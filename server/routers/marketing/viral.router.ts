import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import {
  mktTrends, mktViralScores, mktViralLog, mktReviews,
  mktCrossPosts, mktAutoResponses, mktBoostRules, mktChannelPosts,
} from "../../../drizzle/schema";
import { eq, and, desc, gte, sql, like } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { detectTrendsForUser } from "../../modules/marketing/trendDetector";
import { scorePostManual } from "../../modules/marketing/viralScorer";
import { analyzeReview, convertReviewToContent } from "../../modules/marketing/reviewCollector";

const platformEnum = z.enum(["instagram", "youtube", "tiktok", "naver_blog", "naver_cafe", "kakao"]);
const platformAllEnum = z.enum(["instagram", "youtube", "tiktok", "naver_blog", "naver_cafe", "kakao", "all"]);

// ======================== 트렌드 ========================
const trendsRouter = router({
  list: protectedProcedure
    .input(z.object({ onlyActionable: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const conditions = [eq(mktTrends.userId, ctx.user.id)];
      if (input?.onlyActionable) conditions.push(eq(mktTrends.isActionable, true));
      return db.select().from(mktTrends)
        .where(and(...conditions))
        .orderBy(desc(mktTrends.trendScore))
        .limit(50);
    }),

  refresh: protectedProcedure.mutation(async ({ ctx }) => {
    await detectTrendsForUser(ctx.user.id);
    return { success: true };
  }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(mktTrends)
        .where(and(eq(mktTrends.id, input.id), eq(mktTrends.userId, ctx.user.id)));
      return { success: true };
    }),
});

// ======================== 바이럴 모니터 ========================
const viralMonitorRouter = router({
  // 바이럴 스코어 순으로 게시물 조회
  topPosts: protectedProcedure
    .input(z.object({ days: z.number().default(7) }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const since = new Date(Date.now() - (input?.days || 7) * 86400000)
        .toISOString().replace("T", " ").slice(0, 19);
      return db.select().from(mktViralScores)
        .where(and(
          eq(mktViralScores.userId, ctx.user.id),
          gte(mktViralScores.measuredAt, since),
        ))
        .orderBy(desc(mktViralScores.viralScore))
        .limit(20);
    }),

  // 현재 바이럴 중인 게시물
  activeViral: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db.select().from(mktViralScores)
      .where(and(
        eq(mktViralScores.userId, ctx.user.id),
        eq(mktViralScores.isViral, true),
      ))
      .orderBy(desc(mktViralScores.measuredAt))
      .limit(10);
  }),

  // 수동 스코어 계산
  scorePost: protectedProcedure
    .input(z.object({ postId: z.number() }))
    .mutation(async ({ input }) => {
      const score = await scorePostManual(input.postId);
      return { success: true, score };
    }),

  // 바이럴 로그
  getLog: protectedProcedure
    .input(z.object({ limit: z.number().default(30) }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return db.select().from(mktViralLog)
        .where(eq(mktViralLog.userId, ctx.user.id))
        .orderBy(desc(mktViralLog.createdAt))
        .limit(input?.limit || 30);
    }),

  // 크로스 포스팅 목록
  crossPosts: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db.select().from(mktCrossPosts)
      .where(eq(mktCrossPosts.userId, ctx.user.id))
      .orderBy(desc(mktCrossPosts.createdAt))
      .limit(20);
  }),
});

// ======================== 리뷰/후기 ========================
const reviewsRouter = router({
  list: protectedProcedure
    .input(z.object({
      sentiment: z.enum(["positive", "neutral", "negative"]).optional(),
      isUsable: z.boolean().optional(),
      source: z.enum(["coupang", "naver_store", "naver_blog", "instagram", "youtube", "manual"]).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const conditions = [eq(mktReviews.userId, ctx.user.id)];
      if (input?.sentiment) conditions.push(eq(mktReviews.sentiment, input.sentiment));
      if (input?.isUsable) conditions.push(eq(mktReviews.isUsable, true));
      if (input?.source) conditions.push(eq(mktReviews.source, input.source));
      return db.select().from(mktReviews)
        .where(and(...conditions))
        .orderBy(desc(mktReviews.collectedAt))
        .limit(50);
    }),

  // 수동 리뷰 등록
  add: protectedProcedure
    .input(z.object({
      brandId: z.number().optional(),
      productId: z.number().optional(),
      source: z.enum(["coupang", "naver_store", "naver_blog", "instagram", "youtube", "manual"]),
      sourceUrl: z.string().optional(),
      reviewerName: z.string().optional(),
      rating: z.number().min(1).max(5).optional(),
      content: z.string().min(1),
      imageUrls: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const result = await db.insert(mktReviews).values({
        userId: ctx.user.id,
        brandId: input.brandId || null,
        productId: input.productId || null,
        source: input.source,
        sourceUrl: input.sourceUrl || null,
        reviewerName: input.reviewerName || null,
        rating: input.rating || null,
        content: input.content,
        imageUrls: input.imageUrls?.length ? input.imageUrls : null,
      });
      const insertId = Number((result as any)?.[0]?.insertId);

      // 자동 AI 분석
      setTimeout(() => analyzeReview(insertId).catch(() => {}), 1000);

      return { success: true, id: insertId };
    }),

  // AI 분석 트리거
  analyze: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const analysis = await analyzeReview(input.id);
      return { success: !!analysis, analysis };
    }),

  // 리뷰 → 콘텐츠 변환
  convertToContent: protectedProcedure
    .input(z.object({
      reviewId: z.number(),
      platforms: z.array(platformEnum),
    }))
    .mutation(async ({ input }) => {
      const content = await convertReviewToContent(input.reviewId, input.platforms);
      if (!content) throw new TRPCError({ code: "BAD_REQUEST", message: "변환 실패" });
      return { success: true, content };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(mktReviews)
        .where(and(eq(mktReviews.id, input.id), eq(mktReviews.userId, ctx.user.id)));
      return { success: true };
    }),
});

