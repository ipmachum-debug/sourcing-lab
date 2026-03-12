/**
 * 키워드 점수화 + 판매추정 보정 엔진
 *
 * 7가지 채굴 알고리즘 + 네이버 외부수요 보정
 *
 * 핵심 보정 구조:
 *   base_sales_est = 쿠팡 리뷰증가량 × 카테고리별 리뷰전환계수
 *   naver_demand_index = (검색량 표준화 × 0.5) + (CPC 표준화 × 0.3) + (경쟁도 표준화 × 0.2)
 *   corrected_sales_est = base_sales_est × (1 + alpha × naver_demand_index)
 *
 * 가짜 상승 필터링:
 *   네이버 정체 + 쿠팡만 급등 → 광고/프로모션 가능성 (신뢰도 ↓)
 *   네이버 상승 + 쿠팡 상승 → 실수요 확대 (신뢰도 ↑)
 *   네이버 선행 상승 + 쿠팡 아직 → 초기 트렌드 (선행지표)
 */

interface ScoringInput {
  // 네이버 데이터
  naverTotalSearch?: number;
  naverCompetition?: string; // "높음" | "중간" | "낮음"
  naverAvgCpc?: number;
  naverSearchPrev?: number; // 이전 기간 검색량 (트렌드용)
  naverPcSearch?: number;
  naverMobileSearch?: number;

  // 쿠팡 데이터
  coupangProductCount?: number;
  coupangSellerCount?: number;
  coupangAvgPrice?: number;
  coupangTop10ReviewSum?: number;
  coupangTop10ReviewDelta?: number; // 리뷰 증가량
  coupangNewProduct30d?: number;
  coupangNewProductReview30d?: number;
  coupangOutOfStockCount?: number;
  coupangProductCountPrev?: number; // 이전 상품수 (공급증가율용)
  coupangReviewDeltaPrev?: number; // 이전 리뷰 증가량 (가짜 상승 필터용)

  // 소싱 데이터
  sourcePrice?: number; // 중국가

  // 카테고리 (보정 계수 결정용)
  categoryHint?: string;
}

export interface ScoringResult {
  marketGapScore: number;      // 1. 검색량 대비 경쟁도
  salesVelocityScore: number;  // 2. 리뷰 증가 속도
  chinaArbitrageScore: number; // 3. 가격 격차
  trendSpikeScore: number;     // 4. 검색량 급등
  demandDensityScore: number;  // 5. 리뷰 대비 상품수
  hiddenItemScore: number;     // 6. 숨은 아이템
  marketPressureScore: number; // 7. 시장 압력
  coupangBaseScore: number;    // 쿠팡 기본 점수 (70% 비중)
  naverValidationScore: number; // 네이버 검증 점수 (30% 비중)
  finalScore: number;          // 최종 종합 점수
  grade: "S" | "A" | "B" | "C" | "D";
  tags: string[];
  // 판매추정 보정 결과
  calibration: CalibrationResult;
}

/** 판매추정 보정 결과 */
export interface CalibrationResult {
  baseSalesEst: number;          // 기본 판매추정 (리뷰 × 전환계수)
  naverDemandIndex: number;      // 네이버 수요지수 (0~1)
  correctedSalesEst: number;     // 보정된 판매추정
  confidence: "high" | "medium" | "low"; // 신뢰도
  confidenceReason: string;      // 신뢰도 근거
  surgeType: "real_demand" | "promo_suspected" | "early_trend" | "stable" | "unknown";
  surgeLabel: string;            // 한글 라벨
  categoryAlpha: number;         // 적용된 카테고리 보정계수
  reviewConversion: number;      // 적용된 리뷰전환계수
}

/** 0~100 클램프 */
function clamp(v: number): number {
  return Math.round(Math.max(0, Math.min(100, v)));
}

/**
 * 1. Market Gap — 검색량 / 상품수
 */
function calcMarketGap(search: number, products: number): number {
  if (!products || !search) return 0;
  const ratio = search / products;
  // ratio 50+ → 100, 10→ 50, 5→ 25
  return clamp(Math.min(100, ratio * 2));
}

/**
 * 2. Sales Velocity — 리뷰 증가 속도
 */
function calcSalesVelocity(reviewDelta: number): number {
  if (reviewDelta <= 0) return 0;
  // delta 200+ → 100, 50→ 50, 10→ 15
  return clamp(Math.log10(reviewDelta + 1) * 43);
}

/**
 * 3. China Arbitrage — 쿠팡가격 / 중국가격
 */
