/* Coupang Sourcing Helper — Analysis Tab */

// ============================================================
//  분석 탭
// ============================================================

function analyzeCompetition(items) {
  if (!items.length) return null;
  const prices = items.map(i => i.price).filter(p => p > 0);
  const reviews = items.map(i => i.reviewCount).filter(r => r > 0);
  const ratings = items.map(i => i.rating).filter(r => r > 0);
  const avgPrice = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
  const avgReview = reviews.length ? Math.round(reviews.reduce((a, b) => a + b, 0) / reviews.length) : 0;
  const avgRating = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : 0;
  const highReviewCount = items.filter(i => i.reviewCount >= 100).length;
  const highReviewRatio = Math.round((highReviewCount / items.length) * 100);
  const adCount = items.filter(i => i.isAd).length;

  // ★ v8.2.0: 연속 로그 스케일 경쟁도 (0–100 균등 분산)
  // 기존: 4개 지표 × 고정 버킷 → 63~90 사이 밀집
  // 개선: 각 지표를 연속 함수로 산출 후 가중합산
  const adRatio = adCount / items.length;

  // 축 1: 평균 리뷰 수 (0–35점) — log 스케일
  const reviewAxis = avgReview > 0
    ? Math.min(35, (Math.log10(avgReview) / 4) * 35)
    : 0;

  // 축 2: 고리뷰 비율 (0–25점) — 선형
  const highReviewAxis = Math.min(25, (highReviewRatio / 80) * 25);

  // 축 3: 평균 평점 (0–20점) — 4.0 미만=0, 4.0–5.0 선형
  const ratingVal = parseFloat(avgRating) || 0;
  const ratingAxis = ratingVal >= 4.0
    ? Math.min(20, ((ratingVal - 4.0) / 1.0) * 20)
    : 0;

  // 축 4: 광고 비율 (0–20점) — 선형
  const adAxis = Math.min(20, (adRatio / 0.4) * 20);

  const competitionScore = Math.round(Math.min(100, reviewAxis + highReviewAxis + ratingAxis + adAxis));

  let level, levelText, levelCls;
  if (competitionScore >= 65) { level = '강함'; levelText = '경쟁이 매우 치열합니다. 차별화 전략이 필요합니다.'; levelCls = 'level-hard'; }
  else if (competitionScore >= 35) { level = '보통'; levelText = '경쟁이 있지만 진입 가능합니다.'; levelCls = 'level-medium'; }
  else { level = '약함'; levelText = '경쟁이 낮습니다. 소싱 기회!'; levelCls = 'level-easy'; }

  return { competitionScore, level, levelText, levelCls, avgPrice, avgReview, avgRating, highReviewRatio, adCount, totalItems: items.length };
}

