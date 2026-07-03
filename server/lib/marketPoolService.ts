/**
 * ============================================================
 * Market Shared Pool Service
 * ============================================================
 *
 * 전 유저 공유 시장 풀(market_keyword_stats / market_product_stats)을
 * 유저별 수집 데이터에서 병합해 채운다. (길 B — 안전한 추가 방식)
 *
 * 입력(기존, 유저별):
 *   - ext_keyword_daily_stats        키워드 일별 통계 (유저별)
 *   - ext_product_sales_estimates    상품 판매 추정 (유저별)
 *   - ext_product_trackings          추적 상품 메타 (유저별)
 *
 * 출력(신규, 공유):
 *   - market_keyword_stats           정규화 키워드 1행 = 시장 진실
 *   - market_product_stats           키워드별 효자상품
 *
 * 병합 원칙: 같은 정규화 키워드를 검색한 여러 유저의 스냅샷 중
 *   "가장 데이터가 풍부한 대표 스냅샷"(snapshot_count 최대)을 취하고,
 *   contributor_count로 몇 명의 데이터가 모였는지 신뢰도를 남긴다.
 */

import { getDb } from "../db";
import {
  extKeywordDailyStats,
  extProductSalesEstimates,
  extProductTrackings,
  marketKeywordStats,
  marketProductStats,
} from "../../drizzle/schema";
import { gte, sql } from "drizzle-orm";
import { normalizeKeyword } from "./keywordScorer";

