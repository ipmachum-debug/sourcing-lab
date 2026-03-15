/**
 * ============================================================
 * [DEPRECATED 2026-03-15] Keyword Metrics Engine
 * ============================================================
 *
 * ⚠ 이 모듈은 구 ext_keyword_daily_status 테이블 기반이며, 현재 미사용 (0행).
 * 정확한 통계는 ext_keyword_daily_stats (per-product delta) 기반의
 * demand.router.ts → rebuildDailyStats 를 사용하세요.
 *
 * 원래 설계: ext_keyword_daily_status 일별 스냅샷을 기반으로:
 *   1. review_delta 계산 (전일 대비 리뷰 증가량)
 *   2. 카테고리 계수 × 가격/성숙도/광고 보정 → sales_estimate
 *   3. EMA7 / EMA30 스무딩
 *   4. 30일 rolling 평균/표준편차 → spike detection
 *   5. 알람 생성 (spike / explosion / price_drop / competition_jump)
 *
 * 그래프 출력:
 *   - bar: sales_estimate (원본)
 *   - line: sales_estimate_ema7 (부드러운 추세)
 *   - marker: alert_level (spike=주황, explosion=빨강)
 */

import { getDb } from "./db";
import { extKeywordDailyStatus, extKeywordMetrics, extKeywordAlerts } from "../drizzle/schema";
import { eq, and, desc, asc, sql } from "drizzle-orm";

// ============================================================
//  카테고리 계수 (리뷰 1개 ≈ 판매 N건)
// ============================================================

const CATEGORY_FACTOR: Record<string, number> = {
  "생활용품": 35,
  "주방": 35,
  "반려동물": 28,
  "식품": 18,
  "뷰티": 22,
  "전자기기": 10,
  "패션잡화": 16,
  "패션의류": 16,
  "유아동": 20,
  "스포츠": 14,
  "가구인테리어": 12,
  "문구완구": 20,
  "자동차": 12,
  "헬스": 22,
  "기타": 20,
};

// ============================================================
//  보정 계수
// ============================================================

function getCategoryFactor(category?: string | null): number {
  if (!category) return CATEGORY_FACTOR["기타"];
  return CATEGORY_FACTOR[category] ?? CATEGORY_FACTOR["기타"];
}

/** 가격 보정: 고가 상품일수록 리뷰 1개가 더 많은 판매량 의미 */
function getPriceFactor(avgPrice: number): number {
  if (avgPrice < 10000) return 0.9;
  if (avgPrice < 30000) return 1.0;
  if (avgPrice < 70000) return 1.15;
  if (avgPrice < 150000) return 1.35;
  return 1.6;
}

/** 성숙도 보정: 리뷰 많은 성숙 상품 vs 신상품 */
function getMaturityFactor(medianReview: number): number {
  if (medianReview < 10) return 0.7;
  if (medianReview < 50) return 0.9;
  if (medianReview < 200) return 1.0;
  if (medianReview < 1000) return 1.1;
  return 1.15;
}

/** 광고 보정: 광고 비중 높으면 리뷰 증감 왜곡 */
function getAdFactor(adRatio: number): number {
  if (adRatio >= 0.3) return 0.9;
  if (adRatio >= 0.15) return 0.95;
  return 1.0;
}

// ============================================================
//  수학 유틸리티
// ============================================================

function N(v: any): number { return Number(v) || 0; }

/** EMA (Exponential Moving Average) 계산 */
function ema(values: number[], period: number): number[] {
  if (!values.length) return [];
  const alpha = 2 / (period + 1);
  let current = values[0];
  const out = [current];
  for (let i = 1; i < values.length; i++) {
    current = alpha * values[i] + (1 - alpha) * current;
    out.push(current);
  }
  return out;
}

