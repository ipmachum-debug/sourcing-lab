import { getDb } from "../../db";
import {
  mktChannelPosts, mktContentItems, mktProducts,
  mktAnalytics, mktBrands, mktCampaigns,
} from "../../../drizzle/schema";
import { eq, and, desc, sql, gte, count } from "drizzle-orm";

interface BriefingData {
  summary: string;
  actionItems: { type: string; title: string; description: string; priority: string; link?: string }[];
  alerts: { level: string; message: string; productId?: number }[];
  recommendations: { type: string; content: string; reason: string }[];
}

export async function generateBriefing(userId: number): Promise<BriefingData> {
  const db = await getDb();
  if (!db) {
    return fallbackBriefing();
  }

  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000)
    .toISOString().replace("T", " ").slice(0, 19);

  // 데이터 수집 (병렬)
  const [
    queuedPosts,
    failedPosts,
    recentPublished,
    contentDrafts,
    brands,
  ] = await Promise.all([
    db.select().from(mktChannelPosts)
      .where(and(eq(mktChannelPosts.userId, userId), eq(mktChannelPosts.publishStatus, "queued")))
      .orderBy(mktChannelPosts.scheduledAt)
      .limit(10),
    db.select().from(mktChannelPosts)
      .where(and(eq(mktChannelPosts.userId, userId), eq(mktChannelPosts.publishStatus, "failed")))
      .limit(10),
    db.select().from(mktChannelPosts)
      .where(and(
        eq(mktChannelPosts.userId, userId),
        eq(mktChannelPosts.publishStatus, "published"),
        gte(mktChannelPosts.publishedAt, weekAgo),
      ))
      .orderBy(desc(mktChannelPosts.publishedAt))
      .limit(20),
    db.select().from(mktContentItems)
      .where(and(eq(mktContentItems.userId, userId), eq(mktContentItems.status, "draft")))
      .limit(10),
    db.select().from(mktBrands)
      .where(eq(mktBrands.userId, userId))
      .limit(5),
  ]);

  // AI 요약 시도
  const apiUrl = process.env.BUILT_IN_FORGE_API_URL;
  const apiKey = process.env.BUILT_IN_FORGE_API_KEY;

  if (apiUrl && apiKey) {
    try {
      return await generateAiBriefing({
        apiUrl, apiKey, queuedPosts, failedPosts,
        recentPublished, contentDrafts, brands, today,
      });
    } catch (e) {
      console.warn("[Marketing Briefing] AI 생성 실패, 규칙 기반 폴백:", e);
    }
  }

  // 규칙 기반 폴백
  return buildRuleBasedBriefing({
    queuedPosts, failedPosts, recentPublished, contentDrafts, brands, today,
  });
}