function calcChinaArbitrage(coupangPrice: number, sourcePrice: number): number {
  if (!sourcePrice || !coupangPrice) return 0;
  const ratio = coupangPrice / sourcePrice;
  if (ratio >= 6) return 100;
  if (ratio >= 3) return 60 + (ratio - 3) * 13.3;
  if (ratio >= 2) return 30 + (ratio - 2) * 30;
  return clamp(ratio * 15);
}

/**
 * 4. Trend Spike — 검색량 급등
 */
function calcTrendSpike(current: number, prev: number): number {
  if (!prev || prev <= 0) return current > 0 ? 50 : 0;
  const growth = (current - prev) / prev;
  if (growth <= 0) return 0;
  // 200%+ → 100, 100% → 70, 50% → 45
  return clamp(growth * 50);
}

/**
 * 5. Demand Density — 리뷰합 / 상품수
 */
function calcDemandDensity(reviewSum: number, products: number): number {
  if (!products) return 0;
  const density = reviewSum / products;
  // density 100+ → 100, 50→ 65, 10→ 30
  return clamp(Math.log10(density + 1) * 50);
}

/**
 * 6. Hidden Item — 검색량 낮지만 판매 빠름
 */
function calcHiddenItem(
  search: number,
  reviewDelta: number,
  adCount?: number,
  newProductReview?: number,
): number {
  // 검색량 높으면 숨은 아이템이 아님
  if (search > 5000) return 0;

  let score = 0;
  // 리뷰 속도 / 검색량 역전
  if (search > 0 && reviewDelta > 0) {
    const ratio = reviewDelta / (search / 100);
    score += Math.min(40, ratio * 10);
  }
  // 광고 적음
  if (adCount !== undefined && adCount <= 3) score += 20;
  // 신규상품 반응 좋음
  if (newProductReview && newProductReview > 50) score += 20;
  // 검색량 자체가 낮으면 보너스 (니치)
  if (search < 2000) score += 20;

  return clamp(score);
}

/**
 * 7. Market Pressure — 수요증가율 / 공급증가율
 */
function calcMarketPressure(
  reviewDelta: number,
  productCountPrev: number,
  productCountNow: number,
): number {
  const supplyGrowth = productCountPrev > 0
    ? (productCountNow - productCountPrev) / productCountPrev
    : 0;
  const demandProxy = reviewDelta;

  if (supplyGrowth <= 0 && demandProxy > 0) return 90; // 공급 감소 + 수요 있음
  if (supplyGrowth <= 0) return 50;

  const pressure = (demandProxy / 10) / (supplyGrowth * 100);
  // pressure > 2 → 공급부족, 1~2 → 균형, <1 → 과포화
  if (pressure >= 2) return clamp(70 + pressure * 5);
  if (pressure >= 1) return clamp(40 + pressure * 15);
  return clamp(pressure * 30);
}

// ========== 판매추정 보정 엔진 ==========

/**
 * 카테고리별 리뷰→판매 전환계수
 * 리뷰 1건 ≈ 실제 판매 N건 (카테고리마다 다름)
 */
const REVIEW_CONVERSION_MAP: Record<string, number> = {
  "가전": 25,
  "생활용품": 20,
  "주방": 22,
  "뷰티": 30,
  "패션": 35,
  "식품": 15,
  "반려동물": 20,
  "유아동": 25,
  "스포츠": 25,
  "자동차": 20,
  "캠핑": 22,
  "수납": 20,
  "욕실": 20,
  "문구": 18,
};

/**
 * 카테고리별 네이버 보정 강도 (alpha)
 * - 생활용품/가전: 네이버 보정 강하게 (0.3)
 * - 충동구매형 저가 잡화: 쿠팡 내부지표 비중 크게 (0.1)
 * - 시즌상품: 네이버 선행신호 비중 높게 (0.4)
 */
const CATEGORY_ALPHA_MAP: Record<string, number> = {
  "가전": 0.30,
  "생활용품": 0.30,
  "주방": 0.25,
  "뷰티": 0.15,
  "패션": 0.10,   // 충동구매형
  "식품": 0.15,
  "반려동물": 0.20,
  "유아동": 0.25,
  "스포츠": 0.25,
  "자동차": 0.30,
  "캠핑": 0.35,   // 시즌성 강함
  "수납": 0.25,
  "욕실": 0.25,
  "문구": 0.15,
};

function getReviewConversion(category?: string): number {
  if (!category) return 20; // 기본값
  for (const [key, val] of Object.entries(REVIEW_CONVERSION_MAP)) {
    if (category.includes(key)) return val;
  }
  return 20;
}

