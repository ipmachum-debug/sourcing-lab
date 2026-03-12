/**
 * 키워드 점수화 엔진
 * 7가지 알고리즘을 통합하여 키워드별 최종 점수 산출
 */

interface ScoringInput {
  // 네이버 데이터
  naverTotalSearch?: number;
  naverCompetition?: string; // "높음" | "중간" | "낮음"
  naverAvgCpc?: number;
  naverSearchPrev?: number; // 이전 기간 검색량 (트렌드용)

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

  // 소싱 데이터
  sourcePrice?: number; // 중국가
}

export interface ScoringResult {
  marketGapScore: number;      // 1. 검색량 대비 경쟁도
  salesVelocityScore: number;  // 2. 리뷰 증가 속도
  chinaArbitrageScore: number; // 3. 가격 격차
  trendSpikeScore: number;     // 4. 검색량 급등
  demandDensityScore: number;  // 5. 리뷰 대비 상품수
  hiddenItemScore: number;     // 6. 숨은 아이템
  marketPressureScore: number; // 7. 시장 압력
  finalScore: number;          // 최종 종합 점수
  grade: "S" | "A" | "B" | "C" | "D";
  tags: string[];
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

/**
 * 최종 점수 계산
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

  // 최종 추천 점수
  const finalScore = clamp(
    marketGapScore * 0.20 +
    salesVelocityScore * 0.15 +
    trendSpikeScore * 0.15 +
    demandDensityScore * 0.15 +
    hiddenItemScore * 0.15 +
    marketPressureScore * 0.10 +
    chinaArbitrageScore * 0.10,
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

  return {
    marketGapScore,
    salesVelocityScore,
    chinaArbitrageScore,
    trendSpikeScore,
    demandDensityScore,
    hiddenItemScore,
    marketPressureScore,
    finalScore,
    grade,
    tags,
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
