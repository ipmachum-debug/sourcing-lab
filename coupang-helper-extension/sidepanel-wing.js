/* Coupang Sourcing Helper — WING Tab & AI Analysis */

// ============================================================
//  WING 인기상품 탭
// ============================================================

async function loadWingTab() {
  // 통계 로드
  const statsResp = await chrome.runtime.sendMessage({ type: 'GET_WING_STATS' });
  const stats = statsResp?.data;

  if (stats && stats.totalSearches > 0) {
    $('#wingStatsGrid').style.display = '';
    $('#wingStatTotal').textContent = stats.totalSearches;
    $('#wingStatKeywords').textContent = stats.uniqueKeywords;
    $('#wingStatProducts').textContent = stats.totalProducts;
    $('#wingStatAvgPrice').textContent = stats.avgPrice ? formatPrice(stats.avgPrice) : '-';
    $('#wingStatusBadge').textContent = '수집 중';
    $('#wingStatusBadge').className = 'competition-badge level-medium';
    $('#wingStatusDesc').textContent = `총 ${stats.totalSearches}건의 인기상품 데이터가 수집되었습니다.`;
  }

  // 히스토리 로드
  const histResp = await chrome.runtime.sendMessage({ type: 'GET_WING_HISTORY', limit: 30 });
  const history = histResp?.data || [];

  const list = $('#wingSearchList');
  const empty = $('#wingEmpty');
  list.innerHTML = '';

  if (!history.length) {
    empty.style.display = '';
    $('#wingDetailCard').style.display = 'none';
    return;
  }
  empty.style.display = 'none';

  for (const h of history) {
    const div = document.createElement('div');
    div.className = 'tracked-keyword-item';
    const timeStr = new Date(h.capturedAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `
      <div class="tk-main">
        <span class="tk-query">${h.keyword || '(키워드 없음)'}</span>
        ${h.category ? `<span class="tk-target">${h.category}</span>` : ''}
        <span class="tk-target">${h.count}개 · ${formatPrice(h.avgPrice)} · ${timeStr}</span>
      </div>
      <div class="tk-actions">
        <button class="btn-sm tk-ai-btn" title="AI 소싱 분석" style="background:#8b5cf6;color:#fff;font-size:10px">🤖</button>
        <button class="btn-sm tk-view-btn">📊 상세</button>
        <button class="btn-sm tk-search-btn" title="쿠팡에서 검색">🔍</button>
      </div>
    `;

    div.querySelector('.tk-ai-btn').addEventListener('click', () => runAIAnalysis(h));
    div.querySelector('.tk-view-btn').addEventListener('click', () => loadWingDetail(h));
    div.querySelector('.tk-search-btn').addEventListener('click', () => {
      if (h.keyword) {
        chrome.tabs.create({ url: `https://www.coupang.com/np/search?q=${encodeURIComponent(h.keyword)}` });
      }
    });
    list.appendChild(div);
  }
}

function loadWingDetail(entry) {
  currentWingEntry = entry;
  const card = $('#wingDetailCard');
  card.style.display = '';
  $('#wingDetailTitle').textContent = entry.keyword || '(키워드 없음)';
  $('#wingDetailCount').textContent = entry.count || 0;

  const content = $('#wingDetailContent');
  const items = entry.items || [];

  if (!items.length) {
    content.innerHTML = '<p class="empty-msg">상세 상품 데이터가 없습니다.</p>';
    return;
  }

  let html = '<div class="rank-list">';
  for (const item of items.slice(0, 30)) {
    html += `
      <div class="rank-item">
        <span class="rank-pos">#${item.rank || '-'}</span>
        <div class="rank-info">
          <div class="rank-title">${item.productName || item.title || '(상품명 없음)'}</div>
          <div class="rank-meta">
            ${item.price ? formatPrice(item.price) : '-'}
            ${item.brand ? ` · ${item.brand}` : ''}
            ${item.rating ? ` · 평점 ${item.rating}` : ''}
            ${item.reviewCount ? ` · 리뷰 ${item.reviewCount}` : ''}
            ${item.viewCount ? ` · 조회 ${item.viewCount}` : ''}
          </div>
        </div>
      </div>`;
  }
  html += '</div>';
  content.innerHTML = html;
}

$('#clearWingBtn').addEventListener('click', async () => {
  if (!confirm('WING 인기상품 데이터를 모두 삭제할까요?')) return;
  await chrome.runtime.sendMessage({ type: 'CLEAR_WING_HISTORY' });
  loadWingTab();
});

// ============================================================
//  AI 소싱 코치 분석 시스템 (v5.0)
// ============================================================

let _aiAnalyzing = false;

// WING 검색 결과에서 AI 분석 실행
async function runAIAnalysis(entry) {
  if (_aiAnalyzing) return;
  _aiAnalyzing = true;
  currentWingEntry = entry;

  const panel = $('#aiAnalysisPanel');
  const loading = $('#aiLoading');
  const overview = $('#aiOverview');
  const topRecs = $('#aiTopRecs');
  const productList = $('#aiProductList');
  const suggestions = $('#aiSearchSuggestions');

  // UI 초기화
  panel.style.display = '';
  loading.style.display = '';
  overview.style.display = 'none';
  topRecs.style.display = 'none';
  productList.innerHTML = '';
  suggestions.style.display = 'none';

  try {
    // 서버 AI 분석 호출
    const items = (entry.items || []).map((p, i) => ({
      rank: p.rank || i + 1,
      productName: p.productName || p.title || '',
      price: p.price || 0,
      rating: p.rating || 0,
      reviewCount: p.reviewCount || 0,
      viewCount: p.viewCount || 0,
      brand: p.brand || '',
      manufacturer: p.manufacturer || '',
      category: p.category || entry.category || '',
      imageUrl: p.imageUrl || '',
    }));

    const resp = await chrome.runtime.sendMessage({
      type: 'AI_ANALYZE_WING',
      data: {
        keyword: entry.keyword || '',
        category: entry.category || '',
        products: items,
      }
    });

    loading.style.display = 'none';

    if (!resp?.ok || !resp.data) {
      productList.innerHTML = '<div class="empty-msg">AI 분석에 실패했습니다. 서버 연결을 확인해주세요.</div>';
      _aiAnalyzing = false;
      return;
    }

    const data = resp.data;
    currentAIAnalysis = data;

    // AI/규칙 뱃지
    $('#aiPoweredBadge').textContent = data.aiPowered ? 'AI' : '규칙 기반';
    $('#aiPoweredBadge').style.background = data.aiPowered ? 'linear-gradient(135deg, #8b5cf6, #6366f1)' : '#6b7280';

    // 시장 요약
    if (data.overview) {
      overview.style.display = '';
      $('#aiMarketSummary').textContent = data.overview.marketSummary || '-';
      const compLevel = data.overview.competitionLevel || '-';
      const compColors = { '낮음': '#059669', '보통': '#d97706', '높음': '#dc2626', '매우높음': '#7f1d1d' };
      $('#aiCompetitionLevel').innerHTML = `<span style="color:${compColors[compLevel] || '#6b7280'};font-weight:700">${compLevel}</span>`;
      $('#aiTrendInsight').textContent = data.overview.trendInsight || '-';
      $('#aiBestOpportunity').textContent = data.overview.bestOpportunity || '-';
    }

    // TOP 추천
    if (data.topRecommendations?.length) {
      topRecs.style.display = '';
      const recList = $('#aiTopRecsList');
      recList.innerHTML = '';
      data.topRecommendations.forEach((rec, i) => {
        const div = document.createElement('div');
        div.className = 'ai-rec-item';
        div.innerHTML = `
          <div class="ai-rec-rank ${i === 0 ? 'top1' : ''}">${i + 1}</div>
          <div class="ai-rec-info">
            <div class="ai-rec-name">${rec.productName}</div>
            <div class="ai-rec-reason">${rec.reason}</div>
            <div class="ai-rec-action">${rec.actionPlan}</div>
          </div>
        `;
        recList.appendChild(div);
      });
    }

    // 상품별 분석
    if (data.products?.length) {
      renderAIProducts(data.products, productList);
    }

    // 키워드 제안
    if (data.searchSuggestions) {
      suggestions.style.display = '';
      const sContent = $('#aiSuggestionsContent');
      let sHtml = '';
      if (data.searchSuggestions.relatedKeywords?.length) {
        sHtml += '<div class="ai-section"><div class="ai-section-label">추천 키워드</div><div class="ai-suggestion-tags">';
        data.searchSuggestions.relatedKeywords.forEach(kw => {
          sHtml += `<span class="ai-suggestion-tag" onclick="navigator.clipboard.writeText('${kw}').then(()=>this.style.background='#a7f3d0')">${kw}</span>`;
        });
        sHtml += '</div></div>';
      }
      if (data.searchSuggestions.avoidKeywords?.length) {
        sHtml += '<div class="ai-section"><div class="ai-section-label">피해야 할 키워드</div><div class="ai-suggestion-tags">';
        data.searchSuggestions.avoidKeywords.forEach(kw => {
          sHtml += `<span class="ai-suggestion-tag avoid">${kw}</span>`;
        });
        sHtml += '</div></div>';
      }
      if (data.searchSuggestions.nicheSuggestion) {
        sHtml += `<div class="ai-section"><div class="ai-section-label">니치 시장 제안</div><div class="ai-section-value">${data.searchSuggestions.nicheSuggestion}</div></div>`;
      }
      sContent.innerHTML = sHtml;
    }

  } catch (err) {
    loading.style.display = 'none';
    productList.innerHTML = `<div class="empty-msg">AI 분석 오류: ${err.message || '알 수 없는 오류'}</div>`;
  }

  _aiAnalyzing = false;
}

// AI 분석된 상품 목록 렌더링
function renderAIProducts(products, container) {
  container.innerHTML = '';

  const badgeColors = {
    '초보추천': { bg: '#d1fae5', color: '#065f46' },
    '고마진': { bg: '#d1fae5', color: '#065f46' },
    '저마진': { bg: '#fee2e2', color: '#991b1b' },
    '소싱쉬움': { bg: '#dbeafe', color: '#1e40af' },
    '경쟁약함': { bg: '#dbeafe', color: '#1e40af' },
    '경쟁심함': { bg: '#fee2e2', color: '#991b1b' },
    '인증필요': { bg: '#fee2e2', color: '#991b1b' },
    '파손위험': { bg: '#fef3c7', color: '#92400e' },
    '계절상품': { bg: '#ede9fe', color: '#6d28d9' },
    '배송주의': { bg: '#fef3c7', color: '#92400e' },
    '옵션복잡': { bg: '#ede9fe', color: '#6d28d9' },
  };

  for (const p of products) {
    const card = document.createElement('div');
    card.className = 'ai-product-card';

    const badgesHtml = (p.badges || []).map(b => {
      const c = badgeColors[b] || { bg: '#f3f4f6', color: '#6b7280' };
      return `<span class="ai-product-badge" style="background:${c.bg};color:${c.color}">${b}</span>`;
    }).join('');

    const fit = p.beginnerFit || {};
    const difficultyLabels = { easy: '쉬움', medium: '보통', hard: '어려움', expert: '전문가' };
    const fitClass = fit.difficulty || 'medium';

    card.innerHTML = `
      <div class="ai-product-header">
        <div class="ai-product-rank">${p.rank || '-'}</div>
        <div class="ai-product-name" title="${p.productName}">${p.productName}</div>
        <div class="ai-product-badges">${badgesHtml}</div>
        <span class="ai-product-toggle">▼</span>
      </div>
      <div class="ai-product-body">
        <!-- 초보 적합도 -->
        <div class="ai-beginner-fit ${fitClass}">
          <div class="ai-fit-score">${fit.score || '-'}</div>
          <div class="ai-fit-info">
            <div style="font-size:11px;font-weight:600">${fit.reason || '-'}</div>
            <span class="ai-fit-difficulty">${difficultyLabels[fit.difficulty] || '?'}</span>
          </div>
        </div>

        <!-- 코치 코멘트 -->
        ${p.coachComment ? `<div class="ai-coach-comment">${p.coachComment}</div>` : ''}

        <!-- 상품 용도 -->
        ${p.purpose ? `<div class="ai-section"><div class="ai-section-label">용도</div><div class="ai-section-value">${p.purpose}</div></div>` : ''}

        <!-- 셀링 포인트 -->
        ${p.sellingPoints?.length ? `
          <div class="ai-section">
            <div class="ai-section-label">핵심 포인트</div>
            <ul class="ai-selling-points">${p.sellingPoints.map(sp => `<li>${sp}</li>`).join('')}</ul>
          </div>` : ''}

        <!-- 마진 -->
        ${p.margin ? `
          <div class="ai-section">
            <div class="ai-section-label">마진 분석</div>
            <div class="ai-margin-bar">
              <span class="ai-margin-label">예상 원가</span>
              <span class="ai-margin-value">${p.margin.estimatedCnyCost || '-'}</span>
            </div>
            <div class="ai-margin-bar">
              <span class="ai-margin-label">예상 마진</span>
              <span class="ai-margin-value ${parseFloat(p.margin.expectedMarginRate) >= 30 ? 'ai-margin-good' : parseFloat(p.margin.expectedMarginRate) >= 15 ? 'ai-margin-caution' : 'ai-margin-danger'}">${p.margin.expectedMarginRate || '-'}</span>
            </div>
            <div class="ai-margin-bar">
              <span class="ai-margin-label">조언</span>
              <span class="ai-section-value">${p.margin.advice || '-'}</span>
            </div>
          </div>` : ''}

        <!-- 리스크 -->
        ${p.risks?.length ? `
          <div class="ai-section">
            <div class="ai-section-label">리스크</div>
            <ul class="ai-risk-list">${p.risks.map(r => `<li>${r}</li>`).join('')}</ul>
          </div>` : ''}

        <!-- 소싱 키워드 -->
        ${p.keywords ? `
          <div class="ai-section">
            <div class="ai-section-label">소싱 키워드</div>
            <div class="ai-keyword-row">
              ${p.keywords.korean ? `<span class="ai-keyword-tag ko" onclick="navigator.clipboard.writeText('${p.keywords.korean}').then(()=>this.style.opacity='0.5')" title="클릭하여 복사">🇰🇷 ${p.keywords.korean}</span>` : ''}
              ${p.keywords.chinese ? `<span class="ai-keyword-tag cn" onclick="navigator.clipboard.writeText('${p.keywords.chinese}').then(()=>this.style.opacity='0.5')" title="클릭하여 복사">🇨🇳 ${p.keywords.chinese}</span>` : ''}
              ${p.keywords.english ? `<span class="ai-keyword-tag en" onclick="navigator.clipboard.writeText('${p.keywords.english}').then(()=>this.style.opacity='0.5')" title="클릭하여 복사">🇺🇸 ${p.keywords.english}</span>` : ''}
            </div>
            <div class="ai-search-btns">
              ${p.keywords.chinese ? `<button class="ai-search-btn btn-1688" onclick="window.open('https://s.1688.com/selloffer/offer_search.htm?keywords='+'${p.keywords.chinese}'.replace(/\\s+/g,'+')+'&charset=utf8')">1688 검색</button>` : ''}
              ${p.keywords.english ? `<button class="ai-search-btn btn-ali" onclick="window.open('https://www.aliexpress.com/wholesale?SearchText='+encodeURIComponent('${p.keywords.english}'))">AliExpress</button>` : ''}
              ${p.keywords.korean ? `<button class="ai-search-btn" onclick="window.open('https://www.coupang.com/np/search?q='+encodeURIComponent('${p.keywords.korean}'))">쿠팡 검색</button>` : ''}
            </div>
          </div>` : ''}

        <!-- 규칙 기반 점수 (있으면) -->
        ${p.ruleBasedScore ? `
          <div class="ai-section" style="margin-top:8px;padding-top:8px;border-top:1px solid #e5e7eb">
            <div class="ai-section-label">소싱 점수 (규칙 기반)</div>
            <div style="display:flex;gap:6px;align-items:center;font-size:11px">
              <span class="coach-grade-badge" style="background:${p.ruleBasedScore.grade === 'S' ? '#16a34a' : p.ruleBasedScore.grade === 'A' ? '#3b82f6' : p.ruleBasedScore.grade === 'B' ? '#f59e0b' : '#9ca3af'};color:#fff;padding:2px 6px;border-radius:4px;font-weight:700;font-size:10px">${p.ruleBasedScore.grade}</span>
              <span>${p.ruleBasedScore.total}점</span>
              <span style="color:#6b7280">(마진${p.ruleBasedScore.breakdown.margin} 경쟁${p.ruleBasedScore.breakdown.competition} 소싱${p.ruleBasedScore.breakdown.sourcingEase} 옵션${p.ruleBasedScore.breakdown.optionSimplicity} 인증${p.ruleBasedScore.breakdown.certStability} 배송${p.ruleBasedScore.breakdown.deliveryStability} 리뷰${p.ruleBasedScore.breakdown.reviewPotential})</span>
            </div>
          </div>` : ''}
      </div>
    `;

    // 아코디언 토글
    const header = card.querySelector('.ai-product-header');
    const body = card.querySelector('.ai-product-body');
    const toggle = card.querySelector('.ai-product-toggle');
    header.addEventListener('click', () => {
      body.classList.toggle('expanded');
      toggle.classList.toggle('expanded');
    });

    container.appendChild(card);
  }
}

// 전체 분석 버튼 (최신 WING 검색 결과를 AI 분석)
$('#aiAnalyzeAllBtn').addEventListener('click', async () => {
  const histResp = await chrome.runtime.sendMessage({ type: 'GET_WING_HISTORY', limit: 1 });
  const history = histResp?.data || [];
  if (!history.length) {
    alert('분석할 WING 인기상품 데이터가 없습니다.\nWING 셀러센터에서 인기상품검색을 먼저 해주세요.');
    return;
  }
  runAIAnalysis(history[0]);
});

// 상세 보기에서 AI 분석 버튼
$('#aiAnalyzeDetailBtn').addEventListener('click', () => {
  if (currentWingEntry) {
    runAIAnalysis(currentWingEntry);
  } else {
    alert('먼저 WING 검색 결과를 선택해주세요.');
  }
});
