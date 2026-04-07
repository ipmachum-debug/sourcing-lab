import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import { mktReports, mktChannelPosts, mktAnalytics, mktContentItems, mktBrands } from "../../../drizzle/schema";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

export const reportsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db.select().from(mktReports)
      .where(eq(mktReports.userId, ctx.user.id))
      .orderBy(desc(mktReports.createdAt));
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [report] = await db.select().from(mktReports)
        .where(and(eq(mktReports.id, input.id), eq(mktReports.userId, ctx.user.id)))
        .limit(1);
      if (!report) throw new TRPCError({ code: "NOT_FOUND" });
      return report;
    }),

  // AI 리포트 자동 생성
  generate: protectedProcedure
    .input(z.object({
      clientId: z.number().optional(),
      brandId: z.number().optional(),
      periodStart: z.string(),
      periodEnd: z.string(),
      title: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 기간 내 성과 데이터 수집
      const publishedPosts = await db.select().from(mktChannelPosts)
        .where(and(
          eq(mktChannelPosts.userId, ctx.user.id),
          eq(mktChannelPosts.publishStatus, "published"),
          gte(mktChannelPosts.publishedAt, input.periodStart),
          lte(mktChannelPosts.publishedAt, input.periodEnd + " 23:59:59"),
        ));

      // 플랫폼별 성과 집계
      const platformStats = await db.select({
        platform: mktAnalytics.platform,
        totalViews: sql<number>`SUM(${mktAnalytics.views})`,
        totalLikes: sql<number>`SUM(${mktAnalytics.likes})`,
        totalComments: sql<number>`SUM(${mktAnalytics.comments})`,
        totalShares: sql<number>`SUM(${mktAnalytics.shares})`,
        totalClicks: sql<number>`SUM(${mktAnalytics.clicks})`,
        totalConversions: sql<number>`SUM(${mktAnalytics.conversions})`,
        postCount: sql<number>`COUNT(DISTINCT ${mktAnalytics.channelPostId})`,
      }).from(mktAnalytics)
        .where(and(
          gte(mktAnalytics.capturedAt, input.periodStart),
          lte(mktAnalytics.capturedAt, input.periodEnd + " 23:59:59"),
        ))
        .groupBy(mktAnalytics.platform);

      // AI로 요약 생성
      const apiUrl = "https://api.openai.com/v1/chat/completions";
      const apiKey = process.env.OPENAI_API_KEY;

      let summary = `${input.periodStart} ~ ${input.periodEnd} 기간 마케팅 리포트입니다. 총 ${publishedPosts.length}건 발행.`;
      let highlights: any[] = [];
      let recommendations: any[] = [];

      if (apiUrl && apiKey) {
        try {
          const aiResult = await generateAiReport(apiUrl, apiKey, {
            period: `${input.periodStart} ~ ${input.periodEnd}`,
            totalPosts: publishedPosts.length,
            platformStats,
          });
          summary = aiResult.summary || summary;
          highlights = aiResult.highlights || [];
          recommendations = aiResult.recommendations || [];
        } catch (e) {
          console.warn("[Report] AI 생성 실패:", e);
        }
      }

      // 베스트 콘텐츠 (좋아요 기준 상위 5개)
      const topContent = platformStats.map(ps => ({
        platform: ps.platform,
        views: Number(ps.totalViews),
        likes: Number(ps.totalLikes),
        clicks: Number(ps.totalClicks),
        posts: Number(ps.postCount),
      }));

      const result = await db.insert(mktReports).values({
        userId: ctx.user.id,
        clientId: input.clientId || null,
        brandId: input.brandId || null,
        title: input.title || `마케팅 리포트 (${input.periodStart} ~ ${input.periodEnd})`,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        summary,
        highlights,
        platformBreakdown: platformStats,
        topContent,
        recommendations,
        status: "draft",
      });
      const insertId = Number((result as any)?.[0]?.insertId);
      return { success: true, id: insertId };
    }),

  // 상태 변경
  updateStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["draft", "finalized", "sent"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(mktReports)
        .set({ status: input.status } as any)
        .where(and(eq(mktReports.id, input.id), eq(mktReports.userId, ctx.user.id)));
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(mktReports)
        .where(and(eq(mktReports.id, input.id), eq(mktReports.userId, ctx.user.id)));
      return { success: true };
    }),
});

async function generateAiReport(apiUrl: string, apiKey: string, data: any) {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `마케팅 성과 리포트를 작성하는 전문가입니다. JSON으로 응답하세요:
{
  "summary": "3-5문장 요약",
  "highlights": [{"metric": "지표명", "value": "값", "change": "+15%", "comment": "코멘트"}],
  "recommendations": [{"type": "개선분야", "content": "구체적 추천", "reason": "이유"}]
}`,
        },
        { role: "user", content: `다음 데이터로 마케팅 리포트를 작성해주세요:\n${JSON.stringify(data, null, 2)}` },
      ],
      temperature: 0.7,
      max_tokens: 2000,
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) throw new Error(`AI ${response.status}`);
  const result = await response.json();
  return JSON.parse(result.choices?.[0]?.message?.content || "{}");
}
