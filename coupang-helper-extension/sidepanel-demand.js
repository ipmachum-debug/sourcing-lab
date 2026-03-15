/* Coupang Sourcing Helper — Demand Tab (Auto/Manual Collection) */

// ============================================================
//  검색수요 탭 (v6.3) — 하이브리드 데이터 수집 대시보드
// ============================================================

let demandKeywords = [];
let selectedKeywordIds = new Set();
let batchRunning = false;

// 유틸: 메시지 전송 래퍼
function sendMsg(msg, retries) {
  if (typeof retries === 'undefined') retries = 2;
  return new Promise(function(resolve) {
    try {
      chrome.runtime.sendMessage(msg, function(resp) {
        if (chrome.runtime.lastError) {
          console.warn('[sendMsg] runtime.lastError:', chrome.runtime.lastError.message, 'type:', msg.type);
          if (retries > 0) {
            console.log('[sendMsg] 재시도 (' + retries + '회 남음)...');
            setTimeout(function() {
              sendMsg(msg, retries - 1).then(resolve);
            }, 500);
          } else {
            resolve({ ok: false, error: 'Service Worker 응답 없음: ' + chrome.runtime.lastError.message });
          }
          return;
        }
        resolve(resp || { ok: false, error: '응답 없음' });
      });
    } catch (e) {
      console.error('[sendMsg] 예외:', e.message);
      resolve({ ok: false, error: e.message });
    }
  });
}
function formatDemandPrice(v) {
  if (!v || v === 0) return '-';
  return Number(v).toLocaleString() + '원';
}
function timeAgo(dateStr) {
  if (!dateStr) return '-';
  const now = new Date();
  const d = new Date(dateStr);
  const diff = now - d;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins + '분 전';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + '시간 전';
  const days = Math.floor(hours / 24);
  return days + '일 전';
}
function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

async function loadDemandTab() {
  const { serverLoggedIn } = await chrome.storage.local.get('serverLoggedIn');
  if (!serverLoggedIn) {
    document.querySelector('#demandEmpty').textContent = '서버 로그인이 필요합니다. 서버 탭에서 먼저 로그인하세요.';
    document.querySelector('#demandEmpty').style.display = '';
    return;
  }
  const { batchEnabled } = await chrome.storage.local.get('batchEnabled');
  document.querySelector('#batchToggle').checked = !!batchEnabled;
  updateBatchToggleUI(!!batchEnabled);

  const { lastDailyBatchRun } = await chrome.storage.local.get('lastDailyBatchRun');
  if (lastDailyBatchRun) {
    document.querySelector('#demandLastRun').style.display = '';
    document.querySelector('#demandLastRunTime').textContent = new Date(lastDailyBatchRun).toLocaleString('ko-KR');
  }
  loadDemandDashboard();
  loadDemandKeywords();
}

async function loadDemandDashboard() {
  try {
    const resp = await sendMsg({ type: 'HYBRID_DASHBOARD' });
    if (!resp || !resp.ok || !resp.data) return;
    const d = resp.data;
    document.querySelector('#demandStatsGrid').style.display = 'grid';
    document.querySelector('#demandStatKeywords').textContent = (d.watchKeywords && d.watchKeywords.total) || 0;
    document.querySelector('#demandStatEvents').textContent = (d.searchEvents && d.searchEvents.totalLast7d) || 0;
    document.querySelector('#demandStatQuality').textContent = ((d.parseQuality && d.parseQuality.avgPriceRate) || 0) + '%';
    document.querySelector('#demandStatGrowth').textContent = (d.watchKeywords && d.watchKeywords.withGrowth) || 0;
    const badge = document.querySelector('#autoCollectStatusBadge');
    if (d.watchKeywords && d.watchKeywords.total > 0) {
      badge.textContent = d.watchKeywords.active + '개 활성';
      badge.className = 'competition-badge level-easy';
    }
  } catch (e) { console.error('[Demand] dashboard:', e); }

  // v8.4.6: 미수집 키워드 건수 뱃지 업데이트
  try {
    var ucResp = await sendMsg({ type: 'HYBRID_GET_UNCOLLECTED_KEYWORDS' });
    var ucBadge = document.querySelector('#uncollectedBadge');
    if (ucResp && ucResp.ok && ucResp.data) {
      var ucCount = ucResp.data.uncollectedCount || 0;
      if (ucBadge) {
        ucBadge.textContent = ucCount;
        ucBadge.style.display = ucCount > 0 ? 'inline' : 'none';
      }
    }
  } catch (e) { console.error('[Demand] uncollected badge:', e); }

  // v8.5.1: 오늘의 배치 요약 표시
  updateTodayBatchSummary();
  // v8.5.1: 실시간 수집 상태 체크
  updateLiveBatchStatus();
}

// v8.5.1: 오늘의 배치 요약 (5배치/일 제한 표시)
async function updateTodayBatchSummary() {
  try {
    var stored = await chrome.storage.local.get(['todayBatchRuns', 'todayValidCount', 'todayBatchDate']);
    var today = new Date().toISOString().slice(0, 10);
    var runs = 0;
    var validCount = 0;
    if (stored.todayBatchDate === today) {
      runs = stored.todayBatchRuns || 0;
      validCount = stored.todayValidCount || 0;
    }
    var summaryEl = document.querySelector('#todayBatchSummary');
    if (summaryEl) {
      summaryEl.style.display = '';
      document.querySelector('#todayBatchCount').textContent = runs;
      document.querySelector('#todayValidKeywords').textContent = validCount;
      // 5배치 제한 시 경고 색상
      if (runs >= 5) {
        document.querySelector('#todayBatchCount').style.color = '#dc2626';
      } else {
        document.querySelector('#todayBatchCount').style.color = '#475569';
      }
    }
  } catch (e) { console.error('[Demand] todayBatch:', e); }
}

