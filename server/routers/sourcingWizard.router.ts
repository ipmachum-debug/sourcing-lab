import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { marketKeywordStats, marketProductStats } from "../../drizzle/schema";
import { and, desc, eq, gte, inArray, lt, lte, sql, SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { rebuildMarketPool } from "../lib/marketPoolService";

// 티어별 월매출(원) 경계
const TIER_BOUNDS: Record<string, { min: number; max?: number }> = {
  beginner: { min: 3_000_000, max: 10_000_000 },
  intermediate: { min: 10_000_000, max: 30_000_000 },
  advanced: { min: 30_000_000 },
  trend: { min: 30_000_000 }, // + 리뷰 50 이하 (아래에서 강제)
};

const HIGH_PRICE_THRESHOLD = 20_000;

/**
 * 꿀통키워드 소싱 위저드 — 전 유저 공유 풀(market_keyword_stats) 조회.
 * userId로 필터하지 않음(공유 데이터). 별도 크롤링 없이 검색-수집된 데이터를 그대로 노출.
 */
export const sourcingWizardRouter = router({
  // 공유 풀 재구성 (관리자) — 유저별 수집 데이터를 병합해 market_* 채움.
  // 배치에서 주기 호출하거나 관리자가 수동 트리거.
  rebuildPool: adminProcedure
    .input(z.object({ windowDays: z.number().int().min(1).max(90).default(21) }).optional())
    .mutation(async ({ input }) => {
      return await rebuildMarketPool({ windowDays: input?.windowDays ?? 21 });
    }),

  // 로딩 화면용 카운터 (KEYWORDS / CATEGORIES / PRODUCTS)
  honeypotStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const [kw] = await db
      .select({
        keywords: sql<number>`count(*)`,
        categories: sql<number>`count(distinct ${marketKeywordStats.categoryHint})`,
      })
      .from(marketKeywordStats);
    const [pr] = await db
      .select({ products: sql<number>`count(*)` })
      .from(marketProductStats);
    return {
      keywords: Number(kw?.keywords ?? 0),
      categories: Number(kw?.categories ?? 0),
      products: Number(pr?.products ?? 0),
    };
  }),

  // 꿀통키워드 검색
  honeypotSearch: protectedProcedure
    .input(
      z.object({
        tier: z.enum(["beginner", "intermediate", "advanced", "trend"]),
        maxReview: z.number().int().min(50).max(1000).default(500),
        categories: z.array(z.string()).default([]),
        tags: z
          .array(
            z.enum(["surge", "new", "blue_ocean", "seasonal", "rocket_gap", "high_price"])
          )
          .default([]),
        limit: z.number().int().min(1).max(50).default(20),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const bounds = TIER_BOUNDS[input.tier];
      const conditions: SQL[] = [];

      // 티어 월매출 경계
      conditions.push(gte(marketKeywordStats.monthlyRevenue, String(bounds.min)));
      if (bounds.max) {
        conditions.push(lt(marketKeywordStats.monthlyRevenue, String(bounds.max)));
      }

      // 효자상품 최대 리뷰수 (트렌드는 50 이하 강제)
      const effMaxReview = input.tier === "trend" ? Math.min(input.maxReview, 50) : input.maxReview;
      conditions.push(lte(marketKeywordStats.topProductReviewCount, effMaxReview));

      // 카테고리 (미선택 시 전체)
      if (input.categories.length) {
        conditions.push(inArray(marketKeywordStats.categoryHint, input.categories));
      }

      // 태그 필터
      for (const tag of input.tags) {
        if (tag === "surge") {
          conditions.push(
            inArray(marketKeywordStats.spikeLevel, ["rising", "surging", "explosive"])
          );
        } else if (tag === "blue_ocean") {
          conditions.push(eq(marketKeywordStats.competitionLevel, "easy"));
        } else if (tag === "high_price") {
          conditions.push(gte(marketKeywordStats.avgPrice, HIGH_PRICE_THRESHOLD));
        } else if (tag === "rocket_gap") {
          // 로켓 상품 비중이 낮은(로켓 공백) 키워드
          conditions.push(
            sql`${marketKeywordStats.rocketCount} * 2 < ${marketKeywordStats.productCount}`
          );
        }
        // "new" / "seasonal" 은 공유 풀에 신호 컬럼이 없어 후속 단계에서 지원 (P5)
      }

      const keywords = await db
        .select()
        .from(marketKeywordStats)
        .where(and(...conditions))
        .orderBy(desc(marketKeywordStats.honeypotScore), desc(marketKeywordStats.monthlyRevenue))
        .limit(input.limit);

      if (!keywords.length) {
        return { totalFound: 0, items: [] as HoneypotItem[] };
      }

      // 효자상품 조인 (키워드별 상위 상품)
      const norms = keywords.map(k => k.normalizedKeyword);
      const products = await db
        .select()
        .from(marketProductStats)
        .where(inArray(marketProductStats.normalizedKeyword, norms))
        .orderBy(desc(marketProductStats.estMonthlyRevenue));

      const productsByKeyword = new Map<string, typeof products>();
      for (const p of products) {
        const arr = productsByKeyword.get(p.normalizedKeyword) ?? [];
        arr.push(p);
        productsByKeyword.set(p.normalizedKeyword, arr);
      }

      const items: HoneypotItem[] = keywords.map(k => ({
        keyword: k.keyword,
        normalizedKeyword: k.normalizedKeyword,
        grade: k.grade ?? "C",
        tier: input.tier,
        category: k.categoryHint,
        stats: {
          productCount: k.productCount ?? 0,
          avgPrice: k.avgPrice ?? 0,
          totalReviewSum: k.totalReviewSum ?? 0,
          topProductReviewCount: k.topProductReviewCount ?? 0,
          competitionLevel: k.competitionLevel ?? "medium",
          monthlySales: k.monthlySales ?? 0,
          monthlyRevenue: Number(k.monthlyRevenue ?? 0),
          honeypotScore: k.honeypotScore ?? 0,
          contributorCount: k.contributorCount ?? 0,
          lastObservedDate: k.lastObservedDate,
        },
        topProducts: (productsByKeyword.get(k.normalizedKeyword) ?? [])
          .slice(0, 5)
          .map(p => ({
            coupangProductId: p.coupangProductId,
            productName: p.productName,
            price: p.price ?? 0,
            reviewCount: p.reviewCount ?? 0,
            estMonthlySales: p.estMonthlySales ?? 0,
            estMonthlyRevenue: Number(p.estMonthlyRevenue ?? 0),
            rankInKeyword: p.rankInKeyword ?? 0,
          })),
      }));

      return { totalFound: items.length, items };
    }),
});

type HoneypotItem = {
  keyword: string;
  normalizedKeyword: string;
  grade: string;
  tier: string;
  category: string | null;
  stats: {
    productCount: number;
    avgPrice: number;
    totalReviewSum: number;
    topProductReviewCount: number;
    competitionLevel: string;
    monthlySales: number;
    monthlyRevenue: number;
    honeypotScore: number;
    contributorCount: number;
    lastObservedDate: string | null;
  };
  topProducts: Array<{
    coupangProductId: string;
    productName: string;
    price: number;
    reviewCount: number;
    estMonthlySales: number;
    estMonthlyRevenue: number;
    rankInKeyword: number;
  }>;
};
