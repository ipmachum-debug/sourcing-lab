/**
 * ============================================================
 * Hybrid Data Collection — Adaptive Batch Collector Engine
 * ============================================================
 *
 * 서버 사이드 배치 수집 엔진 (적응형 스케줄러 + 인간 행동 딜레이)
 * - 크롤링 NO! 사용자가 수집한 데이터를 기반으로 일일 집계/분석만 수행
 * - next_collect_at 기반 적응형 스케줄링
 * - 변동성(volatility) 기반 수집 주기 자동 조절
 * - 인간 행동 패턴을 모방한 딜레이 설정 제공
 *
 * 적응형 스케줄링 규칙:
 *   변동성 점수(0~100) → 수집 주기(8h~168h)
 *   - 🔥 급변 (score≥80): 8시간
 *   - 🆕 신규 (등록 3일 이내): 24~30시간 (신규 보너스)
 *   - 📊 중간 (score 40~79): 24~48시간
 *   - 😴 안정 (score<40): 72~168시간
 */

import { getDb } from "./db";
import {
  extSearchEvents, extWatchKeywords, extKeywordDailyStatus,
  extSearchSnapshots, extKeywordDailyStats,
  keywordMaster, keywordDailyMetrics,
} from "../drizzle/schema";
import { eq, and, desc, sql, gte, lt, asc, ne, isNull, lte, or } from "drizzle-orm";

/** Drizzle-ORM decimal/SUM 결과 → number 변환 */
function N(v: any): number { return Number(v) || 0; }

/** KST 현재 시각 */
function nowKST(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 9);
  return d;
}

