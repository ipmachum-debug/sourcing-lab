/**
 * 쿠팡 판매량 추정 엔진 (Sales Estimation Engine)
 * 
 * 판매량을 직접 알 수 없는 쿠팡에서, 리뷰 증가량·순위·품절·가격 안정성 등을
 * 종합하여 판매량을 추정하는 핵심 로직.
 * 
 * 공식 요약:
 *   baseDailySales = 0.65 × (reviewΔ7d / reviewRate / 7)
 *                  + 0.35 × (reviewΔ30d / reviewRate / 30)
 *   estimatedDailySales = baseDailySales × rankBoost × soldOutBoost × priceBoost
 *   monthlyEstimate = estimatedDailySales × 30
 * 
 * 판매력 점수:
 *   salesPowerScore = log10(monthly + 1) × 30 + rankBonus + soldOutBonus
 *   Grade: VERY_LOW(0-24.99), LOW(25-39.99), MEDIUM(40-54.99), HIGH(55-69.99), VERY_HIGH(70+)
 */

// ============================================================
//  Types
// ============================================================

export interface EstimateInput {
  trackingId: number;
  reviewDelta7d: number;    // 최근 7일 리뷰 증가량
  reviewDelta30d: number;   // 최근 30일 리뷰 증가량
  avgRank: number;          // 기간 내 평균 순위
  soldOutDays: number;      // 30일 중 품절 일수
  priceChangeRate: number;  // 가격 변동률 (표준편차 / 평균가)
  currentPrice: number;     // 현재 가격
  currentReviewCount: number; // 현재 총 리뷰 수
  currentRating: number;    // 현재 평점
  categoryKey?: string;     // 카테고리 키
  reviewRate?: number;      // 카테고리별 리뷰 작성률 (없으면 기본값 사용)
}

export interface EstimateResult {
  // 입력값 그대로 저장
  reviewDelta7d: number;
  reviewDelta30d: number;
  avgRank: number;
  soldOutDays: number;
  priceChangeRate: number;
  currentPrice: number;
  currentReviewCount: number;
  currentRating: number;
  categoryKey: string;
  reviewRate: number;

  // 추정 결과
  baseDailySales: number;
  rankBoost: number;
  soldOutBoost: number;
  priceBoost: number;
  estimatedDailySales: number;
  estimatedMonthlySales: number;
  estimatedMonthlyRevenue: number;

  // 판매력 스코어
  salesPowerScore: number;
  salesGrade: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';

  // 추세 지표
  trendDirection: 'rising' | 'stable' | 'declining';
  surgeFlag: boolean;
}

// ============================================================
//  기본 상수 & 카테고리 리뷰율
// ============================================================

/** 기본 리뷰 작성률 (카테고리 미지정 시) */
const DEFAULT_REVIEW_RATE = 0.02;

/** 카테고리별 기본 리뷰율 맵 (DB 값이 없을 때 폴백) */
export const DEFAULT_CATEGORY_REVIEW_RATES: Record<string, number> = {
  '생활용품': 0.02,
  '뷰티': 0.035,
  '전자기기': 0.015,
  '패션의류': 0.025,
  '패션잡화': 0.023,
  '식품': 0.01,
  '유아동': 0.03,
  '스포츠': 0.018,
  '가구인테리어': 0.012,
  '주방': 0.022,
  '반려동물': 0.028,
  '문구완구': 0.02,
  '자동차': 0.014,
  '헬스': 0.025,
  '기타': 0.02,
};

/** 이상치 캡 (아웃라이어 방지) */
const CAP_REVIEW_DELTA_7D = 300;
const CAP_REVIEW_DELTA_30D = 1000;

// ============================================================
//  유틸리티
// ============================================================

