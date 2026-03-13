/**
 * Ali Validation Engine Router — 알리 검증 엔진 API
 *
 * 정방향: 쿠팡 키워드 → 알리 검색 → 추천
 * 역방향: 알리 상품 → 쿠팡 키워드 추천
 * 공통: 매핑 관리 + 추적 스냅샷
 */

import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  aliSearchCache,
  aliProductCache,
  aliKeywordMatchCandidate,
  keywordAliMapping,
  keywordAliTrackingSnapshot,
  keywordMaster,
  keywordDailyMetrics,
} from "../../drizzle/schema";
import { eq, and, desc, sql, gte, lte, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  generateAliSearchQueries,
  aliTitleToKoKeywords,
  calculateForwardMatchScore,
  calculateReverseMatchScore,
  estimateMargin,
  EN_TO_KO,
} from "../lib/aliMatchEngine";

export const aliValidationRouter = router({
  // ================================================================
  //  1. 정방향: 쿠팡 키워드 → 알리 검색어 생성
  // ================================================================
  generateSearchQueries: protectedProcedure
    .input(z.object({
      keywordId: z.number().int(),
      keyword: z.string(),
      canonicalKeyword: z.string().optional(),
      attributes: z.array(z.string()).optional(),
    }))
    .query(({ input }) => {
      const queries = generateAliSearchQueries(
        input.keyword,
        input.canonicalKeyword,
        input.attributes,
      );
      return { queries };
    }),

  // ================================================================
  //  2. 검색 캐시 저장 (확장프로그램 또는 크롤러가 결과 전송)
  // ================================================================
  saveSearchResults: protectedProcedure
    .input(z.object({
      keywordId: z.number().int(),
      searchQuery: z.string(),
      results: z.array(z.object({
        rank: z.number().int(),
        productUrl: z.string(),
        productTitle: z.string(),
        productImageUrl: z.string().optional(),
        priceMin: z.number().default(0),
        priceMax: z.number().default(0),
        orderCount: z.number().int().default(0),
        rating: z.number().default(0),
        shippingSummary: z.string().optional(),
      })),
      coupangKeyword: z.string(),
      canonicalKeyword: z.string().optional(),
      attributes: z.array(z.string()).optional(),
      coupangAvgPrice: z.number().optional(),
      cacheTtlHours: z.number().default(24),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      const now = new Date();
      const expiresAt = new Date(now.getTime() + input.cacheTtlHours * 60 * 60 * 1000);
      const expiresStr = expiresAt.toISOString().replace("T", " ").slice(0, 19);

      // 기존 캐시 만료 처리
      await db.delete(aliSearchCache).where(
        and(
          eq(aliSearchCache.keywordId, input.keywordId),
          eq(aliSearchCache.searchQuery, input.searchQuery),
        ),
      );

      const scored = input.results.map(r => {
        const scores = calculateForwardMatchScore({
          aliTitle: r.productTitle,
          coupangKeyword: input.coupangKeyword,
          canonicalKeyword: input.canonicalKeyword,
          attributes: input.attributes,
          aliPriceUSD: r.priceMin,
          coupangAvgPrice: input.coupangAvgPrice,
          aliOrderCount: r.orderCount,
          aliRating: r.rating,
        });
        return { ...r, scores };
      });

      // 점수 기준 정렬
      scored.sort((a, b) => b.scores.finalScore - a.scores.finalScore);

      const values = scored.map((r, idx) => ({
        keywordId: input.keywordId,
        searchQuery: input.searchQuery,
        resultRank: idx + 1,
        productUrl: r.productUrl,
        productTitle: r.productTitle,
        productImageUrl: r.productImageUrl || null,
        priceMin: String(r.priceMin),
        priceMax: String(r.priceMax),
        orderCount: r.orderCount,
        rating: String(r.rating),
        shippingSummary: r.shippingSummary || null,
        matchScore: String(r.scores.finalScore),
        titleMatchScore: String(r.scores.titleMatchScore),
        attributeMatchScore: String(r.scores.attributeMatchScore),
        priceFitScore: String(r.scores.priceFitScore),
        orderSignalScore: String(r.scores.orderSignalScore),
        shippingFitScore: String(r.scores.shippingFitScore),
        expiresAt: expiresStr,
      }));

      if (values.length > 0) {
        await db.insert(aliSearchCache).values(values);
      }

      return { saved: values.length, topScore: scored[0]?.scores.finalScore ?? 0 };
    }),

  // ================================================================
  //  3. 캐시된 검색 결과 조회 (추천 리스트)
  // ================================================================
  getSearchResults: protectedProcedure
    .input(z.object({
      keywordId: z.number().int(),
      limit: z.number().int().default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);
      const results = await db
        .select()
        .from(aliSearchCache)
        .where(
          and(
            eq(aliSearchCache.keywordId, input.keywordId),
            gte(aliSearchCache.expiresAt, nowStr),
          ),
        )
        .orderBy(desc(aliSearchCache.matchScore))
        .limit(input.limit);

      return results;
    }),

  // ================================================================
  //  4. 역방향: 알리 상품 캐시 저장
  // ================================================================
  saveAliProduct: protectedProcedure
    .input(z.object({
      aliProductId: z.string().optional(),
      productUrl: z.string(),
      title: z.string(),
      priceMin: z.number().default(0),
      priceMax: z.number().default(0),
      orderCount: z.number().int().default(0),
      rating: z.number().default(0),
      categoryText: z.string().optional(),
      attributes: z.array(z.string()).optional(),
      imageUrl: z.string().optional(),
      sourceType: z.enum(["page", "search", "extension"]).default("extension"),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      // 한국어 제목 생성
      const koKeywords = aliTitleToKoKeywords(input.title);
      const titleKo = koKeywords[0] || null;

      const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const expiresStr = expires.toISOString().replace("T", " ").slice(0, 19);

      // UPSERT: 같은 URL이면 업데이트
      const existing = await db
        .select({ id: aliProductCache.id })
        .from(aliProductCache)
        .where(eq(aliProductCache.productUrl, input.productUrl))
        .limit(1);

      let cacheId: number;

      if (existing.length > 0) {
        cacheId = existing[0].id;
        await db.update(aliProductCache).set({
          aliProductId: input.aliProductId || null,
          title: input.title,
          titleKo,
          priceMin: String(input.priceMin),
          priceMax: String(input.priceMax),
          orderCount: input.orderCount,
          rating: String(input.rating),
          categoryText: input.categoryText || null,
          attributesJson: input.attributes || null,
          imageUrl: input.imageUrl || null,
          sourceType: input.sourceType,
          expiresAt: expiresStr,
        }).where(eq(aliProductCache.id, cacheId));
      } else {
        const result = await db.insert(aliProductCache).values({
          aliProductId: input.aliProductId || null,
          productUrl: input.productUrl,
          title: input.title,
          titleKo,
          priceMin: String(input.priceMin),
          priceMax: String(input.priceMax),
          orderCount: input.orderCount,
          rating: String(input.rating),
          categoryText: input.categoryText || null,
          attributesJson: input.attributes || null,
          imageUrl: input.imageUrl || null,
          sourceType: input.sourceType,
          expiresAt: expiresStr,
        });
        cacheId = Number((result as any)?.[0]?.insertId ?? 0);
      }

      return { cacheId, titleKo, koKeywords };
    }),

  // ================================================================
  //  5. 역방향: 알리 상품 → 쿠팡 키워드 추천
  // ================================================================
  reverseMatch: protectedProcedure
    .input(z.object({
      aliCacheId: z.number().int(),
      limit: z.number().int().default(10),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      // 알리 상품 캐시 조회
      const [aliProduct] = await db
        .select()
        .from(aliProductCache)
        .where(eq(aliProductCache.id, input.aliCacheId))
        .limit(1);

      if (!aliProduct) {
        throw new TRPCError({ code: "NOT_FOUND", message: "알리 상품 캐시를 찾을 수 없습니다." });
      }

      // 한국어 키워드 후보 생성
      const koKeywords = aliTitleToKoKeywords(aliProduct.title);
      if (koKeywords.length === 0) {
        return { aliProduct, koKeywords: [], candidates: [] };
      }

      // 쿠팡 키워드 마스터에서 유사 키워드 검색
      // LIKE로 각 한국어 토큰이 포함된 키워드 찾기
      const koTokens = koKeywords.flatMap(kw => kw.split(/\s+/));
      const uniqueTokens = [...new Set(koTokens)].slice(0, 5);

      if (uniqueTokens.length === 0) {
        return { aliProduct, koKeywords, candidates: [] };
      }

      // OR 조건으로 키워드 검색
      const conditions = uniqueTokens.map(tok =>
        sql`${keywordMaster.keyword} LIKE ${"%" + tok + "%"}`,
      );
      const orCondition = sql`(${sql.join(conditions, sql` OR `)})`;

      const kwResults = await db
        .select({
          id: keywordMaster.id,
          keyword: keywordMaster.keyword,
          normalizedKeyword: keywordMaster.normalizedKeyword,
          canonicalKeyword: keywordMaster.canonicalKeyword,
          categoryHint: keywordMaster.categoryHint,
          validationStatus: keywordMaster.validationStatus,
        })
        .from(keywordMaster)
        .where(and(
          eq(keywordMaster.userId, ctx.user.id),
          eq(keywordMaster.isActive, true),
          orCondition,
        ))
        .limit(50);

      // 각 키워드에 대해 역방향 점수 계산
      const scored = await Promise.all(kwResults.map(async kw => {
        // 최근 일별 지표에서 coupang_avg_price, final_score 조회
        const [metrics] = await db
          .select({
            coupangAvgPrice: keywordDailyMetrics.coupangAvgPrice,
            finalScore: keywordDailyMetrics.finalScore,
          })
          .from(keywordDailyMetrics)
          .where(eq(keywordDailyMetrics.keywordId, kw.id))
          .orderBy(desc(keywordDailyMetrics.metricDate))
          .limit(1);

        const scores = calculateReverseMatchScore({
          aliTitle: aliProduct.title,
          coupangKeyword: kw.keyword,
          canonicalKeyword: kw.canonicalKeyword || undefined,
          aliPriceUSD: Number(aliProduct.priceMin) || 0,
          coupangAvgPrice: metrics?.coupangAvgPrice ? Number(metrics.coupangAvgPrice) : undefined,
          coupangFinalScore: metrics?.finalScore ? Number(metrics.finalScore) : undefined,
        });

        const margin = Number(aliProduct.priceMin) > 0
          ? estimateMargin(
            Number(aliProduct.priceMin),
            metrics?.coupangAvgPrice ? Number(metrics.coupangAvgPrice) : undefined,
          )
          : null;

        return {
          keyword: kw,
          scores,
          coupangAvgPrice: metrics?.coupangAvgPrice ? Number(metrics.coupangAvgPrice) : null,
          coupangFinalScore: metrics?.finalScore ? Number(metrics.finalScore) : null,
          margin,
        };
      }));

      // 점수 정렬
      scored.sort((a, b) => b.scores.finalMatchScore - a.scores.finalMatchScore);

      return {
        aliProduct,
        koKeywords,
        candidates: scored.slice(0, input.limit),
      };
    }),

  // ================================================================
  //  6. 매핑 생성 (운영자가 선택)
  // ================================================================
  createMapping: protectedProcedure
    .input(z.object({
      keywordId: z.number().int(),
      aliProductUrl: z.string(),
      aliProductId: z.string().optional(),
      aliProductTitle: z.string(),
      selectedPrice: z.number().default(0),
      selectedShippingFee: z.number().default(0),
      selectedOrderCount: z.number().int().default(0),
      selectedRating: z.number().default(0),
      matchScore: z.number().default(0),
      matchDirection: z.enum(["forward", "reverse"]).default("forward"),
      isPrimary: z.boolean().default(false),
      selectedReason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      const exchangeRate = 1350;
      const priceMajor = input.selectedPrice;
      const totalCost = Math.round(priceMajor * exchangeRate * 1.08) + 6000 + Math.round(input.selectedShippingFee * exchangeRate);

      // isPrimary이면 기존 primary 해제
      if (input.isPrimary) {
        await db.update(keywordAliMapping)
          .set({ isPrimary: false })
          .where(
            and(
              eq(keywordAliMapping.keywordId, input.keywordId),
              eq(keywordAliMapping.isPrimary, true),
            ),
          );
      }

      const result = await db.insert(keywordAliMapping).values({
        keywordId: input.keywordId,
        aliProductUrl: input.aliProductUrl,
        aliProductId: input.aliProductId || null,
        aliProductTitle: input.aliProductTitle,
        selectedPrice: String(input.selectedPrice),
        selectedShippingFee: String(input.selectedShippingFee),
        selectedTotalCost: String(totalCost),
        selectedOrderCount: input.selectedOrderCount,
        selectedRating: String(input.selectedRating),
        matchScore: String(input.matchScore),
        matchDirection: input.matchDirection,
        isPrimary: input.isPrimary,
        trackingEnabled: true,
        selectedBy: ctx.user.email || ctx.user.name || String(ctx.user.id),
        selectedReason: input.selectedReason || null,
      });

      return { mappingId: Number((result as any)?.[0]?.insertId ?? 0) };
    }),

  // ================================================================
  //  7. 매핑 목록 조회
  // ================================================================
  listMappings: protectedProcedure
    .input(z.object({
      keywordId: z.number().int().optional(),
      mappingStatus: z.enum(["active", "inactive", "dropped"]).optional(),
      trackingEnabled: z.boolean().optional(),
      limit: z.number().int().default(50),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      const conditions = [];
      if (input.keywordId !== undefined) {
        conditions.push(eq(keywordAliMapping.keywordId, input.keywordId));
      }
      if (input.mappingStatus) {
        conditions.push(eq(keywordAliMapping.mappingStatus, input.mappingStatus));
      }
      if (input.trackingEnabled !== undefined) {
        conditions.push(eq(keywordAliMapping.trackingEnabled, input.trackingEnabled));
      }

      const results = await db
        .select()
        .from(keywordAliMapping)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(keywordAliMapping.isPrimary), desc(keywordAliMapping.matchScore))
        .limit(input.limit);

      return results;
    }),

  // ================================================================
  //  8. 매핑 업데이트 (상태 변경, 주력 전환 등)
  // ================================================================
  updateMapping: protectedProcedure
    .input(z.object({
      mappingId: z.number().int(),
      isPrimary: z.boolean().optional(),
      trackingEnabled: z.boolean().optional(),
      mappingStatus: z.enum(["active", "inactive", "dropped"]).optional(),
      selectedReason: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      const updateData: Record<string, any> = {};
      if (input.isPrimary !== undefined) updateData.isPrimary = input.isPrimary;
      if (input.trackingEnabled !== undefined) updateData.trackingEnabled = input.trackingEnabled;
      if (input.mappingStatus !== undefined) updateData.mappingStatus = input.mappingStatus;
      if (input.selectedReason !== undefined) updateData.selectedReason = input.selectedReason;

      // isPrimary로 전환시 기존 primary 해제
      if (input.isPrimary) {
        const [mapping] = await db
          .select({ keywordId: keywordAliMapping.keywordId })
          .from(keywordAliMapping)
          .where(eq(keywordAliMapping.id, input.mappingId))
          .limit(1);

        if (mapping) {
          await db.update(keywordAliMapping)
            .set({ isPrimary: false })
            .where(
              and(
                eq(keywordAliMapping.keywordId, mapping.keywordId),
                eq(keywordAliMapping.isPrimary, true),
              ),
            );
        }
      }

      await db.update(keywordAliMapping)
        .set(updateData)
        .where(eq(keywordAliMapping.id, input.mappingId));

      return { success: true };
    }),

  // ================================================================
  //  9. 추적 스냅샷 저장
  // ================================================================
  saveTrackingSnapshot: protectedProcedure
    .input(z.object({
      mappingId: z.number().int(),
      priceMin: z.number().default(0),
      priceMax: z.number().default(0),
      shippingFee: z.number().default(0),
      orderCount: z.number().int().default(0),
      rating: z.number().default(0),
      stockText: z.string().optional(),
      deliveryText: z.string().optional(),
      availabilityStatus: z.enum(["available", "low_stock", "out_of_stock", "unknown"]).default("unknown"),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);
      const totalCost = Math.round((input.priceMin * 1350 * 1.08) + 6000 + (input.shippingFee * 1350));

      // 이전 스냅샷과 비교하여 변화율 계산
      const [prevSnapshot] = await db
        .select()
        .from(keywordAliTrackingSnapshot)
        .where(eq(keywordAliTrackingSnapshot.mappingId, input.mappingId))
        .orderBy(desc(keywordAliTrackingSnapshot.snapshotAt))
        .limit(1);

      let priceChangeRate = 0;
      let orderVelocity = 0;
      if (prevSnapshot) {
        const prevPrice = Number(prevSnapshot.priceMin) || 0;
        if (prevPrice > 0 && input.priceMin > 0) {
          priceChangeRate = (input.priceMin - prevPrice) / prevPrice;
        }
        const prevOrders = prevSnapshot.orderCount || 0;
        if (prevOrders > 0) {
          orderVelocity = (input.orderCount - prevOrders) / prevOrders;
        }
      }

      await db.insert(keywordAliTrackingSnapshot).values({
        mappingId: input.mappingId,
        snapshotAt: nowStr,
        priceMin: String(input.priceMin),
        priceMax: String(input.priceMax),
        shippingFee: String(input.shippingFee),
        totalCost: String(totalCost),
        orderCount: input.orderCount,
        rating: String(input.rating),
        stockText: input.stockText || null,
        deliveryText: input.deliveryText || null,
        availabilityStatus: input.availabilityStatus,
        priceChangeRate: String(Math.round(priceChangeRate * 10000) / 10000),
        orderVelocity: String(Math.round(orderVelocity * 10000) / 10000),
      });

      return { success: true, priceChangeRate, orderVelocity };
    }),

  // ================================================================
  //  10. 추적 이력 조회
  // ================================================================
  getTrackingHistory: protectedProcedure
    .input(z.object({
      mappingId: z.number().int(),
      limit: z.number().int().default(30),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      return db
        .select()
        .from(keywordAliTrackingSnapshot)
        .where(eq(keywordAliTrackingSnapshot.mappingId, input.mappingId))
        .orderBy(desc(keywordAliTrackingSnapshot.snapshotAt))
        .limit(input.limit);
    }),

  // ================================================================
  //  11. 캐시 정리 (만료된 캐시 삭제)
  // ================================================================
  cleanExpiredCache: protectedProcedure
    .mutation(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);

      const searchResult = await db.delete(aliSearchCache)
        .where(lte(aliSearchCache.expiresAt, nowStr));

      const productResult = await db.delete(aliProductCache)
        .where(
          and(
            sql`${aliProductCache.expiresAt} IS NOT NULL`,
            lte(aliProductCache.expiresAt, nowStr),
          ),
        );

      return { cleaned: true };
    }),

  // ================================================================
  //  12. EN_TO_KO 사전 조회 (확장프로그램에서 사용)
  // ================================================================
  getDictionary: protectedProcedure
    .query(() => {
      return { enToKo: EN_TO_KO };
    }),

  // ================================================================
  //  13. 키워드 상세 + 알리 검증 통합 조회
  // ================================================================
  getKeywordAliSummary: protectedProcedure
    .input(z.object({
      keywordId: z.number().int(),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      // 키워드 정보
      const [kw] = await db
        .select()
        .from(keywordMaster)
        .where(
          and(
            eq(keywordMaster.id, input.keywordId),
            eq(keywordMaster.userId, ctx.user.id),
          ),
        )
        .limit(1);

      if (!kw) {
        throw new TRPCError({ code: "NOT_FOUND", message: "키워드를 찾을 수 없습니다." });
      }

      // 최근 일별 지표
      const [metrics] = await db
        .select()
        .from(keywordDailyMetrics)
        .where(eq(keywordDailyMetrics.keywordId, kw.id))
        .orderBy(desc(keywordDailyMetrics.metricDate))
        .limit(1);

      // 검색어 생성
      const searchQueries = generateAliSearchQueries(
        kw.keyword,
        kw.canonicalKeyword || undefined,
      );

      // 캐시된 추천 결과
      const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);
      const cachedResults = await db
        .select()
        .from(aliSearchCache)
        .where(
          and(
            eq(aliSearchCache.keywordId, kw.id),
            gte(aliSearchCache.expiresAt, nowStr),
          ),
        )
        .orderBy(desc(aliSearchCache.matchScore))
        .limit(20);

      // 연결된 매핑
      const mappings = await db
        .select()
        .from(keywordAliMapping)
        .where(
          and(
            eq(keywordAliMapping.keywordId, kw.id),
            eq(keywordAliMapping.mappingStatus, "active"),
          ),
        )
        .orderBy(desc(keywordAliMapping.isPrimary), desc(keywordAliMapping.matchScore));

      return {
        keyword: kw,
        metrics: metrics || null,
        searchQueries,
        cachedResults,
        mappings,
      };
    }),
});
