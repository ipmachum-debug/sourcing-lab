import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  extSearchSnapshots, extCandidates, extRankTrackings, extTrackedKeywords,
  extProductDetails, extNotifications, extReviewAnalyses, extWingSearches,
  extKeywordDailyStats, extProductTrackings, extProductDailySnapshots,
  extCategoryReviewRates, extProductSalesEstimates,
  extSearchEvents, extWatchKeywords, extKeywordDailyStatus,
  products, productChannelMappings
} from "../../drizzle/schema";
import {
  calculateSalesEstimate, buildWindowMetrics, matchCategoryKey,
  DEFAULT_CATEGORY_REVIEW_RATES, getSalesGradeLabel,
  type EstimateInput, type SnapshotRow
} from "../salesEstimate";
import { eq, and, desc, sql, like, asc, gte, ne, lt, isNull } from "drizzle-orm";
import {
  selectBatchKeywords, computeDailyAggregation, runDailyBatch,
  recomputeCompositeScore, diagnoseParsingQuality,
  normalizeKeyword, detectDuplicateKeywords,
} from "../batchCollector";
import { TRPCError } from "@trpc/server";

/** Drizzle-ORM returns decimal/SUM/AVG/COUNT results as string — always coerce to number */
function N(v: any): number { return Number(v) || 0; }

