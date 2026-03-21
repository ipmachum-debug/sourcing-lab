/* ============================================================
   Coupang Sourcing Helper — Background Service Worker v7.4.1
   v7.4.1: 인간 행동 모방 딜레이 전면 개편 (봇 탐지 회피 강화)
         - 지수 분포 딜레이: 짧은 간격 70%, 긴 간격 30% (실제 사람 클릭 패턴)
         - 세션 피로도: 10번째 요청부터 딜레이 3%씩 증가 (최대 2배)
         - 시간대 가중치: 새벽 ×1.8, 피크 ×0.85 (KST 기준)
         - 마이크로 지터: 모든 딜레이에 ±5~15% 랜덤 변동
         - 재시도 큐 분산: 실패 키워드를 큐 중간에 삽입 (연속 동일 URL 방지)
         - 에러 딜레이 지수 백오프: 재시도마다 1.5배 증가
         - 상세 수집 딜레이: humanDetailDelay (검색→상세 자연스러운 패턴)
         - 좀비 감지 동적 임계값: 키워드 수 기반 (30분 고정값 제거)
         - 재귀→setTimeout 루프: Service Worker 메모리 안전
         - resetCollector 완전 초기화
   v7.2.5: Service Worker DOMParser 파싱오류 수정 + Regex 파서 추가 + 가격 오버플로 방지
   v7.2.3: 검색시 통계 자동 산출 + saveSearchEvent 데이터 동기화
   v7.2.2: 자동 수집 UNKNOWN 에러 수정 + 딜레이 최적화 + 상태 관리 강화
   v7.2.1: 마진 계산기 셀러라이프 방식 전면 반영 + API 통신 강화
   v7.2: 셀러라이프 수집방식 전면 반영 (대개편)
   v7.1: tRPC SuperJSON 응답 해제 수정
   v7.0: 하이브리드 수집 아키텍처 대개편
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
  // v8.6: 예약 자동수집 알람 (매 2시간마다)
  chrome.alarms.create('scheduledAutoCollect', { periodInMinutes: 120 });
  // v8.1: AI 제품 발견 자동 폴링 (매 1분마다 pending job 확인)
  chrome.alarms.create('discoveryPolling', { periodInMinutes: 1 });

  // 설치 또는 업데이트 시 열린 쿠팡 탭을 새로고침하여 새 content script 적용
  if (details.reason === 'install' || details.reason === 'update') {
    // v7.0: declarativeNetRequest 헤더 위조 설정
    HybridParser.setupCoupangHeaders().catch(() => {});

    chrome.tabs.query({ url: ['https://www.coupang.com/*', 'https://wing.coupang.com/*', 'https://m-wing.coupang.com/*'] }, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.reload(tab.id);
      }
    });
    console.log(`[SH] Extension ${details.reason}d — v8.1.0 — AI 자동 발견 + 시장 데이터 + CPC`);
  }
});

// v8.1: 서비스 워커 시작 시 — 알람 보장 + 즉시 체크
(async () => {
  // 알람이 없으면 재생성 (서비스 워커 재시작 시 알람이 사라질 수 있음)
  const existing = await chrome.alarms.get('discoveryPolling').catch(() => null);
  if (!existing) {
    chrome.alarms.create('discoveryPolling', { periodInMinutes: 1 });
    console.log('[Discovery] 폴링 알람 재생성');
  }
  // v8.6: 예약 수집 알람 보장 + 경과 시간 기반 즉시 실행
  const schedData = await chrome.storage.local.get(['scheduleEnabled', 'scheduleLastRun']);
  if (schedData.scheduleEnabled) {
    const schedAlarm = await chrome.alarms.get('scheduledAutoCollect').catch(() => null);
    if (!schedAlarm) {
      const lastRun = schedData.scheduleLastRun ? new Date(schedData.scheduleLastRun).getTime() : 0;
      const elapsed = Date.now() - lastRun;
      const intervalMs = 120 * 60 * 1000;
      if (elapsed >= intervalMs) {
        chrome.alarms.create('scheduledAutoCollect', { periodInMinutes: 120 });
        console.log('[Schedule] 알람 재생성 — 즉시 실행');
        setTimeout(() => runScheduledAutoCollect(), 5000);
      } else {
        const remainMin = Math.max(1, Math.round((intervalMs - elapsed) / 60000));
        chrome.alarms.create('scheduledAutoCollect', { delayInMinutes: remainMin, periodInMinutes: 120 });
        console.log('[Schedule] 알람 재생성 — ' + remainMin + '분 후');
      }
    }
  }
  // 10초 후 즉시 체크
  setTimeout(async () => {
    console.log('[Discovery] 서비스 워커 시작 — 자동 체크 실행');
    try { await discoveryAutoCheck(); } catch (e) { console.warn('[Discovery] 시작 체크 실패:', e.message); }
  }, 10000);
})();

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
  // v8.1: AI 제품 발견 자동 폴링
  if (alarm.name === 'discoveryPolling') {
    await discoveryAutoCheck();
  }
  // v8.6: 예약 자동수집 (2시간마다)
  if (alarm.name === 'scheduledAutoCollect') {
    await runScheduledAutoCollect();
  }
});

// v8.1: 자동 발견 폴링 — pending 작업이 있으면 자동으로 크롤링 시작
async function discoveryAutoCheck() {
  try {
    // 이미 실행 중이면 스킵
    if (discoveryState.running) {
      console.log('[Discovery] 자동 폴링: 이미 크롤링 실행 중 — 스킵');
      return;
    }
    
    // 로그인 상태 확인
    const { serverLoggedIn } = await chrome.storage.local.get('serverLoggedIn');
    if (!serverLoggedIn) {
      console.log('[Discovery] 자동 폴링: 로그인 안됨 — 스킵');
      return;
    }
    
    console.log('[Discovery] 자동 폴링: 서버에 pending 작업 확인 중...');
    
    // 서버에 pending 작업 확인
    const resp = await apiClient.discoveryGetPendingJobs();
    console.log('[Discovery] 자동 폴링 응답:', JSON.stringify(resp)?.slice(0, 300));
    const jobs = resp?.result?.data || [];
    
    if (jobs.length > 0) {
      console.log(`[Discovery] 🔍 자동 폴링: ${jobs.length}개 대기 작업 발견 → 크롤링 시작`);
      startDiscoveryCrawl();
    } else {
      console.log('[Discovery] 자동 폴링: 대기 작업 없음');
    }
  } catch (err) {
    console.warn('[Discovery] 자동 폴링 체크 실패:', err.message, err.stack);
  }
}

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
      // v7.2.2: 사용자 검색 시에도 saveSearchEvent 호출 (웹 대시보드 통계 자동 갱신)
      syncSearchEventToServer(payload).catch(() => {});
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

    // v8.4.6: 미수집 키워드 목록 조회
    case 'HYBRID_GET_UNCOLLECTED_KEYWORDS': {
      apiClient.getUncollectedKeywords().then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    // v8.4.6: 미수집 키워드 우선수집 예약
    case 'HYBRID_BOOST_UNCOLLECTED': {
      apiClient.boostUncollectedPriority().then((resp) => {
        sendResponse({ ok: true, data: resp?.result?.data });
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    // 수동 수집용: 선택된 키워드 nextCollectAt 리셋 (수집주기 바이패스)
    case 'HYBRID_RESET_NEXT_COLLECT': {
      apiClient.resetNextCollectForKeywords(message.data).then((resp) => {
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

    // ===== v8.6.1: 검색량 조회 (content.js 플로팅 패널용) =====
    // 호출 순서 최적화: getKeywordMarketData(query, 빠름) 먼저 → searchVolume 없을 때만 fetchSearchVolume
    case 'GET_KEYWORD_MARKET_DATA': {
      (async () => {
        try {
          if (!message.keyword) {
            sendResponse({ ok: false, error: 'no_keyword' });
            return;
          }

          // ★ Step 1: 통합 마켓 데이터 먼저 조회 (GET query = 빠름, DB에서 기존 데이터 반환)
          let data = {};
          try {
            const resp = await apiClient.getKeywordMarketData({ keyword: message.keyword });
            data = resp?.result?.data || {};
          } catch (marketErr) {
            const errMsg = marketErr.message || '';
            if (errMsg.includes('UNAUTHORIZED') || errMsg.includes('401') || errMsg.includes('인증')) {
              sendResponse({ ok: false, error: 'UNAUTHORIZED' });
              return;
            }
            console.log('[SH] getKeywordMarketData 실패:', errMsg);
          }

          // ★ Step 2: searchVolume이 없을 때만 fetchSearchVolume 호출 (API 큐 절약)
          // 이미 searchVolume이 있으면 추가 API 호출 불필요
          let naverNotFound = false;
          if (!data.searchVolume || Number(data.searchVolume.totalSearch || 0) === 0) {
            try {
              const fetchResp = await apiClient.fetchSearchVolume({ keywords: [message.keyword] });
              const naverFetchData = fetchResp?.result?.data;
              naverNotFound = naverFetchData?.naverNotFound === true;

              if (naverFetchData?.directVolume) {
                data.searchVolume = naverFetchData.directVolume;
                // 추정치 보정
                if (data.searchVolumeEstimate && data.searchVolumeEstimate.estimatedMonthlySearch === 0) {
                  const tv = naverFetchData.directVolume.totalSearch || 0;
                  data.searchVolumeEstimate.estimatedMonthlySearch = Math.round(tv * 0.33);
                  data.searchVolumeEstimate.components = {
                    ...(data.searchVolumeEstimate.components || {}),
                    naverEstimate: Math.round(tv * 0.33),
                  };
                }
              }
            } catch (e) {
              const errMsg = e.message || '';
              if (errMsg.includes('UNAUTHORIZED') || errMsg.includes('401') || errMsg.includes('인증')) {
                sendResponse({ ok: false, error: 'UNAUTHORIZED' });
                return;
              }
              console.log('[SH] fetchSearchVolume 실패 (계속 진행):', errMsg);
            }
          }

          // Naver 미등록 키워드 표시
          if (!data.searchVolume && naverNotFound) {
            data._naverNotFound = true;
          }

          console.log(`[SH] 마켓 데이터 응답: ${message.keyword}`,
            `sv=${data.searchVolume?.totalSearch || 'null'}, est=${data.searchVolumeEstimate?.model || 'null'}, snap=${!!data.snapshot}, naverNotFound=${naverNotFound}`);
          sendResponse({ ok: true, data });
        } catch (e) {
          console.error('[SH] 마켓 데이터 조회 실패:', e.message);
          const errMsg = e.message || '';
          if (errMsg.includes('UNAUTHORIZED') || errMsg.includes('401') || errMsg.includes('인증')) {
            sendResponse({ ok: false, error: 'UNAUTHORIZED' });
          } else {
            sendResponse({ ok: false, error: errMsg });
          }
        }
      })();
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
        // 적응형 스케줄러: { keywords, delayConfig, totalActive, totalOverdue }
        const data = resp?.result?.data || {};
        sendResponse({ ok: true, data });
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

    // v8.6: 예약 수집 토글
    case 'SCHEDULE_TOGGLE': {
      (async () => {
        const { scheduleEnabled } = await chrome.storage.local.get('scheduleEnabled');
        const newVal = !scheduleEnabled;
        await chrome.storage.local.set({ scheduleEnabled: newVal });
        if (newVal) {
          // 마지막 수집으로부터 경과 시간 계산
          const { scheduleLastRun } = await chrome.storage.local.get('scheduleLastRun');
          const lastRun = scheduleLastRun ? new Date(scheduleLastRun).getTime() : 0;
          const elapsed = Date.now() - lastRun;
          const intervalMs = 120 * 60 * 1000; // 2시간
          if (elapsed >= intervalMs) {
            // 이미 2시간 지남 → 즉시 실행 + 이후 2시간 주기
            chrome.alarms.create('scheduledAutoCollect', { periodInMinutes: 120 });
            console.log('[Schedule] 예약 활성화 — 마지막 수집 ' + Math.round(elapsed / 60000) + '분 전 → 즉시 실행');
            setTimeout(() => runScheduledAutoCollect(), 3000);
          } else {
            // 아직 2시간 안됨 → 남은 시간 후 첫 실행
            const remainMin = Math.max(1, Math.round((intervalMs - elapsed) / 60000));
            chrome.alarms.create('scheduledAutoCollect', { delayInMinutes: remainMin, periodInMinutes: 120 });
            console.log('[Schedule] 예약 활성화 — ' + remainMin + '분 후 첫 수집');
          }
        } else {
          chrome.alarms.clear('scheduledAutoCollect');
          console.log('[Schedule] 예약 수집 비활성화');
        }
        sendResponse({ ok: true, enabled: newVal });
      })();
      return true;
    }

    case 'SCHEDULE_STATUS': {
      (async () => {
        const st = await chrome.storage.local.get(['scheduleEnabled', 'scheduleLastRun', 'scheduleNextRound']);
        sendResponse({ ok: true, enabled: !!st.scheduleEnabled, lastRun: st.scheduleLastRun || null });
      })();
      return true;
    }

    // v7.2: 강제 수집기 리셋 (사이드패널에서 'Already running' 에러 시 사용)
    case 'FORCE_RESET_COLLECTOR': {
      resetCollector();
      sendResponse({ ok: true, message: '수집기 강제 리셋 완료' });
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

    // ===== v8.0: AI 제품 발견 크롤링 =====
    case 'START_DISCOVERY_CRAWL': {
      startDiscoveryCrawl().then(result => {
        sendResponse(result);
      }).catch(e => {
        sendResponse({ ok: false, error: e.message });
      });
      return true;
    }

    case 'GET_DISCOVERY_STATUS': {
      sendResponse({ ok: true, data: discoveryState });
      return true;
    }

    // v8.0: 쿠팡 애즈 CPC 데이터 수신 (content-coupang-ads.js → background)
    case 'COUPANG_ADS_CPC_DATA': {
      (async () => {
        try {
          const items = message.data || [];
          let saved = 0;
          for (const item of items) {
            try {
              await apiClient.saveCpcData({
                keyword: item.keyword,
                categoryId: item.categoryId || '',
                categoryName: item.categoryName || '',
                suggestedBid: item.suggestedBid || 0,
                minBid: item.minBid || 0,
                maxBid: item.maxBid || 0,
                estimatedImpressions: item.estimatedImpressions || 0,
                estimatedClicks: item.estimatedClicks || 0,
                estimatedCtr: item.estimatedCtr || 0,
                competitionLevel: item.competitionLevel || '',
              });
              saved++;
            } catch (e) {
              console.warn('[CPC] Save failed for', item.keyword, e);
            }
          }
          console.log(`[CPC] Saved ${saved}/${items.length} CPC records`);
          sendResponse({ ok: true, saved });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
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

  // ★ v8.2.0: 연속 로그 스케일 경쟁도 (0–100 균등 분산)
  const adRatio = items.length ? adCount / items.length : 0;
  const reviewAxis = avgReview > 0 ? Math.min(35, (Math.log10(avgReview) / 4) * 35) : 0;
  const highReviewAxis = Math.min(25, (highReviewRatio / 80) * 25);
  const ratingAxis = avgRating >= 4.0 ? Math.min(20, ((avgRating - 4.0) / 1.0) * 20) : 0;
  const adAxis = Math.min(20, (adRatio / 0.4) * 20);
  const competitionScore = Math.round(Math.min(100, reviewAxis + highReviewAxis + ratingAxis + adAxis));

  const competitionLevel = competitionScore >= 65 ? 'hard' : competitionScore >= 35 ? 'medium' : 'easy';

  // v8.0: 셀러라이프 수준 시장 데이터 계산
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;
  const sortedPrices = [...prices].sort((a, b) => a - b);
  const medianPrice = sortedPrices.length ? sortedPrices[Math.floor(sortedPrices.length / 2)] : 0;
  const totalReviewSum = reviews.reduce((a, b) => a + b, 0);
  const maxReviewCount = reviews.length ? Math.max(...reviews) : 0;
  const minReviewCount = reviews.length ? Math.min(...reviews) : 0;

  // 배송 타입별 카운트
  let rocketCnt = 0, sellerRocketCnt = 0, globalRocketCnt = 0;
  let normalDeliveryCnt = 0, overseasDeliveryCnt = 0;
  for (const it of items) {
    const dt = it.deliveryType || '';
    if (dt === 'rocketDelivery') rocketCnt++;
    else if (dt === 'sellerRocketDelivery') sellerRocketCnt++;
    else if (dt === 'globalRocketDelivery') globalRocketCnt++;
    else if (dt === 'normalDelivery') normalDeliveryCnt++;
    else if (dt === 'internationalDelivery') overseasDeliveryCnt++;
  }

  // 가격/리뷰 분포 히스토그램
  function makeDistribution(values, bucketCount) {
    if (!values.length) return [];
    const vMin = Math.min(...values);
    const vMax = Math.max(...values);
    if (vMin === vMax) return [{ range: `${vMin}`, count: values.length }];
    const step = (vMax - vMin) / bucketCount;
    return Array.from({ length: bucketCount }, (_, i) => {
      const lo = Math.round(vMin + step * i);
      const hi = Math.round(vMin + step * (i + 1));
      const count = values.filter(v => v >= lo && (i === bucketCount - 1 ? v <= hi : v < hi)).length;
      return { range: `${lo}~${hi}`, count };
    });
  }

  await apiClient.saveSnapshot({
    query: payload.query,
    totalItems: payload.count,
    avgPrice, avgRating, avgReview, highReviewRatio, adCount,
    competitionScore, competitionLevel,
    items: items.slice(0, 36),
    // v8.0: 확장 시장 데이터
    totalProductCount: payload.totalProductCount || 0,
    minPrice, maxPrice, medianPrice,
    totalReviewSum: Math.min(totalReviewSum, 2147483647),
    maxReviewCount, minReviewCount,
    rocketCount: rocketCnt,
    sellerRocketCount: sellerRocketCnt,
    globalRocketCount: globalRocketCnt,
    normalDeliveryCount: normalDeliveryCnt,
    overseasDeliveryCount: overseasDeliveryCnt,
    priceDistribution: makeDistribution(prices, 6),
    reviewDistribution: makeDistribution(reviews, 5),
    highReviewCount,
  });
}

// v7.2.2: 사용자 검색 시 saveSearchEvent 자동 호출 (웹 대시보드 통계 연동)
async function syncSearchEventToServer(payload) {
  const { serverLoggedIn } = await chrome.storage.local.get('serverLoggedIn');
  if (!serverLoggedIn) return;
  if (!payload.query || !payload.items?.length) return;

  const items = payload.items;
  const prices = items.map(i => i.price).filter(p => p > 0);
  const ratings = items.map(i => i.rating).filter(r => r > 0);
  const reviews = items.map(i => i.reviewCount).filter(r => r >= 0);

  const avgPrice = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
  const avgRating = ratings.length ? +(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : 0;
  const avgReview = reviews.length ? Math.round(reviews.reduce((a, b) => a + b, 0) / reviews.length) : 0;
  const totalReviewSum = Math.min(reviews.reduce((a, b) => a + b, 0), 2147483647);
  const adCount = items.filter(i => i.isAd).length;
  const rocketCount = items.filter(i => i.isRocket).length;
  const highReviewCount = items.filter(i => (i.reviewCount || 0) >= 100).length;
  const priceRate = items.length ? Math.round(prices.length / items.length * 100) : 0;
  const ratingRate = items.length ? Math.round(ratings.length / items.length * 100) : 0;
  const reviewRate = items.length ? Math.round(reviews.length / items.length * 100) : 0;

  try {
    await apiClient.saveSearchEvent({
      keyword: payload.query,
      source: 'user_search',
      pageUrl: payload.url || '',
      totalItems: items.length,
      items: items.slice(0, 36),
      avgPrice,
      avgRating,
      avgReview,
      totalReviewSum,
      adCount,
      rocketCount,
      highReviewCount,
      priceParseRate: priceRate,
      ratingParseRate: ratingRate,
      reviewParseRate: reviewRate,
    });
    console.log(`[SH] saveSearchEvent 자동 동기화: "${payload.query}" (${items.length}개)`);
  } catch (e) {
    console.warn('[SH] saveSearchEvent 동기화 실패:', e.message);
  }
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
    console.log('[SH] 자동수집 스킵: 서버 미로그인');
    return;
  }

  // 2) 쿠팡 탭이 열려있는지 확인 — 쿠팡 검색창을 열었을 때만 실행
  const coupangTabs = await chrome.tabs.query({ url: 'https://www.coupang.com/*' });
  if (!coupangTabs || coupangTabs.length === 0) {
    console.log('[SH] 자동수집 스킵: 쿠팡 탭 미열림');
    return;
  }

  // v8.5.1: 하루 5배치 제한 체크
  const todayData = await chrome.storage.local.get(['todayBatchRuns', 'todayBatchDate']);
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayRuns = (todayData.todayBatchDate === todayStr) ? (todayData.todayBatchRuns || 0) : 0;
  if (todayRuns >= 5) {
    console.log('[SH] 자동수집 스킵: 오늘 5회 완료');
    return;
  }

  try {
    // v8.5.1: 배치 크기 100 키워드 기본값 (서버에서 스마트 선택)
    const { batchSize, batchOffset } = await chrome.storage.local.get(['batchSize', 'batchOffset']);
    const size = parseInt(batchSize) || 100;
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

      // v8.5.1: 오늘 배치 카운트 업데이트
      const tdValid = (todayData.todayBatchDate === todayStr) ? (todayData.todayValidCount || 0) : 0;
      await chrome.storage.local.set({
        lastDailyBatchRun: new Date().toISOString(),
        todayBatchRuns: todayRuns + 1,
        todayValidCount: tdValid + (data.processed || 0),
        todayBatchDate: todayStr,
      });
    }
  } catch (e) {
    console.error('[SH] 일일 배치 실패:', e.message);
  }
}

// ============================================================
//  v8.6: 예약 자동수집 (2시간마다 다회차 자동 수집)
//
//  - 키워드 ≤500개: ceil(total/100)회차 수집
//  - 키워드 >500개: 5회차(100×5) 수집
//  - 회차 간 2~4분 쿨다운
//  - 수집 완료 후 자동 통계 처리
// ============================================================

async function runScheduledAutoCollect() {
  // 1) 예약 활성 체크
  const { scheduleEnabled } = await chrome.storage.local.get('scheduleEnabled');
  if (!scheduleEnabled) {
    console.log('[Schedule] 예약 수집 비활성 — 스킵');
    return;
  }

  // 2) 서버 로그인 체크
  const { serverLoggedIn } = await chrome.storage.local.get('serverLoggedIn');
  if (!serverLoggedIn) {
    console.log('[Schedule] 서버 미로그인 — 스킵');
    return;
  }

  // 3) 쿠팡 탭 열려있는지 확인
  const coupangTabs = await chrome.tabs.query({ url: 'https://www.coupang.com/*' });
  if (!coupangTabs || coupangTabs.length === 0) {
    console.log('[Schedule] 쿠팡 탭 미열림 — 스킵');
    return;
  }

  // 4) 수집기가 이미 실행 중이면 스킵
  if (collector.running) {
    console.log('[Schedule] 수집기 실행 중 — 스킵');
    return;
  }

  // 5) 서버에서 전체 키워드 수 + 오늘 수집 상태 조회
  let totalActive = 0;
  let roundsToday = 0;
  let maxRounds = 5;
  try {
    const dashResp = await apiClient.hybridCollectionDashboard();
    const dashData = dashResp?.result?.data;
    if (dashData) {
      totalActive = (dashData.watchKeywords && dashData.watchKeywords.active) || 0;
      if (dashData.batchEngine) {
        roundsToday = dashData.batchEngine.roundsToday || 0;
        maxRounds = dashData.batchEngine.maxRoundsPerDay || 5;
      }
    }
  } catch (e) {
    console.error('[Schedule] 대시보드 조회 실패:', e.message);
    return;
  }

  if (totalActive === 0) {
    console.log('[Schedule] 활성 키워드 없음 — 스킵');
    return;
  }

  // 6) 필요한 회차 계산
  const neededRounds = Math.min(Math.ceil(totalActive / 100), maxRounds);
  const remainingRounds = Math.max(0, neededRounds - roundsToday);

  if (remainingRounds <= 0) {
    console.log(`[Schedule] 오늘 수집 완료 (${roundsToday}/${maxRounds}회차) — 스킵`);
    return;
  }

  console.log(`[Schedule] 예약 자동수집 시작 — ${remainingRounds}회차 예정 (활성: ${totalActive}개, 오늘: ${roundsToday}/${maxRounds})`);
  await chrome.storage.local.set({ scheduleLastRun: new Date().toISOString() });

  // 7) 다회차 순차 수집
  for (let round = 0; round < remainingRounds; round++) {
    if (collector.running) {
      console.log(`[Schedule] 회차 ${round + 1} — 수집기 실행 중, 대기...`);
      await waitForCollectorDone(180000); // 최대 3분 대기
    }

    // 서버에서 이번 회차 키워드 선별 (2회차부터 간격 체크 스킵)
    let batchKeywords = [];
    try {
      const batchResp = await apiClient.getBatchKeywordSelection({ limit: 100, skipIntervalCheck: round > 0 });
      const batchData = batchResp?.result?.data;
      if (batchData && batchData.keywords && batchData.keywords.length > 0) {
        batchKeywords = batchData.keywords.map(function(k) { return k.keyword; });
      }
    } catch (e) {
      console.error(`[Schedule] 회차 ${round + 1} 키워드 선별 실패:`, e.message);
      break;
    }

    if (batchKeywords.length === 0) {
      console.log(`[Schedule] 회차 ${round + 1} — 수집할 키워드 없음, 중단`);
      break;
    }

    console.log(`[Schedule] 회차 ${round + 1}/${remainingRounds} 시작 — ${batchKeywords.length}개 키워드`);

    // 자동수집 시작
    try {
      await startAutoCollect({ limit: batchKeywords.length, collectDetail: false, keywords: batchKeywords, roundSize: 100 });
      // 수집 완료 대기 (최대 80분)
      await waitForCollectorDone(80 * 60 * 1000);
      console.log(`[Schedule] 회차 ${round + 1} 완료 — 성공: ${collector.successCount}, 실패: ${collector.failCount}`);
    } catch (e) {
      console.error(`[Schedule] 회차 ${round + 1} 수집 오류:`, e.message);
      break;
    }

    // 다음 회차 전 쿨다운 (2~4분 랜덤)
    if (round < remainingRounds - 1) {
      const cooldown = 120000 + Math.random() * 120000; // 2~4분
      console.log(`[Schedule] 쿨다운 ${Math.round(cooldown / 1000)}초...`);
      await new Promise(resolve => setTimeout(resolve, cooldown));
    }
  }

  console.log('[Schedule] 예약 자동수집 완료');
}

// 수집기 완료 대기 헬퍼
function waitForCollectorDone(timeoutMs) {
  return new Promise(function(resolve) {
    var elapsed = 0;
    var interval = 3000;
    var check = setInterval(function() {
      elapsed += interval;
      if (!collector.running || elapsed >= timeoutMs) {
        clearInterval(check);
        resolve();
      }
    }, interval);
  });
}


// ============================================================
//  v7.4: 하이브리드 자동 수집기 (인간 행동 모방 + 봇 탐지 회피)
//
//  딜레이 전략 (v7.4 신규):
//  1. 지수 분포: exponentialRandom() — 짧은 간격 자주, 긴 간격 가끔
//  2. 세션 피로도: getSessionFatigueMultiplier() — 수집 진행 시 점진 감속
//  3. 시간대 가중치: getTimeOfDayMultiplier() — KST 새벽/피크 차등
//  4. 마이크로 지터: addJitter() — 모든 딜레이에 ±5~15% 변동
//  5. 재시도 큐 분산: 실패 키워드를 2~5번째에 삽입 (연속 동일 URL 방지)
//  6. 에러 딜레이: errorDelay() — 에러 유형별 지수 백오프
//
//  수집 전략 (v7.2 유지):
//  1. Background fetch (k() 방식) — 가장 빠름
//  2. DNR 규칙 적용 fetch (cData-v3 방식)
//  3. 기존 탭 executeScript (cData-coupang 방식)
//  4. Hidden Tab + 폴링 (cDataTab2 방식) — 가장 확실
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
  _consecutiveErrors: 0,  // v7.2: 연속 에러 카운터
};

// ============================================================
//  v7.4: 인간 행동 모방 딜레이 시스템
//  - 지수 분포: 짧은 간격 70%, 긴 간격 30% (실제 사람 클릭 패턴)
//  - 세션 피로도: 요청 누적 시 딜레이 점진적 증가
//  - 시간대 가중치: 새벽엔 느리게, 피크타임엔 빠르게
//  - 마이크로 지터: 모든 딜레이에 ±5~15% 랜덤 변동
// ============================================================

// ---- 기본 유틸 (폴백 전용) ----
function randomDelay(min = 15000, max = 25000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ---- 지수 분포 랜덤 (핵심) ----
// mean 기준 지수 분포: 짧은 값이 자주, 긴 값이 가끔 나오는 자연스러운 패턴
function exponentialRandom(mean) {
  // -ln(U) * mean, U ∈ (0, 1)
  const u = Math.random();
  // u가 0에 너무 가까우면 극단값 방지
  return -Math.log(Math.max(u, 0.001)) * mean;
}

// ---- 시간대 가중치 (KST 기준) ----
function getTimeOfDayMultiplier() {
  // KST = UTC + 9
  const kstHour = (new Date().getUTCHours() + 9) % 24;
  // 새벽 1~5시: 트래픽 매우 적음 → 딜레이 크게 (눈에 띄므로)
  if (kstHour >= 1 && kstHour <= 5) return 1.8;
  // 아침 6~8시: 트래픽 증가 시작
  if (kstHour >= 6 && kstHour <= 8) return 1.3;
  // 피크타임 9~12시, 19~23시: 트래픽 많음 → 딜레이 줄여도 안 띔
  if ((kstHour >= 9 && kstHour <= 12) || (kstHour >= 19 && kstHour <= 23)) return 0.85;
  // 오후 13~18시: 보통
  if (kstHour >= 13 && kstHour <= 18) return 1.0;
  // 자정~1시, 나머지
  return 1.5;
}

// ---- 세션 피로도 계수 ----
// 사람은 시간이 지날수록 느려짐: 10번째 요청부터 요청당 3%씩 증가, 최대 2배
function getSessionFatigueMultiplier(requestIndex) {
  if (requestIndex < 10) return 1.0;
  const fatigue = 1.0 + (requestIndex - 10) * 0.03;
  return Math.min(fatigue, 2.0);
}

// ---- 마이크로 지터: 모든 딜레이에 ±5~15% 랜덤 변동 ----
function addJitter(delayMs) {
  const jitterPercent = 0.05 + Math.random() * 0.10; // 5~15%
  const direction = Math.random() < 0.5 ? -1 : 1;
  return Math.round(delayMs * (1 + direction * jitterPercent));
}

// ---- 인간 행동 딜레이 생성기 (v7.4: 지수분포 + 피로도 + 시간대) ----
function humanDelay(config, indexInBurst) {
  if (!config) return addJitter(randomDelay());

  const burstSize = config.burstSize || 5;
  const isBurstBreak = burstSize > 0 && indexInBurst > 0 && indexInBurst % burstSize === 0;

  let delay;

  if (isBurstBreak) {
    // 버스트 완료 → 긴 휴식 (사람이 다른 일 하다 돌아오는 패턴)
    // 긴 휴식도 지수 분포: 평균 = (min + max) / 2, 하한 min, 상한 max
    const pauseMin = config.burstPauseMinMs || 60000;
    const pauseMax = config.burstPauseMaxMs || 180000;
    const pauseMean = (pauseMin + pauseMax) / 2;
    delay = exponentialRandom(pauseMean * 0.7); // 지수분포 mean을 약간 낮게 → 짧은 휴식이 더 빈번
    delay = Math.max(pauseMin, Math.min(pauseMax * 1.2, delay)); // 상한 약간 여유
    console.log(`[SH-DELAY] 🛋️ 버스트 휴식: ${Math.round(delay/1000)}초 (버스트 #${Math.floor(indexInBurst / burstSize)})`);
  } else {
    // 버스트 내 — 지수 분포 (짧은 간격이 70%, 긴 간격이 30%)
    const baseMs = config.baseDelayMs || 15000;
    const maxMs = config.maxDelayMs || 35000;
    const expMean = (baseMs + maxMs) / 3; // 지수분포 mean을 낮게 잡아서 짧은 값 빈번
    delay = exponentialRandom(expMean);
    delay = Math.max(baseMs, Math.min(maxMs, delay));
  }

  // 세션 피로도 적용
  delay *= getSessionFatigueMultiplier(indexInBurst);

  // 시간대 가중치 적용
  delay *= getTimeOfDayMultiplier();

  // 마이크로 지터
  delay = addJitter(delay);

  return Math.round(delay);
}

// ---- 상세 수집용 인간 딜레이 (검색→상세 전환 패턴) ----
// 사람이 검색 결과 → 상세 페이지로 가는 패턴: 빠르게 클릭(5~8초) 또는 좀 읽다 클릭(15~30초)
function humanDetailDelay(detailIndex) {
  const baseMean = 8000; // 8초 기준 지수분포
  let delay = exponentialRandom(baseMean);
  delay = Math.max(5000, Math.min(35000, delay)); // 5~35초 범위
  // 2번째, 3번째 상세는 점점 느려짐 (사람은 첫 번째를 가장 빨리 클릭)
  delay *= (1 + detailIndex * 0.15);
  delay *= getTimeOfDayMultiplier();
  return Math.round(addJitter(delay));
}

// ---- 에러 후 딜레이 (지수 백오프 기반) ----
function errorDelay(errorCode, retryCount) {
  if (errorCode === 'ACCESS_BLOCKED') {
    // 차단: 지수 분포, 평균 3분, 최소 2분, 최대 8분
    let delay = exponentialRandom(180000);
    delay = Math.max(120000, Math.min(480000, delay));
    // 재시도 횟수에 따라 지수 백오프
    delay *= Math.pow(1.5, retryCount);
    return Math.round(addJitter(delay));
  }
  if (errorCode === 'ALL_STRATEGIES_FAILED' || errorCode === 'FETCH_EXCEPTION' || errorCode === 'NETWORK_ERROR') {
    // 네트워크: 지수 백오프 10초 → 20초 → 40초
    const base = 10000 * Math.pow(2, retryCount);
    return Math.round(addJitter(Math.min(base, 120000)));
  }
  if (errorCode === 'EMPTY_RESULT' || errorCode === 'PARSE_EXCEPTION') {
    // 파싱: 15~30초 지수분포
    let delay = exponentialRandom(15000);
    return Math.round(addJitter(Math.max(10000, Math.min(40000, delay))));
  }
  if (errorCode === 'TAB_ERROR') {
    // 탭: 짧은 딜레이 5~15초
    let delay = exponentialRandom(8000);
    return Math.round(addJitter(Math.max(5000, Math.min(20000, delay))));
  }
  // 기타: 10~30초
  let delay = exponentialRandom(15000);
  return Math.round(addJitter(Math.max(8000, Math.min(40000, delay))));
}

function collectorSleep(ms) {
  return new Promise((resolve) => {
    collector._delayTimeoutId = setTimeout(resolve, ms);
  });
}

// v7.4: 수집기 상태 완전 초기화 (모든 내부 상태 포함)
function resetCollector() {
  if (collector._delayTimeoutId) { clearTimeout(collector._delayTimeoutId); collector._delayTimeoutId = null; }
  collector.running = false;
  collector.paused = false;
  collector._aborted = false;
  collector.status = 'IDLE';
  collector.current = null;
  collector.queue = [];
  collector._consecutiveErrors = 0;
  collector._collectedKeywords = [];
  collector._delayConfig = null;
  collector._burstIndex = 0;
  console.log('[SH-AC] 수집기 상태 리셋 완료');
}

// v7.4: 재귀 대신 setTimeout 기반 루프 (스택 안전)
function scheduleNextKeyword() {
  setTimeout(() => runNextKeyword(), 0);
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

// ---- 자동 수집 시작 (v7.2: 'Already running' 버그 수정) ----
async function startAutoCollect(options = {}) {
  // v7.4: 강화된 상태 체크 — 좀비 임계값을 키워드 수 기반 동적 계산
  if (collector.running && !collector.paused) {
    const elapsed = collector.startedAt ? (Date.now() - new Date(collector.startedAt).getTime()) : 0;
    // 키워드당 평균 40초(딜레이+수집+상세) × 큐 크기 × 1.5배 여유 + 최소 10분
    const estimatedMs = Math.max(10 * 60 * 1000, collector.totalQueued * 40000 * 1.5);
    if (elapsed > estimatedMs) {
      console.warn(`[SH-AC] ⚠️ 좀비 상태 감지 (${Math.round(elapsed/60000)}분 > 예상 ${Math.round(estimatedMs/60000)}분), 강제 리셋`);
      resetCollector();
    } else if (collector.current === null && collector.queue.length === 0) {
      // 큐가 비어있고 현재 작업도 없음 — 실질적으로 중단된 상태
      console.warn('[SH-AC] ⚠️ 빈 상태 감지, 리셋');
      resetCollector();
    } else {
      console.warn('[SH-AC] 이미 실행 중 — 현재 키워드:', collector.current?.keyword);
      return { ok: false, error: `이미 실행 중 (현재: ${collector.current?.keyword || '대기중'})` };
    }
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

  // v7.2: declarativeNetRequest 헤더 위조 적용 (셀러라이프 완전 반영)
  await HybridParser.setupCoupangHeaders().catch(() => {});

  const limit = Math.min(options.limit || 100, 500);
  const collectDetail = options.collectDetail !== false;
  const directKeywords = options.keywords || null;

  console.log(`[SH-AC] v7.2 다중전략 수집 시작 (limit=${limit}, direct=${directKeywords ? directKeywords.length : 'N/A'})`);

  // 큐 로드
  try {
    let keywords;
    let delayConfig = null; // 서버 제공 인간 행동 딜레이 설정
    if (directKeywords && directKeywords.length > 0) {
      keywords = directKeywords.map(kw => ({
        keyword: typeof kw === 'string' ? kw : kw.keyword,
        priority: 50,
        selectionReason: 'batch_manual',
      }));
      console.log(`[SH-AC] 직접 키워드 ${keywords.length}개 로드`);
    } else {
      // 서버 적응형 스케줄러: { keywords, delayConfig, totalActive, totalOverdue }
      const resp = await apiClient.getBatchKeywordSelection({ limit });
      const data = resp?.result?.data || {};
      keywords = data.keywords || data || []; // 하위 호환: 배열 직접 반환도 지원
      delayConfig = data.delayConfig || null;
      if (data.totalActive !== undefined) {
        console.log(`[SH-AC] 적응형 스케줄러: 전체 ${data.totalActive}개 중 수집 대상 ${data.totalOverdue}개`);
      }
    }
    if (Array.isArray(keywords) && !keywords.length) {
      console.log('[SH-AC] 수집할 키워드가 없습니다.');
      return { ok: false, error: '수집할 키워드가 없습니다 (watch_keywords 등록 필요 또는 아직 수집 시기 아님)' };
    }

    // 상태 완전 초기화 후 설정
    resetCollector();
    collector.queue = keywords.map(k => ({
      keyword: k.keyword,
      priority: k.priority || 50,
      selectionReason: k.selectionReason || '',
      volatilityScore: k.volatilityScore || 0,
      adaptiveIntervalHours: k.adaptiveIntervalHours || null,
      retryCount: 0,
    }));
    collector.collectDetail = collectDetail;
    collector.totalQueued = collector.queue.length;
    collector.running = true;
    collector.status = 'RUNNING';
    collector.successCount = 0;
    collector.failCount = 0;
    collector.skipCount = 0;
    collector._collectedKeywords = [];
    collector._isManual = options.isManual === true; // 명시적 수동 수집 플래그만 인정
    collector._delayConfig = delayConfig; // 서버 딜레이 설정 저장
    collector._burstIndex = 0;            // 버스트 카운터 초기화
    collector.lastError = null;
    collector.startedAt = new Date().toISOString();

    console.log(`[SH-AC] 큐 로드 완료: ${collector.queue.length}개 키워드` +
      (delayConfig ? ` (인간 딜레이: burst=${delayConfig.burstSize}, base=${delayConfig.baseDelayMs}ms)` : ''));
    collector.queue.forEach((k, i) => {
      const volTag = k.volatilityScore >= 80 ? '🔥' : k.volatilityScore >= 40 ? '📊' : '😴';
      const intervalTag = k.adaptiveIntervalHours ? `${k.adaptiveIntervalHours}h` : '-';
      console.log(`  [${i+1}] "${k.keyword}" (우선순위:${k.priority} ${volTag}변동성:${k.volatilityScore} 주기:${intervalTag} 사유:${k.selectionReason})`);
    });

    // ★ v7.3.1: 비동기 시작 — 즉시 반환 (message channel timeout 방지)
    // 워밍업 딜레이 후 시작 (서버 설정 or 기본 5초)
    const warmup = delayConfig?.warmupDelayMs || 5000;
    console.log(`[SH-AC] 워밍업 ${Math.round(warmup/1000)}초 후 수집 시작...`);
    setTimeout(() => runNextKeyword(), warmup);
    return { ok: true, queueLength: collector.queue.length };
  } catch (e) {
    console.error('[SH-AC] 큐 로드 실패:', e.message);
    resetCollector(); // 실패 시 상태 리셋
    return { ok: false, error: e.message };
  }
}

// ---- 수집 중단 (v7.2: 확실한 정리) ----
function stopAutoCollect() {
  console.log('[SH-AC] 수집 중단');
  resetCollector();
  collector.status = 'STOPPED';
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

// ---- 쿠팡 탭 확보 (v7.2.2: 더 안정적인 탭 확보 + 에러 복구) ----
async function ensureCoupangTab() {
  // 기존 탭 확인
  if (collector.currentTabId) {
    try {
      const tab = await chrome.tabs.get(collector.currentTabId);
      if (tab?.id && tab.url?.includes('coupang.com')) {
        console.log(`[SH-AC] 기존 쿠팡 탭 사용: ${tab.id}`);
        return tab.id;
      }
    } catch (_) {
      console.log('[SH-AC] 기존 탭 없음, 새로 찾기...');
      collector.currentTabId = null;
    }
  }

  // 열려있는 쿠팡 탭 찾기
  try {
    const tabs = await chrome.tabs.query({ url: 'https://www.coupang.com/*' });
    if (tabs.length > 0) {
      collector.currentTabId = tabs[0].id;
      console.log(`[SH-AC] 열린 쿠팡 탭 발견: ${tabs[0].id}`);
      return tabs[0].id;
    }
  } catch (e) {
    console.warn('[SH-AC] 탭 검색 실패:', e.message);
  }

  // 새 탭 생성 (비활성)
  console.log('[SH-AC] 새 쿠팡 탭 생성...');
  const tab = await chrome.tabs.create({
    url: 'https://www.coupang.com/',
    active: false,
  });
  collector.currentTabId = tab.id;
  // 초기 로드 대기 (5초)
  await new Promise(r => setTimeout(r, 5000));
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
//  ★★★ 핵심: 다음 키워드 실행 (v7.2 다중 전략) ★★★
//  셀러라이프 방식:
//  전략 1: Background fetch (k() 방식) — 가장 빠름
//  전략 2: DNR 규칙 적용 fetch (cData-v3 방식)
//  전략 3: 기존 탭 executeScript (cData-coupang 방식)
//  전략 4: Hidden Tab + 폴링 (cDataTab2 방식) — 가장 확실
// ============================================================
async function runNextKeyword() {
  if (!collector.running || collector.paused || collector._aborted) return;

  // v7.2: 연속 에러 5회 이상이면 30분 대기
  if (collector._consecutiveErrors >= 5) {
    console.warn(`[SH-AC] ⚠️ 연속 ${collector._consecutiveErrors}회 실패, 30분 대기 후 재시도`);
    collector.status = 'WAITING_NEXT';
    collector._consecutiveErrors = 0;
    await collectorSleep(30 * 60 * 1000);
    if (!collector.running || collector._aborted) return;
  }

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

    // v7.2.5: 수집 완료 → 서버 자동 통계 처리 (autoCollectComplete)
    try {
      const completeResult = await apiClient.autoCollectComplete({
        successCount: collector.successCount,
        failCount: collector.failCount,
        skipCount: collector.skipCount,
        keywords: collector._collectedKeywords || [],
        isManual: collector._isManual || false,
      });
      console.log(`[SH-AC] 🔄 서버 자동 통계 처리 완료: stats=${completeResult?.result?.data?.statsComputed || 0}, batch=${completeResult?.result?.data?.batchUpdated || 0}`);
      
      chrome.notifications.create(`auto-stats-done-${Date.now()}`, {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: '✅ 서버 통계 자동 갱신 완료',
        message: `${completeResult?.result?.data?.statsComputed || 0}개 키워드 통계 자동 처리됨`,
        priority: 0,
      });
    } catch (e) {
      console.warn('[SH-AC] autoCollectComplete 실패, fallback to runDailyBatchCollection:', e.message);
      try { await apiClient.runDailyBatchCollection(); } catch (_) {}
    }
    return;
  }

  collector.current = { keyword: next.keyword, retryCount: next.retryCount || 0, startedAt: Date.now() };
  const keyword = next.keyword;
  const progress = collector.successCount + collector.failCount + collector.skipCount + 1;

  console.log(`[SH-AC] 🔍 [${progress}/${collector.totalQueued}] 키워드 수집: "${keyword}" (재시도: ${next.retryCount || 0})`);

  try {
    // ★ v7.2.2: 다중 전략 HTML 수집 (에러 진단 강화)
    collector.status = 'PARSING';
    let tabId = null;
    try {
      tabId = await ensureCoupangTab();
      console.log(`[SH-AC] 쿠팡 탭 확보: ${tabId}`);
    } catch (tabErr) {
      console.warn(`[SH-AC] ⚠️ 쿠팡 탭 확보 실패: ${tabErr.message}`);
      // 탭 없이도 direct_fetch / dnr_fetch / hidden_tab 전략 가능
    }

    let collectResult;
    try {
      collectResult = await HybridParser.collectSearchHTML(keyword, {
        tabId,
        page: 1,
        listSize: 36,
      });
    } catch (fetchErr) {
      console.error(`[SH-AC] ❌ "${keyword}" collectSearchHTML 예외:`, fetchErr.message, fetchErr.stack);
      await handleCollectFail(keyword, next.retryCount, 'FETCH_EXCEPTION', `수집 예외: ${fetchErr.message}`);
      return;
    }

    const html = collectResult?.html || '';
    const strategy = collectResult?.strategy || 'NONE';
    // ★ v7.2.9: tab 전략에서 탭 내 파싱된 결과가 있으면 직접 사용
    const tabParsedResult = collectResult?.parsedResult || null;

    if (!html || html.length < 500) {
      console.warn(`[SH-AC] ❌ "${keyword}" HTML 수집 실패 (모든 전략, ${html.length}바이트)`);
      await handleCollectFail(keyword, next.retryCount, 'ALL_STRATEGIES_FAILED', `모든 수집 전략 실패 (HTML ${html.length}바이트)`);
      return;
    }

    // 차단 확인
    if (/봇|robot|captcha|차단|접근.*불가|Access Denied|Please verify/i.test(html) && html.length < 5000) {
      console.warn(`[SH-AC] ⛔ "${keyword}" 접근 차단 감지 (전략: ${strategy})`);
      await handleCollectFail(keyword, next.retryCount, 'ACCESS_BLOCKED', `쿠팡 접근 차단 (${strategy})`);
      return;
    }

    // ★ v7.2.9: 탭 내 파싱 결과가 있으면 그대로 사용 (DOMParser 활용된 정확한 결과)
    let result;
    if (tabParsedResult && tabParsedResult.items && tabParsedResult.items.length > 0) {
      result = tabParsedResult;
      console.log(`[SH-AC] 🎯 탭 내 파싱 결과 사용: ${result.items.length}개 (${strategy}/${result.domVersion || 'TAB_DOM'})`);
    } else {
      // 폴백: background에서 파싱 (SSR/Regex)
      try {
        result = HybridParser.parseSearchHTML(html, keyword);
      } catch (parseErr) {
        console.error(`[SH-AC] ❌ "${keyword}" parseSearchHTML 예외:`, parseErr.message, parseErr.stack);
        await handleCollectFail(keyword, next.retryCount, 'PARSE_EXCEPTION', `파싱 예외: ${parseErr.message}`);
        return;
      }
    }

    if (!result.items.length) {
      console.warn(`[SH-AC] ❌ "${keyword}" 파싱 결과 0개 (전략: ${strategy}, DOM: ${result.domVersion})`);
      await handleCollectFail(keyword, next.retryCount, 'EMPTY_RESULT', `파싱된 상품 0개 (${strategy}/${result.domVersion})`);
      return;
    }

    // 성공 처리
    console.log(`[SH-AC] ✅ "${keyword}" 수집 성공: ${result.items.length}개 (${strategy}/${result.domVersion}) | 가격${result.stats.priceRate}% 평점${result.stats.ratingRate}% 리뷰${result.stats.reviewRate}%`);

    collector.successCount++;
    if (!collector._collectedKeywords) collector._collectedKeywords = [];
    collector._collectedKeywords.push(keyword);
    collector.current = null;
    collector._consecutiveErrors = 0; // 연속 에러 리셋

    const searchUrl = `https://www.coupang.com/np/search?q=${encodeURIComponent(keyword)}&page=1`;

    // 서버에 검색 이벤트 저장
    try {
      const saveResp = await apiClient.saveSearchEvent({
        keyword,
        source: `auto_collect_v72_${strategy}`,
        pageUrl: searchUrl,
        totalItems: result.items.length,
        items: result.items.slice(0, 36),
        avgPrice: result.stats.avgPrice,
        avgRating: result.stats.avgRating,
        avgReview: result.stats.avgReview,
        totalReviewSum: Math.min(result.stats.totalReviewSum, 2147483647), // INT overflow 방지
        adCount: result.stats.adCount,
        rocketCount: result.stats.rocketCount,
        highReviewCount: result.stats.highReviewCount,
        priceParseRate: result.stats.priceRate,
        ratingParseRate: result.stats.ratingRate,
        reviewParseRate: result.stats.reviewRate,
      });
      console.log(`[SH-AC] 💾 서버 저장 완료: "${keyword}" (eventId: ${saveResp?.result?.data?.eventId || 'N/A'})`);
    } catch (saveErr) {
      console.error(`[SH-AC] ❌ 서버 저장 실패: "${keyword}"`, saveErr.message || saveErr);
    }

    try { await apiClient.markKeywordCollected({ keyword }); } catch (e) { console.warn('[SH-AC] markKeywordCollected 실패:', e.message); }

    // 상세 페이지 상위 3개 보강 (v7.4: humanDetailDelay로 자연스러운 패턴)
    if (collector.collectDetail && result.items.length) {
      const topItems = result.items.filter(i => i.productId && !i.isAd).slice(0, 3);
      if (topItems.length > 0) {
        console.log(`[SH-AC] 📋 상위 ${topItems.length}개 상세 수집...`);
        collector.status = 'COLLECTING_DETAIL';
        for (let di = 0; di < topItems.length; di++) {
          if (!collector.running || collector._aborted) break;
          try {
            await collectDetailForItem(topItems[di], keyword);
            const detDelay = humanDetailDelay(di);
            console.log(`[SH-AC] 📄 상세 ${di+1}/${topItems.length} 완료, ${Math.round(detDelay/1000)}초 대기`);
            await collectorSleep(detDelay);
          } catch (e) {
            console.warn(`[SH-AC] 상세 수집 실패: ${topItems[di].productId}`, e.message);
          }
        }
      }
    }

    // 다음 키워드 — 인간 행동 딜레이 (서버 delayConfig 기반)
    if (!collector.running || collector._aborted) return;
    collector._burstIndex = (collector._burstIndex || 0) + 1;
    const delay = humanDelay(collector._delayConfig, collector._burstIndex);
    const burstSize = collector._delayConfig?.burstSize || 5;
    const isBurst = burstSize > 0 && collector._burstIndex % burstSize === 0;
    console.log(`[SH-AC] ⏳ 다음 키워드까지 ${Math.round(delay/1000)}초 대기${isBurst ? ' (버스트 휴식 🛋️)' : ''} [피로도:×${getSessionFatigueMultiplier(collector._burstIndex).toFixed(2)} 시간대:×${getTimeOfDayMultiplier().toFixed(2)}]`);
    collector.status = 'WAITING_NEXT';
    await collectorSleep(delay);

    // v7.4: 재귀 대신 루프 (스택 안전)
    scheduleNextKeyword();

  } catch (e) {
    // v7.2.2: 더 상세한 에러 진단
    const errorCode = e.name === 'TypeError' ? 'NETWORK_ERROR'
      : e.name === 'AbortError' ? 'TIMEOUT'
      : e.message?.includes('tab') ? 'TAB_ERROR'
      : e.message?.includes('permission') ? 'PERMISSION_ERROR'
      : 'RUNTIME_ERROR';
    console.error(`[SH-AC] "${keyword}" 수집 중 오류 [${errorCode}]:`, e.message, e.stack);
    await handleCollectFail(keyword, next.retryCount, errorCode, e.message || '알 수 없는 오류');
  }
}

// ---- 수집 실패 처리 (v7.4: 큐 분산 + 지수 백오프 + 에러별 딜레이) ----
async function handleCollectFail(keyword, retryCount, errorCode, errorMessage) {
  console.warn(`[SH-AC] ❌ "${keyword}" 실패 [${retryCount}/3]: ${errorCode} — ${errorMessage}`);
  collector.lastError = `${keyword}: ${errorCode}`;
  collector._consecutiveErrors++;

  const maxRetry = 3;
  if (retryCount < maxRetry) {
    // v7.4: 큐 중간에 분산 삽입 (같은 URL 연속 요청 방지)
    // 다른 키워드 2~5개를 먼저 처리한 후 재시도하도록 배치
    const retryItem = { keyword, priority: 0, retryCount: retryCount + 1, selectionReason: 'retry' };
    const insertAt = Math.min(
      2 + Math.floor(Math.random() * 4), // 2~5번째 위치
      collector.queue.length               // 큐가 짧으면 끝에
    );
    collector.queue.splice(insertAt, 0, retryItem);
    console.log(`[SH-AC] 🔄 "${keyword}" 재시도 큐 ${insertAt}번째 삽입 (${retryCount + 1}/${maxRetry}) — 분산 배치`);
  } else {
    collector.failCount++;
    try { await apiClient.markKeywordFailed({ keyword, errorCode, errorMessage }); } catch (_) {}
  }

  collector.current = null;

  if (!collector.running || collector._aborted) return;

  // v7.4: 에러 유형별 지수 백오프 딜레이
  const delay = errorDelay(errorCode, retryCount);
  const emoji = errorCode === 'ACCESS_BLOCKED' ? '⛔' :
    errorCode.includes('NETWORK') || errorCode.includes('FETCH') || errorCode.includes('STRATEGIES') ? '🌐' :
    errorCode.includes('PARSE') || errorCode.includes('EMPTY') ? '📄' :
    errorCode.includes('TAB') ? '🔧' : '⚠️';
  console.log(`[SH-AC] ${emoji} ${errorCode} — ${Math.round(delay/1000)}초 대기 (retry=${retryCount})`);

  // ACCESS_BLOCKED: 탭 재생성 (차단된 세션 갱신)
  if (errorCode === 'ACCESS_BLOCKED' && collector.currentTabId) {
    try { chrome.tabs.remove(collector.currentTabId); } catch (_) {}
    collector.currentTabId = null;
  }
  // TAB_ERROR: 탭 ID 리셋
  if (errorCode === 'TAB_ERROR') {
    collector.currentTabId = null;
  }

  collector.status = 'WAITING_NEXT';
  await collectorSleep(delay);

  // v7.4: 재귀 대신 루프로 전환 (scheduleNextKeyword)
  scheduleNextKeyword();
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

  // DOM 안정화 대기 (3~6초 + 지터)
  await collectorSleep(addJitter(3000 + Math.floor(Math.random() * 3000)));

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

// ============================================================
//  v8.0: AI 제품 발견 크롤링 파이프라인
//  서버 pending jobs 폴링 → 검색 크롤링 → 서버 필터링 → 상세 크롤링 → AI 분석
// ============================================================
const discoveryState = {
  running: false,
  status: 'IDLE', // IDLE|POLLING|CRAWLING_SEARCH|SUBMITTING_SEARCH|CRAWLING_DETAIL|SUBMITTING_DETAIL|DONE|ERROR
  currentJob: null,
  progress: '',
  error: null,
};

async function startDiscoveryCrawl() {
  if (discoveryState.running) {
    return { ok: false, error: '이미 발견 크롤링 실행 중' };
  }

  const { serverLoggedIn } = await chrome.storage.local.get('serverLoggedIn');
  if (!serverLoggedIn) {
    return { ok: false, error: '서버 로그인 필요' };
  }

  discoveryState.running = true;
  discoveryState.status = 'POLLING';
  discoveryState.error = null;
  discoveryState.progress = '서버에서 대기 작업 확인 중...';

  // 비동기 실행
  runDiscoveryPipeline().catch(err => {
    console.error('[Discovery] 파이프라인 에러:', err);
    discoveryState.status = 'ERROR';
    discoveryState.error = err.message;
    discoveryState.running = false;
  });

  return { ok: true, message: '발견 크롤링 시작됨' };
}

async function runDiscoveryPipeline() {
  try {
    // 1. 서버에서 pending 작업 가져오기
    const resp = await apiClient.discoveryGetPendingJobs();
    const jobs = resp?.result?.data || [];

    if (!jobs.length) {
      discoveryState.status = 'IDLE';
      discoveryState.running = false;
      discoveryState.progress = '대기 중인 작업 없음';
      return;
    }

    // DNR 헤더 셋업
    await HybridParser.setupCoupangHeaders().catch(() => {});

    for (const job of jobs) {
      if (!discoveryState.running) break;
      await processDiscoveryJob(job);
    }

    discoveryState.status = 'DONE';
    discoveryState.running = false;
    discoveryState.progress = `${jobs.length}개 작업 처리 완료`;

    chrome.notifications.create(`discovery-done-${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: '🔍 AI 제품 발견 완료',
      message: `${jobs.length}개 키워드 분석이 완료되었습니다. 결과를 확인하세요!`,
      priority: 2,
    });

  } catch (err) {
    discoveryState.status = 'ERROR';
    discoveryState.error = err.message;
    discoveryState.running = false;
    throw err;
  }
}

async function processDiscoveryJob(job) {
  const { id: jobId, keyword, maxPages, filteredProductIds, status } = job;
  discoveryState.currentJob = { jobId, keyword };

  try {
    // 이미 필터링 완료된 작업 = 상세 크롤링만 필요
    if (status === 'filtering' && filteredProductIds?.length) {
      await crawlDetailPages(jobId, keyword, filteredProductIds);
      return;
    }

    // === Phase 1: 검색 결과 크롤링 ===
    discoveryState.status = 'CRAWLING_SEARCH';
    discoveryState.progress = `"${keyword}" 검색 크롤링 중...`;

    await apiClient.discoveryUpdateJobStatus({ jobId, status: 'crawling_search' });

    // 쿠팡 탭 확보
    let tabId = null;
    try { tabId = await ensureCoupangTab(); } catch (_) {}

    const allItems = [];
    const pages = maxPages || 2;

    for (let page = 1; page <= pages; page++) {
      discoveryState.progress = `"${keyword}" 검색 페이지 ${page}/${pages} 크롤링 중...`;

      let collectResult;
      try {
        collectResult = await HybridParser.collectSearchHTML(keyword, {
          tabId,
          page,
          listSize: 36,
        });
      } catch (err) {
        console.warn(`[Discovery] 페이지 ${page} 수집 실패:`, err.message);
        continue;
      }

      const html = collectResult?.html || '';
      if (!html || html.length < 500) continue;

      // 차단 체크
      if (/봇|robot|captcha|차단/i.test(html) && html.length < 5000) {
        console.warn(`[Discovery] "${keyword}" 페이지 ${page} 차단`);
        break;
      }

      let result;
      if (collectResult?.parsedResult?.items?.length) {
        result = collectResult.parsedResult;
      } else {
        result = HybridParser.parseSearchHTML(html, keyword);
      }

      if (result?.items?.length) {
        // 랭크 정보 추가
        const startRank = (page - 1) * 36;
        result.items.forEach((item, idx) => {
          item.rank = startRank + idx + 1;
          item.page = page;
        });
        allItems.push(...result.items);
      }

      // 페이지 사이 딜레이
      if (page < pages) {
        await new Promise(r => setTimeout(r, 3000 + Math.random() * 3000));
      }
    }

    if (allItems.length === 0) {
      await apiClient.discoveryUpdateJobStatus({
        jobId,
        status: 'failed',
        errorMessage: '검색 결과를 수집할 수 없습니다',
      });
      return;
    }

    // === Phase 2: 서버에 검색 결과 전송 + 1차 필터링 ===
    discoveryState.status = 'SUBMITTING_SEARCH';
    discoveryState.progress = `"${keyword}" 검색 결과 ${allItems.length}개 서버 전송 중...`;

    const nonAd = allItems.filter(i => !i.isAd);
    const summary = {
      totalItems: allItems.length,
      avgPrice: Math.round(nonAd.reduce((s, i) => s + (i.price || 0), 0) / (nonAd.length || 1)),
      avgRating: +(nonAd.reduce((s, i) => s + (i.rating || 0), 0) / (nonAd.length || 1)).toFixed(1),
      avgReview: Math.round(nonAd.reduce((s, i) => s + (i.reviewCount || 0), 0) / (nonAd.length || 1)),
      highReviewRatio: Math.round(nonAd.filter(i => (i.reviewCount || 0) >= 100).length / (nonAd.length || 1) * 100),
      adCount: allItems.filter(i => i.isAd).length,
      rocketCount: allItems.filter(i => i.isRocket).length,
      competitionScore: 0,
      competitionLevel: 'medium',
    };

    // 경쟁도 계산
    const avgReview = summary.avgReview;
    if (avgReview > 500 || summary.highReviewRatio > 50) {
      summary.competitionScore = 80;
      summary.competitionLevel = 'hard';
    } else if (avgReview > 100 || summary.highReviewRatio > 20) {
      summary.competitionScore = 50;
      summary.competitionLevel = 'medium';
    } else {
      summary.competitionScore = 20;
      summary.competitionLevel = 'easy';
    }

    const filterResp = await apiClient.discoverySubmitSearchResults({
      jobId,
      items: allItems.slice(0, 100), // 최대 100개
      summary,
    });

    const filteredProducts = filterResp?.result?.data?.filteredProducts || [];

    if (!filteredProducts.length) {
      console.warn(`[Discovery] "${keyword}" 필터링 결과 0개`);
      return;
    }

    // === Phase 3: 상세 페이지 크롤링 ===
    await crawlDetailPages(jobId, keyword, filteredProducts);

  } catch (err) {
    console.error(`[Discovery] 작업 ${jobId} 실패:`, err);
    try {
      await apiClient.discoveryUpdateJobStatus({
        jobId,
        status: 'failed',
        errorMessage: err.message,
      });
    } catch (_) {}
  }
}

async function crawlDetailPages(jobId, keyword, filteredProducts) {
  discoveryState.status = 'CRAWLING_DETAIL';

  // 쿠팡 탭 확보
  let tabId;
  try { tabId = await ensureCoupangTab(); } catch (_) {}
  if (!tabId) {
    // 새 탭 생성
    try {
      const tab = await chrome.tabs.create({
        url: 'https://www.coupang.com',
        active: false,
      });
      tabId = tab.id;
      await new Promise(r => setTimeout(r, 3000));
    } catch (e) {
      await apiClient.discoveryUpdateJobStatus({
        jobId, status: 'failed', errorMessage: '쿠팡 탭 생성 실패',
      });
      return;
    }
  }

  await apiClient.discoveryUpdateJobStatus({ jobId, status: 'crawling_detail' });

  const detailResults = [];

  for (let i = 0; i < filteredProducts.length; i++) {
    if (!discoveryState.running) break;
    const product = filteredProducts[i];
    const productId = product.productId || product.coupangProductId;
    const detailUrl = product.url || `https://www.coupang.com/vp/products/${productId}`;

    discoveryState.progress = `"${keyword}" 상세 ${i + 1}/${filteredProducts.length} 크롤링 중 (${(product.title || '').substring(0, 25)}...)`;

    try {
      // 탭에서 상세 페이지 로드
      await chrome.tabs.update(tabId, { url: detailUrl });

      // 로드 완료 대기
      await new Promise((resolve) => {
        const listener = (tid, changeInfo) => {
          if (tid === tabId && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 20000);
      });

      // DOM 안정화 대기
      await new Promise(r => setTimeout(r, 3000 + Math.random() * 3000));

      // content-detail.js에 파싱 요청
      const requestId = `discovery-${jobId}-${productId}-${Date.now()}`;
      const detail = await new Promise((resolve) => {
        const handler = (msg) => {
          if (msg.type === 'DETAIL_PARSE_SUCCESS' && msg.requestId === requestId) {
            chrome.runtime.onMessage.removeListener(handler);
            resolve(msg.result || null);
          } else if (msg.type === 'DETAIL_PARSE_FAILED' && msg.requestId === requestId) {
            chrome.runtime.onMessage.removeListener(handler);
            resolve(null);
          }
        };
        chrome.runtime.onMessage.addListener(handler);
        setTimeout(() => { chrome.runtime.onMessage.removeListener(handler); resolve(null); }, 25000);

        chrome.tabs.sendMessage(tabId, {
          type: 'START_PARSE_DETAIL',
          requestId,
          productId: String(productId),
          keyword,
          isAutoCollect: true,
        }).catch(() => resolve(null));
      });

      if (detail) {
        detailResults.push({
          ...detail,
          productId: String(productId),
          searchRank: product.rank || 0,
          filterScore: product.filterScore || 0,
        });
        console.log(`[Discovery] ✅ 상세 ${i + 1}/${filteredProducts.length}: ${productId} (confidence: ${detail.confidence || 0})`);
      } else {
        console.warn(`[Discovery] ❌ 상세 ${i + 1}/${filteredProducts.length}: ${productId} 파싱 실패`);
      }

    } catch (err) {
      console.warn(`[Discovery] 상세 크롤링 오류 ${productId}:`, err.message);
    }

    // 상품 사이 딜레이 (인간 행동 시뮬레이션)
    if (i < filteredProducts.length - 1) {
      await new Promise(r => setTimeout(r, 4000 + Math.random() * 4000));
    }
  }

  // === Phase 4: 상세 결과 서버 전송 → AI 분석 트리거 ===
  discoveryState.status = 'SUBMITTING_DETAIL';
  discoveryState.progress = `"${keyword}" 상세 데이터 ${detailResults.length}개 서버 전송 → AI 분석 시작`;

  await apiClient.discoverySubmitDetailResults({
    jobId,
    details: detailResults,
  });

  discoveryState.progress = `"${keyword}" AI 분석 진행 중... (서버에서 처리)`;
  console.log(`[Discovery] ✅ "${keyword}" 상세 ${detailResults.length}개 전송 완료, AI 분석 시작`);
}
