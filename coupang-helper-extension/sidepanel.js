/* ============================================================
   Coupang Sourcing Helper — Side Panel Logic v5.0
   AI 소싱 코치 시스템: AI 분석 · 점수 · 뱃지 · 키워드 · 마진 · 리스크
   v5.0: WING 인기상품 AI 분석 + 초보 셀러 가이드형 소싱 시스템
   ============================================================ */

// ---- State ----
let currentData = null;
let currentItems = [];
let currentDetail = null;
let lastActiveTabId = null;
let coachResults = null; // 소싱 코치 분석 결과 캐시
let currentAIAnalysis = null; // AI 분석 결과 캐시
let currentWingEntry = null; // 현재 선택된 WING 검색 결과

// ---- DOM refs ----
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// ---- 탭 활성화 감지: 사용자가 탭을 전환하면 자동으로 최신 데이터 가져오기 ----
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (activeInfo.tabId !== lastActiveTabId) {
    lastActiveTabId = activeInfo.tabId;
    await refreshFromCurrentTab();
  }
});

// 탭 URL이 변경될 때 자동 새로고침 (SPA 내부 navigation 포함)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active) {
    // 쿠팡 검색 페이지로 이동한 경우
    if (changeInfo.url.includes('coupang.com/np/search')) {
      // 살짝 딜레이를 줘서 content script가 파싱을 완료할 시간 확보
      setTimeout(async () => {
        const response = await getResults(tabId);
        if (response?.data) {
          // URL의 query와 data의 query가 일치하는지 검증
          const urlQuery = extractQueryFromUrl(changeInfo.url);
          if (!response.data.query || response.data.query !== urlQuery) {
            // 불일치: content script에 재파싱 요청
            try {
              await chrome.scripting.executeScript({
                target: { tabId },
                func: () => { document.dispatchEvent(new Event('visibilitychange')); }
              });
            } catch (e) { }
            // 약간 대기 후 다시 시도
            setTimeout(async () => {
              const retry = await getResults(tabId);
              renderAnalysis(retry?.data || null);
              if ($('#tab-datasheet')?.classList.contains('active')) renderDataSheet();
            }, 1500);
          } else {
            renderAnalysis(response.data);
            if ($('#tab-datasheet')?.classList.contains('active')) renderDataSheet();
          }
        }
      }, 1000);
    }
  }
});

// URL에서 검색어 추출 (사이드패널 내부 검증용)
function extractQueryFromUrl(url) {
  try {
    const u = new URL(url);
    return u.searchParams.get('q') || u.searchParams.get('query') || u.searchParams.get('keyword') || '';
  } catch (e) { return ''; }
}

// ---- Tab 관리 ----
$$('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    $$('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    $(`#tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'candidates') loadCandidates();
    if (btn.dataset.tab === 'history') loadHistory();
    if (btn.dataset.tab === 'ranking') loadRankingTab();
    if (btn.dataset.tab === 'detail') loadDetailTab();
    if (btn.dataset.tab === 'wing') loadWingTab();
    if (btn.dataset.tab === 'datasheet') renderDataSheet();
  });
});

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
  if (!price || price <= 0) return { marginRate: 0, advice: '-', adviceType: 'danger', profit: 0 };
  const rate = 190;
  const cnyCost = Math.round(price * 0.15 / rate * 10) / 10;
  const costKrw = Math.round(cnyCost * rate);
  const totalCost = costKrw + 3000 + 3000 + Math.round(costKrw * 0.08);
  const fees = Math.round(price * 0.108) + Math.round(price * 0.05) + Math.round(price * 0.03);
  const profit = price - totalCost - fees;
  const marginRate = Math.round((profit / price) * 1000) / 10;
  let advice, adviceType;
  if (marginRate >= 35) { advice = '마진 여유'; adviceType = 'good'; }
  else if (marginRate >= 20) { advice = '마진 적정'; adviceType = 'good'; }
  else if (marginRate >= 10) { advice = '마진 낮음'; adviceType = 'caution'; }
  else if (marginRate >= 0) { advice = '광고 시 손실'; adviceType = 'danger'; }
  else { advice = '적자 예상'; adviceType = 'danger'; }
  return { marginRate, advice, adviceType, profit };
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

  // 서버 분석 시도
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

  // 로컬 폴백
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

// 노이즈 워드: 브랜드/모델/스펙/광고문구/수량단위 등 제거
const NOISE_WORDS = new Set([
  // 수량/단위
  '1개', '2개', '3개', '4개', '5개', '6개', '7개', '8개', '9개', '10개',
  '1P', '2P', '3P', '4P', '5P', '1p', '2p', '3p',
  '1팩', '2팩', '3팩', '1세트', '2세트', '3세트', '1박스', '2박스',
  '1+1', '2+1', '3+1', '1개입', '2개입', '5개입', '10개입', '20개입',
  // 할인/프로모션
  '무료배송', '당일발송', '국내배송', '무료반품', '최저가', '특가', '세일',
  '할인', '초특가', '빅세일', '핫딜', '타임딜', '쿠폰', '적립',
  '인기', '추천', '베스트', 'BEST', 'HOT', 'NEW', 'SALE',
  // 일반 형용사/부사
  '고급', '프리미엄', '럭셔리', '대용량', '소용량', '미니', '슬림',
  '정품', '국내정품', '수입정품', '공식', '공식판매', '정식수입',
  // 사이즈/규격
  'S', 'M', 'L', 'XL', 'XXL', 'FREE', 'Free',
  'ml', 'ML', 'g', 'kg', 'KG', 'cm', 'mm', 'oz',
  // 색상
  '블랙', '화이트', '그레이', '네이비', '베이지', '브라운', '핑크',
  '레드', '블루', '그린', '옐로우', '퍼플', '오렌지',
]);

// 한국어→중국어 핵심 상품 카테고리 번역 맵
const KO_TO_CN = {
  // 생활용품
  '텀블러': '保温杯', '물병': '水杯', '보온병': '保温瓶', '컵': '杯子',
  '수건': '毛巾', '타올': '毛巾', '목욕': '沐浴', '비누': '肥皂',
  '치약': '牙膏', '칫솔': '牙刷', '면도기': '剃须刀',
  '빗': '梳子', '거울': '镜子', '바구니': '篮子', '정리함': '收纳盒',
  '수납': '收纳', '선반': '架子', '후크': '挂钩', '행거': '衣架',
  // 청소용품
  '수세미': '百洁布', '스펀지': '海绵', '솔': '刷子', '청소': '清洁',
  '걸레': '拖把', '먼지': '灰尘', '먼지떨이': '鸡毛掸子', '빗자루': '扫帚',
  '쓰레받기': '簸箕', '세제': '洗涤剂', '세탁': '洗衣', '표백': '漂白',
  '락스': '漂白剂', '스크럽': '百洁刷', '행주': '抹布', '극세사': '超细纤维',
  '다용도': '多用途', '실리콘': '硅胶', '세척': '清洗',
  // 주방
  '냄비': '锅', '프라이팬': '平底锅', '도마': '砧板', '칼': '刀',
  '접시': '盘子', '그릇': '碗', '젓가락': '筷子', '숟가락': '勺子',
  '밀폐용기': '密封盒', '보관용기': '保鲜盒', '물통': '水壶',
  '주전자': '水壶', '커피': '咖啡', '차': '茶', '머그컵': '马克杯',
  // 전자/모바일
  '충전기': '充电器', '케이블': '数据线', '이어폰': '耳机', '헤드폰': '头戴耳机',
  '블루투스': '蓝牙', '스피커': '音箱', '마우스': '鼠标', '키보드': '键盘',
  '보조배터리': '充电宝', '거치대': '支架', '핸드폰': '手机',
  '케이스': '手机壳', '필름': '贴膜', '보호필름': '保护膜',
  '무선충전': '无线充电', 'USB': 'USB', 'LED': 'LED',
  '조명': '照明', '램프': '灯', '스탠드': '台灯', '전구': '灯泡',
  // 의류/패션
  '티셔츠': 'T恤', '반팔': '短袖', '긴팔': '长袖', '맨투맨': '卫衣',
  '후드': '连帽衫', '자켓': '夹克', '점퍼': '外套', '코트': '大衣',
  '바지': '裤子', '청바지': '牛仔裤', '반바지': '短裤', '레깅스': '打底裤',
  '치마': '裙子', '원피스': '连衣裙', '블라우스': '衬衫',
  '양말': '袜子', '속옷': '内衣', '브래지어': '文胸', '팬티': '内裤',
  '모자': '帽子', '벨트': '腰带', '장갑': '手套', '스카프': '围巾',
  '가방': '包', '백팩': '双肩包', '크로스백': '斜挎包', '지갑': '钱包',
  '신발': '鞋', '운동화': '运动鞋', '슬리퍼': '拖鞋', '샌들': '凉鞋',
  '부츠': '靴子', '구두': '皮鞋',
  // 액세서리
  '목걸이': '项链', '반지': '戒指', '팔찌': '手链', '귀걸이': '耳环',
  '선글라스': '太阳镜', '안경': '眼镜', '시계': '手表', '헤어밴드': '发带',
  '머리끈': '发绳', '핀': '发夹',
  // 뷰티
  '립스틱': '口红', '파운데이션': '粉底', '쿠션': '气垫', '마스카라': '睫毛膏',
  '아이라이너': '眼线笔', '로션': '乳液', '크림': '面霜', '세럼': '精华',
  '선크림': '防晒霜', '클렌징': '洁面', '마스크팩': '面膜', '토너': '爽肤水',
  '샴푸': '洗发水', '린스': '护发素', '바디워시': '沐浴露',
  // 완구/유아
  '장난감': '玩具', '인형': '玩偶', '블록': '积木', '레고': '积木',
  '퍼즐': '拼图', '스티커': '贴纸', '색칠': '涂色', '크레파스': '蜡笔',
  '기저귀': '尿不湿', '젖병': '奶瓶', '유모차': '婴儿车',
  // 반려동물
  '사료': '宠物粮', '간식': '零食', '장난감': '玩具', '목줄': '牵引绳',
  '쿠션': '靠垫', '방석': '坐垫', '매트': '垫子',
  // 문구/오피스
  '펜': '笔', '볼펜': '圆珠笔', '노트': '笔记本', '다이어리': '日记本',
  '테이프': '胶带', '가위': '剪刀', '풀': '胶水', '파일': '文件夹',
  '스탬프': '印章', '스티커': '贴纸',
  // 운동/레저
  '요가매트': '瑜伽垫', '아령': '哑铃', '운동': '运动', '헬스': '健身',
  '자전거': '自行车', '텐트': '帐篷', '캠핑': '露营',
  '등산': '登山', '수영': '游泳', '낚시': '钓鱼',
  // 자동차
  '차량용': '车载', '핸들커버': '方向盘套', '시트커버': '座椅套',
  '방향제': '香薰', '세차': '洗车', '와이퍼': '雨刷',
  // 인테리어
  '커튼': '窗帘', '쿠션': '靠垫', '러그': '地毯', '이불': '被子',
  '베개': '枕头', '침대': '床', '매트리스': '床垫', '시트': '床单',
  '조화': '假花', '화분': '花盆', '시계': '时钟', '액자': '相框',
  '벽지': '壁纸', '스티커': '贴纸',
};

// 한국어→영어 핵심 카테고리 (AliExpress/Alibaba용)
const KO_TO_EN = {
  '텀블러': 'tumbler', '물병': 'water bottle', '보온병': 'thermos',
  '수건': 'towel', '비누': 'soap', '칫솔': 'toothbrush',
  // 청소용품
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

// 스마트 키워드 추출 (개선된 버전)
function extractSmartKeyword(title) {
  if (!title) return { ko: '', cn: '', en: '' };

  // 1단계: 기본 정리 - 괄호/대괄호/특수문자 제거
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

  // 2단계: 단어 분리 및 노이즈 제거
  let words = cleaned.split(/\s+/).filter(w => {
    if (w.length <= 1) return false;
    if (NOISE_WORDS.has(w)) return false;
    if (/^\d+$/.test(w)) return false; // 순수 숫자
    if (/^[A-Z]{1,3}$/.test(w) && !KO_TO_CN[w]) return false; // 짧은 대문자 (사이즈 등)
    return true;
  });

  // 3단계: 브랜드명 추정 제거 (첫 번째 단어가 영문+한글 조합이면 브랜드일 가능성 높음)
  if (words.length > 2) {
    const first = words[0];
    // 영문 전용 + 2글자 이상이면 브랜드 가능성
    if (/^[a-zA-Z]+$/.test(first) && first.length >= 2 && !KO_TO_CN[first]) {
      words.shift();
    }
    // 한글+영문 혼합 (예: "오뚜기", "삼성") - 유명 브랜드는 제거
    const brands = ['삼성', '엘지', 'LG', 'SAMSUNG', 'APPLE', '애플', '나이키', 'NIKE',
      '아디다스', 'ADIDAS', '뉴발란스', '컨버스', '반스', '무인양품', '이케아', 'IKEA',
      '샤오미', 'XIAOMI', '앤커', 'ANKER', '로지텍', '필립스', '다이슨'];
    if (brands.some(b => first.toUpperCase() === b.toUpperCase())) {
      words.shift();
    }
  }

  // 4단계: 핵심 명사 추출 (최대 3~4개)
  const coreWords = words.slice(0, 4);
  const koKeyword = coreWords.join(' ');

  // 5단계: 중국어 번역 시도
  let cnParts = [];
  for (const w of coreWords) {
    if (KO_TO_CN[w]) {
      cnParts.push(KO_TO_CN[w]);
    }
  }
  // 매칭 안된 경우 전체 키워드로 번역 시도
  const cnKeyword = cnParts.length > 0 ? cnParts.join(' ') : '';

  // 6단계: 영어 번역 시도
  let enParts = [];
  for (const w of coreWords) {
    if (KO_TO_EN[w]) {
      enParts.push(KO_TO_EN[w]);
    }
  }
  const enKeyword = enParts.length > 0 ? enParts.join(' ') : '';

  return { ko: koKeyword, cn: cnKeyword, en: enKeyword };
}

// Google Translate 무료 API로 한국어→중국어 번역
async function translateKoToCn(text) {
  if (!text) return '';
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data && data[0] && data[0][0]) {
      return data[0][0][0] || '';
    }
  } catch (e) {
    console.warn('Translation failed:', e);
  }
  return '';
}

// Google Translate 무료 API로 한국어→영어 번역
async function translateKoToEn(text) {
  if (!text) return '';
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=en&dt=t&q=${encodeURIComponent(text)}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data && data[0] && data[0][0]) {
      return data[0][0][0] || '';
    }
  } catch (e) {
    console.warn('Translation failed:', e);
  }
  return '';
}

// 소싱 검색 URL 생성기
function buildSourcingUrls(koKeyword, cnKeyword, enKeyword, imageUrl) {
  const urls = [];

  // 1) 1688 중국어 키워드 검색 (최우선)
  if (cnKeyword) {
    urls.push({
      platform: '1688',
      type: 'keyword_cn',
      label: '🇨🇳 1688 (중국어)',
      url: `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(cnKeyword)}`,
      priority: 1,
    });
  }

  // 2) 1688 한국어 키워드 (1688이 자체 번역 지원)
  if (koKeyword) {
    urls.push({
      platform: '1688',
      type: 'keyword_ko',
      label: '🔍 1688 (한국어)',
      url: `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(koKeyword)}`,
      priority: 3,
    });
  }

  // 3) 1688 이미지 검색 (매칭율 매우 높음!)
  // 쿠팡 CDN 이미지는 1688에서 직접 접근 불가 → 서버에 캐시 후 공개 URL 사용
  if (imageUrl) {
    // 캐시 API를 통해 서버에 이미지를 저장하고 공개 URL을 받아옴
    const cacheApiUrl = `https://lumiriz.kr/api/image-cache?url=${encodeURIComponent(imageUrl)}`;
    urls.push({
      platform: '1688',
      type: 'image',
      label: '📸 1688 이미지검색',
      url: cacheApiUrl, // 나중에 비동기로 실제 URL 교체됨
      imageUrl: imageUrl, // 원본 URL 보관
      priority: 2,
      needsCacheResolve: true, // 캐시 URL 비동기 resolve 필요
    });
  }

  // 4) 1688 AIBUY 글로벌 (한국어 지원)
  if (koKeyword) {
    urls.push({
      platform: '1688_aibuy',
      type: 'aibuy',
      label: '🤖 1688 AIBUY',
      url: `https://aibuy.1688.com/search?keywords=${encodeURIComponent(koKeyword)}`,
      priority: 2,
    });
  }

  // 5) AliExpress 영어 검색
  if (enKeyword) {
    urls.push({
      platform: 'aliexpress',
      type: 'keyword_en',
      label: '🌐 AliExpress',
      url: `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(enKeyword)}`,
      priority: 4,
    });
  }

  // 6) Taobao 중국어 검색
  if (cnKeyword) {
    urls.push({
      platform: 'taobao',
      type: 'keyword_cn',
      label: '🛒 Taobao',
      url: `https://s.taobao.com/search?q=${encodeURIComponent(cnKeyword)}`,
      priority: 5,
    });
  }

  // 7) AliExpress 한국어 검색 (자체 번역)
  if (koKeyword) {
    urls.push({
      platform: 'aliexpress',
      type: 'keyword_ko',
      label: '🌐 AliExpress (한)',
      url: `https://ko.aliexpress.com/wholesale?SearchText=${encodeURIComponent(koKeyword)}`,
      priority: 5,
    });
  }

  // 우선순위로 정렬
  urls.sort((a, b) => a.priority - b.priority);
  return urls;
}

