/* ============================================================
   Coupang Sourcing Helper — Product Detail Content Script v5.5.5
   쿠팡 상품 상세 페이지에서 가격, 평점, 리뷰수, 구매수,
   판매자, 옵션 등 상세 데이터 파싱

   v5.5.5 변경사항:
   - 가격: meta[product:price:amount] + JSON-LD 우선 전략 추가 (가장 신뢰)
   - 가격: 적립금/포인트/캐시/쿠폰/코팩/와우할인 영역 제외 강화
   - 가격: "N원 이상 구매" 패턴 제외
   - 가격: 빈도 기반 가격 선택 (가장 자주 등장하는 가격 우선)
   - 리뷰: "N개 상품평" 텍스트 패턴을 1순위로 승격
   - 리뷰: .count 범용 셀렉터 제거 (다른 카운트와 혼동 방지)
   - 디버그: 가격 파싱 결과 콘솔 로그 추가

   v5.5.3 변경사항:
   - 쿠팡 React SPA에 대응하여 텍스트 패턴 기반 파싱으로 전면 재작성
   - 가격: 할인가 우선, "N% N,NNN원" 패턴, 적립금/단위가격 제외
   - 평점: aria-label, star width, 숫자 텍스트 다중 전략
   - 리뷰수: "N개 상품평" 또는 "(N,NNN)" 패턴
   - 구매수: "N명이 구매" 또는 "N만+ 구매" 패턴
   ============================================================ */
