/**
 * Ali Validation Engine — 양방향 매칭 엔진
 *
 * 정방향: 쿠팡 키워드 → 알리 검색어 생성 + 결과 점수화
 * 역방향: 알리 상품 → 쿠팡 키워드 후보 추천
 *
 * 핵심 사전:
 *   EN_TO_KO  — 영어 → 한국어 상품 단어
 *   KO_TO_EN  — 한국어 → 영어 (정방향 검색어 생성)
 *   SYNONYMS  — 동의어 그룹
 *   ATTRS     — 속성 토큰
 */

// ============================================================
//  1. 사전 (Dictionary)
// ============================================================

/** 영 → 한 (약 250개) */
export const EN_TO_KO: Record<string, string> = {
  // 전자기기
  charger: "충전기",
  "wireless charger": "무선충전기",
  cable: "케이블",
  "usb cable": "USB 케이블",
  earphone: "이어폰",
  earphones: "이어폰",
  headphone: "헤드폰",
  headphones: "헤드폰",
  bluetooth: "블루투스",
  speaker: "스피커",
  "bluetooth speaker": "블루투스 스피커",
  mouse: "마우스",
  "wireless mouse": "무선마우스",
  keyboard: "키보드",
  "power bank": "보조배터리",
  "phone case": "폰케이스",
  "phone stand": "거치대",
  "phone holder": "거치대",
  tablet: "태블릿",
  "tablet stand": "태블릿 거치대",
  adapter: "어댑터",
  hub: "허브",
  "usb hub": "USB 허브",
  webcam: "웹캠",
  microphone: "마이크",
  "ring light": "링라이트",
  smartwatch: "스마트워치",
  "smart watch": "스마트워치",
  earbuds: "이어버드",
  "screen protector": "화면보호필름",
  stylus: "스타일러스펜",
  router: "라우터",
  projector: "프로젝터",
  "mini projector": "미니프로젝터",
  drone: "드론",
  camera: "카메라",
  tripod: "삼각대",
  gimbal: "짐벌",
  "action camera": "액션카메라",
  dashcam: "블랙박스",
  "dash cam": "블랙박스",

  // 가방/패션잡화
  backpack: "백팩",
  wallet: "지갑",
  bag: "가방",
  "tote bag": "토트백",
  "shoulder bag": "숄더백",
  "crossbody bag": "크로스백",
  "waist bag": "힙색",
  "fanny pack": "힙색",
  "laptop bag": "노트북가방",
  "travel bag": "여행가방",
  suitcase: "캐리어",
  luggage: "캐리어",
  pouch: "파우치",
  "makeup bag": "화장품파우치",

  // 액세서리/주얼리
  necklace: "목걸이",
  ring: "반지",
  bracelet: "팔찌",
  earring: "귀걸이",
  earrings: "귀걸이",
  sunglasses: "선글라스",
  watch: "시계",
  scarf: "스카프",
  belt: "벨트",
  gloves: "장갑",
  hat: "모자",
  cap: "모자",
  beanie: "비니",
  "bucket hat": "버킷햇",

  // 의류
  "t-shirt": "티셔츠",
  tshirt: "티셔츠",
  shirt: "셔츠",
  jacket: "자켓",
  coat: "코트",
  hoodie: "후드",
  sweater: "스웨터",
  cardigan: "가디건",
  pants: "바지",
  jeans: "청바지",
  shorts: "반바지",
  dress: "원피스",
  skirt: "치마",
  leggings: "레깅스",
  sneakers: "운동화",
  shoes: "신발",
  boots: "부츠",
  slippers: "슬리퍼",
  sandals: "샌들",
  mask: "마스크",
  sock: "양말",
  socks: "양말",
  underwear: "속옷",
  bra: "브라",
  swimsuit: "수영복",
  "rain coat": "비옷",
  raincoat: "비옷",
  vest: "조끼",

  // 주방용품
  kitchen: "주방",
  cooking: "요리",
  pot: "냄비",
  pan: "프라이팬",
  "frying pan": "프라이팬",
  wok: "웍",
  knife: "칼",
  "kitchen knife": "주방칼",
  scissors: "가위",
  cup: "컵",
  mug: "머그컵",
  tumbler: "텀블러",
  "water bottle": "물병",
  spoon: "숟가락",
  fork: "포크",
  chopsticks: "젓가락",
  plate: "접시",
  bowl: "그릇",
  "cutting board": "도마",
  peeler: "필러",
  whisk: "거품기",
  spatula: "뒤집개",
  ladle: "국자",
  strainer: "거름망",
  grater: "강판",
  blender: "블렌더",
  mixer: "믹서",
  "food container": "밀폐용기",
  lunchbox: "도시락",
  "lunch box": "도시락",
  thermos: "보온병",
  "ice maker": "제빙기",
  "air fryer": "에어프라이어",
  kettle: "전기포트",

  // 수납/정리
  storage: "수납",
  organizer: "정리함",
  shelf: "선반",
  rack: "거치대",
  hook: "후크",
  hanger: "행거",
  basket: "바구니",
  tray: "트레이",
  drawer: "서랍",
  "storage box": "수납함",

  // 청소/생활
  cleaning: "청소",
  "vacuum cleaner": "청소기",
  vacuum: "청소기",
  mop: "걸레",
  "spin mop": "회전걸레",
  brush: "솔",
  sponge: "스펀지",
  broom: "빗자루",
  "trash can": "쓰레기통",
  "lint roller": "먼지제거기",
  towel: "수건",
  mirror: "거울",
  scale: "저울",

  // 조명/인테리어
  lamp: "램프",
  "desk lamp": "책상램프",
  light: "조명",
  "night light": "수면등",
  led: "LED",
  "led strip": "LED스트립",
  "fairy light": "전구",
  candle: "캔들",
  "wall art": "벽장식",
  clock: "시계",
  "wall clock": "벽시계",
  "alarm clock": "알람시계",
  vase: "꽃병",
  "picture frame": "액자",
  curtain: "커튼",
  rug: "러그",
  carpet: "카펫",
  cushion: "쿠션",
  pillow: "베개",
  blanket: "이불",
  "bed sheet": "침대시트",
  "mattress pad": "매트리스패드",

  // 문구
  pen: "펜",
  pencil: "연필",
  notebook: "노트",
  diary: "다이어리",
  tape: "테이프",
  sticker: "스티커",
  toy: "장난감",
  puzzle: "퍼즐",
  "building blocks": "블록",
  lego: "레고",

  // 운동/아웃도어
  "yoga mat": "요가매트",
  dumbbell: "아령",
  "resistance band": "저항밴드",
  "jump rope": "줄넘기",
  "exercise ball": "짐볼",
  tent: "텐트",
  camping: "캠핑",
  "sleeping bag": "침낭",
  fishing: "낚시",
  "fishing rod": "낚싯대",
  bicycle: "자전거",
  helmet: "헬멧",
  "knee pad": "무릎보호대",
  "golf ball": "골프공",
  "swim goggles": "수경",
  goggles: "고글",

  // 반려동물
  pet: "반려동물",
  dog: "강아지",
  cat: "고양이",
  "pet bed": "반려동물침대",
  "pet toy": "반려동물장난감",
  "pet bowl": "반려동물밥그릇",
  "cat toy": "고양이장난감",
  "dog toy": "강아지장난감",
  leash: "리드줄",
  collar: "목줄",
  "pet carrier": "이동장",

  // 차량용
  car: "차량용",
  "car vacuum": "차량용청소기",
  "car charger": "차량용충전기",
  "car mount": "차량용거치대",
  "car seat": "카시트",
  "car mat": "차량용매트",
  "sun shade": "햇빛가리개",

  // 미용/뷰티
  makeup: "메이크업",
  "makeup brush": "화장솔",
  "nail art": "네일아트",
  "hair clip": "헤어클립",
  "hair band": "헤어밴드",
  "hair dryer": "헤어드라이기",
  "curling iron": "고데기",
  comb: "빗",
  "face mask": "페이스마스크",
  serum: "세럼",
  lotion: "로션",
  "essential oil": "에센셜오일",
  diffuser: "디퓨저",

  // 가전/생활가전
  fan: "선풍기",
  "mini fan": "미니선풍기",
  "neck fan": "넥팬",
  humidifier: "가습기",
  dehumidifier: "제습기",
  "air purifier": "공기청정기",
  heater: "히터",
  "electric blanket": "전기장판",
  iron: "다리미",
  "steamer": "스팀다리미",
  "sewing machine": "재봉틀",

  // 속성 키워드
  wireless: "무선",
  portable: "휴대용",
  mini: "미니",
  foldable: "접이식",
  waterproof: "방수",
  rechargeable: "충전식",
  adjustable: "조절",
  magnetic: "자석",
  automatic: "자동",
  electric: "전동",
  stainless: "스테인리스",
  silicone: "실리콘",
  bamboo: "대나무",
  wooden: "원목",
  leather: "가죽",
  transparent: "투명",
  thermal: "보온",
  insulated: "단열",
  "large capacity": "대용량",
  multifunctional: "다기능",
  retractable: "접이식",
  detachable: "분리형",
  ergonomic: "인체공학",
  handheld: "핸디",
  desktop: "탁상용",
  outdoor: "아웃도어",
  indoor: "실내",
};

