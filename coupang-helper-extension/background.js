/* ============================================================
   Coupang Sourcing Helper — Background Service Worker v7.0
   v7.0: 하이브리드 수집 아키텍처 대개편
         - Background fetch + DOMParser (셀러라이프 방식)
         - V2 DOM 자동감지 (ProductUnit, aria-label 평점)
         - 배송유형 6종 분류
         - declarativeNetRequest 헤더 위조
         - 배치 수집 완전 재작성 (순차 1개씩, 28~90초 간격)
         - 모바일 리뷰 API 통합
         - SSR JSON 파싱 폴백
   v6.6: 검색수요 분석 + 자동배치 토글 + 분할 배치
   v6.5: 상세페이지 정밀파싱 연동
   v6.4: 자동 순회 수집기
   v5.3: content.js가 자체 URL 감지
   ============================================================ */

importScripts('api-client.js');
importScripts('hybrid-parser.js');

// ---- 유틸: 고유 요청 ID 생성 ----
function generateRequestId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---- 설치/업데이트 시 열린 쿠팡 탭 자동 새로고침 ----
chrome.runtime.onInstalled.addListener((details) => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  // 순위 추적 알람 (매 6시간마다)
  chrome.alarms.create('rankTracking', { periodInMinutes: 360 });
  // 판매량 추정 배치 알람 (매 12시간마다)
  chrome.alarms.create('salesEstimateBatch', { periodInMinutes: 720 });
  // 하이브리드 일일 배치 알람 (매 24시간마다)
  chrome.alarms.create('dailyBatchCollection', { periodInMinutes: 1440 });

  // 설치 또는 업데이트 시 열린 쿠팡 탭을 새로고침하여 새 content script 적용
  if (details.reason === 'install' || details.reason === 'update') {
    // v7.0: declarativeNetRequest 헤더 위조 설정
    HybridParser.setupCoupangHeaders().catch(() => {});

    chrome.tabs.query({ url: ['https://www.coupang.com/*', 'https://wing.coupang.com/*', 'https://m-wing.coupang.com/*'] }, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.reload(tab.id);
      }
    });
    console.log(`[SH] Extension ${details.reason}d — v7.0.0 — hybrid architecture`);
  }
});

// ---- v5.3: SPA 재주입 제거 ----
// content.js가 자체적으로 setInterval + popstate + MutationObserver로 URL 변경 감지
// background에서 executeScript 호출은 쿠팡 React와 충돌 가능 → 제거

// 탭이 닫히면 세션 데이터 정리
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove([`results:${tabId}`]).catch(() => {});
});

// ---- 알람 핸들러 (순위 추적 자동 수집) ----
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'rankTracking') {
    await autoTrackRankings();
  }
  if (alarm.name === 'salesEstimateBatch') {
    await autoRunSalesEstimate();
  }
  if (alarm.name === 'dailyBatchCollection') {
    await autoRunDailyBatch();
  }
});

