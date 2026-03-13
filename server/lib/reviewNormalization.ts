/**
 * ============================================================
 * Review Normalization Engine (v7.7.5)
 * ============================================================
 *
 * 크롤링 시 수집 제품 수가 변동하면 totalReviewSum이 왜곡되는 문제 해결.
 *
 * 핵심 공식:
 *   normalizedReviewSum = (reviewSum / productCount) × baseProductCount
 *
 * 처리 흐름:
 *   1. Raw 저장 → 2. 상품수 정규화 → 3. 첫 양수 크롤링 = 기준점
 *   → 4. 양수 delta 구간 탐색 → 음수/0 구간 분산
 *   → 5. 3일 연속 음수/0 → 기준점 이동
 *   → 6. anomaly cap → 7. MA7/MA30 (기준점 이후부터)
 *
 * ★ v7.7.4 핵심 변경:
 *   - 2-pass delta 처리: 먼저 모든 앵커 쌍의 raw delta 수집,
 *     양수 구간 평균으로 음수/0 구간을 분산 (forward-looking)
 *   - 3일 연속 음수/0 → 기준점 재설정:
 *     첫 크롤링 품질 오차 감지, baseline에서 연속 3개 앵커 쌍이
 *     모두 음수/0이면 기준점을 마지막 음수 앵커로 이동
 *   - carry-forward 제거: 양수 구간 분산이 대체하므로 불필요,
 *     기존에 보간된 정상값을 덮어쓰는 문제 해결
 *   - MA7/MA30: 기준점 이후부터만 계산 (baseline 이전 0 제외)
 *
 * ★ v7.7.5 변경:
 *   - MA7/MA30: finalized 0값도 포함 (양수만 필터 제거, 정확한 평균)
 *   - 기준점 이동을 초기 7일 이내로 제한 (운영 중 데이터 보호)
 *   - calendarDaysBetween: TZ-safe 로컬 Date 생성으로 변경
 *   - per-product delta: finalized+raw_valid일 때만 보수적 비교 적용
 */

/** Drizzle-ORM decimal/SUM 결과 → number 변환 */
function N(v: any): number {
  return Number(v) || 0;
}

