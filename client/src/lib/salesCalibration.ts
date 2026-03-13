/**
 * 클라이언트 판매추정 보정 유틸리티
 *
 * 쿠팡 내부 데이터 기반 판매추정을 보정하는 경량 버전
 * (서버의 keywordScorer.ts와 동일한 로직)
 *
 * 보정 공식:
 *   base = reviewDelta × reviewConversion
 *   corrected = base × (1 + alpha × naverDemandIndex)
 */

export interface CalibrationInput {
  reviewDelta: number;          // 리뷰 증가량
  reviewDeltaPrev?: number;     // 이전 기간 리뷰 증가량
  productCount?: number;
  avgPrice?: number;
  categoryHint?: string;
  // MA 기반 판매추정 (서버에서 계산된 값)
  salesEstimateMa7?: number;
  salesEstimateMa30?: number;
  // 데이터 상태
  dataStatus?: string;          // raw_valid/interpolated/provisional/anomaly/missing
  isFinalized?: boolean;
  spikeLevel?: string;          // normal/rising/surging/explosive
  spikeRatio?: number;
  // 네이버 데이터 (있으면 보정 적용)
  naverTotalSearch?: number;
  naverSearchPrev?: number;
  naverAvgCpc?: number;
  naverCompetition?: string;
}

export interface CalibrationOutput {
  baseSalesEst: number;
  correctedSalesEst: number;
  naverDemandIndex: number;
  confidence: "high" | "medium" | "low";
  surgeType: "real_demand" | "promo_suspected" | "early_trend" | "stable" | "unknown";
  surgeLabel: string;
  confidenceReason: string;
  hasNaverData: boolean;
  /** 쿠팡 내부 지표 기반 점수 비중 (70%) - UI 표시용 */
  coupangWeight: number;
  /** 네이버 검증 점수 비중 (30%) - UI 표시용 */
  naverWeight: number;
  /** MA7 기반 판매추정 (서버 계산값) */
  ma7SalesEst: number;
  /** 추정 방식 라벨: MA7추정 / 임시추정 / 기본추정 */
  estimateLabel: string;
  /** 추정 방식 타입 */
  estimateType: "ma7" | "provisional" | "basic";
  /** spike 라벨 */
  spikeLabel: string | null;
}

const REVIEW_CONVERSION: Record<string, number> = {
  가전: 25, 생활용품: 20, 주방: 22, 뷰티: 30, 패션: 35,
  식품: 15, 반려동물: 20, 유아동: 25, 스포츠: 25, 자동차: 20,
  캠핑: 22, 수납: 20, 욕실: 20, 문구: 18,
};

const CATEGORY_ALPHA: Record<string, number> = {
  가전: 0.30, 생활용품: 0.30, 주방: 0.25, 뷰티: 0.15, 패션: 0.10,
  식품: 0.15, 반려동물: 0.20, 유아동: 0.25, 스포츠: 0.25, 자동차: 0.30,
  캠핑: 0.35, 수납: 0.25, 욕실: 0.25, 문구: 0.15,
};

function getConversion(cat?: string): number {
  if (!cat) return 20;
  for (const [k, v] of Object.entries(REVIEW_CONVERSION)) {
    if (cat.includes(k)) return v;
  }
  return 20;
}

function getAlpha(cat?: string): number {
  if (!cat) return 0.20;
  for (const [k, v] of Object.entries(CATEGORY_ALPHA)) {
    if (cat.includes(k)) return v;
  }
  return 0.20;
}

