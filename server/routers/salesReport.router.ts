import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { salesRecords, poizonSaleObservations, reversePurchases } from "../../drizzle/schema";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { rateLimit } from "../lib/rateLimit";

function normKeyOf(brand: string | undefined | null, name: string): string {
  return `${brand ?? ""} ${name}`
    .toLowerCase()
    .replace(/\s+/g, "")
    .slice(0, 250);
}
function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export const salesReportRouter = router({
  // ===== 판매 리포트 업로드 (엑셀/CSV) =====
  bulkImport: protectedProcedure
    .input(
      z.object({
        channel: z.enum(["poizon", "shopee", "other"]).default("poizon"),
        currency: z.string().max(8).default("CNY"),
        rows: z
          .array(
            z.object({
              orderDate: z.string().max(10),
              productName: z.string().min(1).max(300),
              brand: z.string().max(100).optional(),
              sku: z.string().max(120).optional(),
              size: z.string().max(40).optional(),
              qty: z.number().int().min(1).default(1),
              salePrice: z.number().int().min(0).default(0),
              settleAmount: z.number().int().min(0).default(0),
              externalOrderId: z.string().max(120).optional(),
            })
          )
          .min(1)
          .max(3000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const uid = ctx.user!.id;
      const rl = rateLimit(`sales:${uid}`, 20, 60 * 60 * 1000); // 업로드 시간당 20회
      if (!rl.ok)
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `업로드가 너무 잦습니다. ${rl.retryAfterSec}초 후 다시.`,
        });

      // 날짜 정규화 (YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD 허용)
      const normDate = (s: string) => {
        const m = String(s || "").match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
        if (!m) return "";
        return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
      };
      const values = input.rows
        .map(r => {
          const orderDate = normDate(r.orderDate);
          if (!orderDate) return null;
          return {
            userId: uid,
            channel: input.channel,
            orderDate,
            normKey: normKeyOf(r.brand, r.productName),
            productName: r.productName,
            brand: r.brand ?? null,
            sku: r.sku ?? null,
            size: r.size ?? null,
            qty: r.qty || 1,
            salePrice: r.salePrice || 0,
            currency: input.currency || "CNY",
            settleAmount: r.settleAmount || 0,
            externalOrderId: r.externalOrderId ?? null,
          };
        })
        .filter(Boolean) as any[];
      if (values.length === 0)
        throw new TRPCError({ code: "BAD_REQUEST", message: "유효한 주문일이 있는 행이 없어요." });
      await db.insert(salesRecords).values(values);
      return { ok: true, count: values.length, skipped: input.rows.length - values.length };
    }),

  // ===== 판매 분석 (추이 + SKU별 + 시장 매칭) =====
  summary: protectedProcedure
    .input(
      z
        .object({
          days: z.number().int().min(7).max(365).default(90),
          rate: z.number().int().min(1).max(1000).default(190), // 원가(KRW) → 판매통화 환산
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const uid = ctx.user!.id;
      const days = input?.days ?? 90;
      const rate = input?.rate ?? 190;
      const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const recs = await db
        .select()
        .from(salesRecords)
        .where(and(eq(salesRecords.userId, uid), gte(salesRecords.orderDate, since)))
        .limit(20000);
      if (recs.length === 0)
        return {
          trend: [], bySku: [], totals: { orders: 0, qty: 0, revenue: 0 },
          matched: 0, currency: "CNY", channels: [], monthly: [], avgTurnoverDays: null,
        };

      const currency = recs[0].currency || "CNY";
      // 원가 환산: 매입가는 KRW. 판매통화가 CNY면 /rate, KRW면 그대로.
      const costToSale = (krw: number) => (currency === "KRW" ? krw : Math.round(krw / rate));

      // 매입 데이터 — norm_key별 평균 매입가(KRW) + 회전일(매입→판매)
      const purchases = await db
        .select()
        .from(reversePurchases)
        .where(eq(reversePurchases.userId, uid))
        .limit(20000);
      const costByKey = new Map<string, number[]>();
      const turnByKey = new Map<string, number[]>();
      for (const p of purchases) {
        const nk = normKeyOf(p.brand, p.productName);
        if ((p.buyPrice ?? 0) > 0) {
          const arr = costByKey.get(nk) ?? [];
          arr.push(p.buyPrice ?? 0);
          costByKey.set(nk, arr);
        }
        if (p.buyDate && p.sellDate) {
          const t = (new Date(p.sellDate).getTime() - new Date(p.buyDate).getTime()) / 86400000;
          if (Number.isFinite(t) && t >= 0) {
            const arr = turnByKey.get(nk) ?? [];
            arr.push(Math.round(t));
            turnByKey.set(nk, arr);
          }
        }
      }
      const avgOf = (a: number[] | undefined) =>
        a && a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0;

      // 일별 추이
      const dayMap = new Map<string, { qty: number; revenue: number }>();
      for (const r of recs) {
        const e = dayMap.get(r.orderDate) ?? { qty: 0, revenue: 0 };
        e.qty += r.qty ?? 0;
        e.revenue += (r.salePrice ?? 0) * (r.qty ?? 0);
        dayMap.set(r.orderDate, e);
      }
      const trend = [...dayMap.entries()]
        .map(([d, v]) => ({ d, qty: v.qty, revenue: v.revenue }))
        .sort((a, b) => a.d.localeCompare(b.d));

      // SKU별 집계
      const skuMap = new Map<
        string,
        { productName: string; brand: string | null; qty: number; revenue: number; prices: number[]; last: string }
      >();
      for (const r of recs) {
        const e =
          skuMap.get(r.normKey) ??
          { productName: r.productName, brand: r.brand, qty: 0, revenue: 0, prices: [], last: "" };
        e.qty += r.qty ?? 0;
        e.revenue += (r.salePrice ?? 0) * (r.qty ?? 0);
        if (r.salePrice) e.prices.push(r.salePrice);
        if (r.orderDate > e.last) e.last = r.orderDate;
        skuMap.set(r.normKey, e);
      }

      // 시장 매칭 — 같은 norm_key의 관측 시세(90일) 중앙값
      const keys = [...skuMap.keys()];
      const marketMap = new Map<string, number[]>();
      if (keys.length) {
        const obs = await db
          .select({ normKey: poizonSaleObservations.normKey, priceCny: poizonSaleObservations.priceCny })
          .from(poizonSaleObservations)
          .where(
            and(
              inArray(poizonSaleObservations.normKey, keys),
              gte(poizonSaleObservations.observedAt, sql`DATE_SUB(NOW(), INTERVAL 90 DAY)`)
            )
          )
          .limit(8000);
        for (const o of obs) {
          const arr = marketMap.get(o.normKey) ?? [];
          if (o.priceCny > 0) arr.push(o.priceCny);
          marketMap.set(o.normKey, arr);
        }
      }

      let matched = 0;
      const bySku = [...skuMap.entries()]
        .map(([normKey, e]) => {
          const myAvg = e.prices.length ? Math.round(e.prices.reduce((a, b) => a + b, 0) / e.prices.length) : 0;
          const marketP50 = median(marketMap.get(normKey) ?? []);
          const hasMarket = marketP50 > 0 && currency === "CNY";
          if (hasMarket) matched++;
          const vsMarketPct =
            hasMarket && myAvg > 0 ? Math.round(((myAvg - marketP50) / marketP50) * 1000) / 10 : null;
          const turnoverDays = avgOf(turnByKey.get(normKey)) || null;
          return {
            normKey, productName: e.productName, brand: e.brand,
            qty: e.qty, revenue: e.revenue, myAvg, marketP50: hasMarket ? marketP50 : 0,
            vsMarketPct, lastDate: e.last, turnoverDays,
          };
        })
        .sort((a, b) => b.qty - a.qty);

      // 채널별 실적 (POIZON vs 쇼피 …)
      const chMap = new Map<string, { qty: number; revenue: number; settle: number; orders: number }>();
      for (const r of recs) {
        const ch = r.channel || "other";
        const e = chMap.get(ch) ?? { qty: 0, revenue: 0, settle: 0, orders: 0 };
        e.qty += r.qty ?? 0;
        e.revenue += (r.salePrice ?? 0) * (r.qty ?? 0);
        e.settle += (r.settleAmount ?? 0) * (r.qty ?? 0);
        e.orders += 1;
        chMap.set(ch, e);
      }
      const channels = [...chMap.entries()]
        .map(([channel, v]) => ({
          channel, ...v,
          avgPrice: v.qty ? Math.round(v.revenue / v.qty) : 0,
          net: v.settle > 0 ? v.settle : v.revenue,
        }))
        .sort((a, b) => b.revenue - a.revenue);

      // 월별 손익계산서 — 매출·정산(수령)·원가(매입 환산)·순이익
      const moMap = new Map<
        string,
        { revenue: number; settle: number; qty: number; orders: number; cost: number; costQty: number }
      >();
      for (const r of recs) {
        const mo = r.orderDate.slice(0, 7); // YYYY-MM
        const e = moMap.get(mo) ?? { revenue: 0, settle: 0, qty: 0, orders: 0, cost: 0, costQty: 0 };
        const q = r.qty ?? 0;
        e.revenue += (r.salePrice ?? 0) * q;
        e.settle += (r.settleAmount ?? 0) * q;
        e.qty += q;
        e.orders += 1;
        const unitCostKrw = avgOf(costByKey.get(r.normKey));
        if (unitCostKrw > 0) { e.cost += costToSale(unitCostKrw) * q; e.costQty += q; }
        moMap.set(mo, e);
      }
      const monthly = [...moMap.entries()]
        .map(([month, v]) => {
          const net = v.settle > 0 ? v.settle : v.revenue; // 수령액(정산 없으면 매출)
          const profit = net - v.cost;
          return {
            month, revenue: v.revenue, settle: v.settle, net, cost: v.cost, profit,
            qty: v.qty, orders: v.orders,
            marginPct: net > 0 ? Math.round((profit / net) * 1000) / 10 : 0,
            costCoveragePct: v.qty ? Math.round((v.costQty / v.qty) * 100) : 0,
          };
        })
        .sort((a, b) => a.month.localeCompare(b.month));

      const allTurns = [...turnByKey.values()].flat();
      const avgTurnoverDays = allTurns.length
        ? Math.round(allTurns.reduce((a, b) => a + b, 0) / allTurns.length)
        : null;

      const totals = {
        orders: recs.length,
        qty: recs.reduce((a, r) => a + (r.qty ?? 0), 0),
        revenue: recs.reduce((a, r) => a + (r.salePrice ?? 0) * (r.qty ?? 0), 0),
      };
      return { trend, bySku, totals, matched, currency, channels, monthly, avgTurnoverDays };
    }),
});
