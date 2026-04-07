import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import { mktProducts } from "../../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

const productInput = z.object({
  brandId: z.number(),
  name: z.string().min(1).max(500),
  description: z.string().optional(),
  features: z.array(z.string()).optional(),
  targetAudience: z.string().optional(),
  price: z.string().optional(),
  landingUrl: z.string().optional(),
  imageUrls: z.array(z.string()).optional(),
  category: z.string().optional(),
  seasonality: z.string().optional(),
});

export const mktProductsRouter = router({
  list: protectedProcedure
    .input(z.object({ brandId: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const conditions = [eq(mktProducts.userId, ctx.user.id)];
      if (input?.brandId) conditions.push(eq(mktProducts.brandId, input.brandId));
      return db.select().from(mktProducts)
        .where(and(...conditions))
        .orderBy(desc(mktProducts.createdAt));
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [product] = await db.select().from(mktProducts)
        .where(and(eq(mktProducts.id, input.id), eq(mktProducts.userId, ctx.user.id)))
        .limit(1);
      if (!product) throw new TRPCError({ code: "NOT_FOUND" });
      return product;
    }),

  create: protectedProcedure
    .input(productInput)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const vals: Record<string, any> = {
        userId: ctx.user.id,
        brandId: input.brandId,
        name: input.name,
        description: input.description || null,
        targetAudience: input.targetAudience || null,
        price: input.price || null,
        landingUrl: input.landingUrl || null,
        category: input.category || null,
        seasonality: input.seasonality || null,
      };
      if (input.features && input.features.length > 0) vals.features = input.features;
      if (input.imageUrls && input.imageUrls.length > 0) vals.imageUrls = input.imageUrls;

      const result = await db.insert(mktProducts).values(vals);
      const insertId = Number((result as any)?.[0]?.insertId);
      return { success: true, id: insertId };
    }),

  update: protectedProcedure
    .input(z.object({ id: z.number() }).merge(productInput.partial()))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...data } = input;
      await db.update(mktProducts).set(data as any)
        .where(and(eq(mktProducts.id, id), eq(mktProducts.userId, ctx.user.id)));
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(mktProducts)
        .where(and(eq(mktProducts.id, input.id), eq(mktProducts.userId, ctx.user.id)));
      return { success: true };
    }),
});
