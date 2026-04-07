import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import { mktCopyLibrary, mktMediaAssets, mktCompetitors } from "../../../drizzle/schema";
import { eq, and, desc, sql, like } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

const platformEnum = z.enum(["instagram", "youtube", "tiktok", "naver_blog", "naver_cafe", "kakao", "all"]);

// ======================== 베스트 카피 라이브러리 ========================
const copyLibraryRouter = router({
  list: protectedProcedure
    .input(z.object({
      category: z.enum(["hook", "caption", "cta", "hashtag_set", "script", "title", "description"]).optional(),
      platform: platformEnum.optional(),
      search: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const conditions = [eq(mktCopyLibrary.userId, ctx.user.id)];
      if (input?.category) conditions.push(eq(mktCopyLibrary.category, input.category));
      if (input?.platform) conditions.push(eq(mktCopyLibrary.platform, input.platform));
      if (input?.search) conditions.push(like(mktCopyLibrary.text, `%${input.search}%`));
      return db.select().from(mktCopyLibrary)
        .where(and(...conditions))
        .orderBy(desc(mktCopyLibrary.performanceScore), desc(mktCopyLibrary.createdAt))
        .limit(100);
    }),

  save: protectedProcedure
    .input(z.object({
      brandId: z.number().optional(),
      sourceContentId: z.number().optional(),
      category: z.enum(["hook", "caption", "cta", "hashtag_set", "script", "title", "description"]),
      platform: platformEnum.optional(),
      text: z.string().min(1),
      performanceScore: z.number().optional(),
      tags: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const result = await db.insert(mktCopyLibrary).values({
        userId: ctx.user.id,
        brandId: input.brandId || null,
        sourceContentId: input.sourceContentId || null,
        category: input.category,
        platform: input.platform || null,
        text: input.text,
        performanceScore: input.performanceScore || null,
        tags: input.tags?.length ? input.tags : null,
      });
      const insertId = Number((result as any)?.[0]?.insertId);
      return { success: true, id: insertId };
    }),

  toggleFavorite: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [item] = await db.select().from(mktCopyLibrary)
        .where(and(eq(mktCopyLibrary.id, input.id), eq(mktCopyLibrary.userId, ctx.user.id)))
        .limit(1);
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      await db.update(mktCopyLibrary)
        .set({ isFavorite: !item.isFavorite } as any)
        .where(eq(mktCopyLibrary.id, input.id));
      return { success: true, isFavorite: !item.isFavorite };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(mktCopyLibrary)
        .where(and(eq(mktCopyLibrary.id, input.id), eq(mktCopyLibrary.userId, ctx.user.id)));
      return { success: true };
    }),
});

// ======================== 미디어 라이브러리 ========================
const mediaRouter = router({
  list: protectedProcedure
    .input(z.object({
      type: z.enum(["image", "video", "template", "document", "audio"]).optional(),
      folder: z.string().optional(),
      search: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const conditions = [eq(mktMediaAssets.userId, ctx.user.id)];
      if (input?.type) conditions.push(eq(mktMediaAssets.type, input.type));
      if (input?.folder) conditions.push(eq(mktMediaAssets.folder, input.folder));
      if (input?.search) conditions.push(like(mktMediaAssets.name, `%${input.search}%`));
      return db.select().from(mktMediaAssets)
        .where(and(...conditions))
        .orderBy(desc(mktMediaAssets.createdAt))
        .limit(100);
    }),

  upload: protectedProcedure
    .input(z.object({
      brandId: z.number().optional(),
      clientId: z.number().optional(),
      name: z.string().min(1),
      type: z.enum(["image", "video", "template", "document", "audio"]),
      url: z.string().min(1),
      thumbnailUrl: z.string().optional(),
      mimeType: z.string().optional(),
      fileSize: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      duration: z.number().optional(),
      tags: z.array(z.string()).optional(),
      folder: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const result = await db.insert(mktMediaAssets).values({
        userId: ctx.user.id,
        brandId: input.brandId || null,
        clientId: input.clientId || null,
        name: input.name,
        type: input.type,
        url: input.url,
        thumbnailUrl: input.thumbnailUrl || null,
        mimeType: input.mimeType || null,
        fileSize: input.fileSize || null,
        width: input.width || null,
        height: input.height || null,
        duration: input.duration || null,
        tags: input.tags?.length ? input.tags : null,
        folder: input.folder || null,
      });
      const insertId = Number((result as any)?.[0]?.insertId);
      return { success: true, id: insertId };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(mktMediaAssets)
        .where(and(eq(mktMediaAssets.id, input.id), eq(mktMediaAssets.userId, ctx.user.id)));
      return { success: true };
    }),

  // 폴더 목록
  listFolders: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const folders = await db.select({
      folder: mktMediaAssets.folder,
      count: sql<number>`count(*)`,
    }).from(mktMediaAssets)
      .where(eq(mktMediaAssets.userId, ctx.user.id))
      .groupBy(mktMediaAssets.folder);
    return folders.filter(f => f.folder);
  }),
});

