// ============================================================
// reverseProfit.ts — 역직구 "매입 판단" 엔진
// ============================================================
// 핵심: 실시간 가격 비교기가 아니라, "무엇을 미리 사두면 돈이 되는지" 알려주는
//       매입 판단 프로그램. POIZON 현재가가 아니라 **안정 판매가**로 계산한다.
//
//   안정 판매가 = 최근 30일 하위 25%(P25) 체결가 (보수적 기준)
//     → "잘 팔릴 때 가격"이 아니라 "조금 싸게 팔아도 남는 가격"으로 잡는다.
//
//   순이익 = 안정 판매가(원) − 국내 매입가 − 중국 배송비 − POIZON 수수료
//            − 환전 손실 − 포장비 − 반품/검수 리스크 비용
//   마진율 = 순이익 ÷ 국내 매입가 × 100
//
//   판매 안정성 등급(A/B/C/D)과 추천 매입 수량은 마진율·거래량·변동폭으로 결정.
// ============================================================

/** 풀 코스트 파라미터 (원/달러, %는 백분율). 유저·상품별로 조정 가능. */
export interface CostParams {
  rate: number; // 환율 (원/달러, KRW per USD)
  poizonFeePct: number; // POIZON 수수료율 (%) — 신발/의류 10%
  feeMinKrw: number; // 최소 수수료 (원)
  feeMaxKrw: number; // 최대 수수료 (원)
  extraFeePct: number; // POIZON 부가 수수료(적립+주문처리, %) — 보수적 버퍼
  chinaShipKrw: number; // 국내→POIZON 배송비 등 (건당, 원)
  fxLossPct: number; // 환전 손실 (%)
  packingKrw: number; // 포장비 (건당, 원)
  inspectRiskPct: number; // 반품/검수 리스크 비용 (매출 대비 %)
  vatRefund: boolean; // 부가세 환급(수출 영세율) 반영 = 매입가 ÷ 11
}

// ★ POIZON 판매 기준 시장 = 중국(득물) → 시세는 달러($). 정산은 원화.
//   수수료 = 판매가 × 10%, 단 최소 15,000 / 최대 45,000 (신발·의류, 한국 판매자 기준).
//   → 15만원 이하 저가 상품은 최소 수수료가 마진을 무너뜨림(저가 경고).
//   부가세 환급 = 국내 매입가 ÷ 11 (수출 영세율, 적격증빙 전제).
export const DEFAULT_COST: CostParams = {
  rate: 1350,
  poizonFeePct: 10,
  feeMinKrw: 15000,
  feeMaxKrw: 45000,
  extraFeePct: 2, // 적립+주문처리 수수료 보수적 버퍼
  chinaShipKrw: 5000,
  fxLossPct: 1.5,
  packingKrw: 1000,
  inspectRiskPct: 3,
  vatRefund: true,
};

// ★ POIZON 수수료는 카테고리(대분류)별로 다름 (실제 요금표):
//   가방·시계·액세서리 → 14% / 최소 18,000
//   신발·의류·운동·뷰티·완구·기타 → 10% / 최소 15,000
//   최대는 공통 45,000
export interface FeeTier {
  pct: number;
  minKrw: number;
  maxKrw: number;
}
export function feeTier(category: string | null | undefined): FeeTier {
  if (category === "가방" || category === "액세서리")
    return { pct: 14, minKrw: 18000, maxKrw: 45000 };
  return { pct: 10, minKrw: 15000, maxKrw: 45000 };
}

// POIZON 수수료 = 판매가 × 요율, 단 [최소, 최대]로 클램프.
//   category 주면 카테고리 요율, 없으면 cost 기본값 사용.
export function poizonFeeKrw(
  revenueKrw: number,
  cost: CostParams,
  category?: string | null
): { fee: number; raw: number; floorHit: boolean } {
  const t = category
    ? feeTier(category)
    : { pct: cost.poizonFeePct, minKrw: cost.feeMinKrw, maxKrw: cost.feeMaxKrw };
  const raw = Math.round((revenueKrw * t.pct) / 100);
  const fee = Math.min(t.maxKrw, Math.max(t.minKrw, raw));
  return { fee, raw, floorHit: raw < t.minKrw };
}

/** 한 상품·사이즈의 관측 시세 샘플 (위안, 관측 시각 epoch ms) */
export interface PriceSample {
  priceCny: number;
  at: number;
}

export interface StablePrice {
  stableCny: number; // 안정 판매가 = 최근 30일 P25 (보수적)
  avg7Cny: number; // 최근 7일 평균
  avg30Cny: number; // 최근 30일 평균
  lowCny: number; // 최저 체결가
  highCny: number; // 최고 체결가
  volume30: number; // 최근 30일 관측(거래) 표본 수
  volatilityPct: number; // 가격 변동폭 (max-min)/avg × 100
  sampleCount: number; // 유효 표본 수
}