// v8.5.1: 실시간 배치 상태 업데이트
var liveBatchPollingId = null;
async function updateLiveBatchStatus() {
  try {
    var resp = await sendMsg({ type: 'GET_COLLECTOR_STATE' });
    if (!resp || !resp.ok || !resp.data) return;
    var state = resp.data;
    var livePanel = document.querySelector('#liveBatchStatusPanel');
    if (!livePanel) return;

    if (state.running || state.paused) {
      livePanel.style.display = '';
      var done = (state.successCount || 0) + (state.failCount || 0) + (state.skipCount || 0);
      var total = state.totalQueued || 0;
      var pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

      // 배치 번호 계산
      var stored = await chrome.storage.local.get(['todayBatchRuns', 'todayBatchDate']);
      var today = new Date().toISOString().slice(0, 10);
      var batchNum = (stored.todayBatchDate === today ? (stored.todayBatchRuns || 0) : 0) + 1;
      document.querySelector('#liveBatchRunCount').textContent = batchNum + '배치';

      document.querySelector('#liveBatchCurrent').textContent = done + '/' + total;
      document.querySelector('#liveBatchTotal').textContent = total + '개';
      document.querySelector('#liveBatchSuccess').textContent = state.successCount || 0;
      document.querySelector('#liveBatchFail').textContent = state.failCount || 0;
      document.querySelector('#liveBatchProgressFill').style.width = pct + '%';
      document.querySelector('#liveBatchProgressText').textContent = done + '/' + total + ' (' + pct + '%)';

      var kwEl = document.querySelector('#liveBatchCurrentKw');
      if (kwEl) {
        if (state.currentKeyword) {
          kwEl.textContent = '\u25b6 \"' + state.currentKeyword + '\" 수집 중...';
        } else if (state.status === 'WAITING_NEXT') {
          kwEl.textContent = '\u23f3 다음 키워드 대기중... (' + state.queueLength + '개 남음)';
        } else {
          kwEl.textContent = '';
        }
      }

      // 배지 업데이트
      var badge = document.querySelector('#autoCollectStatusBadge');
      if (badge && state.running) {
        badge.textContent = '수집중 ' + done + '/' + total;
        badge.className = 'competition-badge level-medium';
      }

      // 폴링 시작
      if (!liveBatchPollingId) {
        liveBatchPollingId = setInterval(updateLiveBatchStatus, 2000);
      }
    } else {
      livePanel.style.display = 'none';
      // 폴링 중단
      if (liveBatchPollingId) {
        clearInterval(liveBatchPollingId);
        liveBatchPollingId = null;
      }
    }
  } catch (e) { /* ignore */ }
}

async function loadDemandKeywords() {
  const sortSel = document.querySelector('#demandSortSelect');
  const sortBy = sortSel ? sortSel.value : 'compositeScore';
  try {
    const resp = await sendMsg({ type: 'HYBRID_LIST_WATCH_KEYWORDS', opts: { sortBy: sortBy, limit: 1000 } });
    // v8.5.1: data 형식 유연하게 처리
    var keywords = null;
    if (resp && resp.ok && resp.data) {
      if (Array.isArray(resp.data)) keywords = resp.data;
      else if (resp.data.items && Array.isArray(resp.data.items)) keywords = resp.data.items;
      else if (resp.data.keywords && Array.isArray(resp.data.keywords)) keywords = resp.data.keywords;
    }
    if (!keywords || !keywords.length) {
      document.querySelector('#demandEmpty').style.display = '';
      document.querySelector('#demandKwHeader').style.display = 'none';
      return;
    }
    demandKeywords = keywords;
    document.querySelector('#demandEmpty').style.display = 'none';
    document.querySelector('#demandKwHeader').style.display = 'flex';
    document.querySelector('#demandBatchControls').style.display = '';
    renderDemandKeywords(demandKeywords);
  } catch (e) { console.error('[Demand] keywords:', e); }
}

function renderDemandKeywords(keywords) {
  const list = document.querySelector('#demandKeywordList');
  list.innerHTML = '';
  keywords.forEach(function(kw) {
    const el = document.createElement('div');
    el.className = 'demand-kw-item' + (selectedKeywordIds.has(kw.id) ? ' selected' : '');
    el.dataset.kwId = kw.id;
    const scoreClass = kw.compositeScore >= 60 ? 's-high' : kw.compositeScore >= 30 ? 's-mid' : 's-low';
    let tags = '';
    if (kw.reviewGrowth7d > 0) tags += '<span class="demand-kw-tag growth">+' + kw.reviewGrowth7d + ' 리뷰</span>';
    if (kw.totalSearchCount >= 5) tags += '<span class="demand-kw-tag hot">🔥 ' + kw.totalSearchCount + '회</span>';
    if (kw.compositeScore >= 60) tags += '<span class="demand-kw-tag score">⭐ TOP</span>';
    if (kw.latestAvgPrice > 0) tags += '<span class="demand-kw-tag">' + formatDemandPrice(kw.latestAvgPrice) + '</span>';
    const lastStr = kw.lastSearchedAt ? timeAgo(kw.lastSearchedAt) : '-';

    el.innerHTML = '<div class="demand-kw-check"><input type="checkbox" ' + (selectedKeywordIds.has(kw.id) ? 'checked' : '') + ' data-kw-id="' + kw.id + '" /></div>' +
      '<div class="demand-kw-info">' +
        '<div class="demand-kw-name">' + escHtml(kw.keyword) + '</div>' +
        '<div class="demand-kw-meta">' + tags + '<span class="demand-kw-tag">' + lastStr + '</span></div>' +
      '</div>' +
      '<div class="demand-kw-score ' + scoreClass + '">' + kw.compositeScore + '</div>' +
      '<div class="demand-kw-actions-mini">' +
        '<button class="btn-sm" data-action="detail" data-keyword="' + escHtml(kw.keyword) + '" title="상세">📊</button>' +
        '<button class="btn-sm" data-action="delete" data-kw-id="' + kw.id + '" title="삭제">🗑</button>' +
      '</div>';

    // 체크박스 클릭
    el.querySelector('input[type="checkbox"]').addEventListener('change', function(e) {
      e.stopPropagation();
      if (e.target.checked) { selectedKeywordIds.add(kw.id); el.classList.add('selected'); }
      else { selectedKeywordIds.delete(kw.id); el.classList.remove('selected'); }
    });
    // 상세
    el.querySelector('[data-action="detail"]').addEventListener('click', function(e) {
      e.stopPropagation(); showKeywordDetail(kw.keyword);
    });
    // 삭제
    el.querySelector('[data-action="delete"]').addEventListener('click', async function(e) {
      e.stopPropagation();
      if (confirm('"' + kw.keyword + '" 키워드를 삭제할까요?')) {
        await sendMsg({ type: 'HYBRID_DELETE_WATCH_KEYWORD', id: kw.id });
        selectedKeywordIds.delete(kw.id);
        loadDemandKeywords();
      }
    });
    // 행 클릭 -> 상세
    el.addEventListener('click', function(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
      showKeywordDetail(kw.keyword);
    });
    list.appendChild(el);
  });
}

