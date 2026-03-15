/* ============================================================
   Coupang Sourcing Helper — Shared Utilities & Sourcing Coach
   공통 상태, DOM 헬퍼, 유틸, 소싱 코치, 스마트 키워드 매칭, 소싱 팝업
   ============================================================ */

// ---- State ----
let currentData = null;
let currentItems = [];
let lastActiveTabId = null;
let coachResults = null; // 소싱 코치 분석 결과 캐시
let currentAIAnalysis = null; // AI 분석 결과 캐시
let currentWingEntry = null; // 현재 선택된 WING 검색 결과

// ---- DOM refs ----
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// URL에서 검색어 추출 (사이드패널 내부 검증용)
function extractQueryFromUrl(url) {
  try {
    const u = new URL(url);
    return u.searchParams.get('q') || u.searchParams.get('query') || u.searchParams.get('keyword') || '';
  } catch (e) { return ''; }
}

// ============================================================
//  유틸
// ============================================================

function formatPrice(n) {
  if (!n) return '-';
  return n.toLocaleString('ko-KR') + '원';
}

function calcSourcingScore(item, avgPrice, avgReview) {
  let score = 50;
  if (item.reviewCount === 0) score += 25;
  else if (item.reviewCount < 10) score += 20;
  else if (item.reviewCount < 50) score += 10;
  else if (item.reviewCount < 100) score += 5;
  else if (item.reviewCount > 500) score -= 15;
  else if (item.reviewCount > 1000) score -= 25;
  if (item.rating > 0 && item.rating < 3.5) score += 10;
  else if (item.rating >= 4.5) score -= 5;
  if (avgPrice > 0 && item.price > 0) {
    const priceRatio = item.price / avgPrice;
    if (priceRatio > 1.3) score += 15;
    else if (priceRatio > 1.1) score += 8;
    else if (priceRatio < 0.7) score -= 10;
  }
  if (item.isAd) score -= 10;
  if (item.isRocket) score -= 5;
  return Math.max(0, Math.min(100, score));
}

function getSourcingGrade(score) {
  if (score >= 80) return { grade: 'A', label: '매우 좋음', cls: 'grade-a' };
  if (score >= 65) return { grade: 'B', label: '좋음', cls: 'grade-b' };
  if (score >= 50) return { grade: 'C', label: '보통', cls: 'grade-c' };
  if (score >= 35) return { grade: 'D', label: '어려움', cls: 'grade-d' };
  return { grade: 'F', label: '매우 어려움', cls: 'grade-f' };
}

// ============================================================
//  소싱 코치: 100점 만점 점수 · 마진 · 리스크 · 뱃지 (로컬 폴백)
// ============================================================

const KC_WORDS = new Set(['전기','전자','충전기','어댑터','배터리','보조배터리','콘센트','멀티탭','히터','선풍기','가습기','제습기','공기청정기','LED','조명','램프','전구','드라이기','고데기','다리미','에어프라이어','전기포트','토스터','믹서기','전기밥솥','블루투스','이어폰','헤드폰','스피커','블랙박스','마사지기']);
const REGULATED_WORDS = new Set(['식품','간식','과자','음료','건강식품','영양제','비타민','화장품','스킨케어','립스틱','파운데이션','선크림','로션','크림','세럼','토너','클렌징','마스크팩','의약품']);
const SEASONAL_MAP = {'선풍기':'여름','에어컨':'여름','냉풍기':'여름','수영복':'여름','히터':'겨울','핫팩':'겨울','패딩':'겨울','장갑':'겨울','크리스마스':'겨울','스키':'겨울'};
const FRAGILE_WORDS = new Set(['유리','도자기','세라믹','크리스탈','거울','화분','액자','접시','그릇','머그컵','와인잔']);
const BULKY_WORDS = new Set(['캠핑테이블','텐트','자전거','킥보드','유모차','매트리스','침대','책상','의자','수납장','미니냉장고']);