/** 한 → 영 (정방향 검색어 생성용) — EN_TO_KO 역변환 + 추가 */
export const KO_TO_EN: Record<string, string[]> = {};
for (const [en, ko] of Object.entries(EN_TO_KO)) {
  if (!KO_TO_EN[ko]) KO_TO_EN[ko] = [];
  if (!KO_TO_EN[ko].includes(en)) KO_TO_EN[ko].push(en);
}
// 추가 한국어 → 영어 매핑 (역변환에 없는 것)
const extraKoEn: Record<string, string[]> = {
  청소기: ["vacuum cleaner", "vacuum"],
  충전기: ["charger", "charging"],
  이어폰: ["earphone", "earbuds"],
  보조배터리: ["power bank", "portable charger"],
  거치대: ["stand", "holder", "mount"],
  케이스: ["case", "cover"],
  수납함: ["storage box", "organizer"],
  장난감: ["toy", "toys"],
  정리함: ["organizer", "storage"],
};
for (const [ko, ens] of Object.entries(extraKoEn)) {
  if (!KO_TO_EN[ko]) KO_TO_EN[ko] = [];
  for (const en of ens) {
    if (!KO_TO_EN[ko].includes(en)) KO_TO_EN[ko].push(en);
  }
}

/** 한국어 동의어 그룹 */
export const KO_SYNONYMS: Record<string, string[]> = {
  차량용: ["자동차용", "카"],
  핸디: ["휴대용", "소형"],
  무선: ["코드리스", "와이어리스"],
  미니: ["소형", "초소형"],
  청소기: ["클리너"],
  보조배터리: ["파워뱅크"],
  거치대: ["홀더", "마운트", "스탠드"],
  후드: ["후드티", "후디"],
  텀블러: ["보온컵", "보냉컵"],
  물병: ["텀블러"],
};

