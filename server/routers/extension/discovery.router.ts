/**
 * Extension Sub-Router: AI 제품 발견 v2 (완전 자동)
 *
 * 플로우:
 * 1. 서버가 ext_keyword_daily_stats에서 유망 키워드를 AI로 자동 발견
 * 2. 프론트에서 발견된 키워드 목록 확인 → 유저 "검토 승인"
 * 3. 승인된 키워드가 crawl_queue에 등록 → 확장프로그램이 폴링
 * 4. 확장프로그램이 쿠팡 검색 + 유력 상품 상세 크롤링 → 서버 전송
 * 5. 서버에서 AI 분석 → 상세 결과 출력
 * 6. 유저가 추적/거절 결정
 */
import { z } from "zod";
import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import {
  extDiscoveryJobs,
  extDiscoveryProducts,
  extProductTrackings,
  extKeywordDailyStats,
} from "../../../drizzle/schema";
import { eq, and, desc, sql, inArray, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { N } from "./_helpers";
import { invokeLLM } from "../../_core/llm";

// ============================================================
//  AI 키워드 발견: 기존 크롤링 데이터에서 유망 키워드 추출
// ============================================================
async function discoverPromisingKeywords(userId: number, db: any): Promise<any[]> {
  // 최근 7일 finalized 데이터에서 키워드별 최신 통계 집계
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const dateStr = sevenDaysAgo.toISOString().slice(0, 10);

  const stats = await db.select({
    query: extKeywordDailyStats.query,
    latestDate: sql<string>`MAX(${extKeywordDailyStats.statDate})`,
    avgDemandScore: sql<number>`ROUND(AVG(${extKeywordDailyStats.demandScore}))`,
    avgKeywordScore: sql<number>`ROUND(AVG(${extKeywordDailyStats.keywordScore}))`,
    avgCompetitionScore: sql<number>`ROUND(AVG(${extKeywordDailyStats.competitionScore}))`,
    avgSalesMa7: sql<number>`ROUND(AVG(${extKeywordDailyStats.salesEstimateMa7}))`,
    avgSalesMa30: sql<number>`ROUND(AVG(${extKeywordDailyStats.salesEstimateMa30}))`,
    avgReviewGrowth: sql<number>`ROUND(AVG(${extKeywordDailyStats.reviewGrowth}))`,
    avgPrice: sql<number>`ROUND(AVG(${extKeywordDailyStats.avgPrice}))`,
    avgProductCount: sql<number>`ROUND(AVG(${extKeywordDailyStats.productCount}))`,
    totalDays: sql<number>`COUNT(DISTINCT ${extKeywordDailyStats.statDate})`,
    latestCompLevel: sql<string>`(SELECT competition_level FROM ext_keyword_daily_stats t2 WHERE t2.user_id = ${userId} AND t2.query = ext_keyword_daily_stats.query ORDER BY t2.stat_date DESC LIMIT 1)`,
  })
    .from(extKeywordDailyStats)
    .where(and(
      eq(extKeywordDailyStats.userId, userId),
      gte(extKeywordDailyStats.statDate, dateStr),
      sql`${extKeywordDailyStats.dataStatus} NOT IN ('missing', 'baseline')`,
      eq(extKeywordDailyStats.isFinalized, true),
    ))
    .groupBy(extKeywordDailyStats.query)
    .having(sql`COUNT(DISTINCT ${extKeywordDailyStats.statDate}) >= 2`);

  if (stats.length === 0) return [];

  // 이미 발견된 키워드 제외 (최근 3일 이내)
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  const recentJobs = await db.select({ keyword: extDiscoveryJobs.keyword })
    .from(extDiscoveryJobs)
    .where(and(
      eq(extDiscoveryJobs.userId, userId),
      gte(extDiscoveryJobs.createdAt, threeDaysAgo),
    ));
  const recentKeywords = new Set(recentJobs.map((j: any) => j.keyword));

  // 유망 키워드 점수 계산
  const scored = stats
    .filter((s: any) => !recentKeywords.has(s.query))
    .map((s: any) => {
      const demand = N(s.avgDemandScore);
      const kwScore = N(s.avgKeywordScore);
      const competition = N(s.avgCompetitionScore);
      const salesMa7 = N(s.avgSalesMa7);
      const reviewGrowth = N(s.avgReviewGrowth);
      const price = N(s.avgPrice);

      // 발견 점수: 높은수요 + 높은키워드점수 + 낮은경쟁 + 적절한가격
      let discoveryScore = 0;

      // 수요 점수 (0~30)
      discoveryScore += Math.min(demand * 0.3, 30);

      // 키워드 점수 (0~25)
      discoveryScore += Math.min(kwScore * 0.25, 25);

      // 경쟁 역점수 (낮을수록 좋음, 0~20)
      discoveryScore += Math.max(0, 20 - competition * 0.2);

      // 판매량 (0~15)
      if (salesMa7 > 0) discoveryScore += Math.min(salesMa7 / 2000, 1) * 15;

      // 리뷰 성장 (0~10)
      if (reviewGrowth > 0) discoveryScore += Math.min(reviewGrowth / 50, 1) * 10;

      // 가격대 적합성 (5000~50000원 최적)
      if (price >= 5000 && price <= 50000) discoveryScore += 5;
      else if (price > 50000 && price <= 100000) discoveryScore += 2;

      const reasons: string[] = [];
      if (demand >= 70) reasons.push(`수요 점수 ${demand}점 (높음)`);
      if (competition <= 40) reasons.push(`경쟁 점수 ${competition}점 (낮음)`);
      if (salesMa7 >= 5000) reasons.push(`MA7 판매 추정 ${salesMa7.toLocaleString()}개`);
      if (reviewGrowth >= 10) reasons.push(`일 리뷰 성장 +${reviewGrowth}`);
      if (price >= 10000 && price <= 30000) reasons.push(`소싱 적합 가격대 ${price.toLocaleString()}원`);
      if (kwScore >= 70) reasons.push(`키워드 점수 ${kwScore}점 (우수)`);

      return {
        keyword: s.query,
        discoveryScore: Math.round(discoveryScore),
        demandScore: demand,
        keywordScore: kwScore,
        competitionScore: competition,
        competitionLevel: s.latestCompLevel || "medium",
        salesEstimateMa7: salesMa7,
        salesEstimateMa30: N(s.avgSalesMa30),
        reviewGrowth,
        avgPrice: price,
        productCount: N(s.avgProductCount),
        dataDays: N(s.totalDays),
        latestDate: s.latestDate,
        reasons,
      };
    })
    .filter((s: any) => s.discoveryScore >= 25) // 최소 점수 필터
    .sort((a: any, b: any) => b.discoveryScore - a.discoveryScore);

  return scored.slice(0, 30); // 상위 30개
}

// ============================================================
//  1차 필터링: 검색 결과에서 유력 후보 선별
// ============================================================
function filterCandidates(
  items: any[],
  maxCount: number
): { filtered: any[]; criteria: Record<string, any> } {
  const nonAd = items.filter((it: any) => !it.isAd);
  const avgPrice = nonAd.reduce((s: number, it: any) => s + (it.price || 0), 0) / (nonAd.length || 1);
  const avgReview = nonAd.reduce((s: number, it: any) => s + (it.reviewCount || 0), 0) / (nonAd.length || 1);

  const scored = nonAd.map((it: any, idx: number) => {
    let score = 0;
    const price = it.price || 0;
    const review = it.reviewCount || 0;
    const rating = it.rating || 0;
    const rank = it.rank || idx + 1;

    if (review >= 50 && review <= 500) score += 30;
    else if (review > 500 && review <= 2000) score += 20;
    else if (review > 2000) score += 5;
    else if (review >= 10) score += 15;

    if (rating >= 4.5) score += 20;
    else if (rating >= 4.0) score += 15;
    else if (rating >= 3.5) score += 5;

    if (price >= 5000 && price <= 50000) score += 20;
    else if (price > 50000 && price <= 100000) score += 10;

    if (!it.isRocket) score += 10;

    if (rank <= 5) score += 15;
    else if (rank <= 10) score += 10;
    else if (rank <= 20) score += 5;

    return { ...it, _filterScore: score, _rank: rank };
  });

  scored.sort((a: any, b: any) => b._filterScore - a._filterScore);
  const filtered = scored.slice(0, maxCount);

  return {
    filtered,
    criteria: {
      totalItems: items.length,
      nonAdItems: nonAd.length,
      avgPrice: Math.round(avgPrice),
      avgReview: Math.round(avgReview),
      selectedCount: filtered.length,
      minFilterScore: filtered.length > 0 ? filtered[filtered.length - 1]._filterScore : 0,
    },
  };
}

// ============================================================
//  AI 분석
// ============================================================
async function analyzeProductsWithAI(
  keyword: string,
  searchSummary: any,
  detailResults: any[],
  searchItems: any[]
): Promise<any> {
  const productSummaries = detailResults.map((d: any, i: number) => {
    const searchItem = searchItems.find(
      (s: any) => String(s.productId || s.coupangProductId) === String(d.productId || d.coupangProductId)
    );
    return {
      index: i + 1,
      productId: d.productId || d.coupangProductId,
      title: (d.title || d.productTitle || "").slice(0, 120),
      price: d.price || 0,
      originalPrice: d.originalPrice || 0,
      rating: d.rating || 0,
      reviewCount: d.reviewCount || 0,
      sellerName: d.sellerName || "",
      deliveryType: d.deliveryType || d.delivery || "",
      categoryPath: d.categoryPath || "",
      optionCount: d.optionCount || (d.optionSummary?.length || 0),
      searchRank: searchItem?.rank || searchItem?._rank || 0,
      isRocket: d.isRocket || searchItem?.isRocket || false,
      brandName: d.brandName || "",
      manufacturer: d.manufacturer || "",
      reviewSamples: (d.reviewSamples || []).slice(0, 3).map((r: any) => ({
        rating: r.rating,
        text: (r.text || "").slice(0, 100),
      })),
      soldOut: d.soldOut || false,
    };
  });

  const systemPrompt = `당신은 한국 쿠팡 마켓에서 대박 상품을 발굴하는 AI 소싱 전문가입니다.
유저가 키워드로 검색한 결과와 상세 크롤링 데이터를 기반으로 각 상품의 소싱 가능성을 분석합니다.

분석 기준:
1. 시장 진입 가능성 — 리뷰 1000개 이하의 틈새 시장인지
2. 수익성 — 가격대가 마진 확보에 적합한지 (원가 30~40% 기준)
3. 소싱 난이도 — 중국(1688/알리)에서 유사 상품을 구할 수 있는지
4. 경쟁 강도 — 로켓배송, 광고 비율, 리뷰 양극화
5. 트렌드 — 리뷰 증가 속도, 품절 여부, 가격 변동
6. 차별화 여지 — 옵션, 패키징, 세트 구성으로 차별화 가능한지

반드시 한국어로 응답하세요. 각 상품에 대해 구체적 수치와 함께 근거를 제시하세요.`;

  const userPrompt = `## 키워드: "${keyword}"

## 시장 개요
${JSON.stringify(searchSummary, null, 2)}

## 분석 대상 상품 (${productSummaries.length}개)
${JSON.stringify(productSummaries, null, 2)}

위 상품들을 분석하여 다음 JSON 형식으로 응답해주세요:
{
  "marketOverview": {
    "competitionLevel": "low|medium|high",
    "marketSize": "small|medium|large",
    "entryDifficulty": "easy|medium|hard",
    "summary": "시장 한줄 요약"
  },
  "products": [
    {
      "productId": "상품ID",
      "aiScore": 0~100,
      "grade": "S|A|B|C|D",
      "verdict": "strong_buy|buy|watch|pass",
      "reasons": [
        { "type": "positive|negative|neutral", "category": "market|price|competition|trend|sourcing|differentiation", "text": "구체적 근거" }
      ],
      "risks": [{ "level": "high|medium|low", "text": "리스크 설명" }],
      "opportunities": [{ "text": "기회 요인" }],
      "estimatedMonthlySales": 0,
      "estimatedMarginPercent": 0,
      "sourcingTip": "소싱 팁",
      "differentiationIdea": "차별화 아이디어"
    }
  ],
  "topRecommendation": { "productId": "최고 추천 ID", "reason": "추천 이유" }
}`;

  try {
    const result = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      responseFormat: { type: "json_object" },
      maxTokens: 8192,
    });

    const content = typeof result.choices[0]?.message?.content === "string"
      ? result.choices[0].message.content
      : "";
    return JSON.parse(content);
  } catch (err) {
    console.error("[AI Discovery Analysis] LLM failed:", err);
    return ruleBasedAnalysis(keyword, searchSummary, detailResults, searchItems);
  }
}

