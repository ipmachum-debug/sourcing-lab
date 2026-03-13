/**
 * ============================================================
 * Review Normalization Engine (v7.8.0)
 * ============================================================
 *
 * 크롤링 시 수집 제품 수가 변동하면 totalReviewSum이 왜곡되는 문제 해결.
 *
 * 핵심 공식:
 *   normalizedReviewSum = (reviewSum / productCount) × baseProductCount
 *
 * ★ v7.8.0 — 기준점 기반 순수 delta 엔진:
 *
 *   원칙 1: 첫 양수 크롤링일 = 기준점 (차트 제외)
 *     - 리뷰합이 처음 양수로 잡힌 날 = 오랜 기간 누적 총합이므로 그래프에서 제외
 *     - 다음날부터 delta 연산 시작
 *
 *   원칙 2: 음수/0 delta = 크롤링 품질 이슈 → 제외 후 분산
 *     - 음수나 0 delta는 "실제 판매 감소"가 아니라 크롤링 오차
 *     - 다음 양수 delta가 나올 때까지의 총 일수로 균등 분배
 *     - 예: 0, 0, +150 → 3일간 하루 50으로 분산
 *
 *   원칙 3: 3일 이상 연속 음수/0 → 기준점 이동
 *     - 기준점 이후 3일 이상 양수 없으면 → 상품 구성이 바뀐 것으로 판단
 *     - 다음 양수 delta 발생일로 기준점 자체를 이동
 *     - MA7/MA30도 새 기준점부터 재계산
 *
 *   원칙 4: 상품수 비례 정규화
 *     - delta는 반드시 크롤링 대상 상품수로 정규화
 *     - 상품수 25개일 때 +200 vs 상품수 50개일 때 +200은 다른 의미
 *     - per-product delta로 환산하여 비교 가능하게
 *
 *   원칙 5: anomaly cap 유지 (안전장치)
 *     - per-product 50건/일, 절대 5,000건/일
 *
 * 처리 흐름:
 *   1. Raw 저장 → 2. 상품수 정규화 → 3. 첫 양수 크롤링 = 기준점
 *   → 4. 양수 delta 구간 탐색 → 음수/0 구간 분산
 *   → 5. 3일 연속 음수/0 → 기준점 이동
 *   → 6. anomaly cap → 7. MA7/MA30 (기준점 이후부터)
 */

/** Drizzle-ORM decimal/SUM 결과 → number 변환 */
function N(v: any): number {
  return Number(v) || 0;
}

