/**
 * 크로스 포스팅 엔진
 *
 * - 바이럴 감지된 게시물을 다른 채널 포맷으로 자동 변환
 * - AI가 각 플랫폼에 맞게 카피 최적화
 * - 변환 후 발행 큐에 자동 등록
 */

import { getDb } from "../../db";
import {
  mktCrossPosts, mktChannelPosts, mktContentItems, mktViralLog,
} from "../../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";

let crossInterval: ReturnType<typeof setInterval> | null = null;

export function startCrossPoster() {
  if (crossInterval) return;
  console.log("[Viral CrossPost] Starting (15min interval)...");
  crossInterval = setInterval(processPending, 15 * 60_000);
  setTimeout(processPending, 8 * 60_000);
}

export function stopCrossPoster() {
  if (crossInterval) { clearInterval(crossInterval); crossInterval = null; }
}

const PLATFORM_SPECS: Record<string, { name: string; maxCaption: number; style: string }> = {
  instagram: { name: "인스타그램", maxCaption: 2200, style: "감성적, 이모지 활용, 스토리텔링" },
  youtube: { name: "유튜브", maxCaption: 5000, style: "정보성, SEO 최적화, 타임스탬프" },
  tiktok: { name: "틱톡", maxCaption: 4000, style: "짧고 임팩트, 훅 강조, 트렌디" },
  naver_blog: { name: "네이버 블로그", maxCaption: 50000, style: "SEO 최적화, 상세 후기형, 소제목 활용" },
};

async function processPending() {
  try {
    const db = await getDb();
    if (!db) return;

    const pending = await db.select().from(mktCrossPosts)
      .where(eq(mktCrossPosts.status, "pending"))
      .limit(10);

    if (pending.length === 0) return;

    console.log(`[Viral CrossPost] Processing ${pending.length} cross-posts...`);

    for (const cp of pending) {
      await convertAndQueue(db, cp);
    }
  } catch (err) {
    console.error("[Viral CrossPost] Error:", err);
  }
}

async function convertAndQueue(db: any, crossPost: any) {
  // 원본 게시물 조회
  const [sourcePost] = await db.select().from(mktChannelPosts)
    .where(eq(mktChannelPosts.id, crossPost.sourcePostId))
    .limit(1);

  if (!sourcePost) {
    await db.update(mktCrossPosts).set({ status: "failed" } as any)
      .where(eq(mktCrossPosts.id, crossPost.id));
    return;
  }

  // converting 상태로
  await db.update(mktCrossPosts).set({ status: "converting" } as any)
    .where(eq(mktCrossPosts.id, crossPost.id));

  const targetSpec = PLATFORM_SPECS[crossPost.targetPlatform];
  if (!targetSpec) {
    await db.update(mktCrossPosts).set({ status: "failed" } as any)
      .where(eq(mktCrossPosts.id, crossPost.id));
    return;
  }

  // AI로 타겟 플랫폼에 맞게 변환
  const apiUrl = process.env.BUILT_IN_FORGE_API_URL;
  const apiKey = process.env.BUILT_IN_FORGE_API_KEY;

  let convertedCaption = sourcePost.caption || "";
  let convertedTitle = sourcePost.title || "";
  let convertedHashtags = (sourcePost.hashtags as string[]) || [];

  if (apiUrl && apiKey) {
    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `소셜미디어 콘텐츠 변환 전문가. 한 플랫폼의 콘텐츠를 다른 플랫폼에 맞게 변환합니다.
JSON 응답: {"title": "제목", "caption": "캡션", "hashtags": ["해시태그"]}`,
            },
            {
              role: "user",
              content: `다음 ${PLATFORM_SPECS[crossPost.sourcePlatform]?.name || crossPost.sourcePlatform} 콘텐츠를 ${targetSpec.name}용으로 변환해주세요.

원본 제목: ${sourcePost.title || "없음"}
원본 캡션: ${sourcePost.caption || "없음"}
원본 해시태그: ${JSON.stringify(sourcePost.hashtags || [])}

타겟 플랫폼 특성: ${targetSpec.style}
캡션 제한: ${targetSpec.maxCaption}자`,
            },
          ],
          temperature: 0.8,
          max_tokens: 2000,
          response_format: { type: "json_object" },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const converted = JSON.parse(data.choices?.[0]?.message?.content || "{}");
        convertedTitle = converted.title || convertedTitle;
        convertedCaption = converted.caption || convertedCaption;
        convertedHashtags = converted.hashtags || convertedHashtags;
      }
    } catch {}
  }

  // 새 채널 포스트 생성 (발행 큐에 추가)
  const result = await db.insert(mktChannelPosts).values({
    contentItemId: sourcePost.contentItemId,
    userId: sourcePost.userId,
    platform: crossPost.targetPlatform,
    title: convertedTitle,
    caption: convertedCaption,
    hashtags: convertedHashtags,
    mediaPaths: sourcePost.mediaPaths || [],
    publishStatus: "queued",
    // 30분 후 발행 (검수 시간)
    scheduledAt: new Date(Date.now() + 30 * 60_000).toISOString().replace("T", " ").slice(0, 19),
  });
  const newPostId = Number((result as any)?.[0]?.insertId);

  // 크로스포스트 업데이트
  await db.update(mktCrossPosts).set({
    targetPostId: newPostId,
    status: "ready",
  } as any).where(eq(mktCrossPosts.id, crossPost.id));

  console.log(`[Viral CrossPost] Converted #${crossPost.sourcePostId} (${crossPost.sourcePlatform}) → ${crossPost.targetPlatform}`);
}
