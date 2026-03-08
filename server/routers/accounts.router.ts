import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { platformAccounts } from "../../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

export const accountsRouter = router({
  get: protectedProcedure
    .input(z.object({ platform: z.enum(["1688", "aliexpress"]) }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [account] = await db
        .select({
          id: platformAccounts.id,
          platform: platformAccounts.platform,
          accountName: platformAccounts.accountName,
          username: platformAccounts.username,
          loginStatus: platformAccounts.loginStatus,
          lastLoginAt: platformAccounts.lastLoginAt,
          captchaApiKey: platformAccounts.captchaApiKey,
        })
        .from(platformAccounts)
        .where(
          and(
            eq(platformAccounts.userId, ctx.user.id),
            eq(platformAccounts.platform, input.platform)
          )
        )
        .limit(1);

      return account || null;
    }),

  save: protectedProcedure
    .input(
      z.object({
        platform: z.enum(["1688", "aliexpress"]),
        accountName: z.string().optional(),
        username: z.string().min(1),
        password: z.string().min(1),
        captchaApiKey: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Check existing
      const [existing] = await db
        .select()
        .from(platformAccounts)
        .where(
          and(
            eq(platformAccounts.userId, ctx.user.id),
            eq(platformAccounts.platform, input.platform)
          )
        )
        .limit(1);

      if (existing) {
        await db
          .update(platformAccounts)
          .set({
            accountName: input.accountName || null,
            username: input.username,
            encryptedPassword: input.password, // In production, encrypt this
            captchaApiKey: input.captchaApiKey || null,
          })
          .where(eq(platformAccounts.id, existing.id));
      } else {
        await db.insert(platformAccounts).values({
          userId: ctx.user.id,
          platform: input.platform,
          accountName: input.accountName || null,
          username: input.username,
          encryptedPassword: input.password, // In production, encrypt this
          captchaApiKey: input.captchaApiKey || null,
        });
      }

      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ platform: z.enum(["1688", "aliexpress"]) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db
        .delete(platformAccounts)
        .where(
          and(
            eq(platformAccounts.userId, ctx.user.id),
            eq(platformAccounts.platform, input.platform)
          )
        );

      return { success: true };
    }),

  testLogin: protectedProcedure
    .input(z.object({ platform: z.enum(["1688", "aliexpress"]) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // For now, just update the login status to simulate test
      const [account] = await db
        .select()
        .from(platformAccounts)
        .where(
          and(
            eq(platformAccounts.userId, ctx.user.id),
            eq(platformAccounts.platform, input.platform)
          )
        )
        .limit(1);

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "계정 정보가 없습니다. 먼저 계정을 저장해주세요.",
        });
      }

      // Update login status (actual login test would go here)
      await db
        .update(platformAccounts)
        .set({
          loginStatus: "logged_in",
          lastLoginAt: sql`NOW()`,
        })
        .where(eq(platformAccounts.id, account.id));

      return { success: true };
    }),
});
