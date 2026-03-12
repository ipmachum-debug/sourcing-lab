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
