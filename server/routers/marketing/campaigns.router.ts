import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import { mktCampaigns } from "../../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

const campaignInput = z.object({
  brandId: z.number(),
  name: z.string().min(1).max(255),
  goal: z.enum(["sales", "inquiry", "followers", "launch", "awareness", "engagement"]).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: z.enum(["draft", "active", "paused", "completed"]).optional(),
  memo: z.string().optional(),
});

export const campaignsRouter = router({
  list: protectedProcedure
    .input(z.object({ brandId: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const conditions = [eq(mktCampaigns.userId, ctx.user.id)];
      if (input?.brandId) conditions.push(eq(mktCampaigns.brandId, input.brandId));
      return db.select().from(mktCampaigns)
        .where(and(...conditions))
        .orderBy(desc(mktCampaigns.createdAt));
    }),

  create: protectedProcedure
    .input(campaignInput)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const result = await db.insert(mktCampaigns).values({
        userId: ctx.user.id,
        brandId: input.brandId,
        name: input.name,
        goal: input.goal || "sales",
        startDate: input.startDate || null,
        endDate: input.endDate || null,
        status: input.status || "draft",
        memo: input.memo || null,
      });
      const insertId = Number((result as any)?.[0]?.insertId);
      return { success: true, id: insertId };
    }),

  update: protectedProcedure
    .input(z.object({ id: z.number() }).merge(campaignInput.partial()))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...data } = input;
      await db.update(mktCampaigns).set(data as any)
        .where(and(eq(mktCampaigns.id, id), eq(mktCampaigns.userId, ctx.user.id)));
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(mktCampaigns)
        .where(and(eq(mktCampaigns.id, input.id), eq(mktCampaigns.userId, ctx.user.id)));
      return { success: true };
    }),
});
