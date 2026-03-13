/**
 * Extension 자동 처리 헬퍼 함수
 * autoComputeKeywordDailyStat, autoMatchTrackedProducts
 */
import { getDb } from "../../db";
import {
  extSearchSnapshots, extKeywordDailyStats,
  extProductTrackings, extProductDailySnapshots,
} from "../../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { N } from "./_helpers";

export async function autoComputeKeywordDailyStat(userId: number, query: string, db: any) {
  try {
    const today = new Date();
    today.setHours(today.getHours() + 9);
    const todayStr = today.toISOString().slice(0, 10);

    // ★ v7.3.3: 최근 스냅샷 중 가장 완전한 데이터(totalReviewSum 최대) 선택
    const recentSnapshots = await db.select()
      .from(extSearchSnapshots)
      .where(and(eq(extSearchSnapshots.userId, userId), eq(extSearchSnapshots.query, query)))
      .orderBy(desc(extSearchSnapshots.createdAt))
      .limit(5);

    if (!recentSnapshots.length) return;

    let bestSnapshot = recentSnapshots[0];
    let bestItems: any[] = [];
    let bestTotalReviewSum = 0;

    for (const snap of recentSnapshots) {
      let snapItems: any[] = [];
      try { snapItems = snap.itemsJson ? JSON.parse(snap.itemsJson) : []; } catch { snapItems = []; }
      const snapReviewSum = snapItems.reduce((sum: number, i: any) => sum + (i.reviewCount || 0), 0);
      if (snapReviewSum > bestTotalReviewSum) {
        bestTotalReviewSum = snapReviewSum;
        bestSnapshot = snap;
        bestItems = snapItems;
      }
    }

    const latest = bestSnapshot;
    const items = bestItems;
    const totalReviewSum = bestTotalReviewSum;

    const adCount = items.filter((i: any) => i.isAd).length;
    const rocketCount = items.filter((i: any) => i.isRocket).length;
    const highReviewCount = items.filter((i: any) => (i.reviewCount || 0) >= 100).length;
    const adRatio = items.length ? Math.round((adCount / items.length) * 100) : 0;

    // ★ v7.4.0: 유효한 기준점(baseline) 기반 리뷰 증가 계산
    // - 리뷰 파싱 실패(totalReviewSum=0 && items>0)인 날은 기준점에서 제외
    // - 유효한 첫 기준점부터 증가분만 계산
    // - 중간에 파싱 실패한 날이 있으면 경과일수로 나눠 일평균 증가로 산출

    // 최근 14일 이내 과거 daily_stats 데이터 조회
    const recentHistory = await db.select({
      statDate: extKeywordDailyStats.statDate,
      totalReviewSum: extKeywordDailyStats.totalReviewSum,
      productCount: extKeywordDailyStats.productCount,
      avgPrice: extKeywordDailyStats.avgPrice,
    })
      .from(extKeywordDailyStats)
      .where(and(
        eq(extKeywordDailyStats.userId, userId),
        eq(extKeywordDailyStats.query, query),
        sql`${extKeywordDailyStats.statDate} < ${todayStr}`,
        sql`${extKeywordDailyStats.statDate} >= DATE_SUB(${todayStr}, INTERVAL 14 DAY)`,
      ))
      .orderBy(desc(extKeywordDailyStats.statDate))
      .limit(14);

    // 리뷰 데이터 유효성 판별: totalReviewSum > 0 이어야 함
    const isReviewDataValid = (reviewSum: number, itemCount: number): boolean =>
      reviewSum > 0 || itemCount === 0;

    const todayReviewValid = isReviewDataValid(totalReviewSum, items.length);

    // 유효한 가장 최근 기준점 찾기
    let baselineEntry: { statDate: string; totalReviewSum: number; avgPrice: number; productCount: number } | null = null;
    let daysSinceBaseline = 0;

    for (const entry of recentHistory) {
      const entryReviewSum = N(entry.totalReviewSum);
      const entryProductCount = N(entry.productCount);
      if (isReviewDataValid(entryReviewSum, entryProductCount) && String(entry.statDate) !== todayStr) {
        baselineEntry = {
          statDate: String(entry.statDate),
          totalReviewSum: entryReviewSum,
          avgPrice: N(entry.avgPrice),
          productCount: entryProductCount,
        };
        const baseDate = new Date(baselineEntry.statDate + "T00:00:00");
        const currentDate = new Date(todayStr + "T00:00:00");
        daysSinceBaseline = Math.max(1, Math.round(
          (currentDate.getTime() - baseDate.getTime()) / (24 * 60 * 60 * 1000),
        ));
        break;
      }
    }

    // 스냅샷 fallback: daily_stats에 유효 기준점 없으면 이전 스냅샷 확인
    if (!baselineEntry) {
      const prevSnapshots = await db.select()
        .from(extSearchSnapshots)
        .where(and(
          eq(extSearchSnapshots.userId, userId),
          eq(extSearchSnapshots.query, query),
          sql`${extSearchSnapshots.id} < ${latest.id}`,
        ))
        .orderBy(desc(extSearchSnapshots.createdAt))
        .limit(5);

      for (const snap of prevSnapshots) {
        let snapItems: any[] = [];
        try { snapItems = snap.itemsJson ? JSON.parse(snap.itemsJson) : []; } catch { snapItems = []; }
        const snapReviewSum = snapItems.reduce((sum: number, i: any) => sum + (i.reviewCount || 0), 0);
        if (isReviewDataValid(snapReviewSum, snapItems.length)) {
          const snapDate = snap.createdAt ? String(snap.createdAt).slice(0, 10) : null;
          if (snapDate && snapDate !== todayStr) {
            baselineEntry = {
              statDate: snapDate,
              totalReviewSum: snapReviewSum,
              avgPrice: snap.avgPrice || 0,
              productCount: snap.totalItems || 0,
            };
            const baseDate = new Date(snapDate + "T00:00:00");
            const currentDate = new Date(todayStr + "T00:00:00");
            daysSinceBaseline = Math.max(1, Math.round(
              (currentDate.getTime() - baseDate.getTime()) / (24 * 60 * 60 * 1000),
            ));
            break;
          }
        }
      }
    }

    let reviewGrowth = 0;
    let priceChange = 0;
    let productCountChange = 0;

    if (todayReviewValid && baselineEntry) {
      // ★ v7.5.0: 제품 수 변동 정규화 — 제품당 평균 리뷰 기반 성장 계산
      // 크롤링 시 제품 수가 달라지면 totalReviewSum도 변동하므로
      // 제품당 평균 리뷰로 정규화 후 보수적(min) 제품 수에 곱해 성장 산출
      const avgReviewToday = totalReviewSum / Math.max(1, items.length);
      const avgReviewBaseline = baselineEntry.totalReviewSum / Math.max(1, baselineEntry.productCount);
      const growthPerProduct = avgReviewToday - avgReviewBaseline;
      const referenceCount = Math.min(items.length, baselineEntry.productCount);
      const normalizedGrowth = Math.round(growthPerProduct * referenceCount);

      if (normalizedGrowth >= 0) {
        // 경과일수로 나눠 일평균 증가분 산출
        reviewGrowth = daysSinceBaseline > 1
          ? Math.round(normalizedGrowth / daysSinceBaseline)
          : normalizedGrowth;
      }
      // 음수면 0 유지 (수집 편차)
      priceChange = (latest.avgPrice || 0) - baselineEntry.avgPrice;
      productCountChange = (latest.totalItems || 0) - baselineEntry.productCount;
    } else if (!todayReviewValid) {
      // 오늘 리뷰 파싱 실패 → 증가 0 (잘못된 데이터로 계산하지 않음)
      reviewGrowth = 0;
    }

    const salesEstimate = reviewGrowth * 20;

    // ★ 개선: 수요 점수 — 성장 데이터 + 절대값 기반 기본 점수 병합
    let demandScore = 0;
    if (salesEstimate > 500) demandScore = 90;
    else if (salesEstimate > 200) demandScore = 75;
    else if (salesEstimate > 100) demandScore = 60;
    else if (salesEstimate > 50) demandScore = 45;
    else if (salesEstimate > 20) demandScore = 30;
    else if (salesEstimate > 5) demandScore = 15;
    else if (reviewGrowth > 0) demandScore = 10;

    // (B) 절대값 기반 기본 수요 점수 (이전 데이터 없어서 성장 계산 불가 시 보완)
    if (demandScore === 0 && items.length > 0) {
      let baselineDemand = 0;
      const avgReviewCount = totalReviewSum / Math.max(1, items.length);
      if (avgReviewCount > 500) baselineDemand += 25;
      else if (avgReviewCount > 200) baselineDemand += 20;
      else if (avgReviewCount > 100) baselineDemand += 15;
      else if (avgReviewCount > 50) baselineDemand += 10;
      else if (avgReviewCount > 20) baselineDemand += 5;
      if (items.length >= 30) baselineDemand += 10;
      else if (items.length >= 20) baselineDemand += 5;
      const rocketRatio = items.length ? rocketCount / items.length : 0;
      if (rocketRatio > 0.5) baselineDemand += 10;
      else if (rocketRatio > 0.3) baselineDemand += 5;
      demandScore = Math.min(50, baselineDemand);
    }

    // ★ v7.2.7 수정: 키워드 점수 — 정규화된 지표 합산 (100점 만점)
    // 각 지표를 0~1 범위로 정규화 후 가중합산
    const avgReviewPerProduct = items.length > 0 ? totalReviewSum / items.length : 0;
    const competitionFactor = Math.max(0, 100 - (latest.competitionScore || 0)) / 100;
    
    // 리뷰 증가 점수 (0~25점) - reviewGrowth 기반
    let reviewGrowthScore = 0;
    if (reviewGrowth >= 100) reviewGrowthScore = 25;
    else if (reviewGrowth >= 50) reviewGrowthScore = 20;
    else if (reviewGrowth >= 20) reviewGrowthScore = 15;
    else if (reviewGrowth >= 10) reviewGrowthScore = 10;
    else if (reviewGrowth >= 5) reviewGrowthScore = 7;
    else if (reviewGrowth > 0) reviewGrowthScore = 3;
    
    // 시장 규모 점수 (0~25점) - 평균 리뷰 수 기반
    let marketSizeScore = 0;
    if (avgReviewPerProduct >= 500) marketSizeScore = 25;
    else if (avgReviewPerProduct >= 200) marketSizeScore = 20;
    else if (avgReviewPerProduct >= 100) marketSizeScore = 15;
    else if (avgReviewPerProduct >= 50) marketSizeScore = 10;
    else if (avgReviewPerProduct >= 20) marketSizeScore = 5;
    
    // 경쟁 용이성 점수 (0~25점) - 낮은 경쟁 + 낮은 광고 비율
    const competitionEaseScore = Math.round(competitionFactor * 15 + (1 - adRatio / 100) * 10);
    
    // 수요 점수 (0~25점) - demandScore 기반 
    const demandPart = Math.round(demandScore * 0.25);
    
    const keywordScore = Math.min(100, reviewGrowthScore + marketSizeScore + competitionEaseScore + demandPart);

    // upsert
    const [existing] = await db.select({ id: extKeywordDailyStats.id })
      .from(extKeywordDailyStats)
      .where(and(
        eq(extKeywordDailyStats.userId, userId),
        eq(extKeywordDailyStats.query, query),
        eq(extKeywordDailyStats.statDate, todayStr),
      ))
      .limit(1);

    const statData = {
      snapshotCount: 1,
      productCount: latest.totalItems || 0,
      avgPrice: latest.avgPrice || 0,
      avgRating: latest.avgRating || "0",
      avgReview: latest.avgReview || 0,
      totalReviewSum,
      adCount,
      adRatio,
      rocketCount,
      highReviewCount,
      competitionScore: latest.competitionScore || 0,
      competitionLevel: (latest.competitionLevel || "medium") as "easy" | "medium" | "hard",
      reviewGrowth,
      salesEstimate,
      priceChange,
      productCountChange,
      demandScore,
      keywordScore,
    };

    if (existing) {
      await db.update(extKeywordDailyStats).set(statData).where(eq(extKeywordDailyStats.id, existing.id));
    } else {
      await db.insert(extKeywordDailyStats).values({ userId, query, statDate: todayStr, ...statData });
    }
    console.log(`[autoComputeKeywordDailyStat] "${query}" rGrowth:${reviewGrowth} sales:${salesEstimate} demand:${demandScore} kwScore:${keywordScore}`);
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
