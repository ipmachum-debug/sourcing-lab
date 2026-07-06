// 국내 매입처 검색 링크 — POIZON 상품명으로 국내 최저가를 바로 확인.
// 상품명에서 사이즈·불용어를 정리해 검색 쿼리를 만든다.

const STOP = [
  "남성", "여성", "남녀공용", "여성용", "남성용", "공용", "로우탑", "하이탑",
  "미끄럼", "방지", "내마모성", "통기성", "쿠셔닝", "쿠션감", "좋은", "지지력",
  "카본", "플레이트", "빈티지", "신발", "슈즈", "스니커즈", "러닝화", "운동화",
];

export function cleanQuery(name: string, brand?: string | null): string {
  let q = name || "";
  for (const w of STOP) q = q.split(w).join(" ");
  q = q.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  // 너무 길면 앞쪽 핵심어만 (브랜드 + 모델 6단어)
  const words = q.split(" ").filter(Boolean).slice(0, 6);
  const base = words.join(" ");
  const b = (brand || "").trim();
  return b && !base.toLowerCase().includes(b.toLowerCase()) ? `${b} ${base}` : base;
}

export interface SearchLink {
  label: string;
  url: string;
}

export function domesticSearchLinks(name: string, brand?: string | null): SearchLink[] {
  const q = encodeURIComponent(cleanQuery(name, brand));
  return [
    { label: "네이버 최저가", url: `https://search.shopping.naver.com/search/all?query=${q}` },
    { label: "무신사", url: `https://www.musinsa.com/search/goods?keyword=${q}` },
    { label: "ABC마트", url: `https://abcmart.a-rt.com/product/search?searchPapmerWord=${q}&searchWord=${q}` },
    { label: "다나와", url: `https://search.danawa.com/dsearch.php?query=${q}` },
  ];
}
