import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { reverseSkuWatch, reversePurchases, salesRecords } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

// ============================================================
// aiMemory — SKU별 소싱 기억 + 맥락 추천 ("이번에도 살까?")
// ============================================================
// 원칙: 새 데이터를 만들지 않고, 이미 쌓인 매입·판매 이력을 SKU 단위로 "기억"해
//   계절성·컬러 변형 비교로 판단을 돕는다. 감이 아니라 이력으로 답한다.

function normKeyOf(brand: string | undefined | null, name: string): string {
  return `${brand ?? ""} ${name}`.toLowerCase().replace(/\s+/g, "").slice(0, 250);
}

const COLOR_TOKENS: { re: RegExp; label: string }[] = [
  { re: /(bone|본)\b/i, label: "Bone" },
  { re: /(white|화이트)/i, label: "White" },
  { re: /(black|블랙)/i, label: "Black" },
  { re: /(grey|gray|그레이|회색)/i, label: "Grey" },
  { re: /(navy|네이비)/i, label: "Navy" },
  { re: /(blue|블루|파랑)/i, label: "Blue" },
  { re: /(red|레드|빨강)/i, label: "Red" },
  { re: /(beige|베이지)/i, label: "Beige" },
  { re: /(green|그린|카키|khaki)/i, label: "Green" },
  { re: /(pink|핑크)/i, label: "Pink" },
  { re: /(brown|브라운|갈색)/i, label: "Brown" },
];
function detectColor(name: string): string | null {
  for (const t of COLOR_TOKENS) if (t.re.test(name)) return t.label;
  return null;
}
function baseKeyOf(brand: string | null, name: string): string {
  let b = name;
  for (const t of COLOR_TOKENS) b = b.replace(t.re, "");
  return normKeyOf(brand, b);
}
const MONTHS_KR = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];

