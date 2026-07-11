import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  poizonSaleObservations,
  poizonPricePool,
  domesticPricePool,
} from "../../drizzle/schema";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { invokeLLM } from "../_core/llm";
import { rateLimit } from "../lib/rateLimit";
import { fetchWatchPriceUsd } from "../lib/watchCollector";
import { readiness as poizonReadiness } from "../lib/poizonApi";
import {
  evaluateDeal,
  DEFAULT_COST,
  type PriceSample,
} from "../lib/reverseProfit";

function normKeyOf(brand: string | undefined | null, name: string): string {
  return `${brand ?? ""} ${name}`.toLowerCase().replace(/\s+/g, "").slice(0, 250);
}

// ── 가격표 사진 → 상품 추출 (Vision LLM) ──
const EXTRACT_SCHEMA = {
  name: "price_tags",
  schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            productName: { type: "string", description: "상품명(모델명 포함)" },
            brand: { type: "string", description: "브랜드" },
            articleNumber: { type: "string", description: "모델번호/품번/스타일코드(예: FJ4170-004, 207937-2YJ). 없으면 빈 문자열" },
            color: { type: "string", description: "색상(있으면)" },
            sizes: { type: "string", description: "사이즈(여러 개면 쉼표)" },
            listPrice: { type: "number", description: "정상가(원)" },
            salePrice: { type: "number", description: "할인가/판매가(원)" },
            discountPct: { type: "number", description: "할인율(%)" },
          },
          required: ["productName"],
        },
      },
    },
    required: ["items"],
  },
  strict: false,
};

const SYS = `너는 오프라인 매장(아울렛·백화점)의 가격표 사진을 읽는 소싱 비서다.
사진에서 상품마다 다음을 정확히 추출한다:
- brand(브랜드), productName(상품/모델명), articleNumber(모델번호/품번/스타일코드), color(색상), sizes(사이즈, 여러 개면 쉼표로)
- listPrice(정상가, 원), salePrice(할인가/실판매가, 원), discountPct(할인율 %)
규칙:
1) "SALE 50%", "50% OFF" 같은 표시가 있으면 discountPct에 반영하고, 정상가·할인가를 구분한다. 할인가만 보이면 salePrice, 정상가만 보이면 listPrice.
2) 가격은 원화 숫자만(콤마·₩·원 제거). 못 읽는 값은 0 또는 "".
3) 사진에 여러 상품이 있으면 모두 배열로. 없으면 빈 배열.
4) 브랜드/모델은 영문 표기 그대로(예: Crocs Classic Clog, Nike Dunk Low).
5) 모델번호/품번/스타일코드(태그·박스의 영숫자 코드, 예: FJ4170-004, DA8301-100, 207937-2YJ)를 보이면 articleNumber에 정확히. 없으면 "".
반드시 JSON 스키마로만 응답.`;

function parseJson(content: any): { items: any[] } {
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((c: any) => (typeof c === "string" ? c : c.text || "")).join("")
        : "";
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    const obj = JSON.parse(cleaned);
    return { items: Array.isArray(obj.items) ? obj.items : [] };
  } catch {
    return { items: [] };
  }
}

async function extractFromImage(dataUrl: string): Promise<any[]> {
  try {
    const result = await invokeLLM({
      messages: [
        { role: "system", content: SYS },
        {
          role: "user",
          content: [
            { type: "text", text: "이 가격표 사진에서 상품들을 추출해줘." },
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
          ],
        },
      ],
      outputSchema: EXTRACT_SCHEMA,
      temperature: 0,
    });
    return parseJson(result.choices?.[0]?.message?.content).items;
  } catch {
    return [];
  }
}

function effBuy(listPrice: number, salePrice: number): number {
  return salePrice > 0 ? salePrice : listPrice;
}