function calcScore100(item, market) {
  const bd = {margin:0,competition:0,sourcingEase:0,optionSimplicity:0,certStability:0,deliveryStability:0,reviewPotential:0};
  if (item.price >= 20000 && item.price <= 50000) bd.margin = 30;
  else if (item.price >= 15000 && item.price <= 80000) bd.margin = 25;
  else if (item.price >= 10000) bd.margin = 18;
  else if (item.price >= 5000) bd.margin = 10;
  else bd.margin = 3;
  if (market.avgPrice > 0 && item.price > market.avgPrice * 1.2) bd.margin = Math.min(30, bd.margin + 5);

  if (item.reviewCount === 0) bd.competition = 20;
  else if (item.reviewCount < 10) bd.competition = 18;
  else if (item.reviewCount < 50) bd.competition = 14;
  else if (item.reviewCount < 100) bd.competition = 10;
  else if (item.reviewCount < 500) bd.competition = 5;
  else bd.competition = 2;
  if (market.highReviewRatio < 20) bd.competition = Math.min(20, bd.competition + 3);

  const kw = extractSmartKeyword(item.title);
  if (kw.cn) bd.sourcingEase = 15;
  else if (kw.en) bd.sourcingEase = 10;
  else if (kw.ko) bd.sourcingEase = 6;
  else bd.sourcingEase = 2;

  const oc = item.optionCount || 0;
  if (oc <= 1) bd.optionSimplicity = 10; else if (oc <= 3) bd.optionSimplicity = 8; else if (oc <= 5) bd.optionSimplicity = 5; else if (oc <= 10) bd.optionSimplicity = 3; else bd.optionSimplicity = 1;

  const tks = (item.title || '').split(/\s+/);
  const hasKc = tks.some(t => KC_WORDS.has(t));
  const hasReg = tks.some(t => REGULATED_WORDS.has(t));
  if (!hasKc && !hasReg) bd.certStability = 10; else if (hasKc && !hasReg) bd.certStability = 4; else bd.certStability = 1;

  let del = 10;
  if (tks.some(t => FRAGILE_WORDS.has(t))) del -= 4;
  if (tks.some(t => BULKY_WORDS.has(t))) del -= 3;
  if (tks.some(t => SEASONAL_MAP[t])) del -= 2;
  bd.deliveryStability = Math.max(0, del);

  if (item.rating > 0 && item.rating < 3.5) bd.reviewPotential = 5;
  else if (market.avgRating > 0 && market.avgRating < 4.0) bd.reviewPotential = 4;
  else if (item.reviewCount === 0) bd.reviewPotential = 3;
  else bd.reviewPotential = 2;

  const total = Object.values(bd).reduce((s, v) => s + v, 0);
  let grade, gradeLabel, cls;
  if (total >= 85) { grade = 'S'; gradeLabel = '초보추천'; cls = 'coach-grade-s'; }
  else if (total >= 70) { grade = 'A'; gradeLabel = '검토추천'; cls = 'coach-grade-a'; }
  else if (total >= 50) { grade = 'B'; gradeLabel = '경험자용'; cls = 'coach-grade-b'; }
  else { grade = 'C'; gradeLabel = '비추천'; cls = 'coach-grade-c'; }
  return { total, breakdown: bd, grade, gradeLabel, cls };
}

function estimateMargin(price) {
  if (!price || price <= 0) return { marginRate: 0, advice: '-', adviceType: 'danger', profit: 0, tooltip: '' };
  let costRatio;
  if (price >= 50000) costRatio = 0.12;
  else if (price >= 20000) costRatio = 0.15;
  else if (price >= 10000) costRatio = 0.18;
  else if (price >= 5000) costRatio = 0.22;
  else costRatio = 0.30;

  const rate = 190;
  const estimatedCostKrw = Math.round(price * costRatio);
  const cnyCost = Math.round(estimatedCostKrw / rate * 10) / 10;
  const shipping = 3000;
  const domestic = 3000;
  const customs = Math.round(estimatedCostKrw * 0.08);
  const totalCost = estimatedCostKrw + shipping + domestic + customs;
  const coupangFee = Math.round(price * 0.108);
  const adFee = Math.round(price * 0.05);
  const etcFee = Math.round(price * 0.03);
  const fees = coupangFee + adFee + etcFee;
  const profit = price - totalCost - fees;
  const marginRate = Math.round((profit / price) * 1000) / 10;
  let advice, adviceType;
  if (marginRate >= 35) { advice = '마진 여유'; adviceType = 'good'; }
  else if (marginRate >= 20) { advice = '마진 적정'; adviceType = 'good'; }
  else if (marginRate >= 10) { advice = '마진 낮음'; adviceType = 'caution'; }
  else if (marginRate >= 0) { advice = '광고 시 손실'; adviceType = 'danger'; }
  else { advice = '적자 예상'; adviceType = 'danger'; }
  const tooltip = `추정 원가: ~${estimatedCostKrw.toLocaleString()}원 (판매가의 ${Math.round(costRatio*100)}%)\n국제배송: ${shipping.toLocaleString()}원 | 국내: ${domestic.toLocaleString()}원\n관세: ${customs.toLocaleString()}원 | 수수료: ${fees.toLocaleString()}원\n총 비용: ${(totalCost+fees).toLocaleString()}원\n추정 이익: ${profit.toLocaleString()}원\n※ 1688 원가 미정 시 추정치입니다`;
  return { marginRate, advice, adviceType, profit, tooltip };
}