/** Date → MySQL TIMESTAMP 문자열 (KST) */
function toMySQLTimestamp(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

// ============================================================
//  타입 정의
// ============================================================

export interface BatchKeywordSelection {
  id: number;
  keyword: string;
  priority: number;
  lastSearchedAt: string | null;
  lastCollectedAt: string | null;
  nextCollectAt: string | null;
  totalSearchCount: number;
  compositeScore: number;
  volatilityScore: number;
  adaptiveIntervalHours: number | null;
  selectionReason: string;
}

export interface AdaptiveBatchResult {
  keywords: BatchKeywordSelection[];
  delayConfig: HumanDelayConfig;
  totalActive: number;
  totalOverdue: number;
}

/** 인간 행동 딜레이 설정 — 클라이언트에 전달 */
export interface HumanDelayConfig {
  /** 버스트 내 요청 간 기본 딜레이 (ms) */
  baseDelayMs: number;
  /** 버스트 내 딜레이 랜덤 범위 상한 (ms) */
  maxDelayMs: number;
  /** 버스트 크기 (연속 수집 후 긴 휴식) */
  burstSize: number;
  /** 버스트 후 긴 휴식 최소 (ms) */
  burstPauseMinMs: number;
  /** 버스트 후 긴 휴식 최대 (ms) */
  burstPauseMaxMs: number;
  /** 세션 시작 워밍업 딜레이 (ms) */
  warmupDelayMs: number;
}

export interface DailyAggregation {
  keyword: string;
  statDate: string;
  totalItems: number;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  avgRating: number;
  avgReview: number;
  totalReviewSum: number;
  medianReview: number;
  adCount: number;
  adRatio: number;
  rocketCount: number;
  rocketRatio: number;
  highReviewCount: number;
  newProductCount: number;
  reviewGrowth: number;
  priceChange: number;
  itemCountChange: number;
  estimatedDailySales: number;
  salesScore: number;
  demandScore: number;
  competitionScore: number;
  competitionLevel: string;
  dataQualityScore: number;
  priceParseRate: number;
  ratingParseRate: number;
  reviewParseRate: number;
}

// ============================================================
//  적응형 스케줄러 — 변동성 기반 수집 주기 계산
// ============================================================

/** 변동성 점수 계산 (0~100) */
function computeVolatilityScore(kw: {
  reviewGrowth1d: any;
  reviewGrowth7d: any;
  priceChange1d: any;
  compositeScore: any;
  totalSearchCount: any;
  createdAt: any;
  lastSearchedAt: any;
}): number {
  let score = 0;

  // 리뷰 증가 (1일) — 최대 35점
  const rg1d = Math.abs(N(kw.reviewGrowth1d));
  if (rg1d >= 100) score += 35;
  else if (rg1d >= 50) score += 28;
  else if (rg1d >= 20) score += 20;
  else if (rg1d >= 10) score += 12;
  else if (rg1d > 0) score += 5;

  // 리뷰 증가 (7일) — 최대 20점
  const rg7d = Math.abs(N(kw.reviewGrowth7d));
  if (rg7d >= 500) score += 20;
  else if (rg7d >= 200) score += 15;
  else if (rg7d >= 100) score += 10;
  else if (rg7d > 0) score += 5;

  // 가격 변동 — 최대 20점
  const pc = Math.abs(N(kw.priceChange1d));
  if (pc >= 10000) score += 20;
  else if (pc >= 5000) score += 15;
  else if (pc >= 2000) score += 10;
  else if (pc >= 500) score += 5;

  // 사용자 관심도 (검색 횟수) — 최대 15점
  const searches = N(kw.totalSearchCount);
  if (searches >= 20) score += 15;
  else if (searches >= 10) score += 10;
  else if (searches >= 5) score += 7;
  else if (searches >= 2) score += 3;

  // 최근 사용자 활동 보정 — 최대 10점
  const now = nowKST();
  const lastSearch = kw.lastSearchedAt ? new Date(kw.lastSearchedAt) : null;
  if (lastSearch) {
    const hoursSince = (now.getTime() - lastSearch.getTime()) / (3600 * 1000);
    if (hoursSince <= 6) score += 10;
    else if (hoursSince <= 24) score += 7;
    else if (hoursSince <= 72) score += 4;
  }

  return Math.min(100, score);
}

/**
 * 변동성 점수 → 적응형 수집 주기 (시간)
 *
 * | 시나리오         | 점수    | 주기      |
 * |-----------------|---------|----------|
 * | 🔥 급변          | ≥80     | 8시간    |
 * | 🆕 신규 (3일)    | any     | 24~30시간 |
 * | 📊 높은 변동     | 60~79   | 24시간    |
 * | 📊 중간 변동     | 40~59   | 48시간    |
 * | 😴 낮은 변동     | 20~39   | 72시간    |
 * | 💤 안정          | <20     | 120시간   |
 */
function computeAdaptiveInterval(
  volatilityScore: number,
  createdAt: string | null,
): number {
  const now = nowKST();

  // 신규 키워드 보너스 (등록 3일 이내)
  if (createdAt) {
    const created = new Date(createdAt);
    const daysSinceCreation = (now.getTime() - created.getTime()) / (24 * 3600 * 1000);
    if (daysSinceCreation <= 3) {
      // 신규는 자주 수집하되, 변동성 높으면 더 자주
      return volatilityScore >= 60 ? 12 : 24;
    }
  }

  // 변동성 기반 주기
  if (volatilityScore >= 80) return 8;
  if (volatilityScore >= 60) return 24;
  if (volatilityScore >= 40) return 48;
  if (volatilityScore >= 20) return 72;
  return 120;
}

/** next_collect_at 계산 */
function computeNextCollectAt(intervalHours: number): Date {
  const next = nowKST();
  next.setTime(next.getTime() + intervalHours * 3600 * 1000);
  return next;
}

// ============================================================
//  인간 행동 딜레이 설정 생성
// ============================================================

/**
 * 수집 키워드 수에 따라 인간 행동 패턴 딜레이 설정 생성
 * - 버스트 + 긴 휴식 패턴 (사람이 검색하다가 다른 일 하다 돌아오는 패턴)
 * - 키워드가 많을수록 보수적으로 설정
 */
function generateDelayConfig(keywordCount: number): HumanDelayConfig {
  if (keywordCount <= 5) {
    // 소량: 비교적 빠르게
    return {
      baseDelayMs: 15000,
      maxDelayMs: 35000,
      burstSize: 3,
      burstPauseMinMs: 60000,
      burstPauseMaxMs: 120000,
      warmupDelayMs: 5000,
    };
  }
  if (keywordCount <= 15) {
    // 중간: 적당한 패턴
    return {
      baseDelayMs: 20000,
      maxDelayMs: 45000,
      burstSize: 4,
      burstPauseMinMs: 80000,
      burstPauseMaxMs: 150000,
      warmupDelayMs: 8000,
    };
  }
  // 대량: 보수적 패턴
  return {
    baseDelayMs: 25000,
    maxDelayMs: 55000,
    burstSize: 5,
    burstPauseMinMs: 90000,
    burstPauseMaxMs: 180000,
    warmupDelayMs: 10000,
  };
}

// ============================================================
//  배치 키워드 선택 (next_collect_at 기반 적응형)
// ============================================================

/**
 * 적응형 배치 수집 대상 키워드 선택
 *
 * 선택 전략:
 * 1. next_collect_at이 현재 이전인 키워드 (수집 기한 초과) — 우선
 * 2. next_collect_at이 NULL인 키워드 (아직 스케줄링 안 됨) — 다음
 * 3. 변동성 높은 순 → 마지막 수집이 오래된 순 정렬
 *
 * 반환에 delayConfig 포함 → 클라이언트는 이 설정대로 딜레이만 적용
 */
export async function selectBatchKeywords(
  userId: number,
  limit: number = 20,
): Promise<AdaptiveBatchResult> {
  const db = await getDb();
  if (!db) return { keywords: [], delayConfig: generateDelayConfig(0), totalActive: 0, totalOverdue: 0 };

  const now = nowKST();
  const nowStr = toMySQLTimestamp(now);

  // 전체 활성 키워드 수
  const [{ cnt: totalActive }] = await db.select({
    cnt: sql<number>`COUNT(*)`,
  })
    .from(extWatchKeywords)
    .where(and(
      eq(extWatchKeywords.userId, userId),
      eq(extWatchKeywords.isActive, true),
    ));

  // next_collect_at 기한 초과 또는 NULL인 키워드 선택
  const keywords = await db.select({
    id: extWatchKeywords.id,
    keyword: extWatchKeywords.keyword,
    priority: extWatchKeywords.priority,
    lastSearchedAt: extWatchKeywords.lastSearchedAt,
    lastCollectedAt: extWatchKeywords.lastCollectedAt,
    nextCollectAt: extWatchKeywords.nextCollectAt,
    totalSearchCount: extWatchKeywords.totalSearchCount,
    compositeScore: extWatchKeywords.compositeScore,
    volatilityScore: extWatchKeywords.volatilityScore,
    adaptiveIntervalHours: extWatchKeywords.adaptiveIntervalHours,
    reviewGrowth1d: extWatchKeywords.reviewGrowth1d,
    reviewGrowth7d: extWatchKeywords.reviewGrowth7d,
    priceChange1d: extWatchKeywords.priceChange1d,
    createdAt: extWatchKeywords.createdAt,
    lastUserViewAt: extWatchKeywords.lastUserViewAt,
  })
    .from(extWatchKeywords)
    .where(and(
      eq(extWatchKeywords.userId, userId),
      eq(extWatchKeywords.isActive, true),
      or(
        isNull(extWatchKeywords.nextCollectAt),
        lte(extWatchKeywords.nextCollectAt, nowStr),
      ),
    ))
    .orderBy(
      // NULL(미스케줄링) 먼저
      sql`${extWatchKeywords.nextCollectAt} IS NOT NULL`,
      // 기한 초과가 오래된 순
      asc(extWatchKeywords.nextCollectAt),
      // 변동성 높은 순
      desc(extWatchKeywords.volatilityScore),
      // 마지막 수집이 오래된 순
      asc(extWatchKeywords.lastCollectedAt),
    )
    .limit(limit);

  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 3600 * 1000);

  const result: BatchKeywordSelection[] = keywords.map(k => {
    // 변동성 재계산 (최신 데이터 기반)
    const volScore = computeVolatilityScore(k);
    const intervalHours = computeAdaptiveInterval(volScore, k.createdAt);

    // 선택 사유
    let reason = "";
    if (!k.nextCollectAt) {
      reason = "미스케줄링_초기수집";
    } else if (!k.lastCollectedAt) {
      reason = "미수집_키워드";
    } else {
      const lastSearch = k.lastSearchedAt ? new Date(k.lastSearchedAt) : null;
      if (volScore >= 80) reason = "급변_감지";
      else if (lastSearch && lastSearch >= threeDaysAgo) reason = "최근_3일_검색";
      else if (N(k.compositeScore) >= 70) reason = "높은_종합점수";
      else if (N(k.reviewGrowth1d) > 0) reason = "리뷰_증가_감지";
      else reason = "정기_수집";
    }

    return {
      id: k.id,
      keyword: k.keyword,
      priority: N(k.priority),
      lastSearchedAt: k.lastSearchedAt,
      lastCollectedAt: k.lastCollectedAt,
      nextCollectAt: k.nextCollectAt,
      totalSearchCount: N(k.totalSearchCount),
      compositeScore: N(k.compositeScore),
      volatilityScore: volScore,
      adaptiveIntervalHours: intervalHours,
      selectionReason: reason,
    };
  });

  return {
    keywords: result,
    delayConfig: generateDelayConfig(result.length),
    totalActive: N(totalActive),
    totalOverdue: result.length,
  };
}