export const aiMemoryRouter = router({
  // SKU에 대한 종합 판단 + 기억 (한 번에)
  advise: protectedProcedure
    .input(z.object({ skuId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const uid = ctx.user!.id;
      const [sku] = await db
        .select()
        .from(reverseSkuWatch)
        .where(and(eq(reverseSkuWatch.id, input.skuId), eq(reverseSkuWatch.userId, uid)))
        .limit(1);
      if (!sku) throw new TRPCError({ code: "NOT_FOUND" });

      const nk = normKeyOf(sku.brand, sku.productName);
      const baseKey = baseKeyOf(sku.brand, sku.productName);
      const myColor = detectColor(sku.productName);

      const purchases = await db
        .select()
        .from(reversePurchases)
        .where(eq(reversePurchases.userId, uid))
        .limit(20000);
      const sales = await db
        .select()
        .from(salesRecords)
        .where(eq(salesRecords.userId, uid))
        .limit(20000);

      // ── 이 SKU의 기억 (매입) ──
      const myBuys = purchases.filter(p => normKeyOf(p.brand, p.productName) === nk);
      const buyCount = myBuys.length;
      const buyQty = myBuys.reduce((a, p) => a + (p.qty ?? 1), 0);
      const turns = myBuys
        .filter(p => p.buyDate && p.sellDate)
        .map(p => (new Date(p.sellDate!).getTime() - new Date(p.buyDate!).getTime()) / 86400000)
        .filter(t => Number.isFinite(t) && t >= 0);
      const avgTurnover = turns.length ? Math.round(turns.reduce((a, b) => a + b, 0) / turns.length) : null;
      const inspected = myBuys.filter(p => p.inspectStatus === "pass" || p.inspectStatus === "fail");
      const passRate = inspected.length
        ? Math.round((inspected.filter(p => p.inspectStatus === "pass").length / inspected.length) * 100)
        : null;
      const profits = myBuys
        .filter(p => (p.soldPrice ?? 0) > 0 && (p.buyPrice ?? 0) > 0)
        .map(p => (p.soldPrice ?? 0) - (p.buyPrice ?? 0));
      const avgProfit = profits.length ? Math.round(profits.reduce((a, b) => a + b, 0) / profits.length) : null;

      // ── 판매 이력 (계절성) ──
      const mySales = sales.filter(s => normKeyOf(s.brand, s.productName) === nk);
      const salesQty = mySales.reduce((a, s) => a + (s.qty ?? 0), 0);
      const byMonth = new Array(12).fill(0);
      for (const s of mySales) {
        const mo = parseInt(s.orderDate.slice(5, 7), 10);
        if (mo >= 1 && mo <= 12) byMonth[mo - 1] += s.qty ?? 0;
      }
      const totalMo = byMonth.reduce((a, b) => a + b, 0);
      const nowMonth = new Date().getMonth(); // 0-11
      const window = [nowMonth, (nowMonth + 1) % 12, (nowMonth + 2) % 12];
      const windowQty = window.reduce((a, m) => a + byMonth[m], 0);
      const windowShare = totalMo ? windowQty / totalMo : 0;
      const evenShare = 3 / 12;
      const peakMonthIdx = totalMo ? byMonth.indexOf(Math.max(...byMonth)) : -1;

      // ── 컬러 변형 비교 (같은 베이스, 다른 색) ──
      const variantMap = new Map<string, number>();
      for (const s of sales) {
        if (baseKeyOf(s.brand, s.productName) !== baseKey) continue;
        const c = detectColor(s.productName) || "기타";
        variantMap.set(c, (variantMap.get(c) ?? 0) + (s.qty ?? 0));
      }
      const variants = [...variantMap.entries()].map(([color, qty]) => ({ color, qty })).sort((a, b) => b.qty - a.qty);
      let variantNote: string | null = null;
      if (myColor && variants.length >= 2) {
        const mine = variants.find(v => v.color === myColor);
        const others = variants.filter(v => v.color !== myColor && v.qty > 0);
        if (mine && mine.qty > 0 && others.length) {
          const bestOther = others[0];
          if (mine.qty >= bestOther.qty && bestOther.qty > 0) {
            const pct = Math.round(((mine.qty - bestOther.qty) / bestOther.qty) * 100);
            if (pct >= 5) variantNote = `${myColor}가 ${bestOther.color}보다 ${pct}% 더 팔렸습니다`;
          } else if (mine.qty < bestOther.qty) {
            const pct = Math.round(((bestOther.qty - mine.qty) / mine.qty) * 100);
            variantNote = `${bestOther.color}가 ${myColor}보다 ${pct}% 더 팔립니다`;
          }
        }
      }

      // ── 판단 종합 ──
      const reasons: string[] = [];
      let score = 0;
      if (avgProfit != null) {
        if (avgProfit > 0) { score += 2; reasons.push(`과거 평균 순익 ${avgProfit.toLocaleString()}원`); }
        else { score -= 2; reasons.push(`과거 평균 순익 ${avgProfit.toLocaleString()}원(손실)`); }
      }
      if (passRate != null) {
        if (passRate >= 90) { score += 1; reasons.push(`검수 통과율 ${passRate}%`); }
        else if (passRate < 70) { score -= 1; reasons.push(`검수 통과율 ${passRate}%(주의)`); }
        else reasons.push(`검수 통과율 ${passRate}%`);
      }
      if (avgTurnover != null) {
        if (avgTurnover <= 14) { score += 1; reasons.push(`평균 회전 ${avgTurnover}일(빠름)`); }
        else if (avgTurnover > 45) { score -= 1; reasons.push(`평균 회전 ${avgTurnover}일(느림)`); }
        else reasons.push(`평균 회전 ${avgTurnover}일`);
      }
      let seasonNote: string | null = null;
      if (totalMo >= 6 && windowShare > evenShare * 1.3) {
        score += 1;
        seasonNote = `${MONTHS_KR[window[0]]}~${MONTHS_KR[window[2]]}에 판매가 집중(연간 ${Math.round(windowShare * 100)}%)`;
        reasons.push(seasonNote);
      } else if (totalMo >= 6 && windowShare < evenShare * 0.6) {
        score -= 1;
        seasonNote = `지금은 비수기(${MONTHS_KR[window[0]]}~ 연간 ${Math.round(windowShare * 100)}%)`;
        reasons.push(seasonNote);
      }
      if (variantNote) reasons.push(variantNote);

      const dataThin = buyCount === 0 && salesQty === 0;
      const verdict = dataThin ? "unknown" : score >= 2 ? "buy" : score <= -1 ? "hold" : "watch";

      // ── 자연어 한마디 ──
      let headline: string;
      if (dataThin) {
        headline = "아직 이 상품의 매입·판매 기록이 없어요. 첫 매입 후부터 기억이 쌓입니다.";
      } else {
        const bits: string[] = [];
        if (buyCount > 0) bits.push(`지금까지 ${buyCount}회(${buyQty}개) 매입`);
        if (avgTurnover != null) bits.push(`평균 ${avgTurnover}일 회전`);
        if (avgProfit != null) bits.push(`평균 순익 ${avgProfit.toLocaleString()}원`);
        const past = bits.length ? bits.join(" · ") + ". " : "";
        const season = seasonNote ? seasonNote + ". " : "";
        const variant = variantNote ? variantNote + ". " : "";
        const call =
          verdict === "buy" ? "지금 매입 추천합니다."
            : verdict === "hold" ? "이번에는 관망을 권합니다."
              : "조건은 나쁘지 않아요, 마진만 확인하고 결정하세요.";
        headline = `${past}${season}${variant}${call}`;
      }

      return {
        sku: { id: sku.id, brand: sku.brand, productName: sku.productName, color: myColor },
        memory: { buyCount, buyQty, avgTurnover, passRate, avgProfit, salesQty, peakMonth: peakMonthIdx >= 0 ? MONTHS_KR[peakMonthIdx] : null },
        seasonalByMonth: byMonth,
        variants,
        verdict,
        headline,
        reasons,
      };
    }),
});
