// ==================== 인증/규제 체크 (중국 소싱 필수) ====================
// 키워드/카테고리 텍스트에서 필요한 국내 인증·규제를 감지해 경고한다.
// 중국에서 소싱해 쿠팡에 판매할 때 인증 누락은 판매중지/과태료 리스크.

export type CertLevel = "required" | "caution";

export interface CertRule {
  /** 표시 카테고리명 */
  category: string;
  /** 필요한 인증/규제 */
  cert: string;
  /** required=필수, caution=위험/주의 */
  level: CertLevel;
  /** 한 줄 설명 */
  note: string;
  /** 키워드/카테고리에 이 토큰이 포함되면 매칭 */
  match: string[];
}

export const CERT_RULES: CertRule[] = [
  {
    category: "전자제품",
    cert: "KC 인증 (전기용품 안전확인)",
    level: "required",
    note: "전원·충전 제품은 KC 안전인증 없이 판매 불가.",
    match: ["전자", "가전", "디지털", "충전", "전기", "이어폰", "스피커", "조명", "led", "선풍기", "가습기", "노트북", "모니터", "키보드", "마우스"],
  },
  {
    category: "어린이제품",
    cert: "어린이 KC (안전확인/공급자적합성)",
    level: "required",
    note: "13세 이하 대상 제품은 어린이제품 안전특별법 적용.",
    match: ["어린이", "유아", "아동", "키즈", "완구", "장난감", "출산", "육아", "젖병", "기저귀"],
  },
  {
    category: "식품접촉용품",
    cert: "식약처 수입신고 (기구·용기·포장)",
    level: "required",
    note: "음식이 닿는 주방·식기류는 식약처 수입신고 대상.",
    match: ["주방", "도시락", "수저", "젓가락", "컵", "텀블러", "식기", "용기", "밀폐", "도마", "프라이팬", "냄비", "빨대"],
  },
  {
    category: "화장품",
    cert: "화장품 책임판매업 등록",
    level: "required",
    note: "화장품 수입·판매는 책임판매업 등록 필수.",
    match: ["화장품", "미용", "스킨", "로션", "크림", "마스크팩", "세럼", "립", "선크림", "쿠션", "파운데이션", "에센스"],
  },
  {
    category: "의료/건강",
    cert: "의료기기/건강기능식품 (허가 위험)",
    level: "caution",
    note: "효능 표방 시 의료기기·건기식으로 분류돼 허가 필요할 수 있음.",
    match: ["의료", "건강", "마사지", "보호대", "혈압", "온열", "찜질", "다이어트", "영양제", "건기식", "패치", "교정"],
  },
  {
    category: "배터리",
    cert: "KC + 항공운송 위험(UN38.3)",
    level: "caution",
    note: "리튬 배터리는 KC 인증 + 항공운송 제한(통관 지연) 위험.",
    match: ["배터리", "보조배터리", "충전지", "리튬", "파워뱅크"],
  },
  {
    category: "섬유",
    cert: "섬유 표시사항 (품질경영·안전관리법)",
    level: "required",
    note: "의류·침구는 혼용률·취급주의 등 표시사항 부착 의무.",
    match: ["의류", "패션", "섬유", "티셔츠", "바지", "원단", "침구", "이불", "수건", "양말", "속옷", "잠옷", "커튼"],
  },
];

/**
 * 키워드/카테고리 텍스트에서 해당하는 인증 규칙을 감지한다.
 * 여러 규칙에 매칭될 수 있음(예: "유아 화장품").
 */
export function detectCerts(text: string): CertRule[] {
  if (!text) return [];
  const t = text.toLowerCase();
  return CERT_RULES.filter(rule => rule.match.some(tok => t.includes(tok.toLowerCase())));
}
