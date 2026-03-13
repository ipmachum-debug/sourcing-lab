/**
 * Extension Sub-Router: 알림 센터 (Notification Center)
 */
import { z } from "zod";
import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import {
  extNotifications, extSearchSnapshots, extCandidates, extRankTrackings, extTrackedKeywords, extReviewAnalyses,
} from "../../../drizzle/schema";
import { eq, and, desc, sql, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { N } from "./_helpers";

export const notificationsRouter = router({
  listNotifications: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(30),
      offset: z.number().int().min(0).default(0),
      unreadOnly: z.boolean().default(false),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const conditions = [eq(extNotifications.userId, ctx.user!.id)];
      if (input.unreadOnly) conditions.push(eq(extNotifications.isRead, false));

      const rows = await db.select()
        .from(extNotifications)
        .where(and(...conditions))
        .orderBy(desc(extNotifications.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return rows;
    }),

  // 미읽은 알림 수
  unreadNotificationCount: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [result] = await db.select({
        count: sql<number>`COUNT(*)`,
      })
        .from(extNotifications)
        .where(and(
          eq(extNotifications.userId, ctx.user!.id),
          eq(extNotifications.isRead, false),
        ));

      return { count: N(result?.count) };
    }),

  // 알림 읽음 처리
  markNotificationRead: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.update(extNotifications)
        .set({ isRead: true })
        .where(and(eq(extNotifications.id, input.id), eq(extNotifications.userId, ctx.user!.id)));
      return { success: true };
    }),

  // 모든 알림 읽음 처리
  markAllNotificationsRead: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.update(extNotifications)
        .set({ isRead: true })
        .where(and(
          eq(extNotifications.userId, ctx.user!.id),
          eq(extNotifications.isRead, false),
        ));
      return { success: true };
    }),

  // 알림 삭제
  deleteNotification: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.delete(extNotifications)
        .where(and(eq(extNotifications.id, input.id), eq(extNotifications.userId, ctx.user!.id)));
      return { success: true };
    }),

  // 30일 이상 된 알림 자동 정리
  cleanOldNotifications: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const result = await db.delete(extNotifications)
        .where(and(
          eq(extNotifications.userId, ctx.user!.id),
          sql`${extNotifications.createdAt} < DATE_SUB(NOW(), INTERVAL 30 DAY)`,
        ));
      return { success: true };
    }),

  // PDF 보고서용 데이터 집합 조회
  getReportData: protectedProcedure
    .input(z.object({ days: z.number().int().min(1).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 검색 통계
      const [searchStats] = await db.select({
        totalSearches: sql<number>`COUNT(*)`,
        uniqueQueries: sql<number>`COUNT(DISTINCT ${extSearchSnapshots.query})`,
        avgCompetition: sql<number>`ROUND(AVG(${extSearchSnapshots.competitionScore}))`,
        avgPrice: sql<number>`ROUND(AVG(${extSearchSnapshots.avgPrice}))`,
      })
        .from(extSearchSnapshots)
        .where(and(
          eq(extSearchSnapshots.userId, ctx.user!.id),
          sql`${extSearchSnapshots.createdAt} >= DATE_SUB(NOW(), INTERVAL ${input.days} DAY)`,
        ));

      // 후보 통계
      const [candStats] = await db.select({
        total: sql<number>`COUNT(*)`,
        avgScore: sql<number>`ROUND(AVG(${extCandidates.sourcingScore}))`,
      })
        .from(extCandidates)
        .where(eq(extCandidates.userId, ctx.user!.id));

      const statusCounts = await db.select({
        status: extCandidates.status,
        count: sql<number>`COUNT(*)`,
      })
        .from(extCandidates)
        .where(eq(extCandidates.userId, ctx.user!.id))
        .groupBy(extCandidates.status);

      // TOP 키워드
      const topQueries = await db.select({
        query: extSearchSnapshots.query,
        count: sql<number>`COUNT(*)`,
        avgCompetition: sql<number>`ROUND(AVG(${extSearchSnapshots.competitionScore}))`,
        avgPrice: sql<number>`ROUND(AVG(${extSearchSnapshots.avgPrice}))`,
      })
        .from(extSearchSnapshots)
        .where(and(
          eq(extSearchSnapshots.userId, ctx.user!.id),
          sql`${extSearchSnapshots.createdAt} >= DATE_SUB(NOW(), INTERVAL ${input.days} DAY)`,
        ))
        .groupBy(extSearchSnapshots.query)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(10);

      // 추적 키워드
      const trackedKeywords = await db.select()
        .from(extTrackedKeywords)
        .where(and(eq(extTrackedKeywords.userId, ctx.user!.id), eq(extTrackedKeywords.isActive, true)));

      // 최근 AI 분석
      const recentAnalyses = await db.select()
        .from(extReviewAnalyses)
        .where(and(
          eq(extReviewAnalyses.userId, ctx.user!.id),
          sql`${extReviewAnalyses.createdAt} >= DATE_SUB(NOW(), INTERVAL ${input.days} DAY)`,
        ))
        .orderBy(desc(extReviewAnalyses.createdAt))
        .limit(5);

      return {
        period: input.days,
        generatedAt: new Date().toISOString(),
        searchStats: searchStats ? {
          totalSearches: N(searchStats.totalSearches),
          uniqueQueries: N(searchStats.uniqueQueries),
          avgCompetition: N(searchStats.avgCompetition),
          avgPrice: N(searchStats.avgPrice),
        } : {},
        candidateStats: {
          total: N(candStats?.total),
          avgScore: N(candStats?.avgScore),
          statusCounts: statusCounts.map(s => ({ ...s, count: N(s.count) })),
        },
        topQueries: topQueries.map(q => ({
          ...q,
          count: N(q.count),
          avgCompetition: N(q.avgCompetition),
          avgPrice: N(q.avgPrice),
        })),
        trackedKeywords,
        recentAnalyses: recentAnalyses.map(a => {
          const safeJsonParse = (str: string | null) => {
            if (!str) return [];
            try { return JSON.parse(str); } catch { return []; }
          };
          return {
            ...a,
            recommendations: safeJsonParse(a.recommendations),
            opportunities: safeJsonParse(a.opportunities),
          };
        }),
      };
    }),

});
