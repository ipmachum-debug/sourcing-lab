import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import { mktAbTests, mktChannelPosts, mktAnalytics } from "../../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

const platformEnum = z.enum(["instagram", "youtube", "tiktok", "naver_blog", "naver_cafe", "kakao"]);

export const abTestRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db.select().from(mktAbTests)
      .where(eq(mktAbTests.userId, ctx.user.id))
      .orderBy(desc(mktAbTests.createdAt));
  }),

  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      campaignId: z.number().optional(),
      platform: platformEnum,
      variantA: z.object({
        title: z.string().optional(),
        caption: z.string(),
        hashtags: z.array(z.string()).optional(),
        mediaUrl: z.string().optional(),
      }),
      variantB: z.object({
        title: z.string().optional(),
        caption: z.string(),
        hashtags: z.array(z.string()).optional(),
        mediaUrl: z.string().optional(),
      }),
      winnerMetric: z.enum(["views", "likes", "clicks", "conversions", "ctr"]).optional(),
      testDurationHours: z.number().min(1).max(168).optional(), // 1시간 ~ 7일
      autoExpandWinner: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const result = await db.insert(mktAbTests).values({
        userId: ctx.user.id,
        campaignId: input.campaignId || null,
        name: input.name,
        platform: input.platform,
        variantA: input.variantA,
        variantB: input.variantB,
        winnerMetric: input.winnerMetric || "clicks",
        testDurationHours: input.testDurationHours || 48,
        autoExpandWinner: input.autoExpandWinner || false,
        status: "draft",
      });
      const insertId = Number((result as any)?.[0]?.insertId);
      return { success: true, id: insertId };
    }),

  // A/B 테스트 시작 — 두 변형을 각각 발행 큐에 추가
  start: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [test] = await db.select().from(mktAbTests)
        .where(and(eq(mktAbTests.id, input.id), eq(mktAbTests.userId, ctx.user.id)))
        .limit(1);
      if (!test) throw new TRPCError({ code: "NOT_FOUND" });
      if (test.status !== "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "이미 시작된 테스트입니다." });

      const varA = test.variantA as any;
      const varB = test.variantB as any;
      const now = new Date().toISOString().replace("T", " ").slice(0, 19);

      // 변형 A 발행
      const resA = await db.insert(mktChannelPosts).values({
        contentItemId: 0, // A/B 테스트용
        userId: ctx.user.id,
        platform: test.platform,
        title: varA.title || null,
        caption: varA.caption,
        hashtags: varA.hashtags || [],
        mediaPaths: varA.mediaUrl ? [varA.mediaUrl] : [],
        scheduledAt: now,
        publishStatus: "queued",
      });
      const postAId = Number((resA as any)?.[0]?.insertId);

      // 변형 B 발행
      const resB = await db.insert(mktChannelPosts).values({
        contentItemId: 0,
        userId: ctx.user.id,
        platform: test.platform,
        title: varB.title || null,
        caption: varB.caption,
        hashtags: varB.hashtags || [],
        mediaPaths: varB.mediaUrl ? [varB.mediaUrl] : [],
        scheduledAt: now,
        publishStatus: "queued",
      });
      const postBId = Number((resB as any)?.[0]?.insertId);

      // 테스트 시작 업데이트
      await db.update(mktAbTests).set({
        status: "running",
        variantAPostId: postAId,
        variantBPostId: postBId,
        startedAt: now,
      } as any).where(eq(mktAbTests.id, input.id));

      return { success: true, postAId, postBId };
    }),

  // 결과 확인 (수동 or 자동)
  checkResult: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [test] = await db.select().from(mktAbTests)
        .where(and(eq(mktAbTests.id, input.id), eq(mktAbTests.userId, ctx.user.id)))
        .limit(1);
      if (!test) throw new TRPCError({ code: "NOT_FOUND" });
      if (test.status !== "running") throw new TRPCError({ code: "BAD_REQUEST", message: "실행 중인 테스트만 결과를 확인할 수 있습니다." });

      // 두 변형의 최신 성과 비교
      const getLatestStats = async (postId: number | null) => {
        if (!postId) return null;
        const [stats] = await db.select().from(mktAnalytics)
          .where(eq(mktAnalytics.channelPostId, postId))
          .orderBy(desc(mktAnalytics.capturedAt))
          .limit(1);
        return stats;
      };

      const statsA = await getLatestStats(test.variantAPostId);
      const statsB = await getLatestStats(test.variantBPostId);

      if (!statsA && !statsB) {
        return { success: true, status: "no_data", message: "아직 성과 데이터가 수집되지 않았습니다." };
      }

      // 승자 판정
      const metric = test.winnerMetric || "clicks";
      const scoreA = Number((statsA as any)?.[metric] || 0);
      const scoreB = Number((statsB as any)?.[metric] || 0);
      const winner = scoreA >= scoreB ? "a" : "b";

      const now = new Date().toISOString().replace("T", " ").slice(0, 19);
      await db.update(mktAbTests).set({
        status: "completed",
        winnerVariant: winner,
        completedAt: now,
      } as any).where(eq(mktAbTests.id, input.id));

      return {
        success: true,
        status: "completed",
        winner,
        scoreA,
        scoreB,
        metric,
      };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(mktAbTests)
        .where(and(eq(mktAbTests.id, input.id), eq(mktAbTests.userId, ctx.user.id)));
      return { success: true };
    }),
});
