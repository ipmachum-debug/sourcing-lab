import crypto from "crypto";

// 네이버 광고 API 클라이언트 (HMAC SHA256 서명 방식)
// Docs: https://naver.github.io/searchad-apidoc/

const BASE_URL = "https://api.searchad.naver.com";

function generateSignature(
  timestamp: string,
  method: string,
  uri: string,
  secret: string,
) {
  const message = `${timestamp}.${method}.${uri}`;
  return crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("base64");
}

function getHeaders(method: string, uri: string) {
  const apiKey = process.env.NAVER_API_KEY;
  const secret = process.env.NAVER_SECRET_KEY;
  const customerId = process.env.NAVER_CUSTOMER_ID;

  if (!apiKey || !secret || !customerId) {
    throw new Error("네이버 광고 API 키가 설정되지 않았습니다. (.env에 NAVER_API_KEY, NAVER_SECRET_KEY, NAVER_CUSTOMER_ID 필요)");
  }

  const timestamp = Date.now().toString();
  const signature = generateSignature(timestamp, method, uri, secret);

  return {
    "X-Timestamp": timestamp,
    "X-API-KEY": apiKey,
    "X-Customer": customerId,
    "X-Signature": signature,
  };
}

export interface NaverKeywordResult {
  relKeyword: string;
  monthlyPcQcCnt: number;
  monthlyMobileQcCnt: number;
  monthlyAvgPcQcCnt?: number;
  monthlyAvgMobileQcCnt?: number;
  compIdx: string; // "높음" | "중간" | "낮음"
  plAvgDepth?: number;
  monthlyAvgPcClkCnt?: number;
  monthlyAvgMobileClkCnt?: number;
}

/**
 * 키워드 정규화: 공백·특수문자 제거 + 소문자
 * "현금 파우치" → "현금파우치"
 * "LED 조명" → "led조명"
 */
