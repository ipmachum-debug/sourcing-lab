/**
 * ============================================================
 * Search Volume Estimator v1
 * ============================================================
 *
 * 쿠팡 검색량 추정 알고리즘.
 * 쿠팡은 검색량을 공개하지 않으므로 간접 신호를 결합하여 추정.
 *
 * ★ 자동 전환 로직:
 *   - 데이터 미성숙 → Simple Model (네이버 × 0.33)
 *   - 데이터 성숙    → Hybrid Model (네이버 50% + 리뷰역산 35% + 자동완성 15%)
 *
 * 성숙 조건:
 *   - 데이터 축적 >= 60일
 *   - 신뢰 delta 수 >= 20개
 *   - 평균 matchRate >= 0.35
 *
 * Phase 2 (데이터 축적 후 자동 활성화):
 *   리뷰 기반 보정은 multiplicative error propagation 우려가 있으므로
 *   가중치를 보수적으로 설정하고, 네이버 추정치의 ±50% 클램프를 적용.
 */

/** 네이버 → 쿠팡 트래픽 비율 (기본값) */
const DEFAULT_COUPANG_RATIO = 0.33;

/** 리뷰 작성률 (구매 대비 리뷰 작성 비율) */
const REVIEW_WRITE_RATE = 0.02;

/** 검색 → 구매 전환율 (평균) */
const SEARCH_TO_PURCHASE_RATE = 0.035;

/** Hybrid 활성화 최소 조건 */
const MATURITY_MIN_DAYS = 60;
const MATURITY_MIN_RELIABLE_DELTAS = 20;
const MATURITY_MIN_MATCH_RATE = 0.35;

/** Hybrid 가중치 */
const W_NAVER = 0.50;
const W_REVIEW = 0.35;
const W_AUTO = 0.15;

/** 리뷰 기반 추정치의 네이버 대비 클램프 범위 */
const REVIEW_CLAMP_MIN = 0.5; // 네이버의 50% 이하로 못 내려감
const REVIEW_CLAMP_MAX = 2.0; // 네이버의 200% 이상으로 못 올라감

/** 자동완성 점수 변환 계수 */
const AUTO_SCORE_MULTIPLIER = 1200;

export type EstimateModel = "simple" | "hybrid";
export type DataMaturity = "immature" | "growing" | "mature";

export interface SearchVolumeEstimateInput {
  /** 네이버 월간 총 검색량 (PC + 모바일) */
  naverTotalSearch: number;
  /** 최근 30일 평균 리뷰 증가량/일 (scaledDelta 기반) */
  avgDailyReviewGrowth: number;
  /** 평균 matchRate (per-product delta 품질) */
  avgMatchRate: number;
  /** 데이터 축적 일수 */
  dataDays: number;
  /** 신뢰 delta 개수 (reliable=true인 날 수) */
  reliableDeltaCount: number;
  /** 쿠팡 자동완성 키워드 수 (없으면 0) */
  autoCompleteCount: number;
}

export interface SearchVolumeEstimateResult {
  /** 최종 추정 쿠팡 월간 검색량 */
  estimatedMonthlySearch: number;
  /** 사용된 모델 */
  model: EstimateModel;
  /** 데이터 성숙도 */
  maturity: DataMaturity;
  /** 신뢰도 (0~1) */
  confidence: number;
  /** 각 구성요소 (디버그/투명성용) */
  components: {
    naverEstimate: number;
    reviewEstimate: number | null;
    autoEstimate: number | null;
  };
  /** 모델 전환까지 남은 조건 */
  maturityProgress: {
    days: { current: number; required: number };
    deltas: { current: number; required: number };
    matchRate: { current: number; required: number };
  };
}

/**
 * 데이터 성숙도 판정
 */
function assessMaturity(input: SearchVolumeEstimateInput): DataMaturity {
  const daysMet = input.dataDays >= MATURITY_MIN_DAYS;
  const deltasMet = input.reliableDeltaCount >= MATURITY_MIN_RELIABLE_DELTAS;
  const matchMet = input.avgMatchRate >= MATURITY_MIN_MATCH_RATE;

  if (daysMet && deltasMet && matchMet) return "mature";
  // 50% 이상 충족이면 growing
  const met = [daysMet, deltasMet, matchMet].filter(Boolean).length;
  if (met >= 2 || input.dataDays >= 30) return "growing";
  return "immature";
}

