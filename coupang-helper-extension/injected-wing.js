/* ============================================================
   Coupang Sourcing Helper — WING XHR/Fetch Interceptor v4.0
   wing.coupang.com 페이지에 인젝트되어 fetch/XHR 응답을 가로채고
   인기상품검색 관련 데이터를 content script로 전달합니다.
   ============================================================ */
(function () {
  'use strict';

  // 인기상품검색 관련 URL 패턴
  const WING_API_PATTERNS = [
    /popular.*product/i,
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
    /srp\//i,               // Search Result Page API
    /catalog/i,
  ];

  function isRelevantUrl(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    // WING 도메인 확인
    if (!lower.includes('wing.coupang.com') && !lower.includes('coupang.com')) return false;
    // API 패턴 매치
    return WING_API_PATTERNS.some(p => p.test(url));
  }

  function isProductListResponse(data) {
    if (!data) return false;
    // 배열 형태의 상품 데이터
    if (Array.isArray(data)) {
      return data.length > 0 && data.some(item =>
        item.productId || item.productName || item.itemId ||
        item.vendorItemId || item.sellerProductId || item.name
      );
    }
    // 객체 안에 상품 배열이 있는 경우
    if (typeof data === 'object') {
      const candidates = ['data', 'result', 'results', 'items', 'products',
        'productList', 'content', 'list', 'records', 'rows'];
      for (const key of candidates) {
        if (Array.isArray(data[key]) && data[key].length > 0) {
          const first = data[key][0];
          if (first && (first.productId || first.productName || first.itemId ||
            first.vendorItemId || first.sellerProductId || first.name)) {
            return true;
          }
        }
      }
      // pagination 구조
      if (data.pagination && (data.data || data.items || data.results)) return true;
    }
    return false;
  }

  function extractProductList(data) {
    if (Array.isArray(data)) return data;
    if (typeof data === 'object') {
      const candidates = ['data', 'result', 'results', 'items', 'products',
        'productList', 'content', 'list', 'records', 'rows'];
      for (const key of candidates) {
        if (Array.isArray(data[key]) && data[key].length > 0) {
          return data[key];
        }
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
  //  Fetch 후킹
  // ============================================================
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
    const response = await originalFetch.apply(this, args);

    try {
      if (isRelevantUrl(url)) {
        const cloned = response.clone();
        cloned.json().then(json => {
          if (isProductListResponse(json)) {
            const products = extractProductList(json);
            const pagination = extractPagination(json);
            sendToContentScript('WING_API_RESPONSE', {
              url,
              method: args[1]?.method || 'GET',
              products,
              pagination,
              rawKeys: Object.keys(json || {}),
            });
          }
        }).catch(() => {}); // JSON 파싱 실패 무시
      }
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
    if (this._wingUrl && isRelevantUrl(this._wingUrl)) {
      this.addEventListener('load', function () {
        try {
          const json = JSON.parse(this.responseText);
          if (isProductListResponse(json)) {
            const products = extractProductList(json);
            const pagination = extractPagination(json);
            sendToContentScript('WING_API_RESPONSE', {
              url: this._wingUrl,
              method: this._wingMethod,
              products,
              pagination,
              rawKeys: Object.keys(json || {}),
              requestBody: body ? (typeof body === 'string' ? body : null) : null,
            });
          }
        } catch (e) { /* JSON 파싱 실패 무시 */ }
      });
    }
    return originalSend.apply(this, arguments);
  };

  // 인젝션 완료 알림
  sendToContentScript('WING_INJECTED_READY', { version: '4.0' });
})();