export const extensionRouter = router({
  // ===== 검색 스냅샷 =====

  // 검색 스냅샷 저장 (확장프로그램에서 호출)
  saveSnapshot: protectedProcedure
    .input(z.object({
      query: z.string().min(1).max(255),
      totalItems: z.number().int().default(0),
      avgPrice: z.number().int().default(0),
      avgRating: z.number().default(0),
      avgReview: z.number().int().default(0),
      highReviewRatio: z.number().int().default(0),
      adCount: z.number().int().default(0),
      competitionScore: z.number().int().default(0),
      competitionLevel: z.enum(["easy", "medium", "hard"]).default("medium"),
      items: z.array(z.any()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      // 같은 사용자 + 같은 검색어가 이미 있으면 업데이트 (중복 방지)
      const [existing] = await db.select({ id: extSearchSnapshots.id })
        .from(extSearchSnapshots)
        .where(and(
          eq(extSearchSnapshots.userId, ctx.user!.id),
          eq(extSearchSnapshots.query, input.query),
        ))
        .orderBy(desc(extSearchSnapshots.createdAt))
        .limit(1);

      if (existing) {
        // 기존 레코드 업데이트
        await db.update(extSearchSnapshots)
          .set({
            totalItems: input.totalItems,
            avgPrice: input.avgPrice,
            avgRating: input.avgRating.toFixed(1),
            avgReview: input.avgReview,
            highReviewRatio: input.highReviewRatio,
            adCount: input.adCount,
            competitionScore: input.competitionScore,
            competitionLevel: input.competitionLevel,
            itemsJson: input.items ? JSON.stringify(input.items) : null,
          })
          .where(eq(extSearchSnapshots.id, existing.id));
        // 자동으로 일별 통계 계산 (비동기, 실패 무시)
        autoComputeKeywordDailyStat(ctx.user!.id, input.query, db).catch(() => {});
        // 추적 상품 자동 매칭 (비동기, 실패 무시)
        autoMatchTrackedProducts(ctx.user!.id, input.query, input.items || [], db).catch(() => {});
        return { success: true, id: existing.id, updated: true };
      }

      // 신규 저장
      const result = await db.insert(extSearchSnapshots).values({
        userId: ctx.user!.id,
        query: input.query,
        totalItems: input.totalItems,
        avgPrice: input.avgPrice,
        avgRating: input.avgRating.toFixed(1),
        avgReview: input.avgReview,
        highReviewRatio: input.highReviewRatio,
        adCount: input.adCount,
        competitionScore: input.competitionScore,
        competitionLevel: input.competitionLevel,
        itemsJson: input.items ? JSON.stringify(input.items) : null,
      });

      // 자동으로 일별 통계 계산 (비동기, 실패 무시)
      autoComputeKeywordDailyStat(ctx.user!.id, input.query, db).catch(() => {});
      // 추적 상품 자동 매칭 (비동기, 실패 무시)
      autoMatchTrackedProducts(ctx.user!.id, input.query, input.items || [], db).catch(() => {});

      return { success: true, id: (result as any)?.[0]?.insertId };
    }),

  // 검색 히스토리 조회
  listSnapshots: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
      query: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const conditions = [eq(extSearchSnapshots.userId, ctx.user!.id)];
      if (input.query) {
        conditions.push(like(extSearchSnapshots.query, `%${input.query}%`));
      }

      const rows = await db.select({
        id: extSearchSnapshots.id,
        query: extSearchSnapshots.query,
        totalItems: extSearchSnapshots.totalItems,
        avgPrice: extSearchSnapshots.avgPrice,
        avgRating: extSearchSnapshots.avgRating,
        avgReview: extSearchSnapshots.avgReview,
        highReviewRatio: extSearchSnapshots.highReviewRatio,
        competitionScore: extSearchSnapshots.competitionScore,
        competitionLevel: extSearchSnapshots.competitionLevel,
        adCount: extSearchSnapshots.adCount,
        createdAt: extSearchSnapshots.createdAt,
      })
        .from(extSearchSnapshots)
        .where(and(...conditions))
        .orderBy(desc(extSearchSnapshots.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return rows;
    }),

  // 특정 스냅샷의 상품 목록 조회
  getSnapshotItems: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [row] = await db.select()
        .from(extSearchSnapshots)
        .where(and(eq(extSearchSnapshots.id, input.id), eq(extSearchSnapshots.userId, ctx.user!.id)))
        .limit(1);

      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      let items: any[] = [];
      try {
        items = row.itemsJson ? JSON.parse(row.itemsJson) : [];
      } catch {
        items = [];
      }
      return {
        ...row,
        items,
      };
    }),

  // 스냅샷 개별 삭제
  deleteSnapshot: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.delete(extSearchSnapshots)
        .where(and(eq(extSearchSnapshots.id, input.id), eq(extSearchSnapshots.userId, ctx.user!.id)));
      return { success: true };
    }),

  // 스냅샷 전체 삭제
  deleteAllSnapshots: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const result = await db.delete(extSearchSnapshots)
        .where(eq(extSearchSnapshots.userId, ctx.user!.id));
      return { success: true };
    }),

  // 검색 통계 요약
  searchStats: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const [stats] = await db.select({
      totalSearches: sql<number>`COUNT(*)`,
      uniqueQueries: sql<number>`COUNT(DISTINCT ${extSearchSnapshots.query})`,
      avgCompetition: sql<number>`ROUND(AVG(${extSearchSnapshots.competitionScore}))`,
      avgPrice: sql<number>`ROUND(AVG(${extSearchSnapshots.avgPrice}))`,
    })
      .from(extSearchSnapshots)
      .where(eq(extSearchSnapshots.userId, ctx.user!.id));

    // 최근 검색어 TOP 10 (빈도순)
    const topQueries = await db.select({
      query: extSearchSnapshots.query,
      count: sql<number>`COUNT(*)`,
      lastSearched: sql<string>`MAX(${extSearchSnapshots.createdAt})`,
      avgCompetition: sql<number>`ROUND(AVG(${extSearchSnapshots.competitionScore}))`,
    })
      .from(extSearchSnapshots)
      .where(eq(extSearchSnapshots.userId, ctx.user!.id))
      .groupBy(extSearchSnapshots.query)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(10);

    return {
      totalSearches: N(stats?.totalSearches),
      uniqueQueries: N(stats?.uniqueQueries),
      avgCompetition: N(stats?.avgCompetition),
      avgPrice: N(stats?.avgPrice),
      topQueries: topQueries.map(q => ({
        ...q,
        count: N(q.count),
        avgCompetition: N(q.avgCompetition),
      })),
    };
  }),

  // ===== 소싱 후보 =====

  // 후보 저장 (확장프로그램에서 호출)
  saveCandidate: protectedProcedure
    .input(z.object({
      productId: z.string().optional(),
      title: z.string().max(500).optional(),
      price: z.number().int().default(0),
      rating: z.number().default(0),
      reviewCount: z.number().int().default(0),
      imageUrl: z.string().optional(),
      coupangUrl: z.string().optional(),
      sourcingScore: z.number().int().default(0),
      sourcingGrade: z.string().max(2).optional(),
      searchQuery: z.string().max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 중복 체크
      if (input.productId) {
        const [existing] = await db.select({ id: extCandidates.id })
          .from(extCandidates)
          .where(and(
            eq(extCandidates.userId, ctx.user!.id),
            eq(extCandidates.productId, input.productId)
          ))
          .limit(1);
        if (existing) {
          return { success: true, id: existing.id, message: "이미 저장된 후보입니다." };
        }
      }

      const result = await db.insert(extCandidates).values({
        userId: ctx.user!.id,
        productId: input.productId || null,
        title: input.title || null,
        price: input.price,
        rating: input.rating.toFixed(1),
        reviewCount: input.reviewCount,
        imageUrl: input.imageUrl || null,
        coupangUrl: input.coupangUrl || null,
        sourcingScore: input.sourcingScore,
        sourcingGrade: input.sourcingGrade || null,
        searchQuery: input.searchQuery || null,
        status: "new",
      });

      return { success: true, id: (result as any)?.[0]?.insertId };
    }),

  // 후보 목록 조회
  listCandidates: protectedProcedure
    .input(z.object({
      status: z.enum(["new", "reviewing", "contacted_supplier", "sample_ordered", "dropped", "selected"]).optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const conditions = [eq(extCandidates.userId, ctx.user!.id)];
      if (input.status) conditions.push(eq(extCandidates.status, input.status));

      const rows = await db.select()
        .from(extCandidates)
        .where(and(...conditions))
        .orderBy(desc(extCandidates.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return rows;
    }),

  // 후보 상태 업데이트
  updateCandidate: protectedProcedure
    .input(z.object({
      id: z.number().int(),
      status: z.enum(["new", "reviewing", "contacted_supplier", "sample_ordered", "dropped", "selected"]).optional(),
      memo: z.string().max(2000).optional(),
      supplierUrl: z.string().optional(),
      estimatedCostCny: z.number().optional(),
      estimatedMarginRate: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const { id, ...updates } = input;
      const setObj: Record<string, any> = {};
      if (updates.status !== undefined) setObj.status = updates.status;
      if (updates.memo !== undefined) setObj.memo = updates.memo;
      if (updates.supplierUrl !== undefined) setObj.supplierUrl = updates.supplierUrl;
      if (updates.estimatedCostCny !== undefined) setObj.estimatedCostCny = updates.estimatedCostCny.toFixed(2);
      if (updates.estimatedMarginRate !== undefined) setObj.estimatedMarginRate = updates.estimatedMarginRate.toFixed(2);

      await db.update(extCandidates)
        .set(setObj)
        .where(and(eq(extCandidates.id, id), eq(extCandidates.userId, ctx.user!.id)));

      return { success: true };
    }),

  // 후보 삭제
  removeCandidate: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.delete(extCandidates)
        .where(and(eq(extCandidates.id, input.id), eq(extCandidates.userId, ctx.user!.id)));
      return { success: true };
    }),

  // 후보를 products 테이블로 승격 (소싱 상품으로 전환)
  promoteToProduct: protectedProcedure
    .input(z.object({ candidateId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { products } = await import("../../drizzle/schema");

      const [candidate] = await db.select()
        .from(extCandidates)
        .where(and(eq(extCandidates.id, input.candidateId), eq(extCandidates.userId, ctx.user!.id)))
        .limit(1);

      if (!candidate) throw new TRPCError({ code: "NOT_FOUND" });

      // products 테이블에 추가
      const today = new Date().toISOString().slice(0, 10);
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const weekday = dayNames[new Date().getDay()];
      // weekKey 계산
      const todayDate = new Date();
      const onejan = new Date(todayDate.getFullYear(), 0, 1);
      const weekNum = Math.ceil(((todayDate.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
      const weekKey = `${todayDate.getFullYear()}-W${weekNum.toString().padStart(2, "0")}`;

      const result = await db.insert(products).values({
        userId: ctx.user!.id,
        recordDate: today,
        weekday,
        weekKey,
        productName: candidate.title || "확장프로그램 후보",
        status: "reviewing",
        priority: "medium",
        keyword1: candidate.searchQuery || null,
        coupangUrl: candidate.coupangUrl || null,
        competitionLevel: candidate.sourcingScore && candidate.sourcingScore >= 65 ? "low" :
                          candidate.sourcingScore && candidate.sourcingScore >= 45 ? "medium" : "high",
      });

      // 후보 상태 업데이트
      await db.update(extCandidates)
        .set({ status: "selected" })
        .where(eq(extCandidates.id, input.candidateId));

      return {
        success: true,
        productId: (result as any)?.[0]?.insertId,
        message: "소싱 상품으로 등록되었습니다.",
      };
    }),

  // 후보 통계
  candidateStats: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const statusCounts = await db.select({
      status: extCandidates.status,
      count: sql<number>`COUNT(*)`,
    })
      .from(extCandidates)
      .where(eq(extCandidates.userId, ctx.user!.id))
      .groupBy(extCandidates.status);

    const [totals] = await db.select({
      total: sql<number>`COUNT(*)`,
      avgScore: sql<number>`ROUND(AVG(${extCandidates.sourcingScore}))`,
      avgPrice: sql<number>`ROUND(AVG(${extCandidates.price}))`,
    })
      .from(extCandidates)
      .where(eq(extCandidates.userId, ctx.user!.id));

    return {
      statusCounts: statusCounts.map(s => ({ ...s, count: N(s.count) })),
      total: N(totals?.total),
      avgScore: N(totals?.avgScore),
      avgPrice: N(totals?.avgPrice),
    };
  }),

  // ===== 순위 추적 =====

  // 추적 키워드 등록
  addTrackedKeyword: protectedProcedure
    .input(z.object({
      query: z.string().min(1).max(255),
      targetProductId: z.string().max(50).optional(),
      targetProductName: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 중복 체크
      const [existing] = await db.select({ id: extTrackedKeywords.id })
        .from(extTrackedKeywords)
        .where(and(eq(extTrackedKeywords.userId, ctx.user!.id), eq(extTrackedKeywords.query, input.query)))
        .limit(1);
      if (existing) return { success: true, id: existing.id, message: "이미 추적 중인 키워드입니다." };

      const result = await db.insert(extTrackedKeywords).values({
        userId: ctx.user!.id,
        query: input.query,
        targetProductId: input.targetProductId || null,
        targetProductName: input.targetProductName || null,
      });
      return { success: true, id: (result as any)?.[0]?.insertId };
    }),

  // 추적 키워드 목록
  listTrackedKeywords: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db.select()
      .from(extTrackedKeywords)
      .where(and(eq(extTrackedKeywords.userId, ctx.user!.id), eq(extTrackedKeywords.isActive, true)))
      .orderBy(desc(extTrackedKeywords.createdAt));
  }),

  // 추적 키워드 삭제 (비활성화)
  removeTrackedKeyword: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(extTrackedKeywords)
        .set({ isActive: false })
        .where(and(eq(extTrackedKeywords.id, input.id), eq(extTrackedKeywords.userId, ctx.user!.id)));
      return { success: true };
    }),

  // 순위 데이터 저장 (확장프로그램에서 배치 호출)
  saveRankData: protectedProcedure
    .input(z.object({
      query: z.string().min(1).max(255),
      items: z.array(z.object({
        coupangProductId: z.string(),
        title: z.string().optional(),
        position: z.number().int(),
        price: z.number().int().default(0),
        rating: z.number().default(0),
        reviewCount: z.number().int().default(0),
        isAd: z.boolean().default(false),
        isRocket: z.boolean().default(false),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      if (!input.items.length) return { success: true, count: 0 };

      const values = input.items.map(item => ({
        userId: ctx.user!.id,
        query: input.query,
        coupangProductId: item.coupangProductId,
        title: item.title || null,
        position: item.position,
        price: item.price,
        rating: item.rating.toFixed(1),
        reviewCount: item.reviewCount,
        isAd: item.isAd,
        isRocket: item.isRocket,
      }));

      await db.insert(extRankTrackings).values(values);
      return { success: true, count: input.items.length };
    }),

  // 특정 키워드의 순위 변동 히스토리
  getRankHistory: protectedProcedure
    .input(z.object({
      query: z.string(),
      coupangProductId: z.string().optional(),
      days: z.number().int().min(1).max(90).default(7),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const conditions = [
        eq(extRankTrackings.userId, ctx.user!.id),
        eq(extRankTrackings.query, input.query),
        sql`${extRankTrackings.capturedAt} >= DATE_SUB(NOW(), INTERVAL ${input.days} DAY)`,
      ];
      if (input.coupangProductId) {
        conditions.push(eq(extRankTrackings.coupangProductId, input.coupangProductId));
      }

      return db.select()
        .from(extRankTrackings)
        .where(and(...conditions))
        .orderBy(desc(extRankTrackings.capturedAt))
        .limit(500);
    }),

  // 키워드별 최신 순위 요약 (TOP 10 상품)
  getLatestRanking: protectedProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 가장 최근 캡처 시점의 데이터만
      const rows = await db.select()
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
        .limit(20);

      return rows;
    }),

  // ===== 상품 상세 =====

  // 상품 상세 저장
  saveProductDetail: protectedProcedure
    .input(z.object({
      coupangProductId: z.string(),
      title: z.string().optional(),
      price: z.number().int().default(0),
      originalPrice: z.number().int().default(0),
      discountRate: z.number().int().default(0),
      rating: z.number().default(0),
      reviewCount: z.number().int().default(0),
      purchaseCount: z.string().optional(),
      sellerName: z.string().optional(),
      isRocket: z.boolean().default(false),
      isFreeShipping: z.boolean().default(false),
      categoryPath: z.string().optional(),
      optionCount: z.number().int().default(0),
      imageUrl: z.string().optional(),
      detailJson: z.any().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const result = await db.insert(extProductDetails).values({
        userId: ctx.user!.id,
        coupangProductId: input.coupangProductId,
        title: input.title || null,
        price: input.price,
        originalPrice: input.originalPrice,
        discountRate: input.discountRate,
        rating: input.rating.toFixed(1),
        reviewCount: input.reviewCount,
        purchaseCount: input.purchaseCount || null,
        sellerName: input.sellerName || null,
        isRocket: input.isRocket,
        isFreeShipping: input.isFreeShipping,
        categoryPath: input.categoryPath || null,
        optionCount: input.optionCount,
        imageUrl: input.imageUrl || null,
        detailJson: input.detailJson ? JSON.stringify(input.detailJson) : null,
      });
      return { success: true, id: (result as any)?.[0]?.insertId };
    }),

  // 상품 상세 히스토리 (가격 변동 등)
  getProductHistory: protectedProcedure
    .input(z.object({
      coupangProductId: z.string(),
      days: z.number().int().min(1).max(90).default(30),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      return db.select({
        id: extProductDetails.id,
        price: extProductDetails.price,
        originalPrice: extProductDetails.originalPrice,
        discountRate: extProductDetails.discountRate,
        rating: extProductDetails.rating,
        reviewCount: extProductDetails.reviewCount,
        purchaseCount: extProductDetails.purchaseCount,
        capturedAt: extProductDetails.capturedAt,
      })
        .from(extProductDetails)
        .where(and(
          eq(extProductDetails.userId, ctx.user!.id),
          eq(extProductDetails.coupangProductId, input.coupangProductId),
          sql`${extProductDetails.capturedAt} >= DATE_SUB(NOW(), INTERVAL ${input.days} DAY)`,
        ))
        .orderBy(desc(extProductDetails.capturedAt))
        .limit(200);
    }),

  // ===== v6.5: 상세 페이지 확장 스냅샷 저장 =====
  saveDetailSnapshot: protectedProcedure
    .input(z.object({
      coupangProductId: z.string(),
      vendorItemId: z.string().optional().nullable(),
      title: z.string().optional(),
      price: z.number().int().default(0),
      originalPrice: z.number().int().default(0),
      discountRate: z.number().int().default(0),
      rating: z.number().default(0),
      reviewCount: z.number().int().default(0),
      purchaseCount: z.string().optional(),
      sellerName: z.string().optional(),
      brandName: z.string().optional().nullable(),
      manufacturer: z.string().optional().nullable(),
      origin: z.string().optional().nullable(),
      deliveryType: z.string().optional(),
      isRocket: z.boolean().default(false),
      isFreeShipping: z.boolean().default(false),
      soldOut: z.boolean().default(false),
      categoryPath: z.string().optional(),
      optionCount: z.number().int().default(0),
      imageUrl: z.string().optional(),
      confidence: z.number().int().default(0),
      reviewSamples: z.array(z.object({
        rating: z.number().nullable().optional(),
        text: z.string(),
        dateText: z.string().nullable().optional(),
      })).optional(),
      optionSummary: z.array(z.object({
        optionName: z.string(),
        priceDelta: z.number().nullable().optional(),
        soldOut: z.boolean().optional(),
      })).optional(),
      badgeText: z.string().optional().nullable(),
      keyword: z.string().optional(),
      source: z.enum(['manual', 'auto_collect', 'user_browse']).default('manual'),
      detailJson: z.any().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const extJson = {
        ...(input.detailJson || {}),
        vendorItemId: input.vendorItemId || null,
        brandName: input.brandName || null,
        manufacturer: input.manufacturer || null,
        origin: input.origin || null,
        deliveryType: input.deliveryType || 'STANDARD',
        soldOut: input.soldOut || false,
        confidence: input.confidence || 0,
        reviewSamples: input.reviewSamples || [],
        optionSummary: input.optionSummary || [],
        badgeText: input.badgeText || null,
        keyword: input.keyword || null,
        source: input.source || 'manual',
      };
      const result = await db.insert(extProductDetails).values({
        userId: ctx.user!.id,
        coupangProductId: input.coupangProductId,
        title: input.title || null,
        price: input.price,
        originalPrice: input.originalPrice,
        discountRate: input.discountRate,
        rating: input.rating.toFixed(1),
        reviewCount: input.reviewCount,
        purchaseCount: input.purchaseCount || null,
        sellerName: input.sellerName || null,
        isRocket: input.isRocket,
        isFreeShipping: input.isFreeShipping,
        categoryPath: input.categoryPath || null,
        optionCount: input.optionCount,
        imageUrl: input.imageUrl || null,
        detailJson: JSON.stringify(extJson),
      });
      return { success: true, id: (result as any)?.[0]?.insertId };
    }),

  getDetailHistory: protectedProcedure
    .input(z.object({
      coupangProductId: z.string(),
      days: z.number().int().min(1).max(90).default(30),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return db.select({
        id: extProductDetails.id,
        price: extProductDetails.price,
        originalPrice: extProductDetails.originalPrice,
        discountRate: extProductDetails.discountRate,
        rating: extProductDetails.rating,
        reviewCount: extProductDetails.reviewCount,
        purchaseCount: extProductDetails.purchaseCount,
        sellerName: extProductDetails.sellerName,
        isRocket: extProductDetails.isRocket,
        isFreeShipping: extProductDetails.isFreeShipping,
        optionCount: extProductDetails.optionCount,
        detailJson: extProductDetails.detailJson,
        capturedAt: extProductDetails.capturedAt,
      })
        .from(extProductDetails)
        .where(and(
          eq(extProductDetails.userId, ctx.user!.id),
          eq(extProductDetails.coupangProductId, input.coupangProductId),
          sql`${extProductDetails.capturedAt} >= DATE_SUB(NOW(), INTERVAL ${input.days} DAY)`,
        ))
        .orderBy(desc(extProductDetails.capturedAt))
        .limit(200);
    }),

  // ===== Phase 5: 트렌드 & 분석 =====

  // 검색 트렌드 (날짜별 검색 횟수, 경쟁도 변화)
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

  // ===== Phase 6: AI 리뷰 분석 =====

  // AI 리뷰 분석 실행 (검색 데이터 기반)
  analyzeReviews: protectedProcedure
    .input(z.object({
      query: z.string().min(1).max(255),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 해당 키워드의 스냅샷 데이터 가져오기
      const snapshots = await db.select()
        .from(extSearchSnapshots)
        .where(and(
          eq(extSearchSnapshots.userId, ctx.user!.id),
          eq(extSearchSnapshots.query, input.query),
        ))
        .orderBy(desc(extSearchSnapshots.createdAt))
        .limit(5);

      if (!snapshots.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "해당 키워드의 검색 데이터가 없습니다." });
      }

      // 관련 후보 데이터
      const candidates = await db.select()
        .from(extCandidates)
        .where(and(
          eq(extCandidates.userId, ctx.user!.id),
          eq(extCandidates.searchQuery, input.query),
        ))
        .limit(20);

      // 상품 상세 데이터
      const latestSnapshot = snapshots[0];
      let items: any[] = [];
      try {
        items = latestSnapshot.itemsJson ? JSON.parse(latestSnapshot.itemsJson) : [];
      } catch {
        // itemsJson이 손상된 경우 빈 배열로 진행
        items = [];
      }

      // AI 분석 로직 (OpenAI GPT 연동, 실패 시 규칙 기반 폴백)
      const analysis = await generateReviewAnalysis(input.query, latestSnapshot, items, candidates, snapshots);

      // 분석 결과 저장
      const result = await db.insert(extReviewAnalyses).values({
        userId: ctx.user!.id,
        query: input.query,
        analysisType: "keyword_review",
        totalProductsAnalyzed: items.length,
        avgRating: analysis.avgRating.toFixed(1),
        avgReviewCount: analysis.avgReviewCount,
        painPoints: JSON.stringify(analysis.painPoints),
        customerNeeds: JSON.stringify(analysis.customerNeeds),
        opportunities: JSON.stringify(analysis.opportunities),
        commonPraises: JSON.stringify(analysis.commonPraises),
        commonComplaints: JSON.stringify(analysis.commonComplaints),
        priceSensitivity: analysis.priceSensitivity,
        qualityConcerns: JSON.stringify(analysis.qualityConcerns),
        summaryText: analysis.summaryText,
        recommendations: JSON.stringify(analysis.recommendations),
      });

      // 알림 생성
      await db.insert(extNotifications).values({
        userId: ctx.user!.id,
        type: "ai_recommendation",
        title: `🔮 "${input.query}" AI 리뷰 분석 완료`,
        message: `${items.length}개 상품 분석 → ${analysis.opportunities.length}개 기회 발견`,
        data: JSON.stringify({ analysisId: (result as any)?.[0]?.insertId, query: input.query }),
        priority: "medium",
      });

      return {
        success: true,
        id: (result as any)?.[0]?.insertId,
        analysis,
      };
    }),

  // AI 분석 결과 조회
  getReviewAnalysis: protectedProcedure
    .input(z.object({
      query: z.string().optional(),
      limit: z.number().int().min(1).max(50).default(10),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const conditions = [eq(extReviewAnalyses.userId, ctx.user!.id)];
      if (input.query) conditions.push(eq(extReviewAnalyses.query, input.query));

      const rows = await db.select()
        .from(extReviewAnalyses)
        .where(and(...conditions))
        .orderBy(desc(extReviewAnalyses.createdAt))
        .limit(input.limit);

      return rows.map(row => {
        const safeJsonParse = (str: string | null) => {
          if (!str) return [];
          try { return JSON.parse(str); } catch { return []; }
        };
        const painPoints = safeJsonParse(row.painPoints);
        const customerNeeds = safeJsonParse(row.customerNeeds);
        const opportunities = safeJsonParse(row.opportunities);
        const commonPraises = safeJsonParse(row.commonPraises);
        const commonComplaints = safeJsonParse(row.commonComplaints);
        const qualityConcerns = safeJsonParse(row.qualityConcerns);
        const recommendations = safeJsonParse(row.recommendations);

        // aiPowered / trendInsight are not stored in DB — derive from summaryText
        const aiPowered = !(row.summaryText || "").startsWith("[규칙기반]");

        return {
          ...row,
          painPoints,
          customerNeeds,
          opportunities,
          commonPraises,
          commonComplaints,
          qualityConcerns,
          recommendations,
          aiPowered,
        };
      });
    }),

  // ===== Phase 6: 알림 센터 =====

  // 알림 목록
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

  // ===== WING 인기상품 검색 =====

  // WING 인기상품 데이터 저장
  saveWingSearch: protectedProcedure
    .input(z.object({
      keyword: z.string().max(255).default(""),
      category: z.string().max(255).default(""),
      totalItems: z.number().int().default(0),
      avgPrice: z.number().int().default(0),
      avgRating: z.number().default(0),
      avgReview: z.number().int().default(0),
      source: z.string().max(50).default("unknown"),
      pageUrl: z.string().optional(),
      items: z.array(z.any()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      // 같은 키워드+카테고리가 이미 있으면 업데이트
      const [existing] = await db.select({ id: extWingSearches.id })
        .from(extWingSearches)
        .where(and(
          eq(extWingSearches.userId, ctx.user!.id),
          eq(extWingSearches.keyword, input.keyword || ""),
          eq(extWingSearches.category, input.category || ""),
        ))
        .orderBy(desc(extWingSearches.createdAt))
        .limit(1);

      const itemsJson = input.items ? JSON.stringify(input.items) : null;

      if (existing) {
        await db.update(extWingSearches)
          .set({
            totalItems: input.totalItems,
            avgPrice: input.avgPrice,
            avgRating: input.avgRating.toFixed(1),
            avgReview: input.avgReview,
            source: input.source,
            pageUrl: input.pageUrl || null,
            itemsJson,
          })
          .where(eq(extWingSearches.id, existing.id));
        return { success: true, id: existing.id, updated: true };
      }

      const [result] = await db.insert(extWingSearches).values({
        userId: ctx.user!.id,
        keyword: input.keyword || "",
        category: input.category || "",
        totalItems: input.totalItems,
        avgPrice: input.avgPrice,
        avgRating: input.avgRating.toFixed(1),
        avgReview: input.avgReview,
        source: input.source,
        pageUrl: input.pageUrl || null,
        itemsJson,
      });
      return { success: true, id: result.insertId, updated: false };
    }),

  // WING 검색 목록 조회
  listWingSearches: protectedProcedure
    .input(z.object({
      keyword: z.string().optional(),
      category: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(20),
    }).optional().default({ limit: 20 }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      let conditions = [eq(extWingSearches.userId, ctx.user!.id)];
      if (input.keyword) {
        conditions.push(like(extWingSearches.keyword, `%${input.keyword}%`));
      }
      if (input.category) {
        conditions.push(eq(extWingSearches.category, input.category));
      }

      const rows = await db.select()
        .from(extWingSearches)
        .where(and(...conditions))
        .orderBy(desc(extWingSearches.createdAt))
        .limit(input.limit);

      return rows.map(row => {
        let items: any[] = [];
        if (row.itemsJson) {
          try { items = JSON.parse(row.itemsJson); } catch { items = []; }
        }
        return {
          ...row,
          items,
          itemsJson: undefined,
        };
      });
    }),

  // WING 검색 통계
  wingStats: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      // 기본 통계
      const [stats] = await db.select({
        totalSearches: sql<number>`COUNT(*)`,
        uniqueKeywords: sql<number>`COUNT(DISTINCT keyword)`,
        uniqueCategories: sql<number>`COUNT(DISTINCT category)`,
        avgPrice: sql<number>`ROUND(AVG(avg_price))`,
        avgRating: sql<number>`ROUND(AVG(avg_rating), 1)`,
        totalProducts: sql<number>`SUM(total_items)`,
      })
        .from(extWingSearches)
        .where(eq(extWingSearches.userId, ctx.user!.id));

      // TOP 키워드
      const topKeywords = await db.select({
        keyword: extWingSearches.keyword,
        count: sql<number>`COUNT(*)`,
        avgPrice: sql<number>`ROUND(AVG(avg_price))`,
        avgItems: sql<number>`ROUND(AVG(total_items))`,
      })
        .from(extWingSearches)
        .where(and(
          eq(extWingSearches.userId, ctx.user!.id),
          ne(extWingSearches.keyword, ""),
        ))
        .groupBy(extWingSearches.keyword)
        .orderBy(desc(sql`COUNT(*)`))
        .limit(10);

      // 카테고리별 분포
      const categories = await db.select({
        category: extWingSearches.category,
        count: sql<number>`COUNT(*)`,
        avgPrice: sql<number>`ROUND(AVG(avg_price))`,
      })
        .from(extWingSearches)
        .where(and(
          eq(extWingSearches.userId, ctx.user!.id),
          ne(extWingSearches.category, ""),
        ))
        .groupBy(extWingSearches.category)
        .orderBy(desc(sql`COUNT(*)`))
        .limit(10);

      // 최근 7일 일별 검색 수
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const dailySearches = await db.select({
        date: sql<string>`DATE(created_at)`,
        count: sql<number>`COUNT(*)`,
        totalProducts: sql<number>`SUM(total_items)`,
      })
        .from(extWingSearches)
        .where(and(
          eq(extWingSearches.userId, ctx.user!.id),
          gte(extWingSearches.createdAt, sevenDaysAgo.toISOString().slice(0, 19).replace("T", " ")),
        ))
        .groupBy(sql`DATE(created_at)`)
        .orderBy(asc(sql`DATE(created_at)`));

      return {
        totalSearches: N(stats?.totalSearches),
        uniqueKeywords: N(stats?.uniqueKeywords),
        uniqueCategories: N(stats?.uniqueCategories),
        avgPrice: N(stats?.avgPrice),
        avgRating: N(stats?.avgRating),
        totalProducts: N(stats?.totalProducts),
        topKeywords: topKeywords.map(k => ({
          ...k,
          count: N(k.count),
          avgPrice: N(k.avgPrice),
          avgItems: N(k.avgItems),
        })),
        categories: categories.map(c => ({
          ...c,
          count: N(c.count),
          avgPrice: N(c.avgPrice),
        })),
        dailySearches: dailySearches.map(d => ({
          ...d,
          count: N(d.count),
          totalProducts: N(d.totalProducts),
        })),
      };
    }),

  // WING 검색 삭제
  deleteWingSearch: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      await db.delete(extWingSearches)
        .where(and(
          eq(extWingSearches.id, input.id),
          eq(extWingSearches.userId, ctx.user!.id),
        ));
      return { success: true };
    }),

  // WING 검색 전체 삭제
  deleteAllWingSearches: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      await db.delete(extWingSearches)
        .where(eq(extWingSearches.userId, ctx.user!.id));
      return { success: true };
    }),

  // ===== 검색 수요 추정 (Search Demand Estimation) =====

  // 키워드별 일별 통계 계산 및 저장 (스냅샷 데이터 기반)
  computeKeywordDailyStats: protectedProcedure
    .input(z.object({
      query: z.string().min(1).max(255).optional(), // 특정 키워드만 또는 전체
    }).optional().default({} as { query?: string }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      // 오늘 날짜 (KST)
      const today = new Date();
      today.setHours(today.getHours() + 9);
      const todayStr = today.toISOString().slice(0, 10);

      // 해당 사용자의 스냅샷에서 키워드 목록 추출
      const queryConditions = [eq(extSearchSnapshots.userId, ctx.user!.id)];
      if (input?.query) {
        queryConditions.push(eq(extSearchSnapshots.query, input.query));
      }

      const snapshots = await db.select()
        .from(extSearchSnapshots)
        .where(and(...queryConditions))
        .orderBy(desc(extSearchSnapshots.createdAt));

      if (!snapshots.length) return { success: true, computed: 0 };

      // 키워드별로 그룹화
      const byQuery = new Map<string, typeof snapshots>();
      for (const s of snapshots) {
        const arr = byQuery.get(s.query) || [];
        arr.push(s);
        byQuery.set(s.query, arr);
      }

      let computed = 0;
      const entries = Array.from(byQuery.entries());
      for (const [query, querySnapshots] of entries) {
        // ★ v7.3.3: 스냅샷 중 가장 완전한 데이터(totalReviewSum 최대) 선택
        let bestSnapshot = querySnapshots[0];
        let bestItems: any[] = [];
        let bestTotalReviewSum = 0;

        for (const snap of querySnapshots.slice(0, 5)) {
          let snapItems: any[] = [];
          try { snapItems = snap.itemsJson ? JSON.parse(snap.itemsJson) : []; } catch { snapItems = []; }
          const snapReviewSum = snapItems.reduce((sum: number, i: any) => sum + (i.reviewCount || 0), 0);
          if (snapReviewSum > bestTotalReviewSum) {
            bestTotalReviewSum = snapReviewSum;
            bestSnapshot = snap;
            bestItems = snapItems;
          }
        }

        const latest = bestSnapshot;
        const items = bestItems;
        const totalReviewSum = bestTotalReviewSum;

        const adCount = items.filter((i: any) => i.isAd).length;
        const rocketCount = items.filter((i: any) => i.isRocket).length;
        const highReviewCount = items.filter((i: any) => (i.reviewCount || 0) >= 100).length;
        const adRatio = items.length ? Math.round((adCount / items.length) * 100) : 0;

        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().slice(0, 10);

        // 1단계: 어제 daily_stats
        let [prevStat] = await db.select()
          .from(extKeywordDailyStats)
          .where(and(
            eq(extKeywordDailyStats.userId, ctx.user!.id),
            eq(extKeywordDailyStats.query, query),
            eq(extKeywordDailyStats.statDate, yesterdayStr),
          ))
          .limit(1);

        // 2단계: 어제 없으면 최근 7일 이내
        if (!prevStat) {
          const weekAgo = new Date(today);
          weekAgo.setDate(weekAgo.getDate() - 7);
          const weekAgoStr = weekAgo.toISOString().slice(0, 10);
          const [recentStat] = await db.select()
            .from(extKeywordDailyStats)
            .where(and(
              eq(extKeywordDailyStats.userId, ctx.user!.id),
              eq(extKeywordDailyStats.query, query),
              sql`${extKeywordDailyStats.statDate} >= ${weekAgoStr}`,
              sql`${extKeywordDailyStats.statDate} < ${todayStr}`,
            ))
            .orderBy(desc(extKeywordDailyStats.statDate))
            .limit(1);
          if (recentStat) prevStat = recentStat;
        }

        // 3단계: daily_stats 없으면 이전 스냅샷과 비교
        let prevSnapshotReviewSum: number | null = null;
        let prevSnapshotAvgPrice: number | null = null;
        let prevSnapshotTotalItems: number | null = null;
        if (!prevStat && querySnapshots.length > 1) {
          const prevSnapshot = querySnapshots[1];
          let prevItems: any[] = [];
          try { prevItems = prevSnapshot.itemsJson ? JSON.parse(prevSnapshot.itemsJson) : []; } catch { prevItems = []; }
          prevSnapshotReviewSum = prevItems.reduce((sum: number, i: any) => sum + (i.reviewCount || 0), 0);
          prevSnapshotAvgPrice = prevSnapshot.avgPrice || 0;
          prevSnapshotTotalItems = prevSnapshot.totalItems || 0;
        }

        // ★ v7.3.3: 기존 growth 복구 소스 (오늘 저장값 또는 어제 growth)
        const [existingTodayStat] = await db.select()
          .from(extKeywordDailyStats)
          .where(and(
            eq(extKeywordDailyStats.userId, ctx.user!.id),
            eq(extKeywordDailyStats.query, query),
            eq(extKeywordDailyStats.statDate, todayStr),
          ))
          .limit(1);
        const todayStoredGrowth = existingTodayStat ? N(existingTodayStat.reviewGrowth) || 0 : 0;
        const prevDayGrowth = prevStat ? N(prevStat.reviewGrowth) || 0 : 0;
        const fallbackGrowth = todayStoredGrowth > 0 ? todayStoredGrowth : prevDayGrowth;

        // ★ v7.3.3: 수집 편차에 의한 음수 growth 방지
        let reviewGrowth = 0;
        let priceChange = 0;
        let productCountChange = 0;
        if (prevStat) {
          const prevDate = String(prevStat.statDate || '');
          if (prevDate !== todayStr) {
            const rawGrowth = totalReviewSum - (N(prevStat.totalReviewSum) || 0);
            if (rawGrowth >= 0) {
              reviewGrowth = rawGrowth;
            } else {
              reviewGrowth = fallbackGrowth > 0 ? fallbackGrowth : 0;
            }
            priceChange = (latest.avgPrice || 0) - (N(prevStat.avgPrice) || 0);
            productCountChange = (latest.totalItems || 0) - (N(prevStat.productCount) || 0);
          } else if (fallbackGrowth > 0) {
            reviewGrowth = fallbackGrowth;
          }
        } else if (prevSnapshotReviewSum !== null) {
          const prevSnap = querySnapshots.length > 1 ? querySnapshots[1] : null;
          const prevSnapDate = prevSnap?.createdAt ? String(prevSnap.createdAt).slice(0, 10) : '';
          if (prevSnapDate && prevSnapDate !== todayStr) {
            const rawGrowth = totalReviewSum - prevSnapshotReviewSum;
            if (rawGrowth >= 0) {
              reviewGrowth = rawGrowth;
            } else {
              reviewGrowth = fallbackGrowth > 0 ? fallbackGrowth : 0;
            }
            priceChange = (latest.avgPrice || 0) - (prevSnapshotAvgPrice || 0);
            productCountChange = (latest.totalItems || 0) - (prevSnapshotTotalItems || 0);
          }
        }

        const salesEstimate = reviewGrowth * 20;

        // 수요 점수 — 성장 + 절대값 기반 병합
        let demandScore = 0;
        if (salesEstimate > 500) demandScore = 90;
        else if (salesEstimate > 200) demandScore = 75;
        else if (salesEstimate > 100) demandScore = 60;
        else if (salesEstimate > 50) demandScore = 45;
        else if (salesEstimate > 20) demandScore = 30;
        else if (salesEstimate > 5) demandScore = 15;
        else if (reviewGrowth > 0) demandScore = 10;

        // 절대값 기반 기본 수요 점수 (이전 데이터 없을 때 보완)
        if (demandScore === 0 && items.length > 0) {
          let baselineDemand = 0;
          const avgReviewCount = totalReviewSum / Math.max(1, items.length);
          if (avgReviewCount > 500) baselineDemand += 25;
          else if (avgReviewCount > 200) baselineDemand += 20;
          else if (avgReviewCount > 100) baselineDemand += 15;
          else if (avgReviewCount > 50) baselineDemand += 10;
          else if (avgReviewCount > 20) baselineDemand += 5;
          if (items.length >= 30) baselineDemand += 10;
          else if (items.length >= 20) baselineDemand += 5;
          const rocketRatio = items.length ? rocketCount / items.length : 0;
          if (rocketRatio > 0.5) baselineDemand += 10;
          else if (rocketRatio > 0.3) baselineDemand += 5;
          demandScore = Math.min(50, baselineDemand);
        }

        // 키워드 점수 — 경쟁도 역수 + 수요 점수 반영
        const avgReviewPerProduct = items.length > 0 ? totalReviewSum / items.length : 0;
        const competitionFactor = Math.max(0, 100 - (latest.competitionScore || 0)) / 100;
        
        // v7.2.7: 정규화된 키워드 점수 계산
        let reviewGrowthScore = 0;
        if (reviewGrowth >= 100) reviewGrowthScore = 25;
        else if (reviewGrowth >= 50) reviewGrowthScore = 20;
        else if (reviewGrowth >= 20) reviewGrowthScore = 15;
        else if (reviewGrowth >= 10) reviewGrowthScore = 10;
        else if (reviewGrowth >= 5) reviewGrowthScore = 7;
        else if (reviewGrowth > 0) reviewGrowthScore = 3;
        
        let marketSizeScore = 0;
        if (avgReviewPerProduct >= 500) marketSizeScore = 25;
        else if (avgReviewPerProduct >= 200) marketSizeScore = 20;
        else if (avgReviewPerProduct >= 100) marketSizeScore = 15;
        else if (avgReviewPerProduct >= 50) marketSizeScore = 10;
        else if (avgReviewPerProduct >= 20) marketSizeScore = 5;
        
        const competitionEaseScore = Math.round(competitionFactor * 15 + (1 - adRatio / 100) * 10);
        const demandPart = Math.round(demandScore * 0.25);
        
        const keywordScore = Math.min(100, reviewGrowthScore + marketSizeScore + competitionEaseScore + demandPart);

        // upsert: 같은 날짜+키워드가 있으면 업데이트
        const [existing] = await db.select({ id: extKeywordDailyStats.id })
          .from(extKeywordDailyStats)
          .where(and(
            eq(extKeywordDailyStats.userId, ctx.user!.id),
            eq(extKeywordDailyStats.query, query),
            eq(extKeywordDailyStats.statDate, todayStr),
          ))
          .limit(1);

        const statData = {
          snapshotCount: querySnapshots.length,
          productCount: latest.totalItems || 0,
          avgPrice: latest.avgPrice || 0,
          avgRating: latest.avgRating || "0",
          avgReview: latest.avgReview || 0,
          totalReviewSum,
          adCount,
          adRatio,
          rocketCount,
          highReviewCount,
          competitionScore: latest.competitionScore || 0,
          competitionLevel: (latest.competitionLevel || "medium") as "easy" | "medium" | "hard",
          reviewGrowth,
          salesEstimate,
          priceChange,
          productCountChange,
          demandScore,
          keywordScore,
        };

        if (existing) {
          await db.update(extKeywordDailyStats)
            .set(statData)
            .where(eq(extKeywordDailyStats.id, existing.id));
        } else {
          await db.insert(extKeywordDailyStats).values({
            userId: ctx.user!.id,
            query,
            statDate: todayStr,
            ...statData,
          });
        }
        computed++;
      }

      return { success: true, computed, date: todayStr };
    }),

  // 키워드별 일별 통계 목록 조회 (특정 키워드의 시계열 데이터)
  getKeywordDailyStats: protectedProcedure
    .input(z.object({
      query: z.string().min(1).max(255),
      days: z.number().int().min(1).max(90).default(30),
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
        .limit(90);
    }),

  // 키워드별 최신 일별 통계 요약 (대시보드 전체 키워드 목록)
  listKeywordStats: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(500).default(100),
      sortBy: z.enum(["keyword_score", "demand_score", "review_growth", "sales_estimate", "competition_score", "avg_price", "query"]).default("keyword_score"),
      sortDir: z.enum(["asc", "desc"]).default("desc"),
      search: z.string().optional(),
    }).default({ limit: 100, sortBy: "keyword_score", sortDir: "desc" }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 각 키워드의 가장 최신 stat_date 레코드만 가져오기
      const conditions = [eq(extKeywordDailyStats.userId, ctx.user!.id)];
      if (input?.search) {
        conditions.push(like(extKeywordDailyStats.query, `%${input.search}%`));
      }

      // 서브쿼리로 각 키워드의 최신 날짜만 가져오기
      const rows = await db.select()
        .from(extKeywordDailyStats)
        .where(and(
          ...conditions,
          sql`(${extKeywordDailyStats.query}, ${extKeywordDailyStats.statDate}) IN (
            SELECT \`query\`, MAX(stat_date) FROM ext_keyword_daily_stats
            WHERE user_id = ${ctx.user!.id}
            GROUP BY \`query\`
          )`,
        ))
        .limit(input?.limit || 100);

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
      rows.sort((a: any, b: any) => {
        const av = sortField === "query" ? (a.query || "") : Number(a[sortField] || 0);
        const bv = sortField === "query" ? (b.query || "") : Number(b[sortField] || 0);
        if (sortField === "query") {
          return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
        }
        return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
      });

      return rows;
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
            GROUP BY \`query\`
          )`,
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
      }

      return { success: true, count: input.queries.length };
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

  // ===== 내 상품 자동 추적 시스템 =====

  // 추적 상품 등록 (수동 또는 소싱/후보/매핑에서 자동)
  addProductTracking: protectedProcedure
    .input(z.object({
      sourceType: z.enum(["product", "candidate", "coupang_mapping", "manual"]).default("manual"),
      sourceId: z.number().int().optional(),
      productName: z.string().min(1).max(500),
      coupangProductId: z.string().max(50).optional(),
      coupangUrl: z.string().optional(),
      imageUrl: z.string().optional(),
      keywords: z.array(z.string()).default([]),
      trackFrequency: z.enum(["daily", "weekly"]).default("daily"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 중복 체크: 같은 coupangProductId 또는 같은 sourceType+sourceId
      if (input.coupangProductId) {
        const [dup] = await db.select({ id: extProductTrackings.id })
          .from(extProductTrackings)
          .where(and(
            eq(extProductTrackings.userId, ctx.user!.id),
            eq(extProductTrackings.coupangProductId, input.coupangProductId),
            eq(extProductTrackings.isActive, true),
          )).limit(1);
        if (dup) return { success: true, id: dup.id, message: "이미 추적 중인 상품입니다." };
      }

      // 키워드 자동 추출: 상품명에서 핵심 키워드 추출
      let keywords = input.keywords;
      if (keywords.length === 0 && input.productName) {
        // 한글 2글자 이상 단어 추출
        const words = input.productName.match(/[가-힣]{2,}/g) || [];
        const stopwords = /세트|개입|묶음|패키지|특가|인기|추천|프리미엄|신상|무료배송|당일|국내/;
        keywords = words.filter(w => w.length >= 2 && !stopwords.test(w)).slice(0, 5);
      }

      // 키워드를 추적 키워드에도 자동 등록
      for (const kw of keywords) {
        const [existing] = await db.select({ id: extTrackedKeywords.id })
          .from(extTrackedKeywords)
          .where(and(
            eq(extTrackedKeywords.userId, ctx.user!.id),
            eq(extTrackedKeywords.query, kw),
          )).limit(1);
        if (!existing) {
          await db.insert(extTrackedKeywords).values({
            userId: ctx.user!.id,
            query: kw,
            targetProductId: input.coupangProductId || null,
            targetProductName: input.productName,
          });
        }
      }

      const result = await db.insert(extProductTrackings).values({
        userId: ctx.user!.id,
        sourceType: input.sourceType,
        sourceId: input.sourceId || null,
        productName: input.productName,
        coupangProductId: input.coupangProductId || null,
        coupangUrl: input.coupangUrl || null,
        imageUrl: input.imageUrl || null,
        keywords: JSON.stringify(keywords),
        trackFrequency: input.trackFrequency,
      });

      return { success: true, id: (result as any)?.[0]?.insertId, keywordsRegistered: keywords.length };
    }),

  // 추적 상품 목록 조회
  listProductTrackings: protectedProcedure
    .input(z.object({
      activeOnly: z.boolean().default(true),
      limit: z.number().int().min(1).max(100).default(50),
    }).default({ activeOnly: true, limit: 50 }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const conditions = [eq(extProductTrackings.userId, ctx.user!.id)];
      if (input?.activeOnly) conditions.push(eq(extProductTrackings.isActive, true));

      const rows = await db.select()
        .from(extProductTrackings)
        .where(and(...conditions))
        .orderBy(desc(extProductTrackings.updatedAt))
        .limit(input?.limit || 50);

      return rows.map(r => ({
        ...r,
        keywords: r.keywords ? JSON.parse(r.keywords) : [],
        similarProducts: r.similarProductsJson ? JSON.parse(r.similarProductsJson) : [],
        competitorSummary: r.competitorSummaryJson ? JSON.parse(r.competitorSummaryJson) : null,
      }));
    }),

  // 추적 상품 상세 + 히스토리
  getProductTrackingDetail: protectedProcedure
    .input(z.object({ id: z.number().int(), days: z.number().int().min(1).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [tracking] = await db.select()
        .from(extProductTrackings)
        .where(and(eq(extProductTrackings.id, input.id), eq(extProductTrackings.userId, ctx.user!.id)))
        .limit(1);
      if (!tracking) throw new TRPCError({ code: "NOT_FOUND" });

      // 일별 스냅샷 히스토리
      const history = await db.select()
        .from(extProductDailySnapshots)
        .where(and(
          eq(extProductDailySnapshots.trackingId, input.id),
          eq(extProductDailySnapshots.userId, ctx.user!.id),
          sql`${extProductDailySnapshots.snapshotDate} >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL ${input.days} DAY), '%Y-%m-%d')`,
        ))
        .orderBy(asc(extProductDailySnapshots.snapshotDate))
        .limit(90);

      // 키워드별 최신 검색 데이터
      const keywords: string[] = tracking.keywords ? JSON.parse(tracking.keywords) : [];
      const keywordStats: any[] = [];
      for (const kw of keywords.slice(0, 5)) {
        const [stat] = await db.select()
          .from(extKeywordDailyStats)
          .where(and(
            eq(extKeywordDailyStats.userId, ctx.user!.id),
            eq(extKeywordDailyStats.query, kw),
          ))
          .orderBy(desc(extKeywordDailyStats.statDate))
          .limit(1);
        if (stat) keywordStats.push({ keyword: kw, ...stat });
      }

      return {
        tracking: {
          ...tracking,
          keywords,
          similarProducts: tracking.similarProductsJson ? JSON.parse(tracking.similarProductsJson) : [],
          competitorSummary: tracking.competitorSummaryJson ? JSON.parse(tracking.competitorSummaryJson) : null,
        },
        history,
        keywordStats,
      };
    }),

  // 추적 상품 데이터 업데이트 (확장프로그램에서 검색 시 자동 호출)
  updateProductTrackingData: protectedProcedure
    .input(z.object({
      trackingId: z.number().int().optional(),
      coupangProductId: z.string().optional(),
      price: z.number().int().default(0),
      rating: z.number().default(0),
      reviewCount: z.number().int().default(0),
      rank: z.number().int().default(0),
      rankKeyword: z.string().optional(),
      similarProducts: z.array(z.any()).optional(),
      competitorSummary: z.any().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // trackingId 또는 coupangProductId로 추적 상품 찾기
      let tracking: any = null;
      if (input.trackingId) {
        [tracking] = await db.select()
          .from(extProductTrackings)
          .where(and(eq(extProductTrackings.id, input.trackingId), eq(extProductTrackings.userId, ctx.user!.id)))
          .limit(1);
      } else if (input.coupangProductId) {
        [tracking] = await db.select()
          .from(extProductTrackings)
          .where(and(
            eq(extProductTrackings.userId, ctx.user!.id),
            eq(extProductTrackings.coupangProductId, input.coupangProductId),
            eq(extProductTrackings.isActive, true),
          ))
          .limit(1);
      }

      if (!tracking) return { success: false, message: "추적 상품을 찾을 수 없습니다." };

      // 변동량 계산
      const priceChange = input.price > 0 ? input.price - (tracking.latestPrice || 0) : 0;
      const reviewChange = input.reviewCount > 0 ? input.reviewCount - (tracking.latestReviewCount || 0) : 0;
      const rankChange = input.rank > 0 && tracking.latestRank > 0 ? tracking.latestRank - input.rank : 0;

      // 추적 상품 업데이트
      await db.update(extProductTrackings).set({
        latestPrice: input.price || tracking.latestPrice,
        latestRating: input.rating > 0 ? input.rating.toFixed(1) : tracking.latestRating,
        latestReviewCount: input.reviewCount || tracking.latestReviewCount,
        latestRank: input.rank || tracking.latestRank,
        latestRankKeyword: input.rankKeyword || tracking.latestRankKeyword,
        priceChange,
        reviewChange,
        rankChange,
        similarProductsJson: input.similarProducts ? JSON.stringify(input.similarProducts.slice(0, 10)) : tracking.similarProductsJson,
        competitorSummaryJson: input.competitorSummary ? JSON.stringify(input.competitorSummary) : tracking.competitorSummaryJson,
        competitorCount: input.similarProducts?.length || tracking.competitorCount,
        lastTrackedAt: sql`NOW()`,
      }).where(eq(extProductTrackings.id, tracking.id));

      // 일별 스냅샷 upsert
      const today = new Date();
      today.setHours(today.getHours() + 9);
      const todayStr = today.toISOString().slice(0, 10);

      const [existingSnapshot] = await db.select({ id: extProductDailySnapshots.id })
        .from(extProductDailySnapshots)
        .where(and(
          eq(extProductDailySnapshots.trackingId, tracking.id),
          eq(extProductDailySnapshots.snapshotDate, todayStr),
        )).limit(1);

      const snapshotData = {
        price: input.price || 0,
        rating: input.rating > 0 ? input.rating.toFixed(1) : "0",
        reviewCount: input.reviewCount || 0,
        rankPosition: input.rank || 0,
        rankKeyword: input.rankKeyword || null,
        competitorCount: input.similarProducts?.length || 0,
        similarAvgPrice: input.similarProducts?.length
          ? Math.round(input.similarProducts.reduce((s: number, p: any) => s + (p.price || 0), 0) / input.similarProducts.length)
          : 0,
        similarAvgReview: input.similarProducts?.length
          ? Math.round(input.similarProducts.reduce((s: number, p: any) => s + (p.reviewCount || 0), 0) / input.similarProducts.length)
          : 0,
      };

      if (existingSnapshot) {
        await db.update(extProductDailySnapshots).set(snapshotData)
          .where(eq(extProductDailySnapshots.id, existingSnapshot.id));
      } else {
        await db.insert(extProductDailySnapshots).values({
          userId: ctx.user!.id,
          trackingId: tracking.id,
          snapshotDate: todayStr,
          ...snapshotData,
        });
      }

      // 중요 변동이 있으면 알림 생성
      if (Math.abs(priceChange) > (tracking.latestPrice || 1) * 0.05 && tracking.latestPrice > 0) {
        await db.insert(extNotifications).values({
          userId: ctx.user!.id,
          type: "price_change",
          title: `💰 ${tracking.productName} 가격 변동`,
          message: `${priceChange > 0 ? "상승" : "하락"}: ${Math.abs(priceChange).toLocaleString()}원 (${tracking.latestPrice?.toLocaleString()}원 → ${input.price.toLocaleString()}원)`,
          data: JSON.stringify({ trackingId: tracking.id, priceChange }),
          priority: Math.abs(priceChange) > (tracking.latestPrice || 1) * 0.1 ? "high" : "medium",
        });
      }

      if (Math.abs(rankChange) >= 3 && input.rank > 0) {
        await db.insert(extNotifications).values({
          userId: ctx.user!.id,
          type: "rank_change",
          title: `📊 ${tracking.productName} 순위 변동`,
          message: `${rankChange > 0 ? "상승" : "하락"} ${Math.abs(rankChange)}위: ${tracking.latestRank}위 → ${input.rank}위 ("${input.rankKeyword}")`,
          data: JSON.stringify({ trackingId: tracking.id, rankChange }),
          priority: Math.abs(rankChange) >= 5 ? "high" : "medium",
        });
      }

      return { success: true, priceChange, reviewChange, rankChange };
    }),

  // 소싱 상품(products) / 후보(candidates) / 쿠팡매핑에서 자동 추적 등록
  autoRegisterTrackings: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      let registered = 0;

      // 1. products 테이블에서 selected/testing/reviewing 상태 상품
      const activeProducts = await db.select()
        .from(products)
        .where(and(
          eq(products.userId, ctx.user!.id),
          sql`${products.status} IN ('selected', 'testing', 'reviewing', 'test_candidate')`,
        ))
        .limit(50);

      for (const prod of activeProducts) {
        const [existing] = await db.select({ id: extProductTrackings.id })
          .from(extProductTrackings)
          .where(and(
            eq(extProductTrackings.userId, ctx.user!.id),
            eq(extProductTrackings.sourceType, "product"),
            eq(extProductTrackings.sourceId, prod.id),
          )).limit(1);
        if (existing) continue;

        const keywords: string[] = [];
        if (prod.keyword1) keywords.push(prod.keyword1);
        if (prod.keyword2) keywords.push(prod.keyword2);
        if (prod.keyword3) keywords.push(prod.keyword3);

        // 키워드를 추적 키워드에도 등록
        for (const kw of keywords) {
          const [kExist] = await db.select({ id: extTrackedKeywords.id })
            .from(extTrackedKeywords)
            .where(and(eq(extTrackedKeywords.userId, ctx.user!.id), eq(extTrackedKeywords.query, kw)))
            .limit(1);
          if (!kExist) {
            await db.insert(extTrackedKeywords).values({
              userId: ctx.user!.id,
              query: kw,
              targetProductName: prod.productName,
            });
          }
        }

        await db.insert(extProductTrackings).values({
          userId: ctx.user!.id,
          sourceType: "product",
          sourceId: prod.id,
          productName: prod.productName,
          coupangUrl: prod.coupangUrl || null,
          keywords: JSON.stringify(keywords),
        });
        registered++;
      }

      // 2. ext_candidates에서 selected/reviewing 상태 후보
      const activeCandidates = await db.select()
        .from(extCandidates)
        .where(and(
          eq(extCandidates.userId, ctx.user!.id),
          sql`${extCandidates.status} IN ('selected', 'reviewing', 'sample_ordered')`,
        ))
        .limit(50);

      for (const cand of activeCandidates) {
        if (!cand.productId) continue;
        const [existing] = await db.select({ id: extProductTrackings.id })
          .from(extProductTrackings)
          .where(and(
            eq(extProductTrackings.userId, ctx.user!.id),
            eq(extProductTrackings.coupangProductId, cand.productId),
          )).limit(1);
        if (existing) continue;

        const keywords: string[] = [];
        if (cand.searchQuery) keywords.push(cand.searchQuery);

        for (const kw of keywords) {
          const [kExist] = await db.select({ id: extTrackedKeywords.id })
            .from(extTrackedKeywords)
            .where(and(eq(extTrackedKeywords.userId, ctx.user!.id), eq(extTrackedKeywords.query, kw)))
            .limit(1);
          if (!kExist) {
            await db.insert(extTrackedKeywords).values({
              userId: ctx.user!.id,
              query: kw,
              targetProductId: cand.productId,
              targetProductName: cand.title || undefined,
            });
          }
        }

        await db.insert(extProductTrackings).values({
          userId: ctx.user!.id,
          sourceType: "candidate",
          sourceId: cand.id,
          productName: cand.title || "후보 상품",
          coupangProductId: cand.productId,
          coupangUrl: cand.coupangUrl || null,
          imageUrl: cand.imageUrl || null,
          keywords: JSON.stringify(keywords),
          latestPrice: cand.price || 0,
          latestRating: cand.rating || "0",
          latestReviewCount: cand.reviewCount || 0,
        });
        registered++;
      }

      // 3. product_channel_mappings에서 활성 매핑
      const activeMappings = await db.select()
        .from(productChannelMappings)
        .where(and(
          eq(productChannelMappings.userId, ctx.user!.id),
          eq(productChannelMappings.isActive, true),
        ))
        .limit(50);

      for (const mapping of activeMappings) {
        if (!mapping.vendorItemId && !mapping.sellerProductId) continue;
        const cpId = mapping.sellerProductId || mapping.vendorItemId || "";
        const [existing] = await db.select({ id: extProductTrackings.id })
          .from(extProductTrackings)
          .where(and(
            eq(extProductTrackings.userId, ctx.user!.id),
            eq(extProductTrackings.sourceType, "coupang_mapping"),
            eq(extProductTrackings.sourceId, mapping.id),
          )).limit(1);
        if (existing) continue;

        // 내부 상품의 키워드 가져오기
        const keywords: string[] = [];
        if (mapping.internalProductId) {
          const [prod] = await db.select()
            .from(products)
            .where(eq(products.id, mapping.internalProductId))
            .limit(1);
          if (prod) {
            if (prod.keyword1) keywords.push(prod.keyword1);
            if (prod.keyword2) keywords.push(prod.keyword2);
            if (prod.keyword3) keywords.push(prod.keyword3);
          }
        }
        // 상품명에서 키워드 추출
        if (keywords.length === 0 && mapping.coupangProductName) {
          const words = mapping.coupangProductName.match(/[가-힣]{2,}/g) || [];
          const stopwords = /세트|개입|묶음|패키지|특가|인기|추천|프리미엄|신상|무료배송|당일|국내/;
          keywords.push(...words.filter(w => w.length >= 2 && !stopwords.test(w)).slice(0, 3));
        }

        for (const kw of keywords) {
          const [kExist] = await db.select({ id: extTrackedKeywords.id })
            .from(extTrackedKeywords)
            .where(and(eq(extTrackedKeywords.userId, ctx.user!.id), eq(extTrackedKeywords.query, kw)))
            .limit(1);
          if (!kExist) {
            await db.insert(extTrackedKeywords).values({
              userId: ctx.user!.id,
              query: kw,
              targetProductName: mapping.coupangProductName || undefined,
            });
          }
        }

        await db.insert(extProductTrackings).values({
          userId: ctx.user!.id,
          sourceType: "coupang_mapping",
          sourceId: mapping.id,
          productName: mapping.coupangProductName || "쿠팡 매핑 상품",
          coupangProductId: cpId,
          coupangUrl: mapping.coupangUrl || null,
          keywords: JSON.stringify(keywords),
        });
        registered++;
      }

      return { success: true, registered, message: `${registered}개 상품이 자동 추적에 등록되었습니다.` };
    }),

  // 추적 상품 삭제 (비활성화)
  removeProductTracking: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(extProductTrackings)
        .set({ isActive: false })
        .where(and(eq(extProductTrackings.id, input.id), eq(extProductTrackings.userId, ctx.user!.id)));
      return { success: true };
    }),

  // 추적 대시보드 요약 (전체 추적 상품 상황)
  productTrackingOverview: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const trackings = await db.select()
        .from(extProductTrackings)
        .where(and(eq(extProductTrackings.userId, ctx.user!.id), eq(extProductTrackings.isActive, true)))
        .orderBy(desc(extProductTrackings.updatedAt));

      const totalProducts = trackings.length;
      const priceAlerts = trackings.filter(t => Math.abs(t.priceChange || 0) > 0).length;
      const rankAlerts = trackings.filter(t => Math.abs(t.rankChange || 0) >= 2).length;
      const reviewGrowing = trackings.filter(t => (t.reviewChange || 0) > 0).length;
      const avgPrice = totalProducts > 0 ? Math.round(trackings.reduce((s, t) => s + (t.latestPrice || 0), 0) / totalProducts) : 0;
      const avgReview = totalProducts > 0 ? Math.round(trackings.reduce((s, t) => s + (t.latestReviewCount || 0), 0) / totalProducts) : 0;

      // 가격 하락 TOP 3
      const priceDrops = trackings
        .filter(t => (t.priceChange || 0) < 0)
        .sort((a, b) => (a.priceChange || 0) - (b.priceChange || 0))
        .slice(0, 3)
        .map(t => ({ id: t.id, name: t.productName, change: t.priceChange, price: t.latestPrice }));

      // 순위 상승 TOP 3
      const rankRisers = trackings
        .filter(t => (t.rankChange || 0) > 0)
        .sort((a, b) => (b.rankChange || 0) - (a.rankChange || 0))
        .slice(0, 3)
        .map(t => ({ id: t.id, name: t.productName, change: t.rankChange, rank: t.latestRank, keyword: t.latestRankKeyword }));

      // 리뷰 증가 TOP 3
      const reviewGrowers = trackings
        .filter(t => (t.reviewChange || 0) > 0)
        .sort((a, b) => (b.reviewChange || 0) - (a.reviewChange || 0))
        .slice(0, 3)
        .map(t => ({ id: t.id, name: t.productName, change: t.reviewChange, count: t.latestReviewCount }));

      // AI 제안이 있는 상품
      const withSuggestions = trackings.filter(t => t.aiSuggestion).length;

      // 소스별 분포
      const bySource = {
        product: trackings.filter(t => t.sourceType === "product").length,
        candidate: trackings.filter(t => t.sourceType === "candidate").length,
        coupang_mapping: trackings.filter(t => t.sourceType === "coupang_mapping").length,
        manual: trackings.filter(t => t.sourceType === "manual").length,
      };

      return {
        totalProducts,
        priceAlerts,
        rankAlerts,
        reviewGrowing,
        avgPrice,
        avgReview,
        priceDrops,
        rankRisers,
        reviewGrowers,
        withSuggestions,
        bySource,
      };
    }),

  // AI 기반 추적 상품 분석 및 제안 생성
  analyzeTrackedProduct: protectedProcedure
    .input(z.object({ trackingId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [tracking] = await db.select()
        .from(extProductTrackings)
        .where(and(eq(extProductTrackings.id, input.trackingId), eq(extProductTrackings.userId, ctx.user!.id)))
        .limit(1);
      if (!tracking) throw new TRPCError({ code: "NOT_FOUND" });

      // 히스토리 데이터
      const history = await db.select()
        .from(extProductDailySnapshots)
        .where(eq(extProductDailySnapshots.trackingId, input.trackingId))
        .orderBy(desc(extProductDailySnapshots.snapshotDate))
        .limit(30);

      const keywords: string[] = tracking.keywords ? JSON.parse(tracking.keywords) : [];
      const similarProducts = tracking.similarProductsJson ? JSON.parse(tracking.similarProductsJson) : [];

      // 규칙 기반 분석 (OpenAI 비용 없이)
      const suggestions: string[] = [];

      // 가격 분석
      if (history.length >= 2) {
        const prices = history.map(h => h.price || 0).filter(p => p > 0);
        if (prices.length >= 2) {
          const trend = prices[0] - prices[prices.length - 1];
          if (trend > 0) suggestions.push(`가격이 ${trend.toLocaleString()}원 상승 추세입니다. 경쟁사 가격도 확인하세요.`);
          if (trend < 0) suggestions.push(`가격이 ${Math.abs(trend).toLocaleString()}원 하락 추세입니다. 마진 영향을 점검하세요.`);
        }
      }

      // 리뷰 분석
      if ((tracking.latestReviewCount || 0) < 50) {
        suggestions.push("리뷰 50개 미만입니다. 리뷰 마케팅 전략이 필요합니다.");
      }
      if ((tracking.reviewChange || 0) > 10) {
        suggestions.push(`리뷰가 ${tracking.reviewChange}개 증가했습니다. 판매 호조 신호입니다.`);
      }

      // 순위 분석
      if ((tracking.latestRank || 0) > 20) {
        suggestions.push(`대표 키워드 순위가 ${tracking.latestRank}위입니다. SEO/광고 최적화가 필요합니다.`);
      }
      if ((tracking.rankChange || 0) < -5) {
        suggestions.push(`순위가 ${Math.abs(tracking.rankChange || 0)}위 하락했습니다. 경쟁사 동향을 확인하세요.`);
      }

      // 경쟁사 분석
      if (similarProducts.length > 0) {
        const avgCompPrice = Math.round(similarProducts.reduce((s: number, p: any) => s + (p.price || 0), 0) / similarProducts.length);
        if ((tracking.latestPrice || 0) > avgCompPrice * 1.2) {
          suggestions.push(`경쟁사 평균가(${avgCompPrice.toLocaleString()}원) 대비 20%+ 비싸니다. 가격 경쟁력을 점검하세요.`);
        }
        if ((tracking.latestPrice || 0) < avgCompPrice * 0.8) {
          suggestions.push(`경쟁사 평균가(${avgCompPrice.toLocaleString()}원) 대비 20%+ 저렴합니다. 가격을 올릴 여지가 있습니다.`);
        }
      }

      // 파생 키워드 제안
      if (keywords.length > 0 && keywords.length < 5) {
        suggestions.push(`현재 ${keywords.length}개 키워드만 추적 중입니다. 관련 파생 키워드를 추가하여 더 넓게 모니터링하세요.`);
      }

      const aiSuggestion = suggestions.join("\n");

      await db.update(extProductTrackings).set({
        aiSuggestion,
        aiUpdatedAt: sql`NOW()`,
      }).where(eq(extProductTrackings.id, input.trackingId));

      return { success: true, suggestions, aiSuggestion };
    }),

  // 추적 상품 키워드 업데이트
  updateTrackingKeywords: protectedProcedure
    .input(z.object({
      trackingId: z.number().int(),
      keywords: z.array(z.string().min(1).max(255)),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.update(extProductTrackings)
        .set({ keywords: JSON.stringify(input.keywords) })
        .where(and(eq(extProductTrackings.id, input.trackingId), eq(extProductTrackings.userId, ctx.user!.id)));

      // 새 키워드들을 추적 키워드에도 등록
      for (const kw of input.keywords) {
        const [existing] = await db.select({ id: extTrackedKeywords.id })
          .from(extTrackedKeywords)
          .where(and(eq(extTrackedKeywords.userId, ctx.user!.id), eq(extTrackedKeywords.query, kw)))
          .limit(1);
        if (!existing) {
          await db.insert(extTrackedKeywords).values({ userId: ctx.user!.id, query: kw });
        }
      }

      return { success: true, count: input.keywords.length };
    }),

  // 데이터 축적 상태 확인
  dataAccumulationStatus: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 스냅샷별 날짜 분포 확인
      const dateStats = await db.select({
        statDate: extKeywordDailyStats.statDate,
        count: sql<number>`COUNT(*)`,
      })
        .from(extKeywordDailyStats)
        .where(eq(extKeywordDailyStats.userId, ctx.user!.id))
        .groupBy(extKeywordDailyStats.statDate)
        .orderBy(desc(extKeywordDailyStats.statDate))
        .limit(30);

      const snapshotCount = await db.select({
        total: sql<number>`COUNT(*)`,
        keywords: sql<number>`COUNT(DISTINCT \`query\`)`,
      })
        .from(extSearchSnapshots)
        .where(eq(extSearchSnapshots.userId, ctx.user!.id));

      const dayCount = dateStats.length;
      const totalKeywords = Number(snapshotCount[0]?.keywords || 0);
      const totalSnapshots = Number(snapshotCount[0]?.total || 0);

      // 리뷰 증가가 0이 아닌 키워드 수
      const withGrowth = await db.select({
        count: sql<number>`COUNT(DISTINCT \`query\`)`,
      })
        .from(extKeywordDailyStats)
        .where(and(
          eq(extKeywordDailyStats.userId, ctx.user!.id),
          sql`review_growth > 0`,
        ));

      return {
        dayCount,
        totalKeywords,
        totalSnapshots,
        keywordsWithGrowth: Number(withGrowth[0]?.count || 0),
        dates: dateStats.map(d => ({ date: d.statDate, count: Number(d.count) })),
        explanation: {
          reviewGrowth: "매일 같은 키워드를 검색하면, 전일 대비 리뷰 총합 증가량을 계산합니다. 최소 2일 이상 데이터가 필요합니다.",
          salesEstimate: "리뷰증가 × 20으로 추정합니다. 리뷰 1건 = 약 20건 판매 (리뷰 작성률 약 5% 기준).",
          demandScore: "판매추정량을 기반으로 0~100점으로 환산합니다. 판매추정 500+ = 90점, 200+ = 75점, 100+ = 60점.",
          competitorMonitor: "같은 키워드의 일별 총 리뷰수·평균가 변동을 추적하여 경쟁자 동향을 파악합니다.",
          rankChanges: "순위추적에 등록된 키워드만 해당. 검색할 때마다 각 상품의 순위를 기록합니다.",
          rating: "검색 결과 페이지에서 별점을 파싱합니다. v5.6.1에서 12단계 전략으로 파싱 정확도를 대폭 향상했습니다.",
        },
      };
    }),

  // ===================================================================
  //  판매량 추정 시스템 (Sales Estimation System)
  // ===================================================================

  // 카테고리별 리뷰 작성률 목록 조회
  getCategoryReviewRates: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const rows = await db.select()
      .from(extCategoryReviewRates)
      .orderBy(asc(extCategoryReviewRates.categoryName));

    return rows.map(r => ({
      id: r.id,
      categoryKey: r.categoryKey,
      categoryName: r.categoryName,
      reviewRate: N(r.reviewRate),
      confidence: r.confidence,
      sampleCount: r.sampleCount,
      notes: r.notes,
    }));
  }),

  // 카테고리 리뷰율 수정 (사용자 커스텀)
  updateCategoryReviewRate: protectedProcedure
    .input(z.object({
      categoryKey: z.string().min(1),
      reviewRate: z.number().min(0.001).max(0.5),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [existing] = await db.select({ id: extCategoryReviewRates.id })
        .from(extCategoryReviewRates)
        .where(eq(extCategoryReviewRates.categoryKey, input.categoryKey))
        .limit(1);

      if (existing) {
        await db.update(extCategoryReviewRates)
          .set({
            reviewRate: input.reviewRate.toFixed(4),
            notes: input.notes || null,
          })
          .where(eq(extCategoryReviewRates.id, existing.id));
        return { success: true, updated: true };
      }

      await db.insert(extCategoryReviewRates).values({
        categoryKey: input.categoryKey,
        categoryName: input.categoryKey,
        reviewRate: input.reviewRate.toFixed(4),
        notes: input.notes || null,
      });
      return { success: true, updated: false };
    }),

  // 단일 상품 판매량 추정 실행
  estimateSingleProduct: protectedProcedure
    .input(z.object({
      trackingId: z.number().int(),
      categoryKey: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const userId = ctx.user!.id;

      // 추적 상품 확인
      const [tracking] = await db.select()
        .from(extProductTrackings)
        .where(and(
          eq(extProductTrackings.id, input.trackingId),
          eq(extProductTrackings.userId, userId),
        ))
        .limit(1);

      if (!tracking) throw new TRPCError({ code: "NOT_FOUND", message: "추적 상품을 찾을 수 없습니다" });

      // 최근 30일 스냅샷 조회
      const now = new Date();
      now.setHours(now.getHours() + 9);
      const todayStr = now.toISOString().slice(0, 10);
      const date30ago = new Date(now);
      date30ago.setDate(date30ago.getDate() - 30);
      const date30agoStr = date30ago.toISOString().slice(0, 10);

      const snapshots = await db.select({
        snapshotDate: extProductDailySnapshots.snapshotDate,
        price: extProductDailySnapshots.price,
        reviewCount: extProductDailySnapshots.reviewCount,
        rankPosition: extProductDailySnapshots.rankPosition,
        rating: extProductDailySnapshots.rating,
        dataJson: extProductDailySnapshots.dataJson,
      })
        .from(extProductDailySnapshots)
        .where(and(
          eq(extProductDailySnapshots.trackingId, input.trackingId),
          gte(extProductDailySnapshots.snapshotDate, date30agoStr),
        ))
        .orderBy(desc(extProductDailySnapshots.snapshotDate));

      if (snapshots.length < 2) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "최소 2일 이상의 스냅샷 데이터가 필요합니다"
        });
      }

      // 윈도우 메트릭 계산
      const snapshotRows: SnapshotRow[] = snapshots.map(s => ({
        snapshotDate: s.snapshotDate,
        price: N(s.price),
        reviewCount: N(s.reviewCount),
        rankPosition: N(s.rankPosition),
        rating: N(s.rating),
        dataJson: s.dataJson || undefined,
      }));

      const metrics = buildWindowMetrics(snapshotRows, todayStr);
      if (!metrics) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "메트릭 계산 실패" });
      }

      // 카테고리 리뷰율 조회
      const categoryKey = input.categoryKey || matchCategoryKey(tracking.productName || '');
      let reviewRate = DEFAULT_CATEGORY_REVIEW_RATES[categoryKey] || 0.02;

      const [dbRate] = await db.select({ reviewRate: extCategoryReviewRates.reviewRate })
        .from(extCategoryReviewRates)
        .where(eq(extCategoryReviewRates.categoryKey, categoryKey))
        .limit(1);
      if (dbRate) reviewRate = N(dbRate.reviewRate);

      // 판매량 추정 실행
      const estimateInput: EstimateInput = {
        trackingId: input.trackingId,
        ...metrics,
        categoryKey,
        reviewRate,
      };

      const result = calculateSalesEstimate(estimateInput);

      // 결과 저장 (upsert)
      const [existingEst] = await db.select({ id: extProductSalesEstimates.id })
        .from(extProductSalesEstimates)
        .where(and(
          eq(extProductSalesEstimates.trackingId, input.trackingId),
          eq(extProductSalesEstimates.estimateDate, todayStr),
        ))
        .limit(1);

      const estData = {
        userId,
        trackingId: input.trackingId,
        estimateDate: todayStr,
        reviewDelta7d: result.reviewDelta7d,
        reviewDelta30d: result.reviewDelta30d,
        avgRank: result.avgRank.toFixed(2),
        soldOutDays: result.soldOutDays,
        priceChangeRate: result.priceChangeRate.toFixed(4),
        currentPrice: result.currentPrice,
        currentReviewCount: result.currentReviewCount,
        currentRating: result.currentRating.toFixed(1),
        categoryKey: result.categoryKey,
        reviewRate: result.reviewRate.toFixed(4),
        estimatedDailySales: result.estimatedDailySales.toFixed(2),
        estimatedMonthlySales: result.estimatedMonthlySales.toFixed(2),
        estimatedMonthlyRevenue: String(result.estimatedMonthlyRevenue),
        baseDailySales: result.baseDailySales.toFixed(2),
        rankBoost: result.rankBoost.toFixed(3),
        soldOutBoost: result.soldOutBoost.toFixed(3),
        priceBoost: result.priceBoost.toFixed(3),
        salesPowerScore: result.salesPowerScore.toFixed(2),
        salesGrade: result.salesGrade,
        trendDirection: result.trendDirection,
        surgeFlag: result.surgeFlag,
      };

      if (existingEst) {
        await db.update(extProductSalesEstimates).set(estData)
          .where(eq(extProductSalesEstimates.id, existingEst.id));
      } else {
        await db.insert(extProductSalesEstimates).values(estData);
      }

      return {
        success: true,
        estimate: result,
        gradeLabel: getSalesGradeLabel(result.salesGrade),
      };
    }),

  // 전체 추적 상품 배치 판매량 추정
  runSalesEstimateBatch: protectedProcedure
    .input(z.object({
      targetDate: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const userId = ctx.user!.id;
      const now = new Date();
      now.setHours(now.getHours() + 9);
      const todayStr = input.targetDate || now.toISOString().slice(0, 10);
      const date30ago = new Date(todayStr);
      date30ago.setDate(date30ago.getDate() - 30);
      const date30agoStr = date30ago.toISOString().slice(0, 10);

      // 활성 추적 상품 전체 조회
      const trackings = await db.select({
        id: extProductTrackings.id,
        productName: extProductTrackings.productName,
        coupangProductId: extProductTrackings.coupangProductId,
      })
        .from(extProductTrackings)
        .where(and(
          eq(extProductTrackings.userId, userId),
          eq(extProductTrackings.isActive, true),
        ));

      // 카테고리 리뷰율 맵 미리 로딩
      const dbRates = await db.select()
        .from(extCategoryReviewRates);
      const rateMap: Record<string, number> = {};
      for (const r of dbRates) {
        rateMap[r.categoryKey] = N(r.reviewRate);
      }

      let processed = 0;
      let skipped = 0;
      let errors = 0;
      const results: Array<{ trackingId: number; productName: string; grade: string; monthly: number }> = [];

      for (const tracking of trackings) {
        try {
          const snapshots = await db.select({
            snapshotDate: extProductDailySnapshots.snapshotDate,
            price: extProductDailySnapshots.price,
            reviewCount: extProductDailySnapshots.reviewCount,
            rankPosition: extProductDailySnapshots.rankPosition,
            rating: extProductDailySnapshots.rating,
            dataJson: extProductDailySnapshots.dataJson,
          })
            .from(extProductDailySnapshots)
            .where(and(
              eq(extProductDailySnapshots.trackingId, tracking.id),
              gte(extProductDailySnapshots.snapshotDate, date30agoStr),
            ))
            .orderBy(desc(extProductDailySnapshots.snapshotDate));

          if (snapshots.length < 2) {
            skipped++;
            continue;
          }

          const snapshotRows: SnapshotRow[] = snapshots.map(s => ({
            snapshotDate: s.snapshotDate,
            price: N(s.price),
            reviewCount: N(s.reviewCount),
            rankPosition: N(s.rankPosition),
            rating: N(s.rating),
            dataJson: s.dataJson || undefined,
          }));

          const metrics = buildWindowMetrics(snapshotRows, todayStr);
          if (!metrics) { skipped++; continue; }

          const categoryKey = matchCategoryKey(tracking.productName || '');
          const reviewRate = rateMap[categoryKey] || DEFAULT_CATEGORY_REVIEW_RATES[categoryKey] || 0.02;

          const estInput: EstimateInput = {
            trackingId: tracking.id,
            ...metrics,
            categoryKey,
            reviewRate,
          };

          const result = calculateSalesEstimate(estInput);

          // Upsert
          const [existingEst] = await db.select({ id: extProductSalesEstimates.id })
            .from(extProductSalesEstimates)
            .where(and(
              eq(extProductSalesEstimates.trackingId, tracking.id),
              eq(extProductSalesEstimates.estimateDate, todayStr),
            ))
            .limit(1);

          const estData = {
            userId,
            trackingId: tracking.id,
            estimateDate: todayStr,
            reviewDelta7d: result.reviewDelta7d,
            reviewDelta30d: result.reviewDelta30d,
            avgRank: result.avgRank.toFixed(2),
            soldOutDays: result.soldOutDays,
            priceChangeRate: result.priceChangeRate.toFixed(4),
            currentPrice: result.currentPrice,
            currentReviewCount: result.currentReviewCount,
            currentRating: result.currentRating.toFixed(1),
            categoryKey: result.categoryKey,
            reviewRate: result.reviewRate.toFixed(4),
            estimatedDailySales: result.estimatedDailySales.toFixed(2),
            estimatedMonthlySales: result.estimatedMonthlySales.toFixed(2),
            estimatedMonthlyRevenue: String(result.estimatedMonthlyRevenue),
            baseDailySales: result.baseDailySales.toFixed(2),
            rankBoost: result.rankBoost.toFixed(3),
            soldOutBoost: result.soldOutBoost.toFixed(3),
            priceBoost: result.priceBoost.toFixed(3),
            salesPowerScore: result.salesPowerScore.toFixed(2),
            salesGrade: result.salesGrade,
            trendDirection: result.trendDirection,
            surgeFlag: result.surgeFlag,
          };

          if (existingEst) {
            await db.update(extProductSalesEstimates).set(estData)
              .where(eq(extProductSalesEstimates.id, existingEst.id));
          } else {
            await db.insert(extProductSalesEstimates).values(estData);
          }

          processed++;
          results.push({
            trackingId: tracking.id,
            productName: tracking.productName,
            grade: result.salesGrade,
            monthly: result.estimatedMonthlySales,
          });
        } catch (err) {
          errors++;
          console.error(`[salesEstimateBatch] tracking ${tracking.id}:`, err);
        }
      }

      return {
        success: true,
        targetDate: todayStr,
        total: trackings.length,
        processed,
        skipped,
        errors,
        results: results.slice(0, 20),
      };
    }),

  // 판매량 추정 결과 조회 (특정 상품)
  getProductSalesEstimates: protectedProcedure
    .input(z.object({
      trackingId: z.number().int(),
      days: z.number().int().min(1).max(90).default(30),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const dateLimit = new Date();
      dateLimit.setHours(dateLimit.getHours() + 9);
      dateLimit.setDate(dateLimit.getDate() - input.days);
      const dateLimitStr = dateLimit.toISOString().slice(0, 10);

      const rows = await db.select()
        .from(extProductSalesEstimates)
        .where(and(
          eq(extProductSalesEstimates.userId, ctx.user!.id),
          eq(extProductSalesEstimates.trackingId, input.trackingId),
          gte(extProductSalesEstimates.estimateDate, dateLimitStr),
        ))
        .orderBy(desc(extProductSalesEstimates.estimateDate));

      return rows.map(r => ({
        id: r.id,
        estimateDate: r.estimateDate,
        reviewDelta7d: N(r.reviewDelta7d),
        reviewDelta30d: N(r.reviewDelta30d),
        avgRank: N(r.avgRank),
        soldOutDays: N(r.soldOutDays),
        priceChangeRate: N(r.priceChangeRate),
        currentPrice: N(r.currentPrice),
        currentReviewCount: N(r.currentReviewCount),
        currentRating: N(r.currentRating),
        categoryKey: r.categoryKey,
        reviewRate: N(r.reviewRate),
        estimatedDailySales: N(r.estimatedDailySales),
        estimatedMonthlySales: N(r.estimatedMonthlySales),
        estimatedMonthlyRevenue: N(r.estimatedMonthlyRevenue),
        baseDailySales: N(r.baseDailySales),
        rankBoost: N(r.rankBoost),
        soldOutBoost: N(r.soldOutBoost),
        priceBoost: N(r.priceBoost),
        salesPowerScore: N(r.salesPowerScore),
        salesGrade: r.salesGrade,
        salesGradeLabel: getSalesGradeLabel(r.salesGrade || 'MEDIUM'),
        trendDirection: r.trendDirection,
        surgeFlag: r.surgeFlag,
      }));
    }),

  // 판매량 추정 대시보드 (전체 상품 최신 추정 결과 요약)
  salesEstimateDashboard: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const userId = ctx.user!.id;

    // 각 추적 상품의 최신 추정 결과 조회
    const latestEstimates = await db.select({
      trackingId: extProductSalesEstimates.trackingId,
      estimateDate: sql<string>`MAX(estimate_date)`.as('max_date'),
    })
      .from(extProductSalesEstimates)
      .where(eq(extProductSalesEstimates.userId, userId))
      .groupBy(extProductSalesEstimates.trackingId);

    if (!latestEstimates.length) {
      return {
        totalProducts: 0,
        gradeDistribution: {} as Record<string, number>,
        topSellers: [] as any[],
        surgeProducts: [] as any[],
        summary: {
          totalEstimatedMonthlySales: 0,
          totalEstimatedMonthlyRevenue: 0,
          avgSalesPowerScore: 0,
        },
      };
    }

    // 전체 최신 추정 결과 조회
    const allEstimates: any[] = [];
    for (const le of latestEstimates) {
      const [row] = await db.select()
        .from(extProductSalesEstimates)
        .where(and(
          eq(extProductSalesEstimates.trackingId, le.trackingId),
          eq(extProductSalesEstimates.estimateDate, le.estimateDate),
        ))
        .limit(1);
      if (row) {
        const [tracking] = await db.select({
          productName: extProductTrackings.productName,
          coupangProductId: extProductTrackings.coupangProductId,
          imageUrl: extProductTrackings.imageUrl,
        })
          .from(extProductTrackings)
          .where(eq(extProductTrackings.id, le.trackingId))
          .limit(1);

        allEstimates.push({
          ...row,
          productName: tracking?.productName || '',
          coupangProductId: tracking?.coupangProductId || '',
          imageUrl: tracking?.imageUrl || '',
        });
      }
    }

    // 등급 분포
    const gradeDistribution: Record<string, number> = {};
    for (const est of allEstimates) {
      const grade = est.salesGrade || 'MEDIUM';
      gradeDistribution[grade] = (gradeDistribution[grade] || 0) + 1;
    }

    // TOP 10 판매 상품
    const topSellers = [...allEstimates]
      .sort((a, b) => N(b.estimatedMonthlySales) - N(a.estimatedMonthlySales))
      .slice(0, 10)
      .map(est => ({
        trackingId: est.trackingId,
        productName: est.productName,
        coupangProductId: est.coupangProductId,
        imageUrl: est.imageUrl,
        estimatedMonthlySales: N(est.estimatedMonthlySales),
        estimatedMonthlyRevenue: N(est.estimatedMonthlyRevenue),
        salesPowerScore: N(est.salesPowerScore),
        salesGrade: est.salesGrade,
        salesGradeLabel: getSalesGradeLabel(est.salesGrade || 'MEDIUM'),
        trendDirection: est.trendDirection,
        surgeFlag: est.surgeFlag,
        currentPrice: N(est.currentPrice),
      }));

    // 급등 상품
    const surgeProducts = allEstimates
      .filter(est => est.surgeFlag)
      .map(est => ({
        trackingId: est.trackingId,
        productName: est.productName,
        coupangProductId: est.coupangProductId,
        reviewDelta7d: N(est.reviewDelta7d),
        estimatedDailySales: N(est.estimatedDailySales),
        salesGrade: est.salesGrade,
      }));

    // 종합 요약
    const totalEstimatedMonthlySales = allEstimates.reduce((sum, est) => sum + N(est.estimatedMonthlySales), 0);
    const totalEstimatedMonthlyRevenue = allEstimates.reduce((sum, est) => sum + N(est.estimatedMonthlyRevenue), 0);
    const avgSalesPowerScore = allEstimates.length > 0
      ? Math.round(allEstimates.reduce((sum, est) => sum + N(est.salesPowerScore), 0) / allEstimates.length * 100) / 100
      : 0;

    return {
      totalProducts: allEstimates.length,
      gradeDistribution,
      topSellers,
      surgeProducts,
      summary: {
        totalEstimatedMonthlySales: Math.round(totalEstimatedMonthlySales),
        totalEstimatedMonthlyRevenue: Math.round(totalEstimatedMonthlyRevenue),
        avgSalesPowerScore,
      },
    };
  }),


  // ===================================================================
  //  하이브리드 데이터 수집 시스템 (Hybrid Data Collection)
  //  실시간 사용자검색 수집 + 저빈도 배치 보강
  // ===================================================================

  // ===== 검색 이벤트 저장 (content.js → background.js → 서버) =====
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
        totalReviewSum: input.totalReviewSum,
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
        });
      }

      // 3. 일일 상태 비동기 업데이트
      const todayStr = now.toISOString().slice(0, 10);
      computeDailyAggregation(userId, input.keyword, todayStr).then(async (agg) => {
        if (!agg) return;
        const [existingStatus] = await db.select({ id: extKeywordDailyStatus.id })
          .from(extKeywordDailyStatus)
          .where(and(
            eq(extKeywordDailyStatus.userId, userId),
            eq(extKeywordDailyStatus.keyword, input.keyword),
            eq(extKeywordDailyStatus.statDate, todayStr),
          ))
          .limit(1);

        const INT_MAX = 2000000000;
        const statusData = {
          totalItems: agg.totalItems,
          avgPrice: Math.min(agg.avgPrice, INT_MAX),
          minPrice: Math.min(agg.minPrice, INT_MAX),
          maxPrice: Math.min(agg.maxPrice, INT_MAX),
          avgRating: agg.avgRating.toFixed(1),
          avgReview: agg.avgReview,
          totalReviewSum: agg.totalReviewSum,
          medianReview: agg.medianReview,
          adCount: agg.adCount,
          adRatio: agg.adRatio.toFixed(2),
          rocketCount: agg.rocketCount,
          rocketRatio: agg.rocketRatio.toFixed(2),
          highReviewCount: agg.highReviewCount,
          newProductCount: agg.newProductCount,
          reviewGrowth: agg.reviewGrowth,
          priceChange: agg.priceChange,
          itemCountChange: agg.itemCountChange,
          estimatedDailySales: agg.estimatedDailySales,
          salesScore: agg.salesScore,
          demandScore: agg.demandScore,
          competitionScore: agg.competitionScore,
          competitionLevel: agg.competitionLevel,
          dataQualityScore: agg.dataQualityScore,
          priceParseRate: agg.priceParseRate,
          ratingParseRate: agg.ratingParseRate,
          reviewParseRate: agg.reviewParseRate,
        };

        if (existingStatus) {
          await db.update(extKeywordDailyStatus).set(statusData)
            .where(eq(extKeywordDailyStatus.id, existingStatus.id));
        } else {
          try {
            await db.insert(extKeywordDailyStatus).values({
              userId, keyword: input.keyword, statDate: todayStr, source: input.source, ...statusData,
            });
          } catch (dupErr: any) {
            if (dupErr?.cause?.code === "ER_DUP_ENTRY" || dupErr?.code === "ER_DUP_ENTRY") {
              await db.update(extKeywordDailyStatus).set(statusData)
                .where(and(
                  eq(extKeywordDailyStatus.userId, userId),
                  eq(extKeywordDailyStatus.keyword, input.keyword),
                  eq(extKeywordDailyStatus.statDate, todayStr),
                ));
            } else {
              throw dupErr;
            }
          }
        }
      }).catch((err) => console.error("[saveSearchEvent] daily status error:", err));

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

          const [existingSnap] = await db.select({ id: extSearchSnapshots.id })
            .from(extSearchSnapshots)
            .where(and(
              eq(extSearchSnapshots.userId, userId),
              eq(extSearchSnapshots.query, input.keyword),
              sql`DATE(${extSearchSnapshots.createdAt}) = ${todayStr}`,
            ))
            .orderBy(desc(extSearchSnapshots.createdAt))
            .limit(1);

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

          if (existingSnap) {
            await db.update(extSearchSnapshots).set(snapData).where(eq(extSearchSnapshots.id, existingSnap.id));
          } else {
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
      limit: z.number().int().min(1).max(200).default(50),
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
          compositeScore: N(r.compositeScore),
          keywordScore: ds?.keywordScore || N(r.compositeScore),
          demandScore: ds?.demandScore || 0,
          dailyReviewGrowth: ds?.reviewGrowth || 0,
          dailySalesEstimate: ds?.salesEstimate || 0,
          dailyCompetitionScore: ds?.competitionScore || 0,
          createdAt: r.createdAt,
        };
      });

      // keywordScore 정렬
      if (input.sortBy === "keywordScore") {
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

  // ===== 키워드 일별 상태 이력 조회 =====
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

      const rows = await db.select()
        .from(extKeywordDailyStatus)
        .where(and(
          eq(extKeywordDailyStatus.userId, ctx.user!.id),
          eq(extKeywordDailyStatus.keyword, input.keyword),
          gte(extKeywordDailyStatus.statDate, startDateStr),
        ))
        .orderBy(asc(extKeywordDailyStatus.statDate));

      return rows.map(r => ({
        statDate: r.statDate,
        totalItems: N(r.totalItems),
        avgPrice: N(r.avgPrice),
        minPrice: N(r.minPrice),
        maxPrice: N(r.maxPrice),
        avgRating: N(r.avgRating),
        avgReview: N(r.avgReview),
        totalReviewSum: N(r.totalReviewSum),
        reviewGrowth: N(r.reviewGrowth),
        priceChange: N(r.priceChange),
        estimatedDailySales: N(r.estimatedDailySales),
        salesScore: N(r.salesScore),
        demandScore: N(r.demandScore),
        competitionScore: N(r.competitionScore),
        competitionLevel: r.competitionLevel,
        dataQualityScore: N(r.dataQualityScore),
        adCount: N(r.adCount),
        rocketCount: N(r.rocketCount),
        source: r.source,
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
      return await runDailyBatch(ctx.user!.id, opts.limit, opts.offset, opts.keywords);
    }),

  // ===== 배치 수집 대상 키워드 조회 =====
  getBatchKeywordSelection: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(20) }))
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

      await db.update(extWatchKeywords)
        .set({
          lastCollectedAt: nowStr,
        })
        .where(and(
          eq(extWatchKeywords.userId, userId),
          eq(extWatchKeywords.keyword, input.keyword),
        ));

      return { success: true, keyword: input.keyword, collectedAt: nowStr };
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
    }).optional().default({ successCount: 0, failCount: 0, skipCount: 0 }))
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
            });
            syncCount++;
          }
        }
        if (syncCount > 0) console.log(`[autoCollectComplete] 고아 키워드 ${syncCount}개 자동 등록`);
      } catch (e) {
        console.warn('[autoCollectComplete] 키워드 동기화 오류:', e);
      }

      console.log(`[autoCollectComplete] 완료: batch=${batchResult.updated}, stats=${statsOk}, err=${statsErr}, synced=${syncCount}`);
      return { success: true, batchUpdated: batchResult.updated, statsComputed: statsOk, statsErrors: statsErr, totalKeywords: allKws.length, keywordsSynced: syncCount };
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
      if (!hasMore) { await runDailyBatch(userId).catch(() => {}); }

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

      return {
        collectedToday: N(todayStats?.collectedToday),
        totalActive: N(queueStats?.totalActive),
        neverCollected: N(queueStats?.neverCollected),
        staleKeywords: N(queueStats?.stale),
        sourceDist: sourceDist.map(s => ({ source: s.source, count: N(s.count) })),
        lastCollectedAt: lastCollected?.lastAt || null,
        lastStatsUpdatedAt: lastDailyStat?.lastAt || null,
      };
    }),
});