const DAY = 24 * 60 * 60 * 1000;

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

/**
 * 안정 판매가 산출. 최근 30일 체결 표본에서 하위 25%(P25)를 보수적 기준값으로.
 * @param volumeHint 페이지에서 직접 읽은 30일 거래량(있으면 표본수보다 우선).
 */
export function stableSellPrice(
  samples: PriceSample[],
  now: number,
  volumeHint?: number
): StablePrice | null {
  const valid = samples.filter(s => s.priceCny > 0);
  if (valid.length === 0) return null;

  const in30 = valid.filter(s => now - s.at <= 30 * DAY);
  const in7 = valid.filter(s => now - s.at <= 7 * DAY);
  // 30일 내 표본이 없으면 전체 표본으로 보수적 산출(오래된 데이터 경고는 UI에서)
  const base = in30.length > 0 ? in30 : valid;

  const prices = base.map(s => s.priceCny).sort((a, b) => a - b);
  const low = prices[0];
  const high = prices[prices.length - 1];
  const avg30 = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
  const avg7 =
    in7.length > 0
      ? Math.round(in7.reduce((a, b) => a + b.priceCny, 0) / in7.length)
      : avg30;
  const stable = Math.round(percentile(prices, 25));
  const volatilityPct =
    avg30 > 0 ? Math.round(((high - low) / avg30) * 1000) / 10 : 0;

  return {
    stableCny: stable,
    avg7Cny: avg7,
    avg30Cny: avg30,
    lowCny: low,
    highCny: high,
    volume30: volumeHint && volumeHint > 0 ? volumeHint : base.length,
    volatilityPct,
    sampleCount: base.length,
  };
}

export interface ProfitBreakdown {
  revenueKrw: number; // 안정 판매가 → 원 환산 매출(판매가)
  domesticBuyKrw: number; // 국내 매입가
  feeKrw: number; // POIZON 수수료 (10~14% 클램프 15k~45k)
  extraFeeKrw: number; // 부가 수수료(적립+주문처리)
  effectiveFeePct: number; // 실효 수수료율 = (수수료+부가) ÷ 판매가 × 100
  feeFloorHit: boolean; // 최소 수수료가 적용됨(저가 불리)
  chinaShipKrw: number; // 국내→POIZON 배송비 등
  fxLossKrw: number; // 환전 손실
  packingKrw: number; // 포장비
  inspectRiskKrw: number; // 반품/검수 리스크
  vatRefundKrw: number; // 부가세 환급(+) = 매입가 ÷ 11
  deductKrw: number; // 매입가 제외 총 차감 (수수료+부가+배송+환전+포장+검수)
  netProfitKrw: number; // 순이익 = 판매가 − 매입가 − 차감 + 부가세환급
  marginPct: number; // 마진율 (순이익 ÷ 매입가 × 100)
  lowPrice: boolean; // 판매가 15만원 이하(최소 수수료 타격 구간)
}

/** 안정 판매가($) × 국내 매입가(원) → 풀 코스트 순이익·마진율. category로 수수료 요율 결정 */
export function computeProfit(
  domesticBuyKrw: number,
  stableSellUsd: number,
  cost: CostParams = DEFAULT_COST,
  category?: string | null
): ProfitBreakdown {
  const revenueKrw = Math.round(stableSellUsd * cost.rate);
  const { fee: feeKrw, floorHit: feeFloorHit } = poizonFeeKrw(
    revenueKrw,
    cost,
    category
  );
  const extraFeeKrw = Math.round((revenueKrw * cost.extraFeePct) / 100);
  const effectiveFeePct =
    revenueKrw > 0
      ? Math.round(((feeKrw + extraFeeKrw) / revenueKrw) * 1000) / 10
      : 0;
  const fxLossKrw = Math.round((revenueKrw * cost.fxLossPct) / 100);
  const inspectRiskKrw = Math.round((revenueKrw * cost.inspectRiskPct) / 100);
  const chinaShipKrw = Math.round(cost.chinaShipKrw);
  const packingKrw = Math.round(cost.packingKrw);
  const vatRefundKrw = cost.vatRefund ? Math.round(domesticBuyKrw / 11) : 0;
  const deductKrw =
    feeKrw + extraFeeKrw + chinaShipKrw + fxLossKrw + packingKrw + inspectRiskKrw;
  const netProfitKrw = revenueKrw - domesticBuyKrw - deductKrw + vatRefundKrw;
  const marginPct =
    domesticBuyKrw > 0
      ? Math.round((netProfitKrw / domesticBuyKrw) * 1000) / 10
      : 0;
  return {
    revenueKrw,
    domesticBuyKrw,
    feeKrw,
    extraFeeKrw,
    effectiveFeePct,
    feeFloorHit,
    chinaShipKrw,
    fxLossKrw,
    packingKrw,
    inspectRiskKrw,
    vatRefundKrw,
    deductKrw,
    netProfitKrw,
    marginPct,
    lowPrice: revenueKrw <= 150000,
  };
}

