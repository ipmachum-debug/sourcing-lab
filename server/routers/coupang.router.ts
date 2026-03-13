import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  coupangAccounts, productChannelMappings,
  cpDailySales, cpDailySettlements, coupangSyncJobs, products,
} from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  testCoupangConnection,
  testCoupangApis,
  fetchOrders,
  fetchAllStatusOrders,
  fetchSalesDetail,
  fetchSettlementHistories,
  aggregateOrdersToDailySales,
  aggregateSalesDetailToDaily,
  getYesterdayStr,
  getTodayStr,
  clampDateToYesterday,
  isValidDateFormat,
  isValidYearMonthFormat,
  daysBetween,
} from "../lib/coupangApi";

// ================================================================
//  쿠팡 분석 시스템 라우터
//  쿠팡윙 = 운영 원장  /  내 시스템 = 분석·판단·손익·기록
// ================================================================

/** Drizzle-ORM returns decimal/SUM results as string — always coerce to number */
function N(v: any): number { return Number(v) || 0; }

export const coupangRouter = router({

  // ━━━━━━━━━━━━━━━ 1) API 계정 관리 ━━━━━━━━━━━━━━━
  listAccounts: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db.select().from(coupangAccounts)
      .where(eq(coupangAccounts.userId, ctx.user.id))
      .orderBy(desc(coupangAccounts.isDefault), coupangAccounts.createdAt);
  }),

  createAccount: protectedProcedure
    .input(z.object({
      accountName: z.string().min(1),
      vendorId: z.string().optional(),
      accessKey: z.string().optional(),
      secretKey: z.string().optional(),
      wingLoginId: z.string().optional(),
      companyName: z.string().optional(),
      apiUrl: z.string().optional(),
      ipAddress: z.string().optional(),
      isDefault: z.boolean().optional(),
      memo: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      if (input.isDefault) {
        await db.update(coupangAccounts).set({ isDefault: false })
          .where(and(eq(coupangAccounts.userId, ctx.user.id), eq(coupangAccounts.isDefault, true)));
      }
      const existing = await db.select({ id: coupangAccounts.id }).from(coupangAccounts)
        .where(eq(coupangAccounts.userId, ctx.user.id)).limit(1);
      await db.insert(coupangAccounts).values({
        userId: ctx.user.id,
        accountName: input.accountName,
        vendorId: input.vendorId || null,
        accessKey: input.accessKey || null,
        secretKey: input.secretKey || null,
        wingLoginId: input.wingLoginId || null,
        companyName: input.companyName || null,
        apiUrl: input.apiUrl || null,
        ipAddress: input.ipAddress || null,
        isDefault: input.isDefault || existing.length === 0,
        memo: input.memo || null,
      });
      return { success: true };
    }),

  updateAccount: protectedProcedure
    .input(z.object({
      id: z.number(),
      accountName: z.string().min(1).optional(),
      vendorId: z.string().optional(),
      accessKey: z.string().optional(),
      secretKey: z.string().optional(),
      wingLoginId: z.string().optional(),
      companyName: z.string().optional(),
      apiUrl: z.string().optional(),
      ipAddress: z.string().optional(),
      isActive: z.boolean().optional(),
      isDefault: z.boolean().optional(),
      memo: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...data } = input;
      const [acc] = await db.select().from(coupangAccounts)
        .where(and(eq(coupangAccounts.id, id), eq(coupangAccounts.userId, ctx.user.id))).limit(1);
      if (!acc) throw new TRPCError({ code: "NOT_FOUND" });
      if (data.isDefault) {
        await db.update(coupangAccounts).set({ isDefault: false })
          .where(and(eq(coupangAccounts.userId, ctx.user.id), eq(coupangAccounts.isDefault, true)));
      }
      const upd: Record<string, any> = {};
      if (data.accountName !== undefined) upd.accountName = data.accountName;
      if (data.vendorId !== undefined) upd.vendorId = data.vendorId || null;
      if (data.accessKey !== undefined) upd.accessKey = data.accessKey || null;
      if (data.secretKey !== undefined) upd.secretKey = data.secretKey || null;
      if (data.wingLoginId !== undefined) upd.wingLoginId = data.wingLoginId || null;
      if (data.companyName !== undefined) upd.companyName = data.companyName || null;
      if (data.apiUrl !== undefined) upd.apiUrl = data.apiUrl || null;
      if (data.ipAddress !== undefined) upd.ipAddress = data.ipAddress || null;
      if (data.isActive !== undefined) upd.isActive = data.isActive;
      if (data.isDefault !== undefined) upd.isDefault = data.isDefault;
      if (data.memo !== undefined) upd.memo = data.memo || null;
      if (Object.keys(upd).length > 0) {
        await db.update(coupangAccounts).set(upd).where(eq(coupangAccounts.id, id));
      }
      return { success: true };
    }),

  deleteAccount: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // 연관 데이터 정리
      await db.delete(cpDailySales).where(and(eq(cpDailySales.accountId, input.id), eq(cpDailySales.userId, ctx.user.id)));
      await db.delete(cpDailySettlements).where(and(eq(cpDailySettlements.accountId, input.id), eq(cpDailySettlements.userId, ctx.user.id)));
      await db.delete(productChannelMappings).where(and(eq(productChannelMappings.accountId, input.id), eq(productChannelMappings.userId, ctx.user.id)));
      await db.delete(coupangSyncJobs).where(and(eq(coupangSyncJobs.accountId, input.id), eq(coupangSyncJobs.userId, ctx.user.id)));
      await db.delete(coupangAccounts).where(and(eq(coupangAccounts.id, input.id), eq(coupangAccounts.userId, ctx.user.id)));
      return { success: true };
    }),

  testApi: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [acc] = await db.select().from(coupangAccounts)
        .where(and(eq(coupangAccounts.id, input.id), eq(coupangAccounts.userId, ctx.user.id))).limit(1);
      if (!acc) throw new TRPCError({ code: "NOT_FOUND" });
      if (!acc.accessKey || !acc.secretKey || !acc.vendorId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "업체코드, Access Key, Secret Key를 먼저 입력해주세요." });
      }
      // 실제 쿠팡 OPEN API 호출 테스트
      const result = await testCoupangConnection(acc.accessKey, acc.secretKey, acc.vendorId);
      await db.update(coupangAccounts)
        .set({ apiStatus: result.success ? "active" : "error", lastSyncAt: sql`NOW()` })
        .where(eq(coupangAccounts.id, input.id));
      if (!result.success) {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.message });
      }
      return { success: true, message: result.message };
    }),

  setDefault: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(coupangAccounts).set({ isDefault: false })
        .where(and(eq(coupangAccounts.userId, ctx.user.id), eq(coupangAccounts.isDefault, true)));
      await db.update(coupangAccounts).set({ isDefault: true })
        .where(and(eq(coupangAccounts.id, input.id), eq(coupangAccounts.userId, ctx.user.id)));
      return { success: true };
    }),

  /** 개별 API 엔드포인트 테스트 (settlement, revenue-history, ordersheets 각각) */
  testApis: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [acc] = await db.select().from(coupangAccounts)
        .where(and(eq(coupangAccounts.id, input.id), eq(coupangAccounts.userId, ctx.user.id))).limit(1);
      if (!acc) throw new TRPCError({ code: "NOT_FOUND" });
      if (!acc.accessKey || !acc.secretKey || !acc.vendorId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "업체코드, Access Key, Secret Key를 먼저 입력해주세요." });
      }
      const results = await testCoupangApis(acc.accessKey, acc.secretKey, acc.vendorId);
      const allOk = results.settlement === "OK" && results.revenue === "OK" && results.ordersheets === "OK";
      if (allOk) {
        await db.update(coupangAccounts)
          .set({ apiStatus: "active", lastSyncAt: sql`NOW()` })
          .where(eq(coupangAccounts.id, input.id));
      }
      return { success: allOk, results };
    }),

  // ━━━━━━━━━━━━━━━ 2) 상품 매핑 (소싱 ↔ 쿠팡) ━━━━━━━━━━━━━━━
  listMappings: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const mappings = await db.select().from(productChannelMappings)
        .where(and(eq(productChannelMappings.userId, ctx.user.id), eq(productChannelMappings.accountId, input.accountId)))
        .orderBy(desc(productChannelMappings.updatedAt));

      // 내부 상품 이름 조인
      const internalIds = mappings.map(m => m.internalProductId).filter(Boolean) as number[];
      let productNameMap = new Map<number, { name: string; category: string | null }>();
      if (internalIds.length > 0) {
        const prods = await db.select({ id: products.id, productName: products.productName, category: products.category })
          .from(products)
          .where(sql`${products.id} IN (${sql.join(internalIds.map(id => sql`${id}`), sql`, `)})`);
        prods.forEach(p => productNameMap.set(p.id, { name: p.productName, category: p.category }));
      }

      return mappings.map(m => ({
        ...m,
        internalProductName: m.internalProductId ? productNameMap.get(m.internalProductId)?.name || null : null,
        internalProductCategory: m.internalProductId ? productNameMap.get(m.internalProductId)?.category || null : null,
      }));
    }),

  /** 소싱 상품 목록 (매핑 드롭다운용) */
  listInternalProducts: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db.select({ id: products.id, productName: products.productName, category: products.category, status: products.status })
      .from(products)
      .where(eq(products.userId, ctx.user.id))
      .orderBy(desc(products.createdAt));
  }),

  createMapping: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      internalProductId: z.number().optional(),
      sellerProductId: z.string().optional(),
      vendorItemId: z.string().optional(),
      coupangProductName: z.string().optional(),
      coupangUrl: z.string().optional(),
      memo: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.insert(productChannelMappings).values({
        userId: ctx.user.id,
        accountId: input.accountId,
        internalProductId: input.internalProductId || null,
        sellerProductId: input.sellerProductId || null,
        vendorItemId: input.vendorItemId || null,
        coupangProductName: input.coupangProductName || null,
        coupangUrl: input.coupangUrl || null,
        memo: input.memo || null,
      });
      return { success: true };
    }),

  updateMapping: protectedProcedure
    .input(z.object({
      id: z.number(),
      internalProductId: z.number().nullable().optional(),
      sellerProductId: z.string().optional(),
      vendorItemId: z.string().optional(),
      coupangProductName: z.string().optional(),
      coupangUrl: z.string().optional(),
      isActive: z.boolean().optional(),
      memo: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...data } = input;
      const upd: Record<string, any> = {};
      if (data.internalProductId !== undefined) upd.internalProductId = data.internalProductId;
      if (data.sellerProductId !== undefined) upd.sellerProductId = data.sellerProductId || null;
      if (data.vendorItemId !== undefined) upd.vendorItemId = data.vendorItemId || null;
      if (data.coupangProductName !== undefined) upd.coupangProductName = data.coupangProductName || null;
      if (data.coupangUrl !== undefined) upd.coupangUrl = data.coupangUrl || null;
      if (data.isActive !== undefined) upd.isActive = data.isActive;
      if (data.memo !== undefined) upd.memo = data.memo || null;
      if (Object.keys(upd).length > 0) {
        await db.update(productChannelMappings).set(upd).where(
          and(eq(productChannelMappings.id, id), eq(productChannelMappings.userId, ctx.user.id)));
      }
      return { success: true };
    }),

  deleteMapping: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(cpDailySales).where(and(eq(cpDailySales.mappingId, input.id), eq(cpDailySales.userId, ctx.user.id)));
      await db.delete(cpDailySettlements).where(and(eq(cpDailySettlements.mappingId, input.id), eq(cpDailySettlements.userId, ctx.user.id)));
      await db.delete(productChannelMappings).where(
        and(eq(productChannelMappings.id, input.id), eq(productChannelMappings.userId, ctx.user.id)));
      return { success: true };
    }),

  // ━━━━━━━━━━━━━━━ 3) 일별 판매 집계 ━━━━━━━━━━━━━━━
  getDailySales: protectedProcedure
    .input(z.object({ accountId: z.number(), date: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 활성 매핑 목록
      const mappings = await db.select().from(productChannelMappings)
        .where(and(
          eq(productChannelMappings.userId, ctx.user.id),
          eq(productChannelMappings.accountId, input.accountId),
          eq(productChannelMappings.isActive, true),
        ))
        .orderBy(desc(productChannelMappings.updatedAt));

      // 해당 날짜 판매 데이터
      const sales = await db.select().from(cpDailySales)
        .where(and(
          eq(cpDailySales.userId, ctx.user.id),
          eq(cpDailySales.accountId, input.accountId),
          eq(cpDailySales.saleDate, input.date),
        ));
      const salesMap = new Map(sales.map(s => [s.mappingId, s]));

      // 해당 날짜 정산 데이터
      const settlements = await db.select().from(cpDailySettlements)
        .where(and(
          eq(cpDailySettlements.userId, ctx.user.id),
          eq(cpDailySettlements.accountId, input.accountId),
          eq(cpDailySettlements.settlementDate, input.date),
        ));
      const settlementMap = new Map(settlements.map(s => [s.mappingId!, s]));

      // 내부 상품 이름
      const internalIds = mappings.map(m => m.internalProductId).filter(Boolean) as number[];
      let productNameMap = new Map<number, string>();
      if (internalIds.length > 0) {
        const prods = await db.select({ id: products.id, productName: products.productName })
          .from(products)
          .where(sql`${products.id} IN (${sql.join(internalIds.map(id => sql`${id}`), sql`, `)})`);
        prods.forEach(p => productNameMap.set(p.id, p.productName));
      }

      // 마진 정보 (소싱 상품의 마진 시나리오에서 가져옴)
      const { productMarginScenarios } = await import("../../drizzle/schema");
      let marginMap = new Map<number, number>(); // internalProductId → profit per unit
      if (internalIds.length > 0) {
        const margins = await db.select({
          productId: productMarginScenarios.productId,
          profit: productMarginScenarios.profit,
          isPrimary: productMarginScenarios.isPrimary,
          label: productMarginScenarios.label,
        }).from(productMarginScenarios)
          .where(sql`${productMarginScenarios.productId} IN (${sql.join(internalIds.map(id => sql`${id}`), sql`, `)})`);
        for (const pid of internalIds) {
          const pm = margins.filter(m => m.productId === pid);
          const best = pm.find(m => m.isPrimary) || pm.find(m => m.label === "normal") || pm[0];
          if (best) marginMap.set(pid, Number(best.profit || 0));
        }
      }

      const items = mappings.map(m => {
        const sale = salesMap.get(m.id);
        const settlement = settlementMap.get(m.id);
        const qty = sale?.quantity || 0;
        const grossSales = Number(sale?.grossSales || 0);
        const orderCount = sale?.orderCount || 0;
        const adSpend = Number(sale?.adSpend || 0);
        const marginPerUnit = m.internalProductId ? (marginMap.get(m.internalProductId) || 0) : 0;
        const estimatedProfit = marginPerUnit * qty;

        return {
          mappingId: m.id,
          coupangProductName: m.coupangProductName,
          sellerProductId: m.sellerProductId,
          vendorItemId: m.vendorItemId,
          internalProductId: m.internalProductId,
          internalProductName: m.internalProductId ? productNameMap.get(m.internalProductId) || null : null,
          // 판매 데이터
          saleId: sale?.id || null,
          quantity: qty,
          grossSales,
          orderCount,
          adSpend,
          // 마진 기반 추정 수익
          marginPerUnit,
          estimatedProfit,
          // 정산 데이터
          settlementId: settlement?.id || null,
          grossAmount: Number(settlement?.grossAmount || 0),
          commissionAmount: Number(settlement?.commissionAmount || 0),
          shippingAmount: Number(settlement?.shippingAmount || 0),
          payoutAmount: Number(settlement?.payoutAmount || 0),
        };
      });

      let totalPayoutAmount = items.reduce((s, i) => s + i.payoutAmount, 0);
      const totalGrossSales = items.reduce((s, i) => s + i.grossSales, 0);
      let isEstimated = false;

      // 오늘 날짜이고 정산 데이터가 없지만 매출이 있으면 추정
      if (totalPayoutAmount === 0 && totalGrossSales > 0) {
        const recentSettleDays = await db.select({
          totalGross: sql<number>`COALESCE(SUM(${cpDailySettlements.grossAmount}), 0)`,
          totalPayout: sql<number>`COALESCE(SUM(${cpDailySettlements.payoutAmount}), 0)`,
        }).from(cpDailySettlements).where(and(
          eq(cpDailySettlements.userId, ctx.user.id),
          eq(cpDailySettlements.accountId, input.accountId),
          sql`${cpDailySettlements.settlementDate} >= DATE_SUB(${input.date}, INTERVAL 14 DAY)`,
          sql`${cpDailySettlements.settlementDate} < ${input.date}`,
        ));
        const recentGross = N(recentSettleDays[0]?.totalGross);
        const recentPayout = N(recentSettleDays[0]?.totalPayout);
        if (recentGross > 0) {
          totalPayoutAmount = Math.round(totalGrossSales * (recentPayout / recentGross));
        } else {
          totalPayoutAmount = Math.round(totalGrossSales * (1 - 0.108));
        }
        isEstimated = true;
      }

      const totals = {
        totalQuantity: items.reduce((s, i) => s + i.quantity, 0),
        totalGrossSales,
        totalOrders: items.reduce((s, i) => s + i.orderCount, 0),
        totalAdSpend: items.reduce((s, i) => s + i.adSpend, 0),
        totalEstimatedProfit: items.reduce((s, i) => s + i.estimatedProfit, 0),
        totalPayoutAmount,
        isEstimated,
      };

      return { date: input.date, items, totals };
    }),

  upsertDailySale: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      mappingId: z.number(),
      date: z.string(),
      quantity: z.number().min(0),
      grossSales: z.number().min(0).optional(),
      orderCount: z.number().min(0).optional(),
      adSpend: z.number().min(0).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [existing] = await db.select().from(cpDailySales)
        .where(and(
          eq(cpDailySales.userId, ctx.user.id),
          eq(cpDailySales.accountId, input.accountId),
          eq(cpDailySales.mappingId, input.mappingId),
          eq(cpDailySales.saleDate, input.date),
        )).limit(1);

      const data = {
        quantity: input.quantity,
        grossSales: String(input.grossSales || 0),
        orderCount: input.orderCount || 0,
        adSpend: String(input.adSpend || 0),
      };

      if (existing) {
        await db.update(cpDailySales).set(data).where(eq(cpDailySales.id, existing.id));
      } else {
        await db.insert(cpDailySales).values({
          userId: ctx.user.id,
          accountId: input.accountId,
          mappingId: input.mappingId,
          saleDate: input.date,
          ...data,
        });
      }
      return { success: true };
    }),

  // ━━━━━━━━━━━━━━━ 4) 정산 집계 ━━━━━━━━━━━━━━━━━
  upsertSettlement: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      mappingId: z.number().optional(),
      date: z.string(),
      grossAmount: z.number().min(0),
      commissionAmount: z.number().min(0).optional(),
      shippingAmount: z.number().min(0).optional(),
      payoutAmount: z.number().min(0).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const conditions = [
        eq(cpDailySettlements.userId, ctx.user.id),
        eq(cpDailySettlements.accountId, input.accountId),
        eq(cpDailySettlements.settlementDate, input.date),
      ];
      if (input.mappingId) {
        conditions.push(eq(cpDailySettlements.mappingId, input.mappingId));
      }
      const [existing] = await db.select().from(cpDailySettlements).where(and(...conditions)).limit(1);

      const payout = input.payoutAmount ?? (input.grossAmount - (input.commissionAmount || 0) - (input.shippingAmount || 0));
      const data = {
        grossAmount: String(input.grossAmount),
        commissionAmount: String(input.commissionAmount || 0),
        shippingAmount: String(input.shippingAmount || 0),
        payoutAmount: String(payout),
      };

      if (existing) {
        await db.update(cpDailySettlements).set(data).where(eq(cpDailySettlements.id, existing.id));
      } else {
        await db.insert(cpDailySettlements).values({
          userId: ctx.user.id,
          accountId: input.accountId,
          mappingId: input.mappingId || null,
          settlementDate: input.date,
          ...data,
        });
      }
      return { success: true };
    }),

  // ━━━━━━━━━━━━━━━ 5) 대시보드 요약 (분석용) ━━━━━━━━━━━━━━━
  accountDashboard: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // ★ KST 기준 날짜 계산 (UTC+9) — UTC toISOString()은 하루 어긋남 위험
      const nowMs = Date.now() + 9 * 60 * 60 * 1000;
      const kstNow = new Date(nowMs);
      const today = kstNow.toISOString().slice(0, 10);
      const kstDay = kstNow.getUTCDay();
      const mon = new Date(kstNow); mon.setUTCDate(kstNow.getUTCDate() - (kstDay === 0 ? 6 : kstDay - 1));
      const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
      const weekStart = mon.toISOString().slice(0, 10);
      const weekEnd = sun.toISOString().slice(0, 10);
      const year = kstNow.getUTCFullYear(); const month = kstNow.getUTCMonth() + 1;
      const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      const salesQuery = (start: string, end: string) =>
        db.select({
          totalQty: sql<number>`COALESCE(SUM(${cpDailySales.quantity}), 0)`,
          totalGrossSales: sql<number>`COALESCE(SUM(${cpDailySales.grossSales}), 0)`,
          totalOrders: sql<number>`COALESCE(SUM(${cpDailySales.orderCount}), 0)`,
          totalAdSpend: sql<number>`COALESCE(SUM(${cpDailySales.adSpend}), 0)`,
        }).from(cpDailySales).where(and(
          eq(cpDailySales.userId, ctx.user.id),
          eq(cpDailySales.accountId, input.accountId),
          sql`${cpDailySales.saleDate} >= ${start}`,
          sql`${cpDailySales.saleDate} <= ${end}`,
        ));

      const settlementQuery = (start: string, end: string) =>
        db.select({
          totalPayout: sql<number>`COALESCE(SUM(${cpDailySettlements.payoutAmount}), 0)`,
          totalCommission: sql<number>`COALESCE(SUM(${cpDailySettlements.commissionAmount}), 0)`,
          totalShipping: sql<number>`COALESCE(SUM(${cpDailySettlements.shippingAmount}), 0)`,
        }).from(cpDailySettlements).where(and(
          eq(cpDailySettlements.userId, ctx.user.id),
          eq(cpDailySettlements.accountId, input.accountId),
          sql`${cpDailySettlements.settlementDate} >= ${start}`,
          sql`${cpDailySettlements.settlementDate} <= ${end}`,
        ));

      const [dailySales] = await salesQuery(today, today);
      const [weeklySales] = await salesQuery(weekStart, weekEnd);
      const [monthlySales] = await salesQuery(monthStart, monthEnd);
      const [dailySettle] = await settlementQuery(today, today);
      const [weeklySettle] = await settlementQuery(weekStart, weekEnd);
      const [monthlySettle] = await settlementQuery(monthStart, monthEnd);

      // ★ 오늘 정산 데이터 추정: settlement API는 당일 데이터를 제공하지 않으므로
      //   최근 7일 수수료율 평균을 이용해 오늘의 수수료/실정산을 추정
      let dailyPayout = N(dailySettle?.totalPayout);
      let dailyCommission = N(dailySettle?.totalCommission);
      const dailyGrossSales = N(dailySales?.totalGrossSales);
      const isEstimated = dailyPayout === 0 && dailyCommission === 0 && dailyGrossSales > 0;

      if (isEstimated) {
        // 최근 7일간 정산이 있는 데이터에서 수수료율 계산
        const recentSettleDays = await db.select({
          totalGross: sql<number>`COALESCE(SUM(${cpDailySettlements.grossAmount}), 0)`,
          totalCommission: sql<number>`COALESCE(SUM(${cpDailySettlements.commissionAmount}), 0)`,
          totalPayout: sql<number>`COALESCE(SUM(${cpDailySettlements.payoutAmount}), 0)`,
        }).from(cpDailySettlements).where(and(
          eq(cpDailySettlements.userId, ctx.user.id),
          eq(cpDailySettlements.accountId, input.accountId),
          sql`${cpDailySettlements.settlementDate} >= DATE_SUB(${today}, INTERVAL 14 DAY)`,
          sql`${cpDailySettlements.settlementDate} < ${today}`,
        ));

        const recentGross = N(recentSettleDays[0]?.totalGross);
        const recentCommission = N(recentSettleDays[0]?.totalCommission);
        const recentPayout = N(recentSettleDays[0]?.totalPayout);

        if (recentGross > 0) {
          // 수수료율 = 최근 수수료 / 최근 총매출
          const commissionRate = recentCommission / recentGross;
          // 실정산율 = 최근 실정산 / 최근 총매출
          const payoutRate = recentPayout / recentGross;

          dailyCommission = Math.round(dailyGrossSales * commissionRate);
          dailyPayout = Math.round(dailyGrossSales * payoutRate);
        } else {
          // 최근 정산 데이터도 없으면 기본 수수료율 10.8% 적용
          dailyCommission = Math.round(dailyGrossSales * 0.108);
          dailyPayout = dailyGrossSales - dailyCommission;
        }
      }

      const [mappingCount] = await db.select({ count: sql<number>`count(*)` }).from(productChannelMappings)
        .where(and(eq(productChannelMappings.userId, ctx.user.id), eq(productChannelMappings.accountId, input.accountId)));
      const [activeMappingCount] = await db.select({ count: sql<number>`count(*)` }).from(productChannelMappings)
        .where(and(eq(productChannelMappings.userId, ctx.user.id), eq(productChannelMappings.accountId, input.accountId), eq(productChannelMappings.isActive, true)));

      // 최근 동기화 이력
      const recentJobs = await db.select().from(coupangSyncJobs)
        .where(and(eq(coupangSyncJobs.userId, ctx.user.id), eq(coupangSyncJobs.accountId, input.accountId)))
        .orderBy(desc(coupangSyncJobs.startedAt))
        .limit(5);

      return {
        daily: { qty: N(dailySales?.totalQty), orders: N(dailySales?.totalOrders), grossSales: dailyGrossSales, adSpend: N(dailySales?.totalAdSpend), payout: dailyPayout, commission: dailyCommission, label: today, isEstimated },
        weekly: { qty: N(weeklySales?.totalQty), orders: N(weeklySales?.totalOrders), grossSales: N(weeklySales?.totalGrossSales), adSpend: N(weeklySales?.totalAdSpend), payout: N(weeklySettle?.totalPayout), commission: N(weeklySettle?.totalCommission), label: `${weekStart} ~ ${weekEnd}` },
        monthly: { qty: N(monthlySales?.totalQty), orders: N(monthlySales?.totalOrders), grossSales: N(monthlySales?.totalGrossSales), adSpend: N(monthlySales?.totalAdSpend), payout: N(monthlySettle?.totalPayout), commission: N(monthlySettle?.totalCommission), label: `${year}년 ${month}월` },
        mappingCount: N(mappingCount?.count),
        activeMappingCount: N(activeMappingCount?.count),
        recentJobs,
      };
    }),

  // ━━━━━━━━━━━━━━━ 6) 동기화 이력 ━━━━━━━━━━━━━━━
  listSyncJobs: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return db.select().from(coupangSyncJobs)
        .where(and(eq(coupangSyncJobs.userId, ctx.user.id), eq(coupangSyncJobs.accountId, input.accountId)))
        .orderBy(desc(coupangSyncJobs.startedAt))
        .limit(50);
    }),

  // ━━━━━━━━━━━━━━━ 7) 기간 트렌드 리포트 ━━━━━━━━━━━━━━━
  periodTrend: protectedProcedure
    .input(z.object({ accountId: z.number(), startDate: z.string(), endDate: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 일별 판매 집계
      const dailySaleRows = await db.select({
        saleDate: cpDailySales.saleDate,
        totalQty: sql<number>`COALESCE(SUM(${cpDailySales.quantity}), 0)`,
        totalGrossSales: sql<number>`COALESCE(SUM(${cpDailySales.grossSales}), 0)`,
        totalOrders: sql<number>`COALESCE(SUM(${cpDailySales.orderCount}), 0)`,
        totalAdSpend: sql<number>`COALESCE(SUM(${cpDailySales.adSpend}), 0)`,
      }).from(cpDailySales).where(and(
        eq(cpDailySales.userId, ctx.user.id),
        eq(cpDailySales.accountId, input.accountId),
        sql`${cpDailySales.saleDate} >= ${input.startDate}`,
        sql`${cpDailySales.saleDate} <= ${input.endDate}`,
      )).groupBy(cpDailySales.saleDate).orderBy(cpDailySales.saleDate);

      // 일별 정산 집계
      const dailySettleRows = await db.select({
        settlementDate: cpDailySettlements.settlementDate,
        totalPayout: sql<number>`COALESCE(SUM(${cpDailySettlements.payoutAmount}), 0)`,
        totalCommission: sql<number>`COALESCE(SUM(${cpDailySettlements.commissionAmount}), 0)`,
        totalGross: sql<number>`COALESCE(SUM(${cpDailySettlements.grossAmount}), 0)`,
      }).from(cpDailySettlements).where(and(
        eq(cpDailySettlements.userId, ctx.user.id),
        eq(cpDailySettlements.accountId, input.accountId),
        sql`${cpDailySettlements.settlementDate} >= ${input.startDate}`,
        sql`${cpDailySettlements.settlementDate} <= ${input.endDate}`,
      )).groupBy(cpDailySettlements.settlementDate).orderBy(cpDailySettlements.settlementDate);

      const settleMap = new Map(dailySettleRows.map(r => [r.settlementDate, r]));

      // 전체 합산
      const grandTotals = {
        totalQty: dailySaleRows.reduce((s, r) => s + Number(r.totalQty), 0),
        totalGrossSales: dailySaleRows.reduce((s, r) => s + Number(r.totalGrossSales), 0),
        totalOrders: dailySaleRows.reduce((s, r) => s + Number(r.totalOrders), 0),
        totalAdSpend: dailySaleRows.reduce((s, r) => s + Number(r.totalAdSpend), 0),
        totalPayout: dailySettleRows.reduce((s, r) => s + Number(r.totalPayout), 0),
        totalCommission: dailySettleRows.reduce((s, r) => s + Number(r.totalCommission), 0),
      };

      // 일별 데이터 머지
      const allDates = new Set([
        ...dailySaleRows.map(r => r.saleDate),
        ...dailySettleRows.map(r => r.settlementDate),
      ]);
      const days = [...allDates].sort().map(date => {
        const sale = dailySaleRows.find(r => r.saleDate === date);
        const settle = settleMap.get(date);
        return {
          date,
          qty: Number(sale?.totalQty || 0),
          grossSales: Number(sale?.totalGrossSales || 0),
          orders: Number(sale?.totalOrders || 0),
          adSpend: Number(sale?.totalAdSpend || 0),
          payout: Number(settle?.totalPayout || 0),
          commission: Number(settle?.totalCommission || 0),
        };
      });

      return { days, grandTotals };
    }),

  // ━━━━━━━━━━━━━━━ 8) 상품별 성과 랭킹 ━━━━━━━━━━━━━━━
  productRanking: protectedProcedure
    .input(z.object({ accountId: z.number(), startDate: z.string(), endDate: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 매핑별 판매 집계
      const salesByMapping = await db.select({
        mappingId: cpDailySales.mappingId,
        totalQty: sql<number>`COALESCE(SUM(${cpDailySales.quantity}), 0)`,
        totalGrossSales: sql<number>`COALESCE(SUM(${cpDailySales.grossSales}), 0)`,
        totalOrders: sql<number>`COALESCE(SUM(${cpDailySales.orderCount}), 0)`,
        totalAdSpend: sql<number>`COALESCE(SUM(${cpDailySales.adSpend}), 0)`,
        salesDays: sql<number>`COUNT(DISTINCT ${cpDailySales.saleDate})`,
      }).from(cpDailySales).where(and(
        eq(cpDailySales.userId, ctx.user.id),
        eq(cpDailySales.accountId, input.accountId),
        sql`${cpDailySales.saleDate} >= ${input.startDate}`,
        sql`${cpDailySales.saleDate} <= ${input.endDate}`,
      )).groupBy(cpDailySales.mappingId);

      // 매핑별 정산 집계
      const settleByMapping = await db.select({
        mappingId: cpDailySettlements.mappingId,
        totalPayout: sql<number>`COALESCE(SUM(${cpDailySettlements.payoutAmount}), 0)`,
        totalCommission: sql<number>`COALESCE(SUM(${cpDailySettlements.commissionAmount}), 0)`,
      }).from(cpDailySettlements).where(and(
        eq(cpDailySettlements.userId, ctx.user.id),
        eq(cpDailySettlements.accountId, input.accountId),
        sql`${cpDailySettlements.settlementDate} >= ${input.startDate}`,
        sql`${cpDailySettlements.settlementDate} <= ${input.endDate}`,
      )).groupBy(cpDailySettlements.mappingId);
      const settleMap = new Map(settleByMapping.map(s => [s.mappingId!, s]));

      // 매핑 이름 가져오기
      const mappingIds = salesByMapping.map(s => s.mappingId);
      let mappingNameMap = new Map<number, { coupangName: string | null; internalId: number | null }>();
      if (mappingIds.length > 0) {
        const maps = await db.select({
          id: productChannelMappings.id,
          coupangProductName: productChannelMappings.coupangProductName,
          internalProductId: productChannelMappings.internalProductId,
        }).from(productChannelMappings)
          .where(sql`${productChannelMappings.id} IN (${sql.join(mappingIds.map(id => sql`${id}`), sql`, `)})`);
        maps.forEach(m => mappingNameMap.set(m.id, { coupangName: m.coupangProductName, internalId: m.internalProductId }));

        // 내부 상품명
        const internalIds = maps.map(m => m.internalProductId).filter(Boolean) as number[];
        if (internalIds.length > 0) {
          const prods = await db.select({ id: products.id, productName: products.productName })
            .from(products)
            .where(sql`${products.id} IN (${sql.join(internalIds.map(id => sql`${id}`), sql`, `)})`);
          const prodMap = new Map(prods.map(p => [p.id, p.productName]));
          maps.forEach(m => {
            if (m.internalProductId && prodMap.has(m.internalProductId)) {
              const existing = mappingNameMap.get(m.id)!;
              mappingNameMap.set(m.id, { ...existing, coupangName: existing.coupangName || prodMap.get(m.internalProductId)! });
            }
          });
        }
      }

      const items = salesByMapping.map(s => {
        const settle = settleMap.get(s.mappingId);
        const info = mappingNameMap.get(s.mappingId);
        const grossSales = Number(s.totalGrossSales);
        const adSpend = Number(s.totalAdSpend);
        const payout = Number(settle?.totalPayout || 0);
        const netProfit = payout - adSpend;
        return {
          mappingId: s.mappingId,
          productName: info?.coupangName || `매핑 #${s.mappingId}`,
          totalQty: Number(s.totalQty),
          totalGrossSales: grossSales,
          totalOrders: Number(s.totalOrders),
          totalAdSpend: adSpend,
          salesDays: Number(s.salesDays),
          avgDailySales: Number(s.salesDays) > 0 ? Math.round(Number(s.totalQty) / Number(s.salesDays)) : 0,
          totalPayout: payout,
          totalCommission: Number(settle?.totalCommission || 0),
          netProfit,
          roas: adSpend > 0 ? Math.round((grossSales / adSpend) * 100) / 100 : 0,
        };
      }).sort((a, b) => b.totalGrossSales - a.totalGrossSales);

      return { items };
    }),

  // ━━━━━━━━━━━━━━━ 9) 정산 삭제 ━━━━━━━━━━━━━━━
  deleteSettlement: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(cpDailySettlements).where(
        and(eq(cpDailySettlements.id, input.id), eq(cpDailySettlements.userId, ctx.user.id)));
      return { success: true };
    }),

  // ━━━━━━━━━━━━━━━ 10) 판매 삭제 ━━━━━━━━━━━━━━━
  deleteDailySale: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(cpDailySales).where(
        and(eq(cpDailySales.id, input.id), eq(cpDailySales.userId, ctx.user.id)));
      return { success: true };
    }),

  // ━━━━━━━━━━━━━━━ 11) 주문 동기화 (판매 데이터 수집) ━━━━━━━━━━━━━━━
  syncOrders: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      dateFrom: z.string(),  // YYYY-MM-DD
      dateTo: z.string(),    // YYYY-MM-DD
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // ★ 날짜 형식 검증
      if (!isValidDateFormat(input.dateFrom) || !isValidDateFormat(input.dateTo)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)." });
      }
      if (input.dateFrom > input.dateTo) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "시작일이 종료일보다 이후입니다." });
      }

      const [acc] = await db.select().from(coupangAccounts)
        .where(and(eq(coupangAccounts.id, input.accountId), eq(coupangAccounts.userId, ctx.user.id))).limit(1);
      if (!acc) throw new TRPCError({ code: "NOT_FOUND", message: "계정을 찾을 수 없습니다." });
      if (!acc.accessKey || !acc.secretKey || !acc.vendorId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "업체코드, Access Key, Secret Key를 먼저 입력해주세요." });
      }

      // 동기화 작업 생성
      const [job] = await db.insert(coupangSyncJobs).values({
        userId: ctx.user.id,
        accountId: input.accountId,
        jobType: "orders",
        status: "running",
      }).$returningId();

      try {
        // 매핑 목록 가져오기 (vendorItemId → mappingId 매핑)
        const mappings = await db.select().from(productChannelMappings)
          .where(and(
            eq(productChannelMappings.userId, ctx.user.id),
            eq(productChannelMappings.accountId, input.accountId),
          ));
        const vendorItemToMapping = new Map<string, number>();
        const sellerProductToMapping = new Map<string, number>();
        for (const m of mappings) {
          if (m.vendorItemId) vendorItemToMapping.set(m.vendorItemId, m.id);
          if (m.sellerProductId) sellerProductToMapping.set(m.sellerProductId, m.id);
        }

        // ★ fetchAllStatusOrders: 모든 상태의 주문을 한번에 가져오기 (일 단위 순회는 API 내부에서 처리)
        const orders = await fetchAllStatusOrders(acc.accessKey, acc.secretKey, acc.vendorId, input.dateFrom, input.dateTo);

        let totalRecords = 0;
        const newMappingsCreated: string[] = [];

        // ★ 날짜별로 집계 — orderedAt에서 날짜를 추출하되,
        //   KST 기준 오늘 날짜와 비교하여 오늘 범위 주문은 today로 강제 (syncAll과 동일 로직)
        const todayStr = getTodayStr();
        const ordersByDate = new Map<string, typeof orders>();
        for (const order of orders) {
          let orderDate = order.orderedAt?.split("T")[0] || order.paidAt?.split("T")[0] || "";
          // orderedAt이 없거나, 날짜가 입력 범위 바깥이면 오늘로 처리
          if (!orderDate || orderDate < input.dateFrom || orderDate > input.dateTo) {
            orderDate = todayStr;
          }
          if (!ordersByDate.has(orderDate)) ordersByDate.set(orderDate, []);
          ordersByDate.get(orderDate)!.push(order);
        }

        for (const [dateStr, dayOrders] of ordersByDate) {
          const dailyAgg = aggregateOrdersToDailySales(dayOrders, dateStr);

          for (const [vid, data] of dailyAgg) {
            let mappingId = vendorItemToMapping.get(vid) || sellerProductToMapping.get(data.sellerProductId);

            if (!mappingId) {
              const [newMapping] = await db.insert(productChannelMappings).values({
                userId: ctx.user.id,
                accountId: input.accountId,
                vendorItemId: vid,
                sellerProductId: data.sellerProductId || null,
                coupangProductName: data.productName || null,
              }).$returningId();
              mappingId = newMapping.id;
              vendorItemToMapping.set(vid, mappingId);
              newMappingsCreated.push(data.productName || vid);
            }

            const [existing] = await db.select().from(cpDailySales)
              .where(and(
                eq(cpDailySales.userId, ctx.user.id),
                eq(cpDailySales.accountId, input.accountId),
                eq(cpDailySales.mappingId, mappingId),
                eq(cpDailySales.saleDate, dateStr),
              )).limit(1);

            if (existing) {
              await db.update(cpDailySales).set({
                quantity: data.qty,
                grossSales: String(data.grossSales),
                orderCount: data.orderCount,
              }).where(eq(cpDailySales.id, existing.id));
            } else {
              await db.insert(cpDailySales).values({
                userId: ctx.user.id,
                accountId: input.accountId,
                mappingId,
                saleDate: dateStr,
                quantity: data.qty,
                grossSales: String(data.grossSales),
                orderCount: data.orderCount,
              });
            }
            totalRecords++;
          }
        }

        await db.update(coupangSyncJobs).set({
          status: "success",
          finishedAt: sql`NOW()`,
          recordCount: totalRecords,
        }).where(eq(coupangSyncJobs.id, job.id));

        await db.update(coupangAccounts)
          .set({ apiStatus: "active", lastSyncAt: sql`NOW()` })
          .where(eq(coupangAccounts.id, input.accountId));

        return {
          success: true,
          message: `주문 동기화 완료! ${totalRecords}건 처리 (${input.dateFrom}~${input.dateTo})${newMappingsCreated.length > 0 ? `, 신규 매핑 ${newMappingsCreated.length}건 자동 생성` : ""}`,
          recordCount: totalRecords,
          newMappings: newMappingsCreated.length,
        };
      } catch (err: any) {
        await db.update(coupangSyncJobs).set({
          status: "failed",
          finishedAt: sql`NOW()`,
          errorMessage: err.message?.slice(0, 500),
        }).where(eq(coupangSyncJobs.id, job.id));

        // ★ 동기화 실패 시 apiStatus를 'error'로 변경하지 않음
        // API 연결 자체는 정상이고 데이터만 없는 경우를 구분해야 함
        // apiStatus는 testApi 에서만 변경하고, 동기화 실패는 syncJobs에만 기록

        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `주문 동기화 실패: ${err.message}` });
      }
    }),

  // ━━━━━━━━━━━━━━━ 12) 매출 상세 동기화 (revenue-history) ━━━━━━━━━━━━━━━
  syncSalesDetail: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      dateFrom: z.string(),  // YYYY-MM-DD
      dateTo: z.string(),    // YYYY-MM-DD
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // ★ 날짜 형식 검증
      if (!isValidDateFormat(input.dateFrom) || !isValidDateFormat(input.dateTo)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)." });
      }

      // ★ dateTo를 어제 이전으로 자동 보정 (Coupang API 제한)
      const yesterday = getYesterdayStr();
      const clampedDateTo = clampDateToYesterday(input.dateTo);

      if (input.dateFrom > clampedDateTo) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `매출 상세는 전일(${yesterday})까지만 조회 가능합니다. 오늘 데이터는 "주문 동기화"를 이용하세요.`,
        });
      }

      // ★ 날짜 범위 검증 (최대 31일)
      const range = daysBetween(input.dateFrom, clampedDateTo);
      if (range > 31) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `날짜 범위가 31일을 초과합니다 (${range}일). 범위를 줄여주세요.` });
      }

      const [acc] = await db.select().from(coupangAccounts)
        .where(and(eq(coupangAccounts.id, input.accountId), eq(coupangAccounts.userId, ctx.user.id))).limit(1);
      if (!acc) throw new TRPCError({ code: "NOT_FOUND" });
      if (!acc.accessKey || !acc.secretKey || !acc.vendorId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "업체코드, Access Key, Secret Key를 먼저 입력해주세요." });
      }

      const [job] = await db.insert(coupangSyncJobs).values({
        userId: ctx.user.id,
        accountId: input.accountId,
        jobType: "sales",
        status: "running",
      }).$returningId();

      try {
        const mappings = await db.select().from(productChannelMappings)
          .where(and(
            eq(productChannelMappings.userId, ctx.user.id),
            eq(productChannelMappings.accountId, input.accountId),
          ));
        const vendorItemToMapping = new Map<string, number>();
        for (const m of mappings) {
          if (m.vendorItemId) vendorItemToMapping.set(m.vendorItemId, m.id);
        }

        // ★ 보정된 날짜로 API 호출 (fetchSalesDetail 내부에서도 클램프하지만 여기서도 확인)
        const salesRecords = await fetchSalesDetail(acc.accessKey, acc.secretKey, acc.vendorId, input.dateFrom, clampedDateTo);
        const aggregated = aggregateSalesDetailToDaily(salesRecords);

        let totalRecords = 0;
        const newMappingsCreated: string[] = [];

        for (const [dateStr, dateMap] of aggregated) {
          for (const [vid, data] of dateMap) {
            let mappingId = vendorItemToMapping.get(vid);

            if (!mappingId) {
              const [newMapping] = await db.insert(productChannelMappings).values({
                userId: ctx.user.id,
                accountId: input.accountId,
                vendorItemId: vid,
                sellerProductId: data.productId || null,
                coupangProductName: data.productName || null,
              }).$returningId();
              mappingId = newMapping.id;
              vendorItemToMapping.set(vid, mappingId);
              newMappingsCreated.push(data.productName || vid);
            }

            // 판매 데이터 upsert
            const [existingSale] = await db.select().from(cpDailySales)
              .where(and(
                eq(cpDailySales.userId, ctx.user.id),
                eq(cpDailySales.accountId, input.accountId),
                eq(cpDailySales.mappingId, mappingId),
                eq(cpDailySales.saleDate, dateStr),
              )).limit(1);

            if (existingSale) {
              await db.update(cpDailySales).set({
                quantity: data.qty,
                grossSales: String(data.grossSales),
                orderCount: data.orderCount,
              }).where(eq(cpDailySales.id, existingSale.id));
            } else {
              await db.insert(cpDailySales).values({
                userId: ctx.user.id,
                accountId: input.accountId,
                mappingId,
                saleDate: dateStr,
                quantity: data.qty,
                grossSales: String(data.grossSales),
                orderCount: data.orderCount,
              });
            }

            // 정산 데이터 upsert (개별 상품별)
            const [existingSettle] = await db.select().from(cpDailySettlements)
              .where(and(
                eq(cpDailySettlements.userId, ctx.user.id),
                eq(cpDailySettlements.accountId, input.accountId),
                eq(cpDailySettlements.mappingId, mappingId),
                eq(cpDailySettlements.settlementDate, dateStr),
              )).limit(1);

            if (existingSettle) {
              await db.update(cpDailySettlements).set({
                grossAmount: String(data.grossSales),
                commissionAmount: String(data.serviceFee),
                payoutAmount: String(data.settlementAmount),
              }).where(eq(cpDailySettlements.id, existingSettle.id));
            } else {
              await db.insert(cpDailySettlements).values({
                userId: ctx.user.id,
                accountId: input.accountId,
                mappingId,
                settlementDate: dateStr,
                grossAmount: String(data.grossSales),
                commissionAmount: String(data.serviceFee),
                payoutAmount: String(data.settlementAmount),
              });
            }

            totalRecords++;
          }
        }

        await db.update(coupangSyncJobs).set({
          status: "success",
          finishedAt: sql`NOW()`,
          recordCount: totalRecords,
        }).where(eq(coupangSyncJobs.id, job.id));

        await db.update(coupangAccounts)
          .set({ apiStatus: "active", lastSyncAt: sql`NOW()` })
          .where(eq(coupangAccounts.id, input.accountId));

        const dateNote = input.dateTo !== clampedDateTo ? ` (종료일 자동보정: ${input.dateTo} -> ${clampedDateTo})` : "";

        return {
          success: true,
          message: `매출 상세 동기화 완료! ${totalRecords}건 처리 (판매+정산, ${input.dateFrom}~${clampedDateTo})${dateNote}${newMappingsCreated.length > 0 ? `, 신규 매핑 ${newMappingsCreated.length}건` : ""}`,
          recordCount: totalRecords,
          newMappings: newMappingsCreated.length,
          clampedDateTo,
        };
      } catch (err: any) {
        await db.update(coupangSyncJobs).set({
          status: "failed",
          finishedAt: sql`NOW()`,
          errorMessage: err.message?.slice(0, 500),
        }).where(eq(coupangSyncJobs.id, job.id));

        // ★ 동기화 실패 시 apiStatus를 'error'로 변경하지 않음

        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `매출 상세 동기화 실패: ${err.message}` });
      }
    }),

  // ━━━━━━━━━━━━━━━ 13) 정산 내역 동기화 (settlement-histories) ━━━━━━━━━━━━━━━
  syncSettlements: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      yearMonth: z.string(), // YYYY-MM
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // ★ 형식 검증
      if (!isValidYearMonthFormat(input.yearMonth)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "정산월 형식이 올바르지 않습니다 (YYYY-MM)." });
      }

      const [acc] = await db.select().from(coupangAccounts)
        .where(and(eq(coupangAccounts.id, input.accountId), eq(coupangAccounts.userId, ctx.user.id))).limit(1);
      if (!acc) throw new TRPCError({ code: "NOT_FOUND" });
      if (!acc.accessKey || !acc.secretKey || !acc.vendorId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "업체코드, Access Key, Secret Key를 먼저 입력해주세요." });
      }

      const [job] = await db.insert(coupangSyncJobs).values({
        userId: ctx.user.id,
        accountId: input.accountId,
        jobType: "settlements",
        status: "running",
      }).$returningId();

      try {
        const settlements = await fetchSettlementHistories(acc.accessKey, acc.secretKey, acc.vendorId, input.yearMonth);

        let totalRecords = 0;

        for (const settlement of settlements) {
          // 정산일 기준으로 upsert (전체 계정 단위, mappingId = null)
          const settleDate = settlement.settlementDate; // YYYY-MM-DD
          if (!settleDate) continue;

          const [existing] = await db.select().from(cpDailySettlements)
            .where(and(
              eq(cpDailySettlements.userId, ctx.user.id),
              eq(cpDailySettlements.accountId, input.accountId),
              sql`${cpDailySettlements.mappingId} IS NULL`,
              eq(cpDailySettlements.settlementDate, settleDate),
            )).limit(1);

          const data = {
            grossAmount: String(settlement.totalSale || 0),
            commissionAmount: String(settlement.serviceFee || 0),
            payoutAmount: String(settlement.finalAmount || 0),
          };

          if (existing) {
            await db.update(cpDailySettlements).set(data).where(eq(cpDailySettlements.id, existing.id));
          } else {
            await db.insert(cpDailySettlements).values({
              userId: ctx.user.id,
              accountId: input.accountId,
              mappingId: null,
              settlementDate: settleDate,
              ...data,
            });
          }
          totalRecords++;
        }

        await db.update(coupangSyncJobs).set({
          status: "success",
          finishedAt: sql`NOW()`,
          recordCount: totalRecords,
        }).where(eq(coupangSyncJobs.id, job.id));

        await db.update(coupangAccounts)
          .set({ apiStatus: "active", lastSyncAt: sql`NOW()` })
          .where(eq(coupangAccounts.id, input.accountId));

        return {
          success: true,
          message: `정산 내역 동기화 완료! ${totalRecords}건 (${input.yearMonth})`,
          recordCount: totalRecords,
        };
      } catch (err: any) {
        await db.update(coupangSyncJobs).set({
          status: "failed",
          finishedAt: sql`NOW()`,
          errorMessage: err.message?.slice(0, 500),
        }).where(eq(coupangSyncJobs.id, job.id));

        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `정산 동기화 실패: ${err.message}` });
      }
    }),

  // ━━━━━━━━━━━━━━━ 14) 전체 동기화 (주문 + 매출상세 + 정산 한번에) ━━━━━━━━━━━━━━━
  syncAll: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      dateFrom: z.string(),
      dateTo: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 날짜 검증
      if (!isValidDateFormat(input.dateFrom) || !isValidDateFormat(input.dateTo)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)." });
      }
      if (input.dateFrom > input.dateTo) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "시작일이 종료일보다 이후입니다." });
      }

      const [acc] = await db.select().from(coupangAccounts)
        .where(and(eq(coupangAccounts.id, input.accountId), eq(coupangAccounts.userId, ctx.user.id))).limit(1);
      if (!acc) throw new TRPCError({ code: "NOT_FOUND", message: "계정을 찾을 수 없습니다." });
      if (!acc.accessKey || !acc.secretKey || !acc.vendorId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "업체코드, Access Key, Secret Key를 먼저 입력해주세요." });
      }

      const [job] = await db.insert(coupangSyncJobs).values({
        userId: ctx.user.id,
        accountId: input.accountId,
        jobType: "all",
        status: "running",
      }).$returningId();

      const results: string[] = [];
      let totalRecords = 0;
      let hasError = false;

      // --- 1) 매출 상세 동기화 (어제까지) ---
      const yesterday = getYesterdayStr();
      const clampedDateTo = clampDateToYesterday(input.dateTo);

      if (input.dateFrom <= clampedDateTo) {
        try {
          const mappings = await db.select().from(productChannelMappings)
            .where(and(eq(productChannelMappings.userId, ctx.user.id), eq(productChannelMappings.accountId, input.accountId)));
          const vendorItemToMapping = new Map<string, number>();
          for (const m of mappings) {
            if (m.vendorItemId) vendorItemToMapping.set(m.vendorItemId, m.id);
          }

          const salesRecords = await fetchSalesDetail(acc.accessKey, acc.secretKey, acc.vendorId, input.dateFrom, clampedDateTo);
          const aggregated = aggregateSalesDetailToDaily(salesRecords);
          let salesCount = 0;
          const newMappingsCreated: string[] = [];

          for (const [dateStr, dateMap] of aggregated) {
            for (const [vid, data] of dateMap) {
              let mappingId = vendorItemToMapping.get(vid);
              if (!mappingId) {
                const [newMapping] = await db.insert(productChannelMappings).values({
                  userId: ctx.user.id, accountId: input.accountId,
                  vendorItemId: vid, sellerProductId: data.productId || null,
                  coupangProductName: data.productName || null,
                }).$returningId();
                mappingId = newMapping.id;
                vendorItemToMapping.set(vid, mappingId);
                newMappingsCreated.push(data.productName || vid);
              }

              // Sales upsert
              const [existingSale] = await db.select().from(cpDailySales)
                .where(and(eq(cpDailySales.userId, ctx.user.id), eq(cpDailySales.accountId, input.accountId), eq(cpDailySales.mappingId, mappingId), eq(cpDailySales.saleDate, dateStr))).limit(1);
              if (existingSale) {
                await db.update(cpDailySales).set({ quantity: data.qty, grossSales: String(data.grossSales), orderCount: data.orderCount }).where(eq(cpDailySales.id, existingSale.id));
              } else {
                await db.insert(cpDailySales).values({ userId: ctx.user.id, accountId: input.accountId, mappingId, saleDate: dateStr, quantity: data.qty, grossSales: String(data.grossSales), orderCount: data.orderCount });
              }

              // Settlement upsert
              const [existingSettle] = await db.select().from(cpDailySettlements)
                .where(and(eq(cpDailySettlements.userId, ctx.user.id), eq(cpDailySettlements.accountId, input.accountId), eq(cpDailySettlements.mappingId, mappingId), eq(cpDailySettlements.settlementDate, dateStr))).limit(1);
              if (existingSettle) {
                await db.update(cpDailySettlements).set({ grossAmount: String(data.grossSales), commissionAmount: String(data.serviceFee), payoutAmount: String(data.settlementAmount) }).where(eq(cpDailySettlements.id, existingSettle.id));
              } else {
                await db.insert(cpDailySettlements).values({ userId: ctx.user.id, accountId: input.accountId, mappingId, settlementDate: dateStr, grossAmount: String(data.grossSales), commissionAmount: String(data.serviceFee), payoutAmount: String(data.settlementAmount) });
              }
              salesCount++;
            }
          }
          totalRecords += salesCount;
          results.push(`매출상세: ${salesCount}건 (${input.dateFrom}~${clampedDateTo})${newMappingsCreated.length > 0 ? `, 신규매핑 ${newMappingsCreated.length}` : ""}`);
        } catch (err: any) {
          results.push(`매출상세: 실패 - ${err.message?.slice(0, 100)}`);
          hasError = true;
        }
      }

      // --- 2) 오늘 주문 동기화 (오늘 데이터가 범위에 포함된 경우) ---
      const today = getTodayStr();
      if (input.dateTo >= today) {
        try {
          const mappings = await db.select().from(productChannelMappings)
            .where(and(eq(productChannelMappings.userId, ctx.user.id), eq(productChannelMappings.accountId, input.accountId)));
          const vendorItemToMapping = new Map<string, number>();
          const sellerProductToMapping = new Map<string, number>();
          for (const m of mappings) {
            if (m.vendorItemId) vendorItemToMapping.set(m.vendorItemId, m.id);
            if (m.sellerProductId) sellerProductToMapping.set(m.sellerProductId, m.id);
          }

          const orders = await fetchAllStatusOrders(acc.accessKey, acc.secretKey, acc.vendorId, today, today);
          let orderCount = 0;

          const dailyAgg = aggregateOrdersToDailySales(orders, today);
          for (const [vid, data] of dailyAgg) {
            let mappingId = vendorItemToMapping.get(vid) || sellerProductToMapping.get(data.sellerProductId);
            if (!mappingId) {
              const [newMapping] = await db.insert(productChannelMappings).values({
                userId: ctx.user.id, accountId: input.accountId,
                vendorItemId: vid, sellerProductId: data.sellerProductId || null,
                coupangProductName: data.productName || null,
              }).$returningId();
              mappingId = newMapping.id;
              vendorItemToMapping.set(vid, mappingId);
            }
            const [existing] = await db.select().from(cpDailySales)
              .where(and(eq(cpDailySales.userId, ctx.user.id), eq(cpDailySales.accountId, input.accountId), eq(cpDailySales.mappingId, mappingId), eq(cpDailySales.saleDate, today))).limit(1);
            if (existing) {
              await db.update(cpDailySales).set({ quantity: data.qty, grossSales: String(data.grossSales), orderCount: data.orderCount }).where(eq(cpDailySales.id, existing.id));
            } else {
              await db.insert(cpDailySales).values({ userId: ctx.user.id, accountId: input.accountId, mappingId, saleDate: today, quantity: data.qty, grossSales: String(data.grossSales), orderCount: data.orderCount });
            }
            orderCount++;
          }
          totalRecords += orderCount;
          results.push(`오늘주문: ${orderCount}건`);
        } catch (err: any) {
          results.push(`오늘주문: 실패 - ${err.message?.slice(0, 100)}`);
          hasError = true;
        }
      }

      // --- 3) 정산 동기화 (해당 월) ---
      try {
        const fromMonth = input.dateFrom.slice(0, 7); // YYYY-MM
        const toMonth = input.dateTo.slice(0, 7);
        const months = new Set<string>();
        months.add(fromMonth);
        months.add(toMonth);
        // Add intermediate months if range spans multiple months
        const startD = new Date(input.dateFrom);
        const endD = new Date(input.dateTo);
        for (let d = new Date(startD); d <= endD; d.setMonth(d.getMonth() + 1)) {
          months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
        }

        const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
        const currentYM = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
        let settleCount = 0;

        for (const ym of months) {
          if (ym > currentYM) continue; // Skip future months
          try {
            const settlements = await fetchSettlementHistories(acc.accessKey, acc.secretKey, acc.vendorId, ym);
            for (const settlement of settlements) {
              const settleDate = settlement.settlementDate;
              if (!settleDate) continue;
              const [existing] = await db.select().from(cpDailySettlements)
                .where(and(eq(cpDailySettlements.userId, ctx.user.id), eq(cpDailySettlements.accountId, input.accountId), sql`${cpDailySettlements.mappingId} IS NULL`, eq(cpDailySettlements.settlementDate, settleDate))).limit(1);
              const data = { grossAmount: String(settlement.totalSale || 0), commissionAmount: String(settlement.serviceFee || 0), payoutAmount: String(settlement.finalAmount || 0) };
              if (existing) { await db.update(cpDailySettlements).set(data).where(eq(cpDailySettlements.id, existing.id)); }
              else { await db.insert(cpDailySettlements).values({ userId: ctx.user.id, accountId: input.accountId, mappingId: null, settlementDate: settleDate, ...data }); }
              settleCount++;
            }
          } catch (err: any) {
            results.push(`정산(${ym}): 실패 - ${err.message?.slice(0, 80)}`);
            hasError = true;
          }
        }
        if (settleCount > 0) {
          totalRecords += settleCount;
          results.push(`정산요약: ${settleCount}건`);
        }
      } catch (err: any) {
        results.push(`정산: 실패 - ${err.message?.slice(0, 100)}`);
        hasError = true;
      }

      // Finalize
      await db.update(coupangSyncJobs).set({
        status: hasError ? "failed" : "success",
        finishedAt: sql`NOW()`,
        recordCount: totalRecords,
        errorMessage: hasError ? results.filter(r => r.includes("실패")).join("; ").slice(0, 500) : null,
      }).where(eq(coupangSyncJobs.id, job.id));

      await db.update(coupangAccounts)
        .set({ apiStatus: hasError ? "active" : "active", lastSyncAt: sql`NOW()` })
        .where(eq(coupangAccounts.id, input.accountId));

      return {
        success: true,
        message: `전체 동기화 ${hasError ? "일부 완료" : "완료"}! 총 ${totalRecords}건\n${results.join("\n")}`,
        recordCount: totalRecords,
        details: results,
        hasError,
      };
    }),
});