// ============================================================
//  OpenAI GPT 연동 AI 리뷰 분석 엔진
// ============================================================

/** OpenAI Chat Completion API 호출 (fetch 기반, 패키지 불필요) */
async function callOpenAI(messages: { role: string; content: string }[], options?: { temperature?: number; maxTokens?: number }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY 환경변수가 설정되지 않았습니다.");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 3000,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error("[OpenAI] API error:", res.status, errBody);
    throw new Error(`OpenAI API 오류 (${res.status}): ${errBody.slice(0, 200)}`);
  }

  const data = await res.json() as any;
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI 응답이 비어있습니다.");

  return JSON.parse(content);
}

/** 시장 데이터 통계 요약 생성 (GPT 프롬프트용) */
function buildMarketDataSummary(
  query: string,
  snapshot: any,
  items: any[],
  candidates: any[],
  historicalSnapshots: any[]
) {
  const avgPrice = snapshot.avgPrice || 0;
  const avgRating = parseFloat(snapshot.avgRating) || 0;
  const avgReview = snapshot.avgReview || 0;
  const competitionScore = snapshot.competitionScore || 0;
  const totalItems = items.length;

  const prices = items.map((i: any) => i.price).filter((p: number) => p > 0);
  const priceMin = prices.length ? Math.min(...prices) : 0;
  const priceMax = prices.length ? Math.max(...prices) : 0;

  const highReviewItems = items.filter((i: any) => (i.reviewCount || 0) >= 100);
  const lowReviewItems = items.filter((i: any) => (i.reviewCount || 0) < 10);
  const noReviewItems = items.filter((i: any) => (i.reviewCount || 0) === 0);
  const lowRatingItems = items.filter((i: any) => i.rating > 0 && i.rating < 3.5);
  const adItems = items.filter((i: any) => i.isAd);
  const rocketItems = items.filter((i: any) => i.isRocket);

  // 상위 10개 상품 요약
  const topItemsSummary = items.slice(0, 10).map((item: any, idx: number) => ({
    rank: idx + 1,
    title: (item.title || "").slice(0, 60),
    price: item.price,
    rating: item.rating,
    reviewCount: item.reviewCount || 0,
    isAd: !!item.isAd,
    isRocket: !!item.isRocket,
  }));

  // 트렌드 데이터
  let trendData = "";
  if (historicalSnapshots.length >= 2) {
    const oldComp = historicalSnapshots[historicalSnapshots.length - 1]?.competitionScore || 0;
    const newComp = snapshot.competitionScore || 0;
    const oldPrice = historicalSnapshots[historicalSnapshots.length - 1]?.avgPrice || 0;
    trendData = `경쟁도 변화: ${oldComp} → ${newComp}, 평균가 변화: ${oldPrice.toLocaleString()}원 → ${avgPrice.toLocaleString()}원 (${historicalSnapshots.length}회 기록)`;
  }

  return {
    summary: `
[쿠팡 시장 데이터 - "${query}" 키워드]
- 분석 상품 수: ${totalItems}개
- 평균 판매가: ${avgPrice.toLocaleString()}원 (최저 ${priceMin.toLocaleString()}원 ~ 최고 ${priceMax.toLocaleString()}원)
- 평균 평점: ${avgRating}점
- 평균 리뷰 수: ${avgReview}개
- 경쟁도 점수: ${competitionScore}점/100
- 리뷰 100개 이상 상품: ${highReviewItems.length}개 (${totalItems ? Math.round(highReviewItems.length / totalItems * 100) : 0}%)
- 리뷰 10개 미만 상품: ${lowReviewItems.length}개 (${totalItems ? Math.round(lowReviewItems.length / totalItems * 100) : 0}%)
- 리뷰 0개 상품: ${noReviewItems.length}개
- 평점 3.5 미만 상품: ${lowRatingItems.length}개
- 광고 상품: ${adItems.length}개 (${totalItems ? Math.round(adItems.length / totalItems * 100) : 0}%)
- 로켓배송 상품: ${rocketItems.length}개 (${totalItems ? Math.round(rocketItems.length / totalItems * 100) : 0}%)
- 후보 저장 수: ${candidates.length}개
${trendData ? `- 트렌드: ${trendData}` : ""}
`.trim(),
    topItems: topItemsSummary,
    stats: {
      avgPrice, avgRating, avgReview, competitionScore, totalItems,
      priceMin, priceMax,
      highReviewCount: highReviewItems.length,
      lowReviewCount: lowReviewItems.length,
      noReviewCount: noReviewItems.length,
      lowRatingCount: lowRatingItems.length,
      adCount: adItems.length,
      rocketCount: rocketItems.length,
    },
  };
}