// ============================================================
//  일일 집계 계산
// ============================================================

/**
 * 특정 날짜의 검색 이벤트를 기반으로 일일 집계 데이터 생성
 */
export async function computeDailyAggregation(
  userId: number,
  keyword: string,
  statDate: string,
): Promise<DailyAggregation | null> {
  const db = await getDb();
  if (!db) return null;

  // 해당 날짜의 검색 이벤트 가져오기 (가장 최신 것 기준)
  const events = await db.select()
    .from(extSearchEvents)
    .where(and(
      eq(extSearchEvents.userId, userId),
      eq(extSearchEvents.keyword, keyword),
      sql`DATE(${extSearchEvents.searchedAt}) = ${statDate}`,
    ))
    .orderBy(desc(extSearchEvents.searchedAt))
    .limit(5);

  if (!events.length) return null;

  // 가장 최신 이벤트의 데이터를 기본으로 사용
  const latest = events[0];
  let items: any[] = [];
  try {
    items = latest.itemsJson ? JSON.parse(latest.itemsJson) : [];
  } catch { items = []; }

  const totalItems = items.length || N(latest.totalItems);

  // 상세 통계 계산 (개별 상품 레벨)
  const prices = items.map((i: any) => N(i.price)).filter((p: number) => p > 0 && p < 100000000);
  const ratings = items.map((i: any) => N(i.rating)).filter((r: number) => r > 0 && r <= 5);
  const reviews = items.map((i: any) => N(i.reviewCount)).filter((r: number) => r > 0);

  const INT_MAX = 2147483647; // MySQL INT 최대값
  const clampInt = (v: number) => Math.min(Math.max(Math.round(v), 0), INT_MAX);
  const avgPrice = clampInt(prices.length ? prices.reduce((a: number, b: number) => a + b, 0) / prices.length : 0);
  const minPrice = clampInt(prices.length ? Math.min(...prices) : 0);
  const maxPrice = clampInt(prices.length ? Math.max(...prices) : 0);
  const avgRating = ratings.length ? +(ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length).toFixed(1) : 0;
  const avgReview = clampInt(reviews.length ? reviews.reduce((a: number, b: number) => a + b, 0) / reviews.length : 0);
  const totalReviewSum = clampInt(reviews.reduce((a: number, b: number) => a + b, 0));

  // 중앙값 리뷰
  const sortedReviews = [...reviews].sort((a, b) => a - b);
  const medianReview = sortedReviews.length
    ? sortedReviews[Math.floor(sortedReviews.length / 2)]
    : 0;

  // 광고/로켓/특수 분류
  const adCount = items.filter((i: any) => i.isAd).length;
  const rocketCount = items.filter((i: any) => i.isRocket).length;
  const highReviewCount = items.filter((i: any) => N(i.reviewCount) >= 100).length;
  const newProductCount = items.filter((i: any) => N(i.reviewCount) < 10).length;

  const adRatio = totalItems ? +(adCount / totalItems * 100).toFixed(2) : 0;
  const rocketRatio = totalItems ? +(rocketCount / totalItems * 100).toFixed(2) : 0;

  // 파싱 품질 계산
  const priceParseRate = totalItems ? Math.round(prices.length / totalItems * 100) : 0;
  const ratingParseRate = totalItems ? Math.round(ratings.length / totalItems * 100) : 0;
  const reviewParseRate = totalItems ? Math.round(reviews.length / totalItems * 100) : 0;
  const dataQualityScore = Math.round((priceParseRate + ratingParseRate + reviewParseRate) / 3);

  // ★ v7.4.0: 유효한 기준점(baseline) 기반 리뷰 증가 계산
  // - 리뷰 파싱 실패(totalReviewSum=0 && totalItems>0)인 날은 기준점에서 제외
  // - 유효한 첫 기준점부터 증가분만 계산
  // - 중간에 파싱 실패한 날이 있으면 경과일수로 나눠 일평균 증가로 산출

  // 최근 14일 이내 과거 데이터 조회 (유효한 기준점 찾기)
  const recentHistory = await db.select({
    statDate: extKeywordDailyStatus.statDate,
    totalReviewSum: extKeywordDailyStatus.totalReviewSum,
    totalItems: extKeywordDailyStatus.totalItems,
    reviewGrowth: extKeywordDailyStatus.reviewGrowth,
    avgPrice: extKeywordDailyStatus.avgPrice,
  })
    .from(extKeywordDailyStatus)
    .where(and(
      eq(extKeywordDailyStatus.userId, userId),
      eq(extKeywordDailyStatus.keyword, keyword),
      sql`${extKeywordDailyStatus.statDate} < ${statDate}`,
      sql`${extKeywordDailyStatus.statDate} >= DATE_SUB(${statDate}, INTERVAL 14 DAY)`,
    ))
    .orderBy(desc(extKeywordDailyStatus.statDate))
    .limit(14);

  /**
   * 리뷰 데이터가 유효한지 판별:
   * - totalReviewSum > 0 이어야 함
   * - totalItems > 0인데 totalReviewSum = 0이면 파싱 실패로 판단
   */
  const isReviewDataValid = (reviewSum: number, items: number): boolean =>
    reviewSum > 0 || items === 0;

  // 오늘 데이터가 유효한지 확인
  const todayReviewValid = isReviewDataValid(totalReviewSum, totalItems);

  // 유효한 가장 최근 기준점 찾기
  let baselineEntry: { statDate: string; totalReviewSum: number; avgPrice: number } | null = null;
  let daysSinceBaseline = 0;

  for (const entry of recentHistory) {
    const entryReviewSum = N(entry.totalReviewSum);
    const entryItems = N(entry.totalItems);
    if (isReviewDataValid(entryReviewSum, entryItems)) {
      baselineEntry = {
        statDate: String(entry.statDate),
        totalReviewSum: entryReviewSum,
        avgPrice: N(entry.avgPrice),
      };
      // 경과일수 계산
      const baseDate = new Date(baselineEntry.statDate + "T00:00:00");
      const currentDate = new Date(statDate + "T00:00:00");
      daysSinceBaseline = Math.max(1, Math.round(
        (currentDate.getTime() - baseDate.getTime()) / (24 * 60 * 60 * 1000),
      ));
      break;
    }
  }

  let reviewGrowth = 0;
  let priceChange = 0;
  let itemCountChange = 0;

  if (todayReviewValid && baselineEntry) {
    const rawGrowth = totalReviewSum - baselineEntry.totalReviewSum;
    if (rawGrowth >= 0) {
      // 경과일수로 나눠 일평균 증가분 산출
      reviewGrowth = daysSinceBaseline > 1
        ? Math.round(rawGrowth / daysSinceBaseline)
        : rawGrowth;
    }
    // 음수면 0 유지 (수집 편차)
    priceChange = avgPrice - baselineEntry.avgPrice;
  } else if (!todayReviewValid) {
    // 오늘 리뷰 파싱 실패 → 증가 0 (잘못된 데이터로 계산하지 않음)
    reviewGrowth = 0;
  }

  // 전일 데이터로 상품수 변동 계산
  const prevDate = getPrevDate(statDate);
  const [prevStatus] = await db.select()
    .from(extKeywordDailyStatus)
    .where(and(
      eq(extKeywordDailyStatus.userId, userId),
      eq(extKeywordDailyStatus.keyword, keyword),
      eq(extKeywordDailyStatus.statDate, prevDate),
    ))
    .limit(1);
  itemCountChange = prevStatus ? totalItems - N(prevStatus.totalItems) : 0;

  // 판매량 추정 (리뷰 증가 × 20 = 리뷰 작성률 ~5% 기준)
  const estimatedDailySales = Math.max(0, reviewGrowth * 20);

  // 판매력 점수 (0~100)
  let salesScore = 0;
  if (estimatedDailySales >= 500) salesScore = 90;
  else if (estimatedDailySales >= 200) salesScore = 75;
  else if (estimatedDailySales >= 100) salesScore = 60;
  else if (estimatedDailySales >= 50) salesScore = 45;
  else if (estimatedDailySales >= 20) salesScore = 30;
  else if (estimatedDailySales > 0) salesScore = 15;

  // 수요 점수 = 판매력 + 검색 빈도 보정
  const demandScore = Math.min(100, salesScore + (totalItems >= 36 ? 10 : 0));

  // 경쟁도 계산
  let competitionScore = 0;
  if (avgReview > 1000) competitionScore += 35;
  else if (avgReview > 500) competitionScore += 25;
  else if (avgReview > 100) competitionScore += 15;
  else if (avgReview > 30) competitionScore += 8;

  const highRatio = totalItems ? highReviewCount / totalItems : 0;
  if (highRatio > 0.6) competitionScore += 25;
  else if (highRatio > 0.4) competitionScore += 15;
  else if (highRatio > 0.2) competitionScore += 8;

  if (avgRating >= 4.5) competitionScore += 15;
  else if (avgRating >= 4.0) competitionScore += 8;

  if (adRatio > 30) competitionScore += 20;
  else if (adRatio > 15) competitionScore += 10;

  competitionScore = Math.min(100, competitionScore);
  const competitionLevel = competitionScore >= 70 ? "hard" : competitionScore >= 40 ? "medium" : "easy";

  return {
    keyword,
    statDate,
    totalItems,
    avgPrice,
    minPrice,
    maxPrice,
    avgRating,
    avgReview,
    totalReviewSum,
    medianReview,
    adCount,
    adRatio,
    rocketCount,
    rocketRatio,
    highReviewCount,
    newProductCount,
    reviewGrowth: Math.max(0, reviewGrowth),
    priceChange,
    itemCountChange,
    estimatedDailySales,
    salesScore,
    demandScore,
    competitionScore,
    competitionLevel,
    dataQualityScore,
    priceParseRate,
    ratingParseRate,
    reviewParseRate,
  };
}

