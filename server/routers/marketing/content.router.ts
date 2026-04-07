import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import { mktContentItems, mktChannelPosts, mktProducts, mktBrands } from "../../../drizzle/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { generateContent } from "../../modules/marketing/contentGenerator";

export const contentRouter = router({
  // 콘텐츠 목록
  list: protectedProcedure
    .input(z.object({
      campaignId: z.number().optional(),
      status: z.enum(["draft", "approved", "scheduled", "published", "failed", "archived"]).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const conditions = [eq(mktContentItems.userId, ctx.user.id)];
      if (input?.campaignId) conditions.push(eq(mktContentItems.campaignId, input.campaignId));
      if (input?.status) conditions.push(eq(mktContentItems.status, input.status));
      return db.select().from(mktContentItems)
        .where(and(...conditions))
        .orderBy(desc(mktContentItems.createdAt));
    }),

  // 콘텐츠 상세
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [content] = await db.select().from(mktContentItems)
        .where(and(eq(mktContentItems.id, input.id), eq(mktContentItems.userId, ctx.user.id)))
        .limit(1);
      if (!content) throw new TRPCError({ code: "NOT_FOUND" });

      // 채널별 발행 목록도 함께
      const posts = await db.select().from(mktChannelPosts)
        .where(eq(mktChannelPosts.contentItemId, input.id))
        .orderBy(desc(mktChannelPosts.createdAt));

      return { ...content, channelPosts: posts };
    }),

  // AI 콘텐츠 생성
  generate: protectedProcedure
    .input(z.object({
      productId: z.number(),
      campaignId: z.number().optional(),
      platforms: z.array(z.enum(["instagram", "youtube", "tiktok", "naver_blog", "naver_cafe", "kakao"])),
      contentType: z.enum(["promotional", "storytelling", "educational", "event", "review"]).optional(),
      customPrompt: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 상품 + 브랜드 정보 조회
      const [product] = await db.select().from(mktProducts)
        .where(and(eq(mktProducts.id, input.productId), eq(mktProducts.userId, ctx.user.id)))
        .limit(1);
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "상품을 찾을 수 없습니다." });

      const [brand] = await db.select().from(mktBrands)
        .where(eq(mktBrands.id, product.brandId))
        .limit(1);

      // AI 콘텐츠 생성
      const generated = await generateContent({
        product,
        brand: brand || null,
        platforms: input.platforms,
        contentType: input.contentType || "promotional",
        customPrompt: input.customPrompt,
      });

      // 마스터 콘텐츠 저장
      const result = await db.insert(mktContentItems).values({
        userId: ctx.user.id,
        productId: input.productId,
        campaignId: input.campaignId || null,
        sourceType: "ai_generated",
        masterTitle: generated.masterTitle,
        masterHook: generated.masterHook,
        masterBody: generated.masterBody,
        hashtags: generated.hashtags,
        script: generated.script || null,
        status: "draft",
        aiScore: generated.aiScore || null,
      });
      const contentId = Number((result as any)?.[0]?.insertId);

      // 채널별 변환 결과 저장
      for (const post of generated.channelPosts) {
        await db.insert(mktChannelPosts).values({
          contentItemId: contentId,
          userId: ctx.user.id,
          platform: post.platform,
          title: post.title || null,
          caption: post.caption || null,
          description: post.description || null,
          hashtags: post.hashtags || [],
          publishStatus: "queued",
        });
      }

      return { success: true, id: contentId, generated };
    }),

  // 콘텐츠 수동 생성/수정
  upsert: protectedProcedure
    .input(z.object({
      id: z.number().optional(),
      productId: z.number().optional(),
      campaignId: z.number().optional(),
      masterTitle: z.string().optional(),
      masterHook: z.string().optional(),
      masterBody: z.string().optional(),
      hashtags: z.array(z.string()).optional(),
      script: z.string().optional(),
      status: z.enum(["draft", "approved", "scheduled", "published", "failed", "archived"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      if (input.id) {
        const { id, ...data } = input;
        await db.update(mktContentItems).set(data as any)
          .where(and(eq(mktContentItems.id, id), eq(mktContentItems.userId, ctx.user.id)));
        return { success: true, id };
      }

      const result = await db.insert(mktContentItems).values({
        userId: ctx.user.id,
        productId: input.productId || null,
        campaignId: input.campaignId || null,
        sourceType: "manual",
        masterTitle: input.masterTitle || null,
        masterHook: input.masterHook || null,
        masterBody: input.masterBody || null,
        hashtags: input.hashtags?.length ? input.hashtags : null,
        script: input.script || null,
        status: input.status || "draft",
      });
      const insertId = Number((result as any)?.[0]?.insertId);
      return { success: true, id: insertId };
    }),

  // 상태 변경 (승인/예약/보관 등)
  updateStatus: protectedProcedure
    .input(z.object({
      ids: z.array(z.number()),
      status: z.enum(["draft", "approved", "scheduled", "published", "failed", "archived"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(mktContentItems)
        .set({ status: input.status } as any)
        .where(and(
          inArray(mktContentItems.id, input.ids),
          eq(mktContentItems.userId, ctx.user.id),
        ));
      return { success: true, count: input.ids.length };
    }),

  // 삭제
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // 채널 포스트도 함께 삭제
      await db.delete(mktChannelPosts).where(eq(mktChannelPosts.contentItemId, input.id));
      await db.delete(mktContentItems)
        .where(and(eq(mktContentItems.id, input.id), eq(mktContentItems.userId, ctx.user.id)));
      return { success: true };
    }),
});
