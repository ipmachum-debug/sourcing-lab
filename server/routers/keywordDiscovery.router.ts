import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  keywordMaster,
  keywordDailyMetrics,
  extKeywordDailyStats,
  extWatchKeywords,
} from "../../drizzle/schema";
import { and, desc, eq, like, sql, inArray, asc, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { validateKeywordsWithNaver } from "../lib/naverAds";
import { normalizeKeyword, scoreKeyword } from "../lib/keywordScorer";

export const keywordDiscoveryRouter = router({
  // ===== 1. 후보 키워드 목록 (쿠팡 수집 기반) =====
  listCandidates: protectedProcedure
    .input(z.object({
      search: z.string().max(200).default(""),
      status: z.enum(["all", "pending", "validated", "rejected", "recommended"]).default("all"),
      sortBy: z.enum(["keyword", "priority", "final_score", "created"]).default("priority"),
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
      if (input.status !== "all") {
        conditions.push(eq(keywordMaster.validationStatus, input.status));
      }

      const [countResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(keywordMaster)
        .where(and(...conditions));

      const total = Number(countResult?.count ?? 0);
      const offset = (input.page - 1) * input.perPage;

      let orderBy: any;
      if (input.sortBy === "keyword") {
        orderBy = input.sortDir === "asc" ? asc(keywordMaster.keyword) : desc(keywordMaster.keyword);
      } else if (input.sortBy === "priority") {
        orderBy = input.sortDir === "asc" ? asc(keywordMaster.validationPriority) : desc(keywordMaster.validationPriority);
      } else {
        orderBy = input.sortDir === "asc" ? asc(keywordMaster.firstSeenAt) : desc(keywordMaster.firstSeenAt);
      }

      const keywords = await db.select()
        .from(keywordMaster)
        .where(and(...conditions))
        .orderBy(orderBy)
        .limit(input.perPage)
        .offset(offset);

      if (!keywords.length) return { items: [], total, page: input.page, totalPages: Math.ceil(total / input.perPage) };

      // 최신 지표 조인
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

      const items = keywords.map(kw => ({
        ...kw,
        metrics: metricsMap.get(kw.id) || null,
      }));

      // final_score 정렬
      if (input.sortBy === "final_score") {
        items.sort((a, b) => {
          const av = Number(a.metrics?.finalScore || 0);
          const bv = Number(b.metrics?.finalScore || 0);
          return input.sortDir === "desc" ? bv - av : av - bv;
        });
      }

      return { items, total, page: input.page, totalPages: Math.ceil(total / input.perPage) };
    }),

  // ===== 2. 네이버 검증 실행 (확장 아닌 검증만) =====
  validateWithNaver: protectedProcedure
    .input(z.object({
      keywordIds: z.array(z.number().int()).min(1).max(50),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 대상 키워드 조회
      const keywords = await db.select()
        .from(keywordMaster)
        .where(and(
          eq(keywordMaster.userId, ctx.user!.id),
          inArray(keywordMaster.id, input.keywordIds),
        ));

      if (!keywords.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "키워드를 찾을 수 없습니다" });
      }

      const keywordTexts = keywords.map(k => k.keyword);
      const today = new Date().toISOString().slice(0, 10);
      const now = new Date().toISOString().replace("T", " ").slice(0, 19);

      // 네이버 API 검증 (배치 5개씩)
      let validated = 0;
      let rejected = 0;
      const recommendedKeywords: { keyword: string; totalSearch: number; competition: string; parentId: number }[] = [];

      const batchSize = 5;
      for (let i = 0; i < keywordTexts.length; i += batchSize) {
        const batch = keywordTexts.slice(i, i + batchSize);
        const batchKeywords = keywords.slice(i, i + batchSize);

        try {
          const results = await validateKeywordsWithNaver(batch);
          const resultMap = new Map(results.map(r => [r.keyword.trim().toLowerCase().replace(/\s+/g, " "), r]));

          for (const kw of batchKeywords) {
            const key = kw.keyword.trim().toLowerCase().replace(/\s+/g, " ");
            const result = resultMap.get(key);

            if (!result) {
              // 네이버 데이터 없음 → rejected
              await db.update(keywordMaster)
                .set({
                  validationStatus: "rejected",
                  lastValidatedAt: now,
                })
                .where(eq(keywordMaster.id, kw.id));
              rejected++;
              continue;
            }

            // 검증 상태 업데이트
            await db.update(keywordMaster)
              .set({
                validationStatus: result.passed ? "validated" : "rejected",
                lastValidatedAt: now,
              })
              .where(eq(keywordMaster.id, kw.id));

            if (result.passed) validated++;
            else rejected++;

            // 쿠팡 데이터 조회 (점수 계산용)
            const [coupangData] = await db.select()
              .from(extKeywordDailyStats)
              .where(and(
                eq(extKeywordDailyStats.userId, ctx.user!.id),
                like(extKeywordDailyStats.query, `%${kw.keyword}%`),
              ))
              .orderBy(desc(extKeywordDailyStats.statDate))
              .limit(1);

            // 점수 계산
            const scores = scoreKeyword({
              naverTotalSearch: result.totalSearch,
              naverCompetition: result.competition,
              naverAvgCpc: result.avgCpc,
              coupangProductCount: coupangData?.productCount || 0,
              coupangAvgPrice: coupangData?.avgPrice || 0,
              coupangTop10ReviewSum: coupangData?.totalReviewSum || 0,
              coupangTop10ReviewDelta: coupangData?.reviewGrowth || 0,
            });

            // 일별 지표 upsert
            const [existingMetric] = await db.select({ id: keywordDailyMetrics.id })
              .from(keywordDailyMetrics)
              .where(and(
                eq(keywordDailyMetrics.userId, ctx.user!.id),
                eq(keywordDailyMetrics.keywordId, kw.id),
                eq(keywordDailyMetrics.metricDate, today),
              ))
              .limit(1);

            const metricData = {
              naverPcSearch: result.pcSearch,
              naverMobileSearch: result.mobileSearch,
              naverTotalSearch: result.totalSearch,
              naverCompetitionIndex: result.competition,
              coupangProductCount: coupangData?.productCount || 0,
              coupangAvgPrice: coupangData?.avgPrice || 0,
              coupangTop10ReviewSum: coupangData?.totalReviewSum || 0,
              coupangTop10ReviewDelta: coupangData?.reviewGrowth || 0,
              marketGapScore: scores.marketGapScore.toFixed(4),
              trendScore: scores.trendSpikeScore.toFixed(4),
              hiddenScore: scores.hiddenItemScore.toFixed(4),
              sourcingScore: scores.coupangBaseScore.toFixed(4),
              finalScore: scores.finalScore.toFixed(4),
              coupangBaseScore: scores.coupangBaseScore.toFixed(4),
              naverValidationScore: scores.naverValidationScore.toFixed(4),
              validationPassed: result.passed,
              rejectReason: result.rejectReason || null,
            };

            if (existingMetric) {
              await db.update(keywordDailyMetrics)
                .set(metricData)
                .where(eq(keywordDailyMetrics.id, existingMetric.id));
            } else {
              await db.insert(keywordDailyMetrics).values({
                userId: ctx.user!.id,
                keywordId: kw.id,
                metricDate: today,
                ...metricData,
              });
            }

            // 추천 키워드 수집
            for (const rec of result.recommendations) {
              recommendedKeywords.push({
                keyword: rec.keyword,
                totalSearch: rec.totalSearch,
                competition: rec.competition,
                parentId: kw.id,
              });
            }
          }
        } catch (err: any) {
          console.error(`Naver validation batch error:`, err.message);
        }

        if (i + batchSize < keywordTexts.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // 추천 키워드 등록 (TTL 7일, 중복 제외)
      let recommendedInserted = 0;
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        .toISOString().replace("T", " ").slice(0, 19);

      for (const rec of recommendedKeywords) {
        const normalized = normalizeKeyword(rec.keyword);
        if (!normalized) continue;

        const [existing] = await db.select({ id: keywordMaster.id })
          .from(keywordMaster)
          .where(and(
            eq(keywordMaster.userId, ctx.user!.id),
            eq(keywordMaster.normalizedKeyword, normalized),
          ))
          .limit(1);

        if (existing) continue;

        await db.insert(keywordMaster).values({
          userId: ctx.user!.id,
          keyword: rec.keyword,
          normalizedKeyword: normalized,
          sourceType: "naver_api",
          rootKeyword: keywords.find(k => k.id === rec.parentId)?.keyword,
          keywordDepth: 1,
          validationStatus: "recommended",
          validationPriority: 30,
          recommendedExpiresAt: expiresAt,
        });
        recommendedInserted++;
      }

      return { success: true, validated, rejected, recommendedInserted };
    }),

  // ===== 3. 추천 키워드 수락 (recommended → pending 전환) =====
  acceptRecommendation: protectedProcedure
    .input(z.object({
      keywordIds: z.array(z.number().int()).min(1).max(50),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.update(keywordMaster)
        .set({
          validationStatus: "pending",
          validationPriority: 60,
          recommendedExpiresAt: null,
        })
        .where(and(
          eq(keywordMaster.userId, ctx.user!.id),
          inArray(keywordMaster.id, input.keywordIds),
          eq(keywordMaster.validationStatus, "recommended"),
        ));

      return { success: true, accepted: input.keywordIds.length };
    }),

  // ===== 4. 감시 목록에 추가 (validated → ext_watch_keywords 연동) =====
  promoteToWatch: protectedProcedure
    .input(z.object({
      keywordIds: z.array(z.number().int()).min(1).max(50),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const keywords = await db.select()
        .from(keywordMaster)
        .where(and(
          eq(keywordMaster.userId, ctx.user!.id),
          inArray(keywordMaster.id, input.keywordIds),
        ));

      let promoted = 0;
      for (const kw of keywords) {
        // ext_watch_keywords에 중복 체크
        const [existing] = await db.select({ id: extWatchKeywords.id })
          .from(extWatchKeywords)
          .where(and(
            eq(extWatchKeywords.userId, ctx.user!.id),
            eq(extWatchKeywords.keyword, kw.keyword),
          ))
          .limit(1);

        if (existing) {
          // 연결만 업데이트
          await db.update(extWatchKeywords)
            .set({ keywordMasterId: kw.id, watchReason: "naver_validated", watchStatus: "promoted" })
            .where(eq(extWatchKeywords.id, existing.id));
        } else {
          await db.insert(extWatchKeywords).values({
            userId: ctx.user!.id,
            keyword: kw.keyword,
            priority: 70,
            keywordMasterId: kw.id,
            watchReason: "naver_validated",
            watchStatus: "promoted",
          });
        }
        promoted++;
      }

      return { success: true, promoted };
    }),

  // ===== 5. 수동 키워드 등록 =====
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
            validationStatus: "pending",
            validationPriority: 60,
          });
          inserted++;
        }
      }

      return { success: true, inserted };
    }),

  // ===== 6. 점수 계산 (배치) =====
  scoreKeywords: protectedProcedure
    .input(z.object({
      keywordIds: z.array(z.number().int()).min(1).max(50).optional(),
    }).optional())
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const today = new Date().toISOString().slice(0, 10);
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
        const [metric] = await db.select()
          .from(keywordDailyMetrics)
          .where(and(
            eq(keywordDailyMetrics.userId, ctx.user!.id),
            eq(keywordDailyMetrics.keywordId, kw.id),
          ))
          .orderBy(desc(keywordDailyMetrics.metricDate))
          .limit(1);

        if (!metric) continue;

        const [coupangData] = await db.select()
          .from(extKeywordDailyStats)
          .where(and(
            eq(extKeywordDailyStats.userId, ctx.user!.id),
            like(extKeywordDailyStats.query, `%${kw.keyword}%`),
          ))
          .orderBy(desc(extKeywordDailyStats.statDate))
          .limit(1);

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

        await db.update(keywordDailyMetrics)
          .set({
            marketGapScore: result.marketGapScore.toFixed(4),
            trendScore: result.trendSpikeScore.toFixed(4),
            hiddenScore: result.hiddenItemScore.toFixed(4),
            sourcingScore: result.coupangBaseScore.toFixed(4),
            finalScore: result.finalScore.toFixed(4),
            coupangBaseScore: result.coupangBaseScore.toFixed(4),
            naverValidationScore: result.naverValidationScore.toFixed(4),
          })
          .where(eq(keywordDailyMetrics.id, metric.id));

        scored++;
      }

      return { success: true, scored };
    }),

  // ===== 7. 키워드 삭제 =====
  deleteKeywords: protectedProcedure
    .input(z.object({
      ids: z.array(z.number().int()).min(1).max(50),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.delete(keywordDailyMetrics)
        .where(and(
          eq(keywordDailyMetrics.userId, ctx.user!.id),
          inArray(keywordDailyMetrics.keywordId, input.ids),
        ));

      await db.delete(keywordMaster)
        .where(and(
          eq(keywordMaster.userId, ctx.user!.id),
          inArray(keywordMaster.id, input.ids),
        ));

      return { success: true, deleted: input.ids.length };
    }),

  // ===== 8. 대시보드 요약 =====
  overview: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [stats] = await db.select({
        totalKeywords: sql<number>`COUNT(*)`,
        pendingCount: sql<number>`SUM(CASE WHEN validation_status = 'pending' THEN 1 ELSE 0 END)`,
        validatedCount: sql<number>`SUM(CASE WHEN validation_status = 'validated' THEN 1 ELSE 0 END)`,
        rejectedCount: sql<number>`SUM(CASE WHEN validation_status = 'rejected' THEN 1 ELSE 0 END)`,
        recommendedCount: sql<number>`SUM(CASE WHEN validation_status = 'recommended' THEN 1 ELSE 0 END)`,
      })
        .from(keywordMaster)
        .where(eq(keywordMaster.userId, ctx.user!.id));

      return {
        totalKeywords: Number(stats?.totalKeywords || 0),
        pendingCount: Number(stats?.pendingCount || 0),
        validatedCount: Number(stats?.validatedCount || 0),
        rejectedCount: Number(stats?.rejectedCount || 0),
        recommendedCount: Number(stats?.recommendedCount || 0),
      };
    }),

  // ===== 9. 네이버 API 설정 상태 확인 =====
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

  // ===== 10. 만료된 추천 키워드 자동 정리 =====
  cleanExpiredRecommendations: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const now = new Date().toISOString().replace("T", " ").slice(0, 19);

      // 만료된 추천 키워드 삭제
      const expired = await db.select({ id: keywordMaster.id })
        .from(keywordMaster)
        .where(and(
          eq(keywordMaster.userId, ctx.user!.id),
          eq(keywordMaster.validationStatus, "recommended"),
          sql`${keywordMaster.recommendedExpiresAt} IS NOT NULL AND ${keywordMaster.recommendedExpiresAt} < ${now}`,
        ))
        .limit(200);

      if (!expired.length) return { success: true, deleted: 0 };

      const ids = expired.map(k => k.id);
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

      return { success: true, deleted: ids.length };
    }),

  // ===== 11. 검증 대상 자동 선택 (우선순위 기반 top N) =====
  getValidationQueue: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(20).default(10),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const keywords = await db.select()
        .from(keywordMaster)
        .where(and(
          eq(keywordMaster.userId, ctx.user!.id),
          eq(keywordMaster.validationStatus, "pending"),
          eq(keywordMaster.isActive, true),
        ))
        .orderBy(desc(keywordMaster.validationPriority))
        .limit(input.limit);

      return keywords;
    }),
});
