/**
 * AI 성과 분석기
 *
 * - 발행된 콘텐츠의 성과 데이터를 AI가 분석
 * - 잘된 훅, 실패 패턴, 다음 추천 액션 자동 생성
 * - 학습 데이터로 축적하여 콘텐츠 생성 품질 향상
 */

import { getDb } from "../../db";
import {
  mktChannelPosts, mktContentItems, mktAnalytics, mktAiFeedback,
} from "../../../drizzle/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";

let analyzerInterval: ReturnType<typeof setInterval> | null = null;

export function startFeedbackAnalyzer() {
  if (analyzerInterval) {
    console.log("[Marketing Feedback] Already running");
    return;
  }

  console.log("[Marketing Feedback] Starting (12hr interval)...");
  // 12시간마다 분석 (하루 2회)
  analyzerInterval = setInterval(analyzeAll, 12 * 60 * 60_000);
  // 30분 후 첫 실행
  setTimeout(analyzeAll, 30 * 60_000);
}

export function stopFeedbackAnalyzer() {
  if (analyzerInterval) {
    clearInterval(analyzerInterval);
    analyzerInterval = null;
    console.log("[Marketing Feedback] Stopped");
  }
}

async function analyzeAll() {
  try {
    const db = await getDb();
    if (!db) return;

    const apiUrl = "https://api.openai.com/v1/chat/completions";
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiUrl || !apiKey) return;

    // 최근 3일 내 발행되었고, 아직 피드백이 없는 콘텐츠
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000)
      .toISOString().replace("T", " ").slice(0, 19);

    const publishedPosts = await db.select().from(mktChannelPosts)
      .where(and(
        eq(mktChannelPosts.publishStatus, "published"),
        gte(mktChannelPosts.publishedAt, threeDaysAgo),
      ))
      .limit(20);

    if (publishedPosts.length === 0) return;

    console.log(`[Marketing Feedback] Analyzing ${publishedPosts.length} posts...`);

    for (const post of publishedPosts) {
      // 이미 피드백 있는지 확인
      const [existing] = await db.select().from(mktAiFeedback)
        .where(and(
          eq(mktAiFeedback.contentItemId, post.contentItemId),
          eq(mktAiFeedback.platform, post.platform),
        ))
        .limit(1);
      if (existing) continue;

      // 성과 데이터 조회
      const analytics = await db.select().from(mktAnalytics)
        .where(eq(mktAnalytics.channelPostId, post.id))
        .orderBy(desc(mktAnalytics.capturedAt))
        .limit(1);

      const stats = analytics[0] || null;

      // 콘텐츠 원본 조회
      const [content] = await db.select().from(mktContentItems)
        .where(eq(mktContentItems.id, post.contentItemId))
        .limit(1);

      if (!content) continue;

      try {
        const feedback = await generateFeedback(apiUrl, apiKey, {
          platform: post.platform,
          title: post.title,
          caption: post.caption,
          masterHook: content.masterHook,
          hashtags: post.hashtags,
          stats,
        });

        await db.insert(mktAiFeedback).values({
          contentItemId: post.contentItemId,
          userId: post.userId,
          platform: post.platform,
          score: feedback.score,
          reason: feedback.reason,
          bestHook: feedback.bestHook,
          badPattern: feedback.badPattern,
          recommendedAction: feedback.recommendedAction,
        });
      } catch (err) {
        console.warn(`[Marketing Feedback] Analysis failed for post #${post.id}:`, err);
      }
    }
  } catch (err) {
    console.error("[Marketing Feedback] Error:", err);
  }
}

interface FeedbackInput {
  platform: string;
  title: string | null;
  caption: string | null;
  masterHook: string | null;
  hashtags: any;
  stats: any;
}

interface FeedbackResult {
  score: number;
  reason: string;
  bestHook: string;
  badPattern: string;
  recommendedAction: string;
}

async function generateFeedback(
  apiUrl: string, apiKey: string, input: FeedbackInput
): Promise<FeedbackResult> {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `당신은 소셜미디어 마케팅 성과 분석 전문가입니다.
게시물의 성과 데이터를 분석하여 피드백을 제공합니다.
반드시 JSON 형식으로 응답하세요:
{
  "score": 1~10 점수,
  "reason": "점수 이유 (2-3문장)",
  "bestHook": "이 게시물에서 잘 된 부분 (훅, 카피, 해시태그 등)",
  "badPattern": "개선이 필요한 부분",
  "recommendedAction": "다음 게시물에 대한 구체적 추천"
}`,
        },
        {
          role: "user",
          content: `다음 게시물의 성과를 분석해주세요:

플랫폼: ${input.platform}
제목: ${input.title || "없음"}
캡션: ${(input.caption || "").slice(0, 500)}
훅: ${input.masterHook || "없음"}
해시태그: ${JSON.stringify(input.hashtags || [])}

성과 데이터:
${input.stats ? `
- 조회수: ${input.stats.views}
- 좋아요: ${input.stats.likes}
- 댓글: ${input.stats.comments}
- 공유: ${input.stats.shares}
- 클릭: ${input.stats.clicks}
- 전환: ${input.stats.conversions}
` : "아직 성과 데이터가 없습니다. 콘텐츠 품질만 평가해주세요."}`,
        },
      ],
      temperature: 0.7,
      max_tokens: 1000,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) throw new Error(`AI API ${response.status}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response");
  return JSON.parse(content);
}

/**
 * 특정 콘텐츠에 대해 즉시 피드백 생성
 */
export async function analyzeSingle(contentItemId: number, platform: string): Promise<FeedbackResult | null> {
  const apiUrl = "https://api.openai.com/v1/chat/completions";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiUrl || !apiKey) return null;

  const db = await getDb();
  if (!db) return null;

  const [content] = await db.select().from(mktContentItems)
    .where(eq(mktContentItems.id, contentItemId))
    .limit(1);
  if (!content) return null;

  // 해당 플랫폼의 발행된 게시물 + 최신 성과
  const [post] = await db.select().from(mktChannelPosts)
    .where(and(
      eq(mktChannelPosts.contentItemId, contentItemId),
      eq(mktChannelPosts.platform, platform as any),
    ))
    .limit(1);

  let stats = null;
  if (post) {
    const [latestAnalytics] = await db.select().from(mktAnalytics)
      .where(eq(mktAnalytics.channelPostId, post.id))
      .orderBy(desc(mktAnalytics.capturedAt))
      .limit(1);
    stats = latestAnalytics;
  }

  return generateFeedback(apiUrl, apiKey, {
    platform,
    title: post?.title || content.masterTitle,
    caption: post?.caption || content.masterBody,
    masterHook: content.masterHook,
    hashtags: post?.hashtags || content.hashtags,
    stats,
  });
}
