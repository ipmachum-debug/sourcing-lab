/**
 * Extension Sub-Router: 상품 상세 (Product Details)
 */
import { z } from "zod";
import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import { extProductDetails } from "../../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const productsRouter = router({
  saveProductDetail: protectedProcedure
    .input(z.object({
      coupangProductId: z.string(),
      title: z.string().optional(),
      price: z.number().int().default(0),
      originalPrice: z.number().int().default(0),
      discountRate: z.number().int().default(0),
      rating: z.number().default(0),
      reviewCount: z.number().int().default(0),
      purchaseCount: z.string().optional(),
      sellerName: z.string().optional(),
      isRocket: z.boolean().default(false),
      isFreeShipping: z.boolean().default(false),
      categoryPath: z.string().optional(),
      optionCount: z.number().int().default(0),
      imageUrl: z.string().optional(),
      detailJson: z.any().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const result = await db.insert(extProductDetails).values({
        userId: ctx.user!.id,
        coupangProductId: input.coupangProductId,
        title: input.title || null,
        price: input.price,
        originalPrice: input.originalPrice,
        discountRate: input.discountRate,
        rating: input.rating.toFixed(1),
        reviewCount: input.reviewCount,
        purchaseCount: input.purchaseCount || null,
        sellerName: input.sellerName || null,
        isRocket: input.isRocket,
        isFreeShipping: input.isFreeShipping,
        categoryPath: input.categoryPath || null,
        optionCount: input.optionCount,
        imageUrl: input.imageUrl || null,
        detailJson: input.detailJson ? JSON.stringify(input.detailJson) : null,
      });
      return { success: true, id: (result as any)?.[0]?.insertId };
    }),

  // 상품 상세 히스토리 (가격 변동 등)
  getProductHistory: protectedProcedure
    .input(z.object({
      coupangProductId: z.string(),
      days: z.number().int().min(1).max(90).default(30),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      return db.select({
        id: extProductDetails.id,
        price: extProductDetails.price,
        originalPrice: extProductDetails.originalPrice,
        discountRate: extProductDetails.discountRate,
        rating: extProductDetails.rating,
        reviewCount: extProductDetails.reviewCount,
        purchaseCount: extProductDetails.purchaseCount,
        capturedAt: extProductDetails.capturedAt,
      })
        .from(extProductDetails)
        .where(and(
          eq(extProductDetails.userId, ctx.user!.id),
          eq(extProductDetails.coupangProductId, input.coupangProductId),
          sql`${extProductDetails.capturedAt} >= DATE_SUB(NOW(), INTERVAL ${input.days} DAY)`,
        ))
        .orderBy(desc(extProductDetails.capturedAt))
        .limit(200);
    }),

  // ===== v6.5: 상세 페이지 확장 스냅샷 저장 =====
  saveDetailSnapshot: protectedProcedure
    .input(z.object({
      coupangProductId: z.string(),
      vendorItemId: z.string().optional().nullable(),
      title: z.string().optional(),
      price: z.number().int().default(0),
      originalPrice: z.number().int().default(0),
      discountRate: z.number().int().default(0),
      rating: z.number().default(0),
      reviewCount: z.number().int().default(0),
      purchaseCount: z.string().optional(),
      sellerName: z.string().optional(),
      brandName: z.string().optional().nullable(),
      manufacturer: z.string().optional().nullable(),
      origin: z.string().optional().nullable(),
      deliveryType: z.string().optional(),
      isRocket: z.boolean().default(false),
      isFreeShipping: z.boolean().default(false),
      soldOut: z.boolean().default(false),
      categoryPath: z.string().optional(),
      optionCount: z.number().int().default(0),
      imageUrl: z.string().optional(),
      confidence: z.number().int().default(0),
      reviewSamples: z.array(z.object({
        rating: z.number().nullable().optional(),
        text: z.string(),
        dateText: z.string().nullable().optional(),
      })).optional(),
      optionSummary: z.array(z.object({
        optionName: z.string(),
        priceDelta: z.number().nullable().optional(),
        soldOut: z.boolean().optional(),
      })).optional(),
      badgeText: z.string().optional().nullable(),
      keyword: z.string().optional(),
      source: z.enum(['manual', 'auto_collect', 'user_browse']).default('manual'),
      detailJson: z.any().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const extJson = {
        ...(input.detailJson || {}),
        vendorItemId: input.vendorItemId || null,
        brandName: input.brandName || null,
        manufacturer: input.manufacturer || null,
        origin: input.origin || null,
        deliveryType: input.deliveryType || 'STANDARD',
        soldOut: input.soldOut || false,
        confidence: input.confidence || 0,
        reviewSamples: input.reviewSamples || [],
        optionSummary: input.optionSummary || [],
        badgeText: input.badgeText || null,
        keyword: input.keyword || null,
        source: input.source || 'manual',
      };
      const result = await db.insert(extProductDetails).values({
        userId: ctx.user!.id,
        coupangProductId: input.coupangProductId,
        title: input.title || null,
        price: input.price,
        originalPrice: input.originalPrice,
        discountRate: input.discountRate,
        rating: input.rating.toFixed(1),
        reviewCount: input.reviewCount,
        purchaseCount: input.purchaseCount || null,
        sellerName: input.sellerName || null,
        isRocket: input.isRocket,
        isFreeShipping: input.isFreeShipping,
        categoryPath: input.categoryPath || null,
        optionCount: input.optionCount,
        imageUrl: input.imageUrl || null,
        detailJson: JSON.stringify(extJson),
      });
      return { success: true, id: (result as any)?.[0]?.insertId };
    }),

  getDetailHistory: protectedProcedure
    .input(z.object({
      coupangProductId: z.string(),
      days: z.number().int().min(1).max(90).default(30),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return db.select({
        id: extProductDetails.id,
        price: extProductDetails.price,
        originalPrice: extProductDetails.originalPrice,
        discountRate: extProductDetails.discountRate,
        rating: extProductDetails.rating,
        reviewCount: extProductDetails.reviewCount,
        purchaseCount: extProductDetails.purchaseCount,
        sellerName: extProductDetails.sellerName,
        isRocket: extProductDetails.isRocket,
        isFreeShipping: extProductDetails.isFreeShipping,
        optionCount: extProductDetails.optionCount,
        detailJson: extProductDetails.detailJson,
        capturedAt: extProductDetails.capturedAt,
      })
        .from(extProductDetails)
        .where(and(
          eq(extProductDetails.userId, ctx.user!.id),
          eq(extProductDetails.coupangProductId, input.coupangProductId),
          sql`${extProductDetails.capturedAt} >= DATE_SUB(NOW(), INTERVAL ${input.days} DAY)`,
        ))
        .orderBy(desc(extProductDetails.capturedAt))
        .limit(200);
    }),
});