function analyzeRiskLocal(item) {
  const warnings = [];
  let rs = 0;
  const tks = (item.title || '').split(/\s+/);
  for (const t of tks) { if (KC_WORDS.has(t)) { warnings.push({type:'kc_cert',label:'인증필요',severity:'danger',icon:'📋'}); rs += 20; break; } }
  for (const t of tks) { if (REGULATED_WORDS.has(t)) { warnings.push({type:'regulated',label:'규제품목',severity:'danger',icon:'⚠️'}); rs += 25; break; } }
  for (const t of tks) { if (SEASONAL_MAP[t]) { warnings.push({type:'seasonal',label:'계절상품',severity:'warn',icon:'🌡️'}); rs += 10; break; } }
  for (const t of tks) { if (FRAGILE_WORDS.has(t)) { warnings.push({type:'fragile',label:'파손위험',severity:'warn',icon:'💔'}); rs += 12; break; } }
  for (const t of tks) { if (BULKY_WORDS.has(t)) { warnings.push({type:'bulky',label:'대형상품',severity:'warn',icon:'📦'}); rs += 10; break; } }
  if ((item.optionCount||0) > 10) { warnings.push({type:'many_options',label:'옵션복잡',severity:'warn',icon:'🔧'}); rs += 8; }
  if (item.reviewCount > 1000) { warnings.push({type:'high_review',label:'리뷰장벽',severity:'danger',icon:'🏔️'}); rs += 15; }
  if (item.price > 0 && item.price < 5000) { warnings.push({type:'low_price',label:'저가상품',severity:'warn',icon:'💸'}); rs += 10; }
  rs = Math.min(100, rs);
  const level = rs >= 40 ? 'critical' : rs >= 25 ? 'high' : rs >= 10 ? 'medium' : 'low';
  return { level, score: rs, warnings };
}

function generateBadgesLocal(s100, margin, risk, item) {
  const badges = [];
  if (s100.breakdown.sourcingEase >= 12) badges.push({label:'소싱쉬움',color:'#10b981',icon:'✅'});
  if (margin.marginRate >= 35) badges.push({label:'고마진',color:'#059669',icon:'💰'});
  else if (margin.marginRate < 10) badges.push({label:'저마진',color:'#ef4444',icon:'⚠️'});
  if (s100.breakdown.competition >= 16) badges.push({label:'경쟁약함',color:'#3b82f6',icon:'🌊'});
  else if (s100.breakdown.competition <= 5) badges.push({label:'경쟁심함',color:'#f97316',icon:'🔥'});
  if (risk.warnings.some(w => w.type === 'fragile' || w.type === 'bulky')) badges.push({label:'배송주의',color:'#f59e0b',icon:'📦'});
  if ((item.optionCount||0) > 5) badges.push({label:'옵션복잡',color:'#8b5cf6',icon:'🔧'});
  if (risk.warnings.some(w => w.type === 'kc_cert' || w.type === 'regulated')) badges.push({label:'인증필요',color:'#dc2626',icon:'📋'});
  if (risk.warnings.some(w => w.type === 'seasonal')) badges.push({label:'계절상품',color:'#6366f1',icon:'🌡️'});
  if (s100.total >= 85) badges.push({label:'초보추천',color:'#16a34a',icon:'🌟'});
  return badges;
}