/** 평균 */
function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 표준편차 */
function stddev(values: number[]): number {
  if (!values.length) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** 소수점 반올림 */
function round(v: number, decimals = 4): number {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

// ============================================================
//  타입 정의
// ============================================================

interface DailyStatusRow {
  statDate: string;
  totalItems: number;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  totalReviewSum: number;
  medianReview: number;
  adCount: number;
  newProductCount: number;
}

export interface MetricRow {
  metricDate: string;
  reviewDelta: number;
  reviewDeltaEma7: number;
  reviewDeltaEma30: number;
  salesEstimate: number;
  salesEstimateEma7: number;
  salesEstimateEma30: number;
  adRatio: number;
  newProductRatio: number;
  priceSpread: number;
  rollingMean30: number;
  rollingStd30: number;
  spikeScore: number;
  alertLevel: "normal" | "spike" | "explosion";
}

export interface AlertRow {
  alertDate: string;
  alertType: "sales_spike" | "sales_explosion" | "price_drop" | "competition_jump";
  alertScore: number;
  message: string;
}

// ============================================================
//  핵심 계산 로직
// ============================================================

/**
 * ext_keyword_daily_status 행들로부터 메트릭 계산
 * (날짜순 ASC 정렬 필요)
 */
export function buildMetricsFromDailyStatus(
  rows: DailyStatusRow[],
  categoryName?: string | null,
): MetricRow[] {
  if (!rows.length) return [];

  const reviewDeltas: number[] = [];
  const salesEstimates: number[] = [];
  const catFactor = getCategoryFactor(categoryName);

  // Step 1: review_delta + sales_estimate 계산
  for (let i = 0; i < rows.length; i++) {
    const today = rows[i];
    const yesterday = i > 0 ? rows[i - 1] : null;

    // review_delta: 음수면 0 처리 (리뷰 삭제 등)
    const reviewDelta = Math.max(
      0,
      N(today.totalReviewSum) - (yesterday ? N(yesterday.totalReviewSum) : N(today.totalReviewSum)),
    );
    reviewDeltas.push(reviewDelta);

    const totalItems = N(today.totalItems);
    const adRatio = totalItems > 0 ? N(today.adCount) / totalItems : 0;
    const priceFactor = getPriceFactor(N(today.avgPrice));
    const maturityFactor = getMaturityFactor(N(today.medianReview));
    const adFactor = getAdFactor(adRatio);

    const salesEstimate = Math.round(
      reviewDelta * catFactor * priceFactor * maturityFactor * adFactor,
    );
    salesEstimates.push(salesEstimate);
  }

  // Step 2: EMA 계산
  const reviewDeltaEma7 = ema(reviewDeltas, 7);
  const reviewDeltaEma30 = ema(reviewDeltas, 30);
  const salesEstimateEma7 = ema(salesEstimates, 7);
  const salesEstimateEma30 = ema(salesEstimates, 30);

  // Step 3: 메트릭 조합
  const metrics: MetricRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const totalItems = N(row.totalItems);
    const adRatio = totalItems > 0 ? N(row.adCount) / totalItems : 0;
    const newProductRatio = totalItems > 0 ? N(row.newProductCount) / totalItems : 0;
    const priceSpread = N(row.maxPrice) - N(row.minPrice);

    // 30일 rolling window
    const start = Math.max(0, i - 29);
    const salesWindow = salesEstimates.slice(start, i + 1);
    const rollingMean30 = mean(salesWindow);
    const rollingStd30 = stddev(salesWindow);

    const spikeScore = rollingStd30 > 0
      ? (salesEstimates[i] - rollingMean30) / rollingStd30
      : 0;

    let alertLevel: "normal" | "spike" | "explosion" = "normal";
    if (spikeScore >= 3) alertLevel = "explosion";
    else if (spikeScore >= 2) alertLevel = "spike";

    metrics.push({
      metricDate: row.statDate,
      reviewDelta: reviewDeltas[i],
      reviewDeltaEma7: round(reviewDeltaEma7[i]),
      reviewDeltaEma30: round(reviewDeltaEma30[i]),
      salesEstimate: salesEstimates[i],
      salesEstimateEma7: round(salesEstimateEma7[i]),
      salesEstimateEma30: round(salesEstimateEma30[i]),
      adRatio: round(adRatio),
      newProductRatio: round(newProductRatio),
      priceSpread,
      rollingMean30: round(rollingMean30),
      rollingStd30: round(rollingStd30),
      spikeScore: round(spikeScore),
      alertLevel,
    });
  }

  return metrics;
}

/**
 * 메트릭에서 추가 알람 생성 (가격 붕괴 + 경쟁 폭증 포함)
 */
export function buildAlertsFromMetrics(
  metrics: MetricRow[],
  dailyRows: DailyStatusRow[],
): AlertRow[] {
  const alerts: AlertRow[] = [];

  for (let i = 0; i < metrics.length; i++) {
    const m = metrics[i];
    const row = dailyRows[i];

    // 판매 급등
    if (m.alertLevel === "spike") {
      alerts.push({
        alertDate: m.metricDate,
        alertType: "sales_spike",
        alertScore: m.spikeScore,
        message: `30일 평균 대비 판매 추정 급등 (σ=${m.spikeScore.toFixed(1)})`,
      });
    }
    if (m.alertLevel === "explosion") {
      alerts.push({
        alertDate: m.metricDate,
        alertType: "sales_explosion",
        alertScore: m.spikeScore,
        message: `30일 평균 대비 매우 큰 판매 추정 급등 (σ=${m.spikeScore.toFixed(1)})`,
      });
    }

    // 가격 붕괴: 오늘 평균가 < 0.7 × 7일 중앙값
    if (i >= 7) {
      const recentPrices = dailyRows.slice(Math.max(0, i - 6), i + 1).map(r => N(r.avgPrice)).filter(p => p > 0);
      if (recentPrices.length > 0) {
        const sorted = [...recentPrices].sort((a, b) => a - b);
        const medianPrice = sorted[Math.floor(sorted.length / 2)];
        const todayPrice = N(row.avgPrice);
        if (todayPrice > 0 && todayPrice < 0.7 * medianPrice) {
          alerts.push({
            alertDate: m.metricDate,
            alertType: "price_drop",
            alertScore: round(todayPrice / medianPrice),
            message: `평균 가격이 최근 7일 중앙값의 ${Math.round(todayPrice / medianPrice * 100)}% 수준으로 급락`,
          });
        }
      }
    }

    // 경쟁 폭증: 오늘 상품수 > 1.5 × 7일 평균
    if (i >= 7) {
      const recentCounts = dailyRows.slice(Math.max(0, i - 6), i + 1).map(r => N(r.totalItems));
      const avgCount = mean(recentCounts);
      const todayCount = N(row.totalItems);
      if (avgCount > 0 && todayCount > 1.5 * avgCount) {
        alerts.push({
          alertDate: m.metricDate,
          alertType: "competition_jump",
          alertScore: round(todayCount / avgCount),
          message: `상품 수가 최근 7일 평균의 ${Math.round(todayCount / avgCount * 100)}% 수준으로 급증`,
        });
      }
    }
  }

  return alerts;
}

// ============================================================
//  DB 저장 (Drizzle ORM)
// ============================================================

/**
 * 특정 키워드의 메트릭 재계산 + 저장
 */
export async function rebuildKeywordMetrics(
  userId: number,
  keyword: string,
  categoryName?: string | null,
): Promise<{ metricsCount: number; alertsCount: number }> {
  const db = await getDb();
  if (!db) throw new Error("DB 연결 실패");

  // 1. ext_keyword_daily_status에서 일별 스냅샷 조회 (ASC)
  const dailyRows = await db
    .select({
      statDate: extKeywordDailyStatus.statDate,
      totalItems: extKeywordDailyStatus.totalItems,
      avgPrice: extKeywordDailyStatus.avgPrice,
      minPrice: extKeywordDailyStatus.minPrice,
      maxPrice: extKeywordDailyStatus.maxPrice,
      totalReviewSum: extKeywordDailyStatus.totalReviewSum,
      medianReview: extKeywordDailyStatus.medianReview,
      adCount: extKeywordDailyStatus.adCount,
      newProductCount: extKeywordDailyStatus.newProductCount,
    })
    .from(extKeywordDailyStatus)
    .where(
      and(
        eq(extKeywordDailyStatus.userId, userId),
        eq(extKeywordDailyStatus.keyword, keyword),
      ),
    )
    .orderBy(asc(extKeywordDailyStatus.statDate));

  if (!dailyRows.length) return { metricsCount: 0, alertsCount: 0 };

  // 2. 메트릭 계산
  const metrics = buildMetricsFromDailyStatus(
    dailyRows.map(r => ({
      statDate: r.statDate,
      totalItems: N(r.totalItems),
      avgPrice: N(r.avgPrice),
      minPrice: N(r.minPrice),
      maxPrice: N(r.maxPrice),
      totalReviewSum: N(r.totalReviewSum),
      medianReview: N(r.medianReview),
      adCount: N(r.adCount),
      newProductCount: N(r.newProductCount),
    })),
    categoryName,
  );

  // 3. 알람 계산
  const alerts = buildAlertsFromMetrics(
    metrics,
    dailyRows.map(r => ({
      statDate: r.statDate,
      totalItems: N(r.totalItems),
      avgPrice: N(r.avgPrice),
      minPrice: N(r.minPrice),
      maxPrice: N(r.maxPrice),
      totalReviewSum: N(r.totalReviewSum),
      medianReview: N(r.medianReview),
      adCount: N(r.adCount),
      newProductCount: N(r.newProductCount),
    })),
  );

  // 4. 메트릭 upsert (ON DUPLICATE KEY UPDATE)
  if (metrics.length) {
    const values = metrics.map(m => ({
      userId,
      keyword,
      metricDate: m.metricDate,
      reviewDelta: m.reviewDelta,
      reviewDeltaEma7: String(m.reviewDeltaEma7),
      reviewDeltaEma30: String(m.reviewDeltaEma30),
      salesEstimate: m.salesEstimate,
      salesEstimateEma7: String(m.salesEstimateEma7),
      salesEstimateEma30: String(m.salesEstimateEma30),
      adRatio: String(m.adRatio),
      newProductRatio: String(m.newProductRatio),
      priceSpread: m.priceSpread,
      rollingMean30: String(m.rollingMean30),
      rollingStd30: String(m.rollingStd30),
      spikeScore: String(m.spikeScore),
      alertLevel: m.alertLevel,
    }));

    // Drizzle ORM batch insert with onDuplicateKeyUpdate
    await db.insert(extKeywordMetrics).values(values).onDuplicateKeyUpdate({
      set: {
        reviewDelta: sql`VALUES(review_delta)`,
        reviewDeltaEma7: sql`VALUES(review_delta_ema7)`,
        reviewDeltaEma30: sql`VALUES(review_delta_ema30)`,
        salesEstimate: sql`VALUES(sales_estimate)`,
        salesEstimateEma7: sql`VALUES(sales_estimate_ema7)`,
        salesEstimateEma30: sql`VALUES(sales_estimate_ema30)`,
        adRatio: sql`VALUES(ad_ratio)`,
        newProductRatio: sql`VALUES(new_product_ratio)`,
        priceSpread: sql`VALUES(price_spread)`,
        rollingMean30: sql`VALUES(rolling_mean_30)`,
        rollingStd30: sql`VALUES(rolling_std_30)`,
        spikeScore: sql`VALUES(spike_score)`,
        alertLevel: sql`VALUES(alert_level)`,
      },
    });
  }

  // 5. 알람 upsert
  if (alerts.length) {
    const alertValues = alerts.map(a => ({
      userId,
      keyword,
      alertDate: a.alertDate,
      alertType: a.alertType,
      alertScore: String(a.alertScore),
      message: a.message,
    }));

    await db.insert(extKeywordAlerts).values(alertValues).onDuplicateKeyUpdate({
      set: {
        alertScore: sql`VALUES(alert_score)`,
        message: sql`VALUES(message)`,
      },
    });
  }

  return { metricsCount: metrics.length, alertsCount: alerts.length };
}

/**
 * 전체 활성 키워드의 메트릭 일괄 재계산
 */
export async function rebuildAllKeywordMetrics(userId: number): Promise<{
  total: number;
  processed: number;
  errors: string[];
}> {
  const db = await getDb();
  if (!db) throw new Error("DB 연결 실패");

  // 고유 키워드 목록 조회
  const keywords = await db
    .selectDistinct({ keyword: extKeywordDailyStatus.keyword })
    .from(extKeywordDailyStatus)
    .where(eq(extKeywordDailyStatus.userId, userId));

  const errors: string[] = [];
  let processed = 0;

  for (const { keyword } of keywords) {
    try {
      await rebuildKeywordMetrics(userId, keyword);
      processed++;
    } catch (e: any) {
      errors.push(`${keyword}: ${e.message}`);
    }
  }

  return { total: keywords.length, processed, errors };
}
