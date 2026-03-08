/* ============================================================
   Coupang Sourcing Helper — Content Script v5.4.0
   "플로팅 패널" — 셀록홈즈 스타일 자동 오버레이 패널

   원칙:
   1) 검색 결과 페이지에서 자동으로 플로팅 패널 표시
   2) 패널은 화면 오른쪽에 떠 있는 형태 (드래그 가능)
   3) 각 상품: 점수·가격·리뷰·1688·저장 버튼
   4) 접기/펼치기 토글
   5) 쿠팡 DOM 최소 건드림
   ============================================================ */
(function () {
  'use strict';
  const VER = '5.4.0';

  // ---- 중복 방지 ----
  if (window.__SH_LOADED__) return;
  window.__SH_LOADED__ = true;

  // 모든 이전 버전 잔재 제거
  document.querySelectorAll(
    '#sh-float-bar,#sh-topbar,#sh-card-styles,#sh-styles-v531,' +
    '.sh-card-overlay,.sh-databar,.sh-mini-badge,.sh-card-box,' +
    '.sh-modal-backdrop,.sh-modal-panel,.sh-hover-highlight,' +
    '[data-sh-badge],[data-sh-overlay],[data-sh-card],[data-sh],' +
    '#sh-overlay-styles,#sh-modal-styles,#sh-debug-panel,#sh-version-badge,' +
    '.sh-tag,#sh-panel'
  ).forEach(el => el.remove());

  console.log(`%c[SH] v${VER} 플로팅 패널 로드`, 'color:#16a34a;font-weight:bold;font-size:13px;');

  // ============================================================
  //  CSS — 플로팅 패널 전체 스타일
  // ============================================================
  const css = document.createElement('style');
  css.id = 'sh-panel-css';
  css.textContent = `
    /* ---- 패널 컨테이너 ---- */
    #sh-panel {
      position: fixed !important;
      top: 60px !important;
      right: 12px !important;
      width: 380px !important;
      max-height: calc(100vh - 80px) !important;
      z-index: 2147483640 !important;
      font-family: -apple-system, 'Noto Sans KR', 'Malgun Gothic', sans-serif !important;
      font-size: 12px !important;
      color: #1e293b !important;
      background: #ffffff !important;
      border-radius: 12px !important;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08) !important;
      display: flex !important;
      flex-direction: column !important;
      overflow: hidden !important;
      border: 1px solid #e2e8f0 !important;
      transition: width 0.2s ease, opacity 0.2s ease !important;
      user-select: none !important;
    }
    #sh-panel.sh-collapsed {
      width: 48px !important;
      max-height: 48px !important;
      border-radius: 24px !important;
      cursor: pointer !important;
    }
    #sh-panel.sh-collapsed .sh-header-content,
    #sh-panel.sh-collapsed .sh-body {
      display: none !important;
    }
    #sh-panel.sh-dragging {
      opacity: 0.85 !important;
      cursor: grabbing !important;
    }

    /* ---- 헤더 ---- */
    .sh-header {
      background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%) !important;
      color: #fff !important;
      padding: 10px 14px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      cursor: grab !important;
      flex-shrink: 0 !important;
      border-radius: 12px 12px 0 0 !important;
    }
    #sh-panel.sh-collapsed .sh-header {
      border-radius: 24px !important;
      padding: 12px !important;
      justify-content: center !important;
    }
    .sh-logo {
      font-size: 16px !important;
      font-weight: 800 !important;
      letter-spacing: -0.5px !important;
    }
    .sh-header-content {
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      flex: 1 !important;
    }
    .sh-ver {
      font-size: 9px !important;
      opacity: 0.7 !important;
      background: rgba(255,255,255,0.15) !important;
      padding: 1px 5px !important;
      border-radius: 4px !important;
    }
    .sh-query-badge {
      font-size: 11px !important;
      background: rgba(255,255,255,0.2) !important;
      padding: 2px 8px !important;
      border-radius: 6px !important;
      max-width: 140px !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
    }
    .sh-count-badge {
      font-size: 10px !important;
      background: rgba(255,255,255,0.25) !important;
      padding: 2px 6px !important;
      border-radius: 6px !important;
      font-weight: 700 !important;
    }
    .sh-header-btns {
      display: flex !important;
      gap: 4px !important;
    }
    .sh-hbtn {
      width: 24px !important;
      height: 24px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      border: none !important;
      background: rgba(255,255,255,0.15) !important;
      color: #fff !important;
      border-radius: 6px !important;
      cursor: pointer !important;
      font-size: 13px !important;
      line-height: 1 !important;
      padding: 0 !important;
    }
    .sh-hbtn:hover { background: rgba(255,255,255,0.3) !important; }

    /* ---- 요약 바 ---- */
    .sh-summary {
      background: #f8fafc !important;
      padding: 8px 14px !important;
      display: flex !important;
      gap: 12px !important;
      border-bottom: 1px solid #e2e8f0 !important;
      flex-shrink: 0 !important;
      flex-wrap: wrap !important;
    }
    .sh-stat {
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
    }
    .sh-stat-val {
      font-size: 14px !important;
      font-weight: 800 !important;
      color: #4f46e5 !important;
    }
    .sh-stat-lbl {
      font-size: 9px !important;
      color: #94a3b8 !important;
      margin-top: 1px !important;
    }

    /* ---- 상품 리스트 ---- */
    .sh-body {
      overflow-y: auto !important;
      flex: 1 !important;
      max-height: calc(100vh - 200px) !important;
    }
    .sh-body::-webkit-scrollbar { width: 4px !important; }
    .sh-body::-webkit-scrollbar-thumb { background: #cbd5e1 !important; border-radius: 4px !important; }

    .sh-item {
      display: flex !important;
      align-items: flex-start !important;
      gap: 10px !important;
      padding: 10px 14px !important;
      border-bottom: 1px solid #f1f5f9 !important;
      transition: background 0.15s !important;
      cursor: pointer !important;
    }
    .sh-item:hover {
      background: #f8fafc !important;
    }
    .sh-item.sh-item-active {
      background: #eff6ff !important;
      border-left: 3px solid #4f46e5 !important;
    }

    /* 순위 번호 */
    .sh-rank {
      width: 22px !important;
      height: 22px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      border-radius: 6px !important;
      font-size: 10px !important;
      font-weight: 800 !important;
      flex-shrink: 0 !important;
      margin-top: 2px !important;
    }
    .sh-rank-top { background: #fef3c7 !important; color: #92400e !important; }
    .sh-rank-mid { background: #e2e8f0 !important; color: #475569 !important; }
    .sh-rank-low { background: #f1f5f9 !important; color: #94a3b8 !important; }

    /* 이미지 */
    .sh-thumb {
      width: 48px !important;
      height: 48px !important;
      border-radius: 6px !important;
      object-fit: cover !important;
      flex-shrink: 0 !important;
      background: #f1f5f9 !important;
    }

    /* 상품 정보 */
    .sh-info {
      flex: 1 !important;
      min-width: 0 !important;
    }
    .sh-title {
      font-size: 11px !important;
      font-weight: 600 !important;
      color: #1e293b !important;
      line-height: 1.3 !important;
      display: -webkit-box !important;
      -webkit-line-clamp: 2 !important;
      -webkit-box-orient: vertical !important;
      overflow: hidden !important;
      margin-bottom: 4px !important;
    }
    .sh-meta {
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
      flex-wrap: wrap !important;
    }

    /* 등급 뱃지 */
    .sh-grade {
      display: inline-flex !important;
      align-items: center !important;
      gap: 2px !important;
      font-size: 10px !important;
      font-weight: 800 !important;
      padding: 1px 6px !important;
      border-radius: 4px !important;
      color: #fff !important;
    }
    .sh-grade-s { background: #16a34a !important; }
    .sh-grade-a { background: #3b82f6 !important; }
    .sh-grade-b { background: #f59e0b !important; }
    .sh-grade-c { background: #9ca3af !important; }
    .sh-grade-d { background: #dc2626 !important; }

    .sh-price {
      font-size: 11px !important;
      font-weight: 700 !important;
      color: #dc2626 !important;
    }
    .sh-review {
      font-size: 10px !important;
      color: #64748b !important;
    }
    .sh-flags {
      display: flex !important;
      gap: 3px !important;
    }
    .sh-flag {
      font-size: 9px !important;
      padding: 0 4px !important;
      border-radius: 3px !important;
      font-weight: 600 !important;
    }
    .sh-flag-ad { background: #fee2e2 !important; color: #b91c1c !important; }
    .sh-flag-rocket { background: #dbeafe !important; color: #1d4ed8 !important; }

    /* 액션 버튼 행 */
    .sh-actions {
      display: flex !important;
      gap: 4px !important;
      margin-top: 5px !important;
    }
    .sh-btn {
      height: 22px !important;
      padding: 0 8px !important;
      border: none !important;
      border-radius: 4px !important;
      font-size: 10px !important;
      font-weight: 700 !important;
      cursor: pointer !important;
      color: #fff !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 3px !important;
      white-space: nowrap !important;
    }
    .sh-btn:hover { opacity: 0.85 !important; }
    .sh-btn-1688 { background: #ea580c !important; }
    .sh-btn-ali { background: #dc2626 !important; }
    .sh-btn-save { background: #4f46e5 !important; }
    .sh-btn-saved { background: #16a34a !important; }
    .sh-btn-detail { background: #6366f1 !important; }

    /* 상세 펼치기 */
    .sh-expand {
      display: none;
      padding: 8px 14px 8px 80px !important;
      background: #f8fafc !important;
      border-bottom: 1px solid #f1f5f9 !important;
      font-size: 10px !important;
      color: #64748b !important;
      line-height: 1.5 !important;
    }
    .sh-expand.sh-open { display: block !important; }
    .sh-expand-row {
      display: flex !important;
      justify-content: space-between !important;
      padding: 2px 0 !important;
    }
    .sh-expand-label { color: #94a3b8 !important; }
    .sh-expand-value { color: #1e293b !important; font-weight: 600 !important; }
    .sh-kw-tag {
      display: inline-block !important;
      background: #fef3c7 !important;
      color: #92400e !important;
      padding: 1px 6px !important;
      border-radius: 4px !important;
      font-size: 9px !important;
      margin: 1px 2px !important;
    }

    /* ---- 로딩/빈 상태 ---- */
    .sh-empty {
      padding: 40px 20px !important;
      text-align: center !important;
      color: #94a3b8 !important;
    }
    .sh-empty-icon { font-size: 32px !important; margin-bottom: 8px !important; }
    .sh-empty-text { font-size: 12px !important; }

    /* ---- 호버 하이라이트 (쿠팡 상품에) ---- */
    .sh-highlight {
      outline: 2px solid #4f46e5 !important;
      outline-offset: -2px !important;
      transition: outline 0.15s !important;
    }

    /* ---- 반응형 ---- */
    @media (max-width: 1200px) {
      #sh-panel {
        width: 320px !important;
      }
    }
  `;
  document.head.appendChild(css);

  // ============================================================
  //  키워드 매핑 (KO → CN)
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

  function getGrade(score) {
    if (score >= 80) return { letter: 'S', cls: 'sh-grade-s' };
    if (score >= 65) return { letter: 'A', cls: 'sh-grade-a' };
    if (score >= 50) return { letter: 'B', cls: 'sh-grade-b' };
    if (score >= 35) return { letter: 'C', cls: 'sh-grade-c' };
    return { letter: 'D', cls: 'sh-grade-d' };
  }

  // ============================================================
  //  상품 파싱
  // ============================================================
  const MAX_ITEMS = 36;

  function getQuery() {
    try {
      const u = new URL(location.href);
      return u.searchParams.get('q') || u.searchParams.get('query') || u.searchParams.get('keyword') || '';
    } catch { return ''; }
  }

  function tx(el) { return (el?.textContent || '').replace(/\s+/g, ' ').trim(); }
  function nm(s) { return parseInt((s || '').replace(/[^0-9]/g, ''), 10) || 0; }

  function parseProducts() {
    const items = [], seen = new Set(), q = getQuery();

    for (const a of document.querySelectorAll('a[href*="/vp/products/"]')) {
      if (items.length >= MAX_ITEMS) break;
      const m = (a.href || '').match(/\/vp\/products\/(\d+)/);
      if (!m) continue;
      const pid = m[1];
      if (seen.has(pid)) continue;
      seen.add(pid);

      // 컨테이너 찾기
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
        productId: pid,
        title,
        price,
        rating,
        reviewCount,
        url: href,
        imageUrl: img?.src || img?.getAttribute('data-img-src') || '',
        position: items.length + 1,
        query: q,
        isAd,
        isRocket,
        _box: box,  // DOM 참조 (하이라이트용)
      });
    }
    return items;
  }

  // ============================================================
  //  플로팅 패널 생성
  // ============================================================
  let panel = null;
  let allItems = [];
  let savedSet = new Set(); // 저장된 상품 ID
  let isCollapsed = false;

  function createPanel() {
    if (panel) panel.remove();

    panel = document.createElement('div');
    panel.id = 'sh-panel';
    panel.innerHTML = `
      <div class="sh-header" id="sh-drag-handle">
        <span class="sh-logo">🐢</span>
        <div class="sh-header-content">
          <span class="sh-ver">v${VER}</span>
          <span class="sh-query-badge" id="sh-query"></span>
          <span class="sh-count-badge" id="sh-count">0개</span>
        </div>
        <div class="sh-header-btns">
          <button class="sh-hbtn" id="sh-btn-refresh" title="새로고침">↻</button>
          <button class="sh-hbtn" id="sh-btn-collapse" title="접기">—</button>
        </div>
      </div>
      <div class="sh-summary" id="sh-summary"></div>
      <div class="sh-body" id="sh-list"></div>
    `;
    document.body.appendChild(panel);

    // ---- 드래그 ----
    initDrag();

    // ---- 접기/펼치기 ----
    document.getElementById('sh-btn-collapse').addEventListener('click', (e) => {
      e.stopPropagation();
      isCollapsed = !isCollapsed;
      panel.classList.toggle('sh-collapsed', isCollapsed);
    });
    panel.addEventListener('click', () => {
      if (isCollapsed) {
        isCollapsed = false;
        panel.classList.remove('sh-collapsed');
      }
    });

    // ---- 새로고침 ----
    document.getElementById('sh-btn-refresh').addEventListener('click', (e) => {
      e.stopPropagation();
      doScan(true);
    });

    return panel;
  }

  // ---- 드래그 ----
  function initDrag() {
    const handle = document.getElementById('sh-drag-handle');
    let isDragging = false, startX, startY, startRight, startTop;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('.sh-hbtn')) return;
      isDragging = true;
      panel.classList.add('sh-dragging');
      const rect = panel.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startRight = window.innerWidth - rect.right;
      startTop = rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const newTop = Math.max(0, Math.min(window.innerHeight - 60, startTop + dy));
      const newRight = Math.max(0, Math.min(window.innerWidth - 60, startRight - dx));
      panel.style.top = newTop + 'px';
      panel.style.right = newRight + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        panel.classList.remove('sh-dragging');
      }
    });
  }

  // ============================================================
  //  패널 렌더링
  // ============================================================
  function renderPanel(items) {
    if (!panel) createPanel();
    if (isCollapsed) return;

    const q = getQuery();
    document.getElementById('sh-query').textContent = q ? `"${q}"` : '';
    document.getElementById('sh-count').textContent = items.length + '개';

    // ---- 요약 통계 ----
    const prices = items.map(i => i.price).filter(p => p > 0);
    const reviews = items.map(i => i.reviewCount).filter(r => r > 0);
    const ratings = items.map(i => i.rating).filter(r => r > 0);
    const avgPrice = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
    const avgReview = reviews.length ? Math.round(reviews.reduce((a, b) => a + b, 0) / reviews.length) : 0;
    const avgRating = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : '-';
    const adCount = items.filter(i => i.isAd).length;
    const sScoreItems = items.filter(i => calcScore(i) >= 80);

    document.getElementById('sh-summary').innerHTML = `
      <div class="sh-stat"><span class="sh-stat-val">${avgPrice ? avgPrice.toLocaleString() + '원' : '-'}</span><span class="sh-stat-lbl">평균가</span></div>
      <div class="sh-stat"><span class="sh-stat-val">${avgRating}</span><span class="sh-stat-lbl">평균평점</span></div>
      <div class="sh-stat"><span class="sh-stat-val">${avgReview.toLocaleString()}</span><span class="sh-stat-lbl">평균리뷰</span></div>
      <div class="sh-stat"><span class="sh-stat-val">${adCount}</span><span class="sh-stat-lbl">광고</span></div>
      <div class="sh-stat"><span class="sh-stat-val" style="color:#16a34a !important;">${sScoreItems.length}</span><span class="sh-stat-lbl">S등급</span></div>
    `;

    // ---- 상품 리스트 ----
    const listEl = document.getElementById('sh-list');
    if (!items.length) {
      listEl.innerHTML = `
        <div class="sh-empty">
          <div class="sh-empty-icon">📦</div>
          <div class="sh-empty-text">상품을 파싱 중입니다...</div>
        </div>
      `;
      return;
    }

    listEl.innerHTML = items.map((item, idx) => {
      const sc = calcScore(item);
      const g = getGrade(sc);
      const kw = extractKw(item.title);
      const rankCls = idx < 3 ? 'sh-rank-top' : idx < 10 ? 'sh-rank-mid' : 'sh-rank-low';
      const isSaved = savedSet.has(item.productId);

      return `
        <div class="sh-item" data-pid="${item.productId}" data-idx="${idx}">
          <div class="sh-rank ${rankCls}">${idx + 1}</div>
          ${item.imageUrl ? `<img class="sh-thumb" src="${item.imageUrl}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
          <div class="sh-info">
            <div class="sh-title">${escHtml(item.title)}</div>
            <div class="sh-meta">
              <span class="sh-grade ${g.cls}">${g.letter}${sc}</span>
              ${item.price ? `<span class="sh-price">${item.price.toLocaleString()}원</span>` : ''}
              ${item.rating > 0 ? `<span class="sh-review">★${item.rating}</span>` : ''}
              ${item.reviewCount > 0 ? `<span class="sh-review">(${item.reviewCount.toLocaleString()})</span>` : ''}
              <div class="sh-flags">
                ${item.isAd ? '<span class="sh-flag sh-flag-ad">AD</span>' : ''}
                ${item.isRocket ? '<span class="sh-flag sh-flag-rocket">🚀</span>' : ''}
              </div>
            </div>
            <div class="sh-actions">
              <button class="sh-btn sh-btn-1688" data-pid="${item.productId}">1688</button>
              <button class="sh-btn sh-btn-ali" data-pid="${item.productId}">Ali</button>
              <button class="sh-btn ${isSaved ? 'sh-btn-saved' : 'sh-btn-save'}" data-pid="${item.productId}" data-action="save">${isSaved ? '✓저장됨' : '저장'}</button>
              <button class="sh-btn sh-btn-detail" data-pid="${item.productId}" data-action="expand">더보기</button>
            </div>
          </div>
        </div>
        <div class="sh-expand" id="sh-expand-${item.productId}">
          <div class="sh-expand-row"><span class="sh-expand-label">상품ID</span><span class="sh-expand-value">${item.productId}</span></div>
          <div class="sh-expand-row"><span class="sh-expand-label">소싱점수</span><span class="sh-expand-value">${sc}점 (${g.letter}등급)</span></div>
          ${item.rating > 0 ? `<div class="sh-expand-row"><span class="sh-expand-label">평점</span><span class="sh-expand-value">★ ${item.rating} (${item.reviewCount.toLocaleString()}개)</span></div>` : ''}
          <div class="sh-expand-row"><span class="sh-expand-label">1688 키워드</span><span class="sh-expand-value">${kw.cn ? `<span class="sh-kw-tag">${escHtml(kw.cn)}</span>` : '-'}</span></div>
          <div class="sh-expand-row"><span class="sh-expand-label">한국어</span><span class="sh-expand-value">${kw.ko ? `<span class="sh-kw-tag">${escHtml(kw.ko)}</span>` : '-'}</span></div>
          <div class="sh-expand-row"><span class="sh-expand-label">광고</span><span class="sh-expand-value">${item.isAd ? '✅ 광고상품' : '❌ 일반상품'}</span></div>
          <div class="sh-expand-row"><span class="sh-expand-label">로켓배송</span><span class="sh-expand-value">${item.isRocket ? '✅ 로켓배송' : '❌'}</span></div>
        </div>
      `;
    }).join('');
  }

  function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ============================================================
  //  이벤트 핸들러 (이벤트 위임)
  // ============================================================
  document.addEventListener('click', (e) => {
    // ---- 1688 버튼 ----
    const btn1688 = e.target.closest('.sh-btn-1688');
    if (btn1688) {
      e.preventDefault();
      e.stopPropagation();
      const pid = btn1688.dataset.pid;
      const item = allItems.find(i => i.productId === pid);
      if (!item) return;

      btn1688.textContent = '..';
      chrome.runtime.sendMessage({
        type: 'PRE_MATCH', productName: item.title, price: item.price, imageUrl: item.imageUrl,
      }).then(r => {
        const kw = extractKw(item.title);
        const keyword = (r?.success && r.keywords1688?.length) ? r.keywords1688[0].keyword : kw.cn;
        window.open('https://s.1688.com/selloffer/offer_search.htm?keywords=' + encodeURIComponent(keyword), '_blank');
        btn1688.textContent = '1688';
      }).catch(() => {
        const kw = extractKw(item.title);
        window.open('https://s.1688.com/selloffer/offer_search.htm?keywords=' + encodeURIComponent(kw.cn), '_blank');
        btn1688.textContent = '1688';
      });
      return;
    }

    // ---- Ali 버튼 ----
    const btnAli = e.target.closest('.sh-btn-ali');
    if (btnAli) {
      e.preventDefault();
      e.stopPropagation();
      const pid = btnAli.dataset.pid;
      const item = allItems.find(i => i.productId === pid);
      if (!item) return;
      const kw = extractKw(item.title);
      window.open('https://www.aliexpress.com/wholesale?SearchText=' + encodeURIComponent(kw.cn || kw.ko), '_blank');
      return;
    }

    // ---- 저장 버튼 ----
    const btnSave = e.target.closest('[data-action="save"]');
    if (btnSave) {
      e.preventDefault();
      e.stopPropagation();
      const pid = btnSave.dataset.pid;
      const item = allItems.find(i => i.productId === pid);
      if (!item) return;

      const { _box, ...clean } = item;
      chrome.runtime.sendMessage({
        type: 'SAVE_CANDIDATE', product: clean,
        score: calcScore(item), grade: getGrade(calcScore(item)).letter,
      }).catch(() => {});
      savedSet.add(pid);
      btnSave.textContent = '✓저장됨';
      btnSave.className = 'sh-btn sh-btn-saved';
      return;
    }

    // ---- 더보기 토글 ----
    const btnExpand = e.target.closest('[data-action="expand"]');
    if (btnExpand) {
      e.preventDefault();
      e.stopPropagation();
      const pid = btnExpand.dataset.pid;
      const expandEl = document.getElementById('sh-expand-' + pid);
      if (expandEl) {
        expandEl.classList.toggle('sh-open');
        btnExpand.textContent = expandEl.classList.contains('sh-open') ? '접기' : '더보기';
      }
      return;
    }

    // ---- 상품 아이템 클릭 → 쿠팡 상품으로 스크롤 & 하이라이트 ----
    const itemEl = e.target.closest('.sh-item');
    if (itemEl && !e.target.closest('.sh-btn')) {
      e.preventDefault();
      e.stopPropagation();
      const pid = itemEl.dataset.pid;
      const item = allItems.find(i => i.productId === pid);
      if (!item?._box) return;

      // 기존 하이라이트 제거
      document.querySelectorAll('.sh-highlight').forEach(el => el.classList.remove('sh-highlight'));
      document.querySelectorAll('.sh-item-active').forEach(el => el.classList.remove('sh-item-active'));

      // 하이라이트 + 스크롤
      item._box.classList.add('sh-highlight');
      itemEl.classList.add('sh-item-active');
      item._box.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // 3초 후 하이라이트 제거
      setTimeout(() => {
        item._box.classList.remove('sh-highlight');
      }, 3000);
      return;
    }
  }, true);

  // ============================================================
  //  메인 스캔
  // ============================================================
  let lastSig = '';
  let scanTimer = null;

  function doScan(force = false) {
    if (!location.href.includes('/np/search')) {
      // 검색 페이지가 아니면 패널 숨기기
      if (panel) panel.style.display = 'none';
      return;
    }

    const items = parseProducts();
    if (!items.length) {
      if (panel) {
        panel.style.display = '';
        renderPanel([]);
      }
      return;
    }

    const sig = items.map(i => i.productId).slice(0, 5).join(',');
    const isNew = sig !== lastSig || force;

    if (isNew) {
      lastSig = sig;
      allItems = items;
      console.log(`%c[SH] ✅ ${items.length}개 상품 파싱 완료`, 'color:#16a34a;font-weight:bold;');
    }

    // 패널 표시
    if (!panel) createPanel();
    panel.style.display = '';

    if (isNew) {
      renderPanel(items);

      // 서버에 전송
      const q = getQuery();
      const clean = items.map(({ _box, ...c }) => c);
      chrome.runtime.sendMessage({
        type: 'SEARCH_RESULTS_PARSED', query: q, items: clean,
      }).catch(() => {});
    }
  }

  // ============================================================
  //  URL 변경 감지 (SPA 대응)
  // ============================================================
  let lastUrl = location.href;

  function urlCheck() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastSig = '';
      allItems = [];
      document.querySelectorAll('.sh-highlight').forEach(el => el.classList.remove('sh-highlight'));
      setTimeout(() => doScan(true), 300);
      setTimeout(() => doScan(true), 800);
      setTimeout(() => doScan(true), 1500);
    }
  }

  window.addEventListener('popstate', () => setTimeout(urlCheck, 100));
  setInterval(urlCheck, 800);

  // visibilitychange 이벤트 수신 (사이드패널에서 재파싱 요청)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) setTimeout(() => doScan(true), 300);
  });

  // force-reparse 커스텀 이벤트 수신
  document.addEventListener('force-reparse', () => setTimeout(() => doScan(true), 300));

  // MutationObserver (디바운스)
  const observer = new MutationObserver(() => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => doScan(), 600);
  });
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

  // ============================================================
  //  초기 실행
  // ============================================================
  doScan();
  setTimeout(() => doScan(), 500);
  setTimeout(() => doScan(), 1200);
  setTimeout(() => doScan(), 2500);

  // 페이지 타입 알림
  chrome.runtime.sendMessage({ type: 'PAGE_DETECTED', pageType: 'search', url: location.href }).catch(() => {});
})();
