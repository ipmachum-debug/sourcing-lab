/* ============================================================
   Coupang Sourcing Helper — WING Content Script v4.0
   wing.coupang.com 인기상품검색 데이터 자동 수집
   
   전략:
   1) injected-wing.js로 XHR/fetch 응답 가로채기 (가장 안정적)
   2) DOM에서 직접 인기상품 데이터 파싱 (fallback)
   3) 팝업/모달 열림 감지하여 자동 추출
   ============================================================ */
(function () {
  'use strict';

  const VERSION = '4.0';
  let lastSignature = '';
  let debounceTimer = null;
  let injectedReady = false;
  let apiDataReceived = false;

  // ---- 유틸 ----
  function text(el) {
    return (el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function parseNumber(str) {
    if (!str) return 0;
    return parseInt(str.replace(/[^0-9]/g, ''), 10) || 0;
  }

  function parseFloat2(str) {
    if (!str) return 0;
    const m = str.match(/[\d,.]+/);
    return m ? parseFloat(m[0].replace(/,/g, '')) : 0;
  }

  // ============================================================
  //  1) injected-wing.js 인젝트 (XHR/fetch 후킹)
  // ============================================================
  function injectScript() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('injected-wing.js');
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      console.log('[SourcingHelper] WING inject failed:', e.message);
    }
  }

  // ============================================================
  //  2) window.postMessage 수신 (injected-wing.js에서 전달)
  // ============================================================
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.source !== 'COUPANG_WING_INJECTED') return;

    const { type, payload } = event.data;

    if (type === 'WING_INJECTED_READY') {
      injectedReady = true;
      return;
    }

    if (type === 'WING_API_RESPONSE') {
      apiDataReceived = true;
      handleApiResponse(payload);
    }
  });

  function handleApiResponse(payload) {
    if (!payload?.products?.length) return;

    const items = payload.products.map((p, idx) => normalizeProduct(p, idx + 1));
    if (!items.length) return;

    const searchInfo = detectSearchContext();
    const data = {
      source: 'api',
      url: payload.url || location.href,
      keyword: searchInfo.keyword || '',
      category: searchInfo.category || '',
      items,
      pagination: payload.pagination || null,
      capturedAt: new Date().toISOString(),
      pageUrl: location.href,
    };

    sendToBackground(data);
  }

  // ============================================================
  //  3) DOM 기반 인기상품 파싱 (Fallback)
  // ============================================================

  function parseWingPopularProducts() {
    const items = [];

    // -- 전략 A: 테이블 행에서 추출 (WING은 대부분 테이블 레이아웃)
    const tableRows = document.querySelectorAll(
      'table tbody tr, ' +
      '[class*="product"] tr, ' +
      '[class*="item"] tr, ' +
      '[class*="ranking"] tr, ' +
      '[class*="popular"] tr, ' +
      '[class*="best"] tr'
    );

    for (const row of tableRows) {
      if (items.length >= 100) break;
      const item = parseTableRow(row, items.length + 1);
      if (item) items.push(item);
    }

    if (items.length >= 3) return items;

    // -- 전략 B: 카드/리스트 기반 파싱
    const cardSelectors = [
      '[class*="product-card"]',
      '[class*="product-item"]',
      '[class*="item-card"]',
      '[class*="ranking-item"]',
      '[class*="popular-item"]',
      '[class*="best-item"]',
      '[data-product-id]',
      '[data-item-id]',
      'li[class*="product"]',
      'div[class*="product-list"] > div',
    ];

    const cards = document.querySelectorAll(cardSelectors.join(','));
    for (const card of cards) {
      if (items.length >= 100) break;
      const item = parseProductCard(card, items.length + 1);
      if (item) items.push(item);
    }

    return items;
  }

  function parseTableRow(row, rank) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 3) return null;

    const fullText = text(row);
    // 상품명이 없는 헤더 행 등은 건너뛰기
    if (fullText.length < 10) return null;
    if (/^(순위|상품명|브랜드|카테고리|가격|평점)/i.test(fullText)) return null;

    // 각 셀에서 데이터 추출
    let productName = '';
    let productId = '';
    let brand = '';
    let manufacturer = '';
    let price = 0;
    let rating = 0;
    let reviewCount = 0;
    let viewCount = 0;
    let imageUrl = '';
    let rankNum = rank;
    let coupangUrl = '';

    for (const cell of cells) {
      const cellText = text(cell);
      const cellHtml = cell.innerHTML;

      // 이미지
      const img = cell.querySelector('img');
      if (img && !imageUrl) {
        imageUrl = img.src || img.getAttribute('data-src') || '';
      }

      // 링크에서 상품 ID
      const link = cell.querySelector('a[href*="products/"], a[href*="productId="], a[href*="itemId="]');
      if (link) {
        const href = link.href || '';
        const idMatch = href.match(/products?[/=](\d+)|itemId=(\d+)|vendorItemId=(\d+)/i);
        if (idMatch) {
          productId = idMatch[1] || idMatch[2] || idMatch[3] || '';
          coupangUrl = href;
        }
        if (!productName) productName = text(link);
      }

      // 순위 (1~3자리 숫자만 있는 셀)
      if (/^\d{1,3}$/.test(cellText) && parseInt(cellText) <= 200) {
        rankNum = parseInt(cellText);
        continue;
      }

      // 가격 패턴 (원)
      const priceMatch = cellText.match(/([\d,]+)\s*원/);
      if (priceMatch && !price) {
        price = parseNumber(priceMatch[1]);
        continue;
      }

      // 평점 (0~5 사이 소수)
      const ratingMatch = cellText.match(/^(\d\.\d)\s*$/);
      if (ratingMatch) {
        const r = parseFloat(ratingMatch[1]);
        if (r > 0 && r <= 5) { rating = r; continue; }
      }

      // 리뷰 수
      if (/리뷰|review/i.test(cellText)) {
        reviewCount = parseNumber(cellText);
        continue;
      }

      // 조회수
      if (/조회|view/i.test(cellText)) {
        viewCount = parseNumber(cellText);
        continue;
      }

      // 브랜드/제조사
      if (/브랜드/i.test(cell.previousElementSibling?.textContent || '')) {
        brand = cellText;
        continue;
      }
      if (/제조사/i.test(cell.previousElementSibling?.textContent || '')) {
        manufacturer = cellText;
        continue;
      }

      // 상품명 (긴 텍스트로 추정)
      if (cellText.length > 10 && !productName) {
        productName = cellText;
      }
    }

    if (!productName && !productId) return null;

    return {
      productId: productId || '',
      productName: productName || '',
      brand: brand || '',
      manufacturer: manufacturer || '',
      price,
      rating,
      reviewCount,
      viewCount,
      imageUrl,
      rank: rankNum,
      coupangUrl,
      source: 'dom_table',
    };
  }

  function parseProductCard(card, rank) {
    const fullText = text(card);
    if (fullText.length < 10) return null;

    // 상품 ID
    let productId = card.dataset.productId || card.dataset.itemId || '';
    const link = card.querySelector('a[href*="products/"], a[href*="productId="]');
    let coupangUrl = '';
    if (link) {
      const href = link.href || '';
      const idMatch = href.match(/products?[/=](\d+)/i);
      if (idMatch) productId = idMatch[1];
      coupangUrl = href;
    }

    // 상품명
    const nameEl = card.querySelector('[class*="name"], [class*="title"], [class*="Name"], [class*="Title"], h3, h4');
    const productName = text(nameEl) || text(link) || '';

    // 이미지
    const img = card.querySelector('img');
    const imageUrl = img?.src || img?.getAttribute('data-src') || '';

    // 가격
    const priceEl = card.querySelector('[class*="price"], [class*="Price"]');
    const priceMatch = (text(priceEl) || fullText).match(/([\d,]+)\s*원/);
    const price = priceMatch ? parseNumber(priceMatch[1]) : 0;

    // 평점
    const ratingEl = card.querySelector('[class*="rating"], [class*="star"], [class*="Rating"]');
    const ratingMatch = text(ratingEl)?.match(/(\d\.\d)/);
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;

    // 리뷰수
    const reviewEl = card.querySelector('[class*="review"], [class*="count"]');
    const reviewCount = parseNumber(text(reviewEl)?.replace(/[()]/g, ''));

    // 브랜드
    const brandEl = card.querySelector('[class*="brand"], [class*="Brand"]');
    const brand = text(brandEl) || '';

    if (!productName && !productId) return null;

    return {
      productId,
      productName,
      brand,
      manufacturer: '',
      price,
      rating,
      reviewCount,
      viewCount: 0,
      imageUrl,
      rank,
      coupangUrl,
      source: 'dom_card',
    };
  }

  // ============================================================
  //  검색 컨텍스트 감지
  // ============================================================

  function detectSearchContext() {
    let keyword = '';
    let category = '';

    // URL 파라미터에서 키워드 추출
    const url = new URL(location.href);
    keyword = url.searchParams.get('keyword') ||
      url.searchParams.get('q') ||
      url.searchParams.get('query') ||
      url.searchParams.get('searchKeyword') ||
      url.searchParams.get('search') || '';

    // 카테고리 추출
    category = url.searchParams.get('category') ||
      url.searchParams.get('categoryId') ||
      url.searchParams.get('categoryName') || '';

    // DOM에서 검색어 추출
    if (!keyword) {
      const searchInput = document.querySelector(
        'input[type="search"], input[name="keyword"], input[name="q"], ' +
        'input[placeholder*="검색"], input[placeholder*="키워드"], ' +
        'input[class*="search"]'
      );
      if (searchInput) keyword = searchInput.value || '';
    }

    // DOM에서 카테고리 추출
    if (!category) {
      const catEl = document.querySelector(
        '[class*="category-name"], [class*="categoryName"], ' +
        'select[name*="category"] option:checked, ' +
        '[class*="breadcrumb"] a:last-child'
      );
      if (catEl) category = text(catEl);
    }

    // 페이지 타이틀에서 키워드 추출
    if (!keyword) {
      const titleMatch = document.title.match(/[""'](.+?)[""']|검색[:\s]*(.+?)[\s|$-]/);
      if (titleMatch) keyword = titleMatch[1] || titleMatch[2] || '';
    }

    return { keyword: keyword.trim(), category: category.trim() };
  }

  // ============================================================
  //  상품 데이터 정규화
  // ============================================================

  function normalizeProduct(raw, rank) {
    return {
      productId: String(raw.productId || raw.itemId || raw.vendorItemId ||
        raw.sellerProductId || raw.id || ''),
      productName: raw.productName || raw.name || raw.title || raw.itemName || '',
      brand: raw.brand || raw.brandName || '',
      manufacturer: raw.manufacturer || raw.manufacturerName || raw.maker || '',
      price: parseInt(raw.price || raw.salePrice || raw.sellingPrice || 0),
      originalPrice: parseInt(raw.originalPrice || raw.listPrice || raw.msrp || 0),
      rating: parseFloat(raw.rating || raw.avgRating || raw.starRating || 0),
      reviewCount: parseInt(raw.reviewCount || raw.ratingCount || raw.commentCount || 0),
      viewCount: parseInt(raw.viewCount || raw.views || raw.clickCount || 0),
      imageUrl: raw.imageUrl || raw.thumbnailUrl || raw.image || raw.imgUrl || '',
      rank: raw.rank || raw.ranking || raw.position || rank,
      category: raw.category || raw.categoryName || raw.displayCategoryName || '',
      categoryId: raw.categoryId || raw.displayCategoryId || '',
      coupangUrl: raw.coupangUrl || raw.productUrl || raw.url ||
        (raw.productId ? `https://www.coupang.com/vp/products/${raw.productId}` : ''),
      isRocket: raw.isRocket || raw.rocketDelivery || false,
      isFreeShipping: raw.isFreeShipping || raw.freeShipping || false,
      sellerName: raw.sellerName || raw.vendorName || '',
      source: 'api',
    };
  }

  // ============================================================
  //  Background로 데이터 전송
  // ============================================================

  function sendToBackground(data) {
    const signature = JSON.stringify({
      keyword: data.keyword,
      count: data.items.length,
      ids: data.items.slice(0, 5).map(i => i.productId || i.productName),
    });

    if (signature === lastSignature) return;
    lastSignature = signature;

    chrome.runtime.sendMessage({
      type: 'WING_PRODUCTS_PARSED',
      ...data,
    }).catch(() => {});
  }

  // ============================================================
  //  팝업/모달 감지
  // ============================================================

  function detectPopupOpen() {
    // 인기상품검색 팝업이나 모달이 열렸는지 감지
    const popupSelectors = [
      '[class*="modal"][class*="open"]',
      '[class*="popup"][style*="display: block"]',
      '[class*="popup"][style*="visibility: visible"]',
      '[class*="dialog"][open]',
      '[role="dialog"]:not([aria-hidden="true"])',
      '[class*="popular-product"]',
      '[class*="trending"]',
      '[class*="best-seller"]',
      '[class*="ranking-popup"]',
    ];

    return document.querySelector(popupSelectors.join(','));
  }

  // ============================================================
  //  메인 스캔 로직
  // ============================================================

  function scanForProducts() {
    // API 데이터를 이미 받았으면 DOM 스캔 생략
    if (apiDataReceived) return;

    const items = parseWingPopularProducts();
    if (!items.length) return;

    const searchInfo = detectSearchContext();
    const data = {
      source: 'dom',
      url: location.href,
      keyword: searchInfo.keyword || '',
      category: searchInfo.category || '',
      items,
      pagination: null,
      capturedAt: new Date().toISOString(),
      pageUrl: location.href,
    };

    sendToBackground(data);
  }

  function schedulePublish() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scanForProducts, 1200);
  }

  // ============================================================
  //  WING 페이지 감지 및 초기화
  // ============================================================

  function isWingPage() {
    const host = location.hostname;
    return host.includes('wing.coupang.com') || host.includes('m-wing.coupang.com');
  }

  function init() {
    if (!isWingPage()) return;

    // 1) XHR/fetch 후킹 스크립트 인젝트
    injectScript();

    // 2) DOM 변경 감지
    const observer = new MutationObserver(() => {
      schedulePublish();
      // 팝업 열림 감지
      const popup = detectPopupOpen();
      if (popup) schedulePublish();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    // 3) 초기 및 주기적 스캔
    schedulePublish();
    setTimeout(schedulePublish, 2000);
    setTimeout(schedulePublish, 5000);
    setTimeout(schedulePublish, 10000);

    // 4) 이벤트 리스너
    window.addEventListener('load', schedulePublish);
    document.addEventListener('visibilitychange', schedulePublish);

    // 5) WING 로고/상태 알림
    chrome.runtime.sendMessage({
      type: 'WING_PAGE_DETECTED',
      url: location.href,
    }).catch(() => {});
  }

  init();
})();