async function showKeywordDetail(keyword) {
  const card = document.querySelector('#demandDetailCard');
  card.style.display = '';
  document.querySelector('#demandDetailTitle').textContent = '"' + keyword + '" 상세';
  const content = document.querySelector('#demandDetailContent');
  content.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8">로딩중...</div>';

  try {
    const [histResp, diagResp] = await Promise.all([
      sendMsg({ type: 'HYBRID_KEYWORD_DAILY_STATUS', opts: { keyword: keyword, days: 14 } }),
      sendMsg({ type: 'HYBRID_DIAGNOSE_PARSE', keyword: keyword }),
    ]);
    const history = (histResp && histResp.ok) ? histResp.data : [];
    const diag = (diagResp && diagResp.ok) ? diagResp.data : null;
    const latest = (history && history.length) ? history[history.length - 1] : null;
    let html = '';

    if (latest) {
      html += '<div class="demand-detail-grid">' +
        '<div class="demand-detail-item"><div class="demand-detail-val">' + latest.totalItems + '</div><div class="demand-detail-lbl">상품수</div></div>' +
        '<div class="demand-detail-item"><div class="demand-detail-val">' + formatDemandPrice(latest.avgPrice) + '</div><div class="demand-detail-lbl">평균가</div></div>' +
        '<div class="demand-detail-item"><div class="demand-detail-val">' + latest.avgRating + '</div><div class="demand-detail-lbl">평균 평점</div></div>' +
        '<div class="demand-detail-item"><div class="demand-detail-val">' + latest.avgReview + '</div><div class="demand-detail-lbl">평균 리뷰</div></div>' +
        '<div class="demand-detail-item"><div class="demand-detail-val">' + latest.competitionScore + '</div><div class="demand-detail-lbl">경쟁도</div></div>' +
        '<div class="demand-detail-item"><div class="demand-detail-val">' + (latest.competitionLevel || '-') + '</div><div class="demand-detail-lbl">경쟁레벨</div></div>' +
        '<div class="demand-detail-item"><div class="demand-detail-val">' + (latest.reviewGrowth || 0) + '</div><div class="demand-detail-lbl">리뷰증가</div></div>' +
        '<div class="demand-detail-item"><div class="demand-detail-val">' + (latest.demandScore || 0) + '</div><div class="demand-detail-lbl">수요점수</div></div>' +
      '</div>';

      if (history.length >= 2) {
        html += '<div style="margin-top:8px"><strong style="font-size:11px">📈 최근 트렌드</strong></div>';
        var recent = history.slice(-7);
        recent.forEach(function(day) {
          var rgClass = day.reviewGrowth > 0 ? 'demand-trend-up' : day.reviewGrowth < 0 ? 'demand-trend-down' : 'demand-trend-flat';
          var pcClass = day.priceChange > 0 ? 'demand-trend-up' : day.priceChange < 0 ? 'demand-trend-down' : 'demand-trend-flat';
          var sales = day.estimatedDailySales || 0;
          html += '<div class="demand-trend-row">' +
            '<span>' + (day.statDate ? day.statDate.slice(5) : '-') + '</span>' +
            '<span>상품' + day.totalItems + '</span>' +
            '<span class="' + rgClass + '">리뷰' + (day.reviewGrowth > 0 ? '+' : '') + day.reviewGrowth + '</span>' +
            '<span>' + (sales > 0 ? '판매~' + sales.toLocaleString() : '-') + '</span>' +
            '<span class="' + pcClass + '">가격' + (day.priceChange > 0 ? '+' : '') + formatDemandPrice(day.priceChange) + '</span>' +
          '</div>';
        });
      }
    } else {
      html += '<p style="color:#94a3b8;font-size:11px;text-align:center">아직 일별 데이터가 없습니다. 쿠팡에서 이 키워드로 검색해주세요.</p>';
    }

    if (diag && diag.hasData && diag.diagnosis) {
      var dd = diag.diagnosis;
      html += '<div style="margin-top:10px;padding:8px;background:#f8fafc;border-radius:6px">' +
        '<strong style="font-size:11px">🔍 파싱 품질 진단</strong>' +
        '<div class="demand-detail-grid" style="margin-top:6px">' +
          '<div class="demand-detail-item"><div class="demand-detail-val">' + dd.priceRate + '%</div><div class="demand-detail-lbl">가격 파싱률</div></div>' +
          '<div class="demand-detail-item"><div class="demand-detail-val">' + dd.ratingRate + '%</div><div class="demand-detail-lbl">평점 파싱률</div></div>' +
          '<div class="demand-detail-item"><div class="demand-detail-val">' + dd.reviewRate + '%</div><div class="demand-detail-lbl">리뷰 파싱률</div></div>' +
          '<div class="demand-detail-item"><div class="demand-detail-val">' + dd.overallScore + '%</div><div class="demand-detail-lbl">전체 품질</div></div>' +
        '</div>' +
        (dd.issues && dd.issues.length ? '<div style="margin-top:6px;font-size:10px;color:#dc2626">' + dd.issues.map(function(i) { return '⚠️ ' + i; }).join('<br/>') + '</div>' : '<div style="font-size:10px;color:#16a34a;margin-top:4px">✅ 파싱 품질 양호</div>') +
      '</div>';
    }
    content.innerHTML = html;
  } catch (e) {
    content.innerHTML = '<p style="color:#dc2626;font-size:11px">로드 실패: ' + e.message + '</p>';
  }
}

function updateBatchToggleUI(enabled) {
  var label = document.querySelector('#batchToggleLabel');
  var badge = document.querySelector('#autoCollectStatusBadge');
  var controls = document.querySelector('#demandBatchControls');
  if (enabled) {
    label.textContent = '배치 ON';
    label.style.color = '#6366f1';
    badge.textContent = '활성';
    badge.className = 'competition-badge level-easy';
    if (controls) controls.style.display = '';
  } else {
    label.textContent = '배치 OFF';
    label.style.color = '#64748b';
    badge.textContent = '대기';
    badge.className = 'competition-badge';
    if (controls) controls.style.display = 'none';
  }
}

// 배치 토글 이벤트
document.querySelector('#batchToggle').addEventListener('change', async function(e) {
  var enabled = e.target.checked;
  await chrome.storage.local.set({ batchEnabled: enabled });
  updateBatchToggleUI(enabled);
  if (enabled) {
    chrome.alarms.create('dailyBatchCollection', { periodInMinutes: 1440 });
  } else {
    chrome.alarms.clear('dailyBatchCollection');
  }
});

// 배치 중지 (레거시 호환)
(function() {
  var stopBtn = document.querySelector('#stopBatchBtn');
  if (stopBtn) {
    stopBtn.addEventListener('click', async function() {
      batchRunning = false;
      stopBtn.style.display = 'none';
      try { await sendMsg({ type: 'STOP_AUTO_COLLECT' }); } catch(_){}
    });
  }
})();

// 정렬, 전체선택, 새로고침, 상세닫기
document.querySelector('#demandSortSelect').addEventListener('change', function() { loadDemandKeywords(); });
document.querySelector('#demandSelectAll').addEventListener('change', function(e) {
  selectedKeywordIds.clear();
  if (e.target.checked) demandKeywords.forEach(function(kw) { selectedKeywordIds.add(kw.id); });
  renderDemandKeywords(demandKeywords);
});
document.querySelector('#demandRefreshBtn').addEventListener('click', function() { loadDemandDashboard(); loadDemandKeywords(); });
document.querySelector('#demandDetailClose').addEventListener('click', function() { document.querySelector('#demandDetailCard').style.display = 'none'; });

