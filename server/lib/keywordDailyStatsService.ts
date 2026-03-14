/**
 * ============================================================
 * Keyword Daily Stats Service (v8.3.1)
 * ============================================================
 *
 * ext_keyword_daily_stats의 단일 계산 경로 (Single Source of Truth).
 *
 * ★ v8.3.1 핵심 변경: Per-Product Matched Delta 엔진
 *
 * 문제: 기존 normalizeReviewSeries()의 sum-diff 방식은
 *       상품 구성 변동(20-45% 일일 교체)에 의해 20-40배 왜곡됨
 *       예) 실제 +30리뷰/일 → sum-diff: +1188 (40배 과대)
 *
 * 해결: 동일 상품(productId)의 리뷰 변화만 추적
 *       → 상품 교체 노이즈 완전 제거
 *       → match rate로 비매칭 상품 보정 (scaledDelta)
 *
 * 내부 흐름:
 *   1. 최근 45일 raw 조회 + 스냅샷 items_json 파싱
 *   2. 날짜별 best 스냅샷 선택 (reviewSum 최대)
 *   3. ★ Per-product matched delta 계산 (인접 스냅샷 비교)
 *   4. P70 baseProductCount 계산
 *   5. normalizeReviewSeries() 실행 (데이터 상태/기준점 판정용만)
 *   6. ★ Per-product delta로 reviewGrowth/salesEstimate 교체
 *      - 스냅샷 있는 날: scaledDelta 직접 사용
 *      - 스냅샷 없는 날: 신뢰 delta 평균으로 보간
 *   7. MA7/MA30 재계산 (per-product delta 기반)
 *   8. spike 탐지 / 점수 계산
 *   9. ext_keyword_daily_stats UPSERT
 */
import {
  extKeywordDailyStats,
  extSearchSnapshots,
} from "../../drizzle/schema";
import { eq, and, desc, sql, asc } from "drizzle-orm";
import {
  computeBaseProductCount,
  normalizeReviewSum,
  isValidSnapshot,
  resolveReviewDelta,
  computeFallbackDeltas,
  normalizeReviewSeries,
  computePerProductDelta,
  detectSpike,
  type RawDailyData,
  type NormalizedMetric,
  type SpikeLevel,
} from "./reviewNormalization";

/** Drizzle decimal/SUM → number */
function N(v: any): number {
  return Number(v) || 0;
}

// ============================================================
//  Score 계산 유틸 (demandScore, keywordScore 등)
// ============================================================

/**
 * ★ v8.2.0: 연속 로그 스케일 수요점수 (0–100 균등 분산)
 *
 * 기존: 6단계 버킷 (500 초과 → 무조건 90) → 변별력 없음
 * 개선: log 스케일로 0–100 연속 분포 + 보조 지표 보정
 *
 * 기준값 (쿠팡 시장):
 *   - salesRef 1 → ~0점, 10 → ~17점, 50 → ~28점, 200 → ~39점
 *   - 500 → ~46점, 2000 → ~56점, 10000 → ~68점, 50000 → ~79점
 *   - salesRef 단독으로 최대 80점 (나머지 20점은 보조 지표)
 */
function computeDemandScore(
  salesEstimateMa7: number,
  reviewGrowth: number,
  items: any[],
  totalReviewSum: number,
  rocketCount: number,
): number {
  const salesRef = salesEstimateMa7;

  // ── 주 지표: salesRef 로그 스케일 (0–80점) ──
  // log10(1)=0 → 0점, log10(100000)=5 → 80점
  let mainScore = 0;
  if (salesRef > 0) {
    mainScore = Math.min(80, (Math.log10(salesRef) / 5) * 80);
  }

  // ── 보조 지표 (0–20점) ──
  let auxScore = 0;

  // 리뷰 증가 활력 (0–8점): log 스케일
  if (reviewGrowth > 0) {
    auxScore += Math.min(8, (Math.log10(reviewGrowth + 1) / 4) * 8);
  }

  // 시장 규모 (0–7점): 상품수 × 평균리뷰
  if (items.length > 0) {
    const avgReviewCount = totalReviewSum / Math.max(1, items.length);
    const marketDepth = items.length * avgReviewCount;
    if (marketDepth > 0) {
      auxScore += Math.min(7, (Math.log10(marketDepth) / 6) * 7);
    }
  }

  // 로켓배송 비율 (0–5점): 수요 신뢰도 지표
  if (items.length > 0) {
    const rocketRatio = rocketCount / items.length;
    auxScore += rocketRatio * 5;
  }

  return Math.round(Math.min(100, mainScore + auxScore));
}