function ruleBasedAnalysis(keyword: string, searchSummary: any, detailResults: any[], searchItems: any[]): any {
  const products = detailResults.map((d: any) => {
    const searchItem = searchItems.find(
      (s: any) => String(s.productId || s.coupangProductId) === String(d.productId || d.coupangProductId)
    );
    const price = d.price || 0;
    const review = d.reviewCount || 0;
    const rating = d.rating || 0;
    const rank = searchItem?.rank || searchItem?._rank || 99;

    let score = 0;
    const reasons: any[] = [];
    const risks: any[] = [];
    const opportunities: any[] = [];

    if (review <= 100) { score += 25; reasons.push({ type: "positive", category: "competition", text: `리뷰 ${review}개로 진입 장벽이 낮음` }); }
    else if (review <= 500) { score += 20; reasons.push({ type: "positive", category: "market", text: `리뷰 ${review}개 — 시장 검증됨 + 진입 가능` }); }
    else if (review <= 2000) { score += 10; reasons.push({ type: "neutral", category: "competition", text: `리뷰 ${review}개 — 경쟁 보통` }); }
    else { risks.push({ level: "high", text: "리뷰 수가 많아 신규 진입이 어려움" }); }

    if (price >= 10000 && price <= 30000) { score += 25; reasons.push({ type: "positive", category: "price", text: `가격 ${price.toLocaleString()}원 — 마진 확보 적합` }); }
    else if (price >= 5000 && price <= 50000) { score += 15; }
    else if (price < 5000) { risks.push({ level: "medium", text: "저가 상품 — 마진 확보 어려움" }); }

    if (rating >= 4.5) { score += 15; reasons.push({ type: "positive", category: "market", text: `평점 ${rating} — 고객 만족도 높음` }); }
    else if (rating >= 4.0) score += 10;
    else if (rating < 3.5 && rating > 0) opportunities.push({ text: `평점 ${rating}점 — 품질 개선으로 차별화 가능` });

    if (rank <= 10) { score += 15; reasons.push({ type: "positive", category: "trend", text: `검색 ${rank}위 — 상위 노출` }); }
    if (!searchItem?.isRocket && !d.isRocket) { score += 10; opportunities.push({ text: "로켓배송 아님 — 3P 판매자 시장" }); }
    else risks.push({ level: "medium", text: "로켓배송 — 쿠팡 직매입과 경쟁" });

    const grade = score >= 80 ? "S" : score >= 60 ? "A" : score >= 40 ? "B" : score >= 20 ? "C" : "D";
    const verdict = score >= 70 ? "strong_buy" : score >= 50 ? "buy" : score >= 30 ? "watch" : "pass";

    return {
      productId: String(d.productId || d.coupangProductId),
      aiScore: Math.min(score, 100), grade, verdict,
      reasons, risks, opportunities,
      estimatedMonthlySales: Math.round(review * 0.5),
      estimatedMarginPercent: price >= 10000 ? 30 : price >= 5000 ? 20 : 10,
      sourcingTip: `1688에서 "${keyword}" 관련 제품 검색`,
      differentiationIdea: "세트 구성 또는 패키지 차별화 검토",
    };
  });

  products.sort((a: any, b: any) => b.aiScore - a.aiScore);
  return {
    marketOverview: {
      competitionLevel: searchSummary?.competitionLevel || "medium",
      marketSize: (searchSummary?.totalItems || 0) > 1000 ? "large" : (searchSummary?.totalItems || 0) > 200 ? "medium" : "small",
      entryDifficulty: "medium",
      summary: `"${keyword}" 시장 분석 (규칙 기반)`,
    },
    products,
    topRecommendation: products.length > 0
      ? { productId: products[0].productId, reason: `최고 점수 ${products[0].aiScore}점` }
      : null,
  };
}

