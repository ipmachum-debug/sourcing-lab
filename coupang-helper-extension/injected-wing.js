/* ============================================================
   Coupang Sourcing Helper — WING XHR/Fetch Interceptor v4.5
   wing.coupang.com 페이지에 인젝트되어 fetch/XHR 응답을 가로채고
   인기상품검색 관련 데이터를 content script로 전달합니다.
   ============================================================ */
(function () {
  'use strict';

  // 인기상품검색 관련 URL 패턴 — v4.5 대폭 확대
  const WING_API_PATTERNS = [
    /popular.*product/i,
    /product.*popular/i,
    /best.*seller/i,
    /trending/i,
    /hot.*deal/i,
    /search.*product/i,
    /product.*search/i,
    /keyword.*rank/i,
    /ranking/i,
    /category.*product/i,
    /mdrecommend/i,
    /recommendation/i,
    /api\/v\d+\/.*product/i,
    /marketplace.*api/i,
    /wing.*api.*search/i,
    /srp\//i,
    /catalog/i,
    // v4.5 추가 패턴
    /popular.*search/i,
    /search.*popular/i,
    /popular.*keyword/i,
    /keyword.*popular/i,
    /popular.*item/i,
    /item.*popular/i,
    /bestseller/i,
    /best-seller/i,
    /top.*product/i,
    /product.*rank/i,
    /rank.*product/i,
    /seller.*product/i,
    /product.*list/i,
    /search.*result/i,
    /searchResult/i,
    /itemSearch/i,
    /item.*search/i,
    /search.*item/i,
    /productSearch/i,
    /searchProduct/i,
    /display.*product/i,
    /product.*display/i,
    /curation/i,
    /discovery/i,
    /trending.*product/i,
    /hot.*product/i,
    /recommend.*product/i,
    /product.*recommend/i,
    // WING 특화 API 패턴
    /wing\.coupang\.com\/api/i,
    /wing\.coupang\.com\/.*\/api/i,
    /api.*popular/i,
    /api.*search/i,
    /api.*product/i,
    /api.*item/i,
    /api.*keyword/i,
    /api.*rank/i,
    /api.*best/i,
    /api.*trend/i,
    /\/graphql/i,
    /\/gql/i,
  ];

  function isRelevantUrl(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    // WING 도메인 또는 쿠팡 API 호출
    const isCoupangDomain = lower.includes('wing.coupang.com') ||
      lower.includes('coupang.com') ||
      lower.includes('api.coupang') ||
      lower.includes('gateway.coupang');
    if (!isCoupangDomain) return false;
    // API 패턴 매치
    return WING_API_PATTERNS.some(p => p.test(url));
  }

  // v4.5: 더 넓은 범위의 상품 데이터 감지
  function isProductListResponse(data) {
    if (!data) return false;

    // 배열 형태의 상품 데이터
    if (Array.isArray(data)) {
      return data.length > 0 && data.some(item =>
        item.productId || item.productName || item.itemId ||
        item.vendorItemId || item.sellerProductId || item.name ||
        item.productNo || item.displayProductName || item.title ||
        item.itemName || item.id
      );
    }

    // 객체 안에 상품 배열이 있는 경우
    if (typeof data === 'object') {
      // 1차: 직접 키 탐색
      const candidates = [
        'data', 'result', 'results', 'items', 'products',
        'productList', 'content', 'list', 'records', 'rows',
        'searchResults', 'searchResult', 'popularProducts',
        'bestProducts', 'rankingProducts', 'trendingProducts',
        'productItems', 'itemList', 'goodsList', 'goods',
        'body', 'payload', 'response', 'output',
      ];
      for (const key of candidates) {
        if (Array.isArray(data[key]) && data[key].length > 0) {
          const first = data[key][0];
          if (first && (first.productId || first.productName || first.itemId ||
            first.vendorItemId || first.sellerProductId || first.name ||
            first.productNo || first.displayProductName || first.title ||
            first.itemName || first.id)) {
            return true;
          }
        }
      }

      // 2차: 중첩 구조 탐색 (data.data, data.result.items 등)
      if (data.data && typeof data.data === 'object') {
        if (isProductListResponse(data.data)) return true;
      }
      if (data.result && typeof data.result === 'object') {
        if (isProductListResponse(data.result)) return true;
      }
      if (data.body && typeof data.body === 'object') {
        if (isProductListResponse(data.body)) return true;
      }

      // pagination 구조
      if (data.pagination && (data.data || data.items || data.results || data.products)) return true;
      if (data.totalCount && (data.data || data.items || data.results || data.products || data.list)) return true;
    }
    return false;
  }

  function extractProductList(data) {
    if (Array.isArray(data)) return data;
    if (typeof data === 'object') {
      const candidates = [
        'data', 'result', 'results', 'items', 'products',
        'productList', 'content', 'list', 'records', 'rows',
        'searchResults', 'searchResult', 'popularProducts',
        'bestProducts', 'rankingProducts', 'trendingProducts',
        'productItems', 'itemList', 'goodsList', 'goods',
        'body', 'payload', 'response', 'output',
      ];
      for (const key of candidates) {
        if (Array.isArray(data[key]) && data[key].length > 0) {
          return data[key];
        }
      }
      // 중첩 구조
      if (data.data && typeof data.data === 'object') {
        const nested = extractProductList(data.data);
        if (nested.length) return nested;
      }
      if (data.result && typeof data.result === 'object') {
        const nested = extractProductList(data.result);
        if (nested.length) return nested;
      }
      if (data.body && typeof data.body === 'object') {
        const nested = extractProductList(data.body);
        if (nested.length) return nested;
      }
    }
    return [];
  }

  function extractPagination(data) {
    if (!data || typeof data !== 'object') return null;
    const page = data.page || data.currentPage || data.pageNo || data.pageNumber || null;
    const totalPages = data.totalPages || data.totalPage || data.lastPage || null;
    const totalItems = data.totalCount || data.totalElements || data.total || data.totalItems || null;
    const pageSize = data.pageSize || data.size || data.limit || data.perPage || null;
    if (data.pagination) {
      return {
        page: data.pagination.page || page,
        totalPages: data.pagination.totalPages || totalPages,
        totalItems: data.pagination.totalCount || data.pagination.totalElements || totalItems,
        pageSize: data.pagination.pageSize || pageSize,
      };
    }
    return { page, totalPages, totalItems, pageSize };
  }

  function sendToContentScript(type, payload) {
    window.postMessage({
      source: 'COUPANG_WING_INJECTED',
      type,
      payload,
      timestamp: Date.now(),
    }, '*');
  }

  // ============================================================
  //  v4.5: 모든 XHR/fetch 응답에서 상품 데이터 탐색 (Aggressive Mode)
  // ============================================================

  function tryExtractProducts(url, json, method, body) {
    // 먼저 URL 패턴 매치 체크
    if (isRelevantUrl(url)) {
      if (isProductListResponse(json)) {
        const products = extractProductList(json);
        const pagination = extractPagination(json);
        console.log('[SourcingHelper] WING API 감지:', url, products.length, '개 상품');
        sendToContentScript('WING_API_RESPONSE', {
          url,
          method: method || 'GET',
          products,
          pagination,
          rawKeys: Object.keys(json || {}),
          requestBody: body || null,
        });
        return true;
      }
    }

    // URL이 매치되지 않아도, coupang 도메인이고 상품 데이터가 있으면 전송
    const lower = (url || '').toLowerCase();
    if ((lower.includes('coupang.com') || lower.includes('coupang')) && isProductListResponse(json)) {
      const products = extractProductList(json);
      if (products.length >= 3) {
        const pagination = extractPagination(json);
        console.log('[SourcingHelper] WING 비패턴 상품 감지:', url, products.length, '개 상품');
        sendToContentScript('WING_API_RESPONSE', {
          url,
          method: method || 'GET',
          products,
          pagination,
          rawKeys: Object.keys(json || {}),
          requestBody: body || null,
        });
        return true;
      }
    }

    return false;
  }

  // ============================================================
  //  Fetch 후킹
  // ============================================================
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
    const response = await originalFetch.apply(this, args);

    try {
      const cloned = response.clone();
      cloned.json().then(json => {
        tryExtractProducts(url, json, args[1]?.method || 'GET', null);
      }).catch(() => {}); // JSON 파싱 실패 무시
    } catch (e) { /* 에러 무시 */ }

    return response;
  };

  // ============================================================
  //  XMLHttpRequest 후킹
  // ============================================================
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._wingUrl = url;
    this._wingMethod = method;
    return originalOpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (body) {
    this.addEventListener('load', function () {
      try {
        const json = JSON.parse(this.responseText);
        tryExtractProducts(
          this._wingUrl,
          json,
          this._wingMethod,
          body ? (typeof body === 'string' ? body : null) : null
        );
      } catch (e) { /* JSON 파싱 실패 무시 */ }
    });
    return originalSend.apply(this, arguments);
  };

  // 인젝션 완료 알림
  sendToContentScript('WING_INJECTED_READY', { version: '4.5' });
  console.log('[SourcingHelper] WING injected v4.5 ready');
})();
