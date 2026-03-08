import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { products } from "../../drizzle/schema";
import { eq, desc, and, sql, gte, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { calculateScore, getScoreGrade, getAutoStatus } from "../scoring";

const productInput = z.object({
  recordDate: z.string(),
  category: z.string().optional(),
  productName: z.string().min(1),
  priority: z.enum(["low", "medium", "high"]).optional(),
  keyword1: z.string().optional(),
  keyword2: z.string().optional(),
  keyword3: z.string().optional(),
  targetCustomer: z.string().optional(),
  seasonality: z.string().optional(),
  competitionLevel: z.enum(["low", "medium", "high", "very_high"]).optional(),
  differentiationLevel: z.enum(["low", "medium", "high"]).optional(),
  thumbnailMemo: z.string().optional(),
  detailPoint: z.string().optional(),
  giftIdea: z.string().optional(),
  improvementNote: z.string().optional(),
  developmentNote: z.string().optional(),
  finalOpinion: z.string().optional(),
  coupangUrl: z.string().optional(),
  referenceUrl: z.string().optional(),
});

function getWeekKey(dateStr: string): string {
  const d = new Date(dateStr);
  const onejan = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${weekNum.toString().padStart(2, "0")}`;
}

function getWeekday(dateStr: string): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(dateStr).getDay()];
}

export const sourcingRouter = router({
  /** 상품 등록 */
  create: protectedProcedure
    .input(productInput)
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      const score = calculateScore(input);
      const scoreGrade = getScoreGrade(score);
      const status = getAutoStatus(score);

      await db.insert(products).values({
        userId: ctx.user.id,
        recordDate: input.recordDate,
        weekday: getWeekday(input.recordDate),
        weekKey: getWeekKey(input.recordDate),
        category: input.category || null,
        productName: input.productName,
        priority: input.priority || "medium",
        keyword1: input.keyword1 || null,
        keyword2: input.keyword2 || null,
        keyword3: input.keyword3 || null,
        targetCustomer: input.targetCustomer || null,
        seasonality: input.seasonality || null,
        competitionLevel: input.competitionLevel || "medium",
        differentiationLevel: input.differentiationLevel || "medium",
        thumbnailMemo: input.thumbnailMemo || null,
        detailPoint: input.detailPoint || null,
        giftIdea: input.giftIdea || null,
        improvementNote: input.improvementNote || null,
        developmentNote: input.developmentNote || null,
        finalOpinion: input.finalOpinion || null,
        coupangUrl: input.coupangUrl || null,
        referenceUrl: input.referenceUrl || null,
        score,
        scoreGrade,
        status,
      });

      return { success: true };
    }),

  /** 상품 수정 */
  update: protectedProcedure
    .input(z.object({ id: z.number() }).merge(productInput.partial()))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      const { id, ...data } = input;

      // 기존 상품 확인
      const [existing] = await db.select().from(products)
        .where(and(eq(products.id, id), eq(products.userId, ctx.user.id)))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "상품을 찾을 수 없습니다." });

      // 점수 재계산용 merged data
      const merged = { ...existing, ...data };
      const score = calculateScore(merged);
      const scoreGrade = getScoreGrade(score);

      await db.update(products).set({
        ...data,
        score,
        scoreGrade,
        ...(data.recordDate ? {
          weekday: getWeekday(data.recordDate),
          weekKey: getWeekKey(data.recordDate),
        } : {}),
      }).where(eq(products.id, id));

      return { success: true };
    }),

  /** 상품 상태 변경 */
  changeStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["draft", "reviewing", "test_candidate", "testing", "hold", "dropped", "selected"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      await db.update(products)
        .set({ status: input.status })
        .where(and(eq(products.id, input.id), eq(products.userId, ctx.user.id)));

      return { success: true };
    }),

  /** 상품 목록 조회 */
  list: protectedProcedure
    .input(z.object({
      weekKey: z.string().optional(),
      status: z.string().optional(),
      category: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().default(100),
      offset: z.number().default(0),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      const filters = input || {};
      const conditions = [eq(products.userId, ctx.user.id)];

      if (filters.weekKey) conditions.push(eq(products.weekKey, filters.weekKey));
      if (filters.status) conditions.push(eq(products.status, filters.status as any));
      if (filters.category) conditions.push(eq(products.category, filters.category));
      if (filters.search) conditions.push(sql`${products.productName} LIKE ${'%' + filters.search + '%'}`);

      const items = await db.select().from(products)
        .where(and(...conditions))
        .orderBy(desc(products.createdAt))
        .limit(filters.limit || 100)
        .offset(filters.offset || 0);

      const [countResult] = await db.select({ count: sql<number>`count(*)` })
        .from(products)
        .where(and(...conditions));

      return { items, total: countResult?.count || 0 };
    }),

  /** 단일 상품 조회 */
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      const [item] = await db.select().from(products)
        .where(and(eq(products.id, input.id), eq(products.userId, ctx.user.id)))
        .limit(1);

      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      return item;
    }),

  /** 상품 삭제 */
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      await db.delete(products)
        .where(and(eq(products.id, input.id), eq(products.userId, ctx.user.id)));

      return { success: true };
    }),
});
