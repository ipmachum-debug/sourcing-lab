import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { invokeLLM } from "../_core/llm";

// ============================================================
//  Sourcing Coach API — v4.4
//  AI 소싱 코치 시스템 (OpenAI 연동)
//  WING 인기상품 AI 분석, 키워드 생성, 마진 계산, 리스크 분석, 소싱 점수
// ============================================================

// ---- 한국어→중국어 확장 사전 ----
const KO_TO_CN: Record<string, string> = {
  // 생활용품
  '텀블러': '保温杯', '물병': '水杯', '보온병': '保温瓶', '컵': '杯子',
  '수건': '毛巾', '타올': '毛巾', '목욕': '沐浴', '비누': '肥皂',
  '치약': '牙膏', '칫솔': '牙刷', '면도기': '剃须刀', '빗': '梳子',
  '거울': '镜子', '바구니': '篮子', '정리함': '收纳盒', '수납': '收纳',
  '선반': '架子', '후크': '挂钩', '행거': '衣架', '빨래': '洗衣',
  '세탁': '洗涤', '건조': '干燥', '다리미': '熨斗', '청소': '清洁',
  '걸레': '拖把', '빗자루': '扫帚', '쓰레기통': '垃圾桶', '방향제': '香薰',
  // 주방
  '냄비': '锅', '프라이팬': '平底锅', '도마': '砧板', '칼': '刀',
  '접시': '盘子', '그릇': '碗', '젓가락': '筷子', '숟가락': '勺子',
  '밀폐용기': '密封盒', '보관용기': '保鲜盒', '물통': '水壶',
  '에어프라이어': '空气炸锅', '믹서기': '搅拌机',
  '전기포트': '电热水壶', '토스터': '烤面包机',
  // 전자/모바일
  '충전기': '充电器', '케이블': '数据线', '이어폰': '耳机', '헤드폰': '头戴耳机',
  '블루투스': '蓝牙', '스피커': '音箱', '마우스': '鼠标', '키보드': '键盘',
  '보조배터리': '充电宝', '거치대': '支架', '핸드폰': '手机',
  '케이스': '手机壳', '필름': '贴膜', '보호필름': '保护膜',
  '무선충전': '无线充电', '조명': '照明', '램프': '灯', '스탠드': '台灯',
  '전구': '灯泡', '리모컨': '遥控器', '태블릿': '平板电脑',
  '모니터': '显示器', '웹캠': '摄像头', '허브': '集线器',
  // 자동차
  '차량용': '车载', '핸들커버': '方向盘套', '시트커버': '座椅套',
  '세차': '洗车', '와이퍼': '雨刷', '블랙박스': '行车记录仪',
  '차량': '汽车', '자동차': '汽车', '출풍구': '出风口',
  '접이식': '折叠', '회전': '旋转', '흡착식': '吸盘',
  // 의류/패션
  '티셔츠': 'T恤', '반팔': '短袖', '긴팔': '长袖', '맨투맨': '卫衣',
  '후드': '连帽衫', '자켓': '夹克', '점퍼': '外套', '코트': '大衣',
  '바지': '裤子', '청바지': '牛仔裤', '반바지': '短裤', '레깅스': '打底裤',
  '치마': '裙子', '원피스': '连衣裙', '블라우스': '衬衫',
  '양말': '袜子', '속옷': '内衣', '팬티': '内裤',
  '모자': '帽子', '벨트': '腰带', '장갑': '手套', '스카프': '围巾',
  '가방': '包', '백팩': '双肩包', '크로스백': '斜挎包', '지갑': '钱包',
  '신발': '鞋', '운동화': '运动鞋', '슬리퍼': '拖鞋', '샌들': '凉鞋',
  // 액세서리
  '목걸이': '项链', '반지': '戒指', '팔찌': '手链', '귀걸이': '耳环',
  '선글라스': '太阳镜', '안경': '眼镜', '시계': '手表', '헤어밴드': '发带',
  // 뷰티
  '립스틱': '口红', '파운데이션': '粉底', '마스카라': '睫毛膏',
  '로션': '乳液', '크림': '面霜', '선크림': '防晒霜',
  '샴푸': '洗发水', '린스': '护发素', '바디워시': '沐浴露',
  // 완구/유아
  '장난감': '玩具', '인형': '玩偶', '블록': '积木', '퍼즐': '拼图',
  '스티커': '贴纸', '기저귀': '尿不湿', '젖병': '奶瓶',
  // 반려동물
  '사료': '宠物粮', '간식': '零食', '목줄': '牵引绳',
  '쿠션': '靠垫', '방석': '坐垫', '매트': '垫子',
  // 문구/오피스
  '펜': '笔', '볼펜': '圆珠笔', '노트': '笔记本', '다이어리': '日记本',
  '테이프': '胶带', '가위': '剪刀',
  // 운동/레저
  '요가매트': '瑜伽垫', '아령': '哑铃', '텐트': '帐篷',
  '등산': '登山', '수영': '游泳', '낚시': '钓鱼',
  // 인테리어
  '커튼': '窗帘', '러그': '地毯', '이불': '被子',
  '베개': '枕头', '침대': '床', '액자': '相框',
};

// ---- 한국어→영어 확장 사전 ----
const KO_TO_EN: Record<string, string> = {
  '텀블러': 'tumbler', '물병': 'water bottle', '보온병': 'thermos',
  '수건': 'towel', '비누': 'soap', '칫솔': 'toothbrush',
  '충전기': 'charger', '케이블': 'cable', '이어폰': 'earphone',
  '블루투스': 'bluetooth', '스피커': 'speaker', '마우스': 'mouse',
  '키보드': 'keyboard', '보조배터리': 'power bank', '거치대': 'phone stand',
  '케이스': 'phone case', '티셔츠': 't-shirt', '양말': 'socks',
  '가방': 'bag', '백팩': 'backpack', '지갑': 'wallet',
  '목걸이': 'necklace', '반지': 'ring', '팔찌': 'bracelet',
  '귀걸이': 'earring', '선글라스': 'sunglasses',
  '장난감': 'toy', '인형': 'plush toy', '블록': 'building blocks',
  '펜': 'pen', '노트': 'notebook', '스티커': 'sticker',
  '요가매트': 'yoga mat', '텐트': 'tent',
  '커튼': 'curtain', '러그': 'rug', '이불': 'blanket',
  '베개': 'pillow', '쿠션': 'cushion', '매트': 'mat',
  '차량용': 'car', '접이식': 'foldable',
  '프라이팬': 'frying pan', '도마': 'cutting board', '냄비': 'pot',
  '에어프라이어': 'air fryer', '전기포트': 'electric kettle',
  '자전거': 'bicycle', '캠핑': 'camping', '등산': 'hiking',
  '수영': 'swimming', '낚시': 'fishing',
  '모자': 'hat', '장갑': 'gloves', '벨트': 'belt',
};

