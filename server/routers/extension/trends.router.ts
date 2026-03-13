/**
 * Extension Sub-Router: 트렌드 & 분석 (Trends & Analytics)
 */
import { z } from "zod";
import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import {
  extSearchSnapshots, extCandidates, extRankTrackings, extProductDetails, extTrackedKeywords,
} from "../../../drizzle/schema";
import { eq, and, desc, sql, asc, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { N } from "./_helpers";

export const trendsRouter = router({
  searchTrends: protectedProcedure
    .input(z.object({ days: z.number().int().min(1).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const trends = await db.select({
        date: sql<string>`DATE(${extSearchSnapshots.createdAt})`,
        count: sql<number>`COUNT(*)`,
        uniqueQueries: sql<number>`COUNT(DISTINCT ${extSearchSnapshots.query})`,
        avgCompetition: sql<number>`ROUND(AVG(${extSearchSnapshots.competitionScore}))`,
        avgPrice: sql<number>`ROUND(AVG(${extSearchSnapshots.avgPrice}))`,
      })
        .from(extSearchSnapshots)
        .where(and(
          eq(extSearchSnapshots.userId, ctx.user!.id),
          sql`${extSearchSnapshots.createdAt} >= DATE_SUB(NOW(), INTERVAL ${input.days} DAY)`,
        ))
        .groupBy(sql`DATE(${extSearchSnapshots.createdAt})`)
        .orderBy(asc(sql`DATE(${extSearchSnapshots.createdAt})`));

      return trends.map(t => ({
        date: t.date,
        count: N(t.count),
        uniqueQueries: N(t.uniqueQueries),
        avgCompetition: N(t.avgCompetition),
        avgPrice: N(t.avgPrice),
      }));
    }),

  // 키워드별 경쟁도 트렌드
  keywordTrend: protectedProcedure
    .input(z.object({
      query: z.string(),
      days: z.number().int().min(1).max(90).default(30),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      return db.select({
        id: extSearchSnapshots.id,
        totalItems: extSearchSnapshots.totalItems,
        avgPrice: extSearchSnapshots.avgPrice,
        avgRating: extSearchSnapshots.avgRating,
        avgReview: extSearchSnapshots.avgReview,
        competitionScore: extSearchSnapshots.competitionScore,
        competitionLevel: extSearchSnapshots.competitionLevel,
        createdAt: extSearchSnapshots.createdAt,
      })
        .from(extSearchSnapshots)
        .where(and(
          eq(extSearchSnapshots.userId, ctx.user!.id),
          eq(extSearchSnapshots.query, input.query),
          sql`${extSearchSnapshots.createdAt} >= DATE_SUB(NOW(), INTERVAL ${input.days} DAY)`,
        ))
        .orderBy(asc(extSearchSnapshots.createdAt))
        .limit(100);
    }),

  // 순위 변동 차트 데이터 (타겟 상품의 일별 순위)
  rankTrendChart: protectedProcedure
    .input(z.object({
      query: z.string(),
      coupangProductId: z.string(),
      days: z.number().int().min(1).max(90).default(30),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const rows = await db.select({
        date: sql<string>`DATE(${extRankTrackings.capturedAt})`,
        avgPosition: sql<number>`ROUND(AVG(${extRankTrackings.position}))`,
        minPosition: sql<number>`MIN(${extRankTrackings.position})`,
        maxPosition: sql<number>`MAX(${extRankTrackings.position})`,
        price: sql<number>`ROUND(AVG(${extRankTrackings.price}))`,
        reviewCount: sql<number>`ROUND(AVG(${extRankTrackings.reviewCount}))`,
      })
        .from(extRankTrackings)
        .where(and(
          eq(extRankTrackings.userId, ctx.user!.id),
          eq(extRankTrackings.query, input.query),
          eq(extRankTrackings.coupangProductId, input.coupangProductId),
          sql`${extRankTrackings.capturedAt} >= DATE_SUB(NOW(), INTERVAL ${input.days} DAY)`,
        ))
        .groupBy(sql`DATE(${extRankTrackings.capturedAt})`)
        .orderBy(asc(sql`DATE(${extRankTrackings.capturedAt})`));

      return rows.map(r => ({
        date: r.date,
        avgPosition: N(r.avgPosition),
        minPosition: N(r.minPosition),
        maxPosition: N(r.maxPosition),
        price: N(r.price),
        reviewCount: N(r.reviewCount),
      }));
    }),

  // 경쟁자 모니터링: 특정 키워드의 상위 상품 변동 추적
  competitorMonitor: protectedProcedure
    .input(z.object({
      query: z.string(),
      days: z.number().int().min(1).max(90).default(7),
      topN: z.number().int().min(1).max(20).default(10),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 최신 순위
      const latest = await db.select()
        .from(extRankTrackings)
        .where(and(
          eq(extRankTrackings.userId, ctx.user!.id),
          eq(extRankTrackings.query, input.query),
          sql`${extRankTrackings.capturedAt} = (
            SELECT MAX(captured_at) FROM ext_rank_trackings
            WHERE user_id = ${ctx.user!.id} AND query = ${input.query}
          )`,
        ))
        .orderBy(extRankTrackings.position)
        .limit(input.topN);

      // N일 전 순위
      const previous = await db.select()
        .from(extRankTrackings)
        .where(and(
          eq(extRankTrackings.userId, ctx.user!.id),
          eq(extRankTrackings.query, input.query),
          sql`DATE(${extRankTrackings.capturedAt}) = (
            SELECT DISTINCT DATE(captured_at) FROM ext_rank_trackings
            WHERE user_id = ${ctx.user!.id} AND query = ${input.query}
            AND DATE(captured_at) < DATE(NOW())
            ORDER BY DATE(captured_at) DESC
            LIMIT 1
          )`,
        ))
        .orderBy(extRankTrackings.position)
        .limit(20);

      // 비교 데이터 생성
      const prevMap = new Map<string, any>();
      for (const p of previous) prevMap.set(p.coupangProductId, p);

      const competitors = latest.map(item => {
        const prev = prevMap.get(item.coupangProductId);
        return {
          ...item,
          prevPosition: prev?.position ?? null,
          positionChange: prev ? prev.position - item.position : null,
          prevPrice: prev?.price ?? null,
          priceChange: prev && item.price ? item.price - prev.price : null,
          prevReviewCount: prev?.reviewCount ?? null,
          reviewChange: prev ? (item.reviewCount || 0) - (prev.reviewCount || 0) : null,
        };
      });

      return { latest: competitors, totalTracked: latest.length };
    }),

  // 키워드 그룹 관리 (로컬 저장은 추적 키워드에 memo 필드 사용)
  updateTrackedKeyword: protectedProcedure
    .input(z.object({
      id: z.number().int(),
      targetProductId: z.string().max(50).optional(),
      targetProductName: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const setObj: Record<string, any> = {};
      if (input.targetProductId !== undefined) setObj.targetProductId = input.targetProductId;
      if (input.targetProductName !== undefined) setObj.targetProductName = input.targetProductName;
      await db.update(extTrackedKeywords)
        .set(setObj)
        .where(and(eq(extTrackedKeywords.id, input.id), eq(extTrackedKeywords.userId, ctx.user!.id)));
      return { success: true };
    }),

  // AI 소싱 추천 (서버에 축적된 데이터 기반)
  aiSourcingRecommendation: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 경쟁도가 낮은 검색어 Top 5
      const easyKeywords = await db.select({
        query: extSearchSnapshots.query,
        competitionScore: extSearchSnapshots.competitionScore,
        avgPrice: extSearchSnapshots.avgPrice,
        avgReview: extSearchSnapshots.avgReview,
        totalItems: extSearchSnapshots.totalItems,
        createdAt: extSearchSnapshots.createdAt,
      })
        .from(extSearchSnapshots)
        .where(and(
          eq(extSearchSnapshots.userId, ctx.user!.id),
          sql`${extSearchSnapshots.competitionScore} <= 40`,
          sql`${extSearchSnapshots.totalItems} >= 5`,
        ))
        .orderBy(asc(extSearchSnapshots.competitionScore))
        .limit(10);

      // 소싱 점수 높은 후보 Top 5
      const topCandidates = await db.select()
        .from(extCandidates)
        .where(and(
          eq(extCandidates.userId, ctx.user!.id),
          ne(extCandidates.status, 'dropped'),
          sql`${extCandidates.sourcingScore} >= 65`,
        ))
        .orderBy(desc(extCandidates.sourcingScore))
        .limit(5);

      // 가격이 높아서 마진 여유 있는 카테고리
      const highPriceKeywords = await db.select({
        query: extSearchSnapshots.query,
        avgPrice: extSearchSnapshots.avgPrice,
        competitionScore: extSearchSnapshots.competitionScore,
      })
        .from(extSearchSnapshots)
        .where(and(
          eq(extSearchSnapshots.userId, ctx.user!.id),
          sql`${extSearchSnapshots.avgPrice} >= 20000`,
          sql`${extSearchSnapshots.competitionScore} <= 60`,
        ))
        .orderBy(desc(extSearchSnapshots.avgPrice))
        .limit(5);

      // 추천 로직
      const recommendations = [];

      // 블루오션 키워드 추천
      const uniqueEasy = Array.from(new Map(easyKeywords.map(k => [k.query, k])).values()).slice(0, 5);
      if (uniqueEasy.length > 0) {
        recommendations.push({
          type: 'blueocean',
          title: '🌊 블루오션 키워드',
          description: '경쟁도가 낮아 진입하기 좋은 키워드입니다.',
          items: uniqueEasy.map(k => ({
            query: k.query,
            score: k.competitionScore,
            avgPrice: k.avgPrice,
            avgReview: k.avgReview,
            reason: `경쟁도 ${k.competitionScore}점 (약함), 평균리뷰 ${k.avgReview}개`,
          })),
        });
      }

      // 고마진 가능 키워드 추천
      if (highPriceKeywords.length > 0) {
        recommendations.push({
          type: 'high_margin',
          title: '💰 고마진 기회',
          description: '평균 판매가가 높고 경쟁이 적당한 키워드입니다.',
          items: highPriceKeywords.map(k => ({
            query: k.query,
            avgPrice: k.avgPrice,
            score: k.competitionScore,
            reason: `평균가 ${(k.avgPrice || 0).toLocaleString()}원, 경쟁도 ${k.competitionScore}점`,
          })),
        });
      }

      // 유망 후보 추천
      if (topCandidates.length > 0) {
        recommendations.push({
          type: 'top_candidates',
          title: '⭐ 유망 소싱 후보',
          description: '소싱 점수가 높은 상품들입니다.',
          items: topCandidates.map(c => ({
            title: c.title,
            price: c.price,
            sourcingScore: c.sourcingScore,
            sourcingGrade: c.sourcingGrade,
            reviewCount: c.reviewCount,
            reason: `소싱등급 ${c.sourcingGrade} (${c.sourcingScore}점), 리뷰 ${c.reviewCount}개`,
          })),
        });
      }

      return { recommendations };
    }),

  // 알림/활동 요약 (최근 변동 사항)
  activitySummary: protectedProcedure
    .input(z.object({ days: z.number().int().min(1).max(30).default(7) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 최근 검색 수
      const [recentSearches] = await db.select({
        count: sql<number>`COUNT(*)`,
      })
        .from(extSearchSnapshots)
        .where(and(
          eq(extSearchSnapshots.userId, ctx.user!.id),
          sql`${extSearchSnapshots.createdAt} >= DATE_SUB(NOW(), INTERVAL ${input.days} DAY)`,
        ));

      // 최근 저장된 후보 수
      const [recentCandidates] = await db.select({
        count: sql<number>`COUNT(*)`,
      })
        .from(extCandidates)
        .where(and(
          eq(extCandidates.userId, ctx.user!.id),
          sql`${extCandidates.createdAt} >= DATE_SUB(NOW(), INTERVAL ${input.days} DAY)`,
        ));

      // 순위 데이터 수
      const [recentRanks] = await db.select({
        count: sql<number>`COUNT(*)`,
      })
        .from(extRankTrackings)
        .where(and(
          eq(extRankTrackings.userId, ctx.user!.id),
          sql`${extRankTrackings.capturedAt} >= DATE_SUB(NOW(), INTERVAL ${input.days} DAY)`,
        ));

      // 상세 파싱 수
      const [recentDetails] = await db.select({
        count: sql<number>`COUNT(*)`,
      })
        .from(extProductDetails)
        .where(and(
          eq(extProductDetails.userId, ctx.user!.id),
          sql`${extProductDetails.capturedAt} >= DATE_SUB(NOW(), INTERVAL ${input.days} DAY)`,
        ));

      return {
        period: input.days,
        searches: N(recentSearches?.count),
        candidates: N(recentCandidates?.count),
        rankRecords: N(recentRanks?.count),
        productDetails: N(recentDetails?.count),
      };
    }),

  // CSV 데이터 내보내기 (서버사이드)
  exportData: protectedProcedure
    .input(z.object({
      type: z.enum(["snapshots", "candidates", "rankings"]),
      limit: z.number().int().min(1).max(500).default(100),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      if (input.type === "snapshots") {
        return db.select()
          .from(extSearchSnapshots)
          .where(eq(extSearchSnapshots.userId, ctx.user!.id))
          .orderBy(desc(extSearchSnapshots.createdAt))
          .limit(input.limit);
      }
      if (input.type === "candidates") {
        return db.select()
          .from(extCandidates)
          .where(eq(extCandidates.userId, ctx.user!.id))
          .orderBy(desc(extCandidates.createdAt))
          .limit(input.limit);
      }
      // rankings
      return db.select()
        .from(extRankTrackings)
        .where(eq(extRankTrackings.userId, ctx.user!.id))
        .orderBy(desc(extRankTrackings.capturedAt))
        .limit(input.limit);
    }),
});