/**
 * ★ v8.2.0: 연속 가중평균 종합점수 (0–100)
 *
 * 4개 축 각각 연속 함수로 산출 후 가중합산:
 *   - 리뷰 성장성 (30%): MA7 기반 일간 리뷰 증가
 *   - 시장 규모 (25%): 상품당 평균 리뷰 → 시장 깊이
 *   - 진입 용이성 (25%): 경쟁도 역수 + 광고 비율 역수
 *   - 수요 강도 (20%): demandScore 직접 반영
 */
function computeKeywordScore(
  reviewGrowthMa7: number,
  avgReviewPerProduct: number,
  competitionScore: number,
  adRatio: number,
  demandScore: number,
): number {
  // ── 축 1: 리뷰 성장성 (0–100) ──
  // log10(1)=0 → 0, log10(200)≈2.3 → 100
  let growthAxis = 0;
  if (reviewGrowthMa7 > 0) {
    growthAxis = Math.min(100, (Math.log10(reviewGrowthMa7 + 1) / 2.3) * 100);
  }

  // ── 축 2: 시장 규모 (0–100) ──
  // log10(1)=0 → 0, log10(1000)=3 → 100
  let marketAxis = 0;
  if (avgReviewPerProduct > 0) {
    marketAxis = Math.min(
      100,
      (Math.log10(avgReviewPerProduct + 1) / 3) * 100,
    );
  }

  // ── 축 3: 진입 용이성 (0–100) ──
  // competitionScore 0=블루오션(100점), 100=레드오션(0점)
  // adRatio 0%=광고없음(100점), 50%+=광고포화(0점)
  const competitionEase = Math.max(0, 100 - competitionScore);
  const adEase = Math.max(0, 100 - adRatio * 2); // 50%에서 0점
  const entryAxis = competitionEase * 0.6 + adEase * 0.4;

  // ── 축 4: 수요 강도 (0–100) ──
  const demandAxis = demandScore; // 이미 0-100 연속 함수

  // ── 가중합산 ──
  const weighted =
    growthAxis * 0.3 +
    marketAxis * 0.25 +
    entryAxis * 0.25 +
    demandAxis * 0.2;

  return Math.round(Math.min(100, weighted));
}

// ============================================================
//  핵심: rebuildKeywordDailyStatsForKeyword
// ============================================================

export type RebuildResult = {
  success: boolean;
  daysProcessed: number;
  reviewGrowth: number;
  salesEstimate: number;
  salesEstimateMa7: number;
  salesEstimateMa30: number;
  spikeLevel: SpikeLevel;
};

/**
 * 하나의 키워드에 대해 최근 45일 시계열을 재구축.
 * ext_keyword_daily_stats를 단일 truth로 업데이트.
 */
