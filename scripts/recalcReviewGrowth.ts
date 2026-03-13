/**
 * 리뷰 증가량 일괄 재계산 스크립트
 */
import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

function N(v: any): number { return Number(v) || 0; }

function calcDemandScore(salesEstimate: number, reviewGrowth: number): number {
  if (salesEstimate > 500) return 90;
  if (salesEstimate > 200) return 75;
  if (salesEstimate > 100) return 60;
  if (salesEstimate > 50) return 45;
  if (salesEstimate > 20) return 30;
  if (salesEstimate > 5) return 15;
  if (reviewGrowth > 0) return 10;
  return 0;
}

function calcKeywordScore(reviewGrowth: number, productCount: number, competitionScore: number, demandScore: number): number {
  let rg = 0;
  if (reviewGrowth >= 100) rg = 25;
  else if (reviewGrowth >= 50) rg = 20;
  else if (reviewGrowth >= 20) rg = 15;
  else if (reviewGrowth >= 10) rg = 10;
  else if (reviewGrowth >= 5) rg = 7;
  else if (reviewGrowth > 0) rg = 3;

  let ms = 0;
  if (productCount >= 100) ms = 10;
  else if (productCount >= 50) ms = 8;
  else if (productCount >= 20) ms = 5;

  let ce = 0;
  if (competitionScore <= 30) ce = 20;
  else if (competitionScore <= 50) ce = 15;
  else if (competitionScore <= 70) ce = 10;
  else ce = 5;

  return Math.min(100, rg + ms + ce + Math.round(demandScore * 0.45));
}

async function main() {
  console.log("=== 리뷰 증가량 재계산 시작 ===");
  const db = await getDb();
  if (!db) { console.error("DB 연결 실패"); process.exit(1); }

  const [keywords] = await db.execute(sql`
    SELECT DISTINCT user_id, query FROM ext_keyword_daily_stats ORDER BY user_id, query
  `) as any;
  console.log(`총 ${keywords.length}개 키워드 처리`);

  let totalUpdated = 0, totalZeroed = 0, totalRecalculated = 0;

  for (const kw of keywords) {
    const [dailyRows] = await db.execute(sql`
      SELECT id, stat_date, product_count, total_review_sum, review_growth, sales_estimate, competition_score
      FROM ext_keyword_daily_stats 
      WHERE user_id = ${kw.user_id} AND query = ${kw.query}
      ORDER BY stat_date ASC
    `) as any;
    if (!dailyRows?.length) continue;

    // baseline: 첫 유효 크롤링일 (total_review_sum > 0 AND product_count >= 5)
    let baselineIdx = -1;
    for (let i = 0; i < dailyRows.length; i++) {
      if (N(dailyRows[i].total_review_sum) > 0 && N(dailyRows[i].product_count) >= 5) {
        baselineIdx = i; break;
      }
    }

    if (baselineIdx === -1) {
      for (const r of dailyRows) {
        const ks = calcKeywordScore(0, N(r.product_count), N(r.competition_score), 0);
        await db.execute(sql`UPDATE ext_keyword_daily_stats SET review_growth=0, sales_estimate=0, demand_score=0, keyword_score=${ks} WHERE id=${r.id}`);
        totalZeroed++;
      }
      continue;
    }

    let prevSum: number | null = null, prevDate: string | null = null, prevPc: number = 0;

    for (let i = 0; i < dailyRows.length; i++) {
      const r = dailyRows[i];
      const reviewSum = N(r.total_review_sum), pc = N(r.product_count);
      const isValid = reviewSum > 0 && pc >= 5;
      let g = 0;

      if (i <= baselineIdx) {
        g = 0;
        if (isValid) { prevSum = reviewSum; prevDate = r.stat_date; prevPc = pc; }
      } else if (!isValid) {
        g = 0;
      } else if (prevSum !== null && prevDate !== null) {
        const raw = reviewSum - prevSum;
        const gap = Math.max(1, Math.round((new Date(r.stat_date).getTime() - new Date(prevDate).getTime()) / 86400000));
        
        // 상품 수 변동 체크: 20% 이상 변동이면 상품 set 변동으로 판단
        const pcChangeRatio = prevPc > 0 ? Math.abs(pc - prevPc) / prevPc : 0;
        
        if (raw <= 0) {
          g = 0;
        } else if (pcChangeRatio > 0.2) {
          // 상품 set 대폭 변동 → growth 신뢰 불가
          g = 0;
        } else {
          const daily = raw / gap;
          // 상품당 하루 최대 20개 리뷰 증가 상한 (현실적 한계)
          const maxDailyGrowth = pc * 20;
          if (daily > maxDailyGrowth) {
            g = 0; // 비현실적 증가 → 상품 set 변동
          } else {
            g = Math.round(daily);
          }
        }
        // 유효일이면 항상 기준점 갱신 (감소해도 새 기준점)
        prevSum = reviewSum; prevDate = r.stat_date; prevPc = pc;
      } else {
        g = 0;
        if (isValid) { prevSum = reviewSum; prevDate = r.stat_date; prevPc = pc; }
      }

      const se = g * 20;
      const ds = calcDemandScore(se, g);
      const ks = calcKeywordScore(g, pc, N(r.competition_score), ds);

      if (N(r.review_growth) !== g || N(r.sales_estimate) !== se) {
        await db.execute(sql`UPDATE ext_keyword_daily_stats SET review_growth=${g}, sales_estimate=${se}, demand_score=${ds}, keyword_score=${ks} WHERE id=${r.id}`);
        totalUpdated++;
        if (g === 0 && N(r.review_growth) > 0) totalZeroed++;
        if (g > 0) totalRecalculated++;
      }
    }
  }

  console.log(`\n=== 재계산 완료 ===`);
  console.log(`총 업데이트: ${totalUpdated}건`);
  console.log(`0으로 리셋: ${totalZeroed}건`);
  console.log(`정상 재계산: ${totalRecalculated}건`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