export const photoSourcingRouter = router({
  scan: protectedProcedure
    .input(
      z.object({
        // data URL(base64) 이미지. 클라이언트에서 축소·압축해서 전송.
        images: z.array(z.string().min(20).max(8_000_000)).min(1).max(12),
        rate: z.number().int().min(1).max(3000).default(1350), // 원/$ (POIZON 시세=중국시장 $)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const uid = ctx.user!.id;
      // 비전 호출은 비싸므로: 유저당 시간당 40장
      const rl = rateLimit(`photo:${uid}`, 40, 60 * 60 * 1000);
      if (!rl.ok)
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `사진 인식이 너무 많습니다. ${rl.retryAfterSec}초 후 다시.`,
        });

      // 1) 각 이미지 OCR·추출 (병렬)
      const perImage = await Promise.all(input.images.map(extractFromImage));
      const raw = perImage.flat();

      // 정규화 + 중복 제거(normKey+sizes)
      const seen = new Set<string>();
      const items = raw
        .map(r => {
          const productName = String(r.productName || "").trim().slice(0, 300);
          if (!productName) return null;
          const brand = String(r.brand || "").trim().slice(0, 100) || null;
          const listPrice = Math.max(0, Math.round(Number(r.listPrice) || 0));
          const salePrice = Math.max(0, Math.round(Number(r.salePrice) || 0));
          if (!listPrice && !salePrice) return null;
          const normKey = normKeyOf(brand, productName);
          const dedup = normKey + "|" + (r.sizes || "");
          if (seen.has(dedup)) return null;
          seen.add(dedup);
          return {
            normKey, productName, brand,
            articleNumber: String(r.articleNumber || "").trim().slice(0, 64) || null,
            color: String(r.color || "").trim().slice(0, 60) || null,
            sizes: String(r.sizes || "").trim().slice(0, 80) || null,
            listPrice, salePrice,
            discountPct: Math.max(0, Math.min(100, Math.round(Number(r.discountPct) || 0))),
          };
        })
        .filter(Boolean) as any[];

      if (items.length === 0)
        return { images: input.images.length, detected: 0, items: [], counts: { buy: 0, watch: 0, skip: 0, noMarket: 0 } };

      // 2) POIZON 관측 로드 (매칭)
      const keys = items.map(i => i.normKey);
      const obs = await db
        .select()
        .from(poizonSaleObservations)
        .where(
          and(
            inArray(poizonSaleObservations.normKey, keys),
            gte(poizonSaleObservations.observedAt, sql`DATE_SUB(NOW(), INTERVAL 90 DAY)`)
          )
        )
        .limit(8000);
      const byKey = new Map<string, PriceSample[]>();
      const soldMax = new Map<string, number>();
      const now = Date.now();
      for (const o of obs) {
        const arr = byKey.get(o.normKey) ?? [];
        arr.push({ priceCny: o.priceCny, at: o.observedAt ? new Date(o.observedAt).getTime() : now });
        byKey.set(o.normKey, arr);
        soldMax.set(o.normKey, Math.max(soldMax.get(o.normKey) ?? 0, o.soldCount30d ?? 0));
      }
      // 관측 없으면 공유 시세 풀 단일 표본 폴백
      const missing = keys.filter(k => !byKey.has(k));
      if (missing.length) {
        const pool = await db
          .select({ normKey: poizonPricePool.normKey, priceCny: poizonPricePool.priceCny })
          .from(poizonPricePool)
          .where(inArray(poizonPricePool.normKey, missing))
          .limit(2000);
        for (const p of pool) { const pc = p.priceCny ?? 0; if (pc > 0) byKey.set(p.normKey, [{ priceCny: pc, at: now }]); }
      }
      // 공유 풀에도 없고 모델번호가 있는 상품 → POIZON 라이브 조회(매장 즉시 판정).
      //   순차·상한(8) — 밴 안전. 자격증명 없으면 skip.
      const pr = poizonReadiness();
      if (pr.appKey && pr.appSecret) {
        const liveTargets = items.filter(it => !byKey.has(it.normKey) && it.articleNumber).slice(0, 8);
        for (const it of liveTargets) {
          try {
            const usd = await fetchWatchPriceUsd(it.articleNumber);
            if (usd != null && usd > 0) byKey.set(it.normKey, [{ priceCny: usd, at: now }]);
          } catch {
            /* 개별 실패 무시 */
          }
        }
      }

      const cost = { ...DEFAULT_COST, rate: input.rate };
      const counts = { buy: 0, watch: 0, skip: 0, noMarket: 0 };
      const out = items.map(it => {
        const buy = effBuy(it.listPrice, it.salePrice);
        const samples = byKey.get(it.normKey);
        let verdict: string = "no_market";
        let deal: any = null;
        if (samples && samples.length) {
          const v = evaluateDeal(buy, samples, now, cost, soldMax.get(it.normKey) || undefined);
          if (v) {
            deal = {
              stableCny: v.stable.stableCny, revenueKrw: v.profit.revenueKrw,
              netProfitKrw: v.profit.netProfitKrw, marginPct: v.profit.marginPct,
              grade: v.grade, recommendQty: v.recommendQty, stars: v.stars,
              hasObservations: samples.length > 1,
            };
            verdict = v.recommendQty > 0 ? "buy" : v.profit.marginPct >= 15 ? "watch" : "skip";
          }
        }
        if (verdict === "buy") counts.buy++;
        else if (verdict === "watch") counts.watch++;
        else if (verdict === "skip") counts.skip++;
        else counts.noMarket++;
        return { ...it, buyKrw: buy, verdict, deal };
      });

      // 3) 국내 최저가 공유 풀에 적립 (오늘 사야 할 상품에도 반영)
      for (const it of items) {
        await db
          .insert(domesticPricePool)
          .values({
            normKey: it.normKey, source: "photo", brand: it.brand,
            productName: it.productName, listPrice: it.listPrice || it.salePrice,
            salePrice: it.salePrice || it.listPrice, discountPct: it.discountPct,
            inStock: true, observeCount: 1,
          })
          .onDuplicateKeyUpdate({
            set: {
              listPrice: it.listPrice || it.salePrice,
              salePrice: it.salePrice || it.listPrice,
              discountPct: it.discountPct,
              observeCount: sql`${domesticPricePool.observeCount} + 1`,
              lastObservedAt: sql`NOW()`,
            },
          })
          .catch(() => {});
      }

      // 추천 우선 정렬
      const order: Record<string, number> = { buy: 0, watch: 1, no_market: 2, skip: 3 };
      out.sort((a, b) => (order[a.verdict] - order[b.verdict]) || (b.deal?.marginPct ?? -999) - (a.deal?.marginPct ?? -999));

      return { images: input.images.length, detected: out.length, items: out, counts };
    }),
});
