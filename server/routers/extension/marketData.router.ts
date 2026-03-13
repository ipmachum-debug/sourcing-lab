/**
 * Extension Sub-Router: 시장 데이터 (Market Data)
 *
 * 키워드별 셀러라이프 수준 시장 데이터:
 *   1. 네이버 검색량 월별 히스토리 (Naver Search Ads API)
 *   2. 쿠팡 애즈 CPC 데이터 (확장 프로그램 크롤링)
 *   3. 스냅샷 기반 시장 지표 집계 (배송, 가격, 리뷰 분포)
 */
import { z } from "zod";
import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import {
  keywordSearchVolumeHistory,
  keywordCpcCache,
  extSearchSnapshots,
} from "../../../drizzle/schema";
import { eq, and, desc, sql, asc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { N } from "./_helpers";
import { getNaverKeywords } from "../../lib/naverAds";

export const marketDataRouter = router({
  // ============================================================
  //  1. 네이버 검색량 수집 & 저장 (월별 히스토리 축적)
  // ============================================================
  fetchSearchVolume: protectedProcedure
    .input(z.object({
      keywords: z.array(z.string().min(1).max(255)).min(1).max(20),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      // 네이버 API 호출
      let naverResults;
      try {
        naverResults = await getNaverKeywords(input.keywords);
      } catch (err: any) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `네이버 API 오류: ${err.message}`,
        });
      }

      // 현재 월 YYYY-MM
      const now = new Date();
      now.setHours(now.getHours() + 9);
      const yearMonth = now.toISOString().slice(0, 7);

      let saved = 0;
      for (const r of naverResults) {
        const totalSearch = (r.monthlyPcQcCnt || 0) + (r.monthlyMobileQcCnt || 0);
        if (totalSearch === 0) continue;

        // UPSERT: 같은 user + keyword + source + yearMonth이면 업데이트
        await db.insert(keywordSearchVolumeHistory).values({
          userId: ctx.user!.id,
          keyword: r.relKeyword,
          source: "naver",
          yearMonth,
          pcSearch: r.monthlyPcQcCnt || 0,
          mobileSearch: r.monthlyMobileQcCnt || 0,
          totalSearch,
          competitionIndex: r.compIdx || "낮음",
          avgCpc: String(
            (r.monthlyAvgPcClkCnt || 0) + (r.monthlyAvgMobileClkCnt || 0)
          ),
        }).onDuplicateKeyUpdate({
          set: {
            pcSearch: r.monthlyPcQcCnt || 0,
            mobileSearch: r.monthlyMobileQcCnt || 0,
            totalSearch,
            competitionIndex: r.compIdx || "낮음",
            avgCpc: String(
              (r.monthlyAvgPcClkCnt || 0) + (r.monthlyAvgMobileClkCnt || 0)
            ),
          },
        });
        saved++;
      }

      return { success: true, saved, yearMonth, totalResults: naverResults.length };
    }),

  // ============================================================
  //  2. 검색량 히스토리 조회 (특정 키워드)
  // ============================================================
  getSearchVolumeHistory: protectedProcedure
    .input(z.object({
      keyword: z.string().min(1).max(255),
      months: z.number().int().min(1).max(24).default(12),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const rows = await db.select()
        .from(keywordSearchVolumeHistory)
        .where(and(
          eq(keywordSearchVolumeHistory.userId, ctx.user!.id),
          eq(keywordSearchVolumeHistory.keyword, input.keyword),
        ))
        .orderBy(desc(keywordSearchVolumeHistory.yearMonth))
        .limit(input.months);

      return rows.reverse(); // 오래된 순으로 반환 (차트용)
    }),

  // ============================================================
  //  3. 쿠팡 애즈 CPC 데이터 저장 (확장 프로그램에서 크롤링)
  // ============================================================
  saveCpcData: protectedProcedure
    .input(z.object({
      keyword: z.string().min(1).max(255),
      categoryId: z.string().max(50).optional(),
      categoryName: z.string().max(255).optional(),
      suggestedBid: z.number().int().default(0),
      minBid: z.number().int().default(0),
      maxBid: z.number().int().default(0),
      estimatedImpressions: z.number().int().default(0),
      estimatedClicks: z.number().int().default(0),
      estimatedCtr: z.number().default(0),
      competitionLevel: z.string().max(20).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      // 만료일: 7일 후 (CPC 데이터는 자주 변동)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      expiresAt.setHours(expiresAt.getHours() + 9);
      const expiresStr = expiresAt.toISOString().slice(0, 19).replace("T", " ");

      await db.insert(keywordCpcCache).values({
        userId: ctx.user!.id,
        keyword: input.keyword,
        categoryId: input.categoryId || null,
        categoryName: input.categoryName || null,
        suggestedBid: input.suggestedBid,
        minBid: input.minBid,
        maxBid: input.maxBid,
        estimatedImpressions: input.estimatedImpressions,
        estimatedClicks: input.estimatedClicks,
        estimatedCtr: String(input.estimatedCtr),
        competitionLevel: input.competitionLevel || null,
        expiresAt: expiresStr,
      });

      return { success: true };
    }),

  // ============================================================
  //  4. CPC 데이터 조회 (키워드별 최신)
  // ============================================================
  getCpcData: protectedProcedure
    .input(z.object({
      keyword: z.string().min(1).max(255),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [row] = await db.select()
        .from(keywordCpcCache)
        .where(and(
          eq(keywordCpcCache.userId, ctx.user!.id),
          eq(keywordCpcCache.keyword, input.keyword),
          sql`${keywordCpcCache.expiresAt} > NOW()`,
        ))
        .orderBy(desc(keywordCpcCache.collectedAt))
        .limit(1);

      return row || null;
    }),

  // ============================================================
  //  5. 키워드별 종합 시장 데이터 조회 (스냅샷 기반)
  // ============================================================
  getKeywordMarketData: protectedProcedure
    .input(z.object({
      keyword: z.string().min(1).max(255),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 최신 스냅샷에서 시장 데이터 추출
      const [snapshot] = await db.select({
        totalProductCount: extSearchSnapshots.totalProductCount,
        totalItems: extSearchSnapshots.totalItems,
        avgPrice: extSearchSnapshots.avgPrice,
        minPrice: extSearchSnapshots.minPrice,
        maxPrice: extSearchSnapshots.maxPrice,
        medianPrice: extSearchSnapshots.medianPrice,
        avgRating: extSearchSnapshots.avgRating,
        avgReview: extSearchSnapshots.avgReview,
        totalReviewSum: extSearchSnapshots.totalReviewSum,
        maxReviewCount: extSearchSnapshots.maxReviewCount,
        minReviewCount: extSearchSnapshots.minReviewCount,
        rocketCount: extSearchSnapshots.rocketCount,
        sellerRocketCount: extSearchSnapshots.sellerRocketCount,
        globalRocketCount: extSearchSnapshots.globalRocketCount,
        normalDeliveryCount: extSearchSnapshots.normalDeliveryCount,
        overseasDeliveryCount: extSearchSnapshots.overseasDeliveryCount,
        priceDistribution: extSearchSnapshots.priceDistributionJson,
        reviewDistribution: extSearchSnapshots.reviewDistributionJson,
        highReviewCount: extSearchSnapshots.highReviewCount,
        adCount: extSearchSnapshots.adCount,
        competitionScore: extSearchSnapshots.competitionScore,
        competitionLevel: extSearchSnapshots.competitionLevel,
        createdAt: extSearchSnapshots.createdAt,
      })
        .from(extSearchSnapshots)
        .where(and(
          eq(extSearchSnapshots.userId, ctx.user!.id),
          eq(extSearchSnapshots.query, input.keyword),
        ))
        .orderBy(desc(extSearchSnapshots.createdAt))
        .limit(1);

      // 검색량 최신 데이터
      const [volume] = await db.select()
        .from(keywordSearchVolumeHistory)
        .where(and(
          eq(keywordSearchVolumeHistory.userId, ctx.user!.id),
          eq(keywordSearchVolumeHistory.keyword, input.keyword),
          eq(keywordSearchVolumeHistory.source, "naver"),
        ))
        .orderBy(desc(keywordSearchVolumeHistory.yearMonth))
        .limit(1);

      // CPC 최신 데이터 (만료되지 않은)
      const [cpc] = await db.select()
        .from(keywordCpcCache)
        .where(and(
          eq(keywordCpcCache.userId, ctx.user!.id),
          eq(keywordCpcCache.keyword, input.keyword),
          sql`${keywordCpcCache.expiresAt} > NOW()`,
        ))
        .orderBy(desc(keywordCpcCache.collectedAt))
        .limit(1);

      return {
        snapshot: snapshot || null,
        searchVolume: volume || null,
        cpc: cpc || null,
      };
    }),

  // ============================================================
  //  6. 다수 키워드 시장 데이터 일괄 조회 (목록 페이지용)
  // ============================================================
  getKeywordsMarketSummary: protectedProcedure
    .input(z.object({
      keywords: z.array(z.string().min(1).max(255)).min(1).max(50),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const results: Record<string, any> = {};

      for (const keyword of input.keywords) {
        // 최신 스냅샷
        const [snap] = await db.select({
          totalProductCount: extSearchSnapshots.totalProductCount,
          avgPrice: extSearchSnapshots.avgPrice,
          medianPrice: extSearchSnapshots.medianPrice,
          avgReview: extSearchSnapshots.avgReview,
          rocketCount: extSearchSnapshots.rocketCount,
          competitionScore: extSearchSnapshots.competitionScore,
          competitionLevel: extSearchSnapshots.competitionLevel,
        })
          .from(extSearchSnapshots)
          .where(and(
            eq(extSearchSnapshots.userId, ctx.user!.id),
            eq(extSearchSnapshots.query, keyword),
          ))
          .orderBy(desc(extSearchSnapshots.createdAt))
          .limit(1);

        // 검색량
        const [vol] = await db.select({
          totalSearch: keywordSearchVolumeHistory.totalSearch,
          competitionIndex: keywordSearchVolumeHistory.competitionIndex,
          yearMonth: keywordSearchVolumeHistory.yearMonth,
        })
          .from(keywordSearchVolumeHistory)
          .where(and(
            eq(keywordSearchVolumeHistory.userId, ctx.user!.id),
            eq(keywordSearchVolumeHistory.keyword, keyword),
          ))
          .orderBy(desc(keywordSearchVolumeHistory.yearMonth))
          .limit(1);

        // CPC
        const [cpc] = await db.select({
          suggestedBid: keywordCpcCache.suggestedBid,
          competitionLevel: keywordCpcCache.competitionLevel,
        })
          .from(keywordCpcCache)
          .where(and(
            eq(keywordCpcCache.userId, ctx.user!.id),
            eq(keywordCpcCache.keyword, keyword),
            sql`${keywordCpcCache.expiresAt} > NOW()`,
          ))
          .orderBy(desc(keywordCpcCache.collectedAt))
          .limit(1);

        results[keyword] = {
          snapshot: snap || null,
          searchVolume: vol || null,
          cpc: cpc || null,
        };
      }

      return results;
    }),
});
