import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../_core/localAuth";

export const profileRouter = router({
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        userMemo: users.userMemo,
        profileImage: users.profileImage,
        role: users.role,
        isSuperAdmin: users.isSuperAdmin,
        loginMethod: users.loginMethod,
        createdAt: users.createdAt,
        lastSignedIn: users.lastSignedIn,
      })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);

    if (!user) throw new TRPCError({ code: "NOT_FOUND" });
    return user;
  }),

  updateProfile: protectedProcedure
    .input(
      z.object({
        name: z.string().max(100).optional(),
        userMemo: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db
        .update(users)
        .set({
          name: input.name || null,
          userMemo: input.userMemo || null,
        })
        .where(eq(users.id, ctx.user.id));

      return { success: true };
    }),

  uploadProfileImage: protectedProcedure
    .input(
      z.object({
        imageData: z.string().max(2 * 1024 * 1024, "이미지는 2MB 이하여야 합니다."), // base64 data URL
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Validate that it's a data URL with image type
      if (!input.imageData.startsWith("data:image/")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "유효한 이미지 파일이 아닙니다." });
      }

      await db
        .update(users)
        .set({ profileImage: input.imageData })
        .where(eq(users.id, ctx.user.id));

      return { success: true };
    }),

  removeProfileImage: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db
        .update(users)
        .set({ profileImage: null })
        .where(eq(users.id, ctx.user.id));

      return { success: true };
    }),

  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string(),
        newPassword: z.string().min(8).max(100),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      if (!user || !user.password) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "비밀번호를 변경할 수 없는 계정입니다.",
        });
      }

      const isValid = await verifyPassword(input.currentPassword, user.password);
      if (!isValid) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "현재 비밀번호가 올바르지 않습니다.",
        });
      }

      const hashedPassword = await hashPassword(input.newPassword);
      await db
        .update(users)
        .set({ password: hashedPassword })
        .where(eq(users.id, ctx.user.id));

      return { success: true };
    }),
});
