import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { products, extSearchSnapshots } from "../../drizzle/schema";
import { eq, desc, and, sql, gte, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { calculateScore, getScoreGrade, getAutoStatus } from "../scoring";

function N(v: any): number { return Number(v) || 0; }

const productInput = z.object({
  recordDate: z.string(),
  category: z.string().optional(),
  productName: z.string().min(1),
  priority: z.enum(["low", "medium", "high"]).optional(),
  keyword1: z.string().optional(),
  keyword2: z.string().optional(),
  keyword3: z.string().optional(),
  targetCustomer: z.string().optional(),
  seasonality: z.string().optional(),
  competitionLevel: z.enum(["low", "medium", "high", "very_high"]).optional(),
  differentiationLevel: z.enum(["low", "medium", "high"]).optional(),
  thumbnailMemo: z.string().optional(),
  detailPoint: z.string().optional(),
  giftIdea: z.string().optional(),
  improvementNote: z.string().optional(),
  developmentNote: z.string().optional(),
  finalOpinion: z.string().optional(),
  coupangUrl: z.string().optional(),
  referenceUrl: z.string().optional(),
});

function getWeekKey(dateStr: string): string {
  const d = new Date(dateStr);
  const onejan = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${weekNum.toString().padStart(2, "0")}`;
}

function getWeekday(dateStr: string): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(dateStr).getDay()];
}

export const sourcingRouter = router({
  /** 상품 등록 */
  create: protectedProcedure
    .input(productInput)
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      const score = calculateScore(input);
      const scoreGrade = getScoreGrade(score);
      const status = getAutoStatus(score);

      await db.insert(products).values({
        userId: ctx.user.id,
        recordDate: input.recordDate,
        weekday: getWeekday(input.recordDate),
        weekKey: getWeekKey(input.recordDate),
        category: input.category || null,
        productName: input.productName,
        priority: input.priority || "medium",
        keyword1: input.keyword1 || null,
        keyword2: input.keyword2 || null,
        keyword3: input.keyword3 || null,
        targetCustomer: input.targetCustomer || null,
        seasonality: input.seasonality || null,
        competitionLevel: input.competitionLevel || "medium",
        differentiationLevel: input.differentiationLevel || "medium",
        thumbnailMemo: input.thumbnailMemo || null,
        detailPoint: input.detailPoint || null,
        giftIdea: input.giftIdea || null,
        improvementNote: input.improvementNote || null,
        developmentNote: input.developmentNote || null,
        finalOpinion: input.finalOpinion || null,
        coupangUrl: input.coupangUrl || null,
        referenceUrl: input.referenceUrl || null,
        score,
        scoreGrade,
        status,
      });

      return { success: true };
    }),

  /** 상품 수정 */
  update: protectedProcedure
    .input(z.object({ id: z.number() }).merge(productInput.partial()))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      const { id, ...data } = input;

      // 기존 상품 확인
      const [existing] = await db.select().from(products)
        .where(and(eq(products.id, id), eq(products.userId, ctx.user.id)))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "상품을 찾을 수 없습니다." });

      // 점수 재계산용 merged data
      const merged = { ...existing, ...data };
      const score = calculateScore(merged);
      const scoreGrade = getScoreGrade(score);

      await db.update(products).set({
        ...data,
        score,
        scoreGrade,
        ...(data.recordDate ? {
          weekday: getWeekday(data.recordDate),
          weekKey: getWeekKey(data.recordDate),
        } : {}),
      }).where(eq(products.id, id));

      return { success: true };
    }),

  /** 상품 상태 변경 */
  changeStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["draft", "reviewing", "test_candidate", "testing", "hold", "dropped", "selected"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      await db.update(products)
        .set({ status: input.status })
        .where(and(eq(products.id, input.id), eq(products.userId, ctx.user.id)));

      return { success: true };
    }),

  /** 상품 목록 조회 */
  list: protectedProcedure
    .input(z.object({
      weekKey: z.string().optional(),
      status: z.string().optional(),
      category: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().default(100),
      offset: z.number().default(0),
    }).optional())
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      const filters = input || {};
      const conditions = [eq(products.userId, ctx.user.id)];

      if (filters.weekKey) conditions.push(eq(products.weekKey, filters.weekKey));
      if (filters.status) conditions.push(eq(products.status, filters.status as any));
      if (filters.category) conditions.push(eq(products.category, filters.category));
      if (filters.search) conditions.push(sql`${products.productName} LIKE ${'%' + filters.search + '%'}`);

      const items = await db.select().from(products)
        .where(and(...conditions))
        .orderBy(desc(products.createdAt))
        .limit(filters.limit || 100)
        .offset(filters.offset || 0);

      const [countResult] = await db.select({ count: sql<number>`count(*)` })
        .from(products)
        .where(and(...conditions));

      return { items, total: countResult?.count || 0 };
    }),

  /** 단일 상품 조회 */
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      const [item] = await db.select().from(products)
        .where(and(eq(products.id, input.id), eq(products.userId, ctx.user.id)))
        .limit(1);

      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      return item;
    }),

  /** 상품 삭제 */
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      await db.delete(products)
        .where(and(eq(products.id, input.id), eq(products.userId, ctx.user.id)));

      return { success: true };
    }),

  /** 대시보드 데이터 기반 소싱 폼 자동 생성 */
  generateFromDashboard: protectedProcedure
    .input(z.object({
      source: z.enum(["keyword", "ai_recommendation", "review_analysis", "candidate"]),
      // keyword source
      keyword: z.string().optional(),
      productCount: z.number().optional(),
      avgPrice: z.number().optional(),
      competitionScore: z.number().optional(),
      demandScore: z.number().optional(),
      keywordScore: z.number().optional(),
      salesEstimate: z.number().optional(),
      reviewGrowth: z.number().optional(),
      competitionLevel: z.string().optional(),
      // AI recommendation source
      aiTitle: z.string().optional(),
      aiReason: z.string().optional(),
      aiType: z.string().optional(), // blueocean, high_margin, trending
      aiScore: z.number().optional(),
      // review analysis source
      reviewQuery: z.string().optional(),
      summaryText: z.string().optional(),
      opportunities: z.array(z.object({
        title: z.string(), description: z.string(), potential: z.string().optional(),
      })).optional(),
      painPoints: z.array(z.object({
        point: z.string(), detail: z.string(), severity: z.string().optional(),
      })).optional(),
      customerNeeds: z.array(z.object({
        need: z.string(), insight: z.string(), priority: z.string().optional(),
      })).optional(),
      recommendations: z.array(z.object({
        action: z.string(), expectedImpact: z.string(), priority: z.string().optional(),
      })).optional(),
      commonPraises: z.array(z.string()).optional(),
      commonComplaints: z.array(z.string()).optional(),
      qualityConcerns: z.array(z.string()).optional(),
      marketOverview: z.object({
        competitionScore: z.number().optional(),
        avgPrice: z.number().optional(),
        adRatio: z.number().optional(),
        rocketRatio: z.number().optional(),
      }).optional(),
      priceSensitivity: z.string().optional(),
      // candidate source
      candidateTitle: z.string().optional(),
      candidatePrice: z.number().optional(),
      candidateCategory: z.string().optional(),
      candidateUrl: z.string().optional(),
      candidateSearchQuery: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const today = new Date().toISOString().split("T")[0];
      const form: Record<string, any> = {
        recordDate: today,
        category: "",
        productName: "",
        priority: "medium",
        keyword1: "",
        keyword2: "",
        keyword3: "",
        targetCustomer: "",
        seasonality: "연중",
        competitionLevel: "medium",
        differentiationLevel: "medium",
        thumbnailMemo: "",
        detailPoint: "",
        giftIdea: "",
        improvementNote: "",
        developmentNote: "",
        finalOpinion: "",
        coupangUrl: "",
        referenceUrl: "",
      };

      // Helper: infer competition level from score
      function inferCompetition(score?: number): string {
        if (!score && score !== 0) return "medium";
        if (score <= 25) return "low";
        if (score <= 50) return "medium";
        if (score <= 75) return "high";
        return "very_high";
      }

      // Helper: infer differentiation
      function inferDifferentiation(compScore?: number, demandScore?: number): string {
        const c = compScore ?? 50;
        const d = demandScore ?? 50;
        if (c < 40 && d > 50) return "high";
        if (c < 60) return "medium";
        return "low";
      }

      // ---- Fill based on source ----
      if (input.source === "keyword") {
        const kw = input.keyword || "";
        form.productName = kw ? `[소싱분석] ${kw}` : "";
        form.keyword1 = kw;
        form.competitionLevel = inferCompetition(input.competitionScore);
        form.differentiationLevel = inferDifferentiation(input.competitionScore, input.demandScore);
        
        const priceStr = input.avgPrice ? `${N(input.avgPrice).toLocaleString()}원` : "미확인";
        form.thumbnailMemo = `키워드 "${kw}" 시장 분석:\n- 평균가: ${priceStr}\n- 상품수: ${input.productCount || 0}개\n- 경쟁도: ${input.competitionScore || 0}점\n- 수요점수: ${input.demandScore || 0}점\n- 종합점수: ${input.keywordScore || 0}점`;
        form.detailPoint = `검색수요 기반 추정:\n- 추정 판매량: ${input.salesEstimate || 0}건/일\n- 리뷰 증가: ${input.reviewGrowth || 0}건\n- 경쟁 레벨: ${input.competitionLevel || "보통"}`;
        form.improvementNote = `시장 경쟁도 ${input.competitionScore || 0}점 기준 보완 전략:\n- 경쟁이 ${(input.competitionScore || 50) > 50 ? '높으므로 차별화된 상세페이지와 리뷰 전략이 필요' : '낮으므로 빠른 진입이 유리'}\n- 평균가 대비 가격 경쟁력 확보 필요`;
        form.developmentNote = `수요점수 ${input.demandScore || 0}점 기반 개발 방향:\n- 리뷰 증가 트렌드: ${(input.reviewGrowth || 0) > 0 ? '양호 (성장 중)' : '정체 (신중한 접근 필요)'}\n- 판매 추정치 기반 MOQ 설정 고려`;
        form.finalOpinion = `키워드 "${kw}" 종합 판단: 종합점수 ${input.keywordScore || 0}점, 경쟁 ${input.competitionLevel || "보통"}, 수요 ${input.demandScore || 0}점.\n${(input.keywordScore || 0) >= 60 ? '진입 가치 있음' : '추가 분석 필요'}`;

        // Try to fetch related keywords from snapshots
        try {
          const db = await getDb();
          if (db && kw) {
            const relatedSnaps = await db.select({
              query: extSearchSnapshots.query,
            }).from(extSearchSnapshots)
              .where(and(
                eq(extSearchSnapshots.userId, ctx.user.id),
                sql`${extSearchSnapshots.query} LIKE ${'%' + kw + '%'}`,
              ))
              .groupBy(extSearchSnapshots.query)
              .limit(5);
            
            const relatedKws = relatedSnaps.map(s => s.query).filter(q => q !== kw);
            if (relatedKws.length >= 1) form.keyword2 = relatedKws[0];
            if (relatedKws.length >= 2) form.keyword3 = relatedKws[1];
          }
        } catch { /* ignore */ }

        // Infer category from keyword
        const kwLower = kw.toLowerCase();
        const catMap: [string, string[]][] = [
          ["주방용품", ["주방", "식기", "수저", "냄비", "프라이팬", "주걱", "수세미", "그릇", "접시"]],
          ["생활용품", ["생활", "세제", "청소", "빨래", "수건", "티슈", "쓰레기"]],
          ["욕실용품", ["욕실", "샤워", "비누", "치약", "칫솔", "목욕"]],
          ["수납/정리", ["수납", "정리", "서랍", "선반", "행거", "옷걸이"]],
          ["인테리어", ["인테리어", "쿠션", "커튼", "러그", "액자", "화분"]],
          ["전자기기", ["전자", "충전", "케이블", "블루투스", "이어폰", "스피커"]],
          ["반려동물", ["반려", "강아지", "고양이", "펫", "애완", "사료"]],
          ["유아/아동", ["유아", "아기", "아동", "키즈", "젖병"]],
          ["건강/뷰티", ["건강", "뷰티", "비타민", "영양", "마스크", "화장", "스킨"]],
          ["스포츠/아웃도어", ["스포츠", "운동", "헬스", "요가", "등산"]],
          ["캠핑", ["캠핑", "텐트", "버너", "랜턴"]],
          ["자동차", ["자동차", "차량", "카", "세차"]],
          ["패션소품", ["패션", "악세서리", "목걸이", "반지", "시계"]],
          ["가방/파우치", ["가방", "파우치", "백팩", "크로스"]],
        ];
        for (const [cat, keywords] of catMap) {
          if (keywords.some(k => kwLower.includes(k))) {
            form.category = cat;
            break;
          }
        }
      }

      else if (input.source === "ai_recommendation") {
        const title = input.aiTitle || "";
        form.productName = title ? `[AI추천] ${title}` : "";
        form.keyword1 = input.keyword || title;
        form.competitionLevel = inferCompetition(input.aiScore);
        form.differentiationLevel = input.aiType === "blueocean" ? "high" : input.aiType === "high_margin" ? "medium" : "medium";
        form.priority = input.aiType === "blueocean" ? "high" : "medium";
        
        form.thumbnailMemo = `AI 소싱 추천 (${input.aiType || "일반"}):\n- 추천: ${title}\n- 사유: ${input.aiReason || "없음"}\n- 경쟁점수: ${input.aiScore || "-"}점`;
        form.detailPoint = `AI 분석 기반 상세페이지 전략:\n- ${input.aiType === "blueocean" ? "블루오션 키워드로 경쟁이 적음. 기본에 충실한 상세페이지로 진입 유리" : input.aiType === "high_margin" ? "높은 마진 가능성. 프리미엄 이미지와 품질 강조 필요" : "트렌드 키워드. 빠른 진입과 트렌디한 디자인 중요"}`;
        form.improvementNote = `AI 추천 근거: ${input.aiReason || "없음"}\n경쟁사 대비 보완점:\n- ${input.aiType === "blueocean" ? "선점 효과 극대화, 리뷰 빠르게 확보" : "가격 경쟁력 및 품질 차별화 필요"}`;
        form.developmentNote = `AI 기반 개발 방향:\n- 타입: ${input.aiType || "일반"}\n- 추천 사유 기반으로 OEM/ODM 포인트 설정\n- ${input.aiReason || ""}`;
        form.finalOpinion = `AI 소싱 추천 "${title}": ${input.aiType === "blueocean" ? "블루오션 - 적극 검토 추천" : input.aiType === "high_margin" ? "고마진 - 품질/차별화 중심 접근" : "트렌딩 - 시의성 확보 중요"}`;
      }

      else if (input.source === "review_analysis") {
        const query = input.reviewQuery || "";
        form.productName = query ? `[리뷰분석] ${query}` : "";
        form.keyword1 = query;
        
        // Infer competition from market overview
        if (input.marketOverview?.competitionScore) {
          form.competitionLevel = inferCompetition(input.marketOverview.competitionScore);
        }
        
        // Build comprehensive memos from review analysis
        const opps = (input.opportunities || []).map(o => `  - ${o.title}: ${o.description}`).join("\n");
        const pains = (input.painPoints || []).map(p => `  - ${p.point}: ${p.detail}`).join("\n");
        const needs = (input.customerNeeds || []).map(n => `  - ${n.need}: ${n.insight}`).join("\n");
        const recs = (input.recommendations || []).map(r => `  - ${r.action}: ${r.expectedImpact}`).join("\n");
        
        form.thumbnailMemo = `리뷰 분석 기반 시장 개요:\n- 키워드: "${query}"\n${input.summaryText ? `- 요약: ${input.summaryText}` : ""}\n${input.marketOverview ? `- 경쟁도: ${input.marketOverview.competitionScore || "-"}점\n- 평균가: ${input.marketOverview.avgPrice ? N(input.marketOverview.avgPrice).toLocaleString() + "원" : "-"}\n- 광고비율: ${input.marketOverview.adRatio || "-"}%\n- 로켓배송: ${input.marketOverview.rocketRatio || "-"}%` : ""}`;
        
        form.detailPoint = `소싱 기회 분석:\n${opps || "  (분석 데이터 없음)"}\n\n고객 니즈:\n${needs || "  (분석 데이터 없음)"}`;
        
        form.improvementNote = `주의사항 & 고객 불만:\n${pains || "  (분석 데이터 없음)"}\n\n품질 우려사항:\n${(input.qualityConcerns || []).map(q => `  - ${q}`).join("\n") || "  (없음)"}\n\n고객 불만 TOP:\n${(input.commonComplaints || []).map(c => `  - ${c}`).join("\n") || "  (없음)"}`;
        
        form.developmentNote = `추천 액션:\n${recs || "  (분석 데이터 없음)"}\n\n고객 칭찬 포인트 (강화 포인트):\n${(input.commonPraises || []).map(p => `  - ${p}`).join("\n") || "  (없음)"}`;
        
        form.finalOpinion = `리뷰 분석 종합: "${query}"\n가격 민감도: ${input.priceSensitivity || "보통"}\n기회: ${(input.opportunities || []).length}개, 주의: ${(input.painPoints || []).length}개\n${input.summaryText || ""}`;
        
        // High differentiation if many opportunities and few pain points
        const oppCount = (input.opportunities || []).length;
        const painCount = (input.painPoints || []).length;
        form.differentiationLevel = oppCount >= 3 && painCount <= 2 ? "high" : oppCount >= 2 ? "medium" : "low";
        form.priority = oppCount >= 3 ? "high" : "medium";
      }

      else if (input.source === "candidate") {
        form.productName = input.candidateTitle || "";
        form.keyword1 = input.candidateSearchQuery || "";
        form.coupangUrl = input.candidateUrl || "";
        form.category = input.candidateCategory || "";
        if (input.candidatePrice) {
          form.thumbnailMemo = `후보 상품 정보:\n- 가격: ${N(input.candidatePrice).toLocaleString()}원\n- 검색키워드: ${input.candidateSearchQuery || "-"}`;
        }
      }

      return form;
    }),

  /** 소싱 통계 (소싱관리 탭용) */
  stats: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      const [counts] = await db.select({
        total: sql<number>`COUNT(*)`,
        avgScore: sql<number>`AVG(score)`,
        draft: sql<number>`SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END)`,
        reviewing: sql<number>`SUM(CASE WHEN status = 'reviewing' THEN 1 ELSE 0 END)`,
        testCandidate: sql<number>`SUM(CASE WHEN status = 'test_candidate' THEN 1 ELSE 0 END)`,
        testing: sql<number>`SUM(CASE WHEN status = 'testing' THEN 1 ELSE 0 END)`,
        selected: sql<number>`SUM(CASE WHEN status = 'selected' THEN 1 ELSE 0 END)`,
        hold: sql<number>`SUM(CASE WHEN status = 'hold' THEN 1 ELSE 0 END)`,
        dropped: sql<number>`SUM(CASE WHEN status = 'dropped' THEN 1 ELSE 0 END)`,
      }).from(products).where(eq(products.userId, ctx.user.id));

      // Category distribution
      const categories = await db.select({
        category: products.category,
        count: sql<number>`COUNT(*)`,
      }).from(products)
        .where(and(eq(products.userId, ctx.user.id), sql`${products.category} IS NOT NULL AND ${products.category} != ''`))
        .groupBy(products.category)
        .orderBy(desc(sql`COUNT(*)`))
        .limit(10);

      // Grade distribution
      const grades = await db.select({
        grade: products.scoreGrade,
        count: sql<number>`COUNT(*)`,
      }).from(products)
        .where(eq(products.userId, ctx.user.id))
        .groupBy(products.scoreGrade)
        .orderBy(desc(sql`COUNT(*)`));

      return {
        total: N(counts?.total),
        avgScore: Math.round(N(counts?.avgScore)),
        draft: N(counts?.draft),
        reviewing: N(counts?.reviewing),
        testCandidate: N(counts?.testCandidate),
        testing: N(counts?.testing),
        selected: N(counts?.selected),
        hold: N(counts?.hold),
        dropped: N(counts?.dropped),
        categories: categories.map(c => ({ category: c.category || "미분류", count: N(c.count) })),
        grades: grades.map(g => ({ grade: g.grade || "?", count: N(g.count) })),
      };
    }),
});
