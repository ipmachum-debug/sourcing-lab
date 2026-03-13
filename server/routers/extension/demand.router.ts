/**
 * Extension Sub-Router: 검색 수요 추정 & AI 인사이트 (Search Demand & AI Insights)
 */
import { z } from "zod";
import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import {
  extKeywordDailyStats, extSearchSnapshots, extCandidates, extWatchKeywords,
} from "../../../drizzle/schema";
import { eq, and, desc, sql, asc, gte, like } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { N } from "./_helpers";
import { callOpenAI, buildMarketDataSummary } from "./_aiHelpers";

export const demandRouter = router({
  computeKeywordDailyStats: protectedProcedure
    .input(z.object({
      query: z.string().min(1).max(255).optional(), // 특정 키워드만 또는 전체
    }).optional().default({} as { query?: string }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      // 오늘 날짜 (KST)
      const today = new Date();
      today.setHours(today.getHours() + 9);
      const todayStr = today.toISOString().slice(0, 10);

      // 해당 사용자의 스냅샷에서 키워드 목록 추출
      const queryConditions = [eq(extSearchSnapshots.userId, ctx.user!.id)];
      if (input?.query) {
        queryConditions.push(eq(extSearchSnapshots.query, input.query));
      }

      const snapshots = await db.select()
        .from(extSearchSnapshots)
        .where(and(...queryConditions))
        .orderBy(desc(extSearchSnapshots.createdAt));

      if (!snapshots.length) return { success: true, computed: 0 };

      // 키워드별로 그룹화
      const byQuery = new Map<string, typeof snapshots>();
      for (const s of snapshots) {
        const arr = byQuery.get(s.query) || [];
        arr.push(s);
        byQuery.set(s.query, arr);
      }

      let computed = 0;
      const entries = Array.from(byQuery.entries());
      for (const [query, querySnapshots] of entries) {
        // ★ v7.3.3: 스냅샷 중 가장 완전한 데이터(totalReviewSum 최대) 선택
        let bestSnapshot = querySnapshots[0];
        let bestItems: any[] = [];
        let bestTotalReviewSum = 0;

        for (const snap of querySnapshots.slice(0, 5)) {
          let snapItems: any[] = [];
          try { snapItems = snap.itemsJson ? JSON.parse(snap.itemsJson) : []; } catch { snapItems = []; }
          const snapReviewSum = snapItems.reduce((sum: number, i: any) => sum + (i.reviewCount || 0), 0);
          if (snapReviewSum > bestTotalReviewSum) {
            bestTotalReviewSum = snapReviewSum;
            bestSnapshot = snap;
            bestItems = snapItems;
          }
        }

        const latest = bestSnapshot;
        const items = bestItems;
        const totalReviewSum = bestTotalReviewSum;

        const adCount = items.filter((i: any) => i.isAd).length;
        const rocketCount = items.filter((i: any) => i.isRocket).length;
        const highReviewCount = items.filter((i: any) => (i.reviewCount || 0) >= 100).length;
        const adRatio = items.length ? Math.round((adCount / items.length) * 100) : 0;

        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().slice(0, 10);

        // 1단계: 어제 daily_stats
        let [prevStat] = await db.select()
          .from(extKeywordDailyStats)
          .where(and(
            eq(extKeywordDailyStats.userId, ctx.user!.id),
            eq(extKeywordDailyStats.query, query),
            eq(extKeywordDailyStats.statDate, yesterdayStr),
          ))
          .limit(1);

        // 2단계: 어제 없으면 최근 7일 이내
        if (!prevStat) {
          const weekAgo = new Date(today);
          weekAgo.setDate(weekAgo.getDate() - 7);
          const weekAgoStr = weekAgo.toISOString().slice(0, 10);
          const [recentStat] = await db.select()
            .from(extKeywordDailyStats)
            .where(and(
              eq(extKeywordDailyStats.userId, ctx.user!.id),
              eq(extKeywordDailyStats.query, query),
              sql`${extKeywordDailyStats.statDate} >= ${weekAgoStr}`,
              sql`${extKeywordDailyStats.statDate} < ${todayStr}`,
            ))
            .orderBy(desc(extKeywordDailyStats.statDate))
            .limit(1);
          if (recentStat) prevStat = recentStat;
        }

        // 3단계: daily_stats 없으면 이전 스냅샷과 비교
        let prevSnapshotReviewSum: number | null = null;
        let prevSnapshotAvgPrice: number | null = null;
        let prevSnapshotTotalItems: number | null = null;
        if (!prevStat && querySnapshots.length > 1) {
          const prevSnapshot = querySnapshots[1];
          let prevItems: any[] = [];
          try { prevItems = prevSnapshot.itemsJson ? JSON.parse(prevSnapshot.itemsJson) : []; } catch { prevItems = []; }
          prevSnapshotReviewSum = prevItems.reduce((sum: number, i: any) => sum + (i.reviewCount || 0), 0);
          prevSnapshotAvgPrice = prevSnapshot.avgPrice || 0;
          prevSnapshotTotalItems = prevSnapshot.totalItems || 0;
        }

        // ★ v7.3.3: 기존 growth 복구 소스 (오늘 저장값 또는 어제 growth)
        const [existingTodayStat] = await db.select()
          .from(extKeywordDailyStats)
          .where(and(
            eq(extKeywordDailyStats.userId, ctx.user!.id),
            eq(extKeywordDailyStats.query, query),
            eq(extKeywordDailyStats.statDate, todayStr),
          ))
          .limit(1);
        const todayStoredGrowth = existingTodayStat ? N(existingTodayStat.reviewGrowth) || 0 : 0;
        const prevDayGrowth = prevStat ? N(prevStat.reviewGrowth) || 0 : 0;
        const fallbackGrowth = todayStoredGrowth > 0 ? todayStoredGrowth : prevDayGrowth;

        // ★ v7.3.3: 수집 편차에 의한 음수 growth 방지
        let reviewGrowth = 0;
        let priceChange = 0;
        let productCountChange = 0;
        if (prevStat) {
          const prevDate = String(prevStat.statDate || '');
          if (prevDate !== todayStr) {
            const rawGrowth = totalReviewSum - (N(prevStat.totalReviewSum) || 0);
            if (rawGrowth >= 0) {
              reviewGrowth = rawGrowth;
            } else {
              reviewGrowth = fallbackGrowth > 0 ? fallbackGrowth : 0;
            }
            priceChange = (latest.avgPrice || 0) - (N(prevStat.avgPrice) || 0);
            productCountChange = (latest.totalItems || 0) - (N(prevStat.productCount) || 0);
          } else if (fallbackGrowth > 0) {
            reviewGrowth = fallbackGrowth;
          }
        } else if (prevSnapshotReviewSum !== null) {
          const prevSnap = querySnapshots.length > 1 ? querySnapshots[1] : null;
          const prevSnapDate = prevSnap?.createdAt ? String(prevSnap.createdAt).slice(0, 10) : '';
          if (prevSnapDate && prevSnapDate !== todayStr) {
            const rawGrowth = totalReviewSum - prevSnapshotReviewSum;
            if (rawGrowth >= 0) {
              reviewGrowth = rawGrowth;
            } else {
              reviewGrowth = fallbackGrowth > 0 ? fallbackGrowth : 0;
            }
            priceChange = (latest.avgPrice || 0) - (prevSnapshotAvgPrice || 0);
            productCountChange = (latest.totalItems || 0) - (prevSnapshotTotalItems || 0);
          }
        }

        const salesEstimate = reviewGrowth * 20;

        // 수요 점수 — 성장 + 절대값 기반 병합
        let demandScore = 0;
        if (salesEstimate > 500) demandScore = 90;
        else if (salesEstimate > 200) demandScore = 75;
        else if (salesEstimate > 100) demandScore = 60;
        else if (salesEstimate > 50) demandScore = 45;
        else if (salesEstimate > 20) demandScore = 30;
        else if (salesEstimate > 5) demandScore = 15;
        else if (reviewGrowth > 0) demandScore = 10;

        // 절대값 기반 기본 수요 점수 (이전 데이터 없을 때 보완)
        if (demandScore === 0 && items.length > 0) {
          let baselineDemand = 0;
          const avgReviewCount = totalReviewSum / Math.max(1, items.length);
          if (avgReviewCount > 500) baselineDemand += 25;
          else if (avgReviewCount > 200) baselineDemand += 20;
          else if (avgReviewCount > 100) baselineDemand += 15;
          else if (avgReviewCount > 50) baselineDemand += 10;
          else if (avgReviewCount > 20) baselineDemand += 5;
          if (items.length >= 30) baselineDemand += 10;
          else if (items.length >= 20) baselineDemand += 5;
          const rocketRatio = items.length ? rocketCount / items.length : 0;
          if (rocketRatio > 0.5) baselineDemand += 10;
          else if (rocketRatio > 0.3) baselineDemand += 5;
          demandScore = Math.min(50, baselineDemand);
        }

        // 키워드 점수 — 경쟁도 역수 + 수요 점수 반영
        const avgReviewPerProduct = items.length > 0 ? totalReviewSum / items.length : 0;
        const competitionFactor = Math.max(0, 100 - (latest.competitionScore || 0)) / 100;
        
        // v7.2.7: 정규화된 키워드 점수 계산
        let reviewGrowthScore = 0;
        if (reviewGrowth >= 100) reviewGrowthScore = 25;
        else if (reviewGrowth >= 50) reviewGrowthScore = 20;
        else if (reviewGrowth >= 20) reviewGrowthScore = 15;
        else if (reviewGrowth >= 10) reviewGrowthScore = 10;
        else if (reviewGrowth >= 5) reviewGrowthScore = 7;
        else if (reviewGrowth > 0) reviewGrowthScore = 3;
        
        let marketSizeScore = 0;
        if (avgReviewPerProduct >= 500) marketSizeScore = 25;
        else if (avgReviewPerProduct >= 200) marketSizeScore = 20;
        else if (avgReviewPerProduct >= 100) marketSizeScore = 15;
        else if (avgReviewPerProduct >= 50) marketSizeScore = 10;
        else if (avgReviewPerProduct >= 20) marketSizeScore = 5;
        
        const competitionEaseScore = Math.round(competitionFactor * 15 + (1 - adRatio / 100) * 10);
        const demandPart = Math.round(demandScore * 0.25);
        
        const keywordScore = Math.min(100, reviewGrowthScore + marketSizeScore + competitionEaseScore + demandPart);

        // upsert: 같은 날짜+키워드가 있으면 업데이트
        const [existing] = await db.select({ id: extKeywordDailyStats.id })
          .from(extKeywordDailyStats)
          .where(and(
            eq(extKeywordDailyStats.userId, ctx.user!.id),
            eq(extKeywordDailyStats.query, query),
            eq(extKeywordDailyStats.statDate, todayStr),
          ))
          .limit(1);

        const statData = {
          snapshotCount: querySnapshots.length,
          productCount: latest.totalItems || 0,
          avgPrice: latest.avgPrice || 0,
          avgRating: latest.avgRating || "0",
          avgReview: latest.avgReview || 0,
          totalReviewSum,
          adCount,
          adRatio,
          rocketCount,
          highReviewCount,
          competitionScore: latest.competitionScore || 0,
          competitionLevel: (latest.competitionLevel || "medium") as "easy" | "medium" | "hard",
          reviewGrowth,
          salesEstimate,
          priceChange,
          productCountChange,
          demandScore,
          keywordScore,
        };

        if (existing) {
          await db.update(extKeywordDailyStats)
            .set(statData)
            .where(eq(extKeywordDailyStats.id, existing.id));
        } else {
          await db.insert(extKeywordDailyStats).values({
            userId: ctx.user!.id,
            query,
            statDate: todayStr,
            ...statData,
          });
        }
        computed++;
      }

      return { success: true, computed, date: todayStr };
    }),

  // 키워드별 일별 통계 목록 조회 (특정 키워드의 시계열 데이터)
  getKeywordDailyStats: protectedProcedure
    .input(z.object({
      query: z.string().min(1).max(255),
      days: z.number().int().min(1).max(90).default(30),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      return db.select()
        .from(extKeywordDailyStats)
        .where(and(
          eq(extKeywordDailyStats.userId, ctx.user!.id),
          eq(extKeywordDailyStats.query, input.query),
          sql`${extKeywordDailyStats.statDate} >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL ${input.days} DAY), '%Y-%m-%d')`,
        ))
        .orderBy(asc(extKeywordDailyStats.statDate))
        .limit(90);
    }),

  // 키워드별 최신 일별 통계 요약 (대시보드 전체 키워드 목록)
  listKeywordStats: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(500).default(100),
      sortBy: z.enum(["keyword_score", "demand_score", "review_growth", "sales_estimate", "competition_score", "avg_price", "query"]).default("keyword_score"),
      sortDir: z.enum(["asc", "desc"]).default("desc"),
      search: z.string().optional(),
    }).default({ limit: 100, sortBy: "keyword_score", sortDir: "desc" }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 각 키워드의 가장 최신 stat_date 레코드만 가져오기
      const conditions = [eq(extKeywordDailyStats.userId, ctx.user!.id)];
      if (input?.search) {
        conditions.push(like(extKeywordDailyStats.query, `%${input.search}%`));
      }

      // 서브쿼리로 각 키워드의 최신 날짜만 가져오기
      const rows = await db.select()
        .from(extKeywordDailyStats)
        .where(and(
          ...conditions,
          sql`(${extKeywordDailyStats.query}, ${extKeywordDailyStats.statDate}) IN (
            SELECT \`query\`, MAX(stat_date) FROM ext_keyword_daily_stats
            WHERE user_id = ${ctx.user!.id}
            GROUP BY \`query\`
          )`,
        ))
        .limit(input?.limit || 100);

      // 정렬 (snake_case sortBy → camelCase Drizzle 프로퍼티 매핑)
      const sortFieldMap: Record<string, string> = {
        keyword_score: "keywordScore",
        demand_score: "demandScore",
        review_growth: "reviewGrowth",
        sales_estimate: "salesEstimate",
        competition_score: "competitionScore",
        avg_price: "avgPrice",
        query: "query",
      };
      const sortField = sortFieldMap[input?.sortBy || "keyword_score"] || "keywordScore";
      const sortDir = input?.sortDir || "desc";
      rows.sort((a: any, b: any) => {
        const av = sortField === "query" ? (a.query || "") : Number(a[sortField] || 0);
        const bv = sortField === "query" ? (b.query || "") : Number(b[sortField] || 0);
        if (sortField === "query") {
          return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
        }
        return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
      });

      return rows;
    }),

  // 키워드별 통계 전체 요약 (대시보드 헤더)
  keywordStatsOverview: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [overview] = await db.select({
        totalKeywords: sql<number>`COUNT(DISTINCT \`query\`)`,
        avgDemandScore: sql<number>`ROUND(AVG(demand_score))`,
        avgKeywordScore: sql<number>`ROUND(AVG(keyword_score))`,
        avgCompetition: sql<number>`ROUND(AVG(competition_score))`,
        totalSalesEstimate: sql<number>`SUM(sales_estimate)`,
        avgPrice: sql<number>`ROUND(AVG(avg_price))`,
        totalReviewGrowth: sql<number>`SUM(review_growth)`,
      })
        .from(extKeywordDailyStats)
        .where(and(
          eq(extKeywordDailyStats.userId, ctx.user!.id),
          sql`(${extKeywordDailyStats.query}, ${extKeywordDailyStats.statDate}) IN (
            SELECT \`query\`, MAX(stat_date) FROM ext_keyword_daily_stats
            WHERE user_id = ${ctx.user!.id}
            GROUP BY \`query\`
          )`,
        ));

      return overview ? {
        totalKeywords: N(overview.totalKeywords),
        avgDemandScore: N(overview.avgDemandScore),
        avgKeywordScore: N(overview.avgKeywordScore),
        avgCompetition: N(overview.avgCompetition),
        totalSalesEstimate: N(overview.totalSalesEstimate),
        avgPrice: N(overview.avgPrice),
        totalReviewGrowth: N(overview.totalReviewGrowth),
      } : {};
    }),

  // 키워드 삭제 (키워드 데이터 전체 제거: 스냅샷 + 일별통계)
  deleteKeyword: protectedProcedure
    .input(z.object({ query: z.string().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 스냅샷 삭제
      await db.delete(extSearchSnapshots)
        .where(and(eq(extSearchSnapshots.userId, ctx.user!.id), eq(extSearchSnapshots.query, input.query)));

      // 일별 통계 삭제
      await db.delete(extKeywordDailyStats)
        .where(and(eq(extKeywordDailyStats.userId, ctx.user!.id), eq(extKeywordDailyStats.query, input.query)));

      return { success: true, query: input.query };
    }),

  // 키워드 일괄 삭제
  deleteKeywords: protectedProcedure
    .input(z.object({ queries: z.array(z.string().min(1).max(255)).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      for (const query of input.queries) {
        await db.delete(extSearchSnapshots)
          .where(and(eq(extSearchSnapshots.userId, ctx.user!.id), eq(extSearchSnapshots.query, query)));
        await db.delete(extKeywordDailyStats)
          .where(and(eq(extKeywordDailyStats.userId, ctx.user!.id), eq(extKeywordDailyStats.query, query)));
      }

      return { success: true, count: input.queries.length };
    }),

  // ===== AI 인사이트 — 축적 데이터 기반 분석 =====

  // AI 인사이트: 놓친 기회 + 파생상품 제안 + 종합 분석
  aiInsights: protectedProcedure
    .input(z.object({
      forceRefresh: z.boolean().default(false),
    }).default({ forceRefresh: false }))
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 1. 모든 스냅샷 데이터 가져오기
      const snapshots = await db.select()
        .from(extSearchSnapshots)
        .where(eq(extSearchSnapshots.userId, ctx.user!.id))
        .orderBy(desc(extSearchSnapshots.createdAt));

      // 2. 일별 통계 가져오기
      const dailyStats = await db.select()
        .from(extKeywordDailyStats)
        .where(eq(extKeywordDailyStats.userId, ctx.user!.id))
        .orderBy(desc(extKeywordDailyStats.statDate));

      if (!snapshots.length) {
        return {
          missedOpportunities: [],
          derivativeProducts: [],
          competitorAlerts: [],
          insights: [],
          summary: "검색 데이터가 아직 없습니다. 쿠팡에서 키워드를 검색하면 데이터가 자동으로 축적됩니다.",
        };
      }

      // 3. 데이터 분석 — 규칙 기반 인사이트 생성
      const insights: any[] = [];
      const missedOpportunities: any[] = [];
      const derivativeProducts: any[] = [];
      const competitorAlerts: any[] = [];

      // 키워드별 최신 스냅샷 그룹핑
      const keywordMap = new Map<string, any>();
      for (const s of snapshots) {
        if (!keywordMap.has(s.query)) keywordMap.set(s.query, s);
      }

      // 키워드별 일별 통계 그룹핑
      const dailyMap = new Map<string, any[]>();
      for (const d of dailyStats) {
        if (!dailyMap.has(d.query)) dailyMap.set(d.query, []);
        dailyMap.get(d.query)!.push(d);
      }

      for (const [keyword, snapshot] of keywordMap) {
        let items: any[] = [];
        try { items = snapshot.itemsJson ? JSON.parse(snapshot.itemsJson) : []; } catch { items = []; }

        const daily = dailyMap.get(keyword) || [];
        const totalItems = snapshot.totalItems || 0;
        const avgPrice = snapshot.avgPrice || 0;
        const avgReview = snapshot.avgReview || 0;
        const competitionScore = snapshot.competitionScore || 0;
        const adCount = snapshot.adCount || 0;
        const adRatio = totalItems > 0 ? (adCount / totalItems) * 100 : 0;

        // === 놓친 기회 분석 ===
        // 경쟁이 낮고 리뷰가 적은 키워드 = 진입 기회
        if (competitionScore < 40 && avgReview < 200 && totalItems > 10) {
          missedOpportunities.push({
            keyword,
            reason: `경쟁도 ${competitionScore}점으로 낮고, 평균 리뷰 ${avgReview}건으로 신규 진입 적합`,
            score: 100 - competitionScore,
            type: "low_competition",
            avgPrice,
            totalItems,
          });
        }

        // 광고가 많은데 경쟁도가 낮은 경우 = 광고비로 순위를 사는 시장
        if (adRatio > 25 && competitionScore < 50) {
          missedOpportunities.push({
            keyword,
            reason: `광고 비율 ${Math.round(adRatio)}%이지만 경쟁도 ${competitionScore}점 — 광고 없이 진입 가능`,
            score: Math.round(90 - competitionScore * 0.5),
            type: "ad_opportunity",
            avgPrice,
            totalItems,
          });
        }

        // 평균가가 높은데 리뷰가 적은 = 고마진 기회
        if (avgPrice > 20000 && avgReview < 300) {
          missedOpportunities.push({
            keyword,
            reason: `평균가 ${avgPrice.toLocaleString()}원으로 마진이 높고, 평균 리뷰 ${avgReview}건으로 경쟁이 적음`,
            score: Math.min(95, Math.round(avgPrice / 500)),
            type: "high_margin",
            avgPrice,
            totalItems,
          });
        }

        // === 파생 상품 제안 (의미적 연관 키워드) ===
        if (items.length > 0) {
          // 커머스 불용어 — 파생 키워드로 의미 없는 단어들
          const DERIVED_NOISE = /^(세트|개입|세트입|묶음|패키지|특가|인기|추천|프리미엄|신상|무료배송|당일|국내|용품|제품|상품|전용|겸용|개당|매입|적립|포인트|도착|배송|발송|출고|택배|반품|교환|증정|사은품|할인|쿠폰|세일|최저가|초특가|핫딜|대용량|소용량|정품|수입|국산|미니|슬림|블랙|화이트|그레이|네이비|베이지|브라운|핑크|레드|블루|그린|골드|실버|리뉴얼|업그레이드|신제품|한정|품절|히트|대박|베스트|랭킹|호환|사이즈|색상|컬러|보장|가능|불가|포함|별도|단품|낱개|잡화|기타|공식|판매|인증|고급|럭셔리)$/;
          // 수량/단위 패턴
          const UNIT_PATTERN = /^\d+[개팩세트입매장병봉롤캔컵짝]+$|^\d+[+]\d+$|^\d+[PpRr]$/;
          // 색상 패턴
          const COLOR_PATTERN = /^(블랙|화이트|그레이|네이비|베이지|브라운|핑크|레드|블루|그린|옐로우|퍼플|오렌지|실버|골드|아이보리|카키|와인|차콜)$/;

          // 검색 키워드의 핵심 단어 추출
          const keywordTokens = keyword.match(/[가-힣]{2,}|[a-zA-Z]{2,}/g) || [];

          // 1단계: 상위 상품 타이틀에서 의미있는 "상품 특성" 단어 추출
          const wordContext = new Map<string, { count: number; titles: string[] }>();

          for (const item of items.slice(0, 30)) {
            const title = (item.title || "").replace(/\[.*?\]/g, "").replace(/\(.*?\)/g, "");
            const words = title.match(/[가-힣]{2,}/g) || [];
            const seen = new Set<string>();
            for (const w of words) {
              if (seen.has(w)) continue;
              seen.add(w);
              if (keywordTokens.some((kt: string) => kt === w || w.includes(kt) || kt.includes(w))) continue;
              if (w.length < 2 || DERIVED_NOISE.test(w) || UNIT_PATTERN.test(w) || COLOR_PATTERN.test(w)) continue;
              if (/^\d|\d$/.test(w) || /^[A-Z]{1,3}$/.test(w)) continue;
              const existing = wordContext.get(w) || { count: 0, titles: [] };
              existing.count++;
              if (existing.titles.length < 3) existing.titles.push(title.slice(0, 40));
              wordContext.set(w, existing);
            }
          }

          // 2단계: 상품 특성 분류 — 대상/재질/용도/형태 등
          const PRODUCT_ATTRS = /^(강아지|고양이|반려견|반려묘|애견|애묘|유아|아기|어린이|성인|여성|남성|실리콘|스테인리스|원목|나무|플라스틱|가죽|면|린넨|폴리|접이식|휴대용|무선|유선|충전식|자동|수동|방수|방한|보온|보냉|미끄럼방지|논슬립|항균|살균|친환경|대형|중형|소형|초소형|유기농|천연)$/;
          const CATEGORY_WORDS = /^(브러쉬|브러시|빗|솔|클리너|청소기|정리함|수납함|보관함|바구니|가방|파우치|케이스|커버|매트|패드|쿠션|방석|이불|담요|텀블러|컵|접시|그릇|냄비|팬|도마|칼|가위|스푼|포크|젓가락|장갑|양말|모자|마스크|슬리퍼|필터|리필|충전기|거치대|스탠드|홀더|트레이|디스펜서|스프레이|세정제|세제|샴푸|린스|크림|오일|밤|젤|폼|워터|미스트|팩|마사지|롤러|밴드|테이프|스티커|라벨)$/;

          // 3단계: 의미적 파생 키워드 생성
          const candidates: Array<{ word: string; count: number; type: string }> = [];

          for (const [word, ctx] of wordContext.entries()) {
            if (ctx.count < 2) continue;
            if (PRODUCT_ATTRS.test(word)) {
              candidates.push({ word, count: ctx.count, type: "attribute" });
            } else if (CATEGORY_WORDS.test(word)) {
              candidates.push({ word, count: ctx.count, type: "category" });
            } else if (ctx.count >= 3 && word.length >= 2) {
              candidates.push({ word, count: ctx.count, type: "related" });
            }
          }

          // 속성어 우선, 등장 횟수 순 정렬
          candidates.sort((a, b) => {
            const tp: Record<string, number> = { attribute: 3, category: 2, related: 1 };
            const diff = (tp[b.type] || 0) - (tp[a.type] || 0);
            return diff !== 0 ? diff : b.count - a.count;
          });

          for (const c of candidates.slice(0, 6)) {
            const typeLabel = c.type === "attribute" ? "대상/속성" : c.type === "category" ? "관련 품목" : "연관 키워드";
            // 파생 키워드: "고양이 브러쉬", "실리콘 매트" 형태로 생성
            const coreKeyword = keywordTokens.filter((t: string) => !c.word.includes(t)).join(" ");
            const suggestion = coreKeyword ? `${c.word} ${coreKeyword}` : `${c.word} ${keyword}`;
            derivativeProducts.push({
              keyword,
              suggestion,
              alternativeKeyword: c.word,
              confidence: Math.min(95, c.count * 12 + (c.type === "attribute" ? 20 : c.type === "category" ? 10 : 0)),
              reason: `상위 상품 ${c.count}개에서 발견된 ${typeLabel} "${c.word}" — 별도 검색으로 틈새시장 확인 추천`,
              occurrences: c.count,
              type: c.type,
            });
          }
        }
        // === 경쟁자 알림 ===
        // 리뷰 급증 감지 (일별 데이터 필요)
        if (daily.length >= 2) {
          const latest = daily[0];
          const prev = daily[1];
          if (Number(latest.totalReviewSum) > Number(prev.totalReviewSum) * 1.1) {
            competitorAlerts.push({
              keyword,
              type: "review_surge",
              message: `총 리뷰가 10%+ 급증 (${Number(prev.totalReviewSum).toLocaleString()} → ${Number(latest.totalReviewSum).toLocaleString()})`,
              severity: "warning",
            });
          }
          // 가격 변동 감지
          const priceChange = (Number(latest.avgPrice) - Number(prev.avgPrice));
          if (Math.abs(priceChange) > Number(prev.avgPrice) * 0.05) {
            competitorAlerts.push({
              keyword,
              type: "price_change",
              message: `평균가 ${priceChange > 0 ? "상승" : "하락"}: ${Number(prev.avgPrice).toLocaleString()}원 → ${Number(latest.avgPrice).toLocaleString()}원 (${priceChange > 0 ? "+" : ""}${priceChange.toLocaleString()}원)`,
              severity: priceChange > 0 ? "info" : "warning",
            });
          }
        }
      }

      // === 종합 인사이트 ===
      const allCompetitions = [...keywordMap.values()].map(s => s.competitionScore || 0);
      const avgCompetition = allCompetitions.length ? Math.round(allCompetitions.reduce((a: number, b: number) => a + b, 0) / allCompetitions.length) : 0;

      if (avgCompetition < 40) {
        insights.push({
          type: "positive",
          icon: "🎯",
          title: "전체적으로 경쟁이 낮은 키워드들",
          message: `평균 경쟁도 ${avgCompetition}점 — 현재 추적 키워드들은 대체로 진입 장벽이 낮습니다.`,
        });
      } else if (avgCompetition > 70) {
        insights.push({
          type: "warning",
          icon: "⚠️",
          title: "경쟁이 치열한 키워드가 많습니다",
          message: `평균 경쟁도 ${avgCompetition}점 — 경쟁이 낮은 니치 키워드를 추가로 탐색하세요.`,
        });
      }

      // 데이터 축적 안내
      if (dailyStats.length < keywordMap.size * 2) {
        insights.push({
          type: "info",
          icon: "📊",
          title: "데이터 축적이 필요합니다",
          message: `리뷰증가, 판매추정, 수요점수는 매일 쿠팡에서 검색할 때마다 데이터가 축적됩니다. 2~3일간 같은 키워드를 검색하면 추이 분석이 시작됩니다.`,
        });
      }

      // 파생 상품 안내
      if (derivativeProducts.length > 0) {
        insights.push({
          type: "suggestion",
          icon: "💡",
          title: `${derivativeProducts.length}개 파생 키워드 발견`,
          message: `현재 추적 중인 키워드에서 ${derivativeProducts.length}개의 파생/유사 상품 키워드가 발견되었습니다.`,
        });
      }

      const summary = [
        `📦 ${keywordMap.size}개 키워드 분석 완료`,
        missedOpportunities.length ? `🎯 놓친 기회 ${missedOpportunities.length}건` : "",
        derivativeProducts.length ? `💡 파생상품 제안 ${derivativeProducts.length}건` : "",
        competitorAlerts.length ? `⚠️ 경쟁자 알림 ${competitorAlerts.length}건` : "",
      ].filter(Boolean).join(" · ");

      return {
        missedOpportunities: missedOpportunities.sort((a, b) => b.score - a.score).slice(0, 10),
        derivativeProducts: derivativeProducts.sort((a, b) => b.confidence - a.confidence).slice(0, 15),
        competitorAlerts: competitorAlerts.slice(0, 10),
        insights,
        summary,
      };
    }),

});
