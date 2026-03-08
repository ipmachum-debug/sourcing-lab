/* ============================================================
   Coupang Sourcing Helper — Background Service Worker v4.5
   세션 스토리지 관리 + 검색 히스토리 + 순위 추적 + 상세 파싱 + 서버 동기화
   + 순위 변동 알림 + 자동 순위 체크 + WING 인기상품 데이터 수집
   + 소싱 코치 (점수/마진/리스크/뱃지)
   + AI 소싱 분석 (WING 인기상품 OpenAI 연동)
   ============================================================ */

importScripts('api-client.js');

// ---- 설치/초기화 ----
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  // 순위 추적 알람 (매 6시간마다)
  chrome.alarms.create('rankTracking', { periodInMinutes: 360 });
});

// ---- 탭 URL 변경 감지 (SPA Navigation 대응) ----
// 쿠팡이 SPA로 동작할 때 URL만 바뀌고 content script가 다시 로드되지 않는 문제 해결
// tabs.onUpdated로 URL 변경 시 content.js를 프로그래밍 방식으로 재주입
const injectedTabs = new Set();

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // URL이 변경되었고, 쿠팡 검색 페이지인 경우
  if (changeInfo.url && changeInfo.url.includes('coupang.com/np/search')) {
    try {
      // content script가 이미 주입되어 있으면 visibilitychange 이벤트로 재파싱 트리거
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          // content.js의 URL 변경 감지를 트리거
          document.dispatchEvent(new Event('visibilitychange'));
        }
      });
    } catch (e) {
      // content script가 아직 없으면 주입 시도
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js']
        });
      } catch (e2) { /* 무시 */ }
    }
  }
});

// 탭이 닫히면 세션 데이터 정리
chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
  chrome.storage.session.remove([`results:${tabId}`]).catch(() => {});
});

// ---- 알람 핸들러 (순위 추적 자동 수집) ----
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'rankTracking') {
    await autoTrackRankings();
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

    // ===== 후보 관리 =====
    case 'SAVE_CANDIDATE': {
      saveCandidateItem(message.item).then((result) => {
        sendResponse({ ok: true, ...result });
      });
      return true;
    }

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

    // ===== AI 소싱 코치 v4.5 (WING 인기상품 AI 분석) =====
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