function N(v: unknown): number {
  return Number(v) || 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** YYYY-MM-DD (KST) 문자열 — days일 전 */
function dateStrDaysAgo(days: number): string {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // KST
  now.setUTCDate(now.getUTCDate() - days);
  return now.toISOString().slice(0, 10);
}

type Grade = "S_PLUS" | "S" | "A" | "B" | "C";

/** 꿀통 스코어(0~100) + 등급 산정 */
export function computeHoneypot(input: {
  monthlyRevenue: number;
  monthlySales: number;
  topProductReviewCount: number;
  competitionScore: number;
  spikeLevel: string;
}): { score: number; grade: Grade } {
  const revScore = clamp((input.monthlyRevenue / 30_000_000) * 40, 0, 40); // 월 3천만=만점
  const salesScore = clamp((input.monthlySales / 1000) * 20, 0, 20);
  // 효자상품 리뷰가 적을수록 진입 난이도↓ → 가점
  const reviewEase = clamp((1 - input.topProductReviewCount / 1000) * 20, 0, 20);
  const compEase = clamp(((100 - input.competitionScore) / 100) * 15, 0, 15);
  const spikeBonus =
    input.spikeLevel === "surging" || input.spikeLevel === "explosive"
      ? 5
      : input.spikeLevel === "rising"
        ? 3
        : 0;
  const score = Math.round(revScore + salesScore + reviewEase + compEase + spikeBonus);
  const grade: Grade =
    score >= 85 ? "S_PLUS" : score >= 70 ? "S" : score >= 55 ? "A" : score >= 40 ? "B" : "C";
  return { score: clamp(score, 0, 100), grade };
}

export interface RebuildOptions {
  windowDays?: number; // 병합 대상 최근 일수 (기본 21)
}

export interface RebuildResult {
  keywords: number;
  products: number;
  contributors: number;
}

/**
 * 공유 풀 전체 재구성. 배치(batchCollector)나 관리자 트리거에서 호출.
 */
export async function rebuildMarketPool(opts: RebuildOptions = {}): Promise<RebuildResult> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const windowDays = opts.windowDays ?? 21;
  const cutoff = dateStrDaysAgo(windowDays);

  // ===== 1) 키워드 병합 =====
  const rows = await db
    .select()
    .from(extKeywordDailyStats)
    .where(gte(extKeywordDailyStats.statDate, cutoff));

  // 정규화 키워드로 그룹핑
  type Group = {
    keyword: string;
    norm: string;
    rep: (typeof rows)[number]; // 대표 스냅샷(snapshot_count 최대, 동률 시 최신 statDate)
    users: Set<number>;
    sampleSnapshots: number;
  };
  const groups = new Map<string, Group>();

  for (const r of rows) {
    const norm = normalizeKeyword(r.query);
    if (!norm) continue;
    let g = groups.get(norm);
    if (!g) {
      g = { keyword: r.query, norm, rep: r, users: new Set(), sampleSnapshots: 0 };
      groups.set(norm, g);
    }
    g.users.add(N(r.userId));
    g.sampleSnapshots += N(r.snapshotCount);
    const curr = g.rep;
    const better =
      N(r.snapshotCount) > N(curr.snapshotCount) ||
      (N(r.snapshotCount) === N(curr.snapshotCount) && (r.statDate ?? "") > (curr.statDate ?? ""));
    if (better) g.rep = r;
  }

  let contributors = 0;
  for (const g of groups.values()) {
    const rep = g.rep;
    contributors += g.users.size;

    const dailySales = N(rep.salesEstimateMa30) || N(rep.salesEstimate);
    const monthlySales = Math.round(dailySales * 30);
    const avgPrice = N(rep.avgPrice);
    const monthlyRevenue = monthlySales * avgPrice;
    // topProductReviewCount는 상품 병합(2단계) 후 갱신. 우선 avgReview 근사치.
    const topReviewApprox = N(rep.avgReview);
    const { score, grade } = computeHoneypot({
      monthlyRevenue,
      monthlySales,
      topProductReviewCount: topReviewApprox,
      competitionScore: N(rep.competitionScore),
      spikeLevel: rep.spikeLevel ?? "normal",
    });

    await db
      .insert(marketKeywordStats)
      .values({
        keyword: g.keyword,
        normalizedKeyword: g.norm,
        productCount: N(rep.productCount),
        avgPrice,
        totalReviewSum: N(rep.totalReviewSum),
        avgReview: N(rep.avgReview),
        topProductReviewCount: topReviewApprox,
        competitionScore: N(rep.competitionScore),
        competitionLevel: (rep.competitionLevel ?? "medium") as "easy" | "medium" | "hard",
        rocketCount: N(rep.rocketCount),
        salesEstimateDaily: dailySales,
        monthlySales,
        monthlyRevenue: String(monthlyRevenue),
        keywordScore: N(rep.keywordScore),
        demandScore: N(rep.demandScore),
        honeypotScore: score,
        grade,
        spikeLevel: rep.spikeLevel ?? "normal",
        contributorCount: g.users.size,
        sampleSnapshotCount: g.sampleSnapshots,
        lastObservedDate: rep.statDate,
      })
      .onDuplicateKeyUpdate({
        set: {
          keyword: g.keyword,
          productCount: N(rep.productCount),
          avgPrice,
          totalReviewSum: N(rep.totalReviewSum),
          avgReview: N(rep.avgReview),
          topProductReviewCount: topReviewApprox,
          competitionScore: N(rep.competitionScore),
          competitionLevel: (rep.competitionLevel ?? "medium") as "easy" | "medium" | "hard",
          rocketCount: N(rep.rocketCount),
          salesEstimateDaily: dailySales,
          monthlySales,
          monthlyRevenue: String(monthlyRevenue),
          keywordScore: N(rep.keywordScore),
          demandScore: N(rep.demandScore),
          honeypotScore: score,
          grade,
          spikeLevel: rep.spikeLevel ?? "normal",
          contributorCount: g.users.size,
          sampleSnapshotCount: g.sampleSnapshots,
          lastObservedDate: rep.statDate,
        },
      });
  }

  // ===== 2) 효자상품 병합 =====
  const productCount = await rebuildProductPool(db, cutoff);

  return { keywords: groups.size, products: productCount, contributors };
}