/** 두 날짜 문자열(YYYY-MM-DD) 사이의 캘린더 일수 차이 */
function calendarDaysBetween(dateA: string, dateB: string): number {
  const a = new Date(dateA + "T00:00:00Z");
  const b = new Date(dateB + "T00:00:00Z");
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

// ============================================================
//  상수: 현실적 cap (쿠팡 시장 기준)
// ============================================================

/**
 * 상품당 일일 최대 리뷰 증가 (현실적 상한).
 * 쿠팡 상위 상품도 일 50건 이상 리뷰 달리기 어려움.
 */
const MAX_DAILY_REVIEW_PER_PRODUCT = 50;

/** 절대 상한: 키워드당 일일 reviewGrowth 최대값. */
const MAX_DAILY_DELTA_ABS = 5000;

/**
 * 평균가 변동 임계값. 이보다 크게 변하면 상품 MIX가 바뀐 것으로 판단.
 * 예: 10,000원 → 36,000원 (260% 변동) → 비정상
 */
const PRICE_CHANGE_THRESHOLD = 1.5; // 150%

// ============================================================
//  Types
// ============================================================

export type RawDailyData = {
  statDate: string;
  productCount: number;
  reviewSum: number;
  avgPrice?: number;
  isValidSnapshot: boolean;
};

export type NormalizedMetric = {
  metricDate: string;
  // Raw values
  reviewSumRaw: number;
  productCountRaw: number;
  // Normalized values
  avgReviewPerProduct: number;
  normalizedReviewSum: number;
  coverageRatio: number;
  // Delta
  reviewDeltaObserved: number;
  reviewDeltaUsed: number;
  // Estimates
  salesEstimateDaily: number;
  salesEstimateMa7: number | null;
  salesEstimateMa30: number | null;
  // Status
  dataStatus:
    | "raw_valid"
    | "interpolated"
    | "provisional"
    | "anomaly"
    | "missing"
    | "baseline";
  isProvisional: boolean;
  isFinalized: boolean;
  provisionalReason: string | null;
};

export type BaseProductCountResult = {
  baseProductCount: number;
  method: "p70" | "median" | "max7" | "fixed" | "current";
  sampleDays: number;
};

// ============================================================
//  1. Base Product Count (기준 상품수) 계산
// ============================================================

/**
 * 최근 30일 상품수의 P70(70번째 백분위수)을 기준 상품수로 사용.
 * 데이터 부족 시 최근 7일 최대값 → 현재값 순으로 fallback.
 */
export function computeBaseProductCount(
  recentProductCounts: number[],
): BaseProductCountResult {
  const valid = recentProductCounts.filter(c => c > 0);

  if (valid.length === 0) {
    return { baseProductCount: 0, method: "current", sampleDays: 0 };
  }

  const sorted = [...valid].sort((a, b) => a - b);

  if (sorted.length >= 7) {
    const idx = Math.floor(sorted.length * 0.7);
    return {
      baseProductCount: sorted[Math.min(idx, sorted.length - 1)],
      method: "p70",
      sampleDays: sorted.length,
    };
  }

  if (sorted.length >= 3) {
    const mid = Math.floor(sorted.length / 2);
    return {
      baseProductCount: sorted[mid],
      method: "median",
      sampleDays: sorted.length,
    };
  }

  return {
    baseProductCount: Math.max(...sorted),
    method: "max7",
    sampleDays: sorted.length,
  };
}

// ============================================================
//  2. 상품수 기준 정규화
// ============================================================

export function normalizeReviewSum(
  reviewSum: number,
  productCount: number,
  baseProductCount: number,
): {
  avgReviewPerProduct: number;
  normalizedReviewSum: number;
  coverageRatio: number;
} {
  if (productCount <= 0 || baseProductCount <= 0) {
    return { avgReviewPerProduct: 0, normalizedReviewSum: 0, coverageRatio: 0 };
  }

  const avgReviewPerProduct = reviewSum / productCount;
  const normalizedReviewSum = Math.round(
    avgReviewPerProduct * baseProductCount,
  );
  const coverageRatio = productCount / baseProductCount;

  return { avgReviewPerProduct, normalizedReviewSum, coverageRatio };
}

// ============================================================
//  3. Snapshot 유효성 판정
// ============================================================

export function isValidSnapshot(
  productCount: number,
  reviewSum: number,
  baseProductCount: number,
): { valid: boolean; reason: string | null } {
  if (productCount <= 0) {
    return { valid: false, reason: "no_products" };
  }

  if (reviewSum <= 0 && productCount > 0) {
    return { valid: false, reason: "parser_fail" };
  }

  // 커버리지 50% 미만이면 비정상
  if (baseProductCount > 0 && productCount / baseProductCount < 0.5) {
    return { valid: false, reason: "product_count_drop" };
  }

  return { valid: true, reason: null };
}

// ============================================================
//  4. 리뷰 증가량 해석 (음수 처리 + fallback)
// ============================================================

export type DeltaResolution = {
  reviewDeltaObserved: number;
  reviewDeltaUsed: number;
  isProvisional: boolean;
  provisionalReason: string | null;
};

/**
 * delta가 음수이면 fallback 평균 사용.
 * fallback 우선순위: last7Avg > last30Avg > lifetimeAvg > 0
 */
export function resolveReviewDelta(
  observedDelta: number,
  fallback: {
    last7Avg?: number | null;
    last30Avg?: number | null;
    lifetimeAvg?: number | null;
  },
): DeltaResolution {
  if (observedDelta >= 0) {
    return {
      reviewDeltaObserved: observedDelta,
      reviewDeltaUsed: observedDelta,
      isProvisional: false,
      provisionalReason: null,
    };
  }

  // 음수 → fallback
  let usedDelta = 0;
  if (fallback.last7Avg && fallback.last7Avg > 0) {
    usedDelta = fallback.last7Avg;
  } else if (fallback.last30Avg && fallback.last30Avg > 0) {
    usedDelta = fallback.last30Avg;
  } else if (fallback.lifetimeAvg && fallback.lifetimeAvg > 0) {
    usedDelta = fallback.lifetimeAvg;
  }

  return {
    reviewDeltaObserved: observedDelta,
    reviewDeltaUsed: Math.round(usedDelta),
    isProvisional: true,
    provisionalReason: "negative_delta",
  };
}

// ============================================================
//  5. 상품별 리뷰 증가량 비교 (per-product delta)
// ============================================================

/**
 * 두 스냅샷의 아이템 목록에서 겹치는 상품의 리뷰 증가량 합계를 계산.
 * totalReviewSum 비교보다 정확한 delta 산출 가능.
 *
 * @returns null if insufficient overlap (< 30% of items match)
 */
export function computePerProductDelta(
  prevItems: { productId: string | number; reviewCount: number }[],
  currItems: { productId: string | number; reviewCount: number }[],
): { delta: number; matchedCount: number; totalItems: number } | null {
  if (!prevItems.length || !currItems.length) return null;

  const prevMap = new Map<string, number>();
  for (const item of prevItems) {
    prevMap.set(String(item.productId), item.reviewCount || 0);
  }

  let totalDelta = 0;
  let matchedCount = 0;
  for (const item of currItems) {
    const prevReview = prevMap.get(String(item.productId));
    if (prevReview !== undefined) {
      const diff = (item.reviewCount || 0) - prevReview;
      // 개별 상품 리뷰가 감소하면 0 처리 (삭제된 리뷰 무시)
      totalDelta += Math.max(0, diff);
      matchedCount++;
    }
  }

  const overlapRatio = matchedCount / Math.max(currItems.length, 1);
  if (overlapRatio < 0.3) return null; // 겹침 부족 → 신뢰 불가

  // 매칭되지 않은 상품 수만큼 비례 보정
  if (matchedCount > 0 && matchedCount < currItems.length) {
    totalDelta = Math.round(totalDelta * (currItems.length / matchedCount));
  }

  return { delta: totalDelta, matchedCount, totalItems: currItems.length };
}

// ============================================================
//  6. 시계열 정규화 — v7.8.0 기준점 기반 순수 delta 엔진
// ============================================================

/** 연속 음수/0 허용 일수. 이보다 길면 기준점 이동 */
const BASELINE_RESET_DAYS = 3;

/**
 * ★ v7.8.0 — 기준점 기반 순수 delta 엔진
 *
 * 원칙 1: 첫 양수 크롤링일 = 기준점 (차트 제외, 누적 총합이므로)
 * 원칙 2: 음수/0 delta = 크롤링 품질 → 다음 양수까지 일수로 분산
 * 원칙 3: 3일+ 연속 음수/0 → 기준점 이동 (상품 구성 변경으로 판단)
 * 원칙 4: 상품수 비례 정규화 (per-product delta)
 * 원칙 5: anomaly cap 유지 (per-product 50, 절대 5,000)
 */
export function normalizeReviewSeries(
  rows: RawDailyData[],
  baseProductCount: number,
  reviewToSalesFactor: number = 20,
): NormalizedMetric[] {
  if (rows.length === 0) return [];

  // per-product 기반 dailyDelta 상한
  const perProductCap = Math.max(
    MAX_DAILY_REVIEW_PER_PRODUCT * Math.max(baseProductCount, 1),
    200,
  );
  const effectiveCap = Math.min(perProductCap, MAX_DAILY_DELTA_ABS);

  // ── Step 1: 상품수 정규화 + 유효성 판정 ──
  const normalized = rows.map(r => {
    const norm = normalizeReviewSum(
      r.reviewSum,
      r.productCount,
      baseProductCount,
    );
    const validity = isValidSnapshot(
      r.productCount,
      r.reviewSum,
      baseProductCount,
    );
    return {
      ...r,
      ...norm,
      isValid: r.isValidSnapshot && validity.valid,
      invalidReason: validity.reason,
    };
  });

  // ── 결과 배열 초기화 ──
  const result: NormalizedMetric[] = normalized.map(r => ({
    metricDate: r.statDate,
    reviewSumRaw: r.reviewSum,
    productCountRaw: r.productCount,
    avgReviewPerProduct: r.avgReviewPerProduct,
    normalizedReviewSum: r.normalizedReviewSum,
    coverageRatio: r.coverageRatio,
    reviewDeltaObserved: 0,
    reviewDeltaUsed: 0,
    salesEstimateDaily: 0,
    salesEstimateMa7: null,
    salesEstimateMa30: null,
    dataStatus: r.isValid ? "raw_valid" : "missing",
    isProvisional: true,
    isFinalized: false,
    provisionalReason: r.isValid ? null : r.invalidReason,
  }));

  // ── Step 2: 유효 앵커(양수 normalizedReviewSum) 인덱스 ──
  const validIdx: number[] = [];
  normalized.forEach((r, i) => {
    if (r.isValid) validIdx.push(i);
  });

  if (validIdx.length === 0) return result;

  // ── Step 3: 기준점 찾기 (첫 양수 크롤링) ──
  // 원칙 1: 첫 양수 크롤링 = 기준점. 누적 총합이므로 delta=0, 차트 제외.
  let baselineIdx = validIdx[0];

  // 기준점 설정 함수
  function markBaseline(idx: number) {
    result[idx].reviewDeltaObserved = 0;
    result[idx].reviewDeltaUsed = 0;
    result[idx].salesEstimateDaily = 0;
    result[idx].dataStatus = "baseline";
    result[idx].isProvisional = false;
    result[idx].isFinalized = true;
    result[idx].provisionalReason = "baseline_reference";
  }

  // 기준점 이전 = missing 처리
  function markBeforeBaseline(upToIdx: number) {
    for (let i = 0; i <= upToIdx; i++) {
      if (result[i].dataStatus === "baseline") continue;
      result[i].reviewDeltaObserved = 0;
      result[i].reviewDeltaUsed = 0;
      result[i].salesEstimateDaily = 0;
      result[i].dataStatus = "missing";
      result[i].isProvisional = true;
      result[i].isFinalized = false;
      result[i].provisionalReason = "before_baseline";
    }
  }

  markBaseline(baselineIdx);
  if (baselineIdx > 0) markBeforeBaseline(baselineIdx - 1);

  // ── Step 4: 기준점 이후 delta 계산 — 양수 구간 탐색 + 음수/0 분산 ──
  //
  // 알고리즘:
  //   기준점(prevAnchor)에서 시작, 다음 유효 앵커(nextAnchor)까지 delta 계산.
  //   delta > 0: 구간 일수로 균등 분배 → finalized
  //   delta ≤ 0: "음수/0 구간" → 다음 양수 delta가 나올 때까지 스킵,
  //              양수 나오면 전체 구간(음수+양수)을 합산 일수로 분산.
  //   3일+ 연속 음수/0: 기준점 이동 (원칙 3)

  // 기준점 이후의 유효 앵커만 추출
  const anchorsAfterBaseline = validIdx.filter(i => i > baselineIdx);

  let prevAnchorIdx = baselineIdx;
  let consecutiveNonPositiveDays = 0; // 연속 음수/0 일수 추적
  let pendingStartIdx: number | null = null; // 음수/0 구간 시작 앵커
  const validDailyDeltas: number[] = []; // running average용

  function getRunningFallbackAvg(): number {
    if (validDailyDeltas.length === 0) return 0;
    return validDailyDeltas.reduce((a, b) => a + b, 0) / validDailyDeltas.length;
  }

  for (let ai = 0; ai < anchorsAfterBaseline.length; ai++) {
    const nextIdx = anchorsAfterBaseline[ai];
    const gapDays = calendarDaysBetween(
      normalized[prevAnchorIdx].statDate,
      normalized[nextIdx].statDate,
    );
    if (gapDays <= 0) {
      prevAnchorIdx = nextIdx;
      continue;
    }

    const prevNorm = normalized[prevAnchorIdx].normalizedReviewSum;
    const nextNorm = normalized[nextIdx].normalizedReviewSum;
    const totalDelta = nextNorm - prevNorm;
    const rawDailyDelta = totalDelta / gapDays;

    // ── 원칙 2: delta ≤ 0 = 크롤링 품질 이슈 ──
    if (totalDelta <= 0) {
      consecutiveNonPositiveDays += gapDays;

      // pendingStart 기록 (음수 구간 시작점)
      if (pendingStartIdx === null) pendingStartIdx = prevAnchorIdx;

      // ── 원칙 3: 3일+ 연속 음수/0 → 기준점 이동 ──
      if (consecutiveNonPositiveDays >= BASELINE_RESET_DAYS) {
        // 이전 기준점~현재까지 전부 missing 처리
        for (let j = (pendingStartIdx ?? prevAnchorIdx) + 1; j <= nextIdx; j++) {
          result[j].reviewDeltaObserved = 0;
          result[j].reviewDeltaUsed = 0;
          result[j].salesEstimateDaily = 0;
          result[j].dataStatus = "missing";
          result[j].isProvisional = true;
          result[j].isFinalized = false;
          result[j].provisionalReason = "baseline_reset_gap";
        }

        // 다음 양수 delta를 가진 앵커를 찾아 새 기준점으로 설정
        let newBaselineFound = false;
        for (let fi = ai + 1; fi < anchorsAfterBaseline.length; fi++) {
          const futureIdx = anchorsAfterBaseline[fi];
          const futureDelta =
            normalized[futureIdx].normalizedReviewSum - nextNorm;
          if (futureDelta > 0) {
            // nextIdx를 새 기준점으로 설정
            markBaseline(nextIdx);
            // nextIdx까지의 모든 중간 데이터도 missing
            baselineIdx = nextIdx;
            prevAnchorIdx = nextIdx;
            pendingStartIdx = null;
            consecutiveNonPositiveDays = 0;
            // ai를 fi-1로 이동 (for 루프가 fi로 진행)
            ai = fi - 1;
            newBaselineFound = true;
            break;
          }
        }

        if (!newBaselineFound) {
          // 남은 앵커 전체가 음수/0 → 모두 missing 처리 후 종료
          for (let j = nextIdx + 1; j < result.length; j++) {
            if (result[j].dataStatus === "baseline") continue;
            result[j].dataStatus = "missing";
            result[j].isProvisional = true;
            result[j].isFinalized = false;
            result[j].provisionalReason = "no_positive_anchor";
          }
          // 마지막 유효 데이터를 새 기준점으로
          markBaseline(nextIdx);
          prevAnchorIdx = nextIdx;
          pendingStartIdx = null;
          break;
        }
        continue;
      }

      // 아직 3일 미만 → 일단 대기 (다음 앵커에서 양수 나오면 분산)
      prevAnchorIdx = nextIdx;
      continue;
    }

    // ── delta > 0: 양수 구간 ──
    // 만약 대기 중인 음수/0 구간이 있었다면, 전체를 합산하여 분산
    let distributeFromIdx: number;
    let distributeTotalDelta: number;
    let distributeDays: number;

    if (pendingStartIdx !== null) {
      // 음수/0 구간 + 현재 양수 구간을 통합
      distributeFromIdx = pendingStartIdx;
      distributeTotalDelta =
        normalized[nextIdx].normalizedReviewSum -
        normalized[pendingStartIdx].normalizedReviewSum;
      distributeDays = calendarDaysBetween(
        normalized[pendingStartIdx].statDate,
        normalized[nextIdx].statDate,
      );

      // 통합 delta도 음수면 → 현재 구간만 사용
      if (distributeTotalDelta <= 0) {
        distributeFromIdx = prevAnchorIdx;
        distributeTotalDelta = totalDelta;
        distributeDays = gapDays;
        // 이전 음수 구간은 0으로 채움
        for (let j = (pendingStartIdx ?? prevAnchorIdx) + 1; j < prevAnchorIdx; j++) {
          result[j].reviewDeltaUsed = 0;
          result[j].salesEstimateDaily = 0;
          result[j].dataStatus = "interpolated";
          result[j].isProvisional = false;
          result[j].isFinalized = true;
          result[j].provisionalReason = "zero_in_negative_gap";
        }
      }

      pendingStartIdx = null;
      consecutiveNonPositiveDays = 0;
    } else {
      distributeFromIdx = prevAnchorIdx;
      distributeTotalDelta = totalDelta;
      distributeDays = gapDays;
      consecutiveNonPositiveDays = 0;
    }

    if (distributeDays <= 0) {
      prevAnchorIdx = nextIdx;
      continue;
    }

    // 상품수 비례 정규화 (원칙 4): dailyDelta를 per-product로 계산
    let dailyDelta = distributeTotalDelta / distributeDays;

    // anomaly cap 적용 (원칙 5)
    let isAnomaly = false;
    if (dailyDelta > effectiveCap) {
      dailyDelta = effectiveCap;
      isAnomaly = true;
    }

    // running average에 추가
    if (dailyDelta > 0) {
      validDailyDeltas.push(dailyDelta);
    }

    // 구간 내 모든 일자에 균등 분배 → finalized
    for (let j = distributeFromIdx + 1; j <= nextIdx; j++) {
      if (result[j].dataStatus === "baseline") continue;

      const dayOffset = calendarDaysBetween(
        normalized[distributeFromIdx].statDate,
        normalized[j].statDate,
      );
      const isAnchor = j === nextIdx;

      // normalizedReviewSum 보간 (앵커는 원본 유지)
      if (!isAnchor) {
        result[j].normalizedReviewSum = Math.round(
          normalized[distributeFromIdx].normalizedReviewSum + dailyDelta * dayOffset,
        );
      }

      result[j].reviewDeltaObserved = isAnchor
        ? Math.round(distributeTotalDelta / distributeDays)
        : 0;
      result[j].reviewDeltaUsed = Math.round(dailyDelta);
      result[j].salesEstimateDaily = Math.round(dailyDelta * reviewToSalesFactor);
      result[j].isProvisional = false;
      result[j].isFinalized = true;

      if (isAnchor) {
        result[j].dataStatus = isAnomaly ? "anomaly" : "raw_valid";
        result[j].provisionalReason = isAnomaly ? "delta_capped" : null;
      } else {
        result[j].dataStatus = "interpolated";
        result[j].provisionalReason = "distributed";
      }
    }

    prevAnchorIdx = nextIdx;
  }

  // ── Step 5: 마지막 앵커 이후 = provisional ──
  const lastAnchorIdx = prevAnchorIdx;
  if (lastAnchorIdx < result.length - 1) {
    const fallbackDelta = getRunningFallbackAvg();
    for (let i = lastAnchorIdx + 1; i < result.length; i++) {
      if (result[i].dataStatus === "baseline") continue;
      result[i].reviewDeltaUsed = Math.round(fallbackDelta);
      result[i].salesEstimateDaily = Math.round(fallbackDelta * reviewToSalesFactor);
      result[i].dataStatus = "provisional";
      result[i].isProvisional = true;
      result[i].isFinalized = false;
      result[i].provisionalReason = "awaiting_next_anchor";
    }
  }

  // ── Step 6: MA7/MA30 (기준점 이후부터만, baseline/missing 제외) ──
  for (let i = 0; i < result.length; i++) {
    if (result[i].dataStatus === "missing" || result[i].dataStatus === "baseline") {
      result[i].salesEstimateMa7 = null;
      result[i].salesEstimateMa30 = null;
      continue;
    }

    // MA7: 최근 7일 중 유효 데이터만 (baseline/missing 제외)
    const w7 = result
      .slice(Math.max(0, i - 6), i + 1)
      .filter(x => x.dataStatus !== "missing" && x.dataStatus !== "baseline")
      .map(x => x.salesEstimateDaily)
      .filter(x => x > 0);
    result[i].salesEstimateMa7 =
      w7.length >= 2
        ? Math.round(w7.reduce((a, b) => a + b, 0) / w7.length)
        : null;

    // MA30: 최근 30일 중 유효 데이터만
    const w30 = result
      .slice(Math.max(0, i - 29), i + 1)
      .filter(x => x.dataStatus !== "missing" && x.dataStatus !== "baseline")
      .map(x => x.salesEstimateDaily)
      .filter(x => x > 0);
    result[i].salesEstimateMa30 =
      w30.length >= 2
        ? Math.round(w30.reduce((a, b) => a + b, 0) / w30.length)
        : null;
  }

  return result;
}

// ============================================================
//  7. Fallback 평균 delta 계산 (DB에서 조회한 과거 데이터 기준)
// ============================================================

export function computeFallbackDeltas(
  recentDeltas: { delta: number; daysAgo: number }[],
): { last7Avg: number; last30Avg: number; lifetimeAvg: number } {
  const positiveDeltas = recentDeltas.filter(d => d.delta > 0);

  const last7 = positiveDeltas.filter(d => d.daysAgo <= 7);
  const last30 = positiveDeltas.filter(d => d.daysAgo <= 30);

  const avg = (arr: { delta: number }[]) =>
    arr.length ? arr.reduce((s, d) => s + d.delta, 0) / arr.length : 0;

  return {
    last7Avg: Math.round(avg(last7)),
    last30Avg: Math.round(avg(last30)),
    lifetimeAvg: Math.round(avg(positiveDeltas)),
  };
}

// ============================================================
//  8. 급등 탐지
// ============================================================

export type SpikeLevel = "normal" | "rising" | "surging" | "explosive";

export function detectSpike(
  todaySales: number | null,
  ma7: number | null,
): SpikeLevel {
  if (!todaySales || !ma7 || ma7 <= 0) return "normal";
  const ratio = todaySales / ma7;
  if (ratio >= 4.0) return "explosive";
  if (ratio >= 2.5) return "surging";
  if (ratio >= 1.8) return "rising";
  return "normal";
}