// ======================== 경쟁사 모니터링 ========================
const competitorsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db.select().from(mktCompetitors)
      .where(eq(mktCompetitors.userId, ctx.user.id))
      .orderBy(desc(mktCompetitors.createdAt));
  }),

  add: protectedProcedure
    .input(z.object({
      brandId: z.number().optional(),
      name: z.string().min(1),
      platform: z.enum(["instagram", "youtube", "tiktok", "naver_blog", "naver_cafe", "kakao"]),
      accountUrl: z.string().optional(),
      accountHandle: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const result = await db.insert(mktCompetitors).values({
        userId: ctx.user.id,
        brandId: input.brandId || null,
        name: input.name,
        platform: input.platform,
        accountUrl: input.accountUrl || null,
        accountHandle: input.accountHandle || null,
      });
      const insertId = Number((result as any)?.[0]?.insertId);
      return { success: true, id: insertId };
    }),

  // AI 경쟁사 분석
  analyze: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [comp] = await db.select().from(mktCompetitors)
        .where(and(eq(mktCompetitors.id, input.id), eq(mktCompetitors.userId, ctx.user.id)))
        .limit(1);
      if (!comp) throw new TRPCError({ code: "NOT_FOUND" });

      const apiUrl = process.env.BUILT_IN_FORGE_API_URL;
      const apiKey = process.env.BUILT_IN_FORGE_API_KEY;
      if (!apiUrl || !apiKey) throw new TRPCError({ code: "BAD_REQUEST", message: "AI API 설정이 필요합니다." });

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `소셜미디어 경쟁사 분석 전문가입니다. JSON으로 응답:
{"strengths": "강점 분석", "weaknesses": "약점 분석", "postingFrequency": "예상 발행 빈도", "recommendations": "우리가 취할 전략"}`,
            },
            {
              role: "user",
              content: `경쟁사 분석:\n이름: ${comp.name}\n플랫폼: ${comp.platform}\n핸들: ${comp.accountHandle || "미지정"}\nURL: ${comp.accountUrl || "미지정"}\n팔로워: ${comp.followers || "미지정"}\n평균 좋아요: ${comp.avgLikes || "미지정"}`,
            },
          ],
          temperature: 0.7,
          max_tokens: 1000,
          response_format: { type: "json_object" },
        }),
      });

      if (!response.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 분석 실패" });
      const data = await response.json();
      const analysis = JSON.parse(data.choices?.[0]?.message?.content || "{}");

      await db.update(mktCompetitors).set({
        strengths: analysis.strengths || null,
        weaknesses: analysis.weaknesses || null,
        postingFrequency: analysis.postingFrequency || null,
        lastCheckedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
      } as any).where(eq(mktCompetitors.id, input.id));

      return { success: true, analysis };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      followers: z.number().optional(),
      avgLikes: z.number().optional(),
      avgComments: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...data } = input;
      await db.update(mktCompetitors).set(data as any)
        .where(and(eq(mktCompetitors.id, id), eq(mktCompetitors.userId, ctx.user.id)));
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(mktCompetitors)
        .where(and(eq(mktCompetitors.id, input.id), eq(mktCompetitors.userId, ctx.user.id)));
      return { success: true };
    }),
});

export const libraryRouter = router({
  copy: copyLibraryRouter,
  media: mediaRouter,
  competitors: competitorsRouter,
});