// ============================================================
//  v7.0: 하이브리드 자동 수집기 UI 제어
//  Background fetch + DOMParser (셀러라이프 방식)
// ============================================================

let autoCollectPollingId = null;

function showAutoCollectCard() {
  // v7.1: 통합 UI — autoCollectCard 제거됨, demandBatchControls가 통합 UI
}

function updateAutoCollectUI(state) {
  if (!state) return;
  const badge = document.querySelector('#autoCollectStatusBadge');
  const startBtn = document.querySelector('#startAutoCollectBtn');
  const pauseBtn = document.querySelector('#pauseAutoCollectBtn');
  const stopBtn = document.querySelector('#stopAutoCollectBtn');
  const progressDiv = document.querySelector('#autoCollectProgress');
  const progressFill = document.querySelector('#autoCollectProgressFill');
  const progressText = document.querySelector('#autoCollectProgressText');
  const logDiv = document.querySelector('#autoCollectLog');

  if (!badge) return;

  // 상태 뱃지
  const statusMap = {
    'IDLE': { text: '준비', cls: '' },
    'RUNNING': { text: '수집중', cls: 'level-medium' },
    'NAVIGATING': { text: '이동중', cls: 'level-medium' },
    'PARSING': { text: '파싱중', cls: 'level-medium' },
    'WAITING_NEXT': { text: '대기중', cls: 'level-easy' },
    'COLLECTING_DETAIL': { text: '상세수집', cls: 'level-medium' },
    'PAUSED': { text: '일시정지', cls: 'level-hard' },
    'STOPPED': { text: '중단됨', cls: 'level-hard' },
  };
  const st = statusMap[state.status] || { text: state.status, cls: '' };
  badge.textContent = st.text;
  badge.className = 'competition-badge ' + st.cls;

  // 버튼 상태
  if (state.running && !state.paused) {
    startBtn.style.display = 'none';
    pauseBtn.style.display = '';
    stopBtn.style.display = '';
    progressDiv.style.display = '';
  } else if (state.paused) {
    startBtn.textContent = '▶ 재개';
    startBtn.style.display = '';
    pauseBtn.style.display = 'none';
    stopBtn.style.display = '';
    progressDiv.style.display = '';
  } else {
    startBtn.textContent = '▶ 자동 수집 시작';
    startBtn.style.display = '';
    pauseBtn.style.display = 'none';
    stopBtn.style.display = 'none';
    if (!state.successCount && !state.failCount) progressDiv.style.display = 'none';
  }

  // 진행률
  if (progressFill && progressText) {
    progressFill.style.width = state.progress + '%';
    var kw = state.currentKeyword ? ' "' + state.currentKeyword + '"' : '';
    progressText.textContent = (state.successCount + state.failCount + state.skipCount) + '/' + state.totalQueued + kw;
  }

  // 로그
  if (logDiv) {
    var html = '';
    if (state.running || state.paused) {
      html += '<div>성공: <b style="color:#16a34a">' + state.successCount + '</b> · ';
      html += '실패: <b style="color:#dc2626">' + state.failCount + '</b> · ';
      html += '대기: ' + state.queueLength + '개</div>';
      if (state.currentKeyword) {
        html += '<div>현재: "' + escHtml(state.currentKeyword) + '" (' + st.text + ')</div>';
      } else if (state.status === 'WAITING_NEXT' && state.queueLength > 0) {
        html += '<div style="color:#6366f1">⏳ 다음 키워드 대기중... (' + state.queueLength + '개 남음)</div>';
      }
      if (state.lastError) {
        // v7.2.2: error code to user-friendly text
        var errCodeMap = {
          'ALL_STRATEGIES_FAILED': '수집 전략 실패 (공 재시도)',
          'FETCH_EXCEPTION': '네트워크 오류 (공 재시도)',
          'PARSE_EXCEPTION': '파싱 오류 (공 재시도)',
          'EMPTY_RESULT': '결과 없음 (공 재시도)',
          'ACCESS_BLOCKED': '쿠팡 접근 차단 (장시간 대기)',
          'NETWORK_ERROR': '네트워크 연결 오류',
          'TIMEOUT': '요청 시간 초과',
          'TAB_ERROR': '탭 오류 (재생성 중)',
          'RUNTIME_ERROR': '런타임 오류',
          'UNKNOWN': '알 수 없는 오류'
        };
        var errParts = state.lastError.split(': ');
        var errKw = errParts[0] || '';
        var errCode = errParts.slice(1).join(': ') || state.lastError;
        var friendlyErr = errCodeMap[errCode] || errCode;
        html += '<div style="color:#f59e0b;font-size:9px">⚠️ ' + escHtml(errKw) + ': ' + friendlyErr + '</div>';
      }
    } else if (state.status === 'IDLE' && (state.successCount > 0 || state.failCount > 0)) {
      html += '<div>✅ 수집 완료 — 성공: ' + state.successCount + ', 실패: ' + state.failCount + '</div>';
    }
    logDiv.innerHTML = html;
  }
}

async function pollAutoCollectState() {
  try {
    var resp = await sendMsg({ type: 'GET_COLLECTOR_STATE' });
    if (resp && resp.ok) updateAutoCollectUI(resp.data);
  } catch (e) { /* ignore */ }
}

function startAutoCollectPolling() {
  if (autoCollectPollingId) clearInterval(autoCollectPollingId);
  autoCollectPollingId = setInterval(pollAutoCollectState, 2000);
}

function stopAutoCollectPolling() {
  if (autoCollectPollingId) { clearInterval(autoCollectPollingId); autoCollectPollingId = null; }
}

