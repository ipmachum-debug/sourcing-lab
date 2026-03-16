/* ============================================================
   Coupang Sourcing Helper — Side Panel Main Entry
   탭 전환, 메시지 라우팅, 초기화
   ============================================================
   Script load order (sidepanel.html):
     1. sidepanel-utils.js    — State, DOM refs, utils, sourcing coach, smart keywords, popup
     2. sidepanel-analysis.js — Analysis tab (competition, items, filters)
     3. sidepanel-wing.js     — WING tab + AI analysis
     4. sidepanel-tabs.js     — History, margin calculator, server tab
     5. sidepanel-demand.js   — Demand tab (auto/manual collection)
     6. sidepanel.js          — THIS FILE: tab switching, message routing, init
   ============================================================ */

// ---- 탭 활성화 감지: 사용자가 탭을 전환하면 자동으로 최신 데이터 가져오기 ----
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (activeInfo.tabId !== lastActiveTabId) {
    lastActiveTabId = activeInfo.tabId;
    await refreshFromCurrentTab();
  }
});

// v5.3.1: 탭 URL 변경 시 — executeScript 제거, 데이터 갱신만
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active && changeInfo.url.includes('coupang.com/np/search')) {
    // content.js가 자체적으로 URL 변경 감지하므로 여기서는 대기 후 데이터만 가져옴
    setTimeout(async () => {
      const response = await getResults(tabId);
      if (response?.data) {
        renderAnalysis(response.data);
      }
    }, 2000);
  }
});

// ---- Tab 관리 ----
$$('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    $$('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    $(`#tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'history') loadHistory();
    if (btn.dataset.tab === 'wing') loadWingTab();
    if (btn.dataset.tab === 'demand') loadDemandTab();
  });
});

// ============================================================
//  데이터 로드 & 실시간 업데이트
// ============================================================

async function refreshFromCurrentTab() {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  lastActiveTabId = tab.id;

  // v5.3.1: executeScript 제거 — content.js가 자체적으로 파싱하고 메시지 보냄
  // 여기서는 저장된 데이터만 가져옴
  const response = await getResults(tab.id);
  const data = response?.data || null;
  renderAnalysis(data);
}

chrome.runtime.onMessage.addListener(async (message) => {
  if (message?.type === 'RESULTS_UPDATED') {
    const tab = await getActiveTab();
    if (tab?.id === message.tabId) {
      const response = await getResults(tab.id);
      const data = response?.data || null;

      // URL과 데이터 query 일치 검증 후 렌더링
      if (data && tab.url?.includes('coupang.com/np/search')) {
        const urlQuery = extractQueryFromUrl(tab.url);
        // URL의 query와 data query가 다르면 이전 데이터일 수 있음 — 무시하고 재시도 대기
        if (urlQuery && data.query && urlQuery !== data.query) {
          return; // 다음 RESULTS_UPDATED를 기다림
        }
      }

      renderAnalysis(data);
    }
  }
  if (message?.type === 'WING_DATA_UPDATED') {
    // WING 탭이 활성 상태면 자동 갱신
    if ($('#tab-wing').classList.contains('active')) {
      loadWingTab();
    }
  }
});

// 초기 로드
refreshFromCurrentTab();
checkServerAuth();

// 버전 표시 (manifest.json에서 동적 로드)
try {
  const ver = chrome.runtime.getManifest().version;
  const el = document.querySelector('#extVersion');
  if (el) el.textContent = 'v' + ver;
} catch (_) {}