// ---- 노이즈 워드 ----
const NOISE_WORDS = new Set([
  '1개', '2개', '3개', '4개', '5개', '6개', '7개', '8개', '9개', '10개',
  '1+1', '2+1', '3+1', '1P', '2P', '3P', '1팩', '2팩', '1세트', '2세트',
  '무료배송', '당일발송', '국내배송', '무료반품', '최저가', '특가', '세일',
  '할인', '초특가', '핫딜', '타임딜', '쿠폰', '적립', '인기', '추천', '베스트',
  '고급', '프리미엄', '럭셔리', '대용량', '소용량', '미니', '슬림',
  '정품', '국내정품', '수입정품', '공식', '공식판매',
  '블랙', '화이트', '그레이', '네이비', '베이지', '브라운', '핑크',
  '레드', '블루', '그린', '옐로우', '퍼플', '오렌지',
]);

// ---- 유명 브랜드 ----
const KNOWN_BRANDS = new Set([
  '삼성', '엘지', 'LG', 'SAMSUNG', 'APPLE', '애플', '나이키', 'NIKE',
  '아디다스', 'ADIDAS', '뉴발란스', '컨버스', '무인양품', '이케아', 'IKEA',
  '샤오미', 'XIAOMI', '앤커', 'ANKER', '로지텍', '필립스', '다이슨',
  '소니', 'SONY', '파나소닉', '보쉬', '쿠쿠', '쿠첸', '위닉스',
]);

// ---- KC 인증 필요 키워드 ----
const KC_KEYWORDS = new Set([
  '전기', '전자', '충전기', '어댑터', '배터리', '보조배터리', '콘센트',
  '멀티탭', '히터', '선풍기', '가습기', '제습기', '공기청정기',
  'LED', '조명', '램프', '전구', '드라이기', '고데기', '다리미',
  '에어프라이어', '전기포트', '토스터', '믹서기', '전기밥솥',
  '블루투스', '이어폰', '헤드폰', '스피커', '리모컨',
  '블랙박스', '보조배터리', '마사지기', '전동칫솔',
]);

// ---- 식품/의약/화장품 키워드 ----
const REGULATED_KEYWORDS = new Set([
  '식품', '간식', '과자', '음료', '사탕', '초콜릿', '건강식품', '영양제',
  '비타민', '프로틴', '유산균', '콜라겐', '오메가',
  '화장품', '스킨케어', '립스틱', '파운데이션', '마스카라', '선크림',
  '로션', '크림', '세럼', '토너', '클렌징', '마스크팩',
  '의약품', '밴드', '소독', '연고',
]);

// ---- 계절성 키워드 ----
const SEASONAL_KEYWORDS: Record<string, string> = {
  '선풍기': '여름', '에어컨': '여름', '냉풍기': '여름', '부채': '여름',
  '서핑': '여름', '수영복': '여름', '비치': '여름', '아이스': '여름',
  '히터': '겨울', '난방': '겨울', '핫팩': '겨울', '방한': '겨울',
  '패딩': '겨울', '털모자': '겨울', '장갑': '겨울', '목도리': '겨울',
  '크리스마스': '겨울', '스키': '겨울', '보드': '겨울',
  '벚꽃': '봄', '봄옷': '봄', '가디건': '봄',
  '할로윈': '가을', '추석': '가을',
};

// ---- 파손 위험 키워드 ----
const FRAGILE_KEYWORDS = new Set([
  '유리', '도자기', '세라믹', '크리스탈', '거울', '화분', '액자',
  '접시', '그릇', '머그컵', '와인잔', '맥주잔', '텀블러',
]);

// ---- 대형/무거운 키워드 ----
const BULKY_KEYWORDS = new Set([
  '캠핑테이블', '텐트', '자전거', '킥보드', '유모차', '매트리스',
  '침대', '책상', '의자', '선반', '수납장', '서랍장', '선반',
  '대형', '초대형', '미니냉장고', '냉장고',
]);