export type StabilityGrade = "A" | "B" | "C" | "D";

/**
 * 판매 안정성 등급 — 거래량 + 가격 변동폭 + 표본 수.
 *   A: 거래 활발 + 변동 낮음 + 표본 충분 → 안심 매입
 *   B: 준수
 *   C: 회전 느리거나 변동 큼 → 소량만
 *   D: 데이터 부족/불안정 → 매입 보류
 */
export function stabilityGrade(s: StablePrice): StabilityGrade {
  const { volume30, volatilityPct, sampleCount } = s;
  if (sampleCount < 2 || volume30 < 3) return "D";
  if (volume30 >= 30 && volatilityPct <= 15 && sampleCount >= 4) return "A";
  if (volume30 >= 10 && volatilityPct <= 25) return "B";
  return "C";
}

/**
 * 추천 매입 수량 (베팅 사이징 흡수) — "마진 높아도 거래량 적으면 많이 사면 안 된다".
 *   ① 등급 상한(A/B/C) × ② 마진 보정(엣지 크면 포지션↑) 를
 *   ③ 시장 수요의 15% 상한으로 눌러 재고 리스크를 방어한다. 미달이면 0(보류).
 */
export function recommendQty(
  marginPct: number,
  grade: StabilityGrade,
  volume30: number
): number {
  if (marginPct < 30) return 0; // 마진 기준 미달 → 매입 보류
  if (grade === "D") return 0; // 데이터 부족 → 보류
  const baseCap = grade === "A" ? 30 : grade === "B" ? 15 : 5;
  // 마진 보정: 아주 높은 마진(엣지 큼)이면 상한을 키운다
  const marginBoost = marginPct >= 60 ? 1.5 : 1;
  const cap = Math.round(baseCap * marginBoost);
  // 시장 30일 거래량(수요)의 ~15%까지만 (재고 리스크 방어)
  const byVolume = Math.floor(volume30 * 0.15);
  return Math.max(1, Math.min(cap, byVolume));
}

export interface DealVerdict {
  stable: StablePrice;
  profit: ProfitBreakdown;
  grade: StabilityGrade;
  recommendQty: number;
  stars: number; // 0~5 추천 별점
}

/** 상품 하나에 대한 종합 매입 판단 (안정가 → 순이익 → 등급 → 추천수량 → 별점) */
export function evaluateDeal(
  domesticBuyKrw: number,
  samples: PriceSample[],
  now: number,
  cost: CostParams = DEFAULT_COST,
  volumeHint?: number,
  category?: string | null
): DealVerdict | null {
  const stable = stableSellPrice(samples, now, volumeHint);
  if (!stable || domesticBuyKrw <= 0) return null;
  const profit = computeProfit(domesticBuyKrw, stable.stableCny, cost, category);
  const grade = stabilityGrade(stable);
  const qty = recommendQty(profit.marginPct, grade, stable.volume30);
  // 별점: 마진율 + 안정성 조합
  let stars = 0;
  if (profit.marginPct >= 30) stars += 2;
  else if (profit.marginPct >= 15) stars += 1;
  if (grade === "A") stars += 3;
  else if (grade === "B") stars += 2;
  else if (grade === "C") stars += 1;
  stars = Math.max(0, Math.min(5, stars));
  return { stable, profit, grade, recommendQty: qty, stars };
}

/**
 * 목표 순익(원) 확보에 필요한 최소 POIZON 판매가($) 역산.
 *   floor(target=0) = 손익분기 판매가 → "이 아래로 팔면 손해"인 방어선.
 *   수수료 클램프(최소/최대)가 구간별로 꺾여 닫힌식이 어려우므로 판매가를 이분 탐색.
 */
export function bidForTargetNet(
  domesticBuyKrw: number,
  targetNetKrw: number,
  cost: CostParams = DEFAULT_COST,
  category?: string | null
): number {
  if (domesticBuyKrw <= 0) return 0;
  const netAt = (usd: number) =>
    computeProfit(domesticBuyKrw, usd, cost, category).netProfitKrw;
  let lo = 0;
  let hi =
    (domesticBuyKrw + Math.max(0, targetNetKrw) + 300000) / cost.rate + 100;
  for (let g = 0; g < 10 && netAt(hi) < targetNetKrw; g++) hi *= 2;
  for (let k = 0; k < 44; k++) {
    const mid = (lo + hi) / 2;
    if (netAt(mid) < targetNetKrw) lo = mid;
    else hi = mid;
  }
  return Math.ceil(hi); // 올림 → 안전한 방어선($)
}