// 서버 또는 로컬로 소싱 코치 분석
async function runCoachAnalysis(items, query) {
  if (!items?.length) { coachResults = null; return null; }
  const prices = items.map(i => i.price).filter(p => p > 0);
  const reviews = items.map(i => i.reviewCount || 0);
  const ratings = items.map(i => i.rating).filter(r => r > 0);
  const avgPrice = prices.length ? Math.round(prices.reduce((a,b)=>a+b,0)/prices.length) : 0;
  const avgReview = reviews.length ? Math.round(reviews.reduce((a,b)=>a+b,0)/reviews.length) : 0;
  const avgRating = ratings.length ? Math.round((ratings.reduce((a,b)=>a+b,0)/ratings.length)*10)/10 : 0;
  const highReviewRatio = items.length ? Math.round((items.filter(i=>(i.reviewCount||0)>=100).length/items.length)*100) : 0;
  const market = {avgPrice, avgReview, avgRating, highReviewRatio, totalItems:items.length, adCount:items.filter(i=>i.isAd).length};

  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'SOURCING_ANALYZE_BATCH',
      data: {
        items: items.slice(0,36).map(i=>({productId:i.productId||'',title:i.title||'',price:i.price||0,reviewCount:i.reviewCount||0,rating:i.rating||0,isAd:!!i.isAd,isRocket:!!i.isRocket,optionCount:i.optionCount||0,imageUrl:i.imageUrl||''})),
        query: query || '',
      }
    });
    if (resp?.ok && resp.data?.results) {
      const rm = {};
      for (const r of resp.data.results) { if (r.productId) rm[r.productId] = r; }
      coachResults = rm;
      return rm;
    }
  } catch (e) { /* 서버 실패 */ }

  const rm = {};
  for (const item of items) {
    const s100 = calcScore100(item, market);
    const mg = estimateMargin(item.price || 0);
    const rk = analyzeRiskLocal(item);
    const kw = extractSmartKeyword(item.title);
    const bg = generateBadgesLocal(s100, mg, rk, item);
    rm[item.productId || item.url] = { score: s100, margin: mg, risk: rk, keywords: kw, badges: bg };
  }
  coachResults = rm;
  return rm;
}

function extractKeyword(title) {
  if (!title) return '';
  let cleaned = title.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').replace(/[^\uAC00-\uD7A3a-zA-Z0-9\s]/g, '').trim();
  const words = cleaned.split(/\s+/).filter(w => w.length > 1);
  return words.slice(0, 4).join(' ');
}

// ============================================================
//  스마트 소싱 매칭 시스템 (1688 매칭율 개선)
// ============================================================

const NOISE_WORDS = new Set([
  '1개', '2개', '3개', '4개', '5개', '6개', '7개', '8개', '9개', '10개',
  '1P', '2P', '3P', '4P', '5P', '1p', '2p', '3p',
  '1팩', '2팩', '3팩', '1세트', '2세트', '3세트', '1박스', '2박스',
  '1+1', '2+1', '3+1', '1개입', '2개입', '5개입', '10개입', '20개입',
  '무료배송', '당일발송', '국내배송', '무료반품', '최저가', '특가', '세일',
  '할인', '초특가', '빅세일', '핫딜', '타임딜', '쿠폰', '적립',
  '인기', '추천', '베스트', 'BEST', 'HOT', 'NEW', 'SALE',
  '고급', '프리미엄', '럭셔리', '대용량', '소용량', '미니', '슬림',
  '정품', '국내정품', '수입정품', '공식', '공식판매', '정식수입',
  'S', 'M', 'L', 'XL', 'XXL', 'FREE', 'Free',
  'ml', 'ML', 'g', 'kg', 'KG', 'cm', 'mm', 'oz',
  '블랙', '화이트', '그레이', '네이비', '베이지', '브라운', '핑크',
  '레드', '블루', '그린', '옐로우', '퍼플', '오렌지',
]);

