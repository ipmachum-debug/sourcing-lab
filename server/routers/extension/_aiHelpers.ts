/**
 * Extension AI 헬퍼 함수
 * callOpenAI, buildMarketDataSummary, generateReviewAnalysis, generateRuleBasedAnalysis
 */
import { N } from "./_helpers";

export async function callOpenAI(messages: { role: string; content: string }[], options?: { temperature?: number; maxTokens?: number }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY 환경변수가 설정되지 않았습니다.");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 3000,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error("[OpenAI] API error:", res.status, errBody);
    throw new Error(`OpenAI API 오류 (${res.status}): ${errBody.slice(0, 200)}`);
  }

  const data = await res.json() as any;
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI 응답이 비어있습니다.");

  return JSON.parse(content);
}

/** 시장 데이터 통계 요약 생성 (GPT 프롬프트용) */
export function buildMarketDataSummary(
  query: string,
  snapshot: any,
  items: any[],
  candidates: any[],
  historicalSnapshots: any[]
) {
  const avgPrice = snapshot.avgPrice || 0;
  const avgRating = parseFloat(snapshot.avgRating) || 0;
  const avgReview = snapshot.avgReview || 0;
  const competitionScore = snapshot.competitionScore || 0;
  const totalItems = items.length;

  const prices = items.map((i: any) => i.price).filter((p: number) => p > 0);
  const priceMin = prices.length ? Math.min(...prices) : 0;
  const priceMax = prices.length ? Math.max(...prices) : 0;

  const highReviewItems = items.filter((i: any) => (i.reviewCount || 0) >= 100);
  const lowReviewItems = items.filter((i: any) => (i.reviewCount || 0) < 10);
  const noReviewItems = items.filter((i: any) => (i.reviewCount || 0) === 0);
  const lowRatingItems = items.filter((i: any) => i.rating > 0 && i.rating < 3.5);
  const adItems = items.filter((i: any) => i.isAd);
  const rocketItems = items.filter((i: any) => i.isRocket);

  // 상위 10개 상품 요약
  const topItemsSummary = items.slice(0, 10).map((item: any, idx: number) => ({
    rank: idx + 1,
    title: (item.title || "").slice(0, 60),
    price: item.price,
    rating: item.rating,
    reviewCount: item.reviewCount || 0,
    isAd: !!item.isAd,
    isRocket: !!item.isRocket,
  }));

  // 트렌드 데이터
  let trendData = "";
  if (historicalSnapshots.length >= 2) {
    const oldComp = historicalSnapshots[historicalSnapshots.length - 1]?.competitionScore || 0;
    const newComp = snapshot.competitionScore || 0;
    const oldPrice = historicalSnapshots[historicalSnapshots.length - 1]?.avgPrice || 0;
    trendData = `경쟁도 변화: ${oldComp} → ${newComp}, 평균가 변화: ${oldPrice.toLocaleString()}원 → ${avgPrice.toLocaleString()}원 (${historicalSnapshots.length}회 기록)`;
  }

  return {
    summary: `
[쿠팡 시장 데이터 - "${query}" 키워드]
- 분석 상품 수: ${totalItems}개
- 평균 판매가: ${avgPrice.toLocaleString()}원 (최저 ${priceMin.toLocaleString()}원 ~ 최고 ${priceMax.toLocaleString()}원)
- 평균 평점: ${avgRating}점
- 평균 리뷰 수: ${avgReview}개
- 경쟁도 점수: ${competitionScore}점/100
- 리뷰 100개 이상 상품: ${highReviewItems.length}개 (${totalItems ? Math.round(highReviewItems.length / totalItems * 100) : 0}%)
- 리뷰 10개 미만 상품: ${lowReviewItems.length}개 (${totalItems ? Math.round(lowReviewItems.length / totalItems * 100) : 0}%)
- 리뷰 0개 상품: ${noReviewItems.length}개
- 평점 3.5 미만 상품: ${lowRatingItems.length}개
- 광고 상품: ${adItems.length}개 (${totalItems ? Math.round(adItems.length / totalItems * 100) : 0}%)
- 로켓배송 상품: ${rocketItems.length}개 (${totalItems ? Math.round(rocketItems.length / totalItems * 100) : 0}%)
- 후보 저장 수: ${candidates.length}개
${trendData ? `- 트렌드: ${trendData}` : ""}
`.trim(),
    topItems: topItemsSummary,
    stats: {
      avgPrice, avgRating, avgReview, competitionScore, totalItems,
      priceMin, priceMax,
      highReviewCount: highReviewItems.length,
      lowReviewCount: lowReviewItems.length,
      noReviewCount: noReviewItems.length,
      lowRatingCount: lowRatingItems.length,
      adCount: adItems.length,
      rocketCount: rocketItems.length,
    },
  };
}

