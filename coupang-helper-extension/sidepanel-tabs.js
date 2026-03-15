/* Coupang Sourcing Helper — History, Margin Calculator, Server Tab */

// ============================================================
//  히스토리 탭
// ============================================================

async function loadHistory() {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
  const history = resp?.data || [];
  const list = $('#historyList');
  const empty = $('#historyEmpty');
  list.innerHTML = '';
  if (!history.length) { empty.style.display = ''; return; }
  empty.style.display = 'none';
  for (const h of history) {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.innerHTML = `
      <div class="history-query">"${h.query}"</div>
      <div class="history-stats">${h.count}개 · 평균가 ${formatPrice(h.avgPrice)} · 평점 ${h.avgRating || '-'} · 리뷰 ${h.avgReview || '-'}</div>
      <div class="history-time">${new Date(h.timestamp).toLocaleString('ko-KR')}</div>`;
    li.addEventListener('click', () => {
      chrome.tabs.create({ url: `https://www.coupang.com/np/search?q=${encodeURIComponent(h.query)}` });
    });
    list.appendChild(li);
  }
}

$('#clearHistoryBtn').addEventListener('click', async () => {
  if (!confirm('검색 히스토리를 모두 삭제할까요?')) return;
  await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
  loadHistory();
});

// ============================================================
//  마진 계산기 v7.2 — 셀러라이프 spGrowthCalcUtils 방식 전면 반영
//  배송비 6단계 사이즈·무게 기반 / 카테고리별 수수료 / ROAS / 월 수익
// ============================================================

// 카테고리 수수료 select ↔ 직접입력 토글
$('#calcCategory').addEventListener('change', () => {
  const v = $('#calcCategory').value;
  if (v === '0') {
    $('#customCommissionRow').style.display = '';
  } else {
    $('#customCommissionRow').style.display = 'none';
    if ($('#calcCommission')) $('#calcCommission').value = v;
  }
});

// 배송비 select ↔ 직접입력 토글
$('#calcDeliveryTier').addEventListener('change', () => {
  const v = $('#calcDeliveryTier').value;
  if (v === '0') {
    $('#customDeliveryRow').style.display = '';
  } else {
    $('#customDeliveryRow').style.display = 'none';
  }
});

$('#calcBtn').addEventListener('click', () => {
  const salePrice = parseFloat($('#calcSalePrice').value) || 0;
  const cnyCost = parseFloat($('#calcCnyCost').value) || 0;
  const exchangeRate = parseFloat($('#calcExchangeRate').value) || 190;
  const setQty = Math.max(1, parseInt($('#calcSetQty').value) || 1);
  const monthlySales = parseInt($('#calcMonthlySales').value) || 0;
  const shipping = parseFloat($('#calcShipping').value) || 0;
  const taxRate = parseFloat($('#calcTaxRate').value) || 0;
  const adRate = parseFloat($('#calcAdRate').value) || 0;

  // 수수료율: 카테고리 select 또는 직접입력
  let commissionRate;
  const catVal = $('#calcCategory').value;
  if (catVal === '0') {
    commissionRate = parseFloat($('#calcCommission').value) || 10.8;
  } else {
    commissionRate = parseFloat(catVal) || 10.8;
  }

  // 배송비: 셀러라이프 6단계 또는 직접입력
  let deliveryFee;
  const tierVal = $('#calcDeliveryTier').value;
  if (tierVal === '0') {
    deliveryFee = parseFloat($('#calcCustomDelivery').value) || 0;
  } else {
    deliveryFee = parseFloat(tierVal) || 2200;
  }

  // --- 셀러라이프 공식 ---
  // profit = price - (cost * setQty) - delivery - tax; margin% = profit/price
  const costKrw = Math.round(cnyCost * exchangeRate);
  const totalItemCost = costKrw * setQty;                     // 세트 수량 반영
  const tax = Math.round(totalItemCost * (taxRate / 100));     // 관세
  const sourcingCost = totalItemCost + shipping + tax;         // 총 원가 (소싱비)
  const commission = Math.round(salePrice * (commissionRate / 100)); // 쿠팡 수수료
  const adCost = Math.round(salePrice * (adRate / 100));       // 광고비
  const profit = salePrice - sourcingCost - deliveryFee - commission - adCost;
  const margin = salePrice > 0 ? ((profit / salePrice) * 100).toFixed(1) : 0;
  // 셀러라이프: 최소 ROAS = 11000 / margin%
  const marginNum = parseFloat(margin) || 0;
  const minRoas = marginNum > 0 ? Math.round(11000 / marginNum) : 0;
  const monthlyProfit = monthlySales > 0 ? profit * monthlySales : 0;

  // UI 결과 표시
  $('#calcResult').style.display = '';
  $('#resultCostKrw').textContent = formatPrice(totalItemCost) + (setQty > 1 ? ` (${formatPrice(costKrw)}\u00d7${setQty})` : '');
  $('#resultShipping').textContent = formatPrice(shipping);
  $('#resultTax').textContent = formatPrice(tax);
  $('#resultTotalCost').textContent = formatPrice(sourcingCost);
  $('#resultCoupangDelivery').textContent = formatPrice(deliveryFee);
  $('#resultCommRate').textContent = commissionRate;
  $('#resultCommission').textContent = formatPrice(commission);
  $('#resultAdRateLabel').textContent = adRate;
  $('#resultAdCost').textContent = formatPrice(adCost);
  $('#resultProfit').textContent = formatPrice(profit);
  $('#resultMargin').textContent = margin + '%';

  // ROAS / 월수익 표시
  if (marginNum > 0) {
    $('#roasRow').style.display = '';
    $('#resultMinRoas').textContent = minRoas + '%';
  } else {
    $('#roasRow').style.display = 'none';
  }
  if (monthlySales > 0) {
    $('#monthlyRow').style.display = '';
    $('#resultMonthlyProfit').textContent = formatPrice(monthlyProfit) + ` (${monthlySales}\uac1c)`;
  } else {
    $('#monthlyRow').style.display = 'none';
  }

  const cls = profit > 0 ? 'profit-positive' : 'profit-negative';
  $('#profitRow').className = `calc-result-row profit-row ${cls}`;
  $('#marginRow').className = `calc-result-row margin-row ${cls}`;
});

