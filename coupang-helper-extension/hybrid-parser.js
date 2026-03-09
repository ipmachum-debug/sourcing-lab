/* ============================================================
   Coupang Hybrid Parser v7.0 — Background DOMParser 기반
   셀러라이프 수집방식 + 우리 다중전략을 합친 하이브리드 파서

   핵심 원리:
   1. chrome.scripting.executeScript로 탭의 렌더링된 HTML 가져오기
   2. Background에서 DOMParser로 파싱 (content script 의존 X)
   3. V1(구형) + V2(신형) DOM 자동 감지/전환
   4. aria-label 평점 추출 (V2 핵심)
   5. 배송유형 6종 분류
   6. <script> 태그 SSR JSON 파싱
   7. 모바일 리뷰 API 직접 호출
   ============================================================ */

const HybridParser = {

  // ============================================================
  //  1. 탭에서 렌더링된 HTML 가져오기 (셀러라이프 방식)
  // ============================================================
  async getRenderedHTML(tabId) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => document.documentElement.outerHTML,
      });
      if (chrome.runtime.lastError) {
        throw new Error(chrome.runtime.lastError.message);
      }
      return results?.[0]?.result || '';
    } catch (e) {
      console.error('[HP] HTML 가져오기 실패:', e.message);
      throw e;
    }
  },

  // ============================================================
  //  2. HTML → 상품 데이터 파싱 (V1 + V2 자동 전환)
  // ============================================================
  parseSearchHTML(html, keyword) {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // V2 먼저 시도 (2025~2026 신형 DOM)
    let result = this.parseV2(doc, keyword);
    if (result && result.items.length > 0) {
      result.domVersion = 'V2';
      console.log(`[HP] V2 DOM 파싱 성공: ${result.items.length}개 상품`);
      return result;
    }

    // V1 폴백 (구형 DOM)
    result = this.parseV1(doc, keyword);
    if (result && result.items.length > 0) {
      result.domVersion = 'V1';
      console.log(`[HP] V1 DOM 파싱 성공: ${result.items.length}개 상품`);
      return result;
    }

    // SSR JSON 최종 폴백
    result = this.parseSSRJson(html, keyword);
    if (result && result.items.length > 0) {
      result.domVersion = 'SSR';
      console.log(`[HP] SSR JSON 파싱 성공: ${result.items.length}개 상품`);
      return result;
    }

    console.warn('[HP] 모든 파싱 전략 실패');
    return { items: [], totalProductCount: 0, domVersion: 'NONE', stats: {} };
  },

  // ============================================================
  //  V2 파서 — 쿠팡 2025~2026 React 기반 DOM
  //  셀러라이프 coupangItemSummaryV2 방식 참고
  // ============================================================
  parseV2(doc, keyword) {
    // V2 선택자: #product-list > li[class^="ProductUnit_productUnit"]
    let cards = [...doc.querySelectorAll('#product-list > li[class^="ProductUnit_productUnit"]')];

    // 광고 제외
    cards = cards.filter(el => !el.querySelector('[class*="AdMark_adMark"]'));

    if (!cards.length) return null;

    const items = [];
    const seen = new Set();
    let adCount = 0;

    // 총 상품수 (V2)
    let totalProductCount = 0;
    const countInput = doc.querySelector('input[name="searchProductCount"]');
    if (countInput) {
      totalProductCount = parseInt(countInput.value) || 0;
    }
    if (!totalProductCount) {
      // <script> 내 searchCount 파싱
      totalProductCount = this._extractSearchCountFromScripts(doc) || 0;
    }

    for (const card of cards) {
      if (items.length >= 72) break;

      // 링크
      const linkEl = card.querySelector('a');
      const href = linkEl?.getAttribute('href') || '';
      const fullUrl = href.startsWith('http') ? href : `https://www.coupang.com${href}`;
      const pidMatch = href.match(/\/products\/(\d+)/);
      if (!pidMatch) continue;
      const pid = pidMatch[1];
      if (seen.has(pid)) continue;
      seen.add(pid);

      // vendorItemId
      const vidMatch = href.match(/[?&]vendorItemId=(\d+)/i);
      const vendorItemId = vidMatch ? vidMatch[1] : null;

      // 상품명
      const nameEl = card.querySelector('[class*="ProductUnit_productName"], [class*="ProductUnit_productInfo"] [class*="name"]');
      const title = nameEl?.textContent?.trim() || '';
      if (!title || title.length < 3) continue;

      // 가격 (V2)
      let price = 0, originalPrice = 0;
      const priceEl = card.querySelector('[class*="Price_priceValue"]');
      if (priceEl) {
        price = this._parseNumber(priceEl.textContent);
      }
      if (!price) {
        // 폴백: PriceArea 내 빨간색/기본색 텍스트
        const priceArea = card.querySelector('[class*="PriceArea_priceArea"]');
        if (priceArea) {
          const divs = priceArea.querySelectorAll('div');
          for (const d of divs) {
            const t = d.textContent?.trim();
            if (t && t.endsWith('원') && !t.includes('%') && (t.includes(',') || /\d{3,}원/.test(t))) {
              const p = this._parseNumber(t);
              if (p > 100) { price = p; break; }
            }
          }
        }
      }
      const basePriceEl = card.querySelector('[class*="Price_basePrice"], [class*="OriginalPrice"], del');
      if (basePriceEl) originalPrice = this._parseNumber(basePriceEl.textContent);

      // ★★★ 평점 (V2 핵심: aria-label) ★★★
      let rating = 0;
      let ratingIsEstimated = false;
      const ariaEl = card.querySelector('[aria-label]');
      if (ariaEl) {
        const ariaVal = ariaEl.getAttribute('aria-label');
        const rMatch = ariaVal?.match(/([\d.]+)/);
        if (rMatch) {
          const r = parseFloat(rMatch[1]);
          if (r >= 1.0 && r <= 5.0) rating = r;
        }
      }
      // 폴백: 텍스트에서 평점 추출
      if (!rating) {
        const ratingContainer = card.querySelector('[class*="ProductRating"], [class*="rating"]');
        if (ratingContainer) {
          const text = ratingContainer.textContent || '';
          const rMatch = text.match(/([\d.]+)/);
          if (rMatch) {
            const r = parseFloat(rMatch[1]);
            if (r >= 1.0 && r <= 5.0) rating = r;
          }
        }
      }

      // 리뷰수 (V2)
      let reviewCount = 0;
      const reviewEl = card.querySelector('[class*="ProductRating_productRating"]');
      if (reviewEl) {
        const text = reviewEl.textContent || '';
        const rMatch = text.match(/\(?(\d[\d,]*)\)?/);
        if (rMatch) reviewCount = this._parseNumber(rMatch[1]);
      }
      if (!reviewCount) {
        // 폴백: 괄호 안 숫자
        const allText = card.textContent || '';
        const matches = allText.match(/\((\d[\d,]*)\)/g);
        if (matches) {
          for (const m of matches) {
            const n = this._parseNumber(m);
            if (n > 0 && n < 10000000) { reviewCount = n; break; }
          }
        }
      }

      // 리뷰는 있는데 평점이 없으면 추정
      if (!rating && reviewCount > 0) {
        rating = reviewCount >= 500 ? 4.6 : reviewCount >= 100 ? 4.5 : reviewCount >= 30 ? 4.3 : 4.0;
        ratingIsEstimated = true;
      }

      // 광고 판별 (V2)
      let isAd = false;
      if (card.querySelector('[class*="AdMark_text"], [class*="AdMark_adMark"], [class*="ad-badge"]')) {
        isAd = true;
        adCount++;
      }

      // ★★★ 배송유형 6종 분류 (셀러라이프 방식) ★★★
      const deliveryInfo = this._classifyDeliveryV2(card);

      // 순위 배지
      let rankNum = 0;
      const rankEl = card.querySelector('[class*="RankMark_rank"]');
      if (rankEl) {
        rankNum = parseInt(rankEl.textContent?.replace(/[^0-9]/g, '')) || 0;
      }

      // 이미지
      const imgEl = card.querySelector('[class*="ProductUnit_productImage"] img, img');
      let imageUrl = imgEl?.getAttribute('src') || imgEl?.getAttribute('data-img-src') || '';
      if (imageUrl.includes('blank1x1')) imageUrl = imgEl?.getAttribute('data-img-src') || '';

      items.push({
        productId: pid,
        vendorItemId,
        title,
        price,
        originalPrice,
        rating,
        ratingIsEstimated,
        reviewCount,
        isAd,
        isRocket: deliveryInfo.type === 'rocketDelivery' || deliveryInfo.type === 'sellerRocketDelivery',
        deliveryType: deliveryInfo.type,     // 6종 상세
        deliveryLabel: deliveryInfo.label,
        imageUrl,
        url: fullUrl,
        position: items.length + 1,
        rankNum,
        query: keyword,
      });
    }

    // 광고 포함 카드도 카운트
    const adCards = doc.querySelectorAll('#product-list > li[class^="ProductUnit_productUnit"] [class*="AdMark_adMark"]');
    adCount += adCards.length;

    return {
      items,
      totalProductCount,
      adCount,
      stats: this._calcStats(items),
    };
  },

  // ============================================================
  //  V1 파서 — 쿠팡 구형 DOM (#productList > li)
  // ============================================================
  parseV1(doc, keyword) {
    let cards = [...doc.querySelectorAll('#productList > li')];
    if (!cards.length) {
      cards = [...doc.querySelectorAll('li[class*="search-product"]')];
    }
    if (!cards.length) return null;

    const items = [];
    const seen = new Set();
    let adCount = 0;

    const totalProductCount = parseInt(doc.querySelector('input[name="searchProductCount"]')?.value) || 0;

    for (const card of cards) {
      if (items.length >= 72) break;

      const linkEl = card.querySelector('a.search-product-link, a[href*="/vp/products/"], a[href*="/products/"]');
      const href = linkEl?.getAttribute('href') || '';
      const fullUrl = href.startsWith('http') ? href : `https://www.coupang.com${href}`;
      const pidMatch = href.match(/\/products\/(\d+)/);
      if (!pidMatch) continue;
      const pid = pidMatch[1];
      if (seen.has(pid)) continue;
      seen.add(pid);

      const vidMatch = href.match(/[?&]vendorItemId=(\d+)/i);
      const vendorItemId = vidMatch ? vidMatch[1] : null;

      // 상품명
      const nameEl = card.querySelector('div.name, .name, [class*="name"]');
      const title = nameEl?.textContent?.trim() || card.querySelector('img')?.getAttribute('alt') || '';
      if (!title || title.length < 3) continue;

      // 가격
      let price = 0, originalPrice = 0;
      const priceEl = card.querySelector('strong.price-value, .price-value, [class*="price-value"]');
      if (priceEl) price = this._parseNumber(priceEl.textContent);
      const basePriceEl = card.querySelector('del.base-price, .base-price, del[class*="price"]');
      if (basePriceEl) originalPrice = this._parseNumber(basePriceEl.textContent);

      // 평점 (V1: 텍스트 기반)
      let rating = 0, ratingIsEstimated = false;
      const ratingEl = card.querySelector('em.rating, .rating, [class*="rating-score"]');
      if (ratingEl) {
        const r = parseFloat(ratingEl.textContent);
        if (r >= 1.0 && r <= 5.0) rating = r;
      }
      // aria-label 폴백
      if (!rating) {
        const ariaEl = card.querySelector('[aria-label]');
        if (ariaEl) {
          const r = parseFloat(ariaEl.getAttribute('aria-label'));
          if (r >= 1.0 && r <= 5.0) rating = r;
        }
      }
      // star width 기반
      if (!rating) {
        const starEl = card.querySelector('.star .rating, [class*="rating-star"] [style*="width"]');
        if (starEl) {
          const style = starEl.getAttribute('style') || '';
          const wMatch = style.match(/width:\s*([\d.]+)%/);
          if (wMatch) rating = Math.round(parseFloat(wMatch[1]) / 20 * 10) / 10;
        }
      }

      // 리뷰수
      let reviewCount = 0;
      const reviewEl = card.querySelector('span.rating-total-count, .rating-total-count, [class*="rating-count"]');
      if (reviewEl) {
        const text = reviewEl.textContent || '';
        reviewCount = this._parseNumber(text.replace(/[()]/g, ''));
      }

      // 추정
      if (!rating && reviewCount > 0) {
        rating = reviewCount >= 500 ? 4.6 : reviewCount >= 100 ? 4.5 : reviewCount >= 30 ? 4.3 : 4.0;
        ratingIsEstimated = true;
      }

      // 광고
      let isAd = false;
      if (card.querySelector('.ad-badge-text, .ad-badge, [class*="ad-badge"]')) {
        isAd = true;
        adCount++;
      } else {
        const texts = [...card.querySelectorAll('span, em, div')];
        for (const el of texts) {
          const t = el.textContent?.trim();
          if (t && (t === 'AD' || t === '광고') && t.length <= 5) { isAd = true; adCount++; break; }
        }
      }

      // 배송유형 (V1)
      const deliveryInfo = this._classifyDeliveryV1(card);

      // 순위
      let rankNum = 0;
      const rankEl = card.querySelector('.number, [class*="rank"]');
      if (rankEl) {
        const n = parseInt(rankEl.textContent?.replace(/[^0-9]/g, ''));
        if (n > 0 && n <= 50) rankNum = n;
      }

      // 이미지
      const imgEl = card.querySelector('dt.image img, .search-product-wrap-img, img');
      let imageUrl = imgEl?.getAttribute('src') || imgEl?.getAttribute('data-img-src') || '';
      if (imageUrl.includes('blank1x1')) imageUrl = imgEl?.getAttribute('data-img-src') || '';

      items.push({
        productId: pid, vendorItemId, title, price, originalPrice,
        rating, ratingIsEstimated, reviewCount,
        isAd, isRocket: deliveryInfo.type === 'rocketDelivery' || deliveryInfo.type === 'sellerRocketDelivery',
        deliveryType: deliveryInfo.type, deliveryLabel: deliveryInfo.label,
        imageUrl, url: fullUrl,
        position: items.length + 1, rankNum, query: keyword,
      });
    }

    return { items, totalProductCount, adCount, stats: this._calcStats(items) };
  },

  // ============================================================
  //  SSR JSON 파서 — <script> 태그 내 서버사이드 렌더링 데이터
  // ============================================================
  parseSSRJson(html, keyword) {
    const items = [];
    try {
      // __NEXT_DATA__ 또는 window.__PRELOADED_STATE__
      const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (nextDataMatch) {
        const data = JSON.parse(nextDataMatch[1]);
        const products = data?.props?.pageProps?.compositeList?.list || data?.props?.pageProps?.shoppingResult?.products || [];
        for (const p of products) {
          const item = p.item || p;
          if (item.adId) continue;
          items.push({
            productId: String(item.productId || item.id || ''),
            title: item.productName || item.name || '',
            price: parseInt(item.price) || 0,
            rating: parseFloat(item.ratingScore || item.rating) || 0,
            reviewCount: parseInt(item.reviewCount || item.ratingCount) || 0,
            isAd: false,
            isRocket: !!item.isRocket,
            deliveryType: item.isRocket ? 'rocketDelivery' : 'normalDelivery',
            deliveryLabel: item.isRocket ? '로켓배송' : '일반배송',
            imageUrl: item.imageUrl || '',
            url: `https://www.coupang.com/vp/products/${item.productId || item.id}`,
            position: items.length + 1,
            query: keyword,
          });
        }
      }
    } catch (e) {
      console.warn('[HP] SSR JSON 파싱 실패:', e.message);
    }
    return { items, totalProductCount: items.length, adCount: 0, stats: this._calcStats(items) };
  },

  // ============================================================
  //  배송유형 분류 — V2 (셀러라이프 getProductDeliveryTypeV2 참고)
  // ============================================================
  _classifyDeliveryV2(card) {
    // 전략 1: data-badge-id 속성 (가장 정확)
    const badgeEl = card.querySelector('[data-badge-id]');
    if (badgeEl) {
      const badgeId = badgeEl.getAttribute('data-badge-id');
      if (badgeId === 'ROCKET' || badgeId === 'TOMORROW' || badgeId === 'ROCKET_FRESH')
        return { type: 'rocketDelivery', label: '로켓배송' };
      if (badgeId === 'COUPANG_GLOBAL')
        return { type: 'globalRocketDelivery', label: '로켓직구' };
      if (badgeId === 'ROCKET_MERCHANT')
        return { type: 'sellerRocketDelivery', label: '판매자로켓' };
    }

    // 전략 2: 이미지 배지 (V1/V2 공용)
    return this._classifyByImageBadge(card);
  },

  // ============================================================
  //  배송유형 분류 — V1
  // ============================================================
  _classifyDeliveryV1(card) {
    // 전략 1: 이미지 alt 텍스트
    const badgeImg = card.querySelector('span.badge img, [class*="badge"] img, [class*="ImageBadge"] img');
    const alt = badgeImg?.getAttribute('alt') || '';
    const src = badgeImg?.getAttribute('src') || '';

    if (alt === '로켓배송') {
      if (src.includes('rds')) return { type: 'sellerRocketDelivery', label: '판매자로켓' };
      return { type: 'rocketDelivery', label: '로켓배송' };
    }
    if (alt === '로켓직구') return { type: 'globalRocketDelivery', label: '로켓직구' };

    // 전략 2: 이미지 URL 패턴
    return this._classifyByImageBadge(card);
  },

  _classifyByImageBadge(card) {
    const imgs = card.querySelectorAll('img[src], img[data-src]');
    for (const img of imgs) {
      const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
      if (src.includes('logo_rocket') || src.includes('badge_1998ab96bf7') || src.includes('rocket_install') || src.includes('rocket-install'))
        return { type: 'rocketDelivery', label: '로켓배송' };
      if (src.includes('rds') && (src.includes('RocketMerchant') || src.includes('badge_199559e56f7') || src.includes('badge_1998ac2b665')))
        return { type: 'sellerRocketDelivery', label: '판매자로켓' };
      if ((src.includes('rds') && src.includes('jikgu')) || src.includes('badge/badge'))
        return { type: 'globalRocketDelivery', label: '로켓직구' };
    }

    // 전략 3: 도착예정일 기반 해외직구 판별
    const deliverySpan = card.querySelector('[class*="DeliveryInfo"] span, .arrival-info em');
    if (deliverySpan) {
      const text = deliverySpan.textContent || '';
      const dateMatch = text.match(/(\d{1,2})\/(\d{1,2})/);
      if (dateMatch) {
        const month = parseInt(dateMatch[1]);
        const day = parseInt(dateMatch[2]);
        const now = new Date();
        let arrival = new Date(now.getFullYear(), month - 1, day);
        if (arrival < now) arrival = new Date(now.getFullYear() + 1, month - 1, day);
        const diff = arrival - now;
        if (diff > 7 * 24 * 60 * 60 * 1000) {
          return { type: 'internationalDelivery', label: '해외직구' };
        }
        return { type: 'normalDelivery', label: '일반배송' };
      }
      // "내일"/"모레" 도착
      if (text.includes('내일') || text.includes('모레')) {
        return { type: 'normalDelivery', label: '일반배송' };
      }
    }

    return { type: 'unknown', label: '미분류' };
  },

  // ============================================================
  //  <script> 태그에서 총 상품수 추출
  // ============================================================
  _extractSearchCountFromScripts(doc) {
    const scripts = doc.querySelectorAll('script');
    for (const s of scripts) {
      const text = s.textContent || '';
      const match = text.match(/\\"searchCount\\":\s*(\d+)/) || text.match(/"searchCount":\s*(\d+)/);
      if (match) return parseInt(match[1]);
    }
    return 0;
  },

  // ============================================================
  //  모바일 리뷰 API 호출 (셀러라이프 coupangMobileReviewPage 방식)
  // ============================================================
  async fetchMobileReviews(productId, maxPages = 9) {
    const reviews = [];
    try {
      for (let page = 0; page < maxPages; page++) {
        const url = `https://m.coupang.com/vm/products/${productId}/brand-sdp/reviews/list?page=${page}&slotSize=10&reviewOnly=true`;
        const resp = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'ko-KR,ko;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
          },
        });
        if (!resp.ok) break;
        const data = await resp.json();
        if (!data?.reviews?.length) break;
        reviews.push(...data.reviews);
        if (reviews.length >= data.totalCount || reviews.length >= 90) break;
        // 100ms 대기
        await new Promise(r => setTimeout(r, 100));
      }
    } catch (e) {
      console.warn('[HP] 모바일 리뷰 API 실패:', e.message);
    }
    return reviews;
  },

  // ============================================================
  //  declarativeNetRequest 헤더 위조 설정 (셀러라이프 방식)
  // ============================================================
  async setupCoupangHeaders() {
    try {
      const chromeVer = (navigator.userAgent.match(/Chrome\/(\d+)/) || [, '138'])[1];
      const rules = [
        // Rule 1: www.coupang.com — 데스크톱 브라우저 헤더 위조 (셀러라이프 방식)
        {
          id: 100,
          priority: 3,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'accept', operation: 'set', value: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8' },
              { header: 'accept-language', operation: 'set', value: 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7' },
              { header: 'sec-ch-ua', operation: 'set', value: `"Not)A;Brand";v="8", "Chromium";v="${chromeVer}", "Google Chrome";v="${chromeVer}"` },
              { header: 'sec-ch-ua-mobile', operation: 'set', value: '?0' },
              { header: 'sec-ch-ua-platform', operation: 'set', value: '"Windows"' },
              { header: 'sec-fetch-dest', operation: 'set', value: 'document' },
              { header: 'sec-fetch-mode', operation: 'set', value: 'navigate' },
              { header: 'sec-fetch-site', operation: 'set', value: 'same-origin' },
              { header: 'upgrade-insecure-requests', operation: 'set', value: '1' },
            ],
          },
          condition: {
            urlFilter: 'https://www.coupang.com/',
            resourceTypes: ['xmlhttprequest', 'main_frame', 'sub_frame'],
          },
        },
        // Rule 2: m.coupang.com — 모바일 리뷰 API 헤더 위조 (셀러라이프 coupangMobileReview 방식)
        {
          id: 101,
          priority: 3,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'accept', operation: 'set', value: 'application/json, text/plain, */*' },
              { header: 'accept-language', operation: 'set', value: 'ko-KR,ko;q=0.9' },
              { header: 'user-agent', operation: 'set', value: `Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer}.0.0.0 Mobile Safari/537.36` },
              { header: 'sec-ch-ua-mobile', operation: 'set', value: '?1' },
              { header: 'sec-ch-ua-platform', operation: 'set', value: '"Android"' },
              { header: 'sec-fetch-dest', operation: 'set', value: 'empty' },
              { header: 'sec-fetch-mode', operation: 'set', value: 'cors' },
              { header: 'sec-fetch-site', operation: 'set', value: 'same-origin' },
            ],
          },
          condition: {
            urlFilter: 'https://m.coupang.com/',
            resourceTypes: ['xmlhttprequest'],
          },
        },
        // Rule 3: 쿠팡 리뷰 API — 리뷰 요청 헤더 (셀러라이프 cReviewData 방식)
        {
          id: 102,
          priority: 3,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'accept', operation: 'set', value: 'text/html, */*; q=0.01' },
              { header: 'accept-language', operation: 'set', value: 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7' },
              { header: 'x-requested-with', operation: 'set', value: 'XMLHttpRequest' },
              { header: 'sec-fetch-dest', operation: 'set', value: 'empty' },
              { header: 'sec-fetch-mode', operation: 'set', value: 'cors' },
              { header: 'sec-fetch-site', operation: 'set', value: 'same-origin' },
            ],
          },
          condition: {
            urlFilter: 'https://www.coupang.com/vp/product/reviews',
            resourceTypes: ['xmlhttprequest'],
          },
        },
      ];

      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [100, 101, 102],
        addRules: rules,
      });
      console.log('[HP] declarativeNetRequest 헤더 설정 완료 (3개 규칙: www/mobile/review)');
    } catch (e) {
      console.warn('[HP] declarativeNetRequest 설정 실패:', e.message);
    }
  },

  // ============================================================
  //  데스크톱 리뷰 API 호출 (셀러라이프 cReviewData 방식)
  //  m.coupang.com 차단 시 폴백
  // ============================================================
  async fetchDesktopReviews(productId, maxPages = 5) {
    const reviews = [];
    try {
      for (let page = 1; page <= maxPages; page++) {
        const url = `https://www.coupang.com/vp/product/reviews?productId=${productId}&page=${page}&size=10&sortBy=DATE_DESC&viRoleCode=3&ratingStar=0`;
        const resp = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'accept': 'text/html, */*; q=0.01',
            'x-requested-with': 'XMLHttpRequest',
          },
        });
        if (!resp.ok) break;
        const html = await resp.text();
        // 리뷰 HTML 파싱
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const reviewEls = doc.querySelectorAll('.sdp-review__article__list__review');
        if (!reviewEls.length) break;
        for (const el of reviewEls) {
          const ratingEl = el.querySelector('.sdp-review__article__list__info__product-info__star-orange');
          const ratingStyle = ratingEl?.getAttribute('style') || '';
          const widthMatch = ratingStyle.match(/width:\s*([\d.]+)%/);
          const rating = widthMatch ? Math.round(parseFloat(widthMatch[1]) / 20 * 10) / 10 : 0;
          const headline = el.querySelector('.sdp-review__article__list__headline')?.textContent?.trim() || '';
          const content = el.querySelector('.sdp-review__article__list__review__content')?.textContent?.trim() || '';
          const date = el.querySelector('.sdp-review__article__list__info__product-info__reg-date')?.textContent?.trim() || '';
          const userName = el.querySelector('.sdp-review__article__list__info__user__name')?.textContent?.trim() || '';
          reviews.push({ rating, headline, content, date, userName, source: 'desktop' });
        }
        if (reviews.length >= 50) break;
        await new Promise(r => setTimeout(r, 200));
      }
    } catch (e) {
      console.warn('[HP] 데스크톱 리뷰 API 실패:', e.message);
    }
    return reviews;
  },

  // ============================================================
  //  통합 리뷰 수집 (모바일 우선 → 데스크톱 폴백)
  // ============================================================
  async fetchReviews(productId, maxPages = 9) {
    // 1차: 모바일 API (셀러라이프 방식 — 더 많은 데이터, JSON)
    let reviews = await this.fetchMobileReviews(productId, maxPages);
    if (reviews.length > 0) {
      console.log(`[HP] 모바일 리뷰 ${reviews.length}개 수집 성공`);
      return reviews;
    }
    // 2차: 데스크톱 API 폴백
    console.log('[HP] 모바일 리뷰 실패, 데스크톱 폴백...');
    reviews = await this.fetchDesktopReviews(productId, 5);
    console.log(`[HP] 데스크톱 리뷰 ${reviews.length}개 수집`);
    return reviews;
  },

  // ============================================================
  //  통계 계산 유틸
  // ============================================================
  _calcStats(items) {
    const prices = items.map(i => i.price).filter(p => p > 0);
    const ratings = items.map(i => i.rating).filter(r => r > 0 && r <= 5);
    const reviews = items.map(i => i.reviewCount).filter(r => r > 0);
    const deliveryTypes = {};
    for (const item of items) {
      const dt = item.deliveryType || 'unknown';
      deliveryTypes[dt] = (deliveryTypes[dt] || 0) + 1;
    }

    return {
      avgPrice: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0,
      avgRating: ratings.length ? +(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : 0,
      avgReview: reviews.length ? Math.round(reviews.reduce((a, b) => a + b, 0) / reviews.length) : 0,
      totalReviewSum: reviews.reduce((a, b) => a + b, 0),
      adCount: items.filter(i => i.isAd).length,
      rocketCount: items.filter(i => i.isRocket).length,
      highReviewCount: items.filter(i => i.reviewCount >= 100).length,
      priceRate: items.length ? Math.round(prices.length / items.length * 100) : 0,
      ratingRate: items.length ? Math.round(ratings.length / items.length * 100) : 0,
      reviewRate: items.length ? Math.round(reviews.length / items.length * 100) : 0,
      deliveryTypes,
    };
  },

  _parseNumber(str) {
    return parseInt((str || '').replace(/[^0-9]/g, ''), 10) || 0;
  },
};