// v8.5.3: 통합 수집 시작 버튼 — 배치 로직 수정
// 핵심 배치 로직:
//   - 1 배치 = 최대 100 키워드
//   - 하루 최대 5 배치 = 총 500 키워드
//   - 서버 적응형 스케줄러 기반 키워드 선별
//   - 배치 간 재설정 시간(버스트 휴식) 자동 적용
document.querySelector('#startAutoCollectBtn').addEventListener('click', async function() {
  var collectDetail = document.querySelector('#autoCollectDetailCheck').checked;
  var mode = document.querySelector('input[name="batchMode"]:checked');
  mode = mode ? mode.value : 'all';

  // ── v8.5.3: 서버 적응형 스케줄러에서 배치 정보를 가져옴 ──
  var serverBatch = null;
  var batchKeywords = [];
  var dailyStats = null;
  var sessionLimits = null;
  var totalActive = 0;

  try {
    console.log('[수집] 서버 적응형 스케줄러 조회 중...');
    var batchResp = await sendMsg({ type: 'HYBRID_BATCH_SELECTION', opts: { limit: 100 } });
    if (batchResp && batchResp.ok && batchResp.data) {
      serverBatch = batchResp.data;
      var serverKws = serverBatch.keywords || [];
      batchKeywords = serverKws.map(function(k) { return k.keyword; });
      dailyStats = serverBatch.dailyStats || {};
      sessionLimits = serverBatch.sessionLimits || {};
      totalActive = serverBatch.totalActive || 0;
      console.log('[수집] 서버 선별: ' + batchKeywords.length + '개 (활성 ' + totalActive + ', 배치 ' + (dailyStats.roundsToday || 0) + '/' + (dailyStats.maxRoundsPerDay || 5) + ', 그룹턴 ' + (dailyStats.currentGroupTurn || 0) + ')');
    }
  } catch(e) {
    console.warn('[수집] 서버 배치 선별 실패, 로컬 폴백:', e.message);
  }

  // ── 서버 응답 기반 한도 체크 ──
  if (dailyStats) {
    if (dailyStats.roundsToday >= dailyStats.maxRoundsPerDay) {
      alert('오늘 배치 한도(' + dailyStats.maxRoundsPerDay + '회)에 도달했습니다.\n오늘 수집: ' + dailyStats.collectedToday + '/' + dailyStats.dailyLimit + '개\n내일 다시 시도해주세요.');
      return;
    }
    if (dailyStats.remainingToday <= 0) {
      alert('오늘 일일 수집 한도(' + dailyStats.dailyLimit + '개)에 도달했습니다.\n내일 다시 시도해주세요.');
      return;
    }
  } else {
    // 서버 실패 시 로컬 폴백
    var todayData = await chrome.storage.local.get(['todayBatchRuns', 'todayBatchDate']);
    var todayStr = new Date().toISOString().slice(0, 10);
    var todayRuns = (todayData.todayBatchDate === todayStr) ? (todayData.todayBatchRuns || 0) : 0;
    if (todayRuns >= 5) {
      alert('오늘 배치 한도(5회)에 도달했습니다.\n하루 최대 5배치 × 100개 = 500개까지 수집 가능합니다.\n내일 다시 시도해주세요.');
      return;
    }
  }

  // ── 서버 선별 실패 시 로컬 폴백 ──
  if (batchKeywords.length === 0) {
    console.log('[수집] 서버 선별 결과 없음, 로컬 키워드 로드...');
    var keywordList = [];
    var totalRegisteredCount = 0;
    if (mode === 'uncollected') {
      try {
        var ucResp = await sendMsg({ type: 'HYBRID_GET_UNCOLLECTED_KEYWORDS' });
        if (ucResp && ucResp.ok && ucResp.data && ucResp.data.uncollectedKeywords) {
          keywordList = ucResp.data.uncollectedKeywords;
          totalRegisteredCount = ucResp.data.total || keywordList.length;
          await sendMsg({ type: 'HYBRID_BOOST_UNCOLLECTED' });
        }
      } catch(e) { console.error('[수집] 미수집 키워드 조회 실패:', e); }
    } else if (mode === 'selected' && selectedKeywordIds.size > 0) {
      var selectedKws = demandKeywords.filter(function(kw) { return selectedKeywordIds.has(kw.id); });
      keywordList = selectedKws.map(function(kw) { return kw.keyword; });
      totalRegisteredCount = keywordList.length;
    } else {
      keywordList = demandKeywords.map(function(kw) { return kw.keyword; });
      totalRegisteredCount = keywordList.length;
    }
    if (keywordList.length === 0 && mode !== 'selected' && mode !== 'uncollected') {
      try {
        var kwResp = await sendMsg({ type: 'HYBRID_LIST_WATCH_KEYWORDS', opts: { sortBy: 'compositeScore', limit: 1000 } });
        var kwData = null;
        if (kwResp && kwResp.ok && kwResp.data) {
          if (Array.isArray(kwResp.data)) kwData = kwResp.data;
          else if (kwResp.data.items) kwData = kwResp.data.items;
          else if (kwResp.data.keywords) kwData = kwResp.data.keywords;
        }
        if (kwData && kwData.length > 0) {
          keywordList = kwData.map(function(kw) { return kw.keyword; });
          totalRegisteredCount = keywordList.length;
        }
      } catch(e) { console.error('[수집] 서버 키워드 조회 실패:', e); }
    }
    if (keywordList.length === 0) {
      alert('감시 키워드가 없습니다.\n사이드패널 > 수집 탭에서 키워드를 등록하세요.');
      return;
    }
    batchKeywords = keywordList.slice(0, 100);
    totalActive = totalRegisteredCount || keywordList.length;
  }

  if (batchKeywords.length === 0) {
    alert('수집할 키워드가 없습니다.\n모든 키워드가 수집 완료되었거나 만기 전입니다.');
    return;
  }

  // ── 확인 다이얼로그 (서버 기반 정확한 정보) ──
  var roundsToday = dailyStats ? (dailyStats.roundsToday || 0) : 0;
  var maxRounds = dailyStats ? (dailyStats.maxRoundsPerDay || 5) : 5;
  var collectedToday = dailyStats ? (dailyStats.collectedToday || 0) : 0;
  var dailyLimit = dailyStats ? (dailyStats.dailyLimit || 500) : 500;
  var remainingBatches = maxRounds - roundsToday;
  var totalOverdue = serverBatch ? (serverBatch.totalOverdue || 0) : 0;
  var estMin = Math.ceil(batchKeywords.length * 25 / 60);
  var groupTurn = dailyStats ? (dailyStats.currentGroupTurn || 0) : 0;

  // 티어별 키워드 개수 계산
  var tierInfo = '';
  if (serverBatch && serverBatch.keywords) {
    var reasons = {};
    serverBatch.keywords.forEach(function(k) {
      var r = k.selectionReason || '기타';
      reasons[r] = (reasons[r] || 0) + 1;
    });
    var tierParts = [];
    if (reasons['핀_키워드']) tierParts.push('📌 핀: ' + reasons['핀_키워드']);
    if (reasons['신규_안정화']) tierParts.push('🆕 신규: ' + reasons['신규_안정화']);
    var regularCount = batchKeywords.length - (reasons['핀_키워드'] || 0) - (reasons['신규_안정화'] || 0);
    if (regularCount > 0) tierParts.push('📊 일반: ' + regularCount);
    if (tierParts.length > 0) tierInfo = tierParts.join(' · ');
  }

  var confirmMsg = '📊 자동 배치 수집\n\n';
  confirmMsg += '🗂️ 활성 키워드: ' + totalActive + '개\n';
  if (totalOverdue > 0) confirmMsg += '⏰ 만기 도래: ' + totalOverdue + '개\n';
  confirmMsg += '✅ 오늘 수집: ' + collectedToday + '/' + dailyLimit + '개\n';
  confirmMsg += '📅 배치: ' + (roundsToday + 1) + '/' + maxRounds + '회차 (남은: ' + (remainingBatches - 1) + '회)\n';
  confirmMsg += '🔄 그룹 턴: ' + groupTurn + '/5\n\n';
  confirmMsg += '── 이번 배치 ──\n';
  confirmMsg += '📦 수집 대상: ' + batchKeywords.length + '개\n';
  if (tierInfo) confirmMsg += '   ' + tierInfo + '\n';
  confirmMsg += '⏱️ 예상: 약 ' + estMin + '분 (키워드당 15~35초)\n';
  confirmMsg += '⏸️ 배치 간 재설정 시간: 1~3분\n\n';
  confirmMsg += '계속하시겠습니까?';

  if (!confirm(confirmMsg)) return;

  // v8.5.3: 서버 선별 키워드만 전달, roundSize=100 고정
  var resp = await sendMsg({
    type: 'START_AUTO_COLLECT',
    payload: { limit: batchKeywords.length, collectDetail: collectDetail, keywords: batchKeywords, roundSize: 100 },
  });
  if (resp && resp.ok) {
    batchRunning = true;
    document.querySelector('#autoCollectProgress').style.display = '';
    document.querySelector('#batchProgressBar').style.display = '';
    document.querySelector('#batchProgressFill').style.width = '0%';
    var batchLabel = '배치 ' + (roundsToday + 1) + '/' + maxRounds;
    document.querySelector('#batchProgressText').textContent = '0/' + batchKeywords.length + ' (' + batchLabel + ') 수집 시작중...';
    updateAutoCollectUI({
      status: 'RUNNING', running: true, paused: false,
      queueLength: resp.queueLength || batchKeywords.length, currentKeyword: null,
      successCount: 0, failCount: 0, skipCount: 0,
      totalQueued: resp.queueLength || batchKeywords.length, lastError: null, progress: 0,
    });
    startAutoCollectPolling();
    // 완료 감지 폴링
    var completePollId = setInterval(async function() {
      try {
        var st = await sendMsg({ type: 'GET_COLLECTOR_STATE' });
        if (!st || !st.ok) return;
        var state = st.data;
        var done = state.successCount + state.failCount + state.skipCount;
        var total = state.totalQueued || batchKeywords.length;
        var pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
        document.querySelector('#batchProgressFill').style.width = pct + '%';
        var statusText = done + '/' + total + ' (' + batchLabel + ')';
        if (state.currentKeyword) statusText += ' "' + state.currentKeyword + '"';
        if (state.status === 'NAVIGATING') statusText += ' (이동중)';
        else if (state.status === 'PARSING') statusText += ' (파싱중)';
        else if (state.status === 'WAITING_NEXT') statusText += ' (다음 대기중)';
        if (state.failCount > 0) statusText += ' ⚠️실패:' + state.failCount;
        document.querySelector('#batchProgressText').textContent = statusText;

        if (!state.running && state.status !== 'PAUSED') {
          clearInterval(completePollId);
          document.querySelector('#batchProgressFill').style.width = '100%';
          document.querySelector('#batchProgressText').textContent = '✅ 배치 완료! 성공:' + state.successCount + ' 실패:' + state.failCount;
          batchRunning = false;
          try { await sendMsg({ type: 'HYBRID_RUN_DAILY_BATCH' }); } catch(_){}
          // v8.5.2: 오늘의 배치 카운트 업데이트
          var td = await chrome.storage.local.get(['todayBatchRuns', 'todayBatchDate', 'todayValidCount']);
          var tdStr = new Date().toISOString().slice(0, 10);
          var tdRuns = (td.todayBatchDate === tdStr) ? (td.todayBatchRuns || 0) : 0;
          var tdValid = (td.todayBatchDate === tdStr) ? (td.todayValidCount || 0) : 0;
          await chrome.storage.local.set({
            lastDailyBatchRun: new Date().toISOString(),
            batchOffset: 0,
            todayBatchRuns: tdRuns + 1,
            todayValidCount: tdValid + (state.successCount || 0),
            todayBatchDate: tdStr
          });
          updateTodayBatchSummary();
          setTimeout(function() { loadDemandDashboard(); loadDemandKeywords(); }, 1000);
          setTimeout(function() { document.querySelector('#batchProgressBar').style.display = 'none'; }, 8000);
        }
      } catch (e) {}
    }, 3000);
  } else {
    var errMsg2 = resp ? resp.error : '';
    if (errMsg2 && (errMsg2.indexOf('이미 실행') >= 0 || errMsg2.indexOf('Already') >= 0)) {
      if (confirm('수집기가 실행 중 상태로 남아있습니다.\n강제 리셋 후 다시 시작 버튼을 눌러주세요.')) {
        await sendMsg({ type: 'FORCE_RESET_COLLECTOR' });
      }
    } else {
      alert('수집 시작 실패: ' + (errMsg2 || '알 수 없는 오류'));
    }
  }
});

