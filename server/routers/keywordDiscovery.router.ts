import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  keywordMaster,
  keywordDailyMetrics,
  keywordRelation,
  keywordSourcingCandidate,
  extKeywordDailyStats,
} from "../../drizzle/schema";
import { and, desc, eq, like, sql, inArray, asc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { expandNaverKeywords } from "../lib/naverAds";
import { normalizeKeyword, scoreKeyword } from "../lib/keywordScorer";

export const keywordDiscoveryRouter = router({
  // ===== Seed 키워드로 네이버 연관키워드 확장 수집 =====
  expandFromNaver: protectedProcedure
    .input(z.object({
      seeds: z.array(z.string().min(1).max(100)).min(1).max(10),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const results = await expandNaverKeywords(input.seeds);
      let inserted = 0;
      let skipped = 0;
      const today = new Date().toISOString().slice(0, 10);

      for (const r of results) {
        const normalized = normalizeKeyword(r.keyword);
        if (!normalized) { skipped++; continue; }

        // 중복 체크
        const existing = await db.select({ id: keywordMaster.id })
          .from(keywordMaster)
          .where(and(
            eq(keywordMaster.userId, ctx.user!.id),
            eq(keywordMaster.normalizedKeyword, normalized),
          ))
          .limit(1);

        let keywordId: number;

        if (existing.length > 0) {
          keywordId = existing[0].id;
          // lastSeenAt 갱신
          await db.update(keywordMaster)
            .set({ lastSeenAt: new Date().toISOString().replace("T", " ").slice(0, 19) })
            .where(eq(keywordMaster.id, keywordId));
          skipped++;
        } else {
          const res = await db.insert(keywordMaster).values({
            userId: ctx.user!.id,
            keyword: r.keyword,
            normalizedKeyword: normalized,
            sourceType: "naver_api",
            rootKeyword: input.seeds[0],
            keywordDepth: 1,
          });
          keywordId = Number((res as any)[0]?.insertId);
          inserted++;
        }

        // 일별 지표 저장 (당일 중복이면 스킵)
        const existingMetric = await db.select({ id: keywordDailyMetrics.id })
          .from(keywordDailyMetrics)
          .where(and(
            eq(keywordDailyMetrics.userId, ctx.user!.id),
            eq(keywordDailyMetrics.keywordId, keywordId),
            eq(keywordDailyMetrics.metricDate, today),
          ))
          .limit(1);

        if (!existingMetric.length) {
          await db.insert(keywordDailyMetrics).values({
            userId: ctx.user!.id,
            keywordId,
            metricDate: today,
            naverPcSearch: r.pcSearch,
            naverMobileSearch: r.mobileSearch,
            naverTotalSearch: r.totalSearch,
            naverCompetitionIndex: r.competition,
          });
        }
      }

      return { success: true, inserted, skipped, total: results.length };
    }),

  // ===== 수동 키워드 등록 =====
  addManualKeywords: protectedProcedure
    .input(z.object({
      keywords: z.array(z.string().min(1).max(255)).min(1).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      let inserted = 0;
      for (const kw of input.keywords) {
        const normalized = normalizeKeyword(kw);
        if (!normalized) continue;

        const existing = await db.select({ id: keywordMaster.id })
          .from(keywordMaster)
          .where(and(
            eq(keywordMaster.userId, ctx.user!.id),
            eq(keywordMaster.normalizedKeyword, normalized),
          ))
          .limit(1);

        if (!existing.length) {
          await db.insert(keywordMaster).values({
            userId: ctx.user!.id,
            keyword: kw.trim(),
            normalizedKeyword: normalized,
            sourceType: "manual",
          });
          inserted++;
        }
      }

      return { success: true, inserted };
    }),

  // ===== 키워드 마스터 목록 (필터/정렬/검색) =====
  listKeywords: protectedProcedure
    .input(z.object({
      search: z.string().max(200).default(""),
      sourceType: z.enum(["all", "naver_api", "coupang_autocomplete", "manual", "china", "extension"]).default("all"),
      sortBy: z.enum(["keyword", "total_search", "final_score", "created"]).default("created"),
      sortDir: z.enum(["asc", "desc"]).default("desc"),
      page: z.number().int().min(1).default(1),
      perPage: z.number().int().min(10).max(100).default(30),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const conditions: any[] = [eq(keywordMaster.userId, ctx.user!.id)];
      if (input.search) {
        conditions.push(like(keywordMaster.keyword, `%${input.search}%`));
      }
      if (input.sourceType !== "all") {
        conditions.push(eq(keywordMaster.sourceType, input.sourceType));
      }

      const [countResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(keywordMaster)
        .where(and(...conditions));

      const total = Number(countResult?.count ?? 0);
      const offset = (input.page - 1) * input.perPage;

      // 키워드 목록 + 최신 지표 조인
      const keywords = await db.select()
        .from(keywordMaster)
        .where(and(...conditions))
        .orderBy(
          input.sortBy === "keyword"
            ? (input.sortDir === "asc" ? asc(keywordMaster.keyword) : desc(keywordMaster.keyword))
            : (input.sortDir === "asc" ? asc(keywordMaster.firstSeenAt) : desc(keywordMaster.firstSeenAt)),
        )
        .limit(input.perPage)
        .offset(offset);

      // 각 키워드의 최신 지표 가져오기
      if (!keywords.length) return { items: [], total, page: input.page, totalPages: Math.ceil(total / input.perPage) };

      const keywordIds = keywords.map(k => k.id);
      const metrics = await db.select()
        .from(keywordDailyMetrics)
        .where(and(
          eq(keywordDailyMetrics.userId, ctx.user!.id),
          inArray(keywordDailyMetrics.keywordId, keywordIds),
          sql`(${keywordDailyMetrics.keywordId}, ${keywordDailyMetrics.metricDate}) IN (
            SELECT keyword_id, MAX(metric_date) FROM keyword_daily_metrics
            WHERE user_id = ${ctx.user!.id}
            AND keyword_id IN (${sql.join(keywordIds.map(id => sql`${id}`), sql`, `)})
            GROUP BY keyword_id
          )`,
        ));

      const metricsMap = new Map(metrics.map(m => [m.keywordId, m]));

      const items = keywords.map(kw => {
        const m = metricsMap.get(kw.id);
        return {
          ...kw,
          metrics: m || null,
        };
      });

      // 정렬 (지표 기반)
      if (input.sortBy === "total_search") {
        items.sort((a, b) => {
          const av = a.metrics?.naverTotalSearch || 0;
          const bv = b.metrics?.naverTotalSearch || 0;
          return input.sortDir === "desc" ? bv - av : av - bv;
        });
      } else if (input.sortBy === "final_score") {
        items.sort((a, b) => {
          const av = Number(a.metrics?.finalScore || 0);
          const bv = Number(b.metrics?.finalScore || 0);
          return input.sortDir === "desc" ? bv - av : av - bv;
        });
      }

      return { items, total, page: input.page, totalPages: Math.ceil(total / input.perPage) };
    }),

  // ===== 키워드 점수 계산 (배치 또는 단건) =====
  scoreKeywords: protectedProcedure
    .input(z.object({
      keywordIds: z.array(z.number().int()).min(1).max(50).optional(),
    }).optional())
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const today = new Date().toISOString().slice(0, 10);

      // 대상 키워드 조회
      const conditions: any[] = [eq(keywordMaster.userId, ctx.user!.id)];
      if (input?.keywordIds) {
        conditions.push(inArray(keywordMaster.id, input.keywordIds));
      }

      const keywords = await db.select()
        .from(keywordMaster)
        .where(and(...conditions))
        .limit(200);

      let scored = 0;

      for (const kw of keywords) {
        // 최신 지표
        const [metric] = await db.select()
          .from(keywordDailyMetrics)
          .where(and(
            eq(keywordDailyMetrics.userId, ctx.user!.id),
            eq(keywordDailyMetrics.keywordId, kw.id),
          ))
          .orderBy(desc(keywordDailyMetrics.metricDate))
          .limit(1);

        if (!metric) continue;

        // 쿠팡 데이터 연동 (extKeywordDailyStats에서 가져오기)
        const [coupangData] = await db.select()
          .from(extKeywordDailyStats)
          .where(and(
            eq(extKeywordDailyStats.userId, ctx.user!.id),
            like(extKeywordDailyStats.query, `%${kw.keyword}%`),
          ))
          .orderBy(desc(extKeywordDailyStats.statDate))
          .limit(1);

        // 점수 계산
        const result = scoreKeyword({
          naverTotalSearch: metric.naverTotalSearch || 0,
          naverCompetition: metric.naverCompetitionIndex || undefined,
          naverAvgCpc: Number(metric.naverAvgCpc) || 0,
          coupangProductCount: coupangData?.productCount || metric.coupangProductCount || 0,
          coupangAvgPrice: coupangData?.avgPrice || metric.coupangAvgPrice || 0,
          coupangTop10ReviewSum: coupangData?.totalReviewSum || metric.coupangTop10ReviewSum || 0,
          coupangTop10ReviewDelta: coupangData?.reviewGrowth || metric.coupangTop10ReviewDelta || 0,
          coupangNewProductReview30d: metric.coupangNewProductReview30d || 0,
          coupangOutOfStockCount: metric.coupangOutOfStockCount || 0,
        });

        // 지표 업데이트
        await db.update(keywordDailyMetrics)
          .set({
            marketGapScore: result.marketGapScore.toFixed(4),
            trendScore: result.trendSpikeScore.toFixed(4),
            hiddenScore: result.hiddenItemScore.toFixed(4),
            finalScore: result.finalScore.toFixed(4),
          })
          .where(eq(keywordDailyMetrics.id, metric.id));

        scored++;
      }

      return { success: true, scored };
    }),

  // ===== 키워드 삭제 =====
  deleteKeywords: protectedProcedure
    .input(z.object({
      ids: z.array(z.number().int()).min(1).max(50),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 관련 지표 삭제
      await db.delete(keywordDailyMetrics)
        .where(and(
          eq(keywordDailyMetrics.userId, ctx.user!.id),
          inArray(keywordDailyMetrics.keywordId, input.ids),
        ));

      // 키워드 삭제
      await db.delete(keywordMaster)
        .where(and(
          eq(keywordMaster.userId, ctx.user!.id),
          inArray(keywordMaster.id, input.ids),
        ));

      return { success: true, deleted: input.ids.length };
    }),

  // ===== 대시보드 요약 =====
  overview: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [stats] = await db.select({
        totalKeywords: sql<number>`COUNT(*)`,
        naverCount: sql<number>`SUM(CASE WHEN source_type = 'naver_api' THEN 1 ELSE 0 END)`,
        manualCount: sql<number>`SUM(CASE WHEN source_type = 'manual' THEN 1 ELSE 0 END)`,
        extensionCount: sql<number>`SUM(CASE WHEN source_type = 'extension' THEN 1 ELSE 0 END)`,
      })
        .from(keywordMaster)
        .where(eq(keywordMaster.userId, ctx.user!.id));

      return {
        totalKeywords: Number(stats?.totalKeywords || 0),
        naverCount: Number(stats?.naverCount || 0),
        manualCount: Number(stats?.manualCount || 0),
        extensionCount: Number(stats?.extensionCount || 0),
      };
    }),

  // ===== 급상승 / 블루오션 / 숨은아이템 탭별 조회 =====
  getDiscoveryList: protectedProcedure
    .input(z.object({
      tab: z.enum(["trending", "blue_ocean", "hidden", "high_margin", "overheated"]).default("trending"),
      limit: z.number().int().min(10).max(100).default(30),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 모든 키워드 + 최신 지표 가져와서 점수별 정렬
      const keywords = await db.select()
        .from(keywordMaster)
        .where(eq(keywordMaster.userId, ctx.user!.id));

      if (!keywords.length) return [];

      const keywordIds = keywords.map(k => k.id);
      const metrics = await db.select()
        .from(keywordDailyMetrics)
        .where(and(
          eq(keywordDailyMetrics.userId, ctx.user!.id),
          inArray(keywordDailyMetrics.keywordId, keywordIds),
          sql`(${keywordDailyMetrics.keywordId}, ${keywordDailyMetrics.metricDate}) IN (
            SELECT keyword_id, MAX(metric_date) FROM keyword_daily_metrics
            WHERE user_id = ${ctx.user!.id}
            GROUP BY keyword_id
          )`,
        ));

      const metricsMap = new Map(metrics.map(m => [m.keywordId, m]));

      const items = keywords
        .map(kw => {
          const m = metricsMap.get(kw.id);
          const search = m?.naverTotalSearch || 0;
          const products = m?.coupangProductCount || 0;
          const reviewDelta = m?.coupangTop10ReviewDelta || 0;

          // 점수 계산
          const scores = scoreKeyword({
            naverTotalSearch: search,
            coupangProductCount: products,
            coupangTop10ReviewSum: m?.coupangTop10ReviewSum || 0,
            coupangTop10ReviewDelta: reviewDelta,
            coupangAvgPrice: m?.coupangAvgPrice || 0,
            coupangNewProductReview30d: m?.coupangNewProductReview30d || 0,
            coupangOutOfStockCount: m?.coupangOutOfStockCount || 0,
          });

          return { ...kw, metrics: m, scores };
        });

      // 탭별 필터/정렬
      switch (input.tab) {
        case "trending":
          return items
            .filter(i => i.scores.salesVelocityScore > 0 || i.scores.trendSpikeScore > 0)
            .sort((a, b) => (b.scores.salesVelocityScore + b.scores.trendSpikeScore) - (a.scores.salesVelocityScore + a.scores.trendSpikeScore))
            .slice(0, input.limit);

        case "blue_ocean":
          return items
            .filter(i => i.scores.marketGapScore >= 30)
            .sort((a, b) => b.scores.marketGapScore - a.scores.marketGapScore)
            .slice(0, input.limit);

        case "hidden":
          return items
            .filter(i => i.scores.hiddenItemScore >= 20)
            .sort((a, b) => b.scores.hiddenItemScore - a.scores.hiddenItemScore)
            .slice(0, input.limit);

        case "high_margin":
          return items
            .filter(i => i.scores.chinaArbitrageScore > 0)
            .sort((a, b) => b.scores.chinaArbitrageScore - a.scores.chinaArbitrageScore)
            .slice(0, input.limit);

        case "overheated":
          return items
            .filter(i => i.scores.marketGapScore < 20 && (i.metrics?.naverTotalSearch || 0) > 0)
            .sort((a, b) => a.scores.marketGapScore - b.scores.marketGapScore)
            .slice(0, input.limit);

        default:
          return items
            .sort((a, b) => b.scores.finalScore - a.scores.finalScore)
            .slice(0, input.limit);
      }
    }),

  // ===== 네이버 API 설정 상태 확인 =====
  checkNaverApiConfig: protectedProcedure
    .query(() => {
      return {
        configured: !!(
          process.env.NAVER_API_KEY &&
          process.env.NAVER_SECRET_KEY &&
          process.env.NAVER_CUSTOMER_ID
        ),
      };
    }),

  // ===== DB 통계 (데이터 관리용) =====
  dbStats: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // keyword_master 수
      const [masterStats] = await db.select({
        total: sql<number>`COUNT(*)`,
        naverCount: sql<number>`SUM(CASE WHEN source_type = 'naver_api' THEN 1 ELSE 0 END)`,
        extensionCount: sql<number>`SUM(CASE WHEN source_type = 'extension' THEN 1 ELSE 0 END)`,
        manualCount: sql<number>`SUM(CASE WHEN source_type = 'manual' THEN 1 ELSE 0 END)`,
        noScoreCount: sql<number>`COUNT(*) - (
          SELECT COUNT(DISTINCT km2.id) FROM keyword_master km2
          JOIN keyword_daily_metrics kdm ON km2.id = kdm.keyword_id
          WHERE km2.user_id = ${ctx.user!.id} AND kdm.final_score > 0
        )`,
      }).from(keywordMaster).where(eq(keywordMaster.userId, ctx.user!.id));

      // keyword_daily_metrics 수
      const [metricsStats] = await db.select({
        total: sql<number>`COUNT(*)`,
        oldCount: sql<number>`SUM(CASE WHEN metric_date < DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 30 DAY), '%Y-%m-%d') THEN 1 ELSE 0 END)`,
        uniqueDates: sql<number>`COUNT(DISTINCT metric_date)`,
      }).from(keywordDailyMetrics).where(eq(keywordDailyMetrics.userId, ctx.user!.id));

      // ext_keyword_daily_stats 수
      const [extStats] = await db.select({
        total: sql<number>`COUNT(*)`,
        uniqueKeywords: sql<number>`COUNT(DISTINCT \`query\`)`,
      }).from(extKeywordDailyStats).where(eq(extKeywordDailyStats.userId, ctx.user!.id));

      // 확장(extension) 키워드 중 아직 네이버 확장 안된 키워드 수
      const [unmatchedExt] = await db.select({
        count: sql<number>`COUNT(DISTINCT ess.query)`,
      }).from(sql`ext_search_snapshots ess`)
        .where(sql`ess.user_id = ${ctx.user!.id}
          AND NOT EXISTS (
            SELECT 1 FROM keyword_master km
            WHERE km.user_id = ${ctx.user!.id}
            AND km.normalized_keyword = LOWER(TRIM(ess.query))
          )`);

      return {
        keywordMaster: {
          total: Number(masterStats?.total || 0),
          naverCount: Number(masterStats?.naverCount || 0),
          extensionCount: Number(masterStats?.extensionCount || 0),
          manualCount: Number(masterStats?.manualCount || 0),
          noScoreCount: Number(masterStats?.noScoreCount || 0),
        },
        dailyMetrics: {
          total: Number(metricsStats?.total || 0),
          oldCount: Number(metricsStats?.oldCount || 0),
          uniqueDates: Number(metricsStats?.uniqueDates || 0),
        },
        extKeywordStats: {
          total: Number(extStats?.total || 0),
          uniqueKeywords: Number(extStats?.uniqueKeywords || 0),
        },
        unmatchedExtensionKeywords: Number(unmatchedExt?.count || 0),
      };
    }),

  // ===== 자동 정리 (오래된 메트릭 + 저점수 키워드 삭제) =====
  autoCleanup: protectedProcedure
    .input(z.object({
      retentionDays: z.number().int().min(7).max(365).default(30),
      deleteZeroScore: z.boolean().default(false),
      deleteInactive: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      let deletedMetrics = 0;
      let deletedKeywords = 0;

      // 1. 오래된 일별 지표 삭제 (retentionDays 이전)
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - input.retentionDays);
      const cutoffStr = cutoffDate.toISOString().slice(0, 10);

      const oldMetricsResult = await db.delete(keywordDailyMetrics)
        .where(and(
          eq(keywordDailyMetrics.userId, ctx.user!.id),
          sql`${keywordDailyMetrics.metricDate} < ${cutoffStr}`,
        ));
      deletedMetrics = (oldMetricsResult as any)?.[0]?.affectedRows || 0;

      // 2. 점수 0인 키워드 삭제 (옵션)
      if (input.deleteZeroScore) {
        // 점수가 없는(finalScore = 0이거나 메트릭이 아예 없는) 키워드 찾기
        const zeroScoreKeywords = await db.select({ id: keywordMaster.id })
          .from(keywordMaster)
          .where(and(
            eq(keywordMaster.userId, ctx.user!.id),
            sql`${keywordMaster.id} NOT IN (
              SELECT DISTINCT keyword_id FROM keyword_daily_metrics
              WHERE user_id = ${ctx.user!.id} AND CAST(final_score AS DECIMAL(10,4)) > 0
            )`,
          ))
          .limit(500);

        if (zeroScoreKeywords.length) {
          const ids = zeroScoreKeywords.map(k => k.id);
          await db.delete(keywordDailyMetrics)
            .where(and(
              eq(keywordDailyMetrics.userId, ctx.user!.id),
              inArray(keywordDailyMetrics.keywordId, ids),
            ));
          await db.delete(keywordMaster)
            .where(and(
              eq(keywordMaster.userId, ctx.user!.id),
              inArray(keywordMaster.id, ids),
            ));
          deletedKeywords = ids.length;
        }
      }

      // 3. 비활성 키워드 삭제 (30일 이상 미접근)
      if (input.deleteInactive) {
        const inactiveCutoff = new Date();
        inactiveCutoff.setDate(inactiveCutoff.getDate() - 30);
        const inactiveStr = inactiveCutoff.toISOString().replace("T", " ").slice(0, 19);

        const inactiveKeywords = await db.select({ id: keywordMaster.id })
          .from(keywordMaster)
          .where(and(
            eq(keywordMaster.userId, ctx.user!.id),
            eq(keywordMaster.isActive, false),
            sql`${keywordMaster.lastSeenAt} < ${inactiveStr}`,
          ))
          .limit(500);

        if (inactiveKeywords.length) {
          const ids = inactiveKeywords.map(k => k.id);
          await db.delete(keywordDailyMetrics)
            .where(and(
              eq(keywordDailyMetrics.userId, ctx.user!.id),
              inArray(keywordDailyMetrics.keywordId, ids),
            ));
          await db.delete(keywordMaster)
            .where(and(
              eq(keywordMaster.userId, ctx.user!.id),
              inArray(keywordMaster.id, ids),
            ));
          deletedKeywords += ids.length;
        }
      }

      return { success: true, deletedMetrics, deletedKeywords };
    }),

  // ===== 익스텐션 키워드 일괄 확장 (크롬에서 수집된 키워드 → 네이버 자동 확장) =====
  autoExpandExtensionKeywords: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 익스텐션(ext_search_snapshots)에서 수집된 키워드 중
      // keyword_master에 아직 없는 것들 가져오기
      const unmatchedRows = await db.select({
        query: sql<string>`DISTINCT ess.query`,
      }).from(sql`ext_search_snapshots ess`)
        .where(sql`ess.user_id = ${ctx.user!.id}
          AND NOT EXISTS (
            SELECT 1 FROM keyword_master km
            WHERE km.user_id = ${ctx.user!.id}
            AND km.normalized_keyword = LOWER(TRIM(ess.query))
          )`)
        .limit(50); // 한번에 50개씩 처리

      if (!unmatchedRows.length) {
        return { success: true, message: "확장할 키워드가 없습니다", expanded: 0, inserted: 0, skipped: 0 };
      }

      const seeds = unmatchedRows.map((r: any) => r.query).filter(Boolean);
      if (!seeds.length) {
        return { success: true, message: "유효한 키워드가 없습니다", expanded: 0, inserted: 0, skipped: 0 };
      }

      // 네이버 API 호출 (최대 10개씩 배치)
      const today = new Date().toISOString().slice(0, 10);
      let totalInserted = 0;
      let totalSkipped = 0;

      // 네이버 API는 한번에 최대 5개 seed 가능, 총 10배치 = 50키워드
      const batchSize = 5;
      for (let i = 0; i < seeds.length; i += batchSize) {
        const batch = seeds.slice(i, i + batchSize);
        try {
          const results = await expandNaverKeywords(batch);

          for (const r of results) {
            const normalized = normalizeKeyword(r.keyword);
            if (!normalized) { totalSkipped++; continue; }

            const existing = await db.select({ id: keywordMaster.id })
              .from(keywordMaster)
              .where(and(
                eq(keywordMaster.userId, ctx.user!.id),
                eq(keywordMaster.normalizedKeyword, normalized),
              ))
              .limit(1);

            let keywordId: number;

            if (existing.length > 0) {
              keywordId = existing[0].id;
              await db.update(keywordMaster)
                .set({ lastSeenAt: new Date().toISOString().replace("T", " ").slice(0, 19) })
                .where(eq(keywordMaster.id, keywordId));
              totalSkipped++;
            } else {
              const res = await db.insert(keywordMaster).values({
                userId: ctx.user!.id,
                keyword: r.keyword,
                normalizedKeyword: normalized,
                sourceType: "naver_api",
                rootKeyword: batch[0],
                keywordDepth: 1,
              });
              keywordId = Number((res as any)[0]?.insertId);
              totalInserted++;
            }

            // 일별 지표 저장
            const existingMetric = await db.select({ id: keywordDailyMetrics.id })
              .from(keywordDailyMetrics)
              .where(and(
                eq(keywordDailyMetrics.userId, ctx.user!.id),
                eq(keywordDailyMetrics.keywordId, keywordId),
                eq(keywordDailyMetrics.metricDate, today),
              ))
              .limit(1);

            if (!existingMetric.length) {
              await db.insert(keywordDailyMetrics).values({
                userId: ctx.user!.id,
                keywordId,
                metricDate: today,
                naverPcSearch: r.pcSearch,
                naverMobileSearch: r.mobileSearch,
                naverTotalSearch: r.totalSearch,
                naverCompetitionIndex: r.competition,
              });
            }
          }
        } catch (err: any) {
          // 개별 배치 실패는 건너뛰기 (API 제한 등)
          console.error(`Naver API batch error for seeds [${batch.join(", ")}]:`, err.message);
        }

        // 네이버 API 호출 간격 (rate limit 방지)
        if (i + batchSize < seeds.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      return {
        success: true,
        message: `${seeds.length}개 키워드 처리 완료`,
        expanded: seeds.length,
        inserted: totalInserted,
        skipped: totalSkipped,
      };
    }),

  // ===== 전체 키워드 일괄 네이버 확장 (keyword_master의 모든 키워드 재수집) =====
  bulkRefreshNaverData: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // keyword_master에서 오늘 메트릭이 없는 키워드 가져오기
      const today = new Date().toISOString().slice(0, 10);
      const keywords = await db.select({
        id: keywordMaster.id,
        keyword: keywordMaster.keyword,
      })
        .from(keywordMaster)
        .where(and(
          eq(keywordMaster.userId, ctx.user!.id),
          eq(keywordMaster.isActive, true),
          sql`${keywordMaster.id} NOT IN (
            SELECT keyword_id FROM keyword_daily_metrics
            WHERE user_id = ${ctx.user!.id} AND metric_date = ${today}
          )`,
        ))
        .limit(100); // 한번에 100개씩

      if (!keywords.length) {
        return { success: true, message: "모든 키워드가 최신 상태입니다", refreshed: 0 };
      }

      let refreshed = 0;
      const batchSize = 5;
      const seedBatches: string[][] = [];

      for (let i = 0; i < keywords.length; i += batchSize) {
        seedBatches.push(keywords.slice(i, i + batchSize).map(k => k.keyword));
      }

      for (const batch of seedBatches) {
        try {
          const results = await expandNaverKeywords(batch);

          for (const r of results) {
            const normalized = normalizeKeyword(r.keyword);
            if (!normalized) continue;

            // 기존 키워드 매칭
            const [match] = await db.select({ id: keywordMaster.id })
              .from(keywordMaster)
              .where(and(
                eq(keywordMaster.userId, ctx.user!.id),
                eq(keywordMaster.normalizedKeyword, normalized),
              ))
              .limit(1);

            if (!match) continue;

            // 오늘 메트릭 upsert
            const [existingMetric] = await db.select({ id: keywordDailyMetrics.id })
              .from(keywordDailyMetrics)
              .where(and(
                eq(keywordDailyMetrics.userId, ctx.user!.id),
                eq(keywordDailyMetrics.keywordId, match.id),
                eq(keywordDailyMetrics.metricDate, today),
              ))
              .limit(1);

            if (existingMetric) {
              await db.update(keywordDailyMetrics)
                .set({
                  naverPcSearch: r.pcSearch,
                  naverMobileSearch: r.mobileSearch,
                  naverTotalSearch: r.totalSearch,
                  naverCompetitionIndex: r.competition,
                })
                .where(eq(keywordDailyMetrics.id, existingMetric.id));
            } else {
              await db.insert(keywordDailyMetrics).values({
                userId: ctx.user!.id,
                keywordId: match.id,
                metricDate: today,
                naverPcSearch: r.pcSearch,
                naverMobileSearch: r.mobileSearch,
                naverTotalSearch: r.totalSearch,
                naverCompetitionIndex: r.competition,
              });
            }
            refreshed++;
          }
        } catch (err: any) {
          console.error(`Naver refresh batch error:`, err.message);
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      }

      return { success: true, refreshed, total: keywords.length };
    }),
});