function renderItems(items, comp) {
  const results = $('#results');
  const tpl = $('#itemTemplate');
  results.innerHTML = '';
  if (!items.length) { results.innerHTML = '<li class="empty-msg">표시할 상품이 없습니다.</li>'; return; }

  const avgPrice = comp?.avgPrice || 0;
  const avgReview = comp?.avgReview || 0;

  for (const item of items) {
    const node = tpl.content.cloneNode(true);
    const img = node.querySelector('.item-img');
    if (item.imageUrl) { img.src = item.imageUrl; img.alt = item.title; } else { img.style.display = 'none'; }

    const badges = node.querySelector('.item-badges');
    let badgeHtml = `<span class="badge-rank">#${item.position}</span>`;
    if (item.isAd) badgeHtml += '<span class="badge-ad">AD</span>';
    if (item.isRocket) badgeHtml += '<span class="badge-rocket">🚀</span>';
    badges.innerHTML = badgeHtml;

    node.querySelector('.title').textContent = item.title || '(제목 없음)';
    node.querySelector('.price-line').textContent = item.price ? formatPrice(item.price) : '-';
    node.querySelector('.meta-line').textContent = `평점 ${item.rating || '-'} · 리뷰 ${item.reviewCount?.toLocaleString() || '0'}개`;

    // 소싱 코치 5-line 표시
    const coach = coachResults?.[item.productId || item.url];
    const coachSection = node.querySelector('.coach-section');
    if (coach && coachSection) {
      const s = coach.score || {};
      const m = coach.margin || {};
      const r = coach.risk || {};
      const bg = coach.badges || [];
      const riskColor = r.level === 'critical' ? '#dc2626' : r.level === 'high' ? '#f97316' : r.level === 'medium' ? '#eab308' : '#22c55e';
      const marginColor = m.adviceType === 'good' ? '#059669' : m.adviceType === 'caution' ? '#d97706' : '#dc2626';
      const gradeColor = s.grade === 'S' ? '#16a34a' : s.grade === 'A' ? '#3b82f6' : s.grade === 'B' ? '#f59e0b' : '#9ca3af';

      coachSection.innerHTML = `
        <div class="coach-line coach-score-line">
          <span class="coach-grade-badge" style="background:${gradeColor}">${s.grade || '-'}</span>
          <span class="coach-score-text">${s.total || 0}점 · ${s.gradeLabel || '-'}</span>
          <div class="coach-score-bar"><div class="coach-score-fill" style="width:${s.total||0}%;background:${gradeColor}"></div></div>
        </div>
        <div class="coach-line coach-margin-line">
          <span class="coach-label">💰 마진</span>
          <span class="coach-value" style="color:${marginColor}" title="${(m.tooltip || '').replace(/"/g, '&quot;')}">${m.marginRate != null ? m.marginRate + '%' : '-'} (${m.advice || '-'})</span>
        </div>
        <div class="coach-line coach-risk-line">
          <span class="coach-label">⚡ 리스크</span>
          <span class="coach-value" style="color:${riskColor}">${r.level === 'low' ? '낮음' : r.level === 'medium' ? '보통' : r.level === 'high' ? '높음' : '매우높음'}</span>
          ${r.warnings?.slice(0,3).map(w => `<span class="coach-risk-tag" style="border-color:${w.severity==='danger'?'#dc2626':w.severity==='warn'?'#f59e0b':'#6b7280'}">${w.icon||''} ${w.label}</span>`).join('') || ''}
        </div>
        <div class="coach-line coach-badges-line">
          ${bg.slice(0,4).map(b => `<span class="coach-badge" style="background:${b.color}15;color:${b.color};border:1px solid ${b.color}40">${b.icon} ${b.label}</span>`).join('')}
        </div>
      `;
      coachSection.style.display = '';
    } else if (coachSection) {
      // 코치 결과 없을 때 기존 점수 표시
      const sourcingScore = calcSourcingScore(item, avgPrice, avgReview);
      item._sourcingScore = sourcingScore;
      const grade = getSourcingGrade(sourcingScore);
      item._sourcingGrade = grade.grade;
      coachSection.innerHTML = `<div class="coach-line"><span class="score-value ${grade.cls}">${grade.grade} (${sourcingScore}점)</span></div>`;
      coachSection.style.display = '';
    }

    // 기존 score-value는 숨김 (코치 섹션으로 대체)
    const scoreEl = node.querySelector('.score-value');
    if (scoreEl && coach) scoreEl.style.display = 'none';
    else if (scoreEl && !coach) {
      const sourcingScore = calcSourcingScore(item, avgPrice, avgReview);
      item._sourcingScore = sourcingScore;
      const grade = getSourcingGrade(sourcingScore);
      item._sourcingGrade = grade.grade;
      scoreEl.textContent = `${grade.grade} (${sourcingScore}점)`;
      scoreEl.className = `score-value ${grade.cls}`;
    }

    // 액션 버튼
    node.querySelector('.btn-1688').addEventListener('click', (e) => {
      showSourcingPopup(item.title, item.imageUrl, e.target, currentData?.query);
    });

    const saveBtn = node.querySelector('.btn-save');
    saveBtn.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'SAVE_CANDIDATE', item });
      saveBtn.textContent = '✅';
      saveBtn.disabled = true;
    });

    node.querySelector('.btn-track').addEventListener('click', async () => {
      const query = currentData?.query || '';
      if (!query) { alert('검색어를 감지할 수 없습니다.'); return; }
      await chrome.runtime.sendMessage({
        type: 'ADD_TRACKED_KEYWORD',
        keyword: { query, targetProductId: item.productId, targetProductName: item.title }
      });
      alert(`"${query}" 키워드 순위 추적이 등록되었습니다.`);
    });

    node.querySelector('.btn-link').href = item.url;
    results.appendChild(node);
  }
}

