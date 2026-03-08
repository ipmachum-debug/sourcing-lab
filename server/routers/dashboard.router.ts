import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { products, weeklyReviews, dailySales, coupangAccounts, cpDailySales, cpDailySettlements, coupangSyncJobs } from "../../drizzle/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

/** Drizzle-ORM returns decimal/SUM results as string — always coerce to number */
function N(v: any): number { return Number(v) || 0; }

function getCurrentWeekKey(): string {
  const d = new Date();
  const onejan = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${weekNum.toString().padStart(2, "0")}`;
}

export const dashboardRouter = router({
  /** 대시보드 요약 */
  summary: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const userId = ctx.user.id;
      const currentWeek = getCurrentWeekKey();

      // 이번 주 소싱 수
      const [weekCount] = await db.select({ count: sql<number>`count(*)` })
        .from(products)
        .where(and(eq(products.userId, userId), eq(products.weekKey, currentWeek)));

      // 전체 상품 수
      const [totalCount] = await db.select({ count: sql<number>`count(*)` })
        .from(products)
        .where(eq(products.userId, userId));

      // 테스트 후보 수
      const [testCount] = await db.select({ count: sql<number>`count(*)` })
        .from(products)
        .where(and(eq(products.userId, userId), eq(products.status, "test_candidate")));

      // 평균 점수
      const [avgResult] = await db.select({ avg: sql<number>`COALESCE(AVG(score), 0)` })
        .from(products)
        .where(and(eq(products.userId, userId), eq(products.weekKey, currentWeek)));

      // 고득점 상품 TOP 5
      const topProducts = await db.select({
        id: products.id,
        productName: products.productName,
        score: products.score,
        scoreGrade: products.scoreGrade,
        category: products.category,
        status: products.status,
      }).from(products)
        .where(eq(products.userId, userId))
        .orderBy(desc(products.score))
        .limit(5);

      // 이번 주 카테고리별 수
      const weekProducts = await db.select({
        category: products.category,
      }).from(products)
        .where(and(eq(products.userId, userId), eq(products.weekKey, currentWeek)));

      const categoryMap = new Map<string, number>();
      weekProducts.forEach(p => {
        const cat = p.category || "미분류";
        categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);
      });
      const categoryStats = Array.from(categoryMap.entries())
        .sort((a, b) => b[1] - a[1]).slice(0, 5);

      // 이번 주 키워드 TOP 10
      const kwProducts = await db.select({
        keyword1: products.keyword1,
        keyword2: products.keyword2,
        keyword3: products.keyword3,
      }).from(products)
        .where(and(eq(products.userId, userId), eq(products.weekKey, currentWeek)));

      const kwMap = new Map<string, number>();
      kwProducts.forEach(p => {
        [p.keyword1, p.keyword2, p.keyword3].filter(Boolean).forEach(kw => {
          kwMap.set(kw!, (kwMap.get(kw!) || 0) + 1);
        });
      });
      const topKeywords = Array.from(kwMap.entries())
        .sort((a, b) => b[1] - a[1]).slice(0, 10);

      // 금요일 리뷰 작성 여부
      const [weeklyReview] = await db.select().from(weeklyReviews)
        .where(and(eq(weeklyReviews.userId, userId), eq(weeklyReviews.weekKey, currentWeek)))
        .limit(1);

      // 최근 등록 상품 5개
      const recentProducts = await db.select({
        id: products.id,
        productName: products.productName,
        category: products.category,
        score: products.score,
        status: products.status,
        recordDate: products.recordDate,
      }).from(products)
        .where(eq(products.userId, userId))
        .orderBy(desc(products.createdAt))
        .limit(5);

      return {
        currentWeek,
        weekSourcedCount: weekCount?.count || 0,
        totalProductCount: totalCount?.count || 0,
        testCandidateCount: testCount?.count || 0,
        weekAvgScore: Math.round(avgResult?.avg || 0),
        topProducts,
        categoryStats,
        topKeywords,
        weeklyReviewDone: !!weeklyReview,
        recentProducts,
      };
    }),

  /** 판매 요약 (일간/주간/월간) */
  salesSummary: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const userId = ctx.user.id;
      const today = new Date().toISOString().split("T")[0];

      // 이번 주 (월~일)
      const d = new Date();
      const day = d.getDay();
      const mon = new Date(d); mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      const weekStart = mon.toISOString().split("T")[0];
      const weekEnd = sun.toISOString().split("T")[0];

      // 이번 달
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      // Coerce decimal string results
      const [dailyResult] = await db
        .select({
          totalQuantity: sql<number>`COALESCE(SUM(${dailySales.quantity}), 0)`,
          totalRevenue: sql<number>`COALESCE(SUM(${dailySales.dailyRevenue}), 0)`,
          totalProfit: sql<number>`COALESCE(SUM(${dailySales.dailyProfit}), 0)`,
        })
        .from(dailySales)
        .where(and(eq(dailySales.userId, userId), eq(dailySales.saleDate, today)));

      const [weeklyResult] = await db
        .select({
          totalQuantity: sql<number>`COALESCE(SUM(${dailySales.quantity}), 0)`,
          totalRevenue: sql<number>`COALESCE(SUM(${dailySales.dailyRevenue}), 0)`,
          totalProfit: sql<number>`COALESCE(SUM(${dailySales.dailyProfit}), 0)`,
        })
        .from(dailySales)
        .where(and(
          eq(dailySales.userId, userId),
          sql`${dailySales.saleDate} >= ${weekStart}`,
          sql`${dailySales.saleDate} <= ${weekEnd}`
        ));

      const [monthlyResult] = await db
        .select({
          totalQuantity: sql<number>`COALESCE(SUM(${dailySales.quantity}), 0)`,
          totalRevenue: sql<number>`COALESCE(SUM(${dailySales.dailyRevenue}), 0)`,
          totalProfit: sql<number>`COALESCE(SUM(${dailySales.dailyProfit}), 0)`,
        })
        .from(dailySales)
        .where(and(
          eq(dailySales.userId, userId),
          sql`${dailySales.saleDate} >= ${monthStart}`,
          sql`${dailySales.saleDate} <= ${monthEnd}`
        ));

      return {
        daily: {
          totalQuantity: N(dailyResult?.totalQuantity),
          totalRevenue: N(dailyResult?.totalRevenue),
          totalProfit: N(dailyResult?.totalProfit),
          label: today,
        },
        weekly: {
          totalQuantity: N(weeklyResult?.totalQuantity),
          totalRevenue: N(weeklyResult?.totalRevenue),
          totalProfit: N(weeklyResult?.totalProfit),
          label: `${weekStart} ~ ${weekEnd}`,
        },
        monthly: {
          totalQuantity: N(monthlyResult?.totalQuantity),
          totalRevenue: N(monthlyResult?.totalRevenue),
          totalProfit: N(monthlyResult?.totalProfit),
          label: `${year}년 ${month}월`,
        },
      };
    }),

  /** 쿠팡 API 대시보드 요약 (메인 대시보드 카드용) */
  coupangSummary: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const userId = ctx.user.id;

      // 계정 목록
      const accounts = await db.select({
        id: coupangAccounts.id,
        accountName: coupangAccounts.accountName,
        apiStatus: coupangAccounts.apiStatus,
        isDefault: coupangAccounts.isDefault,
      }).from(coupangAccounts).where(eq(coupangAccounts.userId, userId));

      if (accounts.length === 0) return null;

      // KST 기준 날짜 계산
      const nowMs = Date.now() + 9 * 60 * 60 * 1000;
      const kstNow = new Date(nowMs);
      const today = kstNow.toISOString().slice(0, 10);
      const year = kstNow.getUTCFullYear(); const month = kstNow.getUTCMonth() + 1;
      const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      // 오늘 판매량 (전 계정 합산)
      const [todaySales] = await db.select({
        qty: sql<number>`COALESCE(SUM(${cpDailySales.quantity}), 0)`,
        grossSales: sql<number>`COALESCE(SUM(${cpDailySales.grossSales}), 0)`,
        orders: sql<number>`COALESCE(SUM(${cpDailySales.orderCount}), 0)`,
      }).from(cpDailySales).where(and(
        eq(cpDailySales.userId, userId),
        eq(cpDailySales.saleDate, today),
      ));

      // 이번 달 매출+정산 (전 계정 합산)
      const [monthlySales] = await db.select({
        qty: sql<number>`COALESCE(SUM(${cpDailySales.quantity}), 0)`,
        grossSales: sql<number>`COALESCE(SUM(${cpDailySales.grossSales}), 0)`,
        orders: sql<number>`COALESCE(SUM(${cpDailySales.orderCount}), 0)`,
      }).from(cpDailySales).where(and(
        eq(cpDailySales.userId, userId),
        sql`${cpDailySales.saleDate} >= ${monthStart}`,
        sql`${cpDailySales.saleDate} <= ${monthEnd}`,
      ));

      const [monthlySettle] = await db.select({
        payout: sql<number>`COALESCE(SUM(${cpDailySettlements.payoutAmount}), 0)`,
        commission: sql<number>`COALESCE(SUM(${cpDailySettlements.commissionAmount}), 0)`,
      }).from(cpDailySettlements).where(and(
        eq(cpDailySettlements.userId, userId),
        sql`${cpDailySettlements.settlementDate} >= ${monthStart}`,
        sql`${cpDailySettlements.settlementDate} <= ${monthEnd}`,
      ));

      // 최근 동기화 1건
      const [lastSync] = await db.select({
        id: coupangSyncJobs.id,
        jobType: coupangSyncJobs.jobType,
        status: coupangSyncJobs.status,
        startedAt: coupangSyncJobs.startedAt,
        recordCount: coupangSyncJobs.recordCount,
      }).from(coupangSyncJobs)
        .where(eq(coupangSyncJobs.userId, userId))
        .orderBy(desc(coupangSyncJobs.startedAt))
        .limit(1);

      const activeCount = accounts.filter(a => a.apiStatus === "active").length;

      return {
        accountCount: accounts.length,
        activeCount,
        hasActiveApi: activeCount > 0,
        today: {
          qty: N(todaySales?.qty),
          grossSales: N(todaySales?.grossSales),
          orders: N(todaySales?.orders),
        },
        monthly: {
          qty: N(monthlySales?.qty),
          grossSales: N(monthlySales?.grossSales),
          orders: N(monthlySales?.orders),
          payout: N(monthlySettle?.payout),
          commission: N(monthlySettle?.commission),
          label: `${year}년 ${month}월`,
        },
        lastSync: lastSync || null,
      };
    }),
});
