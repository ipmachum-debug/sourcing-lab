import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import { mktProducts } from "../../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
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
      const features = input.features?.length ? JSON.stringify(input.features) : null;

      const result = await db.execute(sql`
        INSERT INTO mkt_products (user_id, brand_id, name, description, features, target_audience, price, landing_url, category, season_keywords)
        VALUES (${ctx.user.id}, ${input.brandId}, ${input.name}, ${input.description || null},
                ${features}, ${input.targetAudience || null}, ${input.price || null}, ${input.landingUrl || null},
                ${input.category || null}, ${input.seasonality || null})
      `);
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
