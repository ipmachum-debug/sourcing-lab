/**
 * Extension Sub-Router: 내 상품 자동 추적 (Product Tracking)
 */
import { z } from "zod";
import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import {
  extProductTrackings, extProductDailySnapshots, extProductDetails, extNotifications, extTrackedKeywords, extKeywordDailyStats, extCandidates,
  extSearchSnapshots, products, productChannelMappings,
} from "../../../drizzle/schema";
import { eq, and, desc, sql, like, asc, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { N } from "./_helpers";
import { callOpenAI } from "./_aiHelpers";

export const trackingsRouter = router({
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

});
