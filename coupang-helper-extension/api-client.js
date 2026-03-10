/* ============================================================
   Coupang Sourcing Helper — Server API Client v7.2.1
   lumiriz.kr 서버와 통신하는 API 클라이언트
   v7.2.1: API 통신 강화 — 리트라이/타임아웃/인증 갱신/동시요청 큐
   v7.2: 셀러라이프 방식 다중 전략 수집 통합
   v7.1: tRPC SuperJSON 래핑(result.data.json) 자동 해제
   + AI 소싱 코치 + 하이브리드 수집 + 자동 순회 수집
   + 상세 페이지 확장 파싱 데이터 저장
   ============================================================ */

const API_BASE = 'https://lumiriz.kr/api/trpc';

class ApiClient {
  constructor() {
    this._sessionCookie = null;
  }

  // ===== 인증 =====
  async login(email, password) {
    const resp = await this._call('auth.login', { email, password }, 'mutation');
    if (resp?.result?.data?.success) {
      await chrome.storage.local.set({ serverLoggedIn: true, serverEmail: email });
      return { success: true, user: resp.result.data.user };
    }
    throw new Error(resp?.error?.message || '로그인 실패');
  }

  async checkAuth() {
    try {
      const resp = await this._call('auth.me', undefined, 'query');
      const user = resp?.result?.data;
      if (user) {
        await chrome.storage.local.set({ serverLoggedIn: true });
        return { loggedIn: true, user };
      }
      await chrome.storage.local.set({ serverLoggedIn: false });
      return { loggedIn: false, user: null };
    } catch (e) {
      await chrome.storage.local.set({ serverLoggedIn: false });
      return { loggedIn: false, user: null };
    }
  }

  // ===== 검색 스냅샷 =====
  async saveSnapshot(data) {
    return this._call('extension.saveSnapshot', data, 'mutation');
  }

  async listSnapshots(opts = {}) {
    return this._call('extension.listSnapshots', opts, 'query');
  }

  async searchStats() {
    return this._call('extension.searchStats', undefined, 'query');
  }

  // ===== 소싱 후보 =====
  async saveCandidate(item) {
    return this._call('extension.saveCandidate', item, 'mutation');
  }

  async removeCandidate(id) {
    return this._call('extension.removeCandidate', { id }, 'mutation');
  }

  async listCandidates(opts = {}) {
    return this._call('extension.listCandidates', opts, 'query');
  }

  async promoteToProduct(candidateId) {
    return this._call('extension.promoteToProduct', { candidateId }, 'mutation');
  }

  async candidateStats() {
    return this._call('extension.candidateStats', undefined, 'query');
  }

  // ===== 순위 추적 =====
  async addTrackedKeyword(data) {
    return this._call('extension.addTrackedKeyword', data, 'mutation');
  }

  async removeTrackedKeyword(id) {
    return this._call('extension.removeTrackedKeyword', { id }, 'mutation');
  }

  async listTrackedKeywords() {
    return this._call('extension.listTrackedKeywords', undefined, 'query');
  }

  async saveRankData(data) {
    return this._call('extension.saveRankData', data, 'mutation');
  }

  async getRankHistory(opts) {
    return this._call('extension.getRankHistory', opts, 'query');
  }

  async getLatestRanking(opts) {
    return this._call('extension.getLatestRanking', opts, 'query');
  }

  // ===== 상품 상세 =====
  async saveProductDetail(data) {
    return this._call('extension.saveProductDetail', data, 'mutation');
  }

  async getProductHistory(opts) {
    return this._call('extension.getProductHistory', opts, 'query');
  }

  // ===== WING 인기상품 =====
  async saveWingSearch(data) {
    return this._call('extension.saveWingSearch', data, 'mutation');
  }

  async wingSearches(opts = {}) {
    return this._call('extension.listWingSearches', opts, 'query');
  }

  async wingStats() {
    return this._call('extension.wingStats', undefined, 'query');
  }

  // ===== 소싱 코치 (v4.3) =====
  async analyzeProduct(data) {
    return this._call('sourcingCoach.analyzeProduct', data, 'mutation');
  }

  async analyzeBatch(data) {
    return this._call('sourcingCoach.analyzeBatch', data, 'mutation');
  }

  async generateKeywords(title) {
    return this._call('sourcingCoach.generateKeywords', { title }, 'query');
  }

