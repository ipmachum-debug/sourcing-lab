import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  domesticPricePool,
  poizonSaleObservations,
  poizonPricePool,
  reverseSkuWatch,
} from "../../drizzle/schema";
import { and, desc, eq, gte, like, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  evaluateDeal,
  DEFAULT_COST,
  type CostParams,
  type PriceSample,
} from "../lib/reverseProfit";

const DOMESTIC_SOURCES = [
  "musinsa",
  "abcmart",
  "crocs",
  "nike",
  "adidas",
  "newbalance",
  "lfmall",
  "lotteon",
  "ssg",
  "29cm",
  "other",
] as const;

// 상품 매칭키 (브랜드+상품 정규화) — 국내 풀·POIZON 풀 공용
function normKeyOf(brand: string | undefined | null, name: string): string {
  return `${brand ?? ""} ${name}`
    .toLowerCase()
    .replace(/\s+/g, "")
    .slice(0, 250);
}

// 실구매가 = 쿠폰/카드가 > 할인가 > 정상가 순으로 유효한 최저값
function effectiveBuyKrw(r: {
  couponPrice?: number | null;
  salePrice?: number | null;
  listPrice?: number | null;
}): number {
  return r.couponPrice && r.couponPrice > 0
    ? r.couponPrice
    : r.salePrice && r.salePrice > 0
      ? r.salePrice
      : r.listPrice || 0;
}

const costInput = z.object({
  rate: z.number().int().min(1).max(1000).optional(),
  poizonFeePct: z.number().min(0).max(30).optional(),
  chinaShipKrw: z.number().int().min(0).max(100000).optional(),
  fxLossPct: z.number().min(0).max(20).optional(),
  packingKrw: z.number().int().min(0).max(50000).optional(),
  inspectRiskPct: z.number().min(0).max(30).optional(),
});
function resolveCost(i: z.infer<typeof costInput>): CostParams {
  return {
    rate: i.rate ?? DEFAULT_COST.rate,
    poizonFeePct: i.poizonFeePct ?? DEFAULT_COST.poizonFeePct,
    chinaShipKrw: i.chinaShipKrw ?? DEFAULT_COST.chinaShipKrw,
    fxLossPct: i.fxLossPct ?? DEFAULT_COST.fxLossPct,
    packingKrw: i.packingKrw ?? DEFAULT_COST.packingKrw,
    inspectRiskPct: i.inspectRiskPct ?? DEFAULT_COST.inspectRiskPct,
  };
}