// 소싱 검색 팝업 표시
async function showSourcingPopup(title, imageUrl, anchorEl) {
  // 기존 팝업 제거
  const existing = document.getElementById('sourcingPopup');
  if (existing) existing.remove();

  const keywords = extractSmartKeyword(title);

  // 비동기 번역 시작
  let translatedCn = keywords.cn;
  let translatedEn = keywords.en;

  // 로컬 사전에 없으면 Google Translate 호출
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

  // 팝업 생성
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
      <div class="sp-tip">💡 <strong>매칭율 팁:</strong> 중국어 키워드 > 이미지검색 > AIBUY > 한국어 순으로 정확합니다.</div>
    </div>
  `;

  document.body.appendChild(popup);

  // 링크 렌더
  let cachedImageUrl = null; // 서버에 캐시된 이미지 URL

  async function refreshSourcingLinks() {
    const ko = document.getElementById('sourcingKoInput')?.value || '';
    const cn = document.getElementById('sourcingCnInput')?.value || '';
    const en = document.getElementById('sourcingEnInput')?.value || '';
    const links = buildSourcingUrls(ko, cn, en, imageUrl);
    const container = document.getElementById('sourcingLinks');
    if (!container) return;

    // 이미지 캐시 resolve - 1688 이미지검색 링크를 실제 캐시 URL로 교체
    for (const l of links) {
      if (l.needsCacheResolve && imageUrl) {
        if (cachedImageUrl) {
          // 이미 캐시된 URL이 있으면 바로 사용
          l.url = `https://s.1688.com/youyuan/index.htm?tab=imageSearch&imageUrl=${encodeURIComponent(cachedImageUrl)}`;
          l.label = '📸 1688 이미지검색';
        } else {
          // 아직 캐시 중이면 로딩 표시
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

  // 비동기로 이미지 캐시 URL 획득
  if (imageUrl) {
    (async () => {
      try {
        const cacheResp = await fetch(`https://lumiriz.kr/api/image-cache?url=${encodeURIComponent(imageUrl)}`);
        const cacheData = await cacheResp.json();
        if (cacheData.success && cacheData.url) {
          cachedImageUrl = cacheData.url;
          refreshSourcingLinks(); // 캐시 URL로 링크 업데이트
        }
      } catch (e) {
        console.warn('Image cache failed:', e);
        // 실패시 프록시 URL 폴백
        cachedImageUrl = `https://lumiriz.kr/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
        refreshSourcingLinks();
      }
    })();
  }

  // 이벤트 바인딩
  document.getElementById('spClose').onclick = () => popup.remove();

  // 클릭 외부 닫기
  popup.addEventListener('click', (e) => {
    if (e.target === popup) popup.remove();
  });

  // 번역 버튼
  document.getElementById('spTranslateCn').onclick = async () => {
    const ko = document.getElementById('sourcingKoInput').value;
    const btn = document.getElementById('spTranslateCn');
    btn.textContent = '⏳';
    btn.disabled = true;
    const cn = await translateKoToCn(ko);
    if (cn) document.getElementById('sourcingCnInput').value = cn;
    btn.textContent = '🔄'; btn.disabled = false;
    refreshSourcingLinks();
  };

  document.getElementById('spTranslateEn').onclick = async () => {
    const ko = document.getElementById('sourcingKoInput').value;
    const btn = document.getElementById('spTranslateEn');
    btn.textContent = '⏳';
    btn.disabled = true;
    const en = await translateKoToEn(ko);
    if (en) document.getElementById('sourcingEnInput').value = en;
    btn.textContent = '🔄'; btn.disabled = false;
    refreshSourcingLinks();
  };

  // 입력값 변경 시 링크 갱신
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

// ============================================================
//  분석 탭
// ============================================================

function analyzeCompetition(items) {
  if (!items.length) return null;
  const prices = items.map(i => i.price).filter(p => p > 0);
  const reviews = items.map(i => i.reviewCount).filter(r => r > 0);
  const ratings = items.map(i => i.rating).filter(r => r > 0);
  const avgPrice = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
  const avgReview = reviews.length ? Math.round(reviews.reduce((a, b) => a + b, 0) / reviews.length) : 0;
  const avgRating = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : 0;
  const highReviewCount = items.filter(i => i.reviewCount >= 100).length;
  const highReviewRatio = Math.round((highReviewCount / items.length) * 100);
  const adCount = items.filter(i => i.isAd).length;

  let competitionScore = 0;
  if (avgReview > 1000) competitionScore += 40;
  else if (avgReview > 500) competitionScore += 30;
  else if (avgReview > 100) competitionScore += 20;
  else if (avgReview > 30) competitionScore += 10;
  if (highReviewRatio > 60) competitionScore += 25;
  else if (highReviewRatio > 40) competitionScore += 15;
  else if (highReviewRatio > 20) competitionScore += 8;
  if (avgRating >= 4.5) competitionScore += 15;
  else if (avgRating >= 4.0) competitionScore += 8;
  const adRatio = adCount / items.length;
  if (adRatio > 0.3) competitionScore += 20;
  else if (adRatio > 0.15) competitionScore += 10;

  let level, levelText, levelCls;
  if (competitionScore >= 70) { level = '강함'; levelText = '경쟁이 매우 치열합니다. 차별화 전략이 필요합니다.'; levelCls = 'level-hard'; }
  else if (competitionScore >= 45) { level = '보통'; levelText = '경쟁이 있지만 진입 가능합니다.'; levelCls = 'level-medium'; }
  else { level = '약함'; levelText = '경쟁이 낮습니다. 소싱 기회!'; levelCls = 'level-easy'; }

  return { competitionScore, level, levelText, levelCls, avgPrice, avgReview, avgRating, highReviewRatio, adCount, totalItems: items.length };
}

function renderItems(items, comp) {
  const results = $('#results');
  const tpl = $('#itemTemplate');
  results.innerHTML = '';
  if (!items.length) { results.innerHTML = '<li class="empty-msg">표시할 상품이 없습니다.</li>'; return; }

  const avgPrice = comp?.avgPrice || 0;
  const avgReview = comp?.avgReview || 0;

  for (const item of items) {
    const node = tpl.content.cloneNode(true);
    const img = node.querySelector('.item-img');
    if (item.imageUrl) { img.src = item.imageUrl; img.alt = item.title; } else { img.style.display = 'none'; }

    const badges = node.querySelector('.item-badges');
    let badgeHtml = `<span class="badge-rank">#${item.position}</span>`;
    if (item.isAd) badgeHtml += '<span class="badge-ad">AD</span>';
    if (item.isRocket) badgeHtml += '<span class="badge-rocket">🚀</span>';
    badges.innerHTML = badgeHtml;

    node.querySelector('.title').textContent = item.title || '(제목 없음)';
    node.querySelector('.price-line').textContent = item.price ? formatPrice(item.price) : '-';
    node.querySelector('.meta-line').textContent = `평점 ${item.rating || '-'} · 리뷰 ${item.reviewCount?.toLocaleString() || '0'}개`;

    // 소싱 코치 5-line 표시
    const coach = coachResults?.[item.productId || item.url];
    const coachSection = node.querySelector('.coach-section');
    if (coach && coachSection) {
      const s = coach.score || {};
      const m = coach.margin || {};
      const r = coach.risk || {};
      const bg = coach.badges || [];
      const riskColor = r.level === 'critical' ? '#dc2626' : r.level === 'high' ? '#f97316' : r.level === 'medium' ? '#eab308' : '#22c55e';
      const marginColor = m.adviceType === 'good' ? '#059669' : m.adviceType === 'caution' ? '#d97706' : '#dc2626';
      const gradeColor = s.grade === 'S' ? '#16a34a' : s.grade === 'A' ? '#3b82f6' : s.grade === 'B' ? '#f59e0b' : '#9ca3af';

      coachSection.innerHTML = `
        <div class="coach-line coach-score-line">
          <span class="coach-grade-badge" style="background:${gradeColor}">${s.grade || '-'}</span>
          <span class="coach-score-text">${s.total || 0}점 · ${s.gradeLabel || '-'}</span>
          <div class="coach-score-bar"><div class="coach-score-fill" style="width:${s.total||0}%;background:${gradeColor}"></div></div>
        </div>
        <div class="coach-line coach-margin-line">
          <span class="coach-label">💰 마진</span>
          <span class="coach-value" style="color:${marginColor}">${m.marginRate != null ? m.marginRate + '%' : '-'} (${m.advice || '-'})</span>
        </div>
        <div class="coach-line coach-risk-line">
          <span class="coach-label">⚡ 리스크</span>
          <span class="coach-value" style="color:${riskColor}">${r.level === 'low' ? '낮음' : r.level === 'medium' ? '보통' : r.level === 'high' ? '높음' : '매우높음'}</span>
          ${r.warnings?.slice(0,3).map(w => `<span class="coach-risk-tag" style="border-color:${w.severity==='danger'?'#dc2626':w.severity==='warn'?'#f59e0b':'#6b7280'}">${w.icon||''} ${w.label}</span>`).join('') || ''}
        </div>
        <div class="coach-line coach-badges-line">
          ${bg.slice(0,4).map(b => `<span class="coach-badge" style="background:${b.color}15;color:${b.color};border:1px solid ${b.color}40">${b.icon} ${b.label}</span>`).join('')}
        </div>
      `;
      coachSection.style.display = '';
    } else if (coachSection) {
      // 코치 결과 없을 때 기존 점수 표시
      const sourcingScore = calcSourcingScore(item, avgPrice, avgReview);
      item._sourcingScore = sourcingScore;
      const grade = getSourcingGrade(sourcingScore);
      item._sourcingGrade = grade.grade;
      coachSection.innerHTML = `<div class="coach-line"><span class="score-value ${grade.cls}">${grade.grade} (${sourcingScore}점)</span></div>`;
      coachSection.style.display = '';
    }

    // 기존 score-value는 숨김 (코치 섹션으로 대체)
    const scoreEl = node.querySelector('.score-value');
    if (scoreEl && coach) scoreEl.style.display = 'none';
    else if (scoreEl && !coach) {
      const sourcingScore = calcSourcingScore(item, avgPrice, avgReview);
      item._sourcingScore = sourcingScore;
      const grade = getSourcingGrade(sourcingScore);
      item._sourcingGrade = grade.grade;
      scoreEl.textContent = `${grade.grade} (${sourcingScore}점)`;
      scoreEl.className = `score-value ${grade.cls}`;
    }

    // 액션 버튼
    node.querySelector('.btn-1688').addEventListener('click', (e) => {
      showSourcingPopup(item.title, item.imageUrl, e.target);
    });

    const saveBtn = node.querySelector('.btn-save');
    saveBtn.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'SAVE_CANDIDATE', item });
      saveBtn.textContent = '✅';
      saveBtn.disabled = true;
    });

    node.querySelector('.btn-track').addEventListener('click', async () => {
      const query = currentData?.query || '';
      if (!query) { alert('검색어를 감지할 수 없습니다.'); return; }
      await chrome.runtime.sendMessage({
        type: 'ADD_TRACKED_KEYWORD',
        keyword: { query, targetProductId: item.productId, targetProductName: item.title }
      });
      alert(`"${query}" 키워드 순위 추적이 등록되었습니다.`);
    });

    node.querySelector('.btn-link').href = item.url;
    results.appendChild(node);
  }
}