// ============================================================
//  Watch Keyword 종합 점수 재계산
// ============================================================

/**
 * watch_keyword의 composite_score 재계산
 * = 검색빈도(30%) + 리뷰증가(30%) + 우선순위(20%) + 최근활성도(20%)
 */
export async function recomputeCompositeScore(
  userId: number,
  keywordId: number,
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const [kw] = await db.select()
    .from(extWatchKeywords)
    .where(and(
      eq(extWatchKeywords.id, keywordId),
      eq(extWatchKeywords.userId, userId),
    ))
    .limit(1);

  if (!kw) return 0;

  const now = nowKST();

  // 검색 빈도 점수 (최근 7일 검색 횟수)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [countResult] = await db.select({
    cnt: sql<number>`COUNT(*)`,
  })
    .from(extSearchEvents)
    .where(and(
      eq(extSearchEvents.userId, userId),
      eq(extSearchEvents.keyword, kw.keyword),
      gte(extSearchEvents.searchedAt, sevenDaysAgo.toISOString().slice(0, 19).replace("T", " ")),
    ));
  const recentSearches = N(countResult?.cnt);
  const frequencyScore = Math.min(30, recentSearches * 5); // 최대 30점

  // 리뷰 증가 점수
  const reviewGrowth = Math.max(N(kw.reviewGrowth1d), N(kw.reviewGrowth7d) / 7);
  let growthScore = 0;
  if (reviewGrowth >= 50) growthScore = 30;
  else if (reviewGrowth >= 20) growthScore = 22;
  else if (reviewGrowth >= 10) growthScore = 15;
  else if (reviewGrowth >= 5) growthScore = 10;
  else if (reviewGrowth > 0) growthScore = 5;

  // 우선순위 점수
  const priorityScore = Math.round(N(kw.priority) / 100 * 20);

  // 최근 활성도 점수
  let activityScore = 0;
  const lastSearch = kw.lastSearchedAt ? new Date(kw.lastSearchedAt) : null;
  if (lastSearch) {
    const daysSince = (now.getTime() - lastSearch.getTime()) / (24 * 60 * 60 * 1000);
    if (daysSince <= 1) activityScore = 20;
    else if (daysSince <= 3) activityScore = 15;
    else if (daysSince <= 7) activityScore = 10;
    else if (daysSince <= 14) activityScore = 5;
  }

  const composite = Math.min(100, frequencyScore + growthScore + priorityScore + activityScore);

  // 변동성 점수도 함께 업데이트
  const volScore = computeVolatilityScore(kw);
  const intervalHours = computeAdaptiveInterval(volScore, kw.createdAt);

  await db.update(extWatchKeywords)
    .set({
      compositeScore: composite,
      volatilityScore: volScore,
      adaptiveIntervalHours: intervalHours,
    })
    .where(eq(extWatchKeywords.id, keywordId));

  return composite;
}

