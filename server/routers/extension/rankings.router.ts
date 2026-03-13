/**
 * Extension Sub-Router: 순위 추적 (Rank Tracking)
 */
import { z } from "zod";
import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import { extRankTrackings, extTrackedKeywords } from "../../../drizzle/schema";
import { eq, and, desc, sql, asc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const rankingsRouter = router({
  addTrackedKeyword: protectedProcedure
    .input(z.object({
      query: z.string().min(1).max(255),
      targetProductId: z.string().max(50).optional(),
      targetProductName: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 중복 체크
      const [existing] = await db.select({ id: extTrackedKeywords.id })
        .from(extTrackedKeywords)
        .where(and(eq(extTrackedKeywords.userId, ctx.user!.id), eq(extTrackedKeywords.query, input.query)))
        .limit(1);
      if (existing) return { success: true, id: existing.id, message: "이미 추적 중인 키워드입니다." };

      const result = await db.insert(extTrackedKeywords).values({
        userId: ctx.user!.id,
        query: input.query,
        targetProductId: input.targetProductId || null,
        targetProductName: input.targetProductName || null,
      });
      return { success: true, id: (result as any)?.[0]?.insertId };
    }),

  // 추적 키워드 목록
  listTrackedKeywords: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db.select()
      .from(extTrackedKeywords)
      .where(and(eq(extTrackedKeywords.userId, ctx.user!.id), eq(extTrackedKeywords.isActive, true)))
      .orderBy(desc(extTrackedKeywords.createdAt));
  }),

  // 추적 키워드 삭제 (비활성화)
  removeTrackedKeyword: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(extTrackedKeywords)
        .set({ isActive: false })
        .where(and(eq(extTrackedKeywords.id, input.id), eq(extTrackedKeywords.userId, ctx.user!.id)));
      return { success: true };
    }),

  // 순위 데이터 저장 (확장프로그램에서 배치 호출)
  saveRankData: protectedProcedure
    .input(z.object({
      query: z.string().min(1).max(255),
      items: z.array(z.object({
        coupangProductId: z.string(),
        title: z.string().optional(),
        position: z.number().int(),
        price: z.number().int().default(0),
        rating: z.number().default(0),
        reviewCount: z.number().int().default(0),
        isAd: z.boolean().default(false),
        isRocket: z.boolean().default(false),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      if (!input.items.length) return { success: true, count: 0 };

      const values = input.items.map(item => ({
        userId: ctx.user!.id,
        query: input.query,
        coupangProductId: item.coupangProductId,
        title: item.title || null,
        position: item.position,
        price: item.price,
        rating: item.rating.toFixed(1),
        reviewCount: item.reviewCount,
        isAd: item.isAd,
        isRocket: item.isRocket,
      }));

      await db.insert(extRankTrackings).values(values);
      return { success: true, count: input.items.length };
    }),

  // 특정 키워드의 순위 변동 히스토리
  getRankHistory: protectedProcedure
    .input(z.object({
      query: z.string(),
      coupangProductId: z.string().optional(),
      days: z.number().int().min(1).max(90).default(7),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const conditions = [
        eq(extRankTrackings.userId, ctx.user!.id),
        eq(extRankTrackings.query, input.query),
        sql`${extRankTrackings.capturedAt} >= DATE_SUB(NOW(), INTERVAL ${input.days} DAY)`,
      ];
      if (input.coupangProductId) {
        conditions.push(eq(extRankTrackings.coupangProductId, input.coupangProductId));
      }

      return db.select()
        .from(extRankTrackings)
        .where(and(...conditions))
        .orderBy(desc(extRankTrackings.capturedAt))
        .limit(500);
    }),

  // 키워드별 최신 순위 요약 (TOP 10 상품)
  getLatestRanking: protectedProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 가장 최근 캡처 시점의 데이터만
      const rows = await db.select()
        .from(extRankTrackings)
        .where(and(
          eq(extRankTrackings.userId, ctx.user!.id),
          eq(extRankTrackings.query, input.query),
          sql`${extRankTrackings.capturedAt} = (
            SELECT MAX(captured_at) FROM ext_rank_trackings
            WHERE user_id = ${ctx.user!.id} AND query = ${input.query}
          )`,
        ))
        .orderBy(extRankTrackings.position)
        .limit(20);

      return rows;
    }),
});
