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
      const imgUrls = input.imageUrls?.length ? JSON.stringify(input.imageUrls) : null;

      const result = await db.execute(sql`
        INSERT INTO mkt_products (user_id, brand_id, name, description, features, target_audience, price, landing_url, image_urls, category, seasonality)
        VALUES (
          ${ctx.user.id}, ${input.brandId}, ${input.name}, ${input.description || null},
          CAST(${features} AS JSON), ${input.targetAudience || null}, ${input.price || null}, ${input.landingUrl || null},
          CAST(${imgUrls} AS JSON), ${input.category || null}, ${input.seasonality || null}
        )
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
      const features = data.features !== undefined
        ? (data.features?.length ? JSON.stringify(data.features) : null)
        : undefined;
      const imgUrls = data.imageUrls !== undefined
        ? (data.imageUrls?.length ? JSON.stringify(data.imageUrls) : null)
        : undefined;

      await db.execute(sql`
        UPDATE mkt_products SET
          brand_id = COALESCE(${data.brandId ?? null}, brand_id),
          name = COALESCE(${data.name ?? null}, name),
          description = ${data.description !== undefined ? (data.description || null) : sql`description`},
          features = ${features !== undefined ? sql`CAST(${features} AS JSON)` : sql`features`},
          target_audience = ${data.targetAudience !== undefined ? (data.targetAudience || null) : sql`target_audience`},
          price = ${data.price !== undefined ? (data.price || null) : sql`price`},
          landing_url = ${data.landingUrl !== undefined ? (data.landingUrl || null) : sql`landing_url`},
          image_urls = ${imgUrls !== undefined ? sql`CAST(${imgUrls} AS JSON)` : sql`image_urls`},
          category = ${data.category !== undefined ? (data.category || null) : sql`category`},
          seasonality = ${data.seasonality !== undefined ? (data.seasonality || null) : sql`seasonality`}
        WHERE id = ${id} AND user_id = ${ctx.user.id}
      `);
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
