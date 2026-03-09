/**
 * ============================================================
 * Hybrid Data Collection — Batch Collector Engine
 * ============================================================
 *
 * 서버 사이드 배치 수집 엔진
 * - 크롤링 NO! 사용자가 수집한 데이터를 기반으로 일일 집계/분석만 수행
 * - 배치 우선순위 기반 키워드 선택
 * - 리뷰 증감, 순위 변동, 판매량 추정 계산
 *
 * 배치 우선순위 규칙:
 * 1. 최근 3일 내 검색된 키워드
 * 2. 종합 점수(composite_score) 높은 키워드
 * 3. 리뷰 증가가 감지된 키워드
 * 4. 오래 수집되지 않은 키워드
 */

import { getDb } from "./db";
import {
  extSearchEvents, extWatchKeywords, extKeywordDailyStatus,
  extSearchSnapshots, extKeywordDailyStats,
} from "../drizzle/schema";
import { eq, and, desc, sql, gte, lt, asc, ne } from "drizzle-orm";

/** Drizzle-ORM decimal/SUM 결과 → number 변환 */
function N(v: any): number { return Number(v) || 0; }

// ============================================================
//  타입 정의
// ============================================================

export interface BatchKeywordSelection {
  id: number;
  keyword: string;
  priority: number;
  lastSearchedAt: string | null;
  lastCollectedAt: string | null;
  totalSearchCount: number;
  compositeScore: number;
  selectionReason: string;
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
  // 전일 대비 변동
  reviewGrowth: number;
  priceChange: number;
  itemCountChange: number;
  // 판매량 추정
  estimatedDailySales: number;
  salesScore: number;
  demandScore: number;
  // 경쟁도
  competitionScore: number;
  competitionLevel: string;
  // 품질
  dataQualityScore: number;
  priceParseRate: number;
  ratingParseRate: number;
  reviewParseRate: number;
}

// ============================================================
//  배치 키워드 선택 (우선순위 기반)
// ============================================================

/**
 * 배치 수집 대상 키워드를 우선순위에 따라 선택
 * SQL 기반 배치 선택: LIMIT 20, ORDER BY 최근 검색 > 우선순위 > 마지막 수집
 */
