/**
 * Extension Sub-Router: AI 제품 발견 (Product Discovery) v8.1
 *
 * 파이프라인:
 * 1. 서버: ext_keyword_daily_stats에서 유망 키워드 자동 발견 (AI + 규칙)
 * 2. 프론트: AI가 발견한 키워드 목록 → 유저가 "검토" 클릭 (또는 수동 키워드 입력)
 * 3. 서버: 승인된 키워드 → 크롤링 작업 생성 (status: pending)
 * 4. 확장프로그램: 서버 폴링 → 자동 쿠팡 검색 + 상세 크롤링 → 결과 서버 전송
 * 5. 서버: AI 분석 → 추천 제품 생성
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
import { eq, and, desc, sql, gte, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { N } from "./_helpers";
import { invokeLLM } from "../../_core/llm";

// ============================================================
//  1차 필터링: 검색 결과에서 유망 상품 선별
// ============================================================
function filterCandidates(
  items: any[],
  maxCount: number
): { filtered: any[]; criteria: Record<string, any> } {
  // 광고 제외
  const nonAd = items.filter((it: any) => !it.isAd);

  // 기본 통계
  const avgPrice = nonAd.reduce((s: number, it: any) => s + (it.price || 0), 0) / (nonAd.length || 1);
  const avgReview = nonAd.reduce((s: number, it: any) => s + (it.reviewCount || 0), 0) / (nonAd.length || 1);

  // 점수 계산: 진입 가능성이 높은 상품 우선
  const scored = nonAd.map((it: any, idx: number) => {
    let score = 0;
    const price = it.price || 0;
    const review = it.reviewCount || 0;
    const rating = it.rating || 0;
    const rank = it.rank || idx + 1;

    // 리뷰 50~2000: 시장 검증 되었지만 과포화 아닌 구간
    if (review >= 50 && review <= 500) score += 30;
    else if (review > 500 && review <= 2000) score += 20;
    else if (review > 2000) score += 5;
    else if (review >= 10) score += 15;

    // 평점 4.0+
    if (rating >= 4.5) score += 20;
    else if (rating >= 4.0) score += 15;
    else if (rating >= 3.5) score += 5;

    // 가격대 — 소싱 적합 (5,000~50,000원)
    if (price >= 5000 && price <= 50000) score += 20;
    else if (price > 50000 && price <= 100000) score += 10;

    // 로켓배송 아닌 상품 = 독점이 아님 = 진입 가능
    if (!it.isRocket) score += 10;

    // 상위 랭크 가산 (1~10위)
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
//  AI 분석: 크롤링 데이터 기반 디테일 분석
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
      confidence: d.confidence || 0,
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

반드시 한국어로 응답하세요.
각 상품에 대해 구체적 수치와 함께 근거를 제시하세요.`;

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
        { "type": "positive|negative|neutral", "category": "market|price|competition|trend|sourcing|differentiation", "text": "구체적 근거 (수치 포함)" }
      ],
      "risks": [
        { "level": "high|medium|low", "text": "리스크 설명" }
      ],
      "opportunities": [
        { "text": "기회 요인 설명" }
      ],
      "estimatedMonthlySales": 0,
      "estimatedMarginPercent": 0,
      "sourcingTip": "소싱 팁 (1688 검색 키워드 등)",
      "differentiationIdea": "차별화 아이디어"
    }
  ],
  "topRecommendation": {
    "productId": "최고 추천 상품 ID",
    "reason": "추천 이유 요약"
  }
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
    // Fallback: rule-based analysis
    return ruleBasedAnalysis(keyword, searchSummary, detailResults, searchItems);
  }
}

function ruleBasedAnalysis(
  keyword: string,
  searchSummary: any,
  detailResults: any[],
  searchItems: any[]
): any {
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

    // 리뷰 기반
    if (review <= 100) {
      score += 25;
      reasons.push({ type: "positive", category: "competition", text: `리뷰 ${review}개로 진입 장벽이 낮음` });
    } else if (review <= 500) {
      score += 20;
      reasons.push({ type: "positive", category: "market", text: `리뷰 ${review}개 — 시장 검증됨 + 진입 가능` });
    } else if (review <= 2000) {
      score += 10;
      reasons.push({ type: "neutral", category: "competition", text: `리뷰 ${review}개 — 경쟁 보통` });
    } else {
      score += 0;
      reasons.push({ type: "negative", category: "competition", text: `리뷰 ${review}개 — 경쟁 치열` });
      risks.push({ level: "high", text: "리뷰 수가 많아 신규 진입이 어려움" });
    }

    // 가격 기반
    if (price >= 10000 && price <= 30000) {
      score += 25;
      reasons.push({ type: "positive", category: "price", text: `가격 ${price.toLocaleString()}원 — 소싱 마진 확보 적합` });
    } else if (price >= 5000 && price <= 50000) {
      score += 15;
      reasons.push({ type: "neutral", category: "price", text: `가격 ${price.toLocaleString()}원 — 마진 가능 구간` });
    } else if (price < 5000) {
      score += 5;
      risks.push({ level: "medium", text: "저가 상품 — 마진 확보가 어려움" });
    }

    // 평점 기반
    if (rating >= 4.5) {
      score += 15;
      reasons.push({ type: "positive", category: "market", text: `평점 ${rating} — 고객 만족도 높음` });
    } else if (rating >= 4.0) {
      score += 10;
    } else if (rating < 3.5 && rating > 0) {
      opportunities.push({ text: `평점 ${rating}점 — 품질 개선으로 차별화 가능` });
    }

    // 랭크
    if (rank <= 10) {
      score += 15;
      reasons.push({ type: "positive", category: "trend", text: `검색 ${rank}위 — 상위 노출 상품` });
    }

    // 로켓배송
    if (searchItem?.isRocket || d.isRocket) {
      risks.push({ level: "medium", text: "로켓배송 상품 — 쿠팡 직매입과 경쟁" });
    } else {
      score += 10;
      opportunities.push({ text: "로켓배송 아님 — 3P 판매자 시장" });
    }

    const grade = score >= 80 ? "S" : score >= 60 ? "A" : score >= 40 ? "B" : score >= 20 ? "C" : "D";
    const verdict = score >= 70 ? "strong_buy" : score >= 50 ? "buy" : score >= 30 ? "watch" : "pass";

    return {
      productId: String(d.productId || d.coupangProductId),
      aiScore: Math.min(score, 100),
      grade,
      verdict,
      reasons,
      risks,
      opportunities,
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
//  유망 키워드 자동 발견 엔진 (규칙 기반)
// ============================================================
async function discoverPromisingKeywords(userId: number, db: any): Promise<any[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const latestStats = await db
    .select({
      query: extKeywordDailyStats.query,
      productCount: sql<number>`MAX(${extKeywordDailyStats.productCount})`,
      avgPrice: sql<number>`MAX(${extKeywordDailyStats.avgPrice})`,
      competitionScore: sql<number>`MAX(${extKeywordDailyStats.competitionScore})`,
      competitionLevel: sql<string>`MAX(${extKeywordDailyStats.competitionLevel})`,
      reviewGrowth: sql<number>`SUM(${extKeywordDailyStats.reviewGrowth})`,
      salesEstimate: sql<number>`MAX(${extKeywordDailyStats.salesEstimate})`,
      salesEstimateMa7: sql<number>`MAX(${extKeywordDailyStats.salesEstimateMa7})`,
      demandScore: sql<number>`MAX(${extKeywordDailyStats.demandScore})`,
      keywordScore: sql<number>`MAX(${extKeywordDailyStats.keywordScore})`,
      dayCount: sql<number>`COUNT(DISTINCT ${extKeywordDailyStats.statDate})`,
      latestDate: sql<string>`MAX(${extKeywordDailyStats.statDate})`,
    })
    .from(extKeywordDailyStats)
    .where(
      and(
        eq(extKeywordDailyStats.userId, userId),
        gte(extKeywordDailyStats.statDate, sevenDaysAgo),
        sql`${extKeywordDailyStats.dataStatus} NOT IN ('missing', 'baseline')`,
        sql`${extKeywordDailyStats.isFinalized} = true`,
      )
    )
    .groupBy(extKeywordDailyStats.query)
    .orderBy(desc(sql`MAX(${extKeywordDailyStats.keywordScore})`))
    .limit(100);

  if (!latestStats.length) return [];

  const existingJobs = await db
    .select({ keyword: extDiscoveryJobs.keyword })
    .from(extDiscoveryJobs)
    .where(
      and(
        eq(extDiscoveryJobs.userId, userId),
        sql`${extDiscoveryJobs.createdAt} > DATE_SUB(NOW(), INTERVAL 7 DAY)`,
      )
    );
  const existingSet = new Set(existingJobs.map((j: any) => j.keyword));

  const scored = latestStats
    .filter((s: any) => !existingSet.has(s.query))
    .map((s: any) => {
      let score = 0;
      const reasons: string[] = [];

      const demand = N(s.demandScore);
      if (demand >= 80) { score += 30; reasons.push(`수요점수 ${demand} (매우 높음)`); }
      else if (demand >= 60) { score += 20; reasons.push(`수요점수 ${demand} (높음)`); }
      else if (demand >= 40) { score += 10; reasons.push(`수요점수 ${demand} (보통)`); }

      const comp = N(s.competitionScore);
      if (comp <= 30) { score += 25; reasons.push(`경쟁점수 ${comp} (약함 — 진입 기회)`); }
      else if (comp <= 50) { score += 15; reasons.push(`경쟁점수 ${comp} (보통)`); }
      else if (comp > 70) { score -= 10; reasons.push(`경쟁점수 ${comp} (치열)`); }

      const kwScore = N(s.keywordScore);
      if (kwScore >= 80) { score += 25; reasons.push(`키워드종합 ${kwScore} (우수)`); }
      else if (kwScore >= 60) { score += 15; reasons.push(`키워드종합 ${kwScore} (양호)`); }

      const growth = N(s.reviewGrowth);
      if (growth > 50) { score += 15; reasons.push(`7일 리뷰증가 ${growth}개 (활발)`); }
      else if (growth > 20) { score += 10; reasons.push(`7일 리뷰증가 ${growth}개`); }

      const ma7 = N(s.salesEstimateMa7);
      if (ma7 > 500) { score += 15; reasons.push(`MA7 일매출 추정 ${ma7}개`); }
      else if (ma7 > 100) { score += 10; reasons.push(`MA7 일매출 추정 ${ma7}개`); }

      const price = N(s.avgPrice);
      if (price >= 10000 && price <= 50000) { score += 10; reasons.push(`평균가 ${price.toLocaleString()}원 (소싱 적합)`); }
      else if (price >= 5000 && price <= 100000) { score += 5; reasons.push(`평균가 ${price.toLocaleString()}원`); }

      const days = N(s.dayCount);
      if (days >= 5) { score += 5; reasons.push(`${days}일 데이터 확보`); }

      return {
        keyword: s.query,
        discoveryScore: Math.min(Math.max(score, 0), 100),
        reasons,
        stats: {
          demandScore: demand, competitionScore: comp, keywordScore: kwScore,
          reviewGrowth: growth, salesEstimateMa7: ma7, avgPrice: price,
          productCount: N(s.productCount), dayCount: days,
          latestDate: s.latestDate, competitionLevel: s.competitionLevel,
        },
      };
    })
    .filter((s: any) => s.discoveryScore >= 30)
    .sort((a: any, b: any) => b.discoveryScore - a.discoveryScore)
    .slice(0, 20);

  return scored;
}

// ============================================================
//  라우터
// ============================================================
export const discoveryRouter = router({

  // ─── AI 유망 키워드 자동 발견 ───
  discoverKeywords: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return discoverPromisingKeywords(ctx.user!.id, db);
    }),

  // ─── 유저가 키워드 검토 승인 → 크롤링 작업 생성 ───
  approveKeyword: protectedProcedure
    .input(z.object({
      keyword: z.string().min(1).max(255),
      discoveryScore: z.number().optional(),
      reasons: z.array(z.string()).optional(),
      stats: z.any().optional(),
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
        )).limit(1);

      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: `"${input.keyword}" 이미 진행 중입니다.` });
      }

      const result = await db.insert(extDiscoveryJobs).values({
        userId: ctx.user!.id,
        keyword: input.keyword,
        status: "pending",
        maxPages: 2,
        maxDetailProducts: 8,
        searchSummaryJson: input.stats || null,
        filterCriteria: { discoveryScore: input.discoveryScore, reasons: input.reasons },
      });

      return { success: true, jobId: Number((result as any)?.[0]?.insertId) };
    }),

  // === 수동 발견 작업 생성 (기존 호환) ===
  createJob: protectedProcedure
    .input(z.object({
      keyword: z.string().min(1).max(255),
      maxPages: z.number().int().min(1).max(5).default(2),
      maxDetailProducts: z.number().int().min(1).max(15).default(8),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      // 동일 키워드 진행 중인 작업 확인
      const [existing] = await db.select({ id: extDiscoveryJobs.id })
        .from(extDiscoveryJobs)
        .where(and(
          eq(extDiscoveryJobs.userId, ctx.user!.id),
          eq(extDiscoveryJobs.keyword, input.keyword),
          sql`${extDiscoveryJobs.status} NOT IN ('completed', 'failed')`,
        ))
        .limit(1);

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `"${input.keyword}" 키워드로 진행 중인 분석이 있습니다.`,
        });
      }

      const result = await db.insert(extDiscoveryJobs).values({
        userId: ctx.user!.id,
        keyword: input.keyword,
        status: "pending",
        maxPages: input.maxPages,
        maxDetailProducts: input.maxDetailProducts,
      });

      const jobId = Number((result as any)?.[0]?.insertId);
      return { success: true, jobId };
    }),

  // === 확장 프로그램: 대기 중인 작업 가져오기 ===
  getPendingJobs: protectedProcedure
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

  // getCrawlQueue alias (확장프로그램 호환)
  getCrawlQueue: protectedProcedure
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

  // === 3. 확장 프로그램: 검색 결과 전송 ===
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

      // 작업 존재 확인
      const [job] = await db.select()
        .from(extDiscoveryJobs)
        .where(and(
          eq(extDiscoveryJobs.id, input.jobId),
          eq(extDiscoveryJobs.userId, ctx.user!.id),
        ))
        .limit(1);

      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "작업을 찾을 수 없습니다" });

      // 1차 필터링 실행
      const { filtered, criteria } = filterCandidates(
        input.items,
        job.maxDetailProducts || 8
      );

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

      return {
        success: true,
        filteredCount: filteredIds.length,
        filteredProducts: filteredIds,
      };
    }),

  // === 4. 확장 프로그램: 상세 크롤링 결과 전송 ===
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

      // 상세 결과 저장 + AI 분석 시작
      await db.update(extDiscoveryJobs).set({
        status: "analyzing",
        detailResultsJson: input.details,
        detailCrawledCount: input.details.length,
      }).where(eq(extDiscoveryJobs.id, input.jobId));

      // AI 분석 실행 (비동기)
      runAIAnalysis(ctx.user!.id, input.jobId, db).catch(err => {
        console.error("[Discovery] AI analysis failed:", err);
      });

      return { success: true, analyzing: true };
    }),

  // === 5. 작업 목록 조회 ===
  listJobs: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(50).default(20),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const jobs = await db.select({
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

      return jobs;
    }),

  // === 6. 작업 상세 + 추천 제품 조회 ===
  getJobDetail: protectedProcedure
    .input(z.object({ jobId: z.number().int() }))
    .query(async ({ ctx, input }) => {
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

      const products = await db.select()
        .from(extDiscoveryProducts)
        .where(eq(extDiscoveryProducts.jobId, input.jobId))
        .orderBy(desc(extDiscoveryProducts.aiScore));

      return { job, products };
    }),

  // === 7. 추천 제품 목록 (전체) ===
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

      const products = await db.select()
        .from(extDiscoveryProducts)
        .where(and(...conditions))
        .orderBy(desc(extDiscoveryProducts.aiScore))
        .limit(input.limit)
        .offset(input.offset);

      return products;
    }),

  // === 8. 유저 결정: 추적 또는 거절 ===
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
        // ext_product_trackings에 등록
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

  // === 9. 작업 상태 업데이트 (확장 프로그램용) ===
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

  // === 10. 작업 삭제 ===
  deleteJob: protectedProcedure
    .input(z.object({ jobId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.delete(extDiscoveryProducts)
        .where(and(
          eq(extDiscoveryProducts.jobId, input.jobId),
          eq(extDiscoveryProducts.userId, ctx.user!.id),
        ));
      await db.delete(extDiscoveryJobs)
        .where(and(
          eq(extDiscoveryJobs.id, input.jobId),
          eq(extDiscoveryJobs.userId, ctx.user!.id),
        ));

      return { success: true };
    }),

  // === 11. 대시보드 요약 ===
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
});

// ============================================================
//  비동기 AI 분석 실행
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

    // AI 분석 실행
    const analysis = await analyzeProductsWithAI(
      job.keyword,
      searchSummary,
      detailResults,
      searchItems
    );

    // 분석 결과를 discovery_products에 저장
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

    // 작업 완료 마킹
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
