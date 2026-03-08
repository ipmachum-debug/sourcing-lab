import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { coupangApiSettings } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

export const coupangWatchlistRouter = router({
  getApiSettings: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const [settings] = await db
      .select()
      .from(coupangApiSettings)
      .where(eq(coupangApiSettings.userId, ctx.user.id))
      .limit(1);

    return settings || null;
  }),

  saveApiSettings: protectedProcedure
    .input(
      z.object({
        accessKey: z.string().min(1),
        secretKey: z.string().min(1),
        priceChangeThresholdPercent: z.string().optional(),
        checkTime: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [existing] = await db
        .select()
        .from(coupangApiSettings)
        .where(eq(coupangApiSettings.userId, ctx.user.id))
        .limit(1);

      if (existing) {
        await db
          .update(coupangApiSettings)
          .set({
            accessKey: input.accessKey,
            secretKey: input.secretKey,
            priceChangeThresholdPercent: input.priceChangeThresholdPercent || "3.00",
            checkTime: input.checkTime || "09:10",
          })
          .where(eq(coupangApiSettings.id, existing.id));
      } else {
        await db.insert(coupangApiSettings).values({
          userId: ctx.user.id,
          accessKey: input.accessKey,
          secretKey: input.secretKey,
          priceChangeThresholdPercent: input.priceChangeThresholdPercent || "3.00",
          checkTime: input.checkTime || "09:10",
        });
      }

      return { success: true };
    }),
});
