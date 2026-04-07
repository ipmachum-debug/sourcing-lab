/**
 * 바이럴 스코어 추적기
 *
 * - 발행된 게시물의 확산 속도를 실시간 계산
 * - 바이럴 임계치 초과 시 알림 + 자동 부스팅 트리거
 * - 크로스 포스팅 자동 발동
 */

import { getDb } from "../../db";
import {
  mktViralScores, mktChannelPosts, mktAnalytics, mktViralLog,
  mktBoostRules, mktCrossPosts,
} from "../../../drizzle/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";

let viralInterval: ReturnType<typeof setInterval> | null = null;

export function startViralScorer() {
  if (viralInterval) return;
  console.log("[Viral Scorer] Starting (30min interval)...");
  viralInterval = setInterval(scoreAll, 30 * 60_000);
  setTimeout(scoreAll, 5 * 60_000); // 5분 후 첫 실행
}

export function stopViralScorer() {
  if (viralInterval) { clearInterval(viralInterval); viralInterval = null; }
}

const VIRAL_THRESHOLD = 70; // 이 점수 이상이면 "바이럴"

async function scoreAll() {
  try {
    const db = await getDb();
    if (!db) return;

    // 최근 3일 내 발행된 게시물
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000)
      .toISOString().replace("T", " ").slice(0, 19);

    const recentPosts = await db.select().from(mktChannelPosts)
      .where(and(
        eq(mktChannelPosts.publishStatus, "published"),
        gte(mktChannelPosts.publishedAt, threeDaysAgo),
      ))
      .limit(50);

    if (recentPosts.length === 0) return;

    for (const post of recentPosts) {
      await scorePost(db, post);
    }
  } catch (err) {
    console.error("[Viral Scorer] Error:", err);
  }
}

async function scorePost(db: any, post: any) {
  // 최근 2개의 성과 스냅샷으로 속도 계산
  const snapshots = await db.select().from(mktAnalytics)
    .where(eq(mktAnalytics.channelPostId, post.id))
    .orderBy(desc(mktAnalytics.capturedAt))
    .limit(2);

  if (snapshots.length === 0) return;

  const latest = snapshots[0];
  const previous = snapshots[1] || null;

  // 시간 경과 계산
  const publishedAt = new Date(post.publishedAt).getTime();
  const hoursLive = Math.max(1, (Date.now() - publishedAt) / 3600000);

  // 속도 (시간당 반응 수)
  const totalEngagement = (latest.views || 0) + (latest.likes || 0) * 3 +
    (latest.comments || 0) * 5 + (latest.shares || 0) * 10;
  const velocity = totalEngagement / hoursLive;

  // 이전 스냅샷 대비 증가율
  let accelerating = false;
  if (previous) {
    const prevEngagement = (previous.views || 0) + (previous.likes || 0) * 3 +
      (previous.comments || 0) * 5 + (previous.shares || 0) * 10;
    accelerating = totalEngagement > prevEngagement * 1.2; // 20% 이상 증가
  }

  // 참여율
  const engagementRate = latest.views > 0
    ? (((latest.likes || 0) + (latest.comments || 0) + (latest.shares || 0)) / latest.views * 100)
    : 0;

  // 공유 비율 (바이럴의 핵심 지표)
  const shareRatio = latest.views > 0
    ? ((latest.shares || 0) / latest.views * 100)
    : 0;

  // 바이럴 스코어 계산 (가중 합산)
  let viralScore = 0;
  viralScore += Math.min(velocity * 2, 30);           // 속도 (max 30)
  viralScore += Math.min(engagementRate * 3, 25);      // 참여율 (max 25)
  viralScore += Math.min(shareRatio * 10, 25);         // 공유율 (max 25)
  viralScore += accelerating ? 10 : 0;                 // 가속 중 보너스
  viralScore += Math.min((latest.comments || 0) / 10, 10); // 댓글 보너스 (max 10)
  viralScore = Math.round(Math.min(viralScore, 100));

  const isViral = viralScore >= VIRAL_THRESHOLD;

  // 스코어 저장
  await db.insert(mktViralScores).values({
    channelPostId: post.id,
    userId: post.userId,
    platform: post.platform,
    viralScore,
    velocity: velocity.toFixed(2),
    engagementRate: engagementRate.toFixed(2),
    shareRatio: shareRatio.toFixed(2),
    isViral,
    isBoosted: false,
    peakAt: accelerating ? new Date().toISOString().replace("T", " ").slice(0, 19) : null,
  });

  // 바이럴 감지 시 처리
  if (isViral) {
    // 이전에 이미 바이럴로 감지되었는지 확인
    const [prevViral] = await db.select().from(mktViralScores)
      .where(and(
        eq(mktViralScores.channelPostId, post.id),
        eq(mktViralScores.isViral, true),
      ))
      .orderBy(desc(mktViralScores.measuredAt))
      .limit(1);

    // 처음 바이럴 감지
    if (!prevViral || prevViral.id === undefined) {
      await db.insert(mktViralLog).values({
        userId: post.userId,
        eventType: "viral_detected",
        summary: `바이럴 감지! ${post.platform} 게시물 (스코어: ${viralScore}, 참여율: ${engagementRate.toFixed(1)}%, 공유율: ${shareRatio.toFixed(1)}%)`,
        relatedId: post.id,
        relatedType: "channel_post",
        metadata: { viralScore, velocity, engagementRate, shareRatio },
      });

      // 크로스 포스팅 자동 생성
      await triggerCrossPost(db, post);

      // 부스팅 규칙 확인
      await checkBoostRules(db, post, viralScore, engagementRate);
    }
  }
}

