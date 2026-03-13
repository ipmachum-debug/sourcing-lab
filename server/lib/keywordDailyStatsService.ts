/**
 * ============================================================
 * Keyword Daily Stats Service (v7.8.0)
 * ============================================================
 *
 * ext_keyword_daily_stats의 단일 계산 경로 (Single Source of Truth).
 *
 * 모든 배치/라우터/헬퍼는 이 서비스만 호출한다.
 * 내부 흐름:
 *   1. 최근 90일 raw 조회
 *   2. P70 baseProductCount 계산
 *   3. 상품수 정규화 (per-product delta)
 *   4. normalizeReviewSeries() v7.8.0 실행
 *      — 기준점 기반 순수 delta: 음수/0 분산, 3일 룰 기준점 이동
 *   5. provisional/finalized 상태 결정
 *   6. salesEstimateDaily 계산
 *   7. MA7/MA30 계산 (기준점 이후, baseline/missing 제외)
 *   8. spike 탐지 (today / ma7 비율)
 *   9. ext_keyword_daily_stats upsert
 *
 * ★ v7.8.0:
 *   - 기준점 기반 순수 delta 엔진 (음수/0 분산 + 3일 룰)
 *   - MA7/MA30 기반 demandScore/keywordScore
 *   - per-product delta 우선 사용 (itemsJson 비교)
 *   - 상품수 비례 정규화 강화
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
 * ★ v7.7.0: MA7 기반 salesEstimate 사용 (daily raw보다 안정적)
 */
function computeDemandScore(
  salesEstimateMa7: number,
  reviewGrowth: number,
  items: any[],
  totalReviewSum: number,
  rocketCount: number,
): number {
  // MA7을 주 지표로 사용
  const salesRef = salesEstimateMa7;

  let demandScore = 0;
  if (salesRef > 500) demandScore = 90;
  else if (salesRef > 200) demandScore = 75;
  else if (salesRef > 100) demandScore = 60;
  else if (salesRef > 50) demandScore = 45;
  else if (salesRef > 20) demandScore = 30;
  else if (salesRef > 5) demandScore = 15;
  else if (reviewGrowth > 0) demandScore = 10;

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

  return demandScore;
}

/**
 * ★ v7.7.0: MA7 기반 reviewGrowth 사용
 */
function computeKeywordScore(
  reviewGrowthMa7: number,
  avgReviewPerProduct: number,
  competitionScore: number,
  adRatio: number,
  demandScore: number,
): number {
  const competitionFactor = Math.max(0, 100 - competitionScore) / 100;

  let reviewGrowthScore = 0;
  if (reviewGrowthMa7 >= 100) reviewGrowthScore = 25;
  else if (reviewGrowthMa7 >= 50) reviewGrowthScore = 20;
  else if (reviewGrowthMa7 >= 20) reviewGrowthScore = 15;
  else if (reviewGrowthMa7 >= 10) reviewGrowthScore = 10;
  else if (reviewGrowthMa7 >= 5) reviewGrowthScore = 7;
  else if (reviewGrowthMa7 > 0) reviewGrowthScore = 3;

  let marketSizeScore = 0;
  if (avgReviewPerProduct >= 500) marketSizeScore = 25;
  else if (avgReviewPerProduct >= 200) marketSizeScore = 20;
  else if (avgReviewPerProduct >= 100) marketSizeScore = 15;
  else if (avgReviewPerProduct >= 50) marketSizeScore = 10;
  else if (avgReviewPerProduct >= 20) marketSizeScore = 5;

  const competitionEaseScore = Math.round(
    competitionFactor * 15 + (1 - adRatio / 100) * 10,
  );
  const demandPart = Math.round(demandScore * 0.25);

  return Math.min(
    100,
    reviewGrowthScore + marketSizeScore + competitionEaseScore + demandPart,
  );
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
  const snapshotDateRows = await db
    .select({ createdAt: extSearchSnapshots.createdAt })
    .from(extSearchSnapshots)
    .where(
      and(
        eq(extSearchSnapshots.userId, userId),
        eq(extSearchSnapshots.query, query),
        sql`${extSearchSnapshots.createdAt} >= DATE_SUB(${todayStr}, INTERVAL ${windowDays} DAY)`,
      ),
    );

  const realCrawlDates = new Set<string>();
  for (const row of snapshotDateRows) {
    const d = new Date(row.createdAt);
    d.setHours(d.getHours() + 9); // KST
    realCrawlDates.add(d.toISOString().slice(0, 10));
  }

  // ★ per-product delta용: 최근 스냅샷 2개 조회 (itemsJson 비교)
  const recentSnapsForDelta = await db
    .select({
      id: extSearchSnapshots.id,
      createdAt: extSearchSnapshots.createdAt,
      itemsJson: extSearchSnapshots.itemsJson,
    })
    .from(extSearchSnapshots)
    .where(
      and(
        eq(extSearchSnapshots.userId, userId),
        eq(extSearchSnapshots.query, query),
      ),
    )
    .orderBy(desc(extSearchSnapshots.createdAt))
    .limit(10);

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
    rawSeries.push({
      statDate: date,
      productCount: N(row.productCount),
      reviewSum: N(row.totalReviewSum),
      avgPrice: N(row.avgPrice),
      // ★ v7.7.2: 실제 크롤링(스냅샷)이 있는 날만 valid anchor로 인정
      isValidSnapshot:
        N(row.productCount) > 0 &&
        N(row.totalReviewSum) > 0 &&
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

  if (
    perProductDeltaResult &&
    perProductDeltaResult.delta >= 0 &&
    perProductDeltaResult.matchedCount >= 5
  ) {
    // per-product delta가 신뢰할 만하면 우선 사용
    const ppDelta = perProductDeltaResult.delta;
    // 단, 비현실적 값은 cap 적용
    const perProductCap = Math.max(50 * effectiveBase, 200);
    const cappedDelta = Math.min(ppDelta, perProductCap, 5000);

    // normalizeReviewSeries 결과와 비교: 더 보수적인 값 사용
    if (todayReviewGrowth === 0 || cappedDelta < todayReviewGrowth) {
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
    if (
      normalizedMetrics[i].dataStatus === "raw_valid" &&
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

  // ★ v7.8.0: 정규화 엔진의 결과를 신뢰 — 항상 전체 덮어쓰기
  // 이전: 양수 보호 로직으로 잘못된 값이 잔존하는 문제 발생
  // 개선: normalizeReviewSeries가 기준점/음수분산/3일룰을 정확히 처리하므로
  //       엔진 결과를 그대로 DB에 반영
  if (existingToday) {
    await db
      .update(extKeywordDailyStats)
      .set(statData)
      .where(eq(extKeywordDailyStats.id, existingToday.id));
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

      // ★ v7.8.0: 엔진 결과를 전체 반영 (양수 보호 제거)
      // 기준점 기반 순수 delta 엔진이 정확한 값을 산출하므로
      // 항상 엔진 결과로 덮어쓴다.
      updateData.reviewGrowth = metric.reviewDeltaUsed;

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