// 일시정지 버튼
document.querySelector('#pauseAutoCollectBtn').addEventListener('click', async function() {
  await sendMsg({ type: 'PAUSE_AUTO_COLLECT' });
  stopAutoCollectPolling();
  pollAutoCollectState();
});

// 중단 버튼
document.querySelector('#stopAutoCollectBtn').addEventListener('click', async function() {
  await sendMsg({ type: 'STOP_AUTO_COLLECT' });
  stopAutoCollectPolling();
  pollAutoCollectState();
});

// 탭 전환 시 자동 수집 상태 확인
async function checkAutoCollectOnTabSwitch() {
  var resp = await sendMsg({ type: 'GET_COLLECTOR_STATE' });
  if (resp && resp.ok && resp.data) {
    showAutoCollectCard();
    updateAutoCollectUI(resp.data);
    if (resp.data.running) startAutoCollectPolling();
  }
}

// demand 탭 로드 시 자동 수집 카드 연동
(function() {
  var origLoadDemand = loadDemandTab;
  loadDemandTab = async function() {
    await origLoadDemand();
    showAutoCollectCard();
    await checkAutoCollectOnTabSwitch();
    // 수동 수집 탭이 활성화되어 있으면 로드
    var activeSubtab = document.querySelector('.demand-subtab.active');
    if (activeSubtab && activeSubtab.dataset.subtab === 'manual') {
      loadManualKeywords();
    }
  };
})();

// ============================================================
//  수동 수집 탭 — 초성 필터 + 수동 배치 수집
// ============================================================

// 초성 추출 유틸
var CHOSUNG_LIST = [
  '\u3131','\u3132','\u3134','\u3137','\u3138','\u3139','\u3141','\u3142','\u3143','\u3145','\u3146',
  '\u3147','\u3148','\u3149','\u314A','\u314B','\u314C','\u314D','\u314E'
];
var CHOSUNG_GROUP = {
  '\u3132': '\u3131', '\u3138': '\u3137', '\u3143': '\u3142', '\u3146': '\u3145', '\u3149': '\u3148'
};

