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
        .object({ limit: z.number().int().min(5).max(100).default(30) })
        .optional()
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const limit = input?.limit ?? 30;
      // 최근 14일 정찰 표본 (급상승 계산용)
      const rows = await db
        .select()
        .from(poizonTrending)
        .where(gte(poizonTrending.observedAt, sql`DATE_SUB(NOW(), INTERVAL 14 DAY)`))
        .orderBy(poizonTrending.observedAt)
        .limit(6000);

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

      // 오늘 랭킹: 최근 2일 관측 중 normKey별 최상위(최저 rank_pos) — rank 오름차순
      const DAY = 86400000;
      const todayMap = new Map<string, (typeof rows)[number]>();
      for (const r of rows) {
        if (now - at(r) > 2 * DAY || !r.rankPos) continue;
        const prev = todayMap.get(r.normKey);
        if (!prev || (r.rankPos || 999999) < (prev.rankPos || 999999))
          todayMap.set(r.normKey, r);
      }
      const today = [...todayMap.values()]
        .sort((a, b) => (a.rankPos || 999999) - (b.rankPos || 999999))
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
      };
    }),
});
