import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import { mktClients, mktBrands, mktCampaigns } from "../../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

const clientInput = z.object({
  name: z.string().min(1).max(255),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().optional(),
  industry: z.string().optional(),
  monthlyBudget: z.string().optional(),
  contractStart: z.string().optional(),
  contractEnd: z.string().optional(),
  status: z.enum(["active", "paused", "completed", "prospect"]).optional(),
  memo: z.string().optional(),
});

export const clientsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const clients = await db.select().from(mktClients)
      .where(eq(mktClients.userId, ctx.user.id))
      .orderBy(desc(mktClients.createdAt));

    // 각 클라이언트에 연결된 브랜드 수, 캠페인 수 카운트
    const result = [];
    for (const client of clients) {
      const [brandCount] = await db.select({
        count: sql<number>`count(*)`,
      }).from(mktBrands)
        .where(and(eq(mktBrands.userId, ctx.user.id)));

      const [campaignCount] = await db.select({
        count: sql<number>`count(*)`,
      }).from(mktCampaigns)
        .where(eq(mktCampaigns.userId, ctx.user.id));

      result.push({
        ...client,
        brandCount: Number(brandCount?.count || 0),
        campaignCount: Number(campaignCount?.count || 0),
      });
    }
    return result;
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [client] = await db.select().from(mktClients)
        .where(and(eq(mktClients.id, input.id), eq(mktClients.userId, ctx.user.id)))
        .limit(1);
      if (!client) throw new TRPCError({ code: "NOT_FOUND" });
      return client;
    }),

  create: protectedProcedure.input(clientInput).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const result = await db.insert(mktClients).values({
      userId: ctx.user.id,
      name: input.name,
      contactName: input.contactName || null,
      contactEmail: input.contactEmail || null,
      contactPhone: input.contactPhone || null,
      industry: input.industry || null,
      monthlyBudget: input.monthlyBudget || null,
      contractStart: input.contractStart || null,
      contractEnd: input.contractEnd || null,
      status: input.status || "active",
      memo: input.memo || null,
    });
    const insertId = Number((result as any)?.[0]?.insertId);
    return { success: true, id: insertId };
  }),

  update: protectedProcedure
    .input(z.object({ id: z.number() }).merge(clientInput.partial()))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...data } = input;
      await db.update(mktClients).set(data as any)
        .where(and(eq(mktClients.id, id), eq(mktClients.userId, ctx.user.id)));
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(mktClients)
        .where(and(eq(mktClients.id, input.id), eq(mktClients.userId, ctx.user.id)));
      return { success: true };
    }),
});