// ======================== 자동 응답 ========================
const autoResponseRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db.select().from(mktAutoResponses)
      .where(eq(mktAutoResponses.userId, ctx.user.id))
      .orderBy(desc(mktAutoResponses.createdAt));
  }),

  create: protectedProcedure
    .input(z.object({
      brandId: z.number().optional(),
      name: z.string().min(1),
      platform: platformAllEnum,
      triggerType: z.enum(["keyword", "question", "mention", "dm", "comment", "all"]).optional(),
      triggerKeywords: z.array(z.string()).optional(),
      responseTemplate: z.string().min(1),
      includeLink: z.boolean().optional(),
      linkUrl: z.string().optional(),
      useAi: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const result = await db.insert(mktAutoResponses).values({
        userId: ctx.user.id,
        brandId: input.brandId || null,
        name: input.name,
        platform: input.platform,
        triggerType: input.triggerType || "all",
        triggerKeywords: input.triggerKeywords?.length ? input.triggerKeywords : null,
        responseTemplate: input.responseTemplate,
        includeLink: input.includeLink || false,
        linkUrl: input.linkUrl || null,
        useAi: input.useAi !== false,
        isActive: true,
      });
      const insertId = Number((result as any)?.[0]?.insertId);
      return { success: true, id: insertId };
    }),

  toggle: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [item] = await db.select().from(mktAutoResponses)
        .where(and(eq(mktAutoResponses.id, input.id), eq(mktAutoResponses.userId, ctx.user.id)))
        .limit(1);
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      await db.update(mktAutoResponses).set({ isActive: !item.isActive } as any)
        .where(eq(mktAutoResponses.id, input.id));
      return { success: true, isActive: !item.isActive };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(mktAutoResponses)
        .where(and(eq(mktAutoResponses.id, input.id), eq(mktAutoResponses.userId, ctx.user.id)));
      return { success: true };
    }),
});

// ======================== 부스팅 규칙 ========================
const boostRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db.select().from(mktBoostRules)
      .where(eq(mktBoostRules.userId, ctx.user.id))
      .orderBy(desc(mktBoostRules.createdAt));
  }),

  create: protectedProcedure
    .input(z.object({
      brandId: z.number().optional(),
      name: z.string().min(1),
      platform: z.enum(["instagram", "youtube", "tiktok"]),
      minViralScore: z.number().min(50).max(100).optional(),
      dailyBudgetKrw: z.number().min(1000).optional(),
      maxBudgetPerPostKrw: z.number().min(1000).optional(),
      boostDurationHours: z.number().min(1).max(168).optional(),
      targetAudience: z.record(z.any()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const result = await db.insert(mktBoostRules).values({
        userId: ctx.user.id,
        brandId: input.brandId || null,
        name: input.name,
        platform: input.platform,
        minViralScore: input.minViralScore || 70,
        dailyBudgetKrw: input.dailyBudgetKrw || 10000,
        maxBudgetPerPostKrw: input.maxBudgetPerPostKrw || 50000,
        boostDurationHours: input.boostDurationHours || 48,
        targetAudience: input.targetAudience && Object.keys(input.targetAudience).length ? input.targetAudience : null,
        isActive: false, // 기본 비활성 (안전)
      });
      const insertId = Number((result as any)?.[0]?.insertId);
      return { success: true, id: insertId };
    }),

  toggle: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [rule] = await db.select().from(mktBoostRules)
        .where(and(eq(mktBoostRules.id, input.id), eq(mktBoostRules.userId, ctx.user.id)))
        .limit(1);
      if (!rule) throw new TRPCError({ code: "NOT_FOUND" });
      await db.update(mktBoostRules).set({ isActive: !rule.isActive } as any)
        .where(eq(mktBoostRules.id, input.id));
      return { success: true, isActive: !rule.isActive };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(mktBoostRules)
        .where(and(eq(mktBoostRules.id, input.id), eq(mktBoostRules.userId, ctx.user.id)));
      return { success: true };
    }),
});

// ======================== 통합 export ========================
export const viralRouter = router({
  trends: trendsRouter,
  monitor: viralMonitorRouter,
  reviews: reviewsRouter,
  autoResponse: autoResponseRouter,
  boost: boostRouter,
});