// ============================================================
//  라우터
// ============================================================
export const discoveryRouter = router({

  // === 1. AI 유망 키워드 자동 발견 ===
  discoverKeywords: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });
      return discoverPromisingKeywords(ctx.user!.id, db);
    }),

  // === 2. 유저 승인: 키워드 검토 → 크롤링 작업 생성 ===
  approveKeyword: protectedProcedure
    .input(z.object({
      keyword: z.string().min(1).max(255),
      maxDetailProducts: z.number().int().min(1).max(15).default(8),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 중복 체크
      const [existing] = await db.select({ id: extDiscoveryJobs.id })
        .from(extDiscoveryJobs)
        .where(and(
          eq(extDiscoveryJobs.userId, ctx.user!.id),
          eq(extDiscoveryJobs.keyword, input.keyword),
          sql`${extDiscoveryJobs.status} NOT IN ('completed', 'failed')`,
        ))
        .limit(1);

      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: `"${input.keyword}" 이미 진행 중입니다.` });
      }

      const result = await db.insert(extDiscoveryJobs).values({
        userId: ctx.user!.id,
        keyword: input.keyword,
        status: "pending",         // 확장프로그램이 폴링하여 크롤링
        maxPages: 2,
        maxDetailProducts: input.maxDetailProducts,
      });

      const jobId = Number((result as any)?.[0]?.insertId);
      return { success: true, jobId };
    }),

  // === 3. 확장프로그램: 대기 중인 크롤링 작업 폴링 ===
  getCrawlQueue: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const jobs = await db.select({
        id: extDiscoveryJobs.id,
        keyword: extDiscoveryJobs.keyword,
        status: extDiscoveryJobs.status,
        maxPages: extDiscoveryJobs.maxPages,
        maxDetailProducts: extDiscoveryJobs.maxDetailProducts,
        filteredProductIds: extDiscoveryJobs.filteredProductIds,
      })
        .from(extDiscoveryJobs)
        .where(and(
          eq(extDiscoveryJobs.userId, ctx.user!.id),
          sql`${extDiscoveryJobs.status} IN ('pending', 'filtering')`,
        ))
        .orderBy(extDiscoveryJobs.createdAt)
        .limit(5);

      return jobs;
    }),

  // === 4. 확장프로그램: 검색 결과 전송 + 필터링 ===
  submitSearchResults: protectedProcedure
    .input(z.object({
      jobId: z.number().int(),
      items: z.array(z.any()),
      summary: z.object({
        totalItems: z.number().default(0),
        avgPrice: z.number().default(0),
        avgRating: z.number().default(0),
        avgReview: z.number().default(0),
        highReviewRatio: z.number().default(0),
        adCount: z.number().default(0),
        rocketCount: z.number().default(0),
        competitionScore: z.number().default(0),
        competitionLevel: z.string().default("medium"),
      }),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [job] = await db.select()
        .from(extDiscoveryJobs)
        .where(and(
          eq(extDiscoveryJobs.id, input.jobId),
          eq(extDiscoveryJobs.userId, ctx.user!.id),
        ))
        .limit(1);
      if (!job) throw new TRPCError({ code: "NOT_FOUND" });

      const { filtered, criteria } = filterCandidates(input.items, job.maxDetailProducts || 8);

      const filteredIds = filtered.map((it: any) => ({
        productId: String(it.productId || it.coupangProductId),
        title: (it.title || "").slice(0, 100),
        price: it.price || 0,
        reviewCount: it.reviewCount || 0,
        rank: it._rank || 0,
        filterScore: it._filterScore || 0,
        url: it.url || it.productUrl || "",
      }));

      await db.update(extDiscoveryJobs).set({
        status: "filtering",
        searchResultsJson: input.items,
        searchSummaryJson: input.summary,
        filteredProductIds: filteredIds,
        filterCriteria: criteria,
        startedAt: sql`NOW()`,
      }).where(eq(extDiscoveryJobs.id, input.jobId));

      return { success: true, filteredCount: filteredIds.length, filteredProducts: filteredIds };
    }),

  // === 5. 확장프로그램: 상세 크롤링 결과 전송 → AI 분석 시작 ===
  submitDetailResults: protectedProcedure
    .input(z.object({
      jobId: z.number().int(),
      details: z.array(z.any()),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [job] = await db.select()
        .from(extDiscoveryJobs)
        .where(and(
          eq(extDiscoveryJobs.id, input.jobId),
          eq(extDiscoveryJobs.userId, ctx.user!.id),
        ))
        .limit(1);
      if (!job) throw new TRPCError({ code: "NOT_FOUND" });

      await db.update(extDiscoveryJobs).set({
        status: "analyzing",
        detailResultsJson: input.details,
        detailCrawledCount: input.details.length,
      }).where(eq(extDiscoveryJobs.id, input.jobId));

      // 비동기 AI 분석
      runAIAnalysis(ctx.user!.id, input.jobId, db).catch(err => {
        console.error("[Discovery] AI analysis failed:", err);
      });

      return { success: true, analyzing: true };
    }),

  // === 6. 작업 목록 ===
  listJobs: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(50).default(20),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      return db.select({
        id: extDiscoveryJobs.id,
        keyword: extDiscoveryJobs.keyword,
        status: extDiscoveryJobs.status,
        searchSummaryJson: extDiscoveryJobs.searchSummaryJson,
        filterCriteria: extDiscoveryJobs.filterCriteria,
        detailCrawledCount: extDiscoveryJobs.detailCrawledCount,
        aiAnalysisJson: extDiscoveryJobs.aiAnalysisJson,
        errorMessage: extDiscoveryJobs.errorMessage,
        startedAt: extDiscoveryJobs.startedAt,
        completedAt: extDiscoveryJobs.completedAt,
        createdAt: extDiscoveryJobs.createdAt,
      })
        .from(extDiscoveryJobs)
        .where(eq(extDiscoveryJobs.userId, ctx.user!.id))
        .orderBy(desc(extDiscoveryJobs.createdAt))
        .limit(input.limit)
        .offset(input.offset);
    }),

  // === 7. 작업 상세 + 제품 ===
  getJobDetail: protectedProcedure
    .input(z.object({ jobId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [job] = await db.select()
        .from(extDiscoveryJobs)
        .where(and(eq(extDiscoveryJobs.id, input.jobId), eq(extDiscoveryJobs.userId, ctx.user!.id)))
        .limit(1);
      if (!job) throw new TRPCError({ code: "NOT_FOUND" });

      const products = await db.select()
        .from(extDiscoveryProducts)
        .where(eq(extDiscoveryProducts.jobId, input.jobId))
        .orderBy(desc(extDiscoveryProducts.aiScore));

      return { job, products };
    }),

  // === 8. 전체 제품 목록 ===
  listProducts: protectedProcedure
    .input(z.object({
      decision: z.enum(["pending", "track", "reject", "all"]).default("all"),
      limit: z.number().int().min(1).max(100).default(30),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const conditions = [eq(extDiscoveryProducts.userId, ctx.user!.id)];
      if (input.decision !== "all") {
        conditions.push(eq(extDiscoveryProducts.userDecision, input.decision));
      }

      return db.select()
        .from(extDiscoveryProducts)
        .where(and(...conditions))
        .orderBy(desc(extDiscoveryProducts.aiScore))
        .limit(input.limit)
        .offset(input.offset);
    }),

  // === 9. 유저 결정: 추적/거절 ===
  decide: protectedProcedure
    .input(z.object({
      productId: z.number().int(),
      decision: z.enum(["track", "reject"]),
      memo: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [product] = await db.select()
        .from(extDiscoveryProducts)
        .where(and(
          eq(extDiscoveryProducts.id, input.productId),
          eq(extDiscoveryProducts.userId, ctx.user!.id),
        ))
        .limit(1);
      if (!product) throw new TRPCError({ code: "NOT_FOUND" });

      let trackingId: number | null = null;
      if (input.decision === "track") {
        const result = await db.insert(extProductTrackings).values({
          userId: ctx.user!.id,
          sourceType: "manual" as const,
          productName: product.productTitle,
          coupangProductId: product.coupangProductId,
          coupangUrl: product.productUrl,
          imageUrl: product.imageUrl,
          keywords: JSON.stringify([product.keyword]),
          latestPrice: product.price || 0,
          latestRating: product.rating || "0",
          latestReviewCount: product.reviewCount || 0,
          isActive: true,
          trackFrequency: "daily" as const,
        });
        trackingId = Number((result as any)?.[0]?.insertId);
      }

      await db.update(extDiscoveryProducts).set({
        userDecision: input.decision,
        userMemo: input.memo || null,
        trackingId,
        decidedAt: sql`NOW()`,
      }).where(eq(extDiscoveryProducts.id, input.productId));

      return { success: true, trackingId };
    }),

  // === 10. 작업 상태 업데이트 (확장프로그램) ===
  updateJobStatus: protectedProcedure
    .input(z.object({
      jobId: z.number().int(),
      status: z.enum(["crawling_search", "crawling_detail", "failed"]),
      errorMessage: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const updateData: any = { status: input.status };
      if (input.status === "failed") {
        updateData.errorMessage = input.errorMessage || "알 수 없는 오류";
        updateData.completedAt = sql`NOW()`;
      }

      await db.update(extDiscoveryJobs).set(updateData)
        .where(and(
          eq(extDiscoveryJobs.id, input.jobId),
          eq(extDiscoveryJobs.userId, ctx.user!.id),
        ));

      return { success: true };
    }),

  // === 11. 작업 삭제 ===
  deleteJob: protectedProcedure
    .input(z.object({ jobId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.delete(extDiscoveryProducts)
        .where(and(eq(extDiscoveryProducts.jobId, input.jobId), eq(extDiscoveryProducts.userId, ctx.user!.id)));
      await db.delete(extDiscoveryJobs)
        .where(and(eq(extDiscoveryJobs.id, input.jobId), eq(extDiscoveryJobs.userId, ctx.user!.id)));

      return { success: true };
    }),

  // === 12. 대시보드 요약 ===
  overview: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [stats] = await db.select({
        totalJobs: sql<number>`COUNT(*)`,
        completedJobs: sql<number>`SUM(CASE WHEN ${extDiscoveryJobs.status} = 'completed' THEN 1 ELSE 0 END)`,
        pendingJobs: sql<number>`SUM(CASE WHEN ${extDiscoveryJobs.status} NOT IN ('completed', 'failed') THEN 1 ELSE 0 END)`,
        failedJobs: sql<number>`SUM(CASE WHEN ${extDiscoveryJobs.status} = 'failed' THEN 1 ELSE 0 END)`,
      })
        .from(extDiscoveryJobs)
        .where(eq(extDiscoveryJobs.userId, ctx.user!.id));

      const [productStats] = await db.select({
        totalProducts: sql<number>`COUNT(*)`,
        pendingDecision: sql<number>`SUM(CASE WHEN ${extDiscoveryProducts.userDecision} = 'pending' THEN 1 ELSE 0 END)`,
        tracked: sql<number>`SUM(CASE WHEN ${extDiscoveryProducts.userDecision} = 'track' THEN 1 ELSE 0 END)`,
        rejected: sql<number>`SUM(CASE WHEN ${extDiscoveryProducts.userDecision} = 'reject' THEN 1 ELSE 0 END)`,
        avgScore: sql<number>`ROUND(AVG(${extDiscoveryProducts.aiScore}))`,
      })
        .from(extDiscoveryProducts)
        .where(eq(extDiscoveryProducts.userId, ctx.user!.id));

      return {
        totalJobs: N(stats?.totalJobs),
        completedJobs: N(stats?.completedJobs),
        pendingJobs: N(stats?.pendingJobs),
        failedJobs: N(stats?.failedJobs),
        totalProducts: N(productStats?.totalProducts),
        pendingDecision: N(productStats?.pendingDecision),
        tracked: N(productStats?.tracked),
        rejected: N(productStats?.rejected),
        avgScore: N(productStats?.avgScore),
      };
    }),

  // === Legacy aliases for extension backward compat ===
  getPendingJobs: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      return db.select({
        id: extDiscoveryJobs.id,
        keyword: extDiscoveryJobs.keyword,
        status: extDiscoveryJobs.status,
        maxPages: extDiscoveryJobs.maxPages,
        maxDetailProducts: extDiscoveryJobs.maxDetailProducts,
        filteredProductIds: extDiscoveryJobs.filteredProductIds,
      })
        .from(extDiscoveryJobs)
        .where(and(
          eq(extDiscoveryJobs.userId, ctx.user!.id),
          sql`${extDiscoveryJobs.status} IN ('pending', 'filtering')`,
        ))
        .orderBy(extDiscoveryJobs.createdAt)
        .limit(5);
    }),

  createJob: protectedProcedure
    .input(z.object({
      keyword: z.string().min(1).max(255),
      maxPages: z.number().int().min(1).max(5).default(2),
      maxDetailProducts: z.number().int().min(1).max(15).default(8),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [existing] = await db.select({ id: extDiscoveryJobs.id })
        .from(extDiscoveryJobs)
        .where(and(
          eq(extDiscoveryJobs.userId, ctx.user!.id),
          eq(extDiscoveryJobs.keyword, input.keyword),
          sql`${extDiscoveryJobs.status} NOT IN ('completed', 'failed')`,
        ))
        .limit(1);
      if (existing) throw new TRPCError({ code: "CONFLICT", message: `"${input.keyword}" 이미 진행 중` });

      const result = await db.insert(extDiscoveryJobs).values({
        userId: ctx.user!.id,
        keyword: input.keyword,
        status: "pending",
        maxPages: input.maxPages,
        maxDetailProducts: input.maxDetailProducts,
      });

      return { success: true, jobId: Number((result as any)?.[0]?.insertId) };
    }),
});

