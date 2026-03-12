import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { marginCalcHistory } from "../../drizzle/schema";
import { and, desc, eq, like, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { invokeLLM } from "../_core/llm";

export const marginRouter = router({
  /** 마진 계산 결과 저장 */
  save: protectedProcedure
    .input(
      z.object({
        itemName: z.string().max(200).default(""),
        sellingPrice: z.number().int(),
        costPrice: z.number().int(),
        feeRate: z.string(),
        fulfillmentFee: z.number().int(),
        shippingFee: z.number().int(),
        expectedSales: z.number().int().default(100),
        returnRate: z.string().default("0"),
        returnCollectionFee: z.number().int().default(0),
        // 계산 결과
        fulfillmentVat: z.number().int(),
        salesCommission: z.number().int(),
        salesCommissionVat: z.number().int(),
        vat: z.number().int(),
        margin: z.number().int(),
        marginRate: z.string(),
        minAdRoi: z.string().default("0"),
        totalMargin: z.number().int().default(0),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.insert(marginCalcHistory).values({
        userId: ctx.user.id,
        ...input,
      });

      return { success: true };
    }),

  /** 이력 목록 (페이지네이션 + 검색) */
  list: protectedProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        perPage: z.number().int().min(1).max(50).default(15),
        search: z.string().max(200).default(""),
      })
    )
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const where = input.search
        ? and(
            eq(marginCalcHistory.userId, ctx.user.id),
            like(marginCalcHistory.itemName, `%${input.search}%`)
          )
        : eq(marginCalcHistory.userId, ctx.user.id);

      const [countResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(marginCalcHistory)
        .where(where);

      const total = Number(countResult?.count ?? 0);
      const offset = (input.page - 1) * input.perPage;

      const items = await db
        .select()
        .from(marginCalcHistory)
        .where(where)
        .orderBy(desc(marginCalcHistory.createdAt))
        .limit(input.perPage)
        .offset(offset);

      return {
        items,
        total,
        page: input.page,
        totalPages: Math.ceil(total / input.perPage),
      };
    }),

  /** 이력 삭제 */
  delete: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db
        .delete(marginCalcHistory)
        .where(
          and(
            eq(marginCalcHistory.id, input.id),
            eq(marginCalcHistory.userId, ctx.user.id)
          )
        );

      return { success: true };
    }),

  /** AI 추천가 분석 */
  aiRecommend: protectedProcedure
    .input(
      z.object({
        itemName: z.string().max(200).default(""),
        costPrice: z.number().int().min(0),
        feeRate: z.number().min(0).max(100),
        fulfillmentFee: z.number().int().min(0),
        shippingFee: z.number().int().min(0),
        adRate: z.number().min(0).max(100).default(0),
        category: z.string().max(50).default(""),
        supplier: z.string().max(200).default(""),
      })
    )
    .mutation(async ({ input }) => {
      const { costPrice, feeRate, fulfillmentFee, shippingFee, adRate, itemName, category, supplier } = input;

      const fixedCosts = costPrice + fulfillmentFee + shippingFee;
      const fulfillmentVat = Math.round((fulfillmentFee + shippingFee) * 0.1);
      const totalFixed = fixedCosts + fulfillmentVat;

      const prompt = `당신은 쿠팡 마켓플레이스 전문 가격 전략 컨설턴트입니다.

아래 상품 원가 정보를 기반으로 최적 판매가를 3가지(보수적/균형/공격적) 추천하고, 각각의 마진 분석과 전략적 조언을 제공하세요.

## 상품 정보
- 상품명: ${itemName || "(미입력)"}
- 카테고리: ${category || "(미입력)"}
- 공급처: ${supplier || "(미입력)"}
- 원가(환산): ${costPrice.toLocaleString()}원
- 입출고비: ${fulfillmentFee.toLocaleString()}원
- 배송비: ${shippingFee.toLocaleString()}원
- 입출고비 VAT: ${fulfillmentVat.toLocaleString()}원
- 고정비 합계: ${totalFixed.toLocaleString()}원
- 판매수수료율: ${feeRate}%
- 광고비율: ${adRate}%

## 쿠팡 비용 구조 (판매가 대비 변동비)
- 판매수수료: 판매가 × ${feeRate}%
- 판매수수료 VAT: 판매수수료 × 10%
- 부가세: 판매가 ÷ 11
- 광고비: 판매가 × ${adRate}%

## 소싱 원칙
- 마진율 ≥ 45% (필수)
- END ROAS ≤ 250% (필수)

반드시 아래 JSON 형식으로만 응답하세요:
{
  "conservative": {
    "price": 판매가(정수),
    "marginRate": 마진율(소수점2자리),
    "endRoas": END_ROAS(소수점2자리),
    "strategy": "전략 설명(한 줄)"
  },
  "balanced": {
    "price": 판매가(정수),
    "marginRate": 마진율(소수점2자리),
    "endRoas": END_ROAS(소수점2자리),
    "strategy": "전략 설명(한 줄)"
  },
  "aggressive": {
    "price": 판매가(정수),
    "marginRate": 마진율(소수점2자리),
    "endRoas": END_ROAS(소수점2자리),
    "strategy": "전략 설명(한 줄)"
  },
  "tip": "종합 가격 전략 조언 (2~3문장)"
}`;

      try {
        const llmResult = await invokeLLM({
          messages: [
            { role: "system", content: "You are a pricing strategy expert for Korean e-commerce (Coupang). Always respond in valid JSON only." },
            { role: "user", content: prompt },
          ],
        });

        const raw = llmResult.choices?.[0]?.message?.content;
        const text = (typeof raw === "string" ? raw : "").replace(/```json\n?|```/g, "").trim();
        const parsed = JSON.parse(text);
        return { success: true, data: parsed };
      } catch (err: any) {
        console.error("[AI Recommend] Error:", err.message);

        // 폴백: 수학 기반 자동 계산
        const calcPrice = (targetMargin: number) => {
          const variableRatio = 1 - targetMargin / 100 - (feeRate * 1.1) / 100 - 1 / 11 - adRate / 100;
          return variableRatio > 0 ? Math.ceil(totalFixed / variableRatio / 100) * 100 : 0;
        };

        const calcMargin = (price: number) => {
          const commission = Math.round(price * feeRate / 100);
          const commissionVat = Math.round(commission * 0.1);
          const vat = Math.round(price / 11);
          const ad = Math.round(price * adRate / 100);
          const margin = price - totalFixed - commission - commissionVat - vat - ad;
          const marginRate = price > 0 ? (margin / price) * 100 : 0;
          const marginBeforeAd = margin + ad;
          const endRoas = marginBeforeAd > 0 ? (price / marginBeforeAd) * 100 : 0;
          return { marginRate, endRoas };
        };

        const p50 = calcPrice(50);
        const p45 = calcPrice(45);
        const p35 = calcPrice(35);
        const m50 = calcMargin(p50);
        const m45 = calcMargin(p45);
        const m35 = calcMargin(p35);

        return {
          success: true,
          data: {
            conservative: {
              price: p50,
              marginRate: Math.round(m50.marginRate * 100) / 100,
              endRoas: Math.round(m50.endRoas * 100) / 100,
              strategy: "높은 마진 확보로 안정적 수익 · 광고 여유 극대화",
            },
            balanced: {
              price: p45,
              marginRate: Math.round(m45.marginRate * 100) / 100,
              endRoas: Math.round(m45.endRoas * 100) / 100,
              strategy: "소싱 원칙(45%+) 정확 충족 · 가격 경쟁력과 수익 균형",
            },
            aggressive: {
              price: p35,
              marginRate: Math.round(m35.marginRate * 100) / 100,
              endRoas: Math.round(m35.endRoas * 100) / 100,
              strategy: "최저가 전략으로 초기 시장 점유율 확보 · 마진 낮음 주의",
            },
            tip: "소싱 원칙(마진율 45%↑, END ROAS 250%↓)을 충족하는 균형 가격을 기본으로 설정하고, 시장 상황에 따라 보수적/공격적 가격으로 조정하세요. (AI 미연결 — 수학 기반 자동 산출)",
          },
        };
      }
    }),
});
