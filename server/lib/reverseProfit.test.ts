import { describe, it, expect } from "vitest";
import {
  stableSellPrice,
  computeProfit,
  stabilityGrade,
  recommendQty,
  evaluateDeal,
  DEFAULT_COST,
  type PriceSample,
} from "./reverseProfit";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function recent(prices: number[], now = NOW): PriceSample[] {
  return prices.map((priceCny, i) => ({ priceCny, at: now - i * DAY }));
}

describe("stableSellPrice", () => {
  it("returns null when no valid samples", () => {
    expect(stableSellPrice([], NOW)).toBeNull();
    expect(stableSellPrice([{ priceCny: 0, at: NOW }], NOW)).toBeNull();
  });

  it("uses P25 (하위 25%) as the conservative stable price", () => {
    // 100,110,120,130,140 → P25 ≈ 110
    const s = stableSellPrice(recent([140, 130, 120, 110, 100]), NOW)!;
    expect(s.stableCny).toBe(110);
    expect(s.stableCny).toBeLessThan(s.avg30Cny); // 안정가는 평균보다 낮아야
    expect(s.lowCny).toBe(100);
    expect(s.highCny).toBe(140);
  });

  it("prefers an explicit 30d volume hint over sample count", () => {
    const s = stableSellPrice(recent([100, 110]), NOW, 55)!;
    expect(s.volume30).toBe(55);
    expect(s.sampleCount).toBe(2);
  });

  it("excludes samples older than 30 days when recent data exists", () => {
    const samples: PriceSample[] = [
      { priceCny: 100, at: NOW },
      { priceCny: 500, at: NOW - 40 * DAY }, // stale, should be excluded
    ];
    const s = stableSellPrice(samples, NOW)!;
    expect(s.highCny).toBe(100);
    expect(s.sampleCount).toBe(1);
  });
});

describe("computeProfit", () => {
  it("subtracts the full cost stack and computes margin ÷ buy price", () => {
    // 매입 34,900원 / 안정가 $60 @1350 = 81,000원 매출 (중국시장 달러 기준)
    const p = computeProfit(34900, 60, DEFAULT_COST);
    expect(p.revenueKrw).toBe(81000);
    // 수수료 6%(판매 5%+결제 1%) + 환전 1.5% + 검수 3% + 배송 5000 + 포장 1000
    expect(p.feeKrw).toBe(Math.round(81000 * 0.06));
    expect(p.deductKrw).toBe(
      p.feeKrw + 5000 + p.fxLossKrw + 1000 + p.inspectRiskKrw
    );
    expect(p.netProfitKrw).toBe(81000 - 34900 - p.deductKrw);
    expect(p.marginPct).toBeCloseTo((p.netProfitKrw / 34900) * 100, 1);
  });

  it("guards divide-by-zero on 0 buy price", () => {
    expect(computeProfit(0, 60).marginPct).toBe(0);
  });
});

describe("stabilityGrade + recommendQty", () => {
  it("grades a liquid, stable product A", () => {
    const s = stableSellPrice(recent([100, 102, 101, 103, 100, 102]), NOW, 40)!;
    expect(stabilityGrade(s)).toBe("A");
  });

  it("grades a thin/volatile product D and blocks buying", () => {
    const s = stableSellPrice(recent([100]), NOW, 1)!;
    expect(stabilityGrade(s)).toBe("D");
    expect(recommendQty(80, "D", 1)).toBe(0);
  });

  it("blocks buying under 30% margin regardless of grade", () => {
    expect(recommendQty(29, "A", 100)).toBe(0);
  });

  it("caps quantity by grade and by 15% of market volume", () => {
    expect(recommendQty(50, "A", 200)).toBe(30); // A cap
    expect(recommendQty(50, "B", 200)).toBe(15); // B cap
    expect(recommendQty(50, "A", 40)).toBe(6); // 15% of 40
  });
});

describe("evaluateDeal", () => {
  it("produces a full verdict for the 크록스 특가 example", () => {
    // 안정가 ~$60 (중국시장 달러), 국내 매입 34,900원
    const v = evaluateDeal(34900, recent([60, 61, 62, 60, 61, 60]), NOW, DEFAULT_COST, 45)!;
    expect(v.profit.marginPct).toBeGreaterThan(30);
    expect(["A", "B"]).toContain(v.grade);
    expect(v.recommendQty).toBeGreaterThan(0);
    expect(v.stars).toBeGreaterThanOrEqual(4);
  });

  it("returns null without a buy price", () => {
    expect(evaluateDeal(0, recent([60]), NOW)).toBeNull();
  });
});