const KO_TO_CN = {
  '텀블러': '保温杯', '물병': '水杯', '보온병': '保温瓶', '컵': '杯子',
  '수건': '毛巾', '타올': '毛巾', '목욕': '沐浴', '비누': '肥皂',
  '치약': '牙膏', '칫솔': '牙刷', '면도기': '剃须刀',
  '빗': '梳子', '거울': '镜子', '바구니': '篮子', '정리함': '收纳盒',
  '수납': '收纳', '선반': '架子', '후크': '挂钩', '행거': '衣架',
  '수세미': '百洁布', '스펀지': '海绵', '솔': '刷子', '청소': '清洁',
  '걸레': '拖把', '먼지': '灰尘', '먼지떨이': '鸡毛掸子', '빗자루': '扫帚',
  '쓰레받기': '簸箕', '세제': '洗涤剂', '세탁': '洗衣', '표백': '漂白',
  '락스': '漂白剂', '스크럽': '百洁刷', '행주': '抹布', '극세사': '超细纤维',
  '다용도': '多用途', '실리콘': '硅胶', '세척': '清洗',
  '냄비': '锅', '프라이팬': '平底锅', '도마': '砧板', '칼': '刀',
  '접시': '盘子', '그릇': '碗', '젓가락': '筷子', '숟가락': '勺子',
  '밀폐용기': '密封盒', '보관용기': '保鲜盒', '물통': '水壶',
  '주전자': '水壶', '커피': '咖啡', '차': '茶', '머그컵': '马克杯',
  '충전기': '充电器', '케이블': '数据线', '이어폰': '耳机', '헤드폰': '头戴耳机',
  '블루투스': '蓝牙', '스피커': '音箱', '마우스': '鼠标', '키보드': '键盘',
  '보조배터리': '充电宝', '거치대': '支架', '핸드폰': '手机',
  '케이스': '手机壳', '필름': '贴膜', '보호필름': '保护膜',
  '무선충전': '无线充电', 'USB': 'USB', 'LED': 'LED',
  '조명': '照明', '램프': '灯', '스탠드': '台灯', '전구': '灯泡',
  '티셔츠': 'T恤', '반팔': '短袖', '긴팔': '长袖', '맨투맨': '卫衣',
  '후드': '连帽衫', '자켓': '夹克', '점퍼': '外套', '코트': '大衣',
  '바지': '裤子', '청바지': '牛仔裤', '반바지': '短裤', '레깅스': '打底裤',
  '치마': '裙子', '원피스': '连衣裙', '블라우스': '衬衫',
  '양말': '袜子', '속옷': '内衣', '브래지어': '文胸', '팬티': '内裤',
  '모자': '帽子', '벨트': '腰带', '장갑': '手套', '스카프': '围巾',
  '가방': '包', '백팩': '双肩包', '크로스백': '斜挎包', '지갑': '钱包',
  '신발': '鞋', '운동화': '运动鞋', '슬리퍼': '拖鞋', '샌들': '凉鞋',
  '부츠': '靴子', '구두': '皮鞋',
  '목걸이': '项链', '반지': '戒指', '팔찌': '手链', '귀걸이': '耳环',
  '선글라스': '太阳镜', '안경': '眼镜', '시계': '手表', '헤어밴드': '发带',
  '머리끈': '发绳', '핀': '发夹',
  '립스틱': '口红', '파운데이션': '粉底', '쿠션': '气垫', '마스카라': '睫毛膏',
  '아이라이너': '眼线笔', '로션': '乳液', '크림': '面霜', '세럼': '精华',
  '선크림': '防晒霜', '클렌징': '洁面', '마스크팩': '面膜', '토너': '爽肤水',
  '샴푸': '洗发水', '린스': '护发素', '바디워시': '沐浴露',
  '장난감': '玩具', '인형': '玩偶', '블록': '积木', '레고': '积木',
  '퍼즐': '拼图', '스티커': '贴纸', '색칠': '涂色', '크레파스': '蜡笔',
  '기저귀': '尿不湿', '젖병': '奶瓶', '유모차': '婴儿车',
  '사료': '宠物粮', '간식': '零食', '목줄': '牵引绳',
  '방석': '坐垫', '매트': '垫子',
  '펜': '笔', '볼펜': '圆珠笔', '노트': '笔记本', '다이어리': '日记本',
  '테이프': '胶带', '가위': '剪刀', '풀': '胶水', '파일': '文件夹',
  '스탬프': '印章',
  '요가매트': '瑜伽垫', '아령': '哑铃', '운동': '运动', '헬스': '健身',
  '자전거': '自行车', '텐트': '帐篷', '캠핑': '露营',
  '등산': '登山', '수영': '游泳', '낚시': '钓鱼',
  '차량용': '车载', '핸들커버': '方向盘套', '시트커버': '座椅套',
  '방향제': '香薰', '세차': '洗车', '와이퍼': '雨刷',
  '커튼': '窗帘', '쿠션': '靠垫', '러그': '地毯', '이불': '被子',
  '베개': '枕头', '침대': '床', '매트리스': '床垫', '시트': '床单',
  '조화': '假花', '화분': '花盆', '액자': '相框',
  '벽지': '壁纸',
};

