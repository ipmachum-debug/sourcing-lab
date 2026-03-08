/* ============================================================
   Coupang Sourcing Helper — Content Script v5.3.1
   "카드별 미니 태그" — 검색하면 상품마다 작은 태그 1개만

   원칙:
   1) 상품 링크 바로 아래에 작은 태그 1줄만 (중복 방지 철저)
   2) 쿠팡 DOM 최소 건드림 — insertAdjacentHTML만 사용
   3) 서버에는 전체 데이터 자동 전송
   4) 사이드패널 호환 유지
   ============================================================ */
(function () {
  'use strict';
  const VER = '5.3.1';

  // ---- 중복 방지 ----
  if (window.__SH_LOADED__) return;
  window.__SH_LOADED__ = true;

  // 모든 이전 버전 잔재 제거
  document.querySelectorAll(
    '#sh-float-bar,#sh-topbar,#sh-card-styles,' +
    '.sh-card-overlay,.sh-databar,.sh-mini-badge,.sh-card-box,' +
    '.sh-modal-backdrop,.sh-modal-panel,.sh-hover-highlight,' +
    '[data-sh-badge],[data-sh-overlay],[data-sh-card],' +
    '#sh-overlay-styles,#sh-modal-styles,#sh-debug-panel,#sh-version-badge'
  ).forEach(el => el.remove());

  console.log(`%c[SH] v${VER} 로드`, 'color:#16a34a;font-weight:bold;');

  // ============================================================
  //  CSS (최소한)
  // ============================================================
  const css = document.createElement('style');
  css.id = 'sh-styles-v531';
  css.textContent = `
    .sh-tag {
      display: inline-flex !important;
      align-items: center !important;
      gap: 5px !important;
      margin: 3px 0 !important;
      padding: 3px 8px !important;
      background: #1e1b4b !important;
      border-radius: 4px !important;
      font-family: -apple-system, 'Noto Sans KR', sans-serif !important;
      font-size: 11px !important;
      line-height: 18px !important;
      color: #e2e8f0 !important;
      white-space: nowrap !important;
      cursor: default !important;
      vertical-align: middle !important;
    }
    .sh-tag * { margin: 0 !important; padding: 0 !important; }
    .sh-g { font-weight: 800 !important; padding: 1px 5px !important; border-radius: 3px !important; color: #fff !important; font-size: 10px !important; }
    .sh-gs { background: #16a34a !important; }
    .sh-ga { background: #3b82f6 !important; }
    .sh-gb { background: #f59e0b !important; }
    .sh-gc { background: #9ca3af !important; }
    .sh-gd { background: #dc2626 !important; }
    .sh-p { color: #fbbf24 !important; font-weight: 600 !important; }
    .sh-r { color: #94a3b8 !important; font-size: 10px !important; }
    .sh-b {
      display: inline-flex !important; align-items: center !important;
      height: 18px !important; padding: 0 6px !important;
      border: none !important; border-radius: 3px !important;
      font-size: 10px !important; font-weight: 700 !important;
      cursor: pointer !important; color: #fff !important;
    }
    .sh-b:hover { opacity: 0.8 !important; }
    .sh-b1 { background: #ea580c !important; }
    .sh-b2 { background: #4f46e5 !important; }
  `;
  document.head.appendChild(css);

  // ============================================================
  //  키워드 매핑 (로컬)
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

  function kw(title) {
    if (!title) return '';
    const c = title.replace(/\[.*?\]|\(.*?\)|【.*?】/g,' ')
      .replace(/[\/\\|~`!@#$%^&*=+{};:'"<>,.?]/g,' ')
      .replace(/\d+(ml|g|kg|cm|mm|개입|매입|세트|팩|롤)/gi,' ').trim();
    let w = c.split(/\s+/).filter(x => x.length > 1 && !NOISE.has(x) && !/^\d+$/.test(x));
    if (w.length > 2 && /^[a-zA-Z]+$/.test(w[0]) && !CN[w[0]]) w.shift();
    return w.slice(0,3).map(x => CN[x]).filter(Boolean).join(' ') || w.slice(0,3).join(' ');
  }

  // ============================================================
  //  점수
  // ============================================================
  function score(item) {
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
  function grd(s) {
    if (s >= 80) return ['S','sh-gs'];
    if (s >= 65) return ['A','sh-ga'];
    if (s >= 50) return ['B','sh-gb'];
    if (s >= 35) return ['C','sh-gc'];
    return ['D','sh-gd'];
  }

  // ============================================================
  //  상품 파싱
  // ============================================================
  const MAX = 36;
  const MARK = 'data-sh';  // 마킹 속성 — 이미 태그 삽입된 링크

  function getQ() {
    try {
      const u = new URL(location.href);
      return u.searchParams.get('q') || u.searchParams.get('query') || u.searchParams.get('keyword') || '';
    } catch { return ''; }
  }
  function tx(el) { return (el?.textContent||'').replace(/\s+/g,' ').trim(); }
  function nm(s) { return parseInt((s||'').replace(/[^0-9]/g,''),10)||0; }

  function parse() {
    const items = [], seen = new Set(), q = getQ();

    for (const a of document.querySelectorAll('a[href*="/vp/products/"]')) {
      if (items.length >= MAX) break;
      const m = (a.href||'').match(/\/vp\/products\/(\d+)/);
      if (!m) continue;
      const pid = m[1];
      if (seen.has(pid)) continue;
      seen.add(pid);

      // 컨테이너 = LI 또는 data-productId 가진 요소
      let box = a;
      for (let i = 0; i < 6 && box.parentElement; i++) {
        box = box.parentElement;
        if (box.tagName === 'LI' || box.dataset?.productId) break;
      }

      const nameEl = box.querySelector('[class*="name"],[class*="title"],[class*="Name"]');
      const title = (nameEl ? tx(nameEl) : '') || tx(a) || (box.querySelector('img')?.alt||'');
      if (!title || title.length < 3) continue;

      let price = 0;
      for (const el of box.querySelectorAll('[class*="price"],[class*="Price"]')) {
        const ms = tx(el).match(/[\d,]+원/g);
        if (ms) { const ns = ms.map(x=>nm(x)).filter(n=>n>=100&&n<1e8); if (ns.length) { price=Math.min(...ns); break; } }
      }
      if (!price) {
        const ms = tx(box).match(/[\d,]+원/g);
        if (ms) { const ns = ms.map(x=>nm(x)).filter(n=>n>=100&&n<1e8); if (ns.length) price=Math.min(...ns); }
      }

      let rating = 0, reviewCount = 0;
      const ratEl = box.querySelector('[class*="rating"],[class*="star"]');
      if (ratEl) { const rm = tx(ratEl).match(/(\d+\.?\d*)/); if (rm) { const v=parseFloat(rm[1]); if (v>0&&v<=5) rating=v; } }
      const revEl = box.querySelector('[class*="review"],[class*="count"],.rating-total-count');
      if (revEl) reviewCount = nm(tx(revEl).replace(/[()]/g,''));

      const img = box.querySelector('img');
      const isAd = /ad[-_]?badge|광고|sponsored/i.test(box.innerHTML.substring(0,500));
      const isRocket = /로켓배송|로켓와우|rocket/i.test(tx(box));
      const href = a.href.startsWith('http') ? a.href : 'https://www.coupang.com' + a.href;

      items.push({
        productId: pid, title, price, rating, reviewCount,
        url: href, imageUrl: img?.src || img?.getAttribute('data-img-src') || '',
        position: items.length + 1, query: q, isAd, isRocket,
        _firstLink: a,  // 이 상품의 첫 번째 링크 (태그 삽입 기준점)
      });
    }
    return items;
  }

  // ============================================================
  //  태그 삽입 — 링크 바로 뒤에 1줄 태그
  // ============================================================
  function insertTag(item) {
    const a = item._firstLink;
    // 이미 삽입 확인 (링크 자체에 마킹)
    if (a.getAttribute(MARK)) return false;
    a.setAttribute(MARK, item.productId);

    const s = score(item);
    const [g, gc] = grd(s);
    const pr = item.price ? item.price.toLocaleString()+'원' : '';
    const rv = item.reviewCount > 0 ? '리뷰'+item.reviewCount.toLocaleString() : '';

    // 태그 HTML
    const tag = document.createElement('span');
    tag.className = 'sh-tag';
    tag.innerHTML =
      `<span class="sh-g ${gc}">${g}${s}</span>` +
      (pr ? `<span class="sh-p">${pr}</span>` : '') +
      (rv ? `<span class="sh-r">${rv}</span>` : '') +
      (item.isAd ? '<span class="sh-r">AD</span>' : '') +
      `<button class="sh-b sh-b1" data-pid="${item.productId}">1688</button>` +
      `<button class="sh-b sh-b2" data-pid="${item.productId}">저장</button>`;

    // 링크의 부모 안에서, 링크 바로 뒤에 삽입
    a.parentElement.insertBefore(tag, a.nextSibling);
    return true;
  }

  // ============================================================
  //  버튼 클릭 (이벤트 위임)
  // ============================================================
  let allItems = [];

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.sh-b');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    const pid = btn.dataset.pid;
    const item = allItems.find(i => i.productId === pid);
    if (!item) return;

    if (btn.classList.contains('sh-b1')) {
      // 1688
      btn.textContent = '..';
      chrome.runtime.sendMessage({
        type: 'PRE_MATCH', productName: item.title, price: item.price, imageUrl: item.imageUrl,
      }).then(r => {
        const k = (r?.success && r.keywords1688?.length) ? r.keywords1688[0].keyword : kw(item.title);
        window.open('https://s.1688.com/selloffer/offer_search.htm?keywords=' + encodeURIComponent(k), '_blank');
        btn.textContent = '1688';
      }).catch(() => {
        window.open('https://s.1688.com/selloffer/offer_search.htm?keywords=' + encodeURIComponent(kw(item.title)), '_blank');
        btn.textContent = '1688';
      });
    }

    if (btn.classList.contains('sh-b2')) {
      // 저장
      const { _firstLink, ...clean } = item;
      chrome.runtime.sendMessage({
        type: 'SAVE_CANDIDATE', product: clean,
        score: score(item), grade: grd(score(item))[0],
      }).catch(() => {});
      btn.textContent = '✓';
      btn.style.background = '#16a34a';
      setTimeout(() => { btn.textContent = '저장'; btn.style.background = ''; }, 2000);
    }
  }, true);

  // ============================================================
  //  메인 스캔
  // ============================================================
  let lastSig = '';
  let timer = null;

  function scan() {
    if (!location.href.includes('/np/search')) return;
    const items = parse();
    if (!items.length) return;

    const sig = items.map(i => i.productId).slice(0,5).join(',');
    const isNew = sig !== lastSig;
    if (isNew) {
      lastSig = sig;
      allItems = items;
    }

    // 태그 삽입 (중복 체크 내장)
    let count = 0;
    (isNew ? items : allItems).forEach(it => { if (insertTag(it)) count++; });

    if (count > 0 || isNew) {
      console.log(`%c[SH] ✅ ${allItems.length}개 파싱, ${count}개 태그 삽입`, 'color:#16a34a;font-weight:bold;');
    }

    // 서버 전송 (새 데이터일 때만)
    if (isNew) {
      const q = getQ();
      const clean = items.map(({ _firstLink, ...c }) => c);
      chrome.runtime.sendMessage({
        type: 'SEARCH_RESULTS_PARSED', query: q, items: clean,
      }).catch(() => {});
    }
  }

  // ============================================================
  //  URL 변경 감지
  // ============================================================
  let lastUrl = location.href;

  function urlCheck() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastSig = '';
      allItems = [];
      // 이전 태그 제거
      document.querySelectorAll('.sh-tag').forEach(el => el.remove());
      document.querySelectorAll(`[${MARK}]`).forEach(el => el.removeAttribute(MARK));
      setTimeout(scan, 300);
      setTimeout(scan, 800);
      setTimeout(scan, 1500);
    }
  }

  window.addEventListener('popstate', () => setTimeout(urlCheck, 100));
  setInterval(urlCheck, 800);

  // MutationObserver (디바운스)
  const obs = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(scan, 500); });
  obs.observe(document.body || document.documentElement, { childList: true, subtree: true });

  // 초기 스캔
  scan();
  setTimeout(scan, 500);
  setTimeout(scan, 1200);
  setTimeout(scan, 2500);

  chrome.runtime.sendMessage({ type: 'PAGE_DETECTED', pageType: 'search', url: location.href }).catch(() => {});
})();
