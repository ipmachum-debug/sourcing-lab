/**
 * 리뷰/후기 수집기
 *
 * - 쿠팡/네이버 리뷰를 자동 수집
 * - AI로 감성 분석 + 키워드 추출
 * - 마케팅 소재로 사용 가능한 리뷰 자동 표시
 */

import { getDb } from "../../db";
import { mktReviews, mktViralLog } from "../../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";

let reviewInterval: ReturnType<typeof setInterval> | null = null;

export function startReviewCollector() {
  if (reviewInterval) return;
  console.log("[Viral Reviews] Starting (6hr interval)...");
  reviewInterval = setInterval(collectReviews, 6 * 60 * 60_000);
  setTimeout(collectReviews, 15 * 60_000); // 15분 후 첫 실행
}

export function stopReviewCollector() {
  if (reviewInterval) { clearInterval(reviewInterval); reviewInterval = null; }
}

async function collectReviews() {
  // 현재는 수동 수집 + AI 분석 위주
  // 쿠팡/네이버 스크래핑은 약관 이슈로 수동 등록 기반
  console.log("[Viral Reviews] Check cycle complete");
}

/**
 * 수동 리뷰 등록 + AI 분석
 */
export async function analyzeReview(reviewId: number): Promise<any> {
  const db = await getDb();
  if (!db) return null;

  const [review] = await db.select().from(mktReviews)
    .where(eq(mktReviews.id, reviewId))
    .limit(1);
  if (!review) return null;

  const apiUrl = "https://api.openai.com/v1/chat/completions";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiUrl || !apiKey) return null;

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `고객 리뷰 분석가. 리뷰를 분석하여 JSON 응답:
{
  "sentiment": "positive|neutral|negative",
  "keywords": ["핵심 키워드 1", "키워드 2"],
  "isUsable": true/false (마케팅 소재로 사용 가능 여부),
  "usageIdea": "이 리뷰를 마케팅에 활용하는 방법",
  "highlightQuote": "리뷰에서 가장 인상적인 문구"
}`,
          },
          { role: "user", content: `리뷰 분석:\n별점: ${review.rating}/5\n내용: ${review.content}` },
        ],
        temperature: 0.5,
        max_tokens: 500,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const analysis = JSON.parse(data.choices?.[0]?.message?.content || "{}");

    // 분석 결과 업데이트
    await db.update(mktReviews).set({
      sentiment: analysis.sentiment || null,
      keywords: analysis.keywords || [],
      isUsable: analysis.isUsable || false,
    } as any).where(eq(mktReviews.id, reviewId));

    if (analysis.isUsable) {
      await db.insert(mktViralLog).values({
        userId: review.userId,
        eventType: "review_collected",
        summary: `마케팅 활용 가능 리뷰 발견: "${analysis.highlightQuote || review.content.slice(0, 50)}..."`,
        relatedId: reviewId,
        relatedType: "review",
        metadata: analysis,
      });
    }

    return analysis;
  } catch {
    return null;
  }
}

/**
 * 리뷰를 마케팅 콘텐츠로 변환
 */
export async function convertReviewToContent(
  reviewId: number, platforms: string[]
): Promise<any> {
  const db = await getDb();
  if (!db) return null;

  const [review] = await db.select().from(mktReviews)
    .where(eq(mktReviews.id, reviewId))
    .limit(1);
  if (!review) return null;

  const apiUrl = "https://api.openai.com/v1/chat/completions";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiUrl || !apiKey) return null;

  try {
    const platformNames = platforms.join(", ");
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `고객 후기를 바이럴 마케팅 콘텐츠로 변환하는 전문가. JSON 응답:
{
  "title": "제목",
  "hook": "스크롤 멈추는 훅 문장",
  "body": "본문 (후기 기반 스토리텔링)",
  "hashtags": ["해시태그"],
  "channelPosts": [{"platform": "채널명", "caption": "채널별 최적화 캡션"}]
}`,
          },
          {
            role: "user",
            content: `이 고객 후기를 ${platformNames}용 마케팅 콘텐츠로 만들어주세요:
별점: ${review.rating}/5
후기: ${review.content}
소스: ${review.source}`,
          },
        ],
        temperature: 0.8,
        max_tokens: 2000,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const content = JSON.parse(data.choices?.[0]?.message?.content || "{}");

    // 리뷰 사용됨 표시
    await db.update(mktReviews).set({ isUsed: true } as any)
      .where(eq(mktReviews.id, reviewId));

    return content;
  } catch {
    return null;
  }
}
