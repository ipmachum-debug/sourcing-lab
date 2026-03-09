/* ============================================================
   Coupang Sourcing Helper — AliExpress Detail Content Script v6.0
   알리익스프레스 상품 상세 페이지 분석 패널
   
   목적: 참고용 (DB 저장 없음)
   - 상품 기본정보 (가격/평점/리뷰수/판매자)
   - "쿠팡에서 찾기" 버튼 (자동 키워드 변환)
   - "1688에서 찾기" 버튼
   - "소싱 후보 등록" 버튼 (기존 SAVE_CANDIDATE 재활용)
   - 쿠팡 예상 판매가 / 마진 간단 계산
   ============================================================ */
(function () {
  'use strict';
  const VER = '6.0.0';

  if (window.__SH_ALI_DETAIL_LOADED__) return;
  window.__SH_ALI_DETAIL_LOADED__ = true;

  console.log(`%c[SH-Ali-Detail] v${VER} 상품 상세 분석 로드`, 'color:#e74c3c;font-weight:bold;font-size:12px;');

  // ============================================================
  //  CSS
  // ============================================================
  const css = document.createElement('style');
  css.id = 'sh-ali-detail-css';
  css.textContent = `
    #sh-ali-detail {
      position: fixed !important;
      top: 60px !important;
      right: 10px !important;
      width: 320px !important;
      max-height: calc(100vh - 80px) !important;
      z-index: 2147483640 !important;
      font-family: -apple-system, 'Noto Sans KR', 'Malgun Gothic', sans-serif !important;
      font-size: 12px !important;
      color: #1e293b !important;
      background: #fff !important;
      border-radius: 14px !important;
      box-shadow: 0 8px 40px rgba(0,0,0,0.15), 0 1px 4px rgba(0,0,0,0.06) !important;
      display: flex !important;
      flex-direction: column !important;
      overflow: hidden !important;
      border: 1px solid rgba(0,0,0,0.06) !important;
      user-select: none !important;
    }
    #sh-ali-detail.sh-min {
      width: 44px !important; max-height: 44px !important;
      border-radius: 22px !important; cursor: pointer !important;
    }
    #sh-ali-detail.sh-min .sh-d-body, #sh-ali-detail.sh-min .sh-d-actions { display: none !important; }

    .sh-d-hd {
      background: linear-gradient(135deg,#e74c3c 0%,#c0392b 100%) !important;
      color: #fff !important;
      padding: 10px 14px !important;
      display: flex !important; align-items: center !important; justify-content: space-between !important;
      cursor: grab !important; flex-shrink: 0 !important;
      border-radius: 14px 14px 0 0 !important;
    }
    #sh-ali-detail.sh-min .sh-d-hd { border-radius: 22px !important; padding: 10px !important; justify-content: center !important; }
    .sh-d-hd .logo { font-size: 14px !important; font-weight: 800 !important; }
    .sh-d-hd .ver { font-size: 8px !important; opacity: .6 !important; margin-left: 6px !important; }
    .sh-d-hbtns { display: flex !important; gap: 3px !important; }
    .sh-d-hb { width: 22px !important; height: 22px !important; display: flex !important; align-items: center !important; justify-content: center !important; border: none !important; background: rgba(255,255,255,.12) !important; color: #fff !important; border-radius: 5px !important; cursor: pointer !important; font-size: 12px !important; padding: 0 !important; }
    .sh-d-hb:hover { background: rgba(255,255,255,.28) !important; }

    .sh-d-body { overflow-y: auto !important; flex: 1 !important; padding: 0 !important; }
    .sh-d-body::-webkit-scrollbar { width: 3px !important; }
    .sh-d-body::-webkit-scrollbar-thumb { background: #cbd5e1 !important; border-radius: 3px !important; }

    .sh-d-sec { padding: 12px 14px !important; border-bottom: 1px solid #f1f5f9 !important; }
    .sh-d-sec-title { font-size: 10px !important; font-weight: 700 !important; color: #94a3b8 !important; text-transform: uppercase !important; letter-spacing: .5px !important; margin-bottom: 8px !important; }

    .sh-d-row { display: flex !important; justify-content: space-between !important; padding: 4px 0 !important; font-size: 11px !important; }
    .sh-d-row .lbl { color: #64748b !important; }
    .sh-d-row .val { font-weight: 600 !important; color: #1e293b !important; }
    .sh-d-row .val.red { color: #dc2626 !important; }
    .sh-d-row .val.green { color: #16a34a !important; }
    .sh-d-row .val.amber { color: #d97706 !important; }

    .sh-d-actions { padding: 12px 14px !important; display: flex !important; flex-direction: column !important; gap: 6px !important; border-top: 1px solid #f1f5f9 !important; flex-shrink: 0 !important; }
    .sh-d-btn { width: 100% !important; height: 32px !important; border: none !important; border-radius: 6px !important; font-size: 11px !important; font-weight: 700 !important; cursor: pointer !important; color: #fff !important; display: flex !important; align-items: center !important; justify-content: center !important; gap: 4px !important; }
    .sh-d-btn:hover { opacity: .9 !important; }
    .sh-d-btn-coupang { background: #6366f1 !important; }
    .sh-d-btn-1688 { background: #ea580c !important; }
    .sh-d-btn-save { background: #e74c3c !important; }
    .sh-d-btn-saved { background: #16a34a !important; }
    .sh-d-btn-row { display: flex !important; gap: 6px !important; }
    .sh-d-btn-half { flex: 1 !important; }

    .sh-d-margin { background: #f0fdf4 !important; border: 1px solid #bbf7d0 !important; border-radius: 8px !important; padding: 10px !important; margin-top: 8px !important; }
    .sh-d-margin-title { font-size: 10px !important; font-weight: 700 !important; color: #16a34a !important; margin-bottom: 6px !important; }
    .sh-d-margin-row { display: flex !important; justify-content: space-between !important; font-size: 10px !important; padding: 2px 0 !important; }
    .sh-d-margin-row .lbl { color: #64748b !important; }
    .sh-d-margin-row .val { font-weight: 600 !important; }

    .sh-d-foot { padding: 6px 14px !important; background: #f8fafc !important; border-top: 1px solid #f1f5f9 !important; font-size: 9px !important; color: #94a3b8 !important; text-align: center !important; flex-shrink: 0 !important; }
  `;
  document.head.appendChild(css);

  // ============================================================
  //  유틸
  // ============================================================
  function tx(el) { return (el?.textContent || '').replace(/\s+/g, ' ').trim(); }
  function nm(s) { return parseInt((s || '').replace(/[^0-9]/g, ''), 10) || 0; }
  function esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

  function getProductId() {
    const m = location.pathname.match(/\/(?:item|i)\/(\d+)/);
    return m ? m[1] : null;
  }

  // ============================================================
  //  상품 상세 파싱
  // ============================================================
  function parseDetail() {
    const pid = getProductId();
    if (!pid) return null;

    // 제목
    let title = '';
    for (const sel of ['h1[data-pl="product-title"]', 'h1', '[class*="product-title"]', '[class*="ProductTitle"]']) {
      const el = document.querySelector(sel);
      if (el) { const t = tx(el); if (t.length > 3 && t.length < 500) { title = t; break; } }
    }
    if (!title) title = document.title?.replace(/\s*[-|].*(AliExpress|알리).*$/i, '').trim() || '';

    // 가격
    let price = 0;
    let currency = 'USD';
    for (const el of document.querySelectorAll('[class*="price"], [class*="Price"], [class*="cost"], [class*="uniform-banner"]')) {
      if (el.closest('#sh-ali-detail')) continue;
      const t = tx(el);
      const usdM = t.match(/(?:US\s*\$|USD|\$)\s*([\d,.]+)/i);
      if (usdM) { const v = parseFloat(usdM[1].replace(/,/g, '')); if (v > 0 && v < 100000) { price = v; currency = 'USD'; break; } }
      const wonM = t.match(/[₩￦]\s*([\d,]+)/);
      if (wonM) { const v = parseInt(wonM[1].replace(/,/g, ''), 10); if (v > 0) { price = v; currency = 'KRW'; break; } }
    }

    // 원래 가격 (할인 전)
    let originalPrice = 0;
    for (const el of document.querySelectorAll('del, [class*="origin"], [class*="Origin"], [class*="del-price"]')) {
      if (el.closest('#sh-ali-detail')) continue;
      const t = tx(el);
      const m = t.match(/(?:US\s*\$|\$)\s*([\d,.]+)/i);
      if (m) { const v = parseFloat(m[1].replace(/,/g, '')); if (v > price && v < 100000) { originalPrice = v; break; } }
    }

    // 평점
    let rating = 0;
    for (const el of document.querySelectorAll('[class*="rating"], [class*="star"], [aria-label*="star"]')) {
      if (el.closest('#sh-ali-detail')) continue;
      const t = tx(el);
      const m = t.match(/(\d+\.?\d*)/);
      if (m) { const v = parseFloat(m[1]); if (v > 0 && v <= 5) { rating = v; break; } }
      const label = el.getAttribute('aria-label') || '';
      const lm = label.match(/(\d+\.?\d*)/);
      if (lm) { const v = parseFloat(lm[1]); if (v > 0 && v <= 5) { rating = v; break; } }
    }

    // 리뷰 수
    let reviewCount = 0;
    for (const el of document.querySelectorAll('[class*="review"], [class*="Review"], [class*="feedback"]')) {
      if (el.closest('#sh-ali-detail')) continue;
      const t = tx(el);
      const m = t.match(/([\d,]+)\s*(?:review|리뷰|개)/i);
      if (m) { reviewCount = nm(m[1]); break; }
    }
    if (!reviewCount) {
      const bodyText = tx(document.body);
      const m = bodyText.match(/([\d,]+)\s*(?:Reviews?|리뷰)/i);
      if (m) reviewCount = nm(m[1]);
    }

    // 주문수 / 판매량
    let orders = 0;
    for (const el of document.querySelectorAll('[class*="sold"], [class*="trade"], [class*="order"]')) {
      if (el.closest('#sh-ali-detail')) continue;
      const t = tx(el).toLowerCase();
      const m = t.match(/([\d,.]+)\s*(?:k\+?)?\s*(?:sold|orders?|판매)/i);
      if (m) {
        let v = parseFloat(m[0].replace(/[^0-9.k]/gi, ''));
        if (/k/i.test(m[0])) v *= 1000;
        if (v > 0) { orders = Math.round(v); break; }
      }
    }
    if (!orders) {
      const bodyText = tx(document.body);
      const m = bodyText.match(/([\d,]+)\+?\s*sold/i);
      if (m) orders = nm(m[1]);
    }

    // 판매자 정보
    let sellerName = '';
    let sellerRating = '';
    for (const el of document.querySelectorAll('[class*="store"], [class*="Store"], [class*="seller"], [class*="shop"]')) {
      if (el.closest('#sh-ali-detail')) continue;
      const a = el.querySelector('a');
      if (a) { const t = tx(a); if (t.length > 1 && t.length < 100) { sellerName = t; break; } }
      const t = tx(el);
      if (t.length > 1 && t.length < 100 && !/AliExpress/i.test(t)) { sellerName = t; break; }
    }
    for (const el of document.querySelectorAll('[class*="store-rating"], [class*="positive"]')) {
      const t = tx(el);
      const m = t.match(/([\d.]+)%?\s*(?:positive|긍정)/i);
      if (m) { sellerRating = m[1] + '%'; break; }
    }

    // 이미지
    let imageUrl = '';
    const ogImg = document.querySelector('meta[property="og:image"]');
    if (ogImg) imageUrl = ogImg.getAttribute('content') || '';
    if (!imageUrl) {
      const img = document.querySelector('[class*="image-view"] img, [class*="gallery"] img, img[src*="alicdn"]');
      if (img) imageUrl = img.src || '';
    }

    // 무료배송
    const freeShip = /free\s*shipping|무료\s*배송/i.test(tx(document.body));

    // 카테고리
    let category = '';
    const breadcrumbs = document.querySelectorAll('[class*="breadcrumb"] a, [class*="Breadcrumb"] a');
    if (breadcrumbs.length > 0) {
      category = Array.from(breadcrumbs).map(a => tx(a)).filter(t => t && t.length < 50).join(' > ');
    }

    console.log(`[SH-Ali-Detail] 파싱: ${title.substring(0, 40)}.. | $${price} | ★${rating} | 주문:${orders} | 리뷰:${reviewCount}`);

    return {
      productId: pid, title, price, originalPrice, currency,
      rating, reviewCount, orders,
      sellerName, sellerRating,
      imageUrl, freeShip, category,
      url: location.href,
    };
  }

  // ============================================================
  //  마진 간단 계산 (알리 → 쿠팡 판매 시)
  // ============================================================
  function calcMargin(aliPriceUSD) {
    if (!aliPriceUSD || aliPriceUSD <= 0) return null;
    const exchangeRate = 1350; // USD → KRW
    const aliPriceKRW = Math.round(aliPriceUSD * exchangeRate);

    // 비용 구조
    const intlShipping = 3000; // 국제배송비 추정
    const domesticShipping = 3000; // 국내배송비
    const customs = Math.round(aliPriceKRW * 0.08); // 관세+부가세 8%

    const totalCost = aliPriceKRW + intlShipping + domesticShipping + customs;

    // 쿠팡 판매가 추정 (원가의 2.5~3.5배)
    const sellingPrice2x = Math.round(totalCost * 2.5 / 100) * 100;
    const sellingPrice3x = Math.round(totalCost * 3.5 / 100) * 100;

    // 쿠팡 수수료 (10.8%) + 광고비 (5%) + 기타 (3%)
    const feeRate = 0.188;
    const profit2x = sellingPrice2x - totalCost - Math.round(sellingPrice2x * feeRate);
    const profit3x = sellingPrice3x - totalCost - Math.round(sellingPrice3x * feeRate);
    const marginRate2x = Math.round((profit2x / sellingPrice2x) * 100);
    const marginRate3x = Math.round((profit3x / sellingPrice3x) * 100);

    return {
      aliPriceKRW, totalCost,
      sellingPrice2x, sellingPrice3x,
      profit2x, profit3x,
      marginRate2x, marginRate3x,
      exchangeRate,
    };
  }

  // ============================================================
  //  키워드 변환 (영어 → 한국어)
  // ============================================================
  const EN_TO_KO = {
    'tumbler': '텀블러', 'water bottle': '물병', 'towel': '수건',
    'charger': '충전기', 'cable': '케이블', 'earphone': '이어폰',
    'bluetooth': '블루투스', 'speaker': '스피커', 'mouse': '마우스',
    'keyboard': '키보드', 'power bank': '보조배터리', 'phone case': '케이스',
    'phone stand': '거치대', 'backpack': '백팩', 'wallet': '지갑',
    'necklace': '목걸이', 'ring': '반지', 'bracelet': '팔찌',
    'earring': '귀걸이', 'sunglasses': '선글라스', 'watch': '시계',
    'bag': '가방', 'sock': '양말', 'socks': '양말', 'hat': '모자',
    'lamp': '램프', 'light': '조명', 'led': 'LED', 'cushion': '쿠션',
    'pillow': '베개', 'blanket': '이불', 'curtain': '커튼', 'rug': '러그',
    'toy': '장난감', 'puzzle': '퍼즐', 'sticker': '스티커',
    'pen': '펜', 'notebook': '노트', 'tape': '테이프',
    'yoga mat': '요가매트', 'tent': '텐트', 'camping': '캠핑',
    'kitchen': '주방', 'pot': '냄비', 'pan': '프라이팬',
    'knife': '칼', 'scissors': '가위', 'cup': '컵', 'mug': '머그컵',
    'plate': '접시', 'bowl': '그릇', 'storage': '수납', 'organizer': '정리함',
    'cleaning': '청소', 'brush': '솔', 'sponge': '스펀지',
    'hook': '후크', 'hanger': '행거', 'mirror': '거울',
    'drone': '드론', 'camera': '카메라', 'tripod': '삼각대',
    't-shirt': '티셔츠', 'shirt': '셔츠', 'jacket': '자켓',
    'pants': '바지', 'jeans': '청바지', 'dress': '원피스',
    'sneakers': '운동화', 'shoes': '신발', 'slippers': '슬리퍼',
    'mask': '마스크', 'gloves': '장갑', 'belt': '벨트',
    'pet': '반려동물', 'dog': '강아지', 'cat': '고양이',
  };

  function extractCoupangKeyword(aliTitle) {
    if (!aliTitle) return '';
    let cleaned = aliTitle.toLowerCase()
      .replace(/[^a-z0-9가-힣\s]/g, ' ')
      .replace(/\d+\s*(pcs|packs?|sets?|pieces?|lot)\b/gi, '')
      .replace(/\d+(ml|g|kg|cm|mm|oz|l|inch)\b/gi, '')
      .trim();
    const words = cleaned.split(/\s+/).filter(w => w.length > 1);
    const koWords = [];
    const used = new Set();
    for (let i = 0; i < words.length - 1; i++) {
      const tw = words[i] + ' ' + words[i + 1];
      if (EN_TO_KO[tw]) { koWords.push(EN_TO_KO[tw]); used.add(i); used.add(i + 1); }
    }
    for (let i = 0; i < words.length; i++) {
      if (used.has(i)) continue;
      if (EN_TO_KO[words[i]]) { koWords.push(EN_TO_KO[words[i]]); used.add(i); }
    }
    if (koWords.length >= 1) return koWords.slice(0, 3).join(' ');
    const stop = new Set(['the', 'a', 'an', 'for', 'and', 'or', 'with', 'in', 'on', 'to', 'of', 'new', 'hot', 'sale', 'free', 'shipping', 'pcs', 'set', 'piece', 'high', 'quality', 'mini', 'portable', 'style', 'fashion']);
    return words.filter(w => !stop.has(w) && w.length > 2).slice(0, 3).join(' ');
  }

  // ============================================================
  //  패널 생성 & 렌더링
  // ============================================================
  let panel = null;
  let isMin = false;
  let currentDetail = null;
  let isSaved = false;

  function createPanel() {
    if (panel) panel.remove();
    panel = document.createElement('div');
    panel.id = 'sh-ali-detail';
    document.body.appendChild(panel);
    initDrag();
  }

  function initDrag() {
    let drag = false, sx, sy, sr, st;
    panel.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.sh-d-hd') || e.target.closest('.sh-d-hb')) return;
      drag = true;
      const r = panel.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; sr = innerWidth - r.right; st = r.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!drag) return;
      panel.style.top = Math.max(0, Math.min(innerHeight - 50, st + e.clientY - sy)) + 'px';
      panel.style.right = Math.max(0, Math.min(innerWidth - 50, sr - (e.clientX - sx))) + 'px';
    });
    document.addEventListener('mouseup', () => { drag = false; });
  }

  function renderPanel(detail) {
    if (!panel) createPanel();
    if (!detail) {
      panel.innerHTML = `
        <div class="sh-d-hd"><span class="logo">🐢 Ali 분석</span><span class="ver">v${VER}</span></div>
        <div class="sh-d-body" style="padding:30px !important;text-align:center !important;color:#94a3b8 !important;">파싱 중...</div>
      `;
      return;
    }

    const fp = (v, c) => {
      if (!v) return '-';
      if (c === 'KRW') return Math.round(v).toLocaleString() + '원';
      return '$' + v.toFixed(2);
    };

    const kw = extractCoupangKeyword(detail.title);
    const margin = detail.currency === 'USD' ? calcMargin(detail.price) : null;
    const discountPct = detail.originalPrice > 0 && detail.price > 0
      ? Math.round((1 - detail.price / detail.originalPrice) * 100) : 0;

    panel.innerHTML = `
      <div class="sh-d-hd">
        <span class="logo">🐢 Ali 분석</span>
        <div class="sh-d-hbtns">
          <button class="sh-d-hb" id="sh-d-ref" title="새로고침">↻</button>
          <button class="sh-d-hb" id="sh-d-min" title="접기">—</button>
        </div>
      </div>
      <div class="sh-d-body">
        <!-- 기본 정보 -->
        <div class="sh-d-sec">
          <div class="sh-d-sec-title">📦 상품 정보</div>
          <div style="font-size:11px !important;font-weight:600 !important;color:#1e293b !important;line-height:1.4 !important;margin-bottom:8px !important;">${esc(detail.title.substring(0, 100))}</div>
          <div class="sh-d-row"><span class="lbl">판매가</span><span class="val red">${fp(detail.price, detail.currency)}</span></div>
          ${detail.originalPrice > 0 ? `<div class="sh-d-row"><span class="lbl">원가</span><span class="val"><del>${fp(detail.originalPrice, detail.currency)}</del> (${discountPct}%↓)</span></div>` : ''}
          <div class="sh-d-row"><span class="lbl">평점</span><span class="val">★ ${detail.rating || '-'}</span></div>
          <div class="sh-d-row"><span class="lbl">리뷰</span><span class="val">${detail.reviewCount ? detail.reviewCount.toLocaleString() + '개' : '-'}</span></div>
          <div class="sh-d-row"><span class="lbl">주문수</span><span class="val amber">${detail.orders ? detail.orders.toLocaleString() + '건' : '-'}</span></div>
          <div class="sh-d-row"><span class="lbl">무료배송</span><span class="val ${detail.freeShip ? 'green' : ''}">${detail.freeShip ? '✓ 무료' : '유료'}</span></div>
        </div>

        <!-- 판매자 -->
        ${detail.sellerName ? `
        <div class="sh-d-sec">
          <div class="sh-d-sec-title">🏪 판매자</div>
          <div class="sh-d-row"><span class="lbl">스토어</span><span class="val">${esc(detail.sellerName.substring(0, 30))}</span></div>
          ${detail.sellerRating ? `<div class="sh-d-row"><span class="lbl">긍정률</span><span class="val green">${detail.sellerRating}</span></div>` : ''}
        </div>` : ''}

        <!-- 쿠팡 마진 추정 -->
        ${margin ? `
        <div class="sh-d-sec">
          <div class="sh-d-sec-title">💰 쿠팡 판매 시 마진 추정</div>
          <div class="sh-d-margin">
            <div class="sh-d-margin-title">비용 구조 (환율 ₩${margin.exchangeRate})</div>
            <div class="sh-d-margin-row"><span class="lbl">알리 원가</span><span class="val">${margin.aliPriceKRW.toLocaleString()}원</span></div>
            <div class="sh-d-margin-row"><span class="lbl">+ 국제배송/관세</span><span class="val">~${(margin.totalCost - margin.aliPriceKRW).toLocaleString()}원</span></div>
            <div class="sh-d-margin-row" style="border-top:1px dashed #d1d5db !important;padding-top:4px !important;margin-top:4px !important;">
              <span class="lbl"><b>총 원가</b></span><span class="val"><b>${margin.totalCost.toLocaleString()}원</b></span>
            </div>
          </div>
          <div style="display:grid !important;grid-template-columns:1fr 1fr !important;gap:8px !important;margin-top:8px !important;">
            <div style="background:#f0f9ff !important;border:1px solid #bae6fd !important;border-radius:6px !important;padding:8px !important;text-align:center !important;">
              <div style="font-size:9px !important;color:#0369a1 !important;">보수적 (2.5배)</div>
              <div style="font-size:14px !important;font-weight:800 !important;color:#0369a1 !important;">${margin.sellingPrice2x.toLocaleString()}원</div>
              <div style="font-size:9px !important;color:${margin.marginRate2x >= 15 ? '#16a34a' : '#dc2626'} !important;">순이익 ${margin.profit2x.toLocaleString()}원 (${margin.marginRate2x}%)</div>
            </div>
            <div style="background:#f0fdf4 !important;border:1px solid #bbf7d0 !important;border-radius:6px !important;padding:8px !important;text-align:center !important;">
              <div style="font-size:9px !important;color:#16a34a !important;">적극적 (3.5배)</div>
              <div style="font-size:14px !important;font-weight:800 !important;color:#16a34a !important;">${margin.sellingPrice3x.toLocaleString()}원</div>
              <div style="font-size:9px !important;color:${margin.marginRate3x >= 15 ? '#16a34a' : '#dc2626'} !important;">순이익 ${margin.profit3x.toLocaleString()}원 (${margin.marginRate3x}%)</div>
            </div>
          </div>
          <div style="font-size:8px !important;color:#94a3b8 !important;margin-top:6px !important;">
            ※ 수수료 18.8% (쿠팡10.8%+광고5%+기타3%) 기준 추정치
          </div>
        </div>` : ''}

        <!-- 쿠팡 키워드 매칭 -->
        <div class="sh-d-sec">
          <div class="sh-d-sec-title">🔍 쿠팡 키워드 매칭</div>
          <div style="font-size:11px !important;font-weight:600 !important;color:#6366f1 !important;background:#eef2ff !important;border-radius:6px !important;padding:8px !important;">${esc(kw) || '(매칭 키워드 없음)'}</div>
          <div style="font-size:8px !important;color:#94a3b8 !important;margin-top:4px !important;">
            알리 상품명을 한국어 키워드로 자동 변환
          </div>
        </div>
      </div>

      <!-- 액션 버튼 -->
      <div class="sh-d-actions">
        <button class="sh-d-btn sh-d-btn-coupang" id="sh-d-act-coupang">🔍 쿠팡에서 찾기 ("${esc(kw.substring(0, 15))}")</button>
        <div class="sh-d-btn-row">
          <button class="sh-d-btn sh-d-btn-1688 sh-d-btn-half" id="sh-d-act-1688">🇨🇳 1688 검색</button>
          <button class="sh-d-btn ${isSaved ? 'sh-d-btn-saved' : 'sh-d-btn-save'} sh-d-btn-half" id="sh-d-act-save">${isSaved ? '✓ 등록됨' : '⭐ 소싱 후보 등록'}</button>
        </div>
      </div>

      <div class="sh-d-foot">🐢 소싱 헬퍼 · 참고용 분석 (저장 안 됨)</div>
    `;

    // 이벤트
    document.getElementById('sh-d-min').addEventListener('click', (e) => {
      e.stopPropagation();
      isMin = !isMin;
      panel.classList.toggle('sh-min', isMin);
    });
    panel.addEventListener('click', () => { if (isMin) { isMin = false; panel.classList.remove('sh-min'); } });
    document.getElementById('sh-d-ref').addEventListener('click', (e) => { e.stopPropagation(); doScan(true); });

    document.getElementById('sh-d-act-coupang').addEventListener('click', () => {
      window.open('https://www.coupang.com/np/search?q=' + encodeURIComponent(kw), '_blank');
    });

    document.getElementById('sh-d-act-1688').addEventListener('click', () => {
      const keyword = detail.title.substring(0, 50);
      window.open(`https://s.1688.com/selloffer/offer_search.htm?keywords=${keyword.replace(/\s+/g, '+')}&charset=utf8`, '_blank');
    });

    document.getElementById('sh-d-act-save').addEventListener('click', function () {
      if (isSaved) return;
      chrome.runtime.sendMessage({
        type: 'SAVE_CANDIDATE',
        product: {
          productId: 'ali-' + detail.productId,
          title: detail.title,
          price: detail.currency === 'KRW' ? detail.price : Math.round(detail.price * 1350),
          reviewCount: detail.orders,
          rating: detail.rating,
          imageUrl: detail.imageUrl,
          url: detail.url,
          query: kw,
          sourcePlatform: 'aliexpress',
        },
        score: 50,
        grade: 'B',
      }).catch(() => {});
      isSaved = true;
      this.textContent = '✓ 등록됨';
      this.className = 'sh-d-btn sh-d-btn-saved sh-d-btn-half';
    });
  }

  // ============================================================
  //  스캔
  // ============================================================
  let lastSig = '';
  let timer = null;

  function doScan(force = false) {
    const detail = parseDetail();
    if (!detail) {
      if (panel) renderPanel(null);
      return;
    }

    const sig = detail.productId + ':' + detail.price + ':' + detail.reviewCount;
    if (sig === lastSig && !force) return;
    lastSig = sig;
    currentDetail = detail;
    renderPanel(detail);
  }

  // URL 변경 감지 (SPA)
  let lastUrl = location.href;
  function urlCheck() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastSig = '';
      isSaved = false;
      setTimeout(() => doScan(true), 500);
      setTimeout(() => doScan(true), 1500);
      setTimeout(() => doScan(true), 3000);
    }
  }

  window.addEventListener('popstate', () => setTimeout(urlCheck, 100));
  setInterval(urlCheck, 800);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(() => doScan(true), 300); });

  const obs = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(() => doScan(), 1000); });
  obs.observe(document.body || document.documentElement, { childList: true, subtree: true });

  // 초기 실행
  doScan();
  setTimeout(doScan, 1000);
  setTimeout(doScan, 2500);
  setTimeout(doScan, 5000);
})();
