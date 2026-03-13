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
      // v8.0: 셀러라이프 수준 시장 데이터
      totalProductCount: z.number().int().default(0),
      minPrice: z.number().int().default(0),
      maxPrice: z.number().int().default(0),
      medianPrice: z.number().int().default(0),
      totalReviewSum: z.number().int().default(0),
      maxReviewCount: z.number().int().default(0),
      minReviewCount: z.number().int().default(0),
      rocketCount: z.number().int().default(0),
      sellerRocketCount: z.number().int().default(0),
      globalRocketCount: z.number().int().default(0),
      normalDeliveryCount: z.number().int().default(0),
      overseasDeliveryCount: z.number().int().default(0),
      priceDistribution: z.array(z.any()).optional(),
      reviewDistribution: z.array(z.any()).optional(),
      highReviewCount: z.number().int().default(0),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      // ★ v7.6.0: 스냅샷을 덮어쓰지 않고 하루 최대 3개 보존 (원본 데이터 보존)
      const today = new Date();
      today.setHours(today.getHours() + 9);
      const todayStr = today.toISOString().slice(0, 10);

      const todaySnaps = await db.select({ id: extSearchSnapshots.id })
        .from(extSearchSnapshots)
        .where(and(
          eq(extSearchSnapshots.userId, ctx.user!.id),
          eq(extSearchSnapshots.query, input.query),
          sql`DATE(${extSearchSnapshots.createdAt}) = ${todayStr}`,
        ))
        .orderBy(desc(extSearchSnapshots.createdAt));

      const snapData = {
        totalItems: input.totalItems,
        avgPrice: input.avgPrice,
        avgRating: input.avgRating.toFixed(1),
        avgReview: input.avgReview,
        highReviewRatio: input.highReviewRatio,
        adCount: input.adCount,
        competitionScore: input.competitionScore,
        competitionLevel: input.competitionLevel,
        itemsJson: input.items ? JSON.stringify(input.items) : null,
        // v8.0: 확장 시장 데이터
        totalProductCount: input.totalProductCount,
        minPrice: input.minPrice,
        maxPrice: input.maxPrice,
        medianPrice: input.medianPrice,
        totalReviewSum: input.totalReviewSum,
        maxReviewCount: input.maxReviewCount,
        minReviewCount: input.minReviewCount,
        avgRatingAll: input.avgRating.toFixed(2),
        rocketCount: input.rocketCount,
        sellerRocketCount: input.sellerRocketCount,
        globalRocketCount: input.globalRocketCount,
        normalDeliveryCount: input.normalDeliveryCount,
        overseasDeliveryCount: input.overseasDeliveryCount,
        priceDistributionJson: input.priceDistribution || null,
        reviewDistributionJson: input.reviewDistribution || null,
        highReviewCount: input.highReviewCount,
      };

      let resultId: number | undefined;

      if (todaySnaps.length >= 3) {
        // 하루 3개 초과 시 가장 오래된 것 업데이트 (원본 최대 3개 보존)
        const oldestId = todaySnaps[todaySnaps.length - 1].id;
        await db.update(extSearchSnapshots).set(snapData)
          .where(eq(extSearchSnapshots.id, oldestId));
        resultId = oldestId;
      } else {
        // 3개 미만이면 새로 추가 (원본 보존)
        const result = await db.insert(extSearchSnapshots).values({
          userId: ctx.user!.id,
          query: input.query,
          ...snapData,
        });
        resultId = (result as any)?.[0]?.insertId;
      }

      // 자동으로 일별 통계 계산 (비동기, 실패 무시)
      autoComputeKeywordDailyStat(ctx.user!.id, input.query, db).catch(() => {});
      // 추적 상품 자동 매칭 (비동기, 실패 무시)
      autoMatchTrackedProducts(ctx.user!.id, input.query, input.items || [], db).catch(() => {});

      return { success: true, id: resultId };
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
