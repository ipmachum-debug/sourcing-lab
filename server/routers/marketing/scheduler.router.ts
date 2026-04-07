import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import { mktScheduleRules, mktChannelPosts } from "../../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { triggerPublish } from "../../modules/marketing/publishScheduler";
import { collectForPost } from "../../modules/marketing/analyticsCollector";
import { analyzeSingle } from "../../modules/marketing/feedbackAnalyzer";

const platformEnum = z.enum(["instagram", "youtube", "tiktok", "naver_blog", "naver_cafe", "kakao"]);

export const schedulerRouter = router({
  // 예약 규칙 목록
  listRules: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db.select().from(mktScheduleRules)
      .where(eq(mktScheduleRules.userId, ctx.user.id))
      .orderBy(desc(mktScheduleRules.createdAt));
  }),

  // 예약 규칙 생성
  createRule: protectedProcedure
    .input(z.object({
      brandId: z.number().optional(),
      name: z.string().min(1).max(255),
      platform: platformEnum,
      frequency: z.enum(["daily", "weekdays", "weekly", "biweekly", "monthly", "custom"]).optional(),
      preferredTimes: z.array(z.string()).optional(), // ["09:00", "12:00", "18:00"]
      maxPostsPerDay: z.number().min(1).max(20).optional(),
      autoApprove: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const result = await db.insert(mktScheduleRules).values({
        userId: ctx.user.id,
        brandId: input.brandId || null,
        name: input.name,
        platform: input.platform,
        frequency: input.frequency || "daily",
        preferredTimes: input.preferredTimes || ["09:00", "12:00", "18:00"],
        maxPostsPerDay: input.maxPostsPerDay || 3,
        autoApprove: input.autoApprove || false,
        isActive: true,
      });
      const insertId = Number((result as any)?.[0]?.insertId);
      return { success: true, id: insertId };
    }),

  // 예약 규칙 수정
  updateRule: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      frequency: z.enum(["daily", "weekdays", "weekly", "biweekly", "monthly", "custom"]).optional(),
      preferredTimes: z.array(z.string()).optional(),
      maxPostsPerDay: z.number().min(1).max(20).optional(),
      autoApprove: z.boolean().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...data } = input;
      await db.update(mktScheduleRules).set(data as any)
        .where(and(eq(mktScheduleRules.id, id), eq(mktScheduleRules.userId, ctx.user.id)));
      return { success: true };
    }),

  // 예약 규칙 삭제
  deleteRule: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(mktScheduleRules)
        .where(and(eq(mktScheduleRules.id, input.id), eq(mktScheduleRules.userId, ctx.user.id)));
      return { success: true };
    }),

  // 수동 즉시 발행
  triggerPublish: protectedProcedure
    .input(z.object({ postId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // 권한 확인
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [post] = await db.select().from(mktChannelPosts)
        .where(and(eq(mktChannelPosts.id, input.postId), eq(mktChannelPosts.userId, ctx.user.id)))
        .limit(1);
      if (!post) throw new TRPCError({ code: "NOT_FOUND" });

      const result = await triggerPublish(input.postId);
      if (!result.success) {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
      }
      return { success: true };
    }),

  // 수동 성과 수집
  collectAnalytics: protectedProcedure
    .input(z.object({ postId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [post] = await db.select().from(mktChannelPosts)
        .where(and(eq(mktChannelPosts.id, input.postId), eq(mktChannelPosts.userId, ctx.user.id)))
        .limit(1);
      if (!post) throw new TRPCError({ code: "NOT_FOUND" });

      const success = await collectForPost(input.postId);
      return { success };
    }),

  // AI 피드백 분석 (단건)
  analyzeFeedback: protectedProcedure
    .input(z.object({
      contentItemId: z.number(),
      platform: platformEnum,
    }))
    .mutation(async ({ ctx, input }) => {
      const feedback = await analyzeSingle(input.contentItemId, input.platform);
      if (!feedback) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "피드백 생성에 실패했습니다." });
      }
      return { success: true, feedback };
    }),
});