function getFilteredSorted() {
  if (!currentData?.items) return [];
  let items = [...currentData.items];
  if ($('#filterNoAd').checked) items = items.filter(i => !i.isAd);
  if ($('#filterEasySourcing').checked) {
    const comp = analyzeCompetition(currentData.items);
    items.forEach(i => { i._sourcingScore = calcSourcingScore(i, comp?.avgPrice || 0, comp?.avgReview || 0); });
    items = items.filter(i => i._sourcingScore >= 60);
  }
  const topN = parseInt($('#topNSelect').value) || 0;
  if (topN > 0) items = items.slice(0, topN);
  const sort = $('#sortSelect').value;
  switch (sort) {
    case 'price-asc': items.sort((a, b) => (a.price || 0) - (b.price || 0)); break;
    case 'price-desc': items.sort((a, b) => (b.price || 0) - (a.price || 0)); break;
    case 'review-desc': items.sort((a, b) => (b.reviewCount || 0) - (a.reviewCount || 0)); break;
    case 'rating-desc': items.sort((a, b) => (b.rating || 0) - (a.rating || 0)); break;
    case 'sourcing-desc': {
      const comp = analyzeCompetition(currentData.items);
      items.forEach(i => { i._sourcingScore = calcSourcingScore(i, comp?.avgPrice || 0, comp?.avgReview || 0); });
      items.sort((a, b) => (b._sourcingScore || 0) - (a._sourcingScore || 0));
      break;
    }
  }
  return items;
}

function renderAnalysis(data) {
  currentData = data;
  if (!data || !data.items?.length) {
    $('#summary').textContent = '쿠팡 검색 결과 페이지를 열면 자동 분석됩니다.';
    $('#competitionCard').style.display = 'none';
    $('#statsGrid').style.display = 'none';
    $('#filterBar').style.display = 'none';
    $('#results').innerHTML = '';
    coachResults = null;
    return;
  }
  $('#summary').textContent = `"${data.query || '-'}" · ${data.count}개 · ${new Date(data.capturedAt).toLocaleTimeString('ko-KR')}`;

  const comp = analyzeCompetition(data.items);
  if (comp) {
    $('#competitionCard').style.display = '';
    $('#competitionBadge').textContent = `${comp.level} (${comp.competitionScore}점)`;
    $('#competitionBadge').className = `competition-badge ${comp.levelCls}`;
    $('#competitionDetails').innerHTML = `<div>${comp.levelText}</div><div class="comp-stats">상품 ${comp.totalItems}개 · 광고 ${comp.adCount}개 · 리뷰100+ ${comp.highReviewRatio}%</div>`;
    $('#statsGrid').style.display = '';
    $('#statAvgPrice').textContent = formatPrice(comp.avgPrice);
    $('#statAvgRating').textContent = comp.avgRating || '-';
    $('#statAvgReview').textContent = comp.avgReview?.toLocaleString() || '-';
    $('#statHighReviewRatio').textContent = comp.highReviewRatio + '%';
  }
  $('#filterBar').style.display = '';

  // 소싱 코치 분석 실행 → 완료 후 렌더링
  runCoachAnalysis(data.items, data.query).then(() => {
    renderItems(getFilteredSorted(), comp);
  });
}

$('#sortSelect').addEventListener('change', () => renderAnalysis(currentData));
$('#filterNoAd').addEventListener('change', () => renderAnalysis(currentData));
$('#filterEasySourcing').addEventListener('change', () => renderAnalysis(currentData));
$('#topNSelect').addEventListener('change', () => renderAnalysis(currentData));

// ============================================================
//  후보 탭
// ============================================================

async function loadCandidates() {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_CANDIDATES' });
  const candidates = resp?.data || [];
  const list = $('#candidateList');
  const tpl = $('#candidateTemplate');
  const empty = $('#candidateEmpty');
  list.innerHTML = '';
  $('#candidateCount').textContent = candidates.length;
  if (!candidates.length) { empty.style.display = ''; return; }
  empty.style.display = 'none';
  for (const item of candidates) {
    const node = tpl.content.cloneNode(true);
    const img = node.querySelector('.item-img');
    if (item.imageUrl) { img.src = item.imageUrl; img.alt = item.title; } else img.style.display = 'none';
    node.querySelector('.title').textContent = item.title;
    node.querySelector('.price-line').textContent = item.price ? formatPrice(item.price) : '-';
    node.querySelector('.meta-line').textContent = `평점 ${item.rating || '-'} · 리뷰 ${item.reviewCount?.toLocaleString() || '0'}개 · ${new Date(item.savedAt).toLocaleDateString('ko-KR')}`;
    node.querySelector('.btn-1688').addEventListener('click', (e) => {
      showSourcingPopup(item.title, item.imageUrl, e.target);
    });
    node.querySelector('.btn-remove').addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'REMOVE_CANDIDATE', productId: item.productId });
      loadCandidates();
    });
    node.querySelector('.btn-link').href = item.url;
    list.appendChild(node);
  }
}

// ============================================================
//  순위 추적 탭
// ============================================================

