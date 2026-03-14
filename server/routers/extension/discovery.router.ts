/**
 * AI 제품 발견 v8.1 — 전면 재설계
 *
 * 핵심 플로우:
 * 1. 서버: ext_keyword_daily_stats에서 유망 키워드 자동 발견 (AI + 규칙)
 * 2. 프론트: AI가 발견한 키워드 목록 → 유저가 "검토" 클릭
 * 3. 서버: 승인된 키워드 → crawl_queue에 추가 (status: approved)
 * 4. 확장프로그램: 서버 폴링 → 자동 쿠팡 검색 + 상세 크롤링 → 결과 서버 전송
 * 5. 프론트: 크롤링된 상세 데이터 출력 + AI 분석 결과
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
import { eq, and, desc, sql, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { N } from "./_helpers";
import { invokeLLM } from "../../_core/llm";

// ============================================================
//  유망 키워드 자동 발견 엔진 (규칙 기반 + AI 보강)
// ============================================================
async function discoverPromisingKeywords(userId: number, db: any): Promise<any[]> {
  // 최근 7일 데이터에서 유망 키워드 추출
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  // 최신 날짜의 키워드별 통계를 가져온다
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

  // 이미 발견 작업이 있는 키워드 제외
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

  // 규칙 기반 스코어링
  const scored = latestStats
    .filter((s: any) => !existingSet.has(s.query))
    .map((s: any) => {
      let score = 0;
      const reasons: string[] = [];

      // 높은 수요 점수
      const demand = N(s.demandScore);
      if (demand >= 80) { score += 30; reasons.push(`수요점수 ${demand} (매우 높음)`); }
      else if (demand >= 60) { score += 20; reasons.push(`수요점수 ${demand} (높음)`); }
      else if (demand >= 40) { score += 10; reasons.push(`수요점수 ${demand} (보통)`); }

      // 낮은 경쟁
      const comp = N(s.competitionScore);
      if (comp <= 30) { score += 25; reasons.push(`경쟁점수 ${comp} (약함 — 진입 기회)`); }
      else if (comp <= 50) { score += 15; reasons.push(`경쟁점수 ${comp} (보통)`); }
      else if (comp > 70) { score -= 10; reasons.push(`경쟁점수 ${comp} (치열)`); }

      // 키워드 종합 점수
      const kwScore = N(s.keywordScore);
      if (kwScore >= 80) { score += 25; reasons.push(`키워드종합 ${kwScore} (우수)`); }
      else if (kwScore >= 60) { score += 15; reasons.push(`키워드종합 ${kwScore} (양호)`); }

      // 리뷰 성장 (판매 증가 신호)
      const growth = N(s.reviewGrowth);
      if (growth > 50) { score += 15; reasons.push(`7일 리뷰증가 ${growth}개 (활발)`); }
      else if (growth > 20) { score += 10; reasons.push(`7일 리뷰증가 ${growth}개`); }

      // MA7 판매 추정
      const ma7 = N(s.salesEstimateMa7);
      if (ma7 > 500) { score += 15; reasons.push(`MA7 일매출 추정 ${ma7}개`); }
      else if (ma7 > 100) { score += 10; reasons.push(`MA7 일매출 추정 ${ma7}개`); }

      // 적정 가격대 (마진 확보 가능)
      const price = N(s.avgPrice);
      if (price >= 10000 && price <= 50000) { score += 10; reasons.push(`평균가 ${price.toLocaleString()}원 (소싱 적합)`); }
      else if (price >= 5000 && price <= 100000) { score += 5; reasons.push(`평균가 ${price.toLocaleString()}원`); }

      // 데이터 충분성
      const days = N(s.dayCount);
      if (days >= 5) { score += 5; reasons.push(`${days}일 데이터 확보`); }

      return {
        keyword: s.query,
        discoveryScore: Math.min(Math.max(score, 0), 100),
        reasons,
        stats: {
          demandScore: demand,
          competitionScore: comp,
          keywordScore: kwScore,
          reviewGrowth: growth,
          salesEstimateMa7: ma7,
          avgPrice: price,
          productCount: N(s.productCount),
          dayCount: days,
          latestDate: s.latestDate,
          competitionLevel: s.competitionLevel,
        },
      };
    })
    .filter((s: any) => s.discoveryScore >= 30) // 최소 30점 이상만
    .sort((a: any, b: any) => b.discoveryScore - a.discoveryScore)
    .slice(0, 20);

  return scored;
}

// ============================================================
//  1차 필터링
// ============================================================
function filterCandidates(items: any[], maxCount: number) {
  const nonAd = items.filter((it: any) => !it.isAd);
  const avgPrice = nonAd.reduce((s: number, it: any) => s + (it.price || 0), 0) / (nonAd.length || 1);

  const scored = nonAd.map((it: any, idx: number) => {
    let score = 0;
    const review = it.reviewCount || 0;
    const rating = it.rating || 0;
    const price = it.price || 0;
    const rank = it.rank || idx + 1;

    if (review >= 50 && review <= 500) score += 30;
    else if (review > 500 && review <= 2000) score += 20;
    else if (review >= 10) score += 15;

    if (rating >= 4.5) score += 20;
    else if (rating >= 4.0) score += 15;

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
      selectedCount: filtered.length,
    },
  };
}

// ============================================================
//  AI 분석
// ============================================================
async function analyzeProductsWithAI(
  keyword: string, searchSummary: any, detailResults: any[], searchItems: any[]
): Promise<any> {
  const productSummaries = detailResults.map((d: any, i: number) => {
    const si = searchItems.find(
      (s: any) => String(s.productId || s.coupangProductId) === String(d.productId || d.coupangProductId)
    );
    return {
      index: i + 1,
      productId: d.productId || d.coupangProductId,
      title: (d.title || d.productTitle || "").slice(0, 120),
      price: d.price || 0, rating: d.rating || 0, reviewCount: d.reviewCount || 0,
      sellerName: d.sellerName || "", deliveryType: d.deliveryType || "",
      categoryPath: d.categoryPath || "", searchRank: si?.rank || 0,
      isRocket: d.isRocket || si?.isRocket || false,
    };
  });

  const systemPrompt = `당신은 한국 쿠팡 마켓에서 대박 상품을 발굴하는 AI 소싱 전문가입니다.
분석 기준: 시장 진입 가능성, 수익성, 소싱 난이도, 경쟁 강도, 트렌드, 차별화 여지.
반드시 한국어로, 구체적 수치와 함께 근거를 제시하세요.`;

  const userPrompt = `키워드: "${keyword}"
시장 개요: ${JSON.stringify(searchSummary)}
분석 대상 ${productSummaries.length}개: ${JSON.stringify(productSummaries)}

JSON 응답:
{"marketOverview":{"competitionLevel":"low|medium|high","marketSize":"small|medium|large","entryDifficulty":"easy|medium|hard","summary":"한줄요약"},
"products":[{"productId":"ID","aiScore":0-100,"grade":"S|A|B|C|D","verdict":"strong_buy|buy|watch|pass",
"reasons":[{"type":"positive|negative|neutral","category":"market|price|competition","text":"근거"}],
"risks":[{"level":"high|medium|low","text":"리스크"}],
"opportunities":[{"text":"기회"}],
"estimatedMonthlySales":0,"estimatedMarginPercent":0,"sourcingTip":"1688 팁","differentiationIdea":"아이디어"}],
"topRecommendation":{"productId":"ID","reason":"이유"}}`;

  try {
    const result = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      responseFormat: { type: "json_object" },
      maxTokens: 8192,
    });
    const raw = result.choices[0]?.message?.content;
    const text = typeof raw === "string" ? raw : "";
    return JSON.parse(text || "{}");
  } catch {
    return ruleBasedAnalysis(keyword, searchSummary, detailResults, searchItems);
  }
}

function ruleBasedAnalysis(keyword: string, summary: any, details: any[], searchItems: any[]) {
  const products = details.map((d: any) => {
    const si = searchItems.find((s: any) => String(s.productId || s.coupangProductId) === String(d.productId || d.coupangProductId));
    const price = d.price || 0, review = d.reviewCount || 0, rating = d.rating || 0;
    const rank = si?.rank || 99;
    let score = 0;
    const reasons: any[] = [], risks: any[] = [], opportunities: any[] = [];

    if (review <= 100) { score += 25; reasons.push({ type: "positive", category: "competition", text: `리뷰 ${review}개 — 진입 장벽 낮음` }); }
    else if (review <= 500) { score += 20; reasons.push({ type: "positive", category: "market", text: `리뷰 ${review}개 — 시장 검증+진입 가능` }); }
    else { risks.push({ level: "high", text: `리뷰 ${review}개 — 경쟁 치열` }); }

    if (price >= 10000 && price <= 30000) { score += 25; reasons.push({ type: "positive", category: "price", text: `${price.toLocaleString()}원 — 마진 적합` }); }
    else if (price < 5000) { risks.push({ level: "medium", text: "저가 — 마진 어려움" }); }

    if (rating >= 4.5) score += 15;
    if (rank <= 10) score += 15;
    if (!si?.isRocket) { score += 10; opportunities.push({ text: "3P 판매자 시장" }); }

    const grade = score >= 80 ? "S" : score >= 60 ? "A" : score >= 40 ? "B" : score >= 20 ? "C" : "D";
    const verdict = score >= 70 ? "strong_buy" : score >= 50 ? "buy" : score >= 30 ? "watch" : "pass";

    return {
      productId: String(d.productId || d.coupangProductId), aiScore: Math.min(score, 100),
      grade, verdict, reasons, risks, opportunities,
      estimatedMonthlySales: Math.round(review * 0.5),
      estimatedMarginPercent: price >= 10000 ? 30 : 10,
      sourcingTip: `1688에서 "${keyword}" 검색`, differentiationIdea: "세트/패키지 차별화",
    };
  }).sort((a: any, b: any) => b.aiScore - a.aiScore);

  return {
    marketOverview: {
      competitionLevel: summary?.competitionLevel || "medium",
      marketSize: (summary?.totalItems || 0) > 1000 ? "large" : "medium",
      entryDifficulty: "medium", summary: `"${keyword}" 규칙 기반 분석`,
    },
    products,
    topRecommendation: products[0] ? { productId: products[0].productId, reason: `최고 ${products[0].aiScore}점` } : null,
  };
}

// ============================================================
//  라우터
// ============================================================
export const discoveryRouter = router({

  // ─── 1. AI 유망 키워드 자동 발견 ───
  discoverKeywords: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return discoverPromisingKeywords(ctx.user!.id, db);
    }),

  // ─── 2. 유저가 키워드 검토 승인 → 크롤링 작업 생성 ───
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

      // 중복 확인
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
        status: "pending",  // 확장프로그램이 폴링할 상태
        maxPages: 2,
        maxDetailProducts: 8,
        searchSummaryJson: input.stats || null,
        filterCriteria: { discoveryScore: input.discoveryScore, reasons: input.reasons },
      });

      return { success: true, jobId: Number((result as any)?.[0]?.insertId) };
    }),

  // ─── 3. 확장프로그램: 대기 중인 크롤링 작업 폴링 ───
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

  // ─── 3b. getCrawlQueue alias (확장프로그램 호환) ───
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

  // ─── 4. 확장프로그램: 검색 결과 전송 ───
  submitSearchResults: protectedProcedure
    .input(z.object({
      jobId: z.number().int(),
      items: z.array(z.any()),
      summary: z.any(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [job] = await db.select().from(extDiscoveryJobs)
        .where(and(eq(extDiscoveryJobs.id, input.jobId), eq(extDiscoveryJobs.userId, ctx.user!.id)))
        .limit(1);
      if (!job) throw new TRPCError({ code: "NOT_FOUND" });

      const { filtered, criteria } = filterCandidates(input.items, job.maxDetailProducts || 8);

      const filteredIds = filtered.map((it: any) => ({
        productId: String(it.productId || it.coupangProductId),
        title: (it.title || "").slice(0, 100),
        price: it.price || 0, reviewCount: it.reviewCount || 0,
        rank: it._rank || 0, filterScore: it._filterScore || 0,
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

  // ─── 5. 확장프로그램: 상세 크롤링 결과 전송 → AI 분석 ───
  submitDetailResults: protectedProcedure
    .input(z.object({ jobId: z.number().int(), details: z.array(z.any()) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [job] = await db.select().from(extDiscoveryJobs)
        .where(and(eq(extDiscoveryJobs.id, input.jobId), eq(extDiscoveryJobs.userId, ctx.user!.id)))
        .limit(1);
      if (!job) throw new TRPCError({ code: "NOT_FOUND" });

      await db.update(extDiscoveryJobs).set({
        status: "analyzing",
        detailResultsJson: input.details,
        detailCrawledCount: input.details.length,
      }).where(eq(extDiscoveryJobs.id, input.jobId));

      // AI 분석 비동기 실행
      runAIAnalysis(ctx.user!.id, input.jobId, db).catch(err => {
        console.error("[Discovery] AI analysis failed:", err);
      });

      return { success: true, analyzing: true };
    }),

  // ─── 6. 확장프로그램: 작업 상태 업데이트 ───
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
        .where(and(eq(extDiscoveryJobs.id, input.jobId), eq(extDiscoveryJobs.userId, ctx.user!.id)));
      return { success: true };
    }),

  // ─── 7. 작업 목록 조회 ───
  listJobs: protectedProcedure
    .input(z.object({ limit: z.number().int().default(20), offset: z.number().int().default(0) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      return db.select({
        id: extDiscoveryJobs.id, keyword: extDiscoveryJobs.keyword,
        status: extDiscoveryJobs.status, searchSummaryJson: extDiscoveryJobs.searchSummaryJson,
        filterCriteria: extDiscoveryJobs.filterCriteria,
        detailCrawledCount: extDiscoveryJobs.detailCrawledCount,
        aiAnalysisJson: extDiscoveryJobs.aiAnalysisJson,
        errorMessage: extDiscoveryJobs.errorMessage,
        completedAt: extDiscoveryJobs.completedAt, createdAt: extDiscoveryJobs.createdAt,
      })
        .from(extDiscoveryJobs)
        .where(eq(extDiscoveryJobs.userId, ctx.user!.id))
        .orderBy(desc(extDiscoveryJobs.createdAt))
        .limit(input.limit).offset(input.offset);
    }),

  // ─── 8. 작업 상세 + 제품 ───
  getJobDetail: protectedProcedure
    .input(z.object({ jobId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [job] = await db.select().from(extDiscoveryJobs)
        .where(and(eq(extDiscoveryJobs.id, input.jobId), eq(extDiscoveryJobs.userId, ctx.user!.id)))
        .limit(1);
      if (!job) throw new TRPCError({ code: "NOT_FOUND" });

      const products = await db.select().from(extDiscoveryProducts)
        .where(eq(extDiscoveryProducts.jobId, input.jobId))
        .orderBy(desc(extDiscoveryProducts.aiScore));

      return { job, products };
    }),

  // ─── 9. 제품 목록 (판단 대기 등) ───
  listProducts: protectedProcedure
    .input(z.object({
      decision: z.enum(["pending", "track", "reject", "all"]).default("all"),
      limit: z.number().int().default(30), offset: z.number().int().default(0),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const conds = [eq(extDiscoveryProducts.userId, ctx.user!.id)];
      if (input.decision !== "all") conds.push(eq(extDiscoveryProducts.userDecision, input.decision));

      return db.select().from(extDiscoveryProducts)
        .where(and(...conds))
        .orderBy(desc(extDiscoveryProducts.aiScore))
        .limit(input.limit).offset(input.offset);
    }),

  // ─── 10. 유저 결정: 추적 또는 거절 ───
  decide: protectedProcedure
    .input(z.object({
      productId: z.number().int(),
      decision: z.enum(["track", "reject"]),
      memo: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [product] = await db.select().from(extDiscoveryProducts)
        .where(and(eq(extDiscoveryProducts.id, input.productId), eq(extDiscoveryProducts.userId, ctx.user!.id)))
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

  // ─── 11. 작업 삭제 ───
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

  // ─── 12. 대시보드 요약 ───
  overview: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [stats] = await db.select({
        totalJobs: sql<number>`COUNT(*)`,
        completedJobs: sql<number>`SUM(CASE WHEN ${extDiscoveryJobs.status} = 'completed' THEN 1 ELSE 0 END)`,
        pendingJobs: sql<number>`SUM(CASE WHEN ${extDiscoveryJobs.status} NOT IN ('completed', 'failed') THEN 1 ELSE 0 END)`,
      }).from(extDiscoveryJobs).where(eq(extDiscoveryJobs.userId, ctx.user!.id));

      const [pStats] = await db.select({
        totalProducts: sql<number>`COUNT(*)`,
        pendingDecision: sql<number>`SUM(CASE WHEN ${extDiscoveryProducts.userDecision} = 'pending' THEN 1 ELSE 0 END)`,
        tracked: sql<number>`SUM(CASE WHEN ${extDiscoveryProducts.userDecision} = 'track' THEN 1 ELSE 0 END)`,
      }).from(extDiscoveryProducts).where(eq(extDiscoveryProducts.userId, ctx.user!.id));

      return {
        totalJobs: N(stats?.totalJobs), completedJobs: N(stats?.completedJobs),
        pendingJobs: N(stats?.pendingJobs),
        totalProducts: N(pStats?.totalProducts),
        pendingDecision: N(pStats?.pendingDecision),
        tracked: N(pStats?.tracked),
      };
    }),
});

// ============================================================
//  비동기 AI 분석
// ============================================================
async function runAIAnalysis(userId: number, jobId: number, db: any) {
  try {
    const [job] = await db.select().from(extDiscoveryJobs).where(eq(extDiscoveryJobs.id, jobId)).limit(1);
    if (!job) return;

    const searchItems = (job.searchResultsJson || []) as any[];
    const detailResults = (job.detailResultsJson || []) as any[];
    const searchSummary = job.searchSummaryJson || {};

    const analysis = await analyzeProductsWithAI(job.keyword, searchSummary, detailResults, searchItems);

    for (const p of (analysis.products || [])) {
      const detail = detailResults.find((d: any) => String(d.productId || d.coupangProductId) === String(p.productId));
      const si = searchItems.find((s: any) => String(s.productId || s.coupangProductId) === String(p.productId));
      const src = detail || si || {};

      await db.insert(extDiscoveryProducts).values({
        userId, jobId, keyword: job.keyword,
        coupangProductId: String(p.productId),
        productTitle: (src.title || src.productTitle || "").slice(0, 1000),
        productUrl: src.url || src.productUrl || null,
        imageUrl: src.imageUrl || null,
        price: src.price || 0, originalPrice: src.originalPrice || 0,
        rating: String(src.rating || 0), reviewCount: src.reviewCount || 0,
        sellerName: src.sellerName || null,
        deliveryType: src.deliveryType || src.delivery || null,
        categoryPath: src.categoryPath || null,
        optionCount: src.optionCount || 0,
        detailDataJson: detail || null,
        searchRank: si?.rank || si?._rank || 0,
        isAd: !!(si?.isAd), isRocket: !!(src.isRocket || si?.isRocket),
        aiScore: p.aiScore || 0, aiGrade: p.grade || "D",
        aiVerdict: p.verdict || "watch",
        aiReasonJson: p.reasons || [], aiRiskJson: p.risks || [],
        aiOpportunityJson: p.opportunities || [],
        estimatedMonthlySales: p.estimatedMonthlySales || 0,
        estimatedMarginPercent: String(p.estimatedMarginPercent || 0),
        userDecision: "pending",
      });
    }

    await db.update(extDiscoveryJobs).set({
      status: "completed", aiAnalysisJson: analysis, completedAt: sql`NOW()`,
    }).where(eq(extDiscoveryJobs.id, jobId));

  } catch (err: any) {
    console.error("[runAIAnalysis] Error:", err);
    await db.update(extDiscoveryJobs).set({
      status: "failed", errorMessage: err?.message || "AI 분석 실패", completedAt: sql`NOW()`,
    }).where(eq(extDiscoveryJobs.id, jobId));
  }
}
