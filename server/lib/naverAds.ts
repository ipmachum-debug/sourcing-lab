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
 * 네이버 키워드 도구 API 호출
 * seed 키워드를 넣으면 연관 키워드 + 검색량/경쟁도 반환
 */
export async function getNaverKeywords(
  hintKeywords: string[],
): Promise<NaverKeywordResult[]> {
  const method = "GET";
  const uri = "/keywordstool";
  const headers = getHeaders(method, uri);

  const params = new URLSearchParams({
    hintKeywords: hintKeywords.join(","),
    showDetail: "1",
  });

  const res = await fetch(`${BASE_URL}${uri}?${params}`, {
    method,
    headers,
  });

  if (!res.ok) {
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