// ============================================================
//  비동기 AI 분석
// ============================================================
async function runAIAnalysis(userId: number, jobId: number, db: any) {
  try {
    const [job] = await db.select()
      .from(extDiscoveryJobs)
      .where(eq(extDiscoveryJobs.id, jobId))
      .limit(1);
    if (!job) return;

    const searchItems = (job.searchResultsJson || []) as any[];
    const detailResults = (job.detailResultsJson || []) as any[];
    const searchSummary = job.searchSummaryJson || {};

    const analysis = await analyzeProductsWithAI(job.keyword, searchSummary, detailResults, searchItems);

    const products = analysis.products || [];
    for (const p of products) {
      const detail = detailResults.find(
        (d: any) => String(d.productId || d.coupangProductId) === String(p.productId)
      );
      const searchItem = searchItems.find(
        (s: any) => String(s.productId || s.coupangProductId) === String(p.productId)
      );
      if (!detail && !searchItem) continue;
      const src = detail || searchItem || {};

      await db.insert(extDiscoveryProducts).values({
        userId,
        jobId,
        keyword: job.keyword,
        coupangProductId: String(p.productId),
        productTitle: (src.title || src.productTitle || "").slice(0, 1000),
        productUrl: src.url || src.productUrl || null,
        imageUrl: src.imageUrl || null,
        price: src.price || 0,
        originalPrice: src.originalPrice || 0,
        rating: String(src.rating || 0),
        reviewCount: src.reviewCount || 0,
        sellerName: src.sellerName || null,
        deliveryType: src.deliveryType || src.delivery || null,
        categoryPath: src.categoryPath || null,
        optionCount: src.optionCount || (src.optionSummary?.length || 0),
        detailDataJson: detail || null,
        searchRank: searchItem?.rank || searchItem?._rank || 0,
        isAd: !!(searchItem?.isAd),
        isRocket: !!(src.isRocket || searchItem?.isRocket),
        aiScore: p.aiScore || 0,
        aiGrade: p.grade || "D",
        aiVerdict: p.verdict || "watch",
        aiReasonJson: p.reasons || [],
        aiRiskJson: p.risks || [],
        aiOpportunityJson: p.opportunities || [],
        estimatedMonthlySales: p.estimatedMonthlySales || 0,
        estimatedMarginPercent: String(p.estimatedMarginPercent || 0),
        userDecision: "pending",
      });
    }

    await db.update(extDiscoveryJobs).set({
      status: "completed",
      aiAnalysisJson: analysis,
      completedAt: sql`NOW()`,
    }).where(eq(extDiscoveryJobs.id, jobId));

  } catch (err: any) {
    console.error("[runAIAnalysis] Error:", err);
    await db.update(extDiscoveryJobs).set({
      status: "failed",
      errorMessage: err?.message || "AI 분석 실패",
      completedAt: sql`NOW()`,
    }).where(eq(extDiscoveryJobs.id, jobId));
  }
}