/** OpenAI GPT 기반 AI 리뷰 분석 */
async function generateReviewAnalysis(
  query: string,
  snapshot: any,
  items: any[],
  candidates: any[],
  historicalSnapshots: any[]
) {
  const marketData = buildMarketDataSummary(query, snapshot, items, candidates, historicalSnapshots);

  const systemPrompt = `당신은 쿠팡 셀러를 위한 전문 시장 분석 AI 컨설턴트입니다.
제공된 쿠팡 검색 결과 데이터를 분석하여 소싱 판단에 도움이 되는 심층 분석을 제공합니다.
반드시 아래 JSON 형식으로 응답하세요. 각 필드는 한국어로 작성합니다.

응답 JSON 형식:
{
  "painPoints": [{"point": "문제점 제목", "severity": "high|medium|low", "detail": "구체적 설명"}],
  "customerNeeds": [{"need": "고객 니즈", "priority": "high|medium|low", "insight": "분석 근거"}],
  "opportunities": [{"title": "기회 제목", "potential": "high|medium|low", "description": "상세 설명"}],
  "commonPraises": ["긍정적 패턴 1", "긍정적 패턴 2"],
  "commonComplaints": ["부정적 패턴 1", "부정적 패턴 2"],
  "priceSensitivity": "high|medium|low",
  "qualityConcerns": ["품질 우려사항 1", "품질 우려사항 2"],
  "recommendations": [{"action": "구체적 행동 지침", "priority": "high|medium|low", "expectedImpact": "기대 효과"}],
  "trendInsight": "트렌드 분석 한 줄 요약",
  "summaryText": "전체 분석 요약 (2-3문장)"
}

분석 시 고려사항:
1. 경쟁도 점수(0-100): 0에 가까울수록 블루오션, 100에 가까울수록 레드오션
2. 리뷰 100개 이상 비율이 높으면 신규 진입 장벽이 높음
3. 로켓배송 비율이 높으면 배송 경쟁력 필수
4. 광고 비율이 높으면 CPC 경쟁 심함
5. 가격대와 경쟁도를 종합하여 마진 가능성 분석
6. 실제 소싱 셀러가 바로 행동할 수 있는 구체적 추천 제공
7. 각 항목은 최소 2개, 최대 5개로 제한`;

  const userPrompt = `다음 쿠팡 시장 데이터를 분석하여 소싱 전략 보고서를 작성해주세요.

${marketData.summary}

[상위 10개 상품 상세]
${JSON.stringify(marketData.topItems, null, 2)}

위 데이터를 기반으로 시장 진입 가능성, 고객 니즈, 소싱 기회, 위험 요소를 종합적으로 분석해주세요.`;

  try {
    const gptResult = await callOpenAI([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ], { temperature: 0.7, maxTokens: 3000 });

    // GPT 결과를 표준 형식으로 정규화
    return {
      avgRating: marketData.stats.avgRating,
      avgReviewCount: marketData.stats.avgReview,
      painPoints: gptResult.painPoints || [],
      customerNeeds: gptResult.customerNeeds || [],
      opportunities: gptResult.opportunities || [],
      commonPraises: gptResult.commonPraises || [],
      commonComplaints: gptResult.commonComplaints || [],
      priceSensitivity: gptResult.priceSensitivity || "medium",
      qualityConcerns: gptResult.qualityConcerns || [],
      summaryText: gptResult.summaryText || "",
      recommendations: gptResult.recommendations || [],
      trendInsight: gptResult.trendInsight || "",
      aiPowered: true,
      marketOverview: {
        totalItems: marketData.stats.totalItems,
        avgPrice: marketData.stats.avgPrice,
        priceMin: marketData.stats.priceMin,
        priceMax: marketData.stats.priceMax,
        priceRange: marketData.stats.priceMax - marketData.stats.priceMin,
        avgRating: marketData.stats.avgRating,
        avgReview: marketData.stats.avgReview,
        competitionScore: marketData.stats.competitionScore,
        adRatio: marketData.stats.totalItems ? Math.round(marketData.stats.adCount / marketData.stats.totalItems * 100) : 0,
        rocketRatio: marketData.stats.totalItems ? Math.round(marketData.stats.rocketCount / marketData.stats.totalItems * 100) : 0,
        highReviewRatio: marketData.stats.totalItems ? Math.round(marketData.stats.highReviewCount / marketData.stats.totalItems * 100) : 0,
        noReviewRatio: marketData.stats.totalItems ? Math.round(marketData.stats.noReviewCount / marketData.stats.totalItems * 100) : 0,
      },
    };
  } catch (error: any) {
    console.error("[AI Analysis] OpenAI failed, falling back to rule-based:", error.message);
    // OpenAI 실패 시 규칙 기반 폴백
    return generateRuleBasedAnalysis(query, snapshot, items, candidates, historicalSnapshots);
  }
}

