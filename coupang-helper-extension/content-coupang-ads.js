/* ============================================================
   Coupang Ads (쿠팡 애즈) Keyword Planner — Content Script v8.0

   쿠팡 애즈 키워드 플래너 페이지에서 CPC 데이터를 크롤링합니다.
   사용자의 WING 세션을 활용하며, 카테고리 기준으로 데이터를 수집합니다.

   대상 페이지:
   - https://advertising.coupang.com/keyword/planner
   - https://advertising.coupang.com/ (키워드 도구 관련 페이지)
   ============================================================ */

(function () {
  'use strict';

  const LOG_PREFIX = '[CoupangAds]';
  let lastParsedData = null;
  let parseAttempts = 0;
  const MAX_PARSE_ATTEMPTS = 5;

  console.log(`${LOG_PREFIX} Content script loaded on:`, window.location.href);

  // ===== DOM 유틸 =====
  function tx(el) {
    return (el?.textContent || '').trim();
  }

  function parseNumber(str) {
    if (!str) return 0;
    const cleaned = String(str).replace(/[^0-9.]/g, '');
    return parseFloat(cleaned) || 0;
  }

  function parseWon(str) {
    if (!str) return 0;
    const cleaned = String(str).replace(/[^0-9]/g, '');
    return parseInt(cleaned, 10) || 0;
  }

  // ===== 키워드 CPC 데이터 파싱 =====
  function parseCpcTable() {
    const results = [];

    // 쿠팡 애즈 키워드 도구의 테이블 행 찾기
    // 여러 가능한 테이블 셀렉터 시도
    const tableSelectors = [
      'table tbody tr',
      '.keyword-table tbody tr',
      '[class*="keyword"] table tbody tr',
      '.result-table tbody tr',
      '[class*="result"] tbody tr',
      '[class*="planner"] tbody tr',
      '.ant-table-tbody tr',
      '[role="grid"] [role="row"]',
    ];

    let rows = [];
    for (const sel of tableSelectors) {
      rows = document.querySelectorAll(sel);
      if (rows.length > 0) break;
    }

    if (!rows.length) {
      console.log(`${LOG_PREFIX} No table rows found`);
      return results;
    }

    console.log(`${LOG_PREFIX} Found ${rows.length} table rows`);

    for (const row of rows) {
      const cells = row.querySelectorAll('td, [role="gridcell"]');
      if (cells.length < 3) continue;

      // 쿠팡 애즈 키워드 플래너 테이블 구조:
      // [키워드] [카테고리] [추천 입찰가] [예상 노출] [예상 클릭] [예상 CTR] [경쟁도]
      // 정확한 구조는 실제 페이지에 따라 달라질 수 있음
      try {
        const data = {
          keyword: tx(cells[0]),
          categoryName: cells.length > 1 ? tx(cells[1]) : '',
          suggestedBid: 0,
          minBid: 0,
          maxBid: 0,
          estimatedImpressions: 0,
          estimatedClicks: 0,
          estimatedCtr: 0,
          competitionLevel: '',
        };

        // 각 셀에서 데이터 추출 (셀 수에 따라 적응)
        if (cells.length >= 3) data.suggestedBid = parseWon(tx(cells[2]));
        if (cells.length >= 4) data.estimatedImpressions = parseNumber(tx(cells[3]));
        if (cells.length >= 5) data.estimatedClicks = parseNumber(tx(cells[4]));
        if (cells.length >= 6) {
          const ctrText = tx(cells[5]);
          data.estimatedCtr = parseFloat(ctrText.replace('%', '')) || 0;
        }
        if (cells.length >= 7) data.competitionLevel = tx(cells[6]);

        // 입찰가 범위 파싱 (일부 UI에서는 "100~500" 형태)
        const bidText = tx(cells[2] || cells[1]);
        const bidRange = bidText.match(/([\d,]+)\s*[~\-]\s*([\d,]+)/);
        if (bidRange) {
          data.minBid = parseWon(bidRange[1]);
          data.maxBid = parseWon(bidRange[2]);
          data.suggestedBid = Math.round((data.minBid + data.maxBid) / 2);
        }

        // 경쟁도 한국어 매핑
        const compText = (data.competitionLevel || '').toLowerCase();
        if (compText.includes('높') || compText.includes('high')) {
          data.competitionLevel = 'high';
        } else if (compText.includes('중') || compText.includes('medium') || compText.includes('보통')) {
          data.competitionLevel = 'medium';
        } else if (compText.includes('낮') || compText.includes('low')) {
          data.competitionLevel = 'low';
        }

        if (data.keyword && data.keyword.length > 0) {
          results.push(data);
        }
      } catch (e) {
        console.warn(`${LOG_PREFIX} Row parse error:`, e);
      }
    }

    return results;
  }

  // ===== 카테고리 정보 추출 =====
  function parseSelectedCategory() {
    // 선택된 카테고리 셀렉터 시도
    const selectors = [
      '[class*="category"] [class*="selected"]',
      '.category-selector .active',
      '[class*="breadcrumb"]',
      'select[class*="category"] option:checked',
      '[class*="category-name"]',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = tx(el);
        if (text) return { name: text, id: el.getAttribute('data-id') || '' };
      }
    }

    return { name: '', id: '' };
  }

  // ===== 데이터 수집 & 전송 =====
  function collectAndSend() {
    const cpcData = parseCpcTable();
    if (!cpcData.length) {
      parseAttempts++;
      if (parseAttempts < MAX_PARSE_ATTEMPTS) {
        console.log(`${LOG_PREFIX} No data found, retry ${parseAttempts}/${MAX_PARSE_ATTEMPTS}`);
        setTimeout(collectAndSend, 2000);
      }
      return;
    }

    const category = parseSelectedCategory();

    // 카테고리 정보 추가
    const enriched = cpcData.map(d => ({
      ...d,
      categoryId: category.id || d.categoryId || '',
      categoryName: category.name || d.categoryName || '',
    }));

    console.log(`${LOG_PREFIX} Parsed ${enriched.length} keyword CPC records`);
    lastParsedData = enriched;

    // background.js에 전달
    chrome.runtime.sendMessage({
      type: 'COUPANG_ADS_CPC_DATA',
      data: enriched,
      category,
      url: window.location.href,
    }).catch(e => console.warn(`${LOG_PREFIX} Message send error:`, e));
  }

  // ===== MutationObserver: 테이블 변경 감지 =====
  function setupObserver() {
    const observer = new MutationObserver(mutations => {
      // 테이블 업데이트 감지 시 재수집
      let hasTableChange = false;
      for (const m of mutations) {
        if (m.type === 'childList' && m.addedNodes.length > 0) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1) {
              const el = node;
              if (
                el.tagName === 'TR' ||
                el.tagName === 'TABLE' ||
                el.querySelector?.('tr, table, [role="row"]')
              ) {
                hasTableChange = true;
                break;
              }
            }
          }
        }
        if (hasTableChange) break;
      }

      if (hasTableChange) {
        parseAttempts = 0;
        setTimeout(collectAndSend, 1000);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return observer;
  }

  // ===== 메시지 핸들러 =====
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'GET_CPC_DATA') {
      if (lastParsedData) {
        sendResponse({ success: true, data: lastParsedData });
      } else {
        // 즉시 수집 시도
        parseAttempts = 0;
        collectAndSend();
        setTimeout(() => {
          sendResponse({ success: !!lastParsedData, data: lastParsedData || [] });
        }, 3000);
        return true; // async response
      }
    }

    if (msg.type === 'TRIGGER_CPC_COLLECT') {
      parseAttempts = 0;
      collectAndSend();
      sendResponse({ success: true });
    }
  });

  // ===== 초기화 =====
  // 페이지 로드 후 데이터 수집 시작
  if (document.readyState === 'complete') {
    setTimeout(collectAndSend, 2000);
  } else {
    window.addEventListener('load', () => setTimeout(collectAndSend, 2000));
  }

  setupObserver();
  console.log(`${LOG_PREFIX} Initialized — waiting for keyword planner data`);
})();
