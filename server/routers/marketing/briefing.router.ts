import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import { mktBriefings, mktChannelPosts, mktContentItems, mktAnalytics, mktProducts } from "../../../drizzle/schema";
import { eq, and, desc, sql, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { generateBriefing } from "../../modules/marketing/briefingEngine";

export const briefingRouter = router({
  // 오늘 브리핑 조회 (없으면 생성)
  getToday: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const today = new Date().toISOString().slice(0, 10);

    // 오늘 브리핑 있는지 확인
    const [existing] = await db.select().from(mktBriefings)
      .where(and(
        eq(mktBriefings.userId, ctx.user.id),
        eq(mktBriefings.briefingDate, today),
      ))
      .limit(1);

    if (existing) return existing;

    // 없으면 AI로 생성
    const briefingData = await generateBriefing(ctx.user.id);

    const result = await db.insert(mktBriefings).values({
      userId: ctx.user.id,
      briefingDate: today,
      summary: briefingData.summary,
      actionItems: briefingData.actionItems,
      alerts: briefingData.alerts,
      recommendations: briefingData.recommendations,
    });

    const insertId = Number((result as any)?.[0]?.insertId);
    const [created] = await db.select().from(mktBriefings)
      .where(eq(mktBriefings.id, insertId)).limit(1);
    return created;
  }),

  // 브리핑 히스토리
  list: protectedProcedure
    .input(z.object({ limit: z.number().default(14) }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return db.select().from(mktBriefings)
        .where(eq(mktBriefings.userId, ctx.user.id))
        .orderBy(desc(mktBriefings.briefingDate))
        .limit(input?.limit || 14);
    }),

  // 브리핑 읽음 처리
  markRead: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(mktBriefings)
        .set({ isRead: true } as any)
        .where(and(eq(mktBriefings.id, input.id), eq(mktBriefings.userId, ctx.user.id)));
      return { success: true };
    }),

  // 수동 브리핑 재생성
  regenerate: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const today = new Date().toISOString().slice(0, 10);
    const briefingData = await generateBriefing(ctx.user.id);

    // 오늘 것 있으면 업데이트, 없으면 생성
    const [existing] = await db.select().from(mktBriefings)
      .where(and(
        eq(mktBriefings.userId, ctx.user.id),
        eq(mktBriefings.briefingDate, today),
      ))
      .limit(1);

    if (existing) {
      await db.update(mktBriefings).set({
        summary: briefingData.summary,
        actionItems: briefingData.actionItems,
        alerts: briefingData.alerts,
        recommendations: briefingData.recommendations,
        isRead: false,
      } as any).where(eq(mktBriefings.id, existing.id));
      return { success: true, id: existing.id };
    }

    const result = await db.insert(mktBriefings).values({
      userId: ctx.user.id,
      briefingDate: today,
      summary: briefingData.summary,
      actionItems: briefingData.actionItems,
      alerts: briefingData.alerts,
      recommendations: briefingData.recommendations,
    });
    const insertId = Number((result as any)?.[0]?.insertId);
    return { success: true, id: insertId };
  }),
});