function safeNumber(v: any): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function round(v: number, decimals: number = 2): number {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

// ============================================================
//  부스트 계수 계산
// ============================================================

/**
 * 순위 부스트 계수
 * 순위가 높을수록(숫자 작을수록) 판매량이 더 많을 것으로 추정
 */
export function calcRankBoost(avgRank: number): number {
  if (avgRank <= 0) return 1.0;
  if (avgRank <= 3) return 1.25;
  if (avgRank <= 10) return 1.12;
  if (avgRank <= 20) return 1.00;
  if (avgRank <= 50) return 0.88;
  return 0.75;
}

/**
 * 품절 부스트 계수
 * 품절이 잦을수록 수요가 많다는 신호
 */
export function calcSoldOutBoost(soldOutDays: number): number {
  if (soldOutDays <= 0) return 1.0;
  if (soldOutDays <= 2) return 1.03;
  if (soldOutDays <= 4) return 1.06;
  return 1.10;
}

/**
 * 가격 안정성 부스트 계수
 * 가격이 안정적일수록 수요가 탄탄하다는 신호
 */
export function calcPriceBoost(priceChangeRate: number): number {
  const rate = Math.abs(priceChangeRate);
  if (rate <= 0.05) return 1.00;
  if (rate <= 0.15) return 0.97;
  return 0.93;
}

// ============================================================
//  핵심 판매량 추정 로직
// ============================================================

/**
 * 판매량 추정 메인 함수
 * 
 * @param input - 추정에 필요한 입력 데이터
 * @returns EstimateResult - 추정 결과 전체
 */
export function calculateSalesEstimate(input: EstimateInput): EstimateResult {
  const reviewRate = input.reviewRate && input.reviewRate > 0
    ? input.reviewRate
    : DEFAULT_REVIEW_RATE;

  // 이상치 캡 적용
  const rd7 = clamp(safeNumber(input.reviewDelta7d), 0, CAP_REVIEW_DELTA_7D);
  const rd30 = clamp(safeNumber(input.reviewDelta30d), 0, CAP_REVIEW_DELTA_30D);
  const avgRank = safeNumber(input.avgRank);
  const soldOutDays = clamp(safeNumber(input.soldOutDays), 0, 30);
  const priceChangeRate = safeNumber(input.priceChangeRate);
  const currentPrice = safeNumber(input.currentPrice);

  // ── Step 1: 기본 일일 판매량 ──
  // 7일 리뷰 증가 → 일평균 판매량 (단기 트렌드, 가중치 0.65)
  // 30일 리뷰 증가 → 일평균 판매량 (장기 트렌드, 가중치 0.35)
  const daily7d = reviewRate > 0 ? (rd7 / reviewRate / 7) : 0;
  const daily30d = reviewRate > 0 ? (rd30 / reviewRate / 30) : 0;
  const baseDailySales = round(0.65 * daily7d + 0.35 * daily30d, 2);

  // ── Step 2: 부스트 계수 ──
  const rankBoost = calcRankBoost(avgRank);
  const soldOutBoost = calcSoldOutBoost(soldOutDays);
  const priceBoost = calcPriceBoost(priceChangeRate);

  // ── Step 3: 최종 판매량 추정 ──
  const estimatedDailySales = round(baseDailySales * rankBoost * soldOutBoost * priceBoost, 2);
  const estimatedMonthlySales = round(estimatedDailySales * 30, 2);
  const estimatedMonthlyRevenue = Math.round(estimatedMonthlySales * currentPrice);

  // ── Step 4: 판매력 점수 (0~100) ──
  let salesPowerScore = 0;

  // log10 기반 기본 점수 (0~60점 범위)
  if (estimatedMonthlySales > 0) {
    salesPowerScore += Math.log10(estimatedMonthlySales + 1) * 30;
  }

  // 순위 보너스 (최대 15점)
  if (avgRank > 0) {
    if (avgRank <= 3) salesPowerScore += 15;
    else if (avgRank <= 10) salesPowerScore += 10;
    else if (avgRank <= 20) salesPowerScore += 5;
  }

  // 품절 보너스 (최대 5점)
  if (soldOutDays >= 3) salesPowerScore += 5;

  // 리뷰 증가 보너스 (최대 10점)
  if (rd7 >= 30) salesPowerScore += 10;
  else if (rd7 >= 15) salesPowerScore += 7;
  else if (rd7 >= 5) salesPowerScore += 3;

  // 가격 안정성 보너스 (최대 5점)
  if (Math.abs(priceChangeRate) <= 0.05) salesPowerScore += 5;
  else if (Math.abs(priceChangeRate) <= 0.10) salesPowerScore += 3;

  salesPowerScore = round(clamp(salesPowerScore, 0, 100), 2);

  // ── Step 5: 등급 ──
  const salesGrade = getSalesGrade(salesPowerScore);

  // ── Step 6: 추세 판단 ──
  const trendDirection = getTrendDirection(rd7, rd30);
  const surgeFlag = rd7 >= 50 || (rd7 > 0 && daily7d > daily30d * 2);

  return {
    reviewDelta7d: rd7,
    reviewDelta30d: rd30,
    avgRank,
    soldOutDays,
    priceChangeRate: round(priceChangeRate, 4),
    currentPrice,
    currentReviewCount: safeNumber(input.currentReviewCount),
    currentRating: safeNumber(input.currentRating),
    categoryKey: input.categoryKey || '기타',
    reviewRate,

    baseDailySales,
    rankBoost,
    soldOutBoost,
    priceBoost,
    estimatedDailySales,
    estimatedMonthlySales,
    estimatedMonthlyRevenue,

    salesPowerScore,
    salesGrade,
    trendDirection,
    surgeFlag,
  };
}

// ============================================================
//  판매력 등급
// ============================================================

export function getSalesGrade(score: number): 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' {
  if (score >= 70) return 'VERY_HIGH';
  if (score >= 55) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  if (score >= 25) return 'LOW';
  return 'VERY_LOW';
}

