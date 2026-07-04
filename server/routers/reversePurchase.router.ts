import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { reversePurchases } from "../../drizzle/schema";
import { and, eq, desc, like, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

const CONDITION = ["new", "a_grade", "b_grade"] as const;
const INSPECT = ["pending", "pass", "fail"] as const;
const SELL_CHANNEL = ["poizon", "danggeun", "amazon", "other"] as const;
const STATUS = ["purchased", "inspecting", "listed", "sold", "settled", "returned"] as const;

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
    return {
      total: Number(agg?.total ?? 0),
      buyAmount: Number(agg?.buyAmount ?? 0),
      soldCount: Number(agg?.soldCount ?? 0),
      netProfit: Number(agg?.netProfit ?? 0),
      inspectFailRate: inspected > 0 ? Math.round((fail / inspected) * 1000) / 10 : 0, // %
      inspected,
      avgTurnDays: agg?.avgTurnDays != null ? Math.round(Number(agg.avgTurnDays) * 10) / 10 : null,
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
        memo: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.insert(reversePurchases).values({ userId: ctx.user!.id, ...input });
      return { ok: true };
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
        sellChannel: z.enum(SELL_CHANNEL).optional(),
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
});
