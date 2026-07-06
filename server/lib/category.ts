// ============================================================
// category.ts — POIZON 대분류 카테고리 정규화/추론 (공유)
// ============================================================
// 전체/운동화/신발/의류/가방/액세서리/장난감/뷰티 — 저장 카테고리(대분류) 우선,
// 없으면 상품명으로 추론. 정찰 보드·소싱 큐가 공용으로 사용.

export const CANON_CATS = [
  "운동화",
  "신발",
  "의류",
  "가방",
  "액세서리",
  "장난감",
  "뷰티",
];

// 저장된 카테고리 문자열을 대분류로 정규화(페이지 title 등 garbage 제외)
export function normalizeCat(c: string | null | undefined): string | null {
  const s = (c || "").trim();
  if (!s) return null;
  if (CANON_CATS.includes(s)) return s;
  if (/뷰티|퍼스널\s*케어|beauty/i.test(s)) return "뷰티";
  if (/신발|슈즈|footwear|shoe/i.test(s)) return "신발";
  if (/의류|apparel|clothing|의상/i.test(s)) return "의류";
  if (/가방|bag/i.test(s)) return "가방";
  if (/액세서리|accessor/i.test(s)) return "액세서리";
  if (/장난감|토이|toy|피규어/i.test(s)) return "장난감";
  return null;
}

// 상품명으로 대분류 추론 (저장 카테고리가 없어도 분류) — 위→아래 우선순위
export function inferCategory(name: string): string | null {
  const s = String(name || "").toLowerCase();
  if (/향수|퍼퓸|perfume|오드|edp|edt|크림|립스틱|파운데이션|세럼|샴푸/.test(s))
    return "뷰티";
  if (/팝마트|pop\s?mart|인형|피규어|건담|gundam|plush|토이|블록|레고/.test(s))
    return "장난감";
  if (
    /가방|백팩|크로스\s?백|숄더|슬링|메신저|토트|파우치|bag|backpack|지갑|월렛/.test(s)
  )
    return "가방";
  if (
    /모자|캡|비니|버킷|시계|watch|벨트|양말|목걸이|반지|팔찌|스카프|선글라스|sunglass|안경|키링|장갑/.test(
      s
    )
  )
    return "액세서리";
  if (
    /자켓|재킷|jacket|후드|hood|맨투맨|스웨트|sweat|바지|팬츠|pants|반바지|shorts|셔츠|shirt|코트|coat|니트|스웨터|데님|denim|청바지|티셔츠|tee|원피스|레깅스|트랙\s?팬츠/.test(
      s
    )
  )
    return "의류";
  if (
    /러닝화|스니커즈|sneaker|running|농구화|축구화|테니스화|운동화|트레이너|trainer|스케이트보드화|스케이트보드 신발/.test(
      s
    )
  )
    return "운동화";
  if (
    /슬리퍼|슬라이드|slide|클로그|clog|부츠|boots|샌들|sandal|로퍼|구두|더비|derby|플립\s?플롭|flip|뮬|mule/.test(
      s
    )
  )
    return "신발";
  return null;
}

// 저장 카테고리(대분류) 우선, 없으면 상품명 추론
export function catOf(r: {
  category: string | null | undefined;
  productName: string;
}): string | null {
  return normalizeCat(r.category) ?? inferCategory(r.productName);
}