function getFilteredSorted() {
  if (!currentData?.items) return [];
  let items = [...currentData.items];
  if ($('#filterNoAd').checked) items = items.filter(i => !i.isAd);
  if ($('#filterEasySourcing').checked) {
    const comp = analyzeCompetition(currentData.items);
    items.forEach(i => { i._sourcingScore = calcSourcingScore(i, comp?.avgPrice || 0, comp?.avgReview || 0); });
    items = items.filter(i => i._sourcingScore >= 60);
  }
  const topN = parseInt($('#topNSelect').value) || 0;
  if (topN > 0) items = items.slice(0, topN);
  const sort = $('#sortSelect').value;
  switch (sort) {
    case 'price-asc': items.sort((a, b) => (a.price || 0) - (b.price || 0)); break;
    case 'price-desc': items.sort((a, b) => (b.price || 0) - (a.price || 0)); break;
    case 'review-desc': items.sort((a, b) => (b.reviewCount || 0) - (a.reviewCount || 0)); break;
    case 'rating-desc': items.sort((a, b) => (b.rating || 0) - (a.rating || 0)); break;
    case 'sourcing-desc': {
      const comp = analyzeCompetition(currentData.items);
      items.forEach(i => { i._sourcingScore = calcSourcingScore(i, comp?.avgPrice || 0, comp?.avgReview || 0); });
      items.sort((a, b) => (b._sourcingScore || 0) - (a._sourcingScore || 0));
      break;
    }
  }
  return items;
}

function renderAnalysis(data) {
  currentData = data;
  if (!data || !data.items?.length) {
    $('#summary').textContent = '쿠팡 검색 결과 페이지를 열면 자동 분석됩니다.';
    $('#competitionCard').style.display = 'none';
    $('#statsGrid').style.display = 'none';
    $('#filterBar').style.display = 'none';
    $('#results').innerHTML = '';
    coachResults = null;
    return;
  }
  $('#summary').textContent = `"${data.query || '-'}" · ${data.count}개 · ${new Date(data.capturedAt).toLocaleTimeString('ko-KR')}`;

  const comp = analyzeCompetition(data.items);
  if (comp) {
    $('#competitionCard').style.display = '';
    $('#competitionBadge').textContent = `${comp.level} (${comp.competitionScore}점)`;
    $('#competitionBadge').className = `competition-badge ${comp.levelCls}`;
    $('#competitionDetails').innerHTML = `<div>${comp.levelText}</div><div class="comp-stats">상품 ${comp.totalItems}개 · 광고 ${comp.adCount}개 · 리뷰100+ ${comp.highReviewRatio}%</div>`;
    $('#statsGrid').style.display = '';
    $('#statAvgPrice').textContent = formatPrice(comp.avgPrice);
    $('#statAvgRating').textContent = comp.avgRating || '-';
    $('#statAvgReview').textContent = comp.avgReview?.toLocaleString() || '-';
    $('#statHighReviewRatio').textContent = comp.highReviewRatio + '%';
  }
  $('#filterBar').style.display = '';

  // 소싱 코치 분석 실행 → 완료 후 렌더링
  runCoachAnalysis(data.items, data.query).then(() => {
    renderItems(getFilteredSorted(), comp);
  });
}

$('#sortSelect').addEventListener('change', () => renderAnalysis(currentData));
$('#filterNoAd').addEventListener('change', () => renderAnalysis(currentData));
$('#filterEasySourcing').addEventListener('change', () => renderAnalysis(currentData));
$('#topNSelect').addEventListener('change', () => renderAnalysis(currentData));

// ============================================================
//  CSV 내보내기
// ============================================================

function exportToCSV(items, query) {
  if (!items?.length) { alert('내보낼 데이터가 없습니다.'); return; }
  const comp = analyzeCompetition(items);
  const headers = ['순위', '상품명', '가격', '평점', '리뷰수', '소싱점수', '소싱등급', '광고', '로켓배송', 'URL'];
  const rows = items.map(item => {
    const score = calcSourcingScore(item, comp?.avgPrice || 0, comp?.avgReview || 0);
    const grade = getSourcingGrade(score);
    return [
      item.position,
      `"${(item.title || '').replace(/"/g, '""')}"`,
      item.price || 0,
      item.rating || 0,
      item.reviewCount || 0,
      score,
      grade.grade,
      item.isAd ? 'Y' : 'N',
      item.isRocket ? 'Y' : 'N',
      item.url || '',
    ].join(',');
  });
  const bom = '\uFEFF'; // UTF-8 BOM for Korean
  const csv = bom + headers.join(',') + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `coupang_${(query || 'analysis').replace(/[^a-zA-Z0-9가-힣]/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

$('#exportCsvBtn')?.addEventListener('click', () => {
  exportToCSV(getFilteredSorted(), currentData?.query);
});