async function generateAiBriefing(ctx: any): Promise<BriefingData> {
  const { apiUrl, apiKey, queuedPosts, failedPosts, recentPublished, contentDrafts, today } = ctx;

  const dataContext = `
오늘: ${today}
대기 중인 발행: ${queuedPosts.length}건
실패한 발행: ${failedPosts.length}건
최근 7일 발행: ${recentPublished.length}건
작성 중인 초안: ${contentDrafts.length}건
${failedPosts.length > 0 ? `실패 상세: ${failedPosts.map((p: any) => `${p.platform}: ${p.errorMessage || "알 수 없는 오류"}`).join(", ")}` : ""}
`;

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
          content: `당신은 소셜미디어 마케팅 AI 비서입니다. 매일 아침 대표에게 브리핑을 제공합니다.
반드시 JSON 형식으로 응답하세요.
{
  "summary": "오늘의 요약 (2-3문장)",
  "actionItems": [{"type": "publish|review|fix|create", "title": "제목", "description": "설명", "priority": "high|medium|low"}],
  "alerts": [{"level": "danger|warning|info", "message": "알림 메시지"}],
  "recommendations": [{"type": "content|timing|platform|audience", "content": "추천 내용", "reason": "이유"}]
}`,
        },
        { role: "user", content: `다음 데이터 기반으로 오늘 마케팅 브리핑을 생성해주세요:\n${dataContext}` },
      ],
      temperature: 0.7,
      max_tokens: 2000,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) throw new Error(`AI API ${response.status}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty AI response");
  return JSON.parse(content);
}

function buildRuleBasedBriefing(ctx: any): BriefingData {
  const { queuedPosts, failedPosts, recentPublished, contentDrafts, today } = ctx;

  const actionItems: BriefingData["actionItems"] = [];
  const alerts: BriefingData["alerts"] = [];
  const recommendations: BriefingData["recommendations"] = [];

  // 실패 알림
  if (failedPosts.length > 0) {
    alerts.push({
      level: "danger",
      message: `발행 실패 ${failedPosts.length}건이 있습니다. 확인이 필요합니다.`,
    });
    actionItems.push({
      type: "fix",
      title: "실패한 발행 확인",
      description: `${failedPosts.length}건의 발행이 실패했습니다. 재시도하거나 원인을 확인하세요.`,
      priority: "high",
    });
  }

  // 대기 중인 발행
  if (queuedPosts.length > 0) {
    actionItems.push({
      type: "review",
      title: `예약 발행 ${queuedPosts.length}건 대기 중`,
      description: "오늘 발행 예정인 콘텐츠를 검토하세요.",
      priority: "medium",
    });
  }

  // 초안 알림
  if (contentDrafts.length > 0) {
    actionItems.push({
      type: "review",
      title: `초안 ${contentDrafts.length}건 검토 대기`,
      description: "승인 대기 중인 콘텐츠가 있습니다.",
      priority: "medium",
    });
  }

  // 발행 없는 날 경고
  if (recentPublished.length === 0) {
    alerts.push({
      level: "warning",
      message: "최근 7일간 발행된 콘텐츠가 없습니다. 콘텐츠를 생성해보세요.",
    });
    recommendations.push({
      type: "content",
      content: "새 콘텐츠를 생성하여 채널 활성도를 유지하세요.",
      reason: "7일 이상 미발행 시 알고리즘 노출이 급감합니다.",
    });
  }

  // 발행 빈도 추천
  if (recentPublished.length > 0 && recentPublished.length < 7) {
    recommendations.push({
      type: "timing",
      content: "발행 빈도를 하루 1회 이상으로 늘려보세요.",
      reason: `최근 7일간 ${recentPublished.length}건만 발행되었습니다.`,
    });
  }

  const summaryParts = [];
  summaryParts.push(`오늘(${today}) 마케팅 현황입니다.`);
  if (queuedPosts.length > 0) summaryParts.push(`발행 대기 ${queuedPosts.length}건`);
  if (failedPosts.length > 0) summaryParts.push(`실패 ${failedPosts.length}건 주의`);
  if (contentDrafts.length > 0) summaryParts.push(`초안 검토 ${contentDrafts.length}건`);
  summaryParts.push(`최근 7일 발행 ${recentPublished.length}건.`);

  return {
    summary: summaryParts.join(" "),
    actionItems,
    alerts,
    recommendations,
  };
}

function fallbackBriefing(): BriefingData {
  const today = new Date().toISOString().slice(0, 10);
  return {
    summary: `${today} 브리핑을 준비 중입니다. 데이터가 쌓이면 AI가 더 정확한 분석을 제공합니다.`,
    actionItems: [
      { type: "create", title: "브랜드 등록", description: "마케팅할 브랜드를 먼저 등록하세요.", priority: "high" },
      { type: "create", title: "상품 등록", description: "홍보할 상품 정보를 입력하세요.", priority: "high" },
      { type: "create", title: "채널 연동", description: "소셜미디어 계정을 연결하세요.", priority: "medium" },
    ],
    alerts: [],
    recommendations: [
      { type: "content", content: "상품을 등록하면 AI가 자동으로 마케팅 카피를 생성합니다.", reason: "첫 콘텐츠 생성을 위한 기본 설정이 필요합니다." },
    ],
  };
}
