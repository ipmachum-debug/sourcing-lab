/* ============================================================
   Coupang Sourcing Helper — Content Script v5.2.0
   "플로팅 바 UX" — 심플 & 확실

   전략: 쿠팡 DOM에 절대 삽입하지 않음
   - 화면 하단 고정 플로팅 바 (독립 레이어)
   - 상품 호버 → 자동 감지 → 바에 정보 표시
   - 클릭 한번으로 1688/알리 검색
   - 사이드패널 데이터 전송 유지
   ============================================================ */
(function () {
  const SH_VERSION = '5.2.0';

  // ---- 중복 실행 방지 ----
  if (window.__SH_CONTENT_LOADED__) return;
  window.__SH_CONTENT_LOADED__ = true;
  window.__SH_CONTENT_VERSION__ = SH_VERSION;

  // v5.0/v5.1 잔재 제거
  ['sh-overlay-styles','sh-modal-styles','sh-debug-panel','sh-version-badge'].forEach(id => {
    document.getElementById(id)?.remove();
  });
  document.querySelectorAll('.sh-card-overlay,.sh-databar,.sh-mini-badge,.sh-modal-backdrop,.sh-modal-panel,[data-sh-overlay],[data-sh-badge]').forEach(el => el.remove());

  console.log(`%c[SH] v${SH_VERSION} 플로팅 바 모드 로드`, 'color:#16a34a;font-weight:bold;font-size:14px;');

  const MAX_ITEMS = 36;
  let lastSignature = '';
  let lastUrl = location.href;
  let allItems = [];
  let hoveredItem = null;
  let debounceTimer = null;

  // ============================================================
  //  한국어 → 중국어/영어 매핑 (소싱 검색용)
  // ============================================================
  const CN = {
    '텀블러':'保温杯','물병':'水杯','수건':'毛巾','비누':'肥皂','칫솔':'牙刷',
    '수세미':'百洁布','스펀지':'海绵','솔':'刷子','청소':'清洁','세제':'洗涤剂',
    '걸레':'拖把','행주':'抹布','극세사':'超细纤维','실리콘':'硅胶','세척':'清洗',
    '냄비':'锅','프라이팬':'平底锅','도마':'砧板','접시':'盘子','그릇':'碗',
    '밀폐용기':'密封盒','충전기':'充电器','케이블':'数据线','이어폰':'耳机',
    '블루투스':'蓝牙','마우스':'鼠标','키보드':'键盘','보조배터리':'充电宝',
    '거치대':'支架','케이스':'手机壳','티셔츠':'T恤','양말':'袜子','가방':'包',
    '백팩':'双肩包','지갑':'钱包','목걸이':'项链','반지':'戒指','장난감':'玩具',
    '펜':'笔','노트':'笔记本','스티커':'贴纸','요가매트':'瑜伽垫','텐트':'帐篷',
    '커튼':'窗帘','이불':'被子','베개':'枕头','매트':'垫子','빗자루':'扫帚',
    '쓰레받기':'簸箕','세트':'套装','빗자루세트':'扫把套装','먼지떨이':'鸡毛掸子',
    '스크럽':'百洁刷','다용도':'多用途','수납':'收纳','선반':'架子','행거':'衣架',
    '컵':'杯子','거울':'镜子','모자':'帽子','신발':'鞋','운동화':'运动鞋',
    '슬리퍼':'拖鞋','샌들':'凉鞋','선글라스':'太阳镜','시계':'手表',
    '립스틱':'口红','로션':'乳液','크림':'面霜','선크림':'防晒霜','샴푸':'洗发水',
    '칼':'刀','주전자':'水壶','머그컵':'马克杯','빨래':'洗衣','건조대':'晾衣架',
    '쓰레기통':'垃圾桶','휴지통':'纸篓','바구니':'篮子','정리함':'收纳盒',
  };
  const EN = {
    '텀블러':'tumbler','물병':'water bottle','수건':'towel','비누':'soap',
    '수세미':'scrub sponge','스펀지':'sponge','솔':'brush','청소':'cleaning',
    '충전기':'charger','케이블':'cable','이어폰':'earphone','마우스':'mouse',
    '키보드':'keyboard','케이스':'phone case','가방':'bag','백팩':'backpack',
    '장난감':'toy','텐트':'tent','커튼':'curtain','이불':'blanket','베개':'pillow',
    '빗자루':'broom','쓰레받기':'dustpan','세트':'set','빗자루세트':'broom set',
    '먼지떨이':'duster','슬리퍼':'slippers','선글라스':'sunglasses',
  };
  const NOISE = new Set(['1개','2개','3개','4개','5개','1P','2P','3P','1+1','2+1',
    '무료배송','당일발송','최저가','특가','세일','할인','핫딜','정품','국내정품',
    '고급','프리미엄','대용량','소용량','미니','슬림','블랙','화이트','그레이',
    '베이지','네이비','핑크','레드','블루','그린']);

  function extractKeywords(title) {
    if (!title) return { ko: '', cn: '', en: '' };
    let cleaned = title
      .replace(/\[.*?\]/g,' ').replace(/\(.*?\)/g,' ').replace(/【.*?】/g,' ')
      .replace(/[\/\\|~`!@#$%^&*=+{};:'"<>,.?]/g,' ')
      .replace(/\d+(ml|g|kg|cm|mm|개입|매입|세트|팩|롤)/gi,' ')
      .trim();
    let words = cleaned.split(/\s+/).filter(w =>
      w.length > 1 && !NOISE.has(w) && !/^\d+$/.test(w)
    );
    // 첫 단어가 영문 브랜드면 제거
    if (words.length > 2 && /^[a-zA-Z]+$/.test(words[0]) && words[0].length >= 2 && !CN[words[0]]) {
      words.shift();
    }
    const core = words.slice(0, 3);
    const ko = core.join(' ');
    const cnParts = core.map(w => CN[w]).filter(Boolean);
    const enParts = core.map(w => EN[w]).filter(Boolean);
    return {
      ko,
      cn: cnParts.length ? cnParts.join(' ') : '',
      en: enParts.length ? enParts.join(' ') : ko, // 영어 없으면 한국어 폴백
    };
  }

  // ============================================================
  //  간단 점수
  // ============================================================
  function quickScore(item, all) {
    let s = 50;
    if (item.reviewCount < 50) s += 20;
    else if (item.reviewCount < 200) s += 12;
    else if (item.reviewCount < 500) s += 5;
    else if (item.reviewCount > 2000) s -= 10;
    if (item.rating >= 4.5) s += 5;
    else if (item.rating < 3.5 && item.rating > 0) s -= 5;
    if (item.price >= 5000 && item.price <= 30000) s += 10;
    else if (item.price > 0 && item.price < 3000) s -= 5;
    if (item.isAd) s -= 8;
    return Math.max(0, Math.min(100, Math.round(s)));
  }
  function grade(score) {
    if (score >= 80) return { g: 'S', c: '#16a34a' };
    if (score >= 65) return { g: 'A', c: '#3b82f6' };
    if (score >= 50) return { g: 'B', c: '#f59e0b' };
    if (score >= 35) return { g: 'C', c: '#9ca3af' };
    return { g: 'D', c: '#dc2626' };
  }

  // ============================================================
  //  플로팅 바 생성 (화면 하단 고정 — 쿠팡 DOM과 완전 분리)
  // ============================================================
  const bar = document.createElement('div');
  bar.id = 'sh-float-bar';
  bar.innerHTML = `
    <style>
      #sh-float-bar {
        position: fixed !important;
        bottom: 0 !important;
        left: 0 !important;
        right: 0 !important;
        z-index: 2147483647 !important;
        background: linear-gradient(135deg, #1e1b4b, #312e81) !important;
        color: #fff !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', sans-serif !important;
        font-size: 13px !important;
        box-shadow: 0 -4px 20px rgba(0,0,0,0.3) !important;
        display: flex !important;
        align-items: stretch !important;
        height: 48px !important;
        transition: transform 0.3s ease !important;
        user-select: none !important;
      }
      #sh-float-bar.sh-hidden { transform: translateY(100%) !important; }
      #sh-float-bar * { box-sizing: border-box !important; margin: 0 !important; padding: 0 !important; }

      .sh-bar-status {
        display: flex !important; align-items: center !important; gap: 6px !important;
        padding: 0 14px !important; background: rgba(255,255,255,0.08) !important;
        border-right: 1px solid rgba(255,255,255,0.15) !important;
        font-size: 11px !important; color: #a5b4fc !important; white-space: nowrap !important;
        min-width: 120px !important;
      }
      .sh-bar-ver { font-weight: 700 !important; color: #34d399 !important; }
      .sh-bar-count { color: #fbbf24 !important; font-weight: 600 !important; }

      .sh-bar-product {
        flex: 1 !important; display: flex !important; align-items: center !important;
        gap: 10px !important; padding: 0 14px !important; overflow: hidden !important;
        min-width: 0 !important;
      }
      .sh-bar-empty {
        color: #94a3b8 !important; font-size: 12px !important; font-style: italic !important;
      }
      .sh-bar-grade {
        display: inline-flex !important; align-items: center !important; justify-content: center !important;
        min-width: 32px !important; height: 26px !important; border-radius: 6px !important;
        font-size: 12px !important; font-weight: 800 !important; color: #fff !important;
        flex-shrink: 0 !important;
      }
      .sh-bar-title {
        flex: 1 !important; overflow: hidden !important; text-overflow: ellipsis !important;
        white-space: nowrap !important; font-size: 12px !important; color: #e2e8f0 !important;
      }
      .sh-bar-price {
        font-weight: 700 !important; color: #fbbf24 !important; font-size: 13px !important;
        white-space: nowrap !important; flex-shrink: 0 !important;
      }
      .sh-bar-review {
        font-size: 11px !important; color: #94a3b8 !important;
        white-space: nowrap !important; flex-shrink: 0 !important;
      }

      .sh-bar-actions {
        display: flex !important; align-items: center !important; gap: 4px !important;
        padding: 0 10px !important; border-left: 1px solid rgba(255,255,255,0.15) !important;
      }
      .sh-bar-btn {
        height: 32px !important; padding: 0 12px !important; border: none !important;
        border-radius: 6px !important; font-size: 11px !important; font-weight: 700 !important;
        cursor: pointer !important; color: #fff !important; white-space: nowrap !important;
        display: flex !important; align-items: center !important; gap: 4px !important;
        transition: opacity 0.15s !important;
      }
      .sh-bar-btn:hover { opacity: 0.85 !important; }
      .sh-bar-btn:disabled { opacity: 0.4 !important; cursor: default !important; }
      .sh-btn-1688 { background: #ea580c !important; }
      .sh-btn-ali { background: #dc2626 !important; }
      .sh-btn-ai { background: #7c3aed !important; }
      .sh-btn-save { background: #4f46e5 !important; }

      .sh-bar-toggle {
        display: flex !important; align-items: center !important; justify-content: center !important;
        width: 32px !important; background: rgba(255,255,255,0.05) !important;
        border: none !important; color: #94a3b8 !important; cursor: pointer !important;
        font-size: 14px !important; border-left: 1px solid rgba(255,255,255,0.1) !important;
      }
      .sh-bar-toggle:hover { color: #fff !important; background: rgba(255,255,255,0.1) !important; }

      /* 상품 카드 하이라이트 */
      .sh-hover-highlight {
        outline: 3px solid #6366f1 !important;
        outline-offset: -1px !important;
        transition: outline 0.15s !important;
      }
    </style>

    <div class="sh-bar-status">
      <span class="sh-bar-ver">SH v${SH_VERSION}</span>
      <span class="sh-bar-count" id="shBarCount">0개</span>
    </div>

    <div class="sh-bar-product" id="shBarProduct">
      <span class="sh-bar-empty">상품 위에 마우스를 올려보세요</span>
    </div>

    <div class="sh-bar-actions" id="shBarActions" style="display:none !important;">
      <button class="sh-bar-btn sh-btn-1688" id="shBtn1688" title="1688에서 검색">🏭 1688</button>
      <button class="sh-bar-btn sh-btn-ali" id="shBtnAli" title="AliExpress에서 검색">🌐 알리</button>
      <button class="sh-bar-btn sh-btn-ai" id="shBtnAI" title="AI 사전매칭">🤖 AI</button>
      <button class="sh-bar-btn sh-btn-save" id="shBtnSave" title="후보 저장">💾</button>
    </div>

    <button class="sh-bar-toggle" id="shBarToggle" title="접기/펼치기">▼</button>
  `;
  document.documentElement.appendChild(bar);

  // ---- 접기/펼치기 ----
  let barHidden = false;
  document.getElementById('shBarToggle').addEventListener('click', () => {
    barHidden = !barHidden;
    bar.classList.toggle('sh-hidden', barHidden);
    document.getElementById('shBarToggle').textContent = barHidden ? '▲' : '▼';
  });

  // ============================================================
  //  상품 호버 감지 (쿠팡 DOM 분석)
  // ============================================================
  let lastHighlighted = null;

  function findProductFromElement(el) {
    // 링크에서 productId 추출
    let node = el;
    for (let i = 0; i < 8 && node; i++) {
      // href에서 직접 추출
      if (node.tagName === 'A') {
        const href = node.href || '';
        const m = href.match(/\/vp\/products\/(\d+)/);
        if (m) return findItemById(m[1]);
      }
      // data 속성
      if (node.dataset?.productId) return findItemById(node.dataset.productId);
      // 내부 링크 검색
      const link = node.querySelector?.('a[href*="/vp/products/"]');
      if (link) {
        const m = (link.href || '').match(/\/vp\/products\/(\d+)/);
        if (m) return findItemById(m[1]);
      }
      node = node.parentElement;
    }
    return null;
  }

  function findItemById(id) {
    return allItems.find(item => item.productId === id) || null;
  }

  // 마우스 이동 감지 (throttled)
  let hoverThrottle = null;
  document.addEventListener('mouseover', (e) => {
    if (hoverThrottle) return;
    hoverThrottle = setTimeout(() => { hoverThrottle = null; }, 100);

    const item = findProductFromElement(e.target);
    if (item && item !== hoveredItem) {
      hoveredItem = item;
      updateBar(item);
      highlightProduct(e.target, item);
    }
  });

  function highlightProduct(el, item) {
    // 이전 하이라이트 제거
    if (lastHighlighted) lastHighlighted.classList.remove('sh-hover-highlight');
    // 상품 컨테이너 찾기
    let node = el;
    for (let i = 0; i < 6 && node; i++) {
      if (node.tagName === 'LI' || node.dataset?.productId) break;
      const link = node.querySelector?.('a[href*="/vp/products/"]');
      if (link && node.tagName !== 'BODY') break;
      node = node.parentElement;
    }
    if (node && node !== document.body) {
      node.classList.add('sh-hover-highlight');
      lastHighlighted = node;
    }
  }

  // ============================================================
  //  플로팅 바 업데이트
  // ============================================================
  function updateBar(item) {
    const product = document.getElementById('shBarProduct');
    const actions = document.getElementById('shBarActions');
    if (!item) {
      product.innerHTML = '<span class="sh-bar-empty">상품 위에 마우스를 올려보세요</span>';
      actions.style.setProperty('display', 'none', 'important');
      return;
    }

    const score = quickScore(item, allItems);
    const { g, c } = grade(score);
    const priceStr = item.price ? item.price.toLocaleString() + '원' : '-';
    const reviewStr = item.reviewCount > 0 ? `리뷰 ${item.reviewCount.toLocaleString()}` : '리뷰 없음';

    product.innerHTML = `
      <span class="sh-bar-grade" style="background:${c} !important;">${g}${score}</span>
      <span class="sh-bar-title">${item.title || '(제목 없음)'}</span>
      <span class="sh-bar-price">${priceStr}</span>
      <span class="sh-bar-review">${reviewStr}${item.isAd ? ' · AD' : ''}${item.isRocket ? ' · 🚀' : ''}</span>
    `;
    actions.style.setProperty('display', 'flex', 'important');
  }

  // ============================================================
  //  액션 버튼 이벤트
  // ============================================================

  // 1688 검색
  document.getElementById('shBtn1688').addEventListener('click', async () => {
    if (!hoveredItem) return;
    const btn = document.getElementById('shBtn1688');
    btn.disabled = true;
    btn.textContent = '⏳ ...';

    try {
      // AI 사전매칭 시도
      const resp = await chrome.runtime.sendMessage({
        type: 'PRE_MATCH',
        productName: hoveredItem.title,
        price: hoveredItem.price,
        imageUrl: hoveredItem.imageUrl,
      });

      if (resp?.success && resp.keywords1688?.length) {
        // AI 추천 검색어로 열기
        window.open(`https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(resp.keywords1688[0].keyword)}`, '_blank');
      } else {
        // 폴백: 로컬 번역
        const kw = extractKeywords(hoveredItem.title);
        const search = kw.cn || kw.ko;
        window.open(`https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(search)}`, '_blank');
      }
    } catch (e) {
      const kw = extractKeywords(hoveredItem.title);
      window.open(`https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(kw.cn || kw.ko)}`, '_blank');
    }

    btn.disabled = false;
    btn.textContent = '🏭 1688';
  });

  // AliExpress 검색
  document.getElementById('shBtnAli').addEventListener('click', () => {
    if (!hoveredItem) return;
    const kw = extractKeywords(hoveredItem.title);
    window.open(`https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(kw.en || kw.ko)}`, '_blank');
  });

  // AI 분석
  document.getElementById('shBtnAI').addEventListener('click', async () => {
    if (!hoveredItem) return;
    const btn = document.getElementById('shBtnAI');
    btn.disabled = true;
    btn.textContent = '⏳ ...';

    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'REQUEST_AI_ANALYSIS',
        product: hoveredItem,
        score: quickScore(hoveredItem, allItems),
      });
      if (resp?.success) {
        alert(`[AI 분석 결과]\n\n${resp.summary || '분석 완료'}\n\n초보 적합도: ${resp.data?.beginnerFit?.score || '-'}점\n${resp.data?.beginnerFit?.reason || ''}\n\n${resp.data?.risks?.length ? '⚠️ 리스크: ' + resp.data.risks.join(', ') : ''}`);
      } else {
        alert('AI 분석 실패: ' + (resp?.error || '서버 오류'));
      }
    } catch (e) {
      alert('네트워크 오류');
    }

    btn.disabled = false;
    btn.textContent = '🤖 AI';
  });

  // 후보 저장
  document.getElementById('shBtnSave').addEventListener('click', () => {
    if (!hoveredItem) return;
    const btn = document.getElementById('shBtnSave');
    chrome.runtime.sendMessage({
      type: 'SAVE_CANDIDATE',
      product: hoveredItem,
      score: quickScore(hoveredItem, allItems),
      grade: grade(quickScore(hoveredItem, allItems)).g,
    }).catch(() => {});
    btn.textContent = '✅ 저장됨';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = '💾'; btn.disabled = false; }, 2000);
  });

  // ============================================================
  //  상품 파싱 (기존 로직 유지 — 사이드패널 호환)
  // ============================================================
  function getQuery() {
    const url = new URL(location.href);
    return url.searchParams.get('q')
      || url.searchParams.get('query')
      || url.searchParams.get('keyword')
      || '';
  }

  function parseProducts() {
    const products = [];
    const seenIds = new Set();
    const query = getQuery();
    const links = Array.from(document.querySelectorAll('a[href*="/vp/products/"]'));

    for (const link of links) {
      if (products.length >= MAX_ITEMS) break;
      const href = link.href || '';
      const m = href.match(/\/vp\/products\/(\d+)/);
      if (!m) continue;
      const pid = m[1];
      if (seenIds.has(pid)) continue;
      seenIds.add(pid);

      // 컨테이너 탐색
      let container = link;
      for (let i = 0; i < 6 && container.parentElement; i++) {
        container = container.parentElement;
        if (container.tagName === 'LI') break;
        if (container.dataset?.productId) break;
      }

      const txt = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
      const num = (s) => parseInt((s || '').replace(/[^0-9]/g, ''), 10) || 0;

      // 제목
      const nameEl = container.querySelector('[class*="name"],[class*="title"],[class*="Name"]');
      const title = (nameEl ? txt(nameEl) : '') || txt(link) || (container.querySelector('img')?.alt || '');
      if (!title || title.length < 3) continue;

      // 가격
      let price = 0;
      for (const el of container.querySelectorAll('[class*="price"],[class*="Price"]')) {
        const ms = txt(el).match(/[\d,]+원/g);
        if (ms) { const ns = ms.map(m => num(m)).filter(n => n >= 100 && n < 1e8); if (ns.length) { price = Math.min(...ns); break; } }
      }
      if (!price) {
        const ms = txt(container).match(/[\d,]+원/g);
        if (ms) { const ns = ms.map(m => num(m)).filter(n => n >= 100 && n < 1e8); if (ns.length) price = Math.min(...ns); }
      }

      // 평점, 리뷰
      let rating = 0, reviewCount = 0;
      const ratingEl = container.querySelector('[class*="rating"],[class*="star"]');
      if (ratingEl) { const rm = txt(ratingEl).match(/(\d+\.?\d*)/); if (rm) { const v = parseFloat(rm[1]); if (v > 0 && v <= 5) rating = v; } }
      const reviewEl = container.querySelector('[class*="review"],[class*="count"],.rating-total-count');
      if (reviewEl) { reviewCount = num(txt(reviewEl).replace(/[()]/g, '')); }

      const imgEl = container.querySelector('img');
      const isAd = /ad[-_]?badge|광고|sponsored/i.test(container.innerHTML.substring(0, 500));

      products.push({
        productId: pid, title, price, rating, reviewCount,
        url: href.startsWith('http') ? href : 'https://www.coupang.com' + href,
        imageUrl: imgEl?.src || imgEl?.getAttribute('data-img-src') || '',
        position: products.length + 1, query, isAd,
        isRocket: /로켓배송|로켓와우|rocket/i.test(txt(container)),
      });
    }
    return products;
  }

  // ============================================================
  //  Auto Scan
  // ============================================================
  function autoScan() {
    if (!location.href.includes('/np/search')) return;

    const products = parseProducts();
    if (!products.length) return;

    const sig = products.map(p => p.productId).slice(0, 5).join(',');
    if (sig === lastSignature) return;
    lastSignature = sig;

    allItems = products;
    document.getElementById('shBarCount').textContent = `${products.length}개`;
    console.log(`%c[SH] ✅ ${products.length}개 상품 파싱 완료`, 'color:#16a34a;font-weight:bold;');

    // 사이드패널 호환 — background에 데이터 전달
    const query = getQuery();
    chrome.runtime.sendMessage({
      type: 'SEARCH_RESULTS_PARSED',
      query,
      items: products,
    }).catch(() => {});
  }

  // ============================================================
  //  URL 변경 감지
  // ============================================================
  function onUrlChange() {
    const newUrl = location.href;
    if (newUrl === lastUrl) return;
    if (!newUrl.includes('/np/search')) return;
    lastUrl = newUrl;
    lastSignature = '';
    hoveredItem = null;
    allItems = [];
    updateBar(null);
    if (lastHighlighted) { lastHighlighted.classList.remove('sh-hover-highlight'); lastHighlighted = null; }
    setTimeout(autoScan, 300);
    setTimeout(autoScan, 800);
    setTimeout(autoScan, 1500);
  }

  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (...a) { origPush.apply(this, a); onUrlChange(); };
  history.replaceState = function (...a) { origReplace.apply(this, a); onUrlChange(); };
  window.addEventListener('popstate', onUrlChange);
  setInterval(() => { if (location.href !== lastUrl) onUrlChange(); }, 1000);

  // MutationObserver (debounced)
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(autoScan, 600);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // 초기 스캔
  autoScan();
  setTimeout(autoScan, 500);
  setTimeout(autoScan, 1500);
  setTimeout(autoScan, 3000);

  // 페이지 감지
  chrome.runtime.sendMessage({ type: 'PAGE_DETECTED', pageType: 'search', url: location.href }).catch(() => {});
})();