// ============================================================
//  일일 배치 실행 (서버 트리거)
// ============================================================

/**
 * 일일 배치: 모든 활성 키워드의 일일 상태 계산
 * - 크롤링 NO! 이미 수집된 search_events를 기반으로 집계만 수행
 * - 전일 대비 변동 계산 (리뷰 증감, 가격 변동)
 * - watch_keywords 업데이트 + next_collect_at 적응형 갱신
 */
export async function runDailyBatch(
  userId: number,
  limit?: number,
  offset?: number,
  selectedKeywords?: string[],
): Promise<{
  processed: number;
  updated: number;
  errors: number;
  hasMore: boolean;
  total: number;
  results: Array<{ keyword: string; reviewGrowth: number; salesEstimate: number; error?: string }>;
}> {
  const db = await getDb();
  if (!db) return { processed: 0, updated: 0, errors: 0, hasMore: false, total: 0, results: [] };

  const now = nowKST();
  const today = now.toISOString().slice(0, 10);

  // 활성 키워드 가져오기
  let activeKeywords = await db.select()
    .from(extWatchKeywords)
    .where(and(
      eq(extWatchKeywords.userId, userId),
      eq(extWatchKeywords.isActive, true),
    ));

  // 선택된 키워드 필터 (유저가 특정 키워드만 선택한 경우)
  if (selectedKeywords && selectedKeywords.length > 0) {
    activeKeywords = activeKeywords.filter(kw => selectedKeywords.includes(kw.keyword));
  }

  const totalKeywords = activeKeywords.length;

  // 분할 배치: offset/limit 적용
  const batchOffset = offset || 0;
  const batchLimit = limit || activeKeywords.length;
  const batchKeywords = activeKeywords.slice(batchOffset, batchOffset + batchLimit);
  const hasMore = (batchOffset + batchLimit) < totalKeywords;

  let processed = 0, updated = 0, errors = 0;
  const results: Array<{ keyword: string; reviewGrowth: number; salesEstimate: number; error?: string }> = [];

  for (const kw of batchKeywords) {
    try {
      // 일일 집계 계산
      const agg = await computeDailyAggregation(userId, kw.keyword, today);
      if (!agg) {
        results.push({ keyword: kw.keyword, reviewGrowth: 0, salesEstimate: 0, error: "데이터 없음" });
        continue;
      }

      processed++;

      // ext_keyword_daily_status UPSERT
      const [existing] = await db.select({ id: extKeywordDailyStatus.id })
        .from(extKeywordDailyStatus)
        .where(and(
          eq(extKeywordDailyStatus.userId, userId),
          eq(extKeywordDailyStatus.keyword, kw.keyword),
          eq(extKeywordDailyStatus.statDate, today),
        ))
        .limit(1);

      const statusData = {
        totalItems: agg.totalItems,
        avgPrice: agg.avgPrice,
        minPrice: agg.minPrice,
        maxPrice: agg.maxPrice,
        avgRating: agg.avgRating.toFixed(1),
        avgReview: agg.avgReview,
        totalReviewSum: agg.totalReviewSum,
        medianReview: agg.medianReview,
        adCount: agg.adCount,
        adRatio: agg.adRatio.toFixed(2),
        rocketCount: agg.rocketCount,
        rocketRatio: agg.rocketRatio.toFixed(2),
        highReviewCount: agg.highReviewCount,
        newProductCount: agg.newProductCount,
        reviewGrowth: agg.reviewGrowth,
        priceChange: agg.priceChange,
        itemCountChange: agg.itemCountChange,
        estimatedDailySales: agg.estimatedDailySales,
        salesScore: agg.salesScore,
        demandScore: agg.demandScore,
        competitionScore: agg.competitionScore,
        competitionLevel: agg.competitionLevel,
        dataQualityScore: agg.dataQualityScore,
        priceParseRate: agg.priceParseRate,
        ratingParseRate: agg.ratingParseRate,
        reviewParseRate: agg.reviewParseRate,
      };

      if (existing) {
        await db.update(extKeywordDailyStatus)
          .set(statusData)
          .where(eq(extKeywordDailyStatus.id, existing.id));
      } else {
        try {
          await db.insert(extKeywordDailyStatus).values({
            userId,
            keyword: kw.keyword,
            statDate: today,
            source: "batch",
            ...statusData,
          });
        } catch (dupErr: any) {
          if (dupErr?.cause?.code === "ER_DUP_ENTRY" || dupErr?.code === "ER_DUP_ENTRY") {
            // Race condition: another request inserted first → update instead
            await db.update(extKeywordDailyStatus).set(statusData)
              .where(and(
                eq(extKeywordDailyStatus.userId, userId),
                eq(extKeywordDailyStatus.keyword, kw.keyword),
                eq(extKeywordDailyStatus.statDate, today),
              ));
          } else {
            throw dupErr;
          }
        }
      }

      // ★ v7.4.0: 7일 리뷰 증가 — 유효한 기준점 기반 계산
      // 7일 전~14일 전 사이에서 리뷰가 정상 파싱된 가장 가까운 날 찾기
      const weekBaseline = await db.select({
        statDate: extKeywordDailyStatus.statDate,
        totalReviewSum: extKeywordDailyStatus.totalReviewSum,
        totalItems: extKeywordDailyStatus.totalItems,
      })
        .from(extKeywordDailyStatus)
        .where(and(
          eq(extKeywordDailyStatus.userId, userId),
          eq(extKeywordDailyStatus.keyword, kw.keyword),
          sql`${extKeywordDailyStatus.statDate} >= DATE_SUB(${today}, INTERVAL 14 DAY)`,
          sql`${extKeywordDailyStatus.statDate} <= DATE_SUB(${today}, INTERVAL 5 DAY)`,
        ))
        .orderBy(desc(extKeywordDailyStatus.statDate))
        .limit(10);

      let reviewGrowth7d = 0;
      // 유효한 기준점: totalReviewSum > 0 (파싱 성공)
      const validWeekBase = weekBaseline.find(
        e => N(e.totalReviewSum) > 0,
      );
      if (validWeekBase && agg.totalReviewSum > 0) {
        const rawGrowth7d = agg.totalReviewSum - N(validWeekBase.totalReviewSum);
        reviewGrowth7d = Math.max(0, rawGrowth7d);
      }

      // 적응형 스케줄링: 변동성 점수 + 다음 수집 시각 계산
      const volScore = computeVolatilityScore({
        ...kw,
        reviewGrowth1d: agg.reviewGrowth,
        priceChange1d: agg.priceChange,
      });
      const intervalHours = computeAdaptiveInterval(volScore, kw.createdAt);
      const nextCollect = computeNextCollectAt(intervalHours);

      // watch_keyword 업데이트 (적응형 스케줄링 필드 포함)
      await db.update(extWatchKeywords)
        .set({
          latestTotalItems: agg.totalItems,
          latestAvgPrice: agg.avgPrice,
          latestAvgRating: agg.avgRating.toFixed(1),
          latestAvgReview: agg.avgReview,
          latestTotalReviewSum: agg.totalReviewSum,
          latestAdCount: agg.adCount,
          latestRocketCount: agg.rocketCount,
          reviewGrowth1d: agg.reviewGrowth,
          reviewGrowth7d: Math.max(0, reviewGrowth7d),
          priceChange1d: agg.priceChange,
          lastCollectedAt: toMySQLTimestamp(now),
          // 적응형 스케줄링
          volatilityScore: volScore,
          adaptiveIntervalHours: intervalHours,
          nextCollectAt: toMySQLTimestamp(nextCollect),
        })
        .where(eq(extWatchKeywords.id, kw.id));

      // composite_score 재계산
      await recomputeCompositeScore(userId, kw.id);

      updated++;
      results.push({
        keyword: kw.keyword,
        reviewGrowth: agg.reviewGrowth,
        salesEstimate: agg.estimatedDailySales,
      });

    } catch (err: any) {
      errors++;
      results.push({
        keyword: kw.keyword,
        reviewGrowth: 0,
        salesEstimate: 0,
        error: err?.message || "알 수 없는 오류",
      });
    }
  }

  return { processed, updated, errors, hasMore, total: totalKeywords, results };
}

