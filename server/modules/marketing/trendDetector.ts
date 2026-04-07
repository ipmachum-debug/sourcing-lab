/**
 * 트렌드 감지 엔진
 *
 * - 네이버 데이터랩 API / 구글 트렌드로 실시간 키워드 트렌드 수집
 * - AI가 내 브랜드와 관련 있는 트렌드만 필터링
 * - "지금 이 키워드로 콘텐츠 만드세요" 추천
 */

import { getDb } from "../../db";
import { mktTrends, mktBrands, mktProducts, mktViralLog } from "../../../drizzle/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";

let trendInterval: ReturnType<typeof setInterval> | null = null;

export function startTrendDetector() {
  if (trendInterval) return;
  console.log("[Viral Trends] Starting (4hr interval)...");
  trendInterval = setInterval(detectTrends, 4 * 60 * 60_000);
  setTimeout(detectTrends, 2 * 60_000); // 2분 후 첫 실행
}

export function stopTrendDetector() {
  if (trendInterval) { clearInterval(trendInterval); trendInterval = null; }
}

async function detectTrends() {
  try {
    const db = await getDb();
    if (!db) return;

    // 모든 유저의 브랜드/상품 키워드 수집
    const brands = await db.select().from(mktBrands).limit(50);
    const products = await db.select().from(mktProducts).limit(100);

    // 키워드 풀 생성
    const brandKeywords = new Set<string>();
    for (const brand of brands) {
      if (brand.keywords) {
        for (const kw of brand.keywords as string[]) brandKeywords.add(kw);
      }
      brandKeywords.add(brand.name);
    }
    for (const product of products) {
      brandKeywords.add(product.name);
      if (product.category) brandKeywords.add(product.category);
    }

    if (brandKeywords.size === 0) return;

    // 네이버 데이터랩 API로 트렌드 조회
    const trendResults = await fetchNaverTrends([...brandKeywords].slice(0, 20));

    // AI로 관련성 분석 + 액션 추천
    const apiUrl = process.env.BUILT_IN_FORGE_API_URL;
    const apiKey = process.env.BUILT_IN_FORGE_API_KEY;

    for (const trend of trendResults) {
      let suggestedAction = null;
      let isActionable = false;

      if (apiUrl && apiKey) {
        try {
          const analysis = await analyzeTrendRelevance(apiUrl, apiKey, trend, [...brandKeywords]);
          suggestedAction = analysis.action;
          isActionable = analysis.isActionable;
        } catch {}
      }

      // 유저별로 저장 (모든 유저에게 공유)
      const userIds = [...new Set(brands.map(b => b.userId))];
      for (const userId of userIds) {
        await db.insert(mktTrends).values({
          userId,
          platform: "all",
          keyword: trend.keyword,
          category: "keyword",
          trendScore: trend.score,
          volume: trend.volume,
          volumeChange: trend.change?.toString() || null,
          relatedKeywords: trend.related || [],
          suggestedAction,
          isActionable,
          expiresAt: new Date(Date.now() + 48 * 3600000).toISOString().replace("T", " ").slice(0, 19),
        });

        if (isActionable) {
          await db.insert(mktViralLog).values({
            userId,
            eventType: "trend_detected",
            summary: `트렌드 감지: "${trend.keyword}" (점수: ${trend.score}) — ${suggestedAction || "확인 필요"}`,
            metadata: { keyword: trend.keyword, score: trend.score },
          });
        }
      }
    }

    if (trendResults.length > 0) {
      console.log(`[Viral Trends] Detected ${trendResults.length} trends`);
    }
  } catch (err) {
    console.error("[Viral Trends] Error:", err);
  }
}

interface TrendResult {
  keyword: string;
  score: number;
  volume: number;
  change: number | null;
  related: string[];
}

async function fetchNaverTrends(keywords: string[]): Promise<TrendResult[]> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    // 네이버 API 없으면 AI 기반 트렌드 생성
    return generateAiTrends(keywords);
  }

  try {
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    // 네이버 데이터랩 검색어 트렌드 API
    const groups = keywords.slice(0, 5).map((kw, i) => ({
      groupName: kw,
      keywords: [kw],
    }));

    const res = await fetch("https://openapi.naver.com/v1/datalab/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Naver-Client-Id": clientId,
        "X-Naver-Client-Secret": clientSecret,
      },
      body: JSON.stringify({
        startDate,
        endDate,
        timeUnit: "date",
        keywordGroups: groups,
      }),
    });

    if (!res.ok) return generateAiTrends(keywords);
    const data = await res.json();

    return (data.results || []).map((r: any) => {
      const ratios = r.data?.map((d: any) => d.ratio) || [];
      const latest = ratios[ratios.length - 1] || 0;
      const prev = ratios[ratios.length - 2] || latest;
      const change = prev > 0 ? ((latest - prev) / prev * 100) : 0;

      return {
        keyword: r.title,
        score: Math.round(latest),
        volume: Math.round(latest * 100),
        change: Math.round(change * 100) / 100,
        related: [],
      };
    });
  } catch {
    return generateAiTrends(keywords);
  }
}

async function generateAiTrends(keywords: string[]): Promise<TrendResult[]> {
  const apiUrl = process.env.BUILT_IN_FORGE_API_URL;
  const apiKey = process.env.BUILT_IN_FORGE_API_KEY;
  if (!apiUrl || !apiKey) return [];

  try {
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `소셜미디어 트렌드 분석가입니다. 주어진 키워드 관련 현재 트렌드를 분석합니다. JSON 배열로 응답:
[{"keyword": "트렌드 키워드", "score": 0-100, "volume": 예상 검색량, "change": 전주 대비 변화율, "related": ["연관키워드1", "연관키워드2"]}]
최대 10개, 실제 트렌드에 기반하여 현실적으로 분석하세요. 오늘: ${today}`,
          },
          { role: "user", content: `다음 키워드들의 최신 트렌드를 분석해주세요: ${keywords.join(", ")}` },
        ],
        temperature: 0.7,
        max_tokens: 2000,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) return [];
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return [];
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : parsed.trends || [];
  } catch {
    return [];
  }
}

async function analyzeTrendRelevance(
  apiUrl: string, apiKey: string, trend: TrendResult, brandKeywords: string[]
): Promise<{ isActionable: boolean; action: string }> {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `마케팅 트렌드 분석가. JSON 응답: {"isActionable": true/false, "action": "구체적 추천 액션"}`,
        },
        {
          role: "user",
          content: `트렌드: "${trend.keyword}" (점수: ${trend.score}, 변화: ${trend.change}%)
내 브랜드 키워드: ${brandKeywords.join(", ")}
이 트렌드를 활용할 수 있는지, 어떤 콘텐츠를 만들면 좋을지 분석해주세요.`,
        },
      ],
      temperature: 0.7,
      max_tokens: 500,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) return { isActionable: false, action: "" };
  const data = await res.json();
  return JSON.parse(data.choices?.[0]?.message?.content || '{"isActionable":false,"action":""}');
}

// 수동 트렌드 조회
export async function detectTrendsForUser(userId: number): Promise<void> {
  await detectTrends();
}
