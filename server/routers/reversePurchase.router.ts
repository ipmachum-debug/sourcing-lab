import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { reversePurchases, reverseSkuWatch, poizonPricePool } from "../../drizzle/schema";
import { and, eq, desc, like, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

const CONDITION = ["new", "a_grade", "b_grade"] as const;
const INSPECT = ["pending", "pass", "fail"] as const;
const STATUS = ["purchased", "inspecting", "listed", "sold", "settled", "returned"] as const;

// POIZON 시세 풀 매칭키 (브랜드+상품 정규화)
function poizonNormKey(brand: string | undefined, name: string): string {
  return `${brand ?? ""} ${name}`.toLowerCase().replace(/\s+/g, "").slice(0, 250);
}
// 공유 풀 upsert (패시브 관측 반영)
async function upsertPoizon(
  db: any,
  d: { brand?: string; productName: string; priceCny: number; poizonSpuId?: string; imageUrl?: string; source?: string }
) {
  const normKey = poizonNormKey(d.brand, d.productName);
  await db
    .insert(poizonPricePool)
    .values({
      normKey,
      brand: d.brand ?? null,
      productName: d.productName,
      priceCny: d.priceCny,
      poizonSpuId: d.poizonSpuId ?? null,
      imageUrl: d.imageUrl ?? null,
      source: d.source ?? "manual",
      observeCount: 1,
      contributorCount: 1,
    })
    .onDuplicateKeyUpdate({
      set: {
        priceCny: d.priceCny,
        brand: d.brand ?? null,
        productName: d.productName,
        observeCount: sql`${poizonPricePool.observeCount} + 1`,
        lastObservedAt: sql`NOW()`,
        source: d.source ?? "manual",
      },
    });
}

export const reversePurchaseRouter = router({
  // 목록 (상태 필터 + 검색)
  list: protectedProcedure
    .input(
      z.object({
        status: z.enum(["all", ...STATUS]).default("all"),
        search: z.string().max(200).default(""),
        limit: z.number().int().min(1).max(300).default(200),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const conds: any[] = [eq(reversePurchases.userId, ctx.user!.id)];
      if (input.status !== "all") conds.push(eq(reversePurchases.status, input.status));
      if (input.search) conds.push(like(reversePurchases.productName, `%${input.search}%`));
      return db
        .select()
        .from(reversePurchases)
        .where(and(...conds))
        .orderBy(desc(reversePurchases.createdAt))
        .limit(input.limit);
    }),

  // 요약 통계 — 해자 데이터(검수 탈락률·회전일) 포함
  stats: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const uid = ctx.user!.id;
    const [agg] = await db
      .select({
        total: sql<number>`count(*)`,
        buyAmount: sql<number>`coalesce(sum(${reversePurchases.buyPrice} * ${reversePurchases.qty}), 0)`,
        soldCount: sql<number>`sum(case when ${reversePurchases.status} in ('sold','settled') then 1 else 0 end)`,
        netProfit: sql<number>`coalesce(sum(case when ${reversePurchases.status} in ('sold','settled') then (${reversePurchases.soldPrice} - ${reversePurchases.buyPrice}) else 0 end), 0)`,
        passCnt: sql<number>`sum(case when ${reversePurchases.inspectStatus} = 'pass' then 1 else 0 end)`,
        failCnt: sql<number>`sum(case when ${reversePurchases.inspectStatus} = 'fail' then 1 else 0 end)`,
        avgTurnDays: sql<number>`avg(case when ${reversePurchases.status} in ('sold','settled') and ${reversePurchases.sellDate} is not null and ${reversePurchases.buyDate} is not null then datediff(${reversePurchases.sellDate}, ${reversePurchases.buyDate}) else null end)`,
      })
      .from(reversePurchases)
      .where(eq(reversePurchases.userId, uid));

    const pass = Number(agg?.passCnt ?? 0);
    const fail = Number(agg?.failCnt ?? 0);
    const inspected = pass + fail;

    // 판매처별 정산·순익 (판매완료/정산완료 로트만) — POIZON/쇼피/당근 채널 비교.
    const chRows = await db
      .select({
        channel: reversePurchases.sellChannel,
        soldCount: sql<number>`count(*)`,
        revenue: sql<number>`coalesce(sum(${reversePurchases.soldPrice}), 0)`,
        cost: sql<number>`coalesce(sum(${reversePurchases.buyPrice}), 0)`,
        net: sql<number>`coalesce(sum(${reversePurchases.soldPrice} - ${reversePurchases.buyPrice}), 0)`,
        avgTurnDays: sql<number>`avg(case when ${reversePurchases.sellDate} is not null and ${reversePurchases.buyDate} is not null then datediff(${reversePurchases.sellDate}, ${reversePurchases.buyDate}) else null end)`,
      })
      .from(reversePurchases)
      .where(
        and(
          eq(reversePurchases.userId, uid),
          sql`${reversePurchases.status} in ('sold','settled')`
        )
      )
      .groupBy(reversePurchases.sellChannel);

    const byChannel = chRows
      .map((r: any) => {
        const revenue = Number(r.revenue ?? 0);
        const net = Number(r.net ?? 0);
        return {
          channel: r.channel || "unknown", // 미지정 판매처
          soldCount: Number(r.soldCount ?? 0),
          revenue,
          cost: Number(r.cost ?? 0),
          net,
          marginPct: revenue > 0 ? Math.round((net / revenue) * 1000) / 10 : 0,
          avgTurnDays: r.avgTurnDays != null ? Math.round(Number(r.avgTurnDays) * 10) / 10 : null,
        };
      })
      .sort((a, b) => b.net - a.net);

    return {
      total: Number(agg?.total ?? 0),
      buyAmount: Number(agg?.buyAmount ?? 0),
      soldCount: Number(agg?.soldCount ?? 0),
      netProfit: Number(agg?.netProfit ?? 0),
      inspectFailRate: inspected > 0 ? Math.round((fail / inspected) * 1000) / 10 : 0, // %
      inspected,
      avgTurnDays: agg?.avgTurnDays != null ? Math.round(Number(agg.avgTurnDays) * 10) / 10 : null,
      byChannel,
    };
  }),

  create: protectedProcedure
    .input(
      z.object({
        brand: z.string().max(100).optional(),
        productName: z.string().min(1).max(300),
        sku: z.string().max(120).optional(),
        buyChannel: z.string().max(80).optional(),
        buyPrice: z.number().int().min(0).default(0),
        qty: z.number().int().min(1).default(1),
        buyDate: z.string().max(10).optional(),
        condition: z.enum(CONDITION).default("new"),
        sellChannel: z.string().max(16).optional(), // 판매처 (POIZON/쇼피/당근…)
        memo: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.insert(reversePurchases).values({ userId: ctx.user!.id, ...input });
      return { ok: true };
    }),

  // 매입 일괄 등록 (엑셀/CSV 업로드)
  bulkCreate: protectedProcedure
    .input(
      z.object({
        rows: z
          .array(
            z.object({
              brand: z.string().max(100).optional(),
              productName: z.string().min(1).max(300),
              sku: z.string().max(120).optional(),
              buyChannel: z.string().max(80).optional(),
              buyPrice: z.number().int().min(0).default(0),
              qty: z.number().int().min(1).default(1),
              buyDate: z.string().max(10).optional(),
              condition: z.enum(CONDITION).default("new"),
              soldPrice: z.number().int().min(0).default(0),
              sellChannel: z.string().max(16).optional(),
              sellDate: z.string().max(10).optional(),
              status: z.enum(STATUS).default("purchased"),
              memo: z.string().max(500).optional(),
            })
          )
          .min(1)
          .max(1000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const uid = ctx.user!.id;
      await db
        .insert(reversePurchases)
        .values(input.rows.map(r => ({ userId: uid, ...r })));
      return { ok: true, count: input.rows.length };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int(),
        brand: z.string().max(100).optional(),
        productName: z.string().max(300).optional(),
        sku: z.string().max(120).optional(),
        buyChannel: z.string().max(80).optional(),
        buyPrice: z.number().int().min(0).optional(),
        qty: z.number().int().min(1).optional(),
        buyDate: z.string().max(10).optional(),
        condition: z.enum(CONDITION).optional(),
        inspectStatus: z.enum(INSPECT).optional(),
        sellChannel: z.string().max(16).optional(),
        listPrice: z.number().int().min(0).optional(),
        soldPrice: z.number().int().min(0).optional(),
        sellDate: z.string().max(10).optional(),
        status: z.enum(STATUS).optional(),
        memo: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...set } = input;
      await db
        .update(reversePurchases)
        .set(set)
        .where(and(eq(reversePurchases.id, id), eq(reversePurchases.userId, ctx.user!.id)));
      return { ok: true };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db
        .delete(reversePurchases)
        .where(and(eq(reversePurchases.id, input.id), eq(reversePurchases.userId, ctx.user!.id)));
      return { ok: true };
    }),

  // ===== SKU 워치풀 (오늘의 SKU TOP100) =====
  skuList: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db
      .select()
      .from(reverseSkuWatch)
      .where(eq(reverseSkuWatch.userId, ctx.user!.id))
      .orderBy(desc(reverseSkuWatch.createdAt))
      .limit(200);
  }),

  skuCreate: protectedProcedure
    .input(
      z.object({
        brand: z.string().max(100).optional(),
        productName: z.string().min(1).max(300),
        sku: z.string().max(120).optional(),
        category: z.string().max(80).optional(),
        domesticPrice: z.number().int().min(0).default(0),
        poizonCny: z.number().int().min(0).default(0),
        rate: z.number().int().min(1).max(3000).default(1350),
        feePct: z.number().int().min(0).max(30).default(6),
        note: z.string().max(300).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.insert(reverseSkuWatch).values({ userId: ctx.user!.id, ...input });
      // 수동 입력한 POIZON 시세도 공유 풀에 반영 → 다른 유저도 활용
      if (input.poizonCny && input.poizonCny > 0) {
        await upsertPoizon(db, {
          brand: input.brand,
          productName: input.productName,
          priceCny: input.poizonCny,
          source: "manual",
        }).catch(() => {});
      }
      return { ok: true };
    }),

  skuRemove: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db
        .delete(reverseSkuWatch)
        .where(and(eq(reverseSkuWatch.id, input.id), eq(reverseSkuWatch.userId, ctx.user!.id)));
      return { ok: true };
    }),

  // SKU 일괄 등록 (엑셀/CSV 업로드)
  skuBulkCreate: protectedProcedure
    .input(
      z.object({
        rows: z
          .array(
            z.object({
              brand: z.string().max(100).optional(),
              productName: z.string().min(1).max(300),
              sku: z.string().max(120).optional(),
              category: z.string().max(80).optional(),
              domesticPrice: z.number().int().min(0).default(0),
              poizonCny: z.number().int().min(0).default(0),
              rate: z.number().int().min(1).max(3000).default(1350),
              feePct: z.number().int().min(0).max(30).default(6),
              note: z.string().max(300).optional(),
            })
          )
          .min(1)
          .max(1000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const uid = ctx.user!.id;
      await db
        .insert(reverseSkuWatch)
        .values(input.rows.map(r => ({ userId: uid, ...r })));
      // POIZON 시세는 공유 풀에도 반영
      for (const r of input.rows) {
        if (r.poizonCny && r.poizonCny > 0) {
          await upsertPoizon(db, {
            brand: r.brand,
            productName: r.productName,
            priceCny: r.poizonCny,
            source: "manual",
          }).catch(() => {});
        }
      }
      return { ok: true, count: input.rows.length };
    }),

  // ===== 공유 POIZON 시세 풀 (패시브 수집) =====
  // 확장/유저가 본 시세 제출 → 전역 공유. 확장은 이 프로시저만 부르면 됨.
  poizonSubmit: protectedProcedure
    .input(
      z.object({
        brand: z.string().max(100).optional(),
        productName: z.string().min(1).max(300),
        priceCny: z.number().int().min(0),
        poizonSpuId: z.string().max(60).optional(),
        imageUrl: z.string().max(1000).optional(),
        source: z.enum(["manual", "extension"]).default("extension"),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await upsertPoizon(db, input);
      return { ok: true };
    }),

  // 공유 풀 조회 (오늘의 SKU 자동 채움용) — 전역
  poizonLookup: protectedProcedure
    .input(z.object({ query: z.string().min(1).max(200) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return db
        .select()
        .from(poizonPricePool)
        .where(like(poizonPricePool.productName, `%${input.query}%`))
        .orderBy(desc(poizonPricePool.lastObservedAt))
        .limit(8);
    }),
});
