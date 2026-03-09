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
  const VER = '6.0.0';

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
        <span class="logo">🐢</span>
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
      <div class="sh-foot">🐢 소싱 헬퍼 Ali · <a href="https://lumiriz.kr" target="_blank">lumiriz.kr</a></div>
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

    // TOP5 by orders
    const top5 = [...items].sort((a, b) => b.orders - a.orders).slice(0, 5);

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

      <!-- TOP 5 주문 상품 -->
      <div class="sh-sec">
        <div class="sh-sec-title">🏆 TOP 5 인기상품 (주문수 기준)</div>
        ${top5.map((item, idx) => {
          const rcls = ['sh-r1', 'sh-r2', 'sh-r3', 'sh-r3', 'sh-r3'][idx];
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
    'tumbler': '텀블러', 'water bottle': '물병', 'towel': '수건',
    'charger': '충전기', 'cable': '케이블', 'earphone': '이어폰',
    'bluetooth': '블루투스', 'speaker': '스피커', 'mouse': '마우스',
    'keyboard': '키보드', 'power bank': '보조배터리', 'phone case': '케이스',
    'phone stand': '거치대', 'backpack': '백팩', 'wallet': '지갑',
    'necklace': '목걸이', 'ring': '반지', 'bracelet': '팔찌',
    'earring': '귀걸이', 'sunglasses': '선글라스', 'watch': '시계',
    'bag': '가방', 'sock': '양말', 'socks': '양말', 'hat': '모자', 'cap': '모자',
    'lamp': '램프', 'light': '조명', 'led': 'LED', 'cushion': '쿠션',
    'pillow': '베개', 'blanket': '이불', 'curtain': '커튼', 'rug': '러그',
    'toy': '장난감', 'puzzle': '퍼즐', 'sticker': '스티커',
    'pen': '펜', 'notebook': '노트', 'tape': '테이프',
    'yoga mat': '요가매트', 'dumbbell': '아령', 'tent': '텐트',
    'camping': '캠핑', 'fishing': '낚시',
    'kitchen': '주방', 'cooking': '요리', 'pot': '냄비', 'pan': '프라이팬',
    'knife': '칼', 'scissors': '가위', 'cup': '컵', 'mug': '머그컵',
    'spoon': '숟가락', 'fork': '포크', 'plate': '접시', 'bowl': '그릇',
    'storage': '수납', 'organizer': '정리함', 'shelf': '선반',
    'cleaning': '청소', 'mop': '걸레', 'brush': '솔', 'sponge': '스펀지',
    'hook': '후크', 'hanger': '행거', 'mirror': '거울',
    'drone': '드론', 'camera': '카메라', 'tripod': '삼각대',
    't-shirt': '티셔츠', 'shirt': '셔츠', 'jacket': '자켓', 'coat': '코트',
    'pants': '바지', 'jeans': '청바지', 'dress': '원피스',
    'sneakers': '운동화', 'shoes': '신발', 'slippers': '슬리퍼', 'sandals': '샌들',
    'mask': '마스크', 'gloves': '장갑', 'belt': '벨트', 'scarf': '스카프',
    'pet': '반려동물', 'dog': '강아지', 'cat': '고양이',
  };

  function extractCoupangKeyword(aliTitle) {
    if (!aliTitle) return '';
    // 영어 제목에서 핵심 단어 추출
    let cleaned = aliTitle.toLowerCase()
      .replace(/[^a-z0-9가-힣\s]/g, ' ')
      .replace(/\d+\s*(pcs|packs?|sets?|pieces?|lot|pairs?|sheets?)\b/gi, '')
      .replace(/\d+(ml|g|kg|cm|mm|oz|l|inch)\b/gi, '')
      .trim();

    const words = cleaned.split(/\s+/).filter(w => w.length > 1);
    // 매핑된 한국어로 변환 시도
    const koWords = [];
    const usedEn = new Set();
    // 2단어 조합 먼저 시도
    for (let i = 0; i < words.length - 1; i++) {
      const twoWord = words[i] + ' ' + words[i + 1];
      if (EN_TO_KO[twoWord]) {
        koWords.push(EN_TO_KO[twoWord]);
        usedEn.add(i); usedEn.add(i + 1);
      }
    }
    // 1단어 시도
    for (let i = 0; i < words.length; i++) {
      if (usedEn.has(i)) continue;
      if (EN_TO_KO[words[i]]) {
        koWords.push(EN_TO_KO[words[i]]);
        usedEn.add(i);
      }
    }

    if (koWords.length >= 1) {
      return koWords.slice(0, 3).join(' ');
    }

    // 매핑 안 되면 영어 핵심어 3개 반환 (쿠팡도 영어 검색 지원)
    const stopWords = new Set(['the', 'a', 'an', 'for', 'and', 'or', 'with', 'in', 'on', 'to', 'of', 'new', 'hot', 'sale', 'free', 'shipping', 'pcs', 'set', 'piece', 'lot', 'pack', 'high', 'quality', 'mini', 'portable', 'style', 'fashion', 'cute', 'popular', 'wholesale']);
    const filtered = words.filter(w => !stopWords.has(w) && w.length > 2);
    return filtered.slice(0, 3).join(' ');
  }

  // ============================================================
  //  스캔
  // ============================================================
  let lastSig = '';
  let timer = null;

  function doScan(force = false) {
    const items = parseAliProducts();
    if (!items.length) {
      if (panel) renderPanel([]);
      return;
    }

    const sig = items.map(i => i.productId).slice(0, 5).join(',');
    const isNew = sig !== lastSig || force;

    if (isNew) {
      lastSig = sig;
      allItems = items;
      console.log(`%c[SH-Ali] ✅ ${items.length}개 파싱 완료`, 'color:#16a34a;font-weight:bold;');
    }

    if (!panel) createPanel();
    panel.style.display = '';

    if (isNew) {
      renderPanel(items);
    }
  }

  // URL 변경 감지 (SPA)
  let lastUrl = location.href;
  function urlCheck() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastSig = '';
      allItems = [];
      setTimeout(() => doScan(true), 500);
      setTimeout(() => doScan(true), 1500);
      setTimeout(() => doScan(true), 3000);
    }
  }

  window.addEventListener('popstate', () => setTimeout(urlCheck, 100));
  setInterval(urlCheck, 800);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(() => doScan(true), 300); });

  const obs = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(() => doScan(), 800); });
  obs.observe(document.body || document.documentElement, { childList: true, subtree: true });

  // 초기 실행
  doScan();
  setTimeout(doScan, 800);
  setTimeout(doScan, 2000);
  setTimeout(doScan, 4000);
})();