/** 규칙 기반 폴백 분석 (OpenAI 장애 시 사용) */
function generateRuleBasedAnalysis(
  query: string,
  snapshot: any,
  items: any[],
  candidates: any[],
  historicalSnapshots: any[]
) {
  const avgPrice = snapshot.avgPrice || 0;
  const avgRating = parseFloat(snapshot.avgRating) || 0;
  const avgReview = snapshot.avgReview || 0;
  const competitionScore = snapshot.competitionScore || 0;
  const totalItems = items.length;

  const prices = items.map((i: any) => i.price).filter((p: number) => p > 0);
  const priceMin = prices.length ? Math.min(...prices) : 0;
  const priceMax = prices.length ? Math.max(...prices) : 0;
  const priceRange = priceMax - priceMin;

  const highReviewItems = items.filter((i: any) => (i.reviewCount || 0) >= 100);
  const lowReviewItems = items.filter((i: any) => (i.reviewCount || 0) < 10);
  const noReviewItems = items.filter((i: any) => (i.reviewCount || 0) === 0);
  const lowRatingItems = items.filter((i: any) => i.rating > 0 && i.rating < 3.5);
  const adItems = items.filter((i: any) => i.isAd);
  const rocketItems = items.filter((i: any) => i.isRocket);

  let priceSensitivity: string;
  if (priceRange > avgPrice * 0.8) priceSensitivity = "high";
  else if (priceRange > avgPrice * 0.4) priceSensitivity = "medium";
  else priceSensitivity = "low";

  const painPoints: { point: string; severity: string; detail: string }[] = [];
  if (competitionScore >= 70) painPoints.push({ point: "높은 경쟁 강도", severity: "high", detail: `경쟁도 ${competitionScore}점으로 매우 치열합니다.` });
  if (highReviewItems.length > totalItems * 0.5) painPoints.push({ point: "리뷰 장벽 높음", severity: "high", detail: `${Math.round(highReviewItems.length / totalItems * 100)}%가 리뷰 100개 이상` });
  if (rocketItems.length > totalItems * 0.5) painPoints.push({ point: "로켓배송 비율 높음", severity: "medium", detail: `${Math.round(rocketItems.length / totalItems * 100)}%가 로켓배송` });
  if (adItems.length > totalItems * 0.3) painPoints.push({ point: "광고 비율 높음", severity: "medium", detail: `${adItems.length}개(${Math.round(adItems.length / totalItems * 100)}%)가 광고` });

  const customerNeeds: { need: string; priority: string; insight: string }[] = [];
  if (lowRatingItems.length > 0) customerNeeds.push({ need: "품질 개선", priority: "high", insight: `평점 3.5 미만 ${lowRatingItems.length}개` });
  customerNeeds.push({ need: "빠른 배송", priority: rocketItems.length > totalItems * 0.3 ? "high" : "medium", insight: `로켓배송 ${rocketItems.length}개` });

  const opportunities: { title: string; potential: string; description: string }[] = [];
  if (competitionScore < 45) opportunities.push({ title: "블루오션 시장", potential: "high", description: `경쟁도 ${competitionScore}점` });
  if (lowReviewItems.length > totalItems * 0.3) opportunities.push({ title: "리뷰 취약 상품 다수", potential: "high", description: `리뷰 10개 미만 ${lowReviewItems.length}개` });
  if (avgPrice > 20000 && competitionScore < 60) opportunities.push({ title: "고마진 + 낮은 경쟁", potential: "high", description: `평균가 ${avgPrice.toLocaleString()}원` });

  const recommendations: { action: string; priority: string; expectedImpact: string }[] = [];
  if (competitionScore < 50 && avgPrice > 15000) recommendations.push({ action: `"${query}" 키워드 즉시 소싱 검토`, priority: "high", expectedImpact: "마진 확보 유리" });
  recommendations.push({ action: "상위 상품 벤치마크 분석", priority: "medium", expectedImpact: "차별화 포인트 도출" });

  let trendInsight = "";
  if (historicalSnapshots.length >= 2) {
    const oldComp = historicalSnapshots[historicalSnapshots.length - 1]?.competitionScore || 0;
    const newComp = snapshot.competitionScore || 0;
    if (newComp > oldComp + 10) trendInsight = "⚠️ 경쟁 증가 추세";
    else if (newComp < oldComp - 10) trendInsight = "✅ 경쟁 감소 추세";
    else trendInsight = "→ 경쟁 안정적";
  }

  const summaryText = `[규칙기반] "${query}" 분석: ${totalItems}개 상품, 경쟁도 ${competitionScore}점, 평균가 ${avgPrice.toLocaleString()}원. ${opportunities.length}개 기회, ${painPoints.length}개 주의사항.`;

  return {
    avgRating, avgReviewCount: avgReview,
    painPoints, customerNeeds, opportunities,
    commonPraises: avgRating >= 4.0 ? ["전반적 만족도 높음"] : [],
    commonComplaints: lowRatingItems.length > 0 ? ["품질 편차 존재"] : [],
    priceSensitivity, qualityConcerns: lowRatingItems.length > 0 ? [`저평점 상품 ${lowRatingItems.length}개`] : [],
    summaryText, recommendations, trendInsight,
    aiPowered: false,
    marketOverview: {
      totalItems, avgPrice, priceMin, priceMax, priceRange, avgRating, avgReview, competitionScore,
      adRatio: totalItems ? Math.round(adItems.length / totalItems * 100) : 0,
      rocketRatio: totalItems ? Math.round(rocketItems.length / totalItems * 100) : 0,
      highReviewRatio: totalItems ? Math.round(highReviewItems.length / totalItems * 100) : 0,
      noReviewRatio: totalItems ? Math.round(noReviewItems.length / totalItems * 100) : 0,
    },
  };
}

