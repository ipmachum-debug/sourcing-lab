/* ============================================================
   Coupang Sourcing Helper — Content Script v5.0
   "상품 카드 중심 UX" — 셀록홈즈 방식

   v5.0: 사이드패널 중심 → 상품 카드 오버레이 UX 전환
   - Auto Scan: 페이지 로드시 자동 분석
   - 상품 카드에 소싱점수/마진/1688/알리/저장 버튼 삽입
   - 빠른 점수 계산 (0.1초, AI 없이)
   - AI 분석은 백그라운드 → 완료시 카드 업데이트
   - 클릭 4번 → 1번
   ============================================================ */
(function () {
  const MAX_ITEMS = 36;
  const OVERLAY_ATTR = 'data-sh-overlay'; // 오버레이 마커
  let debounceTimer = null;
  let lastSignature = '';
  let lastUrl = location.href;
  let allParsedItems = []; // 파싱된 전체 상품 데이터

  // ---- 유틸리티 ----
  function text(el) {
    return (el?.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function parseNumber(str) {
    if (!str) return 0;
    return parseInt(str.replace(/[^0-9]/g, ''), 10) || 0;
  }
  function parseFloat2(str) {
    if (!str) return 0;
    const m = str.match(/[\d.]+/);
    return m ? parseFloat(m[0]) : 0;
  }
  function formatPrice(n) {
    if (!n) return '-';
    return n.toLocaleString() + '원';
  }

  // ============================================================
  //  스타일 삽입 (한 번만)
  // ============================================================
  function injectStyles() {
    if (document.getElementById('sh-overlay-styles')) return;
    const style = document.createElement('style');
    style.id = 'sh-overlay-styles';
    style.textContent = `
      .sh-card-overlay {
        position: absolute;
        bottom: 0; left: 0; right: 0;
        background: linear-gradient(transparent, rgba(0,0,0,0.85) 30%);
        padding: 28px 8px 6px;
        z-index: 100;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        pointer-events: auto;
        border-radius: 0 0 8px 8px;
        opacity: 0;
        transition: opacity 0.2s;
      }
      *:hover > .sh-card-overlay,
      .sh-card-overlay.sh-visible {
        opacity: 1;
      }
      .sh-score-row {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 4px;
      }
      .sh-score-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px; height: 20px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 700;
        color: #fff;
        letter-spacing: -0.3px;
      }
      .sh-score-s { background: #16a34a; }
      .sh-score-a { background: #3b82f6; }
      .sh-score-b { background: #f59e0b; }
      .sh-score-c { background: #9ca3af; }
      .sh-score-d { background: #dc2626; }
      .sh-score-num {
        font-size: 13px;
        font-weight: 700;
        color: #fff;
      }
      .sh-margin-text {
        font-size: 11px;
        color: #d1d5db;
        margin-left: auto;
      }
      .sh-btn-row {
        display: flex;
        gap: 3px;
        margin-top: 4px;
      }
      .sh-btn {
        flex: 1;
        padding: 4px 2px;
        border: none;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 600;
        cursor: pointer;
        text-align: center;
        transition: all 0.15s;
        color: #fff;
        line-height: 1.2;
        white-space: nowrap;
      }
      .sh-btn:hover {
        transform: scale(1.05);
        filter: brightness(1.15);
      }
      .sh-btn-1688 { background: #ff6a00; }
      .sh-btn-ali { background: #e43225; }
      .sh-btn-save { background: #6366f1; }
      .sh-btn-ai { background: #059669; font-size: 9px; }
      .sh-btn-saved { background: #4f46e5 !important; opacity: 0.7; }

      /* 항상 보이는 미니 배지 (hover 아닐 때) */
      .sh-mini-badge {
        position: absolute;
        top: 6px; right: 6px;
        z-index: 101;
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 2px 6px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 700;
        color: #fff;
        pointer-events: none;
        box-shadow: 0 1px 4px rgba(0,0,0,0.4);
      }

      /* AI 로딩 표시 */
      .sh-ai-loading {
        font-size: 9px;
        color: #93c5fd;
        margin-top: 2px;
        text-align: center;
      }
      .sh-ai-done {
        font-size: 9px;
        color: #86efac;
        margin-top: 2px;
        text-align: center;
      }

      /* 상품 컨테이너에 relative 보장 */
      .sh-relative { position: relative !important; overflow: visible !important; }
    `;
    document.head.appendChild(style);
  }

  // ============================================================
  //  빠른 소싱 점수 계산 (AI 없이, 0.05초)
  // ============================================================
  function quickScore(item, allItems) {
    let score = 50; // 기본점수

    // 1) 리뷰 수 기반 (경쟁도) — 리뷰 적을수록 기회
    if (item.reviewCount < 50) score += 20;
    else if (item.reviewCount < 200) score += 12;
    else if (item.reviewCount < 500) score += 5;
    else if (item.reviewCount > 2000) score -= 10;

    // 2) 평점 기반
    if (item.rating >= 4.5) score += 5;
    else if (item.rating < 3.5 && item.rating > 0) score -= 5;

    // 3) 가격대 기반 (중저가가 소싱에 유리)
    if (item.price >= 5000 && item.price <= 30000) score += 10;
    else if (item.price > 0 && item.price < 3000) score -= 5;
    else if (item.price > 50000) score -= 5;

    // 4) 광고 상품이면 경쟁 치열
    if (item.isAd) score -= 8;

    // 5) 전체 평균 대비 리뷰 수 비교
    if (allItems.length > 3) {
      const avgReview = allItems.reduce((a, b) => a + b.reviewCount, 0) / allItems.length;
      if (item.reviewCount < avgReview * 0.3) score += 8; // 평균보다 리뷰 매우 적음 → 기회
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  function scoreGrade(score) {
    if (score >= 80) return { grade: 'S', cls: 'sh-score-s', color: '#16a34a' };
    if (score >= 65) return { grade: 'A', cls: 'sh-score-a', color: '#3b82f6' };
    if (score >= 50) return { grade: 'B', cls: 'sh-score-b', color: '#f59e0b' };
    if (score >= 35) return { grade: 'C', cls: 'sh-score-c', color: '#9ca3af' };
    return { grade: 'D', cls: 'sh-score-d', color: '#dc2626' };
  }

  // ============================================================
  //  스마트 키워드 추출 (한→중, 한→영)
  // ============================================================
  const NOISE = new Set(['1개','2개','3개','4개','5개','1P','2P','3P','1+1','2+1',
    '무료배송','당일발송','최저가','특가','세일','할인','핫딜','정품','국내정품',
    '고급','프리미엄','대용량','소용량','미니','슬림','블랙','화이트','그레이']);

  const CN_MAP = {
    '텀블러':'保温杯','물병':'水杯','수건':'毛巾','비누':'肥皂','칫솔':'牙刷',
    '수세미':'百洁布','스펀지':'海绵','솔':'刷子','청소':'清洁','세제':'洗涤剂',
    '실리콘':'硅胶','다용도':'多用途','냄비':'锅','프라이팬':'平底锅','도마':'砧板',
    '접시':'盘子','그릇':'碗','밀폐용기':'密封盒','충전기':'充电器','케이블':'数据线',
    '이어폰':'耳机','블루투스':'蓝牙','마우스':'鼠标','키보드':'键盘','보조배터리':'充电宝',
    '거치대':'支架','케이스':'手机壳','티셔츠':'T恤','양말':'袜子','가방':'包',
    '백팩':'双肩包','지갑':'钱包','목걸이':'项链','반지':'戒指','장난감':'玩具',
    '펜':'笔','노트':'笔记本','스티커':'贴纸','요가매트':'瑜伽垫','텐트':'帐篷',
    '커튼':'窗帘','이불':'被子','베개':'枕头','매트':'垫子','행주':'抹布',
    '걸레':'拖把','세탁':'洗衣','극세사':'超细纤维','세척':'清洗','스크럽':'百洁刷',
    '수납':'收纳','선반':'架子','행거':'衣架','컵':'杯子','거울':'镜子',
  };

  function extractKeyword(title) {
    if (!title) return '';
    let cleaned = title
      .replace(/\[.*?\]/g,' ').replace(/\(.*?\)/g,' ').replace(/【.*?】/g,' ')
      .replace(/[\/\\|~`!@#$%^&*=+{};:'"<>,.?]/g,' ')
      .replace(/\d+(ml|g|kg|cm|mm|개입|매입|세트|팩)/gi,' ')
      .trim();
    let words = cleaned.split(/\s+/).filter(w =>
      w.length > 1 && !NOISE.has(w) && !/^\d+$/.test(w)
    );
    return words.slice(0, 3).join(' ');
  }

  function toChinese(title) {
    const words = extractKeyword(title).split(/\s+/);
    const cn = words.map(w => CN_MAP[w]).filter(Boolean);
    return cn.length > 0 ? cn.join(' ') : '';
  }

  // ============================================================
  //  상품 카드에 오버레이 UI 삽입
  // ============================================================
  function insertOverlay(container, item, allItems) {
    // 이미 삽입된 경우 스킵
    if (container.getAttribute(OVERLAY_ATTR)) return;
    container.setAttribute(OVERLAY_ATTR, item.productId || 'true');

    // relative 위치 보장
    const pos = getComputedStyle(container).position;
    if (pos === 'static' || pos === '') {
      container.classList.add('sh-relative');
    }

    const score = quickScore(item, allItems);
    const { grade, cls, color } = scoreGrade(score);
    const cnKw = toChinese(item.title);
    const koKw = extractKeyword(item.title);

    // 미니 배지 (항상 표시)
    const miniBadge = document.createElement('div');
    miniBadge.className = 'sh-mini-badge';
    miniBadge.style.background = color;
    miniBadge.innerHTML = `${grade} ${score}`;
    container.appendChild(miniBadge);

    // 오버레이 (hover시 표시)
    const overlay = document.createElement('div');
    overlay.className = 'sh-card-overlay';
    overlay.dataset.productId = item.productId || '';
    overlay.innerHTML = `
      <div class="sh-score-row">
        <span class="sh-score-badge ${cls}">${grade}</span>
        <span class="sh-score-num">${score}점</span>
        <span class="sh-margin-text">${item.price ? formatPrice(item.price) : ''}</span>
      </div>
      <div class="sh-btn-row">
        <button class="sh-btn sh-btn-1688" data-action="1688" title="1688 검색">1688</button>
        <button class="sh-btn sh-btn-ali" data-action="ali" title="AliExpress 검색">알리</button>
        <button class="sh-btn sh-btn-save" data-action="save" title="후보 저장">저장</button>
        <button class="sh-btn sh-btn-ai" data-action="ai" title="AI 상세 분석">AI</button>
      </div>
      <div class="sh-ai-status"></div>
    `;
    container.appendChild(overlay);

    // ---- 버튼 이벤트 ----
    overlay.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const btn = e.target.closest('.sh-btn');
      if (!btn) return;

      const action = btn.dataset.action;

      if (action === '1688') {
        const kw = cnKw || koKw;
        if (kw) {
          window.open(`https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(kw)}`, '_blank');
        } else {
          window.open(`https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(koKw)}`, '_blank');
        }
      }

      if (action === 'ali') {
        window.open(`https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(koKw)}`, '_blank');
      }

      if (action === 'save') {
        btn.textContent = '저장됨';
        btn.classList.add('sh-btn-saved');
        chrome.runtime.sendMessage({
          type: 'SAVE_CANDIDATE',
          product: item,
          score: score,
          grade: grade,
        }).catch(() => {});
      }

      if (action === 'ai') {
        btn.textContent = '분석중...';
        btn.disabled = true;
        const statusEl = overlay.querySelector('.sh-ai-status');
        statusEl.innerHTML = '<div class="sh-ai-loading">AI 분석 중...</div>';

        chrome.runtime.sendMessage({
          type: 'REQUEST_AI_ANALYSIS',
          product: item,
          score: score,
        }).then(resp => {
          if (resp && resp.success) {
            statusEl.innerHTML = `<div class="sh-ai-done">AI: ${resp.summary || '분석 완료'}</div>`;
          } else {
            statusEl.innerHTML = '<div class="sh-ai-loading">AI 분석 실패</div>';
          }
          btn.textContent = 'AI';
          btn.disabled = false;
        }).catch(() => {
          statusEl.innerHTML = '<div class="sh-ai-loading">AI 연결 실패</div>';
          btn.textContent = 'AI';
          btn.disabled = false;
        });
      }
    });
  }

  // ============================================================
  //  검색어 추출 — 다중 소스 교차 검증
  // ============================================================
  function getQuery() {
    const url = new URL(location.href);
    const urlQuery = url.searchParams.get('q')
      || url.searchParams.get('query')
      || url.searchParams.get('keyword')
      || url.searchParams.get('component')
      || '';
    const inputQuery = (
      document.querySelector('input.search-input')?.value
      || document.querySelector('input[name="q"]')?.value
      || document.querySelector('input[type="search"]')?.value
      || document.querySelector('input[name="query"]')?.value
      || document.querySelector('#headerSearchKeyword')?.value
      || document.querySelector('input[class*="search"]')?.value
      || document.querySelector('[class*="SearchBar"] input')?.value
      || ''
    ).trim();
    let titleQuery = '';
    const titleMatch = document.title.match(/^(.+?)[\s]*[-\u2013|][\s]*(\uc950\ud321|Coupang)/i);
    if (titleMatch) titleQuery = titleMatch[1].trim();
    return urlQuery || inputQuery || titleQuery || '';
  }

  // ============================================================
  //  URL 변경 감지 (SPA Navigation)
  // ============================================================
  function hookHistoryApi() {
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function (...a) { origPush.apply(this, a); onUrlChange(); };
    history.replaceState = function (...a) { origReplace.apply(this, a); onUrlChange(); };
  }
  window.addEventListener('popstate', onUrlChange);

  function onUrlChange() {
    const newUrl = location.href;
    if (newUrl === lastUrl) return;
    if (!newUrl.includes('/np/search')) return;
    lastUrl = newUrl;
    lastSignature = '';
    // 이전 오버레이 제거
    document.querySelectorAll(`[${OVERLAY_ATTR}]`).forEach(el => {
      el.removeAttribute(OVERLAY_ATTR);
      el.querySelectorAll('.sh-card-overlay, .sh-mini-badge').forEach(o => o.remove());
      el.classList.remove('sh-relative');
    });
    scheduleScan(300);
    scheduleScan(800);
    scheduleScan(1500);
    scheduleScan(3000);
  }

  setInterval(() => {
    const newUrl = location.href;
    if (newUrl !== lastUrl && newUrl.includes('/np/search')) {
      onUrlChange();
    }
  }, 1000);

  // ============================================================
  //  상품 파싱 (기존 로직 유지)
  // ============================================================
  function parseProductsLegacy() {
    const products = [];
    const nodes = Array.from(document.querySelectorAll(
      'li.search-product, li[class*="search-product"], [data-sentry-component="ProductUnit"], div[class*="search-product"]'
    ));
    if (!nodes.length) return products;
    const query = getQuery();
    for (const node of nodes) {
      if (products.length >= MAX_ITEMS) break;
      const adBadge = node.querySelector('[class*="ad-badge"], [class*="ad_badge"]');
      const isAd = !!adBadge || node.classList.contains('search-product__ad');
      const linkEl = node.querySelector('a[href*="/vp/products/"]') || node.querySelector('a.search-product-link');
      const titleEl = node.querySelector('.name, [class*="name"]') || linkEl;
      const priceEl = node.querySelector('.price-value, [class*="price"]');
      const ratingEl = node.querySelector('.rating, [class*="rating"]');
      const reviewEl = node.querySelector('.rating-total-count, [class*="review"]');
      const imageEl = node.querySelector('img');
      const rocketBadge = node.querySelector('[class*="rocket"], img[alt*="\ub85c\ucf13"]');
      const href = linkEl?.href || '';
      if (!href) continue;
      const pidMatch = href.match(/\/vp\/products\/(\d+)/);
      const item = {
        productId: pidMatch ? pidMatch[1] : null,
        title: text(titleEl), price: parseNumber(text(priceEl)),
        rating: parseFloat2(text(ratingEl)),
        reviewCount: parseNumber(text(reviewEl).replace(/[()]/g, '')),
        url: href,
        imageUrl: imageEl?.src || imageEl?.getAttribute('data-img-src') || '',
        position: products.length + 1, query, isAd, isRocket: !!rocketBadge,
        _container: node,
      };
      if (!item.title && !item.price) continue;
      products.push(item);
    }
    return products;
  }

  function parseProductsByLinks() {
    const products = [];
    const seenIds = new Set();
    const query = getQuery();
    const allLinks = Array.from(document.querySelectorAll('a[href*="/vp/products/"]'));
    for (const link of allLinks) {
      if (products.length >= MAX_ITEMS) break;
      const href = link.href || link.getAttribute('href') || '';
      const pidMatch = href.match(/\/vp\/products\/(\d+)/);
      if (!pidMatch) continue;
      const productId = pidMatch[1];
      if (seenIds.has(productId)) continue;
      const container = findProductContainer(link);
      if (!container) continue;
      seenIds.add(productId);
      const title = extractTitle(container, link);
      if (!title) continue;
      const price = extractPrice(container);
      const rating = extractRating(container);
      const reviewCount = extractReviewCount(container);
      const imageEl = container.querySelector('img[src*="thumbnail"], img[src*="image"], img[data-img-src]') || container.querySelector('img');
      const containerText = text(container);
      const item = {
        productId, title, price, rating, reviewCount,
        url: href.startsWith('http') ? href : 'https://www.coupang.com' + href,
        imageUrl: imageEl?.src || imageEl?.getAttribute('data-img-src') || '',
        position: products.length + 1, query,
        isAd: detectAd(container, containerText),
        isRocket: detectRocket(container, containerText),
        _container: container,
      };
      products.push(item);
    }
    return products;
  }

  // ---- 파싱 헬퍼 (동일) ----
  function findProductContainer(link) {
    let el = link.parentElement, depth = 0;
    while (el && depth < 8) {
      const tag = el.tagName.toLowerCase();
      const cls = el.className || '';
      if (['ul','ol','main','body','section'].includes(tag)) {
        return el === link.parentElement ? null : link.parentElement;
      }
      if (tag === 'li' && el.parentElement && ['UL','OL'].includes(el.parentElement.tagName)) return el;
      if (tag === 'article') return el;
      if (tag === 'div' && el.parentElement) {
        const sibs = el.parentElement.children;
        let ct = 0;
        for (const s of sibs) if (s.tagName === el.tagName) ct++;
        if (ct >= 3 && el.querySelector('a[href*="/vp/products/"]')) return el;
      }
      if (cls && /product|item|card|result|unit/i.test(cls) && depth >= 1) return el;
      if (el.dataset?.productId || el.dataset?.itemId) return el;
      el = el.parentElement; depth++;
    }
    let fb = link;
    for (let i = 0; i < 3 && fb.parentElement; i++) fb = fb.parentElement;
    return fb;
  }
  function extractTitle(c, link) {
    const ne = c.querySelector('[class*="name"],[class*="title"],[class*="Name"],[class*="Title"]');
    if (ne) { const t = text(ne); if (t.length > 5 && t.length < 500) return t; }
    const lt = text(link);
    if (lt.length > 5 && lt.length < 500) return lt;
    const img = c.querySelector('img');
    if (img?.alt?.length > 3) return img.alt;
    return '';
  }
  function extractPrice(c) {
    for (const el of c.querySelectorAll('[class*="price"],[class*="Price"]')) {
      const ms = text(el).match(/[\d,]+원/g);
      if (ms) { const ns = ms.map(m => parseNumber(m)).filter(n => n >= 100 && n < 1e8); if (ns.length) return Math.min(...ns); }
    }
    const ms = text(c).match(/[\d,]+원/g);
    if (ms) { const ns = ms.map(m => parseNumber(m)).filter(n => n >= 100 && n < 1e8); if (ns.length) return Math.min(...ns); }
    return 0;
  }
  function extractRating(c) {
    const re = c.querySelector('[class*="rating"],[class*="star"],[class*="Rating"],[class*="Star"]');
    if (re) { const m = text(re).match(/(\d+\.?\d*)/); if (m) { const v = parseFloat(m[1]); if (v > 0 && v <= 5) return v; } }
    const se = c.querySelector('[aria-label*="\ubcc4\uc810"]');
    if (se) { const m = (se.getAttribute('aria-label')||'').match(/(\d+\.?\d*)/); if (m) { const v = parseFloat(m[1]); if (v > 0 && v <= 5) return v; } }
    return 0;
  }
  function extractReviewCount(c) {
    const re = c.querySelector('[class*="review"],[class*="Review"],[class*="count"],.rating-total-count');
    if (re) { const n = parseNumber(text(re).replace(/[()]/g,'')); if (n > 0 && n < 1e7) return n; }
    const ms = text(c).match(/\((\d[\d,]*)\)/g);
    if (ms) for (const m of ms) { const n = parseNumber(m); if (n > 0 && n < 1e7) return n; }
    return 0;
  }
  function detectAd(c, ct) {
    if (/ad[-_]?badge|광고|sponsored/i.test((c.className||'')+c.innerHTML)) return true;
    for (const el of c.querySelectorAll('span,em,strong,div')) { const t = text(el).trim(); if (t === 'AD' || t === '광고') return true; }
    return false;
  }
  function detectRocket(c, ct) {
    if (c.querySelector('[class*="rocket"],img[alt*="\ub85c\ucf13"],img[src*="rocket"]')) return true;
    if (/로켓배송|로켓와우|로켓프레시/i.test(ct)) return true;
    return false;
  }

  // ============================================================
  //  Auto Scan — 메인 로직
  // ============================================================
  function autoScan() {
    if (!location.href.includes('/np/search')) return;

    let products = parseProductsLegacy();
    if (products.length < 3) products = parseProductsByLinks();
    if (!products.length) return;

    const query = getQuery();
    const signature = JSON.stringify({
      query, count: products.length,
      ids: products.map(i => i.productId || i.url).slice(0, 5)
    });
    if (signature === lastSignature) return;
    lastSignature = signature;

    allParsedItems = products.map(p => ({ ...p, query }));

    // 스타일 삽입
    injectStyles();

    // 각 상품 카드에 오버레이 삽입
    for (const item of allParsedItems) {
      if (item._container) {
        insertOverlay(item._container, item, allParsedItems);
      }
    }

    // background에도 데이터 전달 (사이드패널 호환)
    const cleanItems = allParsedItems.map(({ _container, ...rest }) => rest);
    chrome.runtime.sendMessage({
      type: 'SEARCH_RESULTS_PARSED',
      query,
      items: cleanItems,
    }).catch(() => {});
  }

  function scheduleScan(delay) {
    setTimeout(autoScan, delay || 800);
  }

  // ============================================================
  //  초기화
  // ============================================================
  hookHistoryApi();

  // MutationObserver (새 상품 로드 감지)
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(autoScan, 600);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('load', () => scheduleScan(500));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleScan(300); });

  // 즉시 시작 + 지연 재시도
  autoScan();
  scheduleScan(500);
  scheduleScan(1500);
  scheduleScan(3000);
  scheduleScan(5000);

  // 페이지 감지 리포트
  chrome.runtime.sendMessage({
    type: 'PAGE_DETECTED',
    pageType: 'search',
    url: location.href,
  }).catch(() => {});
})();
