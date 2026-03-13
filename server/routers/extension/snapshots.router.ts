/**
 * Extension Sub-Router: 검색 스냅샷 (Search Snapshots)
 */
import { z } from "zod";
import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import { extSearchSnapshots } from "../../../drizzle/schema";
import { eq, and, desc, sql, like } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { N } from "./_helpers";
import { autoComputeKeywordDailyStat, autoMatchTrackedProducts } from "./_autoHelpers";

export const snapshotsRouter = router({
  saveSnapshot: protectedProcedure
    .input(z.object({
      query: z.string().min(1).max(255),
      totalItems: z.number().int().default(0),
      avgPrice: z.number().int().default(0),
      avgRating: z.number().default(0),
      avgReview: z.number().int().default(0),
      highReviewRatio: z.number().int().default(0),
      adCount: z.number().int().default(0),
      competitionScore: z.number().int().default(0),
      competitionLevel: z.enum(["easy", "medium", "hard"]).default("medium"),
      items: z.array(z.any()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      // 같은 사용자 + 같은 검색어가 이미 있으면 업데이트 (중복 방지)
      const [existing] = await db.select({ id: extSearchSnapshots.id })
        .from(extSearchSnapshots)
        .where(and(
          eq(extSearchSnapshots.userId, ctx.user!.id),
          eq(extSearchSnapshots.query, input.query),
        ))
        .orderBy(desc(extSearchSnapshots.createdAt))
        .limit(1);

      if (existing) {
        // 기존 레코드 업데이트
        await db.update(extSearchSnapshots)
          .set({
            totalItems: input.totalItems,
            avgPrice: input.avgPrice,
            avgRating: input.avgRating.toFixed(1),
            avgReview: input.avgReview,
            highReviewRatio: input.highReviewRatio,
            adCount: input.adCount,
            competitionScore: input.competitionScore,
            competitionLevel: input.competitionLevel,
            itemsJson: input.items ? JSON.stringify(input.items) : null,
          })
          .where(eq(extSearchSnapshots.id, existing.id));
        // 자동으로 일별 통계 계산 (비동기, 실패 무시)
        autoComputeKeywordDailyStat(ctx.user!.id, input.query, db).catch(() => {});
        // 추적 상품 자동 매칭 (비동기, 실패 무시)
        autoMatchTrackedProducts(ctx.user!.id, input.query, input.items || [], db).catch(() => {});
        return { success: true, id: existing.id, updated: true };
      }

      // 신규 저장
      const result = await db.insert(extSearchSnapshots).values({
        userId: ctx.user!.id,
        query: input.query,
        totalItems: input.totalItems,
        avgPrice: input.avgPrice,
        avgRating: input.avgRating.toFixed(1),
        avgReview: input.avgReview,
        highReviewRatio: input.highReviewRatio,
        adCount: input.adCount,
        competitionScore: input.competitionScore,
        competitionLevel: input.competitionLevel,
        itemsJson: input.items ? JSON.stringify(input.items) : null,
      });

      // 자동으로 일별 통계 계산 (비동기, 실패 무시)
      autoComputeKeywordDailyStat(ctx.user!.id, input.query, db).catch(() => {});
      // 추적 상품 자동 매칭 (비동기, 실패 무시)
      autoMatchTrackedProducts(ctx.user!.id, input.query, input.items || [], db).catch(() => {});

      return { success: true, id: (result as any)?.[0]?.insertId };
    }),

  // 검색 히스토리 조회
  listSnapshots: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
      query: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const conditions = [eq(extSearchSnapshots.userId, ctx.user!.id)];
      if (input.query) {
        conditions.push(like(extSearchSnapshots.query, `%${input.query}%`));
      }

      const rows = await db.select({
        id: extSearchSnapshots.id,
        query: extSearchSnapshots.query,
        totalItems: extSearchSnapshots.totalItems,
        avgPrice: extSearchSnapshots.avgPrice,
        avgRating: extSearchSnapshots.avgRating,
        avgReview: extSearchSnapshots.avgReview,
        highReviewRatio: extSearchSnapshots.highReviewRatio,
        competitionScore: extSearchSnapshots.competitionScore,
        competitionLevel: extSearchSnapshots.competitionLevel,
        adCount: extSearchSnapshots.adCount,
        createdAt: extSearchSnapshots.createdAt,
      })
        .from(extSearchSnapshots)
        .where(and(...conditions))
        .orderBy(desc(extSearchSnapshots.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return rows;
    }),

  // 특정 스냅샷의 상품 목록 조회
  getSnapshotItems: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [row] = await db.select()
        .from(extSearchSnapshots)
        .where(and(eq(extSearchSnapshots.id, input.id), eq(extSearchSnapshots.userId, ctx.user!.id)))
        .limit(1);

      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      let items: any[] = [];
      try {
        items = row.itemsJson ? JSON.parse(row.itemsJson) : [];
      } catch {
        items = [];
      }
      return {
        ...row,
        items,
      };
    }),

  // 스냅샷 개별 삭제
  deleteSnapshot: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.delete(extSearchSnapshots)
        .where(and(eq(extSearchSnapshots.id, input.id), eq(extSearchSnapshots.userId, ctx.user!.id)));
      return { success: true };
    }),

  // 스냅샷 전체 삭제
  deleteAllSnapshots: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const result = await db.delete(extSearchSnapshots)
        .where(eq(extSearchSnapshots.userId, ctx.user!.id));
      return { success: true };
    }),

  // 검색 통계 요약
  searchStats: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const [stats] = await db.select({
      totalSearches: sql<number>`COUNT(*)`,
      uniqueQueries: sql<number>`COUNT(DISTINCT ${extSearchSnapshots.query})`,
      avgCompetition: sql<number>`ROUND(AVG(${extSearchSnapshots.competitionScore}))`,
      avgPrice: sql<number>`ROUND(AVG(${extSearchSnapshots.avgPrice}))`,
    })
      .from(extSearchSnapshots)
      .where(eq(extSearchSnapshots.userId, ctx.user!.id));

    // 최근 검색어 TOP 10 (빈도순)
    const topQueries = await db.select({
      query: extSearchSnapshots.query,
      count: sql<number>`COUNT(*)`,
      lastSearched: sql<string>`MAX(${extSearchSnapshots.createdAt})`,
      avgCompetition: sql<number>`ROUND(AVG(${extSearchSnapshots.competitionScore}))`,
    })
      .from(extSearchSnapshots)
      .where(eq(extSearchSnapshots.userId, ctx.user!.id))
      .groupBy(extSearchSnapshots.query)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(10);

    return {
      totalSearches: N(stats?.totalSearches),
      uniqueQueries: N(stats?.uniqueQueries),
      avgCompetition: N(stats?.avgCompetition),
      avgPrice: N(stats?.avgPrice),
      topQueries: topQueries.map(q => ({
        ...q,
        count: N(q.count),
        avgCompetition: N(q.avgCompetition),
      })),
    };
  }),
});
