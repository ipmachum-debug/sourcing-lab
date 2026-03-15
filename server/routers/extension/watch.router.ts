/**
 * Extension Sub-Router: 감시 키워드 & 배치 수집 (Watch Keywords & Batch Collection)
 */
import { z } from "zod";
import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import {
  extSearchEvents, extWatchKeywords,
  extSearchSnapshots, extKeywordDailyStats, extBatchState,
} from "../../../drizzle/schema";
import { eq, and, desc, sql, like, asc, gte, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { N } from "./_helpers";
import {
  selectBatchKeywords, runDailyBatch,
  recomputeCompositeScore, diagnoseParsingQuality,
  normalizeKeyword, detectDuplicateKeywords,
  syncWatchKeywordsToMaster, advanceBatchState,
} from "../../batchCollector";
import { autoComputeKeywordDailyStat, autoMatchTrackedProducts } from "./_autoHelpers";

export const watchRouter = router({
  saveSearchEvent: protectedProcedure
    .input(z.object({
      keyword: z.string().min(1).max(255),
      source: z.string().max(100).default("user_search"),
      pageUrl: z.string().optional(),
      totalItems: z.number().int().default(0),
      items: z.array(z.any()).optional(),
      avgPrice: z.number().int().default(0),
      avgRating: z.number().default(0),
      avgReview: z.number().int().default(0),
      totalReviewSum: z.number().int().default(0),
      adCount: z.number().int().default(0),
      rocketCount: z.number().int().default(0),
      highReviewCount: z.number().int().default(0),
      priceParseRate: z.number().int().default(0),
      ratingParseRate: z.number().int().default(0),
      reviewParseRate: z.number().int().default(0),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      const userId = ctx.user!.id;
      const itemsJson = input.items ? JSON.stringify(input.items.slice(0, 36)) : null;

      // ★ v8.2.1: totalReviewSum이 0이면 items에서 자동 계산
      let computedReviewSum = input.totalReviewSum;
      if (computedReviewSum === 0 && input.items && input.items.length > 0) {
        computedReviewSum = input.items.reduce(
          (sum: number, i: any) => sum + (i.reviewCount || 0), 0,
        );
      }

      // 1. 검색 이벤트 저장
      const [result] = await db.insert(extSearchEvents).values({
        userId,
        keyword: input.keyword,
        source: input.source,
        pageUrl: input.pageUrl || null,
        totalItems: input.totalItems,
        itemsJson,
        avgPrice: input.avgPrice,
        avgRating: input.avgRating.toFixed(1),
        avgReview: input.avgReview,
        totalReviewSum: computedReviewSum,
        adCount: input.adCount,
        rocketCount: input.rocketCount,
        highReviewCount: input.highReviewCount,
        priceParseRate: input.priceParseRate,
        ratingParseRate: input.ratingParseRate,
        reviewParseRate: input.reviewParseRate,
      });

      // 2. watch_keyword 자동 등록/업데이트 (upsert)
      const [existing] = await db.select({ id: extWatchKeywords.id, totalSearchCount: extWatchKeywords.totalSearchCount })
        .from(extWatchKeywords)
        .where(and(
          eq(extWatchKeywords.userId, userId),
          eq(extWatchKeywords.keyword, input.keyword),
        ))
        .limit(1);

      const now = new Date();
      now.setHours(now.getHours() + 9);
      const nowStr = now.toISOString().slice(0, 19).replace('T', ' ');

      if (existing) {
        await db.update(extWatchKeywords).set({
          totalSearchCount: N(existing.totalSearchCount) + 1,
          lastSearchedAt: nowStr,
          lastUserViewAt: nowStr,
          latestTotalItems: input.totalItems,
          latestAvgPrice: input.avgPrice,
          latestAvgRating: input.avgRating.toFixed(1),
          latestAvgReview: input.avgReview,
          latestTotalReviewSum: input.totalReviewSum,
          latestAdCount: input.adCount,
          latestRocketCount: input.rocketCount,
          isActive: true,
        }).where(eq(extWatchKeywords.id, existing.id));

        recomputeCompositeScore(userId, existing.id).catch(() => {});
      } else {
        // 신규 키워드: 24시간 후 첫 적응형 수집 스케줄링
        const nextCollect = new Date(now.getTime() + 24 * 3600 * 1000);
        const nextCollectStr = nextCollect.toISOString().slice(0, 19).replace("T", " ");
        await db.insert(extWatchKeywords).values({
          userId,
          keyword: input.keyword,
          priority: 50,
          isActive: true,
          collectIntervalHours: 24,
          totalSearchCount: 1,
          lastSearchedAt: nowStr,
          lastUserViewAt: nowStr,
          latestTotalItems: input.totalItems,
          latestAvgPrice: input.avgPrice,
          latestAvgRating: input.avgRating.toFixed(1),
          latestAvgReview: input.avgReview,
          latestTotalReviewSum: input.totalReviewSum,
          latestAdCount: input.adCount,
          latestRocketCount: input.rocketCount,
          nextCollectAt: nextCollectStr,
          adaptiveIntervalHours: 24,
          volatilityScore: 0,
          groupNo: Math.floor(Math.random() * 5),
        });
      }

      // 3. [DEPRECATED] ext_keyword_daily_status 쓰기 제거 (2026-03-15)
      // 구 sum-diff 방식의 ext_keyword_daily_status에 393배 오차 데이터가 쌓이던 문제 해결.
      // 정확한 per-product delta 엔진(ext_keyword_daily_stats)은 아래 step 4~5에서 처리됨.
      // batchCollector.ts의 ext_keyword_daily_status 사용은 별도 마이그레이션 예정.
      const todayStr = now.toISOString().slice(0, 10);

      // 4. ★ 스냅샷 테이블 자동 동기화 (ext_keyword_daily_stats의 데이터 소스)
      // → 반드시 daily_stats 계산보다 먼저 실행해야 함
      if (input.items && input.items.length > 0) {
        try {
          const highReviewCount = input.items.filter((i: any) => (Number(i.reviewCount) || 0) >= 100).length;
          const highReviewRatio = input.items.length ? Math.round((highReviewCount / input.items.length) * 100) : 0;

          // 경쟁도 간이 계산
          const avgReviewVal = input.avgReview || 0;
          const adRatio = input.items.length ? Math.round((input.adCount / input.items.length) * 100) : 0;
          let compScore = 0;
          if (avgReviewVal > 1000) compScore += 40; else if (avgReviewVal > 500) compScore += 30; else if (avgReviewVal > 100) compScore += 20; else if (avgReviewVal > 30) compScore += 10;
          if (highReviewRatio > 60) compScore += 25; else if (highReviewRatio > 30) compScore += 15; else if (highReviewRatio > 10) compScore += 5;
          if (input.avgRating >= 4.5) compScore += 15; else if (input.avgRating >= 4.0) compScore += 10;
          if (adRatio > 30) compScore += 20; else if (adRatio > 15) compScore += 10;
          const compLevel = compScore >= 70 ? "hard" : compScore >= 45 ? "medium" : "easy";

          // ★ v7.5.0: 스냅샷을 덮어쓰지 않고 하루 최대 3개 보존
          // 기존에는 같은 날 재크롤링 시 덮어써서 원본 데이터 소실됨
          const todaySnaps = await db.select({ id: extSearchSnapshots.id })
            .from(extSearchSnapshots)
            .where(and(
              eq(extSearchSnapshots.userId, userId),
              eq(extSearchSnapshots.query, input.keyword),
              sql`DATE(${extSearchSnapshots.createdAt}) = ${todayStr}`,
            ))
            .orderBy(desc(extSearchSnapshots.createdAt));

          const snapData = {
            query: input.keyword,
            totalItems: input.totalItems,
            avgPrice: Math.min(input.avgPrice, 100000000),
            avgRating: input.avgRating.toFixed(1),
            avgReview: Math.min(input.avgReview, 2000000000),
            highReviewRatio,
            adCount: input.adCount,
            competitionScore: compScore,
            competitionLevel: compLevel as "easy" | "medium" | "hard",
            itemsJson: itemsJson,
          };

          if (todaySnaps.length >= 3) {
            // 하루 3개 초과 시 가장 오래된 것 업데이트
            await db.update(extSearchSnapshots).set(snapData)
              .where(eq(extSearchSnapshots.id, todaySnaps[todaySnaps.length - 1].id));
          } else {
            // 3개 미만이면 새로 추가 (원본 보존)
            await db.insert(extSearchSnapshots).values({ userId, ...snapData });
          }
          console.log(`[saveSearchEvent] snapshot synced: "${input.keyword}" (${input.items.length}개, comp:${compScore}/${compLevel})`);
        } catch (snapErr) {
          console.error("[saveSearchEvent] snapshot sync error:", snapErr);
        }
      }

      // 5. ★★★ 핵심: ext_keyword_daily_stats 테이블 자동 업데이트 (웹 대시보드에서 읽는 테이블)
      // 스냅샷이 저장된 후 실행되므로 최신 데이터를 반영할 수 있음
      // 이전에는 수동 "통계 계산" 버튼을 눌러야만 업데이트되었음 → 이제 자동
      autoComputeKeywordDailyStat(userId, input.keyword, db).catch((err) => {
        console.error("[saveSearchEvent] daily stats (dashboard) error:", err);
      });

      return { success: true, eventId: result.insertId };
    }),

  // ===== 감시 키워드 목록 조회 =====
  // v7.3.2: keywordScore 정렬 추가, daily_stats 기반 점수 포함
  listWatchKeywords: protectedProcedure
    .input(z.object({
      activeOnly: z.boolean().default(true),
      sortBy: z.enum(["priority", "lastSearched", "reviewGrowth", "compositeScore", "keywordScore"]).default("compositeScore"),
      limit: z.number().int().min(1).max(2000).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const conditions: any[] = [eq(extWatchKeywords.userId, ctx.user!.id)];
      if (input.activeOnly) conditions.push(eq(extWatchKeywords.isActive, true));

      const orderMap: any = {
        priority: desc(extWatchKeywords.priority),
        lastSearched: desc(extWatchKeywords.lastSearchedAt),
        reviewGrowth: desc(extWatchKeywords.reviewGrowth7d),
        compositeScore: desc(extWatchKeywords.compositeScore),
        keywordScore: desc(extWatchKeywords.compositeScore),
      };

      const rows = await db.select()
        .from(extWatchKeywords)
        .where(and(...conditions))
        .orderBy(orderMap[input.sortBy])
        .limit(input.limit)
        .offset(input.offset);

      // v7.3.2: daily_stats에서 keywordScore, demandScore 가져오기
      const dailyStatsMap = new Map<string, { keywordScore: number; demandScore: number; reviewGrowth: number; salesEstimate: number; competitionScore: number }>();
      const dailyRows = await db.select({
        query: extKeywordDailyStats.query,
        keywordScore: extKeywordDailyStats.keywordScore,
        demandScore: extKeywordDailyStats.demandScore,
        reviewGrowth: extKeywordDailyStats.reviewGrowth,
        salesEstimate: extKeywordDailyStats.salesEstimate,
        competitionScore: extKeywordDailyStats.competitionScore,
      })
        .from(extKeywordDailyStats)
        .where(and(
          eq(extKeywordDailyStats.userId, ctx.user!.id),
          sql`(${extKeywordDailyStats.query}, ${extKeywordDailyStats.statDate}) IN (
            SELECT \`query\`, MAX(stat_date) FROM ext_keyword_daily_stats
            WHERE user_id = ${ctx.user!.id}
            GROUP BY \`query\`
          )`,
        ));
      for (const dr of dailyRows) {
        dailyStatsMap.set(dr.query, {
          keywordScore: N(dr.keywordScore),
          demandScore: N(dr.demandScore),
          reviewGrowth: N(dr.reviewGrowth),
          salesEstimate: N(dr.salesEstimate),
          competitionScore: N(dr.competitionScore),
        });
      }

      const result = rows.map(r => {
        const ds = dailyStatsMap.get(r.keyword);
        return {
          id: r.id,
          keyword: r.keyword,
          priority: N(r.priority),
          isActive: r.isActive,
          collectIntervalHours: N(r.collectIntervalHours),
          totalSearchCount: N(r.totalSearchCount),
          lastSearchedAt: r.lastSearchedAt,
          lastCollectedAt: r.lastCollectedAt,
          latestTotalItems: N(r.latestTotalItems),
          latestAvgPrice: N(r.latestAvgPrice),
          latestAvgRating: N(r.latestAvgRating),
          latestAvgReview: N(r.latestAvgReview),
          latestTotalReviewSum: N(r.latestTotalReviewSum),
          reviewGrowth1d: N(r.reviewGrowth1d),
          reviewGrowth7d: N(r.reviewGrowth7d),
          priceChange1d: N(r.priceChange1d),
          // ★ v8.4.5: compositeScore를 daily_stats의 keywordScore로 동기화
          compositeScore: ds?.keywordScore || N(r.compositeScore),
          isPinned: !!r.isPinned,
          pinOrder: N(r.pinOrder),
          keywordScore: ds?.keywordScore || N(r.compositeScore),
          demandScore: ds?.demandScore || 0,
          dailyReviewGrowth: ds?.reviewGrowth || 0,
          dailySalesEstimate: ds?.salesEstimate || 0,
          dailyCompetitionScore: ds?.competitionScore || 0,
          createdAt: r.createdAt,
        };
      });

      // ★ v8.4.5: compositeScore/keywordScore 정렬 시 daily_stats 기반 재정렬
      if (input.sortBy === "keywordScore" || input.sortBy === "compositeScore") {
        result.sort((a, b) => b.keywordScore - a.keywordScore);
      }

      return result;
    }),

  // ===== 감시 키워드 우선순위/설정 변경 =====
  updateWatchKeyword: protectedProcedure
    .input(z.object({
      id: z.number().int(),
      priority: z.number().int().min(0).max(100).optional(),
      isActive: z.boolean().optional(),
      collectIntervalHours: z.number().int().min(1).max(168).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const update: any = {};
      if (input.priority !== undefined) update.priority = input.priority;
      if (input.isActive !== undefined) update.isActive = input.isActive;
      if (input.collectIntervalHours !== undefined) update.collectIntervalHours = input.collectIntervalHours;

      await db.update(extWatchKeywords).set(update)
        .where(and(eq(extWatchKeywords.id, input.id), eq(extWatchKeywords.userId, ctx.user!.id)));

      return { success: true };
    }),

  // ===== 감시 키워드 삭제 =====
  deleteWatchKeyword: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.delete(extWatchKeywords)
        .where(and(eq(extWatchKeywords.id, input.id), eq(extWatchKeywords.userId, ctx.user!.id)));

      return { success: true };
    }),

  // ===== 키워드 일별 상태 이력 조회 (ext_keyword_daily_stats 기반, 2026-03-15 전환) =====
  getKeywordDailyStatusHistory: protectedProcedure
    .input(z.object({
      keyword: z.string().min(1),
      days: z.number().int().min(1).max(90).default(30),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const now = new Date();
      now.setHours(now.getHours() + 9);
      const startDate = new Date(now.getTime() - input.days * 24 * 60 * 60 * 1000);
      const startDateStr = startDate.toISOString().slice(0, 10);

      // ★ ext_keyword_daily_stats (per-product delta, 정확) 기반으로 전환
      const rows = await db.select()
        .from(extKeywordDailyStats)
        .where(and(
          eq(extKeywordDailyStats.userId, ctx.user!.id),
          eq(extKeywordDailyStats.query, input.keyword),
          gte(extKeywordDailyStats.statDate, startDateStr),
        ))
        .orderBy(asc(extKeywordDailyStats.statDate));

      return rows.map(r => ({
        statDate: r.statDate,
        totalItems: N(r.productCount),
        avgPrice: N(r.avgPrice),
        minPrice: 0,
        maxPrice: 0,
        avgRating: N(r.avgRating),
        avgReview: N(r.avgReview),
        totalReviewSum: N(r.totalReviewSum),
        reviewGrowth: N(r.reviewGrowth),
        priceChange: N(r.priceChange),
        estimatedDailySales: N(r.salesEstimate),
        salesScore: 0,
        demandScore: N(r.demandScore),
        competitionScore: N(r.competitionScore),
        competitionLevel: r.competitionLevel,
        dataQualityScore: 0,
        adCount: N(r.adCount),
        rocketCount: N(r.rocketCount),
        source: "daily_stats",
      }));
    }),

  // ===== 일일 배치 실행 (서버 트리거) =====
  runDailyBatchCollection: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
      keywords: z.array(z.string()).optional(),
    }).optional())
    .mutation(async ({ ctx, input }) => {
      const opts = input || {};
      const result = await runDailyBatch(ctx.user!.id, opts.limit, opts.offset, opts.keywords);
      // 배치 완료 후 니치파인더 데이터 동기화
      await syncWatchKeywordsToMaster(ctx.user!.id).catch(err =>
        console.error("[runDailyBatchCollection] 니치파인더 동기화 오류:", err.message)
      );
      return result;
    }),

  // ===== 배치 수집 대상 키워드 조회 =====
  getBatchKeywordSelection: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(100),
    }))
    .query(async ({ ctx, input }) => {
      return await selectBatchKeywords(ctx.user!.id, input.limit);
    }),

  // ===== 검색 이벤트 히스토리 =====
  listSearchEvents: protectedProcedure
    .input(z.object({
      keyword: z.string().optional(),
      days: z.number().int().min(1).max(90).default(7),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const now = new Date();
      now.setHours(now.getHours() + 9);
      const startDate = new Date(now.getTime() - input.days * 24 * 60 * 60 * 1000);
      const startDateStr = startDate.toISOString().slice(0, 19).replace('T', ' ');

      const conditions: any[] = [
        eq(extSearchEvents.userId, ctx.user!.id),
        gte(extSearchEvents.searchedAt, startDateStr),
      ];
      if (input.keyword) conditions.push(eq(extSearchEvents.keyword, input.keyword));

      const rows = await db.select({
        id: extSearchEvents.id,
        keyword: extSearchEvents.keyword,
        searchedAt: extSearchEvents.searchedAt,
        source: extSearchEvents.source,
        totalItems: extSearchEvents.totalItems,
        avgPrice: extSearchEvents.avgPrice,
        avgRating: extSearchEvents.avgRating,
        avgReview: extSearchEvents.avgReview,
        totalReviewSum: extSearchEvents.totalReviewSum,
        adCount: extSearchEvents.adCount,
        rocketCount: extSearchEvents.rocketCount,
        priceParseRate: extSearchEvents.priceParseRate,
        ratingParseRate: extSearchEvents.ratingParseRate,
        reviewParseRate: extSearchEvents.reviewParseRate,
      })
        .from(extSearchEvents)
        .where(and(...conditions))
        .orderBy(desc(extSearchEvents.searchedAt))
        .limit(input.limit);

      return rows.map(r => ({
        id: r.id,
        keyword: r.keyword,
        searchedAt: r.searchedAt,
        source: r.source,
        totalItems: N(r.totalItems),
        avgPrice: N(r.avgPrice),
        avgRating: N(r.avgRating),
        avgReview: N(r.avgReview),
        totalReviewSum: N(r.totalReviewSum),
        adCount: N(r.adCount),
        rocketCount: N(r.rocketCount),
        priceParseRate: N(r.priceParseRate),
        ratingParseRate: N(r.ratingParseRate),
        reviewParseRate: N(r.reviewParseRate),
      }));
    }),

  // ===== 하이브리드 수집 대시보드 =====
  hybridCollectionDashboard: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const userId = ctx.user!.id;

      const [kwStats] = await db.select({
        total: sql<number>`COUNT(*)`,
        active: sql<number>`SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END)`,
        withGrowth: sql<number>`SUM(CASE WHEN review_growth_7d > 0 THEN 1 ELSE 0 END)`,
        avgComposite: sql<number>`AVG(composite_score)`,
      })
        .from(extWatchKeywords)
        .where(eq(extWatchKeywords.userId, userId));

      const now = new Date();
      now.setHours(now.getHours() + 9);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 19).replace('T', ' ');

      const [eventStats] = await db.select({
        totalEvents: sql<number>`COUNT(*)`,
        uniqueKeywords: sql<number>`COUNT(DISTINCT keyword)`,
        avgParseQuality: sql<number>`AVG((price_parse_rate + rating_parse_rate + review_parse_rate) / 3)`,
      })
        .from(extSearchEvents)
        .where(and(eq(extSearchEvents.userId, userId), gte(extSearchEvents.searchedAt, sevenDaysAgoStr)));

      const dailyCounts = await db.select({
        date: sql<string>`DATE(searched_at)`.as('date'),
        eventCount: sql<number>`COUNT(*)`,
        keywordCount: sql<number>`COUNT(DISTINCT keyword)`,
      })
        .from(extSearchEvents)
        .where(and(eq(extSearchEvents.userId, userId), gte(extSearchEvents.searchedAt, sevenDaysAgoStr)))
        .groupBy(sql`DATE(searched_at)`)
        .orderBy(sql`DATE(searched_at)`);

      const topGrowthKeywords = await db.select({
        keyword: extWatchKeywords.keyword,
        reviewGrowth7d: extWatchKeywords.reviewGrowth7d,
        reviewGrowth1d: extWatchKeywords.reviewGrowth1d,
        latestAvgPrice: extWatchKeywords.latestAvgPrice,
        compositeScore: extWatchKeywords.compositeScore,
      })
        .from(extWatchKeywords)
        .where(and(eq(extWatchKeywords.userId, userId), eq(extWatchKeywords.isActive, true)))
        .orderBy(desc(extWatchKeywords.reviewGrowth7d))
        .limit(5);

      const [parseQuality] = await db.select({
        avgPrice: sql<number>`AVG(price_parse_rate)`,
        avgRating: sql<number>`AVG(rating_parse_rate)`,
        avgReview: sql<number>`AVG(review_parse_rate)`,
      })
        .from(extSearchEvents)
        .where(and(eq(extSearchEvents.userId, userId), gte(extSearchEvents.searchedAt, sevenDaysAgoStr)));

      return {
        watchKeywords: {
          total: N(kwStats?.total),
          active: N(kwStats?.active),
          withGrowth: N(kwStats?.withGrowth),
          avgCompositeScore: Math.round(N(kwStats?.avgComposite)),
        },
        searchEvents: {
          totalLast7d: N(eventStats?.totalEvents),
          uniqueKeywordsLast7d: N(eventStats?.uniqueKeywords),
          avgParseQuality: Math.round(N(eventStats?.avgParseQuality)),
        },
        dailyCounts: dailyCounts.map(d => ({ date: d.date, events: N(d.eventCount), keywords: N(d.keywordCount) })),
        topGrowthKeywords: topGrowthKeywords.map(k => ({
          keyword: k.keyword,
          reviewGrowth7d: N(k.reviewGrowth7d),
          reviewGrowth1d: N(k.reviewGrowth1d),
          latestAvgPrice: N(k.latestAvgPrice),
          compositeScore: N(k.compositeScore),
        })),
        parseQuality: {
          avgPriceRate: Math.round(N(parseQuality?.avgPrice)),
          avgRatingRate: Math.round(N(parseQuality?.avgRating)),
          avgReviewRate: Math.round(N(parseQuality?.avgReview)),
        },
      };
    }),

  // ===== 파싱 품질 진단 =====
  diagnoseParseQuality: protectedProcedure
    .input(z.object({ keyword: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [latestEvent] = await db.select()
        .from(extSearchEvents)
        .where(and(eq(extSearchEvents.userId, ctx.user!.id), eq(extSearchEvents.keyword, input.keyword)))
        .orderBy(desc(extSearchEvents.searchedAt))
        .limit(1);

      if (!latestEvent || !latestEvent.itemsJson) {
        return { keyword: input.keyword, hasData: false, diagnosis: null };
      }

      let items: any[] = [];
      try { items = JSON.parse(latestEvent.itemsJson); } catch { items = []; }

      return { keyword: input.keyword, hasData: true, searchedAt: latestEvent.searchedAt, diagnosis: diagnoseParsingQuality(items) };
    }),

  // ===== v7.3.2: 키워드 중복 감지 =====
  detectDuplicateKeywords: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const watchKws = await db.select({ keyword: extWatchKeywords.keyword })
        .from(extWatchKeywords)
        .where(and(eq(extWatchKeywords.userId, ctx.user!.id), eq(extWatchKeywords.isActive, true)));
      
      const keywords = watchKws.map(k => k.keyword);
      const groups = detectDuplicateKeywords(keywords, 0.85);
      
      return { totalKeywords: keywords.length, duplicateGroups: groups };
    }),

  // ===================================================================
  //  v6.4: 자동 순회 수집기 (Auto-Collect) API
  // ===================================================================

  // ===== 키워드 핀(고정) 토글 =====
  togglePinKeyword: protectedProcedure
    .input(z.object({
      keywordId: z.number().int(),
      isPinned: z.boolean(),
      pinOrder: z.number().int().min(0).max(999).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const update: any = { isPinned: input.isPinned };
      if (input.pinOrder !== undefined) update.pinOrder = input.pinOrder;
      // 핀 해제 시 pinOrder 초기화
      if (!input.isPinned) update.pinOrder = 0;

      await db.update(extWatchKeywords)
        .set(update)
        .where(and(
          eq(extWatchKeywords.id, input.keywordId),
          eq(extWatchKeywords.userId, ctx.user!.id),
        ));

      return { success: true, keywordId: input.keywordId, isPinned: input.isPinned };
    }),

  // ===== 키워드 수집 완료 마킹 =====
  markKeywordCollected: protectedProcedure
    .input(z.object({ keyword: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const userId = ctx.user!.id;
      const now = new Date();
      now.setHours(now.getHours() + 9);
      const nowStr = now.toISOString().slice(0, 19).replace('T', ' ');

      // 기존 키워드의 적응형 간격 조회
      const [kw] = await db.select({
        id: extWatchKeywords.id,
        adaptiveIntervalHours: extWatchKeywords.adaptiveIntervalHours,
      })
        .from(extWatchKeywords)
        .where(and(
          eq(extWatchKeywords.userId, userId),
          eq(extWatchKeywords.keyword, input.keyword),
        ))
        .limit(1);

      // nextCollectAt도 함께 재설정 (수동 수집 후에도 다음 자동 수집 스케줄 반영)
      const intervalHours = N(kw?.adaptiveIntervalHours) || 24;
      const nextCollect = new Date(now.getTime() + intervalHours * 3600 * 1000);
      const nextCollectStr = nextCollect.toISOString().slice(0, 19).replace('T', ' ');

      await db.update(extWatchKeywords)
        .set({
          lastCollectedAt: nowStr,
          nextCollectAt: nextCollectStr,
        })
        .where(and(
          eq(extWatchKeywords.userId, userId),
          eq(extWatchKeywords.keyword, input.keyword),
        ));

      return { success: true, keyword: input.keyword, collectedAt: nowStr };
    }),

  // ===== 수동 수집용: 선택된 키워드의 nextCollectAt 리셋 =====
  // 수동 수집 시 수집주기 제한을 바이패스하여 즉시 수집 가능하게 함
  resetNextCollectForKeywords: protectedProcedure
    .input(z.object({
      keywords: z.array(z.string().min(1)).min(1).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const userId = ctx.user!.id;

      // 선택된 키워드들의 nextCollectAt을 NULL로 리셋
      let resetCount = 0;
      for (const keyword of input.keywords) {
        const [result] = await db.update(extWatchKeywords)
          .set({ nextCollectAt: null })
          .where(and(
            eq(extWatchKeywords.userId, userId),
            eq(extWatchKeywords.keyword, keyword),
          ));
        if (result.affectedRows > 0) resetCount++;
      }

      console.log(`[resetNextCollect] 수동 수집 바이패스: ${resetCount}/${input.keywords.length}개 키워드 nextCollectAt 리셋`);
      return { success: true, resetCount };
    }),

  // ===== 키워드 수집 실패 기록 =====
  markKeywordFailed: protectedProcedure
    .input(z.object({
      keyword: z.string().min(1),
      errorCode: z.string().optional(),
      errorMessage: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 실패 횟수가 많으면 우선순위 낮춤
      const userId = ctx.user!.id;
      const [kw] = await db.select({ id: extWatchKeywords.id, priority: extWatchKeywords.priority })
        .from(extWatchKeywords)
        .where(and(
          eq(extWatchKeywords.userId, userId),
          eq(extWatchKeywords.keyword, input.keyword),
        ))
        .limit(1);

      if (kw) {
        const newPriority = Math.max(0, N(kw.priority) - 5);
        await db.update(extWatchKeywords)
          .set({ priority: newPriority })
          .where(eq(extWatchKeywords.id, kw.id));
      }

      console.warn(`[autoCollect] 수집 실패: "${input.keyword}" — ${input.errorCode}: ${input.errorMessage}`);
      return { success: true };
    }),

  // ===== 확장프로그램 자동수집 완료 → 서버 자동 통계 처리 =====
  autoCollectComplete: protectedProcedure
    .input(z.object({
      successCount: z.number().int().default(0),
      failCount: z.number().int().default(0),
      skipCount: z.number().int().default(0),
      keywords: z.array(z.string()).optional(),
      isManual: z.boolean().default(false),
    }).optional().default({ successCount: 0, failCount: 0, skipCount: 0, isManual: false }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const userId = ctx.user!.id;
      console.log(`[autoCollectComplete] 수집완료: 성공${input.successCount} 실패${input.failCount} 스킵${input.skipCount}`);

      // 1. runDailyBatch (ext_keyword_daily_status)
      const batchResult = await runDailyBatch(userId, undefined, undefined, input.keywords?.length ? input.keywords : undefined);

      // 2. ext_keyword_daily_stats 일괄 갱신 (100개씩)
      const allSnaps = await db.select({ query: extSearchSnapshots.query })
        .from(extSearchSnapshots)
        .where(eq(extSearchSnapshots.userId, userId))
        .groupBy(extSearchSnapshots.query);
      const allKws = allSnaps.map((s: any) => s.query);
      let statsOk = 0, statsErr = 0;
      for (let i = 0; i < allKws.length; i += 100) {
        for (const q of allKws.slice(i, i + 100)) {
          try { await autoComputeKeywordDailyStat(userId, q, db); statsOk++; } catch { statsErr++; }
        }
      }
      // 3. 고아 키워드 자동 활성화 (ext_keyword_daily_stats에는 있지만 ext_watch_keywords에 없는 키워드)
      let syncCount = 0;
      try {
        const orphanKws = await db.select({ query: extKeywordDailyStats.query })
          .from(extKeywordDailyStats)
          .where(eq(extKeywordDailyStats.userId, userId))
          .groupBy(extKeywordDailyStats.query);

        for (const { query: kw } of orphanKws) {
          const [exists] = await db.select({ id: extWatchKeywords.id })
            .from(extWatchKeywords)
            .where(and(eq(extWatchKeywords.userId, userId), eq(extWatchKeywords.keyword, kw)))
            .limit(1);
          if (!exists) {
            await db.insert(extWatchKeywords).values({
              userId,
              keyword: kw,
              priority: 50,
              isActive: true,
              totalSearchCount: 1,
              collectIntervalHours: 24,
              groupNo: Math.floor(Math.random() * 5),
            });
            syncCount++;
          }
        }
        if (syncCount > 0) console.log(`[autoCollectComplete] 고아 키워드 ${syncCount}개 자동 등록`);
      } catch (e) {
        console.warn('[autoCollectComplete] 키워드 동기화 오류:', e);
      }

      // 4. ext_watch_keywords → keyword_master 동기화 (니치파인더 데이터 연동)
      const nicheSync = await syncWatchKeywordsToMaster(userId);

      // 5. 배치 상태 전진 (그룹 턴 이월 + 일일 카운트 증가) — 수동 수집은 제외
      if (!input.isManual) {
        await advanceBatchState(userId, input.successCount).catch(err =>
          console.error("[autoCollectComplete] 배치 상태 업데이트 오류:", err.message)
        );
      } else {
        console.log(`[autoCollectComplete] 수동 수집 — 배치 카운트 증가 생략 (성공: ${input.successCount})`);
      }

      console.log(`[autoCollectComplete] 완료: batch=${batchResult.updated}, stats=${statsOk}, err=${statsErr}, synced=${syncCount}, nicheSynced=${nicheSync.synced}, nicheMetrics=${nicheSync.metricsCreated}`);
      return { success: true, batchUpdated: batchResult.updated, statsComputed: statsOk, statsErrors: statsErr, totalKeywords: allKws.length, keywordsSynced: syncCount, nicheSynced: nicheSync.synced, nicheMetricsCreated: nicheSync.metricsCreated };
    }),

  // ===== 100개 단위 라운드 일괄 통계 계산 (웹 UI용) =====
  bulkComputeStats: protectedProcedure
    .input(z.object({
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(100),
    }).optional().default({ offset: 0, limit: 100 }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const userId = ctx.user!.id;

      const allSnaps = await db.select({ query: extSearchSnapshots.query })
        .from(extSearchSnapshots)
        .where(eq(extSearchSnapshots.userId, userId))
        .groupBy(extSearchSnapshots.query);
      const allKws = allSnaps.map((s: any) => s.query);
      const total = allKws.length;
      const chunk = allKws.slice(input.offset, input.offset + input.limit);
      const hasMore = (input.offset + input.limit) < total;

      let computed = 0, errors = 0;
      for (const q of chunk) {
        try { await autoComputeKeywordDailyStat(userId, q, db); computed++; } catch { errors++; }
      }
      if (!hasMore) {
        await runDailyBatch(userId).catch(() => {});
        await syncWatchKeywordsToMaster(userId).catch(() => {});
      }

      const now = new Date(); now.setHours(now.getHours() + 9);
      return {
        success: true, computed, errors, total, offset: input.offset, hasMore,
        nextOffset: input.offset + input.limit,
        date: now.toISOString().slice(0, 10),
        round: Math.floor(input.offset / input.limit) + 1,
        totalRounds: Math.ceil(total / input.limit),
      };
    }),

  // ===== 자동 수집 통계 =====
  autoCollectStats: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const userId = ctx.user!.id;
      const now = new Date();
      now.setHours(now.getHours() + 9);
      const todayStr = now.toISOString().slice(0, 10);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 19).replace('T', ' ');

      // 오늘 수집된 키워드 수
      const [todayStats] = await db.select({
        collectedToday: sql<number>`COUNT(DISTINCT CASE WHEN DATE(last_collected_at) = ${todayStr} THEN keyword END)`,
      })
        .from(extWatchKeywords)
        .where(eq(extWatchKeywords.userId, userId));

      // 전체 활성 키워드 중 미수집
      const [queueStats] = await db.select({
        totalActive: sql<number>`COUNT(*)`,
        neverCollected: sql<number>`SUM(CASE WHEN last_collected_at IS NULL THEN 1 ELSE 0 END)`,
        stale: sql<number>`SUM(CASE WHEN last_collected_at < ${sevenDaysAgoStr} THEN 1 ELSE 0 END)`,
      })
        .from(extWatchKeywords)
        .where(and(
          eq(extWatchKeywords.userId, userId),
          eq(extWatchKeywords.isActive, true),
        ));

      // 7일간 검색 이벤트 소스 분포
      const sourceDist = await db.select({
        source: extSearchEvents.source,
        count: sql<number>`COUNT(*)`,
      })
        .from(extSearchEvents)
        .where(and(
          eq(extSearchEvents.userId, userId),
          gte(extSearchEvents.searchedAt, sevenDaysAgoStr),
        ))
        .groupBy(extSearchEvents.source);

      // 마지막 수집/통계 갱신 시각 (가장 최근 last_collected_at)
      const [lastCollected] = await db.select({
        lastAt: sql<string>`MAX(last_collected_at)`,
      })
        .from(extWatchKeywords)
        .where(eq(extWatchKeywords.userId, userId));

      // 마지막 daily_stats 갱신 시각
      const [lastDailyStat] = await db.select({
        lastAt: sql<string>`MAX(created_at)`,
      })
        .from(extKeywordDailyStats)
        .where(eq(extKeywordDailyStats.userId, userId));

      // ===== v2 배치 엔진 상태 =====
      const [batchState] = await db.select()
        .from(extBatchState)
        .where(eq(extBatchState.userId, userId))
        .limit(1);

      // 핀 키워드 수
      const [pinStats] = await db.select({
        pinnedCount: sql<number>`SUM(CASE WHEN is_pinned = 1 THEN 1 ELSE 0 END)`,
      })
        .from(extWatchKeywords)
        .where(and(
          eq(extWatchKeywords.userId, userId),
          eq(extWatchKeywords.isActive, true),
        ));

      // 신규 7일 이내 키워드 수
      const [newStats] = await db.select({
        newCount: sql<number>`SUM(CASE WHEN created_at >= ${sevenDaysAgoStr} THEN 1 ELSE 0 END)`,
      })
        .from(extWatchKeywords)
        .where(and(
          eq(extWatchKeywords.userId, userId),
          eq(extWatchKeywords.isActive, true),
        ));

      // overdue 키워드 수 (nextCollectAt이 현재보다 이전)
      const nowStr = now.toISOString().slice(0, 19).replace("T", " ");
      const [overdueStats] = await db.select({
        overdueCount: sql<number>`SUM(CASE WHEN next_collect_at IS NOT NULL AND next_collect_at <= ${nowStr} THEN 1 ELSE 0 END)`,
      })
        .from(extWatchKeywords)
        .where(and(
          eq(extWatchKeywords.userId, userId),
          eq(extWatchKeywords.isActive, true),
        ));

      const isBatchDateToday = batchState?.stateDate === todayStr;

      return {
        collectedToday: N(todayStats?.collectedToday),
        totalActive: N(queueStats?.totalActive),
        neverCollected: N(queueStats?.neverCollected),
        staleKeywords: N(queueStats?.stale),
        sourceDist: sourceDist.map(s => ({ source: s.source, count: N(s.count) })),
        lastCollectedAt: lastCollected?.lastAt || null,
        lastStatsUpdatedAt: lastDailyStat?.lastAt || null,
        // v2 배치 엔진 상태
        batchEngine: {
          currentGroupTurn: batchState?.currentGroupTurn ?? 0,
          totalCollectedToday: isBatchDateToday ? N(batchState?.totalCollectedToday) : 0,
          roundsToday: isBatchDateToday ? N(batchState?.roundsToday) : 0,
          lastBatchCompletedAt: batchState?.lastBatchCompletedAt || null,
          dailyLimit: 500,
          maxRoundsPerDay: 5,
          batchPerRound: 100,
          groupCount: 5,
        },
        pinnedCount: N(pinStats?.pinnedCount),
        newKeywordCount: N(newStats?.newCount),
        overdueCount: N(overdueStats?.overdueCount),
      };
    }),
});
