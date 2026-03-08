import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { weeklyReviews, products } from "../../drizzle/schema";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

export const reviewRouter = router({
  /** 주간 리뷰 저장/수정 */
  upsert: protectedProcedure
    .input(z.object({
      weekKey: z.string(),
      startDate: z.string(),
      endDate: z.string(),
      topCategory: z.string().optional(),
      orderedKeywords: z.string().optional(),
      exposedKeywords: z.string().optional(),
      bestConvertedProducts: z.string().optional(),
      dropProducts: z.string().optional(),
      nextWeekCategories: z.string().optional(),
      nextWeekKeywords: z.string().optional(),
      actionItems: z.string().optional(),
      reviewMemo: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 해당 주차 소싱 건수 카운트
      const [countResult] = await db.select({ count: sql<number>`count(*)` })
        .from(products)
        .where(and(
          eq(products.userId, ctx.user.id),
          eq(products.weekKey, input.weekKey),
        ));

      const existing = await db.select().from(weeklyReviews)
        .where(and(
          eq(weeklyReviews.userId, ctx.user.id),
          eq(weeklyReviews.weekKey, input.weekKey),
        ))
        .limit(1);

      const data = {
        ...input,
        userId: ctx.user.id,
        totalSourcedCount: countResult?.count || 0,
      };

      if (existing.length > 0) {
        await db.update(weeklyReviews)
          .set(data)
          .where(eq(weeklyReviews.id, existing[0].id));
      } else {
        await db.insert(weeklyReviews).values(data);
      }

      return { success: true };
    }),

  /** 특정 주차 리뷰 조회 */
  getByWeek: protectedProcedure
    .input(z.object({ weekKey: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [review] = await db.select().from(weeklyReviews)
        .where(and(
          eq(weeklyReviews.userId, ctx.user.id),
          eq(weeklyReviews.weekKey, input.weekKey),
        ))
        .limit(1);

      return review || null;
    }),

  /** 주간 리뷰 목록 */
  list: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      return await db.select().from(weeklyReviews)
        .where(eq(weeklyReviews.userId, ctx.user.id))
        .orderBy(desc(weeklyReviews.weekKey));
    }),

  /** 주간 집계 (자동 통계) */
  getWeekStats: protectedProcedure
    .input(z.object({ weekKey: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 해당 주차 상품 통계
      const weekProducts = await db.select().from(products)
        .where(and(
          eq(products.userId, ctx.user.id),
          eq(products.weekKey, input.weekKey),
        ));

      const totalCount = weekProducts.length;
      const avgScore = totalCount > 0
        ? Math.round(weekProducts.reduce((sum, p) => sum + (p.score || 0), 0) / totalCount)
        : 0;
      const highScoreCount = weekProducts.filter(p => (p.score || 0) >= 80).length;
      const testCandidateCount = weekProducts.filter(p => p.status === "test_candidate").length;

      // 카테고리별 수량
      const categoryMap = new Map<string, number>();
      weekProducts.forEach(p => {
        const cat = p.category || "미분류";
        categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);
      });

      // 키워드 빈도
      const kwMap = new Map<string, number>();
      weekProducts.forEach(p => {
        [p.keyword1, p.keyword2, p.keyword3].filter(Boolean).forEach(kw => {
          kwMap.set(kw!, (kwMap.get(kw!) || 0) + 1);
        });
      });

      const topCategories = Array.from(categoryMap.entries())
        .sort((a, b) => b[1] - a[1]).slice(0, 5);
      const topKeywords = Array.from(kwMap.entries())
        .sort((a, b) => b[1] - a[1]).slice(0, 10);

      return {
        totalCount,
        avgScore,
        highScoreCount,
        testCandidateCount,
        topCategories,
        topKeywords,
      };
    }),
});