export async function rebuildKeywordDailyStatsForKeyword(
  db: any,
  userId: number,
  query: string,
  opts: {
    todayStr?: string;
    todaySnapshot?: {
      items: any[];
      totalReviewSum: number;
      avgPrice: number;
      avgRating: string;
      avgReview: number;
      adCount: number;
      rocketCount: number;
      highReviewCount: number;
      competitionScore: number;
      competitionLevel: string;
      totalItems: number;
    };
    reviewToSalesFactor?: number;
    windowDays?: number;
  } = {},
): Promise<RebuildResult> {
  const factor = opts.reviewToSalesFactor ?? 20;
  // ★ v7.7.0: 기본 90일로 확장 (연간 축적 가능, 필요 시 730일까지)
  const windowDays = opts.windowDays ?? 90;

  // 오늘 날짜
  let todayStr = opts.todayStr;
  if (!todayStr) {
    const now = new Date();
    now.setHours(now.getHours() + 9);
    todayStr = now.toISOString().slice(0, 10);
  }

  // ================================================================
  //  1단계: 오늘 스냅샷 결정
  // ================================================================
  let todaySnap = opts.todaySnapshot;
  if (!todaySnap) {
    const recentSnapshots = await db
      .select()
      .from(extSearchSnapshots)
      .where(
        and(
          eq(extSearchSnapshots.userId, userId),
          eq(extSearchSnapshots.query, query),
        ),
      )
      .orderBy(desc(extSearchSnapshots.createdAt))
      .limit(5);

    if (!recentSnapshots.length) {
      return {
        success: false,
        daysProcessed: 0,
        reviewGrowth: 0,
        salesEstimate: 0,
        salesEstimateMa7: 0,
        salesEstimateMa30: 0,
        spikeLevel: "normal",
      };
    }

    let bestSnapshot = recentSnapshots[0];
    let bestItems: any[] = [];
    let bestTotalReviewSum = 0;
    for (const snap of recentSnapshots) {
      let snapItems: any[] = [];
      try {
        snapItems = snap.itemsJson ? JSON.parse(snap.itemsJson) : [];
      } catch {
        snapItems = [];
      }
      const snapReviewSum = snapItems.reduce(
        (sum: number, i: any) => sum + (i.reviewCount || 0),
        0,
      );
      if (snapReviewSum > bestTotalReviewSum) {
        bestTotalReviewSum = snapReviewSum;
        bestSnapshot = snap;
        bestItems = snapItems;
      }
    }

    todaySnap = {
      items: bestItems,
      totalReviewSum: bestTotalReviewSum,
      avgPrice: bestSnapshot.avgPrice || 0,
      avgRating: bestSnapshot.avgRating || "0",
      avgReview: bestSnapshot.avgReview || 0,
      adCount: bestItems.filter((i: any) => i.isAd).length,
      rocketCount: bestItems.filter((i: any) => i.isRocket).length,
      highReviewCount: bestItems.filter(
        (i: any) => (i.reviewCount || 0) >= 100,
      ).length,
      competitionScore: bestSnapshot.competitionScore || 0,
      competitionLevel: bestSnapshot.competitionLevel || "medium",
      totalItems: bestItems.length,
    };
  }

  // ================================================================
  //  2단계: 최근 windowDays일 과거 데이터 + 스냅샷 조회
  // ================================================================
  const recentHistory = await db
    .select({
      id: extKeywordDailyStats.id,
      statDate: extKeywordDailyStats.statDate,
      productCount: extKeywordDailyStats.productCount,
      totalReviewSum: extKeywordDailyStats.totalReviewSum,
      reviewGrowth: extKeywordDailyStats.reviewGrowth,
      salesEstimate: extKeywordDailyStats.salesEstimate,
      avgPrice: extKeywordDailyStats.avgPrice,
    })
    .from(extKeywordDailyStats)
    .where(
      and(
        eq(extKeywordDailyStats.userId, userId),
        eq(extKeywordDailyStats.query, query),
        sql`${extKeywordDailyStats.statDate} >= DATE_SUB(${todayStr}, INTERVAL ${windowDays} DAY)`,
      ),
    )
    .orderBy(asc(extKeywordDailyStats.statDate));

  // ★ v7.7.2: 실제 크롤링(ext_search_snapshots) 날짜 조회
  // — 스냅샷이 존재하는 날짜만 valid anchor로 인정
  // ★ v8.2.1: total_review_sum=0인 스냅샷도 items_json에서 리뷰합 복구
  const allSnapshots = await db
    .select({
      id: extSearchSnapshots.id,
      createdAt: extSearchSnapshots.createdAt,
      totalReviewSum: extSearchSnapshots.totalReviewSum,
      totalItems: extSearchSnapshots.totalItems,
      avgPrice: extSearchSnapshots.avgPrice,
      itemsJson: extSearchSnapshots.itemsJson,
    })
    .from(extSearchSnapshots)
    .where(
      and(
        eq(extSearchSnapshots.userId, userId),
        eq(extSearchSnapshots.query, query),
        sql`${extSearchSnapshots.createdAt} >= DATE_SUB(${todayStr}, INTERVAL ${windowDays} DAY)`,
      ),
    )
    .orderBy(desc(extSearchSnapshots.createdAt));

  const realCrawlDates = new Set<string>();
  // ★ v8.2.1: 날짜별 최적 스냅샷 (items_json에서 리뷰합 계산)
  const bestSnapByDate = new Map<string, { reviewSum: number; productCount: number; avgPrice: number; items: any[] }>();

  for (const snap of allSnapshots) {
    const d = new Date(snap.createdAt);
    d.setHours(d.getHours() + 9); // KST
    const dateStr = d.toISOString().slice(0, 10);
    realCrawlDates.add(dateStr);

    // items_json에서 실제 리뷰합 계산 (total_review_sum이 0이어도 복구)
    let snapItems: any[] = [];
    try {
      snapItems = snap.itemsJson ? JSON.parse(snap.itemsJson) : [];
    } catch {
      snapItems = [];
    }
    const computedSum = snapItems.reduce(
      (sum: number, i: any) => sum + (i.reviewCount || 0), 0,
    );
    const reviewSum = computedSum > 0 ? computedSum : N(snap.totalReviewSum);

    const existing = bestSnapByDate.get(dateStr);
    if (!existing || reviewSum > existing.reviewSum) {
      bestSnapByDate.set(dateStr, {
        reviewSum,
        productCount: snapItems.length || N(snap.totalItems),
        avgPrice: N(snap.avgPrice),
        items: snapItems,
      });
    }
  }

  // ★ per-product delta용: 최근 스냅샷 2개 (allSnapshots에서 재사용)
  const recentSnapsForDelta = allSnapshots.slice(0, 10);

  // per-product delta 시도
  let perProductDeltaResult: ReturnType<typeof computePerProductDelta> = null;
  if (recentSnapsForDelta.length >= 2) {
    try {
      const currSnap = recentSnapsForDelta[0];
      // 직전 날짜의 스냅샷 찾기 (같은 날 제외)
      const currDate = new Date(currSnap.createdAt).toISOString().slice(0, 10);
      const prevSnap = recentSnapsForDelta.find((s: any) => {
        const d = new Date(s.createdAt).toISOString().slice(0, 10);
        return d !== currDate;
      });

      if (prevSnap) {
        const currItems = currSnap.itemsJson
          ? JSON.parse(currSnap.itemsJson)
          : [];
        const prevItems = prevSnap.itemsJson
          ? JSON.parse(prevSnap.itemsJson)
          : [];
        perProductDeltaResult = computePerProductDelta(prevItems, currItems);
      }
    } catch {
      // per-product delta 실패 → normalizeReviewSeries에 위임
    }
  }

  // ================================================================
  //  ★ v8.3.1: Per-Product Matched Delta 엔진 (완전 재설계)
  //  
  //  핵심 원리: 동일 상품의 리뷰 증가량만 추적
  //  - 상품 구성 변동 노이즈 완전 제거
  //  - 개별 상품 리뷰 감소(삭제)는 0으로 처리
  //  - match rate 30% 미만이면 fallback (이전 평균) 사용
  //  - 스냅샷 없는 날짜는 인접 스냅샷 평균값 분배
  // ================================================================
  const sortedDates = [...bestSnapByDate.keys()].sort();
  const perProductDailyDelta = new Map<string, { 
    matchedDelta: number; matchRate: number; scaledDelta: number; dayGap: number; reliable: boolean 
  }>();

  for (let i = 1; i < sortedDates.length; i++) {
    const prevDate = sortedDates[i - 1];
    const currDate = sortedDates[i];
    const prevSnap = bestSnapByDate.get(prevDate)!;
    const currSnap = bestSnapByDate.get(currDate)!;

    if (!prevSnap.items.length || !currSnap.items.length) continue;

    const prevMap = new Map<string, number>();
    for (const item of prevSnap.items) {
      if (item.productId) prevMap.set(String(item.productId), item.reviewCount || 0);
    }

    let matched = 0;
    let matchedDelta = 0;
    for (const item of currSnap.items) {
      const pid = String(item.productId);
      if (prevMap.has(pid)) {
        matched++;
        // 개별 상품 리뷰 감소는 0 처리 (리뷰 삭제 무시)
        matchedDelta += Math.max(0, (item.reviewCount || 0) - prevMap.get(pid)!);
      }
    }

    const matchRate = matched / Math.max(currSnap.items.length, 1);
    const dayGap = Math.max(1, Math.round(
      (new Date(currDate).getTime() - new Date(prevDate).getTime()) / 86400000,
    ));
    
    // match rate 30% 이상이면 신뢰할 수 있는 delta
    const reliable = matchRate >= 0.3 && matched >= 3;
    const scaledDelta = reliable
      ? Math.round((matchedDelta / Math.max(matchRate, 0.5)) / dayGap)
      : 0;

    perProductDailyDelta.set(currDate, { matchedDelta, matchRate, scaledDelta, dayGap, reliable });
  }

  // ★ v8.3.1: 신뢰할 수 있는 delta들의 평균 (fallback용)
  const reliableDeltas = [...perProductDailyDelta.values()].filter(d => d.reliable && d.scaledDelta > 0);
  const avgReliableDelta = reliableDeltas.length > 0
    ? Math.round(reliableDeltas.reduce((s, d) => s + d.scaledDelta, 0) / reliableDeltas.length)
    : 0;

  // ================================================================
  //  3단계: RawDailyData 시계열 구성
  // ================================================================
  const rawSeries: RawDailyData[] = [];
  const existingByDate = new Map<
    string,
    { id: number; reviewGrowth: number; salesEstimate: number }
  >();

  for (const row of recentHistory) {
    const date = String(row.statDate);
    if (date === todayStr) {
      existingByDate.set(date, {
        id: row.id,
        reviewGrowth: N(row.reviewGrowth),
        salesEstimate: N(row.salesEstimate),
      });
      continue; // 오늘은 스냅샷 데이터 사용
    }
    existingByDate.set(date, {
      id: row.id,
      reviewGrowth: N(row.reviewGrowth),
      salesEstimate: N(row.salesEstimate),
    });

    // ★ v8.2.1: totalReviewSum이 0이면 items_json에서 복구한 값 사용
    let reviewSum = N(row.totalReviewSum);
    let productCount = N(row.productCount);
    let avgPrice = N(row.avgPrice);
    const bestSnap = bestSnapByDate.get(date);
    if (bestSnap && bestSnap.reviewSum > 0 && (reviewSum === 0 || bestSnap.reviewSum > reviewSum)) {
      reviewSum = bestSnap.reviewSum;
      if (bestSnap.productCount > 0) productCount = bestSnap.productCount;
      if (bestSnap.avgPrice > 0) avgPrice = bestSnap.avgPrice;
    }

    rawSeries.push({
      statDate: date,
      productCount,
      reviewSum,
      avgPrice,
      // ★ v7.7.2: 실제 크롤링(스냅샷)이 있는 날만 valid anchor로 인정
      isValidSnapshot:
        productCount > 0 &&
        reviewSum > 0 &&
        realCrawlDates.has(date),
    });
  }

  // 오늘 데이터 추가
  rawSeries.push({
    statDate: todayStr,
    productCount: todaySnap.totalItems,
    reviewSum: todaySnap.totalReviewSum,
    avgPrice: todaySnap.avgPrice,
    isValidSnapshot:
      todaySnap.totalItems > 0 && todaySnap.totalReviewSum > 0,
  });

  // 날짜순 정렬
  rawSeries.sort((a, b) => a.statDate.localeCompare(b.statDate));

  if (rawSeries.length < 1) {
    return {
      success: false,
      daysProcessed: 0,
      reviewGrowth: 0,
      salesEstimate: 0,
      salesEstimateMa7: 0,
      salesEstimateMa30: 0,
      spikeLevel: "normal",
    };
  }

  // ================================================================
  //  4단계: baseProductCount (P70) 계산
  // ================================================================
  const allProductCounts = rawSeries
    .map(r => r.productCount)
    .filter(c => c > 0);
  const { baseProductCount } = computeBaseProductCount(allProductCounts);
  const effectiveBase =
    baseProductCount > 0
      ? baseProductCount
      : Math.max(...allProductCounts, todaySnap.totalItems, 1);

  // ================================================================
  //  5단계: normalizeReviewSeries() 실행 — 단일 계산 경로
  // ================================================================
  const normalizedMetrics = normalizeReviewSeries(
    rawSeries,
    effectiveBase,
    factor,
  );

  // ================================================================
  //  6단계: ★ v8.3.1 Per-Product Matched Delta = 유일한 진실 (Single Source of Truth)
  //
  //  normalizeReviewSeries는 데이터 상태/기준점 판정에만 사용.
  //  모든 reviewGrowth/salesEstimate는 per-product delta에서 산출.
  //
  //  처리 규칙:
  //  (A) 스냅샷 O + per-product delta 신뢰 → scaledDelta 사용, dataStatus 'raw_valid'
  //  (B) 스냅샷 O + per-product delta 비신뢰(match<30%) → avgReliableDelta fallback
  //  (C) 스냅샷 X (보간 날짜) → avgReliableDelta 사용, dataStatus 'interpolated'
  //  (D) baseline/missing → 0
  // ================================================================
  const todayMetric = normalizedMetrics.find(m => m.metricDate === todayStr);

  for (const metric of normalizedMetrics) {
    // (D) baseline/missing는 항상 0
    if (metric.dataStatus === "baseline" || metric.dataStatus === "missing") {
      metric.reviewDeltaUsed = 0;
      metric.salesEstimateDaily = 0;
      continue;
    }

    const ppd = perProductDailyDelta.get(metric.metricDate);
    const hasSnapshot = bestSnapByDate.has(metric.metricDate);

    if (ppd && ppd.reliable) {
      // (A) 스냅샷 있고 per-product delta 신뢰할 수 있음
      metric.reviewDeltaUsed = ppd.scaledDelta;
      metric.salesEstimateDaily = Math.round(ppd.scaledDelta * factor);
      // ★ 핵심: normalizeReviewSeries가 sum-diff 음수로 "interpolated"를 준 경우에도
      //   per-product delta가 실제 스냅샷 데이터 기반이므로 "raw_valid"로 교정
      if (hasSnapshot) {
        metric.dataStatus = "raw_valid";
        metric.isFinalized = true;
        metric.isProvisional = false;
        metric.provisionalReason = null;
      }
    } else if (hasSnapshot && !ppd) {
      // 첫 번째 스냅샷 날짜 (baseline 직후): delta 계산 대상 아님
      // avgReliableDelta를 사용
      metric.reviewDeltaUsed = avgReliableDelta;
      metric.salesEstimateDaily = Math.round(avgReliableDelta * factor);
    } else if (ppd && !ppd.reliable) {
      // (B) 스냅샷 있지만 match rate 낮음 → fallback
      metric.reviewDeltaUsed = avgReliableDelta;
      metric.salesEstimateDaily = Math.round(avgReliableDelta * factor);
      metric.dataStatus = "anomaly";
      metric.provisionalReason = "low_match_rate";
    } else {
      // (C) 스냅샷 없는 보간 날짜 → avgReliableDelta 사용
      metric.reviewDeltaUsed = avgReliableDelta;
      metric.salesEstimateDaily = Math.round(avgReliableDelta * factor);
      metric.dataStatus = "interpolated";
      metric.isFinalized = true;
      metric.isProvisional = false;
      metric.provisionalReason = "per_product_avg_fill";
    }
  }

  // ================================================================
  //  6.5단계: ★ v8.3.1 MA7/MA30 재계산 (per-product delta 기반)
  //  모든 날짜의 salesEstimateDaily가 per-product delta 기반이므로
  //  raw_valid + anomaly만 포함 (interpolated 제외 = 더 정확한 MA)
  // ================================================================
  const baselineIdx = normalizedMetrics.findIndex(m => m.dataStatus === "baseline");
  for (let i = 0; i < normalizedMetrics.length; i++) {
    if (i <= Math.max(0, baselineIdx)) {
      normalizedMetrics[i].salesEstimateMa7 = null;
      normalizedMetrics[i].salesEstimateMa30 = null;
      continue;
    }
    // MA에 포함할 데이터: 스냅샷 기반 실제 데이터 (per-product delta 적용된)
    const isRealData = (r: NormalizedMetric) =>
      r.dataStatus === "raw_valid" || r.dataStatus === "anomaly";

    const startIdx7 = Math.max(baselineIdx + 1, i - 6);
    const w7 = normalizedMetrics.slice(startIdx7, i + 1)
      .filter(x => isRealData(x))
      .map(x => x.salesEstimateDaily);
    normalizedMetrics[i].salesEstimateMa7 =
      w7.length >= 1 ? Math.round(w7.reduce((a, b) => a + b, 0) / w7.length) : null;

    const startIdx30 = Math.max(baselineIdx + 1, i - 29);
    const w30 = normalizedMetrics.slice(startIdx30, i + 1)
      .filter(x => isRealData(x))
      .map(x => x.salesEstimateDaily);
    normalizedMetrics[i].salesEstimateMa30 =
      w30.length >= 1 ? Math.round(w30.reduce((a, b) => a + b, 0) / w30.length) : null;
  }

  let todayReviewGrowth = todayMetric?.reviewDeltaUsed ?? 0;
  let todaySalesEstimate = todayMetric?.salesEstimateDaily ?? 0;

  const todayMa7 = todayMetric?.salesEstimateMa7 ?? 0;
  const todayMa30 = todayMetric?.salesEstimateMa30 ?? 0;
  const todaySpikeLevel = detectSpike(todaySalesEstimate, todayMa7);
  const todaySpikeRatio =
    todayMa7 && todayMa7 > 0
      ? Math.round((todaySalesEstimate / todayMa7) * 100) / 100
      : 0;

  // ================================================================
  //  7단계: 점수 계산 (★ MA7 기반)
  // ================================================================
  const items = todaySnap.items;
  const adRatio = items.length
    ? Math.round((todaySnap.adCount / items.length) * 100)
    : 0;
  const avgReviewPerProduct =
    items.length > 0 ? todaySnap.totalReviewSum / items.length : 0;

  // ★ MA7을 주 지표로 전달
  const demandScore = computeDemandScore(
    todayMa7 || todaySalesEstimate, // MA7 없으면 daily로 fallback
    todayReviewGrowth,
    items,
    todaySnap.totalReviewSum,
    todaySnap.rocketCount,
  );

  // ★ MA7 기반 reviewGrowth를 점수에 반영
  const ma7ReviewGrowth =
    todayMa7 > 0 ? Math.round(todayMa7 / factor) : todayReviewGrowth;
  const keywordScore = computeKeywordScore(
    ma7ReviewGrowth,
    avgReviewPerProduct,
    todaySnap.competitionScore,
    adRatio,
    demandScore,
  );

  // ================================================================
  //  8단계: anchor_prev_date 찾기
  // ================================================================
  let anchorPrevDate: string | null = null;
  for (let i = normalizedMetrics.length - 2; i >= 0; i--) {
    const ds = normalizedMetrics[i].dataStatus;
    if (
      (ds === "raw_valid" || ds === "baseline") &&
      normalizedMetrics[i].isFinalized
    ) {
      anchorPrevDate = normalizedMetrics[i].metricDate;
      break;
    }
  }

  // ================================================================
  //  9단계: ext_keyword_daily_stats UPSERT (오늘)
  // ================================================================
  const existingToday = existingByDate.get(todayStr);

  const statData = {
    snapshotCount: 1,
    productCount: todaySnap.totalItems,
    avgPrice: todaySnap.avgPrice,
    avgRating: todaySnap.avgRating,
    avgReview: todaySnap.avgReview,
    totalReviewSum: todaySnap.totalReviewSum,
    adCount: todaySnap.adCount,
    adRatio,
    rocketCount: todaySnap.rocketCount,
    highReviewCount: todaySnap.highReviewCount,
    competitionScore: todaySnap.competitionScore,
    competitionLevel: todaySnap.competitionLevel as
      | "easy"
      | "medium"
      | "hard",
    // 정규화 필드
    baseProductCount: effectiveBase,
    normalizedReviewSum: todayMetric?.normalizedReviewSum ?? 0,
    coverageRatio: todayMetric
      ? todayMetric.coverageRatio.toFixed(4)
      : "0.0000",
    reviewDeltaObserved: todayMetric?.reviewDeltaObserved ?? 0,
    reviewDeltaUsed: todayReviewGrowth,
    reviewGrowth: todayReviewGrowth,
    salesEstimate: todaySalesEstimate,
    salesEstimateMa7: todayMa7,
    salesEstimateMa30: todayMa30,
    isProvisional: todayMetric?.isProvisional ?? false,
    isFinalized: todayMetric?.isFinalized ?? false,
    provisionalReason: todayMetric?.provisionalReason ?? null,
    dataStatus: todayMetric?.dataStatus ?? "raw_valid",
    spikeRatio: String(todaySpikeRatio),
    spikeLevel: todaySpikeLevel,
    anchorPrevDate,
    // 점수
    priceChange: 0,
    productCountChange: 0,
    demandScore,
    keywordScore,
  };

  // ★ 양수 reviewGrowth 보호: 기존에 양수값이 있으면 0으로 덮어쓰지 않음
  // ★ v7.7.4: finalized/missing/baseline 모두 보호 우회 (정확한 재계산)
  const todayIsFinalized = todayMetric?.isFinalized ?? false;
  const todayIsBaseline = todayMetric?.dataStatus === "baseline";
  const todayIsMissing = todayMetric?.dataStatus === "missing";
  if (existingToday) {
    if (
      todayReviewGrowth <= 0 &&
      existingToday.reviewGrowth > 0 &&
      !todayIsFinalized &&
      !todayIsBaseline &&
      !todayIsMissing
    ) {
      const {
        reviewGrowth: _rg,
        salesEstimate: _se,
        reviewDeltaUsed: _rdu,
        ...nonGrowthFields
      } = statData;
      await db
        .update(extKeywordDailyStats)
        .set(nonGrowthFields)
        .where(eq(extKeywordDailyStats.id, existingToday.id));
    } else {
      await db
        .update(extKeywordDailyStats)
        .set(statData)
        .where(eq(extKeywordDailyStats.id, existingToday.id));
    }
  } else {
    try {
      await db
        .insert(extKeywordDailyStats)
        .values({ userId, query, statDate: todayStr, ...statData });
    } catch (dupErr: any) {
      if (
        dupErr?.cause?.code === "ER_DUP_ENTRY" ||
        dupErr?.code === "ER_DUP_ENTRY"
      ) {
        await db
          .update(extKeywordDailyStats)
          .set(statData)
          .where(
            and(
              eq(extKeywordDailyStats.userId, userId),
              eq(extKeywordDailyStats.query, query),
              eq(extKeywordDailyStats.statDate, todayStr),
            ),
          );
      } else {
        throw dupErr;
      }
    }
  }

  // ================================================================
  //  10단계: 과거 데이터 재보정
  // ================================================================
  // ★ v8.3.1: per-product delta 기반 정확한 값으로 모든 과거 데이터 업데이트
  for (const metric of normalizedMetrics) {
    if (metric.metricDate === todayStr) continue;
    const existing = existingByDate.get(metric.metricDate);
    if (!existing) continue;

    const updateData: any = {
      normalizedReviewSum: metric.normalizedReviewSum,
      reviewDeltaObserved: metric.reviewDeltaObserved,
      reviewDeltaUsed: metric.reviewDeltaUsed,
      reviewGrowth: metric.reviewDeltaUsed,
      salesEstimate: metric.salesEstimateDaily,
      salesEstimateMa7: metric.salesEstimateMa7 ?? 0,
      salesEstimateMa30: metric.salesEstimateMa30 ?? 0,
      baseProductCount: effectiveBase,
      coverageRatio: metric.coverageRatio.toFixed(4),
      dataStatus: metric.dataStatus,
      isProvisional: metric.isProvisional,
      isFinalized: metric.isFinalized,
      provisionalReason: metric.provisionalReason,
    };

    // ★ v8.3.1: 스냅샷 정보 복구 (totalReviewSum, productCount, avgPrice)
    const bestSnap = bestSnapByDate.get(metric.metricDate);
    if (bestSnap && bestSnap.reviewSum > 0) {
      updateData.totalReviewSum = bestSnap.reviewSum;
      if (bestSnap.productCount > 0) updateData.productCount = bestSnap.productCount;
      if (bestSnap.avgPrice > 0) updateData.avgPrice = bestSnap.avgPrice;
    }

    // ★ v8.3.1: per-product delta가 있는 날은 경쟁도도 스냅샷에서 복구
    const ppd = perProductDailyDelta.get(metric.metricDate);
    if (ppd) {
      updateData.demandScore = computeDemandScore(
        metric.salesEstimateMa7 ?? metric.salesEstimateDaily,
        metric.reviewDeltaUsed,
        bestSnap?.items ?? [],
        bestSnap?.reviewSum ?? 0,
        bestSnap?.items?.filter((i: any) => i.isRocket)?.length ?? 0,
      );
    }

    await db
      .update(extKeywordDailyStats)
      .set(updateData)
      .where(eq(extKeywordDailyStats.id, existing.id));
  }

  console.log(
    `[rebuildStats] "${query}" rGrowth:${todayReviewGrowth} sales:${todaySalesEstimate} ma7:${todayMa7} ma30:${todayMa30} spike:${todaySpikeLevel} demand:${demandScore} kwScore:${keywordScore} finalized:${todayMetric?.isFinalized ?? false} ppdAvg:${avgReliableDelta} ppdCount:${reliableDeltas.length}`,
  );

  return {
    success: true,
    daysProcessed: normalizedMetrics.length,
    reviewGrowth: todayReviewGrowth,
    salesEstimate: todaySalesEstimate,
    salesEstimateMa7: todayMa7,
    salesEstimateMa30: todayMa30,
    spikeLevel: todaySpikeLevel,
  };
}
