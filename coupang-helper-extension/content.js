/* ============================================================
   Coupang Sourcing Helper — Content Script v5.1
   "모달 패널 UX" — 셀록홈즈/아이템스카우트 참고

   v5.1: overlay→모달형 전환
   - 상품 카드: 하단 데이터바 + 우상단 점수 배지 (가림 없음)
   - 클릭시: 우측 고정 모달 패널 열림 (360px)
   - 모달: 상품정보 + 점수 + 1688/알리 + AI 사전매칭 + 저장
   - Auto Scan 유지
   ============================================================ */
(function () {
  console.log('%c[Coupang Sourcing Helper] v5.1.2 모달형 로드됨', 'color:#16a34a;font-weight:bold;font-size:14px;');
  const MAX_ITEMS = 36;
  const BADGE_ATTR = 'data-sh-badge';
  let debounceTimer = null;
  let lastSignature = '';
  let lastUrl = location.href;
  let allParsedItems = [];
  let activeModal = null;  // 현재 열린 모달
  let activeProductId = null;

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
  //  스타일 삽입
  // ============================================================
  function injectStyles() {
    if (document.getElementById('sh-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'sh-modal-styles';
    style.textContent = `
      /* ===== 상품 카드 데이터바 ===== */
      .sh-databar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px 8px;
        background: #f8f9fb;
        border-top: 1px solid #e5e7eb;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 11px;
        color: #374151;
        cursor: pointer;
        transition: background 0.15s;
        position: relative;
        z-index: 50;
      }
      .sh-databar:hover {
        background: #eef2ff;
      }
      .sh-databar-grade {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 22px;
        height: 18px;
        padding: 0 5px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 800;
        color: #fff;
        letter-spacing: -0.3px;
      }
      .sh-grade-s { background: #16a34a; }
      .sh-grade-a { background: #3b82f6; }
      .sh-grade-b { background: #f59e0b; }
      .sh-grade-c { background: #9ca3af; }
      .sh-grade-d { background: #dc2626; }
      .sh-databar-score {
        font-weight: 700;
        font-size: 11px;
        color: #111827;
      }
      .sh-databar-sep {
        color: #d1d5db;
        font-size: 10px;
      }
      .sh-databar-info {
        font-size: 10px;
        color: #6b7280;
      }
      .sh-databar-detail {
        margin-left: auto;
        font-size: 10px;
        color: #6366f1;
        font-weight: 600;
      }

      /* ===== 우상단 미니 배지 ===== */
      .sh-mini-badge {
        position: absolute;
        top: 6px;
        right: 6px;
        z-index: 60;
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 2px 6px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 800;
        color: #fff;
        pointer-events: none;
        box-shadow: 0 1px 4px rgba(0,0,0,0.35);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .sh-relative { position: relative !important; }

      /* ===== 우측 고정 모달 패널 ===== */
      .sh-modal-backdrop {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.18);
        z-index: 99999;
        animation: sh-fadeIn 0.15s ease;
      }
      @keyframes sh-fadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes sh-slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }

      .sh-modal-panel {
        position: fixed;
        top: 0; right: 0;
        width: 380px;
        max-width: 90vw;
        height: 100vh;
        background: #ffffff;
        box-shadow: -4px 0 24px rgba(0,0,0,0.15);
        z-index: 100000;
        overflow-y: auto;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', sans-serif;
        animation: sh-slideIn 0.2s ease;
      }

      /* 모달 헤더 */
      .sh-modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px;
        border-bottom: 1px solid #e5e7eb;
        background: #f8fafc;
        position: sticky;
        top: 0;
        z-index: 10;
      }
      .sh-modal-title {
        font-size: 14px;
        font-weight: 700;
        color: #111827;
      }
      .sh-modal-close {
        width: 28px; height: 28px;
        border: none;
        background: #f3f4f6;
        border-radius: 6px;
        cursor: pointer;
        font-size: 16px;
        color: #6b7280;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s;
      }
      .sh-modal-close:hover { background: #e5e7eb; }

      /* 상품 정보 영역 */
      .sh-modal-product {
        display: flex;
        gap: 12px;
        padding: 14px 16px;
        border-bottom: 1px solid #f3f4f6;
      }
      .sh-modal-img {
        width: 80px; height: 80px;
        border-radius: 8px;
        object-fit: cover;
        background: #f3f4f6;
        flex-shrink: 0;
      }
      .sh-modal-product-info {
        flex: 1;
        min-width: 0;
      }
      .sh-modal-product-name {
        font-size: 13px;
        font-weight: 600;
        color: #111827;
        line-height: 1.4;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        margin-bottom: 6px;
      }
      .sh-modal-product-meta {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        font-size: 11px;
        color: #6b7280;
      }
      .sh-modal-product-meta span {
        background: #f3f4f6;
        padding: 2px 6px;
        border-radius: 4px;
      }

      /* 점수 카드 */
      .sh-score-card {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 16px;
        border-bottom: 1px solid #f3f4f6;
      }
      .sh-score-circle {
        width: 56px; height: 56px;
        border-radius: 50%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: #fff;
        flex-shrink: 0;
      }
      .sh-score-circle-grade {
        font-size: 16px;
        font-weight: 800;
        line-height: 1;
      }
      .sh-score-circle-num {
        font-size: 11px;
        font-weight: 600;
        opacity: 0.9;
        margin-top: 1px;
      }
      .sh-score-details {
        flex: 1;
      }
      .sh-score-label {
        font-size: 13px;
        font-weight: 700;
        color: #111827;
        margin-bottom: 4px;
      }
      .sh-score-desc {
        font-size: 11px;
        color: #6b7280;
        line-height: 1.4;
      }

      /* 액션 버튼 그룹 */
      .sh-action-group {
        padding: 14px 16px;
        border-bottom: 1px solid #f3f4f6;
      }
      .sh-action-group-title {
        font-size: 12px;
        font-weight: 700;
        color: #374151;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .sh-action-btns {
        display: flex;
        gap: 6px;
      }
      .sh-action-btn {
        flex: 1;
        padding: 10px 8px;
        border: none;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        text-align: center;
        transition: all 0.15s;
        color: #fff;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
      }
      .sh-action-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      }
      .sh-action-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none !important;
      }
      .sh-action-btn-icon { font-size: 18px; }
      .sh-action-btn-label { font-size: 11px; }
      .sh-btn-1688 { background: linear-gradient(135deg, #ff6a00, #ee5a00); }
      .sh-btn-ali { background: linear-gradient(135deg, #e43225, #cc2518); }
      .sh-btn-save { background: linear-gradient(135deg, #6366f1, #4f46e5); }
      .sh-btn-ai { background: linear-gradient(135deg, #059669, #047857); }
      .sh-btn-saved { background: #a5b4fc !important; }

      /* AI 사전매칭 검색어 패널 */
      .sh-prematch-section {
        padding: 14px 16px;
        border-bottom: 1px solid #f3f4f6;
        display: none;
      }
      .sh-prematch-section.sh-active { display: block; }
      .sh-prematch-title {
        font-size: 12px;
        font-weight: 700;
        color: #374151;
        margin-bottom: 8px;
      }
      .sh-prematch-loading {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px;
        background: #f8fafc;
        border-radius: 8px;
        font-size: 12px;
        color: #6b7280;
      }
      .sh-prematch-loading .sh-spinner {
        width: 16px; height: 16px;
        border: 2px solid #e5e7eb;
        border-top-color: #6366f1;
        border-radius: 50%;
        animation: sh-spin 0.6s linear infinite;
      }
      @keyframes sh-spin { to { transform: rotate(360deg); } }

      .sh-kw-list { list-style: none; padding: 0; margin: 0; }
      .sh-kw-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        margin-bottom: 4px;
        background: #f8fafc;
        border-radius: 6px;
        cursor: pointer;
        transition: background 0.12s;
        text-decoration: none;
      }
      .sh-kw-item:hover { background: #eef2ff; }
      .sh-kw-num {
        width: 20px; height: 20px;
        border-radius: 50%;
        background: #ff6a00;
        color: #fff;
        font-size: 10px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .sh-kw-num.sh-kw-ali { background: #e43225; }
      .sh-kw-text {
        flex: 1;
        font-size: 12px;
        font-weight: 600;
        color: #111827;
      }
      .sh-kw-tag {
        font-size: 9px;
        color: #9ca3af;
        background: #f3f4f6;
        padding: 1px 5px;
        border-radius: 3px;
      }
      .sh-kw-arrow {
        color: #d1d5db;
        font-size: 12px;
      }
      .sh-tips-box {
        margin-top: 8px;
        padding: 8px 10px;
        background: #eff6ff;
        border-radius: 6px;
        font-size: 11px;
        color: #3b82f6;
        line-height: 1.4;
      }

      /* AI 분석 결과 */
      .sh-ai-section {
        padding: 14px 16px;
        border-bottom: 1px solid #f3f4f6;
        display: none;
      }
      .sh-ai-section.sh-active { display: block; }
      .sh-ai-result {
        padding: 10px 12px;
        background: #f0fdf4;
        border-radius: 8px;
        font-size: 12px;
        color: #166534;
        line-height: 1.5;
      }
      .sh-ai-result.sh-error {
        background: #fef2f2;
        color: #dc2626;
      }
    `;
    document.head.appendChild(style);
  }

  // ============================================================
  //  빠른 소싱 점수 계산 (AI 없이)
  // ============================================================
  function quickScore(item, allItems) {
    let score = 50;
    if (item.reviewCount < 50) score += 20;
    else if (item.reviewCount < 200) score += 12;
    else if (item.reviewCount < 500) score += 5;
    else if (item.reviewCount > 2000) score -= 10;
    if (item.rating >= 4.5) score += 5;
    else if (item.rating < 3.5 && item.rating > 0) score -= 5;
    if (item.price >= 5000 && item.price <= 30000) score += 10;
    else if (item.price > 0 && item.price < 3000) score -= 5;
    else if (item.price > 50000) score -= 5;
    if (item.isAd) score -= 8;
    if (allItems.length > 3) {
      const avgReview = allItems.reduce((a, b) => a + b.reviewCount, 0) / allItems.length;
      if (item.reviewCount < avgReview * 0.3) score += 8;
    }
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  function scoreGrade(score) {
    if (score >= 80) return { grade: 'S', cls: 'sh-grade-s', color: '#16a34a', label: '추천 (경쟁 낮고 기회 높음)' };
    if (score >= 65) return { grade: 'A', cls: 'sh-grade-a', color: '#3b82f6', label: '양호 (소싱 검토 가치 있음)' };
    if (score >= 50) return { grade: 'B', cls: 'sh-grade-b', color: '#f59e0b', label: '보통 (추가 분석 필요)' };
    if (score >= 35) return { grade: 'C', cls: 'sh-grade-c', color: '#9ca3af', label: '주의 (경쟁 치열)' };
    return { grade: 'D', cls: 'sh-grade-d', color: '#dc2626', label: '비추천 (경쟁 과열)' };
  }

  // ============================================================
  //  스마트 키워드 (폴백용)
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
  //  상품 카드에 데이터바 + 배지 삽입 (상품 가림 없음)
  // ============================================================
  function insertDataBar(container, item, allItems) {
    if (container.getAttribute(BADGE_ATTR)) return;
    container.setAttribute(BADGE_ATTR, item.productId || 'true');

    const pos = getComputedStyle(container).position;
    if (pos === 'static' || pos === '') {
      container.classList.add('sh-relative');
    }

    const score = quickScore(item, allItems);
    const { grade, cls, color } = scoreGrade(score);

    // 1) 우상단 미니 배지
    const badge = document.createElement('div');
    badge.className = 'sh-mini-badge';
    badge.style.background = color;
    badge.textContent = `${grade} ${score}`;
    container.appendChild(badge);

    // 2) 하단 데이터바
    const bar = document.createElement('div');
    bar.className = 'sh-databar';
    bar.innerHTML = `
      <span class="sh-databar-grade ${cls}">${grade}</span>
      <span class="sh-databar-score">${score}점</span>
      <span class="sh-databar-sep">|</span>
      <span class="sh-databar-info">${item.reviewCount > 0 ? '리뷰 ' + item.reviewCount.toLocaleString() : '리뷰 없음'}</span>
      <span class="sh-databar-sep">|</span>
      <span class="sh-databar-info">${formatPrice(item.price)}</span>
      ${item.isAd ? '<span class="sh-databar-info" style="color:#ef4444;">AD</span>' : ''}
      <span class="sh-databar-detail">분석 ></span>
    `;
    container.appendChild(bar);

    // 3) 클릭 → 모달 열기
    bar.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      openModal(item, score, grade, cls, color, allItems);
    });

    // 미니 배지도 클릭 가능하게
    badge.style.pointerEvents = 'auto';
    badge.style.cursor = 'pointer';
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      openModal(item, score, grade, cls, color, allItems);
    });
  }

  // ============================================================
  //  모달 패널 열기
  // ============================================================
  function openModal(item, score, grade, cls, color, allItems) {
    // 같은 상품이면 닫기 (토글)
    if (activeProductId === item.productId && activeModal) {
      closeModal();
      return;
    }

    // 기존 모달 닫기
    closeModal();

    activeProductId = item.productId;
    const { label } = scoreGrade(score);
    const cnKw = toChinese(item.title);
    const koKw = extractKeyword(item.title);

    // 백드롭
    const backdrop = document.createElement('div');
    backdrop.className = 'sh-modal-backdrop';
    backdrop.addEventListener('click', () => closeModal());

    // 패널
    const panel = document.createElement('div');
    panel.className = 'sh-modal-panel';
    panel.addEventListener('click', (e) => e.stopPropagation());

    panel.innerHTML = `
      <!-- 헤더 -->
      <div class="sh-modal-header">
        <span class="sh-modal-title">AI 소싱 분석</span>
        <button class="sh-modal-close" id="shModalClose">&times;</button>
      </div>

      <!-- 상품 정보 -->
      <div class="sh-modal-product">
        <img class="sh-modal-img" src="${item.imageUrl || ''}" alt="" onerror="this.style.display='none'">
        <div class="sh-modal-product-info">
          <div class="sh-modal-product-name">${item.title || '제목 없음'}</div>
          <div class="sh-modal-product-meta">
            <span>${formatPrice(item.price)}</span>
            ${item.rating > 0 ? `<span>${item.rating}점</span>` : ''}
            <span>리뷰 ${item.reviewCount.toLocaleString()}</span>
            ${item.isAd ? '<span style="color:#ef4444;">AD</span>' : ''}
            ${item.isRocket ? '<span style="color:#3b82f6;">로켓</span>' : ''}
          </div>
        </div>
      </div>

      <!-- 점수 카드 -->
      <div class="sh-score-card">
        <div class="sh-score-circle" style="background:${color}">
          <div class="sh-score-circle-grade">${grade}</div>
          <div class="sh-score-circle-num">${score}점</div>
        </div>
        <div class="sh-score-details">
          <div class="sh-score-label">소싱점수 ${score} — ${grade}등급</div>
          <div class="sh-score-desc">${label}</div>
        </div>
      </div>

      <!-- 액션 버튼 -->
      <div class="sh-action-group">
        <div class="sh-action-group-title">소싱 액션</div>
        <div class="sh-action-btns">
          <button class="sh-action-btn sh-btn-1688" id="shBtn1688">
            <span class="sh-action-btn-icon">🏭</span>
            <span class="sh-action-btn-label">1688</span>
          </button>
          <button class="sh-action-btn sh-btn-ali" id="shBtnAli">
            <span class="sh-action-btn-icon">🌐</span>
            <span class="sh-action-btn-label">알리</span>
          </button>
          <button class="sh-action-btn sh-btn-ai" id="shBtnAI">
            <span class="sh-action-btn-icon">🤖</span>
            <span class="sh-action-btn-label">AI 분석</span>
          </button>
          <button class="sh-action-btn sh-btn-save" id="shBtnSave">
            <span class="sh-action-btn-icon">💾</span>
            <span class="sh-action-btn-label">저장</span>
          </button>
        </div>
      </div>

      <!-- AI 사전매칭 검색어 (1688 버튼 클릭시) -->
      <div class="sh-prematch-section" id="shPrematchSection">
        <div class="sh-prematch-title">AI 추천 1688 검색어</div>
        <div id="shPrematchContent">
          <div class="sh-prematch-loading">
            <div class="sh-spinner"></div>
            <span>AI가 최적 검색어를 생성 중...</span>
          </div>
        </div>
      </div>

      <!-- AI 분석 결과 (AI 버튼 클릭시) -->
      <div class="sh-ai-section" id="shAISection">
        <div class="sh-prematch-title">AI 소싱 분석</div>
        <div id="shAIContent">
          <div class="sh-prematch-loading">
            <div class="sh-spinner"></div>
            <span>AI 분석 중...</span>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
    activeModal = { backdrop, panel };

    // ---- 이벤트 바인딩 ----
    panel.querySelector('#shModalClose').addEventListener('click', closeModal);

    // 캐시
    let preMatchCache = null;

    // [1688 버튼] → AI 사전매칭 → 검색어 패널
    panel.querySelector('#shBtn1688').addEventListener('click', async () => {
      const section = panel.querySelector('#shPrematchSection');
      const content = panel.querySelector('#shPrematchContent');
      const btn = panel.querySelector('#shBtn1688');

      // 이미 캐시 있으면 토글
      if (preMatchCache) {
        section.classList.toggle('sh-active');
        return;
      }

      section.classList.add('sh-active');
      content.innerHTML = `<div class="sh-prematch-loading"><div class="sh-spinner"></div><span>AI가 최적 검색어를 생성 중...</span></div>`;
      btn.querySelector('.sh-action-btn-label').textContent = 'AI...';
      btn.disabled = true;

      try {
        const resp = await chrome.runtime.sendMessage({
          type: 'PRE_MATCH',
          productName: item.title,
          price: item.price,
          imageUrl: item.imageUrl,
        });

        btn.querySelector('.sh-action-btn-label').textContent = '1688';
        btn.disabled = false;

        if (resp && resp.success && resp.keywords1688?.length) {
          preMatchCache = resp;
          renderPreMatchKeywords(content, resp, cnKw, koKw);
        } else {
          // AI 실패 → 폴백: 기본 검색어로 바로 열기
          const kw = cnKw || koKw;
          content.innerHTML = `
            <div class="sh-tips-box">AI 생성 실패. 기본 검색어로 열립니다.</div>
          `;
          window.open(`https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(kw)}`, '_blank');
        }
      } catch (err) {
        btn.querySelector('.sh-action-btn-label').textContent = '1688';
        btn.disabled = false;
        const kw = cnKw || koKw;
        content.innerHTML = `<div class="sh-tips-box">네트워크 오류. 기본 검색어로 열립니다.</div>`;
        window.open(`https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(kw)}`, '_blank');
      }
    });

    // [알리 버튼]
    panel.querySelector('#shBtnAli').addEventListener('click', () => {
      if (preMatchCache?.keywordsAliExpress?.length) {
        window.open(`https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(preMatchCache.keywordsAliExpress[0].keyword)}`, '_blank');
      } else {
        window.open(`https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(koKw)}`, '_blank');
      }
    });

    // [저장 버튼]
    panel.querySelector('#shBtnSave').addEventListener('click', () => {
      const btn = panel.querySelector('#shBtnSave');
      btn.classList.add('sh-btn-saved');
      btn.querySelector('.sh-action-btn-label').textContent = '저장됨';
      btn.disabled = true;
      chrome.runtime.sendMessage({
        type: 'SAVE_CANDIDATE',
        product: item,
        score: score,
        grade: grade,
      }).catch(() => {});
    });

    // [AI 분석 버튼]
    panel.querySelector('#shBtnAI').addEventListener('click', async () => {
      const section = panel.querySelector('#shAISection');
      const content = panel.querySelector('#shAIContent');
      const btn = panel.querySelector('#shBtnAI');

      section.classList.add('sh-active');
      content.innerHTML = `<div class="sh-prematch-loading"><div class="sh-spinner"></div><span>AI 소싱 분석 중...</span></div>`;
      btn.querySelector('.sh-action-btn-label').textContent = '분석중';
      btn.disabled = true;

      try {
        const resp = await chrome.runtime.sendMessage({
          type: 'REQUEST_AI_ANALYSIS',
          product: item,
          score: score,
        });

        btn.querySelector('.sh-action-btn-label').textContent = 'AI 분석';
        btn.disabled = false;

        if (resp && resp.success) {
          const data = resp.data;
          const summary = resp.summary || '분석 완료';
          let detailHtml = `<div class="sh-ai-result">`;
          detailHtml += `<div style="font-weight:700;margin-bottom:6px;">📊 ${summary}</div>`;
          if (data?.beginnerFit) {
            detailHtml += `<div>초보 적합도: ${data.beginnerFit.score || '-'}점</div>`;
            if (data.beginnerFit.reason) detailHtml += `<div style="font-size:11px;color:#4b5563;">${data.beginnerFit.reason}</div>`;
          }
          if (data?.risks?.length) {
            detailHtml += `<div style="margin-top:6px;color:#dc2626;">⚠️ 리스크: ${data.risks.join(', ')}</div>`;
          }
          if (data?.recommendations?.length) {
            detailHtml += `<div style="margin-top:6px;">💡 ${data.recommendations.join(' / ')}</div>`;
          }
          detailHtml += `</div>`;
          content.innerHTML = detailHtml;
        } else {
          content.innerHTML = `<div class="sh-ai-result sh-error">AI 분석 실패: ${resp?.error || '서버 오류'}</div>`;
        }
      } catch (err) {
        btn.querySelector('.sh-action-btn-label').textContent = 'AI 분석';
        btn.disabled = false;
        content.innerHTML = `<div class="sh-ai-result sh-error">네트워크 오류</div>`;
      }
    });
  }

  // ============================================================
  //  사전매칭 검색어 렌더링
  // ============================================================
  function renderPreMatchKeywords(container, resp, cnKw, koKw) {
    const kws = resp.keywords1688 || [];
    const aliKws = resp.keywordsAliExpress || [];

    let html = `<ul class="sh-kw-list">`;

    // 1688 검색어
    kws.forEach((k, i) => {
      html += `
        <li>
          <a class="sh-kw-item" href="https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(k.keyword)}" target="_blank" rel="noreferrer">
            <span class="sh-kw-num">${i + 1}</span>
            <span class="sh-kw-text">${k.keyword}</span>
            ${k.strategy ? `<span class="sh-kw-tag">${k.strategy}</span>` : ''}
            <span class="sh-kw-arrow">›</span>
          </a>
        </li>`;
    });

    // AliExpress 검색어
    if (aliKws.length) {
      html += `<li style="padding:8px 0 4px;font-size:12px;font-weight:700;color:#e43225;">AliExpress 검색어</li>`;
      aliKws.forEach((k, i) => {
        html += `
          <li>
            <a class="sh-kw-item" href="https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(k.keyword)}" target="_blank" rel="noreferrer">
              <span class="sh-kw-num sh-kw-ali">${i + 1}</span>
              <span class="sh-kw-text">${k.keyword}</span>
              <span class="sh-kw-arrow">›</span>
            </a>
          </li>`;
      });
    }

    html += `</ul>`;

    // 정제 정보
    if (resp.coreProduct) {
      html += `<div class="sh-tips-box">
        <strong>핵심 품목:</strong> ${resp.coreProduct}<br>
        ${resp.normalizedName ? `<strong>정제명:</strong> ${resp.normalizedName}<br>` : ''}
        ${resp.searchTips ? `💡 ${resp.searchTips}` : ''}
      </div>`;
    }

    container.innerHTML = html;
  }

  // ============================================================
  //  모달 닫기
  // ============================================================
  function closeModal() {
    if (activeModal) {
      activeModal.backdrop.remove();
      activeModal.panel.remove();
      activeModal = null;
      activeProductId = null;
    }
  }

  // ESC 키로 모달 닫기
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

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
    closeModal();
    document.querySelectorAll(`[${BADGE_ATTR}]`).forEach(el => {
      el.removeAttribute(BADGE_ATTR);
      el.querySelectorAll('.sh-databar, .sh-mini-badge').forEach(o => o.remove());
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

  // ---- 파싱 헬퍼 ----
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

    // 각 상품 카드에 데이터바 + 배지 삽입
    for (const item of allParsedItems) {
      if (item._container) {
        insertDataBar(item._container, item, allParsedItems);
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
