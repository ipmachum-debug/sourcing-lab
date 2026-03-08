/* ============================================================
   Coupang Sourcing Helper — Product Detail Content Script
   쿠팡 상품 상세 페이지에서 구매수, 판매자, 옵션 등 상세 데이터 파싱
   ============================================================ */
(function () {
  let debounceTimer = null;
  let lastSignature = '';

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

  function getProductId() {
    // URL: /vp/products/12345678?...
    const m = location.pathname.match(/\/(?:vp\/)?products\/(\d+)/);
    return m ? m[1] : null;
  }

  function parseDetailPage() {
    const productId = getProductId();
    if (!productId) return null;

    // 제목
    const titleEl = document.querySelector('.prod-buy-header__title') ||
                    document.querySelector('h1.prod-buy-header__title') ||
                    document.querySelector('h2.prod-buy-header__title') ||
                    document.querySelector('[class*="prod-buy-header"] h1') ||
                    document.querySelector('h1');
    const title = text(titleEl) || '';

    // 가격
    const priceEl = document.querySelector('.total-price strong') ||
                    document.querySelector('.prod-price .total-price') ||
                    document.querySelector('[class*="total-price"]');
    const price = parseNumber(text(priceEl));

    // 원래 가격 (할인 전)
    const origPriceEl = document.querySelector('.origin-price') ||
                        document.querySelector('.base-price') ||
                        document.querySelector('[class*="origin-price"]');
    const originalPrice = parseNumber(text(origPriceEl));

    // 할인율
    const discountEl = document.querySelector('.discount-rate') ||
                       document.querySelector('[class*="discount-rate"]');
    const discountRate = parseNumber(text(discountEl));

    // 평점
    const ratingEl = document.querySelector('.prod-buy-header__rating-number') ||
                     document.querySelector('.rating-star-num') ||
                     document.querySelector('[class*="rating"]');
    const rating = parseFloat2(text(ratingEl));

    // 리뷰 수
    const reviewEl = document.querySelector('.prod-buy-header__review-count') ||
                     document.querySelector('.count') ||
                     document.querySelector('[class*="review-count"]');
    const reviewCount = parseNumber(text(reviewEl));

    // 구매 수 (e.g., "1,234명이 이 상품을 구매했어요" or "1만+ 구매")
    const purchaseTextCandidates = [
      '[class*="purchase-count"]',
      '[class*="bought"]',
      '.prod-buy-header__sub-info',
    ];
    let purchaseCount = '';
    for (const sel of purchaseTextCandidates) {
      const el = document.querySelector(sel);
      if (el) {
        const txt = text(el);
        if (txt.match(/구매|bought|판매/)) {
          purchaseCount = txt;
          break;
        }
      }
    }
    // 본문에서 구매수 찾기
    if (!purchaseCount) {
      const allSpans = document.querySelectorAll('span, div, p');
      for (const el of allSpans) {
        const t = text(el);
        if (t.match(/\d.*(?:명이?\s*(?:이\s*)?(?:상품을?\s*)?구매|만\+?\s*구매|천\+?\s*구매)/) && t.length < 80) {
          purchaseCount = t;
          break;
        }
      }
    }

    // 판매자 정보
    const sellerEl = document.querySelector('.prod-seller-list a') ||
                     document.querySelector('[class*="seller-name"]') ||
                     document.querySelector('.prod-sale-vendor a');
    const sellerName = text(sellerEl) || '';

    // 로켓배송 여부
    const rocketEl = document.querySelector('[class*="rocket"]') ||
                     document.querySelector('img[alt*="로켓"]') ||
                     document.querySelector('.delivery-badge-rocket');
    const isRocket = !!rocketEl;

    // 무료배송 여부
    const freeShipEl = document.querySelector('[class*="free-delivery"]') ||
                       document.querySelector('[class*="free-shipping"]');
    let isFreeShipping = !!freeShipEl;
    if (!isFreeShipping) {
      const deliveryText = document.querySelector('.prod-delivery-info')?.textContent || '';
      isFreeShipping = deliveryText.includes('무료배송') || deliveryText.includes('무료 배송');
    }

    // 카테고리 경로
    const breadcrumbs = document.querySelectorAll('.breadcrumb a, .prod-breadcrumb a, [class*="breadcrumb"] a');
    const categoryPath = Array.from(breadcrumbs).map(a => text(a)).filter(Boolean).join(' > ');

    // 옵션 수
    const optionItems = document.querySelectorAll('.prod-option__item, .prod-option__list li, [class*="option-item"]');
    const optionCount = optionItems.length;

    // 이미지
    const mainImg = document.querySelector('.prod-image__item img') ||
                    document.querySelector('.prod-atf-img img') ||
                    document.querySelector('[class*="prod-image"] img');
    const imageUrl = mainImg?.src || mainImg?.getAttribute('data-img-src') || '';

    // 상세 옵션 데이터
    const options = [];
    optionItems.forEach(el => {
      const optTitle = text(el.querySelector('.title, .name, [class*="name"]') || el);
      const optPrice = text(el.querySelector('.price, [class*="price"]'));
      if (optTitle) options.push({ title: optTitle, price: optPrice });
    });

    return {
      coupangProductId: productId,
      title,
      price,
      originalPrice,
      discountRate,
      rating,
      reviewCount,
      purchaseCount,
      sellerName,
      isRocket,
      isFreeShipping,
      categoryPath,
      optionCount,
      imageUrl,
      url: location.href,
      detailJson: {
        options,
        url: location.href,
      }
    };
  }

  function publishDetail() {
    const detail = parseDetailPage();
    if (!detail || !detail.coupangProductId) return;

    const signature = JSON.stringify({
      id: detail.coupangProductId,
      price: detail.price,
      reviewCount: detail.reviewCount,
    });

    if (signature === lastSignature) return;
    lastSignature = signature;

    chrome.runtime.sendMessage({
      type: 'PRODUCT_DETAIL_PARSED',
      detail
    }).catch(() => {});
  }

  function schedulePublish() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(publishDetail, 800);
  }

  // DOM 변경 감지
  const observer = new MutationObserver(() => schedulePublish());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.addEventListener('load', schedulePublish);
  document.addEventListener('visibilitychange', schedulePublish);
  schedulePublish();
})();