export const reverseDealsRouter = router({
  // ===== 국내 최저가 공유 풀 (패시브 수집) =====
  // 확장/유저가 본 국내몰 상품가 제출 → (normKey, source) upsert.
  domesticSubmit: protectedProcedure
    .input(
      z.object({
        source: z.enum(DOMESTIC_SOURCES).default("other"),
        brand: z.string().max(100).optional(),
        productName: z.string().min(1).max(300),
        sku: z.string().max(120).optional(),
        listPrice: z.number().int().min(0).default(0),
        salePrice: z.number().int().min(0).default(0),
        couponPrice: z.number().int().min(0).default(0),
        discountPct: z.number().int().min(0).max(100).default(0),
        imageUrl: z.string().max(1000).optional(),
        productUrl: z.string().max(1000).optional(),
        inStock: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const normKey = normKeyOf(input.brand, input.productName);
      await db
        .insert(domesticPricePool)
        .values({
          normKey,
          source: input.source,
          brand: input.brand ?? null,
          productName: input.productName,
          sku: input.sku ?? null,
          listPrice: input.listPrice,
          salePrice: input.salePrice,
          couponPrice: input.couponPrice,
          discountPct: input.discountPct,
          imageUrl: input.imageUrl ?? null,
          productUrl: input.productUrl ?? null,
          inStock: input.inStock,
          observeCount: 1,
        })
        .onDuplicateKeyUpdate({
          set: {
            brand: input.brand ?? null,
            productName: input.productName,
            sku: input.sku ?? null,
            listPrice: input.listPrice,
            salePrice: input.salePrice,
            couponPrice: input.couponPrice,
            discountPct: input.discountPct,
            inStock: input.inStock,
            observeCount: sql`${domesticPricePool.observeCount} + 1`,
            lastObservedAt: sql`NOW()`,
          },
        });
      return { ok: true };
    }),

  // 국내 풀 조회 (상품별 최저 소스 채움용)
  domesticLookup: protectedProcedure
    .input(z.object({ query: z.string().min(1).max(200) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return db
        .select()
        .from(domesticPricePool)
        .where(like(domesticPricePool.productName, `%${input.query}%`))
        .orderBy(desc(domesticPricePool.lastObservedAt))
        .limit(20);
    }),

  // ===== POIZON 체결 시세 관측 (안정가 산출용) =====
  // 사이즈별 시세 표본 적립 + 최신가는 poizon_price_pool에도 반영.
  poizonObserve: protectedProcedure
    .input(
      z.object({
        brand: z.string().max(100).optional(),
        productName: z.string().min(1).max(300),
        size: z.string().max(40).optional(),
        priceCny: z.number().int().min(1),
        soldCount30d: z.number().int().min(0).default(0),
        source: z.enum(["manual", "extension"]).default("extension"),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const normKey = normKeyOf(input.brand, input.productName);
      await db.insert(poizonSaleObservations).values({
        normKey,
        size: input.size ?? null,
        brand: input.brand ?? null,
        productName: input.productName,
        priceCny: input.priceCny,
        soldCount30d: input.soldCount30d,
        source: input.source,
      });
      // 최신 시세 스냅샷은 공유 풀에도 (오늘의 SKU 자동 채움 호환)
      await db
        .insert(poizonPricePool)
        .values({
          normKey,
          brand: input.brand ?? null,
          productName: input.productName,
          priceCny: input.priceCny,
          source: input.source,
          observeCount: 1,
          contributorCount: 1,
        })
        .onDuplicateKeyUpdate({
          set: {
            priceCny: input.priceCny,
            observeCount: sql`${poizonPricePool.observeCount} + 1`,
            lastObservedAt: sql`NOW()`,
          },
        })
        .catch(() => {});
      return { ok: true };
    }),

  // ===== SKU 상세 (시세/판매 추이 + P25/P50/P75 안정가 밴드) =====
  skuDetail: protectedProcedure
    .input(z.object({ skuId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [sku] = await db
        .select()
        .from(reverseSkuWatch)
        .where(
          and(
            eq(reverseSkuWatch.id, input.skuId),
            eq(reverseSkuWatch.userId, ctx.user!.id)
          )
        )
        .limit(1);
      if (!sku) throw new TRPCError({ code: "NOT_FOUND" });
      const nk = normKeyOf(sku.brand, sku.productName);
      const now = Date.now();
      const obs = await db
        .select()
        .from(poizonSaleObservations)
        .where(
          and(
            eq(poizonSaleObservations.normKey, nk),
            gte(
              poizonSaleObservations.observedAt,
              sql`DATE_SUB(NOW(), INTERVAL 90 DAY)`
            )
          )
        )
        .orderBy(poizonSaleObservations.observedAt)
        .limit(3000);

      const series = obs.map(o => ({
        t: o.observedAt ? new Date(o.observedAt).getTime() : now,
        d: o.observedAt ? String(o.observedAt).slice(0, 10) : "",
        price: o.priceCny,
        sold: o.soldCount30d ?? 0,
        size: o.size ?? null,
      }));

      const pct = (sortedAsc: number[], p: number) => {
        if (sortedAsc.length === 0) return 0;
        if (sortedAsc.length === 1) return sortedAsc[0];
        const idx = (p / 100) * (sortedAsc.length - 1);
        const lo = Math.floor(idx), hi = Math.ceil(idx);
        return lo === hi
          ? sortedAsc[lo]
          : Math.round(sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo));
      };
      const DAY = 86400000;
      const statsFor = (days: number) => {
        const prices = series
          .filter(s => now - s.t <= days * DAY && s.price > 0)
          .map(s => s.price)
          .sort((a, b) => a - b);
        return {
          p25: pct(prices, 25),
          p50: pct(prices, 50),
          p75: pct(prices, 75),
          min: prices[0] ?? 0,
          max: prices[prices.length - 1] ?? 0,
          count: prices.length,
        };
      };
      const stats30 = statsFor(30);
      const stats90 = statsFor(90);

      // 현재 시세 위치 (최근 30일 내 백분위: 0=최저, 100=최고)
      const win30 = series
        .filter(s => now - s.t <= 30 * DAY && s.price > 0)
        .map(s => s.price)
        .sort((a, b) => a - b);
      const latest = series.length ? series[series.length - 1].price : 0;
      const posPct =
        win30.length > 0
          ? Math.round((win30.filter(p => p <= latest).length / win30.length) * 100)
          : 0;

      // 사이즈별 (30일)
      const bySizeMap = new Map<string, { prices: number[]; latest: number; latestT: number }>();
      for (const s of series) {
        if (!s.size || now - s.t > 30 * DAY || s.price <= 0) continue;
        const e = bySizeMap.get(s.size) ?? { prices: [], latest: 0, latestT: 0 };
        e.prices.push(s.price);
        if (s.t >= e.latestT) { e.latest = s.price; e.latestT = s.t; }
        bySizeMap.set(s.size, e);
      }
      const bySize = [...bySizeMap.entries()]
        .map(([size, e]) => ({
          size,
          p50: pct(e.prices.slice().sort((a, b) => a - b), 50),
          latest: e.latest,
          count: e.prices.length,
        }))
        .sort((a, b) => a.size.localeCompare(b.size, undefined, { numeric: true }));

      return {
        sku: {
          id: sku.id, brand: sku.brand, productName: sku.productName,
          domesticPrice: sku.domesticPrice ?? 0, poizonCny: sku.poizonCny ?? 0,
          rate: sku.rate ?? 190, feePct: sku.feePct ?? 9,
        },
        series,
        stats30,
        stats90,
        current: { price: latest, posPct },
        bySize,
      };
    }),

  // ===== 워치리스트 알림 (앱 메인 표시) =====
  // 워치리스트 SKU의 POIZON 시세 ±10% 변동·판매 급증을 관측 표본에서 계산.
  watchAlerts: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const uid = ctx.user!.id;
    const skus = await db
      .select()
      .from(reverseSkuWatch)
      .where(eq(reverseSkuWatch.userId, uid))
      .limit(300);
    if (skus.length === 0) return { alerts: [], watched: 0, withData: 0 };

    const now = Date.now();
    const obs = await db
      .select()
      .from(poizonSaleObservations)
      .where(
        gte(
          poizonSaleObservations.observedAt,
          sql`DATE_SUB(NOW(), INTERVAL 30 DAY)`
        )
      )
      .limit(6000);
    const byKey = new Map<
      string,
      { at: number; price: number; sold: number }[]
    >();
    for (const o of obs) {
      const arr = byKey.get(o.normKey) ?? [];
      arr.push({
        at: o.observedAt ? new Date(o.observedAt).getTime() : now,
        price: o.priceCny,
        sold: o.soldCount30d ?? 0,
      });
      byKey.set(o.normKey, arr);
    }

    const DAY = 86400000;
    type Alert = {
      skuId: number; productName: string; brand: string | null;
      type: "price_drop" | "price_up" | "sold_surge";
      deltaPct: number; latestCny: number; severity: "high" | "med" | "info"; message: string;
    };
    const alerts: Alert[] = [];
    let withData = 0;
    for (const s of skus) {
      const nk = normKeyOf(s.brand, s.productName);
      const arr = (byKey.get(nk) ?? []).sort((a, b) => a.at - b.at);
      if (arr.length < 2) continue;
      withData++;
      const latest = arr[arr.length - 1];
      // 기준가: 최신에서 7일 이전 표본(없으면 최초)
      const base = arr.find(x => latest.at - x.at <= 7 * DAY) ?? arr[0];
      const deltaPct =
        base.price > 0
          ? Math.round(((latest.price - base.price) / base.price) * 1000) / 10
          : 0;
      if (deltaPct <= -10)
        alerts.push({
          skuId: s.id, productName: s.productName, brand: s.brand,
          type: "price_drop", deltaPct, latestCny: latest.price,
          severity: deltaPct <= -20 ? "high" : "med",
          message: `시세 ${deltaPct}% (${latest.price}¥) — ${deltaPct <= -20 ? "손절/조정 검토" : "조정 관찰"}`,
        });
      else if (deltaPct >= 10)
        alerts.push({
          skuId: s.id, productName: s.productName, brand: s.brand,
          type: "price_up", deltaPct, latestCny: latest.price, severity: "info",
          message: `시세 +${deltaPct}% (${latest.price}¥) — 판매 기회`,
        });
      // 판매 급증
      const soldBase = base.sold, soldNow = latest.sold;
      if (soldBase > 0 && soldNow >= soldBase * 1.5 && soldNow - soldBase >= 5)
        alerts.push({
          skuId: s.id, productName: s.productName, brand: s.brand,
          type: "sold_surge",
          deltaPct: Math.round(((soldNow - soldBase) / soldBase) * 1000) / 10,
          latestCny: latest.price, severity: "info",
          message: `판매 급증 ${soldBase}→${soldNow}건`,
        });
    }
    const rank = { high: 0, med: 1, info: 2 } as const;
    alerts.sort(
      (a, b) => rank[a.severity] - rank[b.severity] || Math.abs(b.deltaPct) - Math.abs(a.deltaPct)
    );
    return { alerts, watched: skus.length, withData };
  }),

  // ===== 엑셀/CSV 일괄 업로드 (콜드스타트 시딩) =====
  // 특가 리스트를 한 번에 시딩 → 국내 풀 + POIZON 관측 동시 적립.
  // 크롤 없이 큐레이션한 스테디 SKU를 바로 "오늘 사야 할 상품"에 반영.
  bulkImport: protectedProcedure
    .input(
      z.object({
        rows: z
          .array(
            z.object({
              brand: z.string().max(100).optional(),
              productName: z.string().min(1).max(300),
              size: z.string().max(40).optional(),
              domesticPrice: z.number().int().min(0).default(0),
              source: z.enum(DOMESTIC_SOURCES).default("other"),
              poizonCny: z.number().int().min(0).default(0),
              soldCount30d: z.number().int().min(0).default(0),
            })
          )
          .min(1)
          .max(1000),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      let domestic = 0;
      let poizon = 0;
      for (const r of input.rows) {
        const normKey = normKeyOf(r.brand, r.productName);
        // 국내 매입가 → 공유 풀
        if (r.domesticPrice > 0) {
          await db
            .insert(domesticPricePool)
            .values({
              normKey,
              source: r.source,
              brand: r.brand ?? null,
              productName: r.productName,
              listPrice: r.domesticPrice,
              salePrice: r.domesticPrice,
              inStock: true,
              observeCount: 1,
            })
            .onDuplicateKeyUpdate({
              set: {
                brand: r.brand ?? null,
                productName: r.productName,
                listPrice: r.domesticPrice,
                salePrice: r.domesticPrice,
                inStock: true,
                observeCount: sql`${domesticPricePool.observeCount} + 1`,
                lastObservedAt: sql`NOW()`,
              },
            })
            .catch(() => {});
          domestic++;
        }
        // POIZON 시세 → 체결 관측 + 최신 스냅샷
        if (r.poizonCny > 0) {
          await db
            .insert(poizonSaleObservations)
            .values({
              normKey,
              size: r.size ?? null,
              brand: r.brand ?? null,
              productName: r.productName,
              priceCny: r.poizonCny,
              soldCount30d: r.soldCount30d,
              source: "manual",
            })
            .catch(() => {});
          await db
            .insert(poizonPricePool)
            .values({
              normKey,
              brand: r.brand ?? null,
              productName: r.productName,
              priceCny: r.poizonCny,
              source: "manual",
              observeCount: 1,
              contributorCount: 1,
            })
            .onDuplicateKeyUpdate({
              set: {
                priceCny: r.poizonCny,
                observeCount: sql`${poizonPricePool.observeCount} + 1`,
                lastObservedAt: sql`NOW()`,
              },
            })
            .catch(() => {});
          poizon++;
        }
      }
      return { ok: true, rows: input.rows.length, domestic, poizon };
    }),

  // ===== 오늘 사야 할 상품 TOP N (매입 판단) =====
  // 국내 매입가 × POIZON 안정 판매가 → 순이익·마진율·안정성·추천수량.
  todayDeals: protectedProcedure
    .input(
      costInput.extend({
        limit: z.number().int().min(1).max(50).default(20),
        minMargin: z.number().min(0).max(200).default(30),
        onlyRecommended: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const now = Date.now();
      const cost = resolveCost(input);

      // 1) 최근 60일 POIZON 체결 관측 → normKey별 표본
      const obs = await db
        .select()
        .from(poizonSaleObservations)
        .where(
          gte(
            poizonSaleObservations.observedAt,
            sql`DATE_SUB(NOW(), INTERVAL 60 DAY)`
          )
        )
        .limit(5000);
      const byKey = new Map<
        string,
        { samples: PriceSample[]; soldMax: number; brand: string; name: string }
      >();
      for (const o of obs) {
        const at = o.observedAt ? new Date(o.observedAt).getTime() : now;
        const e = byKey.get(o.normKey) ?? {
          samples: [],
          soldMax: 0,
          brand: o.brand ?? "",
          name: o.productName,
        };
        e.samples.push({ priceCny: o.priceCny, at });
        e.soldMax = Math.max(e.soldMax, o.soldCount30d ?? 0);
        byKey.set(o.normKey, e);
      }

      // 2) 후보: 유저 워치리스트(국내가+POIZON 수동) + 국내 공유 풀(자동 발굴)
      type Cand = {
        normKey: string;
        brand: string;
        name: string;
        domesticBuyKrw: number;
        source: string;
        imageUrl: string | null;
        fallbackCny: number;
      };
      const cands = new Map<string, Cand>();

      const skus = await db
        .select()
        .from(reverseSkuWatch)
        .where(eq(reverseSkuWatch.userId, ctx.user!.id))
        .limit(300);
      for (const s of skus) {
        const nk = normKeyOf(s.brand, s.productName);
        if ((s.domesticPrice ?? 0) <= 0) continue;
        cands.set(nk, {
          normKey: nk,
          brand: s.brand ?? "",
          name: s.productName,
          domesticBuyKrw: s.domesticPrice ?? 0,
          source: "watchlist",
          imageUrl: null,
          fallbackCny: s.poizonCny ?? 0,
        });
      }

      // 국내 공유 풀 — normKey별 최저 실구매가
      const dpool = await db
        .select()
        .from(domesticPricePool)
        .where(eq(domesticPricePool.inStock, true))
        .limit(3000);
      for (const d of dpool) {
        const buy = effectiveBuyKrw(d);
        if (buy <= 0) continue;
        const prev = cands.get(d.normKey);
        if (prev && prev.source === "watchlist") continue; // 워치리스트 우선
        if (!prev || buy < prev.domesticBuyKrw) {
          cands.set(d.normKey, {
            normKey: d.normKey,
            brand: d.brand ?? "",
            name: d.productName,
            domesticBuyKrw: buy,
            source: d.source,
            imageUrl: d.imageUrl ?? null,
            fallbackCny: 0,
          });
        }
      }

      // 3) 매입 판단
      const deals = [];
      for (const c of cands.values()) {
        const hit = byKey.get(c.normKey);
        let samples: PriceSample[] = hit ? hit.samples : [];
        let soldHint = hit ? hit.soldMax : 0;
        if (samples.length === 0 && c.fallbackCny > 0) {
          samples = [{ priceCny: c.fallbackCny, at: now }]; // 관측 없으면 수동 시세 1표본
        }
        if (samples.length === 0) continue;
        const v = evaluateDeal(
          c.domesticBuyKrw,
          samples,
          now,
          cost,
          soldHint || undefined
        );
        if (!v) continue;
        deals.push({
          normKey: c.normKey,
          brand: c.brand,
          productName: c.name,
          source: c.source,
          imageUrl: c.imageUrl,
          domesticBuyKrw: c.domesticBuyKrw,
          stableCny: v.stable.stableCny,
          avg30Cny: v.stable.avg30Cny,
          volume30: v.stable.volume30,
          volatilityPct: v.stable.volatilityPct,
          revenueKrw: v.profit.revenueKrw,
          deductKrw: v.profit.deductKrw,
          netProfitKrw: v.profit.netProfitKrw,
          marginPct: v.profit.marginPct,
          grade: v.grade,
          recommendQty: v.recommendQty,
          stars: v.stars,
          hasObservations: !!hit,
        });
      }

      const filtered = deals
        .filter(d => d.marginPct >= input.minMargin)
        .filter(d => (input.onlyRecommended ? d.recommendQty > 0 : true))
        .sort((a, b) => b.marginPct - a.marginPct)
        .slice(0, input.limit);

      return {
        deals: filtered,
        cost,
        totalCandidates: cands.size,
        withObservations: [...byKey.keys()].length,
      };
    }),
});
