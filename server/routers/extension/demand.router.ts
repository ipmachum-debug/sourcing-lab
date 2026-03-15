/**
 * Extension Sub-Router: 검색 수요 추정 & AI 인사이트 (Search Demand & AI Insights)
 *
 * ★ v7.6.0: 정규화/판매추정은 단일 서비스(rebuildKeywordDailyStatsForKeyword)로 위임.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import {
  extKeywordDailyStats, extSearchSnapshots, extCandidates, extWatchKeywords,
  extKeywordDailyStatus, keywordSearchVolumeHistory,
} from "../../../drizzle/schema";
import { estimateSearchVolume } from "../../lib/searchVolumeEstimator";
import { eq, and, desc, sql, asc, gte, like } from "drizzle-orm";
import { computeAndUpdateMA } from "../../batchCollector";
import { TRPCError } from "@trpc/server";
import { N } from "./_helpers";
import { callOpenAI, buildMarketDataSummary } from "./_aiHelpers";
import {
  computeBaseProductCount,
  normalizeReviewSum as normalizeReviewSumFn,
  isValidSnapshot as isValidSnapshotFn,
  resolveReviewDelta as resolveReviewDeltaFn,
  computeFallbackDeltas as computeFallbackDeltasFn,
} from "../../lib/reviewNormalization";
import { rebuildKeywordDailyStatsForKeyword } from "../../lib/keywordDailyStatsService";

export const demandRouter = router({
  // ★ v7.6.0: 단일 서비스로 위임 — 정규화/보간/MA/spike 전부 통합
  computeKeywordDailyStats: protectedProcedure
    .input(z.object({
      query: z.string().min(1).max(255).optional(),
    }).optional().default({} as { query?: string }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      // 대상 키워드 목록 수집
      const queryConditions = [eq(extSearchSnapshots.userId, ctx.user!.id)];
      if (input?.query) {
        queryConditions.push(eq(extSearchSnapshots.query, input.query));
      }

      const snapshots = await db.select({ query: extSearchSnapshots.query })
        .from(extSearchSnapshots)
        .where(and(...queryConditions))
        .orderBy(desc(extSearchSnapshots.createdAt));

      if (!snapshots.length) return { success: true, computed: 0 };

      // 유니크 키워드 목록
      const uniqueQueries = [...new Set(snapshots.map(s => s.query))];

      let computed = 0;
      for (const query of uniqueQueries) {
        try {
          const result = await rebuildKeywordDailyStatsForKeyword(
            db,
            ctx.user!.id,
            query,
          );
          if (result.success) computed++;
        } catch (err) {
          console.error(`[computeKeywordDailyStats] "${query}" error:`, err);
        }
      }

      const today = new Date();
      today.setHours(today.getHours() + 9);
      const todayStr = today.toISOString().slice(0, 10);
      return { success: true, computed, date: todayStr };
    }),

  // 키워드별 일별 통계 목록 조회 (특정 키워드의 시계열 데이터)
  getKeywordDailyStats: protectedProcedure
    .input(z.object({
      query: z.string().min(1).max(255),
      days: z.number().int().min(1).max(730).default(30),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      return db.select()
        .from(extKeywordDailyStats)
        .where(and(
          eq(extKeywordDailyStats.userId, ctx.user!.id),
          eq(extKeywordDailyStats.query, input.query),
          sql`${extKeywordDailyStats.statDate} >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL ${input.days} DAY), '%Y-%m-%d')`,
        ))
        .orderBy(asc(extKeywordDailyStats.statDate))
        .limit(730);
    }),

  // 키워드별 최신 일별 통계 요약 (대시보드 전체 키워드 목록)
  listKeywordStats: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(1000).default(500),
      sortBy: z.enum(["keyword_score", "demand_score", "review_growth", "sales_estimate", "competition_score", "avg_price", "query"]).default("keyword_score"),
      sortDir: z.enum(["asc", "desc"]).default("desc"),
      search: z.string().optional(),
    }).default({ limit: 500, sortBy: "keyword_score", sortDir: "desc" }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 각 키워드의 가장 최신 stat_date 레코드만 가져오기
      const conditions = [eq(extKeywordDailyStats.userId, ctx.user!.id)];
      if (input?.search) {
        conditions.push(like(extKeywordDailyStats.query, `%${input.search}%`));
      }

      // 서브쿼리로 각 키워드의 최신 날짜만 가져오기 (JOIN 패턴 — 성능 최적화)
      const rows = await db.select()
        .from(extKeywordDailyStats)
        .where(and(
          ...conditions,
          sql`(${extKeywordDailyStats.query}, ${extKeywordDailyStats.statDate}) IN (
            SELECT \`query\`, MAX(stat_date) FROM ext_keyword_daily_stats
            WHERE user_id = ${ctx.user!.id}
            AND data_status NOT IN ('missing', 'baseline')
            GROUP BY \`query\`
          )`,
        ))
        .limit(input?.limit || 100);

      // 핀 상태 조회 (ext_watch_keywords에서)
      const pinRows = await db.select({
        keyword: extWatchKeywords.keyword,
        isPinned: extWatchKeywords.isPinned,
        pinOrder: extWatchKeywords.pinOrder,
        watchId: extWatchKeywords.id,
      })
        .from(extWatchKeywords)
        .where(and(
          eq(extWatchKeywords.userId, ctx.user!.id),
          eq(extWatchKeywords.isActive, true),
        ));
      const pinMap = new Map(pinRows.map(p => [p.keyword, p]));

      // 핀 상태 합치기
      const enriched = rows.map((r: any) => {
        const pin = pinMap.get(r.query);
        return {
          ...r,
          isPinned: pin ? !!pin.isPinned : false,
          pinOrder: pin ? Number(pin.pinOrder) || 0 : 0,
          watchId: pin?.watchId || null,
        };
      });

      // 정렬 (snake_case sortBy → camelCase Drizzle 프로퍼티 매핑)
      const sortFieldMap: Record<string, string> = {
        keyword_score: "keywordScore",
        demand_score: "demandScore",
        review_growth: "reviewGrowth",
        sales_estimate: "salesEstimate",
        competition_score: "competitionScore",
        avg_price: "avgPrice",
        query: "query",
      };
      const sortField = sortFieldMap[input?.sortBy || "keyword_score"] || "keywordScore";
      const sortDir = input?.sortDir || "desc";
      enriched.sort((a: any, b: any) => {
        // 핀 키워드 항상 최상단
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        if (a.isPinned && b.isPinned && a.pinOrder !== b.pinOrder) return a.pinOrder - b.pinOrder;
        const av = sortField === "query" ? (a.query || "") : Number(a[sortField] || 0);
        const bv = sortField === "query" ? (b.query || "") : Number(b[sortField] || 0);
        if (sortField === "query") {
          return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
        }
        return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
      });

      return enriched;
    }),

  // 키워드별 통계 전체 요약 (대시보드 헤더)
  keywordStatsOverview: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [overview] = await db.select({
        totalKeywords: sql<number>`COUNT(DISTINCT \`query\`)`,
        avgDemandScore: sql<number>`ROUND(AVG(demand_score))`,
        avgKeywordScore: sql<number>`ROUND(AVG(keyword_score))`,
        avgCompetition: sql<number>`ROUND(AVG(competition_score))`,
        totalSalesEstimate: sql<number>`SUM(sales_estimate)`,
        avgPrice: sql<number>`ROUND(AVG(avg_price))`,
        totalReviewGrowth: sql<number>`SUM(review_growth)`,
      })
        .from(extKeywordDailyStats)
        .where(and(
          eq(extKeywordDailyStats.userId, ctx.user!.id),
          sql`(${extKeywordDailyStats.query}, ${extKeywordDailyStats.statDate}) IN (
            SELECT \`query\`, MAX(stat_date) FROM ext_keyword_daily_stats
            WHERE user_id = ${ctx.user!.id}
            AND data_status NOT IN ('missing', 'baseline')
            GROUP BY \`query\`
          )`,
          sql`${extKeywordDailyStats.dataStatus} NOT IN ('missing', 'baseline')`,
        ));

      return overview ? {
        totalKeywords: N(overview.totalKeywords),
        avgDemandScore: N(overview.avgDemandScore),
        avgKeywordScore: N(overview.avgKeywordScore),
        avgCompetition: N(overview.avgCompetition),
        totalSalesEstimate: N(overview.totalSalesEstimate),
        avgPrice: N(overview.avgPrice),
        totalReviewGrowth: N(overview.totalReviewGrowth),
      } : {};
    }),

  // 키워드 삭제 (키워드 데이터 전체 제거: 스냅샷 + 일별통계)
  deleteKeyword: protectedProcedure
    .input(z.object({ query: z.string().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 스냅샷 삭제
      await db.delete(extSearchSnapshots)
        .where(and(eq(extSearchSnapshots.userId, ctx.user!.id), eq(extSearchSnapshots.query, input.query)));

      // 일별 통계 삭제
      await db.delete(extKeywordDailyStats)
        .where(and(eq(extKeywordDailyStats.userId, ctx.user!.id), eq(extKeywordDailyStats.query, input.query)));

      // 감시 키워드 삭제 (is_active = false 처리)
      await db.update(extWatchKeywords)
        .set({ isActive: false })
        .where(and(eq(extWatchKeywords.userId, ctx.user!.id), eq(extWatchKeywords.keyword, input.query)));

      return { success: true, query: input.query };
    }),

  // 키워드 일괄 삭제
  deleteKeywords: protectedProcedure
    .input(z.object({ queries: z.array(z.string().min(1).max(255)).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      for (const query of input.queries) {
        await db.delete(extSearchSnapshots)
          .where(and(eq(extSearchSnapshots.userId, ctx.user!.id), eq(extSearchSnapshots.query, query)));
        await db.delete(extKeywordDailyStats)
          .where(and(eq(extKeywordDailyStats.userId, ctx.user!.id), eq(extKeywordDailyStats.query, query)));
        // 감시 키워드 삭제 (is_active = false 처리)
        await db.update(extWatchKeywords)
          .set({ isActive: false })
          .where(and(eq(extWatchKeywords.userId, ctx.user!.id), eq(extWatchKeywords.keyword, query)));
      }

      return { success: true, count: input.queries.length };
    }),

  // ===== 시장 개요 (최신 스냅샷 기반) =====
  // 크롤링 데이터에서 시장 개요를 가져옴. 일일 1회 기준, 품질이 나쁘면 이전 데이터 유지.
  getLatestMarketOverview: protectedProcedure
    .input(z.object({
      query: z.string().min(1).max(255),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const userId = ctx.user!.id;

      // 최근 7일간 스냅샷을 최신순으로 가져옴 (품질 비교용)
      const recentSnaps = await db.select()
        .from(extSearchSnapshots)
        .where(and(
          eq(extSearchSnapshots.userId, userId),
          eq(extSearchSnapshots.query, input.query),
        ))
        .orderBy(desc(extSearchSnapshots.createdAt))
        .limit(10);

      if (!recentSnaps.length) return null;

      // 품질 판단 함수: 상품수 5개 이상, 평균가 > 0
      const isGoodQuality = (snap: any) => {
        const items = N(snap.totalItems);
        const price = N(snap.avgPrice);
        return items >= 5 && price > 0;
      };

      // 최신 데이터부터 품질 좋은 스냅샷 선택
      const bestSnap = recentSnaps.find(isGoodQuality) || recentSnaps[0];

      // 오늘 날짜 (KST)
      const now = new Date();
      now.setHours(now.getHours() + 9);
      const todayStr = now.toISOString().slice(0, 10);
      const snapDate = bestSnap.createdAt
        ? new Date(bestSnap.createdAt).toISOString().slice(0, 10)
        : todayStr;

      // itemsJson에서 추가 통계 계산
      let medianPrice = N(bestSnap.medianPrice);
      let maxReview = N(bestSnap.maxReviewCount);
      let rocketCount = N(bestSnap.rocketCount);
      let totalReviewSum = N(bestSnap.totalReviewSum);

      if (!medianPrice && bestSnap.itemsJson) {
        try {
          const items: any[] = JSON.parse(bestSnap.itemsJson);
          const prices = items.map(i => Number(i.price) || 0).filter(p => p > 0).sort((a, b) => a - b);
          if (prices.length > 0) medianPrice = prices[Math.floor(prices.length / 2)];
          if (!maxReview) {
            const reviews = items.map(i => Number(i.reviewCount) || 0);
            maxReview = Math.max(0, ...reviews);
          }
          if (!totalReviewSum) {
            totalReviewSum = items.reduce((s, i) => s + (Number(i.reviewCount) || 0), 0);
          }
        } catch {}
      }

      const totalItems = N(bestSnap.totalItems);
      const highReviewCount = N(bestSnap.highReviewCount);
      const adCount = N(bestSnap.adCount);

      return {
        snapshotDate: snapDate,
        isToday: snapDate === todayStr,
        totalItems,
        avgPrice: N(bestSnap.avgPrice),
        avgRating: Number(bestSnap.avgRating || 0),
        totalReviewSum,
        minPrice: N(bestSnap.minPrice),
        maxPrice: N(bestSnap.maxPrice),
        medianPrice,
        maxReviewCount: maxReview,
        highReviewCount,
        highReviewRatio: totalItems > 0 ? Math.round((highReviewCount / totalItems) * 100) : 0,
        adCount,
        adRatio: totalItems > 0 ? Math.round((adCount / totalItems) * 100) : 0,
        rocketCount,
        rocketRatio: totalItems > 0 ? Math.round((rocketCount / totalItems) * 100) : 0,
        competitionScore: N(bestSnap.competitionScore),
        competitionLevel: bestSnap.competitionLevel,
      };
    }),

  // ===== 검색량 (월간) — 네이버 + 쿠팡 추정 =====
  getKeywordSearchVolume: protectedProcedure
    .input(z.object({
      query: z.string().min(1).max(255),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const userId = ctx.user!.id;

      // 네이버 검색량 (최신 월)
      const [volume] = await db.select()
        .from(keywordSearchVolumeHistory)
        .where(and(
          eq(keywordSearchVolumeHistory.userId, userId),
          eq(keywordSearchVolumeHistory.keyword, input.query),
          eq(keywordSearchVolumeHistory.source, "naver"),
        ))
        .orderBy(desc(keywordSearchVolumeHistory.yearMonth))
        .limit(1);

      if (!volume) return null;

      // 쿠팡 검색량 추정 (Simple or Hybrid)
      let searchVolumeEstimate = null;
      try {
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
          .where(and(
            eq(extKeywordDailyStats.userId, userId),
            eq(extKeywordDailyStats.query, input.query),
            gte(extKeywordDailyStats.statDate, dateStr),
          ))
          .orderBy(asc(extKeywordDailyStats.statDate));

        const reliableDeltas = dailyStats.filter(
          d => d.dataStatus === "raw_valid" && !d.isProvisional && Number(d.reviewDeltaUsed ?? 0) >= 0,
        );

        const avgMatchRate = reliableDeltas.length > 0
          ? reliableDeltas.reduce((s, d) => s + Number(d.coverageRatio ?? 0), 0) / reliableDeltas.length
          : 0;
        const avgDailyReviewGrowth = reliableDeltas.length > 0
          ? reliableDeltas.reduce((s, d) => s + Number(d.reviewDeltaUsed ?? 0), 0) / reliableDeltas.length
          : 0;

        searchVolumeEstimate = estimateSearchVolume({
          naverTotalSearch: Number(volume.totalSearch ?? 0),
          avgDailyReviewGrowth,
          avgMatchRate,
          dataDays: dailyStats.length,
          reliableDeltaCount: reliableDeltas.length,
          autoCompleteCount: 0,
        });
      } catch {}

      return {
        pcSearch: N(volume.pcSearch),
        mobileSearch: N(volume.mobileSearch),
        totalSearch: N(volume.totalSearch),
        competitionIndex: volume.competitionIndex || null,
        yearMonth: volume.yearMonth,
        coupangEstimate: searchVolumeEstimate?.estimatedMonthlySearch ?? Math.round(N(volume.totalSearch) * 0.33),
        estimateModel: searchVolumeEstimate?.model ?? "simple",
        estimateConfidence: searchVolumeEstimate?.confidence ?? 0.3,
        competitionRatio: N(volume.totalSearch) > 0
          ? Math.round((searchVolumeEstimate?.estimatedMonthlySearch ?? Math.round(N(volume.totalSearch) * 0.33)) / N(volume.totalSearch) * 10) / 10
          : 0,
      };
    }),

  // ===== 오늘 미수집 키워드 목록 =====
  // 확장프로그램이 200개 제한이라 일부 키워드가 크롤링되지 않음
  // 이 API로 미수집 키워드를 식별하여 선택적 수집 가능
  getUncollectedKeywords: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // KST 기준 오늘 날짜 (서버/MySQL TZ가 이미 Asia/Seoul이므로 이중 변환 방지)
      const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

      // 1. 모든 활성 감시 키워드
      const watchRows = await db.select({
        keyword: extWatchKeywords.keyword,
      })
        .from(extWatchKeywords)
        .where(and(
          eq(extWatchKeywords.userId, ctx.user!.id),
          eq(extWatchKeywords.isActive, true),
        ));
      const allKeywords = watchRows.map(r => r.keyword);

      // 2. 오늘 스냅샷이 있는 키워드
      const collectedRows = await db.select({
        query: extSearchSnapshots.query,
      })
        .from(extSearchSnapshots)
        .where(and(
          eq(extSearchSnapshots.userId, ctx.user!.id),
          sql`DATE(${extSearchSnapshots.createdAt}) = ${todayStr}`,
        ));
      const collectedSet = new Set(collectedRows.map(r => r.query));

      // 3. 미수집 키워드 분류
      const collected: string[] = [];
      const uncollected: string[] = [];
      for (const kw of allKeywords) {
        if (collectedSet.has(kw)) {
          collected.push(kw);
        } else {
          uncollected.push(kw);
        }
      }

      return {
        total: allKeywords.length,
        collectedCount: collected.length,
        uncollectedCount: uncollected.length,
        uncollectedKeywords: uncollected.sort((a, b) => a.localeCompare(b, "ko")),
        date: todayStr,
      };
    }),

  // ===== 미수집 키워드 우선 수집 예약 =====
  // next_collect_at을 NULL로 리셋하면 selectBatchKeywords에서 최우선 선택됨
  boostUncollectedPriority: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // KST 기준 오늘 날짜 (서버/MySQL TZ가 이미 Asia/Seoul이므로 이중 변환 방지)
      const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

      // 오늘 스냅샷이 있는 키워드
      const collectedRows = await db.select({
        query: extSearchSnapshots.query,
      })
        .from(extSearchSnapshots)
        .where(and(
          eq(extSearchSnapshots.userId, ctx.user!.id),
          sql`DATE(${extSearchSnapshots.createdAt}) = ${todayStr}`,
        ));
      const collectedSet = new Set(collectedRows.map(r => r.query));

      // 전체 활성 키워드 중 미수집 키워드의 next_collect_at을 NULL로 리셋
      const watchRows = await db.select({
        id: extWatchKeywords.id,
        keyword: extWatchKeywords.keyword,
      })
        .from(extWatchKeywords)
        .where(and(
          eq(extWatchKeywords.userId, ctx.user!.id),
          eq(extWatchKeywords.isActive, true),
        ));

      const uncollectedIds: number[] = [];
      for (const w of watchRows) {
        if (!collectedSet.has(w.keyword)) {
          uncollectedIds.push(w.id);
        }
      }

      if (uncollectedIds.length > 0) {
        // next_collect_at을 NULL로 리셋 → selectBatchKeywords에서 최우선 선택
        await db.update(extWatchKeywords)
          .set({ nextCollectAt: null })
          .where(and(
            eq(extWatchKeywords.userId, ctx.user!.id),
            sql`${extWatchKeywords.id} IN (${sql.join(uncollectedIds.map(id => sql`${id}`), sql`, `)})`,
          ));
      }

      return {
        boosted: uncollectedIds.length,
        message: `${uncollectedIds.length}개 미수집 키워드가 다음 수집에서 우선 처리됩니다.`,
      };
    }),

  // ===== AI 인사이트 — 축적 데이터 기반 분석 =====

  // AI 인사이트: 놓친 기회 + 파생상품 제안 + 종합 분석
  aiInsights: protectedProcedure
    .input(z.object({
      forceRefresh: z.boolean().default(false),
    }).default({ forceRefresh: false }))
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 1. 모든 스냅샷 데이터 가져오기
      const snapshots = await db.select()
        .from(extSearchSnapshots)
        .where(eq(extSearchSnapshots.userId, ctx.user!.id))
        .orderBy(desc(extSearchSnapshots.createdAt));

      // 2. 일별 통계 가져오기
      const dailyStats = await db.select()
        .from(extKeywordDailyStats)
        .where(eq(extKeywordDailyStats.userId, ctx.user!.id))
        .orderBy(desc(extKeywordDailyStats.statDate));

      if (!snapshots.length) {
        return {
          missedOpportunities: [],
          derivativeProducts: [],
          competitorAlerts: [],
          insights: [],
          summary: "검색 데이터가 아직 없습니다. 쿠팡에서 키워드를 검색하면 데이터가 자동으로 축적됩니다.",
        };
      }

      // 3. 데이터 분석 — 규칙 기반 인사이트 생성
      const insights: any[] = [];
      const missedOpportunities: any[] = [];
      const derivativeProducts: any[] = [];
      const competitorAlerts: any[] = [];

      // 키워드별 최신 스냅샷 그룹핑
      const keywordMap = new Map<string, any>();
      for (const s of snapshots) {
        if (!keywordMap.has(s.query)) keywordMap.set(s.query, s);
      }

      // 키워드별 일별 통계 그룹핑
      const dailyMap = new Map<string, any[]>();
      for (const d of dailyStats) {
        if (!dailyMap.has(d.query)) dailyMap.set(d.query, []);
        dailyMap.get(d.query)!.push(d);
      }

      for (const [keyword, snapshot] of keywordMap) {
        let items: any[] = [];
        try { items = snapshot.itemsJson ? JSON.parse(snapshot.itemsJson) : []; } catch { items = []; }

        const daily = dailyMap.get(keyword) || [];
        const totalItems = snapshot.totalItems || 0;
        const avgPrice = snapshot.avgPrice || 0;
        const avgReview = snapshot.avgReview || 0;
        const competitionScore = snapshot.competitionScore || 0;
        const adCount = snapshot.adCount || 0;
        const adRatio = totalItems > 0 ? (adCount / totalItems) * 100 : 0;

        // === 놓친 기회 분석 ===
        // 경쟁이 낮고 리뷰가 적은 키워드 = 진입 기회
        if (competitionScore < 40 && avgReview < 200 && totalItems > 10) {
          missedOpportunities.push({
            keyword,
            reason: `경쟁도 ${competitionScore}점으로 낮고, 평균 리뷰 ${avgReview}건으로 신규 진입 적합`,
            score: 100 - competitionScore,
            type: "low_competition",
            avgPrice,
            totalItems,
          });
        }

        // 광고가 많은데 경쟁도가 낮은 경우 = 광고비로 순위를 사는 시장
        if (adRatio > 25 && competitionScore < 50) {
          missedOpportunities.push({
            keyword,
            reason: `광고 비율 ${Math.round(adRatio)}%이지만 경쟁도 ${competitionScore}점 — 광고 없이 진입 가능`,
            score: Math.round(90 - competitionScore * 0.5),
            type: "ad_opportunity",
            avgPrice,
            totalItems,
          });
        }

        // 평균가가 높은데 리뷰가 적은 = 고마진 기회
        if (avgPrice > 20000 && avgReview < 300) {
          missedOpportunities.push({
            keyword,
            reason: `평균가 ${avgPrice.toLocaleString()}원으로 마진이 높고, 평균 리뷰 ${avgReview}건으로 경쟁이 적음`,
            score: Math.min(95, Math.round(avgPrice / 500)),
            type: "high_margin",
            avgPrice,
            totalItems,
          });
        }

        // === 파생 상품 제안 (의미적 연관 키워드) ===
        if (items.length > 0) {
          // 커머스 불용어 — 파생 키워드로 의미 없는 단어들
          const DERIVED_NOISE = /^(세트|개입|세트입|묶음|패키지|특가|인기|추천|프리미엄|신상|무료배송|당일|국내|용품|제품|상품|전용|겸용|개당|매입|적립|포인트|도착|배송|발송|출고|택배|반품|교환|증정|사은품|할인|쿠폰|세일|최저가|초특가|핫딜|대용량|소용량|정품|수입|국산|미니|슬림|블랙|화이트|그레이|네이비|베이지|브라운|핑크|레드|블루|그린|골드|실버|리뉴얼|업그레이드|신제품|한정|품절|히트|대박|베스트|랭킹|호환|사이즈|색상|컬러|보장|가능|불가|포함|별도|단품|낱개|잡화|기타|공식|판매|인증|고급|럭셔리)$/;
          // 수량/단위 패턴
          const UNIT_PATTERN = /^\d+[개팩세트입매장병봉롤캔컵짝]+$|^\d+[+]\d+$|^\d+[PpRr]$/;
          // 색상 패턴
          const COLOR_PATTERN = /^(블랙|화이트|그레이|네이비|베이지|브라운|핑크|레드|블루|그린|옐로우|퍼플|오렌지|실버|골드|아이보리|카키|와인|차콜)$/;

          // 검색 키워드의 핵심 단어 추출
          const keywordTokens = keyword.match(/[가-힣]{2,}|[a-zA-Z]{2,}/g) || [];

          // 1단계: 상위 상품 타이틀에서 의미있는 "상품 특성" 단어 추출
          const wordContext = new Map<string, { count: number; titles: string[] }>();

          for (const item of items.slice(0, 30)) {
            const title = (item.title || "").replace(/\[.*?\]/g, "").replace(/\(.*?\)/g, "");
            const words = title.match(/[가-힣]{2,}/g) || [];
            const seen = new Set<string>();
            for (const w of words) {
              if (seen.has(w)) continue;
              seen.add(w);
              if (keywordTokens.some((kt: string) => kt === w || w.includes(kt) || kt.includes(w))) continue;
              if (w.length < 2 || DERIVED_NOISE.test(w) || UNIT_PATTERN.test(w) || COLOR_PATTERN.test(w)) continue;
              if (/^\d|\d$/.test(w) || /^[A-Z]{1,3}$/.test(w)) continue;
              const existing = wordContext.get(w) || { count: 0, titles: [] };
              existing.count++;
              if (existing.titles.length < 3) existing.titles.push(title.slice(0, 40));
              wordContext.set(w, existing);
            }
          }

          // 2단계: 상품 특성 분류 — 대상/재질/용도/형태 등
          const PRODUCT_ATTRS = /^(강아지|고양이|반려견|반려묘|애견|애묘|유아|아기|어린이|성인|여성|남성|실리콘|스테인리스|원목|나무|플라스틱|가죽|면|린넨|폴리|접이식|휴대용|무선|유선|충전식|자동|수동|방수|방한|보온|보냉|미끄럼방지|논슬립|항균|살균|친환경|대형|중형|소형|초소형|유기농|천연)$/;
          const CATEGORY_WORDS = /^(브러쉬|브러시|빗|솔|클리너|청소기|정리함|수납함|보관함|바구니|가방|파우치|케이스|커버|매트|패드|쿠션|방석|이불|담요|텀블러|컵|접시|그릇|냄비|팬|도마|칼|가위|스푼|포크|젓가락|장갑|양말|모자|마스크|슬리퍼|필터|리필|충전기|거치대|스탠드|홀더|트레이|디스펜서|스프레이|세정제|세제|샴푸|린스|크림|오일|밤|젤|폼|워터|미스트|팩|마사지|롤러|밴드|테이프|스티커|라벨)$/;

          // 3단계: 의미적 파생 키워드 생성
          const candidates: Array<{ word: string; count: number; type: string }> = [];

          for (const [word, ctx] of wordContext.entries()) {
            if (ctx.count < 2) continue;
            if (PRODUCT_ATTRS.test(word)) {
              candidates.push({ word, count: ctx.count, type: "attribute" });
            } else if (CATEGORY_WORDS.test(word)) {
              candidates.push({ word, count: ctx.count, type: "category" });
            } else if (ctx.count >= 3 && word.length >= 2) {
              candidates.push({ word, count: ctx.count, type: "related" });
            }
          }

          // 속성어 우선, 등장 횟수 순 정렬
          candidates.sort((a, b) => {
            const tp: Record<string, number> = { attribute: 3, category: 2, related: 1 };
            const diff = (tp[b.type] || 0) - (tp[a.type] || 0);
            return diff !== 0 ? diff : b.count - a.count;
          });

          for (const c of candidates.slice(0, 6)) {
            const typeLabel = c.type === "attribute" ? "대상/속성" : c.type === "category" ? "관련 품목" : "연관 키워드";
            // 파생 키워드: "고양이 브러쉬", "실리콘 매트" 형태로 생성
            const coreKeyword = keywordTokens.filter((t: string) => !c.word.includes(t)).join(" ");
            const suggestion = coreKeyword ? `${c.word} ${coreKeyword}` : `${c.word} ${keyword}`;
            derivativeProducts.push({
              keyword,
              suggestion,
              alternativeKeyword: c.word,
              confidence: Math.min(95, c.count * 12 + (c.type === "attribute" ? 20 : c.type === "category" ? 10 : 0)),
              reason: `상위 상품 ${c.count}개에서 발견된 ${typeLabel} "${c.word}" — 별도 검색으로 틈새시장 확인 추천`,
              occurrences: c.count,
              type: c.type,
            });
          }
        }
        // === 경쟁자 알림 ===
        // 리뷰 급증 감지 (일별 데이터 필요)
        if (daily.length >= 2) {
          const latest = daily[0];
          const prev = daily[1];
          if (Number(latest.totalReviewSum) > Number(prev.totalReviewSum) * 1.1) {
            competitorAlerts.push({
              keyword,
              type: "review_surge",
              message: `총 리뷰가 10%+ 급증 (${Number(prev.totalReviewSum).toLocaleString()} → ${Number(latest.totalReviewSum).toLocaleString()})`,
              severity: "warning",
            });
          }
          // 가격 변동 감지
          const priceChange = (Number(latest.avgPrice) - Number(prev.avgPrice));
          if (Math.abs(priceChange) > Number(prev.avgPrice) * 0.05) {
            competitorAlerts.push({
              keyword,
              type: "price_change",
              message: `평균가 ${priceChange > 0 ? "상승" : "하락"}: ${Number(prev.avgPrice).toLocaleString()}원 → ${Number(latest.avgPrice).toLocaleString()}원 (${priceChange > 0 ? "+" : ""}${priceChange.toLocaleString()}원)`,
              severity: priceChange > 0 ? "info" : "warning",
            });
          }
        }
      }

      // === 종합 인사이트 ===
      const allCompetitions = [...keywordMap.values()].map(s => s.competitionScore || 0);
      const avgCompetition = allCompetitions.length ? Math.round(allCompetitions.reduce((a: number, b: number) => a + b, 0) / allCompetitions.length) : 0;

      if (avgCompetition < 40) {
        insights.push({
          type: "positive",
          icon: "🎯",
          title: "전체적으로 경쟁이 낮은 키워드들",
          message: `평균 경쟁도 ${avgCompetition}점 — 현재 추적 키워드들은 대체로 진입 장벽이 낮습니다.`,
        });
      } else if (avgCompetition > 70) {
        insights.push({
          type: "warning",
          icon: "⚠️",
          title: "경쟁이 치열한 키워드가 많습니다",
          message: `평균 경쟁도 ${avgCompetition}점 — 경쟁이 낮은 니치 키워드를 추가로 탐색하세요.`,
        });
      }

      // 데이터 축적 안내
      if (dailyStats.length < keywordMap.size * 2) {
        insights.push({
          type: "info",
          icon: "📊",
          title: "데이터 축적이 필요합니다",
          message: `리뷰증가, 판매추정, 수요점수는 매일 쿠팡에서 검색할 때마다 데이터가 축적됩니다. 2~3일간 같은 키워드를 검색하면 추이 분석이 시작됩니다.`,
        });
      }

      // 파생 상품 안내
      if (derivativeProducts.length > 0) {
        insights.push({
          type: "suggestion",
          icon: "💡",
          title: `${derivativeProducts.length}개 파생 키워드 발견`,
          message: `현재 추적 중인 키워드에서 ${derivativeProducts.length}개의 파생/유사 상품 키워드가 발견되었습니다.`,
        });
      }

      const summary = [
        `📦 ${keywordMap.size}개 키워드 분석 완료`,
        missedOpportunities.length ? `🎯 놓친 기회 ${missedOpportunities.length}건` : "",
        derivativeProducts.length ? `💡 파생상품 제안 ${derivativeProducts.length}건` : "",
        competitorAlerts.length ? `⚠️ 경쟁자 알림 ${competitorAlerts.length}건` : "",
      ].filter(Boolean).join(" · ");

      return {
        missedOpportunities: missedOpportunities.sort((a, b) => b.score - a.score).slice(0, 10),
        derivativeProducts: derivativeProducts.sort((a, b) => b.confidence - a.confidence).slice(0, 15),
        competitorAlerts: competitorAlerts.slice(0, 10),
        insights,
        summary,
      };
    }),

  // ===== [DEPRECATED 2026-03-15] ext_keyword_daily_status 기반 정규화 재계산 =====
  // 이 프로시저는 구 ext_keyword_daily_status 테이블 대상. 사용 금지.
  // 정확한 재계산은 rebuildDailyStats (ext_keyword_daily_stats 기반) 사용할 것.
  rebuildNormalizedMetrics: protectedProcedure
    .input(z.object({
      keyword: z.string().min(1).max(255).optional(),
      days: z.number().int().min(1).max(730).default(30),
    }).optional().default({ days: 30 }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      const userId = ctx.user!.id;
      const daysBack = input?.days || 30;

      // 대상 키워드 목록 조회
      const keywordConditions = [
        eq(extKeywordDailyStatus.userId, userId),
        sql`${extKeywordDailyStatus.statDate} >= DATE_SUB(CURDATE(), INTERVAL ${daysBack} DAY)`,
      ];
      if (input?.keyword) {
        keywordConditions.push(eq(extKeywordDailyStatus.keyword, input.keyword));
      }

      const allRows = await db.select({
        id: extKeywordDailyStatus.id,
        keyword: extKeywordDailyStatus.keyword,
        statDate: extKeywordDailyStatus.statDate,
        totalItems: extKeywordDailyStatus.totalItems,
        totalReviewSum: extKeywordDailyStatus.totalReviewSum,
        estimatedDailySales: extKeywordDailyStatus.estimatedDailySales,
        reviewGrowth: extKeywordDailyStatus.reviewGrowth,
      })
        .from(extKeywordDailyStatus)
        .where(and(...keywordConditions))
        .orderBy(asc(extKeywordDailyStatus.keyword), asc(extKeywordDailyStatus.statDate));

      if (!allRows.length) return { success: true, rebuilt: 0, keywords: 0 };

      // 키워드별 그룹화
      const byKeyword = new Map<string, typeof allRows>();
      for (const row of allRows) {
        const arr = byKeyword.get(row.keyword) || [];
        arr.push(row);
        byKeyword.set(row.keyword, arr);
      }

      let rebuilt = 0;
      for (const [keyword, rows] of byKeyword.entries()) {
        if (rows.length < 2) continue;

        // 1. 기준 상품수 계산
        const productCounts = rows.map(r => N(r.totalItems)).filter(c => c > 0);
        const { baseProductCount } = computeBaseProductCount(productCounts);
        const effectiveBase = baseProductCount > 0 ? baseProductCount : Math.max(...productCounts, 1);

        // 2. 각 날짜 정규화 + 유효성 판정
        const normalized = rows.map(r => {
          const items = N(r.totalItems);
          const reviewSum = N(r.totalReviewSum);
          const norm = normalizeReviewSumFn(reviewSum, items, effectiveBase);
          const valid = isValidSnapshotFn(items, reviewSum, effectiveBase);
          return { ...r, ...norm, isValid: valid.valid, invalidReason: valid.reason };
        });

        // 3. 유효 앵커 인덱스
        const validIdx: number[] = [];
        normalized.forEach((r, i) => { if (r.isValid) validIdx.push(i); });

        if (validIdx.length < 2) continue;

        // 4. 앵커 간 선형 보간으로 delta 분배
        for (let vi = 1; vi < validIdx.length; vi++) {
          const prevI = validIdx[vi - 1];
          const nextI = validIdx[vi];
          const prevNorm = normalized[prevI].normalizedReviewSum;
          const nextNorm = normalized[nextI].normalizedReviewSum;
          const gap = nextI - prevI;
          if (gap <= 0) continue;

          const totalDelta = nextNorm - prevNorm;
          const dailyDelta = totalDelta >= 0 ? Math.round(totalDelta / gap) : 0;
          const dailySales = dailyDelta * 20;

          // 구간 내 모든 날짜 업데이트 (prevI+1 ~ nextI)
          for (let j = 1; j <= gap; j++) {
            const idx = prevI + j;
            const row = normalized[idx];
            const interpolatedNormSum = Math.round(prevNorm + (totalDelta >= 0 ? totalDelta / gap : 0) * j);
            const isAnchor = idx === nextI;

            await db.update(extKeywordDailyStatus)
              .set({
                baseProductCount: effectiveBase,
                normalizedReviewSum: interpolatedNormSum,
                coverageRatio: row.coverageRatio.toFixed(4),
                reviewGrowth: dailyDelta,
                reviewDeltaObserved: isAnchor ? dailyDelta : 0,
                reviewDeltaUsed: dailyDelta,
                estimatedDailySales: dailySales,
                isProvisional: false,
                provisionalReason: null,
                dataStatus: isAnchor ? (totalDelta >= 0 ? "raw_valid" : "anomaly") : "interpolated",
              })
              .where(eq(extKeywordDailyStatus.id, row.id));

            rebuilt++;
          }
        }

        // 5. MA7/MA30 재계산
        const latestDate = String(rows[rows.length - 1].statDate);
        await computeAndUpdateMA(db, userId, keyword, latestDate);
      }

      return { success: true, rebuilt, keywords: byKeyword.size };
    }),

  // ===== ★ v7.6.0: ext_keyword_daily_stats 재계산 (단일 서비스 기반) =====
  rebuildDailyStats: protectedProcedure
    .input(z.object({
      days: z.number().int().min(1).max(730).default(30),
    }).optional().default({ days: 30 }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      const userId = ctx.user!.id;

      // 유니크 키워드 목록 조회
      const allRows = await db.select({
        query: extKeywordDailyStats.query,
      })
        .from(extKeywordDailyStats)
        .where(eq(extKeywordDailyStats.userId, userId))
        .groupBy(extKeywordDailyStats.query);

      if (!allRows.length) return { success: true, rebuilt: 0, keywords: 0 };

      let rebuilt = 0;
      const windowDays = input?.days || 90;
      for (const row of allRows) {
        try {
          const result = await rebuildKeywordDailyStatsForKeyword(
            db, userId, row.query,
            { windowDays },
          );
          if (result.success) rebuilt++;
        } catch (err) {
          console.error(`[rebuildDailyStats] "${row.query}" error:`, err);
        }
      }

      return { success: true, rebuilt, keywords: allRows.length };
    }),

  // ===== ★ P2: demand_score=0인 과거 데이터 일괄 백필 =====
  backfillDemandScores: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      const userId = ctx.user!.id;

      // demand_score=0인 키워드만 추출
      const zeroKws = await db.selectDistinct({
        query: extKeywordDailyStats.query,
      })
        .from(extKeywordDailyStats)
        .where(and(
          eq(extKeywordDailyStats.userId, userId),
          sql`${extKeywordDailyStats.demandScore} = 0`,
          sql`${extKeywordDailyStats.reviewGrowth} > 0`,
        ));

      if (!zeroKws.length) return { success: true, rebuilt: 0, keywords: 0 };

      let rebuilt = 0;
      for (const row of zeroKws) {
        try {
          const result = await rebuildKeywordDailyStatsForKeyword(
            db, userId, row.query,
            { windowDays: 90 },
          );
          if (result.success) rebuilt++;
        } catch (err) {
          console.error(`[backfillDemandScores] "${row.query}" error:`, err);
        }
      }

      return { success: true, rebuilt, keywords: zeroKws.length };
    }),

  // ===== legacy: 하위 호환 (이전 rebuildNormalizedMetrics는 ext_keyword_daily_status 대상) =====
  // 아래는 기존 ext_keyword_daily_status 테이블 재계산 — 변경 없음
  _legacyRebuildDailyStats: protectedProcedure
    .input(z.object({
      days: z.number().int().min(1).max(90).default(30),
    }).optional().default({ days: 30 }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      const userId = ctx.user!.id;
      const daysBack = input?.days || 30;

      const allRows = await db.select({
        id: extKeywordDailyStats.id,
        query: extKeywordDailyStats.query,
        statDate: extKeywordDailyStats.statDate,
        productCount: extKeywordDailyStats.productCount,
        totalReviewSum: extKeywordDailyStats.totalReviewSum,
        reviewGrowth: extKeywordDailyStats.reviewGrowth,
      })
        .from(extKeywordDailyStats)
        .where(and(
          eq(extKeywordDailyStats.userId, userId),
          sql`${extKeywordDailyStats.statDate} >= DATE_SUB(CURDATE(), INTERVAL ${daysBack} DAY)`,
        ))
        .orderBy(asc(extKeywordDailyStats.query), asc(extKeywordDailyStats.statDate));

      if (!allRows.length) return { success: true, rebuilt: 0, keywords: 0 };

      const byQuery = new Map<string, typeof allRows>();
      for (const row of allRows) {
        const arr = byQuery.get(row.query) || [];
        arr.push(row);
        byQuery.set(row.query, arr);
      }

      let rebuilt = 0;
      for (const [query, rows] of byQuery.entries()) {
        if (rows.length < 2) continue;

        const productCounts = rows.map(r => N(r.productCount)).filter(c => c > 0);
        const { baseProductCount } = computeBaseProductCount(productCounts);
        const effectiveBase = baseProductCount > 0 ? baseProductCount : Math.max(...productCounts, 1);

        const normalized = rows.map(r => {
          const pc = N(r.productCount);
          const rs = N(r.totalReviewSum);
          const norm = normalizeReviewSumFn(rs, pc, effectiveBase);
          const valid = isValidSnapshotFn(pc, rs, effectiveBase);
          return { ...r, ...norm, isValid: valid.valid };
        });

        const validIdx: number[] = [];
        normalized.forEach((r, i) => { if (r.isValid) validIdx.push(i); });
        if (validIdx.length < 2) continue;

        for (let vi = 1; vi < validIdx.length; vi++) {
          const prevI = validIdx[vi - 1];
          const nextI = validIdx[vi];
          const prevNorm = normalized[prevI].normalizedReviewSum;
          const nextNorm = normalized[nextI].normalizedReviewSum;
          const gap = nextI - prevI;
          if (gap <= 0) continue;

          const totalDelta = nextNorm - prevNorm;
          const dailyDelta = totalDelta >= 0 ? Math.round(totalDelta / gap) : 0;
          const dailySales = dailyDelta * 20;

          for (let j = 1; j <= gap; j++) {
            const idx = prevI + j;
            const row = normalized[idx];

            await db.update(extKeywordDailyStats)
              .set({
                reviewGrowth: dailyDelta,
                salesEstimate: dailySales,
              })
              .where(eq(extKeywordDailyStats.id, row.id));

            rebuilt++;
          }
        }
      }

      return { success: true, rebuilt, keywords: byQuery.size };
    }),

});