async function loadRankingTab() {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_TRACKED_KEYWORDS' });
  const keywords = resp?.data || [];
  const list = $('#trackedKeywordsList');
  const empty = $('#rankingEmpty');
  list.innerHTML = '';

  if (!keywords.length) { empty.style.display = ''; $('#rankDetailCard').style.display = 'none'; return; }
  empty.style.display = 'none';

  for (const kw of keywords) {
    const div = document.createElement('div');
    div.className = 'tracked-keyword-item';
    div.innerHTML = `
      <div class="tk-main">
        <span class="tk-query">"${kw.query}"</span>
        ${kw.targetProductId ? `<span class="tk-target">타겟: ${kw.targetProductName || kw.targetProductId}</span>` : ''}
      </div>
      <div class="tk-actions">
        <button class="btn-sm tk-view-btn">📊 보기</button>
        <button class="btn-sm tk-search-btn">🔍</button>
        <button class="btn-sm btn-remove tk-remove-btn">✕</button>
      </div>
    `;

    div.querySelector('.tk-view-btn').addEventListener('click', () => loadRankDetail(kw));
    div.querySelector('.tk-search-btn').addEventListener('click', () => {
      chrome.tabs.create({ url: `https://www.coupang.com/np/search?q=${encodeURIComponent(kw.query)}` });
    });
    div.querySelector('.tk-remove-btn').addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'REMOVE_TRACKED_KEYWORD', keywordId: kw.query });
      loadRankingTab();
    });
    list.appendChild(div);
  }
}

async function loadRankDetail(kw) {
  const card = $('#rankDetailCard');
  card.style.display = '';
  $('#rankDetailTitle').textContent = `"${kw.query}" 순위`;

  const resp = await chrome.runtime.sendMessage({ type: 'GET_LATEST_RANKING', query: kw.query });
  const rankings = resp?.data || [];
  const content = $('#rankDetailContent');

  if (!rankings.length) {
    content.innerHTML = '<p class="empty-msg">아직 순위 데이터가 없습니다.<br/>쿠팡에서 이 키워드를 검색하면 자동으로 기록됩니다.</p>';
    $('#rankDetailCount').textContent = '0';
    return;
  }

  $('#rankDetailCount').textContent = rankings.length;
  let html = '<div class="rank-list">';
  for (const r of rankings) {
    const isTarget = kw.targetProductId && r.coupangProductId === kw.targetProductId;
    html += `
      <div class="rank-item ${isTarget ? 'rank-item-target' : ''}">
        <span class="rank-pos">#${r.position}</span>
        <div class="rank-info">
          <div class="rank-title">${r.title || r.coupangProductId}</div>
          <div class="rank-meta">${formatPrice(r.price)} · 리뷰 ${r.reviewCount} · 평점 ${r.rating}${r.isAd ? ' · <span class="badge-ad">AD</span>' : ''}${r.isRocket ? ' · 🚀' : ''}</div>
        </div>
        ${isTarget ? '<span class="badge-target">타겟</span>' : ''}
      </div>`;
  }
  html += '</div>';
  content.innerHTML = html;
}

// 추적 키워드 추가
$('#addRankKeywordBtn').addEventListener('click', async () => {
  const query = $('#rankKeywordInput').value.trim();
  const targetId = $('#rankProductIdInput').value.trim();
  if (!query) { alert('키워드를 입력하세요.'); return; }
  await chrome.runtime.sendMessage({
    type: 'ADD_TRACKED_KEYWORD',
    keyword: { query, targetProductId: targetId || null, targetProductName: null }
  });
  $('#rankKeywordInput').value = '';
  $('#rankProductIdInput').value = '';
  loadRankingTab();
});

// ============================================================
//  상품 상세 탭
// ============================================================

async function loadDetailTab() {
  // 현재 탭이 상품 상세 페이지인 경우 자동 로드
  const tab = await getActiveTab();
  if (!tab?.url?.includes('/vp/products/')) {
    // 마지막으로 파싱된 상세 있는지 확인
    if (currentDetail) {
      renderDetail(currentDetail);
    } else {
      $('#detailCard').style.display = 'none';
      $('#detailEmpty').style.display = '';
    }
    return;
  }

  // 상품 ID 추출
  const m = tab.url.match(/\/vp\/products\/(\d+)/);
  if (m) {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_PRODUCT_DETAIL', productId: m[1] });
    if (resp?.data) {
      renderDetail(resp.data);
    }
  }
}

function renderDetail(detail) {
  if (!detail) return;
  currentDetail = detail;
  $('#detailCard').style.display = '';
  $('#detailEmpty').style.display = 'none';

  if (detail.imageUrl) {
    $('#detailImg').src = detail.imageUrl;
    $('#detailImg').style.display = '';
  } else {
    $('#detailImg').style.display = 'none';
  }
  $('#detailTitle').textContent = detail.title || '-';
  $('#detailPrice').textContent = detail.price ? formatPrice(detail.price) : '-';

  let metaParts = [];
  if (detail.rating) metaParts.push(`평점 ${detail.rating}`);
  if (detail.reviewCount) metaParts.push(`리뷰 ${detail.reviewCount.toLocaleString()}`);
  if (detail.purchaseCount) metaParts.push(detail.purchaseCount);
  $('#detailMeta').textContent = metaParts.join(' · ');

  // 상세 그리드
  const grid = $('#detailGrid');
  let gridHtml = '';
  const items = [
    { label: '판매자', value: detail.sellerName || '-' },
    { label: '카테고리', value: detail.categoryPath || '-' },
    { label: '원래가격', value: detail.originalPrice ? formatPrice(detail.originalPrice) : '-' },
    { label: '할인율', value: detail.discountRate ? detail.discountRate + '%' : '-' },
    { label: '로켓배송', value: detail.isRocket ? '✅' : '❌' },
    { label: '무료배송', value: detail.isFreeShipping ? '✅' : '❌' },
    { label: '옵션수', value: detail.optionCount || 0 },
  ];
  for (const d of items) {
    gridHtml += `<div class="detail-grid-item"><span class="dg-label">${d.label}</span><span class="dg-value">${d.value}</span></div>`;
  }
  grid.innerHTML = gridHtml;

  // 1688 버튼
  $('#detailBtn1688').onclick = (e) => {
    showSourcingPopup(detail.title, detail.imageUrl, e.target);
  };

  // 후보 저장
  $('#detailBtnSave').onclick = async () => {
    await chrome.runtime.sendMessage({
      type: 'SAVE_CANDIDATE',
      item: {
        productId: detail.coupangProductId,
        title: detail.title,
        price: detail.price,
        rating: detail.rating,
        reviewCount: detail.reviewCount,
        imageUrl: detail.imageUrl,
        url: detail.url,
        query: '',
      }
    });
    $('#detailBtnSave').textContent = '✅ 저장됨';
    $('#detailBtnSave').disabled = true;
  };

  // 순위 추적
  $('#detailBtnTrack').onclick = async () => {
    const query = prompt('이 상품의 주요 검색 키워드를 입력하세요:', extractKeyword(detail.title));
    if (!query) return;
    await chrome.runtime.sendMessage({
      type: 'ADD_TRACKED_KEYWORD',
      keyword: { query, targetProductId: detail.coupangProductId, targetProductName: detail.title }
    });
    alert(`"${query}" 순위 추적이 등록되었습니다.`);
  };

  // 가격 변동 히스토리
  loadPriceHistory(detail.coupangProductId);
}

async function loadPriceHistory(productId) {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_PRODUCT_PRICE_HISTORY', productId, days: 30 });
  const history = resp?.data || [];
  const section = $('#priceHistorySection');
  const content = $('#priceHistoryContent');

  if (!history.length) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';

  let html = '<div class="price-history-list">';
  for (const h of history.slice(0, 10)) {
    html += `
      <div class="ph-item">
        <span class="ph-date">${new Date(h.capturedAt).toLocaleDateString('ko-KR')}</span>
        <span class="ph-price">${formatPrice(h.price)}</span>
        <span class="ph-review">리뷰 ${h.reviewCount}</span>
        ${h.purchaseCount ? `<span class="ph-purchase">${h.purchaseCount}</span>` : ''}
      </div>`;
  }
  html += '</div>';
  content.innerHTML = html;
}

// ============================================================
//  히스토리 탭
// ============================================================

async function loadHistory() {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
  const history = resp?.data || [];
  const list = $('#historyList');
  const empty = $('#historyEmpty');
  list.innerHTML = '';
  if (!history.length) { empty.style.display = ''; return; }
  empty.style.display = 'none';
  for (const h of history) {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.innerHTML = `
      <div class="history-query">"${h.query}"</div>
      <div class="history-stats">${h.count}개 · 평균가 ${formatPrice(h.avgPrice)} · 평점 ${h.avgRating || '-'} · 리뷰 ${h.avgReview || '-'}</div>
      <div class="history-time">${new Date(h.timestamp).toLocaleString('ko-KR')}</div>`;
    li.addEventListener('click', () => {
      chrome.tabs.create({ url: `https://www.coupang.com/np/search?q=${encodeURIComponent(h.query)}` });
    });
    list.appendChild(li);
  }
}

$('#clearHistoryBtn').addEventListener('click', async () => {
  if (!confirm('검색 히스토리를 모두 삭제할까요?')) return;
  await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
  loadHistory();
});

// ============================================================
//  마진 계산기
// ============================================================

$('#calcBtn').addEventListener('click', () => {
  const cnyCost = parseFloat($('#calcCnyCost').value) || 0;
  const exchangeRate = parseFloat($('#calcExchangeRate').value) || 190;
  const shipping = parseFloat($('#calcShipping').value) || 0;
  const taxRate = parseFloat($('#calcTaxRate').value) || 0;
  const salePrice = parseFloat($('#calcSalePrice').value) || 0;
  const commissionRate = parseFloat($('#calcCommission').value) || 0;

  const costKrw = Math.round(cnyCost * exchangeRate);
  const tax = Math.round(costKrw * (taxRate / 100));
  const totalCost = costKrw + shipping + tax;
  const commission = Math.round(salePrice * (commissionRate / 100));
  const profit = salePrice - totalCost - commission;
  const margin = salePrice > 0 ? ((profit / salePrice) * 100).toFixed(1) : 0;

  $('#calcResult').style.display = '';
  $('#resultCostKrw').textContent = formatPrice(costKrw);
  $('#resultShipping').textContent = formatPrice(shipping);
  $('#resultTax').textContent = formatPrice(tax);
  $('#resultTotalCost').textContent = formatPrice(totalCost);
  $('#resultCommission').textContent = formatPrice(commission);
  $('#resultProfit').textContent = formatPrice(profit);
  $('#resultMargin').textContent = margin + '%';

  const cls = profit > 0 ? 'profit-positive' : 'profit-negative';
  $('#profitRow').className = `calc-result-row profit-row ${cls}`;
  $('#marginRow').className = `calc-result-row margin-row ${cls}`;
});

// ============================================================
//  서버 연동 탭
// ============================================================

const statusLabels = {
  new: '신규', reviewing: '검토중', contacted_supplier: '공급처 연락',
  sample_ordered: '샘플 주문', dropped: '탈락', selected: '선정',
};

async function checkServerAuth() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'SERVER_CHECK_AUTH' });
    if (resp?.ok && resp.loggedIn) { showLoggedIn(resp.user); return true; }
    showLoginForm();
    return false;
  } catch (e) { showLoginForm(); return false; }
}

function showLoggedIn(user) {
  $('#syncStatus').className = 'sync-status sync-connected';
  $('#syncStatus').title = '서버 연결됨';
  $('#serverLoginForm').style.display = 'none';
  $('#serverLoggedIn').style.display = '';
  $('#serverUserName').textContent = user?.name || '사용자';
  $('#serverUserEmail').textContent = user?.email || '';
  $('#serverStatusBadge').textContent = '연결됨';
  $('#serverStatusBadge').className = 'sync-indicator sync-connected';
  loadServerStats();
}