async function triggerCrossPost(db: any, post: any) {
  const allPlatforms = ["instagram", "youtube", "tiktok", "naver_blog"];
  const targetPlatforms = allPlatforms.filter(p => p !== post.platform);

  for (const target of targetPlatforms) {
    // 이미 크로스 포스팅 되었는지 확인
    const [existing] = await db.select().from(mktCrossPosts)
      .where(and(
        eq(mktCrossPosts.sourcePostId, post.id),
        eq(mktCrossPosts.targetPlatform, target),
      ))
      .limit(1);

    if (existing) continue;

    await db.insert(mktCrossPosts).values({
      userId: post.userId,
      sourcePostId: post.id,
      sourcePlatform: post.platform,
      targetPlatform: target,
      status: "pending",
    });
  }

  await db.insert(mktViralLog).values({
    userId: post.userId,
    eventType: "cross_posted",
    summary: `바이럴 게시물 크로스 포스팅 대기: ${post.platform} → ${targetPlatforms.join(", ")}`,
    relatedId: post.id,
    relatedType: "channel_post",
  });
}

async function checkBoostRules(db: any, post: any, viralScore: number, engagementRate: number) {
  const rules = await db.select().from(mktBoostRules)
    .where(and(
      eq(mktBoostRules.userId, post.userId),
      eq(mktBoostRules.platform, post.platform),
      eq(mktBoostRules.isActive, true),
    ))
    .limit(1);

  if (rules.length === 0) return;
  const rule = rules[0];

  if (viralScore >= rule.minViralScore) {
    await db.insert(mktViralLog).values({
      userId: post.userId,
      eventType: "boost_triggered",
      summary: `자동 부스팅 트리거! ${post.platform} 게시물 (스코어: ${viralScore} >= 기준: ${rule.minViralScore}). 일 예산: ${rule.dailyBudgetKrw}원`,
      relatedId: post.id,
      relatedType: "channel_post",
      metadata: { ruleId: rule.id, budget: rule.dailyBudgetKrw },
    });

    // 실제 Meta Marketing API 호출은 여기에 구현
    // 지금은 로그만 남김 (API 키 세팅 후 활성화)
  }
}

// 수동 스코어 계산
export async function scorePostManual(postId: number): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const [post] = await db.select().from(mktChannelPosts)
    .where(eq(mktChannelPosts.id, postId)).limit(1);
  if (!post) return null;
  await scorePost(db, post);
  const [latest] = await db.select().from(mktViralScores)
    .where(eq(mktViralScores.channelPostId, postId))
    .orderBy(desc(mktViralScores.measuredAt))
    .limit(1);
  return latest?.viralScore || 0;
}
