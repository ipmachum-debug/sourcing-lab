/**
 * 점수 계산 & 자동 상태 결정 로직
 * 
 * 점수 기준 (총 100점):
 * - 키워드 완성도: 15점
 * - 경쟁도: 20점
 * - 차별화 가능성: 20점
 * - 메모 완성도: 15점
 * - 개발노트 충실도: 15점
 * - 기타 정보 완성도: 15점
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

export function calculateScore(input: ScoreInput): number {
  let score = 0;

  // 키워드 완성도 (15점) - 키워드 3개 각 5점
  if (input.keyword1) score += 5;
  if (input.keyword2) score += 5;
  if (input.keyword3) score += 5;

  // 경쟁도 (20점) - 경쟁이 낮을수록 높은 점수
  const compMap: Record<string, number> = { low: 20, medium: 12, high: 6, very_high: 2 };
  score += compMap[input.competitionLevel || "medium"] || 12;

  // 차별화 가능성 (20점)
  const diffMap: Record<string, number> = { high: 20, medium: 12, low: 4 };
  score += diffMap[input.differentiationLevel || "medium"] || 12;

  // 메모 완성도 (15점)
  if (input.thumbnailMemo && input.thumbnailMemo.length > 5) score += 5;
  if (input.detailPoint && input.detailPoint.length > 5) score += 5;
  if (input.finalOpinion && input.finalOpinion.length > 5) score += 5;

  // 개발노트 충실도 (15점)
  if (input.improvementNote && input.improvementNote.length > 5) score += 8;
  if (input.developmentNote && input.developmentNote.length > 5) score += 7;

  // 기타 정보 완성도 (15점)
  if (input.targetCustomer) score += 3;
  if (input.giftIdea) score += 3;
  if (input.category) score += 3;
  if (input.coupangUrl || input.referenceUrl) score += 3;
  if (input.keyword1 && input.keyword2 && input.keyword3) score += 3; // 키워드 전부 입력 보너스

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
  if (score >= 85) return "test_candidate";
  if (score >= 70) return "reviewing";
  if (score >= 55) return "hold";
  return "draft";
}