// ============================================================
//  서버 연동 탭
// ============================================================

const statusLabels = {
  new: '신규', reviewing: '검토중', contacted_supplier: '공급처 연락',
  sample_ordered: '샘플 주문', dropped: '탈락', selected: '선정',
};

async function checkServerAuth() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'SERVER_CHECK_AUTH' });
    if (resp?.ok && resp.loggedIn) { showLoggedIn(resp.user); return true; }
    showLoginForm();
    return false;
  } catch (e) { showLoginForm(); return false; }
}

function showLoggedIn(user) {
  $('#syncStatus').className = 'sync-status sync-connected';
  $('#syncStatus').title = '서버 연결됨';
  $('#serverLoginForm').style.display = 'none';
  $('#serverLoggedIn').style.display = '';
  $('#serverUserName').textContent = user?.name || '사용자';
  $('#serverUserEmail').textContent = user?.email || '';
  $('#serverStatusBadge').textContent = '연결됨';
  $('#serverStatusBadge').className = 'sync-indicator sync-connected';
  loadServerStats();
}

function showLoginForm() {
  $('#syncStatus').className = 'sync-status sync-disconnected';
  $('#syncStatus').title = '서버 미연결';
  $('#serverLoginForm').style.display = '';
  $('#serverLoggedIn').style.display = 'none';
  $('#serverStatusBadge').textContent = '미연결';
  $('#serverStatusBadge').className = 'sync-indicator sync-disconnected';
  $('#serverStatsCard').style.display = 'none';
}

$('#serverLoginBtn').addEventListener('click', async () => {
  const email = $('#serverEmail').value.trim();
  const password = $('#serverPassword').value;
  const errorEl = $('#serverLoginError');
  errorEl.style.display = 'none';
  if (!email || !password) { errorEl.textContent = '이메일과 비밀번호를 입력하세요.'; errorEl.style.display = ''; return; }
  const btn = $('#serverLoginBtn');
  btn.disabled = true; btn.textContent = '로그인 중...';
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'SERVER_LOGIN', email, password });
    if (resp?.ok) { showLoggedIn(resp.user); }
    else { errorEl.textContent = resp?.error || '로그인 실패'; errorEl.style.display = ''; }
  } catch (e) { errorEl.textContent = e.message || '로그인 실패'; errorEl.style.display = ''; }
  finally { btn.disabled = false; btn.textContent = '로그인'; }
});

