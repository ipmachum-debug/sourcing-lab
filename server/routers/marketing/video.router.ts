import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import { mktVideoJobs, mktProducts, mktBrands, mktChannelPosts } from "../../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  selectBestCuts, generateStory, generateVideoPrompt,
  callVideoApi, checkVideoStatus, selectBgm,
} from "../../modules/marketing/videoPipeline";
import { postProcessVideo, createSlideshowVideo } from "../../modules/marketing/videoPostProcess";

export const videoRouter = router({
  // 영상 작업 목록
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db.select().from(mktVideoJobs)
      .where(eq(mktVideoJobs.userId, ctx.user.id))
      .orderBy(desc(mktVideoJobs.createdAt))
      .limit(20);
  }),

  // Step 1: 영상 제작 시작 — 이미지 선택 + 스토리 + 프롬프트 한번에
  create: protectedProcedure
    .input(z.object({
      productId: z.number(),
      videoStyle: z.enum(["instagram_reel", "tiktok", "youtube_shorts", "product_showcase", "unboxing", "review"]).optional(),
      videoDuration: z.number().min(5).max(60).optional(),
      bgmMood: z.enum(["upbeat", "calm", "luxury", "cute", "trendy", "emotional"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 상품 + 브랜드 조회
      const [product] = await db.select().from(mktProducts)
        .where(and(eq(mktProducts.id, input.productId), eq(mktProducts.userId, ctx.user.id)))
        .limit(1);
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "상품을 찾을 수 없습니다." });

      const [brand] = await db.select().from(mktBrands)
        .where(eq(mktBrands.id, product.brandId))
        .limit(1);

      const images = (product.imageUrls as string[]) || [];
      if (images.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "상품 사진이 없습니다. 먼저 사진을 업로드하세요." });
      }

      const style = input.videoStyle || "instagram_reel";
      const duration = input.videoDuration || 15;
      const mood = input.bgmMood || "trendy";

      // Step 1: AI 베스트 컷 선택
      const { selected, reason } = await selectBestCuts(images, product, brand);

      // Step 2: 스토리 생성
      const { script, subtitles } = await generateStory(selected, product, brand, style);

      // Step 3: 영상 프롬프트 생성
      const videoPrompt = await generateVideoPrompt(product, brand, script, style);

      // Step 6: BGM 선택
      const bgm = selectBgm(mood);

      // DB 저장
      const sourceImagesJson = JSON.stringify(images);
      const selectedImagesJson = JSON.stringify(selected);

      const result = await db.execute(sql`
        INSERT INTO mkt_video_jobs (user_id, product_id, source_images, selected_images,
          story_script, video_prompt, video_style, video_duration,
          subtitle_text, bgm_track, bgm_mood, status)
        VALUES (
          ${ctx.user.id}, ${input.productId},
          CAST(${sourceImagesJson} AS JSON), CAST(${selectedImagesJson} AS JSON),
          ${script}, ${videoPrompt}, ${style}, ${duration},
          ${subtitles}, ${bgm.track}, ${mood}, ${"prompting"}
        )
      `);
      const jobId = Number((result as any)?.[0]?.insertId);

      return {
        success: true,
        id: jobId,
        selectedImages: selected,
        selectionReason: reason,
        script,
        videoPrompt,
        bgm: bgm.name,
      };
    }),

  // Step 4: Kling API 호출 (영상 생성 시작)
  startGeneration: protectedProcedure
    .input(z.object({
      jobId: z.number(),
      imageUrl: z.string().optional(), // 특정 이미지로 생성 (없으면 첫번째 선택 이미지)
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [job] = await db.select().from(mktVideoJobs)
        .where(and(eq(mktVideoJobs.id, input.jobId), eq(mktVideoJobs.userId, ctx.user.id)))
        .limit(1);
      if (!job) throw new TRPCError({ code: "NOT_FOUND" });

      const selectedImages = (job.selectedImages as string[]) || [];
      const imageUrl = input.imageUrl || selectedImages[0];
      if (!imageUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "이미지가 없습니다." });

      // 상대 경로를 절대 URL로 변환
      const host = process.env.BASE_URL || "https://lumiriz.kr";
      const fullImageUrl = imageUrl.startsWith("http") ? imageUrl : `${host}${imageUrl}`;

      const result = await callVideoApi(fullImageUrl, job.videoPrompt || "", job.videoDuration || 5);

      if ("error" in result) {
        await db.execute(sql`
          UPDATE mkt_video_jobs SET status = 'failed', error_message = ${result.error}
          WHERE id = ${input.jobId}
        `);
        throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
      }

      await db.execute(sql`
        UPDATE mkt_video_jobs SET status = 'generating', kling_task_id = ${result.taskId}
        WHERE id = ${input.jobId}
      `);

      return { success: true, taskId: result.taskId };
    }),

  // Kling 상태 확인
  checkStatus: protectedProcedure
    .input(z.object({ jobId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [job] = await db.select().from(mktVideoJobs)
        .where(and(eq(mktVideoJobs.id, input.jobId), eq(mktVideoJobs.userId, ctx.user.id)))
        .limit(1);
      if (!job) throw new TRPCError({ code: "NOT_FOUND" });

      if (!job.klingTaskId) return { status: job.status, job };

      const result = await checkVideoStatus(job.klingTaskId);

      if (result.status === "completed" && result.videoUrl) {
        await db.execute(sql`
          UPDATE mkt_video_jobs SET status = 'completed', raw_video_url = ${result.videoUrl}, final_video_url = ${result.videoUrl}
          WHERE id = ${input.jobId}
        `);
        return { status: "completed", videoUrl: result.videoUrl, job: { ...job, status: "completed", rawVideoUrl: result.videoUrl } };
      } else if (result.status === "failed") {
        await db.execute(sql`
          UPDATE mkt_video_jobs SET status = 'failed', error_message = ${result.error || "생성 실패"}
          WHERE id = ${input.jobId}
        `);
      }

      return { status: result.status, job };
    }),

  // 완성된 영상을 발행 큐에 추가
  sendToQueue: protectedProcedure
    .input(z.object({
      jobId: z.number(),
      platforms: z.array(z.enum(["instagram", "youtube", "tiktok"])),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [job] = await db.select().from(mktVideoJobs)
        .where(and(eq(mktVideoJobs.id, input.jobId), eq(mktVideoJobs.userId, ctx.user.id)))
        .limit(1);
      if (!job || !job.finalVideoUrl) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "영상이 완성되지 않았습니다." });
      }

      const mediaPaths = JSON.stringify([job.finalVideoUrl]);

      for (const platform of input.platforms) {
        await db.execute(sql`
          INSERT INTO mkt_channel_posts (content_item_id, user_id, platform, title, caption, media_paths, publish_status)
          VALUES (
            ${job.contentItemId || 0}, ${ctx.user.id}, ${platform},
            ${job.storyScript?.slice(0, 100) || "영상 콘텐츠"},
            ${job.storyScript || ""},
            CAST(${mediaPaths} AS JSON), ${"queued"}
          )
        `);
      }

      return { success: true, count: input.platforms.length };
    }),

  // FFmpeg 후처리 (자막 + BGM + CTA 합성)
  postProcess: protectedProcedure
    .input(z.object({
      jobId: z.number(),
      ctaText: z.string().optional(),
      brandName: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [job] = await db.select().from(mktVideoJobs)
        .where(and(eq(mktVideoJobs.id, input.jobId), eq(mktVideoJobs.userId, ctx.user.id)))
        .limit(1);
      if (!job) throw new TRPCError({ code: "NOT_FOUND" });
      if (!job.rawVideoUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "원본 영상이 없습니다." });

      // 상태 업데이트
      await db.execute(sql`UPDATE mkt_video_jobs SET status = 'processing' WHERE id = ${input.jobId}`);

      // 자막 파싱
      const subtitleLines = job.subtitleText
        ? job.subtitleText.split("\n").filter((l: string) => l.trim())
        : [];

      // 후처리 실행
      const result = await postProcessVideo({
        rawVideoUrl: job.rawVideoUrl,
        subtitleLines,
        bgmPath: job.bgmTrack || undefined,
        ctaText: input.ctaText || "지금 바로 주문하세요!",
        brandName: input.brandName || undefined,
        outputFormat: "vertical",
      });

      if (result.success && result.outputUrl) {
        await db.execute(sql`
          UPDATE mkt_video_jobs SET status = 'completed', final_video_url = ${result.outputUrl}
          WHERE id = ${input.jobId}
        `);
        return { success: true, videoUrl: result.outputUrl };
      } else {
        await db.execute(sql`
          UPDATE mkt_video_jobs SET status = 'failed', error_message = ${result.error || "후처리 실패"}
          WHERE id = ${input.jobId}
        `);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error });
      }
    }),

  // 사진 슬라이드쇼 영상 (Minimax 없이)
  createSlideshow: protectedProcedure
    .input(z.object({
      productId: z.number(),
      ctaText: z.string().optional(),
      brandName: z.string().optional(),
      secondsPerImage: z.number().min(2).max(5).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [product] = await db.select().from(mktProducts)
        .where(and(eq(mktProducts.id, input.productId), eq(mktProducts.userId, ctx.user.id)))
        .limit(1);
      if (!product) throw new TRPCError({ code: "NOT_FOUND" });

      const images = (product.imageUrls as string[]) || [];
      if (images.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "상품 사진이 없습니다." });

      const [brand] = product.brandId
        ? await db.select().from(mktBrands).where(eq(mktBrands.id, product.brandId)).limit(1)
        : [null];

      // AI로 자막 생성
      const { subtitles } = await generateStory(images, product, brand, "product_showcase");
      const subtitleLines = subtitles ? subtitles.split("\n").filter((l: string) => l.trim()) : [];

      // 슬라이드쇼 생성
      const result = await createSlideshowVideo(images, subtitleLines, {
        secondsPerImage: input.secondsPerImage || 3,
        brandName: input.brandName || brand?.name || undefined,
        ctaText: input.ctaText || "지금 바로 주문하세요!",
        outputFormat: "vertical",
      });

      if (!result.success) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error });
      }

      // DB 저장
      const sourceImagesJson = JSON.stringify(images);
      await db.execute(sql`
        INSERT INTO mkt_video_jobs (user_id, product_id, source_images, selected_images,
          story_script, video_style, video_duration, subtitle_text, final_video_url, status)
        VALUES (
          ${ctx.user.id}, ${input.productId},
          CAST(${sourceImagesJson} AS JSON), CAST(${sourceImagesJson} AS JSON),
          ${subtitles || ""}, ${"product_showcase"}, ${images.length * (input.secondsPerImage || 3)},
          ${subtitles || ""}, ${result.outputUrl}, ${"completed"}
        )
      `);

      return { success: true, videoUrl: result.outputUrl };
    }),

  // 삭제
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(mktVideoJobs)
        .where(and(eq(mktVideoJobs.id, input.id), eq(mktVideoJobs.userId, ctx.user.id)));
      return { success: true };
    }),
});