export function calibrateSales(input: CalibrationInput): CalibrationOutput {
  const conv = getConversion(input.categoryHint);
  const alpha = getAlpha(input.categoryHint);
  const baseSalesEst = input.reviewDelta * conv;

  const hasNaverData = !!(input.naverTotalSearch && input.naverTotalSearch > 0);

  // 네이버 수요지수
  let naverDemandIndex = 0;
  if (hasNaverData) {
    const searchNorm = Math.min(1, (input.naverTotalSearch || 0) / 50000);
    const cpcNorm = Math.min(1, (input.naverAvgCpc || 0) / 2000);
    let compNorm = 0.3;
    if (input.naverCompetition === "높음") compNorm = 1.0;
    else if (input.naverCompetition === "중간") compNorm = 0.5;
    else if (input.naverCompetition === "낮음") compNorm = 0.1;
    naverDemandIndex = searchNorm * 0.5 + cpcNorm * 0.3 + compNorm * 0.2;
  }

  const correctedSalesEst = Math.round(baseSalesEst * (1 + alpha * naverDemandIndex));

  // 가짜 상승 판별
  const naverGrowth = (input.naverSearchPrev || 0) > 0
    ? ((input.naverTotalSearch || 0) - input.naverSearchPrev!) / input.naverSearchPrev!
    : 0;
  const coupangGrowth = (input.reviewDeltaPrev || 0) > 0
    ? (input.reviewDelta - input.reviewDeltaPrev!) / input.reviewDeltaPrev!
    : (input.reviewDelta > 0 ? 1 : 0);

  const coupangSurge = coupangGrowth > 0.5;
  const naverRising = naverGrowth > 0.2;
  const naverFlat = naverGrowth > -0.1 && naverGrowth < 0.1;

  let surgeType: CalibrationOutput["surgeType"] = "unknown";
  let surgeLabel = "판단보류";
  let confidence: CalibrationOutput["confidence"] = "low";
  let confidenceReason = "데이터 부족";

  if (!hasNaverData) {
    // 네이버 데이터 없으면 쿠팡 데이터만으로 기본 판단
    confidence = "medium";
    surgeType = "stable";
    surgeLabel = "기본추정";
    confidenceReason = "쿠팡 데이터 기반 (네이버 보정 미적용)";
  } else if (coupangSurge && naverRising) {
    surgeType = "real_demand";
    surgeLabel = "실수요";
    confidence = "high";
    confidenceReason = "네이버+쿠팡 동시 상승";
  } else if (coupangSurge && naverFlat) {
    surgeType = "promo_suspected";
    surgeLabel = "프로모의심";
    confidence = "low";
    confidenceReason = "네이버 정체, 쿠팡만 급등";
  } else if (naverRising && !coupangSurge) {
    surgeType = "early_trend";
    surgeLabel = "선행트렌드";
    confidence = "medium";
    confidenceReason = "네이버 선행 상승";
  } else {
    surgeType = "stable";
    surgeLabel = "안정";
    confidence = "medium";
    confidenceReason = "변동 없음";
  }

  // ★ v7.7.0: MA7 기반 판매추정 + 편차 기반 신뢰도 판단
  const ma7SalesEst = input.salesEstimateMa7 ?? 0;
  const hasMa7 = ma7SalesEst > 0;
  const dailyEst = correctedSalesEst; // 오늘 리뷰증가 기반 일간추정

  // MA7 vs 일간추정 편차 체크 — 3배 이상 벌어지면 MA7 불안정
  const MAX_DIVERGENCE = 3.0;
  let estimateLabel: string;
  let estimateType: CalibrationOutput["estimateType"];
  let finalSalesEst: number;

  if (!hasMa7) {
    // MA 데이터 없음
    finalSalesEst = dailyEst;
    estimateLabel = "기본추정";
    estimateType = "basic";
  } else if (input.dataStatus === "provisional" || !input.isFinalized) {
    // 아직 확정 안 된 데이터
    finalSalesEst = dailyEst > 0 ? dailyEst : ma7SalesEst;
    estimateLabel = "임시추정";
    estimateType = "provisional";
  } else if (dailyEst > 0 && ma7SalesEst / dailyEst > MAX_DIVERGENCE) {
    // MA7이 일간추정의 3배 초과 → MA7 불안정, 일간추정 사용
    finalSalesEst = dailyEst;
    estimateLabel = "일간추정";
    estimateType = "basic";
  } else if (dailyEst > 0 && dailyEst / ma7SalesEst > MAX_DIVERGENCE) {
    // 일간추정이 MA7의 3배 초과 → 오늘 튀는 날, MA7 유지하되 spike 표시
    finalSalesEst = ma7SalesEst;
    estimateLabel = "MA7";
    estimateType = "ma7";
  } else {
    // 정상 범위 — MA7 신뢰
    finalSalesEst = ma7SalesEst;
    estimateLabel = "MA7";
    estimateType = "ma7";
  }

  // spike 라벨
  let spikeLabel: string | null = null;
  if (input.spikeLevel === "explosive") spikeLabel = "폭발적";
  else if (input.spikeLevel === "surging") spikeLabel = "급등";
  else if (input.spikeLevel === "rising") spikeLabel = "상승";

  return {
    baseSalesEst,
    correctedSalesEst: finalSalesEst,
    naverDemandIndex: Math.round(naverDemandIndex * 100) / 100,
    confidence,
    surgeType,
    surgeLabel,
    confidenceReason,
    hasNaverData,
    coupangWeight: 0.70,
    naverWeight: 0.30,
    ma7SalesEst,
    estimateLabel,
    estimateType,
    spikeLabel,
  };
}
