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
  extKeywordDailyStats,
} from "../../../drizzle/schema";
import { eq, and, desc, sql, asc, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { N } from "./_helpers";
import { getNaverKeywords } from "../../lib/naverAds";
import { estimateSearchVolume } from "../../lib/searchVolumeEstimator";

export const marketDataRouter = router({
  // ============================================================
  //  1. 네이버 검색량 수집 & 저장 (월별 히스토리 축적)
  // ============================================================
  fetchSearchVolume: protectedProcedure
    .input(z.object({
      keywords: z.array(z.string().min(1).max(255)).min(1).max(20),
      forceRefresh: z.boolean().optional().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      // ★ v8.5.5: 원본 키워드 보존 (공백 포함 가능)
      const originalKeywords = input.keywords;

      // ★ v8.5.5: 7일 캐시 — 최근 7일 이내 수집된 데이터가 있으면 API 호출 스킵
      const CACHE_DAYS = 7;
      const cacheCutoff = new Date();
      cacheCutoff.setHours(cacheCutoff.getHours() + 9); // KST
      cacheCutoff.setDate(cacheCutoff.getDate() - CACHE_DAYS);
      const cacheCutoffStr = cacheCutoff.toISOString().slice(0, 19).replace("T", " ");

      if (!input.forceRefresh && originalKeywords.length === 1) {
        const kw = originalKeywords[0];
        const kwClean = kw.replace(/\s+/g, "");

        // DB에서 7일 이내 데이터 조회
        const [cached] = await db.select()
          .from(keywordSearchVolumeHistory)
          .where(and(
            eq(keywordSearchVolumeHistory.userId, ctx.user!.id),
            sql`${keywordSearchVolumeHistory.keyword} IN (${kw}, ${kwClean})`,
            eq(keywordSearchVolumeHistory.source, "naver"),
            gte(keywordSearchVolumeHistory.createdAt, cacheCutoffStr),
          ))
          .orderBy(desc(keywordSearchVolumeHistory.createdAt))
          .limit(1);

        if (cached) {
          return {
            success: true,
            saved: 0,
            yearMonth: cached.yearMonth,
            totalResults: 1,
            naverNotFound: false,
            cached: true,
            directVolume: {
              keyword: kw,
              pcSearch: Number(cached.pcSearch ?? 0),
              mobileSearch: Number(cached.mobileSearch ?? 0),
              totalSearch: Number(cached.totalSearch ?? 0),
              competitionIndex: cached.competitionIndex || "낮음",
            },
          };
        }
      }

      // 네이버 API 호출 (naverAds.ts에서 공백 자동 제거 + 400 에러 처리)
      let naverResults;
      try {
        naverResults = await getNaverKeywords(originalKeywords);
      } catch (err: any) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `네이버 API 오류: ${err.message}`,
        });
      }

      // ★ v8.4.4: 네이버 API가 빈 결과를 반환해도 에러가 아님 (키워드 미등록)
      // naverNotFound 플래그로 확장 프로그램에 알림
      const naverNotFound = naverResults.length === 0;

      // 현재 월 YYYY-MM
      const now = new Date();
      now.setHours(now.getHours() + 9);
      const yearMonth = now.toISOString().slice(0, 7);

      let saved = 0;

      // ★ v8.4.4: 원본 키워드에 해당하는 결과를 정확히 매칭하기 위한 맵
      // 원본 키워드(공백 제거 후 소문자) → 원본 키워드 (DB 저장 시 원본 키워드로 저장)
      const keywordLookup = new Map<string, string>();
      for (const kw of originalKeywords) {
        keywordLookup.set(kw.replace(/\s+/g, "").toLowerCase(), kw);
      }

      for (const r of naverResults) {
        const totalSearch = (r.monthlyPcQcCnt || 0) + (r.monthlyMobileQcCnt || 0);
        if (totalSearch === 0) continue;

        const upsertValues = {
          pcSearch: r.monthlyPcQcCnt || 0,
          mobileSearch: r.monthlyMobileQcCnt || 0,
          totalSearch,
          competitionIndex: r.compIdx || "낮음",
          avgCpc: String(
            (r.monthlyAvgPcClkCnt || 0) + (r.monthlyAvgMobileClkCnt || 0)
          ),
        };

        // UPSERT: relKeyword로 저장 (네이버 반환 키워드)
        await db.insert(keywordSearchVolumeHistory).values({
          userId: ctx.user!.id,
          keyword: r.relKeyword,
          source: "naver",
          yearMonth,
          ...upsertValues,
        }).onDuplicateKeyUpdate({ set: upsertValues });
        saved++;

        // ★ v8.4.4: 원본 키워드에 공백이 있었다면 원본 키워드로도 저장
        // (예: "현금 파우치" → DB에 "현금 파우치"로도 저장, 네이버 반환은 "현금파우치")
        const relClean = r.relKeyword.replace(/\s+/g, "").toLowerCase();
        const originalKw = keywordLookup.get(relClean);
        if (originalKw && originalKw !== r.relKeyword) {
          await db.insert(keywordSearchVolumeHistory).values({
            userId: ctx.user!.id,
            keyword: originalKw,
            source: "naver",
            yearMonth,
            ...upsertValues,
          }).onDuplicateKeyUpdate({ set: upsertValues });
        }
      }

      return {
        success: true,
        saved,
        yearMonth,
        totalResults: naverResults.length,
        naverNotFound,
        cached: false,
        // ★ v8.4.4: 원본 키워드의 검색량을 직접 전달 (DB timing 이슈 우회)
        directVolume: naverResults.length > 0 ? (() => {
          const inputClean = originalKeywords[0]?.replace(/\s+/g, "").toLowerCase();
          const matched = naverResults.find(r =>
            r.relKeyword.replace(/\s+/g, "").toLowerCase() === inputClean,
          );
          if (matched) {
            return {
              keyword: originalKeywords[0],
              pcSearch: matched.monthlyPcQcCnt || 0,
              mobileSearch: matched.monthlyMobileQcCnt || 0,
              totalSearch: (matched.monthlyPcQcCnt || 0) + (matched.monthlyMobileQcCnt || 0),
              competitionIndex: matched.compIdx || "낮음",
            };
          }
          return null;
        })() : null,
      };
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
      let [volume] = await db.select()
        .from(keywordSearchVolumeHistory)
        .where(and(
          eq(keywordSearchVolumeHistory.userId, ctx.user!.id),
          eq(keywordSearchVolumeHistory.keyword, input.keyword),
          eq(keywordSearchVolumeHistory.source, "naver"),
        ))
        .orderBy(desc(keywordSearchVolumeHistory.yearMonth))
        .limit(1);

      // ★ v8.4.4: 원본 키워드로 못 찾으면 공백 제거 버전으로 재시도
      if (!volume) {
        const cleaned = input.keyword.replace(/\s+/g, "");
        if (cleaned !== input.keyword) {
          [volume] = await db.select()
            .from(keywordSearchVolumeHistory)
            .where(and(
              eq(keywordSearchVolumeHistory.userId, ctx.user!.id),
              eq(keywordSearchVolumeHistory.keyword, cleaned),
              eq(keywordSearchVolumeHistory.source, "naver"),
            ))
            .orderBy(desc(keywordSearchVolumeHistory.yearMonth))
            .limit(1);
        }
      }

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

      // ★ v8.4: 검색량 추정 (자동 전환 Simple → Hybrid)
      let searchVolumeEstimate = null;
      try {
        // 최근 90일 일별 통계에서 리뷰 delta 데이터 수집
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        const dateStr = ninetyDaysAgo.toISOString().slice(0, 10);

        const dailyStats = await db
          .select({
            statDate: extKeywordDailyStats.statDate,
            reviewDeltaUsed: extKeywordDailyStats.reviewDeltaUsed,
            coverageRatio: extKeywordDailyStats.coverageRatio,
            dataStatus: extKeywordDailyStats.dataStatus,
            isProvisional: extKeywordDailyStats.isProvisional,
          })
          .from(extKeywordDailyStats)
          .where(
            and(
              eq(extKeywordDailyStats.userId, ctx.user!.id),
              eq(extKeywordDailyStats.query, input.keyword),
              gte(extKeywordDailyStats.statDate, dateStr),
            ),
          )
          .orderBy(asc(extKeywordDailyStats.statDate));

        // 신뢰 delta 필터링 (raw_valid 데이터만)
        const reliableDeltas = dailyStats.filter(
          d =>
            d.dataStatus === "raw_valid" &&
            !d.isProvisional &&
            Number(d.reviewDeltaUsed ?? 0) >= 0,
        );

        const avgMatchRate =
          reliableDeltas.length > 0
            ? reliableDeltas.reduce((s, d) => s + Number(d.coverageRatio ?? 0), 0) /
              reliableDeltas.length
            : 0;

        const avgDailyReviewGrowth =
          reliableDeltas.length > 0
            ? reliableDeltas.reduce((s, d) => s + Number(d.reviewDeltaUsed ?? 0), 0) /
              reliableDeltas.length
            : 0;

        searchVolumeEstimate = estimateSearchVolume({
          naverTotalSearch: volume ? Number(volume.totalSearch ?? 0) : 0,
          avgDailyReviewGrowth,
          avgMatchRate,
          dataDays: dailyStats.length,
          reliableDeltaCount: reliableDeltas.length,
          autoCompleteCount: 0, // Phase 2: 자동완성 크롤링 추가 시 연결
        });
      } catch (e) {
        console.error("[getKeywordMarketData] 검색량 추정 실패:", e);
      }

      return {
        snapshot: snapshot || null,
        searchVolume: volume || null,
        cpc: cpc || null,
        searchVolumeEstimate,
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
