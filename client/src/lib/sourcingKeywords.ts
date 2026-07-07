// ============================================================
// sourcingKeywords.ts — 브랜드별 대표 모델 키워드 (소싱 퀵픽)
// ============================================================
// 클릭 시 카탈로그 검색. 카탈로그 상품명이 한글이라 q(검색어)는 매칭되는 한글/영문으로.
//   label = 보여줄 이름, q = 실제 검색어(상품명에 포함될 만한 토큰).

export interface KwModel {
  label: string;
  q: string;
}
export interface KwBrand {
  brand: string; // 브랜드 검색어 겸 표시
  emoji: string;
  models: KwModel[];
}

export const SOURCING_KEYWORDS: KwBrand[] = [
  {
    brand: "크록스",
    emoji: "🐊",
    // 토큰이 짧고 흔해(메가→'메가데스', 에코 등) 브랜드까지 함께 검색해 정밀도 확보.
    // 검색은 다중 토큰 AND 매칭이라 '크록스 메가'면 둘 다 포함된 상품만 잡힘.
    models: [
      { label: "Classic Clog", q: "크록스 클래식" },
      { label: "Bayaband", q: "크록스 바야" },
      { label: "Echo Clog", q: "크록스 에코" },
      { label: "Mega Crush", q: "크록스 메가" },
      { label: "Platform", q: "크록스 플랫폼" },
    ],
  },
  {
    brand: "나이키",
    emoji: "✔️",
    models: [
      { label: "Air Force 1", q: "에어포스" },
      { label: "Dunk Low", q: "덩크" },
      { label: "Vomero", q: "보메로" },
      { label: "Pegasus", q: "페가수스" },
      { label: "Cortez", q: "코르테즈" },
    ],
  },
  {
    brand: "푸마",
    emoji: "🐆",
    models: [
      { label: "Speedcat", q: "스피드캣" },
      { label: "Palermo", q: "팔레르모" },
      { label: "Suede XL", q: "스웨이드" },
    ],
  },
  {
    brand: "모자·캡",
    emoji: "🧢",
    models: [
      { label: "MLB", q: "MLB" },
      { label: "New Era", q: "뉴에라" },
    ],
  },
];