// ============================================================
//  ext_watch_keywords → keyword_master 동기화
// ============================================================

/**
 * 배치 수집 완료 후 ext_watch_keywords의 키워드를
 * keyword_master 테이블에 동기화하여 니치파인더에서 볼 수 있게 함.
 *
 * 1. keywordMasterId가 NULL인 ext_watch_keywords 조회
 * 2. keyword_master에 없으면 INSERT (sourceType: "extension")
 * 3. ext_watch_keywords.keywordMasterId 업데이트
 * 4. 쿠팡 데이터(ext_keyword_daily_status)를 keyword_daily_metrics에 반영
 */
export async function syncWatchKeywordsToMaster(userId: number): Promise<{
  synced: number;
  metricsCreated: number;
  errors: number;
}> {
  const db = await getDb();
  if (!db) return { synced: 0, metricsCreated: 0, errors: 0 };

  const now = nowKST();
  const today = now.toISOString().slice(0, 10);

  // keywordMasterId가 없는 감시 키워드 조회
  const unlinked = await db.select()
    .from(extWatchKeywords)
    .where(and(
      eq(extWatchKeywords.userId, userId),
      eq(extWatchKeywords.isActive, true),
      isNull(extWatchKeywords.keywordMasterId),
    ));

  let synced = 0, metricsCreated = 0, errors = 0;

  for (const wk of unlinked) {
    try {
      const normalized = normalizeKeyword(wk.keyword);
      if (!normalized) continue;

      // keyword_master에서 이미 존재하는지 확인
      const [existing] = await db.select({ id: keywordMaster.id })
        .from(keywordMaster)
        .where(and(
          eq(keywordMaster.userId, userId),
          eq(keywordMaster.normalizedKeyword, normalized),
        ))
        .limit(1);

      let masterId: number;

      if (existing) {
        masterId = existing.id;
      } else {
        // keyword_master에 새로 등록
        const [inserted] = await db.insert(keywordMaster).values({
          userId,
          keyword: wk.keyword,
          normalizedKeyword: normalized,
          sourceType: "extension",
          validationStatus: "pending",
          validationPriority: 50,
        }).$returningId();
        masterId = inserted.id;
      }

      // ext_watch_keywords에 연결
      await db.update(extWatchKeywords)
        .set({ keywordMasterId: masterId })
        .where(eq(extWatchKeywords.id, wk.id));

      synced++;

      // 쿠팡 데이터가 있으면 keyword_daily_metrics에도 반영
      const [dailyStatus] = await db.select()
        .from(extKeywordDailyStatus)
        .where(and(
          eq(extKeywordDailyStatus.userId, userId),
          eq(extKeywordDailyStatus.keyword, wk.keyword),
        ))
        .orderBy(desc(extKeywordDailyStatus.statDate))
        .limit(1);

      if (dailyStatus) {
        const [existingMetric] = await db.select({ id: keywordDailyMetrics.id })
          .from(keywordDailyMetrics)
          .where(and(
            eq(keywordDailyMetrics.userId, userId),
            eq(keywordDailyMetrics.keywordId, masterId),
            eq(keywordDailyMetrics.metricDate, today),
          ))
          .limit(1);

        const metricData = {
          coupangProductCount: N(dailyStatus.totalItems),
          coupangAvgPrice: N(dailyStatus.avgPrice),
          coupangTop10ReviewSum: N(dailyStatus.totalReviewSum),
          coupangTop10ReviewDelta: N(dailyStatus.reviewGrowth),
        };

        if (existingMetric) {
          await db.update(keywordDailyMetrics)
            .set(metricData)
            .where(eq(keywordDailyMetrics.id, existingMetric.id));
        } else {
          await db.insert(keywordDailyMetrics).values({
            userId,
            keywordId: masterId,
            metricDate: today,
            ...metricData,
          });
        }
        metricsCreated++;
      }
    } catch (err: any) {
      console.error(`[syncWatchToMaster] 에러 (${wk.keyword}):`, err.message);
      errors++;
    }
  }

  // 이미 keywordMasterId가 있는 감시 키워드도 쿠팡 데이터 갱신
  const linked = await db.select()
    .from(extWatchKeywords)
    .where(and(
      eq(extWatchKeywords.userId, userId),
      eq(extWatchKeywords.isActive, true),
      sql`${extWatchKeywords.keywordMasterId} IS NOT NULL`,
    ));

  for (const wk of linked) {
    try {
      const [dailyStatus] = await db.select()
        .from(extKeywordDailyStatus)
        .where(and(
          eq(extKeywordDailyStatus.userId, userId),
          eq(extKeywordDailyStatus.keyword, wk.keyword),
        ))
        .orderBy(desc(extKeywordDailyStatus.statDate))
        .limit(1);

      if (!dailyStatus || !wk.keywordMasterId) continue;

      const [existingMetric] = await db.select({ id: keywordDailyMetrics.id })
        .from(keywordDailyMetrics)
        .where(and(
          eq(keywordDailyMetrics.userId, userId),
          eq(keywordDailyMetrics.keywordId, wk.keywordMasterId),
          eq(keywordDailyMetrics.metricDate, today),
        ))
        .limit(1);

      const metricData = {
        coupangProductCount: N(dailyStatus.totalItems),
        coupangAvgPrice: N(dailyStatus.avgPrice),
        coupangTop10ReviewSum: N(dailyStatus.totalReviewSum),
        coupangTop10ReviewDelta: N(dailyStatus.reviewGrowth),
      };

      if (existingMetric) {
        await db.update(keywordDailyMetrics)
          .set(metricData)
          .where(eq(keywordDailyMetrics.id, existingMetric.id));
      } else {
        await db.insert(keywordDailyMetrics).values({
          userId,
          keywordId: wk.keywordMasterId,
          metricDate: today,
          ...metricData,
        });
      }
      metricsCreated++;
    } catch (err: any) {
      console.error(`[syncWatchToMaster] 쿠팡 데이터 갱신 에러 (${wk.keyword}):`, err.message);
      errors++;
    }
  }

  console.log(`[syncWatchToMaster] 완료: synced=${synced}, metrics=${metricsCreated}, errors=${errors}`);
  return { synced, metricsCreated, errors };
}

