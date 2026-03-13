/**
 * Extension Sub-Router: WING 인기상품 (Wing Popular Products)
 */
import { z } from "zod";
import { protectedProcedure, router } from "../../_core/trpc";
import { getDb } from "../../db";
import { extWingSearches } from "../../../drizzle/schema";
import { eq, and, desc, sql, asc, like, ne, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { N } from "./_helpers";

export const wingRouter = router({
  saveWingSearch: protectedProcedure
    .input(z.object({
      keyword: z.string().max(255).default(""),
      category: z.string().max(255).default(""),
      totalItems: z.number().int().default(0),
      avgPrice: z.number().int().default(0),
      avgRating: z.number().default(0),
      avgReview: z.number().int().default(0),
      source: z.string().max(50).default("unknown"),
      pageUrl: z.string().optional(),
      items: z.array(z.any()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      // 같은 키워드+카테고리가 이미 있으면 업데이트
      const [existing] = await db.select({ id: extWingSearches.id })
        .from(extWingSearches)
        .where(and(
          eq(extWingSearches.userId, ctx.user!.id),
          eq(extWingSearches.keyword, input.keyword || ""),
          eq(extWingSearches.category, input.category || ""),
        ))
        .orderBy(desc(extWingSearches.createdAt))
        .limit(1);

      const itemsJson = input.items ? JSON.stringify(input.items) : null;

      if (existing) {
        await db.update(extWingSearches)
          .set({
            totalItems: input.totalItems,
            avgPrice: input.avgPrice,
            avgRating: input.avgRating.toFixed(1),
            avgReview: input.avgReview,
            source: input.source,
            pageUrl: input.pageUrl || null,
            itemsJson,
          })
          .where(eq(extWingSearches.id, existing.id));
        return { success: true, id: existing.id, updated: true };
      }

      const [result] = await db.insert(extWingSearches).values({
        userId: ctx.user!.id,
        keyword: input.keyword || "",
        category: input.category || "",
        totalItems: input.totalItems,
        avgPrice: input.avgPrice,
        avgRating: input.avgRating.toFixed(1),
        avgReview: input.avgReview,
        source: input.source,
        pageUrl: input.pageUrl || null,
        itemsJson,
      });
      return { success: true, id: result.insertId, updated: false };
    }),

  // WING 검색 목록 조회
  listWingSearches: protectedProcedure
    .input(z.object({
      keyword: z.string().optional(),
      category: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(20),
    }).optional().default({ limit: 20 }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      let conditions = [eq(extWingSearches.userId, ctx.user!.id)];
      if (input.keyword) {
        conditions.push(like(extWingSearches.keyword, `%${input.keyword}%`));
      }
      if (input.category) {
        conditions.push(eq(extWingSearches.category, input.category));
      }

      const rows = await db.select()
        .from(extWingSearches)
        .where(and(...conditions))
        .orderBy(desc(extWingSearches.createdAt))
        .limit(input.limit);

      return rows.map(row => {
        let items: any[] = [];
        if (row.itemsJson) {
          try { items = JSON.parse(row.itemsJson); } catch { items = []; }
        }
        return {
          ...row,
          items,
          itemsJson: undefined,
        };
      });
    }),

  // WING 검색 통계
  wingStats: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      // 기본 통계
      const [stats] = await db.select({
        totalSearches: sql<number>`COUNT(*)`,
        uniqueKeywords: sql<number>`COUNT(DISTINCT keyword)`,
        uniqueCategories: sql<number>`COUNT(DISTINCT category)`,
        avgPrice: sql<number>`ROUND(AVG(avg_price))`,
        avgRating: sql<number>`ROUND(AVG(avg_rating), 1)`,
        totalProducts: sql<number>`SUM(total_items)`,
      })
        .from(extWingSearches)
        .where(eq(extWingSearches.userId, ctx.user!.id));

      // TOP 키워드
      const topKeywords = await db.select({
        keyword: extWingSearches.keyword,
        count: sql<number>`COUNT(*)`,
        avgPrice: sql<number>`ROUND(AVG(avg_price))`,
        avgItems: sql<number>`ROUND(AVG(total_items))`,
      })
        .from(extWingSearches)
        .where(and(
          eq(extWingSearches.userId, ctx.user!.id),
          ne(extWingSearches.keyword, ""),
        ))
        .groupBy(extWingSearches.keyword)
        .orderBy(desc(sql`COUNT(*)`))
        .limit(10);

      // 카테고리별 분포
      const categories = await db.select({
        category: extWingSearches.category,
        count: sql<number>`COUNT(*)`,
        avgPrice: sql<number>`ROUND(AVG(avg_price))`,
      })
        .from(extWingSearches)
        .where(and(
          eq(extWingSearches.userId, ctx.user!.id),
          ne(extWingSearches.category, ""),
        ))
        .groupBy(extWingSearches.category)
        .orderBy(desc(sql`COUNT(*)`))
        .limit(10);

      // 최근 7일 일별 검색 수
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const dailySearches = await db.select({
        date: sql<string>`DATE(created_at)`,
        count: sql<number>`COUNT(*)`,
        totalProducts: sql<number>`SUM(total_items)`,
      })
        .from(extWingSearches)
        .where(and(
          eq(extWingSearches.userId, ctx.user!.id),
          gte(extWingSearches.createdAt, sevenDaysAgo.toISOString().slice(0, 19).replace("T", " ")),
        ))
        .groupBy(sql`DATE(created_at)`)
        .orderBy(asc(sql`DATE(created_at)`));

      return {
        totalSearches: N(stats?.totalSearches),
        uniqueKeywords: N(stats?.uniqueKeywords),
        uniqueCategories: N(stats?.uniqueCategories),
        avgPrice: N(stats?.avgPrice),
        avgRating: N(stats?.avgRating),
        totalProducts: N(stats?.totalProducts),
        topKeywords: topKeywords.map(k => ({
          ...k,
          count: N(k.count),
          avgPrice: N(k.avgPrice),
          avgItems: N(k.avgItems),
        })),
        categories: categories.map(c => ({
          ...c,
          count: N(c.count),
          avgPrice: N(c.avgPrice),
        })),
        dailySearches: dailySearches.map(d => ({
          ...d,
          count: N(d.count),
          totalProducts: N(d.totalProducts),
        })),
      };
    }),

  // WING 검색 삭제
  deleteWingSearch: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      await db.delete(extWingSearches)
        .where(and(
          eq(extWingSearches.id, input.id),
          eq(extWingSearches.userId, ctx.user!.id),
        ));
      return { success: true };
    }),

  // WING 검색 전체 삭제
  deleteAllWingSearches: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 연결 실패" });

      await db.delete(extWingSearches)
        .where(eq(extWingSearches.userId, ctx.user!.id));
      return { success: true };
    }),

});