function showLoginForm() {
  $('#syncStatus').className = 'sync-status sync-disconnected';
  $('#syncStatus').title = '서버 미연결';
  $('#serverLoginForm').style.display = '';
  $('#serverLoggedIn').style.display = 'none';
  $('#serverStatusBadge').textContent = '미연결';
  $('#serverStatusBadge').className = 'sync-indicator sync-disconnected';
  $('#serverStatsCard').style.display = 'none';
}

$('#serverLoginBtn').addEventListener('click', async () => {
  const email = $('#serverEmail').value.trim();
  const password = $('#serverPassword').value;
  const errorEl = $('#serverLoginError');
  errorEl.style.display = 'none';
  if (!email || !password) { errorEl.textContent = '이메일과 비밀번호를 입력하세요.'; errorEl.style.display = ''; return; }
  const btn = $('#serverLoginBtn');
  btn.disabled = true; btn.textContent = '로그인 중...';
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'SERVER_LOGIN', email, password });
    if (resp?.ok) { showLoggedIn(resp.user); }
    else { errorEl.textContent = resp?.error || '로그인 실패'; errorEl.style.display = ''; }
  } catch (e) { errorEl.textContent = e.message || '로그인 실패'; errorEl.style.display = ''; }
  finally { btn.disabled = false; btn.textContent = '로그인'; }
});

$('#serverLogoutBtn').addEventListener('click', async () => {
  await chrome.storage.local.set({ serverLoggedIn: false, serverEmail: '' });
  showLoginForm();
});

async function loadServerStats() {
  const statsCard = $('#serverStatsCard');
  try {
    const searchResp = await chrome.runtime.sendMessage({ type: 'SERVER_SEARCH_STATS' });
    const candResp = await chrome.runtime.sendMessage({ type: 'SERVER_CANDIDATE_STATS' });
    const searchData = searchResp?.data;
    const candData = candResp?.data;
    if (!searchData && !candData) { statsCard.style.display = 'none'; return; }

    statsCard.style.display = '';
    $('#srvTotalSearches').textContent = searchData?.totalSearches || 0;
    $('#srvUniqueQueries').textContent = searchData?.uniqueQueries || 0;
    $('#srvTotalCandidates').textContent = candData?.total || 0;
    $('#srvAvgScore').textContent = candData?.avgScore || '-';

    const topList = $('#srvTopQueries');
    topList.innerHTML = '';
    if (searchData?.topQueries?.length) {
      for (const q of searchData.topQueries) {
        const li = document.createElement('li');
        li.className = 'top-query-item';
        li.innerHTML = `<span class="tq-query">"${q.query}"</span><span class="tq-count">${q.count}회</span><span class="tq-comp">경쟁 ${q.avgCompetition || '-'}점</span>`;
        li.addEventListener('click', () => chrome.tabs.create({ url: `https://www.coupang.com/np/search?q=${encodeURIComponent(q.query)}` }));
        topList.appendChild(li);
      }
    } else { topList.innerHTML = '<li class="empty-msg">아직 검색 기록이 없습니다.</li>'; }

    const statusDiv = $('#srvStatusCounts');
    statusDiv.innerHTML = '';
    if (candData?.statusCounts?.length) {
      for (const s of candData.statusCounts) {
        const chip = document.createElement('span');
        chip.className = `status-chip status-${s.status}`;
        chip.textContent = `${statusLabels[s.status] || s.status} ${s.count}`;
        statusDiv.appendChild(chip);
      }
    } else { statusDiv.innerHTML = '<span class="empty-msg">후보 없음</span>'; }
  } catch (e) { statsCard.style.display = 'none'; }
}

// ============================================================
//  데이터 로드 & 실시간 업데이트
// ============================================================

async function refreshFromCurrentTab() {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  lastActiveTabId = tab.id;

  // 쿠팡 검색 페이지인 경우만 content script에 재파싱 요청
  if (tab.url?.includes('coupang.com/np/search')) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => { document.dispatchEvent(new Event('visibilitychange')); }
      });
    } catch (e) {
      // content script가 아직 로드되지 않은 경우 — 직접 주입 시도
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
      } catch (e2) { }
    }
  }

  const response = await getResults(tab.id);
  const data = response?.data || null;

  // URL의 query와 데이터의 query 일치 검증
  if (data && tab.url?.includes('coupang.com/np/search')) {
    const urlQuery = extractQueryFromUrl(tab.url);
    if (urlQuery && data.query && urlQuery !== data.query) {
      // 데이터가 오래된 것 — content script에 강제 재파싱 요청 후 다시 조회
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            // 시그니처 초기화 강제
            document.dispatchEvent(new CustomEvent('force-reparse'));
            document.dispatchEvent(new Event('visibilitychange'));
          }
        });
      } catch (e) { }
      // 1.5초 후 다시 시도
      setTimeout(async () => {
        const retry = await getResults(tab.id);
        renderAnalysis(retry?.data || data);
      }, 1500);
      return;
    }
  }

  renderAnalysis(data);
}

chrome.runtime.onMessage.addListener(async (message) => {
  if (message?.type === 'RESULTS_UPDATED') {
    const tab = await getActiveTab();
    if (tab?.id === message.tabId) {
      const response = await getResults(tab.id);
      const data = response?.data || null;
      
      // URL과 데이터 query 일치 검증 후 렌더링
      if (data && tab.url?.includes('coupang.com/np/search')) {
        const urlQuery = extractQueryFromUrl(tab.url);
        // URL의 query와 data query가 다르면 이전 데이터일 수 있음 — 무시하고 재시도 대기
        if (urlQuery && data.query && urlQuery !== data.query) {
          return; // 다음 RESULTS_UPDATED를 기다림
        }
      }
      
      renderAnalysis(data);
      // 데이터시트 탭도 갱신
      if ($('#tab-datasheet')?.classList.contains('active')) {
        renderDataSheet();
      }
    }
  }
  if (message?.type === 'DETAIL_UPDATED') {
    currentDetail = message.detail;
    // 상세 탭이 활성 상태면 자동 갱신
    if ($('#tab-detail').classList.contains('active')) {
      renderDetail(message.detail);
    }
  }
  if (message?.type === 'WING_DATA_UPDATED') {
    // WING 탭이 활성 상태면 자동 갱신
    if ($('#tab-wing').classList.contains('active')) {
      loadWingTab();
    }
  }
});

// ============================================================
//  WING 인기상품 탭
// ============================================================