function getCategoryAlpha(category?: string): number {
  if (!category) return 0.20; // 기본값
  for (const [key, val] of Object.entries(CATEGORY_ALPHA_MAP)) {
    if (category.includes(key)) return val;
  }
  return 0.20;
}

/**
 * 네이버 수요지수 계산 (0~1 범위)
 * = (검색량 표준화 × 0.5) + (CPC 표준화 × 0.3) + (경쟁도 표준화 × 0.2)
 */
function calcNaverDemandIndex(
  totalSearch: number,
  avgCpc: number,
  competition: string | undefined,
): number {
  // 검색량 표준화: 0~50000 → 0~1
  const searchNorm = Math.min(1, totalSearch / 50000);

  // CPC 표준화: 0~2000 → 0~1 (CPC 높을수록 광고주가 돈 쓰는 키워드)
  const cpcNorm = Math.min(1, avgCpc / 2000);

  // 경쟁도 표준화: 높음=1, 중간=0.5, 낮음=0.1
  let compNorm = 0.3;
  if (competition === "높음") compNorm = 1.0;
  else if (competition === "중간") compNorm = 0.5;
  else if (competition === "낮음") compNorm = 0.1;

  return searchNorm * 0.5 + cpcNorm * 0.3 + compNorm * 0.2;
}

/**
 * 가짜 상승 / 실수요 판별
 *
 * 네이버 검색량 + 쿠팡 리뷰 delta 비교:
 * - 둘 다 상승 → real_demand (실수요 확대)
 * - 네이버 정체 + 쿠팡만 급등 → promo_suspected (광고/프로모션 의심)
 * - 네이버 선행 상승 + 쿠팡 아직 → early_trend (초기 트렌드)
 * - 변동 없음 → stable
 */
function detectSurgeType(
  naverSearch: number,
  naverSearchPrev: number,
  reviewDelta: number,
  reviewDeltaPrev: number,
): { type: CalibrationResult["surgeType"]; label: string; confidence: CalibrationResult["confidence"]; reason: string } {
  const naverGrowth = naverSearchPrev > 0 ? (naverSearch - naverSearchPrev) / naverSearchPrev : 0;
  const coupangGrowth = reviewDeltaPrev > 0 ? (reviewDelta - reviewDeltaPrev) / reviewDeltaPrev : (reviewDelta > 0 ? 1 : 0);

  // 쿠팡 급등 (리뷰 delta 50%+ 증가)
  const coupangSurge = coupangGrowth > 0.5;
  // 네이버 상승 (검색량 20%+ 증가)
  const naverRising = naverGrowth > 0.2;
  // 네이버 정체 (-10% ~ +10%)
  const naverFlat = naverGrowth > -0.1 && naverGrowth < 0.1;

  if (coupangSurge && naverRising) {
    return {
      type: "real_demand",
      label: "실수요 확대",
      confidence: "high",
      reason: "네이버 검색량과 쿠팡 판매 동시 상승 → 실제 수요 증가",
    };
  }

  if (coupangSurge && naverFlat) {
    return {
      type: "promo_suspected",
      label: "프로모션 의심",
      confidence: "low",
      reason: "네이버 검색량 정체인데 쿠팡만 급등 → 광고/딜/랭킹 조작 가능성",
    };
  }

  if (naverRising && !coupangSurge) {
    return {
      type: "early_trend",
      label: "초기 트렌드",
      confidence: "medium",
      reason: "네이버 검색량 선행 상승 → 쿠팡 판매 반응 대기 (진입 기회)",
    };
  }

  if (!coupangSurge && !naverRising) {
    return {
      type: "stable",
      label: "안정",
      confidence: "medium",
      reason: "큰 변동 없는 안정적 시장",
    };
  }

  return {
    type: "unknown",
    label: "판단보류",
    confidence: "low",
    reason: "데이터 부족으로 판단 보류",
  };
}

/**
 * 판매추정 보정 계산
 */
