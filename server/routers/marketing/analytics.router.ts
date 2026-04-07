import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import { mktAnalytics, mktChannelPosts, mktContentItems, mktAiFeedback } from "../../../drizzle/schema";
import { eq, and, desc, sql, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

export const analyticsRouter = router({
  // 게시물별 성과 조회
  getPostAnalytics: protectedProcedure
    .input(z.object({ channelPostId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return db.select().from(mktAnalytics)
        .where(eq(mktAnalytics.channelPostId, input.channelPostId))
        .orderBy(desc(mktAnalytics.capturedAt));
    }),

  // 대시보드 요약 (전체 성과)
  getSummary: protectedProcedure
    .input(z.object({ days: z.number().default(7) }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const days = input?.days || 7;
      const since = new Date(Date.now() - days * 86400000)
        .toISOString().replace("T", " ").slice(0, 19);

      // 총 발행 수
      const [publishedCount] = await db.select({
        count: sql<number>`count(*)`,
      }).from(mktChannelPosts)
        .where(and(
          eq(mktChannelPosts.userId, ctx.user.id),
          eq(mktChannelPosts.publishStatus, "published"),
          gte(mktChannelPosts.publishedAt, since),
        ));

      // 대기 중
      const [queuedCount] = await db.select({
        count: sql<number>`count(*)`,
      }).from(mktChannelPosts)
        .where(and(
          eq(mktChannelPosts.userId, ctx.user.id),
          eq(mktChannelPosts.publishStatus, "queued"),
        ));

      // 실패
      const [failedCount] = await db.select({
        count: sql<number>`count(*)`,
      }).from(mktChannelPosts)
        .where(and(
          eq(mktChannelPosts.userId, ctx.user.id),
          eq(mktChannelPosts.publishStatus, "failed"),
        ));

      // 콘텐츠 수
      const [contentCount] = await db.select({
        count: sql<number>`count(*)`,
      }).from(mktContentItems)
        .where(eq(mktContentItems.userId, ctx.user.id));

      // 총 성과 (최근 analytics)
      const totalStats = await db.select({
        totalViews: sql<number>`COALESCE(SUM(${mktAnalytics.views}), 0)`,
        totalLikes: sql<number>`COALESCE(SUM(${mktAnalytics.likes}), 0)`,
        totalComments: sql<number>`COALESCE(SUM(${mktAnalytics.comments}), 0)`,
        totalShares: sql<number>`COALESCE(SUM(${mktAnalytics.shares}), 0)`,
        totalClicks: sql<number>`COALESCE(SUM(${mktAnalytics.clicks}), 0)`,
        totalConversions: sql<number>`COALESCE(SUM(${mktAnalytics.conversions}), 0)`,
      }).from(mktAnalytics)
        .where(gte(mktAnalytics.capturedAt, since));

      return {
        period: days,
        published: Number(publishedCount?.count || 0),
        queued: Number(queuedCount?.count || 0),
        failed: Number(failedCount?.count || 0),
        totalContent: Number(contentCount?.count || 0),
        stats: totalStats[0] || {
          totalViews: 0, totalLikes: 0, totalComments: 0,
          totalShares: 0, totalClicks: 0, totalConversions: 0,
        },
      };
    }),

  // 플랫폼별 성과
  getByPlatform: protectedProcedure
    .input(z.object({ days: z.number().default(30) }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const days = input?.days || 30;
      const since = new Date(Date.now() - days * 86400000)
        .toISOString().replace("T", " ").slice(0, 19);

      return db.select({
        platform: mktAnalytics.platform,
        totalViews: sql<number>`SUM(${mktAnalytics.views})`,
        totalLikes: sql<number>`SUM(${mktAnalytics.likes})`,
        totalClicks: sql<number>`SUM(${mktAnalytics.clicks})`,
        totalConversions: sql<number>`SUM(${mktAnalytics.conversions})`,
        postCount: sql<number>`COUNT(DISTINCT ${mktAnalytics.channelPostId})`,
      }).from(mktAnalytics)
        .where(gte(mktAnalytics.capturedAt, since))
        .groupBy(mktAnalytics.platform);
    }),

  // 성과 기록 저장 (수동 입력 or 수집기에서 호출)
  recordSnapshot: protectedProcedure
    .input(z.object({
      channelPostId: z.number(),
      platform: z.enum(["instagram", "youtube", "tiktok", "naver_blog", "naver_cafe", "kakao"]),
      views: z.number().default(0),
      likes: z.number().default(0),
      comments: z.number().default(0),
      shares: z.number().default(0),
      clicks: z.number().default(0),
      conversions: z.number().default(0),
      reach: z.number().optional(),
      impressions: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const ctr = input.impressions && input.impressions > 0
        ? ((input.clicks / input.impressions) * 100).toFixed(2)
        : null;
      await db.insert(mktAnalytics).values({
        channelPostId: input.channelPostId,
        platform: input.platform,
        views: input.views,
        likes: input.likes,
        comments: input.comments,
        shares: input.shares,
        clicks: input.clicks,
        conversions: input.conversions,
        reach: input.reach || 0,
        impressions: input.impressions || 0,
        ctr: ctr,
      });
      return { success: true };
    }),

  // AI 피드백 목록
  listFeedback: protectedProcedure
    .input(z.object({ contentItemId: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const conditions = [eq(mktAiFeedback.userId, ctx.user.id)];
      if (input?.contentItemId) conditions.push(eq(mktAiFeedback.contentItemId, input.contentItemId));
      return db.select().from(mktAiFeedback)
        .where(and(...conditions))
        .orderBy(desc(mktAiFeedback.createdAt))
        .limit(50);
    }),
});
