import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { myProducts, productSnapshots } from "../../drizzle/schema";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { rateLimit } from "../lib/rateLimit";

// ★ 안전장치 — 능동 스캔의 밴 리스크를 코드로 강제.
export const SCAN_CONFIG = {
  maxActiveSkus: 50, // active SKU 상한 (처음 20~50개)
  frequencyPerDay: 1, // 하루 1회
  // 모니터링 대상이 소수라 딜레이를 넉넉히(사람같이) — 밴 리스크 최소화.
  minDelayMs: 20000, // 페이지당 랜덤 딜레이 하한 (20초)
  maxDelayMs: 60000, // 페이지당 랜덤 딜레이 상한 (60초)
  maxErrorsBeforeStop: 1, // 실패 1회 즉시 중단
  stopOnError: true, // 실패 시 즉시 중단
  allowConcurrent: false, // 동시 접속 금지 (한 탭씩 순차)
  captchaAction: "pause_for_human", // CAPTCHA/2FA → 사람이 처리
  storeNumbersOnly: true, // 원본 HTML 저장 금지, 숫자만
  jitter: true, // 매 실행 딜레이 무작위화
} as const;

const PLATFORM = ["coupang", "poizon", "domestic"] as const;
const SOURCE = ["coupang_wing", "poizon", "domestic", "manual"] as const;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function activeCount(db: any, uid: number): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)` })
    .from(myProducts)
    .where(and(eq(myProducts.userId, uid), eq(myProducts.active, true)));
  return Number(r?.n ?? 0);
}

export const myProductsRouter = router({
  // 확장/크론이 지켜야 할 안전 설정 (canonical)
  scanConfig: protectedProcedure.query(() => SCAN_CONFIG),

  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db
      .select()
      .from(myProducts)
      .where(eq(myProducts.userId, ctx.user!.id))
      .orderBy(desc(myProducts.active), desc(myProducts.createdAt))
      .limit(500);
  }),

  create: protectedProcedure
    .input(
      z.object({
        platform: z.enum(PLATFORM).default("coupang"),
        externalId: z.string().max(120).optional(),
        productName: z.string().min(1).max(300),
        brand: z.string().max(100).optional(),
        sku: z.string().max(120).optional(),
        myPriceKrw: z.number().int().min(0).default(0),
        targetStock: z.number().int().min(0).default(0),
        memo: z.string().max(300).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const uid = ctx.user!.id;
      // 안전장치: active 상한 초과 시 비활성으로 등록
      const active = (await activeCount(db, uid)) < SCAN_CONFIG.maxActiveSkus;
      await db.insert(myProducts).values({ userId: uid, ...input, active });
      return { ok: true, active, capped: !active };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int(),
        productName: z.string().max(300).optional(),
        brand: z.string().max(100).optional(),
        sku: z.string().max(120).optional(),
        externalId: z.string().max(120).optional(),
        myPriceKrw: z.number().int().min(0).optional(),
        targetStock: z.number().int().min(0).optional(),
        memo: z.string().max(300).optional(),
        active: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const uid = ctx.user!.id;
      const { id, ...set } = input;
      // 안전장치: 켤 때만 상한 검사
      if (set.active === true) {
        if ((await activeCount(db, uid)) >= SCAN_CONFIG.maxActiveSkus) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `활성 SKU는 최대 ${SCAN_CONFIG.maxActiveSkus}개까지입니다. 다른 상품을 먼저 끄세요.`,
          });
        }
      }
      await db
        .update(myProducts)
        .set(set)
        .where(and(eq(myProducts.id, id), eq(myProducts.userId, uid)));
      return { ok: true };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db
        .delete(myProducts)
        .where(
          and(eq(myProducts.id, input.id), eq(myProducts.userId, ctx.user!.id))
        );
      // 스냅샷도 함께 정리 (고아 데이터 방지)
      await db
        .delete(productSnapshots)
        .where(
          and(
            eq(productSnapshots.myProductId, input.id),
            eq(productSnapshots.userId, ctx.user!.id)
          )
        );
      return { ok: true };
    }),

  // 일괄 등록 (CSV 업로드)
  bulkCreate: protectedProcedure
    .input(
      z.object({
        rows: z
          .array(
            z.object({
              platform: z.enum(PLATFORM).default("coupang"),
              externalId: z.string().max(120).optional(),
              productName: z.string().min(1).max(300),
              brand: z.string().max(100).optional(),
              sku: z.string().max(120).optional(),
              myPriceKrw: z.number().int().min(0).default(0),
              targetStock: z.number().int().min(0).default(0),
            })
          )
          .min(1)
          .max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const uid = ctx.user!.id;
      let slots = Math.max(0, SCAN_CONFIG.maxActiveSkus - (await activeCount(db, uid)));
      const values = input.rows.map(r => {
        const active = slots > 0;
        if (active) slots--;
        return { userId: uid, ...r, active };
      });
      await db.insert(myProducts).values(values);
      return { ok: true, count: values.length };
    }),

  // ===== 스냅샷 (매일 1회 수집) =====
  // 확장/크론/수동/CSV 공통 진입점. (product, date, source) 유니크로 하루 1회 강제.
  snapshotSubmit: protectedProcedure
    .input(
      z.object({
        myProductId: z.number().int(),
        capturedDate: z.string().max(10).optional(),
        source: z.enum(SOURCE).default("manual"),
        revenueKrw: z.number().int().min(0).default(0),
        unitsSold: z.number().int().min(0).default(0),
        stock: z.number().int().min(0).default(0),
        rankPos: z.number().int().min(0).default(0),
        reviewCount: z.number().int().min(0).default(0),
        rating: z.number().min(0).max(5).optional(),
        poizonPriceCny: z.number().int().min(0).default(0),
        poizonSold30d: z.number().int().min(0).default(0),
        competitorLowKrw: z.number().int().min(0).default(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const uid = ctx.user!.id;
      // 레이트 리밋: 유저당 시간당 300건 (하루 1회 × 50 SKU + 재시도 여유).
      const rl = rateLimit(`snap:${uid}`, 300, 60 * 60 * 1000);
      if (!rl.ok)
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `요청이 너무 많습니다. ${rl.retryAfterSec}초 후 다시 시도하세요.`,
        });
      // 소유 검증
      const [own] = await db
        .select({ id: myProducts.id })
        .from(myProducts)
        .where(and(eq(myProducts.id, input.myProductId), eq(myProducts.userId, uid)))
        .limit(1);
      if (!own) throw new TRPCError({ code: "NOT_FOUND" });
      const { rating, capturedDate, ...rest } = input;
      const row = {
        userId: uid,
        ...rest,
        capturedDate: capturedDate || today(),
        rating: rating != null ? String(rating) : null,
      };
      await db
        .insert(productSnapshots)
        .values(row)
        .onDuplicateKeyUpdate({
          set: {
            revenueKrw: row.revenueKrw,
            unitsSold: row.unitsSold,
            stock: row.stock,
            rankPos: row.rankPos,
            reviewCount: row.reviewCount,
            rating: row.rating,
            poizonPriceCny: row.poizonPriceCny,
            poizonSold30d: row.poizonSold30d,
            competitorLowKrw: row.competitorLowKrw,
          },
        });
      return { ok: true };
    }),

  // POIZON API 연동 상태 — 자동 동기화 가능 여부.
  poizonSyncStatus: protectedProcedure.query(async () => {
    const { readiness } = await import("../lib/poizonApi");
    const r = readiness();
    let hasToken = r.accessToken;
    if (!hasToken) {
      try {
        const st = await import("../lib/poizonTokenStore");
        hasToken = (await st.resolveAccessToken()) != null;
      } catch {
        /* db 미연결 */
      }
    }
    // Poizon Sellers 인증: App Key+Secret이면 가동(토큰 불필요)
    return { ready: !!(r.appKey && r.appSecret), hasToken: !!hasToken };
  }),

  // POIZON API로 내 상품 시세 자동 동기화 (승인·인증 후 활성).
  //   sku 칸에 POIZON skuId(숫자)를 넣은 활성 상품 → batchPrice로 US 시세를 스냅샷에 기록.
  syncPoizon: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const uid = ctx.user!.id;

    const { readiness, queryListingRecommendations } = await import("../lib/poizonApi");
    const r = readiness();
    // Poizon Sellers 인증: App Key+Secret이면 동작(access_token 불필요)
    if (!r.appKey || !r.appSecret) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "POIZON API 미연동 — 서버 .env에 POIZON_APP_KEY/POIZON_APP_SECRET가 필요합니다.",
      });
    }

    const prods = await db
      .select()
      .from(myProducts)
      .where(and(eq(myProducts.userId, uid), eq(myProducts.active, true)));
    const withSku = prods.filter(p => p.sku && Number.isFinite(Number(p.sku)) && Number(p.sku) > 0);
    if (withSku.length === 0) {
      return { synced: 0, skipped: prods.length, message: "POIZON skuId를 sku 칸에 넣은 활성 상품이 없습니다." };
    }

    const recs = (await queryListingRecommendations(withSku.map(p => Number(p.sku)))) as any[];
    const byId = new Map<string, any>();
    for (const rec of recs) byId.set(String(rec.skuId ?? rec.globalSkuId), rec);

    let synced = 0;
    for (const p of withSku) {
      const rec = byId.get(String(Number(p.sku)));
      if (!rec) continue;
      // USD 최소단위(센트) → 달러
      const usd =
        rec.usMinPrice != null
          ? Math.round(rec.usMinPrice / 100)
          : rec.globalMinPrice != null
            ? Math.round(rec.globalMinPrice / 100)
            : 0;
      if (usd <= 0) continue;
      await db
        .insert(productSnapshots)
        .values({ userId: uid, myProductId: p.id, capturedDate: today(), source: "poizon", poizonPriceCny: usd })
        .onDuplicateKeyUpdate({ set: { poizonPriceCny: usd } });
      synced++;
    }
    return { synced, skipped: prods.length - withSku.length, message: `${synced}건 POIZON 시세 갱신` };
  }),

  // 상품별 추이 (기본 30일)
  trend: protectedProcedure
    .input(
      z.object({
        myProductId: z.number().int(),
        days: z.number().int().min(2).max(180).default(30),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const since = new Date(Date.now() - input.days * 86400000)
        .toISOString()
        .slice(0, 10);
      return db
        .select()
        .from(productSnapshots)
        .where(
          and(
            eq(productSnapshots.userId, ctx.user!.id),
            eq(productSnapshots.myProductId, input.myProductId),
            gte(productSnapshots.capturedDate, since)
          )
        )
        .orderBy(productSnapshots.capturedDate)
        .limit(400);
    }),

  // 대시보드 — 활성 상품별 최신 스냅샷 + 7일 변화 + 알림
  dashboard: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const uid = ctx.user!.id;
    const prods = await db
      .select()
      .from(myProducts)
      .where(and(eq(myProducts.userId, uid), eq(myProducts.active, true)))
      .limit(SCAN_CONFIG.maxActiveSkus);
    if (prods.length === 0) return { items: [], alerts: [], scanConfig: SCAN_CONFIG };

    const ids = prods.map(p => p.id);
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const snaps = await db
      .select()
      .from(productSnapshots)
      .where(
        and(
          eq(productSnapshots.userId, uid),
          inArray(productSnapshots.myProductId, ids),
          gte(productSnapshots.capturedDate, since)
        )
      )
      .orderBy(desc(productSnapshots.capturedDate))
      .limit(2000);

    // 상품별 스냅샷 정렬 (최신 desc)
    const byProduct = new Map<number, typeof snaps>();
    for (const s of snaps) {
      const arr = byProduct.get(s.myProductId) ?? [];
      arr.push(s);
      byProduct.set(s.myProductId, arr);
    }

    const items = prods.map(p => {
      const arr = byProduct.get(p.id) ?? [];
      const latest = arr[0] ?? null;
      const weekAgo = arr.find(s => {
        const diff =
          (new Date(latest?.capturedDate ?? today()).getTime() -
            new Date(s.capturedDate).getTime()) /
          86400000;
        return diff >= 6;
      });
      const cny = latest?.poizonPriceCny ?? 0;
      const cnyPrev = weekAgo?.poizonPriceCny ?? 0;
      const poizonDeltaPct =
        cnyPrev > 0 ? Math.round(((cny - cnyPrev) / cnyPrev) * 1000) / 10 : 0;
      // 시계열 (오름차순) — sparkline용 최근 30일
      const series = arr
        .slice()
        .reverse()
        .map(s => ({
          d: s.capturedDate,
          revenue: s.revenueKrw ?? 0,
          units: s.unitsSold ?? 0,
          stock: s.stock ?? 0,
          cny: s.poizonPriceCny ?? 0,
          comp: s.competitorLowKrw ?? 0,
        }));
      return {
        product: p,
        latest,
        series,
        poizonDeltaPct,
        stockLow:
          latest != null &&
          (p.targetStock ?? 0) > 0 &&
          (latest.stock ?? 0) <= (p.targetStock ?? 0),
        undercut:
          latest != null &&
          (latest.competitorLowKrw ?? 0) > 0 &&
          (p.myPriceKrw ?? 0) > 0 &&
          (latest.competitorLowKrw ?? 0) < (p.myPriceKrw ?? 0),
      };
    });

    const alerts: { type: string; product: string; detail: string }[] = [];
    for (const it of items) {
      if (it.stockLow)
        alerts.push({
          type: "stock",
          product: it.product.productName,
          detail: `재고 ${it.latest?.stock ?? 0}개 (목표 ${it.product.targetStock})`,
        });
      if (it.undercut)
        alerts.push({
          type: "undercut",
          product: it.product.productName,
          detail: `경쟁사 ${(it.latest?.competitorLowKrw ?? 0).toLocaleString()}원 < 내 ${(it.product.myPriceKrw ?? 0).toLocaleString()}원`,
        });
      if (it.poizonDeltaPct <= -10)
        alerts.push({
          type: "poizon_drop",
          product: it.product.productName,
          detail: `POIZON 시세 7일 ${it.poizonDeltaPct}%`,
        });
    }

    return { items, alerts, scanConfig: SCAN_CONFIG };
  }),
});
