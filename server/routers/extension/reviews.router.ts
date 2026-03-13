/**
 * Extension Sub-Router: AI 리뷰 분석 (AI Review Analysis)
 */
import { z } from "zod";
import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import { extSearchSnapshots, extReviewAnalyses, extCandidates, extNotifications } from "../../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { N } from "./_helpers";
import { callOpenAI, generateReviewAnalysis, generateRuleBasedAnalysis } from "./_aiHelpers";

export const reviewsRouter = router({
  analyzeReviews: protectedProcedure
    .input(z.object({
      query: z.string().min(1).max(255),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 해당 키워드의 스냅샷 데이터 가져오기
      const snapshots = await db.select()
        .from(extSearchSnapshots)
        .where(and(
          eq(extSearchSnapshots.userId, ctx.user!.id),
          eq(extSearchSnapshots.query, input.query),
        ))
        .orderBy(desc(extSearchSnapshots.createdAt))
        .limit(5);

      if (!snapshots.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "해당 키워드의 검색 데이터가 없습니다." });
      }

      // 관련 후보 데이터
      const candidates = await db.select()
        .from(extCandidates)
        .where(and(
          eq(extCandidates.userId, ctx.user!.id),
          eq(extCandidates.searchQuery, input.query),
        ))
        .limit(20);

      // 상품 상세 데이터
      const latestSnapshot = snapshots[0];
      let items: any[] = [];
      try {
        items = latestSnapshot.itemsJson ? JSON.parse(latestSnapshot.itemsJson) : [];
      } catch {
        // itemsJson이 손상된 경우 빈 배열로 진행
        items = [];
      }

      // AI 분석 로직 (OpenAI GPT 연동, 실패 시 규칙 기반 폴백)
      const analysis = await generateReviewAnalysis(input.query, latestSnapshot, items, candidates, snapshots);

      // 분석 결과 저장
      const result = await db.insert(extReviewAnalyses).values({
        userId: ctx.user!.id,
        query: input.query,
        analysisType: "keyword_review",
        totalProductsAnalyzed: items.length,
        avgRating: analysis.avgRating.toFixed(1),
        avgReviewCount: analysis.avgReviewCount,
        painPoints: JSON.stringify(analysis.painPoints),
        customerNeeds: JSON.stringify(analysis.customerNeeds),
        opportunities: JSON.stringify(analysis.opportunities),
        commonPraises: JSON.stringify(analysis.commonPraises),
        commonComplaints: JSON.stringify(analysis.commonComplaints),
        priceSensitivity: analysis.priceSensitivity,
        qualityConcerns: JSON.stringify(analysis.qualityConcerns),
        summaryText: analysis.summaryText,
        recommendations: JSON.stringify(analysis.recommendations),
      });

      // 알림 생성
      await db.insert(extNotifications).values({
        userId: ctx.user!.id,
        type: "ai_recommendation",
        title: `🔮 "${input.query}" AI 리뷰 분석 완료`,
        message: `${items.length}개 상품 분석 → ${analysis.opportunities.length}개 기회 발견`,
        data: JSON.stringify({ analysisId: (result as any)?.[0]?.insertId, query: input.query }),
        priority: "medium",
      });

      return {
        success: true,
        id: (result as any)?.[0]?.insertId,
        analysis,
      };
    }),

  // AI 분석 결과 조회
  getReviewAnalysis: protectedProcedure
    .input(z.object({
      query: z.string().optional(),
      limit: z.number().int().min(1).max(50).default(10),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const conditions = [eq(extReviewAnalyses.userId, ctx.user!.id)];
      if (input.query) conditions.push(eq(extReviewAnalyses.query, input.query));

      const rows = await db.select()
        .from(extReviewAnalyses)
        .where(and(...conditions))
        .orderBy(desc(extReviewAnalyses.createdAt))
        .limit(input.limit);

      return rows.map(row => {
        const safeJsonParse = (str: string | null) => {
          if (!str) return [];
          try { return JSON.parse(str); } catch { return []; }
        };
        const painPoints = safeJsonParse(row.painPoints);
        const customerNeeds = safeJsonParse(row.customerNeeds);
        const opportunities = safeJsonParse(row.opportunities);
        const commonPraises = safeJsonParse(row.commonPraises);
        const commonComplaints = safeJsonParse(row.commonComplaints);
        const qualityConcerns = safeJsonParse(row.qualityConcerns);
        const recommendations = safeJsonParse(row.recommendations);

        // aiPowered / trendInsight are not stored in DB — derive from summaryText
        const aiPowered = !(row.summaryText || "").startsWith("[규칙기반]");

        return {
          ...row,
          painPoints,
          customerNeeds,
          opportunities,
          commonPraises,
          commonComplaints,
          qualityConcerns,
          recommendations,
          aiPowered,
        };
      });
    }),
});