// ============================================================
//  유틸리티
// ============================================================

/** YYYY-MM-DD → 전일 YYYY-MM-DD */
function getPrevDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD → N일 전 YYYY-MM-DD */
function getPrevDateN(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * 검색 이벤트에서 개별 상품 파싱 품질 진단
 * 반환: 어떤 필드가 누락/부정확한지 상세 리포트
 */
export function diagnoseParsingQuality(items: any[]): {
  totalItems: number;
  priceOk: number;
  ratingOk: number;
  reviewOk: number;
  priceRate: number;
  ratingRate: number;
  reviewRate: number;
  overallScore: number;
  issues: string[];
} {
  const totalItems = items.length;
  if (!totalItems) {
    return {
      totalItems: 0, priceOk: 0, ratingOk: 0, reviewOk: 0,
      priceRate: 0, ratingRate: 0, reviewRate: 0,
      overallScore: 0, issues: ["상품 데이터 없음"],
    };
  }

  const priceOk = items.filter((i: any) => N(i.price) > 0).length;
  const ratingOk = items.filter((i: any) => N(i.rating) > 0 && N(i.rating) <= 5).length;
  const reviewOk = items.filter((i: any) => N(i.reviewCount) >= 0).length; // 0도 유효 (신상품)

  const priceRate = Math.round(priceOk / totalItems * 100);
  const ratingRate = Math.round(ratingOk / totalItems * 100);
  const reviewRate = Math.round(reviewOk / totalItems * 100);
  const overallScore = Math.round((priceRate + ratingRate + reviewRate) / 3);

  const issues: string[] = [];
  if (priceRate < 80) issues.push(`가격 파싱률 저조: ${priceRate}%`);
  if (ratingRate < 60) issues.push(`평점 파싱률 저조: ${ratingRate}% — DOM 변경 확인 필요`);
  if (reviewRate < 80) issues.push(`리뷰수 파싱률 저조: ${reviewRate}%`);

  // 이상치 검출
  const prices = items.map((i: any) => N(i.price)).filter((p: number) => p > 0);
  if (prices.length >= 2) {
    const avgP = prices.reduce((a: number, b: number) => a + b, 0) / prices.length;
    const outliers = prices.filter((p: number) => p > avgP * 5 || p < avgP * 0.1);
    if (outliers.length > 0) {
      issues.push(`가격 이상치 ${outliers.length}개 감지 (평균 대비 5배 이상/0.1배 이하)`);
    }
  }

  const ratings = items.map((i: any) => N(i.rating)).filter((r: number) => r > 0);
  const estimatedRatings = ratings.filter((r: number) => r === 4.0 || r === 4.5);
  if (estimatedRatings.length > ratings.length * 0.5 && ratings.length > 5) {
    issues.push(`평점 추정값 비율 높음 (${Math.round(estimatedRatings.length / ratings.length * 100)}%) — DOM 파싱 개선 필요`);
  }

  return { totalItems, priceOk, ratingOk, reviewOk, priceRate, ratingRate, reviewRate, overallScore, issues };
}

// ============================================================
//  키워드 유사도/중복 감지 유틸 (v7.3.2)
// ============================================================

/**
 * 키워드 정규화: 공백/특수문자 제거 + 소문자
 * "오트밀 국수" → "오트밀국수"
 */
export function normalizeKeyword(keyword: string): string {
  return keyword
    .trim()
    .replace(/\s+/g, '')
    .replace(/[·,.\-_\/\\]+/g, '')
    .toLowerCase();
}

/**
 * 두 키워드의 유사도 계산 (자카드 유사도 + 포함 관계)
 */
export function keywordSimilarity(a: string, b: string): number {
  const na = normalizeKeyword(a);
  const nb = normalizeKeyword(b);
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) {
    const shorter = Math.min(na.length, nb.length);
    const longer = Math.max(na.length, nb.length);
    return shorter / longer;
  }
  const bigramsA = new Set<string>();
  const bigramsB = new Set<string>();
  for (let i = 0; i < na.length - 1; i++) bigramsA.add(na.slice(i, i + 2));
  for (let i = 0; i < nb.length - 1; i++) bigramsB.add(nb.slice(i, i + 2));
  let intersection = 0;
  for (const bg of bigramsA) { if (bigramsB.has(bg)) intersection++; }
  const union = bigramsA.size + bigramsB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * 키워드 목록에서 중복 그룹 감지
 */
export function detectDuplicateKeywords(
  keywords: string[],
  threshold: number = 0.85,
): Array<{ group: string[]; normalized: string }> {
  const groups: Array<{ group: string[]; normalized: string }> = [];
  const assigned = new Set<number>();
  for (let i = 0; i < keywords.length; i++) {
    if (assigned.has(i)) continue;
    const group = [keywords[i]];
    assigned.add(i);
    for (let j = i + 1; j < keywords.length; j++) {
      if (assigned.has(j)) continue;
      const sim = keywordSimilarity(keywords[i], keywords[j]);
      if (sim >= threshold) { group.push(keywords[j]); assigned.add(j); }
    }
    if (group.length > 1) {
      groups.push({ group, normalized: normalizeKeyword(group[0]) });
    }
  }
  return groups;
}