const KO_TO_EN = {
  '텀블러': 'tumbler', '물병': 'water bottle', '보온병': 'thermos',
  '수건': 'towel', '비누': 'soap', '칫솔': 'toothbrush',
  '수세미': 'scrub sponge', '스펀지': 'sponge', '솔': 'brush', '청소': 'cleaning',
  '걸레': 'mop', '세제': 'detergent', '세탁': 'laundry', '행주': 'dishcloth',
  '극세사': 'microfiber', '다용도': 'multi-purpose', '실리콘': 'silicone', '세척': 'washing',
  '스크럽': 'scrub',
  '충전기': 'charger', '케이블': 'cable', '이어폰': 'earphone',
  '블루투스': 'bluetooth', '스피커': 'speaker', '마우스': 'mouse',
  '키보드': 'keyboard', '보조배터리': 'power bank', '거치대': 'phone stand',
  '케이스': 'phone case', '티셔츠': 't-shirt', '양말': 'socks',
  '가방': 'bag', '백팩': 'backpack', '지갑': 'wallet',
  '목걸이': 'necklace', '반지': 'ring', '팔찌': 'bracelet',
  '귀걸이': 'earring', '선글라스': 'sunglasses',
  '장난감': 'toy', '인형': 'plush toy', '블록': 'building blocks',
  '펜': 'pen', '노트': 'notebook', '스티커': 'sticker',
  '요가매트': 'yoga mat', '텐트': 'tent', '캠핑': 'camping',
  '커튼': 'curtain', '러그': 'rug', '이불': 'blanket',
  '베개': 'pillow', '쿠션': 'cushion', '매트': 'mat',
};

function extractSmartKeyword(title) {
  if (!title) return { ko: '', cn: '', en: '' };
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

  if (words.length > 2) {
    const first = words[0];
    if (/^[a-zA-Z]+$/.test(first) && first.length >= 2 && !KO_TO_CN[first]) {
      words.shift();
    }
    const brands = ['삼성', '엘지', 'LG', 'SAMSUNG', 'APPLE', '애플', '나이키', 'NIKE',
      '아디다스', 'ADIDAS', '뉴발란스', '컨버스', '반스', '무인양품', '이케아', 'IKEA',
      '샤오미', 'XIAOMI', '앤커', 'ANKER', '로지텍', '필립스', '다이슨'];
    if (brands.some(b => first.toUpperCase() === b.toUpperCase())) {
      words.shift();
    }
  }

  const coreWords = words.slice(0, 4);
  const koKeyword = coreWords.join(' ');

  let cnParts = [];
  for (const w of coreWords) {
    if (KO_TO_CN[w]) cnParts.push(KO_TO_CN[w]);
  }
  const cnKeyword = cnParts.length > 0 ? cnParts.join(' ') : '';

  let enParts = [];
  for (const w of coreWords) {
    if (KO_TO_EN[w]) enParts.push(KO_TO_EN[w]);
  }
  const enKeyword = enParts.length > 0 ? enParts.join(' ') : '';

  return { ko: koKeyword, cn: cnKeyword, en: enKeyword };
}

async function translateKoToCn(text) {
  if (!text) return '';
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data && data[0] && data[0][0]) return data[0][0][0] || '';
  } catch (e) { console.warn('Translation failed:', e); }
  return '';
}

async function translateKoToEn(text) {
  if (!text) return '';
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=en&dt=t&q=${encodeURIComponent(text)}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data && data[0] && data[0][0]) return data[0][0][0] || '';
  } catch (e) { console.warn('Translation failed:', e); }
  return '';
}

function encode1688(keyword) {
  return keyword.replace(/\s+/g, '+');
}

