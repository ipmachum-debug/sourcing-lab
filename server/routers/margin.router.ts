import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { marginCalcHistory } from "../../drizzle/schema";
import { and, desc, eq, like, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

export const marginRouter = router({
  /** 마진 계산 결과 저장 */
  save: protectedProcedure
    .input(
      z.object({
        itemName: z.string().max(200).default(""),
        sellingPrice: z.number().int(),
        costPrice: z.number().int(),
        feeRate: z.string(),
        fulfillmentFee: z.number().int(),
        shippingFee: z.number().int(),
        expectedSales: z.number().int().default(100),
        returnRate: z.string().default("0"),
        returnCollectionFee: z.number().int().default(0),
        // 계산 결과
        fulfillmentVat: z.number().int(),
        salesCommission: z.number().int(),
        salesCommissionVat: z.number().int(),
        vat: z.number().int(),
        margin: z.number().int(),
        marginRate: z.string(),
        minAdRoi: z.string().default("0"),
        totalMargin: z.number().int().default(0),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.insert(marginCalcHistory).values({
        userId: ctx.user.id,
        ...input,
      });

      return { success: true };
    }),

  /** 이력 목록 (페이지네이션 + 검색) */
  list: protectedProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        perPage: z.number().int().min(1).max(50).default(15),
        search: z.string().max(200).default(""),
      })
    )
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const where = input.search
        ? and(
            eq(marginCalcHistory.userId, ctx.user.id),
            like(marginCalcHistory.itemName, `%${input.search}%`)
          )
        : eq(marginCalcHistory.userId, ctx.user.id);

      const [countResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(marginCalcHistory)
        .where(where);

      const total = Number(countResult?.count ?? 0);
      const offset = (input.page - 1) * input.perPage;

      const items = await db
        .select()
        .from(marginCalcHistory)
        .where(where)
        .orderBy(desc(marginCalcHistory.createdAt))
        .limit(input.perPage)
        .offset(offset);

      return {
        items,
        total,
        page: input.page,
        totalPages: Math.ceil(total / input.perPage),
      };
    }),

  /** 이력 삭제 */
  delete: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db
        .delete(marginCalcHistory)
        .where(
          and(
            eq(marginCalcHistory.id, input.id),
            eq(marginCalcHistory.userId, ctx.user.id)
          )
        );

      return { success: true };
    }),
});