/** 불용어 (영어) */
const EN_STOP_WORDS = new Set([
  "the", "a", "an", "for", "and", "or", "with", "in", "on", "to", "of",
  "is", "it", "at", "by", "from", "this", "that", "your", "all",
  "new", "hot", "sale", "free", "shipping", "pcs", "set", "piece", "pieces",
  "lot", "pack", "packs", "high", "quality", "mini", "portable",
  "style", "fashion", "cute", "popular", "wholesale", "item", "items",
  "latest", "brand", "original", "genuine", "authentic",
  "2024", "2025", "2026",
]);

/** 불용어 (한국어) */
const KO_STOP_WORDS = new Set([
  "더", "및", "또는", "등", "위한", "용", "개", "세트", "팩",
  "무료배송", "특가", "할인", "인기", "추천", "신상", "베스트",
]);

// ============================================================
//  2. 텍스트 처리 유틸
// ============================================================

/** 영어 제목 정리 — 소문자, 불필요한 문자/단위 제거 */
export function cleanEnTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, " ")
    .replace(/\d+\s*(pcs|packs?|sets?|pieces?|lot|pairs?|sheets?)\b/gi, "")
    .replace(/\d+(ml|g|kg|cm|mm|oz|l|inch|in)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 한국어 키워드 정리 */
export function cleanKoKeyword(keyword: string): string {
  return keyword
    .replace(/[^가-힣a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 영문 제목 → 토큰 배열 (불용어 제거) */
export function tokenizeEn(title: string): string[] {
  const cleaned = cleanEnTitle(title);
  return cleaned
    .split(/\s+/)
    .filter(w => w.length > 1 && !EN_STOP_WORDS.has(w));
}

/** 한국어 키워드 → 토큰 배열 */
export function tokenizeKo(keyword: string): string[] {
  const cleaned = cleanKoKeyword(keyword);
  return cleaned
    .split(/\s+/)
    .filter(w => w.length > 0 && !KO_STOP_WORDS.has(w));
}

// ============================================================
//  3. 정방향: 쿠팡 키워드 → 알리 검색어 생성
// ============================================================

/**
 * 쿠팡 키워드를 알리 검색어 세트(최대 5개)로 변환
 *
 * 예: "차량용 무선 청소기"
 * → ["car wireless vacuum cleaner", "car vacuum cleaner wireless",
 *    "handheld car vacuum", "mini wireless vacuum cleaner car"]
 */
export function generateAliSearchQueries(
  coupangKeyword: string,
  canonicalKeyword?: string,
  attributes?: string[],
): string[] {
  const queries = new Set<string>();
  const koTokens = tokenizeKo(coupangKeyword);

  // 1. 원문 번역형: 각 한국어 토큰을 영어로 직접 변환
  const directTranslation = koTokens
    .map(tok => KO_TO_EN[tok]?.[0] || tok)
    .join(" ");
  if (directTranslation.trim()) queries.add(directTranslation.trim());

  // 2. canonical 번역형
  if (canonicalKeyword && canonicalKeyword !== coupangKeyword) {
    const canonTokens = tokenizeKo(canonicalKeyword);
    const canonTranslation = canonTokens
      .map(tok => KO_TO_EN[tok]?.[0] || tok)
      .join(" ");
    if (canonTranslation.trim()) queries.add(canonTranslation.trim());
  }

  // 3. 속성 강조형: 핵심 명사 + 속성
  if (attributes && attributes.length > 0) {
    // 명사 부분만 (속성 제외)
    const nouns = koTokens.filter(
      tok => !attributes.some(
        attr => tok === attr || KO_SYNONYMS[tok]?.includes(attr),
      ),
    );
    const nounEn = nouns.map(tok => KO_TO_EN[tok]?.[0] || tok);
    for (const attr of attributes.slice(0, 2)) {
      const attrEn = KO_TO_EN[attr]?.[0] || attr;
      const q = [...nounEn, attrEn].join(" ").trim();
      if (q) queries.add(q);
    }
  }

  // 4. 짧은 핵심형: 2워드 조합 (가장 중요한 명사 2개)
  const importantTokens = koTokens.filter(tok => KO_TO_EN[tok]);
  if (importantTokens.length >= 2) {
    const shortQ = importantTokens
      .slice(0, 2)
      .map(tok => KO_TO_EN[tok]![0])
      .join(" ");
    queries.add(shortQ);
  }

  return [...queries].slice(0, 5);
}

// ============================================================
//  4. 역방향: 알리 제목 → 쿠팡 키워드 변환
// ============================================================

/**
 * 알리 영어 제목 → 한국어 키워드 후보 목록
 *
 * 예: "Wireless Handheld Car Vacuum Cleaner Portable Mini"
 * → ["무선 핸디 차량용 청소기", "차량용 무선 청소기", "차량용 휴대용 청소기"]
 */
export function aliTitleToKoKeywords(aliTitle: string): string[] {
  if (!aliTitle) return [];

  const cleaned = cleanEnTitle(aliTitle);
  const words = cleaned.split(/\s+/).filter(w => w.length > 1);
  const results: string[] = [];

  // 모든 매칭된 한국어 단어 추출 (2단어 → 1단어 우선)
  const koWords: string[] = [];
  const usedIndices = new Set<number>();

  // 2단어 조합 먼저
  for (let i = 0; i < words.length - 1; i++) {
    const twoWord = words[i] + " " + words[i + 1];
    if (EN_TO_KO[twoWord]) {
      koWords.push(EN_TO_KO[twoWord]);
      usedIndices.add(i);
      usedIndices.add(i + 1);
    }
  }

  // 1단어
  for (let i = 0; i < words.length; i++) {
    if (usedIndices.has(i)) continue;
    if (EN_TO_KO[words[i]]) {
      koWords.push(EN_TO_KO[words[i]]);
      usedIndices.add(i);
    }
  }

  if (koWords.length === 0) return [];

  // 결과 1: 전체 매칭 (최대 4단어)
  if (koWords.length >= 1) {
    results.push(koWords.slice(0, 4).join(" "));
  }

  // 결과 2: 속성 제외한 핵심 명사만
  const attrSet = new Set(Object.values(EN_TO_KO).filter(v =>
    ["무선", "휴대용", "미니", "접이식", "방수", "충전식", "자동", "전동",
      "대용량", "다기능", "핸디", "자석", "조절", "탁상용"].includes(v),
  ));
  const nouns = koWords.filter(w => !attrSet.has(w));
  const attrs = koWords.filter(w => attrSet.has(w));

  if (nouns.length >= 1 && attrs.length >= 1) {
    // 속성 1개 + 명사 조합
    for (const attr of attrs.slice(0, 2)) {
      results.push([attr, ...nouns.slice(0, 2)].join(" "));
    }
  }

  // 결과 3: 명사만 (순수 카테고리 검색)
  if (nouns.length >= 2) {
    results.push(nouns.slice(0, 3).join(" "));
  }

  // 중복 제거
  return [...new Set(results)].slice(0, 5);
}

// ============================================================
//  5. 매칭 점수 계산
// ============================================================

export interface MatchScoreInput {
  /** 알리 상품 제목 (영문) */
  aliTitle: string;
  /** 쿠팡 키워드 (한국어) */
  coupangKeyword: string;
  /** 정규화된 키워드 */
  canonicalKeyword?: string;
  /** 속성 토큰 */
  attributes?: string[];
  /** 알리 가격 (USD) */
  aliPriceUSD?: number;
  /** 쿠팡 평균가 (KRW) */
  coupangAvgPrice?: number;
  /** 알리 주문수 */
  aliOrderCount?: number;
  /** 알리 평점 */
  aliRating?: number;
  /** 배송비 (USD) */
  aliShippingFee?: number;
}

export interface MatchScoreResult {
  titleMatchScore: number;
  attributeMatchScore: number;
  priceFitScore: number;
  orderSignalScore: number;
  ratingSignalScore: number;
  shippingFitScore: number;
  finalScore: number;
}

/**
 * 정방향 매칭 점수 계산
 *
 * AliMatchScore =
 *   (title_similarity * 0.40)
 *   + (attribute_match * 0.25)
 *   + (price_fit * 0.15)
 *   + (order_signal * 0.10)
 *   + (rating_signal * 0.05)
 *   + (shipping_fit * 0.05)
 */
export function calculateForwardMatchScore(input: MatchScoreInput): MatchScoreResult {
  const titleScore = calcTitleSimilarity(input.aliTitle, input.coupangKeyword, input.canonicalKeyword);
  const attrScore = calcAttributeMatch(input.aliTitle, input.attributes || []);
  const priceScore = calcPriceFit(input.aliPriceUSD, input.coupangAvgPrice);
  const orderScore = calcOrderSignal(input.aliOrderCount);
  const ratingScore = calcRatingSignal(input.aliRating);
  const shipScore = calcShippingFit(input.aliShippingFee);

  const finalScore =
    titleScore * 0.40 +
    attrScore * 0.25 +
    priceScore * 0.15 +
    orderScore * 0.10 +
    ratingScore * 0.05 +
    shipScore * 0.05;

  return {
    titleMatchScore: Math.round(titleScore * 10000) / 10000,
    attributeMatchScore: Math.round(attrScore * 10000) / 10000,
    priceFitScore: Math.round(priceScore * 10000) / 10000,
    orderSignalScore: Math.round(orderScore * 10000) / 10000,
    ratingSignalScore: Math.round(ratingScore * 10000) / 10000,
    shippingFitScore: Math.round(shipScore * 10000) / 10000,
    finalScore: Math.round(finalScore * 10000) / 10000,
  };
}

/**
 * 역방향 매칭 점수 계산
 *
 * ReverseMatchScore =
 *   (keyword_similarity * 0.40)
 *   + (attribute_overlap * 0.25)
 *   + (price_fit * 0.15)
 *   + (category_fit * 0.10)
 *   + (market_score_fit * 0.10)
 */
export function calculateReverseMatchScore(input: {
  aliTitle: string;
  coupangKeyword: string;
  canonicalKeyword?: string;
  aliPriceUSD?: number;
  coupangAvgPrice?: number;
  coupangFinalScore?: number;
  categoryMatch?: boolean;
}): {
  keywordSimilarityScore: number;
  attributeOverlapScore: number;
  priceFitScore: number;
  categoryFitScore: number;
  marketFitScore: number;
  finalMatchScore: number;
} {
  // 알리 제목에서 한국어 추출
  const koKeywords = aliTitleToKoKeywords(input.aliTitle);
  const bestKo = koKeywords[0] || "";
  const koTokens = tokenizeKo(bestKo);
  const kwTokens = tokenizeKo(input.coupangKeyword);

  // 키워드 유사도: 토큰 겹침 비율
  const overlap = kwTokens.filter(t =>
    koTokens.includes(t) || koTokens.some(kt => KO_SYNONYMS[t]?.includes(kt) || KO_SYNONYMS[kt]?.includes(t)),
  );
  const keywordSim = kwTokens.length > 0 ? overlap.length / kwTokens.length : 0;

  // 속성 겹침
  const attrTokens = new Set(["무선", "휴대용", "미니", "접이식", "방수", "충전식", "핸디", "대용량"]);
  const aliAttrs = koTokens.filter(t => attrTokens.has(t));
  const kwAttrs = kwTokens.filter(t => attrTokens.has(t));
  const attrOverlap = kwAttrs.length > 0
    ? kwAttrs.filter(a => aliAttrs.includes(a)).length / kwAttrs.length
    : aliAttrs.length > 0 ? 0.5 : 1.0;

  const priceScore = calcPriceFit(input.aliPriceUSD, input.coupangAvgPrice);
  const categoryScore = input.categoryMatch ? 1.0 : 0.5;
  const marketScore = input.coupangFinalScore
    ? Math.min(1.0, (input.coupangFinalScore) / 100)
    : 0.5;

  const finalScore =
    keywordSim * 0.40 +
    attrOverlap * 0.25 +
    priceScore * 0.15 +
    categoryScore * 0.10 +
    marketScore * 0.10;

  return {
    keywordSimilarityScore: Math.round(keywordSim * 10000) / 10000,
    attributeOverlapScore: Math.round(attrOverlap * 10000) / 10000,
    priceFitScore: Math.round(priceScore * 10000) / 10000,
    categoryFitScore: Math.round(categoryScore * 10000) / 10000,
    marketFitScore: Math.round(marketScore * 10000) / 10000,
    finalMatchScore: Math.round(finalScore * 10000) / 10000,
  };
}

// ============================================================
//  6. 개별 점수 계산 함수
// ============================================================

/** 제목 유사도: 알리 영문 제목 vs 쿠팡 한국어 키워드 */
function calcTitleSimilarity(
  aliTitle: string,
  coupangKeyword: string,
  canonicalKeyword?: string,
): number {
  const aliTokens = tokenizeEn(aliTitle);
  const koTokens = tokenizeKo(coupangKeyword);

  // 한국어 토큰을 영어로 변환
  const kwEnTokens = koTokens.flatMap(tok => KO_TO_EN[tok] || [tok]);

  // 겹침 비율 계산
  let matchCount = 0;
  for (const enTok of kwEnTokens) {
    if (aliTokens.some(at => at === enTok || at.includes(enTok) || enTok.includes(at))) {
      matchCount++;
    }
  }

  const score1 = kwEnTokens.length > 0 ? matchCount / kwEnTokens.length : 0;

  // canonical과도 비교
  let score2 = 0;
  if (canonicalKeyword) {
    const canonTokens = tokenizeKo(canonicalKeyword);
    const canonEnTokens = canonTokens.flatMap(tok => KO_TO_EN[tok] || [tok]);
    let canonMatch = 0;
    for (const enTok of canonEnTokens) {
      if (aliTokens.some(at => at === enTok || at.includes(enTok) || enTok.includes(at))) {
        canonMatch++;
      }
    }
    score2 = canonEnTokens.length > 0 ? canonMatch / canonEnTokens.length : 0;
  }

  return Math.min(1.0, Math.max(score1, score2));
}

/** 속성 매칭: 알리 제목에 한국어 속성 토큰이 얼마나 있는지 */
function calcAttributeMatch(aliTitle: string, attributes: string[]): number {
  if (attributes.length === 0) return 0.5; // 속성 없으면 중립

  const aliTokens = tokenizeEn(aliTitle);
  let matchCount = 0;

  for (const attr of attributes) {
    const enVersions = KO_TO_EN[attr] || [attr];
    const found = enVersions.some(en =>
      aliTokens.some(at => at === en || at.includes(en) || en.includes(at)),
    );
    if (found) matchCount++;
  }

  return matchCount / attributes.length;
}

/** 가격 적합도: 쿠팡 평균가 / 알리 총 원가 비율 */
function calcPriceFit(aliPriceUSD?: number, coupangAvgPriceKRW?: number): number {
  if (!aliPriceUSD || !coupangAvgPriceKRW || aliPriceUSD <= 0 || coupangAvgPriceKRW <= 0) {
    return 0.5; // 가격 정보 없으면 중립
  }

  const exchangeRate = 1350;
  const aliTotalKRW = aliPriceUSD * exchangeRate * 1.08 + 6000; // 원가+관세+배송
  const ratio = coupangAvgPriceKRW / aliTotalKRW;

  if (ratio >= 6) return 1.0;
  if (ratio >= 3) return 0.6 + (ratio - 3) / 3 * 0.4;
  if (ratio >= 2) return 0.3 + (ratio - 2) * 0.3;
  if (ratio >= 1.5) return (ratio - 1.5) * 0.6;
  return 0;
}

/** 주문수 신호: 알리 주문수 기반 신뢰도 */
function calcOrderSignal(orderCount?: number): number {
  if (!orderCount) return 0.3;
  if (orderCount >= 10000) return 1.0;
  if (orderCount >= 1000) return 0.8;
  if (orderCount >= 100) return 0.6;
  if (orderCount >= 10) return 0.4;
  return 0.2;
}

/** 평점 신호 */
function calcRatingSignal(rating?: number): number {
  if (!rating) return 0.5;
  if (rating >= 4.8) return 1.0;
  if (rating >= 4.5) return 0.8;
  if (rating >= 4.0) return 0.6;
  if (rating >= 3.5) return 0.3;
  return 0.1;
}

/** 배송 적합도 */
function calcShippingFit(shippingFee?: number): number {
  if (shippingFee === undefined || shippingFee === null) return 0.5;
  if (shippingFee === 0) return 1.0; // 무료배송
  if (shippingFee <= 2) return 0.8;
  if (shippingFee <= 5) return 0.5;
  if (shippingFee <= 10) return 0.3;
  return 0.1;
}

// ============================================================
//  7. 마진 계산 유틸
// ============================================================

export interface MarginEstimate {
  aliPriceKRW: number;
  totalCostKRW: number;
  marginRatio: number;
  estimatedProfit2x: number;
  estimatedProfit3x: number;
}

export function estimateMargin(
  aliPriceUSD: number,
  coupangAvgPriceKRW?: number,
): MarginEstimate {
  const exchangeRate = 1350;
  const aliPriceKRW = Math.round(aliPriceUSD * exchangeRate);
  const intlShipping = 3000;
  const domesticShipping = 3000;
  const customs = Math.round(aliPriceKRW * 0.08);
  const totalCostKRW = aliPriceKRW + intlShipping + domesticShipping + customs;
  const feeRate = 0.188;

  const sellingPrice2x = Math.round(totalCostKRW * 2.5 / 100) * 100;
  const sellingPrice3x = Math.round(totalCostKRW * 3.5 / 100) * 100;

  const profit2x = sellingPrice2x - totalCostKRW - Math.round(sellingPrice2x * feeRate);
  const profit3x = sellingPrice3x - totalCostKRW - Math.round(sellingPrice3x * feeRate);

  const marginRatio = coupangAvgPriceKRW && totalCostKRW > 0
    ? coupangAvgPriceKRW / totalCostKRW
    : 0;

  return {
    aliPriceKRW,
    totalCostKRW,
    marginRatio: Math.round(marginRatio * 100) / 100,
    estimatedProfit2x: profit2x,
    estimatedProfit3x: profit3x,
  };
}