  async calculateMarginServer(data) {
    return this._call('sourcingCoach.calculateMargin', data, 'query');
  }

  async analyzeRisk(data) {
    return this._call('sourcingCoach.analyzeRisk', data, 'query');
  }

  async getExchangeRate() {
    return this._call('sourcingCoach.getExchangeRate', undefined, 'query');
  }

  // ===== AI 소싱 코치 v5.0 (WING 인기상품 AI 분석) =====
  async aiAnalyzeWing(data) {
    return this._call('sourcingCoach.aiAnalyzeWing', data, 'mutation');
  }

  async aiAnalyzeWingProduct(data) {
    return this._call('sourcingCoach.aiAnalyzeWingProduct', data, 'mutation');
  }

  // ===== AI 사전매칭 v5.1 (상품명 → 1688 검색어 자동 생성) =====
  async preMatch(data) {
    return this._call('sourcingCoach.preMatch', data, 'mutation');
  }

  // ===== 판매량 추정 시스템 v6.0 =====
  async getCategoryReviewRates() {
    return this._call('extension.getCategoryReviewRates', undefined, 'query');
  }

  async updateCategoryReviewRate(data) {
    return this._call('extension.updateCategoryReviewRate', data, 'mutation');
  }

  async estimateSingleProduct(data) {
    return this._call('extension.estimateSingleProduct', data, 'mutation');
  }

  async runSalesEstimateBatch(data = {}) {
    return this._call('extension.runSalesEstimateBatch', data, 'mutation');
  }

  async getProductSalesEstimates(opts) {
    return this._call('extension.getProductSalesEstimates', opts, 'query');
  }

  async salesEstimateDashboard() {
    return this._call('extension.salesEstimateDashboard', undefined, 'query');
  }

  // ===== 하이브리드 데이터 수집 시스템 v6.2 =====
  async saveSearchEvent(data) {
    return this._call('extension.saveSearchEvent', data, 'mutation');
  }

  async listWatchKeywords(opts = {}) {
    return this._call('extension.listWatchKeywords', opts, 'query');
  }

  async updateWatchKeyword(data) {
    return this._call('extension.updateWatchKeyword', data, 'mutation');
  }

  async deleteWatchKeyword(id) {
    return this._call('extension.deleteWatchKeyword', { id }, 'mutation');
  }

  async getKeywordDailyStatusHistory(opts) {
    return this._call('extension.getKeywordDailyStatusHistory', opts, 'query');
  }

  async runDailyBatchCollection(opts = {}) {
    return this._call('extension.runDailyBatchCollection', opts, 'mutation');
  }

  async getBatchKeywordSelection(opts = {}) {
    return this._call('extension.getBatchKeywordSelection', opts, 'query');
  }

  async listSearchEvents(opts = {}) {
    return this._call('extension.listSearchEvents', opts, 'query');
  }

  async hybridCollectionDashboard() {
    return this._call('extension.hybridCollectionDashboard', undefined, 'query');
  }

  async diagnoseParseQuality(keyword) {
    return this._call('extension.diagnoseParseQuality', { keyword }, 'query');
  }

  // ===== v6.4: 자동 순회 수집기 (Auto-Collect) =====
  async markKeywordCollected(data) {
    return this._call('extension.markKeywordCollected', data, 'mutation');
  }

  async markKeywordFailed(data) {
    return this._call('extension.markKeywordFailed', data, 'mutation');
  }

  async getAutoCollectStats() {
    return this._call('extension.autoCollectStats', undefined, 'query');
  }

  async autoCollectComplete(data = {}) {
    return this._call('extension.autoCollectComplete', data, 'mutation');
  }

  // ===== v6.5: 상세 페이지 확장 파싱 데이터 =====
  async saveDetailSnapshot(data) {
    return this._call('extension.saveDetailSnapshot', data, 'mutation');
  }

  async getDetailHistory(opts) {
    return this._call('extension.getDetailHistory', opts, 'query');
  }

  // ===== v7.2: 내부 통신 (리트라이·타임아웃·인증 갱신 강화) =====

  // 동시 요청 큐 — 서버 과부하 방지 (최대 3개)
  _concurrency = 0;
  _maxConcurrency = 3;
  _requestQueue = [];