/**
 * Simple Model: 네이버 검색량 × 쿠팡 비율
 */
function simpleEstimate(naverTotal: number): number {
  return Math.round(naverTotal * DEFAULT_COUPANG_RATIO);
}

/**
 * 리뷰 기반 검색량 역산
 *
 * reviewGrowth/day → sales/day → searches/day → monthly
 *
 * 주의: multiplicative error propagation이 있으므로
 * 네이버 추정치 기준 ±clamp를 적용
 */
function reviewBasedEstimate(
  avgDailyReviewGrowth: number,
  naverEstimate: number,
): number {
  if (avgDailyReviewGrowth <= 0) return naverEstimate;

  // 리뷰 → 판매 → 검색
  const dailySales = avgDailyReviewGrowth / REVIEW_WRITE_RATE;
  const dailySearches = dailySales / SEARCH_TO_PURCHASE_RATE;
  const monthlySearches = Math.round(dailySearches * 30);

  // 네이버 추정치 기준 클램프 (과대/과소 추정 방지)
  if (naverEstimate > 0) {
    const lower = naverEstimate * REVIEW_CLAMP_MIN;
    const upper = naverEstimate * REVIEW_CLAMP_MAX;
    return Math.round(Math.max(lower, Math.min(upper, monthlySearches)));
  }

  return monthlySearches;
}

/**
 * 자동완성 기반 보정 점수
 */
function autoCompleteEstimate(count: number): number {
  return Math.round(count * AUTO_SCORE_MULTIPLIER);
}

/**
 * 검색량 추정 메인 함수
 *
 * 자동 전환 로직:
 * - immature/growing → Simple Model (네이버 × 0.33)
 * - mature → Hybrid Model (가중 평균)
 */
export function estimateSearchVolume(
  input: SearchVolumeEstimateInput,
): SearchVolumeEstimateResult {
  const maturity = assessMaturity(input);
  const naverEst = simpleEstimate(input.naverTotalSearch);

  const maturityProgress = {
    days: { current: input.dataDays, required: MATURITY_MIN_DAYS },
    deltas: { current: input.reliableDeltaCount, required: MATURITY_MIN_RELIABLE_DELTAS },
    matchRate: { current: Math.round(input.avgMatchRate * 100) / 100, required: MATURITY_MIN_MATCH_RATE },
  };

  // ★ Simple Model (데이터 미성숙)
  if (maturity !== "mature") {
    return {
      estimatedMonthlySearch: naverEst,
      model: "simple",
      maturity,
      confidence: maturity === "growing" ? 0.5 : 0.3,
      components: {
        naverEstimate: naverEst,
        reviewEstimate: null,
        autoEstimate: null,
      },
      maturityProgress,
    };
  }

  // ★ Hybrid Model (데이터 성숙)
  const reviewEst = reviewBasedEstimate(input.avgDailyReviewGrowth, naverEst);
  const autoEst = autoCompleteEstimate(input.autoCompleteCount);

  // 가중 평균
  let hybridEstimate: number;
  if (input.autoCompleteCount > 0) {
    hybridEstimate = Math.round(
      naverEst * W_NAVER + reviewEst * W_REVIEW + autoEst * W_AUTO,
    );
  } else {
    // 자동완성 없으면 네이버 + 리뷰만 (비율 재조정)
    hybridEstimate = Math.round(
      naverEst * (W_NAVER / (W_NAVER + W_REVIEW)) +
      reviewEst * (W_REVIEW / (W_NAVER + W_REVIEW)),
    );
  }

  // 신뢰도: matchRate와 delta 수에 비례
  const confidence = Math.min(
    0.9,
    0.6 + (input.avgMatchRate - 0.35) * 0.5 + Math.min(input.reliableDeltaCount / 60, 0.2),
  );

  return {
    estimatedMonthlySearch: Math.max(0, hybridEstimate),
    model: "hybrid",
    maturity,
    confidence: Math.round(confidence * 100) / 100,
    components: {
      naverEstimate: naverEst,
      reviewEstimate: reviewEst,
      autoEstimate: input.autoCompleteCount > 0 ? autoEst : null,
    },
    maturityProgress,
  };
}