function buildSourcingUrls(koKeyword, cnKeyword, enKeyword, imageUrl) {
  const urls = [];
  if (cnKeyword) {
    urls.push({ platform: '1688', type: 'keyword_cn', label: '🇨🇳 1688 (중국어)', url: `https://s.1688.com/selloffer/offer_search.htm?keywords=${encode1688(cnKeyword)}&charset=utf8`, priority: 1 });
  }
  if (koKeyword) {
    urls.push({ platform: '1688', type: 'keyword_ko', label: '🔍 1688 (한국어)', url: `https://s.1688.com/selloffer/offer_search.htm?keywords=${encode1688(koKeyword)}&charset=utf8`, priority: 3 });
  }
  if (imageUrl) {
    const cacheApiUrl = `https://lumiriz.kr/api/image-cache?url=${encodeURIComponent(imageUrl)}`;
    urls.push({ platform: '1688', type: 'image', label: '📸 1688 이미지검색', url: cacheApiUrl, imageUrl: imageUrl, priority: 2, needsCacheResolve: true });
  }
  if (koKeyword) {
    urls.push({ platform: '1688_aibuy', type: 'aibuy', label: '🤖 1688 AIBUY', url: `https://aibuy.1688.com/search?keywords=${encode1688(koKeyword)}&charset=utf8`, priority: 2 });
  }
  if (enKeyword) {
    urls.push({ platform: 'aliexpress', type: 'keyword_en', label: '🌐 AliExpress', url: `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(enKeyword)}`, priority: 4 });
  }
  if (cnKeyword) {
    urls.push({ platform: 'taobao', type: 'keyword_cn', label: '🛒 Taobao', url: `https://s.taobao.com/search?q=${encode1688(cnKeyword)}&charset=utf8`, priority: 5 });
  }
  if (koKeyword) {
    urls.push({ platform: 'aliexpress', type: 'keyword_ko', label: '🌐 AliExpress (한)', url: `https://ko.aliexpress.com/wholesale?SearchText=${encodeURIComponent(koKeyword)}`, priority: 5 });
  }
  if (koKeyword) {
    urls.push({ platform: 'cninsider', type: 'keyword_ko', label: '🇰🇷 CNINSIDER (한국어)', url: `https://www.cninsider.co.kr/mall/#/product?keywords=${encodeURIComponent(koKeyword)}&type=text&imageAddress=&searchDiff=1`, priority: 2 });
  }
  if (cnKeyword) {
    urls.push({ platform: 'cninsider', type: 'keyword_cn', label: '🇨🇳 CNINSIDER (중국어)', url: `https://www.cninsider.co.kr/mall/#/product?keywords=${encodeURIComponent(cnKeyword)}&type=text&imageAddress=&searchDiff=1`, priority: 2 });
  }
  urls.sort((a, b) => a.priority - b.priority);
  return urls;
}

