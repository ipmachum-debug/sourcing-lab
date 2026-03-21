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
import { getNaverKeywords, normalizeNaverKeyword, isNaverKeywordMatch } from "../../lib/naverAds";
import { estimateSearchVolume } from "../../lib/searchVolumeEstimator";

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

      const originalKeywords = input.keywords;

      // 현재 월 YYYY-MM (KST)
      const now = new Date();
      now.setHours(now.getHours() + 9);
      const yearMonth = now.toISOString().slice(0, 7);

      // ★ v8.6.0: 7일 캐시 — 최근 7일 내 수집된 데이터가 있으면 API 호출 스킵
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 19).replace("T", " ");

      const existing = await db.select({
        keyword: keywordSearchVolumeHistory.keyword,
        totalSearch: keywordSearchVolumeHistory.totalSearch,
        pcSearch: keywordSearchVolumeHistory.pcSearch,
        mobileSearch: keywordSearchVolumeHistory.mobileSearch,
        competitionIndex: keywordSearchVolumeHistory.competitionIndex,
        yearMonth: keywordSearchVolumeHistory.yearMonth,
        createdAt: keywordSearchVolumeHistory.createdAt,
      })
        .from(keywordSearchVolumeHistory)
        .where(and(
          eq(keywordSearchVolumeHistory.userId, ctx.user!.id),
          eq(keywordSearchVolumeHistory.source, "naver"),
          sql`${keywordSearchVolumeHistory.createdAt} >= ${sevenDaysAgoStr}`,
        ));

      const existingMap = new Map<string, typeof existing[0]>();
      for (const row of existing) {
        existingMap.set(normalizeNaverKeyword(row.keyword), row);
      }

      // 이미 수집된 키워드인지 확인 (7일 내 캐시)
      const mainKw = originalKeywords[0];
      const mainClean = normalizeNaverKeyword(mainKw || "");
      const cached = existingMap.get(mainClean);

      if (cached) {
        // 7일 내 데이터가 있으면 API 호출 없이 즉시 반환
        console.log(`[fetchSearchVolume] 캐시 히트(7d) — "${mainKw}" (totalSearch: ${cached.totalSearch})`);
        return {
          success: true,
          saved: 0,
          yearMonth: cached.yearMonth,
          totalResults: 1,
          naverNotFound: false,
          fromCache: true,
          directVolume: {
            keyword: mainKw,
            pcSearch: Number(cached.pcSearch ?? 0),
            mobileSearch: Number(cached.mobileSearch ?? 0),
            totalSearch: Number(cached.totalSearch ?? 0),
            competitionIndex: cached.competitionIndex || "낮음",
          },
        };
      }

      console.log(`[fetchSearchVolume] 캐시 미스(7d) — "${mainKw}" (정규화: "${mainClean}") 네이버 API 호출`);

      // ★ v8.6.3: 7일 캐시 미스 시, 기존 데이터 확보 (폴백용)
      // 인덱스 활용: 원본 키워드 → 공백제거 키워드 순으로 조회 (REPLACE 풀스캔 제거)
      let fallbackVolume: {
        keyword: string;
        pcSearch: number;
        mobileSearch: number;
        totalSearch: number;
        competitionIndex: string;
      } | null = null;
      try {
        // 1차: 원본 키워드로 정확 매칭 (인덱스 활용)
        let [oldRow] = await db.select({
          keyword: keywordSearchVolumeHistory.keyword,
          totalSearch: keywordSearchVolumeHistory.totalSearch,
          pcSearch: keywordSearchVolumeHistory.pcSearch,
          mobileSearch: keywordSearchVolumeHistory.mobileSearch,
          competitionIndex: keywordSearchVolumeHistory.competitionIndex,
        })
          .from(keywordSearchVolumeHistory)
          .where(and(
            eq(keywordSearchVolumeHistory.userId, ctx.user!.id),
            eq(keywordSearchVolumeHistory.source, "naver"),
            eq(keywordSearchVolumeHistory.keyword, mainKw),
          ))
          .orderBy(desc(keywordSearchVolumeHistory.createdAt))
          .limit(1);
        // 2차: 공백 제거 버전으로 재시도 (인덱스 활용)
        if (!oldRow || Number(oldRow.totalSearch ?? 0) === 0) {
          const cleaned = mainKw.replace(/\s+/g, "");
          if (cleaned !== mainKw) {
            [oldRow] = await db.select({
              keyword: keywordSearchVolumeHistory.keyword,
              totalSearch: keywordSearchVolumeHistory.totalSearch,
              pcSearch: keywordSearchVolumeHistory.pcSearch,
              mobileSearch: keywordSearchVolumeHistory.mobileSearch,
              competitionIndex: keywordSearchVolumeHistory.competitionIndex,
            })
              .from(keywordSearchVolumeHistory)
              .where(and(
                eq(keywordSearchVolumeHistory.userId, ctx.user!.id),
                eq(keywordSearchVolumeHistory.source, "naver"),
                eq(keywordSearchVolumeHistory.keyword, cleaned),
              ))
              .orderBy(desc(keywordSearchVolumeHistory.createdAt))
              .limit(1);
          }
        }
        if (oldRow && Number(oldRow.totalSearch ?? 0) > 0) {
          fallbackVolume = {
            keyword: mainKw,
            pcSearch: Number(oldRow.pcSearch ?? 0),
            mobileSearch: Number(oldRow.mobileSearch ?? 0),
            totalSearch: Number(oldRow.totalSearch ?? 0),
            competitionIndex: oldRow.competitionIndex || "낮음",
          };
          console.log(`[fetchSearchVolume] 기존 캐시 확보 — "${mainKw}" (totalSearch: ${fallbackVolume.totalSearch})`);
        }
      } catch (_) {}

      // 미수집 키워드만 네이버 API 호출
      let naverResults;
      try {
        naverResults = await getNaverKeywords(originalKeywords);
      } catch (err: any) {
        // ★ v8.6.1: 429 에러 → 기존 캐시가 있으면 그걸로 반환
        const errMsg = err?.message || "";
        if (errMsg.includes("429") || errMsg.includes("Too Many") || errMsg.includes("toomanyrequest")) {
          console.warn(`[fetchSearchVolume] 429 — "${mainKw}" ${fallbackVolume ? '기존 캐시 반환' : '스킵'}`);
          return {
            success: true,
            saved: 0,
            yearMonth,
            totalResults: fallbackVolume ? 1 : 0,
            naverNotFound: false,
            rateLimited: true,
            fromCache: !!fallbackVolume,
            directVolume: fallbackVolume,
          };
        }
        // 기타 에러도 기존 캐시가 있으면 반환
        if (fallbackVolume) {
          console.warn(`[fetchSearchVolume] API 오류 — "${mainKw}" 기존 캐시 반환:`, errMsg);
          return {
            success: true,
            saved: 0,
            yearMonth,
            totalResults: 1,
            naverNotFound: false,
            fromCache: true,
            directVolume: fallbackVolume,
          };
        }
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `네이버 API 오류: ${err.message}`,
        });
      }

      const naverNotFound = naverResults.length === 0;
      let saved = 0;

      const keywordLookup = new Map<string, string>();
      for (const kw of originalKeywords) {
        keywordLookup.set(normalizeNaverKeyword(kw), kw);
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

        // ★ v8.6.0: createdAt도 갱신 — 7일 캐시 TTL이 리셋되도록
        const upsertSet = { ...upsertValues, createdAt: sql`NOW()` };

        await db.insert(keywordSearchVolumeHistory).values({
          userId: ctx.user!.id,
          keyword: r.relKeyword,
          source: "naver",
          yearMonth,
          ...upsertValues,
        }).onDuplicateKeyUpdate({ set: upsertSet });
        saved++;

        const relClean = normalizeNaverKeyword(r.relKeyword);
        const originalKw = keywordLookup.get(relClean);
        if (originalKw && originalKw !== r.relKeyword) {
          await db.insert(keywordSearchVolumeHistory).values({
            userId: ctx.user!.id,
            keyword: originalKw,
            source: "naver",
            yearMonth,
            ...upsertValues,
          }).onDuplicateKeyUpdate({ set: upsertSet });
        }
      }

      return {
        success: true,
        saved,
        yearMonth,
        totalResults: naverResults.length,
        naverNotFound,
        directVolume: naverResults.length > 0 ? (() => {
          const inputClean = normalizeNaverKeyword(originalKeywords[0] || "");
          const matched = naverResults.find(r =>
            normalizeNaverKeyword(r.relKeyword) === inputClean,
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

      // ★ v8.6.2: 검색량 추정 — 3초 타임아웃 (DB 부하 시 스킵, 핵심 데이터 반환 우선)
      let searchVolumeEstimate = null;
      try {
        const estimatePromise = (async () => {
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

          return estimateSearchVolume({
            naverTotalSearch: volume ? Number(volume.totalSearch ?? 0) : 0,
            avgDailyReviewGrowth,
            avgMatchRate,
            dataDays: dailyStats.length,
            reliableDeltaCount: reliableDeltas.length,
            autoCompleteCount: 0,
          });
        })();

        // 3초 타임아웃 — 추정 데이터는 보조 정보이므로 느리면 스킵
        searchVolumeEstimate = await Promise.race([
          estimatePromise,
          new Promise<null>(r => setTimeout(() => r(null), 3000)),
        ]);
      } catch (e) {
        console.error("[getKeywordMarketData] 검색량 추정 실패:", e);
      }

      // ★ v8.5.8: 디버그 로그 — 확장 프로그램 검색량 표시 문제 추적
      console.log(`[getKeywordMarketData] "${input.keyword}" → vol=${volume ? Number(volume.totalSearch ?? 0) : 'null'}, snap=${!!snapshot}, est=${searchVolumeEstimate?.model || 'null'}`);

      return {
        snapshot: snapshot || null,
        searchVolume: volume || null,
        cpc: cpc || null,
        searchVolumeEstimate,
        _debug: {
          keyword: input.keyword,
          hasSnapshot: !!snapshot,
          hasVolume: !!volume,
          volumeTotal: volume ? Number(volume.totalSearch ?? 0) : null,
          hasCpc: !!cpc,
          estimateModel: searchVolumeEstimate?.model || null,
        },
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
