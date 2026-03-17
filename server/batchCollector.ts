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
  keywordSearchVolumeHistory,
  extBatchState,
} from "../drizzle/schema";
import { getNaverKeywords, isNaverKeywordMatch, normalizeNaverKeyword, findBestNaverMatch, generateKeywordVariants } from "./lib/naverAds";
import { eq, and, desc, sql, gte, lt, asc, ne, isNull, lte, or } from "drizzle-orm";
import { rebuildKeywordDailyStatsForKeyword } from "./lib/keywordDailyStatsService";
import {
  computeBaseProductCount,
  normalizeReviewSum as normalizeReviewSumFn,
  isValidSnapshot as isValidSnapshotFn,
  resolveReviewDelta as resolveReviewDeltaFn,
  computeFallbackDeltas as computeFallbackDeltasFn,
} from "./lib/reviewNormalization";

/** Drizzle-ORM decimal/SUM 결과 → number 변환 */
function N(v: any): number { return Number(v) || 0; }

/** KST 현재 시각
 * ⚠ 이 함수는 서버 TZ=Asia/Seoul 환경에서 동작.
 *   setHours(+9) → toISOString(UTC변환 -9) 상쇄로 결과적으로
 *   toMySQLTimestamp()와 slice(0,10)은 올바른 KST 값을 반환.
 *   서버 TZ가 UTC인 환경에서도 올바르게 동작함.
 */
function nowKST(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 9);
  return d;
}

/** KST 오늘 날짜 (YYYY-MM-DD) — TZ-safe */
function todayKST(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
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
  isPinned: boolean;
  lastSearchedAt: string | null;
  lastCollectedAt: string | null;
  nextCollectAt: string | null;
  totalSearchCount: number;
  compositeScore: number;
  volatilityScore: number;
  adaptiveIntervalHours: number | null;
  selectionReason: string;
  tier: "pin" | "new" | "regular";
}

export interface AdaptiveBatchResult {
  keywords: BatchKeywordSelection[];
  delayConfig: HumanDelayConfig;
  totalActive: number;
  totalOverdue: number;
  /** 일일 수집 현황 */
  dailyStats: {
    collectedToday: number;
    dailyLimit: number;
    remainingToday: number;
    roundsToday: number;
    maxRoundsPerDay: number;
    currentGroupTurn: number;
  };
  /** 세션 상한 */
  sessionLimits: {
    maxKeywords: number;
    maxMinutes: number;
  };
}

// ============================================================
//  배치 수집 v2 상수
// ============================================================

/** 1회 배치 최대 키워드 수 */
const BATCH_PER_ROUND_LIMIT = 100;
/** 1일 최대 수집 키워드 수 */
const DAILY_COLLECT_LIMIT = 500;
/** 1일 최대 배치 회차 */
const MAX_ROUNDS_PER_DAY = 5;
/** 회차 간 최소 간격 (시간) */
const MIN_ROUND_INTERVAL_HOURS = 2;
/** 세션 최대 키워드 수 */
const SESSION_MAX_KEYWORDS = 100;
/** 세션 최대 시간 (분) */
const SESSION_MAX_MINUTES = 80;
/** 신규 키워드 안정화 기간 (일) */
const NEW_KEYWORD_STABILIZATION_DAYS = 7;
/** 라운드로빈 그룹 수 */
const ROUND_ROBIN_GROUP_COUNT = 5;

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
  // ★ v7.5.0: 정규화 엔진 필드
  baseProductCount: number;
  normalizedReviewSum: number;
  coverageRatio: number;
  reviewDeltaObserved: number;
  reviewDeltaUsed: number;
  salesEstimateMa7: number;
  salesEstimateMa30: number;
  isProvisional: boolean;
  provisionalReason: string | null;
  dataStatus: string;
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
 * | 시나리오                | 점수    | 주기        |
 * |------------------------|---------|------------|
 * | 🔥 급변                | ≥80     | 8시간       |
 * | 🆕 신규 (7일 안정화)    | any     | 12~24시간   |
 * | 📊 높은 변동            | 60~79   | 24시간      |
 * | 📊 중간 변동            | 40~59   | 48시간      |
 * | 😴 낮은 변동            | 20~39   | 72시간      |
 * | 💤 안정                | <20     | 120시간     |
 */
