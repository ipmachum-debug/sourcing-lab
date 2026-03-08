/* ============================================================
   Coupang Sourcing Helper — Content Script v4.2
   쿠팡 검색결과 페이지에서 상품 데이터를 파싱하여 background로 전달

   v4.2: 검색 키워드 불일치 문제 근본 해결
   - URL 변경 감지 (SPA navigation 대응: pushState/replaceState/popstate 후킹)
   - 향상된 검색어 추출 (q, query, keyword, component, searchId 등)
   - 검색 입력창 값과 URL 파라미터 크로스 체크
   - 디바운스 + URL 기반 시그니처로 정확한 변경 감지
   - 더 강건한 HTML 구조 역추적 파싱
   ============================================================ */
(function () {
  const MAX_ITEMS = 36;
  let debounceTimer = null;
  let lastSignature = '';
  let lastUrl = location.href; // URL 변경 추적용

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

  // ============================================================
  //  검색어 추출 — 다중 소스 교차 검증
  // ============================================================
  function getQuery() {
    const url = new URL(location.href);
    
    // 1) URL 파라미터에서 추출 (여러 가능한 파라미터명)
    const urlQuery = url.searchParams.get('q') 
      || url.searchParams.get('query') 
      || url.searchParams.get('keyword')
      || url.searchParams.get('component')
      || '';
    
    // 2) 검색 입력창에서 추출 (다양한 셀렉터 시도)
    const inputQuery = (
      document.querySelector('input.search-input')?.value
      || document.querySelector('input[name="q"]')?.value
      || document.querySelector('input[type="search"]')?.value
      || document.querySelector('input[name="query"]')?.value
      || document.querySelector('input[name="keyword"]')?.value
      || document.querySelector('input[data-search-input]')?.value
      || document.querySelector('.header-search input')?.value
      || document.querySelector('#headerSearchKeyword')?.value
      // 쿠팡 신규 UI 셀렉터
      || document.querySelector('input[class*="search"]')?.value
      || document.querySelector('[class*="SearchBar"] input')?.value
      || ''
    ).trim();

    // 3) 페이지 타이틀에서 추출 ("검색어 - 쿠팡!" 패턴)
    let titleQuery = '';
    const titleMatch = document.title.match(/^(.+?)[\s]*[-–|][\s]*(쿠팡|Coupang)/i);
    if (titleMatch) {
      titleQuery = titleMatch[1].trim();
    }

    // 4) 우선순위: URL 파라미터 > 입력창 > 타이틀
    // URL 파라미터가 있으면 가장 신뢰할 수 있음 (SPA에서도 pushState로 URL이 바뀜)
    if (urlQuery) return urlQuery;
    if (inputQuery) return inputQuery;
    if (titleQuery) return titleQuery;

    return '';
  }

  // ============================================================
  //  URL 변경 감지 (SPA Navigation)
  //  쿠팡은 SPA이므로 페이지 전환 시 URL만 변경되고
  //  content script가 다시 로드되지 않음
  // ============================================================

  // History API 후킹 — pushState/replaceState를 감지
  function hookHistoryApi() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      onUrlChange('pushState');
    };

    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      onUrlChange('replaceState');
    };
  }

  // popstate 감지 (뒤로/앞으로 버튼)
  window.addEventListener('popstate', () => {
    onUrlChange('popstate');
  });

  // URL 변경 시 호출
  function onUrlChange(source) {
    const newUrl = location.href;
    if (newUrl === lastUrl) return;
    
    // 검색 페이지인지 확인
    if (!newUrl.includes('/np/search')) return;

    lastUrl = newUrl;
    // URL이 바뀌었으면 시그니처 초기화 → 강제 재파싱
    lastSignature = '';
    
    // SPA 렌더링 완료까지 대기 후 여러 번 파싱 시도
    schedulePublish(300);
    schedulePublish(800);
    schedulePublish(1500);
    schedulePublish(3000);
  }

  // URL 폴링 (백업: History API 후킹이 실패한 경우 대비)
  setInterval(() => {
    const newUrl = location.href;
    if (newUrl !== lastUrl && newUrl.includes('/np/search')) {
      lastUrl = newUrl;
      lastSignature = '';
      schedulePublish(300);
      schedulePublish(1000);
    }
  }, 1000);

  // ============================================================
  //  Strategy 1: 기존 class 기반 파싱 (이전 쿠팡 구조)
  // ============================================================
  function parseProductsLegacy() {
    const products = [];
    const candidateSelectors = [
      'li.search-product',
      'li[class*="search-product"]',
      '[data-sentry-component="ProductUnit"]',
      'div[class*="search-product"]',
    ];

    const nodes = Array.from(document.querySelectorAll(candidateSelectors.join(',')));
    if (!nodes.length) return products;

    const query = getQuery();

    for (const node of nodes) {
      if (products.length >= MAX_ITEMS) break;

      const adBadge = node.querySelector('[class*="ad-badge"]') || node.querySelector('[class*="ad_badge"]');
      const isAd = !!adBadge || node.classList.contains('search-product__ad');

      const linkEl = node.querySelector('a[href*="/vp/products/"]') || node.querySelector('a.search-product-link');
      const titleEl = node.querySelector('.name') || node.querySelector('[class*="name"]') || linkEl;
      const priceEl = node.querySelector('.price-value') || node.querySelector('[class*="price"]');
      const ratingEl = node.querySelector('.rating') || node.querySelector('[class*="rating"]');
      const reviewEl = node.querySelector('.rating-total-count') || node.querySelector('[class*="review"]');
      const imageEl = node.querySelector('img');
      const rocketBadge = node.querySelector('[class*="rocket"]') || node.querySelector('img[alt*="로켓"]');

      const href = linkEl?.href || '';
      if (!href) continue;

      const productIdMatch = href.match(/\/vp\/products\/(\d+)/);
      const productId = productIdMatch ? productIdMatch[1] : null;

      const item = {
        productId,
        title: text(titleEl),
        price: parseNumber(text(priceEl)),
        priceText: text(priceEl),
        rating: parseFloat2(text(ratingEl)),
        ratingText: text(ratingEl),
        reviewCount: parseNumber(text(reviewEl).replace(/[()]/g, '')),
        reviewText: text(reviewEl),
        url: href,
        imageUrl: imageEl?.src || imageEl?.getAttribute('data-img-src') || '',
        position: products.length + 1,
        query: query,
        isAd,
        isRocket: !!rocketBadge
      };

      if (!item.title && !item.price) continue;
      products.push(item);
    }

    return products;
  }

  // ============================================================
  //  Strategy 2: <a> 링크 기반 역추적 파싱 (새 쿠팡 구조 대응)
  // ============================================================
  function parseProductsByLinks() {
    const products = [];
    const seenIds = new Set();
    const query = getQuery();

    const allLinks = Array.from(document.querySelectorAll('a[href*="/vp/products/"]'));
    if (!allLinks.length) return products;

    for (const link of allLinks) {
      if (products.length >= MAX_ITEMS) break;

      const href = link.href || link.getAttribute('href') || '';
      const productIdMatch = href.match(/\/vp\/products\/(\d+)/);
      if (!productIdMatch) continue;

      const productId = productIdMatch[1];
      if (seenIds.has(productId)) continue;

      const container = findProductContainer(link);
      if (!container) continue;

      seenIds.add(productId);

      const title = extractTitle(container, link);
      if (!title) continue;

      const price = extractPrice(container);
      const rating = extractRating(container);
      const reviewCount = extractReviewCount(container);

      const imageEl = container.querySelector('img[src*="thumbnail"], img[src*="image"], img[data-img-src]') || 
                       container.querySelector('img');
      const imageUrl = imageEl?.src || imageEl?.getAttribute('data-img-src') || '';

      const containerText = text(container);
      const isAd = detectAd(container, containerText);
      const isRocket = detectRocket(container, containerText);

      const item = {
        productId,
        title,
        price,
        priceText: price > 0 ? price.toLocaleString() + '원' : '',
        rating,
        ratingText: rating > 0 ? String(rating) : '',
        reviewCount,
        reviewText: reviewCount > 0 ? `(${reviewCount})` : '',
        url: href.startsWith('http') ? href : 'https://www.coupang.com' + href,
        imageUrl,
        position: products.length + 1,
        query: query,
        isAd,
        isRocket
      };

      products.push(item);
    }

    return products;
  }

  // 상품 컨테이너 찾기
  function findProductContainer(link) {
    let el = link.parentElement;
    let depth = 0;

    while (el && depth < 8) {
      const tag = el.tagName.toLowerCase();
      const cls = el.className || '';

      if (tag === 'ul' || tag === 'ol' || tag === 'main' || tag === 'body' || tag === 'section') {
        return el === link.parentElement ? null : el.querySelector(`a[href="${link.getAttribute('href')}"]`)?.closest('li, div, article') || link.parentElement;
      }

      if (tag === 'li' && el.parentElement && (el.parentElement.tagName === 'UL' || el.parentElement.tagName === 'OL')) {
        return el;
      }

      if (tag === 'article') return el;

      if (tag === 'div' && el.parentElement) {
        const parent = el.parentElement;
        const siblings = parent.children;
        if (siblings.length >= 3) {
          let sameTagCount = 0;
          for (const sib of siblings) {
            if (sib.tagName === el.tagName) sameTagCount++;
          }
          if (sameTagCount >= 3 && el.querySelector('a[href*="/vp/products/"]')) {
            return el;
          }
        }
      }

      if (cls && /product|item|card|result|unit/i.test(cls) && depth >= 1) {
        return el;
      }

      if (el.dataset && (el.dataset.productId || el.dataset.itemId || el.dataset.vendorItemId)) {
        return el;
      }

      el = el.parentElement;
      depth++;
    }

    let fallback = link;
    for (let i = 0; i < 3 && fallback.parentElement; i++) {
      fallback = fallback.parentElement;
    }
    return fallback;
  }

  // 제목 추출
  function extractTitle(container, link) {
    const nameEl = container.querySelector('[class*="name"]') ||
                   container.querySelector('[class*="title"]') ||
                   container.querySelector('[class*="Name"]') ||
                   container.querySelector('[class*="Title"]');
    if (nameEl) {
      const t = text(nameEl);
      if (t.length > 5 && t.length < 500) return t;
    }

    const linkText = text(link);
    if (linkText.length > 5 && linkText.length < 500) return linkText;

    const allAnchors = container.querySelectorAll('a');
    let longest = '';
    for (const a of allAnchors) {
      const t = text(a);
      if (t.length > longest.length && t.length < 500) longest = t;
    }
    if (longest.length > 5) return longest;

    const img = container.querySelector('img');
    if (img?.alt && img.alt.length > 3) return img.alt;

    return '';
  }

  // 가격 추출
  function extractPrice(container) {
    const priceEls = container.querySelectorAll('[class*="price"], [class*="Price"]');
    const prices = [];

    for (const el of priceEls) {
      const t = text(el);
      const matches = t.match(/[\d,]+원/g);
      if (matches) {
        for (const m of matches) {
          const n = parseNumber(m);
          if (n >= 100 && n < 100000000) prices.push(n);
        }
      }
    }

    if (prices.length) return Math.min(...prices);

    const fullText = text(container);
    const priceMatches = fullText.match(/[\d,]+원/g);
    if (priceMatches) {
      const nums = priceMatches.map(m => parseNumber(m)).filter(n => n >= 100 && n < 100000000);
      if (nums.length) return Math.min(...nums);
    }

    return 0;
  }

  // 평점 추출
  function extractRating(container) {
    const ratingEl = container.querySelector('[class*="rating"]') ||
                     container.querySelector('[class*="star"]') ||
                     container.querySelector('[class*="Rating"]') ||
                     container.querySelector('[class*="Star"]');
    if (ratingEl) {
      const t = text(ratingEl);
      const m = t.match(/(\d+\.?\d*)/);
      if (m) {
        const val = parseFloat(m[1]);
        if (val > 0 && val <= 5) return val;
      }
    }

    const starEl = container.querySelector('[aria-label*="별점"], [aria-label*="star"]');
    if (starEl) {
      const label = starEl.getAttribute('aria-label') || '';
      const m = label.match(/(\d+\.?\d*)/);
      if (m) {
        const val = parseFloat(m[1]);
        if (val > 0 && val <= 5) return val;
      }
    }

    return 0;
  }

  // 리뷰 수 추출
  function extractReviewCount(container) {
    const reviewEl = container.querySelector('[class*="review"]') ||
                     container.querySelector('[class*="Review"]') ||
                     container.querySelector('[class*="count"]') ||
                     container.querySelector('.rating-total-count');
    if (reviewEl) {
      const t = text(reviewEl).replace(/[()]/g, '');
      const n = parseNumber(t);
      if (n > 0 && n < 10000000) return n;
    }

    const fullText = text(container);
    const parenMatch = fullText.match(/\((\d[\d,]*)\)/g);
    if (parenMatch) {
      for (const m of parenMatch) {
        const n = parseNumber(m);
        if (n > 0 && n < 10000000) return n;
      }
    }

    return 0;
  }

  // 광고 여부 감지
  function detectAd(container, containerText) {
    const cls = (container.className || '') + ' ' + container.innerHTML;
    if (/ad[-_]?badge|광고|ad_label|sponsored/i.test(cls)) return true;

    const adEl = container.querySelector('[class*="ad"]');
    if (adEl && /^AD$/i.test(text(adEl).trim())) return true;

    const smallEls = container.querySelectorAll('span, em, strong, div, p');
    for (const el of smallEls) {
      const t = text(el).trim();
      if (t === 'AD' || t === 'ad' || t === '광고') return true;
    }

    return false;
  }

  // 로켓배송 감지
  function detectRocket(container, containerText) {
    if (container.querySelector('[class*="rocket"]')) return true;
    if (container.querySelector('img[alt*="로켓"]')) return true;
    if (container.querySelector('img[src*="rocket"]')) return true;
    if (/로켓배송|로켓와우|로켓프레시|로켓직구/i.test(containerText)) return true;
    return false;
  }

  // ============================================================
  //  통합 파싱 + 발행
  // ============================================================
  function parseProducts() {
    let products = parseProductsLegacy();
    if (products.length >= 3) return products;
    products = parseProductsByLinks();
    return products;
  }

  function publishResults() {
    // 검색 페이지가 아닌 경우 무시
    if (!location.href.includes('/np/search')) return;

    const items = parseProducts();
    const query = getQuery();

    // 시그니처에 쿼리와 첫 5개 상품 ID 포함 (query 변경 감지가 핵심!)
    const signature = JSON.stringify({
      query,
      count: items.length,
      ids: items.map(i => i.productId || i.url).slice(0, 5)
    });

    if (signature === lastSignature) return;
    lastSignature = signature;

    // 각 아이템에 최신 query 할당 (SPA에서 query 변경 후 아이템이 아직 안 바뀐 경우 대비)
    for (const item of items) {
      item.query = query;
    }

    chrome.runtime.sendMessage({
      type: 'SEARCH_RESULTS_PARSED',
      query,
      items
    }).catch(() => {});
  }

  function schedulePublish(delay) {
    const d = delay || 800;
    // delay별로 독립 타이머 사용
    setTimeout(() => {
      publishResults();
    }, d);
  }

  // ============================================================
  //  초기화 및 이벤트 바인딩
  // ============================================================

  // History API 후킹
  hookHistoryApi();

  // MutationObserver로 DOM 변경 감지 (디바운스)
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(publishResults, 800);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  // 여러 시점에서 파싱 시도
  window.addEventListener('load', () => schedulePublish(500));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) schedulePublish(300);
  });

  // 초기 로드 시 여러 번 시도 (렌더링 지연 대응)
  publishResults(); // 즉시 1회
  schedulePublish(500);
  schedulePublish(1500);
  schedulePublish(3000);
  schedulePublish(5000);
})();
