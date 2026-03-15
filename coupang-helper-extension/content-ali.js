/* ============================================================
   Coupang Sourcing Helper — AliExpress Search Content Script v6.0
   알리익스프레스 검색결과 실시간 분석 패널
   
   목적: 트렌드/참고용 (DB 저장 없음, 실시간 분석만)
   - 가격대/주문수/평점 한눈에 파악
   - 경쟁도 패널
   - TOP3 상품
   - "쿠팡에서 찾기" 버튼
   - "소싱 후보 등록" 버튼
   ============================================================ */
(function () {
  'use strict';
  const VER = '6.3.0';

  if (window.__SH_ALI_LOADED__) return;
  window.__SH_ALI_LOADED__ = true;

  console.log(`%c[SH-Ali] v${VER} AliExpress 검색 분석 로드`, 'color:#e74c3c;font-weight:bold;font-size:14px;');

  // ============================================================
  //  CSS
  // ============================================================
  const css = document.createElement('style');
  css.id = 'sh-ali-css';
  css.textContent = `
    #sh-ali-panel {
      position: fixed !important;
      top: 60px !important;
      right: 10px !important;
      width: 340px !important;
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
      transition: opacity 0.2s !important;
    }
    #sh-ali-panel.sh-min {
      width: 44px !important; max-height: 44px !important;
      border-radius: 22px !important; cursor: pointer !important;
    }
    #sh-ali-panel.sh-min .sh-hc, #sh-ali-panel.sh-min .sh-body { display: none !important; }
    #sh-ali-panel.sh-drag { opacity: 0.8 !important; cursor: grabbing !important; }

    .sh-ali-hd {
      background: linear-gradient(135deg,#e74c3c 0%,#c0392b 100%) !important;
      color: #fff !important;
      padding: 10px 14px !important;
      display: flex !important; align-items: center !important; justify-content: space-between !important;
      cursor: grab !important; flex-shrink: 0 !important;
      border-radius: 14px 14px 0 0 !important;
    }
    #sh-ali-panel.sh-min .sh-ali-hd { border-radius: 22px !important; padding: 10px !important; justify-content: center !important; }
    .sh-ali-hd .logo { font-size: 15px !important; font-weight: 800 !important; }
    .sh-hc { display: flex !important; align-items: center !important; gap: 6px !important; flex:1 !important; }
    .sh-hc .ver { font-size: 8px !important; opacity: .6 !important; background: rgba(255,255,255,.12) !important; padding: 1px 5px !important; border-radius: 3px !important; }
    .sh-hc .qr { font-size: 11px !important; background: rgba(255,255,255,.18) !important; padding: 2px 8px !important; border-radius: 5px !important; max-width: 120px !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; font-weight: 600 !important; }
    .sh-hc .cnt { font-size: 10px !important; background: rgba(255,255,255,.22) !important; padding: 2px 6px !important; border-radius: 5px !important; font-weight: 700 !important; }
    .sh-hbtns { display: flex !important; gap: 3px !important; }
    .sh-hb { width: 22px !important; height: 22px !important; display: flex !important; align-items: center !important; justify-content: center !important; border: none !important; background: rgba(255,255,255,.12) !important; color: #fff !important; border-radius: 5px !important; cursor: pointer !important; font-size: 12px !important; padding: 0 !important; }
    .sh-hb:hover { background: rgba(255,255,255,.28) !important; }

    .sh-body { overflow-y: auto !important; flex: 1 !important; }
    .sh-body::-webkit-scrollbar { width: 3px !important; }
    .sh-body::-webkit-scrollbar-thumb { background: #cbd5e1 !important; border-radius: 3px !important; }

    .sh-sec { padding: 12px 14px !important; border-bottom: 1px solid #f1f5f9 !important; }
    .sh-sec-title { font-size: 10px !important; font-weight: 700 !important; color: #94a3b8 !important; text-transform: uppercase !important; letter-spacing: .5px !important; margin-bottom: 8px !important; }

    .sh-stats { display: grid !important; grid-template-columns: 1fr 1fr 1fr !important; gap: 8px !important; }
    .sh-st { background: #f8fafc !important; border-radius: 8px !important; padding: 8px 10px !important; display: flex !important; flex-direction: column !important; align-items: center !important; border: 1px solid #f1f5f9 !important; }
    .sh-st-v { font-size: 15px !important; font-weight: 800 !important; color: #1e293b !important; line-height: 1.2 !important; }
    .sh-st-v.accent { color: #e74c3c !important; }
    .sh-st-v.red { color: #dc2626 !important; }
    .sh-st-v.green { color: #16a34a !important; }
    .sh-st-v.amber { color: #d97706 !important; }
    .sh-st-l { font-size: 9px !important; color: #94a3b8 !important; margin-top: 2px !important; }

    .sh-comp-bar { height: 6px !important; border-radius: 3px !important; background: #f1f5f9 !important; margin-top: 6px !important; overflow: hidden !important; }
    .sh-comp-fill { height: 100% !important; border-radius: 3px !important; transition: width .3s !important; }
    .sh-comp-easy { background: #16a34a !important; }
    .sh-comp-mid { background: #f59e0b !important; }
    .sh-comp-hard { background: #dc2626 !important; }

    .sh-charts { display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 8px !important; margin-top: 10px !important; }
    .sh-chart { background: #f8fafc !important; border-radius: 8px !important; padding: 8px !important; border: 1px solid #f1f5f9 !important; }
    .sh-chart-title { font-size: 9px !important; font-weight: 600 !important; color: #94a3b8 !important; margin-bottom: 6px !important; }
    .sh-bars { display: flex !important; align-items: flex-end !important; gap: 2px !important; height: 40px !important; }
    .sh-bar { flex: 1 !important; background: #fca5a5 !important; border-radius: 2px 2px 0 0 !important; min-height: 2px !important; transition: height .3s !important; position: relative !important; }
    .sh-bar:hover { background: #e74c3c !important; }
    .sh-bar-lbl { position: absolute !important; bottom: -13px !important; left: 50% !important; transform: translateX(-50%) !important; font-size: 7px !important; color: #94a3b8 !important; white-space: nowrap !important; }
    .sh-bar-active { background: #e74c3c !important; }

    .sh-top { display: flex !important; gap: 8px !important; padding: 8px 0 !important; border-bottom: 1px solid #f1f5f9 !important; align-items: flex-start !important; cursor: pointer !important; transition: background .15s !important; }
    .sh-top:last-child { border-bottom: none !important; }
    .sh-top:hover { background: #f8fafc !important; border-radius: 6px !important; }
    .sh-top-rank { width: 20px !important; height: 20px !important; border-radius: 5px !important; display: flex !important; align-items: center !important; justify-content: center !important; font-size: 10px !important; font-weight: 800 !important; flex-shrink: 0 !important; }
    .sh-r1 { background: #fef3c7 !important; color: #92400e !important; }
    .sh-r2 { background: #fecaca !important; color: #991b1b !important; }
    .sh-r3 { background: #f1f5f9 !important; color: #64748b !important; }
    .sh-top-img { width: 40px !important; height: 40px !important; border-radius: 6px !important; object-fit: cover !important; flex-shrink: 0 !important; background: #f1f5f9 !important; }
    .sh-top-info { flex: 1 !important; min-width: 0 !important; }
    .sh-top-name { font-size: 11px !important; font-weight: 600 !important; color: #1e293b !important; white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important; margin-bottom: 3px !important; line-height: 1.3 !important; }
    .sh-top-meta { display: flex !important; align-items: center !important; gap: 5px !important; flex-wrap: wrap !important; }
    .sh-top-price { font-size: 11px !important; font-weight: 700 !important; color: #dc2626 !important; }
    .sh-top-rev { font-size: 9px !important; color: #64748b !important; }
    .sh-top-btns { display: flex !important; gap: 3px !important; margin-top: 4px !important; }
    .sh-tb { height: 20px !important; padding: 0 7px !important; border: none !important; border-radius: 4px !important; font-size: 9px !important; font-weight: 700 !important; cursor: pointer !important; color: #fff !important; display: inline-flex !important; align-items: center !important; }
    .sh-tb:hover { opacity: .85 !important; }
    .sh-tb-coupang { background: #6366f1 !important; }
    .sh-tb-save { background: #e74c3c !important; }
    .sh-tb-saved { background: #16a34a !important; }
    .sh-tb-1688 { background: #ea580c !important; }

    .sh-foot { padding: 6px 14px !important; background: #f8fafc !important; border-top: 1px solid #f1f5f9 !important; font-size: 9px !important; color: #94a3b8 !important; text-align: center !important; flex-shrink: 0 !important; }
    .sh-foot a { color: #e74c3c !important; text-decoration: none !important; font-weight: 600 !important; }

    /* 필터바 */
    .sh-filter-bar {
      display: flex !important; align-items: center !important; gap: 6px !important;
      padding: 6px 0 8px !important; flex-wrap: wrap !important;
    }
    .sh-filter-bar select {
      height: 22px !important; font-size: 9px !important; border: 1px solid #e2e8f0 !important;
      border-radius: 4px !important; padding: 0 4px !important; background: #fff !important;
      color: #475569 !important; font-weight: 600 !important; cursor: pointer !important;
      outline: none !important;
    }
    .sh-filter-bar .sh-fl { font-size: 9px !important; color: #94a3b8 !important; font-weight: 600 !important; }

    @media (max-width: 1200px) { #sh-ali-panel { width: 300px !important; } }
  `;
  document.head.appendChild(css);

  // ============================================================
  //  유틸
  // ============================================================
  const MAX = 48;
  function tx(el) { return (el?.textContent || '').replace(/\s+/g, ' ').trim(); }
  function nm(s) { return parseInt((s || '').replace(/[^0-9]/g, ''), 10) || 0; }
  function esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

  function getSearchQuery() {
    try {
      const u = new URL(location.href);
      return u.searchParams.get('SearchText') || u.searchParams.get('searchText') || u.searchParams.get('q') || '';
    } catch { return ''; }
  }

  function formatPrice(val, currency) {
    if (!val) return '-';
    if (currency === 'KRW') return Math.round(val).toLocaleString() + '원';
    return '$' + val.toFixed(2);
  }

  function formatOrders(n) {
    if (!n) return '0';
    if (n >= 10000) return (n / 10000).toFixed(1) + '만';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return n.toLocaleString();
  }

  // ============================================================
  //  상품 파싱 — AliExpress 2025-2026 DOM
  // ============================================================
  function parseAliProducts() {
    const items = [];
    const seen = new Set();
    const q = getSearchQuery();

    // === 방법 A: 상품 카드 리스트 ===
    let cards = [...document.querySelectorAll(
      '[class*="search-item-card"], [class*="SearchProductFeed"] a[href*="/item/"], ' +
      '[class*="product-snippet"] a[href*="/item/"], ' +
      '.search--gallery--list a[href*="/item/"], ' +
      'div[data-pl="true"] a[href*="/item/"]'
    )];

    // 방법 B: 직접 product link 탐색
    if (cards.length < 3) {
      const links = document.querySelectorAll('a[href*="/item/"]');
      const boxSet = new Set();
      for (const a of links) {
        let box = a;
        for (let i = 0; i < 6 && box.parentElement; i++) {
          box = box.parentElement;
          if (box.tagName === 'DIV' && box.offsetHeight > 100) break;
        }
        if (!boxSet.has(box)) { boxSet.add(box); cards.push(box); }
      }
    }

    for (const card of cards) {
      if (items.length >= MAX) break;

      // 링크에서 상품 ID 추출
      const link = card.tagName === 'A' ? card : card.querySelector('a[href*="/item/"]');
      if (!link) continue;
      const href = link.href || link.getAttribute('href') || '';
      const idMatch = href.match(/\/item\/(\d+)/);
      if (!idMatch) continue;
      const pid = idMatch[1];
      if (seen.has(pid)) continue;
      seen.add(pid);

      // 제목
      let title = '';
      const titleEl = card.querySelector(
        '[class*="title"], [class*="Title"], h1, h3, [class*="subject"]'
      );
      if (titleEl) title = tx(titleEl);
      if (!title) title = link.title || tx(link);
      if (!title || title.length < 3) continue;

      // 가격 (USD)
      let price = 0;
      let currency = 'USD';
      const priceEls = card.querySelectorAll(
        '[class*="price"], [class*="Price"], [class*="cost"]'
      );
      for (const el of priceEls) {
        if (el.closest('#sh-ali-panel')) continue;
        const t = tx(el);
        // "US $12.34" or "₩12,345" or "$12.34"
        const usdMatch = t.match(/(?:US\s*\$|USD|\$)\s*([\d,.]+)/i);
        if (usdMatch) {
          const v = parseFloat(usdMatch[1].replace(/,/g, ''));
          if (v > 0 && v < 100000) { price = v; currency = 'USD'; break; }
        }
        const wonMatch = t.match(/[₩￦]\s*([\d,]+)/);
        if (wonMatch) {
          const v = parseInt(wonMatch[1].replace(/,/g, ''), 10);
          if (v > 0 && v < 10000000) { price = v; currency = 'KRW'; break; }
        }
      }

      // 주문수
      let orders = 0;
      const orderEls = card.querySelectorAll(
        '[class*="sold"], [class*="trade"], [class*="order"]'
      );
      for (const el of orderEls) {
        const t = tx(el).toLowerCase();
        // "1,234 sold" or "10000+ sold" or "1k+ sold"
        const m = t.match(/([\d,.]+)\s*(?:k\+?)?\s*sold/i);
        if (m) {
          let v = parseFloat(m[0].replace(/[^0-9.k]/gi, ''));
          if (/k/i.test(m[0])) v *= 1000;
          if (v > 0) { orders = Math.round(v); break; }
        }
        // "1만 sold" 한국어
        const km = t.match(/([\d.]+)\s*만\s*개?.*(?:sold|판매)/);
        if (km) { orders = Math.round(parseFloat(km[1]) * 10000); break; }
        // 숫자만 있고 sold 컨텍스트
        if (/sold|판매|개/i.test(t)) {
          const n = nm(t);
          if (n > 0 && n < 10000000) { orders = n; break; }
        }
      }

      // 평점
      let rating = 0;
      const ratingEls = card.querySelectorAll(
        '[class*="star"], [class*="rating"], [class*="evaluation"]'
      );
      for (const el of ratingEls) {
        if (el.closest('#sh-ali-panel')) continue;
        const t = tx(el);
        const rm = t.match(/(\d+\.?\d*)/);
        if (rm) {
          const v = parseFloat(rm[1]);
          if (v > 0 && v <= 5) { rating = v; break; }
        }
        // style width 기반
        const style = el.getAttribute('style') || '';
        const wm = style.match(/width:\s*([\d.]+)%/);
        if (wm) {
          const v = Math.round(parseFloat(wm[1]) / 20 * 10) / 10;
          if (v > 0 && v <= 5) { rating = v; break; }
        }
      }

      // 이미지
      const img = card.querySelector('img[src*="alicdn"], img[src*="ae0"], img');
      const imageUrl = img?.src || img?.getAttribute('data-src') || '';

      // 무료배송 여부
      const freeShip = /free\s*shipping|무료\s*배송/i.test(tx(card));

      items.push({
        productId: pid,
        title,
        price,
        currency,
        orders,
        rating,
        imageUrl,
        url: href.startsWith('http') ? href : 'https://www.aliexpress.com/item/' + pid + '.html',
        freeShip,
        query: q,
        position: items.length + 1,
        platform: 'aliexpress',
        _card: card,
      });
    }

    if (items.length > 0) {
      const pCnt = items.filter(i => i.price > 0).length;
      const oCnt = items.filter(i => i.orders > 0).length;
      const rCnt = items.filter(i => i.rating > 0).length;
      console.log(`%c[SH-Ali] v${VER} 파싱: ${items.length}개 | 가격${pCnt} 주문${oCnt} 평점${rCnt}`, 'color:#e74c3c;font-weight:bold;');
    }
    return items;
  }

  // ============================================================
  //  통계 계산
  // ============================================================
  function calcStats(items) {
    const prices = items.map(i => i.price).filter(p => p > 0);
    const orders = items.map(i => i.orders).filter(o => o > 0);
    const ratings = items.map(i => i.rating).filter(r => r > 0);
    const currency = items[0]?.currency || 'USD';

    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const avgPrice = avg(prices);
    const minPrice = prices.length ? Math.min(...prices) : 0;
    const maxPrice = prices.length ? Math.max(...prices) : 0;
    const avgOrders = avg(orders);
    const totalOrders = orders.reduce((a, b) => a + b, 0);
    const avgRating = ratings.length ? (avg(ratings)).toFixed(1) : '-';
    const freeShipCnt = items.filter(i => i.freeShip).length;

    // 경쟁도: 주문수 기반
    let compScore = 0;
    if (avgOrders > 5000) compScore += 35;
    else if (avgOrders > 1000) compScore += 25;
    else if (avgOrders > 300) compScore += 15;
    else if (avgOrders > 50) compScore += 8;
    const highOrderRatio = items.length ? items.filter(i => i.orders >= 1000).length / items.length : 0;
    if (highOrderRatio > 0.5) compScore += 25;
    else if (highOrderRatio > 0.3) compScore += 15;
    else if (highOrderRatio > 0.1) compScore += 8;
    if (Number(avgRating) >= 4.7) compScore += 15;
    else if (Number(avgRating) >= 4.5) compScore += 8;
    compScore = Math.min(100, compScore);

    const compLevel = compScore >= 65 ? 'hard' : compScore >= 35 ? 'mid' : 'easy';
    const compLabel = compScore >= 65 ? '경쟁 치열' : compScore >= 35 ? '보통' : '진입 용이';
    const compCls = compScore >= 65 ? 'sh-comp-hard' : compScore >= 35 ? 'sh-comp-mid' : 'sh-comp-easy';

    return {
      count: items.length, currency,
      avgPrice, minPrice, maxPrice,
      avgOrders, totalOrders,
      avgRating, freeShipCnt,
      compScore, compLevel, compLabel, compCls,
      highOrderRatio: Math.round(highOrderRatio * 100),
    };
  }

  // ============================================================
  //  히스토그램
  // ============================================================
  function makeHistogram(values, bucketCount) {
    if (!values.length) return [];
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) return [{ label: String(Math.round(min)), count: values.length }];
    const step = (max - min) / bucketCount;
    return Array.from({ length: bucketCount }, (_, i) => {
      const lo = min + step * i;
      const hi = min + step * (i + 1);
      const count = values.filter(v => i === bucketCount - 1 ? v >= lo && v <= hi : v >= lo && v < hi).length;
      return { lo, hi, count, label: lo >= 1000 ? Math.round(lo / 1000) + 'k' : Math.round(lo).toString() };
    });
  }

  function renderBars(buckets) {
    const maxC = Math.max(...buckets.map(b => b.count), 1);
    return buckets.map(b => {
      const h = Math.max(2, Math.round((b.count / maxC) * 36));
      const active = b.count === maxC ? ' sh-bar-active' : '';
      return `<div class="sh-bar${active}" style="height:${h}px !important;" title="${b.label}~: ${b.count}개"><span class="sh-bar-lbl">${b.label}</span></div>`;
    }).join('');
  }

  // ============================================================
  //  패널 생성
  // ============================================================
  let panel = null;
  let allItems = [];
  let savedSet = new Set();
  let isMin = false;

  function createPanel() {
    if (panel) panel.remove();
    panel = document.createElement('div');
    panel.id = 'sh-ali-panel';
    panel.innerHTML = `
      <div class="sh-ali-hd" id="sh-ali-drag">
        <span class="logo"><img src="${chrome.runtime.getURL('icon32.png')}" style="width:18px !important;height:18px !important;vertical-align:middle !important;border-radius:4px !important;" /></span>
        <div class="sh-hc">
          <span class="ver">Ali v${VER}</span>
          <span class="qr" id="sh-ali-q"></span>
          <span class="cnt" id="sh-ali-cnt">0개</span>
        </div>
        <div class="sh-hbtns">
          <button class="sh-hb" id="sh-ali-ref" title="새로고침">↻</button>
          <button class="sh-hb" id="sh-ali-min" title="접기">—</button>
        </div>
      </div>
      <div class="sh-body" id="sh-ali-body"></div>
      <div class="sh-foot">소싱 헬퍼 Ali · <a href="https://lumiriz.kr" target="_blank">lumiriz.kr</a></div>
    `;
    document.body.appendChild(panel);
    initDrag();

    document.getElementById('sh-ali-min').addEventListener('click', (e) => {
      e.stopPropagation();
      isMin = !isMin;
      panel.classList.toggle('sh-min', isMin);
    });
    panel.addEventListener('click', () => { if (isMin) { isMin = false; panel.classList.remove('sh-min'); } });
    document.getElementById('sh-ali-ref').addEventListener('click', (e) => { e.stopPropagation(); doScan(true); });
  }

  function initDrag() {
    const h = document.getElementById('sh-ali-drag');
    let drag = false, sx, sy, sr, st;
    h.addEventListener('mousedown', (e) => {
      if (e.target.closest('.sh-hb')) return;
      drag = true; panel.classList.add('sh-drag');
      const r = panel.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; sr = innerWidth - r.right; st = r.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!drag) return;
      panel.style.top = Math.max(0, Math.min(innerHeight - 50, st + e.clientY - sy)) + 'px';
      panel.style.right = Math.max(0, Math.min(innerWidth - 50, sr - (e.clientX - sx))) + 'px';
    });
    document.addEventListener('mouseup', () => { if (drag) { drag = false; panel.classList.remove('sh-drag'); } });
  }

  // ============================================================
  //  패널 렌더링
  // ============================================================
  function renderPanel(items) {
    if (!panel) createPanel();
    if (isMin) return;

    const q = getSearchQuery();
    document.getElementById('sh-ali-q').textContent = q ? `"${q}"` : '';
    document.getElementById('sh-ali-cnt').textContent = items.length + '개';

    const body = document.getElementById('sh-ali-body');
    if (!items.length) {
      body.innerHTML = '<div style="padding:40px 20px !important;text-align:center !important;color:#94a3b8 !important;"><div style="font-size:28px !important;">📦</div><div style="font-size:11px !important;margin-top:6px !important;">상품 파싱 중...</div></div>';
      return;
    }

    const s = calcStats(items);
    const prices = items.map(i => i.price).filter(p => p > 0);
    const ordersArr = items.map(i => i.orders).filter(o => o > 0);
    const priceBuckets = makeHistogram(prices, 6);
    const orderBuckets = makeHistogram(ordersArr, 5);

    // 정렬·필터 적용
    const sortSel = document.getElementById('sh-ali-sort');
    const limitSel = document.getElementById('sh-ali-limit');
    const sortVal = sortSel ? sortSel.value : 'orders-desc';
    const limitVal = limitSel ? parseInt(limitSel.value) : 0;

    let sorted = [...items];
    switch (sortVal) {
      case 'orders-desc': sorted.sort((a, b) => b.orders - a.orders); break;
      case 'price-asc': sorted.sort((a, b) => a.price - b.price); break;
      case 'price-desc': sorted.sort((a, b) => b.price - a.price); break;
      case 'rating-desc': sorted.sort((a, b) => b.rating - a.rating); break;
      case 'position': sorted.sort((a, b) => a.position - b.position); break;
    }
    const displayItems = limitVal > 0 ? sorted.slice(0, limitVal) : sorted;

    body.innerHTML = `
      <!-- 시장 개요 -->
      <div class="sh-sec">
        <div class="sh-sec-title">📊 AliExpress 시장 개요 (${s.count}개)</div>
        <div class="sh-stats">
          <div class="sh-st">
            <span class="sh-st-v accent">${s.count}</span>
            <span class="sh-st-l">상품수</span>
          </div>
          <div class="sh-st">
            <span class="sh-st-v red">${formatPrice(s.avgPrice, s.currency)}</span>
            <span class="sh-st-l">평균가 (${prices.length}개)</span>
          </div>
          <div class="sh-st">
            <span class="sh-st-v">${s.avgRating}</span>
            <span class="sh-st-l">평균평점</span>
          </div>
          <div class="sh-st">
            <span class="sh-st-v amber">${formatOrders(Math.round(s.avgOrders))}</span>
            <span class="sh-st-l">평균주문</span>
          </div>
          <div class="sh-st">
            <span class="sh-st-v green">${formatOrders(s.totalOrders)}</span>
            <span class="sh-st-l">총 주문</span>
          </div>
          <div class="sh-st">
            <span class="sh-st-v">${s.freeShipCnt}</span>
            <span class="sh-st-l">무료배송</span>
          </div>
        </div>

        <!-- 경쟁도 -->
        <div style="margin-top:10px !important;">
          <div style="display:flex !important;justify-content:space-between !important;align-items:center !important;">
            <span style="font-size:10px !important;font-weight:600 !important;color:#64748b !important;">경쟁 강도</span>
            <span style="font-size:10px !important;font-weight:700 !important;color:${s.compLevel === 'hard' ? '#dc2626' : s.compLevel === 'mid' ? '#d97706' : '#16a34a'} !important;">${s.compLabel} (${s.compScore}점)</span>
          </div>
          <div class="sh-comp-bar"><div class="sh-comp-fill ${s.compCls}" style="width:${s.compScore}% !important;"></div></div>
          <div style="font-size:8px !important;color:#94a3b8 !important;margin-top:4px !important;">
            1000+ 주문 상품: ${s.highOrderRatio}%
          </div>
        </div>
      </div>

      <!-- 가격 & 주문 분포 -->
      <div class="sh-sec" style="padding-top:8px !important;">
        <div class="sh-charts">
          <div class="sh-chart">
            <div class="sh-chart-title">💰 가격 분포</div>
            <div class="sh-bars" style="padding-bottom:14px !important;">${renderBars(priceBuckets)}</div>
            <div style="display:flex !important;justify-content:space-between !important;font-size:8px !important;color:#94a3b8 !important;margin-top:2px !important;">
              <span>${formatPrice(s.minPrice, s.currency)}</span>
              <span>${formatPrice(s.maxPrice, s.currency)}</span>
            </div>
          </div>
          <div class="sh-chart">
            <div class="sh-chart-title">📦 주문 분포</div>
            <div class="sh-bars" style="padding-bottom:14px !important;">${renderBars(orderBuckets)}</div>
            <div style="display:flex !important;justify-content:space-between !important;font-size:8px !important;color:#94a3b8 !important;margin-top:2px !important;">
              <span>적음</span>
              <span>많음</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 상품 목록 (전체) -->
      <div class="sh-sec">
        <div class="sh-sec-title">🛒 상품 목록 (${displayItems.length}/${s.count}개)</div>
        <div class="sh-filter-bar">
          <select id="sh-ali-sort">
            <option value="orders-desc" ${sortVal === 'orders-desc' ? 'selected' : ''}>주문수↓</option>
            <option value="price-asc" ${sortVal === 'price-asc' ? 'selected' : ''}>가격↑</option>
            <option value="price-desc" ${sortVal === 'price-desc' ? 'selected' : ''}>가격↓</option>
            <option value="rating-desc" ${sortVal === 'rating-desc' ? 'selected' : ''}>평점↓</option>
            <option value="position" ${sortVal === 'position' ? 'selected' : ''}>노출순</option>
          </select>
          <span class="sh-fl">상위</span>
          <select id="sh-ali-limit">
            <option value="0" ${limitVal === 0 ? 'selected' : ''}>전체</option>
            <option value="5" ${limitVal === 5 ? 'selected' : ''}>5개</option>
            <option value="10" ${limitVal === 10 ? 'selected' : ''}>10개</option>
            <option value="20" ${limitVal === 20 ? 'selected' : ''}>20개</option>
          </select>
        </div>
        ${displayItems.map((item, idx) => {
          const rcls = idx < 1 ? 'sh-r1' : idx < 2 ? 'sh-r2' : 'sh-r3';
          const isSaved = savedSet.has(item.productId);
          return `
            <div class="sh-top" data-pid="${item.productId}">
              <div class="sh-top-rank ${rcls}">${idx + 1}</div>
              ${item.imageUrl ? `<img class="sh-top-img" src="${item.imageUrl}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
              <div class="sh-top-info">
                <div class="sh-top-name">${esc(item.title)}</div>
                <div class="sh-top-meta">
                  ${item.price ? `<span class="sh-top-price">${formatPrice(item.price, item.currency)}</span>` : ''}
                  ${item.orders > 0 ? `<span class="sh-top-rev">📦${formatOrders(item.orders)}</span>` : ''}
                  ${item.rating > 0 ? `<span class="sh-top-rev">★${item.rating}</span>` : ''}
                  ${item.freeShip ? '<span class="sh-top-rev" style="color:#16a34a !important;">🚚무료</span>' : ''}
                </div>
                <div class="sh-top-btns">
                  <button class="sh-tb sh-tb-coupang" data-pid="${item.productId}" data-act="coupang">쿠팡검색</button>
                  <button class="sh-tb sh-tb-1688" data-pid="${item.productId}" data-act="1688">1688</button>
                  <button class="sh-tb ${isSaved ? 'sh-tb-saved' : 'sh-tb-save'}" data-pid="${item.productId}" data-act="save">${isSaved ? '✓' : '후보등록'}</button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    // 정렬·필터 변경 시 재렌더링
    const sortEl = document.getElementById('sh-ali-sort');
    const limitEl = document.getElementById('sh-ali-limit');
    if (sortEl) sortEl.addEventListener('change', () => renderPanel(allItems));
    if (limitEl) limitEl.addEventListener('change', () => renderPanel(allItems));
  }

  // ============================================================
  //  이벤트 핸들러
  // ============================================================
  document.addEventListener('click', (e) => {
    // 쿠팡에서 찾기
    const bCoupang = e.target.closest('[data-act="coupang"]');
    if (bCoupang) {
      e.preventDefault(); e.stopPropagation();
      const item = allItems.find(i => i.productId === bCoupang.dataset.pid);
      if (!item) return;
      // 제목에서 핵심 키워드 2-3개 추출하여 쿠팡 검색
      const kw = extractCoupangKeyword(item.title);
      window.open('https://www.coupang.com/np/search?q=' + encodeURIComponent(kw), '_blank');
      return;
    }

    // 1688에서 찾기
    const b1688 = e.target.closest('[data-act="1688"]');
    if (b1688) {
      e.preventDefault(); e.stopPropagation();
      const item = allItems.find(i => i.productId === b1688.dataset.pid);
      if (!item) return;
      // 제목 그대로 1688에 전달
      const keyword = item.title.substring(0, 50);
      window.open(`https://s.1688.com/selloffer/offer_search.htm?keywords=${keyword.replace(/\s+/g, '+')}&charset=utf8`, '_blank');
      return;
    }

    // 소싱 후보 등록
    const bSave = e.target.closest('[data-act="save"]');
    if (bSave) {
      e.preventDefault(); e.stopPropagation();
      const item = allItems.find(i => i.productId === bSave.dataset.pid);
      if (!item) return;
      const { _card, ...clean } = item;
      // background.js의 기존 SAVE_CANDIDATE 메시지 재활용
      chrome.runtime.sendMessage({
        type: 'SAVE_CANDIDATE',
        product: {
          ...clean,
          title: clean.title,
          price: clean.currency === 'KRW' ? clean.price : Math.round(clean.price * 1350), // USD→KRW 대략 환산
          reviewCount: clean.orders, // orders를 reviewCount 필드에 매핑
          rating: clean.rating,
          imageUrl: clean.imageUrl,
          url: clean.url,
          productId: 'ali-' + clean.productId,
          query: clean.query,
          sourcePlatform: 'aliexpress',
        },
        score: 50,
        grade: 'B',
      }).catch(() => {});
      savedSet.add(item.productId);
      bSave.textContent = '✓';
      bSave.className = 'sh-tb sh-tb-saved';
      return;
    }

    // TOP 상품 클릭 → 알리 상품 페이지 열기
    const top = e.target.closest('.sh-top');
    if (top && !e.target.closest('.sh-tb')) {
      e.preventDefault(); e.stopPropagation();
      const item = allItems.find(i => i.productId === top.dataset.pid);
      if (!item) return;
      window.open(item.url, '_blank');
      return;
    }
  }, true);

  // ============================================================
  //  알리 제목 → 쿠팡 검색 키워드 변환
  // ============================================================
  const EN_TO_KO = {
    // 전자기기
    'charger': '충전기', 'wireless charger': '무선충전기', 'cable': '케이블',
    'usb cable': 'USB 케이블', 'earphone': '이어폰', 'earphones': '이어폰',
    'headphone': '헤드폰', 'headphones': '헤드폰', 'bluetooth': '블루투스',
    'speaker': '스피커', 'bluetooth speaker': '블루투스 스피커',
    'mouse': '마우스', 'wireless mouse': '무선마우스', 'keyboard': '키보드',
    'power bank': '보조배터리', 'phone case': '폰케이스', 'phone stand': '거치대',
    'phone holder': '거치대', 'tablet': '태블릿', 'tablet stand': '태블릿 거치대',
    'adapter': '어댑터', 'hub': '허브', 'usb hub': 'USB 허브',
    'webcam': '웹캠', 'microphone': '마이크', 'ring light': '링라이트',
    'smartwatch': '스마트워치', 'smart watch': '스마트워치', 'earbuds': '이어버드',
    'screen protector': '화면보호필름', 'stylus': '스타일러스펜',
    'router': '라우터', 'projector': '프로젝터', 'mini projector': '미니프로젝터',
    'drone': '드론', 'camera': '카메라', 'tripod': '삼각대',
    'gimbal': '짐벌', 'action camera': '액션카메라',
    'dashcam': '블랙박스', 'dash cam': '블랙박스',

    // 가방/패션잡화
    'backpack': '백팩', 'wallet': '지갑', 'bag': '가방',
    'tote bag': '토트백', 'shoulder bag': '숄더백', 'crossbody bag': '크로스백',
    'waist bag': '힙색', 'fanny pack': '힙색', 'laptop bag': '노트북가방',
    'travel bag': '여행가방', 'suitcase': '캐리어', 'luggage': '캐리어',
    'pouch': '파우치', 'makeup bag': '화장품파우치',

    // 액세서리/주얼리
    'necklace': '목걸이', 'ring': '반지', 'bracelet': '팔찌',
    'earring': '귀걸이', 'earrings': '귀걸이', 'sunglasses': '선글라스',
    'watch': '시계', 'scarf': '스카프', 'belt': '벨트', 'gloves': '장갑',
    'hat': '모자', 'cap': '모자', 'beanie': '비니', 'bucket hat': '버킷햇',

    // 의류
    't-shirt': '티셔츠', 'tshirt': '티셔츠', 'shirt': '셔츠',
    'jacket': '자켓', 'coat': '코트', 'hoodie': '후드',
    'sweater': '스웨터', 'cardigan': '가디건',
    'pants': '바지', 'jeans': '청바지', 'shorts': '반바지',
    'dress': '원피스', 'skirt': '치마', 'leggings': '레깅스',
    'sneakers': '운동화', 'shoes': '신발', 'boots': '부츠',
    'slippers': '슬리퍼', 'sandals': '샌들',
    'mask': '마스크', 'sock': '양말', 'socks': '양말',
    'underwear': '속옷', 'swimsuit': '수영복', 'vest': '조끼',
    'raincoat': '비옷', 'rain coat': '비옷',

    // 주방용품
    'kitchen': '주방', 'cooking': '요리', 'pot': '냄비', 'pan': '프라이팬',
    'frying pan': '프라이팬', 'wok': '웍',
    'knife': '칼', 'kitchen knife': '주방칼', 'scissors': '가위',
    'cup': '컵', 'mug': '머그컵', 'tumbler': '텀블러', 'water bottle': '물병',
    'spoon': '숟가락', 'fork': '포크', 'chopsticks': '젓가락',
    'plate': '접시', 'bowl': '그릇', 'cutting board': '도마',
    'peeler': '필러', 'whisk': '거품기', 'spatula': '뒤집개',
    'ladle': '국자', 'strainer': '거름망', 'grater': '강판',
    'blender': '블렌더', 'mixer': '믹서',
    'food container': '밀폐용기', 'lunchbox': '도시락', 'lunch box': '도시락',
    'thermos': '보온병', 'ice maker': '제빙기',
    'air fryer': '에어프라이어', 'kettle': '전기포트',

    // 수납/정리
    'storage': '수납', 'organizer': '정리함', 'shelf': '선반',
    'rack': '거치대', 'hook': '후크', 'hanger': '행거',
    'basket': '바구니', 'tray': '트레이', 'drawer': '서랍',
    'storage box': '수납함',

    // 청소/생활
    'cleaning': '청소', 'vacuum cleaner': '청소기', 'vacuum': '청소기',
    'mop': '걸레', 'spin mop': '회전걸레', 'brush': '솔', 'sponge': '스펀지',
    'broom': '빗자루', 'trash can': '쓰레기통', 'lint roller': '먼지제거기',
    'towel': '수건', 'mirror': '거울', 'scale': '저울',

    // 조명/인테리어
    'lamp': '램프', 'desk lamp': '책상램프', 'light': '조명',
    'night light': '수면등', 'led': 'LED', 'led strip': 'LED스트립',
    'fairy light': '전구', 'candle': '캔들',
    'clock': '시계', 'wall clock': '벽시계', 'alarm clock': '알람시계',
    'vase': '꽃병', 'picture frame': '액자',
    'curtain': '커튼', 'rug': '러그', 'carpet': '카펫',
    'cushion': '쿠션', 'pillow': '베개', 'blanket': '이불',
    'bed sheet': '침대시트',

    // 문구
    'pen': '펜', 'pencil': '연필', 'notebook': '노트', 'diary': '다이어리',
    'tape': '테이프', 'sticker': '스티커',
    'toy': '장난감', 'puzzle': '퍼즐', 'building blocks': '블록',

    // 운동/아웃도어
    'yoga mat': '요가매트', 'dumbbell': '아령',
    'resistance band': '저항밴드', 'jump rope': '줄넘기',
    'tent': '텐트', 'camping': '캠핑', 'sleeping bag': '침낭',
    'fishing': '낚시', 'fishing rod': '낚싯대',
    'helmet': '헬멧', 'knee pad': '무릎보호대', 'goggles': '고글',

    // 반려동물
    'pet': '반려동물', 'dog': '강아지', 'cat': '고양이',
    'pet bed': '반려동물침대', 'pet toy': '반려동물장난감',
    'leash': '리드줄', 'collar': '목줄', 'pet carrier': '이동장',

    // 차량용
    'car': '차량용', 'car vacuum': '차량용청소기', 'car charger': '차량용충전기',
    'car mount': '차량용거치대', 'car seat': '카시트', 'car mat': '차량용매트',
    'sun shade': '햇빛가리개',

    // 미용/뷰티
    'makeup': '메이크업', 'makeup brush': '화장솔', 'nail art': '네일아트',
    'hair clip': '헤어클립', 'hair band': '헤어밴드',
    'hair dryer': '헤어드라이기', 'curling iron': '고데기',
    'comb': '빗', 'face mask': '페이스마스크',
    'diffuser': '디퓨저',

    // 가전/생활가전
    'fan': '선풍기', 'mini fan': '미니선풍기', 'neck fan': '넥팬',
    'humidifier': '가습기', 'dehumidifier': '제습기',
    'air purifier': '공기청정기', 'heater': '히터',

    // 속성 키워드
    'wireless': '무선', 'portable': '휴대용', 'foldable': '접이식',
    'waterproof': '방수', 'rechargeable': '충전식', 'adjustable': '조절',
    'magnetic': '자석', 'automatic': '자동', 'electric': '전동',
    'stainless': '스테인리스', 'silicone': '실리콘', 'bamboo': '대나무',
    'wooden': '원목', 'leather': '가죽', 'transparent': '투명',
    'thermal': '보온', 'insulated': '단열', 'large capacity': '대용량',
    'multifunctional': '다기능', 'retractable': '접이식',
    'detachable': '분리형', 'ergonomic': '인체공학', 'handheld': '핸디',
    'desktop': '탁상용', 'outdoor': '아웃도어', 'indoor': '실내',
  };

  // 속성 키워드 세트 — 속성보다 명사를 우선 배치하기 위함
  const ATTR_KO = new Set(['무선', '휴대용', '미니', '접이식', '방수', '충전식', '자동', '전동',
    '대용량', '다기능', '핸디', '자석', '조절', '탁상용', '보온', '단열',
    '스테인리스', '실리콘', '대나무', '원목', '가죽', '투명', '분리형',
    '인체공학', '아웃도어', '실내']);

  function extractCoupangKeyword(aliTitle) {
    if (!aliTitle) return '';
    // 영어 제목에서 핵심 단어 추출
    let cleaned = aliTitle.toLowerCase()
      .replace(/[^a-z0-9가-힣\s-]/g, ' ')
      .replace(/\d+\s*(pcs|packs?|sets?|pieces?|lot|pairs?|sheets?)\b/gi, '')
      .replace(/\d+(ml|g|kg|cm|mm|oz|l|inch|in)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    const words = cleaned.split(/\s+/).filter(w => w.length > 1);
    // 매핑된 한국어로 변환 시도
    const koNouns = []; // 명사 (청소기, 가방 등)
    const koAttrs = []; // 속성 (무선, 미니 등)
    const usedEn = new Set();

    // 3단어 조합 먼저 시도
    for (let i = 0; i < words.length - 2; i++) {
      const threeWord = words[i] + ' ' + words[i + 1] + ' ' + words[i + 2];
      if (EN_TO_KO[threeWord]) {
        const ko = EN_TO_KO[threeWord];
        (ATTR_KO.has(ko) ? koAttrs : koNouns).push(ko);
        usedEn.add(i); usedEn.add(i + 1); usedEn.add(i + 2);
      }
    }

    // 2단어 조합 시도
    for (let i = 0; i < words.length - 1; i++) {
      if (usedEn.has(i) || usedEn.has(i + 1)) continue;
      const twoWord = words[i] + ' ' + words[i + 1];
      if (EN_TO_KO[twoWord]) {
        const ko = EN_TO_KO[twoWord];
        (ATTR_KO.has(ko) ? koAttrs : koNouns).push(ko);
        usedEn.add(i); usedEn.add(i + 1);
      }
    }

    // 1단어 시도
    for (let i = 0; i < words.length; i++) {
      if (usedEn.has(i)) continue;
      if (EN_TO_KO[words[i]]) {
        const ko = EN_TO_KO[words[i]];
        (ATTR_KO.has(ko) ? koAttrs : koNouns).push(ko);
        usedEn.add(i);
      }
    }

    // 중복 제거
    const uniqueNouns = [...new Set(koNouns)];
    const uniqueAttrs = [...new Set(koAttrs)];

    // 명사 우선, 속성 뒤에 배치 (최대 4단어)
    // 예: "차량용 무선 청소기" (속성1 + 속성2 + 명사)
    if (uniqueNouns.length >= 1) {
      const combined = [...uniqueAttrs.slice(0, 2), ...uniqueNouns.slice(0, 2)];
      return combined.slice(0, 4).join(' ');
    }

    if (uniqueAttrs.length >= 1) {
      return uniqueAttrs.slice(0, 3).join(' ');
    }

    // 매핑 안 되면 영어 핵심어 3개 반환 (쿠팡도 영어 검색 지원)
    const stopWords = new Set(['the', 'a', 'an', 'for', 'and', 'or', 'with', 'in', 'on', 'to',
      'of', 'new', 'hot', 'sale', 'free', 'shipping', 'pcs', 'set', 'piece', 'pieces',
      'lot', 'pack', 'packs', 'high', 'quality', 'style', 'fashion', 'cute', 'popular',
      'wholesale', 'item', 'items', 'latest', 'brand', 'original', 'genuine', 'authentic',
      '2024', '2025', '2026']);
    const filtered = words.filter(w => !stopWords.has(w) && w.length > 2);
    return filtered.slice(0, 3).join(' ');
  }

  // ============================================================
  //  스캔 — v6.3: 조건 충족형 1회 파싱
  //  타이머 중심 → 상품 컨테이너 존재 확인 후 1회만 파싱
  //  MutationObserver/setInterval/visibilitychange 없음
  // ============================================================
  let lastSig = '';
  let scanned = false; // 현재 URL에서 파싱 완료 여부

  function doScan(force = false) {
    const items = parseAliProducts();
    if (!items.length) {
      if (panel) renderPanel([]);
      return false;
    }

    const sig = items.map(i => i.productId).slice(0, 5).join(',');
    const isNew = sig !== lastSig || force;

    if (isNew) {
      lastSig = sig;
      allItems = items;
      scanned = true;
      console.log(`%c[SH-Ali] ✅ ${items.length}개 파싱 완료`, 'color:#16a34a;font-weight:bold;');
    }

    if (!panel) createPanel();
    panel.style.display = '';

    if (isNew) {
      renderPanel(items);
    }
    return items.length > 0;
  }

  // ============================================================
  //  상품 컨테이너 존재 감지 — 조건 충족 시 1회만 파싱
  //  querySelectorAll 대신 가벼운 querySelector 1개로 확인
  // ============================================================
  const CONTAINER_SELECTORS = [
    '[class*="SearchProductFeed"]',
    '.search--gallery--list',
    '[class*="search-item-card"]',
    'div[data-pl="true"]',
    'a[href*="/item/"]',
  ];

  function hasProductContainer() {
    for (const sel of CONTAINER_SELECTORS) {
      if (document.querySelector(sel)) return true;
    }
    return false;
  }

  // 컨테이너 대기 → 발견 시 1회 파싱 (최대 15초, 체크 간격 2초)
  function waitForContainerAndScan() {
    scanned = false;
    let attempts = 0;
    const maxAttempts = 8; // 2초 × 8 = 최대 16초 대기

    function check() {
      attempts++;
      if (scanned) return; // 이미 파싱 완료

      if (hasProductContainer()) {
        // 컨테이너 발견 → 렌더링 안정화 대기 후 1회 파싱
        console.log(`%c[SH-Ali] 📦 상품 컨테이너 감지 (${attempts}번째 체크)`, 'color:#e74c3c;');
        setTimeout(() => {
          if (!scanned) doScan(true);
        }, 800);
        return;
      }

      if (attempts < maxAttempts) {
        setTimeout(check, 2000);
      } else {
        console.log(`%c[SH-Ali] ⏰ 상품 컨테이너 미감지 (${maxAttempts}회 초과) — ↻ 버튼으로 수동 스캔`, 'color:#94a3b8;');
        if (!panel) { createPanel(); panel.style.display = ''; }
        renderPanel([]);
      }
    }

    check();
  }

  // URL 변경 감지 (SPA) — 5초 간격으로 체크, 변경 시 컨테이너 대기 재시작
  let lastUrl = location.href;
  function urlCheck() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastSig = '';
      allItems = [];
      waitForContainerAndScan();
    }
  }
  setInterval(urlCheck, 5000);

  // ★ 초기 실행: 페이지 로드 완료 후 컨테이너 대기 시작
  if (document.readyState === 'complete') {
    waitForContainerAndScan();
  } else {
    window.addEventListener('load', () => waitForContainerAndScan(), { once: true });
  }
})();
