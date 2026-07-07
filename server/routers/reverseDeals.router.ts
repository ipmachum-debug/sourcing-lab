import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  domesticPricePool,
  poizonSaleObservations,
  poizonPricePool,
  poizonTrending,
  reverseSkuWatch,
} from "../../drizzle/schema";
import { and, desc, eq, gte, like, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  evaluateDeal,
  stableSellPrice,
  bidForTargetNet,
  DEFAULT_COST,
  type CostParams,
  type PriceSample,
} from "../lib/reverseProfit";
import { detectBrand } from "../lib/brandDetect";
import { bestMatch, makeCandidate } from "../lib/matchProduct";
import { catOf, CANON_CATS } from "../lib/category";
import { cleanSizeLabel, krMmOf } from "../lib/sizeMatch";
import {
  isConfigured as poizonApiConfigured,
  readiness as poizonReadiness,
  selfTest as poizonSelfTest,
} from "../lib/poizonApi";
import { getStoredInfo as poizonStoredInfo } from "../lib/poizonTokenStore";
import { invokeLLM } from "../_core/llm";
import { getKrwUsdRate } from "../lib/fxRate";

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

// 검색어 → 다중 토큰 AND 매칭.
//   "크록스 메가"면 '크록스' AND '메가'가 모두 상품명/브랜드에 있어야 함.
//   단일 부분일치는 '메가'가 '메가데스'(뉴에라)에 오매칭되던 문제가 있어,
//   브랜드+모델처럼 여러 토큰을 주면 교집합으로 좁혀 정밀도를 높인다.
function searchWhere(q: string) {
  const tokens = q
    .split(/\s+/)
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, 6);
  if (tokens.length === 0) return sql`1=1`;
  const clauses = tokens.map(
    t =>
      sql`(${poizonSaleObservations.productName} LIKE ${"%" + t + "%"} OR ${poizonSaleObservations.brand} LIKE ${"%" + t + "%"})`
  );
  return sql.join(clauses, sql` AND `);
}

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
  rate: z.number().int().min(1).max(3000).optional(),
  poizonFeePct: z.number().min(0).max(30).optional(),
  feeMinKrw: z.number().int().min(0).max(200000).optional(),
  feeMaxKrw: z.number().int().min(0).max(500000).optional(),
  extraFeePct: z.number().min(0).max(20).optional(),
  chinaShipKrw: z.number().int().min(0).max(100000).optional(),
  fxLossPct: z.number().min(0).max(20).optional(),
  packingKrw: z.number().int().min(0).max(50000).optional(),
  inspectRiskPct: z.number().min(0).max(30).optional(),
  vatRefund: z.boolean().optional(),
});
function resolveCost(i: z.infer<typeof costInput>): CostParams {
  return {
    rate: i.rate ?? DEFAULT_COST.rate,
    poizonFeePct: i.poizonFeePct ?? DEFAULT_COST.poizonFeePct,
    feeMinKrw: i.feeMinKrw ?? DEFAULT_COST.feeMinKrw,
    feeMaxKrw: i.feeMaxKrw ?? DEFAULT_COST.feeMaxKrw,
    extraFeePct: i.extraFeePct ?? DEFAULT_COST.extraFeePct,
    chinaShipKrw: i.chinaShipKrw ?? DEFAULT_COST.chinaShipKrw,
    fxLossPct: i.fxLossPct ?? DEFAULT_COST.fxLossPct,
    packingKrw: i.packingKrw ?? DEFAULT_COST.packingKrw,
    inspectRiskPct: i.inspectRiskPct ?? DEFAULT_COST.inspectRiskPct,
    vatRefund: i.vatRefund ?? DEFAULT_COST.vatRefund,
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
        barcode: z.string().max(40).optional(), // 바코드(GTIN, JSON-LD) — POIZON SKU와 exact 매칭
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
          barcode: input.barcode ?? null,
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
            barcode: input.barcode ?? null,
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
      const brand = input.brand || detectBrand(input.productName);
      const normKey = normKeyOf(brand, input.productName);
      await db.insert(poizonSaleObservations).values({
        normKey,
        size: input.size ?? null,
        brand: brand ?? null,
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
          brand: brand ?? null,
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
          rate: sku.rate ?? 1350, feePct: sku.feePct ?? 9,
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
          message: `시세 ${deltaPct}% (${latest.price.toLocaleString()}원) — ${deltaPct <= -20 ? "손절/조정 검토" : "조정 관찰"}`,
        });
      else if (deltaPct >= 10)
        alerts.push({
          skuId: s.id, productName: s.productName, brand: s.brand,
          type: "price_up", deltaPct, latestCny: latest.price, severity: "info",
          message: `시세 +${deltaPct}% (${latest.price.toLocaleString()}원) — 판매 기회`,
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

  // ===== POIZON 판매자센터 엑셀(전체 내보내기) 업로더 =====
  // SPU_ID 기준 정확 매칭 + 공식 데이터: 30일 평균 거래가($), 중국 총 판매량, 카테고리(대분류).
  //   중국 시장(득물) 시세는 달러($) → priceCny 필드에 USD 값을 저장(필드명 유지).
  //   한 번의 업로드로 관측(안정가 산출) + 공유 시세 풀 + 정찰 보드(카테고리)까지 시딩.
  sellerImport: protectedProcedure
    .input(
      z.object({
        rows: z
          .array(
            z.object({
              spuId: z.string().max(60).optional(),
              skuId: z.string().max(60).optional(),
              barcode: z.string().max(40).optional(), // 바코드(GTIN) — 국내 exact 매칭
              productName: z.string().min(1).max(300),
              brand: z.string().max(100).optional(),
              category: z.string().max(40).optional(), // 대분류
              size: z.string().max(40).optional(),
              priceUsd: z.number().min(0).max(1000000).default(0), // 30일 평균 거래가($)
              soldCount: z.number().int().min(0).max(100000000).default(0), // 중국 총 판매량
              expectedProfitUsd: z.number().min(-1000000).max(1000000).optional(), // 예상 수익($)
              lowestBidUsd: z.number().min(0).max(1000000).optional(), // 현재 중국 최저 입찰가($)
              bidAvailable: z.boolean().optional(), // 입찰 가능 여부
              bidStatus: z.string().max(24).optional(), // 입찰 상태(원문)
              localSellerCount: z.number().int().min(0).max(100000000).optional(), // 현지 판매자 판매량
            })
          )
          .min(1)
          .max(2000),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 1) 관측(SKU 단위) — 시세 있는 행만 안정가 표본으로 적립
      const obsRows = [];
      // 2) SPU 단위 집계(공유 풀 upsert + 정찰 보드 시딩용)
      type Spu = {
        normKey: string; spuId: string | null; brand: string | null;
        name: string; category: string | null; prices: number[]; soldMax: number;
      };
      const spuMap = new Map<string, Spu>();

      for (const r of input.rows) {
        const brand = r.brand || detectBrand(r.productName) || null;
        const normKey = normKeyOf(brand, r.productName);
        const priceUsd = Math.round(r.priceUsd);
        // 시세·판매량이 없어도 입찰 데이터(예상수익/최저입찰가)가 있으면 적립
        const hasSignal =
          priceUsd > 0 ||
          r.soldCount > 0 ||
          (r.expectedProfitUsd ?? 0) !== 0 ||
          (r.lowestBidUsd ?? 0) > 0;
        if (hasSignal) {
          obsRows.push({
            normKey,
            spuId: r.spuId ?? null,
            skuId: r.skuId ?? null,
            barcode: r.barcode ?? null,
            size: r.size ?? null,
            brand,
            productName: r.productName,
            priceCny: priceUsd, // ★ USD 값(중국시장 달러) — 필드명 유지
            soldCount30d: r.soldCount,
            expectedProfitUsd:
              r.expectedProfitUsd != null ? Math.round(r.expectedProfitUsd) : null,
            lowestBidUsd: r.lowestBidUsd != null ? Math.round(r.lowestBidUsd) : null,
            bidAvailable: r.bidAvailable ?? null,
            bidStatus: r.bidStatus ?? null,
            localSellerCount: r.localSellerCount ?? null,
            source: "seller" as const,
          });
        }
        const g = spuMap.get(normKey) ?? {
          normKey, spuId: r.spuId ?? null, brand, name: r.productName,
          category: r.category?.trim() || null, prices: [], soldMax: 0,
        };
        if (priceUsd > 0) g.prices.push(priceUsd);
        g.soldMax = Math.max(g.soldMax, r.soldCount);
        spuMap.set(normKey, g);
      }

      // 관측 배치 삽입 (500개씩)
      let observations = 0;
      for (let i = 0; i < obsRows.length; i += 500) {
        const chunk = obsRows.slice(i, i + 500);
        if (chunk.length === 0) continue;
        await db.insert(poizonSaleObservations).values(chunk).catch(() => {});
        observations += chunk.length;
      }

      // SPU 단위: 공유 시세 풀 upsert + 정찰 보드(카테고리) 시딩
      const median = (arr: number[]) => {
        if (arr.length === 0) return 0;
        const s = arr.slice().sort((a, b) => a - b);
        return s[Math.floor(s.length / 2)];
      };
      const trendingRows = [];
      let pool = 0;
      for (const g of spuMap.values()) {
        const price = median(g.prices);
        if (price > 0) {
          await db
            .insert(poizonPricePool)
            .values({
              normKey: g.normKey,
              brand: g.brand,
              productName: g.name,
              priceCny: price,
              source: "seller",
              observeCount: 1,
              contributorCount: 1,
            })
            .onDuplicateKeyUpdate({
              set: {
                priceCny: price,
                observeCount: sql`${poizonPricePool.observeCount} + 1`,
                lastObservedAt: sql`NOW()`,
              },
            })
            .catch(() => {});
          pool++;
        }
        trendingRows.push({
          normKey: g.normKey,
          productName: g.name,
          brand: g.brand,
          rankPos: 0,
          category: g.category,
          isNew: false,
          trendingScore: 0,
          priceCny: price,
          soldCount: g.soldMax,
          source: "seller",
        });
      }
      // 정찰 보드 시딩 (500개씩) — 카테고리 탭·급상승 데이터 소스
      for (let i = 0; i < trendingRows.length; i += 500) {
        const chunk = trendingRows.slice(i, i + 500);
        if (chunk.length === 0) continue;
        await db.insert(poizonTrending).values(chunk).catch(() => {});
      }

      return {
        ok: true,
        rows: input.rows.length,
        observations,
        spus: spuMap.size,
        pool,
      };
    }),

  // ===== 판매자 데이터 초기화 =====
  // 잘못 저장된(예: 원화 오염) 판매자 카탈로그를 지우고 깨끗하게 재업로드하기 위함.
  //   source='seller' 관측·정찰·시세 풀만 삭제(확장/수동 데이터는 보존).
  sellerClear: protectedProcedure.mutation(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const o = await db
      .delete(poizonSaleObservations)
      .where(eq(poizonSaleObservations.source, "seller"));
    const t = await db
      .delete(poizonTrending)
      .where(eq(poizonTrending.source, "seller"));
    const p = await db
      .delete(poizonPricePool)
      .where(eq(poizonPricePool.source, "seller"));
    const cnt = (r: any) => Number(r?.[0]?.affectedRows ?? r?.affectedRows ?? 0);
    return { ok: true, observations: cnt(o), trending: cnt(t), pool: cnt(p) };
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

      // 1-b) 유사 매칭용 POIZON 시세 후보 (공유 시세 풀 최신가 — 이름이 조금 달라도 연결)
      const poolRows = await db
        .select({
          brand: poizonPricePool.brand,
          productName: poizonPricePool.productName,
          priceCny: poizonPricePool.priceCny,
        })
        .from(poizonPricePool)
        .limit(4000);
      const fuzzyCands = poolRows
        .filter(p => (p.priceCny ?? 0) > 0)
        .map(p => makeCandidate(p.productName, p.brand, { priceCny: p.priceCny ?? 0 }));

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
        let matchType: "exact" | "watchlist" | "fuzzy" = hit ? "exact" : "watchlist";
        if (samples.length === 0 && c.fallbackCny > 0) {
          samples = [{ priceCny: c.fallbackCny, at: now }]; // 워치리스트 수동 시세
          matchType = "watchlist";
        }
        if (samples.length === 0) {
          // 유사 매칭: 국내 상품명으로 POIZON 시세 풀에서 근접 상품 찾기
          const fm = bestMatch(c.name, c.brand || null, fuzzyCands, 3);
          if (fm) {
            samples = [{ priceCny: fm.ref.priceCny, at: now }];
            matchType = "fuzzy";
          }
        }
        if (samples.length === 0) continue;
        const v = evaluateDeal(
          c.domesticBuyKrw,
          samples,
          now,
          cost,
          soldHint || undefined,
          catOf({ category: null, productName: c.name })
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
          feeKrw: v.profit.feeKrw + v.profit.extraFeeKrw,
          effectiveFeePct: v.profit.effectiveFeePct,
          vatRefundKrw: v.profit.vatRefundKrw,
          deductKrw: v.profit.deductKrw,
          netProfitKrw: v.profit.netProfitKrw,
          marginPct: v.profit.marginPct,
          lowPrice: v.profit.lowPrice,
          feeFloorHit: v.profit.feeFloorHit,
          grade: v.grade,
          recommendQty: v.recommendQty,
          stars: v.stars,
          hasObservations: !!hit,
          matchType,
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

  // ===== 소싱 큐 (카탈로그 주도) =====
  // POIZON 전체 카탈로그(판매자 엑셀)를 SPU(상품)로 묶어, "국내가만 잡으면 딜"인
  // 순서로 세운다. 두 축:
  //   · 발굴(hunt): 판매량은 높은데 국내 매입가 미확보 → 국내 소싱 우선순위
  //   · 딜(deal):   국내가 확보 + 마진 통과 → 바로 매입
  // 검색(상품명/브랜드)·카테고리(대분류)·상태 탭 지원.
  sourcingQueue: protectedProcedure
    .input(
      costInput.extend({
        search: z.string().max(100).optional(),
        category: z.string().max(40).optional(),
        status: z.enum(["all", "hunt", "deal"]).default("all"),
        minMargin: z.number().min(0).max(200).default(30),
        minSold: z.number().int().min(0).max(10_000_000).default(1),
        limit: z.number().int().min(1).max(200).default(60),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const now = Date.now();
      const cost = resolveCost(input);
      const q = (input.search ?? "").trim();

      // 1) POIZON 관측(카탈로그) — 검색어 있으면 SQL LIKE 선필터
      const obs = await db
        .select({
          normKey: poizonSaleObservations.normKey,
          spuId: poizonSaleObservations.spuId,
          barcode: poizonSaleObservations.barcode,
          size: poizonSaleObservations.size,
          brand: poizonSaleObservations.brand,
          productName: poizonSaleObservations.productName,
          priceCny: poizonSaleObservations.priceCny,
          soldCount30d: poizonSaleObservations.soldCount30d,
          observedAt: poizonSaleObservations.observedAt,
        })
        .from(poizonSaleObservations)
        .where(searchWhere(q))
        .orderBy(desc(poizonSaleObservations.observedAt))
        .limit(20000);

      // 2) 카테고리 맵(정찰 보드/판매자 시딩) normKey → 대분류
      const trows = await db
        .select({
          normKey: poizonTrending.normKey,
          category: poizonTrending.category,
          productName: poizonTrending.productName,
          imageUrl: poizonTrending.imageUrl,
        })
        .from(poizonTrending)
        .limit(20000);
      const catByKey = new Map<string, string | null>();
      const imgByKey = new Map<string, string | null>();
      for (const t of trows) {
        if (!catByKey.has(t.normKey))
          catByKey.set(t.normKey, t.category ?? null);
        if (t.imageUrl && !imgByKey.get(t.normKey))
          imgByKey.set(t.normKey, t.imageUrl);
      }

      // 3) 국내 공유 풀 — normKey별 최저 실구매가 + 바코드 인덱스
      const dpool = await db
        .select()
        .from(domesticPricePool)
        .where(eq(domesticPricePool.inStock, true))
        .limit(8000);
      const domByNorm = new Map<
        string,
        { buy: number; source: string; url: string | null; img: string | null }
      >();
      const domByBarcode = new Map<
        string,
        { buy: number; source: string; url: string | null; img: string | null }
      >();
      for (const d of dpool) {
        const buy = effectiveBuyKrw(d);
        if (buy <= 0) continue;
        const rec = {
          buy,
          source: d.source,
          url: d.productUrl ?? null,
          img: d.imageUrl ?? null,
        };
        const pn = domByNorm.get(d.normKey);
        if (!pn || buy < pn.buy) domByNorm.set(d.normKey, rec);
        if (d.barcode) {
          const pb = domByBarcode.get(d.barcode);
          if (!pb || buy < pb.buy) domByBarcode.set(d.barcode, rec);
        }
      }

      // 4) SPU(상품)로 묶음 — 사이즈별 SKU → 모델 1줄 롤업
      type Grp = {
        groupKey: string; normKey: string; spuId: string | null;
        brand: string; name: string; barcodes: Set<string>;
        samples: PriceSample[]; soldMax: number; sizes: Set<string>;
      };
      const groups = new Map<string, Grp>();
      for (const o of obs) {
        const gk = o.spuId || o.normKey;
        const at = o.observedAt ? new Date(o.observedAt).getTime() : now;
        const g =
          groups.get(gk) ??
          ({
            groupKey: gk, normKey: o.normKey, spuId: o.spuId ?? null,
            brand: o.brand ?? "", name: o.productName, barcodes: new Set(),
            samples: [], soldMax: 0, sizes: new Set(),
          } as Grp);
        if (o.priceCny > 0) g.samples.push({ priceCny: o.priceCny, at });
        g.soldMax = Math.max(g.soldMax, o.soldCount30d ?? 0);
        if (o.barcode) g.barcodes.add(o.barcode);
        const qsz = cleanSizeLabel(o.size);
        if (qsz) g.sizes.add(qsz);
        groups.set(gk, g);
      }

      // 5) 매입 판단 + 상태 분류
      const catFilter =
        input.category && input.category !== "전체" ? input.category : null;
      let huntCount = 0, dealCount = 0, thinCount = 0;
      const catCount = new Map<string, Set<string>>();
      type Row = {
        groupKey: string; normKey: string; spuId: string | null;
        brand: string; productName: string; category: string | null;
        imageUrl: string | null; sizeCount: number;
        stableUsd: number; lowUsd: number; highUsd: number;
        soldCount: number; volatilityPct: number;
        hasDomestic: boolean; domesticBuyKrw: number; domesticSource: string | null;
        domesticUrl: string | null; matchBy: "barcode" | "name" | null;
        netProfitKrw: number; marginPct: number; grade: string; recommendQty: number;
        revenueKrw: number; feeKrw: number; vatRefundKrw: number;
        floorBidUsd: number; targetBidUsd: number;
        status: "hunt" | "deal" | "thin"; score: number;
      };
      const rows: Row[] = [];
      for (const g of groups.values()) {
        const stable = stableSellPrice(g.samples, now, g.soldMax);
        if (!stable) continue;
        const category = catOf({
          category: catByKey.get(g.normKey) ?? null,
          productName: g.name,
        });
        if (catFilter && category !== catFilter) continue;
        if (category) {
          const set = catCount.get(category) ?? new Set<string>();
          set.add(g.groupKey);
          catCount.set(category, set);
        }

        // 국내 매칭: 바코드 exact 우선 → normKey
        let dom: { buy: number; source: string; url: string | null; img: string | null } | undefined;
        let matchBy: "barcode" | "name" | null = null;
        for (const bc of g.barcodes) {
          const hit = domByBarcode.get(bc);
          if (hit && (!dom || hit.buy < dom.buy)) { dom = hit; matchBy = "barcode"; }
        }
        if (!dom) {
          const hit = domByNorm.get(g.normKey);
          if (hit) { dom = hit; matchBy = "name"; }
        }

        let netProfitKrw = 0, marginPct = 0, grade = "-", recommendQty = 0;
        let revenueKrw = 0, feeKrw = 0, vatRefundKrw = 0; // 실순익 분해(판매가·수수료·부가세환급)
        let floorBidUsd = 0, targetBidUsd = 0; // 방어선($, 손익분기) · 목표순익 확보가($)
        let status: "hunt" | "deal" | "thin";
        if (dom) {
          const v = evaluateDeal(dom.buy, g.samples, now, cost, g.soldMax, category);
          if (v) {
            netProfitKrw = v.profit.netProfitKrw;
            marginPct = v.profit.marginPct;
            grade = v.grade;
            recommendQty = v.recommendQty;
            revenueKrw = v.profit.revenueKrw;
            feeKrw = v.profit.feeKrw + v.profit.extraFeeKrw;
            vatRefundKrw = v.profit.vatRefundKrw;
          }
          floorBidUsd = bidForTargetNet(dom.buy, 0, cost, category);
          targetBidUsd = bidForTargetNet(dom.buy, 20000, cost, category);
          status = marginPct >= input.minMargin ? "deal" : "thin";
        } else {
          // 국내가 미확보: 판매량 있으면 발굴 대상, 없으면 thin
          status = g.soldMax >= input.minSold ? "hunt" : "thin";
        }
        if (status === "deal") dealCount++;
        else if (status === "hunt") huntCount++;
        else thinCount++;

        // 정렬 점수: 딜(마진) → 발굴(수요) → 기타
        const score =
          status === "deal"
            ? 2e9 + marginPct
            : status === "hunt"
              ? 1e9 + Math.min(g.soldMax, 9e8)
              : Math.min(g.soldMax, 1e8);

        rows.push({
          groupKey: g.groupKey, normKey: g.normKey, spuId: g.spuId,
          brand: g.brand, productName: g.name, category,
          imageUrl: dom?.img ?? imgByKey.get(g.normKey) ?? null,
          sizeCount: g.sizes.size,
          stableUsd: stable.stableCny, lowUsd: stable.lowCny, highUsd: stable.highCny,
          soldCount: g.soldMax, volatilityPct: stable.volatilityPct,
          hasDomestic: !!dom, domesticBuyKrw: dom?.buy ?? 0,
          domesticSource: dom?.source ?? null, domesticUrl: dom?.url ?? null,
          matchBy, netProfitKrw, marginPct, grade, recommendQty,
          revenueKrw, feeKrw, vatRefundKrw,
          floorBidUsd, targetBidUsd, status, score,
        });
      }

      const filtered = rows
        .filter(r => (input.status === "all" ? true : r.status === input.status))
        .sort((a, b) => b.score - a.score)
        .slice(0, input.limit);

      const categories = CANON_CATS.map(name => ({
        name,
        count: catCount.get(name)?.size ?? 0,
      })).filter(c => c.count > 0);

      return {
        rows: filtered,
        cost,
        counts: { hunt: huntCount, deal: dealCount, thin: thinCount, total: groups.size },
        categories,
      };
    }),

  // ===== 카탈로그 인사이트 (소싱 엔진) =====
  // 판매자 다운로드 자료 집계: ①모델 판매량 랭킹 ②가격대별($) 수요 ③사이즈 분포.
  //   POIZON 판매량은 SPU(상품) 단위 총계 → 모델·가격대는 정확, 사이즈는 수요가중 취급 분포.
  catalogInsights: protectedProcedure
    .input(
      z.object({
        search: z.string().max(100).optional(), // 브랜드·상품명(예: 크록스)
        category: z.string().max(40).optional(),
        filter: z
          .enum(["all", "hot", "margin", "safe", "blue", "risk", "bid"])
          .default("all"),
        limit: z.number().int().min(1).max(100).default(30),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const q = (input.search ?? "").trim();

      // 최신 스냅샷 우선: observedAt DESC로 읽어 SKU별 첫 등장(=최신)만 사용
      const obsAll = await db
        .select({
          normKey: poizonSaleObservations.normKey,
          spuId: poizonSaleObservations.spuId,
          skuId: poizonSaleObservations.skuId,
          size: poizonSaleObservations.size,
          brand: poizonSaleObservations.brand,
          productName: poizonSaleObservations.productName,
          priceCny: poizonSaleObservations.priceCny,
          soldCount30d: poizonSaleObservations.soldCount30d,
          expectedProfitUsd: poizonSaleObservations.expectedProfitUsd,
          lowestBidUsd: poizonSaleObservations.lowestBidUsd,
          bidAvailable: poizonSaleObservations.bidAvailable,
          bidStatus: poizonSaleObservations.bidStatus,
          localSellerCount: poizonSaleObservations.localSellerCount,
        })
        .from(poizonSaleObservations)
        .where(searchWhere(q))
        .orderBy(desc(poizonSaleObservations.observedAt))
        .limit(40000);
      // SKU 단위 최신만
      const seenSku = new Set<string>();
      const obs = [] as typeof obsAll;
      for (const o of obsAll) {
        const k = o.skuId || `${o.spuId || o.normKey}|${o.size || ""}`;
        if (seenSku.has(k)) continue;
        seenSku.add(k);
        obs.push(o);
      }

      // 카테고리 맵(정찰/판매자 시딩)
      const trows = await db
        .select({
          normKey: poizonTrending.normKey,
          category: poizonTrending.category,
        })
        .from(poizonTrending)
        .limit(20000);
      const catByKey = new Map<string, string | null>();
      for (const t of trows)
        if (!catByKey.has(t.normKey)) catByKey.set(t.normKey, t.category ?? null);

      const median = (arr: number[]) => {
        if (arr.length === 0) return 0;
        const s = arr.slice().sort((a, b) => a - b);
        return s[Math.floor(s.length / 2)];
      };

      // SPU(상품) 단위 묶음 (사이즈별 입찰/수익 레코드 포함)
      type SizeRec = {
        size: string | null; price: number; profit: number | null;
        bid: number | null; bidAvailable: boolean | null; unbid: boolean;
      };
      type G = {
        normKey: string; brand: string; name: string; category: string | null;
        prices: number[]; soldMax: number; localSellerMax: number;
        sizes: Set<string>; recs: SizeRec[];
      };
      const groups = new Map<string, G>();
      const catFilter =
        input.category && input.category !== "전체" ? input.category : null;
      const catCount = new Map<string, Set<string>>();
      for (const o of obs) {
        const gk = o.spuId || o.normKey;
        const g =
          groups.get(gk) ??
          ({
            normKey: o.normKey, brand: o.brand ?? "", name: o.productName,
            category: catOf({ category: catByKey.get(o.normKey) ?? null, productName: o.productName }),
            prices: [], soldMax: 0, localSellerMax: 0,
            sizes: new Set<string>(), recs: [],
          } as G);
        if (o.priceCny > 0) g.prices.push(o.priceCny);
        g.soldMax = Math.max(g.soldMax, o.soldCount30d ?? 0);
        g.localSellerMax = Math.max(g.localSellerMax, o.localSellerCount ?? 0);
        const sz = cleanSizeLabel(o.size); // 색상·괄호 제거한 순수 사이즈
        if (sz) g.sizes.add(sz);
        const st = String(o.bidStatus ?? "").trim().toLowerCase();
        // 입찰 상태 "0:미입찰 1:입찰완료" — 엑셀은 0.0/1.0 float 문자열로 들어옴
        const unbid = /미입찰|not\s*bid|nobid|no\s*bid|없음|none|^0(\.0+)?$/.test(st);
        g.recs.push({
          size: sz, price: o.priceCny ?? 0,
          profit: o.expectedProfitUsd ?? null, bid: o.lowestBidUsd ?? null,
          bidAvailable: o.bidAvailable ?? null, unbid,
        });
        groups.set(gk, g);
      }

      // 카테고리 칩 카운트(필터 전 전체 기준)
      for (const [gk, g] of groups) {
        if (g.category) {
          const set = catCount.get(g.category) ?? new Set<string>();
          set.add(gk);
          catCount.set(g.category, set);
        }
      }

      const list = [...groups.values()].filter(
        g => !catFilter || g.category === catFilter
      );

      // ① 모델 엔리치먼트 — 발굴 필터·리스크 점수·입찰 추천·사이즈 추천
      const enriched = list.map(g => {
        // ★ 유동 사이즈만 사용 — 최저입찰가가 거래가보다 과도히 높으면(희귀/저유동)
        //   현재가가 스파이크라 정산이 부풀려짐 → 제외해야 현실적. (예: 거래가 $85인데 입찰 $124)
        const reliable = g.recs.filter(
          r => r.price > 0 && (r.bid == null || r.bid <= r.price * 1.3)
        );
        const pool = reliable.length ? reliable : g.recs.filter(r => r.price > 0);
        const priced = pool.slice().sort((a, b) => a.price - b.price);
        // 대표 사이즈 = 거래가 중앙값. 단, 정산(예상)이 채워진 사이즈를 우선해
        //   '정산 대표 -' 빈칸을 막는다(정산값 없는 사이즈가 중앙에 걸리는 경우 방지).
        const repArr = priced.filter(r => r.profit != null);
        const repPool = repArr.length ? repArr : priced;
        const rep = repPool.length ? repPool[Math.floor(repPool.length / 2)] : null;
        const avgUsd = rep ? rep.price : median(g.prices);
        const lowestBidUsd = rep?.bid ?? null; // 대표 사이즈 최저입찰가
        const profitUsd = rep?.profit ?? null; // 대표 사이즈 POIZON 정산(예상)=판매가−수수료
        const poolProfits = pool.map(r => r.profit).filter((x): x is number => x != null);
        const bestProfitUsd = poolProfits.length ? Math.max(...poolProfits) : null;
        const minProfitUsd = poolProfits.length ? Math.min(...poolProfits) : null;
        const bidAvailCnt = g.recs.filter(r => r.bidAvailable === true).length;
        const unbidCnt = g.recs.filter(r => r.unbid).length;
        const localSeller = g.localSellerMax;
        // 경쟁도 낮음: 현지 판매자가 없거나 중국 총판매의 30% 이하
        const lowComp = localSeller === 0 || (g.soldMax > 0 && localSeller <= g.soldMax * 0.3);
        // 리스크 점수(높을수록 위험): 무판매·저마진·경쟁과다
        let riskScore = 0;
        if (g.soldMax < 10) riskScore += 35;
        if (g.soldMax < 3) riskScore += 20;
        if (profitUsd != null && profitUsd <= 0) riskScore += 20;
        if (!lowComp) riskScore += 15;
        if (avgUsd > 0 && g.soldMax < 3) riskScore += 10; // 가격만 있고 사실상 무판매
        riskScore = Math.min(100, riskScore);
        // 발굴 플래그
        const safe = g.soldMax > 0 && bidAvailCnt > 0 && avgUsd > 0;
        const blue = g.soldMax >= 10 && lowComp;
        const riskFlag = g.soldMax < 5 && avgUsd > 0; // 판매 거의 없는데 가격만 있음
        const bidRec =
          (profitUsd ?? 0) >= 20 && g.soldMax >= 10 && lowComp &&
          bidAvailCnt > 0 && unbidCnt > 0;
        // 추천 입찰가: 게이트 통과 시 대표 사이즈 최저입찰가에 매칭(약간 낮게)
        const recommendBidUsd = bidRec ? lowestBidUsd : null;
        // 사이즈 추천: 유동 사이즈 중 정산(예상) 높은 순 + 입찰 공백 우선
        const bestSizes = pool
          .filter(r => r.size)
          .map(r => ({
            size: r.size as string, krMm: krMmOf(r.size), profit: r.profit ?? 0, bid: r.bid ?? 0,
            price: r.price ?? 0, bidAvailable: r.bidAvailable === true, unbid: r.unbid,
          }))
          .sort((a, b) => b.profit - a.profit || Number(b.unbid) - Number(a.unbid))
          .slice(0, 5);

        // ── 위험 별점(0~5) + 종합 등급 ─────────────────────
        //   판매량·가격안정·가품위험·사이즈위험을 별점화 → A+~D. (데이터 기반 근사)
        const minP = g.prices.length ? Math.min(...g.prices) : avgUsd;
        const maxP = g.prices.length ? Math.max(...g.prices) : avgUsd;
        const demandStars =
          g.soldMax >= 1000 ? 5 : g.soldMax >= 300 ? 4 : g.soldMax >= 100 ? 3 : g.soldMax >= 30 ? 2 : g.soldMax >= 5 ? 1 : 0;
        const spread = avgUsd > 0 ? (maxP - minP) / avgUsd : 1;
        const stabilityStars =
          spread <= 0.15 ? 5 : spread <= 0.3 ? 4 : spread <= 0.5 ? 3 : spread <= 0.8 ? 2 : 1;
        // 가품위험: 최저가가 대표가 대비 과도히 낮으면 의심(별점↓). 완만하면 안전(별점↑).
        const dip = avgUsd > 0 ? (avgUsd - minP) / avgUsd : 0;
        const authStars = dip <= 0.2 ? 5 : dip <= 0.35 ? 4 : dip <= 0.5 ? 3 : dip <= 0.7 ? 2 : 1;
        // 사이즈위험: 유동(신뢰) 사이즈가 많을수록 안전.
        const liqSizes = reliable.length;
        const sizeStars =
          liqSizes >= 8 ? 5 : liqSizes >= 5 ? 4 : liqSizes >= 3 ? 3 : liqSizes >= 2 ? 2 : 1;
        const avgStars = (demandStars * 1.2 + stabilityStars + authStars + sizeStars) / 4.2;
        const grade =
          avgStars >= 4.6 ? "A+" : avgStars >= 4.0 ? "A" : avgStars >= 3.2 ? "B" : avgStars >= 2.4 ? "C" : "D";
        const scores = {
          demand: demandStars, stability: stabilityStars,
          authenticity: authStars, size: sizeStars, grade,
        };

        return {
          normKey: g.normKey, brand: g.brand, productName: g.name, category: g.category,
          soldCount: g.soldMax, avgUsd,
          lowUsd: g.prices.length ? Math.min(...g.prices) : 0,
          highUsd: g.prices.length ? Math.max(...g.prices) : 0,
          sizeCount: g.sizes.size,
          profitUsd, minProfitUsd, bestProfitUsd, lowestBidUsd, bidAvailCnt, unbidCnt, localSeller,
          riskScore, safe, blue, risk: riskFlag, bidRec, recommendBidUsd, bestSizes, scores,
        };
      });

      // 필터별 개수(탭 뱃지)
      const counts = {
        all: enriched.length,
        hot: enriched.filter(m => m.soldCount > 0).length,
        margin: enriched.filter(m => (m.profitUsd ?? 0) > 0).length,
        safe: enriched.filter(m => m.safe).length,
        blue: enriched.filter(m => m.blue).length,
        risk: enriched.filter(m => m.risk).length,
        bid: enriched.filter(m => m.bidRec).length,
      };

      // 필터 적용 + 정렬
      const F = input.filter;
      let picked = enriched;
      if (F === "safe") picked = enriched.filter(m => m.safe);
      else if (F === "blue") picked = enriched.filter(m => m.blue);
      else if (F === "risk") picked = enriched.filter(m => m.risk);
      else if (F === "bid") picked = enriched.filter(m => m.bidRec);
      picked = [...picked].sort((a, b) => {
        if (F === "margin" || F === "bid")
          return (b.profitUsd ?? -1e9) - (a.profitUsd ?? -1e9);
        if (F === "risk") return b.riskScore - a.riskScore;
        return b.soldCount - a.soldCount; // hot/all/safe/blue → 판매량
      });
      const models = picked.slice(0, input.limit);

      // ② 가격대별($) 수요 — 모델 중앙가 기준 버킷
      const BANDS: [number, number, string][] = [
        [0, 50, "~$50"],
        [50, 100, "$50–100"],
        [100, 150, "$100–150"],
        [150, 250, "$150–250"],
        [250, 400, "$250–400"],
        [400, Infinity, "$400+"],
      ];
      const bands = BANDS.map(([lo, hi, label]) => {
        const inBand = list.filter(g => {
          const p = median(g.prices);
          return p >= lo && p < hi;
        });
        return {
          label, lo, hi: hi === Infinity ? null : hi,
          models: inBand.length,
          totalSold: inBand.reduce((a, g) => a + g.soldMax, 0),
        };
      }).filter(b => b.models > 0);

      // ③ 사이즈 분포 — 수요가중(인기 모델이 취급하는 사이즈)
      const sizeMap = new Map<string, { models: number; demand: number; prices: number[] }>();
      for (const g of list) {
        const p = median(g.prices);
        for (const sz of g.sizes) {
          const e = sizeMap.get(sz) ?? { models: 0, demand: 0, prices: [] };
          e.models += 1;
          e.demand += g.soldMax;
          if (p > 0) e.prices.push(p);
          sizeMap.set(sz, e);
        }
      }
      const sizes = [...sizeMap.entries()]
        .map(([size, e]) => ({
          size, krMm: krMmOf(size), models: e.models, demand: e.demand, medianUsd: median(e.prices),
        }))
        .sort((a, b) => b.demand - a.demand)
        .slice(0, 24);

      const categories = CANON_CATS.map(name => ({
        name, count: catCount.get(name)?.size ?? 0,
      })).filter(c => c.count > 0);

      return {
        models,
        counts,
        filter: F,
        bands,
        sizes,
        categories,
        summary: {
          totalModels: list.length,
          totalSold: list.reduce((a, g) => a + g.soldMax, 0),
          avgUsd: median(list.map(g => median(g.prices)).filter(x => x > 0)),
        },
      };
    }),

  // ===== 모니터링 — 업로드 스냅샷 diff ("이번에 좋아진 상품") =====
  //   업로드 간격(주/2주 무관) DATE(observed_at) 기준 최신 vs 직전 스냅샷을 SKU별 비교.
  //   최저입찰가↓ · 예상수익↑ · 판매량↑ · 경쟁↓ · 입찰가능 전환을 "개선"으로 집계.
  catalogChanges: protectedProcedure
    .input(
      z.object({
        search: z.string().max(100).optional(),
        limit: z.number().int().min(1).max(200).default(60),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const q = (input.search ?? "").trim();
      const rows = await db
        .select({
          normKey: poizonSaleObservations.normKey,
          spuId: poizonSaleObservations.spuId,
          skuId: poizonSaleObservations.skuId,
          size: poizonSaleObservations.size,
          brand: poizonSaleObservations.brand,
          productName: poizonSaleObservations.productName,
          priceCny: poizonSaleObservations.priceCny,
          soldCount30d: poizonSaleObservations.soldCount30d,
          expectedProfitUsd: poizonSaleObservations.expectedProfitUsd,
          lowestBidUsd: poizonSaleObservations.lowestBidUsd,
          bidAvailable: poizonSaleObservations.bidAvailable,
          bidStatus: poizonSaleObservations.bidStatus,
          localSellerCount: poizonSaleObservations.localSellerCount,
          observedAt: poizonSaleObservations.observedAt,
        })
        .from(poizonSaleObservations)
        .where(searchWhere(q))
        .orderBy(desc(poizonSaleObservations.observedAt))
        .limit(60000);

      const dateOf = (v: unknown) => String(v ?? "").slice(0, 10);
      const allDates = new Set<string>();
      // SKU별 날짜별 최신 레코드(내림차순이라 각 날짜 첫 등장 유지)
      const bySku = new Map<string, { date: string; r: (typeof rows)[number] }[]>();
      for (const r of rows) {
        const d = dateOf(r.observedAt);
        allDates.add(d);
        const key = r.skuId || `${r.spuId || r.normKey}|${r.size || ""}`;
        const arr = bySku.get(key) ?? [];
        if (!arr.some(x => x.date === d)) arr.push({ date: d, r });
        bySku.set(key, arr);
      }
      const snapshotDates = [...allDates].sort().reverse();
      if (snapshotDates.length < 2) {
        return { changes: [], snapshots: snapshotDates.length, hasPrev: false, curDate: snapshotDates[0] ?? null, prevDate: null };
      }

      type Ch = {
        productName: string; brand: string | null; size: string | null;
        good: number; bidDelta: number; profitDelta: number; soldDelta: number;
        localDelta: number; curBid: number | null; curProfit: number | null;
        curSold: number; newlyBidable: boolean;
      };
      const changes: Ch[] = [];
      for (const arr of bySku.values()) {
        if (arr.length < 2) continue;
        const cur = arr[0].r;
        const prev = arr[1].r;
        const bidDelta = (cur.lowestBidUsd ?? 0) - (prev.lowestBidUsd ?? 0);
        const profitDelta = (cur.expectedProfitUsd ?? 0) - (prev.expectedProfitUsd ?? 0);
        const soldDelta = (cur.soldCount30d ?? 0) - (prev.soldCount30d ?? 0);
        const priceDelta = (cur.priceCny ?? 0) - (prev.priceCny ?? 0);
        const localDelta = (cur.localSellerCount ?? 0) - (prev.localSellerCount ?? 0);
        const newlyBidable = cur.bidAvailable === true && prev.bidAvailable !== true;
        if (!bidDelta && !profitDelta && !soldDelta && !priceDelta && !localDelta && !newlyBidable)
          continue;
        let good = 0;
        if (bidDelta < 0) good++; // 최저 입찰가 하락 → 진입 유리
        if (profitDelta > 0) good++;
        if (soldDelta > 0) good++;
        if (localDelta < 0) good++; // 경쟁 감소
        if (newlyBidable) good++;
        changes.push({
          productName: cur.productName, brand: cur.brand, size: cur.size,
          good, bidDelta, profitDelta, soldDelta, localDelta,
          curBid: cur.lowestBidUsd ?? null, curProfit: cur.expectedProfitUsd ?? null,
          curSold: cur.soldCount30d ?? 0, newlyBidable,
        });
      }
      changes.sort(
        (a, b) => b.good - a.good || Math.abs(b.profitDelta) - Math.abs(a.profitDelta)
      );
      return {
        changes: changes.slice(0, input.limit),
        snapshots: snapshotDates.length,
        hasPrev: true,
        curDate: snapshotDates[0],
        prevDate: snapshotDates[1],
      };
    }),

  // ===== 실시간 환율 (USD→KRW) =====
  //   판매자 엑셀 KRW→USD 정규화·$ 표시·엔진 기본 환율에 공용. 6h 캐시 + 폴백.
  fxRate: protectedProcedure.query(async () => {
    const fx = await getKrwUsdRate();
    return { rate: fx.rate, source: fx.source, at: fx.at };
  }),

  // ===== Open API 자동 동기화 상태 (Phase 2) =====
  // 판매자 엑셀 수동 업로드를 대체할 자동 동기화 준비 상태. 자격증명이 세팅되면 활성.
  openApiStatus: protectedProcedure.query(async () => {
    const r = poizonReadiness();
    const stored = await poizonStoredInfo().catch(() => null);
    // 실사용 가능 = appKey/secret 있고 + (env 토큰 || DB 저장 토큰)
    const hasToken = r.accessToken || !!stored?.hasToken;
    const ready = r.appKey && r.appSecret && hasToken;
    return {
      configured: poizonApiConfigured(),
      readiness: { ...r, hasStoredToken: !!stored?.hasToken, ready },
      storedToken: stored, // { hasToken, openId, accessExpiresAt, accessExpired, ... }
      note: ready
        ? "POIZON Open API 가동 준비 완료 — 서명 검증 통과, 토큰 확보. 자가진단으로 각 인터페이스 확인 가능."
        : r.appKey && r.appSecret
          ? "App Key/Secret 확인됨. Access Token 필요 — /api/poizon/authorize 로 Seller Authorization 진행."
          : "Default 패키지 심사 대기(已申请). 승인 후 Seller Authorization으로 원클릭 토큰 발급 → 즉시 가동.",
    };
  }),

  // ===== POIZON API 자가진단 =====
  // 승인·토큰 후 실행 → 각 인터페이스 연결·서명·권한 검증(测试未通过→통과 구동).
  //   자격증명 없으면 모두 skipped로 안전 반환(외부 호출 없음).
  poizonSelfTest: protectedProcedure
    .input(z.object({ sampleArticleNumber: z.string().max(64).optional() }).optional())
    .mutation(async ({ input }) => {
      return poizonSelfTest(input?.sampleArticleNumber || undefined);
    }),

  // ===== AI 추천 이유 (on-demand) =====
  // 상품 지표를 근거로 "왜 사야/사지 말아야 하는지 + 몇 개" 한 줄 판단을 생성.
  //   숫자는 클라이언트가 계산한 발굴 지표를 그대로 전달(환각 방지: 주어진 값만 사용).
  aiReason: protectedProcedure
    .input(
      z.object({
        productName: z.string().max(300),
        brand: z.string().max(100).optional(),
        category: z.string().max(40).optional(),
        soldCount: z.number(),
        avgUsd: z.number(),
        profitUsd: z.number().nullable().optional(),
        marginPct: z.number().nullable().optional(),
        localSeller: z.number().optional(),
        grade: z.string().max(3).optional(),
        riskScore: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const comp =
        input.localSeller == null
          ? "미상"
          : input.localSeller === 0
            ? "현지 경쟁자 없음"
            : `현지 판매자 ${input.localSeller}`;
      const facts = [
        `상품: ${input.brand ? input.brand + " " : ""}${input.productName}`,
        input.category ? `카테고리: ${input.category}` : "",
        `30일 판매량: ${input.soldCount.toLocaleString()}`,
        `POIZON 시세: $${Math.round(input.avgUsd)}`,
        input.profitUsd != null ? `예상 정산: $${Math.round(input.profitUsd)}` : "",
        input.marginPct != null ? `국내 매입 기준 마진: ${input.marginPct.toFixed(0)}%` : "국내 매입가 미확보",
        `경쟁: ${comp}`,
        input.grade ? `종합 등급: ${input.grade}` : "",
        input.riskScore != null ? `위험 점수(높을수록 위험): ${input.riskScore}` : "",
      ].filter(Boolean).join("\n");

      const prompt = `당신은 POIZON 역직구(국내 매입 → POIZON 판매) 소싱 코치입니다.
아래 상품 지표만 근거로, 판매자가 지금 이 상품을 매입할지 판단해 주세요.
주어진 숫자 밖의 사실을 지어내지 마세요. 한국어로 간결하게.

지표:
${facts}

다음 JSON만 출력:
{
  "verdict": "추천" | "주의" | "관망",
  "headline": "한 줄 결론(20자 내외)",
  "bullets": ["근거 2~3개, 각 20자 내외(숫자 포함)"],
  "qtyHint": "매입 수량 힌트(예: '소량 5~10개부터' 또는 '' )"
}`;

      const fallback = () => {
        const good = input.soldCount >= 100 && (input.marginPct == null || input.marginPct >= 25);
        const bad = input.soldCount < 10 || (input.marginPct != null && input.marginPct < 10);
        const verdict = bad ? "주의" : good ? "추천" : "관망";
        const bullets = [
          `30일 판매 ${input.soldCount.toLocaleString()}`,
          input.marginPct != null ? `마진 ${input.marginPct.toFixed(0)}%` : `시세 $${Math.round(input.avgUsd)}`,
          input.localSeller === 0 ? "현지 경쟁 없음" : comp,
        ];
        return {
          verdict,
          headline: verdict === "추천" ? "수요·마진 양호" : verdict === "주의" ? "수요/마진 부족" : "지표 애매",
          bullets,
          qtyHint: verdict === "추천" ? "소량부터 시작" : "",
          source: "rule" as const,
        };
      };

      try {
        const res = await invokeLLM({
          messages: [
            { role: "system", content: "역직구 소싱 코치. 반드시 유효한 JSON만 응답." },
            { role: "user", content: prompt },
          ],
        });
        const raw = res.choices?.[0]?.message?.content;
        const text = (typeof raw === "string" ? raw : "").replace(/```json\n?|```/g, "").trim();
        const p = JSON.parse(text);
        return {
          verdict: String(p.verdict ?? "관망").slice(0, 4),
          headline: String(p.headline ?? "").slice(0, 60),
          bullets: Array.isArray(p.bullets) ? p.bullets.slice(0, 4).map((b: any) => String(b).slice(0, 60)) : [],
          qtyHint: String(p.qtyHint ?? "").slice(0, 60),
          source: "ai" as const,
        };
      } catch {
        return fallback();
      }
    }),

  // ===== 브랜드 대시보드 (ERP 진입점) =====
  // 카탈로그를 브랜드 단위로 롤업: 총상품(SPU)·총판매량·대표 시세·평균 정산·추천/주의 수.
  //   상품 발굴이 '모델' 단위라면, 여기는 그 위 '브랜드' 단위 관제탑.
  brandDashboard: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(80) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const limit = input?.limit ?? 80;

      const obsAll = await db
        .select({
          normKey: poizonSaleObservations.normKey,
          spuId: poizonSaleObservations.spuId,
          skuId: poizonSaleObservations.skuId,
          size: poizonSaleObservations.size,
          brand: poizonSaleObservations.brand,
          productName: poizonSaleObservations.productName,
          priceCny: poizonSaleObservations.priceCny,
          soldCount30d: poizonSaleObservations.soldCount30d,
          expectedProfitUsd: poizonSaleObservations.expectedProfitUsd,
          bidAvailable: poizonSaleObservations.bidAvailable,
          localSellerCount: poizonSaleObservations.localSellerCount,
        })
        .from(poizonSaleObservations)
        .orderBy(desc(poizonSaleObservations.observedAt))
        .limit(60000);

      // SKU 최신 스냅샷만
      const seen = new Set<string>();
      type O = (typeof obsAll)[number];
      const obs: O[] = [];
      for (const o of obsAll) {
        const k = o.skuId || `${o.spuId || o.normKey}|${o.size || ""}`;
        if (seen.has(k)) continue;
        seen.add(k);
        obs.push(o);
      }

      const median = (arr: number[]) => {
        if (!arr.length) return 0;
        const s = arr.slice().sort((a, b) => a - b);
        return s[Math.floor(s.length / 2)];
      };

      // SPU(상품) 묶음
      type G = {
        brand: string; prices: number[]; soldMax: number;
        localMax: number; profits: number[]; bidAvail: number;
      };
      const groups = new Map<string, G>();
      for (const o of obs) {
        const gk = o.spuId || o.normKey;
        const brand = (o.brand || detectBrand(o.productName) || "기타").trim() || "기타";
        const g =
          groups.get(gk) ??
          ({ brand, prices: [], soldMax: 0, localMax: 0, profits: [], bidAvail: 0 } as G);
        if (o.priceCny > 0) g.prices.push(o.priceCny);
        if (o.expectedProfitUsd != null) g.profits.push(o.expectedProfitUsd);
        g.soldMax = Math.max(g.soldMax, o.soldCount30d ?? 0);
        g.localMax = Math.max(g.localMax, o.localSellerCount ?? 0);
        if (o.bidAvailable === true) g.bidAvail++;
        groups.set(gk, g);
      }

      // 브랜드 집계 (추천/주의 판단은 상품 발굴과 동일 기준)
      type B = {
        brand: string; spuCount: number; totalSold: number;
        prices: number[]; profits: number[]; recCount: number; riskCount: number;
      };
      const brands = new Map<string, B>();
      for (const g of groups.values()) {
        const repPrice = median(g.prices);
        const repProfit = g.profits.length ? median(g.profits) : null;
        const lowComp = g.localMax === 0 || (g.soldMax > 0 && g.localMax <= g.soldMax * 0.3);
        const bidRec = (repProfit ?? 0) >= 20 && g.soldMax >= 10 && lowComp && g.bidAvail > 0;
        const riskFlag = g.soldMax < 5 && repPrice > 0;
        const b =
          brands.get(g.brand) ??
          ({ brand: g.brand, spuCount: 0, totalSold: 0, prices: [], profits: [], recCount: 0, riskCount: 0 } as B);
        b.spuCount++;
        b.totalSold += g.soldMax;
        if (repPrice > 0) b.prices.push(repPrice);
        if (repProfit != null) b.profits.push(repProfit);
        if (bidRec) b.recCount++;
        if (riskFlag) b.riskCount++;
        brands.set(g.brand, b);
      }

      const list = [...brands.values()]
        .map(b => ({
          brand: b.brand,
          spuCount: b.spuCount,
          totalSold: b.totalSold,
          medianUsd: median(b.prices),
          avgProfitUsd: b.profits.length
            ? Math.round(b.profits.reduce((a, x) => a + x, 0) / b.profits.length)
            : null,
          recCount: b.recCount,
          riskCount: b.riskCount,
        }))
        .sort((a, b) => b.totalSold - a.totalSold)
        .slice(0, limit);

      const totals = {
        brands: brands.size,
        spuCount: groups.size,
        totalSold: [...groups.values()].reduce((a, g) => a + g.soldMax, 0),
        recCount: list.reduce((a, b) => a + b.recCount, 0),
      };
      return { brands: list, totals };
    }),
});