/**
 * 효자상품 병합: ext_product_sales_estimates + ext_product_trackings 조인.
 * 상품→키워드 연결은 trackings.latestRankKeyword 기준(정규화).
 */
async function rebuildProductPool(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  cutoff: string
): Promise<number> {
  const est = await db
    .select({
      trackingId: extProductSalesEstimates.trackingId,
      estimateDate: extProductSalesEstimates.estimateDate,
      currentPrice: extProductSalesEstimates.currentPrice,
      currentReviewCount: extProductSalesEstimates.currentReviewCount,
      currentRating: extProductSalesEstimates.currentRating,
      estimatedMonthlySales: extProductSalesEstimates.estimatedMonthlySales,
      estimatedMonthlyRevenue: extProductSalesEstimates.estimatedMonthlyRevenue,
      salesGrade: extProductSalesEstimates.salesGrade,
      coupangProductId: extProductTrackings.coupangProductId,
      productName: extProductTrackings.productName,
      latestRankKeyword: extProductTrackings.latestRankKeyword,
    })
    .from(extProductSalesEstimates)
    .innerJoin(
      extProductTrackings,
      sql`${extProductSalesEstimates.trackingId} = ${extProductTrackings.id}`
    )
    .where(gte(extProductSalesEstimates.estimateDate, cutoff));

  // (정규화키워드, coupangProductId) 단위로 최신 추정만 유지
  type P = {
    norm: string;
    productId: string;
    row: (typeof est)[number];
  };
  const best = new Map<string, P>();
  for (const e of est) {
    if (!e.latestRankKeyword || !e.coupangProductId) continue;
    const norm = normalizeKeyword(e.latestRankKeyword);
    if (!norm) continue;
    const key = `${norm}::${e.coupangProductId}`;
    const prev = best.get(key);
    if (!prev || (e.estimateDate ?? "") > (prev.row.estimateDate ?? "")) {
      best.set(key, { norm, productId: e.coupangProductId, row: e });
    }
  }

  // 키워드별 매출 순위 매기기
  const byKeyword = new Map<string, P[]>();
  for (const p of best.values()) {
    const arr = byKeyword.get(p.norm) ?? [];
    arr.push(p);
    byKeyword.set(p.norm, arr);
  }

  let count = 0;
  for (const [norm, arr] of byKeyword) {
    arr.sort((a, b) => N(b.row.estimatedMonthlyRevenue) - N(a.row.estimatedMonthlyRevenue));
    let topReview = 0;
    let idx = 0;
    for (const p of arr) {
      idx += 1;
      const r = p.row;
      if (idx === 1) topReview = N(r.currentReviewCount);
      const vals = {
        normalizedKeyword: norm,
        coupangProductId: p.productId,
        productName: r.productName,
        price: N(r.currentPrice),
        reviewCount: N(r.currentReviewCount),
        rating: String(N(r.currentRating)),
        estMonthlySales: Math.round(N(r.estimatedMonthlySales)),
        estMonthlyRevenue: String(Math.round(N(r.estimatedMonthlyRevenue))),
        salesGrade: (r.salesGrade ?? "MEDIUM") as
          | "VERY_LOW"
          | "LOW"
          | "MEDIUM"
          | "HIGH"
          | "VERY_HIGH",
        rankInKeyword: idx,
        lastObservedDate: r.estimateDate,
      };
      await db.insert(marketProductStats).values(vals).onDuplicateKeyUpdate({ set: vals });
      count += 1;
    }

    // 키워드의 효자상품(매출1위) 리뷰수로 topProductReviewCount 갱신
    // (maxReview 슬라이더 필터가 이 값을 기준으로 동작)
    if (arr.length) {
      await db
        .update(marketKeywordStats)
        .set({ topProductReviewCount: topReview })
        .where(sql`${marketKeywordStats.normalizedKeyword} = ${norm}`);
    }
  }

  return count;
}
