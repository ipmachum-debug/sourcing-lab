import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { hashPassword, verifyPassword } from "./_core/localAuth";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { users } from "../drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

// 새 비즈니스 라우터
import { sourcingRouter } from "./routers/sourcing.router";
import { productRouter } from "./routers/product.router";
import { reviewRouter } from "./routers/review.router";
import { dashboardRouter } from "./routers/dashboard.router";
import { profileRouter } from "./routers/profile.router";
import { accountsRouter } from "./routers/accounts.router";
import { coupangWatchlistRouter } from "./routers/coupangWatchlist.router";
import { dailyProfitRouter } from "./routers/dailyProfit.router";
import { coupangRouter } from "./routers/coupang.router";
import { extensionRouter } from "./routers/extension.router";
import { sourcingCoachRouter } from "./routers/sourcingCoach.router";
import { keywordMetricsRouter } from "./routers/keywordMetrics.router";
import { marginRouter } from "./routers/margin.router";
import { keywordDiscoveryRouter } from "./routers/keywordDiscovery.router";

export const appRouter = router({
  system: systemRouter,

  // ===== 새 비즈니스 라우터 =====
  sourcing: sourcingRouter,
  product: productRouter,
  review: reviewRouter,
  dashboard: dashboardRouter,
  profile: profileRouter,
  accounts: accountsRouter,
  coupangWatchlist: coupangWatchlistRouter,
  dailyProfit: dailyProfitRouter,
  coupang: coupangRouter,
  extension: extensionRouter,
  sourcingCoach: sourcingCoachRouter,
  keywordMetrics: keywordMetricsRouter,
  margin: marginRouter,
  keywordDiscovery: keywordDiscoveryRouter,

  // ===== 인증 (기존 유지) =====
  auth: router({
    me: publicProcedure.query(opts => {
      if (!opts.ctx.user) return null;
      const { password, passwordResetToken, passwordResetExpires, ...safeUser } = opts.ctx.user;
      return safeUser;
    }),

    register: publicProcedure
      .input(z.object({
        email: z.string().email(),
        password: z.string().min(8).max(100),
        name: z.string().min(1).max(100).optional(),
        userMemo: z.string().max(500).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { email, password, name, userMemo } = input;
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

        const existingUser = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (existingUser.length > 0) {
          throw new TRPCError({ code: "CONFLICT", message: "이미 사용 중인 이메일입니다." });
        }

        const hashedPassword = await hashPassword(password);
        const result = await db.insert(users).values({
          email,
          password: hashedPassword,
          name: name || null,
          userMemo: userMemo || null,
          approved: false,
          isSuperAdmin: false,
          role: "user",
          loginMethod: "local",
        });

        // MySQL2 returns insertId as bigint or number
        const rawInsertId = (result as any)?.[0]?.insertId ?? (result as any)?.insertId;
        const insertId = rawInsertId ? Number(rawInsertId) : null;
        if (insertId) {
          await db.update(users)
            .set({ openId: insertId.toString() })
            .where(eq(users.id, insertId));
        }

        return { success: true, message: "회원가입이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다." };
      }),

    login: publicProcedure
      .input(z.object({ email: z.string().email(), password: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const { email, password } = input;
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!user || !user.password) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "이메일 또는 비밀번호가 올바르지 않습니다." });
        }

        const isPasswordValid = await verifyPassword(password, user.password);
        if (!isPasswordValid) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "이메일 또는 비밀번호가 올바르지 않습니다." });
        }

        if (!user.approved) {
          throw new TRPCError({ code: "FORBIDDEN", message: "관리자 승인이 필요합니다." });
        }

        const { sdk } = await import("./_core/sdk");
        const sessionToken = await sdk.createSessionToken(user.id.toString(), {
          name: (user.name || user.email) as string,
          expiresInMs: 365 * 24 * 60 * 60 * 1000,
          loginMethod: "local",
        });

        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: 365 * 24 * 60 * 60 * 1000 });

        return {
          success: true,
          user: { id: user.id, email: user.email, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin },
        };
      }),

    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      // Use res.cookie with expires in the past instead of clearCookie to avoid Express v5 deprecation warning
      ctx.res.cookie(COOKIE_NAME, "", { ...cookieOptions, expires: new Date(0) });
      return { success: true } as const;
    }),

    requestPasswordReset: publicProcedure
      .input(z.object({ email: z.string().email() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
        if (!user) return { success: true, message: "비밀번호 재설정 링크가 이메일로 전송되었습니다." };

        const crypto = await import("crypto");
        const resetToken = crypto.randomBytes(32).toString("hex");
        const hashedToken = crypto.createHash("sha256").update(resetToken).digest("hex");

        await db.update(users).set({
          passwordResetToken: hashedToken,
          passwordResetExpires: new Date(Date.now() + 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19),
        }).where(eq(users.id, user.id));

        return {
          success: true,
          message: "비밀번호 재설정 링크가 이메일로 전송되었습니다.",
          ...(process.env.NODE_ENV === 'development' ? { resetToken } : {}),
        };
      }),

    resetPassword: publicProcedure
      .input(z.object({ token: z.string(), newPassword: z.string().min(8).max(100) }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const crypto = await import("crypto");
        const hashedToken = crypto.createHash("sha256").update(input.token).digest("hex");
        const [user] = await db.select().from(users).where(eq(users.passwordResetToken, hashedToken)).limit(1);

        if (!user || !user.passwordResetExpires || Date.now() > new Date(user.passwordResetExpires).getTime()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "유효하지 않거나 만료된 토큰입니다." });
        }

        await db.update(users).set({
          password: await hashPassword(input.newPassword),
          passwordResetToken: null,
          passwordResetExpires: null,
        }).where(eq(users.id, user.id));

        return { success: true, message: "비밀번호가 변경되었습니다." };
      }),
  }),

  // ===== 관리자 (기존 유지) =====
  admin: router({
    listUsers: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      if (!ctx.user?.isSuperAdmin) throw new TRPCError({ code: "FORBIDDEN" });

      return await db.select({
        id: users.id, email: users.email, name: users.name, role: users.role,
        approved: users.approved, isSuperAdmin: users.isSuperAdmin,
        userMemo: users.userMemo, adminMemo: users.adminMemo,
        createdAt: users.createdAt, loginMethod: users.loginMethod,
      }).from(users);
    }),

    approveUser: protectedProcedure
      .input(z.object({ userId: z.number().int(), adminMemo: z.string().max(500).optional() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        if (!ctx.user?.isSuperAdmin) throw new TRPCError({ code: "FORBIDDEN" });

        await db.update(users).set({ approved: true, adminMemo: input.adminMemo || null }).where(eq(users.id, input.userId));
        return { success: true };
      }),

    revokeUser: protectedProcedure
      .input(z.object({ userId: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        if (!ctx.user?.isSuperAdmin) throw new TRPCError({ code: "FORBIDDEN" });

        await db.update(users).set({ approved: false }).where(eq(users.id, input.userId));
        return { success: true };
      }),

    deleteUser: protectedProcedure
      .input(z.object({ userId: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        if (!ctx.user?.isSuperAdmin) throw new TRPCError({ code: "FORBIDDEN" });
        if (input.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "자기 자신은 삭제 불가" });

        await db.delete(users).where(eq(users.id, input.userId));
        return { success: true, message: "사용자가 삭제되었습니다." };
      }),

    deleteMultipleUsers: protectedProcedure
      .input(z.object({ userIds: z.array(z.number().int()) }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        if (!ctx.user?.isSuperAdmin) throw new TRPCError({ code: "FORBIDDEN" });
        if (input.userIds.includes(ctx.user.id)) throw new TRPCError({ code: "BAD_REQUEST" });

        await db.delete(users).where(inArray(users.id, input.userIds));
        return { success: true, count: input.userIds.length, message: `${input.userIds.length}명의 사용자가 삭제되었습니다.` };
      }),

    updateUserMemo: protectedProcedure
      .input(z.object({ userId: z.number().int(), adminMemo: z.string().max(500).optional() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        if (!ctx.user?.isSuperAdmin) throw new TRPCError({ code: "FORBIDDEN" });

        await db.update(users).set({ adminMemo: input.adminMemo || null }).where(eq(users.id, input.userId));
        return { success: true };
      }),

    resetUserPassword: protectedProcedure
      .input(z.object({ userId: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        if (!ctx.user?.isSuperAdmin) throw new TRPCError({ code: "FORBIDDEN" });

        const [target] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
        if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "사용자를 찾을 수 없습니다." });

        // 임시 비밀번호 생성 (8자리: 대소문자+숫자+특수문자)
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
        const special = "!@#$%";
        let tempPassword = "";
        for (let i = 0; i < 7; i++) tempPassword += chars[Math.floor(Math.random() * chars.length)];
        tempPassword += special[Math.floor(Math.random() * special.length)];
        // 셔플
        tempPassword = tempPassword.split("").sort(() => Math.random() - 0.5).join("");

        const hashedPassword = await hashPassword(tempPassword);
        await db.update(users).set({ password: hashedPassword }).where(eq(users.id, input.userId));

        return { success: true, tempPassword, email: target.email, name: target.name };
      }),

    toggleSuperAdmin: protectedProcedure
      .input(z.object({ userId: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        if (!ctx.user?.isSuperAdmin) throw new TRPCError({ code: "FORBIDDEN" });
        if (input.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "자기 자신의 권한은 변경할 수 없습니다." });

        const [target] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
        if (!target) throw new TRPCError({ code: "NOT_FOUND" });

        const newValue = !target.isSuperAdmin;
        await db.update(users).set({ isSuperAdmin: newValue }).where(eq(users.id, input.userId));
        return { success: true, message: newValue ? "슈퍼 어드민으로 승격되었습니다." : "슈퍼 어드민 권한이 해제되었습니다." };
      }),
  }),
});

export type AppRouter = typeof appRouter;
