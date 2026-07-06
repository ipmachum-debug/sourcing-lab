import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { poizonTrending, poizonPricePool } from "../../drizzle/schema";
import { gte, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { rateLimit } from "../lib/rateLimit";
import { detectBrand } from "../lib/brandDetect";

function normKeyOf(brand: string | undefined | null, name: string): string {
  return `${brand ?? ""} ${name}`
    .toLowerCase()
    .replace(/\s+/g, "")
    .slice(0, 250);
}

// 대분류 카테고리만 인정(페이지 title 등 garbage 제외)
const CANON_CATS = ["운동화", "신발", "의류", "가방", "액세서리", "장난감", "뷰티"];
function normalizeCat(c: string | null): string | null {
  const s = (c || "").trim();
  if (!s) return null;
  if (CANON_CATS.includes(s)) return s;
  if (/뷰티|퍼스널\s*케어/.test(s)) return "뷰티";
  return null;
}

export const poizonTrendingRouter = router({
  // ===== 정찰 수집 (랭킹/신상 페이지 → 배치 적립) =====
  submit: protectedProcedure
    .input(
      z.object({
        category: z.string().max(80).optional(),
        items: z
          .array(
            z.object({
              productName: z.string().min(1).max(300),
              brand: z.string().max(100).optional(),
              rankPos: z.number().int().min(0).max(100000).default(0),
              isNew: z.boolean().default(false),
              trendingScore: z.number().int().min(0).default(0),
              priceCny: z.number().int().min(0).default(0),
              soldCount: z.number().int().min(0).default(0),
              imageUrl: z.string().max(1000).optional(),
            })
          )
          .min(1)
          .max(120),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // 레이트리밋: 유저당 시간당 500건(랭킹 100개 × 여러 페이지 여유)
      const rl = rateLimit(`ptr:${ctx.user!.id}`, 500, 60 * 60 * 1000);
      if (!rl.ok)
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `요청이 너무 많습니다. ${rl.retryAfterSec}초 후 다시 시도하세요.`,
        });

      const rows = input.items.map(it => {
        const brand = it.brand || detectBrand(it.productName);
        return {
        normKey: normKeyOf(brand, it.productName),
        productName: it.productName,
        brand: brand ?? null,
        rankPos: it.rankPos,
        category: input.category ?? null,
        isNew: it.isNew,
        trendingScore: it.trendingScore,
        priceCny: it.priceCny,
        soldCount: it.soldCount,
        imageUrl: it.imageUrl ?? null,
        source: "extension",
        };
      });
      await db.insert(poizonTrending).values(rows);

      // 시세가 보이면 공유 시세 풀도 갱신 (같은 상품 자동 연계)
      for (const r of rows) {
        if (r.priceCny > 0) {
          await db
            .insert(poizonPricePool)
            .values({
              normKey: r.normKey,
              brand: r.brand,
              productName: r.productName,
              priceCny: r.priceCny,
              source: "extension",
              observeCount: 1,
              contributorCount: 1,
            })
            .onDuplicateKeyUpdate({
              set: {
                priceCny: r.priceCny,
                observeCount: sql`${poizonPricePool.observeCount} + 1`,
                lastObservedAt: sql`NOW()`,
              },
            })
            .catch(() => {});
        }
      }
      return { ok: true, count: rows.length };
    }),

  // ===== 정찰 보드 (오늘 랭킹 · 신상 · 급상승 한 번에) =====
  board: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(5).max(200).default(60),
          category: z.string().max(60).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const limit = input?.limit ?? 60;
      // 최근 14일 정찰 표본 (급상승 계산용)
      const allRows = await db
        .select()
        .from(poizonTrending)
        .where(gte(poizonTrending.observedAt, sql`DATE_SUB(NOW(), INTERVAL 14 DAY)`))
        .orderBy(poizonTrending.observedAt)
        .limit(8000);

      const CANON = CANON_CATS;
      // 카테고리 목록(전체 기준, 상품수 순) — 탭 렌더용
      const catCount = new Map<string, Set<string>>();
      for (const r of allRows) {
        const c = normalizeCat(r.category);
        if (!c) continue;
        const set = catCount.get(c) ?? new Set<string>();
        set.add(r.normKey);
        catCount.set(c, set);
      }
      const categories = CANON.map(name => ({ name, count: catCount.get(name)?.size ?? 0 }))
        .filter(c => c.count > 0);

      // 선택 카테고리로 범위 좁힘
      const catFilter =
        input?.category && input.category !== "전체" ? input.category : null;
      const rows = catFilter
        ? allRows.filter(r => normalizeCat(r.category) === catFilter)
        : allRows;

      const now = Date.now();
      const at = (r: (typeof rows)[number]) =>
        r.observedAt ? new Date(r.observedAt).getTime() : now;

      // normKey별 그룹 (관측 오름차순 유지)
      const byKey = new Map<string, typeof rows>();
      for (const r of rows) {
        const arr = byKey.get(r.normKey) ?? [];
        arr.push(r);
        byKey.set(r.normKey, arr);
      }

      // 오늘 랭킹: 최근 3일 관측 중 normKey별 대표(판매량 최대) — 판매량(거래) 내림차순.
      //   rankPos는 페이지 내 위치라 전역 순위가 안 됨 → 실제 판매량으로 랭킹.
      const DAY = 86400000;
      const todayMap = new Map<string, (typeof rows)[number]>();
      for (const r of rows) {
        if (now - at(r) > 3 * DAY) continue;
        const prev = todayMap.get(r.normKey);
        if (!prev || (r.soldCount ?? 0) > (prev.soldCount ?? 0))
          todayMap.set(r.normKey, r);
      }
      const today = [...todayMap.values()]
        .sort((a, b) => (b.soldCount ?? 0) - (a.soldCount ?? 0))
        .slice(0, limit);

      // 신상: 최근 7일 is_new, normKey별 최신
      const newMap = new Map<string, (typeof rows)[number]>();
      for (const r of rows) {
        if (!r.isNew || now - at(r) > 7 * DAY) continue;
        const prev = newMap.get(r.normKey);
        if (!prev || at(r) > at(prev)) newMap.set(r.normKey, r);
      }
      const newArrivals = [...newMap.values()]
        .sort((a, b) => at(b) - at(a))
        .slice(0, limit);

      // 급상승: normKey별 시세/판매 최신 vs 최초(14일) 변화율
      const surging: {
        normKey: string; productName: string; brand: string | null;
        latestCny: number; prevCny: number; deltaPct: number; soldCount: number; imageUrl: string | null;
      }[] = [];
      for (const [key, arr] of byKey) {
        const withPrice = arr.filter(r => (r.priceCny ?? 0) > 0);
        if (withPrice.length < 2) continue;
        const first = withPrice[0];
        const last = withPrice[withPrice.length - 1];
        const prevCny = first.priceCny ?? 0;
        const latestCny = last.priceCny ?? 0;
        if (prevCny <= 0) continue;
        const deltaPct = Math.round(((latestCny - prevCny) / prevCny) * 1000) / 10;
        if (deltaPct >= 10)
          surging.push({
            normKey: key,
            productName: last.productName,
            brand: last.brand,
            latestCny,
            prevCny,
            deltaPct,
            soldCount: last.soldCount ?? 0,
            imageUrl: last.imageUrl,
          });
      }
      surging.sort((a, b) => b.deltaPct - a.deltaPct);

      return {
        today,
        newArrivals,
        surging: surging.slice(0, limit),
        totalObserved: byKey.size,
        categories,
      };
    }),

  // ===== 카테고리별 급상승 알림 =====
  // 시세 급등·판매 급증·신규 급부상을 카테고리별로 감지. 데이터 쌓일수록 자동 활성.
  surgeAlerts: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(60).default(24) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const limit = input?.limit ?? 24;
      const rows = await db
        .select()
        .from(poizonTrending)
        .where(gte(poizonTrending.observedAt, sql`DATE_SUB(NOW(), INTERVAL 14 DAY)`))
        .orderBy(poizonTrending.observedAt)
        .limit(8000);
      const now = Date.now();
      const DAY = 86400000;
      const at = (r: (typeof rows)[number]) =>
        r.observedAt ? new Date(r.observedAt).getTime() : now;

      const byKey = new Map<string, typeof rows>();
      for (const r of rows) {
        const arr = byKey.get(r.normKey) ?? [];
        arr.push(r);
        byKey.set(r.normKey, arr);
      }

      // 카테고리별 판매량 중앙값(신규 급부상 판정 기준)
      const catSold = new Map<string, number[]>();
      for (const [, arr] of byKey) {
        const last = arr[arr.length - 1];
        const cat = normalizeCat(last.category);
        if (!cat) continue;
        const s = catSold.get(cat) ?? [];
        s.push(last.soldCount ?? 0);
        catSold.set(cat, s);
      }
      const catMedian = new Map<string, number>();
      for (const [cat, s] of catSold) {
        const sorted = s.slice().sort((a, b) => a - b);
        catMedian.set(cat, sorted[Math.floor(sorted.length / 2)] ?? 0);
      }

      type Alert = {
        normKey: string; productName: string; brand: string | null; category: string;
        type: "price_surge" | "sold_surge" | "new_hot";
        deltaPct: number; latestCny: number; soldCount: number;
        severity: "high" | "med" | "info"; message: string;
      };
      const alerts: Alert[] = [];
      for (const [key, arr] of byKey) {
        const last = arr[arr.length - 1];
        const first = arr[0];
        const cat = normalizeCat(last.category);
        if (!cat) continue;
        const latestCny = last.priceCny ?? 0;
        const soldNow = last.soldCount ?? 0;
        const base = { normKey: key, productName: last.productName, brand: last.brand, category: cat, latestCny, soldCount: soldNow };

        // 1) 시세 급등 (2회+ 관측, 가격 상승)
        const prevCny = first.priceCny ?? 0;
        if (arr.length >= 2 && prevCny > 0 && latestCny > 0) {
          const d = Math.round(((latestCny - prevCny) / prevCny) * 1000) / 10;
          if (d >= 10)
            alerts.push({ ...base, type: "price_surge", deltaPct: d, severity: d >= 20 ? "high" : "med", message: `시세 +${d}% (${latestCny.toLocaleString()}원)` });
        }
        // 2) 판매 급증 (2회+ 관측, 거래량 급증)
        const soldPrev = first.soldCount ?? 0;
        if (arr.length >= 2 && soldPrev > 0 && soldNow >= soldPrev * 1.5 && soldNow - soldPrev >= 1000) {
          const d = Math.round(((soldNow - soldPrev) / soldPrev) * 1000) / 10;
          alerts.push({ ...base, type: "sold_surge", deltaPct: d, severity: "med", message: `판매 급증 +${d}% (${soldNow.toLocaleString()})` });
        }
        // 3) 신규 급부상 (3일 내 첫 관측 + 카테고리 중앙값의 2배 이상 판매)
        const med = catMedian.get(cat) ?? 0;
        if (now - at(first) <= 3 * DAY && med > 0 && soldNow >= med * 2 && soldNow >= 3000) {
          alerts.push({ ...base, type: "new_hot", deltaPct: 0, severity: "info", message: `신규 급부상 · 판매 ${soldNow.toLocaleString()}` });
        }
      }

      const rank = { high: 0, med: 1, info: 2 } as const;
      alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || b.soldCount - a.soldCount);
      return { alerts: alerts.slice(0, limit), total: alerts.length };
    }),
});
