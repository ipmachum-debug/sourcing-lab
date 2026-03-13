/**
 * Extension Sub-Router: 소싱 후보 (Sourcing Candidates)
 */
import { z } from "zod";
import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import { extCandidates, products } from "../../../drizzle/schema";
import { eq, and, desc, sql, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { N } from "./_helpers";

export const candidatesRouter = router({
  saveCandidate: protectedProcedure
    .input(z.object({
      productId: z.string().optional(),
      title: z.string().max(500).optional(),
      price: z.number().int().default(0),
      rating: z.number().default(0),
      reviewCount: z.number().int().default(0),
      imageUrl: z.string().optional(),
      coupangUrl: z.string().optional(),
      sourcingScore: z.number().int().default(0),
      sourcingGrade: z.string().max(2).optional(),
      searchQuery: z.string().max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 중복 체크
      if (input.productId) {
        const [existing] = await db.select({ id: extCandidates.id })
          .from(extCandidates)
          .where(and(
            eq(extCandidates.userId, ctx.user!.id),
            eq(extCandidates.productId, input.productId)
          ))
          .limit(1);
        if (existing) {
          return { success: true, id: existing.id, message: "이미 저장된 후보입니다." };
        }
      }

      const result = await db.insert(extCandidates).values({
        userId: ctx.user!.id,
        productId: input.productId || null,
        title: input.title || null,
        price: input.price,
        rating: input.rating.toFixed(1),
        reviewCount: input.reviewCount,
        imageUrl: input.imageUrl || null,
        coupangUrl: input.coupangUrl || null,
        sourcingScore: input.sourcingScore,
        sourcingGrade: input.sourcingGrade || null,
        searchQuery: input.searchQuery || null,
        status: "new",
      });

      return { success: true, id: (result as any)?.[0]?.insertId };
    }),

  // 후보 목록 조회
  listCandidates: protectedProcedure
    .input(z.object({
      status: z.enum(["new", "reviewing", "contacted_supplier", "sample_ordered", "dropped", "selected"]).optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const conditions = [eq(extCandidates.userId, ctx.user!.id)];
      if (input.status) conditions.push(eq(extCandidates.status, input.status));

      const rows = await db.select()
        .from(extCandidates)
        .where(and(...conditions))
        .orderBy(desc(extCandidates.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return rows;
    }),

  // 후보 상태 업데이트
  updateCandidate: protectedProcedure
    .input(z.object({
      id: z.number().int(),
      status: z.enum(["new", "reviewing", "contacted_supplier", "sample_ordered", "dropped", "selected"]).optional(),
      memo: z.string().max(2000).optional(),
      supplierUrl: z.string().optional(),
      estimatedCostCny: z.number().optional(),
      estimatedMarginRate: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const { id, ...updates } = input;
      const setObj: Record<string, any> = {};
      if (updates.status !== undefined) setObj.status = updates.status;
      if (updates.memo !== undefined) setObj.memo = updates.memo;
      if (updates.supplierUrl !== undefined) setObj.supplierUrl = updates.supplierUrl;
      if (updates.estimatedCostCny !== undefined) setObj.estimatedCostCny = updates.estimatedCostCny.toFixed(2);
      if (updates.estimatedMarginRate !== undefined) setObj.estimatedMarginRate = updates.estimatedMarginRate.toFixed(2);

      await db.update(extCandidates)
        .set(setObj)
        .where(and(eq(extCandidates.id, id), eq(extCandidates.userId, ctx.user!.id)));

      return { success: true };
    }),

  // 후보 삭제
  removeCandidate: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.delete(extCandidates)
        .where(and(eq(extCandidates.id, input.id), eq(extCandidates.userId, ctx.user!.id)));
      return { success: true };
    }),

  // 후보를 products 테이블로 승격 (소싱 상품으로 전환)
  promoteToProduct: protectedProcedure
    .input(z.object({ candidateId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { products } = await import("../../../drizzle/schema");

      const [candidate] = await db.select()
        .from(extCandidates)
        .where(and(eq(extCandidates.id, input.candidateId), eq(extCandidates.userId, ctx.user!.id)))
        .limit(1);

      if (!candidate) throw new TRPCError({ code: "NOT_FOUND" });

      // products 테이블에 추가
      const today = new Date().toISOString().slice(0, 10);
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const weekday = dayNames[new Date().getDay()];
      // weekKey 계산
      const todayDate = new Date();
      const onejan = new Date(todayDate.getFullYear(), 0, 1);
      const weekNum = Math.ceil(((todayDate.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
      const weekKey = `${todayDate.getFullYear()}-W${weekNum.toString().padStart(2, "0")}`;

      const result = await db.insert(products).values({
        userId: ctx.user!.id,
        recordDate: today,
        weekday,
        weekKey,
        productName: candidate.title || "확장프로그램 후보",
        status: "reviewing",
        priority: "medium",
        keyword1: candidate.searchQuery || null,
        coupangUrl: candidate.coupangUrl || null,
        competitionLevel: candidate.sourcingScore && candidate.sourcingScore >= 65 ? "low" :
                          candidate.sourcingScore && candidate.sourcingScore >= 45 ? "medium" : "high",
      });

      // 후보 상태 업데이트
      await db.update(extCandidates)
        .set({ status: "selected" })
        .where(eq(extCandidates.id, input.candidateId));

      return {
        success: true,
        productId: (result as any)?.[0]?.insertId,
        message: "소싱 상품으로 등록되었습니다.",
      };
    }),

  // 후보 통계
  candidateStats: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const statusCounts = await db.select({
      status: extCandidates.status,
      count: sql<number>`COUNT(*)`,
    })
      .from(extCandidates)
      .where(eq(extCandidates.userId, ctx.user!.id))
      .groupBy(extCandidates.status);

    const [totals] = await db.select({
      total: sql<number>`COUNT(*)`,
      avgScore: sql<number>`ROUND(AVG(${extCandidates.sourcingScore}))`,
      avgPrice: sql<number>`ROUND(AVG(${extCandidates.price}))`,
    })
      .from(extCandidates)
      .where(eq(extCandidates.userId, ctx.user!.id));

    return {
      statusCounts: statusCounts.map(s => ({ ...s, count: N(s.count) })),
      total: N(totals?.total),
      avgScore: N(totals?.avgScore),
      avgPrice: N(totals?.avgPrice),
    };
  }),
});