(function () {
  'use strict';
  const VER = '5.5.5';
  console.log(`%c[SH Detail] v${VER} 상품 상세 파싱 스크립트 로드`, 'color:#6366f1;font-weight:bold;font-size:12px;');
  let debounceTimer = null;
  let lastSignature = '';

  function tx(el) {
    return (el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function nm(str) {
    if (!str) return 0;
    return parseInt(str.replace(/[^0-9]/g, ''), 10) || 0;
  }

  function getProductId() {
    const m = location.pathname.match(/\/(?:vp\/)?products\/(\d+)/);
    return m ? m[1] : null;
  }

  // ============================================================
  //  제목 추출
  // ============================================================
  function parseTitle() {
    // 전략 1: 클래스 기반 (구 DOM 호환)
    const selectors = [
      'h1.prod-buy-header__title',
      'h2.prod-buy-header__title',
      '.prod-buy-header__title',
      '[class*="prod-buy-header"] h1',
      '[class*="prod-buy-header"] h2',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) { const t = tx(el); if (t.length > 2) return t; }
    }

    // 전략 2: 페이지 내 h1, h2 태그 중 상품명스러운 것
    for (const tag of ['h1', 'h2']) {
      const els = document.querySelectorAll(tag);
      for (const el of els) {
        const t = tx(el);
        // 상품명은 보통 10~200자 사이
        if (t.length >= 5 && t.length <= 300 && !/쿠팡|로그인|회원가입|장바구니/.test(t)) {
          return t;
        }
      }
    }

    // 전략 3: 페이지 title에서 추출
    const pageTitle = document.title || '';
    // "상품명 - 쿠팡!" 형태
    const tm = pageTitle.match(/^(.+?)(?:\s*[-|]\s*쿠팡|$)/);
    if (tm && tm[1].length > 3) return tm[1].trim();

    return '';
  }

  // ============================================================
  //  가격 추출 (텍스트 패턴 기반)
  // ============================================================
  function parsePriceData() {
    let price = 0;
    let originalPrice = 0;
    let discountRate = 0;

    // === 전략 0: 쿠팡 가격 메타태그 (가장 신뢰) ===
    const metaPrice = document.querySelector('meta[property="product:price:amount"]');
    if (metaPrice) {
      const v = nm(metaPrice.getAttribute('content') || '');
      if (v >= 100 && v < 1e8) price = v;
    }
    // JSON-LD에서 가격 추출
    if (!price) {
      for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const json = JSON.parse(script.textContent);
          const offers = json.offers || json?.mainEntity?.offers;
          if (offers) {
            const p = parseInt(offers.price || offers.lowPrice || '0', 10);
            if (p >= 100 && p < 1e8) { price = p; break; }
          }
        } catch (e) {}
      }
    }

    // === 전략 1: 클래스 기반 직접 추출 (구 DOM 호환) ===
    if (!price) {
      const priceSelectors = [
        '.total-price strong',
        '.prod-price .total-price',
        '[class*="total-price"] strong',
        'strong.price-value',
        '.price-value',
      ];
      for (const sel of priceSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          // 적립금 영역 내부인지 확인
          if (el.closest('[class*="reward"]') || el.closest('[class*="point"]') || el.closest('[class*="benefit"]')) continue;
          const v = nm(tx(el));
          if (v >= 100 && v < 1e8) { price = v; break; }
        }
      }
    }

    const origSelectors = [
      '.origin-price',
      '.base-price',
      'del[class*="price"]',
      '[class*="origin-price"]',
      '[class*="original-price"]',
    ];
    for (const sel of origSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const v = nm(tx(el));
        if (v > price && v < 1e8) { originalPrice = v; break; }
      }
    }

    const discSelectors = [
      '.discount-rate',
      '[class*="discount-rate"]',
      '[class*="discount-percentage"]',
    ];
    for (const sel of discSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const v = nm(tx(el));
        if (v > 0 && v <= 99) { discountRate = v; break; }
      }
    }

    // === 전략 2: 엘리먼트 순회 — 텍스트 패턴 분석 ===
    if (!price) {
      const candidates = [];
      const allEls = document.querySelectorAll('span, strong, em, div, p, b');
      for (const el of allEls) {
        // 패널 내부 무시
        if (el.closest('#sh-panel') || el.closest('[class*="review"]') || el.closest('[class*="option-price"]')) continue;
        // 적립금/캐시/포인트/혜택 영역 무시
        if (el.closest('[class*="reward"]') || el.closest('[class*="point"]') || el.closest('[class*="benefit"]') || el.closest('[class*="cashback"]')) continue;

        const t = tx(el);
        if (!t || t.length > 100) continue;

        // "원" 포함 검사
        if (!/[\d,]+\s*원/.test(t)) continue;

        // 제외: 적립금
        if (/적립/.test(t)) continue;
        // 제외: 단위가격
        if (/\d+\s*(g|kg|ml|l|개|매|입)\s*당/i.test(t)) continue;
        if (/당\s*[\d,]+\s*원/.test(t)) continue;
        // 제외: 배송비
        if (/배송비/.test(t)) continue;
        // 제외: 카드 할인
        if (/카드/.test(t)) continue;
        // 제외: 캐시/쿠폰/포인트/코팩/와우
        if (/캐시|쿠폰|포인트|코팩|와우|할인.*적용/.test(t)) continue;
        // 제외: "이상 구매" 패턴
        if (/이상\s*(구매|주문)/.test(t)) continue;

        const priceMatch = t.match(/([\d,]+)\s*원/);
        if (priceMatch) {
          const v = nm(priceMatch[1]);
          if (v >= 100 && v < 1e8) {
            const isStrike = el.tagName === 'DEL' || !!el.closest('del') ||
                             /base.?price|original|origin|old/i.test(el.className || '');
            candidates.push({ value: v, isOriginal: isStrike, el });
          }
        }
      }

      if (candidates.length > 0) {
        const salePrices = candidates.filter(c => !c.isOriginal);
        const origPrices = candidates.filter(c => c.isOriginal);

        if (salePrices.length > 0) {
          // 판매가는 가장 빈도 높은 가격 → 같으면 가장 큰 값 우선 (너무 작은 값은 부가 정보)
          const freqMap = new Map();
          for (const c of salePrices) freqMap.set(c.value, (freqMap.get(c.value) || 0) + 1);
          const sorted = [...freqMap.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
          price = sorted[0][0];
        } else if (origPrices.length > 0) {
          price = Math.min(...origPrices.map(c => c.value));
        }
        if (!originalPrice && origPrices.length > 0) {
          originalPrice = Math.max(...origPrices.map(c => c.value));
        }
      }
    }

    // === 전략 3: 페이지 전체 텍스트에서 할인 패턴 ===
    if (!price) {
      const bodyText = tx(document.body);
      let cleanText = bodyText
        .replace(/최대\s*[\d,]+\s*원\s*적립/g, '')
        .replace(/[\d,]+\s*원\s*적립/g, '')
        .replace(/\d+\s*(g|kg|ml|l|개|매|입)\s*당\s*[\d,]+\s*원/gi, '')
        .replace(/배송비\s*[\d,]+\s*원/g, '')
        .replace(/[\d,]+\s*원\s*이상\s*(?:구매|주문)/g, '');

      const discMatch = cleanText.match(/(\d{1,3})%\s*([\d,]+)\s*원/);
      if (discMatch) {
        const p = nm(discMatch[2]);
        if (p >= 100 && p < 1e8) {
          price = p;
          if (!discountRate) discountRate = parseInt(discMatch[1], 10);
        }
      }
    }

    console.log(`[SH Detail] 가격 파싱: ${price}원 (원가:${originalPrice}, 할인:${discountRate}%)`);

    // 할인율 계산 (가격으로부터)
    if (!discountRate && originalPrice > 0 && price > 0 && originalPrice > price) {
      discountRate = Math.round((1 - price / originalPrice) * 100);
    }

    return { price, originalPrice, discountRate };
  }

  // ============================================================
  //  평점 추출 (다중 전략)
  // ============================================================
  function parseRating() {
    // 전략 1: 클래스 기반 직접 조회
    const ratingSelectors = [
      '.prod-buy-header__rating-number',
      '.rating-star-num',
      'em.rating',
      '.star-rating__text',
    ];
    for (const sel of ratingSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const m = tx(el).match(/(\d+\.?\d*)/);
        if (m) { const v = parseFloat(m[1]); if (v > 0 && v <= 5) return v; }
      }
    }

    // 전략 2: aria-label에서 "N점 만점에 X점" 또는 "X out of 5"
    for (const el of document.querySelectorAll('[aria-label], [title]')) {
      const label = (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '');
      let m = label.match(/만점에\s*(\d+\.?\d*)/);
      if (!m) m = label.match(/(\d+\.?\d*)\s*점/);
      if (!m) m = label.match(/(\d+\.?\d*)\s*out\s*of\s*5/i);
      if (m) {
        const v = parseFloat(m[1]);
        if (v > 0 && v <= 5) return v;
      }
    }

    // 전략 3: rating 관련 클래스에서 텍스트 추출
    for (const el of document.querySelectorAll('[class*="rating"]:not([class*="count"]):not([class*="total"]):not([class*="review"])')) {
      const t = tx(el);
      // 순수 숫자(소수점 포함)만 있는 텍스트
      const m = t.match(/^(\d+\.?\d*)$/);
      if (m) {
        const v = parseFloat(m[1]);
        if (v > 0 && v <= 5) return v;
      }
    }

    // 전략 4: star width 비율 기반
    const starContainers = document.querySelectorAll('[class*="star"], [class*="rating-star"], [class*="Star"]');
    for (const container of starContainers) {
      const filled = container.querySelector('[class*="fill"], [class*="active"], [class*="on"], [style*="width"]');
      if (filled) {
        const style = filled.getAttribute('style') || '';
        const wm = style.match(/width:\s*([\d.]+)%/);
        if (wm) {
          let v = Math.round(parseFloat(wm[1]) / 20 * 10) / 10;
          if (v > 5) v = 5;
          if (v > 0) return v;
        }
      }
    }

    // 전략 5: 별(★) 이미지/SVG 개수로 추정
    for (const container of starContainers) {
      const filledStars = container.querySelectorAll('[class*="fill"], [class*="active"], [class*="on"], [class*="full"]');
      if (filledStars.length > 0 && filledStars.length <= 5) return filledStars.length;
    }

    // 전략 6: 텍스트 패턴 — 평점/별점 N.N
    for (const el of document.querySelectorAll('span, em, strong, div')) {
      if (el.closest('#sh-panel') || el.closest('[class*="review-list"]')) continue;
      const t = tx(el);
      if (t.length > 30) continue;
      const m = t.match(/(?:평점|별점)\s*[:：]?\s*(\d+\.?\d*)/);
      if (m) {
        const v = parseFloat(m[1]);
        if (v > 0 && v <= 5) return v;
      }
    }

    return 0;
  }

  // ============================================================
  //  리뷰 수 추출 (다중 전략)
  // ============================================================
  function parseReviewCount() {
    // 전략 0: "N개 상품평" 텍스트 패턴 우선 (가장 확실)
    for (const el of document.querySelectorAll('a, span, div, button, em, strong')) {
      if (el.closest('#sh-panel')) continue;
      const t = tx(el);
      if (t.length > 80) continue;
      let m = t.match(/([\d,]+)\s*개?\s*상품평/);
      if (!m) m = t.match(/상품평\s*\(?\s*([\d,]+)\s*\)?/);
      if (m) {
        const v = nm(m[1]);
        if (v > 0 && v < 1e8) return v;
      }
    }

    // 전략 1: 클래스 기반 (구체적 셀렉터만)
    const revSelectors = [
      '.prod-buy-header__review-count',
      'span.rating-total-count',
      '.rating-total-count',
      '[class*="review-count"]',
      // '.count'는 너무 범용적이라 제외
    ];
    for (const sel of revSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const t = tx(el).replace(/[()]/g, '');
        const v = nm(t);
        if (v > 0 && v < 1e8) return v;
      }
    }

    // 전략 2: "N개 상품평" 패턴 (가장 확실)
    for (const el of document.querySelectorAll('a, span, div, button, em, strong')) {
      if (el.closest('#sh-panel')) continue;
      const t = tx(el);
      if (t.length > 60) continue;

      // "1,234개 상품평" 또는 "상품평(1,234)" 또는 "(1,234)" 다음 리뷰 관련 텍스트
      let m = t.match(/([\d,]+)\s*개?\s*상품평/);
      if (!m) m = t.match(/상품평\s*\(?\s*([\d,]+)\s*\)?/);
      if (!m) m = t.match(/리뷰\s*\(?\s*([\d,]+)\s*\)?/);
      if (!m) m = t.match(/review\s*\(?\s*([\d,]+)\s*\)?/i);
      if (m) {
        const v = nm(m[1]);
        if (v > 0 && v < 1e8) return v;
      }
    }

    // 전략 3: rating/review 관련 요소 근처의 괄호 안 숫자
    for (const el of document.querySelectorAll('[class*="rating"], [class*="review"], [class*="star"]')) {
      if (el.closest('#sh-panel')) continue;
      // 이 요소와 형제 또는 부모의 텍스트에서 (N,NNN) 패턴 찾기
      const parent = el.parentElement;
      if (!parent) continue;
      const t = tx(parent);
      const allParens = [...t.matchAll(/\(\s*([\d,]+)\s*\)/g)];
      for (const pm of allParens) {
        const v = nm(pm[1]);
        if (v > 0 && v < 1e8) return v;
      }
    }

    // 전략 4: 페이지에서 "상품평" 근처 숫자 찾기
    const body = tx(document.body);
    const revMatch = body.match(/([\d,]+)\s*개?\s*상품평/);
    if (revMatch) {
      const v = nm(revMatch[1]);
      if (v > 0 && v < 1e8) return v;
    }

    return 0;
  }

  // ============================================================
  //  구매수 추출
  // ============================================================
  function parsePurchaseCount() {
    // "N명이 이 상품을 구매했어요" 또는 "N만+ 구매" 패턴
    const patterns = [
      /(\d[\d,.]*\s*만?\+?\s*명이?\s*(?:이\s*상품을?\s*)?구매)/,
      /(?:최근|한\s*달간?|지난\s*달)\s*(\d[\d,.]*\s*만?\+?\s*명?\s*(?:이상\s*)?구매)/,
    ];

    for (const el of document.querySelectorAll('span, div, p, em, strong')) {
      if (el.closest('#sh-panel')) continue;
      const t = tx(el);
      if (t.length > 100) continue;

      for (const pat of patterns) {
        const m = t.match(pat);
        if (m) return m[0].trim();
      }

      // "N,NNN명이 구매" 형태
      if (/\d.*(?:명이?\s*(?:이\s*)?(?:상품을?\s*)?구매|만\+?\s*구매|천\+?\s*구매)/.test(t) && t.length < 80) {
        return t;
      }
    }

    return '';
  }

  // ============================================================
  //  판매자 정보 추출
  // ============================================================
  function parseSellerName() {
    const sellerSelectors = [
      '.prod-seller-list a',
      '[class*="seller-name"] a',
      '[class*="seller-name"]',
      '.prod-sale-vendor a',
      '[class*="vendor-name"]',
    ];
    for (const sel of sellerSelectors) {
      const el = document.querySelector(sel);
      if (el) { const t = tx(el); if (t && t.length > 1 && t.length < 100) return t; }
    }

    // 텍스트 패턴: "판매자:" 근처
    for (const el of document.querySelectorAll('span, div, a, td')) {
      const t = tx(el);
      if (t.length > 100) continue;
      const m = t.match(/판매자\s*[:：]?\s*(.{2,40})/);
      if (m) return m[1].trim();
    }

    return '';
  }

  // ============================================================
  //  로켓배송 / 무료배송 감지
  // ============================================================
  function parseDeliveryInfo() {
    let isRocket = false;
    let isFreeShipping = false;

    // 로켓배송: 클래스 기반
    isRocket = !!document.querySelector(
      '[class*="rocket"], img[alt*="로켓"], .delivery-badge-rocket, [class*="Rocket"]'
    );

    // 로켓배송: 이미지 alt/src
    if (!isRocket) {
      for (const img of document.querySelectorAll('img')) {
        const alt = (img.alt || '').toLowerCase();
        const src = (img.src || img.getAttribute('data-img-src') || '').toLowerCase();
        if (/rocket|로켓/i.test(alt) || /rocket/i.test(src)) { isRocket = true; break; }
      }
    }

    // 로켓배송: 텍스트
    if (!isRocket) {
      const body = tx(document.body);
      isRocket = /로켓배송|로켓와우|로켓프레시|로켓직구/.test(body);
    }

    // 무료배송
    isFreeShipping = !!document.querySelector(
      '[class*="free-delivery"], [class*="free-shipping"]'
    );
    if (!isFreeShipping) {
      const body = tx(document.body);
      isFreeShipping = /무료\s*배송/.test(body);
    }

    return { isRocket, isFreeShipping };
  }

  // ============================================================
  //  카테고리 경로
  // ============================================================
  function parseCategoryPath() {
    const breadcrumbs = document.querySelectorAll(
      '.breadcrumb a, .prod-breadcrumb a, [class*="breadcrumb"] a'
    );
    const path = Array.from(breadcrumbs).map(a => tx(a)).filter(Boolean);
    if (path.length > 0) return path.join(' > ');

    // Fallback: 텍스트에서 "홈 > 카테고리1 > 카테고리2" 패턴
    for (const el of document.querySelectorAll('nav, [class*="breadcrumb"], [class*="category-path"]')) {
      const t = tx(el);
      if (t.includes('>') && t.length < 200) return t;
    }
    return '';
  }

  // ============================================================
  //  옵션 정보
  // ============================================================
  function parseOptions() {
    const optionItems = document.querySelectorAll(
      '.prod-option__item, .prod-option__list li, [class*="option-item"], [class*="option-value"]'
    );
    const options = [];
    optionItems.forEach(el => {
      const optTitle = tx(el.querySelector('.title, .name, [class*="name"]') || el);
      const optPrice = tx(el.querySelector('.price, [class*="price"]'));
      if (optTitle && optTitle.length < 200) options.push({ title: optTitle, price: optPrice });
    });
    return options;
  }

  // ============================================================
  //  이미지 URL
  // ============================================================
  function parseImageUrl() {
    const selectors = [
      '.prod-image__item img',
      '.prod-atf-img img',
      '[class*="prod-image"] img',
      '[class*="product-image"] img',
      'img[src*="thumbnail"]',
      'img[src*="coupangcdn"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const url = el.src || el.getAttribute('data-img-src') || el.getAttribute('data-src');
        if (url) return url;
      }
    }

    // Fallback: OG 이미지
    const ogImg = document.querySelector('meta[property="og:image"]');
    if (ogImg) return ogImg.getAttribute('content') || '';

    return '';
  }

  // ============================================================
  //  메인 파싱 함수
  // ============================================================
  function parseDetailPage() {
    const productId = getProductId();
    if (!productId) return null;

    const title = parseTitle();
    const { price, originalPrice, discountRate } = parsePriceData();
    const rating = parseRating();
    const reviewCount = parseReviewCount();
    const purchaseCount = parsePurchaseCount();
    const sellerName = parseSellerName();
    const { isRocket, isFreeShipping } = parseDeliveryInfo();
    const categoryPath = parseCategoryPath();
    const options = parseOptions();
    const optionCount = options.length;
    const imageUrl = parseImageUrl();

    // 디버그 로그
    console.log(
      `%c[SH Detail v${VER}] 파싱 완료: ${title.substring(0, 30)}..` +
      ` | 가격:${price.toLocaleString()}원` +
      (originalPrice ? ` (원가:${originalPrice.toLocaleString()}, ${discountRate}%↓)` : '') +
      ` | ★${rating} | 리뷰:${reviewCount.toLocaleString()}` +
      (purchaseCount ? ` | 구매:${purchaseCount}` : '') +
      ` | ${isRocket ? '🚀로켓' : '일반'} | ${isFreeShipping ? '무료배송' : '유료'}` +
      (sellerName ? ` | 판매자:${sellerName.substring(0, 15)}` : ''),
      'color:#6366f1;font-weight:bold;'
    );

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
      rating: detail.rating,
      reviewCount: detail.reviewCount,
    });

    if (signature === lastSignature) return;
    lastSignature = signature;

    console.log(`%c[SH Detail v${VER}] ✅ 상세 데이터 전송`, 'color:#16a34a;font-weight:bold;');

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
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) schedulePublish();
  });

  // 초기 실행 (React SPA 렌더링 대기)
  schedulePublish();
  setTimeout(schedulePublish, 1500);
  setTimeout(schedulePublish, 3000);
  setTimeout(schedulePublish, 5000);
})();