async function loadWingTab() {
  // 통계 로드
  const statsResp = await chrome.runtime.sendMessage({ type: 'GET_WING_STATS' });
  const stats = statsResp?.data;

  if (stats && stats.totalSearches > 0) {
    $('#wingStatsGrid').style.display = '';
    $('#wingStatTotal').textContent = stats.totalSearches;
    $('#wingStatKeywords').textContent = stats.uniqueKeywords;
    $('#wingStatProducts').textContent = stats.totalProducts;
    $('#wingStatAvgPrice').textContent = stats.avgPrice ? formatPrice(stats.avgPrice) : '-';
    $('#wingStatusBadge').textContent = '수집 중';
    $('#wingStatusBadge').className = 'competition-badge level-medium';
    $('#wingStatusDesc').textContent = `총 ${stats.totalSearches}건의 인기상품 데이터가 수집되었습니다.`;
  }

  // 히스토리 로드
  const histResp = await chrome.runtime.sendMessage({ type: 'GET_WING_HISTORY', limit: 30 });
  const history = histResp?.data || [];

  const list = $('#wingSearchList');
  const empty = $('#wingEmpty');
  list.innerHTML = '';

  if (!history.length) {
    empty.style.display = '';
    $('#wingDetailCard').style.display = 'none';
    return;
  }
  empty.style.display = 'none';

  for (const h of history) {
    const div = document.createElement('div');
    div.className = 'tracked-keyword-item';
    const timeStr = new Date(h.capturedAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `
      <div class="tk-main">
        <span class="tk-query">${h.keyword || '(키워드 없음)'}</span>
        ${h.category ? `<span class="tk-target">${h.category}</span>` : ''}
        <span class="tk-target">${h.count}개 · ${formatPrice(h.avgPrice)} · ${timeStr}</span>
      </div>
      <div class="tk-actions">
        <button class="btn-sm tk-ai-btn" title="AI 소싱 분석" style="background:#8b5cf6;color:#fff;font-size:10px">🤖</button>
        <button class="btn-sm tk-view-btn">📊 상세</button>
        <button class="btn-sm tk-search-btn" title="쿠팡에서 검색">🔍</button>
      </div>
    `;

    div.querySelector('.tk-ai-btn').addEventListener('click', () => runAIAnalysis(h));
    div.querySelector('.tk-view-btn').addEventListener('click', () => loadWingDetail(h));
    div.querySelector('.tk-search-btn').addEventListener('click', () => {
      if (h.keyword) {
        chrome.tabs.create({ url: `https://www.coupang.com/np/search?q=${encodeURIComponent(h.keyword)}` });
      }
    });
    list.appendChild(div);
  }
}

function loadWingDetail(entry) {
  currentWingEntry = entry;
  const card = $('#wingDetailCard');
  card.style.display = '';
  $('#wingDetailTitle').textContent = entry.keyword || '(키워드 없음)';
  $('#wingDetailCount').textContent = entry.count || 0;

  const content = $('#wingDetailContent');
  const items = entry.items || [];

  if (!items.length) {
    content.innerHTML = '<p class="empty-msg">상세 상품 데이터가 없습니다.</p>';
    return;
  }

  let html = '<div class="rank-list">';
  for (const item of items.slice(0, 30)) {
    html += `
      <div class="rank-item">
        <span class="rank-pos">#${item.rank || '-'}</span>
        <div class="rank-info">
          <div class="rank-title">${item.productName || item.title || '(상품명 없음)'}</div>
          <div class="rank-meta">
            ${item.price ? formatPrice(item.price) : '-'}
            ${item.brand ? ` · ${item.brand}` : ''}
            ${item.rating ? ` · 평점 ${item.rating}` : ''}
            ${item.reviewCount ? ` · 리뷰 ${item.reviewCount}` : ''}
            ${item.viewCount ? ` · 조회 ${item.viewCount}` : ''}
          </div>
        </div>
      </div>`;
  }
  html += '</div>';
  content.innerHTML = html;
}

$('#clearWingBtn').addEventListener('click', async () => {
  if (!confirm('WING 인기상품 데이터를 모두 삭제할까요?')) return;
  await chrome.runtime.sendMessage({ type: 'CLEAR_WING_HISTORY' });
  loadWingTab();
});

// ============================================================
//  AI 소싱 코치 분석 시스템 (v5.0)
// ============================================================

let _aiAnalyzing = false;

// WING 검색 결과에서 AI 분석 실행
async function runAIAnalysis(entry) {
  if (_aiAnalyzing) return;
  _aiAnalyzing = true;
  currentWingEntry = entry;

  const panel = $('#aiAnalysisPanel');
  const loading = $('#aiLoading');
  const overview = $('#aiOverview');
  const topRecs = $('#aiTopRecs');
  const productList = $('#aiProductList');
  const suggestions = $('#aiSearchSuggestions');

  // UI 초기화
  panel.style.display = '';
  loading.style.display = '';
  overview.style.display = 'none';
  topRecs.style.display = 'none';
  productList.innerHTML = '';
  suggestions.style.display = 'none';

  try {
    // 서버 AI 분석 호출
    const items = (entry.items || []).map((p, i) => ({
      rank: p.rank || i + 1,
      productName: p.productName || p.title || '',
      price: p.price || 0,
      rating: p.rating || 0,
      reviewCount: p.reviewCount || 0,
      viewCount: p.viewCount || 0,
      brand: p.brand || '',
      manufacturer: p.manufacturer || '',
      category: p.category || entry.category || '',
      imageUrl: p.imageUrl || '',
    }));

    const resp = await chrome.runtime.sendMessage({
      type: 'AI_ANALYZE_WING',
      data: {
        keyword: entry.keyword || '',
        category: entry.category || '',
        products: items,
      }
    });

    loading.style.display = 'none';

    if (!resp?.ok || !resp.data) {
      productList.innerHTML = '<div class="empty-msg">AI 분석에 실패했습니다. 서버 연결을 확인해주세요.</div>';
      _aiAnalyzing = false;
      return;
    }

    const data = resp.data;
    currentAIAnalysis = data;

    // AI/규칙 뱃지
    $('#aiPoweredBadge').textContent = data.aiPowered ? 'AI' : '규칙 기반';
    $('#aiPoweredBadge').style.background = data.aiPowered ? 'linear-gradient(135deg, #8b5cf6, #6366f1)' : '#6b7280';

    // 시장 요약
    if (data.overview) {
      overview.style.display = '';
      $('#aiMarketSummary').textContent = data.overview.marketSummary || '-';
      const compLevel = data.overview.competitionLevel || '-';
      const compColors = { '낮음': '#059669', '보통': '#d97706', '높음': '#dc2626', '매우높음': '#7f1d1d' };
      $('#aiCompetitionLevel').innerHTML = `<span style="color:${compColors[compLevel] || '#6b7280'};font-weight:700">${compLevel}</span>`;
      $('#aiTrendInsight').textContent = data.overview.trendInsight || '-';
      $('#aiBestOpportunity').textContent = data.overview.bestOpportunity || '-';
    }

    // TOP 추천
    if (data.topRecommendations?.length) {
      topRecs.style.display = '';
      const recList = $('#aiTopRecsList');
      recList.innerHTML = '';
      data.topRecommendations.forEach((rec, i) => {
        const div = document.createElement('div');
        div.className = 'ai-rec-item';
        div.innerHTML = `
          <div class="ai-rec-rank ${i === 0 ? 'top1' : ''}">${i + 1}</div>
          <div class="ai-rec-info">
            <div class="ai-rec-name">${rec.productName}</div>
            <div class="ai-rec-reason">${rec.reason}</div>
            <div class="ai-rec-action">${rec.actionPlan}</div>
          </div>
        `;
        recList.appendChild(div);
      });
    }

    // 상품별 분석
    if (data.products?.length) {
      renderAIProducts(data.products, productList);
    }

    // 키워드 제안
    if (data.searchSuggestions) {
      suggestions.style.display = '';
      const sContent = $('#aiSuggestionsContent');
      let sHtml = '';
      if (data.searchSuggestions.relatedKeywords?.length) {
        sHtml += '<div class="ai-section"><div class="ai-section-label">추천 키워드</div><div class="ai-suggestion-tags">';
        data.searchSuggestions.relatedKeywords.forEach(kw => {
          sHtml += `<span class="ai-suggestion-tag" onclick="navigator.clipboard.writeText('${kw}').then(()=>this.style.background='#a7f3d0')">${kw}</span>`;
        });
        sHtml += '</div></div>';
      }
      if (data.searchSuggestions.avoidKeywords?.length) {
        sHtml += '<div class="ai-section"><div class="ai-section-label">피해야 할 키워드</div><div class="ai-suggestion-tags">';
        data.searchSuggestions.avoidKeywords.forEach(kw => {
          sHtml += `<span class="ai-suggestion-tag avoid">${kw}</span>`;
        });
        sHtml += '</div></div>';
      }
      if (data.searchSuggestions.nicheSuggestion) {
        sHtml += `<div class="ai-section"><div class="ai-section-label">니치 시장 제안</div><div class="ai-section-value">${data.searchSuggestions.nicheSuggestion}</div></div>`;
      }
      sContent.innerHTML = sHtml;
    }

  } catch (err) {
    loading.style.display = 'none';
    productList.innerHTML = `<div class="empty-msg">AI 분석 오류: ${err.message || '알 수 없는 오류'}</div>`;
  }

  _aiAnalyzing = false;
}

// AI 분석된 상품 목록 렌더링
function renderAIProducts(products, container) {
  container.innerHTML = '';

  const badgeColors = {
    '초보추천': { bg: '#d1fae5', color: '#065f46' },
    '고마진': { bg: '#d1fae5', color: '#065f46' },
    '저마진': { bg: '#fee2e2', color: '#991b1b' },
    '소싱쉬움': { bg: '#dbeafe', color: '#1e40af' },
    '경쟁약함': { bg: '#dbeafe', color: '#1e40af' },
    '경쟁심함': { bg: '#fee2e2', color: '#991b1b' },
    '인증필요': { bg: '#fee2e2', color: '#991b1b' },
    '파손위험': { bg: '#fef3c7', color: '#92400e' },
    '계절상품': { bg: '#ede9fe', color: '#6d28d9' },
    '배송주의': { bg: '#fef3c7', color: '#92400e' },
    '옵션복잡': { bg: '#ede9fe', color: '#6d28d9' },
  };

  for (const p of products) {
    const card = document.createElement('div');
    card.className = 'ai-product-card';

    const badgesHtml = (p.badges || []).map(b => {
      const c = badgeColors[b] || { bg: '#f3f4f6', color: '#6b7280' };
      return `<span class="ai-product-badge" style="background:${c.bg};color:${c.color}">${b}</span>`;
    }).join('');

    const fit = p.beginnerFit || {};
    const difficultyLabels = { easy: '쉬움', medium: '보통', hard: '어려움', expert: '전문가' };
    const fitClass = fit.difficulty || 'medium';

    card.innerHTML = `
      <div class="ai-product-header">
        <div class="ai-product-rank">${p.rank || '-'}</div>
        <div class="ai-product-name" title="${p.productName}">${p.productName}</div>
        <div class="ai-product-badges">${badgesHtml}</div>
        <span class="ai-product-toggle">▼</span>
      </div>
      <div class="ai-product-body">
        <!-- 초보 적합도 -->
        <div class="ai-beginner-fit ${fitClass}">
          <div class="ai-fit-score">${fit.score || '-'}</div>
          <div class="ai-fit-info">
            <div style="font-size:11px;font-weight:600">${fit.reason || '-'}</div>
            <span class="ai-fit-difficulty">${difficultyLabels[fit.difficulty] || '?'}</span>
          </div>
        </div>

        <!-- 코치 코멘트 -->
        ${p.coachComment ? `<div class="ai-coach-comment">${p.coachComment}</div>` : ''}

        <!-- 상품 용도 -->
        ${p.purpose ? `<div class="ai-section"><div class="ai-section-label">용도</div><div class="ai-section-value">${p.purpose}</div></div>` : ''}

        <!-- 셀링 포인트 -->
        ${p.sellingPoints?.length ? `
          <div class="ai-section">
            <div class="ai-section-label">핵심 포인트</div>
            <ul class="ai-selling-points">${p.sellingPoints.map(sp => `<li>${sp}</li>`).join('')}</ul>
          </div>` : ''}

        <!-- 마진 -->
        ${p.margin ? `
          <div class="ai-section">
            <div class="ai-section-label">마진 분석</div>
            <div class="ai-margin-bar">
              <span class="ai-margin-label">예상 원가</span>
              <span class="ai-margin-value">${p.margin.estimatedCnyCost || '-'}</span>
            </div>
            <div class="ai-margin-bar">
              <span class="ai-margin-label">예상 마진</span>
              <span class="ai-margin-value ${parseFloat(p.margin.expectedMarginRate) >= 30 ? 'ai-margin-good' : parseFloat(p.margin.expectedMarginRate) >= 15 ? 'ai-margin-caution' : 'ai-margin-danger'}">${p.margin.expectedMarginRate || '-'}</span>
            </div>
            <div class="ai-margin-bar">
              <span class="ai-margin-label">조언</span>
              <span class="ai-section-value">${p.margin.advice || '-'}</span>
            </div>
          </div>` : ''}

        <!-- 리스크 -->
        ${p.risks?.length ? `
          <div class="ai-section">
            <div class="ai-section-label">리스크</div>
            <ul class="ai-risk-list">${p.risks.map(r => `<li>${r}</li>`).join('')}</ul>
          </div>` : ''}

        <!-- 소싱 키워드 -->
        ${p.keywords ? `
          <div class="ai-section">
            <div class="ai-section-label">소싱 키워드</div>
            <div class="ai-keyword-row">
              ${p.keywords.korean ? `<span class="ai-keyword-tag ko" onclick="navigator.clipboard.writeText('${p.keywords.korean}').then(()=>this.style.opacity='0.5')" title="클릭하여 복사">🇰🇷 ${p.keywords.korean}</span>` : ''}
              ${p.keywords.chinese ? `<span class="ai-keyword-tag cn" onclick="navigator.clipboard.writeText('${p.keywords.chinese}').then(()=>this.style.opacity='0.5')" title="클릭하여 복사">🇨🇳 ${p.keywords.chinese}</span>` : ''}
              ${p.keywords.english ? `<span class="ai-keyword-tag en" onclick="navigator.clipboard.writeText('${p.keywords.english}').then(()=>this.style.opacity='0.5')" title="클릭하여 복사">🇺🇸 ${p.keywords.english}</span>` : ''}
            </div>
            <div class="ai-search-btns">
              ${p.keywords.chinese ? `<button class="ai-search-btn btn-1688" onclick="window.open('https://s.1688.com/selloffer/offer_search.htm?keywords='+encodeURIComponent('${p.keywords.chinese}'))">1688 검색</button>` : ''}
              ${p.keywords.english ? `<button class="ai-search-btn btn-ali" onclick="window.open('https://www.aliexpress.com/wholesale?SearchText='+encodeURIComponent('${p.keywords.english}'))">AliExpress</button>` : ''}
              ${p.keywords.korean ? `<button class="ai-search-btn" onclick="window.open('https://www.coupang.com/np/search?q='+encodeURIComponent('${p.keywords.korean}'))">쿠팡 검색</button>` : ''}
            </div>
          </div>` : ''}

        <!-- 규칙 기반 점수 (있으면) -->
        ${p.ruleBasedScore ? `
          <div class="ai-section" style="margin-top:8px;padding-top:8px;border-top:1px solid #e5e7eb">
            <div class="ai-section-label">소싱 점수 (규칙 기반)</div>
            <div style="display:flex;gap:6px;align-items:center;font-size:11px">
              <span class="coach-grade-badge" style="background:${p.ruleBasedScore.grade === 'S' ? '#16a34a' : p.ruleBasedScore.grade === 'A' ? '#3b82f6' : p.ruleBasedScore.grade === 'B' ? '#f59e0b' : '#9ca3af'};color:#fff;padding:2px 6px;border-radius:4px;font-weight:700;font-size:10px">${p.ruleBasedScore.grade}</span>
              <span>${p.ruleBasedScore.total}점</span>
              <span style="color:#6b7280">(마진${p.ruleBasedScore.breakdown.margin} 경쟁${p.ruleBasedScore.breakdown.competition} 소싱${p.ruleBasedScore.breakdown.sourcingEase} 옵션${p.ruleBasedScore.breakdown.optionSimplicity} 인증${p.ruleBasedScore.breakdown.certStability} 배송${p.ruleBasedScore.breakdown.deliveryStability} 리뷰${p.ruleBasedScore.breakdown.reviewPotential})</span>
            </div>
          </div>` : ''}
      </div>
    `;

    // 아코디언 토글
    const header = card.querySelector('.ai-product-header');
    const body = card.querySelector('.ai-product-body');
    const toggle = card.querySelector('.ai-product-toggle');
    header.addEventListener('click', () => {
      body.classList.toggle('expanded');
      toggle.classList.toggle('expanded');
    });

    container.appendChild(card);
  }
}

// 전체 분석 버튼 (최신 WING 검색 결과를 AI 분석)
$('#aiAnalyzeAllBtn').addEventListener('click', async () => {
  const histResp = await chrome.runtime.sendMessage({ type: 'GET_WING_HISTORY', limit: 1 });
  const history = histResp?.data || [];
  if (!history.length) {
    alert('분석할 WING 인기상품 데이터가 없습니다.\nWING 셀러센터에서 인기상품검색을 먼저 해주세요.');
    return;
  }
  runAIAnalysis(history[0]);
});

// 상세 보기에서 AI 분석 버튼
$('#aiAnalyzeDetailBtn').addEventListener('click', () => {
  if (currentWingEntry) {
    runAIAnalysis(currentWingEntry);
  } else {
    alert('먼저 WING 검색 결과를 선택해주세요.');
  }
});

// ============================================================
//  데이터시트 탭
// ============================================================

let dsCurrentPage = 1;
let dsPageSize = 20;
let dsCurrentSort = { col: 'position', dir: 'asc' };
let dsSearchFilter = '';
let dsColumnMode = 'all';
let dsSelectedRows = new Set();

const DS_COLUMNS = {
  all: [
    { key: 'checkbox', label: '', width: 28, sortable: false },
    { key: 'position', label: '#', width: 30, sortable: true },
    { key: 'image', label: '', width: 40, sortable: false },
    { key: 'title', label: '상품명', width: 180, sortable: true },
    { key: 'price', label: '가격', width: 75, sortable: true },
    { key: 'rating', label: '평점', width: 42, sortable: true },
    { key: 'reviewCount', label: '리뷰', width: 55, sortable: true },
    { key: 'sourcingScore', label: '소싱점수', width: 55, sortable: true },
    { key: 'sourcingGrade', label: '등급', width: 45, sortable: true },
    { key: 'isAd', label: 'AD', width: 32, sortable: true },
    { key: 'isRocket', label: '로켓', width: 32, sortable: true },
    { key: 'actions', label: '', width: 80, sortable: false },
  ],
  compact: [
    { key: 'checkbox', label: '', width: 28, sortable: false },
    { key: 'position', label: '#', width: 30, sortable: true },
    { key: 'title', label: '상품명', width: 200, sortable: true },
    { key: 'price', label: '가격', width: 80, sortable: true },
    { key: 'reviewCount', label: '리뷰', width: 60, sortable: true },
    { key: 'sourcingGrade', label: '등급', width: 45, sortable: true },
  ],
  sourcing: [
    { key: 'checkbox', label: '', width: 28, sortable: false },
    { key: 'position', label: '#', width: 30, sortable: true },
    { key: 'title', label: '상품명', width: 160, sortable: true },
    { key: 'price', label: '가격', width: 75, sortable: true },
    { key: 'rating', label: '평점', width: 42, sortable: true },
    { key: 'reviewCount', label: '리뷰', width: 55, sortable: true },
    { key: 'sourcingScore', label: '소싱점수', width: 55, sortable: true },
    { key: 'sourcingGrade', label: '등급', width: 45, sortable: true },
    { key: 'isAd', label: 'AD', width: 32, sortable: true },
    { key: 'isRocket', label: '로켓', width: 32, sortable: true },
    { key: 'actions', label: '', width: 80, sortable: false },
  ],
  detail: [
    { key: 'checkbox', label: '', width: 28, sortable: false },
    { key: 'position', label: '#', width: 30, sortable: true },
    { key: 'image', label: '', width: 40, sortable: false },
    { key: 'title', label: '상품명', width: 160, sortable: true },
    { key: 'price', label: '가격', width: 75, sortable: true },
    { key: 'rating', label: '평점', width: 42, sortable: true },
    { key: 'reviewCount', label: '리뷰', width: 55, sortable: true },
    { key: 'sourcingScore', label: '소싱점수', width: 55, sortable: true },
    { key: 'sourcingGrade', label: '등급', width: 45, sortable: true },
    { key: 'isAd', label: 'AD', width: 32, sortable: true },
    { key: 'isRocket', label: '로켓', width: 32, sortable: true },
    { key: 'productId', label: '상품ID', width: 75, sortable: true },
    { key: 'actions', label: '', width: 80, sortable: false },
  ],
};

function getDataSheetItems() {
  if (!currentData?.items?.length) return [];
  const comp = analyzeCompetition(currentData.items);
  let items = currentData.items.map((item, idx) => {
    const score = calcSourcingScore(item, comp?.avgPrice || 0, comp?.avgReview || 0);
    const grade = getSourcingGrade(score);
    return { ...item, sourcingScore: score, sourcingGrade: grade.grade, _gradeInfo: grade };
  });

  // 검색 필터
  if (dsSearchFilter) {
    const q = dsSearchFilter.toLowerCase();
    items = items.filter(i => (i.title || '').toLowerCase().includes(q) || (i.productId || '').includes(q));
  }

  // 정렬
  const { col, dir } = dsCurrentSort;
  items.sort((a, b) => {
    let va = a[col], vb = b[col];
    if (col === 'sourcingGrade') {
      const order = { A: 5, B: 4, C: 3, D: 2, F: 1 };
      va = order[va] || 0; vb = order[vb] || 0;
    }
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (typeof va === 'boolean') { va = va ? 1 : 0; vb = vb ? 1 : 0; }
    if (va < vb) return dir === 'asc' ? -1 : 1;
    if (va > vb) return dir === 'asc' ? 1 : -1;
    return 0;
  });

  return items;
}

function renderDataSheet() {
  const items = getDataSheetItems();
  const empty = $('#dsEmpty');
  const summary = $('#dsSummary');
  const filterRow = $('#dsFilterRow');
  const wrapper = $('#dsTableWrapper');
  const pagination = $('#dsPagination');

  if (!items.length && !currentData?.items?.length) {
    empty.style.display = '';
    summary.style.display = 'none';
    filterRow.style.display = 'none';
    wrapper.style.display = 'none';
    pagination.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  summary.style.display = '';
  filterRow.style.display = '';
  wrapper.style.display = '';

  // 요약 정보
  const comp = analyzeCompetition(currentData.items);
  $('#dsQuery').textContent = `"${currentData.query || '-'}"` ;
  $('#dsCount').textContent = `${currentData.items.length}개`;
  $('#dsAvgPrice').textContent = comp ? formatPrice(comp.avgPrice) : '-';
  if (comp) {
    const el = $('#dsCompLevel');
    el.textContent = `${comp.level} (${comp.competitionScore}점)`;
    el.className = `ds-summary-value ds-comp-${comp.competitionScore >= 70 ? 'hard' : comp.competitionScore >= 45 ? 'medium' : 'easy'}`;
  }

  // 컬럼 설정
  const columns = DS_COLUMNS[dsColumnMode] || DS_COLUMNS.all;

  // 페이지 계산
  const totalPages = Math.max(1, Math.ceil(items.length / dsPageSize));
  if (dsCurrentPage > totalPages) dsCurrentPage = totalPages;
  const startIdx = (dsCurrentPage - 1) * dsPageSize;
  const pageItems = items.slice(startIdx, startIdx + dsPageSize);

  // 테이블 헤더
  const thead = $('#dsTableHead');
  let headHtml = '<tr>';
  for (const col of columns) {
    if (col.key === 'checkbox') {
      headHtml += `<th style="width:${col.width}px"><input type="checkbox" class="ds-checkbox" id="dsSelectAll" /></th>`;
    } else {
      const sortable = col.sortable ? 'ds-sortable' : '';
      const active = dsCurrentSort.col === col.key;
      const cls = active ? (dsCurrentSort.dir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
      const icon = active ? (dsCurrentSort.dir === 'asc' ? '\u25B2' : '\u25BC') : '\u25B2';
      headHtml += `<th class="${sortable} ${cls}" data-col="${col.key}" style="width:${col.width}px">${col.label}${col.sortable ? ` <span class="sort-icon">${icon}</span>` : ''}</th>`;
    }
  }
  headHtml += '</tr>';
  thead.innerHTML = headHtml;

  // 테이블 바디
  const tbody = $('#dsTableBody');
  let bodyHtml = '';
  for (const item of pageItems) {
    const isSelected = dsSelectedRows.has(item.productId);
    bodyHtml += `<tr class="${isSelected ? 'ds-row-selected' : ''}" data-pid="${item.productId || ''}">`;
    for (const col of columns) {
      bodyHtml += renderDsCell(col.key, item);
    }
    bodyHtml += '</tr>';
  }
  tbody.innerHTML = bodyHtml;

  // 페이지네이션
  if (items.length > dsPageSize) {
    pagination.style.display = '';
    $('#dsPageInfo').textContent = `${dsCurrentPage} / ${totalPages} (${items.length}건)`;
    $('#dsPrevPage').disabled = dsCurrentPage <= 1;
    $('#dsNextPage').disabled = dsCurrentPage >= totalPages;
  } else {
    pagination.style.display = 'none';
  }

  // 이벤트 바인딩
  bindDsEvents();
}

function renderDsCell(key, item) {
  switch (key) {
    case 'checkbox':
      return `<td><input type="checkbox" class="ds-checkbox ds-row-check" data-pid="${item.productId || ''}" ${dsSelectedRows.has(item.productId) ? 'checked' : ''} /></td>`;
    case 'position':
      return `<td class="ds-cell-rank">${item.position || '-'}</td>`;
    case 'image':
      return item.imageUrl ? `<td class="ds-cell-img"><img src="${item.imageUrl}" alt="" loading="lazy" /></td>` : '<td class="ds-cell-img">-</td>';
    case 'title':
      return `<td class="ds-cell-title" title="${(item.title || '').replace(/"/g, '&quot;')}" data-url="${item.url || ''}">${item.title || '(제목 없음)'}</td>`;
    case 'price':
      return `<td class="ds-cell-price">${item.price ? item.price.toLocaleString() : '-'}</td>`;
    case 'rating': {
      const r = item.rating || 0;
      const color = r >= 4.5 ? 'var(--success)' : r >= 3.5 ? 'var(--gray-700)' : r > 0 ? 'var(--danger)' : 'var(--gray-300)';
      return `<td class="ds-cell-rating" style="color:${color}">${r || '-'}</td>`;
    }
    case 'reviewCount':
      return `<td class="ds-cell-review">${item.reviewCount ? item.reviewCount.toLocaleString() : '0'}</td>`;
    case 'sourcingScore':
      return `<td>${item.sourcingScore || 0}</td>`;
    case 'sourcingGrade': {
      const g = item.sourcingGrade || 'F';
      return `<td class="ds-cell-grade"><span class="ds-grade-${g.toLowerCase()}">${g}</span></td>`;
    }
    case 'isAd':
      return `<td class="ds-cell-ad">${item.isAd ? '<span style="color:#b45309">AD</span>' : ''}</td>`;
    case 'isRocket':
      return `<td class="ds-cell-rocket">${item.isRocket ? '\ud83d\ude80' : ''}</td>`;
    case 'productId':
      return `<td style="font-size:10px;color:var(--gray-500)">${item.productId || '-'}</td>`;
    case 'actions':
      return `<td class="ds-cell-actions">
        <button class="ds-btn-1688" data-title="${(item.title || '').replace(/"/g, '&quot;')}" title="1688 검색">\ud83d\udd0d</button>
        <button class="ds-btn-save" data-pid="${item.productId || ''}" title="후보 저장">\u2b50</button>
        <button class="ds-btn-link" data-url="${item.url || ''}" title="쿠팡에서 보기">\u2197\ufe0f</button>
      </td>`;
    default:
      return '<td>-</td>';
  }
}

function bindDsEvents() {
  // 제목 클릭 → 쿠팡 열기
  $$('.ds-cell-title').forEach(td => {
    td.addEventListener('click', () => {
      const url = td.dataset.url;
      if (url) chrome.tabs.create({ url });
    });
  });

  // 1688 버튼 → 스마트 소싱 팝업
  $$('.ds-btn-1688').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const title = btn.dataset.title;
      const row = btn.closest('tr');
      const imgEl = row?.querySelector('.ds-cell-img img');
      showSourcingPopup(title, imgEl?.src || '', e.target);
    });
  });

  // 후보 저장
  $$('.ds-btn-save').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pid = btn.dataset.pid;
      const item = currentData?.items?.find(i => i.productId === pid);
      if (item) {
        await chrome.runtime.sendMessage({ type: 'SAVE_CANDIDATE', item });
        btn.textContent = '\u2705';
        btn.disabled = true;
      }
    });
  });

  // 외부 링크
  $$('.ds-btn-link').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.url) chrome.tabs.create({ url: btn.dataset.url });
    });
  });

  // 행 체크박스
  $$('.ds-row-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const pid = cb.dataset.pid;
      if (cb.checked) dsSelectedRows.add(pid);
      else dsSelectedRows.delete(pid);
      cb.closest('tr').classList.toggle('ds-row-selected', cb.checked);
      updateDsSelectionBar();
    });
  });

  // 전체 선택
  const selectAll = $('#dsSelectAll');
  if (selectAll) {
    selectAll.addEventListener('change', () => {
      const items = getDataSheetItems();
      const startIdx = (dsCurrentPage - 1) * dsPageSize;
      const pageItems = items.slice(startIdx, startIdx + dsPageSize);
      pageItems.forEach(i => {
        if (selectAll.checked) dsSelectedRows.add(i.productId);
        else dsSelectedRows.delete(i.productId);
      });
      $$('.ds-row-check').forEach(cb => { cb.checked = selectAll.checked; });
      $$('#dsTableBody tr').forEach(tr => { tr.classList.toggle('ds-row-selected', selectAll.checked); });
      updateDsSelectionBar();
    });
  }

  // 헤더 정렬 클릭
  $$('.ds-sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (dsCurrentSort.col === col) {
        dsCurrentSort.dir = dsCurrentSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        dsCurrentSort = { col, dir: 'asc' };
      }
      renderDataSheet();
    });
  });
}