// ============================================================
//  자동 키워드 일별 통계 계산 헬퍼
// ============================================================

async function autoComputeKeywordDailyStat(userId: number, query: string, db: any) {
  try {
    const today = new Date();
    today.setHours(today.getHours() + 9);
    const todayStr = today.toISOString().slice(0, 10);

    // ★ v7.3.3: 최근 스냅샷 중 가장 완전한 데이터(totalReviewSum 최대) 선택
    const recentSnapshots = await db.select()
      .from(extSearchSnapshots)
      .where(and(eq(extSearchSnapshots.userId, userId), eq(extSearchSnapshots.query, query)))
      .orderBy(desc(extSearchSnapshots.createdAt))
      .limit(5);

    if (!recentSnapshots.length) return;

    let bestSnapshot = recentSnapshots[0];
    let bestItems: any[] = [];
    let bestTotalReviewSum = 0;

    for (const snap of recentSnapshots) {
      let snapItems: any[] = [];
      try { snapItems = snap.itemsJson ? JSON.parse(snap.itemsJson) : []; } catch { snapItems = []; }
      const snapReviewSum = snapItems.reduce((sum: number, i: any) => sum + (i.reviewCount || 0), 0);
      if (snapReviewSum > bestTotalReviewSum) {
        bestTotalReviewSum = snapReviewSum;
        bestSnapshot = snap;
        bestItems = snapItems;
      }
    }

    const latest = bestSnapshot;
    const items = bestItems;
    const totalReviewSum = bestTotalReviewSum;

    const adCount = items.filter((i: any) => i.isAd).length;
    const rocketCount = items.filter((i: any) => i.isRocket).length;
    const highReviewCount = items.filter((i: any) => (i.reviewCount || 0) >= 100).length;
    const adRatio = items.length ? Math.round((adCount / items.length) * 100) : 0;

    // 다단계 이전 데이터 조회 (어제 → 최근 7일 이내 → 이전 스냅샷)
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    // 1단계: 어제 daily_stats 조회
    let [prevStat] = await db.select()
      .from(extKeywordDailyStats)
      .where(and(
        eq(extKeywordDailyStats.userId, userId),
        eq(extKeywordDailyStats.query, query),
        eq(extKeywordDailyStats.statDate, yesterdayStr),
      ))
      .limit(1);

    // 2단계: 어제 데이터 없으면 최근 7일 이내 가장 최근 daily_stats 조회
    if (!prevStat) {
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekAgoStr = weekAgo.toISOString().slice(0, 10);
      const [recentStat] = await db.select()
        .from(extKeywordDailyStats)
        .where(and(
          eq(extKeywordDailyStats.userId, userId),
          eq(extKeywordDailyStats.query, query),
          sql`${extKeywordDailyStats.statDate} >= ${weekAgoStr}`,
          sql`${extKeywordDailyStats.statDate} < ${todayStr}`,
        ))
        .orderBy(desc(extKeywordDailyStats.statDate))
        .limit(1);
      if (recentStat) prevStat = recentStat;
    }

    // 3단계: daily_stats도 없으면 이전 스냅샷과 직접 비교
    let prevSnapshotReviewSum: number | null = null;
    let prevSnapshotAvgPrice: number | null = null;
    let prevSnapshotTotalItems: number | null = null;
    let prevSnapshotCreatedAt: string | null = null;
    if (!prevStat) {
      const [prevSnapshot] = await db.select()
        .from(extSearchSnapshots)
        .where(and(
          eq(extSearchSnapshots.userId, userId),
          eq(extSearchSnapshots.query, query),
          sql`${extSearchSnapshots.id} < ${latest.id}`,
        ))
        .orderBy(desc(extSearchSnapshots.createdAt))
        .limit(1);

      if (prevSnapshot) {
        let prevItems: any[] = [];
        try { prevItems = prevSnapshot.itemsJson ? JSON.parse(prevSnapshot.itemsJson) : []; } catch { prevItems = []; }
        prevSnapshotReviewSum = prevItems.reduce((sum: number, i: any) => sum + (i.reviewCount || 0), 0);
        prevSnapshotAvgPrice = prevSnapshot.avgPrice || 0;
        prevSnapshotTotalItems = prevSnapshot.totalItems || 0;
        prevSnapshotCreatedAt = prevSnapshot.createdAt ? String(prevSnapshot.createdAt).slice(0, 10) : null;
      }
    }

    // ★ v7.3.3: 기존 growth 복구 소스 (오늘 저장값 또는 최근 7일 중 양수 growth)
    const [existingTodayStat] = await db.select()
      .from(extKeywordDailyStats)
      .where(and(
        eq(extKeywordDailyStats.userId, userId),
        eq(extKeywordDailyStats.query, query),
        eq(extKeywordDailyStats.statDate, todayStr),
      ))
      .limit(1);
    const todayStoredGrowth = existingTodayStat ? N(existingTodayStat.reviewGrowth) || 0 : 0;
    // 최근 7일 중 가장 최신의 양수 growth를 찾아 fallback으로 사용
    let recentPositiveGrowth = 0;
    if (todayStoredGrowth <= 0) {
      const recentStats = await db.select({
        reviewGrowth: extKeywordDailyStats.reviewGrowth,
        statDate: extKeywordDailyStats.statDate,
      })
        .from(extKeywordDailyStats)
        .where(and(
          eq(extKeywordDailyStats.userId, userId),
          eq(extKeywordDailyStats.query, query),
          sql`${extKeywordDailyStats.statDate} < ${todayStr}`,
          sql`${extKeywordDailyStats.statDate} >= DATE_SUB(${todayStr}, INTERVAL 7 DAY)`,
        ))
        .orderBy(desc(extKeywordDailyStats.statDate))
        .limit(7);
      for (const rs of recentStats) {
        const g = N(rs.reviewGrowth);
        if (g > 0) { recentPositiveGrowth = g; break; }
      }
    }
    const fallbackGrowth = todayStoredGrowth > 0 ? todayStoredGrowth : recentPositiveGrowth;

    // ★ v7.3.3: 리뷰 증가량 계산 — 수집 편차(상품 수 변동)에 의한 음수 방지
    let reviewGrowth = 0;
    let priceChange = 0;
    let productCountChange = 0;

    if (prevStat) {
      const prevDate = String(prevStat.statDate || '');
      if (prevDate !== todayStr) {
        const rawGrowth = totalReviewSum - (N(prevStat.totalReviewSum) || 0);
        if (rawGrowth >= 0) {
          reviewGrowth = rawGrowth;
        } else {
          // 음수 = 수집 편차 → fallback(오늘 기존값 or 어제 growth) 사용
          reviewGrowth = fallbackGrowth > 0 ? fallbackGrowth : 0;
        }
        priceChange = (latest.avgPrice || 0) - (N(prevStat.avgPrice) || 0);
        productCountChange = (latest.totalItems || 0) - (N(prevStat.productCount) || 0);
      } else if (fallbackGrowth > 0) {
        // 같은 날 재계산: 기존 growth 보존
        reviewGrowth = fallbackGrowth;
      }
    } else if (prevSnapshotReviewSum !== null) {
      if (prevSnapshotCreatedAt && prevSnapshotCreatedAt !== todayStr) {
        const rawGrowth = totalReviewSum - prevSnapshotReviewSum;
        if (rawGrowth >= 0) {
          reviewGrowth = rawGrowth;
        } else {
          reviewGrowth = fallbackGrowth > 0 ? fallbackGrowth : 0;
        }
        priceChange = (latest.avgPrice || 0) - (prevSnapshotAvgPrice || 0);
        productCountChange = (latest.totalItems || 0) - (prevSnapshotTotalItems || 0);
      }
    }

    const salesEstimate = reviewGrowth * 20;

    // ★ 개선: 수요 점수 — 성장 데이터 + 절대값 기반 기본 점수 병합
    let demandScore = 0;
    if (salesEstimate > 500) demandScore = 90;
    else if (salesEstimate > 200) demandScore = 75;
    else if (salesEstimate > 100) demandScore = 60;
    else if (salesEstimate > 50) demandScore = 45;
    else if (salesEstimate > 20) demandScore = 30;
    else if (salesEstimate > 5) demandScore = 15;
    else if (reviewGrowth > 0) demandScore = 10;

    // (B) 절대값 기반 기본 수요 점수 (이전 데이터 없어서 성장 계산 불가 시 보완)
    if (demandScore === 0 && items.length > 0) {
      let baselineDemand = 0;
      const avgReviewCount = totalReviewSum / Math.max(1, items.length);
      if (avgReviewCount > 500) baselineDemand += 25;
      else if (avgReviewCount > 200) baselineDemand += 20;
      else if (avgReviewCount > 100) baselineDemand += 15;
      else if (avgReviewCount > 50) baselineDemand += 10;
      else if (avgReviewCount > 20) baselineDemand += 5;
      if (items.length >= 30) baselineDemand += 10;
      else if (items.length >= 20) baselineDemand += 5;
      const rocketRatio = items.length ? rocketCount / items.length : 0;
      if (rocketRatio > 0.5) baselineDemand += 10;
      else if (rocketRatio > 0.3) baselineDemand += 5;
      demandScore = Math.min(50, baselineDemand);
    }

    // ★ v7.2.7 수정: 키워드 점수 — 정규화된 지표 합산 (100점 만점)
    // 각 지표를 0~1 범위로 정규화 후 가중합산
    const avgReviewPerProduct = items.length > 0 ? totalReviewSum / items.length : 0;
    const competitionFactor = Math.max(0, 100 - (latest.competitionScore || 0)) / 100;
    
    // 리뷰 증가 점수 (0~25점) - reviewGrowth 기반
    let reviewGrowthScore = 0;
    if (reviewGrowth >= 100) reviewGrowthScore = 25;
    else if (reviewGrowth >= 50) reviewGrowthScore = 20;
    else if (reviewGrowth >= 20) reviewGrowthScore = 15;
    else if (reviewGrowth >= 10) reviewGrowthScore = 10;
    else if (reviewGrowth >= 5) reviewGrowthScore = 7;
    else if (reviewGrowth > 0) reviewGrowthScore = 3;
    
    // 시장 규모 점수 (0~25점) - 평균 리뷰 수 기반
    let marketSizeScore = 0;
    if (avgReviewPerProduct >= 500) marketSizeScore = 25;
    else if (avgReviewPerProduct >= 200) marketSizeScore = 20;
    else if (avgReviewPerProduct >= 100) marketSizeScore = 15;
    else if (avgReviewPerProduct >= 50) marketSizeScore = 10;
    else if (avgReviewPerProduct >= 20) marketSizeScore = 5;
    
    // 경쟁 용이성 점수 (0~25점) - 낮은 경쟁 + 낮은 광고 비율
    const competitionEaseScore = Math.round(competitionFactor * 15 + (1 - adRatio / 100) * 10);
    
    // 수요 점수 (0~25점) - demandScore 기반 
    const demandPart = Math.round(demandScore * 0.25);
    
    const keywordScore = Math.min(100, reviewGrowthScore + marketSizeScore + competitionEaseScore + demandPart);

    // upsert
    const [existing] = await db.select({ id: extKeywordDailyStats.id })
      .from(extKeywordDailyStats)
      .where(and(
        eq(extKeywordDailyStats.userId, userId),
        eq(extKeywordDailyStats.query, query),
        eq(extKeywordDailyStats.statDate, todayStr),
      ))
      .limit(1);

    const statData = {
      snapshotCount: 1,
      productCount: latest.totalItems || 0,
      avgPrice: latest.avgPrice || 0,
      avgRating: latest.avgRating || "0",
      avgReview: latest.avgReview || 0,
      totalReviewSum,
      adCount,
      adRatio,
      rocketCount,
      highReviewCount,
      competitionScore: latest.competitionScore || 0,
      competitionLevel: (latest.competitionLevel || "medium") as "easy" | "medium" | "hard",
      reviewGrowth,
      salesEstimate,
      priceChange,
      productCountChange,
      demandScore,
      keywordScore,
    };

    if (existing) {
      await db.update(extKeywordDailyStats).set(statData).where(eq(extKeywordDailyStats.id, existing.id));
    } else {
      await db.insert(extKeywordDailyStats).values({ userId, query, statDate: todayStr, ...statData });
    }
    console.log(`[autoComputeKeywordDailyStat] "${query}" rGrowth:${reviewGrowth} sales:${salesEstimate} demand:${demandScore} kwScore:${keywordScore}`);
  } catch (err) {
    console.error("[autoComputeKeywordDailyStat]", err);
  }
}