function getChosung(ch) {
  var code = ch.charCodeAt(0);
  if (code >= 0xAC00 && code <= 0xD7A3) {
    var idx = Math.floor((code - 0xAC00) / (21 * 28));
    var raw = CHOSUNG_LIST[idx];
    return CHOSUNG_GROUP[raw] || raw;
  }
  return null;
}

function getKeywordGroup(query) {
  if (!query) return 'ETC';
  var first = query.charAt(0);
  var chosung = getChosung(first);
  if (chosung) return chosung;
  if (/[a-zA-Z]/.test(first)) return 'ABC';
  if (/[0-9]/.test(first)) return '123';
  return 'ETC';
}

// 수동 수집 상태
var manualAllKeywords = [];
var manualFilteredKeywords = [];
var manualSelectedIds = new Set();
var manualChosungFilter = '전체';
var manualSearchText = '';
var manualPage = 1;
var MANUAL_PER_PAGE = 50;

// 서브탭 전환
document.querySelectorAll('.demand-subtab').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.demand-subtab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.demand-subtab-content').forEach(function(c) { c.classList.remove('active'); });
    btn.classList.add('active');
    var target = document.querySelector('#subtab-' + btn.dataset.subtab);
    if (target) target.classList.add('active');
    if (btn.dataset.subtab === 'manual') loadManualKeywords();
  });
});

async function loadManualKeywords() {
  var emptyEl = document.querySelector('#manualEmpty');
  var totalCountEl = document.querySelector('#manualKwTotalCount');
  var { serverLoggedIn } = await chrome.storage.local.get('serverLoggedIn');
  if (!serverLoggedIn) {
    emptyEl.textContent = '서버 로그인이 필요합니다. 서버 탭에서 먼저 로그인하세요.';
    emptyEl.style.display = '';
    return;
  }
  // v8.5.2: 로딩 표시
  emptyEl.textContent = '⏳ 서버에서 키워드 목록을 불러오는 중...';
  emptyEl.style.display = '';
  try {
    console.log('[Manual] 키워드 목록 로드 시작...');
    var resp = await sendMsg({ type: 'HYBRID_LIST_WATCH_KEYWORDS', opts: { sortBy: 'compositeScore', limit: 1000 } });
    console.log('[Manual] 응답 원본:', JSON.stringify(resp).slice(0, 500));
    
    // v8.5.2: data 형식을 최대한 유연하게 처리 (tRPC, 배열, 객체 등)
    var keywords = null;
    if (resp && resp.ok && resp.data) {
      if (Array.isArray(resp.data)) {
        keywords = resp.data;
      } else if (resp.data.items && Array.isArray(resp.data.items)) {
        keywords = resp.data.items;
      } else if (resp.data.keywords && Array.isArray(resp.data.keywords)) {
        keywords = resp.data.keywords;
      } else if (resp.data.result && resp.data.result.data) {
        // 이중 래핑된 tRPC 응답
        var inner = resp.data.result.data;
        if (Array.isArray(inner)) keywords = inner;
        else if (inner.items) keywords = inner.items;
        else if (inner.keywords) keywords = inner.keywords;
      }
      // 객체의 값들이 키워드 배열인 경우 (ex: { 0: {...}, 1: {...} })
      if (!keywords && typeof resp.data === 'object' && !Array.isArray(resp.data)) {
        var vals = Object.values(resp.data);
        if (vals.length > 0 && typeof vals[0] === 'object' && vals[0].keyword) {
          keywords = vals;
        }
      }
    }
    // resp 자체가 ok 없이 배열인 경우
    if (!keywords && Array.isArray(resp)) {
      keywords = resp;
    }
    
    // 키워드 객체 정규화: keyword 속성이 없으면 문자열로 변환
    if (keywords && keywords.length > 0) {
      keywords = keywords.map(function(kw) {
        if (typeof kw === 'string') return { keyword: kw, id: kw, compositeScore: 0 };
        if (!kw.keyword && kw.name) kw.keyword = kw.name;
        if (!kw.id) kw.id = kw.keyword || Math.random().toString(36);
        return kw;
      }).filter(function(kw) { return kw && kw.keyword; });
    }
    
    console.log('[Manual] 파싱된 키워드:', keywords ? keywords.length + '개' : 'null');
    
    if (!keywords || !keywords.length) {
      emptyEl.style.display = '';
      emptyEl.textContent = '감시 키워드가 없습니다. 쿠팡에서 검색하면 자동으로 키워드가 등록됩니다.';
      totalCountEl.textContent = '0';
      manualAllKeywords = [];
      filterManualKeywords();
      return;
    }
    manualAllKeywords = keywords;
    emptyEl.style.display = 'none';
    totalCountEl.textContent = manualAllKeywords.length;
    updateChosungCounts();
    filterManualKeywords();
    console.log('[Manual] ' + manualAllKeywords.length + '개 키워드 로드 완료, 첫 키워드:', manualAllKeywords[0].keyword);
  } catch (e) {
    console.error('[Manual] load error:', e);
    emptyEl.textContent = '키워드 로드 실패: ' + e.message + '\n3초 후 재시도...';
    emptyEl.style.display = '';
    setTimeout(loadManualKeywords, 3000);
  }
}

function updateChosungCounts() {
  var counts = {};
  manualAllKeywords.forEach(function(kw) {
    var grp = getKeywordGroup(kw.keyword);
    counts[grp] = (counts[grp] || 0) + 1;
  });
  document.querySelectorAll('.chosung-btn').forEach(function(btn) {
    var ch = btn.dataset.chosung;
    if (ch === '전체') {
      btn.textContent = '전체';
      return;
    }
    var cnt = counts[ch] || 0;
    btn.innerHTML = ch + (cnt > 0 ? '<span class="ch-count">' + cnt + '</span>' : '');
    btn.classList.toggle('disabled', cnt === 0);
  });
}

function filterManualKeywords() {
  var filtered = manualAllKeywords;

  // 초성 필터
  if (manualChosungFilter !== '전체') {
    filtered = filtered.filter(function(kw) {
      return getKeywordGroup(kw.keyword) === manualChosungFilter;
    });
  }

  // 검색어 필터
  if (manualSearchText.trim()) {
    var q = manualSearchText.trim().toLowerCase();
    filtered = filtered.filter(function(kw) {
      return kw.keyword.toLowerCase().includes(q);
    });
  }

  // 한글 정렬
  filtered.sort(function(a, b) { return a.keyword.localeCompare(b.keyword, 'ko'); });

  manualFilteredKeywords = filtered;
  manualPage = 1;
  renderManualKeywords();
}