export function getSalesGradeLabel(grade: string): string {
  const map: Record<string, string> = {
    'VERY_HIGH': '🔥 매우 높음',
    'HIGH': '📈 높음',
    'MEDIUM': '📊 보통',
    'LOW': '📉 낮음',
    'VERY_LOW': '⬇️ 매우 낮음',
  };
  return map[grade] || grade;
}

// ============================================================
//  추세 판단
// ============================================================

function getTrendDirection(rd7: number, rd30: number): 'rising' | 'stable' | 'declining' {
  if (rd30 <= 0) return 'stable';
  
  // 7일 일평균 vs 30일 일평균 비교
  const daily7 = rd7 / 7;
  const daily30 = rd30 / 30;
  
  if (daily30 <= 0) return 'stable';
  
  const ratio = daily7 / daily30;
  if (ratio >= 1.3) return 'rising';
  if (ratio <= 0.7) return 'declining';
  return 'stable';
}

// ============================================================
//  배치 계산을 위한 윈도우 메트릭 빌더
// ============================================================

export interface SnapshotRow {
  snapshotDate: string;
  price: number;
  reviewCount: number;
  rankPosition: number;
  rating: number;
  // sold_out은 dataJson 안에 포함 가능
  dataJson?: string;
}

export interface WindowMetrics {
  reviewDelta7d: number;
  reviewDelta30d: number;
  avgRank: number;
  soldOutDays: number;
  priceChangeRate: number;
  currentPrice: number;
  currentReviewCount: number;
  currentRating: number;
}

/**
 * 일일 스냅샷 배열로부터 판매량 추정에 필요한 윈도우 메트릭 계산
 * 
 * @param snapshots - 최신순 정렬된 최근 30일 스냅샷 배열
 * @param targetDate - 계산 기준일 (YYYY-MM-DD)
 * @returns WindowMetrics | null
 */
