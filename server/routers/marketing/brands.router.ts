import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import { mktBrands, mktProducts } from "../../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

const brandInput = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  toneOfVoice: z.enum(["casual", "premium", "friendly", "professional", "b2b"]).optional(),
  keywords: z.array(z.string()).optional(),
  forbiddenWords: z.array(z.string()).optional(),
  ctaStyle: z.enum(["purchase", "inquiry", "visit", "follow", "custom"]).optional(),
  logoUrl: z.string().optional(),
  colorPrimary: z.string().max(7).optional(),
});

export const brandsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db.select().from(mktBrands)
      .where(eq(mktBrands.userId, ctx.user.id))
      .orderBy(desc(mktBrands.createdAt));
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [brand] = await db.select().from(mktBrands)
        .where(and(eq(mktBrands.id, input.id), eq(mktBrands.userId, ctx.user.id)))
        .limit(1);
      if (!brand) throw new TRPCError({ code: "NOT_FOUND", message: "브랜드를 찾을 수 없습니다." });
      return brand;
    }),

  create: protectedProcedure
    .input(brandInput)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const vals: Record<string, any> = {
        userId: ctx.user.id,
        name: input.name,
        description: input.description || null,
        toneOfVoice: input.toneOfVoice || "friendly",
        ctaStyle: input.ctaStyle || "purchase",
        logoUrl: input.logoUrl || null,
        colorPrimary: input.colorPrimary || null,
      };
      // JSON 컬럼: sql`CAST(... AS JSON)`으로 명시적 변환
      if (input.keywords && input.keywords.length > 0) {
        vals.keywords = sql`CAST(${JSON.stringify(input.keywords)} AS JSON)`;
      }
      if (input.forbiddenWords && input.forbiddenWords.length > 0) {
        vals.forbiddenWords = sql`CAST(${JSON.stringify(input.forbiddenWords)} AS JSON)`;
      }

      const result = await db.insert(mktBrands).values(vals);
      const insertId = Number((result as any)?.[0]?.insertId);
      return { success: true, id: insertId };
    }),

  update: protectedProcedure
    .input(z.object({ id: z.number() }).merge(brandInput.partial()))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...data } = input;
      await db.update(mktBrands).set(data as any)
        .where(and(eq(mktBrands.id, id), eq(mktBrands.userId, ctx.user.id)));
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(mktBrands)
        .where(and(eq(mktBrands.id, input.id), eq(mktBrands.userId, ctx.user.id)));
      return { success: true };
    }),
});