/** 두 날짜 문자열(YYYY-MM-DD) 사이의 캘린더 일수 차이 (TZ-safe) */
function calendarDaysBetween(dateA: string, dateB: string): number {
  const [ay, am, ad] = dateA.split("-").map(Number);
  const [by, bm, bd] = dateB.split("-").map(Number);
  const a = new Date(ay, am - 1, ad);
  const b = new Date(by, bm - 1, bd);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
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
//  6. 시계열 정규화 — v7.7.4 전면 개편
// ============================================================

/**
 * 정상 앵커(anchor) 사이를 선형 보간 + 양수 구간 분산.
 *
 * ★ v7.7.4 처리 흐름:
 *
 * 1. 상품수 정규화 + 유효 앵커 판정
 * 2. 첫 양수 크롤링 = 기준점 (baseline)
 * 3. 3일 연속 음수/0 → 기준점 재설정
 *    (첫 크롤링 품질 오차 감지)
 * 4. 2-pass delta 처리:
 *    Pass 1: 모든 앵커 쌍의 raw delta 수집
 *    Pass 2: 양수 구간 평균으로 음수/0 구간 분산 (forward-looking)
 * 5. anomaly cap 적용
 * 6. 마지막 앵커 이후 = provisional
 * 7. MA7/MA30 (기준점 이후부터만 계산)
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

  // ── Step 2: 유효 앵커 인덱스 ──
  const validIdx: number[] = [];
  normalized.forEach((r, i) => {
    if (r.isValid) validIdx.push(i);
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

  if (validIdx.length === 0) return result;

  // ── Step 3: 첫 양수 크롤링 = 기준점 ──
  let baselineIdx = validIdx[0];
  let baselineAiPos = 0; // validIdx 내 위치

  // ── Step 3.5: 3일 연속 음수/0 → 기준점 재설정 ──
  // ★ 초기 구간에서만 적용 (등록 후 7일 이내)
  // 운영 중 음수/0은 실제 시장 변화이므로 기준점 이동하지 않음
  if (validIdx.length >= 4) {
    const firstAnchorDate = normalized[validIdx[0]].statDate;
    const lastCheckIdx = Math.min(validIdx.length - 1, 4);
    const lastCheckDate = normalized[validIdx[lastCheckIdx]].statDate;
    const spanDays = calendarDaysBetween(firstAnchorDate, lastCheckDate);

    // 첫 앵커~체크 구간이 7일 이내일 때만 기준점 이동 허용
    if (spanDays <= 7) {
      let consecutiveNonPositive = 0;
      for (let ai = 1; ai < validIdx.length && ai <= 4; ai++) {
        const prevI = validIdx[ai - 1];
        const nextI = validIdx[ai];
        const delta =
          normalized[nextI].normalizedReviewSum -
          normalized[prevI].normalizedReviewSum;

        if (delta <= 0) {
          consecutiveNonPositive++;
          if (consecutiveNonPositive >= 3) {
            // 기준점을 이 앵커로 이동
            baselineIdx = nextI;
            baselineAiPos = ai;
            break;
          }
        } else {
          break; // 첫 양수 발견 → 기준점 유효
        }
      }
    }
  }

  // ── 기준점 설정 ──
  result[baselineIdx].reviewDeltaObserved = 0;
  result[baselineIdx].reviewDeltaUsed = 0;
  result[baselineIdx].salesEstimateDaily = 0;
  result[baselineIdx].dataStatus = "baseline";
  result[baselineIdx].isProvisional = false;
  result[baselineIdx].isFinalized = true;
  result[baselineIdx].provisionalReason = "baseline_reference";

  // 기준점 이전 = 모두 missing
  for (let i = 0; i < baselineIdx; i++) {
    result[i].reviewDeltaObserved = 0;
    result[i].reviewDeltaUsed = 0;
    result[i].salesEstimateDaily = 0;
    result[i].dataStatus = "missing";
    result[i].isProvisional = true;
    result[i].isFinalized = false;
    result[i].provisionalReason = "before_baseline";
  }

  // ── Step 4: 2-pass 앵커 쌍 처리 ──

  // ★ Pass 1: 모든 앵커 쌍의 raw delta 수집
  type PairInfo = {
    ai: number;
    prevIdx: number;
    nextIdx: number;
    gapDays: number;
    totalDelta: number;
    rawDailyDelta: number;
    priceMixChanged: boolean;
  };

  const pairs: PairInfo[] = [];
  for (let ai = baselineAiPos + 1; ai < validIdx.length; ai++) {
    const prevIdx = validIdx[ai - 1];
    const nextIdx = validIdx[ai];
    const gapDays = calendarDaysBetween(
      normalized[prevIdx].statDate,
      normalized[nextIdx].statDate,
    );
    if (gapDays <= 0) continue;

    const prevNorm = normalized[prevIdx].normalizedReviewSum;
    const nextNorm = normalized[nextIdx].normalizedReviewSum;
    const totalDelta = nextNorm - prevNorm;

    // 평균가 MIX 변동 감지
    const prevPrice = normalized[prevIdx].avgPrice ?? 0;
    const currPrice = normalized[nextIdx].avgPrice ?? 0;
    let priceMixChanged = false;
    if (prevPrice > 0 && currPrice > 0) {
      const priceRatio =
        Math.max(currPrice, prevPrice) / Math.min(currPrice, prevPrice);
      if (priceRatio > PRICE_CHANGE_THRESHOLD) {
        priceMixChanged = true;
      }
    }

    pairs.push({
      ai,
      prevIdx,
      nextIdx,
      gapDays,
      totalDelta,
      rawDailyDelta: totalDelta / gapDays,
      priceMixChanged,
    });
  }

  // ★ Pass 1.5: 양수 구간 평균 산출 (forward-looking)
  // 모든 정상 양수 delta의 평균 = 음수/0 구간의 분산값
  const positiveDailyDeltas = pairs
    .filter(p => p.rawDailyDelta > 0 && !p.priceMixChanged)
    .map(p => Math.min(p.rawDailyDelta, effectiveCap));
  const globalPositiveAvg =
    positiveDailyDeltas.length > 0
      ? positiveDailyDeltas.reduce((a, b) => a + b, 0) /
        positiveDailyDeltas.length
      : 0;

  // ★ Pass 2: 각 앵커 쌍에 최종 dailyDelta 결정 + 보간 채우기
  for (const pair of pairs) {
    let dailyDelta: number;
    let usedFallback = false;
    let fallbackReason: string | null = null;
    let isAnomaly = false;

    if (pair.totalDelta < 0) {
      // 음수 → 양수 구간 평균으로 분산
      dailyDelta = globalPositiveAvg;
      usedFallback = true;
      fallbackReason = "negative_delta_distributed";
    } else if (pair.priceMixChanged) {
      // MIX 변동 → 양수 구간 평균 우선, 없으면 실제 delta 사용
      if (globalPositiveAvg > 0) {
        dailyDelta = globalPositiveAvg;
        usedFallback = true;
        fallbackReason = "price_mix_distributed";
      } else if (pair.totalDelta > 0) {
        dailyDelta = pair.rawDailyDelta;
        usedFallback = true;
        fallbackReason = "price_mix_use_actual";
      } else {
        dailyDelta = 0;
        usedFallback = true;
        fallbackReason = "price_mix_no_data";
      }
    } else {
      // 정상 양수 delta → 일수로 균등 분배
      dailyDelta = pair.rawDailyDelta;
    }

    // ── Step 5: anomaly cap 적용 ──
    if (dailyDelta > effectiveCap) {
      dailyDelta = effectiveCap;
      isAnomaly = true;
    }

    // ── 앵커 쌍 사이 일자 채우기 (finalized) ──
    for (let j = pair.prevIdx + 1; j <= pair.nextIdx; j++) {
      const isAnchor = j === pair.nextIdx;
      const dayOffset = calendarDaysBetween(
        normalized[pair.prevIdx].statDate,
        normalized[j].statDate,
      );

      // 비앵커 일자는 normalizedReviewSum 보간
      if (!isAnchor) {
        result[j].normalizedReviewSum = Math.round(
          normalized[pair.prevIdx].normalizedReviewSum + dailyDelta * dayOffset,
        );
      }

      result[j].reviewDeltaObserved = isAnchor
        ? Math.round(pair.totalDelta / pair.gapDays)
        : 0;
      result[j].reviewDeltaUsed = Math.round(dailyDelta);
      result[j].salesEstimateDaily = Math.round(
        dailyDelta * reviewToSalesFactor,
      );

      result[j].isProvisional = false;
      result[j].isFinalized = true;

      if (isAnchor) {
        if (usedFallback) {
          result[j].dataStatus = "interpolated";
          result[j].provisionalReason = fallbackReason;
        } else if (isAnomaly) {
          result[j].dataStatus = "anomaly";
          result[j].provisionalReason = "delta_capped";
        } else {
          result[j].dataStatus = "raw_valid";
          result[j].provisionalReason = null;
        }
      } else {
        result[j].dataStatus = "interpolated";
        result[j].provisionalReason = "interpolated";
      }
    }
  }

  // ── Step 6: 마지막 앵커 이후 = provisional (임시) ──
  const lastAnchorIdx = validIdx[validIdx.length - 1];
  if (lastAnchorIdx < result.length - 1) {
    const fallbackDelta = globalPositiveAvg;
    for (let i = lastAnchorIdx + 1; i < result.length; i++) {
      result[i].reviewDeltaUsed = Math.round(fallbackDelta);
      result[i].salesEstimateDaily = Math.round(
        fallbackDelta * reviewToSalesFactor,
      );
      result[i].dataStatus = "provisional";
      result[i].isProvisional = true;
      result[i].isFinalized = false;
      result[i].provisionalReason = "awaiting_next_anchor";
    }
  }

  // ★ v7.7.4: carry-forward 제거
  // 양수 구간 분산(globalPositiveAvg)이 음수/0 구간을 이미 처리하므로 불필요.
  // 기존 carry-forward는 보간된 정상값을 덮어쓰는 문제가 있었음.

  // ── Step 7: MA7/MA30 (기준점 이후부터만 계산) ──
  for (let i = 0; i < result.length; i++) {
    // baseline 이전/baseline 자체 = MA 계산하지 않음
    if (i <= baselineIdx) {
      result[i].salesEstimateMa7 = null;
      result[i].salesEstimateMa30 = null;
      continue;
    }

    // ★ v7.7.4+: MA7/MA30 — finalized/interpolated 날은 0이어도 포함
    // missing/baseline은 제외, provisional은 제외 (아직 불확실)
    const isValidForMA = (r: NormalizedMetric) =>
      r.dataStatus !== "missing" &&
      r.dataStatus !== "baseline" &&
      !r.isProvisional;

    // MA7: 기준점 이후 최근 7일
    const startIdx7 = Math.max(baselineIdx + 1, i - 6);
    const w7 = result
      .slice(startIdx7, i + 1)
      .filter(x => isValidForMA(x))
      .map(x => x.salesEstimateDaily);
    result[i].salesEstimateMa7 =
      w7.length >= 2
        ? Math.round(w7.reduce((a, b) => a + b, 0) / w7.length)
        : null;

    // MA30: 기준점 이후 최근 30일
    const startIdx30 = Math.max(baselineIdx + 1, i - 29);
    const w30 = result
      .slice(startIdx30, i + 1)
      .filter(x => isValidForMA(x))
      .map(x => x.salesEstimateDaily);
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
