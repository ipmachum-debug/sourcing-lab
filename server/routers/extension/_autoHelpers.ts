/**
 * Extension 자동 처리 헬퍼 함수
 * autoComputeKeywordDailyStat, autoMatchTrackedProducts
 *
 * ★ v7.6.0: 정규화/판매추정은 단일 서비스(rebuildKeywordDailyStatsForKeyword)로 위임.
 * ★ v8.5.9: 디바운스 + lightMode로 이벤트 루프 차단 최소화.
 */
import { getDb } from "../../db";
import {
  extSearchSnapshots, extKeywordDailyStats,
  extProductTrackings, extProductDailySnapshots,
} from "../../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { rebuildKeywordDailyStatsForKeyword } from "../../lib/keywordDailyStatsService";

// ★ v8.5.9: 디바운스 — 동일 키워드에 대해 60초 이내 중복 rebuildStats 방지
const recentRebuildMap = new Map<string, number>(); // "userId:keyword" → timestamp
const REBUILD_DEBOUNCE_MS = 60_000; // 60초

// 메모리 누수 방지: 5분마다 만료된 엔트리 정리
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of recentRebuildMap) {
    if (now - ts > REBUILD_DEBOUNCE_MS * 2) recentRebuildMap.delete(key);
  }
}, 300_000);

/**
 * 스냅샷 저장/업데이트 후 호출.
 * ext_keyword_daily_stats를 단일 서비스로 재계산.
 * ★ v8.5.9: lightMode + 디바운스 적용
 */
export async function autoComputeKeywordDailyStat(userId: number, query: string, db: any) {
  try {
    const key = `${userId}:${query}`;
    const lastRun = recentRebuildMap.get(key);
    if (lastRun && Date.now() - lastRun < REBUILD_DEBOUNCE_MS) {
      return; // 60초 이내 중복 → 스킵
    }
    recentRebuildMap.set(key, Date.now());
    await rebuildKeywordDailyStatsForKeyword(db, userId, query, { lightMode: true });
  } catch (err) {
    console.error("[autoComputeKeywordDailyStat]", err);
  }
}

// ============================================================
//  추적 상품 자동 매칭 (검색 시 유사상품/경쟁자 자동 수집)
// ============================================================

export async function autoMatchTrackedProducts(userId: number, query: string, items: any[], db: any) {
  try {
    if (!items.length) return;

    // 이 키워드와 관련된 추적 상품 찾기
    const trackings = await db.select()
      .from(extProductTrackings)
      .where(and(
        eq(extProductTrackings.userId, userId),
        eq(extProductTrackings.isActive, true),
      ));

    for (const tracking of trackings) {
      const keywords: string[] = tracking.keywords ? JSON.parse(tracking.keywords) : [];
      // 검색어가 추적 상품의 키워드와 매칭되는지 확인
      const isMatch = keywords.some((kw: string) =>
        kw === query || query.includes(kw) || kw.includes(query)
      );
      if (!isMatch) continue;

      // 추적 상품이 검색 결과에 있는지 확인 (coupangProductId로 매칭)
      let myProduct = null;
      let myRank = 0;
      if (tracking.coupangProductId) {
        const idx = items.findIndex((item: any) =>
          String(item.productId) === String(tracking.coupangProductId)
        );
        if (idx >= 0) {
          myProduct = items[idx];
          myRank = idx + 1;
        }
      }

      // 유사 상품 (검색 결과의 상위 상품 중 추적 상품이 아닌 것들)
      const similarProducts = items
        .filter((item: any) => String(item.productId) !== String(tracking.coupangProductId))
        .slice(0, 10)
        .map((item: any, idx: number) => ({
          productId: item.productId,
          title: (item.title || "").slice(0, 80),
          price: item.price || 0,
          rating: item.rating || 0,
          reviewCount: item.reviewCount || 0,
          rank: idx + 1,
          isAd: !!item.isAd,
          isRocket: !!item.isRocket,
        }));

      // 경쟁자 요약
      const competitorSummary = {
        totalCompetitors: items.length,
        avgPrice: Math.round(items.reduce((s: number, i: any) => s + (i.price || 0), 0) / items.length),
        avgReview: Math.round(items.reduce((s: number, i: any) => s + (i.reviewCount || 0), 0) / items.length),
        adCount: items.filter((i: any) => i.isAd).length,
        rocketCount: items.filter((i: any) => i.isRocket).length,
        keyword: query,
        capturedAt: new Date().toISOString(),
      };

      // 추적 데이터 업데이트
      const updateData: any = {
        similarProductsJson: JSON.stringify(similarProducts),
        competitorSummaryJson: JSON.stringify(competitorSummary),
        competitorCount: items.length,
        lastTrackedAt: sql`NOW()`,
      };

      if (myProduct) {
        const oldPrice = tracking.latestPrice || 0;
        const oldReview = tracking.latestReviewCount || 0;
        const oldRank = tracking.latestRank || 0;

        updateData.latestPrice = myProduct.price || 0;
        updateData.latestRating = (myProduct.rating || 0).toFixed ? (myProduct.rating || 0).toFixed(1) : "0";
        updateData.latestReviewCount = myProduct.reviewCount || 0;
        updateData.latestRank = myRank;
        updateData.latestRankKeyword = query;
        updateData.priceChange = (myProduct.price || 0) - oldPrice;
        updateData.reviewChange = (myProduct.reviewCount || 0) - oldReview;
        updateData.rankChange = oldRank > 0 ? oldRank - myRank : 0;
      }

      await db.update(extProductTrackings)
        .set(updateData)
        .where(eq(extProductTrackings.id, tracking.id));

      // 일일 스냅샷 upsert
      const today = new Date();
      today.setHours(today.getHours() + 9);
      const todayStr = today.toISOString().slice(0, 10);

      const [existingSnap] = await db.select({ id: extProductDailySnapshots.id })
        .from(extProductDailySnapshots)
        .where(and(
          eq(extProductDailySnapshots.trackingId, tracking.id),
          eq(extProductDailySnapshots.snapshotDate, todayStr),
        )).limit(1);

      const snapData = {
        price: myProduct?.price || tracking.latestPrice || 0,
        rating: myProduct ? (myProduct.rating || 0).toFixed(1) : (tracking.latestRating || "0"),
        reviewCount: myProduct?.reviewCount || tracking.latestReviewCount || 0,
        rankPosition: myRank || tracking.latestRank || 0,
        rankKeyword: query,
        competitorCount: items.length,
        similarAvgPrice: competitorSummary.avgPrice,
        similarAvgReview: competitorSummary.avgReview,
        adCount: competitorSummary.adCount,
      };

      if (existingSnap) {
        await db.update(extProductDailySnapshots).set(snapData)
          .where(eq(extProductDailySnapshots.id, existingSnap.id));
      } else {
        await db.insert(extProductDailySnapshots).values({
          userId,
          trackingId: tracking.id,
          snapshotDate: todayStr,
          ...snapData,
        });
      }
    }
  } catch (err) {
    console.error("[autoMatchTrackedProducts]", err);
  }
}
