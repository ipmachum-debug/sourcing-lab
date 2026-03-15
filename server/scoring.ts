/**
 * 점수 계산 & 자동 상태 결정 로직 v2.1
 *
 * 점수 기준 (총 100점):
 * A. 시장 기회 (50점) — 실제 수집된 시장 데이터 기반
 *    - 종합점수(keywordScore) 반영: 20점 (0~100 → 0~20 비례)
 *    - 수요점수(demandScore) 반영: 10점 (0~100 → 0~10 비례)
 *    - 경쟁 유리도 (티어 기반): 10점
 *    - 판매추정 로그스케일: 10점
 * B. 분석 완성도 (30점) — 폼 작성 충실도
 *    - 키워드 입력: 9점 (3개 × 3점)
 *    - 메모/분석: 16점 (4항목 × 4점)
 *    - 기타 정보: 5점
 * C. 차별화 전략 (20점)
 *    - 차별화 수준: 12점
 *    - 개선노트 충실도: 8점
 *
 * 설계 원칙:
 * - 좋은 키워드(keywordScore 70+, 경쟁도 보통) + 자동완성 폼 → ~80점 달성 가능
 * - 시장 데이터 없는 경우 → 분석 완성도 + 차별화만 반영 (50점 만점)
 *
 * 경쟁유리도 티어 (경쟁도 점수 기준):
 *   0~30  (블루오션)    → 10점
 *   31~50 (저경쟁)      → 8점
 *   51~70 (보통)        → 6점
 *   71~85 (경쟁적)      → 4점
 *   86~100(레드오션)    → 2점
 */

interface ScoreInput {
  keyword1?: string | null;
  keyword2?: string | null;
  keyword3?: string | null;
  competitionLevel?: string | null;
  differentiationLevel?: string | null;
  thumbnailMemo?: string | null;
  detailPoint?: string | null;
  improvementNote?: string | null;
  developmentNote?: string | null;
  finalOpinion?: string | null;
  giftIdea?: string | null;
  targetCustomer?: string | null;
  coupangUrl?: string | null;
  referenceUrl?: string | null;
  category?: string | null;
}

interface MarketData {
  keywordScore?: number | null;
  demandScore?: number | null;
  competitionScore?: number | null;
  salesEstimate?: number | null;
  reviewGrowth?: number | null;
}

export function calculateScore(input: ScoreInput, market?: MarketData): number {
  let score = 0;

  // ===== A. 시장 기회 (50점) =====
  if (market) {
    // 종합점수 반영 (20점) — keywordScore 0~100 → 0~20 비례
    const ks = Math.max(0, Math.min(100, market.keywordScore ?? 0));
    score += Math.round((ks / 100) * 20);

    // 수요점수 반영 (10점) — demandScore 0~100 → 0~10 비례
    const ds = Math.max(0, Math.min(100, market.demandScore ?? 0));
    score += Math.round((ds / 100) * 10);

    // 경쟁 유리도 (10점) — 티어 기반 (현실적 배점)
    const cs = Math.max(0, Math.min(100, market.competitionScore ?? 50));
    if (cs <= 30) score += 10;       // 블루오션
    else if (cs <= 50) score += 8;   // 저경쟁
    else if (cs <= 70) score += 6;   // 보통
    else if (cs <= 85) score += 4;   // 경쟁적
    else score += 2;                 // 레드오션

    // 판매추정 (10점) — 로그스케일 (0→0, 100→5, 1000→8, 5000+→10)
    const se = Math.max(0, market.salesEstimate ?? 0);
    if (se > 0) {
      score += Math.min(10, Math.round(Math.log10(se + 1) * 2.7));
    }
  }

  // ===== B. 분석 완성도 (30점) =====
  // 키워드 입력 (9점) — 3개 × 3점
  if (input.keyword1) score += 3;
  if (input.keyword2) score += 3;
  if (input.keyword3) score += 3;

  // 메모/분석 (16점) — 4항목 × 4점
  if (input.thumbnailMemo && input.thumbnailMemo.length > 5) score += 4;
  if (input.detailPoint && input.detailPoint.length > 5) score += 4;
  if (input.finalOpinion && input.finalOpinion.length > 5) score += 4;
  if (input.developmentNote && input.developmentNote.length > 5) score += 4;

  // 기타 정보 (5점)
  if (input.targetCustomer) score += 1;
  if (input.giftIdea) score += 1;
  if (input.category) score += 1;
  if (input.coupangUrl || input.referenceUrl) score += 1;
  if (input.keyword1 && input.keyword2 && input.keyword3) score += 1;

  // ===== C. 차별화 전략 (20점) =====
  // 차별화 수준 (12점)
  const diffMap: Record<string, number> = { high: 12, medium: 7, low: 3 };
  score += diffMap[input.differentiationLevel || "medium"] || 7;

  // 개선노트 충실도 (8점)
  if (input.improvementNote && input.improvementNote.length > 5) score += 8;

  return Math.min(score, 100);
}

export function getScoreGrade(score: number): string {
  if (score >= 90) return "S";
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  return "D";
}

export function getAutoStatus(score: number): "draft" | "reviewing" | "test_candidate" | "hold" | "dropped" {
  if (score >= 70) return "test_candidate";
  if (score >= 55) return "reviewing";
  if (score >= 35) return "hold";
  return "draft";
}
