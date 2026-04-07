/**
 * 성과 자동 수집기
 *
 * - 발행된 게시물의 성과를 플랫폼 API로 수집
 * - 30분 간격으로 실행
 * - 최근 7일 내 발행된 게시물만 수집 (API 호출 최소화)
 */

import { getDb } from "../../db";
import { mktChannelPosts, mktAccounts, mktAnalytics } from "../../../drizzle/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import { getAdapter } from "./platformAdapters";

let collectorInterval: ReturnType<typeof setInterval> | null = null;

export function startAnalyticsCollector() {
  if (collectorInterval) {
    console.log("[Marketing Analytics] Already running");
    return;
  }

  console.log("[Marketing Analytics] Starting (30min interval)...");
  collectorInterval = setInterval(collectAll, 30 * 60_000);
  // 5분 후 첫 실행 (서버 시작 직후 부하 방지)
  setTimeout(collectAll, 5 * 60_000);
}

export function stopAnalyticsCollector() {
  if (collectorInterval) {
    clearInterval(collectorInterval);
    collectorInterval = null;
    console.log("[Marketing Analytics] Stopped");
  }
}

async function collectAll() {
  try {
    const db = await getDb();
    if (!db) return;

    const weekAgo = new Date(Date.now() - 7 * 86400000)
      .toISOString().replace("T", " ").slice(0, 19);

    // 최근 7일 내 발행된 게시물 (remotePostId 있는 것만)
    const publishedPosts = await db.select().from(mktChannelPosts)
      .where(and(
        eq(mktChannelPosts.publishStatus, "published"),
        gte(mktChannelPosts.publishedAt, weekAgo),
      ))
      .limit(100);

    if (publishedPosts.length === 0) return;

    console.log(`[Marketing Analytics] Collecting analytics for ${publishedPosts.length} posts...`);

    // 계정 토큰 캐시
    const accountCache = new Map<number, any>();

    let collected = 0;
    for (const post of publishedPosts) {
      if (!post.remotePostId) continue;

      const adapter = getAdapter(post.platform);
      if (!adapter) continue;

      // 계정 조회 (캐시)
      let account = null;
      if (post.accountId) {
        if (accountCache.has(post.accountId)) {
          account = accountCache.get(post.accountId);
        } else {
          const [acc] = await db.select().from(mktAccounts)
            .where(eq(mktAccounts.id, post.accountId))
            .limit(1);
          account = acc;
          if (acc) accountCache.set(post.accountId, acc);
        }
      }

      if (!account?.accessToken) {
        // accountId 없으면 유저의 해당 플랫폼 첫 active 계정 사용
        const [acc] = await db.select().from(mktAccounts)
          .where(and(
            eq(mktAccounts.userId, post.userId),
            eq(mktAccounts.platform, post.platform),
            eq(mktAccounts.status, "active"),
          ))
          .limit(1);
        account = acc;
      }

      if (!account?.accessToken) continue;

      try {
        const analytics = await adapter.fetchAnalytics(
          account.accessToken, post.remotePostId, account.meta
        );

        // 스냅샷 저장
        await db.insert(mktAnalytics).values({
          channelPostId: post.id,
          platform: post.platform,
          views: analytics.views,
          likes: analytics.likes,
          comments: analytics.comments,
          shares: analytics.shares,
          clicks: analytics.clicks,
          reach: analytics.reach || 0,
          impressions: analytics.impressions || 0,
          ctr: analytics.impressions && analytics.impressions > 0
            ? ((analytics.clicks / analytics.impressions) * 100).toFixed(2)
            : null,
        });

        collected++;
      } catch (err) {
        console.warn(`[Marketing Analytics] Failed for post #${post.id}:`, err);
      }
    }

    if (collected > 0) {
      console.log(`[Marketing Analytics] Collected ${collected} snapshots`);
    }
  } catch (err) {
    console.error("[Marketing Analytics] Error:", err);
  }
}

/**
 * 특정 게시물의 성과를 즉시 수집
 */
export async function collectForPost(postId: number): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;

    const [post] = await db.select().from(mktChannelPosts)
      .where(eq(mktChannelPosts.id, postId))
      .limit(1);

    if (!post || !post.remotePostId) return false;

    const adapter = getAdapter(post.platform);
    if (!adapter) return false;

    let account = null;
    if (post.accountId) {
      const [acc] = await db.select().from(mktAccounts)
        .where(eq(mktAccounts.id, post.accountId)).limit(1);
      account = acc;
    }
    if (!account?.accessToken) {
      const [acc] = await db.select().from(mktAccounts)
        .where(and(
          eq(mktAccounts.userId, post.userId),
          eq(mktAccounts.platform, post.platform),
          eq(mktAccounts.status, "active"),
        )).limit(1);
      account = acc;
    }
    if (!account?.accessToken) return false;

    const analytics = await adapter.fetchAnalytics(account.accessToken, post.remotePostId, account.meta);

    await db.insert(mktAnalytics).values({
      channelPostId: post.id,
      platform: post.platform,
      views: analytics.views,
      likes: analytics.likes,
      comments: analytics.comments,
      shares: analytics.shares,
      clicks: analytics.clicks,
      reach: analytics.reach || 0,
      impressions: analytics.impressions || 0,
      ctr: analytics.impressions && analytics.impressions > 0
        ? ((analytics.clicks / analytics.impressions) * 100).toFixed(2)
        : null,
    });

    return true;
  } catch {
    return false;
  }
}