  async _enqueue(fn) {
    if (this._concurrency < this._maxConcurrency) {
      this._concurrency++;
      try { return await fn(); }
      finally { this._concurrency--; this._drainQueue(); }
    }
    return new Promise((resolve, reject) => {
      this._requestQueue.push(() => fn().then(resolve).catch(reject));
    });
  }

  _drainQueue() {
    while (this._requestQueue.length > 0 && this._concurrency < this._maxConcurrency) {
      this._concurrency++;
      const next = this._requestQueue.shift();
      next().finally(() => { this._concurrency--; this._drainQueue(); });
    }
  }

  async _call(procedure, input, type = 'query', _retryCount = 0) {
    return this._enqueue(() => this._callInner(procedure, input, type, _retryCount));
  }

  async _callInner(procedure, input, type = 'query', _retryCount = 0) {
    const url = type === 'query'
      ? `${API_BASE}/${procedure}${input ? '?input=' + encodeURIComponent(JSON.stringify({ json: input })) : ''}`
      : `${API_BASE}/${procedure}`;

    const options = {
      method: type === 'query' ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    };

    if (type !== 'query' && input !== undefined) {
      options.body = JSON.stringify({ json: input });
    }

    // v7.2: 타임아웃 (30초 일반, 60초 배치/AI)
    const isBatch = procedure.includes('Batch') || procedure.includes('batch') || procedure.includes('ai');
    const timeout = isBatch ? 60000 : 30000;
    const controller = new AbortController();
    options.signal = controller.signal;
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const resp = await fetch(url, options);
      clearTimeout(timer);

      // v7.2: 401 인증 만료 → 자동 재인증 시도 (1회)
      if (resp.status === 401 && _retryCount === 0) {
        console.warn('[API] 인증 만료 감지, 재인증 시도...');
        const { serverEmail, serverPassword } = await chrome.storage.local.get(['serverEmail', 'serverPassword']);
        if (serverEmail) {
          try {
            await this.checkAuth();
            return this._callInner(procedure, input, type, 1);
          } catch (_) {
            await chrome.storage.local.set({ serverLoggedIn: false });
          }
        }
        throw new Error('인증 만료 — 재로그인 필요');
      }

      // v7.2: 429 Too Many Requests → 지수 백오프 리트라이
      if (resp.status === 429 && _retryCount < 3) {
        const delay = Math.pow(2, _retryCount) * 1000 + Math.random() * 1000;
        console.warn(`[API] 429 Too Many Requests, ${Math.round(delay/1000)}초 후 재시도 (${_retryCount + 1}/3)`);
        await new Promise(r => setTimeout(r, delay));
        return this._callInner(procedure, input, type, _retryCount + 1);
      }

      // v7.2: 5xx 서버 에러 → 1회 리트라이
      if (resp.status >= 500 && _retryCount < 2) {
        const delay = 2000 + Math.random() * 3000;
        console.warn(`[API] 서버 에러 ${resp.status}, ${Math.round(delay/1000)}초 후 재시도`);
        await new Promise(r => setTimeout(r, delay));
        return this._callInner(procedure, input, type, _retryCount + 1);
      }

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        const msg = errBody?.[0]?.error?.message || errBody?.error?.message || `HTTP ${resp.status}`;
        throw new Error(msg);
      }

      const data = await resp.json();
      // tRPC 배치 응답은 배열로 래핑됨: [{result:{data:{json:...}}}]
      const unwrapped = Array.isArray(data) ? data[0] : data;
      // tRPC SuperJSON 래핑 해제: result.data.json → result.data
      if (unwrapped?.result?.data?.json !== undefined) {
        unwrapped.result.data = unwrapped.result.data.json;
      }
      return unwrapped;
    } catch (e) {
      clearTimeout(timer);

      // v7.2: 네트워크 에러 (오프라인, DNS 등) → 1회 리트라이
      if (e.name === 'AbortError') {
        throw new Error(`요청 타임아웃 (${timeout/1000}초): ${procedure}`);
      }
      if (e.name === 'TypeError' && _retryCount < 1) {
        // fetch 자체가 실패 (네트워크 끊김)
        const delay = 3000;
        console.warn(`[API] 네트워크 에러, ${delay/1000}초 후 재시도:`, e.message);
        await new Promise(r => setTimeout(r, delay));
        return this._callInner(procedure, input, type, _retryCount + 1);
      }

      throw e;
    }
  }
}

const apiClient = new ApiClient();