function updateDsSelectionBar() {
  let bar = $('#dsSelectionBar');
  if (dsSelectedRows.size > 0) {
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'dsSelectionBar';
      bar.className = 'ds-selection-bar';
      const wrapper = $('#dsTableWrapper');
      wrapper.parentNode.insertBefore(bar, wrapper);
    }
    bar.innerHTML = `<span>${dsSelectedRows.size}개 선택됨</span>
      <div>
        <button id="dsSelBulk1688">\ud83d\udd0d 1688 검색</button>
        <button id="dsSelBulkSave">\u2b50 일괄 저장</button>
        <button id="dsSelBulkCsv">\ud83d\udce5 CSV</button>
        <button id="dsSelClear">\u2716 해제</button>
      </div>`;

    $('#dsSelBulk1688')?.addEventListener('click', async () => {
      const items = getDataSheetItems().filter(i => dsSelectedRows.has(i.productId));
      if (!items.length) return;
      if (items.length > 5 && !confirm(`${items.length}개 상품을 1688에서 검색할까요? (중국어 자동 번역)`)) return;
      for (const item of items.slice(0, 10)) {
        const keywords = extractSmartKeyword(item.title);
        let searchTerm = keywords.cn;
        if (!searchTerm) {
          searchTerm = await translateKoToCn(keywords.ko);
        }
        if (!searchTerm) searchTerm = keywords.ko;
        chrome.tabs.create({ url: `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(searchTerm)}` });
      }
    });

    $('#dsSelBulkSave')?.addEventListener('click', async () => {
      const items = getDataSheetItems().filter(i => dsSelectedRows.has(i.productId));
      let saved = 0;
      for (const item of items) {
        const original = currentData.items.find(o => o.productId === item.productId);
        if (original) {
          await chrome.runtime.sendMessage({ type: 'SAVE_CANDIDATE', item: original });
          saved++;
        }
      }
      alert(`${saved}개 상품을 후보에 저장했습니다.`);
    });

    $('#dsSelBulkCsv')?.addEventListener('click', () => {
      const items = getDataSheetItems().filter(i => dsSelectedRows.has(i.productId));
      exportToCSV(items, currentData?.query);
    });

    $('#dsSelClear')?.addEventListener('click', () => {
      dsSelectedRows.clear();
      renderDataSheet();
    });
  } else if (bar) {
    bar.remove();
  }
}