// ============================================================
//  스마트 키워드 추출 (서버 사이드)
// ============================================================
function extractSmartKeywords(title: string) {
  if (!title) return { ko: '', cn: '', en: '', tokens: [] };

  let cleaned = title
    .replace(/\[.*?\]/g, ' ')
    .replace(/\(.*?\)/g, ' ')
    .replace(/【.*?】/g, ' ')
    .replace(/《.*?》/g, ' ')
    .replace(/<.*?>/g, ' ')
    .replace(/[\/\\|~`!@#$%^&*=+{}\[\];:'"<>,.?]/g, ' ')
    .replace(/\d+[%％]?\s*(할인|OFF|off)/g, ' ')
    .replace(/\d+(ml|ML|g|kg|KG|cm|mm|oz|L|개입|매입|세트|팩|롤|장|매|병|봉|박스)/g, ' ')
    .replace(/\d+\+\d+/g, ' ')
    .trim();

  let words = cleaned.split(/\s+/).filter(w => {
    if (w.length <= 1) return false;
    if (NOISE_WORDS.has(w)) return false;
    if (/^\d+$/.test(w)) return false;
    if (/^[A-Z]{1,3}$/.test(w) && !KO_TO_CN[w]) return false;
    return true;
  });

  // 브랜드 제거
  if (words.length > 2) {
    const first = words[0];
    if (KNOWN_BRANDS.has(first) || KNOWN_BRANDS.has(first.toUpperCase())) {
      words.shift();
    } else if (/^[a-zA-Z]+$/.test(first) && first.length >= 2 && !KO_TO_CN[first]) {
      words.shift();
    }
  }

  const coreWords = words.slice(0, 4);
  const koKeyword = coreWords.join(' ');

  // 중국어
  const cnParts: string[] = [];
  for (const w of coreWords) {
    if (KO_TO_CN[w]) cnParts.push(KO_TO_CN[w]);
  }

  // 영어
  const enParts: string[] = [];
  for (const w of coreWords) {
    if (KO_TO_EN[w]) enParts.push(KO_TO_EN[w]);
  }

  return {
    ko: koKeyword,
    cn: cnParts.join(' '),
    en: enParts.join(' '),
    tokens: coreWords,
  };
}

// ============================================================
//  리스크 분석
// ============================================================
interface RiskResult {
  level: 'low' | 'medium' | 'high' | 'critical';
  score: number; // 0-100 (높을수록 위험)
  warnings: Array<{
    type: string;
    label: string;
    severity: 'info' | 'warn' | 'danger';
    description: string;
  }>;
}

function analyzeRisks(title: string, price: number, reviewCount: number, rating: number, optionCount: number, categoryPath?: string): RiskResult {
  const warnings: RiskResult['warnings'] = [];
  let riskScore = 0;
  const titleLower = (title || '').toLowerCase();
  const tokens = (title || '').split(/\s+/);

  // KC 인증 필요
  for (const t of tokens) {
    if (KC_KEYWORDS.has(t)) {
      warnings.push({ type: 'kc_cert', label: '인증필요', severity: 'danger', description: `"${t}" — KC 인증 필요 가능성` });
      riskScore += 20;
      break;
    }
  }

  // 식품/화장품 규제
  for (const t of tokens) {
    if (REGULATED_KEYWORDS.has(t)) {
      warnings.push({ type: 'regulated', label: '규제품목', severity: 'danger', description: `"${t}" — 식품/화장품/의약 규제 가능` });
      riskScore += 25;
      break;
    }
  }

  // 계절성
  for (const t of tokens) {
    if (SEASONAL_KEYWORDS[t]) {
      warnings.push({ type: 'seasonal', label: '계절상품', severity: 'warn', description: `"${t}" — ${SEASONAL_KEYWORDS[t]} 시즌 상품` });
      riskScore += 10;
      break;
    }
  }

  // 파손 위험
  for (const t of tokens) {
    if (FRAGILE_KEYWORDS.has(t)) {
      warnings.push({ type: 'fragile', label: '파손위험', severity: 'warn', description: `"${t}" — 배송 중 파손 위험` });
      riskScore += 12;
      break;
    }
  }

  // 대형 상품
  for (const t of tokens) {
    if (BULKY_KEYWORDS.has(t)) {
      warnings.push({ type: 'bulky', label: '대형상품', severity: 'warn', description: `"${t}" — 배송비 높음 / 반품 어려움` });
      riskScore += 10;
      break;
    }
  }

  // 옵션 복잡도
  if (optionCount > 10) {
    warnings.push({ type: 'many_options', label: '옵션복잡', severity: 'warn', description: `옵션 ${optionCount}개 — 재고관리 어려움` });
    riskScore += 8;
  } else if (optionCount > 5) {
    warnings.push({ type: 'options', label: '옵션많음', severity: 'info', description: `옵션 ${optionCount}개` });
    riskScore += 4;
  }

  // 리뷰 수 기반 진입 난이도
  if (reviewCount > 1000) {
    warnings.push({ type: 'high_review', label: '리뷰장벽', severity: 'danger', description: `리뷰 ${reviewCount}개 — 신규 진입 매우 어려움` });
    riskScore += 15;
  } else if (reviewCount > 500) {
    warnings.push({ type: 'review_barrier', label: '리뷰많음', severity: 'warn', description: `리뷰 ${reviewCount}개 — 진입 장벽 높음` });
    riskScore += 8;
  }

  // 저평점
  if (rating > 0 && rating < 3.0) {
    warnings.push({ type: 'low_rating', label: '저평점', severity: 'info', description: `평점 ${rating} — 품질 우려 (=기회 가능)` });
  }

  // 가격대 (저가 상품은 마진 확보 어려움)
  if (price > 0 && price < 5000) {
    warnings.push({ type: 'low_price', label: '저가상품', severity: 'warn', description: `가격 ${price.toLocaleString()}원 — 마진 확보 어려움` });
    riskScore += 10;
  }

  // 고가 상품은 초기 자본 필요
  if (price > 100000) {
    warnings.push({ type: 'high_price', label: '고가상품', severity: 'info', description: `가격 ${price.toLocaleString()}원 — 초기 자본 필요` });
    riskScore += 5;
  }

  riskScore = Math.min(100, riskScore);
  const level: RiskResult['level'] = riskScore >= 40 ? 'critical' : riskScore >= 25 ? 'high' : riskScore >= 10 ? 'medium' : 'low';

  return { level, score: riskScore, warnings };
}

// ============================================================
//  소싱 점수 계산 (100점 만점 - 새 기준)
// ============================================================
interface SourcingScoreInput {
  price: number;
  reviewCount: number;
  rating: number;
  isAd: boolean;
  isRocket: boolean;
  optionCount: number;
  title: string;
  // 시장 평균 (검색 결과 전체)
  avgPrice: number;
  avgReview: number;
  avgRating: number;
  adCount: number;
  totalItems: number;
  highReviewRatio: number;
}

interface SourcingScoreResult {
  total: number;
  breakdown: {
    margin: number;        // 30점
    competition: number;   // 20점
    sourcingEase: number;  // 15점
    optionSimplicity: number; // 10점
    certStability: number; // 10점
    deliveryStability: number; // 10점
    reviewPotential: number;  // 5점
  };
  grade: string;
  gradeLabel: string;
  recommendation: string;
}

function calcSourcingScore100(input: SourcingScoreInput): SourcingScoreResult {
  const breakdown = {
    margin: 0,
    competition: 0,
    sourcingEase: 0,
    optionSimplicity: 0,
    certStability: 0,
    deliveryStability: 0,
    reviewPotential: 0,
  };

  // 1. 마진 (30점) — 가격대가 적정하고 중국 소싱 가능 가격이면 높음
  if (input.price >= 15000 && input.price <= 80000) {
    breakdown.margin = 25;
    if (input.price >= 20000 && input.price <= 50000) breakdown.margin = 30; // 최적 가격대
  } else if (input.price >= 10000) {
    breakdown.margin = 18;
  } else if (input.price >= 5000) {
    breakdown.margin = 10;
  } else {
    breakdown.margin = 3; // 5000원 미만은 마진 확보 어려움
  }

  // 가격이 평균보다 높으면 마진 여유
  if (input.avgPrice > 0 && input.price > input.avgPrice * 1.2) {
    breakdown.margin = Math.min(30, breakdown.margin + 5);
  }

  // 2. 경쟁 (20점) — 리뷰 적고, 광고 적고, 고리뷰 비율 낮으면 좋음
  if (input.reviewCount === 0) {
    breakdown.competition = 20;
  } else if (input.reviewCount < 10) {
    breakdown.competition = 18;
  } else if (input.reviewCount < 50) {
    breakdown.competition = 14;
  } else if (input.reviewCount < 100) {
    breakdown.competition = 10;
  } else if (input.reviewCount < 500) {
    breakdown.competition = 5;
  } else {
    breakdown.competition = 2;
  }

  // 시장 전체 경쟁도 반영
  if (input.highReviewRatio < 20) {
    breakdown.competition = Math.min(20, breakdown.competition + 3);
  }
  if (input.totalItems > 0 && input.adCount / input.totalItems < 0.15) {
    breakdown.competition = Math.min(20, breakdown.competition + 2);
  }

  // 3. 소싱 용이도 (15점) — 한국어→중국어 키워드 매칭 가능여부, 일반적 상품인지
  const keywords = extractSmartKeywords(input.title);
  if (keywords.cn) {
    breakdown.sourcingEase = 15;
  } else if (keywords.en) {
    breakdown.sourcingEase = 10;
  } else if (keywords.ko) {
    breakdown.sourcingEase = 6;
  } else {
    breakdown.sourcingEase = 2;
  }

  // 4. 옵션 단순성 (10점)
  if (input.optionCount <= 1) {
    breakdown.optionSimplicity = 10;
  } else if (input.optionCount <= 3) {
    breakdown.optionSimplicity = 8;
  } else if (input.optionCount <= 5) {
    breakdown.optionSimplicity = 5;
  } else if (input.optionCount <= 10) {
    breakdown.optionSimplicity = 3;
  } else {
    breakdown.optionSimplicity = 1;
  }

  // 5. 인증 안정성 (10점) — KC, 식품, 화장품 등 규제 여부
  const risk = analyzeRisks(input.title, input.price, input.reviewCount, input.rating, input.optionCount);
  const hasKc = risk.warnings.some(w => w.type === 'kc_cert');
  const hasRegulated = risk.warnings.some(w => w.type === 'regulated');
  if (!hasKc && !hasRegulated) {
    breakdown.certStability = 10;
  } else if (hasKc && !hasRegulated) {
    breakdown.certStability = 4;
  } else {
    breakdown.certStability = 1;
  }

  // 6. 배송 안정성 (10점) — 파손위험, 대형, 계절성
  const hasFragile = risk.warnings.some(w => w.type === 'fragile');
  const hasBulky = risk.warnings.some(w => w.type === 'bulky');
  const hasSeasonal = risk.warnings.some(w => w.type === 'seasonal');
  let deliverySub = 10;
  if (hasFragile) deliverySub -= 4;
  if (hasBulky) deliverySub -= 3;
  if (hasSeasonal) deliverySub -= 2;
  breakdown.deliveryStability = Math.max(0, deliverySub);

  // 7. 리뷰 잠재력 (5점) — 저평점 상품이 많으면 차별화 가능
  if (input.rating > 0 && input.rating < 3.5) {
    breakdown.reviewPotential = 5; // 기존 상품이 별로면 기회
  } else if (input.avgRating > 0 && input.avgRating < 4.0) {
    breakdown.reviewPotential = 4;
  } else if (input.reviewCount === 0) {
    breakdown.reviewPotential = 3; // 아직 리뷰 없으면 가능성
  } else {
    breakdown.reviewPotential = 2;
  }

  const total = Object.values(breakdown).reduce((s, v) => s + v, 0);

  // 등급 및 추천
  let grade: string, gradeLabel: string, recommendation: string;
  if (total >= 85) {
    grade = 'S'; gradeLabel = '초보추천'; recommendation = '초보 셀러에게 적극 추천하는 상품입니다!';
  } else if (total >= 70) {
    grade = 'A'; gradeLabel = '검토추천'; recommendation = '충분히 검토해볼 만한 상품입니다.';
  } else if (total >= 50) {
    grade = 'B'; gradeLabel = '경험자용'; recommendation = '경험 있는 셀러에게 적합합니다.';
  } else {
    grade = 'C'; gradeLabel = '비추천'; recommendation = '초보 셀러에게는 추천하지 않습니다.';
  }

  return { total, breakdown, grade, gradeLabel, recommendation };
}

// ============================================================
//  마진 계산
// ============================================================
interface MarginInput {
  salePrice: number;       // 쿠팡 판매가 (KRW)
  estimatedCnyCost?: number; // 중국 원가 (CNY) - optional
  exchangeRate?: number;    // 환율 (기본 190)
  shippingCost?: number;    // 국제 배송비 (KRW, 기본 3000)
  domesticShipping?: number; // 국내 배송비 (기본 3000)
  customsRate?: number;     // 관세율 (기본 8%)
  coupangFeeRate?: number;  // 쿠팡 수수료율 (기본 10.8%)
  adCostRate?: number;      // 광고비 비율 (기본 5%)
  returnRate?: number;      // 반품률 (기본 3%)
}

interface MarginResult {
  costKrw: number;
  shipping: number;
  domesticShipping: number;
  customs: number;
  totalCost: number;
  coupangFee: number;
  adCost: number;
  returnCost: number;
  profit: number;
  marginRate: number;
  advice: string;
  adviceType: 'good' | 'caution' | 'danger';
}

function calculateMargin(input: MarginInput): MarginResult {
  const exchangeRate = input.exchangeRate || 190;
  const shippingCost = input.shippingCost ?? 3000;
  const domesticShipping = input.domesticShipping ?? 3000;
  const customsRate = (input.customsRate ?? 8) / 100;
  const coupangFeeRate = (input.coupangFeeRate ?? 10.8) / 100;
  const adCostRate = (input.adCostRate ?? 5) / 100;
  const returnRate = (input.returnRate ?? 3) / 100;

  // 중국 원가 추정 (판매가의 15~25% 수준 = 일반적인 소싱 비율)
  const estimatedCnyCost = input.estimatedCnyCost ?? Math.round(input.salePrice * 0.15 / exchangeRate * 10) / 10;

  const costKrw = Math.round(estimatedCnyCost * exchangeRate);
  const customs = Math.round(costKrw * customsRate);
  const totalCost = costKrw + shippingCost + domesticShipping + customs;
  const coupangFee = Math.round(input.salePrice * coupangFeeRate);
  const adCost = Math.round(input.salePrice * adCostRate);
  const returnCost = Math.round(input.salePrice * returnRate);
  const profit = input.salePrice - totalCost - coupangFee - adCost - returnCost;
  const marginRate = input.salePrice > 0 ? Math.round((profit / input.salePrice) * 1000) / 10 : 0;

  let advice: string, adviceType: MarginResult['adviceType'];
  if (marginRate >= 35) {
    advice = '판매 가능 — 마진 여유 충분'; adviceType = 'good';
  } else if (marginRate >= 20) {
    advice = '판매 가능 — 마진 적정'; adviceType = 'good';
  } else if (marginRate >= 10) {
    advice = '주의 — 마진 낮음, 광고비 절감 필요'; adviceType = 'caution';
  } else if (marginRate >= 0) {
    advice = '경고 — 광고 시 손실 가능'; adviceType = 'danger';
  } else {
    advice = '위험 — 적자 예상, 소싱 비추천'; adviceType = 'danger';
  }

  return {
    costKrw, shipping: shippingCost, domesticShipping, customs,
    totalCost, coupangFee, adCost, returnCost,
    profit, marginRate, advice, adviceType,
  };
}

// ============================================================
//  소싱 뱃지 생성
// ============================================================
interface SourcingBadge {
  type: string;
  label: string;
  color: string;
  icon: string;
}

function generateBadges(
  scoreResult: SourcingScoreResult,
  marginResult: MarginResult,
  riskResult: RiskResult,
  item: { reviewCount: number; rating: number; isRocket: boolean; optionCount: number }
): SourcingBadge[] {
  const badges: SourcingBadge[] = [];

  // 소싱 용이도
  if (scoreResult.breakdown.sourcingEase >= 12) {
    badges.push({ type: 'easy_sourcing', label: '소싱쉬움', color: '#10b981', icon: '✅' });
  }

  // 마진
  if (marginResult.marginRate >= 35) {
    badges.push({ type: 'high_margin', label: '고마진', color: '#059669', icon: '💰' });
  } else if (marginResult.marginRate < 10) {
    badges.push({ type: 'low_margin', label: '저마진', color: '#ef4444', icon: '⚠️' });
  }

  // 경쟁
  if (scoreResult.breakdown.competition >= 16) {
    badges.push({ type: 'low_competition', label: '경쟁약함', color: '#3b82f6', icon: '🌊' });
  } else if (scoreResult.breakdown.competition <= 5) {
    badges.push({ type: 'high_competition', label: '경쟁심함', color: '#f97316', icon: '🔥' });
  }

  // 배송 주의
  if (riskResult.warnings.some(w => w.type === 'fragile' || w.type === 'bulky')) {
    badges.push({ type: 'shipping_caution', label: '배송주의', color: '#f59e0b', icon: '📦' });
  }

  // 옵션 복잡
  if (item.optionCount > 5) {
    badges.push({ type: 'complex_options', label: '옵션복잡', color: '#8b5cf6', icon: '🔧' });
  }

  // 인증 필요
  if (riskResult.warnings.some(w => w.type === 'kc_cert' || w.type === 'regulated')) {
    badges.push({ type: 'cert_needed', label: '인증필요', color: '#dc2626', icon: '📋' });
  }

  // 파손 위험
  if (riskResult.warnings.some(w => w.type === 'fragile')) {
    badges.push({ type: 'breakage_risk', label: '파손위험', color: '#d97706', icon: '💔' });
  }

  // 계절성
  if (riskResult.warnings.some(w => w.type === 'seasonal')) {
    badges.push({ type: 'seasonal', label: '계절상품', color: '#6366f1', icon: '🌡️' });
  }

  // 초보 추천
  if (scoreResult.total >= 85) {
    badges.push({ type: 'beginner_recommend', label: '초보추천', color: '#16a34a', icon: '🌟' });
  }

  return badges;
}

// ============================================================
//  AI 소싱 분석 엔진 (OpenAI / LLM 연동)
// ============================================================

/** WING 상품 데이터를 AI에 전송하기 위한 구조 */
interface WingProductForAI {
  rank: number;
  productName: string;
  price: number;
  rating: number;
  reviewCount: number;
  viewCount: number;
  brand: string;
  manufacturer: string;
  category: string;
  imageUrl: string;
}

/** AI 분석 결과 JSON 스키마 */
interface AISourcingAnalysis {
  overview: {
    marketSummary: string;
    competitionLevel: string;
    trendInsight: string;
    bestOpportunity: string;
  };
  products: Array<{
    rank: number;
    productName: string;
    purpose: string;
    sellingPoints: string[];
    beginnerFit: {
      score: number;
      reason: string;
      difficulty: 'easy' | 'medium' | 'hard' | 'expert';
    };
    risks: string[];
    keywords: {
      korean: string;
      chinese: string;
      english: string;
      excludeWords: string[];
    };
    margin: {
      estimatedCnyCost: string;
      expectedMarginRate: string;
      advice: string;
    };
    coachComment: string;
    badges: string[];
  }>;
  topRecommendations: Array<{
    rank: number;
    productName: string;
    reason: string;
    actionPlan: string;
  }>;
  searchSuggestions: {
    relatedKeywords: string[];
    avoidKeywords: string[];
    nicheSuggestion: string;
  };
}

/** 시스템 프롬프트: AI 소싱 코치 역할 정의 */
function buildSystemPrompt(): string {
  return `당신은 "쿠팡 AI 소싱 코치"입니다. 중국(1688/알리익스프레스)에서 소싱하여 쿠팡에서 판매하는 초보 셀러를 도와주는 전문 컨설턴트입니다.

역할:
- WING(쿠팡 셀러센터) 인기상품 검색 결과를 분석합니다.
- 각 상품의 용도, 핵심 포인트, 초보 적합도, 리스크, 소싱 키워드를 분석합니다.
- 한국어로 쉽게 설명하며, 초보 셀러가 바로 행동할 수 있는 구체적인 조언을 제공합니다.

분석 기준:
1. 마진: 판매가 대비 예상 소싱 원가, 배송비, 쿠팡 수수료(10.8%), 광고비(5%), 반품률(3%) 고려
2. 경쟁: 리뷰 수, 브랜드 파워, 광고 비율로 진입 난이도 평가
3. 소싱 용이도: 1688/알리에서 찾기 쉬운지, 중국어 키워드 존재 여부
4. 옵션 복잡도: 색상/사이즈 옵션이 많으면 재고 관리 어려움
5. 인증/규제: KC인증(전자제품), 식약처(화장품/식품), 위생허가 등 필요 여부
6. 배송 안정성: 파손위험(유리/세라믹), 대형 상품, 계절성
7. 리뷰 잠재력: 기존 상품 평점이 낮으면 차별화 기회

초보 추천 기준:
- 가격 15,000~50,000원 (마진 확보 최적)
- 리뷰 100개 미만 (진입 가능)
- 옵션 3개 이하 (관리 용이)
- KC인증 불필요 (규제 리스크 낮음)
- 파손 위험 낮음

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 절대 포함하지 마세요.`;
}

/** 사용자 프롬프트: WING 상품 데이터 포함 */
function buildUserPrompt(keyword: string, category: string, products: WingProductForAI[], marketStats: any): string {
  const productsSummary = products.slice(0, 15).map((p, i) => (
    `  ${i+1}. "${p.productName}" | 가격: ${p.price.toLocaleString()}원 | 평점: ${p.rating} | 리뷰: ${p.reviewCount}개 | 조회: ${p.viewCount} | 브랜드: ${p.brand || '없음'} | 제조사: ${p.manufacturer || '없음'} | 카테고리: ${p.category || '없음'}`
  )).join('\n');

  return `아래는 WING 인기상품검색 결과입니다. 분석해주세요.

검색 키워드: "${keyword}"
카테고리: "${category || '미지정'}"
총 상품 수: ${products.length}개

[시장 통계]
- 평균 가격: ${marketStats.avgPrice?.toLocaleString() || 0}원
- 평균 평점: ${marketStats.avgRating || 0}
- 평균 리뷰: ${marketStats.avgReview || 0}개
- 최저가: ${marketStats.minPrice?.toLocaleString() || 0}원
- 최고가: ${marketStats.maxPrice?.toLocaleString() || 0}원

[상품 목록]
${productsSummary}

아래 JSON 형식으로 응답하세요:
{
  "overview": {
    "marketSummary": "시장 한줄 요약 (한국어)",
    "competitionLevel": "낮음|보통|높음|매우높음",
    "trendInsight": "트렌드 분석 코멘트",
    "bestOpportunity": "최고의 기회 상품/전략"
  },
  "products": [
    {
      "rank": 1,
      "productName": "상품명",
      "purpose": "상품 용도/사용처 설명",
      "sellingPoints": ["핵심 셀링포인트1", "셀링포인트2"],
      "beginnerFit": {
        "score": 85,
        "reason": "초보 적합 이유",
        "difficulty": "easy|medium|hard|expert"
      },
      "risks": ["리스크1", "리스크2"],
      "keywords": {
        "korean": "한국어 핵심 키워드",
        "chinese": "中文搜索关键词",
        "english": "english search keywords",
        "excludeWords": ["제외할 단어"]
      },
      "margin": {
        "estimatedCnyCost": "예상 중국 원가 (CNY)",
        "expectedMarginRate": "예상 마진율 (%)",
        "advice": "마진 관련 조언"
      },
      "coachComment": "초보 셀러를 위한 한줄 코멘트",
      "badges": ["초보추천", "고마진", "소싱쉬움", ...]
    }
  ],
  "topRecommendations": [
    {
      "rank": 1,
      "productName": "추천 상품",
      "reason": "추천 이유",
      "actionPlan": "구체적 행동 계획"
    }
  ],
  "searchSuggestions": {
    "relatedKeywords": ["연관 키워드1", "연관 키워드2"],
    "avoidKeywords": ["피해야 할 키워드"],
    "nicheSuggestion": "니치 시장 제안"
  }
}

상위 ${Math.min(products.length, 10)}개 상품을 분석하세요. products 배열에 분석 결과를 포함하세요.
topRecommendations에는 초보 셀러에게 가장 추천하는 상위 3개 상품을 선정하세요.`;
}

/** AI 분석 호출 (invokeLLM 사용) */
async function callAISourcingAnalysis(
  keyword: string,
  category: string,
  products: WingProductForAI[],
  marketStats: any
): Promise<AISourcingAnalysis> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(keyword, category, products, marketStats);

  try {
    const result = await invokeLLM({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      responseFormat: { type: 'json_object' },
      maxTokens: 4096,
    });

    const content = result.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI 응답이 비어있습니다');

    const text = typeof content === 'string' ? content : (content as any)[0]?.text || '';
    return JSON.parse(text) as AISourcingAnalysis;
  } catch (aiError: any) {
    console.error('[AI Sourcing] LLM 호출 실패:', aiError.message);

    // OPENAI_API_KEY 폴백 시도
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.7,
            max_tokens: 4096,
            response_format: { type: 'json_object' },
          }),
        });
        if (res.ok) {
          const data = await res.json() as any;
          const content = data.choices?.[0]?.message?.content;
          if (content) return JSON.parse(content);
        }
      } catch (e2: any) {
        console.error('[AI Sourcing] OpenAI 폴백도 실패:', e2.message);
      }
    }

    // 최종 폴백: 규칙 기반 분석
    return generateRuleBasedAnalysis(keyword, category, products, marketStats);
  }
}

/** 규칙 기반 분석 (AI 실패 시 폴백) */
function generateRuleBasedAnalysis(
  keyword: string,
  category: string,
  products: WingProductForAI[],
  marketStats: any
): AISourcingAnalysis {
  const avgPrice = marketStats.avgPrice || 0;
  const avgReview = marketStats.avgReview || 0;
  const competitionLevel = avgReview > 500 ? '매우높음' : avgReview > 100 ? '높음' : avgReview > 30 ? '보통' : '낮음';

  const productAnalyses = products.slice(0, 10).map((p, idx) => {
    const kw = extractSmartKeywords(p.productName);
    const score = calcSourcingScore100({
      price: p.price,
      reviewCount: p.reviewCount,
      rating: p.rating,
      isAd: false,
      isRocket: false,
      optionCount: 0,
      title: p.productName,
      avgPrice,
      avgReview,
      avgRating: marketStats.avgRating || 0,
      adCount: 0,
      totalItems: products.length,
      highReviewRatio: marketStats.highReviewRatio || 0,
    });
    const margin = calculateMargin({ salePrice: p.price });
    const risk = analyzeRisks(p.productName, p.price, p.reviewCount, p.rating, 0);
    const badges: string[] = [];

    if (score.total >= 85) badges.push('초보추천');
    if (margin.marginRate >= 35) badges.push('고마진');
    if (margin.marginRate < 10) badges.push('저마진');
    if (score.breakdown.sourcingEase >= 12) badges.push('소싱쉬움');
    if (score.breakdown.competition >= 16) badges.push('경쟁약함');
    if (risk.warnings.some(w => w.type === 'kc_cert')) badges.push('인증필요');
    if (risk.warnings.some(w => w.type === 'fragile')) badges.push('파손위험');

    const difficulty: 'easy' | 'medium' | 'hard' | 'expert' =
      score.total >= 85 ? 'easy' : score.total >= 70 ? 'medium' : score.total >= 50 ? 'hard' : 'expert';

    return {
      rank: idx + 1,
      productName: p.productName,
      purpose: `${p.category || keyword} 관련 상품`,
      sellingPoints: [
        p.price >= 15000 && p.price <= 50000 ? '적정 가격대' : p.price > 50000 ? '고가 상품' : '저가 상품',
        p.reviewCount < 50 ? '진입 가능한 리뷰 수' : '리뷰 축적 필요',
      ],
      beginnerFit: {
        score: score.total,
        reason: score.recommendation,
        difficulty,
      },
      risks: risk.warnings.map(w => `${w.label}: ${w.description}`),
      keywords: {
        korean: kw.ko,
        chinese: kw.cn || '(사전 매칭 없음 — 1688에서 직접 검색 필요)',
        english: kw.en || '(영어 키워드 없음)',
        excludeWords: [],
      },
      margin: {
        estimatedCnyCost: `약 ${(margin.costKrw / 190).toFixed(1)} CNY`,
        expectedMarginRate: `${margin.marginRate}%`,
        advice: margin.advice,
      },
      coachComment: `${score.gradeLabel} (${score.total}점) — ${margin.advice}`,
      badges,
    };
  });

  // 초보 추천 상위 3개
  const sortedByScore = [...productAnalyses].sort((a, b) => b.beginnerFit.score - a.beginnerFit.score);
  const topRecs = sortedByScore.slice(0, 3).map((p, i) => ({
    rank: p.rank,
    productName: p.productName,
    reason: `소싱점수 ${p.beginnerFit.score}점, 마진 ${p.margin.expectedMarginRate}`,
    actionPlan: `1688에서 "${p.keywords.chinese || p.keywords.korean}" 검색 → 단가 비교 → 샘플 주문`,
  }));

  return {
    overview: {
      marketSummary: `"${keyword}" 시장: 평균가 ${avgPrice.toLocaleString()}원, 평균 리뷰 ${avgReview}개, 경쟁도 ${competitionLevel}`,
      competitionLevel,
      trendInsight: `${products.length}개 인기 상품 중 리뷰 100개 미만 상품이 ${products.filter(p => p.reviewCount < 100).length}개로 ${products.filter(p => p.reviewCount < 100).length > products.length / 2 ? '신규 진입 가능성이 있습니다.' : '경쟁이 치열합니다.'}`,
      bestOpportunity: topRecs.length > 0 ? `"${topRecs[0].productName}" — ${topRecs[0].reason}` : '분석 결과 없음',
    },
    products: productAnalyses,
    topRecommendations: topRecs,
    searchSuggestions: {
      relatedKeywords: [keyword, ...extractSmartKeywords(keyword).tokens].filter(Boolean),
      avoidKeywords: [],
      nicheSuggestion: '규칙 기반 분석입니다. AI 분석이 가능하면 더 정확한 니치 제안을 받을 수 있습니다.',
    },
  };
}

/** 단일 상품 AI 분석 */
async function callAISingleProduct(
  product: WingProductForAI,
  keyword: string,
  marketStats: any
): Promise<any> {
  const systemPrompt = `당신은 "쿠팡 AI 소싱 코치"입니다. 단일 상품을 분석하여 초보 셀러에게 소싱 조언을 제공합니다.
반드시 JSON 형식으로만 응답하세요.`;

  const userPrompt = `상품을 분석해주세요.

검색 키워드: "${keyword}"
상품명: "${product.productName}"
가격: ${product.price.toLocaleString()}원
평점: ${product.rating}
리뷰: ${product.reviewCount}개
조회수: ${product.viewCount}
브랜드: ${product.brand || '없음'}
카테고리: ${product.category || '없음'}

시장 평균가: ${marketStats.avgPrice?.toLocaleString() || 0}원
시장 평균 리뷰: ${marketStats.avgReview || 0}개

아래 JSON 형식으로 응답하세요:
{
  "purpose": "상품 용도 설명",
  "sellingPoints": ["포인트1", "포인트2", "포인트3"],
  "beginnerFit": {
    "score": 0-100,
    "reason": "이유",
    "difficulty": "easy|medium|hard|expert"
  },
  "risks": ["리스크1", "리스크2"],
  "keywords": {
    "korean": "한국어 키워드",
    "chinese": "中文关键词",
    "english": "english keywords",
    "excludeWords": ["제외어"]
  },
  "margin": {
    "estimatedCnyCost": "CNY 예상",
    "expectedMarginRate": "마진율%",
    "advice": "마진 조언"
  },
  "coachComment": "초보 셀러를 위한 종합 조언 (2~3문장)",
  "badges": ["뱃지1", "뱃지2"]
}`;

  try {
    const result = await invokeLLM({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      responseFormat: { type: 'json_object' },
      maxTokens: 2048,
    });

    const content = result.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI 응답이 비어있습니다');
    const text = typeof content === 'string' ? content : (content as any)[0]?.text || '';
    return JSON.parse(text);
  } catch (e: any) {
    console.error('[AI Sourcing] 단일 상품 분석 실패:', e.message);
    return null; // 폴백은 호출자가 처리
  }
}

// ============================================================
//  tRPC Router
// ============================================================

export const sourcingCoachRouter = router({
  // 단일 상품 분석
  analyzeProduct: publicProcedure
    .input(z.object({
      title: z.string(),
      price: z.number().int(),
      reviewCount: z.number().int().default(0),
      rating: z.number().default(0),
      isAd: z.boolean().default(false),
      isRocket: z.boolean().default(false),
      optionCount: z.number().int().default(0),
      imageUrl: z.string().optional(),
      categoryPath: z.string().optional(),
      // 시장 평균
      avgPrice: z.number().int().default(0),
      avgReview: z.number().int().default(0),
      avgRating: z.number().default(0),
      adCount: z.number().int().default(0),
      totalItems: z.number().int().default(0),
      highReviewRatio: z.number().int().default(0),
    }))
    .mutation(async ({ input }) => {
      // 키워드 추출
      const keywords = extractSmartKeywords(input.title);

      // 소싱 점수
      const score = calcSourcingScore100({
        price: input.price,
        reviewCount: input.reviewCount,
        rating: input.rating,
        isAd: input.isAd,
        isRocket: input.isRocket,
        optionCount: input.optionCount,
        title: input.title,
        avgPrice: input.avgPrice,
        avgReview: input.avgReview,
        avgRating: input.avgRating,
        adCount: input.adCount,
        totalItems: input.totalItems,
        highReviewRatio: input.highReviewRatio,
      });

      // 마진 추정
      const margin = calculateMargin({ salePrice: input.price });

      // 리스크 분석
      const risk = analyzeRisks(input.title, input.price, input.reviewCount, input.rating, input.optionCount, input.categoryPath);

      // 뱃지 생성
      const badges = generateBadges(score, margin, risk, {
        reviewCount: input.reviewCount,
        rating: input.rating,
        isRocket: input.isRocket,
        optionCount: input.optionCount,
      });

      return {
        keywords,
        score,
        margin,
        risk,
        badges,
      };
    }),

  // 일괄 분석 (검색 결과 전체)
  analyzeBatch: publicProcedure
    .input(z.object({
      items: z.array(z.object({
        productId: z.string().optional(),
        title: z.string(),
        price: z.number().int(),
        reviewCount: z.number().int().default(0),
        rating: z.number().default(0),
        isAd: z.boolean().default(false),
        isRocket: z.boolean().default(false),
        optionCount: z.number().int().default(0),
        imageUrl: z.string().optional(),
      })),
      query: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const items = input.items;
      if (!items.length) return { results: [] };

      // 시장 통계 계산
      const prices = items.map(i => i.price).filter(p => p > 0);
      const reviews = items.map(i => i.reviewCount);
      const ratings = items.map(i => i.rating).filter(r => r > 0);
      const avgPrice = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
      const avgReview = reviews.length ? Math.round(reviews.reduce((a, b) => a + b, 0) / reviews.length) : 0;
      const avgRating = ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : 0;
      const adCount = items.filter(i => i.isAd).length;
      const totalItems = items.length;
      const highReviewCount = items.filter(i => i.reviewCount >= 100).length;
      const highReviewRatio = totalItems ? Math.round((highReviewCount / totalItems) * 100) : 0;

      const results = items.map(item => {
        const keywords = extractSmartKeywords(item.title);
        const score = calcSourcingScore100({
          price: item.price,
          reviewCount: item.reviewCount,
          rating: item.rating,
          isAd: item.isAd,
          isRocket: item.isRocket,
          optionCount: item.optionCount,
          title: item.title,
          avgPrice, avgReview, avgRating, adCount, totalItems, highReviewRatio,
        });
        const margin = calculateMargin({ salePrice: item.price });
        const risk = analyzeRisks(item.title, item.price, item.reviewCount, item.rating, item.optionCount);
        const badges = generateBadges(score, margin, risk, {
          reviewCount: item.reviewCount,
          rating: item.rating,
          isRocket: item.isRocket,
          optionCount: item.optionCount,
        });

        return {
          productId: item.productId,
          keywords,
          score,
          margin,
          risk,
          badges,
        };
      });

      return {
        results,
        marketStats: {
          avgPrice, avgReview, avgRating, adCount, totalItems, highReviewRatio,
        },
      };
    }),

  // 키워드 생성 (단일 상품명)
  generateKeywords: publicProcedure
    .input(z.object({ title: z.string() }))
    .query(({ input }) => {
      return extractSmartKeywords(input.title);
    }),

  // 마진 계산
  calculateMargin: publicProcedure
    .input(z.object({
      salePrice: z.number().int(),
      estimatedCnyCost: z.number().optional(),
      exchangeRate: z.number().optional(),
      shippingCost: z.number().optional(),
      domesticShipping: z.number().optional(),
      customsRate: z.number().optional(),
      coupangFeeRate: z.number().optional(),
      adCostRate: z.number().optional(),
      returnRate: z.number().optional(),
    }))
    .query(({ input }) => {
      return calculateMargin(input);
    }),

  // 리스크 분석
  analyzeRisk: publicProcedure
    .input(z.object({
      title: z.string(),
      price: z.number().int(),
      reviewCount: z.number().int().default(0),
      rating: z.number().default(0),
      optionCount: z.number().int().default(0),
      categoryPath: z.string().optional(),
    }))
    .query(({ input }) => {
      return analyzeRisks(input.title, input.price, input.reviewCount, input.rating, input.optionCount, input.categoryPath);
    }),

  // 현재 환율 가져오기
  getExchangeRate: publicProcedure
    .query(async () => {
      try {
        const resp = await fetch('https://open.er-api.com/v6/latest/CNY');
        const data = await resp.json() as any;
        if (data?.rates?.KRW) {
          return { rate: Math.round(data.rates.KRW), source: 'er-api.com', updatedAt: new Date().toISOString() };
        }
        return { rate: 190, source: 'fallback', updatedAt: new Date().toISOString() };
      } catch {
        return { rate: 190, source: 'fallback', updatedAt: new Date().toISOString() };
      }
    }),

  // ============================================================
  //  AI 소싱 분석 엔드포인트 (WING 인기상품)
  // ============================================================

  // WING 인기상품 AI 일괄 분석
  aiAnalyzeWing: publicProcedure
    .input(z.object({
      keyword: z.string(),
      category: z.string().optional().default(''),
      products: z.array(z.object({
        rank: z.number().int().default(0),
        productName: z.string(),
        price: z.number().int().default(0),
        rating: z.number().default(0),
        reviewCount: z.number().int().default(0),
        viewCount: z.number().int().default(0),
        brand: z.string().optional().default(''),
        manufacturer: z.string().optional().default(''),
        category: z.string().optional().default(''),
        imageUrl: z.string().optional().default(''),
      })),
    }))
    .mutation(async ({ input }) => {
      const { keyword, category, products } = input;
      if (!products.length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '분석할 상품이 없습니다.' });
      }

      // 시장 통계 계산
      const prices = products.map(p => p.price).filter(p => p > 0);
      const reviews = products.map(p => p.reviewCount);
      const ratings = products.map(p => p.rating).filter(r => r > 0);
      const marketStats = {
        avgPrice: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0,
        avgReview: reviews.length ? Math.round(reviews.reduce((a, b) => a + b, 0) / reviews.length) : 0,
        avgRating: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : 0,
        minPrice: prices.length ? Math.min(...prices) : 0,
        maxPrice: prices.length ? Math.max(...prices) : 0,
        highReviewRatio: products.length ? Math.round((products.filter(p => p.reviewCount >= 100).length / products.length) * 100) : 0,
        totalItems: products.length,
      };

      // AI 분석 호출
      const analysis = await callAISourcingAnalysis(keyword, category, products, marketStats);

      // 각 상품에 규칙 기반 점수/마진도 병합 (AI 결과와 함께 제공)
      const enrichedProducts = analysis.products.map((aiProduct, idx) => {
        const originalProduct = products.find(p => p.rank === aiProduct.rank) || products[idx];
        const ruleKeywords = originalProduct ? extractSmartKeywords(originalProduct.productName) : null;
        const ruleScore = originalProduct ? calcSourcingScore100({
          price: originalProduct.price,
          reviewCount: originalProduct.reviewCount,
          rating: originalProduct.rating,
          isAd: false,
          isRocket: false,
          optionCount: 0,
          title: originalProduct.productName,
          avgPrice: marketStats.avgPrice,
          avgReview: marketStats.avgReview,
          avgRating: marketStats.avgRating,
          adCount: 0,
          totalItems: products.length,
          highReviewRatio: marketStats.highReviewRatio,
        }) : null;
        const ruleMargin = originalProduct ? calculateMargin({ salePrice: originalProduct.price }) : null;
        const ruleRisk = originalProduct ? analyzeRisks(originalProduct.productName, originalProduct.price, originalProduct.reviewCount, originalProduct.rating, 0) : null;

        return {
          ...aiProduct,
          ruleBasedScore: ruleScore,
          ruleBasedMargin: ruleMargin,
          ruleBasedRisk: ruleRisk,
          ruleBasedKeywords: ruleKeywords,
        };
      });

      return {
        success: true,
        aiPowered: true,
        keyword,
        category,
        marketStats,
        overview: analysis.overview,
        products: enrichedProducts,
        topRecommendations: analysis.topRecommendations,
        searchSuggestions: analysis.searchSuggestions,
        analyzedAt: new Date().toISOString(),
      };
    }),

  // 단일 WING 상품 AI 분석
  aiAnalyzeWingProduct: publicProcedure
    .input(z.object({
      keyword: z.string(),
      product: z.object({
        rank: z.number().int().default(0),
        productName: z.string(),
        price: z.number().int().default(0),
        rating: z.number().default(0),
        reviewCount: z.number().int().default(0),
        viewCount: z.number().int().default(0),
        brand: z.string().optional().default(''),
        manufacturer: z.string().optional().default(''),
        category: z.string().optional().default(''),
        imageUrl: z.string().optional().default(''),
      }),
      marketStats: z.object({
        avgPrice: z.number().int().default(0),
        avgReview: z.number().int().default(0),
        avgRating: z.number().default(0),
      }).optional(),
    }))
    .mutation(async ({ input }) => {
      const { keyword, product, marketStats } = input;
      const stats = marketStats || { avgPrice: product.price, avgReview: product.reviewCount, avgRating: product.rating };

      // AI 분석 시도
      const aiResult = await callAISingleProduct(product, keyword, stats);

      // 규칙 기반 분석 (항상 실행, AI 결과와 병합)
      const ruleKeywords = extractSmartKeywords(product.productName);
      const ruleScore = calcSourcingScore100({
        price: product.price,
        reviewCount: product.reviewCount,
        rating: product.rating,
        isAd: false,
        isRocket: false,
        optionCount: 0,
        title: product.productName,
        avgPrice: stats.avgPrice,
        avgReview: stats.avgReview,
        avgRating: stats.avgRating,
        adCount: 0,
        totalItems: 1,
        highReviewRatio: product.reviewCount >= 100 ? 100 : 0,
      });
      const ruleMargin = calculateMargin({ salePrice: product.price });
      const ruleRisk = analyzeRisks(product.productName, product.price, product.reviewCount, product.rating, 0);
      const ruleBadges = generateBadges(ruleScore, ruleMargin, ruleRisk, {
        reviewCount: product.reviewCount,
        rating: product.rating,
        isRocket: false,
        optionCount: 0,
      });

      return {
        success: true,
        aiPowered: !!aiResult,
        keyword,
        product: product.productName,
        // AI 분석 결과 (있으면)
        aiAnalysis: aiResult || null,
        // 규칙 기반 분석 결과 (항상)
        ruleBasedScore: ruleScore,
        ruleBasedMargin: ruleMargin,
        ruleBasedRisk: ruleRisk,
        ruleBasedKeywords: ruleKeywords,
        ruleBasedBadges: ruleBadges,
        analyzedAt: new Date().toISOString(),
      };
    }),
});