export function buildWindowMetrics(snapshots: SnapshotRow[], targetDate?: string): WindowMetrics | null {
  if (!snapshots || snapshots.length < 2) return null;

  // 최신 스냅샷 = 현재값
  const latest = snapshots[0];
  const currentPrice = safeNumber(latest.price);
  const currentReviewCount = safeNumber(latest.reviewCount);
  const currentRating = safeNumber(latest.rating);

  // 7일 전/30일 전 스냅샷 찾기
  const now = targetDate ? new Date(targetDate) : new Date();
  const date7ago = new Date(now);
  date7ago.setDate(date7ago.getDate() - 7);
  const date30ago = new Date(now);
  date30ago.setDate(date30ago.getDate() - 30);

  const fmt = (d: Date) => d.toISOString().substring(0, 10);

  // 7일 전에 가장 가까운 스냅샷 찾기
  const snap7 = findClosestSnapshot(snapshots, fmt(date7ago));
  // 30일 전에 가장 가까운 스냅샷 찾기
  const snap30 = findClosestSnapshot(snapshots, fmt(date30ago));

  const reviewDelta7d = snap7
    ? Math.max(0, currentReviewCount - safeNumber(snap7.reviewCount))
    : 0;
  const reviewDelta30d = snap30
    ? Math.max(0, currentReviewCount - safeNumber(snap30.reviewCount))
    : reviewDelta7d; // 30일 데이터 없으면 7일 기반 추정

  // 평균 순위 계산 (최근 7일)
  const recentSnapshots = snapshots.filter(s => s.snapshotDate >= fmt(date7ago));
  const ranks = recentSnapshots
    .map(s => safeNumber(s.rankPosition))
    .filter(r => r > 0);
  const avgRank = ranks.length > 0
    ? round(ranks.reduce((a, b) => a + b, 0) / ranks.length, 2)
    : 0;

  // 품절 일수 (30일 이내, dataJson에 soldOut 포함 시 카운트)
  let soldOutDays = 0;
  for (const snap of snapshots) {
    try {
      const data = snap.dataJson ? JSON.parse(snap.dataJson) : {};
      if (data.soldOut || data.isSoldOut) soldOutDays++;
    } catch { /* ignore */ }
  }

  // 가격 변동률 (최근 30일 가격의 표준편차 / 평균)
  const prices = snapshots.map(s => safeNumber(s.price)).filter(p => p > 0);
  let priceChangeRate = 0;
  if (prices.length >= 2) {
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    if (mean > 0) {
      const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
      priceChangeRate = round(Math.sqrt(variance) / mean, 4);
    }
  }

  return {
    reviewDelta7d,
    reviewDelta30d,
    avgRank,
    soldOutDays,
    priceChangeRate,
    currentPrice,
    currentReviewCount,
    currentRating,
  };
}

/**
 * 주어진 날짜에 가장 가까운 스냅샷 찾기
 */
function findClosestSnapshot(snapshots: SnapshotRow[], targetDate: string): SnapshotRow | null {
  let best: SnapshotRow | null = null;
  let bestDiff = Infinity;

  const target = new Date(targetDate).getTime();
  for (const snap of snapshots) {
    const diff = Math.abs(new Date(snap.snapshotDate).getTime() - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = snap;
    }
  }

  // 3일 이내 차이만 허용
  if (bestDiff > 3 * 24 * 60 * 60 * 1000) return null;
  return best;
}

// ============================================================
//  카테고리 매칭 유틸리티
// ============================================================

/** 쿠팡 카테고리 경로에서 리뷰율 카테고리 키 추출 */
export function matchCategoryKey(categoryPath: string): string {
  if (!categoryPath) return '기타';

  const path = categoryPath.toLowerCase();

  // 우선순위: 구체적 매칭 → 상위 매칭
  const matchers: [RegExp, string][] = [
    [/뷰티|화장|스킨케어|향수|클렌징|마스크팩|에센스/i, '뷰티'],
    [/전자|디지털|컴퓨터|노트북|태블릿|스마트폰|이어폰|충전/i, '전자기기'],
    [/패션.*잡화|가방|지갑|벨트|모자|양말|스카프/i, '패션잡화'],
    [/패션.*의류|의류|티셔츠|바지|원피스|자켓|코트/i, '패션의류'],
    [/식품|과자|음료|커피|건강식품|다이어트|비타민/i, '식품'],
    [/유아|아동|아기|키즈|베이비/i, '유아동'],
    [/스포츠|레저|아웃도어|캠핑|등산|자전거|요가/i, '스포츠'],
    [/가구|인테리어|홈데코|커튼|수납|정리/i, '가구인테리어'],
    [/주방|요리|냄비|프라이팬|식기|그릇|칼/i, '주방'],
    [/반려|펫|강아지|고양이|사료|간식/i, '반려동물'],
    [/문구|완구|장난감|퍼즐|크레용/i, '문구완구'],
    [/자동차|차량|카용품/i, '자동차'],
    [/헬스|건강|다이어트|프로틴|영양제/i, '헬스'],
    [/생활|일상|청소|세제|화장지|건전지/i, '생활용품'],
  ];

  for (const [regex, key] of matchers) {
    if (regex.test(path)) return key;
  }

  return '생활용품'; // 매칭 안 되면 생활용품 기본값
}
