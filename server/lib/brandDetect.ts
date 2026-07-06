// ============================================================
// brandDetect.ts — 상품명에서 브랜드 추론 (한글/영문 표기 동시)
// ============================================================
// POIZON 리스트는 브랜드 컬럼이 비어 상품명에만 브랜드가 있음 → 서버에서 채운다.
// 긴/구체 토큰 먼저 매칭(예: "뉴발란스"를 "발란스"보다 먼저).

const BRANDS: { label: string; re: RegExp }[] = [
  { label: "New Balance", re: /(뉴발란스|뉴발|new\s?balance|\bNB\b)/i },
  { label: "Nike", re: /(나이키|nike)/i },
  { label: "Jordan", re: /(조던|jordan|air\s?jordan)/i },
  { label: "Adidas", re: /(아디다스|adidas)/i },
  { label: "Li-Ning", re: /(리닝|리-닝|li[-\s]?ning)/i },
  { label: "Asics", re: /(아식스|asics|onitsuka|오니츠카)/i },
  { label: "Crocs", re: /(크록스|crocs)/i },
  { label: "Vans", re: /(반스|vans)/i },
  { label: "Converse", re: /(컨버스|converse)/i },
  { label: "Dr.Martens", re: /(닥터마틴|dr\.?\s?martens|doc\s?martens)/i },
  { label: "Skechers", re: /(스케쳐스|스케처스|skechers)/i },
  { label: "Anta", re: /(안타|anta)/i },
  { label: "Puma", re: /(푸마|puma)/i },
  { label: "Salomon", re: /(살로몬|salomon)/i },
  { label: "Timberland", re: /(팀버랜드|timberland)/i },
  { label: "UGG", re: /(어그|\bugg\b)/i },
  { label: "Birkenstock", re: /(버켄스탁|birkenstock)/i },
  { label: "Hoka", re: /(호카|hoka)/i },
  { label: "Reebok", re: /(리복|reebok)/i },
  { label: "Fila", re: /(휠라|fila)/i },
  { label: "Mizuno", re: /(미즈노|mizuno)/i },
  { label: "Under Armour", re: /(언더아머|under\s?armou?r)/i },
  { label: "Kangol", re: /(캉골|kangol)/i },
  { label: "Dickies", re: /(디키즈|dickies)/i },
  { label: "Pop Mart", re: /(팝마트|pop\s?mart)/i },
  { label: "Gucci", re: /(구찌|gucci)/i },
  { label: "Prada", re: /(프라다|prada)/i },
  { label: "Calvin Klein", re: /(캘빈클라인|calvin\s?klein|\bCK\b)/i },
  { label: "YSL", re: /(입생로랑|ysl|saint\s?laurent)/i },
  { label: "Timberland", re: /(팀버랜드|timberland)/i },
  { label: "361°", re: /(361)/ },
  { label: "Winning", re: /(위닝|winning)/i },
  { label: "Camel", re: /(카멜|camel)/i },
  { label: "Xtep", re: /(엑스텝|xtep)/i },
];

export function detectBrand(name: string | undefined | null): string | null {
  const s = String(name || "");
  if (!s) return null;
  for (const b of BRANDS) if (b.re.test(s)) return b.label;
  return null;
}
