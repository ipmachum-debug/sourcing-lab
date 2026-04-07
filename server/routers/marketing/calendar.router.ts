import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import { mktCalendarEvents } from "../../../drizzle/schema";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

const eventInput = z.object({
  brandId: z.number().optional(),
  clientId: z.number().optional(),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  eventDate: z.string(), // YYYY-MM-DD
  eventTime: z.string().optional(), // HH:mm
  type: z.enum(["post", "story", "reel", "shorts", "live", "blog", "meeting", "deadline", "holiday", "promotion", "memo"]).optional(),
  platform: z.enum(["instagram", "youtube", "tiktok", "naver_blog", "naver_cafe", "kakao", "all"]).optional(),
  contentItemId: z.number().optional(),
  channelPostId: z.number().optional(),
  color: z.string().max(7).optional(),
  status: z.enum(["planned", "in_progress", "done", "cancelled"]).optional(),
});

export const calendarRouter = router({
  // 기간별 이벤트 조회 (캘린더 뷰)
  getEvents: protectedProcedure
    .input(z.object({
      startDate: z.string(), // YYYY-MM-DD
      endDate: z.string(),
      brandId: z.number().optional(),
      clientId: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const conditions = [
        eq(mktCalendarEvents.userId, ctx.user.id),
        gte(mktCalendarEvents.eventDate, input.startDate),
        lte(mktCalendarEvents.eventDate, input.endDate),
      ];
      if (input.brandId) conditions.push(eq(mktCalendarEvents.brandId, input.brandId));
      if (input.clientId) conditions.push(eq(mktCalendarEvents.clientId, input.clientId));
      return db.select().from(mktCalendarEvents)
        .where(and(...conditions))
        .orderBy(mktCalendarEvents.eventDate, mktCalendarEvents.eventTime);
    }),

  // 이벤트 생성
  create: protectedProcedure.input(eventInput).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const result = await db.insert(mktCalendarEvents).values({
      userId: ctx.user.id,
      brandId: input.brandId || null,
      clientId: input.clientId || null,
      title: input.title,
      description: input.description || null,
      eventDate: input.eventDate,
      eventTime: input.eventTime || null,
      type: input.type || "post",
      platform: input.platform || null,
      contentItemId: input.contentItemId || null,
      channelPostId: input.channelPostId || null,
      color: input.color || null,
      status: input.status || "planned",
    });
    const insertId = Number((result as any)?.[0]?.insertId);
    return { success: true, id: insertId };
  }),

  // 이벤트 수정
  update: protectedProcedure
    .input(z.object({ id: z.number() }).merge(eventInput.partial()))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...data } = input;
      await db.update(mktCalendarEvents).set(data as any)
        .where(and(eq(mktCalendarEvents.id, id), eq(mktCalendarEvents.userId, ctx.user.id)));
      return { success: true };
    }),

  // 이벤트 삭제
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(mktCalendarEvents)
        .where(and(eq(mktCalendarEvents.id, input.id), eq(mktCalendarEvents.userId, ctx.user.id)));
      return { success: true };
    }),

  // 드래그 이동 (날짜 변경)
  moveEvent: protectedProcedure
    .input(z.object({ id: z.number(), eventDate: z.string(), eventTime: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(mktCalendarEvents)
        .set({ eventDate: input.eventDate, eventTime: input.eventTime || null } as any)
        .where(and(eq(mktCalendarEvents.id, input.id), eq(mktCalendarEvents.userId, ctx.user.id)));
      return { success: true };
    }),
});