$('#serverLogoutBtn').addEventListener('click', async () => {
  await chrome.storage.local.set({ serverLoggedIn: false, serverEmail: '' });
  showLoginForm();
});

async function loadServerStats() {
  const statsCard = $('#serverStatsCard');
  try {
    const searchResp = await chrome.runtime.sendMessage({ type: 'SERVER_SEARCH_STATS' });
    const candResp = await chrome.runtime.sendMessage({ type: 'SERVER_CANDIDATE_STATS' });
    const searchData = searchResp?.data;
    const candData = candResp?.data;
    if (!searchData && !candData) { statsCard.style.display = 'none'; return; }

    statsCard.style.display = '';
    $('#srvTotalSearches').textContent = searchData?.totalSearches || 0;
    $('#srvUniqueQueries').textContent = searchData?.uniqueQueries || 0;
    $('#srvTotalCandidates').textContent = candData?.total || 0;
    $('#srvAvgScore').textContent = candData?.avgScore || '-';

    const topList = $('#srvTopQueries');
    topList.innerHTML = '';
    if (searchData?.topQueries?.length) {
      for (const q of searchData.topQueries) {
        const li = document.createElement('li');
        li.className = 'top-query-item';
        li.innerHTML = `<span class="tq-query">"${q.query}"</span><span class="tq-count">${q.count}회</span><span class="tq-comp">경쟁 ${q.avgCompetition || '-'}점</span>`;
        li.addEventListener('click', () => chrome.tabs.create({ url: `https://www.coupang.com/np/search?q=${encodeURIComponent(q.query)}` }));
        topList.appendChild(li);
      }
    } else { topList.innerHTML = '<li class="empty-msg">아직 검색 기록이 없습니다.</li>'; }

    const statusDiv = $('#srvStatusCounts');
    statusDiv.innerHTML = '';
    if (candData?.statusCounts?.length) {
      for (const s of candData.statusCounts) {
        const chip = document.createElement('span');
        chip.className = `status-chip status-${s.status}`;
        chip.textContent = `${statusLabels[s.status] || s.status} ${s.count}`;
        statusDiv.appendChild(chip);
      }
    } else { statusDiv.innerHTML = '<span class="empty-msg">후보 없음</span>'; }
  } catch (e) { statsCard.style.display = 'none'; }
}

// ============================================================
//  환율 실시간 가져오기
// ============================================================

$('#fetchRateBtn').addEventListener('click', async () => {
  const btn = $('#fetchRateBtn');
  btn.disabled = true;
  btn.textContent = '⏳';
  try {
    // 공개 환율 API 사용
    const resp = await fetch('https://open.er-api.com/v6/latest/CNY');
    const data = await resp.json();
    if (data?.rates?.KRW) {
      const rate = Math.round(data.rates.KRW);
      $('#calcExchangeRate').value = rate;
      btn.textContent = '✅';
      setTimeout(() => { btn.textContent = '🔄'; btn.disabled = false; }, 2000);
    } else { throw new Error('환율 데이터 없음'); }
  } catch (e) {
    btn.textContent = '❌';
    setTimeout(() => { btn.textContent = '🔄'; btn.disabled = false; }, 2000);
    alert('환율 가져오기 실패. 네트워크를 확인하세요.');
  }
});

// ============================================================
//  마진 계산 결과 저장
// ============================================================

$('#exportMarginBtn').addEventListener('click', () => {
  const result = $('#calcResult');
  if (result.style.display === 'none') { alert('먼저 계산을 실행하세요.'); return; }
  const data = {
    date: new Date().toISOString().slice(0, 10),
    cnyCost: $('#calcCnyCost').value,
    exchangeRate: $('#calcExchangeRate').value,
    shipping: $('#calcShipping').value,
    taxRate: $('#calcTaxRate').value,
    salePrice: $('#calcSalePrice').value,
    commission: $('#calcCommission').value,
    costKrw: $('#resultCostKrw').textContent,
    totalCost: $('#resultTotalCost').textContent,
    profit: $('#resultProfit').textContent,
    margin: $('#resultMargin').textContent,
  };
  const bom = '\uFEFF';
  const csv = bom + Object.keys(data).join(',') + '\n' + Object.values(data).join(',');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `margin_calc_${data.date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});
