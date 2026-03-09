/* ============================================================
   Coupang Sourcing Helper — Server API Client v6.5
   lumiriz.kr 서버와 통신하는 API 클라이언트
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

  // ===== v6.5: 상세 페이지 확장 파싱 데이터 =====
  async saveDetailSnapshot(data) {
    return this._call('extension.saveDetailSnapshot', data, 'mutation');
  }

  async getDetailHistory(opts) {
    return this._call('extension.getDetailHistory', opts, 'query');
  }

  // ===== 내부 통신 =====
  async _call(procedure, input, type = 'query') {
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

    const resp = await fetch(url, options);
    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      const msg = errBody?.[0]?.error?.message || errBody?.error?.message || `HTTP ${resp.status}`;
      throw new Error(msg);
    }

    const data = await resp.json();
    if (Array.isArray(data)) return data[0];
    return data;
  }
}

const apiClient = new ApiClient();
