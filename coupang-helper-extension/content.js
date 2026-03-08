/* ============================================================
   Coupang Sourcing Helper — Content Script v5.5.0
   "마켓 대시보드 패널" — 시장 분석 + TOP3 + 미니 차트

   원칙:
   1) 검색 시 자동 플로팅 패널 (오른쪽)
   2) 시장 개요: 상품수·평균가·리뷰·경쟁도·그래프
   3) TOP 3 상품만 간결 표시
   4) 쿠팡 DOM 최소 건드림
   ============================================================ */
(function () {
  'use strict';
  const VER = '5.5.0';

  if (window.__SH_LOADED__) return;
  window.__SH_LOADED__ = true;

  // 이전 버전 잔재 제거
  document.querySelectorAll(
    '#sh-float-bar,#sh-topbar,#sh-card-styles,#sh-styles-v531,' +
    '.sh-card-overlay,.sh-databar,.sh-mini-badge,.sh-card-box,' +
    '.sh-modal-backdrop,.sh-modal-panel,.sh-hover-highlight,' +
    '[data-sh-badge],[data-sh-overlay],[data-sh-card],[data-sh],' +
    '#sh-overlay-styles,#sh-modal-styles,#sh-debug-panel,#sh-version-badge,' +
    '.sh-tag,#sh-panel,#sh-panel-css'
  ).forEach(el => el.remove());

  console.log(`%c[SH] v${VER} 마켓 대시보드 로드`, 'color:#16a34a;font-weight:bold;font-size:13px;');

  // ============================================================
  //  CSS
  // ============================================================
  const css = document.createElement('style');
  css.id = 'sh-panel-css';
  css.textContent = `
    #sh-panel {
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
    #sh-panel.sh-min {
      width: 44px !important; max-height: 44px !important;
      border-radius: 22px !important; cursor: pointer !important;
    }
    #sh-panel.sh-min .sh-hc, #sh-panel.sh-min .sh-body { display: none !important; }
    #sh-panel.sh-drag { opacity: 0.8 !important; cursor: grabbing !important; }

    /* 헤더 */
    .sh-hd {
      background: linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%) !important;
      color: #fff !important;
      padding: 10px 14px !important;
      display: flex !important; align-items: center !important; justify-content: space-between !important;
      cursor: grab !important; flex-shrink: 0 !important;
      border-radius: 14px 14px 0 0 !important;
    }
    #sh-panel.sh-min .sh-hd { border-radius: 22px !important; padding: 10px !important; justify-content: center !important; }
    .sh-hd .logo { font-size: 15px !important; font-weight: 800 !important; }
    .sh-hc { display: flex !important; align-items: center !important; gap: 6px !important; flex:1 !important; }
    .sh-hc .ver { font-size: 8px !important; opacity: .6 !important; background: rgba(255,255,255,.12) !important; padding: 1px 5px !important; border-radius: 3px !important; }
    .sh-hc .qr { font-size: 11px !important; background: rgba(255,255,255,.18) !important; padding: 2px 8px !important; border-radius: 5px !important; max-width: 120px !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; font-weight: 600 !important; }
    .sh-hc .cnt { font-size: 10px !important; background: rgba(255,255,255,.22) !important; padding: 2px 6px !important; border-radius: 5px !important; font-weight: 700 !important; }
    .sh-hbtns { display: flex !important; gap: 3px !important; }
    .sh-hb { width: 22px !important; height: 22px !important; display: flex !important; align-items: center !important; justify-content: center !important; border: none !important; background: rgba(255,255,255,.12) !important; color: #fff !important; border-radius: 5px !important; cursor: pointer !important; font-size: 12px !important; padding: 0 !important; }
    .sh-hb:hover { background: rgba(255,255,255,.28) !important; }

    /* 바디 */
    .sh-body { overflow-y: auto !important; flex: 1 !important; }
    .sh-body::-webkit-scrollbar { width: 3px !important; }
    .sh-body::-webkit-scrollbar-thumb { background: #cbd5e1 !important; border-radius: 3px !important; }

    /* 섹션 */
    .sh-sec { padding: 12px 14px !important; border-bottom: 1px solid #f1f5f9 !important; }
    .sh-sec-title { font-size: 10px !important; font-weight: 700 !important; color: #94a3b8 !important; text-transform: uppercase !important; letter-spacing: .5px !important; margin-bottom: 8px !important; }

    /* 시장 통계 그리드 */
    .sh-stats { display: grid !important; grid-template-columns: 1fr 1fr 1fr !important; gap: 8px !important; }
    .sh-st {
      background: #f8fafc !important; border-radius: 8px !important; padding: 8px 10px !important;
      display: flex !important; flex-direction: column !important; align-items: center !important;
      border: 1px solid #f1f5f9 !important;
    }
    .sh-st-v { font-size: 15px !important; font-weight: 800 !important; color: #1e293b !important; line-height: 1.2 !important; }
    .sh-st-v.accent { color: #6366f1 !important; }
    .sh-st-v.red { color: #dc2626 !important; }
    .sh-st-v.green { color: #16a34a !important; }
    .sh-st-v.amber { color: #d97706 !important; }
    .sh-st-l { font-size: 9px !important; color: #94a3b8 !important; margin-top: 2px !important; }

    /* 경쟁도 바 */
    .sh-comp-bar { height: 6px !important; border-radius: 3px !important; background: #f1f5f9 !important; margin-top: 6px !important; overflow: hidden !important; }
    .sh-comp-fill { height: 100% !important; border-radius: 3px !important; transition: width .3s !important; }
    .sh-comp-lbl { display: flex !important; justify-content: space-between !important; margin-top: 3px !important; font-size: 9px !important; color: #94a3b8 !important; }
    .sh-comp-easy { background: #16a34a !important; }
    .sh-comp-mid { background: #f59e0b !important; }
    .sh-comp-hard { background: #dc2626 !important; }

    /* 미니 차트 (가격 분포, 리뷰 분포) */
    .sh-charts { display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 8px !important; margin-top: 10px !important; }
    .sh-chart {
      background: #f8fafc !important; border-radius: 8px !important; padding: 8px !important;
      border: 1px solid #f1f5f9 !important;
    }
    .sh-chart-title { font-size: 9px !important; font-weight: 600 !important; color: #94a3b8 !important; margin-bottom: 6px !important; }
    .sh-bars { display: flex !important; align-items: flex-end !important; gap: 2px !important; height: 40px !important; }
    .sh-bar {
      flex: 1 !important; background: #c7d2fe !important; border-radius: 2px 2px 0 0 !important;
      min-height: 2px !important; transition: height .3s !important; position: relative !important;
    }
    .sh-bar:hover { background: #6366f1 !important; }
    .sh-bar-lbl { position: absolute !important; bottom: -13px !important; left: 50% !important; transform: translateX(-50%) !important; font-size: 7px !important; color: #94a3b8 !important; white-space: nowrap !important; }
    .sh-bar-active { background: #6366f1 !important; }

    /* TOP3 상품 */
    .sh-top {
      display: flex !important; gap: 8px !important; padding: 8px 0 !important;
      border-bottom: 1px solid #f1f5f9 !important; align-items: flex-start !important;
      cursor: pointer !important; transition: background .15s !important;
    }
    .sh-top:last-child { border-bottom: none !important; }
    .sh-top:hover { background: #f8fafc !important; border-radius: 6px !important; }
    .sh-top-rank {
      width: 20px !important; height: 20px !important; border-radius: 5px !important;
      display: flex !important; align-items: center !important; justify-content: center !important;
      font-size: 10px !important; font-weight: 800 !important; flex-shrink: 0 !important;
    }
    .sh-r1 { background: #fef3c7 !important; color: #92400e !important; }
    .sh-r2 { background: #e0e7ff !important; color: #3730a3 !important; }
    .sh-r3 { background: #f1f5f9 !important; color: #64748b !important; }
    .sh-top-img {
      width: 40px !important; height: 40px !important; border-radius: 6px !important;
      object-fit: cover !important; flex-shrink: 0 !important; background: #f1f5f9 !important;
    }
    .sh-top-info { flex: 1 !important; min-width: 0 !important; }
    .sh-top-name {
      font-size: 11px !important; font-weight: 600 !important; color: #1e293b !important;
      white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important;
      margin-bottom: 3px !important; line-height: 1.3 !important;
    }
    .sh-top-meta {
      display: flex !important; align-items: center !important; gap: 5px !important; flex-wrap: wrap !important;
    }
    .sh-top-price { font-size: 11px !important; font-weight: 700 !important; color: #dc2626 !important; }
    .sh-top-rev { font-size: 9px !important; color: #64748b !important; }
    .sh-top-grade {
      font-size: 9px !important; font-weight: 800 !important; padding: 1px 5px !important;
      border-radius: 3px !important; color: #fff !important;
    }
    .sh-gs { background: #16a34a !important; }
    .sh-ga { background: #3b82f6 !important; }
    .sh-gb { background: #f59e0b !important; }
    .sh-gc { background: #9ca3af !important; }
    .sh-gd { background: #dc2626 !important; }

    .sh-top-btns { display: flex !important; gap: 3px !important; margin-top: 4px !important; }
    .sh-tb {
      height: 20px !important; padding: 0 7px !important; border: none !important;
      border-radius: 4px !important; font-size: 9px !important; font-weight: 700 !important;
      cursor: pointer !important; color: #fff !important; display: inline-flex !important;
      align-items: center !important;
    }
    .sh-tb:hover { opacity: .85 !important; }
    .sh-tb-1688 { background: #ea580c !important; }
    .sh-tb-ali { background: #dc2626 !important; }
    .sh-tb-save { background: #6366f1 !important; }
    .sh-tb-saved { background: #16a34a !important; }

    /* 하이라이트 */
    .sh-hl { outline: 3px solid #6366f1 !important; outline-offset: -2px !important; transition: outline .15s !important; }

    /* 풋터 */
    .sh-foot {
      padding: 6px 14px !important; background: #f8fafc !important; border-top: 1px solid #f1f5f9 !important;
      font-size: 9px !important; color: #94a3b8 !important; text-align: center !important; flex-shrink: 0 !important;
    }
    .sh-foot a { color: #6366f1 !important; text-decoration: none !important; font-weight: 600 !important; }

    @media (max-width: 1200px) { #sh-panel { width: 300px !important; } }
  `;
  document.head.appendChild(css);

  // ============================================================
  //  키워드 매핑
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
    '다용도':'多用途','수납':'收纳','선반':'架子','행거':'衣架','컵':'杯子',
    '거울':'镜子','모자':'帽子','신발':'鞋','운동화':'运动鞋','슬리퍼':'拖鞋',
    '샌들':'凉鞋','선글라스':'太阳镜','시계':'手表','칼':'刀','주전자':'水壶',
    '머그컵':'马克杯','쓰레기통':'垃圾桶','정리함':'收纳盒',
  };
  const NOISE = new Set([
    '1개','2개','3개','4개','5개','1P','2P','3P','1+1','2+1',
    '무료배송','당일발송','최저가','특가','세일','할인','핫딜','정품','국내정품',
    '고급','프리미엄','대용량','소용량','미니','슬림','블랙','화이트','그레이',
    '베이지','네이비','핑크','레드','블루','그린',
  ]);

  function extractKw(title) {
    if (!title) return { cn: '', ko: '' };
    const c = title.replace(/\[.*?\]|\(.*?\)|【.*?】/g, ' ')
      .replace(/[\/\\|~`!@#$%^&*=+{};:'"<>,.?]/g, ' ')
      .replace(/\d+(ml|g|kg|cm|mm|개입|매입|세트|팩|롤)/gi, ' ').trim();
    let w = c.split(/\s+/).filter(x => x.length > 1 && !NOISE.has(x) && !/^\d+$/.test(x));
    if (w.length > 2 && /^[a-zA-Z]+$/.test(w[0]) && !CN[w[0]]) w.shift();
    const cnKw = w.slice(0, 3).map(x => CN[x]).filter(Boolean).join(' ');
    const koKw = w.slice(0, 3).join(' ');
    return { cn: cnKw || koKw, ko: koKw };
  }

  // ============================================================
  //  점수 & 등급
  // ============================================================
  function calcScore(item) {
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

  function getGrade(sc) {
    if (sc >= 80) return { l: 'S', c: 'sh-gs' };
    if (sc >= 65) return { l: 'A', c: 'sh-ga' };
    if (sc >= 50) return { l: 'B', c: 'sh-gb' };
    if (sc >= 35) return { l: 'C', c: 'sh-gc' };
    return { l: 'D', c: 'sh-gd' };
  }

  // ============================================================
  //  상품 파싱
  // ============================================================
  const MAX = 36;

  function getQ() {
    try {
      const u = new URL(location.href);
      return u.searchParams.get('q') || u.searchParams.get('query') || u.searchParams.get('keyword') || '';
    } catch { return ''; }
  }
  function tx(el) { return (el?.textContent || '').replace(/\s+/g, ' ').trim(); }
  function nm(s) { return parseInt((s || '').replace(/[^0-9]/g, ''), 10) || 0; }
  function esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

  function parseProducts() {
    const items = [], seen = new Set(), q = getQ();

    for (const a of document.querySelectorAll('a[href*="/vp/products/"]')) {
      if (items.length >= MAX) break;
      const m = (a.href || '').match(/\/vp\/products\/(\d+)/);
      if (!m) continue;
      const pid = m[1];
      if (seen.has(pid)) continue;
      seen.add(pid);

      let box = a;
      for (let i = 0; i < 6 && box.parentElement; i++) {
        box = box.parentElement;
        if (box.tagName === 'LI' || box.dataset?.productId) break;
      }

      const nameEl = box.querySelector('[class*="name"],[class*="title"],[class*="Name"]');
      const title = (nameEl ? tx(nameEl) : '') || tx(a) || (box.querySelector('img')?.alt || '');
      if (!title || title.length < 3) continue;

      let price = 0;
      for (const el of box.querySelectorAll('[class*="price"],[class*="Price"]')) {
        const ms = tx(el).match(/[\d,]+원/g);
        if (ms) { const ns = ms.map(x => nm(x)).filter(n => n >= 100 && n < 1e8); if (ns.length) { price = Math.min(...ns); break; } }
      }
      if (!price) {
        const ms = tx(box).match(/[\d,]+원/g);
        if (ms) { const ns = ms.map(x => nm(x)).filter(n => n >= 100 && n < 1e8); if (ns.length) price = Math.min(...ns); }
      }

      let rating = 0, reviewCount = 0;
      const ratEl = box.querySelector('[class*="rating"],[class*="star"]');
      if (ratEl) { const rm = tx(ratEl).match(/(\d+\.?\d*)/); if (rm) { const v = parseFloat(rm[1]); if (v > 0 && v <= 5) rating = v; } }
      const revEl = box.querySelector('[class*="review"],[class*="count"],.rating-total-count');
      if (revEl) reviewCount = nm(tx(revEl).replace(/[()]/g, ''));

      const img = box.querySelector('img');
      const isAd = /ad[-_]?badge|광고|sponsored/i.test(box.innerHTML.substring(0, 500));
      const isRocket = /로켓배송|로켓와우|rocket/i.test(tx(box));
      const href = a.href.startsWith('http') ? a.href : 'https://www.coupang.com' + a.href;

      items.push({
        productId: pid, title, price, rating, reviewCount,
        url: href, imageUrl: img?.src || img?.getAttribute('data-img-src') || '',
        position: items.length + 1, query: q, isAd, isRocket, _box: box,
      });
    }
    return items;
  }

  // ============================================================
  //  미니 차트 유틸 (히스토그램 생성)
  // ============================================================
  function makeHistogram(values, bucketCount) {
    if (!values.length) return [];
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) return [{ label: String(min), count: values.length }];
    const step = (max - min) / bucketCount;
    const buckets = [];
    for (let i = 0; i < bucketCount; i++) {
      const lo = min + step * i;
      const hi = min + step * (i + 1);
      const count = values.filter(v => i === bucketCount - 1 ? v >= lo && v <= hi : v >= lo && v < hi).length;
      buckets.push({ lo, hi, count, label: formatShort(lo) });
    }
    return buckets;
  }

  function formatShort(n) {
    if (n >= 10000) return Math.round(n / 10000) + '만';
    if (n >= 1000) return Math.round(n / 1000) + '천';
    return String(Math.round(n));
  }

  function renderBars(buckets) {
    const maxC = Math.max(...buckets.map(b => b.count), 1);
    return buckets.map((b, i) => {
      const h = Math.max(2, Math.round((b.count / maxC) * 36));
      const active = b.count === maxC ? ' sh-bar-active' : '';
      return `<div class="sh-bar${active}" style="height:${h}px !important;" title="${b.label}~: ${b.count}개"><span class="sh-bar-lbl">${b.label}</span></div>`;
    }).join('');
  }

  // ============================================================
  //  경쟁도 계산
  // ============================================================
  function calcCompetition(items) {
    const reviews = items.map(i => i.reviewCount).filter(r => r > 0);
    const avgRev = reviews.length ? reviews.reduce((a, b) => a + b, 0) / reviews.length : 0;
    const highRev = items.filter(i => i.reviewCount >= 100).length;
    const highRatio = items.length ? highRev / items.length : 0;
    const adRatio = items.length ? items.filter(i => i.isAd).length / items.length : 0;
    const ratings = items.map(i => i.rating).filter(r => r > 0);
    const avgRat = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;

    let sc = 0;
    if (avgRev > 1000) sc += 35; else if (avgRev > 500) sc += 25; else if (avgRev > 100) sc += 15; else if (avgRev > 30) sc += 8;
    if (highRatio > .6) sc += 25; else if (highRatio > .4) sc += 15; else if (highRatio > .2) sc += 8;
    if (avgRat >= 4.5) sc += 15; else if (avgRat >= 4.0) sc += 8;
    if (adRatio > .3) sc += 20; else if (adRatio > .15) sc += 10;
    sc = Math.min(100, sc);

    const level = sc >= 70 ? 'hard' : sc >= 40 ? 'mid' : 'easy';
    const label = sc >= 70 ? '경쟁 치열' : sc >= 40 ? '보통' : '진입 용이';
    const cls = sc >= 70 ? 'sh-comp-hard' : sc >= 40 ? 'sh-comp-mid' : 'sh-comp-easy';
    return { sc, level, label, cls };
  }

  // ============================================================
  //  플로팅 패널
  // ============================================================
  let panel = null;
  let allItems = [];
  let savedSet = new Set();
  let isMin = false;

  function createPanel() {
    if (panel) panel.remove();
    panel = document.createElement('div');
    panel.id = 'sh-panel';
    panel.innerHTML = `
      <div class="sh-hd" id="sh-drag">
        <span class="logo">🐢</span>
        <div class="sh-hc">
          <span class="ver">v${VER}</span>
          <span class="qr" id="sh-q"></span>
          <span class="cnt" id="sh-cnt">0개</span>
        </div>
        <div class="sh-hbtns">
          <button class="sh-hb" id="sh-ref" title="새로고침">↻</button>
          <button class="sh-hb" id="sh-min" title="접기">—</button>
        </div>
      </div>
      <div class="sh-body" id="sh-body"></div>
      <div class="sh-foot">🐢 소싱 헬퍼 · <a href="https://lumiriz.kr" target="_blank">lumiriz.kr</a></div>
    `;
    document.body.appendChild(panel);
    initDrag();

    document.getElementById('sh-min').addEventListener('click', (e) => {
      e.stopPropagation();
      isMin = !isMin;
      panel.classList.toggle('sh-min', isMin);
    });
    panel.addEventListener('click', () => { if (isMin) { isMin = false; panel.classList.remove('sh-min'); } });
    document.getElementById('sh-ref').addEventListener('click', (e) => { e.stopPropagation(); doScan(true); });
  }

  function initDrag() {
    const h = document.getElementById('sh-drag');
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
  //  패널 렌더링 — 시장 개요 + 차트 + TOP3
  // ============================================================
  function renderPanel(items) {
    if (!panel) createPanel();
    if (isMin) return;

    const q = getQ();
    document.getElementById('sh-q').textContent = q ? `"${q}"` : '';
    document.getElementById('sh-cnt').textContent = items.length + '개';

    const body = document.getElementById('sh-body');
    if (!items.length) {
      body.innerHTML = '<div style="padding:40px 20px !important;text-align:center !important;color:#94a3b8 !important;"><div style="font-size:28px !important;">📦</div><div style="font-size:11px !important;margin-top:6px !important;">상품 파싱 중...</div></div>';
      return;
    }

    // 통계 계산
    const prices = items.map(i => i.price).filter(p => p > 0);
    const reviews = items.map(i => i.reviewCount).filter(r => r > 0);
    const ratings = items.map(i => i.rating).filter(r => r > 0);
    const avgPrice = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
    const minPrice = prices.length ? Math.min(...prices) : 0;
    const maxPrice = prices.length ? Math.max(...prices) : 0;
    const totalRev = reviews.reduce((a, b) => a + b, 0);
    const avgReview = reviews.length ? Math.round(totalRev / reviews.length) : 0;
    const avgRating = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : '-';
    const adCnt = items.filter(i => i.isAd).length;
    const rocketCnt = items.filter(i => i.isRocket).length;
    const comp = calcCompetition(items);

    // 차트 데이터
    const priceBuckets = makeHistogram(prices, 6);
    const revBuckets = makeHistogram(reviews, 5);

    // TOP3
    const top3 = items.slice(0, 3);

    body.innerHTML = `
      <!-- 시장 개요 -->
      <div class="sh-sec">
        <div class="sh-sec-title">📊 시장 개요</div>
        <div class="sh-stats">
          <div class="sh-st">
            <span class="sh-st-v accent">${items.length}</span>
            <span class="sh-st-l">상품수</span>
          </div>
          <div class="sh-st">
            <span class="sh-st-v red">${avgPrice ? avgPrice.toLocaleString() + '원' : '-'}</span>
            <span class="sh-st-l">평균가</span>
          </div>
          <div class="sh-st">
            <span class="sh-st-v">${avgRating}</span>
            <span class="sh-st-l">평균평점</span>
          </div>
          <div class="sh-st">
            <span class="sh-st-v amber">${avgReview.toLocaleString()}</span>
            <span class="sh-st-l">평균리뷰</span>
          </div>
          <div class="sh-st">
            <span class="sh-st-v">${adCnt}</span>
            <span class="sh-st-l">광고</span>
          </div>
          <div class="sh-st">
            <span class="sh-st-v">${rocketCnt}</span>
            <span class="sh-st-l">로켓</span>
          </div>
        </div>

        <!-- 경쟁도 -->
        <div style="margin-top:10px !important;">
          <div style="display:flex !important;justify-content:space-between !important;align-items:center !important;">
            <span style="font-size:10px !important;font-weight:600 !important;color:#64748b !important;">경쟁 강도</span>
            <span style="font-size:10px !important;font-weight:700 !important;color:${comp.level === 'hard' ? '#dc2626' : comp.level === 'mid' ? '#d97706' : '#16a34a'} !important;">${comp.label} (${comp.sc}점)</span>
          </div>
          <div class="sh-comp-bar"><div class="sh-comp-fill ${comp.cls}" style="width:${comp.sc}% !important;"></div></div>
        </div>
      </div>

      <!-- 가격 & 리뷰 분포 차트 -->
      <div class="sh-sec" style="padding-top:8px !important;">
        <div class="sh-charts">
          <div class="sh-chart">
            <div class="sh-chart-title">💰 가격 분포</div>
            <div class="sh-bars" style="padding-bottom:14px !important;">${renderBars(priceBuckets)}</div>
            <div style="display:flex !important;justify-content:space-between !important;font-size:8px !important;color:#94a3b8 !important;margin-top:2px !important;">
              <span>${minPrice ? minPrice.toLocaleString() + '원' : ''}</span>
              <span>${maxPrice ? maxPrice.toLocaleString() + '원' : ''}</span>
            </div>
          </div>
          <div class="sh-chart">
            <div class="sh-chart-title">💬 리뷰 분포</div>
            <div class="sh-bars" style="padding-bottom:14px !important;">${renderBars(revBuckets)}</div>
            <div style="display:flex !important;justify-content:space-between !important;font-size:8px !important;color:#94a3b8 !important;margin-top:2px !important;">
              <span>적음</span>
              <span>많음</span>
            </div>
          </div>
        </div>
      </div>

      <!-- TOP 3 상품 -->
      <div class="sh-sec">
        <div class="sh-sec-title">🏆 TOP 3 상품</div>
        ${top3.map((item, idx) => {
          const sc = calcScore(item);
          const g = getGrade(sc);
          const rcls = ['sh-r1','sh-r2','sh-r3'][idx];
          const isSaved = savedSet.has(item.productId);
          return `
            <div class="sh-top" data-pid="${item.productId}">
              <div class="sh-top-rank ${rcls}">${idx + 1}</div>
              ${item.imageUrl ? `<img class="sh-top-img" src="${item.imageUrl}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
              <div class="sh-top-info">
                <div class="sh-top-name">${esc(item.title)}</div>
                <div class="sh-top-meta">
                  <span class="sh-top-grade ${g.c}">${g.l}${sc}</span>
                  ${item.price ? `<span class="sh-top-price">${item.price.toLocaleString()}원</span>` : ''}
                  ${item.reviewCount > 0 ? `<span class="sh-top-rev">리뷰 ${item.reviewCount.toLocaleString()}</span>` : ''}
                  ${item.isAd ? '<span class="sh-top-rev" style="color:#dc2626 !important;">AD</span>' : ''}
                </div>
                <div class="sh-top-btns">
                  <button class="sh-tb sh-tb-1688" data-pid="${item.productId}">1688</button>
                  <button class="sh-tb sh-tb-ali" data-pid="${item.productId}">Ali</button>
                  <button class="sh-tb ${isSaved ? 'sh-tb-saved' : 'sh-tb-save'}" data-pid="${item.productId}" data-act="save">${isSaved ? '✓' : '저장'}</button>
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
    // 1688
    const b1 = e.target.closest('.sh-tb-1688');
    if (b1) {
      e.preventDefault(); e.stopPropagation();
      const item = allItems.find(i => i.productId === b1.dataset.pid);
      if (!item) return;
      b1.textContent = '..';
      chrome.runtime.sendMessage({ type: 'PRE_MATCH', productName: item.title, price: item.price, imageUrl: item.imageUrl })
        .then(r => {
          const kw = extractKw(item.title);
          const keyword = (r?.success && r.keywords1688?.length) ? r.keywords1688[0].keyword : kw.cn;
          window.open('https://s.1688.com/selloffer/offer_search.htm?keywords=' + encodeURIComponent(keyword), '_blank');
          b1.textContent = '1688';
        }).catch(() => {
          window.open('https://s.1688.com/selloffer/offer_search.htm?keywords=' + encodeURIComponent(extractKw(item.title).cn), '_blank');
          b1.textContent = '1688';
        });
      return;
    }

    // Ali
    const b2 = e.target.closest('.sh-tb-ali');
    if (b2) {
      e.preventDefault(); e.stopPropagation();
      const item = allItems.find(i => i.productId === b2.dataset.pid);
      if (!item) return;
      const kw = extractKw(item.title);
      window.open('https://www.aliexpress.com/wholesale?SearchText=' + encodeURIComponent(kw.cn || kw.ko), '_blank');
      return;
    }

    // 저장
    const bs = e.target.closest('[data-act="save"]');
    if (bs) {
      e.preventDefault(); e.stopPropagation();
      const item = allItems.find(i => i.productId === bs.dataset.pid);
      if (!item) return;
      const { _box, ...clean } = item;
      chrome.runtime.sendMessage({ type: 'SAVE_CANDIDATE', product: clean, score: calcScore(item), grade: getGrade(calcScore(item)).l }).catch(() => {});
      savedSet.add(item.productId);
      bs.textContent = '✓'; bs.className = 'sh-tb sh-tb-saved';
      return;
    }

    // TOP3 상품 클릭 → 쿠팡 페이지에서 하이라이트
    const top = e.target.closest('.sh-top');
    if (top && !e.target.closest('.sh-tb')) {
      e.preventDefault(); e.stopPropagation();
      const item = allItems.find(i => i.productId === top.dataset.pid);
      if (!item?._box) return;
      document.querySelectorAll('.sh-hl').forEach(el => el.classList.remove('sh-hl'));
      item._box.classList.add('sh-hl');
      item._box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => item._box.classList.remove('sh-hl'), 3000);
      return;
    }
  }, true);

  // ============================================================
  //  스캔
  // ============================================================
  let lastSig = '';
  let timer = null;

  function doScan(force = false) {
    if (!location.href.includes('/np/search')) {
      if (panel) panel.style.display = 'none';
      return;
    }

    const items = parseProducts();
    if (!items.length) {
      if (panel) { panel.style.display = ''; renderPanel([]); }
      return;
    }

    const sig = items.map(i => i.productId).slice(0, 5).join(',');
    const isNew = sig !== lastSig || force;

    if (isNew) {
      lastSig = sig;
      allItems = items;
      console.log(`%c[SH] ✅ ${items.length}개 파싱`, 'color:#16a34a;font-weight:bold;');
    }

    if (!panel) createPanel();
    panel.style.display = '';

    if (isNew) {
      renderPanel(items);
      const clean = items.map(({ _box, ...c }) => c);
      chrome.runtime.sendMessage({ type: 'SEARCH_RESULTS_PARSED', query: getQ(), items: clean }).catch(() => {});
    }
  }

  // URL 변경 감지
  let lastUrl = location.href;
  function urlCheck() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastSig = ''; allItems = [];
      document.querySelectorAll('.sh-hl').forEach(el => el.classList.remove('sh-hl'));
      setTimeout(() => doScan(true), 300);
      setTimeout(() => doScan(true), 800);
      setTimeout(() => doScan(true), 1500);
    }
  }

  window.addEventListener('popstate', () => setTimeout(urlCheck, 100));
  setInterval(urlCheck, 800);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(() => doScan(true), 300); });
  document.addEventListener('force-reparse', () => setTimeout(() => doScan(true), 300));

  const obs = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(() => doScan(), 600); });
  obs.observe(document.body || document.documentElement, { childList: true, subtree: true });

  // 초기 실행
  doScan();
  setTimeout(doScan, 500);
  setTimeout(doScan, 1200);
  setTimeout(doScan, 2500);

  chrome.runtime.sendMessage({ type: 'PAGE_DETECTED', pageType: 'search', url: location.href }).catch(() => {});
})();
