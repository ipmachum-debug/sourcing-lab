/* ============================================================
   Coupang Sourcing Helper — WING Content Script v5.0
   wing.coupang.com 인기상품검색 데이터 자동 수집
   
   전략:
   1) injected-wing.js로 XHR/fetch 응답 가로채기 (가장 안정적)
   2) DOM에서 직접 인기상품 데이터 파싱 (fallback)
   3) 팝업/모달 열림 감지하여 자동 추출
   4) SPA 네비게이션 감지 (URL 변경 시 재스캔)
   ============================================================ */
(function () {
  'use strict';

  const VERSION = '4.5';
  let lastSignature = '';
  let lastUrl = location.href;
  let debounceTimer = null;
  let injectedReady = false;
  let apiDataReceived = false;

  function log(...args) {
    console.log(`[SourcingHelper WING v${VERSION}]`, ...args);
  }

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
      log('injected-wing.js 인젝트 완료');
    } catch (e) {
      log('WING inject failed:', e.message);
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
      log('injected-wing.js ready');
      return;
    }

    if (type === 'WING_API_RESPONSE') {
      log('API 응답 수신:', payload?.products?.length, '개 상품');
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

    log('API 데이터 전송:', data.keyword, data.items.length, '개');
    sendToBackground(data);
  }

  // ============================================================
  //  3) DOM 기반 인기상품 파싱 (Fallback) — v5.0 대폭 개선
  // ============================================================

  function parseWingPopularProducts() {
    const items = [];

    // -- 전략 A: 테이블 행에서 추출 (WING 테이블 레이아웃)
    const tableRows = document.querySelectorAll(
      'table tbody tr, ' +
      '[class*="product"] tr, ' +
      '[class*="item"] tr, ' +
      '[class*="ranking"] tr, ' +
      '[class*="popular"] tr, ' +
      '[class*="best"] tr, ' +
      '[class*="search-result"] tr, ' +
      '[class*="searchResult"] tr'
    );

    for (const row of tableRows) {
      if (items.length >= 100) break;
      const item = parseTableRow(row, items.length + 1);
      if (item) items.push(item);
    }

    if (items.length >= 3) {
      log(`테이블 파싱 성공: ${items.length}개`);
      return items;
    }

    // -- 전략 B: WING 인기상품 카드/리스트 기반 파싱 (v5.0 강화)
    const cardSelectors = [
      // React/WING 컴포넌트 기반 선택자
      '[class*="ProductCard"]',
      '[class*="productCard"]',
      '[class*="product-card"]',
      '[class*="product-item"]',
      '[class*="ProductItem"]',
      '[class*="productItem"]',
      '[class*="item-card"]',
      '[class*="ItemCard"]',
      '[class*="ranking-item"]',
      '[class*="popular-item"]',
      '[class*="best-item"]',
      '[class*="searchResultItem"]',
      '[class*="SearchResultItem"]',
      '[class*="search-result-item"]',
      '[class*="ResultItem"]',
      '[class*="resultItem"]',
      '[class*="ListItem"]',
      '[class*="listItem"]',
      '[class*="list-item"]',
      // data 속성 기반
      '[data-product-id]',
      '[data-item-id]',
      '[data-product]',
      '[data-testid*="product"]',
      '[data-testid*="item"]',
      // 구조 기반
      'li[class*="product"]',
      'li[class*="item"]',
      'div[class*="product-list"] > div',
      'div[class*="productList"] > div',
      'div[class*="product-grid"] > div',
      'div[class*="searchResult"] > div',
    ];

    const cards = document.querySelectorAll(cardSelectors.join(','));
    for (const card of cards) {
      if (items.length >= 100) break;
      const item = parseProductCard(card, items.length + 1);
      if (item) items.push(item);
    }

    if (items.length >= 3) {
      log(`카드 파싱 성공: ${items.length}개`);
      return items;
    }

    // -- 전략 C: 범용 DOM 탐색 (v5.0 새로 추가)
    // WING 인기상품 페이지의 실제 DOM 구조를 범용적으로 탐색
    const genericItems = parseGenericProductList();
    if (genericItems.length >= 1) {
      log(`범용 파싱 성공: ${genericItems.length}개`);
      return genericItems;
    }

    log('DOM 파싱 실패: 상품을 찾지 못함');
    return items;
  }

  // -- 전략 C: 범용 DOM 탐색 --
  // WING 인기상품검색 페이지는 React 기반으로 클래스명이 해시화될 수 있음
  // 이미지 + 텍스트 + 가격 패턴을 조합하여 상품 블록을 자동 감지
  function parseGenericProductList() {
    const items = [];

    // 방법 1: 가격 패턴(원)이 포함된 블록 기준으로 상품 추출
    const allElements = document.querySelectorAll('div, li, article, section, tr');
    const productBlocks = [];

    for (const el of allElements) {
      const elText = text(el);
      // 상품 블록 조건: 가격(원) + 이미지 or 충분한 텍스트
      const hasPrice = /[\d,]+\s*원/.test(elText);
      const hasImage = !!el.querySelector('img[src*="coupang"], img[src*="thumbnail"], img[src*="image"], img[src*="http"]');
      const hasRating = /[★☆]|(\d\.\d)\s*(점|\/\s*5)|\d\.\d/.test(elText);
      const hasReview = /리뷰|review|(\d[\d,]*)\s*건/i.test(elText);
      const hasViewCount = /조회|view|클릭|(\d[\d,]*)\s*회/i.test(elText);

      // 상품으로 판단되는 조건
      if (hasPrice && (hasImage || hasRating || hasReview || hasViewCount)) {
        // 너무 큰 컨테이너는 제외 (전체 페이지 등)
        const rect = el.getBoundingClientRect?.();
        const children = el.children?.length || 0;

        // 상품 카드는 보통 자식이 2~20개, 텍스트 길이 20~2000
        if (elText.length >= 15 && elText.length <= 3000 && children <= 30) {
          // 부모가 이미 product block이면 자식을 우선
          const alreadyContained = productBlocks.some(b =>
            b.el.contains(el) && b.el !== el
          );
          if (!alreadyContained) {
            // 기존 블록 중 이 엘리먼트에 포함되는 것 제거
            for (let i = productBlocks.length - 1; i >= 0; i--) {
              if (el.contains(productBlocks[i].el) && el !== productBlocks[i].el) {
                productBlocks.splice(i, 1);
              }
            }
            productBlocks.push({ el, text: elText, hasImage, hasRating, hasReview, hasViewCount });
          }
        }
      }
    }

    // 상품 블록에서 데이터 추출
    for (const block of productBlocks) {
      if (items.length >= 100) break;
      const item = extractProductFromBlock(block.el, items.length + 1);
      if (item) items.push(item);
    }

    return items;
  }

  function extractProductFromBlock(el, rank) {
    const fullText = text(el);
    if (fullText.length < 15) return null;

    // 상품 ID
    let productId = el.dataset?.productId || el.dataset?.itemId || '';
    const allLinks = el.querySelectorAll('a[href]');
    let coupangUrl = '';
    for (const link of allLinks) {
      const href = link.href || link.getAttribute('href') || '';
      const idMatch = href.match(/products?[/=](\d+)|itemId=(\d+)|vendorItemId=(\d+)|productId=(\d+)/i);
      if (idMatch) {
        productId = idMatch[1] || idMatch[2] || idMatch[3] || idMatch[4] || '';
        coupangUrl = href;
        break;
      }
    }

    // 상품명: 가장 긴 텍스트 노드 or 링크 텍스트 or 제목 요소
    let productName = '';
    const nameEl = el.querySelector('a[href*="product"], a[href*="item"], [class*="name"], [class*="title"], [class*="Name"], [class*="Title"], h2, h3, h4, h5, strong');
    if (nameEl) productName = text(nameEl);
    if (!productName) {
      // 긴 텍스트 블록에서 상품명 추출
      const textNodes = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
      let node;
      while (node = walker.nextNode()) {
        const t = node.textContent.trim();
        if (t.length > 5 && !/^[\d,]+\s*원$/.test(t) && !/^\d\.\d$/.test(t)) {
          textNodes.push(t);
        }
      }
      // 가장 긴 텍스트를 상품명으로
      textNodes.sort((a, b) => b.length - a.length);
      if (textNodes[0]) productName = textNodes[0].substring(0, 200);
    }

    // 이미지
    const img = el.querySelector('img');
    const imageUrl = img?.src || img?.getAttribute('data-src') || '';

    // 가격 — 여러 가격이 있을 수 있으므로 첫 번째 유효한 것 사용
    let price = 0;
    const priceMatches = fullText.match(/(\d[\d,]*)\s*원/g);
    if (priceMatches) {
      for (const pm of priceMatches) {
        const p = parseNumber(pm);
        if (p >= 100 && p <= 99999999) { price = p; break; }
      }
    }

    // 평점
    let rating = 0;
    const ratingMatch = fullText.match(/(\d\.\d)\s*(점|\/\s*5)?/);
    if (ratingMatch) {
      const r = parseFloat(ratingMatch[1]);
      if (r > 0 && r <= 5) rating = r;
    }

    // 리뷰 수
    let reviewCount = 0;
    const reviewMatch = fullText.match(/리뷰\s*([\d,]+)|(\d[\d,]*)\s*(?:건|개)\s*리뷰|([\d,]+)\s*리뷰/i);
    if (reviewMatch) {
      reviewCount = parseNumber(reviewMatch[1] || reviewMatch[2] || reviewMatch[3]);
    } else {
      // "104,594" 같은 큰 숫자 패턴
      const bigNumMatch = fullText.match(/(\d{1,3}(?:,\d{3})+)/g);
      if (bigNumMatch) {
        for (const num of bigNumMatch) {
          const n = parseNumber(num);
          // 리뷰 수 범위 (10 ~ 10,000,000)
          if (n >= 10 && n <= 10000000 && n !== price) {
            reviewCount = n;
            break;
          }
        }
      }
    }

    // 조회수
    let viewCount = 0;
    const viewMatch = fullText.match(/조회\s*([\d,]+)|(\d[\d,]*)\s*(?:회|건)\s*조회|([\d,]+)\s*(?:조회|클릭|view)/i);
    if (viewMatch) {
      viewCount = parseNumber(viewMatch[1] || viewMatch[2] || viewMatch[3]);
    }

    // 브랜드
    let brand = '';
    const brandEl = el.querySelector('[class*="brand"], [class*="Brand"]');
    if (brandEl) brand = text(brandEl);
    if (!brand) {
      const brandMatch = fullText.match(/브랜드[:\s]*([^\s,]+)/);
      if (brandMatch) brand = brandMatch[1];
    }

    // 제조사
    let manufacturer = '';
    const mfMatch = fullText.match(/제조사[:\s]*([^\s,]+)/);
    if (mfMatch) manufacturer = mfMatch[1];

    // 순위
    let rankNum = rank;
    const rankEl = el.querySelector('[class*="rank"], [class*="Rank"], [class*="순위"], [class*="num"], [class*="Num"]');
    if (rankEl) {
      const rn = parseInt(text(rankEl));
      if (rn > 0 && rn <= 200) rankNum = rn;
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
      source: 'dom_generic',
    };
  }

  function parseTableRow(row, rank) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 3) return null;

    const fullText = text(row);
    if (fullText.length < 10) return null;
    if (/^(순위|상품명|브랜드|카테고리|가격|평점|No\.|번호)/i.test(fullText)) return null;

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

      // 순위
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

      // 평점
      const ratingMatch = cellText.match(/(\d\.\d)/);
      if (ratingMatch && !rating) {
        const r = parseFloat(ratingMatch[1]);
        if (r > 0 && r <= 5) { rating = r; continue; }
      }

      // 리뷰 수
      if (/리뷰|review/i.test(cellText) || /^\d[\d,]*$/.test(cellText)) {
        const n = parseNumber(cellText);
        if (n >= 1 && n <= 10000000 && !reviewCount) {
          reviewCount = n;
          continue;
        }
      }

      // 조회수
      if (/조회|view|클릭/i.test(cellText)) {
        viewCount = parseNumber(cellText);
        continue;
      }

      // 브랜드/제조사
      const prevText = text(cell.previousElementSibling);
      if (/브랜드/i.test(prevText)) { brand = cellText; continue; }
      if (/제조사/i.test(prevText)) { manufacturer = cellText; continue; }

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
    // 너무 큰 컨테이너 제외
    if (fullText.length > 5000) return null;

    // 상품 ID
    let productId = card.dataset.productId || card.dataset.itemId || card.dataset.product || '';
    const link = card.querySelector('a[href*="products/"], a[href*="productId="], a[href*="itemId="], a[href*="item/"]');
    let coupangUrl = '';
    if (link) {
      const href = link.href || link.getAttribute('href') || '';
      const idMatch = href.match(/products?[/=](\d+)|itemId=(\d+)|productId=(\d+)/i);
      if (idMatch) productId = idMatch[1] || idMatch[2] || idMatch[3] || '';
      coupangUrl = href;
    }

    // 상품명
    const nameEl = card.querySelector(
      '[class*="name"], [class*="title"], [class*="Name"], [class*="Title"], ' +
      '[class*="productName"], [class*="itemName"], ' +
      'h2, h3, h4, h5, strong, a[href*="product"]'
    );
    const productName = text(nameEl) || text(link) || '';

    // 이미지
    const img = card.querySelector('img');
    const imageUrl = img?.src || img?.getAttribute('data-src') || '';

    // 가격
    const priceEl = card.querySelector('[class*="price"], [class*="Price"]');
    const priceText = text(priceEl) || fullText;
    const priceMatch = priceText.match(/([\d,]+)\s*원/);
    const price = priceMatch ? parseNumber(priceMatch[1]) : 0;

    // 평점
    const ratingEl = card.querySelector('[class*="rating"], [class*="star"], [class*="Rating"], [class*="Star"]');
    const ratingText = text(ratingEl) || fullText;
    const ratingMatch = ratingText.match(/(\d\.\d)/);
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;

    // 리뷰수
    let reviewCount = 0;
    const reviewEl = card.querySelector('[class*="review"], [class*="Review"], [class*="count"], [class*="Count"]');
    if (reviewEl) reviewCount = parseNumber(text(reviewEl).replace(/[()]/g, ''));
    if (!reviewCount) {
      const revMatch = fullText.match(/(\d[\d,]*)\s*(?:건|개)?\s*리뷰|리뷰\s*(\d[\d,]*)/i);
      if (revMatch) reviewCount = parseNumber(revMatch[1] || revMatch[2]);
    }

    // 조회수
    let viewCount = 0;
    const viewMatch = fullText.match(/(\d[\d,]*)\s*(?:회|건)?\s*(?:조회|view|클릭)/i);
    if (viewMatch) viewCount = parseNumber(viewMatch[1]);

    // 브랜드
    const brandEl = card.querySelector('[class*="brand"], [class*="Brand"]');
    const brand = text(brandEl) || '';

    // 제조사
    const mfEl = card.querySelector('[class*="manufacturer"], [class*="Manufacturer"], [class*="maker"]');
    const manufacturer = text(mfEl) || '';

    if (!productName && !productId) return null;

    return {
      productId,
      productName,
      brand,
      manufacturer,
      price,
      rating,
      reviewCount,
      viewCount,
      imageUrl,
      rank,
      coupangUrl,
      source: 'dom_card',
    };
  }

  // ============================================================
  //  검색 컨텍스트 감지 — v5.0 searchKeywords(복수형) 추가
  // ============================================================

  function detectSearchContext() {
    let keyword = '';
    let category = '';

    // URL 파라미터에서 키워드 추출 (searchKeywords 복수형 추가!)
    const url = new URL(location.href);
    keyword = url.searchParams.get('searchKeywords') ||  // WING 인기상품검색 실제 파라미터
      url.searchParams.get('searchKeyword') ||
      url.searchParams.get('keyword') ||
      url.searchParams.get('keywords') ||
      url.searchParams.get('q') ||
      url.searchParams.get('query') ||
      url.searchParams.get('search') ||
      url.searchParams.get('searchWord') ||
      url.searchParams.get('searchText') || '';

    // 카테고리 추출
    category = url.searchParams.get('category') ||
      url.searchParams.get('categoryId') ||
      url.searchParams.get('categoryName') ||
      url.searchParams.get('displayCategoryCode') ||
      url.searchParams.get('catId') || '';

    // DOM에서 검색어 추출
    if (!keyword) {
      const searchInputSelectors = [
        'input[type="search"]',
        'input[name="keyword"]',
        'input[name="keywords"]',
        'input[name="searchKeywords"]',
        'input[name="searchKeyword"]',
        'input[name="q"]',
        'input[name="query"]',
        'input[name="searchWord"]',
        'input[placeholder*="검색"]',
        'input[placeholder*="키워드"]',
        'input[placeholder*="상품"]',
        'input[class*="search"]',
        'input[class*="Search"]',
        // WING 특화 선택자
        '[class*="searchInput"] input',
        '[class*="SearchInput"] input',
        '[class*="keyword"] input',
        '[class*="Keyword"] input',
      ];
      const searchInput = document.querySelector(searchInputSelectors.join(', '));
      if (searchInput) keyword = searchInput.value || '';
    }

    // 검색 결과 헤더에서 키워드 추출
    if (!keyword) {
      const headerSelectors = [
        '[class*="search-keyword"]',
        '[class*="searchKeyword"]',
        '[class*="SearchKeyword"]',
        '[class*="result-keyword"]',
        '[class*="query-text"]',
        '[class*="search-term"]',
        'h1[class*="search"]',
        'h2[class*="search"]',
        'span[class*="keyword"]',
      ];
      const headerEl = document.querySelector(headerSelectors.join(', '));
      if (headerEl) {
        const ht = text(headerEl).replace(/[""''「」『』<>]/g, '').trim();
        if (ht.length >= 1 && ht.length <= 100) keyword = ht;
      }
    }

    // 페이지의 주요 텍스트에서 "OOO" 검색 결과 패턴
    if (!keyword) {
      const bodyText = text(document.body).substring(0, 3000);
      const patterns = [
        /["'"']([^"'"']{1,50})["'"']\s*(?:검색\s*결과|인기\s*상품|의\s*인기)/,
        /검색어[:\s]*([^\s,]{1,50})/,
        /키워드[:\s]*([^\s,]{1,50})/,
      ];
      for (const pat of patterns) {
        const m = bodyText.match(pat);
        if (m?.[1]) { keyword = m[1]; break; }
      }
    }

    // DOM에서 카테고리 추출
    if (!category) {
      const catEl = document.querySelector(
        '[class*="category-name"], [class*="categoryName"], [class*="CategoryName"], ' +
        'select[name*="category"] option:checked, ' +
        '[class*="breadcrumb"] a:last-child, ' +
        '[class*="Breadcrumb"] a:last-child'
      );
      if (catEl) category = text(catEl);
    }

    // 페이지 타이틀에서 키워드 추출
    if (!keyword) {
      const titleMatch = document.title.match(/[""''](.+?)[""'']|검색[:\s]*(.+?)[\s|$\-]/);
      if (titleMatch) keyword = titleMatch[1] || titleMatch[2] || '';
    }

    log('검색 컨텍스트:', { keyword, category, url: location.href });
    return { keyword: keyword.trim(), category: category.trim() };
  }

  // ============================================================
  //  상품 데이터 정규화
  // ============================================================

  function normalizeProduct(raw, rank) {
    return {
      productId: String(raw.productId || raw.itemId || raw.vendorItemId ||
        raw.sellerProductId || raw.id || raw.productNo || ''),
      productName: raw.productName || raw.name || raw.title || raw.itemName ||
        raw.displayProductName || raw.productTitle || '',
      brand: raw.brand || raw.brandName || raw.displayBrandName || '',
      manufacturer: raw.manufacturer || raw.manufacturerName || raw.maker ||
        raw.displayManufacturerName || '',
      price: parseInt(raw.price || raw.salePrice || raw.sellingPrice ||
        raw.displayPrice || raw.salesPrice || 0),
      originalPrice: parseInt(raw.originalPrice || raw.listPrice || raw.msrp ||
        raw.basePrice || 0),
      rating: parseFloat(raw.rating || raw.avgRating || raw.starRating ||
        raw.ratingScore || raw.averageRating || 0),
      reviewCount: parseInt(raw.reviewCount || raw.ratingCount || raw.commentCount ||
        raw.reviewCnt || raw.totalReviewCount || 0),
      viewCount: parseInt(raw.viewCount || raw.views || raw.clickCount ||
        raw.viewCnt || raw.clickCnt || raw.searchCount || 0),
      imageUrl: raw.imageUrl || raw.thumbnailUrl || raw.image || raw.imgUrl ||
        raw.productImage || raw.mainImageUrl || '',
      rank: raw.rank || raw.ranking || raw.position || raw.rankNo || rank,
      category: raw.category || raw.categoryName || raw.displayCategoryName ||
        raw.categoryPathName || '',
      categoryId: raw.categoryId || raw.displayCategoryId || raw.displayCategoryCode || '',
      coupangUrl: raw.coupangUrl || raw.productUrl || raw.url || raw.linkUrl ||
        (raw.productId ? `https://www.coupang.com/vp/products/${raw.productId}` : ''),
      isRocket: raw.isRocket || raw.rocketDelivery || raw.rocket || false,
      isFreeShipping: raw.isFreeShipping || raw.freeShipping || raw.freeDelivery || false,
      sellerName: raw.sellerName || raw.vendorName || raw.supplierName || '',
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

    if (signature === lastSignature) {
      log('중복 데이터, 전송 생략');
      return;
    }
    lastSignature = signature;

    log('Background로 전송:', data.keyword, data.items.length, '개 상품');
    chrome.runtime.sendMessage({
      type: 'WING_PRODUCTS_PARSED',
      ...data,
    }).catch((e) => log('전송 실패:', e.message));
  }

  // ============================================================
  //  팝업/모달 감지
  // ============================================================

  function detectPopupOpen() {
    const popupSelectors = [
      '[class*="modal"][class*="open"]',
      '[class*="modal"][class*="show"]',
      '[class*="Modal"][class*="open"]',
      '[class*="popup"][style*="display: block"]',
      '[class*="popup"][style*="visibility: visible"]',
      '[class*="Popup"]:not([style*="display: none"])',
      '[class*="dialog"][open]',
      '[role="dialog"]:not([aria-hidden="true"])',
      '[class*="popular-product"]',
      '[class*="PopularProduct"]',
      '[class*="trending"]',
      '[class*="best-seller"]',
      '[class*="ranking-popup"]',
      '[class*="search-result"]',
      '[class*="SearchResult"]',
      '[class*="searchResult"]',
    ];

    return document.querySelector(popupSelectors.join(','));
  }

  // ============================================================
  //  메인 스캔 로직
  // ============================================================

  function scanForProducts() {
    // API 데이터를 이미 받았으면 DOM 스캔 생략
    if (apiDataReceived) {
      log('API 데이터 수신 완료, DOM 스캔 생략');
      return;
    }

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
  //  SPA 네비게이션 감지 (v5.0 신규)
  // ============================================================

  function checkUrlChange() {
    if (location.href !== lastUrl) {
      log('URL 변경 감지:', lastUrl, '->', location.href);
      lastUrl = location.href;
      // URL이 변경되면 이전 API 데이터 초기화하고 재스캔
      apiDataReceived = false;
      lastSignature = '';
      schedulePublish();
      // 약간의 지연 후 추가 스캔 (React 렌더링 완료 대기)
      setTimeout(schedulePublish, 2000);
      setTimeout(schedulePublish, 4000);
    }
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

    log('WING 페이지 감지, 초기화 시작');

    // 1) XHR/fetch 후킹 스크립트 인젝트
    injectScript();

    // 2) DOM 변경 감지
    const observer = new MutationObserver(() => {
      schedulePublish();
      checkUrlChange();
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
    setTimeout(schedulePublish, 20000);

    // 4) 이벤트 리스너
    window.addEventListener('load', schedulePublish);
    document.addEventListener('visibilitychange', schedulePublish);

    // 5) SPA 네비게이션 감지 (popstate + pushState/replaceState 후킹)
    window.addEventListener('popstate', () => {
      log('popstate 이벤트');
      apiDataReceived = false;
      lastSignature = '';
      schedulePublish();
    });

    // pushState/replaceState 후킹 (SPA 대응)
    try {
      const origPushState = history.pushState;
      const origReplaceState = history.replaceState;
      history.pushState = function (...args) {
        origPushState.apply(this, args);
        log('pushState 감지');
        setTimeout(checkUrlChange, 100);
      };
      history.replaceState = function (...args) {
        origReplaceState.apply(this, args);
        setTimeout(checkUrlChange, 100);
      };
    } catch (e) {
      log('history 후킹 실패:', e.message);
    }

    // 6) 주기적 URL 변경 체크 (안전 장치)
    setInterval(checkUrlChange, 3000);

    // 7) WING 로고/상태 알림
    chrome.runtime.sendMessage({
      type: 'WING_PAGE_DETECTED',
      url: location.href,
    }).catch(() => {});

    log('초기화 완료');
  }

  init();
})();