function calibrateSalesEstimate(input: ScoringInput): CalibrationResult {
  const reviewDelta = input.coupangTop10ReviewDelta || 0;
  const reviewConversion = getReviewConversion(input.categoryHint);
  const alpha = getCategoryAlpha(input.categoryHint);

  // 1. 기본 판매추정 = 리뷰 증가량 × 카테고리별 전환계수
  const baseSalesEst = reviewDelta * reviewConversion;

  // 2. 네이버 수요지수 (0~1)
  const naverDemandIndex = calcNaverDemandIndex(
    input.naverTotalSearch || 0,
    input.naverAvgCpc || 0,
    input.naverCompetition,
  );

  // 3. 보정된 판매추정 = base × (1 + alpha × naverDemandIndex)
  const correctedSalesEst = Math.round(baseSalesEst * (1 + alpha * naverDemandIndex));

  // 4. 가짜 상승 판별
  const surge = detectSurgeType(
    input.naverTotalSearch || 0,
    input.naverSearchPrev || 0,
    reviewDelta,
    input.coupangReviewDeltaPrev || 0,
  );

  return {
    baseSalesEst,
    naverDemandIndex: Math.round(naverDemandIndex * 100) / 100,
    correctedSalesEst,
    confidence: surge.confidence,
    confidenceReason: surge.reason,
    surgeType: surge.type,
    surgeLabel: surge.label,
    categoryAlpha: alpha,
    reviewConversion,
  };
}

/**
 * 최종 점수 계산 + 판매추정 보정
 */
export function scoreKeyword(input: ScoringInput): ScoringResult {
  const search = input.naverTotalSearch || 0;
  const products = input.coupangProductCount || 0;
  const reviewDelta = input.coupangTop10ReviewDelta || 0;

  const marketGapScore = calcMarketGap(search, products);
  const salesVelocityScore = calcSalesVelocity(reviewDelta);
  const chinaArbitrageScore = calcChinaArbitrage(
    input.coupangAvgPrice || 0,
    input.sourcePrice || 0,
  );
  const trendSpikeScore = calcTrendSpike(search, input.naverSearchPrev || 0);
  const demandDensityScore = calcDemandDensity(
    input.coupangTop10ReviewSum || 0,
    products,
  );
  const hiddenItemScore = calcHiddenItem(
    search,
    reviewDelta,
    undefined,
    input.coupangNewProductReview30d,
  );
  const marketPressureScore = calcMarketPressure(
    reviewDelta,
    input.coupangProductCountPrev || products,
    products,
  );

  // 쿠팡 기본 점수 (70%): 쿠팡 내부 지표만으로 산출
  const coupangBaseScore = clamp(
    salesVelocityScore * 0.25 +
    demandDensityScore * 0.25 +
    hiddenItemScore * 0.20 +
    marketPressureScore * 0.15 +
    chinaArbitrageScore * 0.15,
  );

  // 네이버 검증 점수 (30%): 네이버 외부수요 지표로 보정
  const naverValidationScore = clamp(
    marketGapScore * 0.45 +
    trendSpikeScore * 0.55,
  );

  // 최종 추천 점수 = 쿠팡 70% + 네이버 30%
  const finalScore = clamp(
    coupangBaseScore * 0.70 + naverValidationScore * 0.30,
  );

  // 등급
  let grade: ScoringResult["grade"];
  if (finalScore >= 80) grade = "S";
  else if (finalScore >= 60) grade = "A";
  else if (finalScore >= 40) grade = "B";
  else if (finalScore >= 20) grade = "C";
  else grade = "D";

  // 태그 자동 부여
  const tags: string[] = [];
  if (marketGapScore >= 70) tags.push("블루오션");
  if (salesVelocityScore >= 60) tags.push("급상승");
  if (trendSpikeScore >= 60) tags.push("트렌드");
  if (hiddenItemScore >= 60) tags.push("숨은아이템");
  if (marketPressureScore >= 70) tags.push("공급부족");
  if (chinaArbitrageScore >= 60) tags.push("마진좋음");
  if (demandDensityScore >= 70) tags.push("수요밀집");
  if (marketGapScore < 20 && salesVelocityScore < 20) tags.push("레드오션");

  // 판매추정 보정
  const calibration = calibrateSalesEstimate(input);

  // 보정 결과에 따른 추가 태그
  if (calibration.surgeType === "real_demand") tags.push("실수요");
  if (calibration.surgeType === "promo_suspected") tags.push("프로모의심");
  if (calibration.surgeType === "early_trend") tags.push("선행트렌드");

  return {
    marketGapScore,
    salesVelocityScore,
    chinaArbitrageScore,
    trendSpikeScore,
    demandDensityScore,
    hiddenItemScore,
    marketPressureScore,
    coupangBaseScore,
    naverValidationScore,
    finalScore,
    grade,
    tags,
    calibration,
  };
}

/**
 * 키워드 정규화
 */
export function normalizeKeyword(keyword: string): string {
  return keyword
    .trim()
    .replace(/\s+/g, " ")        // 다중 공백 제거
    .replace(/[^\w가-힣\s]/g, "") // 특수문자 제거 (한글/영문/숫자/공백만)
    .toLowerCase();
}
