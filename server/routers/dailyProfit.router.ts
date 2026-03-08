import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { dailySales, products, productMarginScenarios } from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

// ──────────── helpers ────────────
/** Drizzle-ORM returns decimal/SUM results as string — always coerce to number */
function N(v: any): number { return Number(v) || 0; }

function getMarginMap(margins: any[], productIds: number[]) {
  const marginMap = new Map<number, { sellPrice: string; margin: string }>();
  for (const pid of productIds) {
    const pm = margins.filter((m) => m.productId === pid);
    if (pm.length === 0) continue;
    const best = pm.find((m) => m.isPrimary) || pm.find((m) => m.label === "normal") || pm[0];
    if (best) marginMap.set(pid, { sellPrice: best.sellPrice || "0", margin: best.profit || "0" });
  }
  return marginMap;
}

export const dailyProfitRouter = router({
  // ==================== 1) 특정 날짜 판매 데이터 ====================
  getByDate: protectedProcedure
    .input(z.object({ date: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const allProducts = await db
        .select({ id: products.id, productName: products.productName, category: products.category, status: products.status })
        .from(products)
        .where(and(eq(products.userId, ctx.user.id), sql`${products.status} != 'dropped'`))
        .orderBy(desc(products.createdAt));

      const sales = await db.select().from(dailySales).where(and(eq(dailySales.userId, ctx.user.id), eq(dailySales.saleDate, input.date)));
      const salesMap = new Map(sales.map((s) => [s.productId, s]));

      const productIds = allProducts.map((p) => p.id);
      let margins: any[] = [];
      if (productIds.length > 0) {
        margins = await db
          .select({
            productId: productMarginScenarios.productId,
            sellPrice: productMarginScenarios.sellPrice,
            profit: productMarginScenarios.profit,
            isPrimary: productMarginScenarios.isPrimary,
            label: productMarginScenarios.label,
          })
          .from(productMarginScenarios)
          .where(sql`${productMarginScenarios.productId} IN (${sql.join(productIds.map((id) => sql`${id}`), sql`, `)})`);
      }
      const marginMap = getMarginMap(margins, productIds);

      const items = allProducts.map((p) => {
        const sale = salesMap.get(p.id);
        const mi = marginMap.get(p.id);
        const sellPrice = sale ? Number(sale.sellPrice) : Number(mi?.sellPrice || 0);
        const margin = sale ? Number(sale.margin) : Number(mi?.margin || 0);
        const quantity = sale?.quantity || 0;
        return {
          productId: p.id,
          productName: p.productName,
          category: p.category,
          status: p.status,
          saleId: sale?.id || null,
          sellPrice,
          margin,
          quantity,
          dailyRevenue: sellPrice * quantity,
          dailyProfit: margin * quantity,
          memo: sale?.memo || null,
        };
      });

      const totalQuantity = items.reduce((s, i) => s + i.quantity, 0);
      const totalRevenue = items.reduce((s, i) => s + i.dailyRevenue, 0);
      const totalProfit = items.reduce((s, i) => s + i.dailyProfit, 0);

      return { date: input.date, items, summary: { totalQuantity, totalRevenue, totalProfit } };
    }),

  // ==================== 2) 판매량 upsert ====================
  upsertSale: protectedProcedure
    .input(z.object({ productId: z.number(), date: z.string(), quantity: z.number().min(0), sellPrice: z.number().optional(), margin: z.number().optional(), memo: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const sellPrice = input.sellPrice || 0;
      const margin = input.margin || 0;
      const dailyRevenue = sellPrice * input.quantity;
      const dailyProfit = margin * input.quantity;

      const [existing] = await db
        .select()
        .from(dailySales)
        .where(and(eq(dailySales.userId, ctx.user.id), eq(dailySales.productId, input.productId), eq(dailySales.saleDate, input.date)))
        .limit(1);

      if (existing) {
        await db.update(dailySales).set({ quantity: input.quantity, sellPrice: String(sellPrice), margin: String(margin), dailyRevenue: String(dailyRevenue), dailyProfit: String(dailyProfit), memo: input.memo || null }).where(eq(dailySales.id, existing.id));
      } else {
        await db.insert(dailySales).values({ userId: ctx.user.id, productId: input.productId, saleDate: input.date, quantity: input.quantity, sellPrice: String(sellPrice), margin: String(margin), dailyRevenue: String(dailyRevenue), dailyProfit: String(dailyProfit), memo: input.memo || null });
      }
      return { success: true, calculated: { dailyRevenue, dailyProfit } };
    }),

  // ==================== 3) 기간별 일별 요약 (주간 등) ====================
  getSummary: protectedProcedure
    .input(z.object({ startDate: z.string(), endDate: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const results = await db
        .select({
          saleDate: dailySales.saleDate,
          totalQuantity: sql<number>`SUM(${dailySales.quantity})`,
          totalRevenue: sql<number>`SUM(${dailySales.dailyRevenue})`,
          totalProfit: sql<number>`SUM(${dailySales.dailyProfit})`,
        })
        .from(dailySales)
        .where(and(eq(dailySales.userId, ctx.user.id), sql`${dailySales.saleDate} >= ${input.startDate}`, sql`${dailySales.saleDate} <= ${input.endDate}`))
        .groupBy(dailySales.saleDate)
        .orderBy(dailySales.saleDate);

      // Coerce decimal string results to numbers
      const coerced = results.map(r => ({
        saleDate: r.saleDate,
        totalQuantity: N(r.totalQuantity),
        totalRevenue: N(r.totalRevenue),
        totalProfit: N(r.totalProfit),
      }));

      const grandTotal = {
        totalQuantity: coerced.reduce((s, r) => s + r.totalQuantity, 0),
        totalRevenue: coerced.reduce((s, r) => s + r.totalRevenue, 0),
        totalProfit: coerced.reduce((s, r) => s + r.totalProfit, 0),
      };
      return { daily: coerced, grandTotal };
    }),

  // ==================== 4) 주간 리포트 (상품별) ====================
  getWeeklyReport: protectedProcedure
    .input(z.object({ startDate: z.string(), endDate: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 상품별 집계
      const productRows = await db
        .select({
          productId: dailySales.productId,
          totalQuantity: sql<number>`SUM(${dailySales.quantity})`,
          totalRevenue: sql<number>`SUM(${dailySales.dailyRevenue})`,
          totalProfit: sql<number>`SUM(${dailySales.dailyProfit})`,
          avgMargin: sql<number>`AVG(CAST(${dailySales.margin} AS DECIMAL(12,0)))`,
          avgSellPrice: sql<number>`AVG(CAST(${dailySales.sellPrice} AS DECIMAL(12,0)))`,
          salesDays: sql<number>`COUNT(DISTINCT ${dailySales.saleDate})`,
        })
        .from(dailySales)
        .where(and(eq(dailySales.userId, ctx.user.id), sql`${dailySales.saleDate} >= ${input.startDate}`, sql`${dailySales.saleDate} <= ${input.endDate}`, sql`${dailySales.quantity} > 0`))
        .groupBy(dailySales.productId)
        .orderBy(sql`SUM(${dailySales.dailyProfit}) DESC`);

      // 상품 이름 매핑
      const pids = productRows.map((r) => r.productId);
      let productNames = new Map<number, { name: string; category: string | null }>();
      if (pids.length > 0) {
        const pData = await db
          .select({ id: products.id, productName: products.productName, category: products.category })
          .from(products)
          .where(sql`${products.id} IN (${sql.join(pids.map((id) => sql`${id}`), sql`, `)})`);
        pData.forEach((p) => productNames.set(p.id, { name: p.productName, category: p.category }));
      }

      // 일별 합계
      const dailyRows = await db
        .select({
          saleDate: dailySales.saleDate,
          totalQuantity: sql<number>`SUM(${dailySales.quantity})`,
          totalRevenue: sql<number>`SUM(${dailySales.dailyRevenue})`,
          totalProfit: sql<number>`SUM(${dailySales.dailyProfit})`,
        })
        .from(dailySales)
        .where(and(eq(dailySales.userId, ctx.user.id), sql`${dailySales.saleDate} >= ${input.startDate}`, sql`${dailySales.saleDate} <= ${input.endDate}`))
        .groupBy(dailySales.saleDate)
        .orderBy(dailySales.saleDate);

      // Coerce daily breakdown
      const daily = dailyRows.map(d => ({
        saleDate: d.saleDate,
        totalQuantity: N(d.totalQuantity),
        totalRevenue: N(d.totalRevenue),
        totalProfit: N(d.totalProfit),
      }));

      const items = productRows.map((r) => ({
        productId: r.productId,
        productName: productNames.get(r.productId)?.name || "Unknown",
        category: productNames.get(r.productId)?.category || null,
        totalQuantity: N(r.totalQuantity),
        totalRevenue: N(r.totalRevenue),
        totalProfit: N(r.totalProfit),
        avgMargin: Math.round(N(r.avgMargin)),
        avgSellPrice: Math.round(N(r.avgSellPrice)),
        salesDays: N(r.salesDays),
      }));

      const grandTotal = {
        totalQuantity: items.reduce((s, i) => s + i.totalQuantity, 0),
        totalRevenue: items.reduce((s, i) => s + i.totalRevenue, 0),
        totalProfit: items.reduce((s, i) => s + i.totalProfit, 0),
      };

      return { startDate: input.startDate, endDate: input.endDate, items, daily, grandTotal };
    }),

  // ==================== 5) 월간 리포트 ====================
  getMonthlyReport: protectedProcedure
    .input(z.object({ year: z.number(), month: z.number() })) // month 1-12
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const startDate = `${input.year}-${String(input.month).padStart(2, "0")}-01`;
      const lastDay = new Date(input.year, input.month, 0).getDate();
      const endDate = `${input.year}-${String(input.month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      // 상품별 집계
      const productRows = await db
        .select({
          productId: dailySales.productId,
          totalQuantity: sql<number>`SUM(${dailySales.quantity})`,
          totalRevenue: sql<number>`SUM(${dailySales.dailyRevenue})`,
          totalProfit: sql<number>`SUM(${dailySales.dailyProfit})`,
          avgMargin: sql<number>`AVG(CAST(${dailySales.margin} AS DECIMAL(12,0)))`,
          avgSellPrice: sql<number>`AVG(CAST(${dailySales.sellPrice} AS DECIMAL(12,0)))`,
          salesDays: sql<number>`COUNT(DISTINCT ${dailySales.saleDate})`,
        })
        .from(dailySales)
        .where(and(eq(dailySales.userId, ctx.user.id), sql`${dailySales.saleDate} >= ${startDate}`, sql`${dailySales.saleDate} <= ${endDate}`, sql`${dailySales.quantity} > 0`))
        .groupBy(dailySales.productId)
        .orderBy(sql`SUM(${dailySales.dailyProfit}) DESC`);

      const pids = productRows.map((r) => r.productId);
      let productNames = new Map<number, { name: string; category: string | null }>();
      if (pids.length > 0) {
        const pData = await db
          .select({ id: products.id, productName: products.productName, category: products.category })
          .from(products)
          .where(sql`${products.id} IN (${sql.join(pids.map((id) => sql`${id}`), sql`, `)})`);
        pData.forEach((p) => productNames.set(p.id, { name: p.productName, category: p.category }));
      }

      // 주별 합계
      const weeklyRows = await db
        .select({
          weekNum: sql<string>`CONCAT(YEAR(${dailySales.saleDate}), '-W', LPAD(WEEK(${dailySales.saleDate}, 1), 2, '0'))`,
          weekStart: sql<string>`MIN(${dailySales.saleDate})`,
          weekEnd: sql<string>`MAX(${dailySales.saleDate})`,
          totalQuantity: sql<number>`SUM(${dailySales.quantity})`,
          totalRevenue: sql<number>`SUM(${dailySales.dailyRevenue})`,
          totalProfit: sql<number>`SUM(${dailySales.dailyProfit})`,
        })
        .from(dailySales)
        .where(and(eq(dailySales.userId, ctx.user.id), sql`${dailySales.saleDate} >= ${startDate}`, sql`${dailySales.saleDate} <= ${endDate}`))
        .groupBy(sql`CONCAT(YEAR(${dailySales.saleDate}), '-W', LPAD(WEEK(${dailySales.saleDate}, 1), 2, '0'))`)
        .orderBy(sql`MIN(${dailySales.saleDate})`);

      // Coerce weekly breakdown
      const weekly = weeklyRows.map(w => ({
        weekNum: w.weekNum,
        weekStart: w.weekStart,
        weekEnd: w.weekEnd,
        totalQuantity: N(w.totalQuantity),
        totalRevenue: N(w.totalRevenue),
        totalProfit: N(w.totalProfit),
      }));

      const items = productRows.map((r) => ({
        productId: r.productId,
        productName: productNames.get(r.productId)?.name || "Unknown",
        category: productNames.get(r.productId)?.category || null,
        totalQuantity: N(r.totalQuantity),
        totalRevenue: N(r.totalRevenue),
        totalProfit: N(r.totalProfit),
        avgMargin: Math.round(N(r.avgMargin)),
        avgSellPrice: Math.round(N(r.avgSellPrice)),
        salesDays: N(r.salesDays),
      }));

      const grandTotal = {
        totalQuantity: items.reduce((s, i) => s + i.totalQuantity, 0),
        totalRevenue: items.reduce((s, i) => s + i.totalRevenue, 0),
        totalProfit: items.reduce((s, i) => s + i.totalProfit, 0),
      };

      return { year: input.year, month: input.month, startDate, endDate, items, weekly, grandTotal };
    }),

  // ==================== 6) 연간 리포트 ====================
  getYearlyReport: protectedProcedure
    .input(z.object({ year: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const startDate = `${input.year}-01-01`;
      const endDate = `${input.year}-12-31`;

      // 상품별 집계
      const productRows = await db
        .select({
          productId: dailySales.productId,
          totalQuantity: sql<number>`SUM(${dailySales.quantity})`,
          totalRevenue: sql<number>`SUM(${dailySales.dailyRevenue})`,
          totalProfit: sql<number>`SUM(${dailySales.dailyProfit})`,
          avgMargin: sql<number>`AVG(CAST(${dailySales.margin} AS DECIMAL(12,0)))`,
          salesDays: sql<number>`COUNT(DISTINCT ${dailySales.saleDate})`,
        })
        .from(dailySales)
        .where(and(eq(dailySales.userId, ctx.user.id), sql`${dailySales.saleDate} >= ${startDate}`, sql`${dailySales.saleDate} <= ${endDate}`, sql`${dailySales.quantity} > 0`))
        .groupBy(dailySales.productId)
        .orderBy(sql`SUM(${dailySales.dailyProfit}) DESC`);

      const pids = productRows.map((r) => r.productId);
      let productNames = new Map<number, { name: string; category: string | null }>();
      if (pids.length > 0) {
        const pData = await db
          .select({ id: products.id, productName: products.productName, category: products.category })
          .from(products)
          .where(sql`${products.id} IN (${sql.join(pids.map((id) => sql`${id}`), sql`, `)})`);
        pData.forEach((p) => productNames.set(p.id, { name: p.productName, category: p.category }));
      }

      // 월별 합계
      const monthlyRows = await db
        .select({
          monthNum: sql<number>`MONTH(${dailySales.saleDate})`,
          totalQuantity: sql<number>`SUM(${dailySales.quantity})`,
          totalRevenue: sql<number>`SUM(${dailySales.dailyRevenue})`,
          totalProfit: sql<number>`SUM(${dailySales.dailyProfit})`,
        })
        .from(dailySales)
        .where(and(eq(dailySales.userId, ctx.user.id), sql`${dailySales.saleDate} >= ${startDate}`, sql`${dailySales.saleDate} <= ${endDate}`))
        .groupBy(sql`MONTH(${dailySales.saleDate})`)
        .orderBy(sql`MONTH(${dailySales.saleDate})`);

      // Coerce monthly breakdown
      const monthly = monthlyRows.map(m => ({
        monthNum: N(m.monthNum),
        totalQuantity: N(m.totalQuantity),
        totalRevenue: N(m.totalRevenue),
        totalProfit: N(m.totalProfit),
      }));

      const items = productRows.map((r) => ({
        productId: r.productId,
        productName: productNames.get(r.productId)?.name || "Unknown",
        category: productNames.get(r.productId)?.category || null,
        totalQuantity: N(r.totalQuantity),
        totalRevenue: N(r.totalRevenue),
        totalProfit: N(r.totalProfit),
        avgMargin: Math.round(N(r.avgMargin)),
        salesDays: N(r.salesDays),
      }));

      const grandTotal = {
        totalQuantity: items.reduce((s, i) => s + i.totalQuantity, 0),
        totalRevenue: items.reduce((s, i) => s + i.totalRevenue, 0),
        totalProfit: items.reduce((s, i) => s + i.totalProfit, 0),
      };

      return { year: input.year, items, monthly, grandTotal };
    }),

  // ==================== 7) 다운로드용 상세 데이터 (기간별) ====================
  getExportData: protectedProcedure
    .input(z.object({ startDate: z.string(), endDate: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const rows = await db
        .select({
          saleDate: dailySales.saleDate,
          productId: dailySales.productId,
          quantity: dailySales.quantity,
          sellPrice: dailySales.sellPrice,
          margin: dailySales.margin,
          dailyRevenue: dailySales.dailyRevenue,
          dailyProfit: dailySales.dailyProfit,
          memo: dailySales.memo,
        })
        .from(dailySales)
        .where(and(eq(dailySales.userId, ctx.user.id), sql`${dailySales.saleDate} >= ${input.startDate}`, sql`${dailySales.saleDate} <= ${input.endDate}`, sql`${dailySales.quantity} > 0`))
        .orderBy(dailySales.saleDate, dailySales.productId);

      const pids = Array.from(new Set(rows.map((r) => r.productId)));
      let productNames = new Map<number, { name: string; category: string | null }>();
      if (pids.length > 0) {
        const pData = await db
          .select({ id: products.id, productName: products.productName, category: products.category })
          .from(products)
          .where(sql`${products.id} IN (${sql.join(pids.map((id) => sql`${id}`), sql`, `)})`);
        pData.forEach((p) => productNames.set(p.id, { name: p.productName, category: p.category }));
      }

      return rows.map((r) => ({
        saleDate: r.saleDate,
        productName: productNames.get(r.productId)?.name || "Unknown",
        category: productNames.get(r.productId)?.category || "",
        quantity: r.quantity,
        sellPrice: Number(r.sellPrice || 0),
        margin: Number(r.margin || 0),
        dailyRevenue: Number(r.dailyRevenue || 0),
        dailyProfit: Number(r.dailyProfit || 0),
        memo: r.memo || "",
      }));
    }),

  // ==================== 8) 판매 기록 삭제 ====================
  deleteSale: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(dailySales).where(and(eq(dailySales.id, input.id), eq(dailySales.userId, ctx.user.id)));
      return { success: true };
    }),
});
