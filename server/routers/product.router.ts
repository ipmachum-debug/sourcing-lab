import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  productCompetitors,
  productSuppliers,
  productMarginScenarios,
  productNotes,
  productKeywordLinks,
  products,
} from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

export const productRouter = router({
  /** 상품 상세 조회 (경쟁사/공급처/마진/노트 포함) */
  getDetail: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [product] = await db.select().from(products)
        .where(and(eq(products.id, input.id), eq(products.userId, ctx.user.id)))
        .limit(1);
      if (!product) throw new TRPCError({ code: "NOT_FOUND" });

      const competitors = await db.select().from(productCompetitors)
        .where(eq(productCompetitors.productId, input.id))
        .orderBy(desc(productCompetitors.createdAt));

      const suppliers = await db.select().from(productSuppliers)
        .where(eq(productSuppliers.productId, input.id))
        .orderBy(desc(productSuppliers.createdAt));

      const marginScenarios = await db.select().from(productMarginScenarios)
        .where(eq(productMarginScenarios.productId, input.id))
        .orderBy(productMarginScenarios.label);

      const notes = await db.select().from(productNotes)
        .where(eq(productNotes.productId, input.id))
        .orderBy(desc(productNotes.createdAt));

      const keywordLinks = await db.select().from(productKeywordLinks)
        .where(eq(productKeywordLinks.productId, input.id))
        .orderBy(productKeywordLinks.keywordIndex, productKeywordLinks.linkType, productKeywordLinks.slot);

      return { product, competitors, suppliers, marginScenarios, notes, keywordLinks };
    }),

  // ===== 경쟁사 =====
  addCompetitor: protectedProcedure
    .input(z.object({
      productId: z.number(),
      name: z.string().optional(),
      url: z.string().optional(),
      price: z.string().optional(),
      reviewCount: z.number().optional(),
      rating: z.string().optional(),
      estimatedSales: z.number().optional(),
      thumbnailFeature: z.string().optional(),
      detailFeature: z.string().optional(),
      strengths: z.string().optional(),
      weaknesses: z.string().optional(),
      freeGift: z.string().optional(),
      memo: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.insert(productCompetitors).values(input);
      return { success: true };
    }),

  updateCompetitor: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      url: z.string().optional(),
      price: z.string().optional(),
      reviewCount: z.number().optional(),
      rating: z.string().optional(),
      estimatedSales: z.number().optional(),
      thumbnailFeature: z.string().optional(),
      detailFeature: z.string().optional(),
      strengths: z.string().optional(),
      weaknesses: z.string().optional(),
      freeGift: z.string().optional(),
      memo: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...data } = input;
      await db.update(productCompetitors).set(data).where(eq(productCompetitors.id, id));
      return { success: true };
    }),

  deleteCompetitor: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(productCompetitors).where(eq(productCompetitors.id, input.id));
      return { success: true };
    }),

  // ===== 공급처 =====
  addSupplier: protectedProcedure
    .input(z.object({
      productId: z.number(),
      supplierName: z.string().optional(),
      url1688: z.string().optional(),
      moq: z.number().optional(),
      unitCost: z.string().optional(),
      internationalShippingCost: z.string().optional(),
      packagingCustomizable: z.boolean().optional(),
      oemAvailable: z.boolean().optional(),
      leadTimeDays: z.number().optional(),
      qualityMemo: z.string().optional(),
      sampleRequested: z.boolean().optional(),
      memo: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.insert(productSuppliers).values(input);
      return { success: true };
    }),

  updateSupplier: protectedProcedure
    .input(z.object({
      id: z.number(),
      supplierName: z.string().optional(),
      url1688: z.string().optional(),
      moq: z.number().optional(),
      unitCost: z.string().optional(),
      internationalShippingCost: z.string().optional(),
      packagingCustomizable: z.boolean().optional(),
      oemAvailable: z.boolean().optional(),
      leadTimeDays: z.number().optional(),
      qualityMemo: z.string().optional(),
      sampleRequested: z.boolean().optional(),
      memo: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...data } = input;
      await db.update(productSuppliers).set(data).where(eq(productSuppliers.id, id));
      return { success: true };
    }),

  deleteSupplier: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(productSuppliers).where(eq(productSuppliers.id, input.id));
      return { success: true };
    }),

  // ===== 마진 시나리오 =====
  upsertMargin: protectedProcedure
    .input(z.object({
      id: z.number().optional(),
      productId: z.number(),
      label: z.enum(["conservative", "normal", "aggressive"]),
      supplyCost: z.string().optional(),
      internationalShippingCost: z.string().optional(),
      domesticShippingCost: z.string().optional(),
      packagingCost: z.string().optional(),
      materialCost: z.string().optional(),
      otherCost: z.string().optional(),
      feeRate: z.string().optional(),
      adRate: z.string().optional(),
      sellPrice: z.string().optional(),
      isPrimary: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 마진 계산
      const supply = Number(input.supplyCost || 0);
      const intlShip = Number(input.internationalShippingCost || 0);
      const domShip = Number(input.domesticShippingCost || 0);
      const pkg = Number(input.packagingCost || 0);
      const mat = Number(input.materialCost || 0);
      const other = Number(input.otherCost || 0);
      const sell = Number(input.sellPrice || 0);
      const feeRate = Number(input.feeRate || 10.8);
      const adRate = Number(input.adRate || 15);

      const totalCost = supply + intlShip + domShip + pkg + mat + other;
      const feeAmount = Math.round(sell * feeRate / 100);
      const adAmount = Math.round(sell * adRate / 100);
      const profit = sell - totalCost - feeAmount - adAmount;
      const marginRate = sell > 0 ? Math.round((profit / sell) * 10000) / 100 : 0;
      const breakEvenAdRate = sell > 0 ? Math.round(((sell - totalCost - feeAmount) / sell) * 10000) / 100 : 0;

      const data = {
        productId: input.productId,
        label: input.label,
        supplyCost: String(supply),
        internationalShippingCost: String(intlShip),
        domesticShippingCost: String(domShip),
        packagingCost: String(pkg),
        materialCost: String(mat),
        otherCost: String(other),
        feeRate: String(feeRate),
        adRate: String(adRate),
        sellPrice: String(sell),
        totalCost: String(totalCost),
        feeAmount: String(feeAmount),
        adAmount: String(adAmount),
        profit: String(profit),
        marginRate: String(marginRate),
        breakEvenAdRate: String(Math.max(0, breakEvenAdRate)),
        isPrimary: input.isPrimary || false,
      };

      if (input.id) {
        await db.update(productMarginScenarios).set(data).where(eq(productMarginScenarios.id, input.id));
      } else {
        await db.insert(productMarginScenarios).values(data);
      }

      return { success: true, calculated: { totalCost, feeAmount, adAmount, profit, marginRate, breakEvenAdRate: Math.max(0, breakEvenAdRate) } };
    }),

  deleteMargin: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(productMarginScenarios).where(eq(productMarginScenarios.id, input.id));
      return { success: true };
    }),

  // ===== 노트 =====
  addNote: protectedProcedure
    .input(z.object({
      productId: z.number(),
      type: z.enum(["improvement", "development", "memo", "review"]),
      content: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.insert(productNotes).values(input);
      return { success: true };
    }),

  updateNote: protectedProcedure
    .input(z.object({
      id: z.number(),
      type: z.enum(["improvement", "development", "memo", "review"]).optional(),
      content: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...data } = input;
      await db.update(productNotes).set(data).where(eq(productNotes.id, id));
      return { success: true };
    }),

  deleteNote: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(productNotes).where(eq(productNotes.id, input.id));
      return { success: true };
    }),

  // ===== 키워드 링크 =====
  upsertKeywordLink: protectedProcedure
    .input(z.object({
      id: z.number().optional(),
      productId: z.number(),
      keywordIndex: z.number().min(1).max(3),
      linkType: z.enum(["coupang", "1688"]),
      slot: z.number().min(1).max(10),
      url: z.string().min(1),
      memo: z.string().max(255).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      if (input.id) {
        await db.update(productKeywordLinks)
          .set({ url: input.url, memo: input.memo || null })
          .where(eq(productKeywordLinks.id, input.id));
      } else {
        // Check if slot already exists for this product/keyword/type
        const existing = await db.select().from(productKeywordLinks)
          .where(and(
            eq(productKeywordLinks.productId, input.productId),
            eq(productKeywordLinks.keywordIndex, input.keywordIndex),
            eq(productKeywordLinks.linkType, input.linkType),
            eq(productKeywordLinks.slot, input.slot),
          ))
          .limit(1);

        if (existing.length > 0) {
          await db.update(productKeywordLinks)
            .set({ url: input.url, memo: input.memo || null })
            .where(eq(productKeywordLinks.id, existing[0].id));
        } else {
          await db.insert(productKeywordLinks).values({
            productId: input.productId,
            keywordIndex: input.keywordIndex,
            linkType: input.linkType,
            slot: input.slot,
            url: input.url,
            memo: input.memo || null,
          });
        }
      }
      return { success: true };
    }),

  deleteKeywordLink: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(productKeywordLinks).where(eq(productKeywordLinks.id, input.id));
      return { success: true };
    }),

  bulkUpsertKeywordLinks: protectedProcedure
    .input(z.object({
      productId: z.number(),
      links: z.array(z.object({
        keywordIndex: z.number().min(1).max(3),
        linkType: z.enum(["coupang", "1688"]),
        slot: z.number().min(1).max(10),
        url: z.string().min(1),
        memo: z.string().max(255).optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      for (const link of input.links) {
        const existing = await db.select().from(productKeywordLinks)
          .where(and(
            eq(productKeywordLinks.productId, input.productId),
            eq(productKeywordLinks.keywordIndex, link.keywordIndex),
            eq(productKeywordLinks.linkType, link.linkType),
            eq(productKeywordLinks.slot, link.slot),
          ))
          .limit(1);

        if (existing.length > 0) {
          await db.update(productKeywordLinks)
            .set({ url: link.url, memo: link.memo || null })
            .where(eq(productKeywordLinks.id, existing[0].id));
        } else {
          await db.insert(productKeywordLinks).values({
            productId: input.productId,
            keywordIndex: link.keywordIndex,
            linkType: link.linkType,
            slot: link.slot,
            url: link.url,
            memo: link.memo || null,
          });
        }
      }
      return { success: true };
    }),
});
