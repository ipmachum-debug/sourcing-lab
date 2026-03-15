/**
 * [DEPRECATED 2026-03-15] 키워드 메트릭 & 알림 라우터
 * ⚠ 구 ext_keyword_metrics / ext_keyword_alerts 테이블 기반 (현재 0행).
 * 정확한 통계는 ext_keyword_daily_stats 기반의 demand.router.ts 사용.
 */

import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import { extKeywordMetrics, extKeywordAlerts } from "../../drizzle/schema";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { rebuildKeywordMetrics, rebuildAllKeywordMetrics } from "../keywordMetrics";

export const keywordMetricsRouter = router({
  /**
   * 키워드 차트 데이터 조회
   * — 프론트엔드 그래프용: 막대(salesEstimate) + 선(EMA7/EMA30) + 마커(alertLevel)
   */
  getChartData: protectedProcedure
    .input(z.object({
      keyword: z.string().min(1),
      days: z.number().int().min(7).max(365).default(90),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      const rows = await db
        .select()
        .from(extKeywordMetrics)
        .where(
          and(
            eq(extKeywordMetrics.userId, ctx.user!.id),
            eq(extKeywordMetrics.keyword, input.keyword),
          ),
        )
        .orderBy(asc(extKeywordMetrics.metricDate))
        .limit(input.days);

      return rows.map(r => ({
        date: r.metricDate,
        reviewDelta: r.reviewDelta,
        reviewDeltaEma7: Number(r.reviewDeltaEma7),
        reviewDeltaEma30: Number(r.reviewDeltaEma30),
        salesEstimate: r.salesEstimate,
        salesEstimateEma7: Number(r.salesEstimateEma7),
        salesEstimateEma30: Number(r.salesEstimateEma30),
        adRatio: Number(r.adRatio),
        newProductRatio: Number(r.newProductRatio),
        priceSpread: r.priceSpread,
        rollingMean30: Number(r.rollingMean30),
        rollingStd30: Number(r.rollingStd30),
        spikeScore: Number(r.spikeScore),
        alertLevel: r.alertLevel,
      }));
    }),

  /**
   * 키워드 메트릭 재계산 (수동 트리거)
   */
  rebuild: protectedProcedure
    .input(z.object({
      keyword: z.string().min(1),
      categoryName: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await rebuildKeywordMetrics(
        ctx.user!.id,
        input.keyword,
        input.categoryName,
      );
      return result;
    }),

  /**
   * 전체 키워드 메트릭 일괄 재계산
   */
  rebuildAll: protectedProcedure
    .mutation(async ({ ctx }) => {
      const result = await rebuildAllKeywordMetrics(ctx.user!.id);
      return result;
    }),

  /**
   * 알림 목록 조회
   */
  listAlerts: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(50),
      unreadOnly: z.boolean().default(false),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      const conditions = [eq(extKeywordAlerts.userId, ctx.user!.id)];
      if (input.unreadOnly) {
        conditions.push(eq(extKeywordAlerts.isRead, false));
      }

      const rows = await db
        .select()
        .from(extKeywordAlerts)
        .where(and(...conditions))
        .orderBy(desc(extKeywordAlerts.createdAt))
        .limit(input.limit);

      return rows.map(r => ({
        id: r.id,
        keyword: r.keyword,
        alertDate: r.alertDate,
        alertType: r.alertType,
        alertScore: Number(r.alertScore),
        message: r.message,
        isRead: r.isRead,
        createdAt: r.createdAt,
      }));
    }),

  /**
   * 알림 읽음 처리
   */
  markAlertRead: protectedProcedure
    .input(z.object({
      alertIds: z.array(z.number().int()).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      for (const id of input.alertIds) {
        await db
          .update(extKeywordAlerts)
          .set({ isRead: true })
          .where(
            and(
              eq(extKeywordAlerts.id, id),
              eq(extKeywordAlerts.userId, ctx.user!.id),
            ),
          );
      }

      return { success: true, count: input.alertIds.length };
    }),

  /**
   * 읽지 않은 알림 수
   */
  unreadCount: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      const [result] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(extKeywordAlerts)
        .where(
          and(
            eq(extKeywordAlerts.userId, ctx.user!.id),
            eq(extKeywordAlerts.isRead, false),
          ),
        );

      return { count: Number(result?.count ?? 0) };
    }),
});