function renderManualKeywords() {
  var list = document.querySelector('#manualKeywordList');
  if (!list) return;
  list.innerHTML = '';

  var total = manualFilteredKeywords.length;
  var totalPages = Math.max(1, Math.ceil(total / MANUAL_PER_PAGE));
  manualPage = Math.min(manualPage, totalPages);
  var start = (manualPage - 1) * MANUAL_PER_PAGE;
  var pageItems = manualFilteredKeywords.slice(start, start + MANUAL_PER_PAGE);

  if (pageItems.length === 0) {
    document.querySelector('#manualEmpty').style.display = '';
    document.querySelector('#manualEmpty').textContent = manualSearchText || manualChosungFilter !== '전체'
      ? '검색 결과가 없습니다.' : '감시 키워드가 없습니다.';
    document.querySelector('#manualPagination').style.display = 'none';
    updateManualSelectedCount();
    return;
  }
  document.querySelector('#manualEmpty').style.display = 'none';

  pageItems.forEach(function(kw) {
    var el = document.createElement('div');
    el.className = 'demand-kw-item' + (manualSelectedIds.has(kw.id) ? ' selected' : '');
    el.dataset.kwId = kw.id;

    var scoreClass = kw.compositeScore >= 60 ? 's-high' : kw.compositeScore >= 30 ? 's-mid' : 's-low';
    var lastStr = kw.lastSearchedAt ? timeAgo(kw.lastSearchedAt) : '미수집';
    var tags = '';
    if (kw.latestAvgPrice > 0) tags += '<span class="demand-kw-tag">' + formatDemandPrice(kw.latestAvgPrice) + '</span>';
    tags += '<span class="demand-kw-tag">' + lastStr + '</span>';

    el.innerHTML =
      '<div class="demand-kw-check"><input type="checkbox" ' + (manualSelectedIds.has(kw.id) ? 'checked' : '') + ' /></div>' +
      '<div class="demand-kw-info">' +
        '<div class="demand-kw-name">' + escHtml(kw.keyword) + '</div>' +
        '<div class="demand-kw-meta">' + tags + '</div>' +
      '</div>' +
      '<div class="demand-kw-score ' + scoreClass + '">' + (kw.compositeScore || 0) + '</div>';

    el.querySelector('input[type="checkbox"]').addEventListener('change', function(e) {
      e.stopPropagation();
      if (e.target.checked) { manualSelectedIds.add(kw.id); el.classList.add('selected'); }
      else { manualSelectedIds.delete(kw.id); el.classList.remove('selected'); }
      updateManualSelectedCount();
    });

    el.addEventListener('click', function(e) {
      if (e.target.tagName === 'INPUT') return;
      var cb = el.querySelector('input[type="checkbox"]');
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change'));
    });

    list.appendChild(el);
  });

  // 페이지네이션
  var pagEl = document.querySelector('#manualPagination');
  if (totalPages > 1) {
    pagEl.style.display = 'flex';
    document.querySelector('#manualPageInfo').textContent = manualPage + ' / ' + totalPages;
  } else {
    pagEl.style.display = 'none';
  }
  updateManualSelectedCount();
}

function updateManualSelectedCount() {
  var el = document.querySelector('#manualSelectedCount');
  if (el) el.textContent = manualSelectedIds.size + '개 선택';
}

// 초성 필터 클릭
document.querySelector('#chosungFilter').addEventListener('click', function(e) {
  var btn = e.target.closest('.chosung-btn');
  if (!btn || btn.classList.contains('disabled')) return;
  document.querySelectorAll('.chosung-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  manualChosungFilter = btn.dataset.chosung;
  filterManualKeywords();
});

// 검색 입력
document.querySelector('#manualKwSearch').addEventListener('input', function(e) {
  manualSearchText = e.target.value;
  filterManualKeywords();
});

// 새로고침
document.querySelector('#manualKwRefreshBtn').addEventListener('click', function() {
  manualSelectedIds.clear();
  loadManualKeywords();
});

// 페이지네이션
document.querySelector('#manualPrevPage').addEventListener('click', function() {
  if (manualPage > 1) { manualPage--; renderManualKeywords(); }
});
document.querySelector('#manualNextPage').addEventListener('click', function() {
  var totalPages = Math.max(1, Math.ceil(manualFilteredKeywords.length / MANUAL_PER_PAGE));
  if (manualPage < totalPages) { manualPage++; renderManualKeywords(); }
});

// 수동 수집 실행 버튼
document.querySelector('#manualCollectBtn').addEventListener('click', async function() {
  if (manualSelectedIds.size === 0) {
    alert('수집할 키워드를 선택해주세요.');
    return;
  }

  var selectedKws = manualAllKeywords.filter(function(kw) { return manualSelectedIds.has(kw.id); });
  var keywordList = selectedKws.map(function(kw) { return kw.keyword; });
  var collectDetail = document.querySelector('#manualCollectDetailCheck').checked;
  var estMin = Math.ceil(keywordList.length * 20 / 60);

  if (!confirm('선택한 ' + keywordList.length + '개 키워드를 수집합니다.\n⏱️ 예상: 약 ' + estMin + '분\n\n계속하시겠습니까?')) return;

  // 수동 수집: 선택된 키워드의 nextCollectAt 리셋 (수집주기 바이패스)
  try {
    await sendMsg({ type: 'HYBRID_RESET_NEXT_COLLECT', data: { keywords: keywordList } });
    console.log('[Manual] nextCollectAt 리셋 완료: ' + keywordList.length + '개');
  } catch (e) { console.warn('[Manual] nextCollectAt 리셋 실패:', e.message); }

  var resp = await sendMsg({
    type: 'START_AUTO_COLLECT',
    payload: { limit: keywordList.length, collectDetail: collectDetail, keywords: keywordList, roundSize: keywordList.length }
  });

  if (resp && resp.ok) {
    document.querySelector('#manualCollectProgress').style.display = '';
    var pollId = setInterval(async function() {
      var st = await sendMsg({ type: 'GET_COLLECTOR_STATE' });
      if (!st || !st.ok) return;
      var state = st.data;
      var done = state.successCount + state.failCount + state.skipCount;
      var total = state.totalQueued || keywordList.length;
      var pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
      document.querySelector('#manualCollectProgressFill').style.width = pct + '%';
      document.querySelector('#manualCollectProgressText').textContent = done + '/' + total;

      if (!state.running && state.status !== 'PAUSED') {
        clearInterval(pollId);
        document.querySelector('#manualCollectProgress').style.display = 'none';
        manualSelectedIds.clear();
        await sendMsg({ type: 'HYBRID_RUN_DAILY_BATCH' });
        setTimeout(function() { loadManualKeywords(); }, 1000);
      }
    }, 3000);
  }
});