/** OpenAI GPT 기반 AI 리뷰 분석 */
export async function generateReviewAnalysis(
  query: string,
  snapshot: any,
  items: any[],
  candidates: any[],
  historicalSnapshots: any[]
) {
  const marketData = buildMarketDataSummary(query, snapshot, items, candidates, historicalSnapshots);

  const systemPrompt = `당신은 쿠팡 셀러를 위한 전문 시장 분석 AI 컨설턴트입니다.
제공된 쿠팡 검색 결과 데이터를 분석하여 소싱 판단에 도움이 되는 심층 분석을 제공합니다.
반드시 아래 JSON 형식으로 응답하세요. 각 필드는 한국어로 작성합니다.

응답 JSON 형식:
{
  "painPoints": [{"point": "문제점 제목", "severity": "high|medium|low", "detail": "구체적 설명"}],
  "customerNeeds": [{"need": "고객 니즈", "priority": "high|medium|low", "insight": "분석 근거"}],
  "opportunities": [{"title": "기회 제목", "potential": "high|medium|low", "description": "상세 설명"}],
  "commonPraises": ["긍정적 패턴 1", "긍정적 패턴 2"],
  "commonComplaints": ["부정적 패턴 1", "부정적 패턴 2"],
  "priceSensitivity": "high|medium|low",
  "qualityConcerns": ["품질 우려사항 1", "품질 우려사항 2"],
  "recommendations": [{"action": "구체적 행동 지침", "priority": "high|medium|low", "expectedImpact": "기대 효과"}],
  "trendInsight": "트렌드 분석 한 줄 요약",
  "summaryText": "전체 분석 요약 (2-3문장)"
}

분석 시 고려사항:
1. 경쟁도 점수(0-100): 0에 가까울수록 블루오션, 100에 가까울수록 레드오션
2. 리뷰 100개 이상 비율이 높으면 신규 진입 장벽이 높음
3. 로켓배송 비율이 높으면 배송 경쟁력 필수
4. 광고 비율이 높으면 CPC 경쟁 심함
5. 가격대와 경쟁도를 종합하여 마진 가능성 분석
6. 실제 소싱 셀러가 바로 행동할 수 있는 구체적 추천 제공
7. 각 항목은 최소 2개, 최대 5개로 제한`;

  const userPrompt = `다음 쿠팡 시장 데이터를 분석하여 소싱 전략 보고서를 작성해주세요.

${marketData.summary}

[상위 10개 상품 상세]
${JSON.stringify(marketData.topItems, null, 2)}

위 데이터를 기반으로 시장 진입 가능성, 고객 니즈, 소싱 기회, 위험 요소를 종합적으로 분석해주세요.`;

  try {
    const gptResult = await callOpenAI([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ], { temperature: 0.7, maxTokens: 3000 });

    // GPT 결과를 표준 형식으로 정규화
    return {
      avgRating: marketData.stats.avgRating,
      avgReviewCount: marketData.stats.avgReview,
      painPoints: gptResult.painPoints || [],
      customerNeeds: gptResult.customerNeeds || [],
      opportunities: gptResult.opportunities || [],
      commonPraises: gptResult.commonPraises || [],
      commonComplaints: gptResult.commonComplaints || [],
      priceSensitivity: gptResult.priceSensitivity || "medium",
      qualityConcerns: gptResult.qualityConcerns || [],
      summaryText: gptResult.summaryText || "",
      recommendations: gptResult.recommendations || [],
      trendInsight: gptResult.trendInsight || "",
      aiPowered: true,
      marketOverview: {
        totalItems: marketData.stats.totalItems,
        avgPrice: marketData.stats.avgPrice,
        priceMin: marketData.stats.priceMin,
        priceMax: marketData.stats.priceMax,
        priceRange: marketData.stats.priceMax - marketData.stats.priceMin,
        avgRating: marketData.stats.avgRating,
        avgReview: marketData.stats.avgReview,
        competitionScore: marketData.stats.competitionScore,
        adRatio: marketData.stats.totalItems ? Math.round(marketData.stats.adCount / marketData.stats.totalItems * 100) : 0,
        rocketRatio: marketData.stats.totalItems ? Math.round(marketData.stats.rocketCount / marketData.stats.totalItems * 100) : 0,
        highReviewRatio: marketData.stats.totalItems ? Math.round(marketData.stats.highReviewCount / marketData.stats.totalItems * 100) : 0,
        noReviewRatio: marketData.stats.totalItems ? Math.round(marketData.stats.noReviewCount / marketData.stats.totalItems * 100) : 0,
      },
    };
  } catch (error: any) {
    console.error("[AI Analysis] OpenAI failed, falling back to rule-based:", error.message);
    // OpenAI 실패 시 규칙 기반 폴백
    return generateRuleBasedAnalysis(query, snapshot, items, candidates, historicalSnapshots);
  }
}