export async function selectBatchKeywords(
  userId: number,
  limit: number = 20
): Promise<BatchKeywordSelection[]> {
  const db = await getDb();
  if (!db) return [];

  const now = new Date();
  now.setHours(now.getHours() + 9); // KST
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

  // 배치 우선순위 SQL
  // 1순위: 최근 3일 내 사용자가 검색한 키워드
  // 2순위: composite_score 높은 키워드
  // 3순위: 리뷰 증가 감지 키워드 (review_growth_1d > 0)
  // 4순위: 오래 수집되지 않은 키워드 (last_collected_at ASC)
  const keywords = await db.select({
    id: extWatchKeywords.id,
    keyword: extWatchKeywords.keyword,
    priority: extWatchKeywords.priority,
    lastSearchedAt: extWatchKeywords.lastSearchedAt,
    lastCollectedAt: extWatchKeywords.lastCollectedAt,
    totalSearchCount: extWatchKeywords.totalSearchCount,
    compositeScore: extWatchKeywords.compositeScore,
    reviewGrowth1d: extWatchKeywords.reviewGrowth1d,
    lastUserViewAt: extWatchKeywords.lastUserViewAt,
  })
    .from(extWatchKeywords)
    .where(and(
      eq(extWatchKeywords.userId, userId),
      eq(extWatchKeywords.isActive, true),
    ))
    .orderBy(
      // 최근 사용자 조회 우선
      desc(extWatchKeywords.lastUserViewAt),
      // 우선순위 높은 순
      desc(extWatchKeywords.priority),
      // 마지막 수집이 오래된 순
      asc(extWatchKeywords.lastCollectedAt),
    )
    .limit(limit);

  return keywords.map(k => {
    let reason = '';
    const lastSearch = k.lastSearchedAt ? new Date(k.lastSearchedAt) : null;

    if (lastSearch && lastSearch >= threeDaysAgo) {
      reason = '최근_3일_검색';
    } else if (N(k.compositeScore) >= 70) {
      reason = '높은_종합점수';
    } else if (N(k.reviewGrowth1d) > 0) {
      reason = '리뷰_증가_감지';
    } else {
      reason = '정기_수집';
    }

    return {
      id: k.id,
      keyword: k.keyword,
      priority: N(k.priority),
      lastSearchedAt: k.lastSearchedAt,
      lastCollectedAt: k.lastCollectedAt,
      totalSearchCount: N(k.totalSearchCount),
      compositeScore: N(k.compositeScore),
      selectionReason: reason,
    };
  });
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
  const prices = items.map((i: any) => N(i.price)).filter((p: number) => p > 0);
  const ratings = items.map((i: any) => N(i.rating)).filter((r: number) => r > 0);
  const reviews = items.map((i: any) => N(i.reviewCount)).filter((r: number) => r > 0);

  const avgPrice = prices.length ? Math.round(prices.reduce((a: number, b: number) => a + b, 0) / prices.length) : 0;
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;
  const avgRating = ratings.length ? +(ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length).toFixed(1) : 0;
  const avgReview = reviews.length ? Math.round(reviews.reduce((a: number, b: number) => a + b, 0) / reviews.length) : 0;
  const totalReviewSum = reviews.reduce((a: number, b: number) => a + b, 0);

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

  // 전일 데이터 가져오기 (변동 계산용)
  const prevDate = getPrevDate(statDate);
  const [prevStatus] = await db.select()
    .from(extKeywordDailyStatus)
    .where(and(
      eq(extKeywordDailyStatus.userId, userId),
      eq(extKeywordDailyStatus.keyword, keyword),
      eq(extKeywordDailyStatus.statDate, prevDate),
    ))
    .limit(1);

  const reviewGrowth = prevStatus ? totalReviewSum - N(prevStatus.totalReviewSum) : 0;
  const priceChange = prevStatus ? avgPrice - N(prevStatus.avgPrice) : 0;
  const itemCountChange = prevStatus ? totalItems - N(prevStatus.totalItems) : 0;

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
  const competitionLevel = competitionScore >= 70 ? 'hard' : competitionScore >= 40 ? 'medium' : 'easy';

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
    reviewGrowth: Math.max(0, reviewGrowth), // 음수는 0 처리
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

  const now = new Date();
  now.setHours(now.getHours() + 9);

  // 검색 빈도 점수 (최근 7일 검색 횟수)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [countResult] = await db.select({
    cnt: sql<number>`COUNT(*)`,
  })
    .from(extSearchEvents)
    .where(and(
      eq(extSearchEvents.userId, userId),
      eq(extSearchEvents.keyword, kw.keyword),
      gte(extSearchEvents.searchedAt, sevenDaysAgo.toISOString().slice(0, 19).replace('T', ' ')),
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

  await db.update(extWatchKeywords)
    .set({ compositeScore: composite })
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
 * - watch_keywords 업데이트
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

  const now = new Date();
  now.setHours(now.getHours() + 9);
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
        results.push({ keyword: kw.keyword, reviewGrowth: 0, salesEstimate: 0, error: '데이터 없음' });
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
        await db.insert(extKeywordDailyStatus).values({
          userId,
          keyword: kw.keyword,
          statDate: today,
          source: "batch",
          ...statusData,
        });
      }

      // 7일 리뷰 증가 계산
      const sevenDaysAgo = getPrevDateN(today, 7);
      const [weekAgoStatus] = await db.select({
        totalReviewSum: extKeywordDailyStatus.totalReviewSum,
      })
        .from(extKeywordDailyStatus)
        .where(and(
          eq(extKeywordDailyStatus.userId, userId),
          eq(extKeywordDailyStatus.keyword, kw.keyword),
          eq(extKeywordDailyStatus.statDate, sevenDaysAgo),
        ))
        .limit(1);

      const reviewGrowth7d = weekAgoStatus
        ? agg.totalReviewSum - N(weekAgoStatus.totalReviewSum)
        : 0;

      // watch_keyword 업데이트
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
          lastCollectedAt: now.toISOString().slice(0, 19).replace('T', ' '),
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
        error: err?.message || '알 수 없는 오류',
      });
    }
  }

  return { processed, updated, errors, hasMore, total: totalKeywords, results };
}

// ============================================================
//  유틸리티
// ============================================================

/** YYYY-MM-DD → 전일 YYYY-MM-DD */
function getPrevDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD → N일 전 YYYY-MM-DD */
function getPrevDateN(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
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
      overallScore: 0, issues: ['상품 데이터 없음'],
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