// 데이터시트 필터 이벤트
$('#dsSearchInput')?.addEventListener('input', (e) => {
  dsSearchFilter = e.target.value.trim();
  dsCurrentPage = 1;
  renderDataSheet();
});

$('#dsColumnFilter')?.addEventListener('change', (e) => {
  dsColumnMode = e.target.value;
  renderDataSheet();
});

// 페이지네이션
$('#dsPrevPage')?.addEventListener('click', () => {
  if (dsCurrentPage > 1) { dsCurrentPage--; renderDataSheet(); }
});
$('#dsNextPage')?.addEventListener('click', () => {
  const items = getDataSheetItems();
  const totalPages = Math.ceil(items.length / dsPageSize);
  if (dsCurrentPage < totalPages) { dsCurrentPage++; renderDataSheet(); }
});

// 데이터시트 CSV 내보내기
$('#dsExportCsvBtn')?.addEventListener('click', () => {
  const items = getDataSheetItems();
  exportToCSV(items, currentData?.query);
});

// 데이터시트 Excel(TSV) 내보내기
$('#dsExportExcelBtn')?.addEventListener('click', () => {
  const items = getDataSheetItems();
  if (!items.length) { alert('내보낼 데이터가 없습니다.'); return; }
  const headers = ['순위', '상품명', '가격', '평점', '리뷰수', '소싱점수', '등급', '광고', '로켓배송', '상품ID', 'URL'];
  const rows = items.map(item => [
    item.position,
    (item.title || '').replace(/\t/g, ' '),
    item.price || 0,
    item.rating || 0,
    item.reviewCount || 0,
    item.sourcingScore || 0,
    item.sourcingGrade || '-',
    item.isAd ? 'Y' : 'N',
    item.isRocket ? 'Y' : 'N',
    item.productId || '',
    item.url || '',
  ].join('\t'));
  const bom = '\uFEFF';
  const tsv = bom + headers.join('\t') + '\n' + rows.join('\n');
  const blob = new Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `coupang_${(currentData?.query || 'data').replace(/[^a-zA-Z0-9가-힣]/g, '_')}_${new Date().toISOString().slice(0, 10)}.xls`;
  a.click();
  URL.revokeObjectURL(url);
});

// ============================================================
//  CSV 내보내기
// ============================================================

function exportToCSV(items, query) {
  if (!items?.length) { alert('내보낼 데이터가 없습니다.'); return; }
  const comp = analyzeCompetition(items);
  const headers = ['순위', '상품명', '가격', '평점', '리뷰수', '소싱점수', '소싱등급', '광고', '로켓배송', 'URL'];
  const rows = items.map(item => {
    const score = calcSourcingScore(item, comp?.avgPrice || 0, comp?.avgReview || 0);
    const grade = getSourcingGrade(score);
    return [
      item.position,
      `"${(item.title || '').replace(/"/g, '""')}"`,
      item.price || 0,
      item.rating || 0,
      item.reviewCount || 0,
      score,
      grade.grade,
      item.isAd ? 'Y' : 'N',
      item.isRocket ? 'Y' : 'N',
      item.url || '',
    ].join(',');
  });
  const bom = '\uFEFF'; // UTF-8 BOM for Korean
  const csv = bom + headers.join(',') + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `coupang_${(query || 'analysis').replace(/[^a-zA-Z0-9가-힣]/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

$('#exportCsvBtn').addEventListener('click', () => {
  exportToCSV(getFilteredSorted(), currentData?.query);
});

// ============================================================
//  환율 실시간 가져오기
// ============================================================

$('#fetchRateBtn').addEventListener('click', async () => {
  const btn = $('#fetchRateBtn');
  btn.disabled = true;
  btn.textContent = '⏳';
  try {
    // 공개 환율 API 사용
    const resp = await fetch('https://open.er-api.com/v6/latest/CNY');
    const data = await resp.json();
    if (data?.rates?.KRW) {
      const rate = Math.round(data.rates.KRW);
      $('#calcExchangeRate').value = rate;
      btn.textContent = '✅';
      setTimeout(() => { btn.textContent = '🔄'; btn.disabled = false; }, 2000);
    } else { throw new Error('환율 데이터 없음'); }
  } catch (e) {
    btn.textContent = '❌';
    setTimeout(() => { btn.textContent = '🔄'; btn.disabled = false; }, 2000);
    alert('환율 가져오기 실패. 네트워크를 확인하세요.');
  }
});

// ============================================================
//  마진 계산 결과 저장
// ============================================================

$('#exportMarginBtn').addEventListener('click', () => {
  const result = $('#calcResult');
  if (result.style.display === 'none') { alert('먼저 계산을 실행하세요.'); return; }
  const data = {
    date: new Date().toISOString().slice(0, 10),
    cnyCost: $('#calcCnyCost').value,
    exchangeRate: $('#calcExchangeRate').value,
    shipping: $('#calcShipping').value,
    taxRate: $('#calcTaxRate').value,
    salePrice: $('#calcSalePrice').value,
    commission: $('#calcCommission').value,
    costKrw: $('#resultCostKrw').textContent,
    totalCost: $('#resultTotalCost').textContent,
    profit: $('#resultProfit').textContent,
    margin: $('#resultMargin').textContent,
  };
  const bom = '\uFEFF';
  const csv = bom + Object.keys(data).join(',') + '\n' + Object.values(data).join(',');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `margin_calc_${data.date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// ============================================================
//  가이드 탭 — 아코디언 토글
// ============================================================

$$('[data-guide-toggle]').forEach(header => {
  header.addEventListener('click', () => {
    const targetId = header.getAttribute('data-guide-toggle');
    const body = $(`#guide-${targetId}`);
    const icon = header.querySelector('.guide-toggle-icon');
    if (!body) return;
    const isOpen = body.classList.contains('open');
    // 다른건 닫지 않고 개별 토글
    body.classList.toggle('open');
    icon.textContent = isOpen ? '▼' : '▲';
  });
});

// 초기 로드
refreshFromCurrentTab();
checkServerAuth();