/** 규칙 기반 폴백 분석 (OpenAI 장애 시 사용) */
export function generateRuleBasedAnalysis(
  query: string,
  snapshot: any,
  items: any[],
  candidates: any[],
  historicalSnapshots: any[]
) {
  const avgPrice = snapshot.avgPrice || 0;
  const avgRating = parseFloat(snapshot.avgRating) || 0;
  const avgReview = snapshot.avgReview || 0;
  const competitionScore = snapshot.competitionScore || 0;
  const totalItems = items.length;

  const prices = items.map((i: any) => i.price).filter((p: number) => p > 0);
  const priceMin = prices.length ? Math.min(...prices) : 0;
  const priceMax = prices.length ? Math.max(...prices) : 0;
  const priceRange = priceMax - priceMin;

  const highReviewItems = items.filter((i: any) => (i.reviewCount || 0) >= 100);
  const lowReviewItems = items.filter((i: any) => (i.reviewCount || 0) < 10);
  const noReviewItems = items.filter((i: any) => (i.reviewCount || 0) === 0);
  const lowRatingItems = items.filter((i: any) => i.rating > 0 && i.rating < 3.5);
  const adItems = items.filter((i: any) => i.isAd);
  const rocketItems = items.filter((i: any) => i.isRocket);

  let priceSensitivity: string;
  if (priceRange > avgPrice * 0.8) priceSensitivity = "high";
  else if (priceRange > avgPrice * 0.4) priceSensitivity = "medium";
  else priceSensitivity = "low";

  const painPoints: { point: string; severity: string; detail: string }[] = [];
  if (competitionScore >= 70) painPoints.push({ point: "높은 경쟁 강도", severity: "high", detail: `경쟁도 ${competitionScore}점으로 매우 치열합니다.` });
  if (highReviewItems.length > totalItems * 0.5) painPoints.push({ point: "리뷰 장벽 높음", severity: "high", detail: `${Math.round(highReviewItems.length / totalItems * 100)}%가 리뷰 100개 이상` });
  if (rocketItems.length > totalItems * 0.5) painPoints.push({ point: "로켓배송 비율 높음", severity: "medium", detail: `${Math.round(rocketItems.length / totalItems * 100)}%가 로켓배송` });
  if (adItems.length > totalItems * 0.3) painPoints.push({ point: "광고 비율 높음", severity: "medium", detail: `${adItems.length}개(${Math.round(adItems.length / totalItems * 100)}%)가 광고` });

  const customerNeeds: { need: string; priority: string; insight: string }[] = [];
  if (lowRatingItems.length > 0) customerNeeds.push({ need: "품질 개선", priority: "high", insight: `평점 3.5 미만 ${lowRatingItems.length}개` });
  customerNeeds.push({ need: "빠른 배송", priority: rocketItems.length > totalItems * 0.3 ? "high" : "medium", insight: `로켓배송 ${rocketItems.length}개` });

  const opportunities: { title: string; potential: string; description: string }[] = [];
  if (competitionScore < 45) opportunities.push({ title: "블루오션 시장", potential: "high", description: `경쟁도 ${competitionScore}점` });
  if (lowReviewItems.length > totalItems * 0.3) opportunities.push({ title: "리뷰 취약 상품 다수", potential: "high", description: `리뷰 10개 미만 ${lowReviewItems.length}개` });
  if (avgPrice > 20000 && competitionScore < 60) opportunities.push({ title: "고마진 + 낮은 경쟁", potential: "high", description: `평균가 ${avgPrice.toLocaleString()}원` });

  const recommendations: { action: string; priority: string; expectedImpact: string }[] = [];
  if (competitionScore < 50 && avgPrice > 15000) recommendations.push({ action: `"${query}" 키워드 즉시 소싱 검토`, priority: "high", expectedImpact: "마진 확보 유리" });
  recommendations.push({ action: "상위 상품 벤치마크 분석", priority: "medium", expectedImpact: "차별화 포인트 도출" });

  let trendInsight = "";
  if (historicalSnapshots.length >= 2) {
    const oldComp = historicalSnapshots[historicalSnapshots.length - 1]?.competitionScore || 0;
    const newComp = snapshot.competitionScore || 0;
    if (newComp > oldComp + 10) trendInsight = "⚠️ 경쟁 증가 추세";
    else if (newComp < oldComp - 10) trendInsight = "✅ 경쟁 감소 추세";
    else trendInsight = "→ 경쟁 안정적";
  }

  const summaryText = `[규칙기반] "${query}" 분석: ${totalItems}개 상품, 경쟁도 ${competitionScore}점, 평균가 ${avgPrice.toLocaleString()}원. ${opportunities.length}개 기회, ${painPoints.length}개 주의사항.`;

  return {
    avgRating, avgReviewCount: avgReview,
    painPoints, customerNeeds, opportunities,
    commonPraises: avgRating >= 4.0 ? ["전반적 만족도 높음"] : [],
    commonComplaints: lowRatingItems.length > 0 ? ["품질 편차 존재"] : [],
    priceSensitivity, qualityConcerns: lowRatingItems.length > 0 ? [`저평점 상품 ${lowRatingItems.length}개`] : [],
    summaryText, recommendations, trendInsight,
    aiPowered: false,
    marketOverview: {
      totalItems, avgPrice, priceMin, priceMax, priceRange, avgRating, avgReview, competitionScore,
      adRatio: totalItems ? Math.round(adItems.length / totalItems * 100) : 0,
      rocketRatio: totalItems ? Math.round(rocketItems.length / totalItems * 100) : 0,
      highReviewRatio: totalItems ? Math.round(highReviewItems.length / totalItems * 100) : 0,
      noReviewRatio: totalItems ? Math.round(noReviewItems.length / totalItems * 100) : 0,
    },
  };
}

// ============================================================
//  자동 키워드 일별 통계 계산 헬퍼
// ============================================================
