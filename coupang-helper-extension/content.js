/* ============================================================
   Coupang Sourcing Helper — Content Script v5.3.0
   "카드별 플로팅" — 검색하면 상품마다 자동으로 미니 UI 표시

   원칙:
   1) 상품카드마다 작은 플로팅 박스 자동 삽입
   2) 화면에는 점수 + 버튼만 (가볍게)
   3) 서버에는 전체 데이터 자동 전송 (무겁게)
   4) 쿠팡 DOM 최소 건드림 — position:relative + 작은 div만
   ============================================================ */
(function () {
  'use strict';
  const VER = '5.3.0';

  // ---- 중복 방지 ----
  if (window.__SH_LOADED__) return;
  window.__SH_LOADED__ = true;

  // 이전 버전 잔재 정리
  document.querySelectorAll(
    '#sh-float-bar,.sh-card-overlay,.sh-databar,.sh-mini-badge,' +
    '.sh-modal-backdrop,.sh-modal-panel,[data-sh-badge],[data-sh-overlay],' +
    '#sh-overlay-styles,#sh-modal-styles,#sh-debug-panel,#sh-version-badge'
  ).forEach(el => el.remove());

  console.log(`%c[SH] v${VER} 카드별 플로팅 모드`, 'color:#16a34a;font-weight:bold;font-size:13px;');

  // ============================================================
  //  CSS 주입 (한번만)
  // ============================================================
  const style = document.createElement('style');
  style.id = 'sh-card-styles';
  style.textContent = `
    /* ---- 카드 오버레이 ---- */
    .sh-card-box {
      position: absolute !important;
      bottom: 4px !important;
      left: 4px !important;
      right: 4px !important;
      z-index: 9999 !important;
      background: rgba(15, 23, 42, 0.92) !important;
      backdrop-filter: blur(8px) !important;
      border-radius: 8px !important;
      padding: 6px 8px !important;
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
      font-family: -apple-system, 'Noto Sans KR', sans-serif !important;
      font-size: 11px !important;
      color: #e2e8f0 !important;
      box-shadow: 0 2px 12px rgba(0,0,0,0.25) !important;
      pointer-events: auto !important;
      box-sizing: border-box !important;
      transition: opacity 0.2s !important;
    }
    .sh-card-box * {
      box-sizing: border-box !important;
      margin: 0 !important;
      padding: 0 !important;
      line-height: 1.3 !important;
    }

    /* 점수 뱃지 */
    .sh-score {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      min-width: 40px !important;
      height: 22px !important;
      border-radius: 5px !important;
      font-size: 11px !important;
      font-weight: 800 !important;
      color: #fff !important;
      flex-shrink: 0 !important;
      letter-spacing: -0.3px !important;
    }
    .sh-score-s { background: #16a34a !important; }
    .sh-score-a { background: #3b82f6 !important; }
    .sh-score-b { background: #f59e0b !important; }
    .sh-score-c { background: #9ca3af !important; }
    .sh-score-d { background: #dc2626 !important; }

    /* 가격 텍스트 */
    .sh-price {
      font-size: 11px !important;
      font-weight: 600 !important;
      color: #fbbf24 !important;
      white-space: nowrap !important;
      flex-shrink: 0 !important;
    }

    /* 리뷰 텍스트 */
    .sh-review {
      font-size: 10px !important;
      color: #94a3b8 !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      flex: 1 !important;
      min-width: 0 !important;
    }

    /* 버튼 그룹 */
    .sh-btns {
      display: flex !important;
      gap: 3px !important;
      flex-shrink: 0 !important;
    }
    .sh-btn {
      height: 22px !important;
      padding: 0 7px !important;
      border: none !important;
      border-radius: 4px !important;
      font-size: 10px !important;
      font-weight: 700 !important;
      cursor: pointer !important;
      color: #fff !important;
      white-space: nowrap !important;
      display: inline-flex !important;
      align-items: center !important;
      transition: opacity 0.15s !important;
    }
    .sh-btn:hover { opacity: 0.8 !important; }
    .sh-btn-1688 { background: #ea580c !important; }
    .sh-btn-ali  { background: #dc2626 !important; }
    .sh-btn-save { background: #4f46e5 !important; }

    /* 상단 상태 바 */
    #sh-topbar {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      z-index: 2147483647 !important;
      height: 32px !important;
      background: linear-gradient(90deg, #1e1b4b, #312e81) !important;
      display: flex !important;
      align-items: center !important;
      padding: 0 16px !important;
      gap: 12px !important;
      font-family: -apple-system, 'Noto Sans KR', sans-serif !important;
      font-size: 11px !important;
      color: #a5b4fc !important;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2) !important;
    }
    #sh-topbar * { margin: 0 !important; padding: 0 !important; }
    .sh-top-ver { color: #34d399 !important; font-weight: 700 !important; }
    .sh-top-count { color: #fbbf24 !important; font-weight: 600 !important; }
    .sh-top-query { color: #c4b5fd !important; }
    .sh-top-status { color: #4ade80 !important; font-size: 10px !important; }
    .sh-top-close {
      margin-left: auto !important;
      background: none !important;
      border: none !important;
      color: #94a3b8 !important;
      cursor: pointer !important;
      font-size: 14px !important;
    }
    .sh-top-close:hover { color: #fff !important; }
    #sh-topbar.sh-hidden { display: none !important; }

    /* 카드에 position:relative 부여 */
    .sh-positioned { position: relative !important; overflow: visible !important; }
  `;
  document.head.appendChild(style);

  // ============================================================
  //  한국어 → 중국어/영어 매핑 (로컬 폴백)
  // ============================================================
  const CN_MAP = {
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
    '샌들':'凉鞋','선글라스':'太阳镜','시계':'手表','립스틱':'口红','로션':'乳液',
    '크림':'面霜','선크림':'防晒霜','샴푸':'洗发水','칼':'刀','주전자':'水壶',
    '머그컵':'马克杯','빨래':'洗衣','건조대':'晾衣架','쓰레기통':'垃圾桶',
    '휴지통':'纸篓','바구니':'篮子','정리함':'收纳盒',
  };
  const EN_MAP = {
    '텀블러':'tumbler','물병':'water bottle','수건':'towel','비누':'soap',
    '수세미':'scrub sponge','스펀지':'sponge','솔':'brush','청소':'cleaning',
    '충전기':'charger','케이블':'cable','이어폰':'earphone','마우스':'mouse',
    '키보드':'keyboard','케이스':'phone case','가방':'bag','백팩':'backpack',
    '장난감':'toy','텐트':'tent','커튼':'curtain','이불':'blanket','베개':'pillow',
    '빗자루':'broom','쓰레받기':'dustpan','세트':'set','빗자루세트':'broom set',
    '먼지떨이':'duster','슬리퍼':'slippers','선글라스':'sunglasses',
  };
  const NOISE = new Set([
    '1개','2개','3개','4개','5개','1P','2P','3P','1+1','2+1',
    '무료배송','당일발송','최저가','특가','세일','할인','핫딜','정품','국내정품',
    '고급','프리미엄','대용량','소용량','미니','슬림','블랙','화이트','그레이',
    '베이지','네이비','핑크','레드','블루','그린',
  ]);

  function extractKw(title) {
    if (!title) return { ko:'', cn:'', en:'' };
    const cleaned = title
      .replace(/\[.*?\]/g,' ').replace(/\(.*?\)/g,' ').replace(/【.*?】/g,' ')
      .replace(/[\/\\|~`!@#$%^&*=+{};:'"<>,.?]/g,' ')
      .replace(/\d+(ml|g|kg|cm|mm|개입|매입|세트|팩|롤)/gi,' ')
      .trim();
    let words = cleaned.split(/\s+/).filter(w => w.length > 1 && !NOISE.has(w) && !/^\d+$/.test(w));
    if (words.length > 2 && /^[a-zA-Z]+$/.test(words[0]) && words[0].length >= 2 && !CN_MAP[words[0]]) {
      words.shift();
    }
    const core = words.slice(0, 3);
    const ko = core.join(' ');
    const cn = core.map(w => CN_MAP[w]).filter(Boolean).join(' ');
    const en = core.map(w => EN_MAP[w]).filter(Boolean).join(' ') || ko;
    return { ko, cn, en };
  }

  // ============================================================
  //  소싱 점수 (로컬 빠른 계산)
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

  function scoreGrade(s) {
    if (s >= 80) return { g:'S', cls:'sh-score-s' };
    if (s >= 65) return { g:'A', cls:'sh-score-a' };
    if (s >= 50) return { g:'B', cls:'sh-score-b' };
    if (s >= 35) return { g:'C', cls:'sh-score-c' };
    return { g:'D', cls:'sh-score-d' };
  }

  // ============================================================
  //  상단 상태 바 (고정)
  // ============================================================
  const topbar = document.createElement('div');
  topbar.id = 'sh-topbar';
  topbar.innerHTML = `
    <span class="sh-top-ver">SH v${VER}</span>
    <span class="sh-top-count" id="shCount">--</span>
    <span class="sh-top-query" id="shQuery">--</span>
    <span class="sh-top-status" id="shStatus">대기</span>
    <button class="sh-top-close" id="shClose" title="닫기">✕</button>
  `;
  document.documentElement.appendChild(topbar);

  document.getElementById('shClose').addEventListener('click', () => {
    topbar.classList.toggle('sh-hidden');
  });

  // ============================================================
  //  상품 파싱 (링크 기반 — 가장 안정적)
  // ============================================================
  const MAX = 36;

  function getQuery() {
    try {
      const u = new URL(location.href);
      return u.searchParams.get('q') || u.searchParams.get('query') || u.searchParams.get('keyword') || '';
    } catch { return ''; }
  }

  function txt(el) { return (el?.textContent || '').replace(/\s+/g,' ').trim(); }
  function num(s) { return parseInt((s||'').replace(/[^0-9]/g,''),10) || 0; }

  function parseAll() {
    const items = [];
    const seen = new Set();
    const query = getQuery();

    for (const a of document.querySelectorAll('a[href*="/vp/products/"]')) {
      if (items.length >= MAX) break;
      const m = (a.href||'').match(/\/vp\/products\/(\d+)/);
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

      // 제목
      const nameEl = box.querySelector('[class*="name"],[class*="title"],[class*="Name"]');
      const title = (nameEl ? txt(nameEl) : '') || txt(a) || (box.querySelector('img')?.alt || '');
      if (!title || title.length < 3) continue;

      // 가격
      let price = 0;
      for (const el of box.querySelectorAll('[class*="price"],[class*="Price"]')) {
        const ms = txt(el).match(/[\d,]+원/g);
        if (ms) { const ns = ms.map(x => num(x)).filter(n => n >= 100 && n < 1e8); if (ns.length) { price = Math.min(...ns); break; } }
      }
      if (!price) {
        const ms = txt(box).match(/[\d,]+원/g);
        if (ms) { const ns = ms.map(x => num(x)).filter(n => n >= 100 && n < 1e8); if (ns.length) price = Math.min(...ns); }
      }

      // 평점/리뷰
      let rating = 0, reviewCount = 0;
      const ratEl = box.querySelector('[class*="rating"],[class*="star"]');
      if (ratEl) { const rm = txt(ratEl).match(/(\d+\.?\d*)/); if (rm) { const v = parseFloat(rm[1]); if (v > 0 && v <= 5) rating = v; } }
      const revEl = box.querySelector('[class*="review"],[class*="count"],.rating-total-count');
      if (revEl) reviewCount = num(txt(revEl).replace(/[()]/g,''));

      const img = box.querySelector('img');
      const isAd = /ad[-_]?badge|광고|sponsored/i.test(box.innerHTML.substring(0,500));
      const isRocket = /로켓배송|로켓와우|rocket/i.test(txt(box));
      const href = a.href.startsWith('http') ? a.href : 'https://www.coupang.com' + a.href;

      items.push({
        productId: pid, title, price, rating, reviewCount,
        url: href,
        imageUrl: img?.src || img?.getAttribute('data-img-src') || '',
        position: items.length + 1, query, isAd, isRocket,
        _container: box,   // DOM 참조 (전송 시 제거)
        _link: a,           // DOM 참조
      });
    }
    return items;
  }

  // ============================================================
  //  카드별 플로팅 UI 삽입
  // ============================================================
  const CARD_ATTR = 'data-sh-card';

  function insertCardUI(item) {
    const box = item._container;
    if (!box || box.getAttribute(CARD_ATTR)) return; // 이미 삽입
    box.setAttribute(CARD_ATTR, item.productId);

    // position:relative 보장
    const pos = getComputedStyle(box).position;
    if (pos === 'static' || pos === '') box.classList.add('sh-positioned');

    const score = calcScore(item);
    const { g, cls } = scoreGrade(score);
    const priceStr = item.price ? item.price.toLocaleString() + '원' : '-';
    const revStr = item.reviewCount > 0 ? `리뷰${item.reviewCount.toLocaleString()}` : '리뷰0';

    const overlay = document.createElement('div');
    overlay.className = 'sh-card-box';
    overlay.innerHTML = `
      <span class="sh-score ${cls}">${g}${score}</span>
      <span class="sh-price">${priceStr}</span>
      <span class="sh-review">${revStr}${item.isAd ? ' AD' : ''}${item.isRocket ? ' 🚀' : ''}</span>
      <span class="sh-btns">
        <button class="sh-btn sh-btn-1688" data-pid="${item.productId}">1688</button>
        <button class="sh-btn sh-btn-save" data-pid="${item.productId}">저장</button>
      </span>
    `;
    box.appendChild(overlay);
  }

  // ============================================================
  //  버튼 이벤트 (이벤트 위임 — document 레벨)
  // ============================================================
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.sh-btn');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    const pid = btn.dataset.pid;
    const item = allItems.find(i => i.productId === pid);
    if (!item) return;

    // 1688 버튼
    if (btn.classList.contains('sh-btn-1688')) {
      btn.textContent = '...';
      // 먼저 AI 사전매칭 시도, 실패하면 로컬 폴백
      chrome.runtime.sendMessage({
        type: 'PRE_MATCH',
        productName: item.title,
        price: item.price,
        imageUrl: item.imageUrl,
      }).then(resp => {
        if (resp?.success && resp.keywords1688?.length) {
          window.open('https://s.1688.com/selloffer/offer_search.htm?keywords=' + encodeURIComponent(resp.keywords1688[0].keyword), '_blank');
        } else {
          const kw = extractKw(item.title);
          window.open('https://s.1688.com/selloffer/offer_search.htm?keywords=' + encodeURIComponent(kw.cn || kw.ko), '_blank');
        }
        btn.textContent = '1688';
      }).catch(() => {
        const kw = extractKw(item.title);
        window.open('https://s.1688.com/selloffer/offer_search.htm?keywords=' + encodeURIComponent(kw.cn || kw.ko), '_blank');
        btn.textContent = '1688';
      });
    }

    // 저장 버튼
    if (btn.classList.contains('sh-btn-save')) {
      chrome.runtime.sendMessage({
        type: 'SAVE_CANDIDATE',
        product: cleanItem(item),
        score: calcScore(item),
        grade: scoreGrade(calcScore(item)).g,
      }).catch(() => {});
      btn.textContent = '✓';
      btn.style.background = '#16a34a';
      setTimeout(() => { btn.textContent = '저장'; btn.style.background = ''; }, 2000);
    }
  }, true); // capture phase

  // ============================================================
  //  서버 전송용 — DOM 참조 제거
  // ============================================================
  function cleanItem(item) {
    const { _container, _link, ...clean } = item;
    return clean;
  }

  // ============================================================
  //  메인 스캔 루프
  // ============================================================
  let allItems = [];
  let lastSig = '';
  let scanTimer = null;

  function doScan() {
    if (!location.href.includes('/np/search')) return;

    const items = parseAll();
    if (!items.length) return;

    // 시그니처 체크 (첫 5개 productId)
    const sig = items.map(i => i.productId).slice(0, 5).join(',');
    if (sig === lastSig) {
      // 이미 같은 결과지만 카드 UI가 부족하면 보충
      const existing = document.querySelectorAll('.sh-card-box').length;
      if (existing < items.length) {
        items.forEach(it => insertCardUI(it));
      }
      return;
    }
    lastSig = sig;
    allItems = items;

    const query = getQuery();

    // 1) 상단바 업데이트
    const countEl = document.getElementById('shCount');
    const queryEl = document.getElementById('shQuery');
    const statusEl = document.getElementById('shStatus');
    if (countEl) countEl.textContent = `${items.length}개`;
    if (queryEl) queryEl.textContent = `"${query}"`;
    if (statusEl) statusEl.textContent = '✓ 파싱완료';

    // 2) 카드별 UI 삽입
    let inserted = 0;
    items.forEach(it => {
      if (!it._container.getAttribute(CARD_ATTR)) {
        insertCardUI(it);
        inserted++;
      }
    });

    console.log(`%c[SH] ✅ ${items.length}개 파싱, ${inserted}개 UI 삽입`, 'color:#16a34a;font-weight:bold;');

    // 3) 서버 전송 (사이드패널 + background)
    const cleanItems = items.map(cleanItem);
    chrome.runtime.sendMessage({
      type: 'SEARCH_RESULTS_PARSED',
      query,
      items: cleanItems,
    }).catch(() => {});
  }

  // ============================================================
  //  URL 변경 감지 (SPA 대응 — history 건드리지 않음)
  // ============================================================
  let lastUrl = location.href;

  function checkUrlChange() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastSig = '';
      // 이전 카드 UI 제거
      document.querySelectorAll('.sh-card-box').forEach(el => el.remove());
      document.querySelectorAll(`[${CARD_ATTR}]`).forEach(el => el.removeAttribute(CARD_ATTR));
      allItems = [];
      const statusEl = document.getElementById('shStatus');
      if (statusEl) statusEl.textContent = '스캔중...';
      // 새 페이지 스캔
      setTimeout(doScan, 300);
      setTimeout(doScan, 800);
      setTimeout(doScan, 1500);
    }
  }

  // popstate + interval (history.pushState 오버라이드 안함!)
  window.addEventListener('popstate', () => setTimeout(checkUrlChange, 100));
  setInterval(checkUrlChange, 800);

  // MutationObserver (디바운스)
  const observer = new MutationObserver(() => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(doScan, 500);
  });
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

  // 초기 스캔 (여러 번 — DOM 로딩 대응)
  doScan();
  setTimeout(doScan, 500);
  setTimeout(doScan, 1200);
  setTimeout(doScan, 2500);

  // 페이지 타입 알림
  chrome.runtime.sendMessage({ type: 'PAGE_DETECTED', pageType: 'search', url: location.href }).catch(() => {});
})();
