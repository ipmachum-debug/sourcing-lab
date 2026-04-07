import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import { mktAccounts, mktChannelPosts } from "../../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

const platformEnum = z.enum(["instagram", "youtube", "tiktok", "naver_blog", "naver_cafe", "kakao"]);

export const channelsRouter = router({
  // 연동 계정 목록
  listAccounts: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db.select().from(mktAccounts)
      .where(eq(mktAccounts.userId, ctx.user.id))
      .orderBy(desc(mktAccounts.createdAt));
  }),

  // 계정 수동 등록 (API 키 방식)
  addAccount: protectedProcedure
    .input(z.object({
      platform: platformEnum,
      accountName: z.string().min(1),
      accountId: z.string().optional(),
      accessToken: z.string().optional(),
      refreshToken: z.string().optional(),
      meta: z.record(z.any()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const result = await db.insert(mktAccounts).values({
        userId: ctx.user.id,
        platform: input.platform,
        accountName: input.accountName,
        accountId: input.accountId || null,
        accessToken: input.accessToken || null,
        refreshToken: input.refreshToken || null,
        meta: input.meta && Object.keys(input.meta).length ? input.meta : null,
        status: "active",
      });
      const insertId = Number((result as any)?.[0]?.insertId);
      return { success: true, id: insertId };
    }),

  // 계정 수정
  updateAccount: protectedProcedure
    .input(z.object({
      id: z.number(),
      accountName: z.string().optional(),
      accessToken: z.string().optional(),
      refreshToken: z.string().optional(),
      meta: z.record(z.any()).optional(),
      status: z.enum(["active", "expired", "error", "disconnected"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...data } = input;
      await db.update(mktAccounts).set(data as any)
        .where(and(eq(mktAccounts.id, id), eq(mktAccounts.userId, ctx.user.id)));
      return { success: true };
    }),

  // 계정 삭제
  deleteAccount: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(mktAccounts)
        .where(and(eq(mktAccounts.id, input.id), eq(mktAccounts.userId, ctx.user.id)));
      return { success: true };
    }),

  // 발행 큐 목록
  listPosts: protectedProcedure
    .input(z.object({
      platform: platformEnum.optional(),
      status: z.enum(["queued", "publishing", "published", "failed", "cancelled"]).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const conditions = [eq(mktChannelPosts.userId, ctx.user.id)];
      if (input?.platform) conditions.push(eq(mktChannelPosts.platform, input.platform));
      if (input?.status) conditions.push(eq(mktChannelPosts.publishStatus, input.status));
      return db.select().from(mktChannelPosts)
        .where(and(...conditions))
        .orderBy(desc(mktChannelPosts.createdAt));
    }),

  // 발행 상태 변경
  updatePostStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      publishStatus: z.enum(["queued", "publishing", "published", "failed", "cancelled"]),
      remotePostId: z.string().optional(),
      remotePostUrl: z.string().optional(),
      errorMessage: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...data } = input;
      if (input.publishStatus === "published") {
        (data as any).publishedAt = new Date().toISOString().replace("T", " ").slice(0, 19);
      }
      await db.update(mktChannelPosts).set(data as any)
        .where(and(eq(mktChannelPosts.id, id), eq(mktChannelPosts.userId, ctx.user.id)));
      return { success: true };
    }),

  // 게시물 삭제
  deletePost: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(mktChannelPosts)
        .where(and(eq(mktChannelPosts.id, input.id), eq(mktChannelPosts.userId, ctx.user.id)));
      return { success: true };
    }),

  // 여러 게시물 일괄 삭제
  deletePosts: protectedProcedure
    .input(z.object({ ids: z.array(z.number()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      let deleted = 0;
      for (const id of input.ids) {
        await db.delete(mktChannelPosts)
          .where(and(eq(mktChannelPosts.id, id), eq(mktChannelPosts.userId, ctx.user.id)));
        deleted++;
      }
      return { success: true, deleted };
    }),

  // 예약 시간 설정
  schedulePost: protectedProcedure
    .input(z.object({
      id: z.number(),
      scheduledAt: z.string(), // "YYYY-MM-DD HH:mm:ss"
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(mktChannelPosts)
        .set({ scheduledAt: input.scheduledAt, publishStatus: "queued" } as any)
        .where(and(eq(mktChannelPosts.id, input.id), eq(mktChannelPosts.userId, ctx.user.id)));
      return { success: true };
    }),
});
