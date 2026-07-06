// ============================================================
// matchProduct.ts — 상품 유사 매칭 (국내 ↔ POIZON 이름이 조금 달라도 연결)
// ============================================================
// 브랜드 일치 + 공통 핵심 토큰 수로 점수. 불용어(사이즈·성별·기능어) 제거.

const STOP = new Set([
  "남성", "여성", "남녀공용", "여성용", "남성용", "공용", "로우탑", "하이탑", "미드탑",
  "미끄럼", "방지", "내마모성", "통기성", "쿠셔닝", "쿠션감", "좋은", "지지력", "카본",
  "플레이트", "빈티지", "신발", "슈즈", "스니커즈", "러닝화", "운동화", "농구화", "샌들",
  "슬리퍼", "클로그", "부츠", "the", "and", "og", "low", "mid", "high", "men", "women",
]);

export function tokenize(s: string): string[] {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(t => t.length >= 2 && !STOP.has(t));
}

export interface MatchCandidate<T> {
  tokens: string[];
  brand: string | null;
  ref: T;
}

export function makeCandidate<T>(name: string, brand: string | null, ref: T): MatchCandidate<T> {
  return { tokens: tokenize(name), brand: brand ? brand.toLowerCase() : null, ref };
}

function score(aTokens: string[], aBrand: string | null, b: { tokens: string[]; brand: string | null }): number {
  const setB = new Set(b.tokens);
  let shared = 0;
  for (const t of aTokens) if (setB.has(t)) shared++;
  const brandBonus = aBrand && b.brand && aBrand === b.brand ? 2 : 0;
  return shared + brandBonus;
}

/** 최고 점수 후보(minScore 이상)를 반환. 없으면 null. */
export function bestMatch<T>(
  targetName: string,
  targetBrand: string | null,
  candidates: MatchCandidate<T>[],
  minScore = 3
): { ref: T; score: number } | null {
  const aTokens = tokenize(targetName);
  if (aTokens.length === 0) return null;
  const aBrand = targetBrand ? targetBrand.toLowerCase() : null;
  let best: { ref: T; score: number } | null = null;
  for (const c of candidates) {
    const s = score(aTokens, aBrand, c);
    if (s >= minScore && (!best || s > best.score)) best = { ref: c.ref, score: s };
  }
  return best;
}