// 소싱 검색 팝업 표시
async function showSourcingPopup(title, imageUrl, anchorEl, query) {
  const existing = document.getElementById('sourcingPopup');
  if (existing) existing.remove();

  let keywords;
  if (query && query.trim()) {
    const q = query.trim();
    keywords = { ko: q, cn: '', en: '' };
    if (KO_TO_CN[q]) keywords.cn = KO_TO_CN[q];
  } else {
    keywords = extractSmartKeyword(title);
  }

  let translatedCn = keywords.cn;
  let translatedEn = keywords.en;

  if (!translatedCn) {
    translateKoToCn(keywords.ko).then(cn => {
      if (cn) {
        translatedCn = cn;
        const cnInput = document.getElementById('sourcingCnInput');
        if (cnInput && !cnInput.value) cnInput.value = cn;
        refreshSourcingLinks();
      }
    });
  }
  if (!translatedEn) {
    translateKoToEn(keywords.ko).then(en => {
      if (en) {
        translatedEn = en;
        const enInput = document.getElementById('sourcingEnInput');
        if (enInput && !enInput.value) enInput.value = en;
        refreshSourcingLinks();
      }
    });
  }

  const popup = document.createElement('div');
  popup.id = 'sourcingPopup';
  popup.className = 'sourcing-popup';
  popup.innerHTML = `
    <div class="sp-header">
      <span class="sp-title">🔍 스마트 소싱 검색</span>
      <button class="sp-close" id="spClose">✕</button>
    </div>
    <div class="sp-body">
      <div class="sp-field">
        <label>한국어 키워드</label>
        <input type="text" id="sourcingKoInput" value="${keywords.ko}" class="sp-input" />
      </div>
      <div class="sp-field">
        <label>중국어 키워드</label>
        <div class="sp-input-group">
          <input type="text" id="sourcingCnInput" value="${translatedCn}" class="sp-input" placeholder="번역 중..." />
          <button class="sp-translate-btn" id="spTranslateCn" title="한→중 번역">🔄</button>
        </div>
      </div>
      <div class="sp-field">
        <label>영어 키워드</label>
        <div class="sp-input-group">
          <input type="text" id="sourcingEnInput" value="${translatedEn}" class="sp-input" placeholder="번역 중..." />
          <button class="sp-translate-btn" id="spTranslateEn" title="한→영 번역">🔄</button>
        </div>
      </div>
      ${imageUrl ? `<div class="sp-image-preview"><img src="${imageUrl}" /><span>이미지 검색 가능</span></div>` : ''}
      <div class="sp-links" id="sourcingLinks"></div>
      <div class="sp-tip">💡 <strong>매칭율 팁:</strong> 중국어 키워드 > 이미지검색 > CNINSIDER/AIBUY > 한국어 순으로 정확합니다.</div>
    </div>
  `;

  document.body.appendChild(popup);

  let cachedImageUrl = null;

  async function refreshSourcingLinks() {
    const ko = document.getElementById('sourcingKoInput')?.value || '';
    const cn = document.getElementById('sourcingCnInput')?.value || '';
    const en = document.getElementById('sourcingEnInput')?.value || '';
    const links = buildSourcingUrls(ko, cn, en, imageUrl);
    const container = document.getElementById('sourcingLinks');
    if (!container) return;

    for (const l of links) {
      if (l.needsCacheResolve && imageUrl) {
        if (cachedImageUrl) {
          l.url = `https://s.1688.com/youyuan/index.htm?tab=imageSearch&imageUrl=${encodeURIComponent(cachedImageUrl)}&charset=utf8`;
          l.label = '📸 1688 이미지검색';
        } else {
          l.url = '#';
          l.label = '📸 1688 이미지검색 (준비 중...)';
        }
      }
    }

    container.innerHTML = links.map(l => `
      <a href="${l.url}" target="_blank" rel="noreferrer" class="sp-link sp-link-${l.platform}" ${l.url === '#' ? 'style="opacity:0.5;pointer-events:none"' : ''}>
        <span class="sp-link-label">${l.label}</span>
        <span class="sp-link-arrow">→</span>
      </a>
    `).join('');
  }

  refreshSourcingLinks();

  if (imageUrl) {
    (async () => {
      try {
        const cacheResp = await fetch(`https://lumiriz.kr/api/image-cache?url=${encodeURIComponent(imageUrl)}`);
        const cacheData = await cacheResp.json();
        if (cacheData.success && cacheData.url) {
          cachedImageUrl = cacheData.url;
          refreshSourcingLinks();
        }
      } catch (e) {
        console.warn('Image cache failed:', e);
        cachedImageUrl = `https://lumiriz.kr/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
        refreshSourcingLinks();
      }
    })();
  }

  document.getElementById('spClose').onclick = () => popup.remove();
  popup.addEventListener('click', (e) => { if (e.target === popup) popup.remove(); });

  document.getElementById('spTranslateCn').onclick = async () => {
    const ko = document.getElementById('sourcingKoInput').value;
    const btn = document.getElementById('spTranslateCn');
    btn.textContent = '⏳'; btn.disabled = true;
    const cn = await translateKoToCn(ko);
    if (cn) document.getElementById('sourcingCnInput').value = cn;
    btn.textContent = '🔄'; btn.disabled = false;
    refreshSourcingLinks();
  };

  document.getElementById('spTranslateEn').onclick = async () => {
    const ko = document.getElementById('sourcingKoInput').value;
    const btn = document.getElementById('spTranslateEn');
    btn.textContent = '⏳'; btn.disabled = true;
    const en = await translateKoToEn(ko);
    if (en) document.getElementById('sourcingEnInput').value = en;
    btn.textContent = '🔄'; btn.disabled = false;
    refreshSourcingLinks();
  };

  ['sourcingKoInput', 'sourcingCnInput', 'sourcingEnInput'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', refreshSourcingLinks);
  });
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function getResults(tabId) {
  return chrome.runtime.sendMessage({ type: 'GET_RESULTS_FOR_TAB', tabId });
}
