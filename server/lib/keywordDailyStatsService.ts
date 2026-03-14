/**
 * ============================================================
 * Keyword Daily Stats Service (v7.7.5)
 * ============================================================
 *
 * ext_keyword_daily_stats의 단일 계산 경로 (Single Source of Truth).
 *
 * 모든 배치/라우터/헬퍼는 이 서비스만 호출한다.
 * 내부 흐름:
 *   1. 최근 45일 raw 조회
 *   2. P70 baseProductCount 계산
 *   3. 상품수 정규화
 *   4. normalizeReviewSeries() 실행 (앵커 간 선형 보간)
 *   5. provisional/finalized 상태 결정
 *   6. salesEstimateDaily 계산
 *   7. MA7/MA30 계산 (주 지표)
 *   8. spike 탐지 (today / ma7 비율)
 *   9. ext_keyword_daily_stats upsert
 *
 * ★ v7.7.0:
 *   - MA7/MA30 기반 demandScore/keywordScore
 *   - per-product delta 우선 사용 (itemsJson 비교)
 *   - provisional/finalized 명확 구분
 *   - 음수 delta = 데이터 품질 문제 → fallback 평균 사용
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
  //  6단계: 오늘 메트릭 추출
  // ================================================================
  const todayMetric = normalizedMetrics.find(m => m.metricDate === todayStr);

  // ★ per-product delta가 있으면 오늘 값에 반영
  let todayReviewGrowth = todayMetric?.reviewDeltaUsed ?? 0;
  let todaySalesEstimate = todayMetric?.salesEstimateDaily ?? 0;

  // ★ per-product delta: finalized + raw_valid인 경우에만 보수적 비교 적용
  if (
    perProductDeltaResult &&
    perProductDeltaResult.delta >= 0 &&
    perProductDeltaResult.matchedCount >= 5 &&
    todayMetric?.isFinalized &&
    todayMetric?.dataStatus === "raw_valid"
  ) {
    // per-product delta가 신뢰할 만하면 우선 사용
    const ppDelta = perProductDeltaResult.delta;
    // 단, 비현실적 값은 cap 적용
    const perProductCap = Math.max(50 * effectiveBase, 200);
    const cappedDelta = Math.min(ppDelta, perProductCap, 5000);

    // normalizeReviewSeries 결과보다 per-product이 더 작으면 교체 (보수적)
    if (todayReviewGrowth > 0 && cappedDelta < todayReviewGrowth) {
      todayReviewGrowth = cappedDelta;
      todaySalesEstimate = Math.round(cappedDelta * factor);
    }
  }

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
  // ★ 오늘이 finalized이면 이전 구간도 재보정
  if (todayMetric && todayMetric.isFinalized) {
    for (const metric of normalizedMetrics) {
      if (metric.metricDate === todayStr) continue;
      const existing = existingByDate.get(metric.metricDate);
      if (!existing) continue;

      const updateData: any = {
        normalizedReviewSum: metric.normalizedReviewSum,
        reviewDeltaObserved: metric.reviewDeltaObserved,
        reviewDeltaUsed: metric.reviewDeltaUsed,
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

      // ★ 양수 reviewGrowth 보호 (과거 데이터도)
      // ★ v7.7.2: finalized 메트릭은 재계산 값이 정확하므로 보호 우회
      // ★ v7.7.3: "missing" (before_first_real_crawl) 메트릭도 보호 우회
      //   — 옛날 코드가 쓴 잘못된 양수값을 0으로 정정해야 함
      const shouldOverride =
        metric.isFinalized ||
        metric.dataStatus === "missing" ||
        metric.dataStatus === "baseline";
      if (
        metric.reviewDeltaUsed <= 0 &&
        existing.reviewGrowth > 0 &&
        !shouldOverride
      ) {
        delete updateData.reviewDeltaUsed;
        delete updateData.salesEstimate;
      } else {
        updateData.reviewGrowth = metric.reviewDeltaUsed;
      }

      await db
        .update(extKeywordDailyStats)
        .set(updateData)
        .where(eq(extKeywordDailyStats.id, existing.id));
    }
  }

  console.log(
    `[rebuildStats] "${query}" rGrowth:${todayReviewGrowth} sales:${todaySalesEstimate} ma7:${todayMa7} ma30:${todayMa30} spike:${todaySpikeLevel} demand:${demandScore} kwScore:${keywordScore} finalized:${todayMetric?.isFinalized ?? false}`,
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
