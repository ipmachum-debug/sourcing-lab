import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  extSearchSnapshots, extCandidates, extRankTrackings, extTrackedKeywords,
  extProductDetails, extNotifications, extReviewAnalyses, extWingSearches
} from "../../drizzle/schema";
import { eq, and, desc, sql, like, asc, gte, ne, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

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

    return { ...stats, topQueries };
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

      const result = await db.insert(products).values({
        userId: ctx.user!.id,
        recordDate: today,
        weekday,
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

    return { statusCounts, ...totals };
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
            WHERE user_id = ${ctx.user!.id} AND \`query\` = ${input.query}
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

      return trends;
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

      return db.select({
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
            WHERE user_id = ${ctx.user!.id} AND \`query\` = ${input.query}
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
            WHERE user_id = ${ctx.user!.id} AND \`query\` = ${input.query}
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
        searches: recentSearches?.count || 0,
        candidates: recentCandidates?.count || 0,
        rankRecords: recentRanks?.count || 0,
        productDetails: recentDetails?.count || 0,
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

      return { count: result?.count || 0 };
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
        searchStats: searchStats || {},
        candidateStats: { ...(candStats || {}), statusCounts },
        topQueries,
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
    }).optional().default({}))
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
          gte(extWingSearches.createdAt, sevenDaysAgo),
        ))
        .groupBy(sql`DATE(created_at)`)
        .orderBy(asc(sql`DATE(created_at)`));

      return {
        ...stats,
        topKeywords,
        categories,
        dailySearches,
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