// ============================================================
//  추적 상품 자동 매칭 (검색 시 유사상품/경쟁자 자동 수집)
// ============================================================

async function autoMatchTrackedProducts(userId: number, query: string, items: any[], db: any) {
  try {
    if (!items.length) return;

    // 이 키워드와 관련된 추적 상품 찾기
    const trackings = await db.select()
      .from(extProductTrackings)
      .where(and(
        eq(extProductTrackings.userId, userId),
        eq(extProductTrackings.isActive, true),
      ));

    for (const tracking of trackings) {
      const keywords: string[] = tracking.keywords ? JSON.parse(tracking.keywords) : [];
      // 검색어가 추적 상품의 키워드와 매칭되는지 확인
      const isMatch = keywords.some((kw: string) =>
        kw === query || query.includes(kw) || kw.includes(query)
      );
      if (!isMatch) continue;

      // 추적 상품이 검색 결과에 있는지 확인 (coupangProductId로 매칭)
      let myProduct = null;
      let myRank = 0;
      if (tracking.coupangProductId) {
        const idx = items.findIndex((item: any) =>
          String(item.productId) === String(tracking.coupangProductId)
        );
        if (idx >= 0) {
          myProduct = items[idx];
          myRank = idx + 1;
        }
      }

      // 유사 상품 (검색 결과의 상위 상품 중 추적 상품이 아닌 것들)
      const similarProducts = items
        .filter((item: any) => String(item.productId) !== String(tracking.coupangProductId))
        .slice(0, 10)
        .map((item: any, idx: number) => ({
          productId: item.productId,
          title: (item.title || "").slice(0, 80),
          price: item.price || 0,
          rating: item.rating || 0,
          reviewCount: item.reviewCount || 0,
          rank: idx + 1,
          isAd: !!item.isAd,
          isRocket: !!item.isRocket,
        }));

      // 경쟁자 요약
      const competitorSummary = {
        totalCompetitors: items.length,
        avgPrice: Math.round(items.reduce((s: number, i: any) => s + (i.price || 0), 0) / items.length),
        avgReview: Math.round(items.reduce((s: number, i: any) => s + (i.reviewCount || 0), 0) / items.length),
        adCount: items.filter((i: any) => i.isAd).length,
        rocketCount: items.filter((i: any) => i.isRocket).length,
        keyword: query,
        capturedAt: new Date().toISOString(),
      };

      // 추적 데이터 업데이트
      const updateData: any = {
        similarProductsJson: JSON.stringify(similarProducts),
        competitorSummaryJson: JSON.stringify(competitorSummary),
        competitorCount: items.length,
        lastTrackedAt: sql`NOW()`,
      };

      if (myProduct) {
        const oldPrice = tracking.latestPrice || 0;
        const oldReview = tracking.latestReviewCount || 0;
        const oldRank = tracking.latestRank || 0;

        updateData.latestPrice = myProduct.price || 0;
        updateData.latestRating = (myProduct.rating || 0).toFixed ? (myProduct.rating || 0).toFixed(1) : "0";
        updateData.latestReviewCount = myProduct.reviewCount || 0;
        updateData.latestRank = myRank;
        updateData.latestRankKeyword = query;
        updateData.priceChange = (myProduct.price || 0) - oldPrice;
        updateData.reviewChange = (myProduct.reviewCount || 0) - oldReview;
        updateData.rankChange = oldRank > 0 ? oldRank - myRank : 0;
      }

      await db.update(extProductTrackings)
        .set(updateData)
        .where(eq(extProductTrackings.id, tracking.id));

      // 일일 스냅샷 upsert
      const today = new Date();
      today.setHours(today.getHours() + 9);
      const todayStr = today.toISOString().slice(0, 10);

      const [existingSnap] = await db.select({ id: extProductDailySnapshots.id })
        .from(extProductDailySnapshots)
        .where(and(
          eq(extProductDailySnapshots.trackingId, tracking.id),
          eq(extProductDailySnapshots.snapshotDate, todayStr),
        )).limit(1);

      const snapData = {
        price: myProduct?.price || tracking.latestPrice || 0,
        rating: myProduct ? (myProduct.rating || 0).toFixed(1) : (tracking.latestRating || "0"),
        reviewCount: myProduct?.reviewCount || tracking.latestReviewCount || 0,
        rankPosition: myRank || tracking.latestRank || 0,
        rankKeyword: query,
        competitorCount: items.length,
        similarAvgPrice: competitorSummary.avgPrice,
        similarAvgReview: competitorSummary.avgReview,
        adCount: competitorSummary.adCount,
      };

      if (existingSnap) {
        await db.update(extProductDailySnapshots).set(snapData)
          .where(eq(extProductDailySnapshots.id, existingSnap.id));
      } else {
        await db.insert(extProductDailySnapshots).values({
          userId,
          trackingId: tracking.id,
          snapshotDate: todayStr,
          ...snapData,
        });
      }
    }
  } catch (err) {
    console.error("[autoMatchTrackedProducts]", err);
  }
}