function computeAdaptiveInterval(
  volatilityScore: number,
  createdAt: string | null,
): number {
  const now = nowKST();

  // 신규 키워드 안정화 기간 (등록 7일 이내) — 자주 수집하여 기초 데이터 축적
  if (createdAt) {
    const created = new Date(createdAt);
    const daysSinceCreation = (now.getTime() - created.getTime()) / (24 * 3600 * 1000);
    if (daysSinceCreation <= NEW_KEYWORD_STABILIZATION_DAYS) {
      // 신규 3일 이내: 더 자주
      if (daysSinceCreation <= 3) {
        return volatilityScore >= 60 ? 12 : 18;
      }
      // 신규 4~7일: 점진적 완화
      return volatilityScore >= 60 ? 18 : 24;
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
 * 배치 수집 상태 조회/생성 (라운드로빈 이월 + 일일 카운트)
 * - 날짜가 바뀌면 카운트만 리셋, groupTurn은 이월
 */
async function getOrCreateBatchState(db: any, userId: number, todayStr: string) {
  const [existing] = await db.select()
    .from(extBatchState)
    .where(eq(extBatchState.userId, userId))
    .limit(1);

  if (!existing) {
    await db.insert(extBatchState).values({
      userId,
      currentGroupTurn: 0,
      totalCollectedToday: 0,
      roundsToday: 0,
      stateDate: todayStr,
    });
    return { currentGroupTurn: 0, totalCollectedToday: 0, roundsToday: 0, lastBatchCompletedAt: null };
  }

  // 날짜가 바뀌면 카운트만 리셋 (groupTurn은 이월!)
  if (existing.stateDate !== todayStr) {
    await db.update(extBatchState)
      .set({
        totalCollectedToday: 0,
        roundsToday: 0,
        stateDate: todayStr,
      })
      .where(eq(extBatchState.id, existing.id));
    return { currentGroupTurn: existing.currentGroupTurn, totalCollectedToday: 0, roundsToday: 0, lastBatchCompletedAt: existing.lastBatchCompletedAt };
  }

  return existing;
}

/**
 * 배치 완료 시 상태 업데이트 (그룹 턴 전진 + 카운트 증가)
 */
export async function advanceBatchState(
  userId: number,
  collectedCount: number,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const now = nowKST();
  const todayStr = todayKST();
  const state = await getOrCreateBatchState(db, userId, todayStr);

  const nextTurn = (state.currentGroupTurn + 1) % ROUND_ROBIN_GROUP_COUNT;
  await db.update(extBatchState)
    .set({
      currentGroupTurn: nextTurn,
      totalCollectedToday: state.totalCollectedToday + collectedCount,
      roundsToday: state.roundsToday + 1,
      lastBatchCompletedAt: toMySQLTimestamp(now),
      stateDate: todayStr,
    })
    .where(eq(extBatchState.userId, userId));
}

/**
 * 배치 수집 v2 — 3-티어 적응형 키워드 선택
 *
 * 티어 1: 핀(Pin) 키워드 → nextCollectAt 기반 (12시간 주기)
 * 티어 2: 신규 키워드 (등록 7일 이내) → nextCollectAt 기반
 * 티어 3: 일반 키워드 → 해시 그룹 라운드로빈 + overdue 정렬
 *
 * 제외 조건 (모든 티어 공통):
 * - now < nextCollectAt → 아직 만기 아님 → 제외
 * - isActive = false
 * - 2회차+: 오늘 유효 데이터가 이미 존재하는 키워드 자동 제외
 * - 일일 상한(500개) / 회차 상한(5회) 초과
 * - 회차 간 최소 간격(2시간) 미충족
 *
 * 이월(carryover): 그룹 턴은 날짜가 바뀌어도 리셋되지 않음
 */
export async function selectBatchKeywords(
  userId: number,
  limit: number = BATCH_PER_ROUND_LIMIT,
  options?: { skipIntervalCheck?: boolean },
): Promise<AdaptiveBatchResult> {
  const db = await getDb();
  const emptyResult: AdaptiveBatchResult = {
    keywords: [],
    delayConfig: generateDelayConfig(0),
    totalActive: 0,
    totalOverdue: 0,
    dailyStats: {
      collectedToday: 0, dailyLimit: DAILY_COLLECT_LIMIT,
      remainingToday: DAILY_COLLECT_LIMIT, roundsToday: 0,
      maxRoundsPerDay: MAX_ROUNDS_PER_DAY, currentGroupTurn: 0,
    },
    sessionLimits: { maxKeywords: SESSION_MAX_KEYWORDS, maxMinutes: SESSION_MAX_MINUTES },
  };
  if (!db) return emptyResult;

  const now = nowKST();
  const nowStr = toMySQLTimestamp(now);
  const todayStr = todayKST(); // TZ-safe KST 날짜

  // ── 1. 배치 상태 조회 (이월 포함) ──
  const batchState = await getOrCreateBatchState(db, userId, todayStr);
  const { currentGroupTurn, totalCollectedToday, roundsToday, lastBatchCompletedAt } = batchState;

  // 일일 상한 체크
  const remainingToday = Math.max(0, DAILY_COLLECT_LIMIT - totalCollectedToday);
  if (remainingToday <= 0) {
    return {
      ...emptyResult,
      dailyStats: {
        collectedToday: totalCollectedToday, dailyLimit: DAILY_COLLECT_LIMIT,
        remainingToday: 0, roundsToday, maxRoundsPerDay: MAX_ROUNDS_PER_DAY,
        currentGroupTurn,
      },
      sessionLimits: { maxKeywords: SESSION_MAX_KEYWORDS, maxMinutes: SESSION_MAX_MINUTES },
    };
  }

  // 회차 상한 체크
  if (roundsToday >= MAX_ROUNDS_PER_DAY) {
    return {
      ...emptyResult,
      dailyStats: {
        collectedToday: totalCollectedToday, dailyLimit: DAILY_COLLECT_LIMIT,
        remainingToday, roundsToday, maxRoundsPerDay: MAX_ROUNDS_PER_DAY,
        currentGroupTurn,
      },
      sessionLimits: { maxKeywords: SESSION_MAX_KEYWORDS, maxMinutes: SESSION_MAX_MINUTES },
    };
  }

  // 회차 간 최소 간격 체크 (예약 자동수집 다회차 시 skipIntervalCheck로 우회)
  if (lastBatchCompletedAt && !options?.skipIntervalCheck) {
    const lastBatch = new Date(lastBatchCompletedAt);
    const hoursSinceLast = (now.getTime() - lastBatch.getTime()) / (3600 * 1000);
    if (hoursSinceLast < MIN_ROUND_INTERVAL_HOURS) {
      return {
        ...emptyResult,
        dailyStats: {
          collectedToday: totalCollectedToday, dailyLimit: DAILY_COLLECT_LIMIT,
          remainingToday, roundsToday, maxRoundsPerDay: MAX_ROUNDS_PER_DAY,
          currentGroupTurn,
        },
        sessionLimits: { maxKeywords: SESSION_MAX_KEYWORDS, maxMinutes: SESSION_MAX_MINUTES },
      };
    }
  }

  const effectiveLimit = Math.min(limit, remainingToday, BATCH_PER_ROUND_LIMIT, SESSION_MAX_KEYWORDS);

  // ── 2. 전체 활성 키워드 수 ──
  const [{ cnt: totalActive }] = await db.select({
    cnt: sql<number>`COUNT(*)`,
  })
    .from(extWatchKeywords)
    .where(and(
      eq(extWatchKeywords.userId, userId),
      eq(extWatchKeywords.isActive, true),
    ));

  // ── 3. 오늘 이미 수집된 키워드 목록 (자동 제외용) ──
  // ★ race condition 방지: roundsToday 무관하게 항상 체크
  //   autoCollectComplete가 아직 처리 중이라 roundsToday 미증가 상태에서도
  //   lastCollectedAt 기반으로 이미 수집된 키워드를 확실히 제외
  const todayCollectedKeywords: Set<string> = new Set();
  const todayStartStr = todayStr + " 00:00:00";

  // 방법 1: lastCollectedAt 기반 (markKeywordCollected가 수집 중 실시간 갱신)
  const collectedRows = await db.select({
    keyword: extWatchKeywords.keyword,
  })
    .from(extWatchKeywords)
    .where(and(
      eq(extWatchKeywords.userId, userId),
      eq(extWatchKeywords.isActive, true),
      gte(extWatchKeywords.lastCollectedAt, todayStartStr),
    ));
  for (const r of collectedRows) todayCollectedKeywords.add(r.keyword);

  // 방법 2: ext_search_snapshots 기반 (실제 크롤링 데이터가 저장된 키워드)
  // ★ v8.5.6: events 대신 snapshots 기준으로 통일 (events만 있고 snapshot 실패 시 미수집 처리)
  const snapshotRows = await db.select({
    keyword: extSearchSnapshots.query,
  })
    .from(extSearchSnapshots)
    .where(and(
      eq(extSearchSnapshots.userId, userId),
      gte(extSearchSnapshots.createdAt, todayStartStr),
    ))
    .groupBy(extSearchSnapshots.query);
  for (const r of snapshotRows) todayCollectedKeywords.add(r.keyword);

  // 방법 3: ext_keyword_daily_stats 기반 (runDailyBatch가 통계 생성 시)
  const validRows = await db.select({
    keyword: extKeywordDailyStats.query,
  })
    .from(extKeywordDailyStats)
    .where(and(
      eq(extKeywordDailyStats.userId, userId),
      eq(extKeywordDailyStats.statDate, todayStr),
    ));
  for (const r of validRows) todayCollectedKeywords.add(r.keyword);

  // ── 공통 select 필드 ──
  const selectFields = {
    id: extWatchKeywords.id,
    keyword: extWatchKeywords.keyword,
    priority: extWatchKeywords.priority,
    isPinned: extWatchKeywords.isPinned,
    pinOrder: extWatchKeywords.pinOrder,
    groupNo: extWatchKeywords.groupNo,
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
  };

  // ── nextCollectAt 기반 만기 조건 (모든 티어 공통) ──
  const dueCondition = or(
    isNull(extWatchKeywords.nextCollectAt),
    lte(extWatchKeywords.nextCollectAt, nowStr),
  );

  // ── 티어 1: 핀 키워드 (nextCollectAt 만기 기준) ──
  const pinnedKeywords = await db.select(selectFields)
    .from(extWatchKeywords)
    .where(and(
      eq(extWatchKeywords.userId, userId),
      eq(extWatchKeywords.isActive, true),
      eq(extWatchKeywords.isPinned, true),
      dueCondition,
    ))
    .orderBy(
      asc(extWatchKeywords.pinOrder),
      asc(extWatchKeywords.lastCollectedAt),
    );

  // ── 티어 2: 신규 키워드 (등록 7일 이내, nextCollectAt 만기) ──
  const sevenDaysAgo = new Date(now.getTime() - NEW_KEYWORD_STABILIZATION_DAYS * 24 * 3600 * 1000);
  const sevenDaysAgoStr = toMySQLTimestamp(sevenDaysAgo);

  const newKeywords = await db.select(selectFields)
    .from(extWatchKeywords)
    .where(and(
      eq(extWatchKeywords.userId, userId),
      eq(extWatchKeywords.isActive, true),
      eq(extWatchKeywords.isPinned, false),
      gte(extWatchKeywords.createdAt, sevenDaysAgoStr),
      dueCondition,
    ))
    .orderBy(
      asc(extWatchKeywords.lastCollectedAt),
      desc(extWatchKeywords.compositeScore),
    );

  // ── 티어 3: 일반 키워드 (해시 그룹 라운드로빈 + overdue 정렬) ──
  // 현재 그룹 턴부터 시작하여 모든 그룹을 순회
  const regularKeywords = await db.select(selectFields)
    .from(extWatchKeywords)
    .where(and(
      eq(extWatchKeywords.userId, userId),
      eq(extWatchKeywords.isActive, true),
      eq(extWatchKeywords.isPinned, false),
      lt(extWatchKeywords.createdAt, sevenDaysAgoStr),
      dueCondition,
    ))
    .orderBy(
      // 현재 그룹 턴에 해당하는 키워드를 먼저 (SQL로 그룹 우선순위)
      sql`CASE WHEN ${extWatchKeywords.groupNo} = ${currentGroupTurn} THEN 0
               WHEN ${extWatchKeywords.groupNo} = ${(currentGroupTurn + 1) % ROUND_ROBIN_GROUP_COUNT} THEN 1
               WHEN ${extWatchKeywords.groupNo} = ${(currentGroupTurn + 2) % ROUND_ROBIN_GROUP_COUNT} THEN 2
               WHEN ${extWatchKeywords.groupNo} = ${(currentGroupTurn + 3) % ROUND_ROBIN_GROUP_COUNT} THEN 3
               ELSE 4 END`,
      // overdue 큰 순 (오래된 만기일 먼저)
      asc(extWatchKeywords.nextCollectAt),
      // 마지막 수집 오래된 순
      asc(extWatchKeywords.lastCollectedAt),
      // 우선순위 높은 순
      desc(extWatchKeywords.priority),
    );

  // ── 3-티어 병합 + 제외 처리 ──
  const result: BatchKeywordSelection[] = [];
  const seenKeywords = new Set<string>();

  const processKeyword = (
    k: typeof pinnedKeywords[number],
    tier: "pin" | "new" | "regular",
  ): BatchKeywordSelection | null => {
    if (seenKeywords.has(k.keyword)) return null;

    // 오늘 이미 수집된 키워드 제외 (lastCollectedAt + daily_stats 이중 체크)
    // ★ roundsToday 무관 — race condition 방지
    if (todayCollectedKeywords.has(k.keyword)) {
      return null;
    }

    seenKeywords.add(k.keyword);

    const volScore = computeVolatilityScore(k);
    const intervalHours = computeAdaptiveInterval(volScore, k.createdAt);

    let reason = "";
    if (tier === "pin") {
      reason = "핀_키워드";
    } else if (tier === "new") {
      reason = "신규_안정화";
    } else if (!k.nextCollectAt) {
      reason = "미스케줄링_초기수집";
    } else if (!k.lastCollectedAt) {
      reason = "미수집_키워드";
    } else {
      const lastSearch = k.lastSearchedAt ? new Date(k.lastSearchedAt) : null;
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 3600 * 1000);
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
      isPinned: !!k.isPinned,
      lastSearchedAt: k.lastSearchedAt,
      lastCollectedAt: k.lastCollectedAt,
      nextCollectAt: k.nextCollectAt,
      totalSearchCount: N(k.totalSearchCount),
      compositeScore: N(k.compositeScore),
      volatilityScore: volScore,
      adaptiveIntervalHours: intervalHours,
      selectionReason: reason,
      tier,
    };
  };

  // 티어 1: 핀 키워드 (pinOrder 순)
  for (const k of pinnedKeywords) {
    if (result.length >= effectiveLimit) break;
    const entry = processKeyword(k, "pin");
    if (entry) result.push(entry);
  }

  // 티어 2: 신규 키워드
  for (const k of newKeywords) {
    if (result.length >= effectiveLimit) break;
    const entry = processKeyword(k, "new");
    if (entry) result.push(entry);
  }

  // 티어 3: 일반 키워드 (그룹 턴 순 → overdue 순)
  for (const k of regularKeywords) {
    if (result.length >= effectiveLimit) break;
    const entry = processKeyword(k, "regular");
    if (entry) result.push(entry);
  }

  console.log(`[selectBatchKeywords] userId=${userId} round=${roundsToday + 1} | active=${N(totalActive)} collectedToday=${todayCollectedKeywords.size} | tier1=${pinnedKeywords.length} tier2=${newKeywords.length} tier3=${regularKeywords.length} → selected=${result.length}/${effectiveLimit}`);

  return {
    keywords: result,
    delayConfig: generateDelayConfig(result.length),
    totalActive: N(totalActive),
    totalOverdue: result.length,
    dailyStats: {
      collectedToday: totalCollectedToday,
      dailyLimit: DAILY_COLLECT_LIMIT,
      remainingToday: Math.max(0, remainingToday - result.length),
      roundsToday,
      maxRoundsPerDay: MAX_ROUNDS_PER_DAY,
      currentGroupTurn,
    },
    sessionLimits: {
      maxKeywords: SESSION_MAX_KEYWORDS,
      maxMinutes: SESSION_MAX_MINUTES,
    },
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

  // ★ v7.5.0→v9: ext_keyword_daily_stats 기반 정규화 엔진
  // 최근 30일 이내 과거 데이터 조회 (기준 상품수 + 기준점 찾기)
  const recentHistory = await db.select({
    statDate: extKeywordDailyStats.statDate,
    totalReviewSum: extKeywordDailyStats.totalReviewSum,
    totalItems: extKeywordDailyStats.productCount,
    reviewGrowth: extKeywordDailyStats.reviewGrowth,
    avgPrice: extKeywordDailyStats.avgPrice,
    reviewDeltaUsed: extKeywordDailyStats.reviewDeltaUsed,
    estimatedDailySales: extKeywordDailyStats.salesEstimate,
  })
    .from(extKeywordDailyStats)
    .where(and(
      eq(extKeywordDailyStats.userId, userId),
      eq(extKeywordDailyStats.query, keyword),
      sql`${extKeywordDailyStats.statDate} < ${statDate}`,
      sql`${extKeywordDailyStats.statDate} >= DATE_SUB(${statDate}, INTERVAL 30 DAY)`,
    ))
    .orderBy(desc(extKeywordDailyStats.statDate))
    .limit(30);

  // ★ v7.5.0: 기준 상품수 계산 (P70)
  const recentProductCounts = recentHistory.map((e: any) => N(e.totalItems));
  if (totalItems > 0) recentProductCounts.push(totalItems);
  const { baseProductCount: computedBase } = computeBaseProductCount(recentProductCounts);
  const effectiveBase = computedBase > 0 ? computedBase : totalItems;

  // 오늘 정규화
  const todayNorm = normalizeReviewSumFn(totalReviewSum, totalItems, effectiveBase);
  const todayValid = isValidSnapshotFn(totalItems, totalReviewSum, effectiveBase);

  // 유효한 가장 최근 기준점 찾기
  let baselineEntry: {
    statDate: string;
    normalizedReviewSum: number;
    avgPrice: number;
    productCount: number;
  } | null = null;
  let daysSinceBaseline = 0;

  for (const entry of recentHistory) {
    const rs = N(entry.totalReviewSum);
    const pc = N(entry.totalItems);
    const entryValid = isValidSnapshotFn(pc, rs, effectiveBase);
    if (entryValid.valid && String(entry.statDate) !== statDate) {
      const entryNorm = normalizeReviewSumFn(rs, pc, effectiveBase);
      baselineEntry = {
        statDate: String(entry.statDate),
        normalizedReviewSum: entryNorm.normalizedReviewSum,
        avgPrice: N(entry.avgPrice),
        productCount: pc,
      };
      const baseDate = new Date(baselineEntry.statDate + "T00:00:00");
      const currentDate = new Date(statDate + "T00:00:00");
      daysSinceBaseline = Math.max(1, Math.round(
        (currentDate.getTime() - baseDate.getTime()) / (24 * 60 * 60 * 1000),
      ));
      break;
    }
  }

  // Fallback delta 계산
  const recentPositiveDeltas = recentHistory
    .map((e: any, i: number) => ({ delta: N(e.reviewDeltaUsed || e.reviewGrowth), daysAgo: i + 1 }))
    .filter((d: any) => d.delta > 0);
  const fallbackDeltas = computeFallbackDeltasFn(recentPositiveDeltas);

  let reviewGrowth = 0;
  let priceChange = 0;
  let itemCountChange = 0;
  let reviewDeltaObserved = 0;
  let reviewDeltaUsed = 0;
  let isProvisional = false;
  let provisionalReason: string | null = null;
  let dataStatus = "raw_valid";

  if (todayValid.valid && baselineEntry) {
    // ★ v7.5.0: 정규화 기준 delta 계산
    const normalizedDelta = todayNorm.normalizedReviewSum - baselineEntry.normalizedReviewSum;
    const dailyNormalizedDelta = daysSinceBaseline > 1
      ? Math.round(normalizedDelta / daysSinceBaseline)
      : normalizedDelta;

    reviewDeltaObserved = dailyNormalizedDelta;

    if (dailyNormalizedDelta >= 0) {
      reviewGrowth = dailyNormalizedDelta;
      reviewDeltaUsed = dailyNormalizedDelta;
    } else {
      // 음수 → fallback 평균 사용
      const resolved = resolveReviewDeltaFn(dailyNormalizedDelta, fallbackDeltas);
      reviewGrowth = resolved.reviewDeltaUsed;
      reviewDeltaUsed = resolved.reviewDeltaUsed;
      isProvisional = resolved.isProvisional;
      provisionalReason = resolved.provisionalReason;
      dataStatus = "provisional";
    }

    priceChange = avgPrice - baselineEntry.avgPrice;
  } else if (!todayValid.valid) {
    // 비정상 데이터 → fallback
    reviewGrowth = fallbackDeltas.last7Avg || 0;
    reviewDeltaUsed = reviewGrowth;
    isProvisional = true;
    provisionalReason = todayValid.reason;
    dataStatus = "anomaly";
  }

  // 전일 데이터로 상품수 변동 계산 (ext_keyword_daily_stats 기반)
  const prevDate = getPrevDate(statDate);
  const [prevStatus] = await db.select({ productCount: extKeywordDailyStats.productCount })
    .from(extKeywordDailyStats)
    .where(and(
      eq(extKeywordDailyStats.userId, userId),
      eq(extKeywordDailyStats.query, keyword),
      eq(extKeywordDailyStats.statDate, prevDate),
    ))
    .limit(1);
  itemCountChange = prevStatus ? totalItems - N(prevStatus.productCount) : 0;

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
    // ★ v7.5.0: 정규화 엔진 필드
    baseProductCount: effectiveBase,
    normalizedReviewSum: todayNorm.normalizedReviewSum,
    coverageRatio: +(todayNorm.coverageRatio.toFixed(4)),
    reviewDeltaObserved,
    reviewDeltaUsed,
    salesEstimateMa7: 0, // MA는 recomputeProvisionalEntries에서 계산
    salesEstimateMa30: 0,
    isProvisional,
    provisionalReason,
    dataStatus,
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
  const today = todayKST();

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

      // ★ v9: ext_keyword_daily_stats에 per-product delta 기반 UPSERT
      // rebuildKeywordDailyStatsForKeyword가 MA, provisional 재보정, spike 탐지 모두 처리
      const rebuildResult = await rebuildKeywordDailyStatsForKeyword(db, userId, kw.keyword, {
        todayStr: today,
        todaySnapshot: {
          items: [], // 스냅샷에서 자동 로드
          totalReviewSum: agg.totalReviewSum,
          avgPrice: agg.avgPrice,
          avgRating: agg.avgRating.toFixed(1),
          avgReview: agg.avgReview,
          adCount: agg.adCount,
          rocketCount: agg.rocketCount,
          highReviewCount: agg.highReviewCount,
          competitionScore: agg.competitionScore,
          competitionLevel: agg.competitionLevel,
          totalItems: agg.totalItems,
        },
      });

      // ★ v9: 7일 리뷰 증가 — ext_keyword_daily_stats 기반
      const weekBaseline = await db.select({
        statDate: extKeywordDailyStats.statDate,
        totalReviewSum: extKeywordDailyStats.totalReviewSum,
        totalItems: extKeywordDailyStats.productCount,
      })
        .from(extKeywordDailyStats)
        .where(and(
          eq(extKeywordDailyStats.userId, userId),
          eq(extKeywordDailyStats.query, kw.keyword),
          sql`${extKeywordDailyStats.statDate} >= DATE_SUB(${today}, INTERVAL 14 DAY)`,
          sql`${extKeywordDailyStats.statDate} <= DATE_SUB(${today}, INTERVAL 5 DAY)`,
        ))
        .orderBy(desc(extKeywordDailyStats.statDate))
        .limit(10);

      let reviewGrowth7d = 0;
      const effectiveBase7d = agg.baseProductCount > 0 ? agg.baseProductCount : agg.totalItems;
      const validWeekBase = weekBaseline.find(
        (e: any) => {
          const v = isValidSnapshotFn(N(e.totalItems), N(e.totalReviewSum), effectiveBase7d);
          return v.valid;
        },
      );
      if (validWeekBase && agg.totalReviewSum > 0 && effectiveBase7d > 0) {
        const baseNorm = normalizeReviewSumFn(N(validWeekBase.totalReviewSum), N(validWeekBase.totalItems), effectiveBase7d);
        const todayNorm7d = normalizeReviewSumFn(agg.totalReviewSum, agg.totalItems, effectiveBase7d);
        reviewGrowth7d = Math.max(0, todayNorm7d.normalizedReviewSum - baseNorm.normalizedReviewSum);
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

      // ★ v9: provisional 재보정 + MA는 rebuildKeywordDailyStatsForKeyword에서 처리됨

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

  // ★ v8.5.5: 크롤링 완료 키워드 중 검색량 미수집분만 네이버 API 요청
  try {
    const syncResult = await syncNaverSearchVolume(userId);
    if (syncResult.totalSaved > 0) console.log(`[runDailyBatch] 네이버 검색량 ${syncResult.totalSaved}건 수집 완료`);
  } catch (e: any) {
    console.error(`[runDailyBatch] 네이버 검색량 수집 오류:`, e?.message);
  }

  return { processed, updated, errors, hasMore, total: totalKeywords, results };
}

// ============================================================
//  v8.5.6: 네이버 검색량 수집 — 서버측 독립 실행
// ============================================================

/**
 * 네이버 검색량 수집 (서버측 독립 실행)
 *
 * ★ v8.5.6 전면 개편:
 * - 필터링 로직:
 *   (A) 7일간 크롤링 데이터 없는 키워드 → 수집 제외 (크롤링된 키워드만 대상)
 *   (B) 이번 달 검색량 이력 없는 키워드 → 수집 대상
 *   ⇒ 크롤링 이력이 있으면서(A 통과) 검색량이 없는(B 해당) 키워드만 수집
 * - 간격: 키워드당 5초 (정밀도 향상 + 429 방어)
 * - 모드: 전체(all) / 선택(keywords[]) 수집
 * - 동종언어 매핑: 띄어쓰기·특수문자 정규화 + findBestNaverMatch
 * - 429 방어: 지수 백오프 10s/30s/60s, 연속 3회 중단
 *
 * @param userId - 사용자 ID
 * @param options.mode - 'all' (전체) | 'selected' (선택 키워드만)
 * @param options.keywords - mode='selected' 시 수집할 키워드 목록
 * @param options.forceRefresh - true면 이번 달 수집 이력 무시하고 재수집
 */
export async function syncNaverSearchVolume(
  userId: number,
  options?: {
    mode?: "all" | "selected";
    keywords?: string[];
    forceRefresh?: boolean;
  },
): Promise<{
  totalSaved: number;
  failCount: number;
  skipped: number;
  targetCount: number;
  rateLimitHit: boolean;
  filterStats: {
    totalActive: number;
    crawledRecently: number;
    alreadyHasVolume: number;
    finalTarget: number;
  };
}> {
  const emptyResult = {
    totalSaved: 0, failCount: 0, skipped: 0, targetCount: 0,
    rateLimitHit: false,
    filterStats: { totalActive: 0, crawledRecently: 0, alreadyHasVolume: 0, finalTarget: 0 },
  };

  const db = await getDb();
  if (!db) return emptyResult;

  const todayStr = todayKST();
  const yearMonth = todayStr.slice(0, 7); // YYYY-MM
  const mode = options?.mode || "all";
  const forceRefresh = options?.forceRefresh || false;

  // ── 1. 대상 키워드 결정 ──
  let targetKeywords: string[] = [];

  if (mode === "selected" && options?.keywords?.length) {
    // 선택 모드: 사용자가 지정한 키워드만
    targetKeywords = options.keywords;
  } else {
    // 전체 모드: 활성 감시 키워드
    const allActive = await db.select({ keyword: extWatchKeywords.keyword })
      .from(extWatchKeywords)
      .where(and(
        eq(extWatchKeywords.userId, userId),
        eq(extWatchKeywords.isActive, true),
      ));
    targetKeywords = allActive.map(r => r.keyword);
  }

  if (targetKeywords.length === 0) {
    return emptyResult;
  }

  const totalActive = targetKeywords.length;

  // ── 2. 필터 A: 7일 내 크롤링 된 키워드만 남기기 ──
  // (크롤링 이력이 없는 키워드는 제외 — 크롤링 데이터와 연동)
  const sevenDaysAgoStr = getPrevDateN(todayStr, 7);
  const recentCrawled = await db.selectDistinct({ keyword: extKeywordDailyStats.query })
    .from(extKeywordDailyStats)
    .where(and(
      eq(extKeywordDailyStats.userId, userId),
      gte(extKeywordDailyStats.statDate, sevenDaysAgoStr),
    ));
  const recentCrawledSet = new Set(recentCrawled.map(r => r.keyword));

  // 선택 모드에서는 크롤링 필터 생략 (사용자 의도 존중)
  const crawlFilteredKeywords = mode === "selected"
    ? targetKeywords
    : targetKeywords.filter(kw => recentCrawledSet.has(kw));

  if (crawlFilteredKeywords.length === 0) {
    console.log(`[syncNaverSearchVolume] 7일 내 크롤링된 키워드 0개 — 수집 스킵 (전체 ${totalActive}개)`);
    return {
      ...emptyResult,
      filterStats: { totalActive, crawledRecently: 0, alreadyHasVolume: 0, finalTarget: 0 },
    };
  }

  // ── 3. 필터 B: 이번 달 검색량 데이터 없는 키워드만 ──
  let finalBatch: string[];
  if (forceRefresh) {
    finalBatch = [...crawlFilteredKeywords];
  } else {
    const existing = await db.select({ keyword: keywordSearchVolumeHistory.keyword })
      .from(keywordSearchVolumeHistory)
      .where(and(
        eq(keywordSearchVolumeHistory.userId, userId),
        eq(keywordSearchVolumeHistory.yearMonth, yearMonth),
        eq(keywordSearchVolumeHistory.source, "naver"),
      ));
    // 정규화 기반 매칭 (띄어쓰기 변형 "냄비 받침" == "냄비받침")
    const existingNormSet = new Set(existing.map(r => normalizeNaverKeyword(r.keyword)));
    finalBatch = crawlFilteredKeywords.filter(kw => !existingNormSet.has(normalizeNaverKeyword(kw)));
  }

  const alreadyHasVolume = crawlFilteredKeywords.length - finalBatch.length;

  if (finalBatch.length === 0) {
    console.log(`[syncNaverSearchVolume] 모든 키워드 수집 완료 (활성 ${totalActive}, 크롤링O ${crawlFilteredKeywords.length}, 검색량O ${alreadyHasVolume})`);
    return {
      ...emptyResult,
      filterStats: { totalActive, crawledRecently: crawlFilteredKeywords.length, alreadyHasVolume, finalTarget: 0 },
    };
  }

  console.log(`[syncNaverSearchVolume] 수집 시작: ${finalBatch.length}개 (활성 ${totalActive}, 크롤링O ${crawlFilteredKeywords.length}, 검색량O ${alreadyHasVolume}, mode=${mode}, force=${forceRefresh})`);

  // ── 4. 1개씩 5초 간격 수집 + 동종언어 매핑 강화 ──
  let totalSaved = 0;
  let failCount = 0;
  let skipped = 0;
  let rateLimitHit = false;
  let consecutiveRateLimits = 0;

  for (let i = 0; i < finalBatch.length; i++) {
    if (rateLimitHit) break;

    const kw = finalBatch[i];
    try {
      // ★ v8.5.6: 키워드 변형 생성 후 공백 제거된 형태로 API 호출
      const results = await getNaverKeywords([kw]);
      consecutiveRateLimits = 0; // 성공 시 리셋

      if (results.length === 0) {
        // 네이버에 등록되지 않은 키워드 → 미등록으로 기록
        skipped++;
        if (i % 50 === 0) console.log(`[syncNaverSearchVolume] ${i + 1}/${finalBatch.length} 진행 중 (성공 ${totalSaved}, 미등록 ${skipped})`);
        // ★ 5초 간격 유지
        if (i + 1 < finalBatch.length) await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }

      // ★ v8.5.6: 동종언어 매핑 강화 — findBestNaverMatch 사용
      const bestMatch = findBestNaverMatch(kw, results);

      if (bestMatch) {
        const totalSearch = (bestMatch.monthlyPcQcCnt || 0) + (bestMatch.monthlyMobileQcCnt || 0);
        if (totalSearch > 0) {
          const upsertValues = {
            pcSearch: bestMatch.monthlyPcQcCnt || 0,
            mobileSearch: bestMatch.monthlyMobileQcCnt || 0,
            totalSearch,
            competitionIndex: bestMatch.compIdx || "낮음",
            avgCpc: String((bestMatch.monthlyAvgPcClkCnt || 0) + (bestMatch.monthlyAvgMobileClkCnt || 0)),
          };

          // relKeyword 형태로 저장
          await db.insert(keywordSearchVolumeHistory).values({
            userId,
            keyword: bestMatch.relKeyword,
            source: "naver",
            yearMonth,
            ...upsertValues,
          }).onDuplicateKeyUpdate({ set: upsertValues });

          // ★ 동종언어 매핑: 원본 키워드가 relKeyword와 다르면 원본으로도 저장
          // "냄비 받침" → API 반환 "냄비받침" → 두 형태 모두 저장
          if (kw !== bestMatch.relKeyword) {
            await db.insert(keywordSearchVolumeHistory).values({
              userId,
              keyword: kw,
              source: "naver",
              yearMonth,
              ...upsertValues,
            }).onDuplicateKeyUpdate({ set: upsertValues });
          }

          totalSaved++;
        } else {
          skipped++; // 검색량 0
        }
      } else {
        // 매칭 없음 — 첫 번째 유효 결과를 원본 키워드명으로 저장
        const firstValid = results.find(r => ((r.monthlyPcQcCnt || 0) + (r.monthlyMobileQcCnt || 0)) > 0);
        if (firstValid) {
          const totalSearch = (firstValid.monthlyPcQcCnt || 0) + (firstValid.monthlyMobileQcCnt || 0);
          const upsertValues = {
            pcSearch: firstValid.monthlyPcQcCnt || 0,
            mobileSearch: firstValid.monthlyMobileQcCnt || 0,
            totalSearch,
            competitionIndex: firstValid.compIdx || "낮음",
            avgCpc: String((firstValid.monthlyAvgPcClkCnt || 0) + (firstValid.monthlyAvgMobileClkCnt || 0)),
          };
          await db.insert(keywordSearchVolumeHistory).values({
            userId,
            keyword: kw,
            source: "naver",
            yearMonth,
            ...upsertValues,
          }).onDuplicateKeyUpdate({ set: upsertValues });
          totalSaved++;
        } else {
          skipped++; // 모든 결과 검색량 0
        }
      }

      // ★ 키워드당 5초 간격 (정밀도 + 429 방어)
      if (i + 1 < finalBatch.length) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      // 진행률 로깅 (50개마다)
      if ((i + 1) % 50 === 0) {
        console.log(`[syncNaverSearchVolume] ${i + 1}/${finalBatch.length} 진행 중 (성공 ${totalSaved}, 실패 ${failCount}, 스킵 ${skipped})`);
      }

    } catch (e: any) {
      failCount++;
      const errMsg = e?.message || "";
      // 429 Too Many Requests → 지수 백오프 재시도 (최대 3회)
      if (errMsg.includes("429") || errMsg.includes("Too Many") || errMsg.includes("toomanyrequest")) {
        consecutiveRateLimits++;
        if (consecutiveRateLimits >= 3) {
          console.warn(`[syncNaverSearchVolume] 429 연속 ${consecutiveRateLimits}회 — ${i + 1}/${finalBatch.length}번째에서 중단 (성공: ${totalSaved})`);
          rateLimitHit = true;
        } else {
          const backoffMs = consecutiveRateLimits === 1 ? 10000 : consecutiveRateLimits === 2 ? 30000 : 60000;
          console.warn(`[syncNaverSearchVolume] 429 발생 (${consecutiveRateLimits}/3) — ${backoffMs / 1000}초 대기 후 재시도`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          i--; // 같은 키워드 재시도
          failCount--;
        }
      } else {
        console.error(`[syncNaverSearchVolume] "${kw}" 실패:`, errMsg);
      }
    }
  }

  if (failCount > 0) {
    console.log(`[syncNaverSearchVolume] ${failCount}개 키워드 실패`);
  }
  console.log(`[syncNaverSearchVolume] 완료: 성공 ${totalSaved}, 실패 ${failCount}, 스킵 ${skipped}, 429중단 ${rateLimitHit} (대상 ${finalBatch.length})`);

  return {
    totalSaved,
    failCount,
    skipped,
    targetCount: finalBatch.length,
    rateLimitHit,
    filterStats: {
      totalActive,
      crawledRecently: crawlFilteredKeywords.length,
      alreadyHasVolume,
      finalTarget: finalBatch.length,
    },
  };
}

// ============================================================
//  [DEPRECATED 2026-03-15] Provisional 엔트리 재보정
//  ⚠ 구 ext_keyword_daily_status 기반. rebuildKeywordDailyStatsForKeyword()가
//  ext_keyword_daily_stats에서 동일 기능을 수행함.
// ============================================================

/**
 * @deprecated rebuildKeywordDailyStatsForKeyword()의 10단계에서 처리됨.
 */
export async function recomputeProvisionalEntries(
  userId: number,
  keyword: string,
  todayDate: string,
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  // 오늘 데이터 가져오기
  const [todayEntry] = await db.select()
    .from(extKeywordDailyStatus)
    .where(and(
      eq(extKeywordDailyStatus.userId, userId),
      eq(extKeywordDailyStatus.keyword, keyword),
      eq(extKeywordDailyStatus.statDate, todayDate),
    ))
    .limit(1);

  if (!todayEntry || todayEntry.isProvisional) return 0;

  // 최근 14일의 provisional 엔트리 찾기
  const recentEntries = await db.select()
    .from(extKeywordDailyStatus)
    .where(and(
      eq(extKeywordDailyStatus.userId, userId),
      eq(extKeywordDailyStatus.keyword, keyword),
      sql`${extKeywordDailyStatus.statDate} >= DATE_SUB(${todayDate}, INTERVAL 14 DAY)`,
      sql`${extKeywordDailyStatus.statDate} < ${todayDate}`,
    ))
    .orderBy(asc(extKeywordDailyStatus.statDate));

  // 마지막 stable 앵커 찾기 (provisional=false인 가장 최근 것)
  let anchorIdx = -1;
  for (let i = recentEntries.length - 1; i >= 0; i--) {
    if (!recentEntries[i].isProvisional) {
      anchorIdx = i;
      break;
    }
  }

  if (anchorIdx < 0) return 0; // 앵커 없으면 보간 불가

  const anchor = recentEntries[anchorIdx];
  const provisionalEntries = recentEntries.slice(anchorIdx + 1);
  if (provisionalEntries.length === 0) return 0;

  const anchorNorm = N(anchor.normalizedReviewSum);
  const todayNorm = N(todayEntry.normalizedReviewSum);
  const totalDays = provisionalEntries.length + 1; // anchor → today 사이 날짜 수
  const totalDelta = todayNorm - anchorNorm;
  const dailyDelta = totalDelta >= 0 ? Math.round(totalDelta / totalDays) : 0;

  let updated = 0;
  for (let i = 0; i < provisionalEntries.length; i++) {
    const entry = provisionalEntries[i];
    const dayIdx = i + 1;
    const interpolatedNorm = Math.round(anchorNorm + dailyDelta * dayIdx);
    const interpolatedSales = Math.max(0, dailyDelta * 20);

    await db.update(extKeywordDailyStatus)
      .set({
        reviewGrowth: Math.max(0, dailyDelta),
        normalizedReviewSum: interpolatedNorm,
        estimatedDailySales: interpolatedSales,
        reviewDeltaUsed: dailyDelta,
        isProvisional: false,
        provisionalReason: null,
        dataStatus: "interpolated",
      })
      .where(eq(extKeywordDailyStatus.id, entry.id));
    updated++;
  }

  return updated;
}

// ============================================================
//  [DEPRECATED 2026-03-15] MA7/MA30 이동평균 계산 (구 ext_keyword_daily_status 기반)
//  ⚠ rebuildKeywordDailyStatsForKeyword()의 6.5단계에서
//  ext_keyword_daily_stats에 per-product delta 기반 MA를 계산함.
// ============================================================

/**
 * @deprecated rebuildKeywordDailyStatsForKeyword()가 MA7/MA30을 직접 처리.
 * demand.router의 rebuildNormalizedMetrics(deprecated)에서만 사용됨.
 */
export async function computeAndUpdateMA(
  dbOrUserId: any,
  userIdOrKeyword: any,
  keywordOrDate?: string,
  targetDateArg?: string,
): Promise<void> {
  // 시그니처 호환: (db, userId, keyword, date) 또는 (userId, keyword, date)
  let db: any;
  let userId: number;
  let keyword: string;
  let targetDate: string;
  if (typeof dbOrUserId === "number") {
    // (userId, keyword, date) 형태
    db = await getDb();
    if (!db) return;
    userId = dbOrUserId;
    keyword = String(userIdOrKeyword);
    targetDate = keywordOrDate!;
  } else {
    // (db, userId, keyword, date) 형태
    db = dbOrUserId;
    userId = Number(userIdOrKeyword);
    keyword = keywordOrDate!;
    targetDate = targetDateArg!;
  }

  try {
    // 최근 30일 데이터 조회 (targetDate 포함)
    const rows = await db.select({
      id: extKeywordDailyStatus.id,
      statDate: extKeywordDailyStatus.statDate,
      estimatedDailySales: extKeywordDailyStatus.estimatedDailySales,
    })
      .from(extKeywordDailyStatus)
      .where(and(
        eq(extKeywordDailyStatus.userId, userId),
        eq(extKeywordDailyStatus.keyword, keyword),
        sql`${extKeywordDailyStatus.statDate} >= DATE_SUB(${targetDate}, INTERVAL 30 DAY)`,
        sql`${extKeywordDailyStatus.statDate} <= ${targetDate}`,
      ))
      .orderBy(asc(extKeywordDailyStatus.statDate));

    if (!rows.length) return;

    // 날짜순 정렬된 판매추정 배열
    const salesArr = rows.map((r: any) => ({
      id: r.id,
      statDate: String(r.statDate),
      sales: N(r.estimatedDailySales),
    }));

    // 각 날짜별 MA7/MA30 계산 (최근 7일만 업데이트)
    for (let i = 0; i < salesArr.length; i++) {
      const targetDateObj = new Date(targetDate + "T00:00:00");
      const entryDateObj = new Date(salesArr[i].statDate + "T00:00:00");
      const daysDiff = Math.round(
        (targetDateObj.getTime() - entryDateObj.getTime()) / (24 * 60 * 60 * 1000),
      );
      if (daysDiff > 7) continue;

      // MA7: 현재 포함 최근 7개
      const window7 = salesArr
        .slice(Math.max(0, i - 6), i + 1)
        .map((x: any) => x.sales)
        .filter((s: number) => s > 0);
      const ma7 = window7.length >= 2
        ? Math.round(window7.reduce((a: number, b: number) => a + b, 0) / window7.length)
        : window7.length === 1 ? window7[0] : 0;

      // MA30: 현재 포함 최근 30개
      const window30 = salesArr
        .slice(Math.max(0, i - 29), i + 1)
        .map((x: any) => x.sales)
        .filter((s: number) => s > 0);
      const ma30 = window30.length >= 2
        ? Math.round(window30.reduce((a: number, b: number) => a + b, 0) / window30.length)
        : window30.length === 1 ? window30[0] : 0;

      await db.update(extKeywordDailyStatus)
        .set({
          salesEstimateMa7: ma7,
          salesEstimateMa30: ma30,
        })
        .where(eq(extKeywordDailyStatus.id, salesArr[i].id));
    }
  } catch (err) {
    console.error("[computeAndUpdateMA]", err);
  }
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
 * 4. 쿠팡 데이터(ext_keyword_daily_stats)를 keyword_daily_metrics에 반영
 */
export async function syncWatchKeywordsToMaster(userId: number): Promise<{
  synced: number;
  metricsCreated: number;
  errors: number;
}> {
  const db = await getDb();
  if (!db) return { synced: 0, metricsCreated: 0, errors: 0 };

  const now = nowKST();
  const today = todayKST();

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

      // 쿠팡 데이터가 있으면 keyword_daily_metrics에도 반영 (ext_keyword_daily_stats 기반)
      const [dailyStatus] = await db.select({
        productCount: extKeywordDailyStats.productCount,
        avgPrice: extKeywordDailyStats.avgPrice,
        totalReviewSum: extKeywordDailyStats.totalReviewSum,
        reviewGrowth: extKeywordDailyStats.reviewGrowth,
      })
        .from(extKeywordDailyStats)
        .where(and(
          eq(extKeywordDailyStats.userId, userId),
          eq(extKeywordDailyStats.query, wk.keyword),
        ))
        .orderBy(desc(extKeywordDailyStats.statDate))
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
          coupangProductCount: N(dailyStatus.productCount),
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
      const [dailyStatus] = await db.select({
        productCount: extKeywordDailyStats.productCount,
        avgPrice: extKeywordDailyStats.avgPrice,
        totalReviewSum: extKeywordDailyStats.totalReviewSum,
        reviewGrowth: extKeywordDailyStats.reviewGrowth,
      })
        .from(extKeywordDailyStats)
        .where(and(
          eq(extKeywordDailyStats.userId, userId),
          eq(extKeywordDailyStats.query, wk.keyword),
        ))
        .orderBy(desc(extKeywordDailyStats.statDate))
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
        coupangProductCount: N(dailyStatus.productCount),
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