// ---- 메시지 핸들러 ----
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) return false;

  switch (message.type) {
    // ===== 검색 결과 파싱 =====
    case 'SEARCH_RESULTS_PARSED': {
      if (!sender.tab?.id) break;
      const tabId = sender.tab.id;
      const payload = {
        tabId,
        url: sender.tab.url,
        title: sender.tab.title,
        query: message.query || '',
        count: Array.isArray(message.items) ? message.items.length : 0,
        items: message.items || [],
        capturedAt: new Date().toISOString()
      };
      chrome.storage.session.set({ [`results:${tabId}`]: payload });
      saveSearchHistory(payload);
      syncSnapshotToServer(payload).catch(() => {});
      // 순위 추적에 등록된 키워드면 자동으로 순위 저장
      saveRankFromSearch(payload).catch(() => {});
      chrome.runtime.sendMessage({ type: 'RESULTS_UPDATED', tabId }).catch(() => {});
      sendResponse({ ok: true });
      return true;
    }

    // ===== 상품 상세 파싱 =====
    case 'PRODUCT_DETAIL_PARSED': {
      const detail = message.detail;
      if (!detail) break;
      // 세션 스토리지에 상세 정보 저장
      if (sender.tab?.id) {
        chrome.storage.session.set({ [`detail:${detail.coupangProductId}`]: detail });
      }
      // 서버에 동기화
      syncProductDetail(detail).catch(() => {});
      chrome.runtime.sendMessage({
        type: 'DETAIL_UPDATED',
        productId: detail.coupangProductId,
        detail
      }).catch(() => {});
      sendResponse({ ok: true });
      return true;
    }

    // ===== 상품 상세 조회 =====
    case 'GET_PRODUCT_DETAIL': {
      const key = `detail:${message.productId}`;
      chrome.storage.session.get([key]).then((obj) => {
        sendResponse({ ok: true, data: obj[key] || null });
      });
      return true;
    }

    // ===== 탭 결과 조회 =====
    case 'GET_RESULTS_FOR_TAB': {
      const key = `results:${message.tabId}`;
      chrome.storage.session.get([key]).then((obj) => {
        sendResponse({ ok: true, data: obj[key] || null });
      });
      return true;
    }

    // ===== 후보 관리 (SAVE_CANDIDATE는 하단 v5.0 블록에서 처리) =====

    case 'REMOVE_CANDIDATE': {
      removeCandidateItem(message.productId).then(() => {
        sendResponse({ ok: true });
      });
      return true;
    }

    case 'GET_CANDIDATES': {
      getCandidates().then((candidates) => {
        sendResponse({ ok: true, data: candidates });
      });
      return true;
    }

    // ===== 히스토리 =====
    case 'GET_HISTORY': {
      getSearchHistory().then((history) => {
        sendResponse({ ok: true, data: history });
      });
      return true;
    }

    case 'CLEAR_HISTORY': {
      chrome.storage.local.set({ searchHistory: [] }).then(() => {
        sendResponse({ ok: true });
      });
      return true;
    }

    // ===== 순위 추적 =====
    case 'ADD_TRACKED_KEYWORD': {
      addTrackedKeyword(message.keyword).then((result) => {
        sendResponse({ ok: true, ...result });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'REMOVE_TRACKED_KEYWORD': {
      removeTrackedKeyword(message.keywordId).then(() => {
        sendResponse({ ok: true });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'GET_TRACKED_KEYWORDS': {
      getTrackedKeywords().then((keywords) => {
        sendResponse({ ok: true, data: keywords });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'GET_RANK_HISTORY': {
      getRankHistory(message.query, message.productId, message.days).then((data) => {
        sendResponse({ ok: true, data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'GET_LATEST_RANKING': {
      getLatestRanking(message.query).then((data) => {
        sendResponse({ ok: true, data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'GET_PRODUCT_PRICE_HISTORY': {
      getProductPriceHistory(message.productId, message.days).then((data) => {
        sendResponse({ ok: true, data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    // ===== 서버 연동 =====
    case 'SERVER_LOGIN': {
      apiClient.login(message.email, message.password).then((result) => {
        sendResponse({ ok: true, ...result });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'SERVER_CHECK_AUTH': {
      apiClient.checkAuth().then((result) => {
        sendResponse({ ok: true, ...result });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'SERVER_SEARCH_STATS': {
      apiClient.searchStats().then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'SERVER_CANDIDATE_STATS': {
      apiClient.candidateStats().then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'SERVER_LIST_CANDIDATES': {
      apiClient.listCandidates(message.opts || {}).then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'SERVER_LIST_SNAPSHOTS': {
      apiClient.listSnapshots(message.opts || {}).then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'SERVER_PROMOTE_CANDIDATE': {
      apiClient.promoteToProduct(message.candidateId).then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    // ===== WING 인기상품 데이터 =====
    case 'WING_PRODUCTS_PARSED': {
      const wingData = {
        source: message.source || 'unknown',
        url: message.url || '',
        keyword: message.keyword || '',
        category: message.category || '',
        items: message.items || [],
        pagination: message.pagination || null,
        capturedAt: message.capturedAt || new Date().toISOString(),
        pageUrl: message.pageUrl || '',
      };
      // 로컬 저장
      saveWingHistory(wingData).catch(() => {});
      // 서버에 동기화
      syncWingDataToServer(wingData).catch(() => {});
      // UI 업데이트 알림
      chrome.runtime.sendMessage({
        type: 'WING_DATA_UPDATED',
        keyword: wingData.keyword,
        count: wingData.items.length,
      }).catch(() => {});
      sendResponse({ ok: true });
      return true;
    }

    case 'WING_PAGE_DETECTED': {
      // WING 페이지 감지 로그
      chrome.storage.session.set({ lastWingPage: { url: message.url, detectedAt: new Date().toISOString() } });
      sendResponse({ ok: true });
      return true;
    }

    case 'GET_WING_HISTORY': {
      getWingHistory(message.limit).then((data) => {
        sendResponse({ ok: true, data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'GET_WING_STATS': {
      getWingStats().then((data) => {
        sendResponse({ ok: true, data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'CLEAR_WING_HISTORY': {
      chrome.storage.local.set({ wingHistory: [] }).then(() => {
        sendResponse({ ok: true });
      });
      return true;
    }

    case 'SERVER_WING_SEARCHES': {
      apiClient.wingSearches(message.opts || {}).then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'SERVER_WING_STATS': {
      apiClient.wingStats().then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    // ===== 소싱 코치 (v4.3) =====
    case 'SOURCING_ANALYZE_BATCH': {
      apiClient.analyzeBatch(message.data).then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        // 서버 실패 시 로컬 폴백 응답
        sendResponse({ ok: false, error: e.message, useLocalFallback: true });
      });
      return true;
    }

    case 'SOURCING_ANALYZE_PRODUCT': {
      apiClient.analyzeProduct(message.data).then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message, useLocalFallback: true });
      });
      return true;
    }

    case 'SOURCING_GENERATE_KEYWORDS': {
      apiClient.generateKeywords(message.title).then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'SOURCING_CALCULATE_MARGIN': {
      apiClient.calculateMarginServer(message.data).then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'SOURCING_GET_EXCHANGE_RATE': {
      apiClient.getExchangeRate().then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    // ===== AI 소싱 코치 v5.0 (WING 인기상품 AI 분석) =====
    case 'AI_ANALYZE_WING': {
      apiClient.aiAnalyzeWing(message.data).then((resp) => {
        const data = resp?.result?.data;
        // AI 분석 결과를 로컬에도 캐시
        if (data && message.data?.keyword) {
          chrome.storage.local.get('aiAnalysisCache', (obj) => {
            const cache = obj.aiAnalysisCache || {};
            cache[message.data.keyword] = {
              data,
              cachedAt: new Date().toISOString(),
            };
            // 캐시 최대 50개 유지
            const keys = Object.keys(cache);
            if (keys.length > 50) {
              const sorted = keys.sort((a, b) =>
                new Date(cache[a].cachedAt).getTime() - new Date(cache[b].cachedAt).getTime()
              );
              delete cache[sorted[0]];
            }
            chrome.storage.local.set({ aiAnalysisCache: cache });
          });
        }
        sendResponse({ ok: true, data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'AI_ANALYZE_WING_PRODUCT': {
      apiClient.aiAnalyzeWingProduct(message.data).then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'GET_AI_ANALYSIS_CACHE': {
      chrome.storage.local.get('aiAnalysisCache', (obj) => {
        const cache = obj.aiAnalysisCache || {};
        if (message.keyword && cache[message.keyword]) {
          sendResponse({ ok: true, data: cache[message.keyword] });
        } else {
          sendResponse({ ok: true, data: null });
        }
      });
      return true;
    }

    case 'CLEAR_AI_ANALYSIS_CACHE': {
      chrome.storage.local.set({ aiAnalysisCache: {} }).then(() => {
        sendResponse({ ok: true });
      });
      return true;
    }

    // ===== v5.1: AI 사전매칭 — 상품명→1688 검색어 자동 생성 =====
    case 'PRE_MATCH': {
      const productName = message.productName;
      if (!productName) {
        sendResponse({ success: false, error: 'No product name' });
        return true;
      }
      apiClient.preMatch({
        productName,
        price: message.price || 0,
        category: message.category || '',
        brand: message.brand || '',
        imageUrl: message.imageUrl || '',
      }).then(resp => {
        const data = resp?.result?.data;
        if (data) {
          sendResponse({ success: true, ...data });
        } else {
          sendResponse({ success: false, error: 'No data returned' });
        }
      }).catch(e => {
        console.error('[PRE_MATCH] Error:', e.message);
        sendResponse({ success: false, error: e.message });
      });
      return true;
    }

    // ===== v5.0: 상품 카드에서 바로 AI 분석 요청 =====
    case 'REQUEST_AI_ANALYSIS': {
      const product = message.product;
      if (!product) {
        sendResponse({ success: false, error: 'No product data' });
        return true;
      }
      // 서버 AI 분석 호출
      apiClient.aiAnalyzeWingProduct({
        keyword: product.query || product.title || '',
        product: {
          name: product.title,
          price: product.price,
          reviewCount: product.reviewCount,
          rating: product.rating,
          brand: product.brand || '',
          rank: product.position,
        },
        marketAvg: {
          avgPrice: product.price, // 단일 상품이므로 자기 가격
          avgReviews: product.reviewCount,
          avgRating: product.rating,
        },
      }).then((resp) => {
        const data = resp?.result?.data;
        let summary = '';
        if (data) {
          const fit = data.beginnerFit?.score || data.score || message.score || '-';
          const risk = data.risks?.[0] || data.riskLevel || '';
          summary = `적합도 ${fit}점`;
          if (risk) summary += ` | ${risk}`;
        }
        sendResponse({ success: true, data, summary });
      }).catch(e => {
        sendResponse({ success: false, error: e.message, summary: '' });
      });
      return true;
    }

    // ===== v5.0: 상품 카드에서 후보 저장 (product 필드 호환) =====
    case 'SAVE_CANDIDATE': {
      const item = message.item || message.product;
      if (item) {
        // score/grade 추가 저장
        if (message.score) item._quickScore = message.score;
        if (message.grade) item._grade = message.grade;
        saveCandidateItem(item).then((result) => {
          sendResponse({ ok: true, ...result });
        });
      } else {
        sendResponse({ ok: false, error: 'No item data' });
      }
      return true;
    }

    // ===== v6.0: 판매량 추정 시스템 (Sales Estimation) =====
    case 'SALES_GET_CATEGORY_RATES': {
      apiClient.getCategoryReviewRates().then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'SALES_UPDATE_CATEGORY_RATE': {
      apiClient.updateCategoryReviewRate(message.data).then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'SALES_ESTIMATE_SINGLE': {
      apiClient.estimateSingleProduct(message.data).then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'SALES_ESTIMATE_BATCH': {
      apiClient.runSalesEstimateBatch(message.data || {}).then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'SALES_GET_PRODUCT_ESTIMATES': {
      apiClient.getProductSalesEstimates(message.opts || {}).then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'SALES_DASHBOARD': {
      apiClient.salesEstimateDashboard().then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    // ===== v6.2: 하이브리드 데이터 수집 시스템 (Hybrid Data Collection) =====
    case 'SAVE_SEARCH_EVENT': {
      (async () => {
        try {
          const { serverLoggedIn } = await chrome.storage.local.get('serverLoggedIn');
          if (!serverLoggedIn || !message.keyword) {
            sendResponse({ ok: false, error: 'Not logged in or no keyword' });
            return;
          }
          const resp = await apiClient.saveSearchEvent({
            keyword: message.keyword,
            source: message.source || 'user_search',
            pageUrl: message.pageUrl || '',
            totalItems: message.totalItems || 0,
            items: (message.items || []).slice(0, 36),
            avgPrice: message.avgPrice || 0,
            avgRating: message.avgRating || 0,
            avgReview: message.avgReview || 0,
            totalReviewSum: message.totalReviewSum || 0,
            adCount: message.adCount || 0,
            rocketCount: message.rocketCount || 0,
            highReviewCount: message.highReviewCount || 0,
            priceParseRate: message.priceParseRate || 0,
            ratingParseRate: message.ratingParseRate || 0,
            reviewParseRate: message.reviewParseRate || 0,
          });
          console.log(`[SH] 검색 이벤트 저장: ${message.keyword} (${message.totalItems}개)`);
          sendResponse({ ok: true, data: resp?.result?.data });
        } catch (e) {
          console.error('[SH] 검색 이벤트 저장 실패:', e.message);
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;
    }

    case 'HYBRID_LIST_WATCH_KEYWORDS': {
      apiClient.listWatchKeywords(message.opts || {}).then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'HYBRID_UPDATE_WATCH_KEYWORD': {
      apiClient.updateWatchKeyword(message.data).then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'HYBRID_DELETE_WATCH_KEYWORD': {
      apiClient.deleteWatchKeyword(message.id).then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'HYBRID_KEYWORD_DAILY_STATUS': {
      apiClient.getKeywordDailyStatusHistory(message.opts || {}).then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'HYBRID_RUN_DAILY_BATCH': {
      // 분할 배치 및 선택 키워드 지원
      const batchOpts = {
        limit: message.limit || undefined,
        offset: message.offset || undefined,
        keywords: message.keywords || undefined,  // 유저가 선택한 키워드 목록
      };
      apiClient.runDailyBatchCollection(batchOpts).then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'HYBRID_BATCH_SELECTION': {
      apiClient.getBatchKeywordSelection(message.opts || {}).then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'HYBRID_LIST_SEARCH_EVENTS': {
      apiClient.listSearchEvents(message.opts || {}).then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'HYBRID_DASHBOARD': {
      apiClient.hybridCollectionDashboard().then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'HYBRID_DIAGNOSE_PARSE': {
      apiClient.diagnoseParseQuality(message.keyword).then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    // ===== v6.4: 자동 순회 수집기 (Auto-Collect) =====
    case 'START_AUTO_COLLECT': {
      startAutoCollect(message.payload || {}).then((result) => {
        sendResponse(result);
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'STOP_AUTO_COLLECT': {
      stopAutoCollect();
      sendResponse({ ok: true });
      return true;
    }

    case 'PAUSE_AUTO_COLLECT': {
      pauseAutoCollect();
      sendResponse({ ok: true });
      return true;
    }

    case 'RESUME_AUTO_COLLECT': {
      startAutoCollect().then((result) => {
        sendResponse(result);
      });
      return true;
    }

    case 'GET_COLLECTOR_STATE': {
      sendResponse({ ok: true, data: getCollectorState() });
      return true;
    }

    // content.js → background: 자동 수집 파싱 완료
    case 'SEARCH_PARSE_SUCCESS': {
      handleAutoCollectSuccess(message).then(() => {
        sendResponse({ ok: true });
      }).catch(() => {
        sendResponse({ ok: false });
      });
      return true;
    }

    // content.js → background: 자동 수집 파싱 실패
    case 'SEARCH_PARSE_FAILED': {
      handleAutoCollectFailed(
        message.requestId,
        message.keyword || '',
        message.error?.code || 'UNKNOWN',
        message.error?.message || ''
      ).then(() => {
        sendResponse({ ok: true });
      }).catch(() => {
        sendResponse({ ok: false });
      });
      return true;
    }

    // ===== v7.0: 하이브리드 파싱 — Background에서 HTML 가져와서 파싱 =====
    case 'HYBRID_PARSE_TAB': {
      (async () => {
        try {
          const tabId = message.tabId || sender.tab?.id;
          if (!tabId) { sendResponse({ ok: false, error: 'No tab ID' }); return; }
          const html = await HybridParser.getRenderedHTML(tabId);
          const result = HybridParser.parseSearchHTML(html, message.keyword || '');
          sendResponse({ ok: true, data: result });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;
    }

    // ===== v7.0: 모바일 리뷰 API 호출 =====
    case 'FETCH_MOBILE_REVIEWS': {
      HybridParser.fetchReviews(message.productId, message.maxPages).then(reviews => {
        sendResponse({ ok: true, data: reviews });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }
  }

  return false;
});

// ============================================================
//  서버 동기화 함수
// ============================================================

async function syncSnapshotToServer(payload) {
  const { serverLoggedIn } = await chrome.storage.local.get('serverLoggedIn');
  if (!serverLoggedIn) return;

  const items = payload.items || [];
  const prices = items.map(i => i.price).filter(p => p > 0);
  const ratings = items.map(i => i.rating).filter(r => r > 0);
  const reviews = items.map(i => i.reviewCount).filter(r => r > 0);

  const avgPrice = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
  const avgRating = ratings.length ? +(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : 0;
  const avgReview = reviews.length ? Math.round(reviews.reduce((a, b) => a + b, 0) / reviews.length) : 0;
  const highReviewCount = items.filter(i => i.reviewCount >= 100).length;
  const highReviewRatio = items.length ? Math.round((highReviewCount / items.length) * 100) : 0;
  const adCount = items.filter(i => i.isAd).length;

  let competitionScore = 0;
  if (avgReview > 1000) competitionScore += 40;
  else if (avgReview > 500) competitionScore += 30;
  else if (avgReview > 100) competitionScore += 20;
  else if (avgReview > 30) competitionScore += 10;
  if (highReviewRatio > 60) competitionScore += 25;
  else if (highReviewRatio > 40) competitionScore += 15;
  else if (highReviewRatio > 20) competitionScore += 8;
  if (avgRating >= 4.5) competitionScore += 15;
  else if (avgRating >= 4.0) competitionScore += 8;
  const adRatio = items.length ? adCount / items.length : 0;
  if (adRatio > 0.3) competitionScore += 20;
  else if (adRatio > 0.15) competitionScore += 10;

  const competitionLevel = competitionScore >= 70 ? 'hard' : competitionScore >= 45 ? 'medium' : 'easy';

  await apiClient.saveSnapshot({
    query: payload.query,
    totalItems: payload.count,
    avgPrice, avgRating, avgReview, highReviewRatio, adCount,
    competitionScore, competitionLevel,
    items: items.slice(0, 20),
  });
}

async function syncCandidateToServer(item) {
  const { serverLoggedIn } = await chrome.storage.local.get('serverLoggedIn');
  if (!serverLoggedIn) return null;
  try {
    const resp = await apiClient.saveCandidate({
      productId: item.productId || undefined,
      title: item.title || undefined,
      price: item.price || 0,
      rating: item.rating || 0,
      reviewCount: item.reviewCount || 0,
      imageUrl: item.imageUrl || undefined,
      coupangUrl: item.url || undefined,
      sourcingScore: item._sourcingScore || 0,
      sourcingGrade: item._sourcingGrade || undefined,
      searchQuery: item.query || undefined,
    });
    return resp?.result?.data;
  } catch (e) { return null; }
}

async function syncProductDetail(detail) {
  const { serverLoggedIn } = await chrome.storage.local.get('serverLoggedIn');
  if (!serverLoggedIn) return;
  try {
    // v6.5: 확장 필드가 있으면 saveDetailSnapshot 사용, 없으면 기존 saveProductDetail
    if (detail.confidence !== undefined || detail.vendorItemId || detail.brandName || detail.reviewSamples) {
      await apiClient.saveDetailSnapshot({
        coupangProductId: detail.coupangProductId,
        vendorItemId: detail.vendorItemId || null,
        title: detail.title || null,
        price: detail.price || 0,
        originalPrice: detail.originalPrice || 0,
        discountRate: detail.discountRate || 0,
        rating: detail.rating || 0,
        reviewCount: detail.reviewCount || 0,
        purchaseCount: detail.purchaseCount || null,
        sellerName: detail.sellerName || null,
        brandName: detail.brandName || null,
        manufacturer: detail.manufacturer || null,
        origin: detail.origin || null,
        deliveryType: detail.deliveryType || 'STANDARD',
        isRocket: detail.isRocket || false,
        isFreeShipping: detail.isFreeShipping || false,
        soldOut: detail.soldOut || false,
        categoryPath: detail.categoryPath || null,
        optionCount: detail.optionCount || 0,
        imageUrl: detail.imageUrl || null,
        confidence: detail.confidence || 0,
        reviewSamples: detail.reviewSamples || [],
        optionSummary: detail.optionSummary || [],
        badgeText: detail.badgeText || null,
        source: 'user_browse',
        detailJson: detail.detailJson || {},
      });
    } else {
      await apiClient.saveProductDetail({
        coupangProductId: detail.coupangProductId,
        title: detail.title,
        price: detail.price,
        originalPrice: detail.originalPrice || 0,
        discountRate: detail.discountRate || 0,
        rating: detail.rating,
        reviewCount: detail.reviewCount,
        purchaseCount: detail.purchaseCount || undefined,
        sellerName: detail.sellerName || undefined,
        isRocket: detail.isRocket || false,
        isFreeShipping: detail.isFreeShipping || false,
        categoryPath: detail.categoryPath || undefined,
        optionCount: detail.optionCount || 0,
        imageUrl: detail.imageUrl || undefined,
        detailJson: detail.detailJson || undefined,
      });
    }
  } catch (e) { /* 실패 무시 */ }
}

// ============================================================
//  순위 추적
// ============================================================

// 검색 결과에서 자동으로 순위 데이터 저장
async function saveRankFromSearch(payload) {
  const { serverLoggedIn } = await chrome.storage.local.get('serverLoggedIn');
  if (!serverLoggedIn || !payload.query || !payload.items?.length) return;

  // 추적 키워드인지 확인
  const { trackedKeywords = [] } = await chrome.storage.local.get('trackedKeywords');
  const tracked = trackedKeywords.find(k => k.query === payload.query);
  if (!tracked) return;

  const items = payload.items.map((item, idx) => ({
    coupangProductId: item.productId || `unknown-${idx}`,
    title: item.title,
    position: item.position || idx + 1,
    price: item.price || 0,
    rating: item.rating || 0,
    reviewCount: item.reviewCount || 0,
    isAd: item.isAd || false,
    isRocket: item.isRocket || false,
  })).filter(i => i.coupangProductId && !i.coupangProductId.startsWith('unknown'));

  if (!items.length) return;

  try {
    // 이전 순위 저장
    const prevKey = `prevRank:${payload.query}`;
    const { [prevKey]: prevRanks = {} } = await chrome.storage.local.get(prevKey);
    
    await apiClient.saveRankData({ query: payload.query, items });

    // 순위 변동 알림 (타겟 상품이 있는 경우)
    const tracked = trackedKeywords.find(k => k.query === payload.query && k.targetProductId);
    if (tracked) {
      const targetItem = items.find(i => i.coupangProductId === tracked.targetProductId);
      const prevPos = prevRanks[tracked.targetProductId];
      if (targetItem && prevPos && prevPos !== targetItem.position) {
        const diff = prevPos - targetItem.position;
        if (Math.abs(diff) >= 2) {
          const direction = diff > 0 ? '상승' : '하락';
          const emoji = diff > 0 ? '📈' : '📉';
          chrome.notifications.create(`rank-live-${Date.now()}`, {
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: `${emoji} 순위 ${direction}!`,
            message: `"${payload.query}": ${prevPos}위 → ${targetItem.position}위 (${Math.abs(diff)}단계 ${direction})`,
            priority: 1,
          });
        }
      }
    }

    // 현재 순위 저장 (다음 비교용)
    const currentRanks = {};
    for (const item of items) { currentRanks[item.coupangProductId] = item.position; }
    await chrome.storage.local.set({ [prevKey]: currentRanks });
  } catch (e) { /* 실패 무시 */ }
}

// 자동 순위 추적 (알람에서 호출) — 사용자가 검색했을 때 저장된 데이터와 비교
async function autoTrackRankings() {
  const { serverLoggedIn } = await chrome.storage.local.get('serverLoggedIn');
  if (!serverLoggedIn) return;

  const { trackedKeywords = [] } = await chrome.storage.local.get('trackedKeywords');
  if (!trackedKeywords.length) return;

  // 각 추적 키워드에 대해 이전 순위와 비교하여 알림
  for (const kw of trackedKeywords) {
    if (!kw.targetProductId) continue;
    try {
      const resp = await apiClient.getRankHistory({
        query: kw.query,
        coupangProductId: kw.targetProductId,
        days: 7
      });
      const history = resp?.result?.data || [];
      if (history.length >= 2) {
        const latest = history[0];
        const prev = history[1];
        const diff = prev.position - latest.position;
        if (Math.abs(diff) >= 3) {
          const direction = diff > 0 ? '상승' : '하락';
          const emoji = diff > 0 ? '📈' : '📉';
          chrome.notifications.create(`rank-${kw.query}-${Date.now()}`, {
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: `${emoji} 순위 ${direction} 알림`,
            message: `"${kw.query}" 키워드에서 ${kw.targetProductName || kw.targetProductId}\n순위 ${prev.position}위 → ${latest.position}위 (${Math.abs(diff)}단계 ${direction})`,
            priority: 2,
          });
        }
      }
    } catch (e) { /* 실패 무시 */ }
  }

  // 순위 체크 시간 기록
  await chrome.storage.local.set({ lastRankCheck: new Date().toISOString() });
}

// 추적 키워드 관리 (로컬 + 서버)
async function addTrackedKeyword(keyword) {
  const { trackedKeywords = [] } = await chrome.storage.local.get('trackedKeywords');
  if (trackedKeywords.find(k => k.query === keyword.query)) {
    return { alreadyExists: true };
  }
  const entry = {
    query: keyword.query,
    targetProductId: keyword.targetProductId || null,
    targetProductName: keyword.targetProductName || null,
    addedAt: new Date().toISOString(),
  };
  trackedKeywords.push(entry);
  await chrome.storage.local.set({ trackedKeywords });

  // 서버에도 등록
  const { serverLoggedIn } = await chrome.storage.local.get('serverLoggedIn');
  if (serverLoggedIn) {
    try {
      const resp = await apiClient.addTrackedKeyword(entry);
      entry.serverId = resp?.result?.data?.id;
    } catch (e) { /* 실패 무시 */ }
  }
  return { success: true };
}

async function removeTrackedKeyword(keywordId) {
  const { trackedKeywords = [] } = await chrome.storage.local.get('trackedKeywords');
  const idx = trackedKeywords.findIndex(k => k.query === keywordId || k.serverId === keywordId);
  if (idx >= 0) {
    const removed = trackedKeywords.splice(idx, 1)[0];
    await chrome.storage.local.set({ trackedKeywords });
    // 서버에서도 삭제
    if (removed.serverId) {
      const { serverLoggedIn } = await chrome.storage.local.get('serverLoggedIn');
      if (serverLoggedIn) {
        try { await apiClient.removeTrackedKeyword(removed.serverId); } catch (e) { }
      }
    }
  }
}

async function getTrackedKeywords() {
  const { trackedKeywords = [] } = await chrome.storage.local.get('trackedKeywords');
  return trackedKeywords;
}

async function getRankHistory(query, productId, days) {
  const { serverLoggedIn } = await chrome.storage.local.get('serverLoggedIn');
  if (!serverLoggedIn) return [];
  try {
    const resp = await apiClient.getRankHistory({ query, coupangProductId: productId, days: days || 7 });
    return resp?.result?.data || [];
  } catch (e) { return []; }
}

async function getLatestRanking(query) {
  const { serverLoggedIn } = await chrome.storage.local.get('serverLoggedIn');
  if (!serverLoggedIn) return [];
  try {
    const resp = await apiClient.getLatestRanking({ query });
    return resp?.result?.data || [];
  } catch (e) { return []; }
}

async function getProductPriceHistory(productId, days) {
  const { serverLoggedIn } = await chrome.storage.local.get('serverLoggedIn');
  if (!serverLoggedIn) return [];
  try {
    const resp = await apiClient.getProductHistory({ coupangProductId: productId, days: days || 30 });
    return resp?.result?.data || [];
  } catch (e) { return []; }
}

// ============================================================
//  검색 히스토리 (로컬)
// ============================================================

async function saveSearchHistory(payload) {
  const { searchHistory = [] } = await chrome.storage.local.get('searchHistory');
  const entry = {
    query: payload.query,
    count: payload.count,
    avgPrice: calcAvg(payload.items.map(i => i.price).filter(p => p > 0)),
    avgRating: calcAvg(payload.items.map(i => i.rating).filter(r => r > 0)),
    avgReview: calcAvg(payload.items.map(i => i.reviewCount).filter(r => r > 0)),
    timestamp: payload.capturedAt
  };
  const idx = searchHistory.findIndex(h => h.query === entry.query);
  if (idx >= 0) searchHistory.splice(idx, 1);
  searchHistory.unshift(entry);
  if (searchHistory.length > 100) searchHistory.length = 100;
  await chrome.storage.local.set({ searchHistory });
}

async function getSearchHistory() {
  const { searchHistory = [] } = await chrome.storage.local.get('searchHistory');
  return searchHistory;
}

// ============================================================
//  후보 저장 (로컬 + 서버)
// ============================================================

async function saveCandidateItem(item) {
  const { candidates = [] } = await chrome.storage.local.get('candidates');
  if (candidates.find(c => c.productId === item.productId)) {
    return { alreadySaved: true };
  }
  item.savedAt = new Date().toISOString();
  candidates.unshift(item);
  if (candidates.length > 500) candidates.length = 500;
  await chrome.storage.local.set({ candidates });
  const serverResult = await syncCandidateToServer(item);
  return { alreadySaved: false, serverId: serverResult?.id };
}

async function removeCandidateItem(productId) {
  const { candidates = [] } = await chrome.storage.local.get('candidates');
  const filtered = candidates.filter(c => c.productId !== productId);
  await chrome.storage.local.set({ candidates: filtered });
}

async function getCandidates() {
  const { candidates = [] } = await chrome.storage.local.get('candidates');
  return candidates;
}

function calcAvg(arr) {
  if (!arr.length) return 0;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

// ============================================================
//  WING 인기상품 데이터 관리
// ============================================================

async function saveWingHistory(data) {
  const { wingHistory = [] } = await chrome.storage.local.get('wingHistory');
  const entry = {
    keyword: data.keyword || '(키워드 없음)',
    category: data.category || '',
    count: data.items.length,
    items: data.items.slice(0, 50), // 최대 50개 저장
    source: data.source,
    url: data.pageUrl || data.url,
    avgPrice: calcAvg(data.items.map(i => i.price).filter(p => p > 0)),
    avgRating: calcAvg(data.items.map(i => i.rating).filter(r => r > 0)),
    avgReview: calcAvg(data.items.map(i => i.reviewCount).filter(r => r > 0)),
    capturedAt: data.capturedAt || new Date().toISOString(),
  };

  // 같은 키워드가 이미 있으면 교체
  const idx = wingHistory.findIndex(h =>
    h.keyword === entry.keyword && h.category === entry.category
  );
  if (idx >= 0) wingHistory.splice(idx, 1);
  wingHistory.unshift(entry);
  if (wingHistory.length > 200) wingHistory.length = 200;

  await chrome.storage.local.set({ wingHistory });
}

async function getWingHistory(limit = 50) {
  const { wingHistory = [] } = await chrome.storage.local.get('wingHistory');
  return wingHistory.slice(0, limit);
}

async function getWingStats() {
  const { wingHistory = [] } = await chrome.storage.local.get('wingHistory');
  const totalSearches = wingHistory.length;
  const uniqueKeywords = new Set(wingHistory.map(h => h.keyword)).size;
  const totalProducts = wingHistory.reduce((sum, h) => sum + (h.count || 0), 0);
  const avgPrice = calcAvg(wingHistory.map(h => h.avgPrice).filter(p => p > 0));
  const recentSearches = wingHistory.slice(0, 10);

  // 카테고리별 분포
  const categoryMap = {};
  for (const h of wingHistory) {
    const cat = h.category || '미분류';
    categoryMap[cat] = (categoryMap[cat] || 0) + 1;
  }
  const categories = Object.entries(categoryMap)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalSearches,
    uniqueKeywords,
    totalProducts,
    avgPrice,
    categories,
    recentSearches,
  };
}

async function syncWingDataToServer(data) {
  const { serverLoggedIn } = await chrome.storage.local.get('serverLoggedIn');
  if (!serverLoggedIn) return;

  try {
    const items = data.items || [];
    const prices = items.map(i => i.price).filter(p => p > 0);
    const ratings = items.map(i => i.rating).filter(r => r > 0);
    const reviews = items.map(i => i.reviewCount).filter(r => r > 0);

    await apiClient.saveWingSearch({
      keyword: data.keyword || '',
      category: data.category || '',
      totalItems: items.length,
      avgPrice: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0,
      avgRating: ratings.length ? +(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : 0,
      avgReview: reviews.length ? Math.round(reviews.reduce((a, b) => a + b, 0) / reviews.length) : 0,
      source: data.source || 'unknown',
      pageUrl: data.pageUrl || data.url || '',
      items: items.slice(0, 50),
    });
  } catch (e) { /* 실패 무시 */ }
}

// ============================================================
//  판매량 추정 자동 배치 (알람에서 호출)
// ============================================================

async function autoRunSalesEstimate() {
  const { serverLoggedIn } = await chrome.storage.local.get('serverLoggedIn');
  if (!serverLoggedIn) return;

  try {
    const resp = await apiClient.runSalesEstimateBatch({});
    const data = resp?.result?.data;
    if (data && data.processed > 0) {
      console.log(`[SH] 판매량 추정 배치 완료: ${data.processed}개 처리, ${data.skipped}개 스킵, ${data.errors}개 오류`);
      
      // 급등 상품이 있으면 알림
      const surgeItems = (data.results || []).filter(r => r.grade === 'VERY_HIGH');
      if (surgeItems.length > 0) {
        chrome.notifications.create(`sales-surge-${Date.now()}`, {
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: '🔥 판매 급등 상품 감지!',
          message: `${surgeItems.length}개 상품의 판매량이 급증하고 있습니다. (${surgeItems[0]?.productName?.substring(0, 30) || ''}...)`,
          priority: 2,
        });
      }

      await chrome.storage.local.set({ lastSalesEstimateRun: new Date().toISOString() });
    }
  } catch (e) {
    console.error('[SH] 판매량 추정 배치 실패:', e.message);
  }
}

// ============================================================
//  하이브리드 일일 배치 (알람에서 호출)
// ============================================================

async function autoRunDailyBatch() {
  // 1) 서버 로그인 체크
  const { serverLoggedIn } = await chrome.storage.local.get('serverLoggedIn');
  if (!serverLoggedIn) {
    console.log('[SH] 자동배치 스킵: 서버 미로그인');
    return;
  }

  // 2) 배치 토글 체크 — 사용자가 OFF하면 자동 실행 안 함
  const { batchEnabled } = await chrome.storage.local.get('batchEnabled');
  if (!batchEnabled) {
    console.log('[SH] 자동배치 스킵: 배치 토글 OFF');
    return;
  }

  // 3) 쿠팡 탭이 열려있는지 확인 — 쿠팡 검색창을 열었을 때만 실행
  const coupangTabs = await chrome.tabs.query({ url: 'https://www.coupang.com/*' });
  if (!coupangTabs || coupangTabs.length === 0) {
    console.log('[SH] 자동배치 스킵: 쿠팡 탭 미열림');
    return;
  }

  try {
    // 배치 크기 및 오프셋 설정 (분할 배치 지원)
    const { batchSize, batchOffset } = await chrome.storage.local.get(['batchSize', 'batchOffset']);
    const size = parseInt(batchSize) || 10;
    const offset = parseInt(batchOffset) || 0;

    const resp = await apiClient.runDailyBatchCollection({ limit: size, offset: offset });
    const data = resp?.result?.data;
    if (data && data.processed > 0) {
      console.log(`[SH] 일일 배치 완료: ${data.processed}개 처리, ${data.updated}개 업데이트, ${data.errors}개 오류`);

      // 다음 분할 배치를 위한 오프셋 업데이트
      if (data.hasMore) {
        await chrome.storage.local.set({ batchOffset: offset + size });
        console.log(`[SH] 다음 배치 오프셋: ${offset + size} (잔여 키워드 있음)`);
      } else {
        await chrome.storage.local.set({ batchOffset: 0 });
        console.log('[SH] 모든 키워드 배치 완료, 오프셋 리셋');
      }

      // 리뷰 급증 키워드 알림
      const growthItems = (data.results || []).filter(r => r.reviewGrowth >= 50);
      if (growthItems.length > 0) {
        chrome.notifications.create(`review-growth-${Date.now()}`, {
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: '📈 리뷰 급증 키워드 감지!',
          message: `${growthItems.length}개 키워드에서 리뷰가 급증중: "${growthItems[0]?.keyword}" (+${growthItems[0]?.reviewGrowth})`,
          priority: 2,
        });
      }

      await chrome.storage.local.set({ lastDailyBatchRun: new Date().toISOString() });
    }
  } catch (e) {
    console.error('[SH] 일일 배치 실패:', e.message);
  }
}


// ============================================================
//  v7.0: 하이브리드 자동 수집기 (완전 재작성)
//  "Background HTML fetch + DOMParser" 방식
//
//  핵심 변경사항 (v6.4 대비):
//  1. content.js 메시지 의존 완전 제거
//  2. chrome.scripting.executeScript로 렌더링된 HTML 가져옴
//  3. Background의 DOMParser로 V1/V2 자동 파싱
//  4. 순차 처리 (1개씩), 28~90초 랜덤 딜레이
//  5. 배치 크기 항상 1 (안전)
//  6. 실패 시 더 긴 대기 (2~5분)
// ============================================================

const collector = {
  status: 'IDLE', // IDLE | RUNNING | NAVIGATING | PARSING | WAITING_NEXT | COLLECTING_DETAIL | PAUSED | STOPPED
  running: false,
  paused: false,
  queue: [],
  current: null,          // { keyword, retryCount, startedAt }
  currentTabId: null,
  successCount: 0,
  failCount: 0,
  skipCount: 0,
  totalQueued: 0,
  lastError: null,
  startedAt: null,
  _delayTimeoutId: null,  // 딜레이 타이머
  _aborted: false,        // 중단 플래그
};

// ---- 유틸 ----
function randomDelay(min = 28000, max = 90000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function collectorSleep(ms) {
  return new Promise((resolve) => {
    collector._delayTimeoutId = setTimeout(resolve, ms);
  });
}

function getCollectorState() {
  return {
    status: collector.status,
    running: collector.running,
    paused: collector.paused,
    queueLength: collector.queue.length,
    currentKeyword: collector.current?.keyword || null,
    currentTabId: collector.currentTabId || null,
    successCount: collector.successCount,
    failCount: collector.failCount,
    skipCount: collector.skipCount,
    totalQueued: collector.totalQueued,
    lastError: collector.lastError,
    startedAt: collector.startedAt,
    collectDetail: collector.collectDetail || false,
    progress: collector.totalQueued > 0
      ? Math.round(((collector.successCount + collector.failCount + collector.skipCount) / collector.totalQueued) * 100)
      : 0,
  };
}

// ---- 자동 수집 시작 ----
async function startAutoCollect(options = {}) {
  if (collector.running && !collector.paused) {
    console.warn('[SH-AC] 이미 실행 중');
    return { ok: false, error: 'Already running' };
  }

  // 일시정지에서 재개
  if (collector.paused) {
    collector.paused = false;
    collector._aborted = false;
    collector.status = 'RUNNING';
    console.log('[SH-AC] 수집 재개');
    runNextKeyword();
    return { ok: true, resumed: true };
  }

  const { serverLoggedIn } = await chrome.storage.local.get('serverLoggedIn');
  if (!serverLoggedIn) {
    return { ok: false, error: '서버 로그인 필요' };
  }

  // v7.0: declarativeNetRequest 헤더 위조 적용
  await HybridParser.setupCoupangHeaders().catch(() => {});

  const limit = Math.min(options.limit || 30, 200);
  const collectDetail = options.collectDetail !== false;

  console.log(`[SH-AC] v7.0 하이브리드 수집 시작 (limit=${limit})`);

  // 큐 로드
  try {
    const resp = await apiClient.getBatchKeywordSelection({ limit });
    const keywords = resp?.result?.data || [];
    if (!keywords.length) {
      console.log('[SH-AC] 수집할 키워드가 없습니다.');
      return { ok: false, error: '수집할 키워드가 없습니다 (watch_keywords 등록 필요)' };
    }

    collector.queue = keywords.map(k => ({
      keyword: k.keyword,
      priority: k.priority || 50,
      selectionReason: k.selectionReason || '',
      retryCount: 0,
    }));
    collector.collectDetail = collectDetail;
    collector.totalQueued = collector.queue.length;
    collector.running = true;
    collector.paused = false;
    collector._aborted = false;
    collector.status = 'RUNNING';
    collector.successCount = 0;
    collector.failCount = 0;
    collector.skipCount = 0;
    collector.lastError = null;
    collector.startedAt = new Date().toISOString();

    console.log(`[SH-AC] 큐 로드 완료: ${collector.queue.length}개 키워드`);
    collector.queue.forEach((k, i) => {
      console.log(`  [${i+1}] "${k.keyword}" (우선순위:${k.priority})`);
    });

    await runNextKeyword();
    return { ok: true, queueLength: collector.queue.length };
  } catch (e) {
    console.error('[SH-AC] 큐 로드 실패:', e.message);
    return { ok: false, error: e.message };
  }
}

// ---- 수집 중단 ----
function stopAutoCollect() {
  console.log('[SH-AC] 수집 중단');
  collector.running = false;
  collector.paused = false;
  collector._aborted = true;
  collector.status = 'STOPPED';
  collector.current = null;
  if (collector._delayTimeoutId) { clearTimeout(collector._delayTimeoutId); collector._delayTimeoutId = null; }
}

// ---- 일시정지 ----
function pauseAutoCollect() {
  if (!collector.running) return;
  console.log('[SH-AC] 수집 일시정지');
  collector.paused = true;
  collector._aborted = true;
  collector.status = 'PAUSED';
  if (collector._delayTimeoutId) { clearTimeout(collector._delayTimeoutId); collector._delayTimeoutId = null; }
}

// ---- 쿠팡 탭 확보 ----
async function ensureCoupangTab() {
  // 기존 탭 확인
  if (collector.currentTabId) {
    try {
      const tab = await chrome.tabs.get(collector.currentTabId);
      if (tab?.id && tab.url?.includes('coupang.com')) return tab.id;
    } catch (_) { /* 탭이 닫혔을 수 있음 */ }
  }

  // 열려있는 쿠팡 탭 찾기
  const tabs = await chrome.tabs.query({ url: 'https://www.coupang.com/*' });
  if (tabs.length > 0) {
    collector.currentTabId = tabs[0].id;
    return tabs[0].id;
  }

  // 새 탭 생성 (비활성)
  const tab = await chrome.tabs.create({
    url: 'https://www.coupang.com/',
    active: false,
  });
  collector.currentTabId = tab.id;
  await collectorSleep(5000); // 초기 로드 대기
  return tab.id;
}

// ---- 탭 네비게이션 완료 대기 ----
function waitForTabLoad(tabId, maxWait = 30000) {
  return new Promise((resolve) => {
    let resolved = false;
    const listener = (tid, changeInfo) => {
      if (tid === tabId && changeInfo.status === 'complete') {
        if (!resolved) { resolved = true; chrome.tabs.onUpdated.removeListener(listener); resolve(true); }
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      if (!resolved) { resolved = true; chrome.tabs.onUpdated.removeListener(listener); resolve(false); }
    }, maxWait);
  });
}

// ============================================================
//  ★★★ 핵심: 다음 키워드 실행 (v7.0 완전 재작성) ★★★
//  content.js 의존 제거 → Background에서 직접 HTML 가져와서 파싱
// ============================================================
async function runNextKeyword() {
  if (!collector.running || collector.paused || collector._aborted) return;

  const next = collector.queue.shift();
  if (!next) {
    // 큐 완료
    collector.running = false;
    collector.status = 'IDLE';
    collector.current = null;
    console.log(`[SH-AC] ✅ 자동 수집 완료: 성공 ${collector.successCount}, 실패 ${collector.failCount}, 스킵 ${collector.skipCount}`);

    chrome.notifications.create(`auto-collect-done-${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: '📊 자동 수집 완료',
      message: `${collector.successCount}개 키워드 수집 성공 (실패 ${collector.failCount}, 스킵 ${collector.skipCount})`,
      priority: 1,
    });

    try { await apiClient.runDailyBatchCollection(); } catch (_) {}
    return;
  }

  collector.current = { keyword: next.keyword, retryCount: next.retryCount || 0, startedAt: Date.now() };
  const keyword = next.keyword;
  const progress = collector.successCount + collector.failCount + collector.skipCount + 1;

  console.log(`[SH-AC] 🔍 [${progress}/${collector.totalQueued}] 키워드 수집: "${keyword}"`);

  try {
    // 1. 쿠팡 탭 확보
    const tabId = await ensureCoupangTab();

    // 2. 검색 URL로 이동
    collector.status = 'NAVIGATING';
    const url = `https://www.coupang.com/np/search?q=${encodeURIComponent(keyword)}&page=1`;
    await chrome.tabs.update(tabId, { url });

    // 3. 페이지 로드 완료 대기 (최대 30초)
    const loaded = await waitForTabLoad(tabId, 30000);
    if (!loaded) {
      console.warn(`[SH-AC] ⏰ 페이지 로드 타임아웃: "${keyword}"`);
      await handleCollectFail(keyword, next.retryCount, 'TIMEOUT', '페이지 로드 30초 초과');
      return;
    }

    // 중단 체크
    if (!collector.running || collector._aborted) return;

    // 4. DOM 렌더링 안정화 대기 (5~10초)
    const renderDelay = Math.floor(Math.random() * 5000) + 5000;
    console.log(`[SH-AC] 페이지 로드 완료, ${Math.round(renderDelay/1000)}초 렌더링 대기...`);
    await collectorSleep(renderDelay);

    if (!collector.running || collector._aborted) return;

    // ★★★ 5. Background에서 HTML 가져와서 파싱 (핵심!) ★★★
    collector.status = 'PARSING';
    console.log(`[SH-AC] 📄 HTML 가져오기 + 하이브리드 파싱 시작...`);

    const html = await HybridParser.getRenderedHTML(tabId);
    if (!html || html.length < 1000) {
      // 차단/비정상 페이지 확인
      const isBlocked = /봇|robot|captcha|차단|접근.*불가|Access Denied/i.test(html);
      await handleCollectFail(keyword, next.retryCount,
        isBlocked ? 'ACCESS_BLOCKED' : 'EMPTY_HTML',
        isBlocked ? '쿠팡 접근 차단' : 'HTML이 비어있음'
      );
      return;
    }

    const result = HybridParser.parseSearchHTML(html, keyword);

    if (!result.items.length) {
      console.warn(`[SH-AC] ❌ "${keyword}" 파싱 결과 0개`);
      await handleCollectFail(keyword, next.retryCount, 'EMPTY_RESULT', '파싱된 상품 0개');
      return;
    }

    // 6. 성공 처리
    console.log(`[SH-AC] ✅ "${keyword}" 수집 성공: ${result.items.length}개 (${result.domVersion}) | 평점${result.stats.ratingRate}% 리뷰${result.stats.reviewRate}%`);

    collector.successCount++;
    collector.current = null;

    // 서버에 검색 이벤트 저장
    try {
      await apiClient.saveSearchEvent({
        keyword,
        source: 'auto_collect_v7',
        pageUrl: url,
        totalItems: result.items.length,
        items: result.items.slice(0, 36),
        avgPrice: result.stats.avgPrice,
        avgRating: result.stats.avgRating,
        avgReview: result.stats.avgReview,
        totalReviewSum: result.stats.totalReviewSum,
        adCount: result.stats.adCount,
        rocketCount: result.stats.rocketCount,
        highReviewCount: result.stats.highReviewCount,
        priceParseRate: result.stats.priceRate,
        ratingParseRate: result.stats.ratingRate,
        reviewParseRate: result.stats.reviewRate,
      });
    } catch (_) {}

    try { await apiClient.markKeywordCollected({ keyword }); } catch (_) {}

    // 7. 상세 페이지 상위 3개 보강
    if (collector.collectDetail && result.items.length) {
      const topItems = result.items.filter(i => i.productId && !i.isAd).slice(0, 3);
      if (topItems.length > 0) {
        console.log(`[SH-AC] 📋 상위 ${topItems.length}개 상세 수집...`);
        collector.status = 'COLLECTING_DETAIL';
        for (const item of topItems) {
          if (!collector.running || collector._aborted) break;
          try {
            await collectDetailForItem(item, keyword);
            await collectorSleep(randomDelay(20000, 40000));
          } catch (e) {
            console.warn(`[SH-AC] 상세 수집 실패: ${item.productId}`, e.message);
          }
        }
      }
    }

    // 8. 다음 키워드 — 28~90초 랜덤 딜레이
    if (!collector.running || collector._aborted) return;
    const delay = randomDelay();
    console.log(`[SH-AC] ⏳ 다음 키워드까지 ${Math.round(delay/1000)}초 대기...`);
    collector.status = 'WAITING_NEXT';
    await collectorSleep(delay);

    await runNextKeyword();

  } catch (e) {
    console.error(`[SH-AC] "${keyword}" 수집 중 오류:`, e.message);
    await handleCollectFail(keyword, next.retryCount, 'UNKNOWN', e.message);
  }
}

// ---- 수집 실패 처리 (v7.0 단순화) ----
async function handleCollectFail(keyword, retryCount, errorCode, errorMessage) {
  console.warn(`[SH-AC] ❌ "${keyword}" 실패: ${errorCode} — ${errorMessage}`);
  collector.lastError = `${keyword}: ${errorCode}`;

  // 1회 재시도
  if (retryCount < 1) {
    collector.queue.push({ keyword, priority: 0, retryCount: retryCount + 1 });
  } else {
    collector.failCount++;
    try { await apiClient.markKeywordFailed({ keyword, errorCode, errorMessage }); } catch (_) {}
  }

  collector.current = null;

  if (!collector.running || collector._aborted) return;

  // 실패 시 더 긴 대기 (2~5분)
  const delay = randomDelay(120000, 300000);
  collector.status = 'WAITING_NEXT';
  await collectorSleep(delay);
  await runNextKeyword();
}

// ---- 자동 수집 성공 처리 (content.js에서 호출되는 기존 방식 유지, 하위호환) ----
async function handleAutoCollectSuccess(message) {
  // v7.0에서는 background 직접 파싱이 주력이므로 이 함수는 하위호환용
  if (!collector.current) return;
  if (message.requestId && message.requestId !== collector.current?.requestId) return;

  if (collector._timeoutId) { clearTimeout(collector._timeoutId); collector._timeoutId = null; }

  const keyword = collector.current.keyword;
  console.log(`[SH-AC] ✅ (content) "${keyword}" 수집 성공 (${message.itemCount || 0}개)`);
  collector.successCount++;
  collector.current = null;

  try { await apiClient.markKeywordCollected({ keyword }); } catch (_) {}
  if (message.searchEventData) {
    try { await apiClient.saveSearchEvent({ ...message.searchEventData, source: 'auto_collect' }); } catch (_) {}
  }
}

// ---- 자동 수집 실패 처리 (하위호환) ----
async function handleAutoCollectFailed(requestId, keyword, errorCode, errorMessage) {
  if (!collector.current) return;
  console.warn(`[SH-AC] ❌ (content) "${keyword}" 실패: ${errorCode}`);
  await handleCollectFail(keyword, collector.current.retryCount || 0, errorCode, errorMessage);
}

// ---- 상세 페이지 수집 (상위 N개 보강) ----
async function collectDetailForItem(item, keyword) {
  const tabId = collector.currentTabId;
  if (!tabId) return;

  const detailUrl = item.url || item.productUrl || `https://www.coupang.com/vp/products/${item.productId}`;
  const requestId = generateRequestId();

  console.log(`[SH-AC] 📄 상세 수집: ${item.productId} (${item.title?.substring(0, 30)}...)`);

  // 상세 페이지로 이동
  await chrome.tabs.update(tabId, { url: detailUrl });

  // 페이지 로드 완료 대기 (Promise 기반)
  await new Promise((resolve) => {
    const listener = (tid, changeInfo) => {
      if (tid === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    // 20초 타임아웃
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 20000);
  });

  // DOM 안정화 대기 (3~6초)
  await collectorSleep(randomDelay(3000, 6000));

  // content-detail.js에 파싱 요청
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'START_PARSE_DETAIL',
      requestId,
      productId: item.productId,
      keyword,
      isAutoCollect: true,
    });
  } catch (e) {
    console.warn('[SH-AC] content-detail.js 메시지 전송 실패:', e.message);
    // content script 로드 대기 후 재시도
    await collectorSleep(3000);
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'START_PARSE_DETAIL',
        requestId,
        productId: item.productId,
        keyword,
        isAutoCollect: true,
      });
    } catch (e2) {
      console.warn('[SH-AC] content-detail.js 재시도 실패:', e2.message);
      return;
    }
  }

  // 응답 대기 (20초) + 서버 저장
  await new Promise((resolve) => {
    const handler = (msg) => {
      if (msg.type === 'DETAIL_PARSE_SUCCESS' && msg.requestId === requestId) {
        chrome.runtime.onMessage.removeListener(handler);
        console.log(`[SH-AC] ✅ 상세 수집 성공: ${item.productId} (confidence: ${msg.result?.confidence || 0})`);

        // v6.5: 서버에 확장 상세 스냅샷 저장
        if (msg.result) {
          saveDetailSnapshotToServer(msg.result, keyword).catch(e =>
            console.warn('[SH-AC] 상세 스냅샷 서버 저장 실패:', e.message)
          );
        }

        resolve();
      } else if (msg.type === 'DETAIL_PARSE_FAILED' && msg.requestId === requestId) {
        chrome.runtime.onMessage.removeListener(handler);
        console.warn(`[SH-AC] ❌ 상세 수집 실패: ${item.productId} — ${msg.error?.message || 'unknown'}`);
        resolve();
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    setTimeout(() => { chrome.runtime.onMessage.removeListener(handler); resolve(); }, 20000);
  });
}

// ---- v6.5: 상세 스냅샷 서버 저장 ----
async function saveDetailSnapshotToServer(result, keyword) {
  const { serverLoggedIn } = await chrome.storage.local.get('serverLoggedIn');
  if (!serverLoggedIn) return;

  try {
    await apiClient.saveDetailSnapshot({
      coupangProductId: result.coupangProductId,
      vendorItemId: result.vendorItemId || null,
      title: result.title || null,
      price: result.price || 0,
      originalPrice: result.originalPrice || 0,
      discountRate: result.discountRate || 0,
      rating: result.rating || 0,
      reviewCount: result.reviewCount || 0,
      purchaseCount: result.purchaseCount || null,
      sellerName: result.sellerName || null,
      brandName: result.brandName || null,
      manufacturer: result.manufacturer || null,
      origin: result.origin || null,
      deliveryType: result.deliveryType || 'STANDARD',
      isRocket: result.isRocket || false,
      isFreeShipping: result.isFreeShipping || false,
      soldOut: result.soldOut || false,
      categoryPath: result.categoryPath || null,
      optionCount: result.optionCount || 0,
      imageUrl: result.imageUrl || null,
      confidence: result.confidence || 0,
      reviewSamples: result.reviewSamples || [],
      optionSummary: result.optionSummary || [],
      badgeText: result.badgeText || null,
      keyword: keyword || null,
      source: 'auto_collect',
      detailJson: result.detailJson || {},
    });
    console.log(`[SH-AC] 💾 상세 스냅샷 서버 저장 완료: ${result.coupangProductId}`);
  } catch (e) {
    console.warn('[SH-AC] 상세 스냅샷 서버 저장 오류:', e.message);
  }
}

// ---- 탭이 닫혔을 때 수집 중단 ----
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === collector.currentTabId && collector.running) {
    console.warn('[SH-AC] 쿠팡 탭이 닫혔습니다. 수집 일시정지.');
    collector.currentTabId = null;
    // 자동으로 새 탭을 만들어 계속할 수도 있지만, 안전하게 일시정지
    pauseAutoCollect();
  }
});
