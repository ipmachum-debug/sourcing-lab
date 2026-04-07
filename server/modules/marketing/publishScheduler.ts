/**
 * 발행 스케줄러
 *
 * - 1분 간격으로 발행 큐 확인
 * - 예약 시간이 된 게시물을 플랫폼 API로 발행
 * - 실패 시 재시도 (최대 3회)
 * - 하루 게시 횟수 제한 준수
 */

import { getDb } from "../../db";
import { mktChannelPosts, mktAccounts, mktScheduleRules } from "../../../drizzle/schema";
import { eq, and, lte, sql } from "drizzle-orm";
import { getAdapter } from "./platformAdapters";

const MAX_RETRIES = 3;
let schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startPublishScheduler() {
  if (schedulerInterval) {
    console.log("[Marketing Scheduler] Already running");
    return;
  }

  console.log("[Marketing Scheduler] Starting (5min interval)...");
  schedulerInterval = setInterval(processQueue, 5 * 60_000);
  // 즉시 한번 실행
  processQueue();
}

export function stopPublishScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("[Marketing Scheduler] Stopped");
  }
}

async function processQueue() {
  try {
    const db = await getDb();
    if (!db) return;

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    // 예약 시간이 지난 queued 상태의 게시물 조회
    const pendingPosts = await db.select().from(mktChannelPosts)
      .where(and(
        eq(mktChannelPosts.publishStatus, "queued"),
        lte(mktChannelPosts.scheduledAt, now),
      ))
      .limit(10); // 한 번에 최대 10개

    if (pendingPosts.length === 0) return;

    console.log(`[Marketing Scheduler] Processing ${pendingPosts.length} posts...`);

    for (const post of pendingPosts) {
      await publishPost(db, post);
    }
  } catch (err) {
    console.error("[Marketing Scheduler] Error:", err);
  }
}

async function publishPost(db: any, post: any) {
  const adapter = getAdapter(post.platform);
  if (!adapter) {
    await markFailed(db, post.id, `지원하지 않는 플랫폼: ${post.platform}`);
    return;
  }

  // 계정 정보 조회
  let account = null;
  if (post.accountId) {
    const [acc] = await db.select().from(mktAccounts)
      .where(eq(mktAccounts.id, post.accountId))
      .limit(1);
    account = acc;
  }

  if (!account) {
    // accountId가 없으면 해당 플랫폼의 active 계정 중 첫번째
    const [acc] = await db.select().from(mktAccounts)
      .where(and(
        eq(mktAccounts.userId, post.userId),
        eq(mktAccounts.platform, post.platform),
        eq(mktAccounts.status, "active"),
      ))
      .limit(1);
    account = acc;
  }

  if (!account || !account.accessToken) {
    await markFailed(db, post.id, `${post.platform} 연동 계정이 없거나 토큰이 없습니다.`);
    return;
  }

  // publishing 상태로 변경
  await db.update(mktChannelPosts)
    .set({ publishStatus: "publishing" } as any)
    .where(eq(mktChannelPosts.id, post.id));

  try {
    const result = await adapter.publish(account.accessToken, {
      title: post.title || undefined,
      caption: post.caption || "",
      description: post.description || undefined,
      hashtags: (post.hashtags as string[]) || [],
      mediaUrls: (post.mediaPaths as string[]) || [],
    }, account.meta);

    if (result.success) {
      await db.update(mktChannelPosts).set({
        publishStatus: "published",
        remotePostId: result.remotePostId || null,
        remotePostUrl: result.remotePostUrl || null,
        publishedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
        errorMessage: null,
      } as any).where(eq(mktChannelPosts.id, post.id));

      console.log(`[Marketing Scheduler] Published post #${post.id} to ${post.platform}`);
    } else {
      await handleFailure(db, post, result.error || "알 수 없는 오류");
    }
  } catch (err: any) {
    await handleFailure(db, post, err.message || "발행 중 예외 발생");
  }
}

async function handleFailure(db: any, post: any, errorMessage: string) {
  const newRetryCount = (post.retryCount || 0) + 1;

  if (newRetryCount >= MAX_RETRIES) {
    await markFailed(db, post.id, `${errorMessage} (${MAX_RETRIES}회 재시도 후 실패)`);
    console.error(`[Marketing Scheduler] Post #${post.id} permanently failed: ${errorMessage}`);
  } else {
    // 재시도 대기 (2^n분 후 재시도)
    const retryMinutes = Math.pow(2, newRetryCount);
    const retryAt = new Date(Date.now() + retryMinutes * 60_000)
      .toISOString().replace("T", " ").slice(0, 19);

    await db.update(mktChannelPosts).set({
      publishStatus: "queued",
      retryCount: newRetryCount,
      scheduledAt: retryAt,
      errorMessage: `${errorMessage} (재시도 ${newRetryCount}/${MAX_RETRIES})`,
    } as any).where(eq(mktChannelPosts.id, post.id));

    console.warn(`[Marketing Scheduler] Post #${post.id} retry ${newRetryCount}/${MAX_RETRIES} at ${retryAt}`);
  }
}

async function markFailed(db: any, postId: number, errorMessage: string) {
  await db.update(mktChannelPosts).set({
    publishStatus: "failed",
    errorMessage,
  } as any).where(eq(mktChannelPosts.id, postId));
}

/**
 * 수동 발행 트리거
 * 특정 게시물을 즉시 발행
 */
export async function triggerPublish(postId: number): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getDb();
    if (!db) return { success: false, error: "DB 연결 실패" };

    const [post] = await db.select().from(mktChannelPosts)
      .where(eq(mktChannelPosts.id, postId))
      .limit(1);

    if (!post) return { success: false, error: "게시물을 찾을 수 없습니다." };
    if (post.publishStatus === "published") return { success: false, error: "이미 발행된 게시물입니다." };

    await publishPost(db, post);

    // 결과 확인
    const [updated] = await db.select().from(mktChannelPosts)
      .where(eq(mktChannelPosts.id, postId))
      .limit(1);

    return {
      success: updated?.publishStatus === "published",
      error: updated?.errorMessage || undefined,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
