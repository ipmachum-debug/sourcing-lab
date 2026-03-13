/**
 * Extension Sub-Router: 판매 추정 시스템 (Sales Estimation)
 */
import { z } from "zod";
import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import {
  extCategoryReviewRates, extProductSalesEstimates,
  extProductTrackings, extProductDailySnapshots,
} from "../../../drizzle/schema";
import { eq, and, desc, sql, asc, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { N } from "./_helpers";
import {
  calculateSalesEstimate, buildWindowMetrics, matchCategoryKey,
  DEFAULT_CATEGORY_REVIEW_RATES, getSalesGradeLabel,
  type EstimateInput, type SnapshotRow,
} from "../../salesEstimate";

export const salesRouter = router({
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
});
