/* ============================================================
   Coupang Hybrid Parser v7.2 — 셀러라이프 수집방식 전면 반영
   
   v7.2 대개편:
   1. 다중 전략 수집 (Background fetch → Hidden Tab → Polling Tab)
   2. 셀러라이프 k() 함수 방식 직접 fetch (완전한 헤더 위조)
   3. cDataTab2 방식 폴링 (HTML>10KB까지 2초 간격 최대10회)
   4. 동적 DNR 규칙 등록/해제 (z.run 방식)
   5. V1/V2 듀얼 DOM 파서 (셀러라이프 coupangItemSummaryV2 참고)
   6. 강화된 배송유형 6종+1 분류
   7. 모바일/데스크톱 리뷰 API 폴백
   ============================================================ */

const HybridParser = {

  // ============================================================
  //  ★ 셀러라이프 k() 방식 — Background에서 직접 Coupang fetch
  //  가장 빠르고 리소스 적은 방식. credentials: include로 쿠키 포함.
  // ============================================================
  async fetchCoupangDirect(url) {
    const chromeVer = this._getChromeVersion();
    return fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'accept-encoding': 'gzip, deflate, br, zstd',
        'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6',
        'cache-control': 'max-age=0',
        'priority': 'u=0, i',
        'sec-ch-ua': `"Not)A;Brand";v="8", "Chromium";v="${chromeVer}", "Google Chrome";v="${chromeVer}"`,
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        'user-agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer}.0.0.0 Safari/537.36`,
      },
      referrerPolicy: 'unsafe-url',
    }).then(resp => {
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.text();
    });
  },

  // ============================================================
  //  ★ 셀러라이프 cData-v3 방식 — DNR 규칙 적용 후 fetch
  //  동적으로 DNR 규칙을 등록 → fetch → 규칙 제거
  // ============================================================
  async fetchWithDNR(url) {
    const chromeVer = this._getChromeVersion();
    const ruleId = 200; // 동적 규칙 전용 ID
    const rules = [{
      id: ruleId,
      priority: 5,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'accept', operation: 'set', value: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7' },
          { header: 'accept-encoding', operation: 'set', value: 'gzip, deflate, br, zstd' },
          { header: 'accept-language', operation: 'set', value: 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6' },
          { header: 'cache-control', operation: 'set', value: 'max-age=0' },
          { header: 'priority', operation: 'set', value: 'u=0, i' },
          { header: 'sec-ch-ua', operation: 'set', value: `"Not)A;Brand";v="8", "Chromium";v="${chromeVer}", "Google Chrome";v="${chromeVer}"` },
          { header: 'sec-ch-ua-mobile', operation: 'set', value: '?0' },
          { header: 'sec-ch-ua-platform', operation: 'set', value: '"Windows"' },
          { header: 'sec-fetch-dest', operation: 'set', value: 'document' },
          { header: 'sec-fetch-mode', operation: 'set', value: 'navigate' },
          { header: 'sec-fetch-site', operation: 'set', value: 'same-origin' },
          { header: 'sec-fetch-user', operation: 'set', value: '?1' },
          { header: 'upgrade-insecure-requests', operation: 'set', value: '1' },
          { header: 'user-agent', operation: 'set', value: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer}.0.0.0 Safari/537.36` },
          { header: 'pragma', operation: 'remove' },
          { header: 'sec-fetch-storage-access', operation: 'remove' },
        ],
      },
      condition: {
        urlFilter: 'https://www.coupang.com/',
        resourceTypes: ['xmlhttprequest'],
      },
    }];

    try {
      // 1. DNR 규칙 등록
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [ruleId],
        addRules: rules,
      });

      // 2. fetch 수행
      const resp = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        referrerPolicy: 'unsafe-url',
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const html = await resp.text();

      // 3. DNR 규칙 제거
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [ruleId],
      }).catch(() => {});

      return html;
    } catch (e) {
      // 규칙 정리
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [ruleId],
      }).catch(() => {});
      throw e;
    }
  },

  // ============================================================
  //  1. 탭에서 렌더링된 HTML 가져오기 (셀러라이프 cDataTab 방식)
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
  //  ★ 셀러라이프 cDataTab2 방식 — Hidden Tab + 폴링
  //  새 탭 생성 → 로드 완료 → HTML 크기 10KB까지 2초 간격 최대10회 폴링
  //  가장 확실한 방식 (SPA 렌더링 보장)
  // ============================================================
  async fetchViaHiddenTab(url, minSize = 10000, maxRetries = 10, retryInterval = 2000) {
    let tabId = null;
    try {
      // 1. 숨은 탭 생성
      const tab = await chrome.tabs.create({ url, active: false });
      tabId = tab.id;

      // 2. 페이지 로드 완료 대기 (최대 30초)
      await new Promise((resolve) => {
        let resolved = false;
        const listener = (tid, changeInfo) => {
          if (tid === tabId && changeInfo.status === 'complete') {
            if (!resolved) { resolved = true; chrome.tabs.onUpdated.removeListener(listener); resolve(true); }
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => {
          if (!resolved) { resolved = true; chrome.tabs.onUpdated.removeListener(listener); resolve(false); }
        }, 30000);
      });

      // 3. HTML 폴링 — 크기가 minSize(10KB) 이상이 될 때까지 반복
      let html = '';
      let retries = 0;

      const getHTML = () => new Promise((resolve, reject) => {
        chrome.scripting.executeScript({
          target: { tabId },
          func: () => document.documentElement.outerHTML,
        }, (results) => {
          if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
          resolve(results?.[0]?.result || '');
        });
      });

      html = await getHTML();
      while (html.length < minSize && retries < maxRetries) {
        retries++;
        await new Promise(r => setTimeout(r, retryInterval));
        html = await getHTML();
      }

      // 4. 탭 정리
      chrome.tabs.remove(tabId).catch(() => {});
      tabId = null;

      if (html.length >= minSize) {
        console.log(`[HP] cDataTab2 성공: HTML ${(html.length / 1024).toFixed(1)}KB (${retries}회 폴링)`);
        return html;
      } else {
        console.warn(`[HP] cDataTab2: HTML 크기 부족 ${html.length}바이트 (${retries}회 폴링 후)`);
        return html; // 부족하더라도 반환 (상위에서 판단)
      }
    } catch (e) {
      if (tabId) chrome.tabs.remove(tabId).catch(() => {});
      throw e;
    }
  },

  // ============================================================
  //  ★★★ 핵심: 다중 전략 HTML 수집 (셀러라이프 방식 통합) ★★★
  //  전략 1: Background fetch (k() 방식) — 가장 빠름
  //  전략 2: DNR 규칙 적용 후 fetch (cData-v3 방식)
  //  전략 3: 기존 탭 executeScript (cData-coupang 방식)
  //  전략 4: Hidden Tab + 폴링 (cDataTab2 방식) — 가장 확실
  // ============================================================
  async collectSearchHTML(keyword, options = {}) {
    const { tabId, page = 1, listSize = 36 } = options;
    const searchUrl = `https://www.coupang.com/np/search?q=${encodeURIComponent(keyword)}&channel=user&page=${page}&listSize=${listSize}`;
    
    // ★ v7.2.8: 전략 순서 변경 — 렌더링된 HTML(리뷰 포함) 우선
    // direct_fetch/dnr_fetch는 SSR HTML만 가져와서 rating/reviewCount가 0 (JS 동적로딩 미반영)
    // tab_script/hidden_tab은 JavaScript 렌더링 후 HTML → 리뷰 데이터 포함
    const strategies = [];

    // 1순위: 탭이 있으면 탭 기반 수집 (가장 정확, JS 렌더링 완료)
    if (tabId) {
      strategies.push({
        name: 'tab_script',
        fn: async () => {
          await chrome.tabs.update(tabId, { url: searchUrl });
          // 페이지 로드 대기
          await new Promise((resolve) => {
            let done = false;
            const listener = (tid, info) => {
              if (tid === tabId && info.status === 'complete') {
                if (!done) { done = true; chrome.tabs.onUpdated.removeListener(listener); resolve(); }
              }
            };
            chrome.tabs.onUpdated.addListener(listener);
            setTimeout(() => { if (!done) { done = true; chrome.tabs.onUpdated.removeListener(listener); resolve(); } }, 30000);
          });
          // 렌더링 안정화 대기
          await new Promise(r => setTimeout(r, 3000 + Math.random() * 3000));
          return this.getRenderedHTML(tabId);
        },
      });
    }

    // 2순위: Hidden Tab + 폴링 (JS 렌더링 보장, 느리지만 정확)
    strategies.push({
      name: 'hidden_tab_polling',
      fn: () => this.fetchViaHiddenTab(searchUrl),
    });

    // 3순위: 직접 fetch (빠르지만 SSR만 → 리뷰 미포함 가능)
    strategies.push(
      { name: 'direct_fetch', fn: () => this.fetchCoupangDirect(searchUrl) },
      { name: 'dnr_fetch', fn: () => this.fetchWithDNR(searchUrl) },
    );

    // 순차 시도
    for (const strategy of strategies) {
      try {
        console.log(`[HP] 전략 시도: ${strategy.name} — "${keyword}"`);
        const html = await strategy.fn();

        if (!html || html.length < 500) {
          console.warn(`[HP] ${strategy.name}: HTML 크기 부족 (${html?.length || 0}바이트)`);
          continue;
        }

        // 차단 페이지 확인
        if (/봇|robot|captcha|차단|접근.*불가|Access Denied|Please verify/i.test(html) && html.length < 5000) {
          console.warn(`[HP] ${strategy.name}: 접근 차단 감지`);
          continue;
        }

        // ★ v7.2.8: 리뷰 품질 검증 — 렌더링 전략에서만 기대
        // tab/hidden_tab 전략에서 HTML 잘 가져왔으면 바로 반환
        // direct_fetch/dnr_fetch는 리뷰 없을 수 있지만, 다른 전략 모두 실패시 최후 수단
        console.log(`[HP] ✅ ${strategy.name} 성공: HTML ${(html.length / 1024).toFixed(1)}KB`);
        return { html, strategy: strategy.name };
      } catch (e) {
        console.warn(`[HP] ${strategy.name} 실패:`, e.message);
        continue;
      }
    }

    console.error(`[HP] ❌ 모든 전략 실패: "${keyword}"`);
    return { html: '', strategy: 'NONE' };
  },

  // ============================================================
  //  2. HTML → 상품 데이터 파싱 (V1 + V2 자동 전환)
  // ============================================================
  parseSearchHTML(html, keyword) {
    const hasDOMParser = typeof DOMParser !== 'undefined';
    let result;

    // ★ DOMParser 사용 가능 시 (content script / sidepanel 컨텍스트)
    if (hasDOMParser) {
      const doc = new DOMParser().parseFromString(html, 'text/html');

      // V2 먼저 시도 (2025~2026 신형 DOM)
      result = this.parseV2(doc, keyword);
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
    } else {
      console.log('[HP] Service Worker 컨텍스트 — DOMParser 없음, SSR/Regex 파싱 사용');
    }

    // SSR JSON (DOMParser 불필요)
    result = this.parseSSRJson(html, keyword);
    if (result && result.items.length > 0) {
      result.domVersion = 'SSR';
      console.log(`[HP] SSR JSON 파싱 성공: ${result.items.length}개 상품`);
      return result;
    }

    // ★ Regex 기반 파싱 (Service Worker 호환, DOMParser 불필요)
    result = this.parseRegex(html, keyword);
    if (result && result.items.length > 0) {
      result.domVersion = 'REGEX';
      console.log(`[HP] Regex 파싱 성공: ${result.items.length}개 상품`);
      return result;
    }

    console.warn('[HP] 모든 파싱 전략 실패');
    return { items: [], totalProductCount: 0, domVersion: 'NONE', stats: this._emptyStats() };
  },

  // ============================================================
  //  V2 파서 — 쿠팡 2025~2026 React 기반 DOM
  //  셀러라이프 coupangItemSummaryV2 방식 정밀 구현
  // ============================================================
  parseV2(doc, keyword) {
    // V2 선택자: #product-list > li[class^="ProductUnit_productUnit"]
    const allCards = [...doc.querySelectorAll('#product-list > li[class^="ProductUnit_productUnit"]')];
    if (!allCards.length) return null;

    const items = [];
    const seen = new Set();
    let adCount = 0;

    // 총 상품수
    let totalProductCount = 0;
    const countInput = doc.querySelector('input[name="searchProductCount"]');
    if (countInput) totalProductCount = parseInt(countInput.value) || 0;
    if (!totalProductCount) totalProductCount = this._extractSearchCountFromScripts(doc) || 0;

    for (const card of allCards) {
      // 셀러라이프: 첫 페이지는 36개 제한
      if (items.length >= 72) break;

      // 광고 판별 (먼저 확인)
      const isAd = !!card.querySelector('[class*="AdMark_text"], [class*="AdMark_adMark"], [class*="ad-badge"], [class*="AdBadge"]');
      if (isAd) {
        adCount++;
        continue; // 광고 상품 제외 (셀러라이프 방식)
      }

      // 링크
      const linkEl = card.querySelector('a[href*="/products/"]') || card.querySelector('a');
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

      // 상품명 — 셀러라이프 V2 셀렉터
      const nameEl = card.querySelector('[class*="ProductUnit_productName"]')
        || card.querySelector('[class*="ProductUnit_productInfo"] [class*="name"]')
        || card.querySelector('[class*="productName"]');
      const title = nameEl?.textContent?.trim() || '';
      if (!title || title.length < 2) continue;

      // ★ 가격 (V2) — 셀러라이프 방식 다중 폴백
      let price = 0, originalPrice = 0;
      // 전략 1: Price_priceValue 클래스
      const priceEl = card.querySelector('[class*="Price_priceValue"]');
      if (priceEl) { const p = this._parseNumber(priceEl.textContent); if (p >= 100 && p < 1e8) price = p; }
      // 전략 2: PriceArea 내 '원' 포함 텍스트
      if (!price) {
        const priceArea = card.querySelector('[class*="PriceArea"], [class*="priceArea"], [class*="price-area"]');
        if (priceArea) {
          const spans = priceArea.querySelectorAll('span, em, strong, div');
          for (const el of spans) {
            const t = el.textContent?.trim();
            if (t && (t.includes(',') || /\d{3,}/.test(t)) && !t.includes('%')) {
              const p = this._parseNumber(t);
              if (p >= 100 && p < 100000000) { price = p; break; }
            }
          }
        }
      }
      // 전략 3: 카드 전체에서 가격 패턴 탐색
      if (!price) {
        const allEls = card.querySelectorAll('strong, em, span, div');
        for (const el of allEls) {
          const t = el.textContent?.trim();
          if (t && /^[\d,]+원?$/.test(t.replace(/\s/g, ''))) {
            const p = this._parseNumber(t);
            if (p >= 1000 && p < 100000000) { price = p; break; }
          }
        }
      }

      // 원래가격(할인전)
      const basePriceEl = card.querySelector('[class*="Price_basePrice"], [class*="OriginalPrice"], del, [class*="base-price"]');
      if (basePriceEl) originalPrice = this._parseNumber(basePriceEl.textContent);

      // ★★★ 평점 (V2 핵심: aria-label 방식) — 셀러라이프 정밀 구현 ★★★
      let rating = 0;
      let ratingIsEstimated = false;
      
      // 전략 1: aria-label (가장 정확)
      const ariaEls = card.querySelectorAll('[aria-label]');
      for (const ariaEl of ariaEls) {
        const ariaVal = ariaEl.getAttribute('aria-label') || '';
        // "5점 만점에 4.5" 또는 "4.5" 형태
        const rMatch = ariaVal.match(/([\d.]+)\s*점?\s*만점/) || ariaVal.match(/^([\d.]+)$/);
        if (rMatch) {
          const r = parseFloat(rMatch[1]);
          if (r >= 1.0 && r <= 5.0) { rating = r; break; }
        }
        // "4.5" 단독 패턴
        const simpleMatch = ariaVal.match(/^([\d.]+)$/);
        if (simpleMatch) {
          const r = parseFloat(simpleMatch[1]);
          if (r >= 1.0 && r <= 5.0) { rating = r; break; }
        }
      }

      // 전략 2: ProductRating 클래스 내 텍스트
      if (!rating) {
        const ratingContainer = card.querySelector('[class*="ProductRating_productRating"], [class*="ProductRating"], [class*="rating"]');
        if (ratingContainer) {
          const text = ratingContainer.textContent || '';
          const rMatch = text.match(/([\d.]+)/);
          if (rMatch) {
            const r = parseFloat(rMatch[1]);
            if (r >= 1.0 && r <= 5.0) rating = r;
          }
        }
      }

      // 전략 3: star width 기반 (V1 폴백)
      if (!rating) {
        const starEl = card.querySelector('[class*="rating-star"] [style*="width"], .star .rating[style*="width"]');
        if (starEl) {
          const style = starEl.getAttribute('style') || '';
          const wMatch = style.match(/width:\s*([\d.]+)%/);
          if (wMatch) rating = Math.round(parseFloat(wMatch[1]) / 20 * 10) / 10;
        }
      }

      // ★ 리뷰수 (V2) — 다중 패턴
      let reviewCount = 0;
      // 전략 1: ProductRating 클래스 내 괄호 숫자
      const reviewEl = card.querySelector('[class*="ProductRating_productRating"]');
      if (reviewEl) {
        const text = reviewEl.textContent || '';
        // (1,234) 또는 (1234) 패턴
        const rMatch = text.match(/\((\d[\d,]*)\)/);
        if (rMatch) reviewCount = this._parseNumber(rMatch[1]);
        // 괄호 없이 순수 숫자 패턴 (rating 뒤)
        if (!reviewCount) {
          const nums = text.match(/\d[\d,]+/g);
          if (nums && nums.length >= 2) {
            // 두 번째 숫자가 리뷰수 (첫 번째는 평점)
            reviewCount = this._parseNumber(nums[1]);
          }
        }
      }
      // 전략 2: 카드 전체에서 괄호 안 숫자
      if (!reviewCount) {
        const allText = card.textContent || '';
        const matches = allText.match(/\((\d[\d,]*)\)/g);
        if (matches) {
          for (const m of matches) {
            const n = this._parseNumber(m);
            if (n > 0 && n < 10000000) { reviewCount = n; break; }
          }
        }
      }

      // 리뷰는 있는데 평점이 없으면 추정 (셀러라이프 방식)
      if (!rating && reviewCount > 0) {
        rating = reviewCount >= 500 ? 4.6 : reviewCount >= 100 ? 4.5 : reviewCount >= 30 ? 4.3 : 4.0;
        ratingIsEstimated = true;
      }

      // ★★★ 배송유형 6종 분류 (셀러라이프 getProductDeliveryTypeV2 정밀 구현) ★★★
      const deliveryInfo = this._classifyDeliveryV2(card);

      // 순위 배지
      let rankNum = 0;
      const rankEl = card.querySelector('[class*="RankMark_rank"], [class*="rankMark"]');
      if (rankEl) {
        rankNum = parseInt(rankEl.textContent?.replace(/[^0-9]/g, '')) || 0;
      }

      // 이미지
      const imgEl = card.querySelector('[class*="ProductUnit_productImage"] img, [class*="productImage"] img, img');
      let imageUrl = imgEl?.getAttribute('src') || imgEl?.getAttribute('data-img-src') || '';
      if (imageUrl.includes('blank1x1') || imageUrl.includes('data:image')) {
        imageUrl = imgEl?.getAttribute('data-img-src') || imgEl?.getAttribute('data-src') || '';
      }

      // 도착예정일
      let arrivalDate = '';
      const arrivalEl = card.querySelector('[class*="DeliveryInfo"] span, [class*="deliveryInfo"] span, [class*="arrival"]');
      if (arrivalEl) arrivalDate = arrivalEl.textContent?.trim() || '';

      items.push({
        productId: pid,
        vendorItemId,
        title,
        price,
        originalPrice,
        rating,
        ratingIsEstimated,
        reviewCount,
        isAd: false,
        isRocket: deliveryInfo.type === 'rocketDelivery' || deliveryInfo.type === 'sellerRocketDelivery',
        deliveryType: deliveryInfo.type,
        deliveryLabel: deliveryInfo.label,
        imageUrl,
        url: fullUrl,
        position: items.length + 1,
        rankNum,
        arrivalDate,
        query: keyword,
      });
    }

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
    if (!cards.length) cards = [...doc.querySelectorAll('li[class*="search-product"]')];
    if (!cards.length) return null;

    const items = [];
    const seen = new Set();
    let adCount = 0;
    const totalProductCount = parseInt(doc.querySelector('input[name="searchProductCount"]')?.value) || 0;

    for (const card of cards) {
      if (items.length >= 72) break;

      // 광고
      let isAd = false;
      if (card.querySelector('.ad-badge-text, .ad-badge, [class*="ad-badge"]')) {
        isAd = true; adCount++;
      } else {
        const texts = [...card.querySelectorAll('span, em, div')];
        for (const el of texts) {
          const t = el.textContent?.trim();
          if (t && (t === 'AD' || t === '광고') && t.length <= 5) { isAd = true; adCount++; break; }
        }
      }
      if (isAd) continue;

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

      const nameEl = card.querySelector('div.name, .name, [class*="name"]');
      const title = nameEl?.textContent?.trim() || card.querySelector('img')?.getAttribute('alt') || '';
      if (!title || title.length < 2) continue;

      let price = 0, originalPrice = 0;
      const priceEl = card.querySelector('strong.price-value, .price-value, [class*="price-value"]');
      if (priceEl) price = this._parseNumber(priceEl.textContent);
      const basePriceEl = card.querySelector('del.base-price, .base-price, del[class*="price"]');
      if (basePriceEl) originalPrice = this._parseNumber(basePriceEl.textContent);

      let rating = 0, ratingIsEstimated = false;
      const ratingEl = card.querySelector('em.rating, .rating, [class*="rating-score"]');
      if (ratingEl) {
        const r = parseFloat(ratingEl.textContent);
        if (r >= 1.0 && r <= 5.0) rating = r;
      }
      if (!rating) {
        const ariaEl = card.querySelector('[aria-label]');
        if (ariaEl) {
          const r = parseFloat(ariaEl.getAttribute('aria-label'));
          if (r >= 1.0 && r <= 5.0) rating = r;
        }
      }
      if (!rating) {
        const starEl = card.querySelector('.star .rating, [class*="rating-star"] [style*="width"]');
        if (starEl) {
          const style = starEl.getAttribute('style') || '';
          const wMatch = style.match(/width:\s*([\d.]+)%/);
          if (wMatch) rating = Math.round(parseFloat(wMatch[1]) / 20 * 10) / 10;
        }
      }

      let reviewCount = 0;
      const reviewEl = card.querySelector('span.rating-total-count, .rating-total-count, [class*="rating-count"]');
      if (reviewEl) reviewCount = this._parseNumber(reviewEl.textContent.replace(/[()]/g, ''));

      if (!rating && reviewCount > 0) {
        rating = reviewCount >= 500 ? 4.6 : reviewCount >= 100 ? 4.5 : reviewCount >= 30 ? 4.3 : 4.0;
        ratingIsEstimated = true;
      }

      const deliveryInfo = this._classifyDeliveryV1(card);
      let rankNum = 0;
      const rankEl = card.querySelector('.number, [class*="rank"]');
      if (rankEl) {
        const n = parseInt(rankEl.textContent?.replace(/[^0-9]/g, ''));
        if (n > 0 && n <= 50) rankNum = n;
      }

      const imgEl = card.querySelector('dt.image img, .search-product-wrap-img, img');
      let imageUrl = imgEl?.getAttribute('src') || imgEl?.getAttribute('data-img-src') || '';
      if (imageUrl.includes('blank1x1')) imageUrl = imgEl?.getAttribute('data-img-src') || '';

      items.push({
        productId: pid, vendorItemId, title, price, originalPrice,
        rating, ratingIsEstimated, reviewCount,
        isAd: false,
        isRocket: deliveryInfo.type === 'rocketDelivery' || deliveryInfo.type === 'sellerRocketDelivery',
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
      // __NEXT_DATA__
      const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (nextDataMatch) {
        const data = JSON.parse(nextDataMatch[1]);
        const products = data?.props?.pageProps?.compositeList?.list
          || data?.props?.pageProps?.shoppingResult?.products
          || data?.props?.pageProps?.productList
          || [];
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

      // __next_f.push 방식 (RSC 스트리밍)
      if (!items.length) {
        const pushMatches = html.match(/__next_f\.push\(\[[\d,]+,"([\s\S]*?)"\]\)/g) || [];
        for (const m of pushMatches) {
          try {
            const jsonStr = m.match(/"([\s\S]*?)"\]/)?.[1]?.replace(/\\"/g, '"')?.replace(/\\\\/g, '\\');
            if (jsonStr?.includes('productId')) {
              const parsed = JSON.parse(jsonStr);
              if (Array.isArray(parsed)) {
                for (const p of parsed) {
                  if (p?.productId && !p.adId) {
                    items.push({
                      productId: String(p.productId),
                      title: p.productName || '',
                      price: parseInt(p.price) || 0,
                      rating: parseFloat(p.ratingScore) || 0,
                      reviewCount: parseInt(p.reviewCount) || 0,
                      isAd: false, isRocket: !!p.isRocket,
                      deliveryType: p.isRocket ? 'rocketDelivery' : 'normalDelivery',
                      deliveryLabel: p.isRocket ? '로켓배송' : '일반배송',
                      imageUrl: p.imageUrl || '',
                      url: `https://www.coupang.com/vp/products/${p.productId}`,
                      position: items.length + 1, query: keyword,
                    });
                  }
                }
              }
            }
          } catch (_) {}
        }
      }
    } catch (e) {
      console.warn('[HP] SSR JSON 파싱 실패:', e.message);
    }
    return { items, totalProductCount: items.length, adCount: 0, stats: this._calcStats(items) };
  },

  // ============================================================
  //  Regex 파서 — Service Worker 호환 (DOMParser 불필요)
  //  HTML 원문에서 정규식으로 상품 데이터 추출
  // ============================================================
  parseRegex(html, keyword) {
    const items = [];
    const seen = new Set();
    let adCount = 0;

    // 총 상품수 추출
    let totalProductCount = 0;
    const countMatch = html.match(/name="searchProductCount"[^>]*value="(\d+)"/)
      || html.match(/searchProductCount["']\s*(?:value|content)\s*=\s*["'](\d+)/);
    if (countMatch) totalProductCount = parseInt(countMatch[1]) || 0;

    // 방법 1: V2 ProductUnit 기반 regex
    // 각 상품 li 블록을 추출
    const productBlocks = html.match(/<li[^>]*class="[^"]*ProductUnit_productUnit[^"]*"[\s\S]*?<\/li>/gi) || [];
    
    for (const block of productBlocks) {
      if (items.length >= 72) break;

      // 광고 체크
      if (/AdMark_text|AdMark_adMark|ad-badge|AdBadge/i.test(block)) {
        adCount++;
        continue;
      }

      // 상품 ID
      const pidMatch = block.match(/\/products\/(\d+)/);
      if (!pidMatch) continue;
      const pid = pidMatch[1];
      if (seen.has(pid)) continue;
      seen.add(pid);

      // vendorItemId
      const vidMatch = block.match(/vendorItemId=(\d+)/i);
      const vendorItemId = vidMatch ? vidMatch[1] : null;

      // URL
      const hrefMatch = block.match(/href="([^"]*\/products\/\d+[^"]*)"/);
      const href = hrefMatch ? hrefMatch[1] : `/vp/products/${pid}`;
      const fullUrl = href.startsWith('http') ? href : `https://www.coupang.com${href}`;

      // 상품명 — ProductUnit_productName 내 텍스트 또는 title 속성
      let title = '';
      const titleMatch = block.match(/class="[^"]*productName[^"]*"[^>]*>([^<]+)</) 
        || block.match(/title="([^"]{2,})"/);
      if (titleMatch) title = titleMatch[1].trim();
      // 더 넓은 패턴 시도
      if (!title) {
        const altMatch = block.match(/alt="([^"]{4,})"/);
        if (altMatch) title = altMatch[1].trim();
      }
      if (!title || title.length < 2) continue;

      // 가격 — "N,NNN원" 패턴 (할인율 등 숫자 방지)
      let price = 0;
      // 전략 1: Price_priceValue 클래스 내 가격
      const priceClassMatch = block.match(/Price_priceValue[^"]*"[^>]*>([^<]*\d[\d,]+원?[^<]*)</i);
      if (priceClassMatch) {
        const pMatch = priceClassMatch[1].match(/(\d{1,3}(?:,\d{3})+)\s*원?/);
        if (pMatch) { const p = parseInt(pMatch[1].replace(/,/g, ''), 10); if (p >= 100 && p < 1e8) price = p; }
      }
      // 전략 2: 일반 가격 패턴 (N,NNN원)
      if (!price) {
        const pricePatterns = block.match(/(\d{1,3}(?:,\d{3})+)\s*원/g) || [];
        for (const pp of pricePatterns) {
          const numMatch = pp.match(/(\d{1,3}(?:,\d{3})+)/);
          if (numMatch) {
            const p = parseInt(numMatch[1].replace(/,/g, ''), 10);
            if (p >= 100 && p < 1e8) { price = p; break; }
          }
        }
      }

      // 평점 — aria-label 또는 텍스트 패턴
      let rating = 0;
      const ariaMatch = block.match(/aria-label="([^"]*\d[^"]*)"/g);
      if (ariaMatch) {
        for (const am of ariaMatch) {
          const rm = am.match(/(\d\.\d)/);
          if (rm) { const r = parseFloat(rm[1]); if (r >= 1 && r <= 5) { rating = r; break; } }
        }
      }
      // 전략 2: ProductRating 내 텍스트
      if (!rating) {
        const ratingSection = block.match(/ProductRating[^"]*"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)/i);
        if (ratingSection) {
          const rm = ratingSection[1].match(/(\d\.\d)/);
          if (rm) { const r = parseFloat(rm[1]); if (r >= 1 && r <= 5) rating = r; }
        }
      }

      // 리뷰수 — (N,NNN) 또는 (NNN) 패턴
      let reviewCount = 0;
      const reviewMatches = block.match(/\((\d[\d,]*)\)/g) || [];
      for (const rm of reviewMatches) {
        const nm = rm.match(/\((\d[\d,]*)\)/);
        if (nm) {
          const n = parseInt(nm[1].replace(/,/g, ''), 10);
          if (n > 0 && n < 10000000) { reviewCount = n; break; }
        }
      }

      // 리뷰는 있는데 평점이 없으면 추정
      if (!rating && reviewCount > 0) {
        rating = reviewCount >= 500 ? 4.6 : reviewCount >= 100 ? 4.5 : reviewCount >= 30 ? 4.3 : 4.0;
      }

      // 로켓배송 여부
      const isRocket = /로켓배송|rocketDelivery|rocket|badge-id.*ROCKET/i.test(block);

      // 이미지
      let imageUrl = '';
      const imgMatch = block.match(/(?:src|data-img-src)="(https?:\/\/[^"]*(?:coupangcdn|thumbnail)[^"]*)"/);
      if (imgMatch) imageUrl = imgMatch[1];

      items.push({
        productId: pid,
        vendorItemId,
        title,
        price,
        originalPrice: 0,
        rating,
        ratingIsEstimated: (!rating && reviewCount > 0),
        reviewCount,
        isAd: false,
        isRocket,
        deliveryType: isRocket ? 'rocketDelivery' : 'normalDelivery',
        deliveryLabel: isRocket ? '로켓배송' : '일반배송',
        imageUrl,
        url: fullUrl,
        position: items.length + 1,
        rankNum: 0,
        arrivalDate: '',
        query: keyword,
      });
    }

    // 방법 2: V1 검색상품 블록
    if (!items.length) {
      const v1Blocks = html.match(/<li[^>]*class="[^"]*search-product[^"]*"[\s\S]*?<\/li>/gi) || [];
      for (const block of v1Blocks) {
        if (items.length >= 72) break;
        if (/ad-badge|AdBadge|광고/i.test(block)) { adCount++; continue; }

        const pidMatch = block.match(/\/products\/(\d+)/);
        if (!pidMatch) continue;
        const pid = pidMatch[1];
        if (seen.has(pid)) continue;
        seen.add(pid);

        let title = '';
        const nameMatch = block.match(/class="[^"]*name[^"]*"[^>]*>([^<]+)</) || block.match(/title="([^"]{2,})"/);
        if (nameMatch) title = nameMatch[1].trim();
        if (!title) { const altMatch = block.match(/alt="([^"]{4,})">/); if (altMatch) title = altMatch[1].trim(); }
        if (!title || title.length < 2) continue;

        let price = 0;
        const pricePatterns = block.match(/(\d{1,3}(?:,\d{3})+)\s*원/g) || [];
        for (const pp of pricePatterns) {
          const numMatch = pp.match(/(\d{1,3}(?:,\d{3})+)/);
          if (numMatch) { const p = parseInt(numMatch[1].replace(/,/g, ''), 10); if (p >= 100 && p < 1e8) { price = p; break; } }
        }

        let rating = 0;
        const starMatch = block.match(/width:\s*([\d.]+)%/);
        if (starMatch) rating = Math.round(parseFloat(starMatch[1]) / 20 * 10) / 10;

        let reviewCount = 0;
        const revMatches = block.match(/\((\d[\d,]*)\)/g) || [];
        for (const rm of revMatches) {
          const nm = rm.match(/\((\d[\d,]*)\)/);
          if (nm) { const n = parseInt(nm[1].replace(/,/g, ''), 10); if (n > 0 && n < 10000000) { reviewCount = n; break; } }
        }

        const isRocket = /로켓배송|rocketDelivery|rocket/i.test(block);

        items.push({
          productId: pid, vendorItemId: null, title, price, originalPrice: 0,
          rating, ratingIsEstimated: false, reviewCount, isAd: false, isRocket,
          deliveryType: isRocket ? 'rocketDelivery' : 'normalDelivery',
          deliveryLabel: isRocket ? '로켓배송' : '일반배송',
          imageUrl: '', url: `https://www.coupang.com/vp/products/${pid}`,
          position: items.length + 1, rankNum: 0, arrivalDate: '', query: keyword,
        });
      }
    }

    return { items, totalProductCount: totalProductCount || items.length, adCount, stats: this._calcStats(items) };
  },

  // ============================================================
  //  배송유형 분류 — V2 (셀러라이프 getProductDeliveryTypeV2 정밀 구현)
  // ============================================================
  _classifyDeliveryV2(card) {
    // 전략 1: data-badge-id 속성 (V2 핵심, 가장 정확)
    const badgeEl = card.querySelector('[data-badge-id]');
    if (badgeEl) {
      const badgeId = (badgeEl.getAttribute('data-badge-id') || '').toUpperCase();
      if (badgeId === 'ROCKET' || badgeId === 'TOMORROW' || badgeId === 'ROCKET_FRESH')
        return { type: 'rocketDelivery', label: '로켓배송' };
      if (badgeId === 'COUPANG_GLOBAL' || badgeId === 'GLOBAL')
        return { type: 'globalRocketDelivery', label: '로켓직구' };
      if (badgeId === 'ROCKET_MERCHANT' || badgeId === 'SELLER_ROCKET')
        return { type: 'sellerRocketDelivery', label: '판매자로켓' };
      if (badgeId === 'FRESH')
        return { type: 'rocketFreshDelivery', label: '로켓프레시' };
    }

    // 전략 2: 배지 텍스트
    const badgeTexts = card.querySelectorAll('[class*="Badge"], [class*="badge"]');
    for (const el of badgeTexts) {
      const text = el.textContent?.trim();
      if (text === '로켓배송') return { type: 'rocketDelivery', label: '로켓배송' };
      if (text === '로켓직구') return { type: 'globalRocketDelivery', label: '로켓직구' };
      if (text === '판매자로켓' || text === '로켓그로스') return { type: 'sellerRocketDelivery', label: '판매자로켓' };
      if (text === '로켓프레시') return { type: 'rocketFreshDelivery', label: '로켓프레시' };
    }

    // 전략 3: 이미지 배지 (V1/V2 공용)
    return this._classifyByImageBadge(card);
  },

  // ============================================================
  //  배송유형 분류 — V1
  // ============================================================
  _classifyDeliveryV1(card) {
    const badgeImg = card.querySelector('span.badge img, [class*="badge"] img, [class*="ImageBadge"] img');
    const alt = badgeImg?.getAttribute('alt') || '';
    const src = badgeImg?.getAttribute('src') || '';

    if (alt === '로켓배송') {
      if (src.includes('rds') || src.includes('RocketMerchant')) return { type: 'sellerRocketDelivery', label: '판매자로켓' };
      return { type: 'rocketDelivery', label: '로켓배송' };
    }
    if (alt === '로켓직구') return { type: 'globalRocketDelivery', label: '로켓직구' };
    if (alt === '로켓프레시') return { type: 'rocketFreshDelivery', label: '로켓프레시' };

    return this._classifyByImageBadge(card);
  },

  _classifyByImageBadge(card) {
    const imgs = card.querySelectorAll('img[src], img[data-src]');
    for (const img of imgs) {
      const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
      const alt = img.getAttribute('alt') || '';
      
      // 로켓배송
      if (src.includes('logo_rocket') || src.includes('badge_1998ab96bf7') || src.includes('rocket_install') || src.includes('rocket-install'))
        return { type: 'rocketDelivery', label: '로켓배송' };
      // 판매자로켓 (rds 포함 특정 배지)
      if (src.includes('rds') && (src.includes('RocketMerchant') || src.includes('badge_199559e56f7') || src.includes('badge_1998ac2b665')))
        return { type: 'sellerRocketDelivery', label: '판매자로켓' };
      // 로켓직구
      if ((src.includes('rds') && src.includes('jikgu')) || src.includes('badge/badge'))
        return { type: 'globalRocketDelivery', label: '로켓직구' };
      // alt 텍스트 기반
      if (alt === '로켓배송') return { type: 'rocketDelivery', label: '로켓배송' };
      if (alt === '로켓직구') return { type: 'globalRocketDelivery', label: '로켓직구' };
    }

    // 전략 3: 도착예정일 기반 해외직구 판별 (셀러라이프 방식)
    const deliverySpan = card.querySelector('[class*="DeliveryInfo"] span, .arrival-info em, [class*="deliveryInfo"] span');
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
        if (diff > 7 * 24 * 60 * 60 * 1000) return { type: 'internationalDelivery', label: '해외직구' };
        return { type: 'normalDelivery', label: '일반배송' };
      }
      if (text.includes('내일') || text.includes('모레')) return { type: 'normalDelivery', label: '일반배송' };
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
    const chromeVer = this._getChromeVersion();
    try {
      for (let page = 0; page < maxPages; page++) {
        const url = `https://m.coupang.com/vm/products/${productId}/brand-sdp/reviews/list?page=${page}&slotSize=10&reviewOnly=true`;
        const resp = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'ko-KR,ko;q=0.9',
            'User-Agent': `Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer}.0.0.0 Mobile Safari/537.36`,
          },
        });
        if (!resp.ok) break;
        const data = await resp.json();
        if (!data?.reviews?.length) break;
        reviews.push(...data.reviews);
        if (reviews.length >= data.totalCount || reviews.length >= 90) break;
        await new Promise(r => setTimeout(r, 100 + Math.random() * 200));
      }
    } catch (e) {
      console.warn('[HP] 모바일 리뷰 API 실패:', e.message);
    }
    return reviews;
  },

  // ============================================================
  //  데스크톱 리뷰 API 호출 (셀러라이프 cReviewData 방식)
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
        if (typeof DOMParser !== 'undefined') {
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
        } else {
          // Service Worker 컨텍스트: regex로 리뷰 추출
          const reviewBlocks = html.match(/class="[^"]*sdp-review__article__list__review[^"]*"[\s\S]*?<\/article>/gi) || [];
          if (!reviewBlocks.length) break;
          for (const block of reviewBlocks) {
            const widthMatch = block.match(/star-orange[^>]*style="[^"]*width:\s*([\d.]+)%/);
            const rating = widthMatch ? Math.round(parseFloat(widthMatch[1]) / 20 * 10) / 10 : 0;
            const headMatch = block.match(/headline[^>]*>([^<]+)</);
            const contentMatch = block.match(/review__content[^>]*>([^<]+)</);
            const dateMatch = block.match(/reg-date[^>]*>([^<]+)</);
            const nameMatch = block.match(/user__name[^>]*>([^<]+)</);
            reviews.push({
              rating,
              headline: headMatch ? headMatch[1].trim() : '',
              content: contentMatch ? contentMatch[1].trim() : '',
              date: dateMatch ? dateMatch[1].trim() : '',
              userName: nameMatch ? nameMatch[1].trim() : '',
              source: 'desktop',
            });
          }
        }
        if (reviews.length >= 50) break;
        await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
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
    let reviews = await this.fetchMobileReviews(productId, maxPages);
    if (reviews.length > 0) {
      console.log(`[HP] 모바일 리뷰 ${reviews.length}개 수집 성공`);
      return reviews;
    }
    console.log('[HP] 모바일 리뷰 실패, 데스크톱 폴백...');
    reviews = await this.fetchDesktopReviews(productId, 5);
    console.log(`[HP] 데스크톱 리뷰 ${reviews.length}개 수집`);
    return reviews;
  },

  // ============================================================
  //  declarativeNetRequest 헤더 위조 설정 (셀러라이프 완전 반영)
  // ============================================================
  async setupCoupangHeaders() {
    try {
      const chromeVer = this._getChromeVersion();
      const rules = [
        // Rule 1: www.coupang.com — 데스크톱 브라우저 헤더 위조 (셀러라이프 coupangSearch 완전 반영)
        {
          id: 100,
          priority: 3,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'accept', operation: 'set', value: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7' },
              { header: 'accept-encoding', operation: 'set', value: 'gzip, deflate, br, zstd' },
              { header: 'accept-language', operation: 'set', value: 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6' },
              { header: 'cache-control', operation: 'set', value: 'max-age=0' },
              { header: 'priority', operation: 'set', value: 'u=0, i' },
              { header: 'sec-ch-ua', operation: 'set', value: `"Not)A;Brand";v="8", "Chromium";v="${chromeVer}", "Google Chrome";v="${chromeVer}"` },
              { header: 'sec-ch-ua-mobile', operation: 'set', value: '?0' },
              { header: 'sec-ch-ua-platform', operation: 'set', value: '"Windows"' },
              { header: 'sec-fetch-dest', operation: 'set', value: 'document' },
              { header: 'sec-fetch-mode', operation: 'set', value: 'navigate' },
              { header: 'sec-fetch-site', operation: 'set', value: 'same-origin' },
              { header: 'sec-fetch-user', operation: 'set', value: '?1' },
              { header: 'upgrade-insecure-requests', operation: 'set', value: '1' },
              { header: 'user-agent', operation: 'set', value: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer}.0.0.0 Safari/537.36` },
              // ★ 셀러라이프: 불필요 헤더 제거
              { header: 'pragma', operation: 'remove' },
              { header: 'sec-fetch-storage-access', operation: 'remove' },
            ],
          },
          condition: {
            urlFilter: 'https://www.coupang.com/',
            resourceTypes: ['xmlhttprequest', 'main_frame', 'sub_frame'],
          },
        },
        // Rule 2: m.coupang.com — 모바일 리뷰 API 헤더 위조
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
        // Rule 3: 쿠팡 리뷰 API (데스크톱)
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
              { header: 'referer', operation: 'set', value: 'https://www.coupang.com/vp/products' },
            ],
          },
          condition: {
            urlFilter: 'https://www.coupang.com/vp/product/reviews',
            resourceTypes: ['xmlhttprequest'],
          },
        },
      ];

      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [100, 101, 102, 200],
        addRules: rules,
      });
      console.log('[HP] declarativeNetRequest 헤더 설정 완료 (3+1 규칙)');
    } catch (e) {
      console.warn('[HP] declarativeNetRequest 설정 실패:', e.message);
    }
  },

  // ============================================================
  //  통계 계산 유틸
  // ============================================================
  _calcStats(items) {
    // 가격 상한 1억원 (INT 오버플로 방지)
    const MAX_PRICE = 100000000;
    const prices = items.map(i => i.price).filter(p => p > 0 && p < MAX_PRICE);
    const ratings = items.map(i => i.rating).filter(r => r > 0 && r <= 5);
    const reviews = items.map(i => i.reviewCount).filter(r => r > 0);
    const deliveryTypes = {};
    for (const item of items) {
      const dt = item.deliveryType || 'unknown';
      deliveryTypes[dt] = (deliveryTypes[dt] || 0) + 1;
    }
    return {
      avgPrice: prices.length ? Math.min(Math.round(prices.reduce((a, b) => a + b, 0) / prices.length), MAX_PRICE) : 0,
      minPrice: prices.length ? Math.min(...prices) : 0,
      maxPrice: prices.length ? Math.min(Math.max(...prices), MAX_PRICE) : 0,
      avgRating: ratings.length ? +(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : 0,
      avgReview: reviews.length ? Math.round(reviews.reduce((a, b) => a + b, 0) / reviews.length) : 0,
      totalReviewSum: reviews.reduce((a, b) => a + b, 0),
      medianReview: reviews.length ? reviews.sort((a, b) => a - b)[Math.floor(reviews.length / 2)] : 0,
      adCount: items.filter(i => i.isAd).length,
      rocketCount: items.filter(i => i.isRocket).length,
      highReviewCount: items.filter(i => i.reviewCount >= 100).length,
      newProductCount: items.filter(i => i.reviewCount < 10).length,
      priceRate: items.length ? Math.round(prices.length / items.length * 100) : 0,
      ratingRate: items.length ? Math.round(ratings.length / items.length * 100) : 0,
      reviewRate: items.length ? Math.round(reviews.length / items.length * 100) : 0,
      deliveryTypes,
    };
  },

  _emptyStats() {
    return {
      avgPrice: 0, minPrice: 0, maxPrice: 0, avgRating: 0, avgReview: 0,
      totalReviewSum: 0, medianReview: 0, adCount: 0, rocketCount: 0,
      highReviewCount: 0, newProductCount: 0,
      priceRate: 0, ratingRate: 0, reviewRate: 0, deliveryTypes: {},
    };
  },

  _parseNumber(str) {
    if (!str) return 0;
    str = str.trim();
    // "N,NNN원" or "N,NNN" pattern
    const priceMatch = str.match(/(\d{1,3}(?:,\d{3})+)\s*원?$/);
    if (priceMatch) return parseInt(priceMatch[1].replace(/,/g, ''), 10) || 0;
    // "NNN원" pattern
    const simpleMatch = str.match(/(\d+)\s*원?$/);
    if (simpleMatch) return parseInt(simpleMatch[1], 10) || 0;
    // Pure number with commas
    const commaMatch = str.match(/(\d{1,3}(?:,\d{3})+)/);
    if (commaMatch) return parseInt(commaMatch[1].replace(/,/g, ''), 10) || 0;
    // Fallback: strip non-digits
    return parseInt(str.replace(/[^0-9]/g, ''), 10) || 0;
  },

  _getChromeVersion() {
    return (navigator.userAgent.match(/Chrome\/(\d+)/) || [, '138'])[1];
  },
};