export function normalizeNaverKeyword(kw: string): string {
  return kw.replace(/\s+/g, "").replace(/[·,.\-_\/\\()\[\]{}"']+/g, "").trim().toLowerCase();
}

/**
 * 동종언어 매핑: 원본 키워드와 네이버 relKeyword 매칭 여부 판단
 * - 정규화 후 완전 일치
 * - 띄어쓰기 변형 허용 ("냄비 받침" == "냄비받침")
 * - 특수문자 무시 ("오트밀·국수" == "오트밀국수")
 * - 괄호/따옴표 무시 ("에어팟(3세대)" == "에어팟3세대")
 */
export function isNaverKeywordMatch(original: string, relKeyword: string): boolean {
  return normalizeNaverKeyword(original) === normalizeNaverKeyword(relKeyword);
}

/**
 * ★ v8.5.6: 키워드 변형 생성 (네이버 동종언어 매핑 개선)
 *
 * 네이버 API는 공백 포함 키워드를 400으로 거부하지만,
 * 사용자의 감시 키워드에는 공백이 포함될 수 있음.
 * 이 함수는 원본 + 공백제거 + 일반적 변형을 생성하여
 * API 호출 전 최적 형태를 결정함.
 *
 * "냄비 받침" → ["냄비받침", "냄비 받침"]
 * "LED조명" → ["led조명", "LED조명"]
 * "에어팟 프로" → ["에어팟프로", "에어팟 프로"]
 */
export function generateKeywordVariants(keyword: string): string[] {
  const variants = new Set<string>();
  const trimmed = keyword.trim();
  if (!trimmed) return [];

  // 원본 (공백 제거)
  const noSpace = trimmed.replace(/\s+/g, "");
  variants.add(noSpace);

  // 원본 (공백 유지 — API는 거부하지만, 결과 매칭용)
  variants.add(trimmed);

  // 특수문자 제거 버전
  const cleaned = normalizeNaverKeyword(trimmed);
  variants.add(cleaned);

  return Array.from(variants).filter(Boolean);
}

/**
 * ★ v8.5.6: 네이버 API 결과에서 원본 키워드에 매칭되는 결과 찾기
 * 정규화 기반으로 relKeyword 중 원본과 일치하는 것을 우선 반환
 */
export function findBestNaverMatch(
  originalKeyword: string,
  results: NaverKeywordResult[],
): NaverKeywordResult | null {
  const normalized = normalizeNaverKeyword(originalKeyword);

  // 1차: 정규화 완전 매칭
  for (const r of results) {
    if (normalizeNaverKeyword(r.relKeyword) === normalized) {
      return r;
    }
  }

  // 2차: 포함 관계 (긴 키워드가 짧은 키워드를 포함)
  for (const r of results) {
    const relNorm = normalizeNaverKeyword(r.relKeyword);
    if (relNorm.includes(normalized) || normalized.includes(relNorm)) {
      const totalSearch = (r.monthlyPcQcCnt || 0) + (r.monthlyMobileQcCnt || 0);
      if (totalSearch > 0) return r;
    }
  }

  return null;
}

/**
 * 네이버 키워드 도구 API 호출
 * ★ v8.5.6: 공백 제거 + 정규화 매핑 강화
 * 네이버 API는 공백 포함 키워드를 400으로 거부함 → 자동 정제
 */
export async function getNaverKeywords(
  hintKeywords: string[],
): Promise<NaverKeywordResult[]> {
  // 공백 제거 + 정규화 (네이버 API 호환)
  const cleanedKeywords = hintKeywords.map(kw => kw.replace(/\s+/g, "").trim()).filter(Boolean);
  // 중복 제거 ("냄비 받침" 과 "냄비받침" 이 같은 키워드를 지칭)
  const uniqueCleaned = [...new Set(cleanedKeywords)];

  if (uniqueCleaned.length === 0) {
    return [];
  }

  const method = "GET";
  const uri = "/keywordstool";
  const headers = getHeaders(method, uri);

  const params = new URLSearchParams({
    hintKeywords: uniqueCleaned.join(","),
    showDetail: "1",
  });

  // ★ v8.5.8: 15초 타임아웃 추가 — 느린 API 응답으로 이벤트 루프 차단 방지
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${uri}?${params}`, {
      method,
      headers,
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(timeoutId);
    if (e?.name === "AbortError") {
      throw new Error(`네이버 API 타임아웃 (15초): ${uniqueCleaned.join(", ")}`);
    }
    throw e;
  }
  clearTimeout(timeoutId);

  if (!res.ok) {
    if (res.status === 400) {
      console.log(`[naverAds] 네이버 API 400: 키워드 미등록 — ${uniqueCleaned.join(", ")}`);
      return [];
    }
    if (res.status === 429) {
      throw new Error(`네이버 API 429: Too Many Requests`);
    }
    const text = await res.text();
    throw new Error(`네이버 API 오류: ${res.status} ${text}`);
  }

  const data = await res.json();
  return (data.keywordList || []) as NaverKeywordResult[];
}

/**
 * 연관 키워드 확장: seed → 연관키워드 목록
 * 검색량 0인 키워드 제외, 총검색량 기준 정렬
 * @deprecated 검증 전용 아키텍처에서는 validateKeywordsWithNaver 사용
 */
export async function expandNaverKeywords(
  seeds: string[],
): Promise<{
  keyword: string;
  pcSearch: number;
  mobileSearch: number;
  totalSearch: number;
  competition: string;
}[]> {
  const results = await getNaverKeywords(seeds);

  return results
    .filter(r => {
      const total = (r.monthlyPcQcCnt || 0) + (r.monthlyMobileQcCnt || 0);
      return total > 0;
    })
    .map(r => ({
      keyword: r.relKeyword,
      pcSearch: r.monthlyPcQcCnt || 0,
      mobileSearch: r.monthlyMobileQcCnt || 0,
      totalSearch: (r.monthlyPcQcCnt || 0) + (r.monthlyMobileQcCnt || 0),
      competition: r.compIdx || "낮음",
    }))
    .sort((a, b) => b.totalSearch - a.totalSearch);
}

/** 검증 결과 (키워드 1건) */
export interface NaverValidationResult {
  keyword: string;
  pcSearch: number;
  mobileSearch: number;
  totalSearch: number;
  competition: string;
  avgCpc: number;
  passed: boolean;
  rejectReason?: string;
  recommendations: {
    keyword: string;
    totalSearch: number;
    competition: string;
  }[];
}

/**
 * 검증 전용: 주어진 키워드의 네이버 검색 지표만 조회 + 상위 3개 추천키워드
 *
 * 확장(expansion)과 달리 파생 키워드를 DB에 적재하지 않고,
 * 요청한 키워드의 지표만 반환 + 관련 키워드 top 3 추천만 제공
 */
export async function validateKeywordsWithNaver(
  keywords: string[],
): Promise<NaverValidationResult[]> {
  // 네이버 API는 hintKeywords로 연관키워드를 반환 — 원본 키워드 매칭 필요
  const normalizedInputs = new Map(
    keywords.map(kw => [kw.trim().toLowerCase().replace(/\s+/g, " "), kw]),
  );

  const results = await getNaverKeywords(keywords);

  const validationMap = new Map<string, NaverValidationResult>();

  for (const r of results) {
    const key = r.relKeyword.trim().toLowerCase().replace(/\s+/g, " ");
    const totalSearch = (r.monthlyPcQcCnt || 0) + (r.monthlyMobileQcCnt || 0);
    const avgCpc = (r.monthlyAvgPcClkCnt || 0) + (r.monthlyAvgMobileClkCnt || 0);

    if (normalizedInputs.has(key)) {
      // 원본 키워드 매칭 — 검증 데이터
      const passed = totalSearch >= 100; // 최소 검색량 100 이상이면 통과
      validationMap.set(key, {
        keyword: normalizedInputs.get(key)!,
        pcSearch: r.monthlyPcQcCnt || 0,
        mobileSearch: r.monthlyMobileQcCnt || 0,
        totalSearch,
        competition: r.compIdx || "낮음",
        avgCpc,
        passed,
        rejectReason: !passed ? "검색량 부족 (월간 100 미만)" : undefined,
        recommendations: [],
      });
    }
  }

  // 두 번째 패스: 매칭되지 않은 키워드는 연관키워드 → top 3 추천으로 활용
  const unmatchedResults = results.filter(r => {
    const key = r.relKeyword.trim().toLowerCase().replace(/\s+/g, " ");
    return !normalizedInputs.has(key);
  });

  // 추천키워드를 각 원본 키워드에 분배 (검색량 순으로 top 3)
  const sortedRecommendations = unmatchedResults
    .map(r => ({
      keyword: r.relKeyword,
      totalSearch: (r.monthlyPcQcCnt || 0) + (r.monthlyMobileQcCnt || 0),
      competition: r.compIdx || "낮음",
    }))
    .filter(r => r.totalSearch > 0)
    .sort((a, b) => b.totalSearch - a.totalSearch)
    .slice(0, 3 * keywords.length); // 전체 키워드 수 × 3

  // 각 검증 결과에 추천키워드 3개씩 배분
  let recIdx = 0;
  for (const [, validation] of validationMap) {
    const recs: typeof sortedRecommendations = [];
    while (recs.length < 3 && recIdx < sortedRecommendations.length) {
      recs.push(sortedRecommendations[recIdx++]);
    }
    validation.recommendations = recs;
  }

  // 입력 키워드 중 API 결과에 없는 것은 rejected 처리
  for (const [key, original] of normalizedInputs) {
    if (!validationMap.has(key)) {
      validationMap.set(key, {
        keyword: original,
        pcSearch: 0,
        mobileSearch: 0,
        totalSearch: 0,
        competition: "낮음",
        avgCpc: 0,
        passed: false,
        rejectReason: "네이버 검색 데이터 없음",
        recommendations: [],
      });
    }
  }

  return Array.from(validationMap.values());
}
