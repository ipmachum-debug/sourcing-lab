/**
 * 쿠팡 OPEN API 클라이언트
 * - HMAC SHA256 서명 생성 (서명 쿼리 === 요청 쿼리 완전 일치 원칙)
 * - 주문 목록 조회 (ordersheets v5, by Minute)
 * - 매출 상세 조회 (revenue-history v1)
 * - 정산 내역 조회 (settlement-histories v1)
 * - 날짜는 모두 KST(Asia/Seoul) 기준
 */

import crypto from "crypto";

const COUPANG_API_HOST = "api-gateway.coupang.com";
const COUPANG_API_BASE = `https://${COUPANG_API_HOST}`;

// ==================== Date Helpers (KST 기준) ====================

/**
 * Date 객체를 KST(UTC+9) 기준 YYYY-MM-DD 문자열로 변환
 * toISOString()은 UTC이므로 한국 시간과 하루 어긋날 수 있음 → 반드시 KST로 변환
 */
function formatDateKST(date: Date): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** 오늘 날짜를 KST 기준 YYYY-MM-DD 형식으로 반환 */
export function getTodayStr(): string {
  return formatDateKST(new Date());
}

/** 어제 날짜를 KST 기준 YYYY-MM-DD 형식으로 반환 */
export function getYesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return formatDateKST(d);
}

/** dateTo를 어제 이전으로 클램프 */
export function clampDateToYesterday(dateTo: string): string {
  const yesterday = getYesterdayStr();
  return dateTo > yesterday ? yesterday : dateTo;
}

/** 두 날짜 사이 일수 계산 */
export function daysBetween(dateFrom: string, dateTo: string): number {
  const from = new Date(dateFrom + "T00:00:00+09:00");
  const to = new Date(dateTo + "T00:00:00+09:00");
  return Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

/** YYYY-MM-DD 형식 검증 */
export function isValidDateFormat(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(Date.parse(dateStr));
}

/** YYYY-MM 형식 검증 */
export function isValidYearMonthFormat(ym: string): boolean {
  return /^\d{4}-\d{2}$/.test(ym);
}

/** KST 기준 현재 연-월 YYYY-MM */
function getCurrentYearMonthKST(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ==================== HMAC Signature ====================

/**
 * HMAC SHA256 서명 생성
 *
 * 핵심 원칙: "서명에 넣는 queryString"과 "실제 요청에 붙이는 queryString"이
 * 한 글자도 다르지 않아야 합니다. 중간에 재정렬·재인코딩하면 불일치 위험.
 *
 * @param method  HTTP 메서드 (GET)
 * @param path    경로 (쿼리 제외, 예: /v2/providers/...)
 * @param queryString  쿼리 문자열 (? 제외, 예: key=val&key2=val2) — 실제 요청에 붙일 것과 동일
 * @param secretKey  Coupang Secret Key
 * @param accessKey  Coupang Access Key
 */
function generateHmacSignature(
  method: string,
  path: string,
  queryString: string,
  secretKey: string,
  accessKey: string
): string {
  // datetime in UTC: yyMMddTHHmmssZ
  const now = new Date();
  const datetime =
    now.getUTCFullYear().toString().slice(2) +
    String(now.getUTCMonth() + 1).padStart(2, "0") +
    String(now.getUTCDate()).padStart(2, "0") +
    "T" +
    String(now.getUTCHours()).padStart(2, "0") +
    String(now.getUTCMinutes()).padStart(2, "0") +
    String(now.getUTCSeconds()).padStart(2, "0") +
    "Z";

  // message = datetime + METHOD + path + queryString
  // ★ queryString은 실제 URL에 붙일 문자열 그대로 사용 (재가공 없음)
  const message = datetime + method.toUpperCase() + path + queryString;

  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(message)
    .digest("hex");

  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`;
}

// ==================== Query String Builder ====================

/**
 * params 객체를 쿼리 문자열로 변환
 * - undefined만 제외 (빈 문자열 ""은 유지 — token= 필수)
 * - ★ 정렬하지 않음 — 호출 시 전달한 순서를 그대로 유지
 *   정렬하면 서명 문자열과 실제 URL이 달라질 위험이 있음
 * - 이 결과를 서명에도, URL에도 동일하게 사용
 *
 * ★ 쿠팡 API 특이사항:
 *   공식 문서 예시 URL이 createdAtFrom=2025-07-21%2B09:00 형식
 *   → "+"는 %2B로 인코딩하지만, ":"는 인코딩하지 않음
 *   encodeURIComponent는 ":"도 %3A로 인코딩하므로 복원 필요
 */
function buildQueryString(params: Record<string, string>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v).replace(/%3A/g, ":")}`)
    .join("&");
}

// ==================== HTTP Request Helper ====================
interface CoupangApiResponse<T = any> {
  code?: number;
  message?: string;
  data?: T;
  hasNext?: boolean;
  nextToken?: string;
}

/**
 * Coupang Open API 요청 실행
 *
 * @param method     HTTP 메서드
 * @param path       경로 (쿼리 제외)
 * @param params     쿼리 파라미터 객체 (rawQuery 미지정 시 사용)
 * @param accessKey  Access Key
 * @param secretKey  Secret Key
 * @param vendorId   업체코드 (X-Requested-By 헤더용)
 * @param rawQuery   직접 빌드한 쿼리 문자열 — 지정 시 params 무시, 이 문자열을 서명+URL에 그대로 사용
 */
async function coupangRequest<T = any>(
  method: string,
  path: string,
  params: Record<string, string>,
  accessKey: string,
  secretKey: string,
  vendorId?: string,
  rawQuery?: string
): Promise<CoupangApiResponse<T>> {
  // ★ 핵심: queryString 하나만 만들고, 이걸 서명에도 URL에도 동일하게 사용
  const queryString = rawQuery !== undefined ? rawQuery : buildQueryString(params);

  // 서명 생성 — path와 queryString을 그대로 전달 (중간 변환 없음)
  const authorization = generateHmacSignature(method, path, queryString, secretKey, accessKey);

  // URL 조합
  const url = queryString
    ? `${COUPANG_API_BASE}${path}?${queryString}`
    : `${COUPANG_API_BASE}${path}`;

  console.log(`[CoupangAPI] ${method} ${url}`);

  const headers: Record<string, string> = {
    Authorization: authorization,
    "Content-Type": "application/json;charset=UTF-8",
    "X-EXTENDED-TIMEOUT": "90000",
    "X-MARKET": "KR",
  };
  if (vendorId) {
    headers["X-Requested-By"] = vendorId;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(url, {
      method,
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const text = await response.text().catch(() => "");
    console.log(`[CoupangAPI] Response ${response.status}, body=${text.slice(0, 500)}`);

    if (!response.ok) {
      let errorMsg = `Coupang API ${response.status}: ${response.statusText}`;
      try {
        const errJson = JSON.parse(text);
        if (errJson.message) errorMsg = `Coupang API ${response.status}: ${JSON.stringify(errJson)}`;
      } catch {}
      console.error(`[CoupangAPI] FAILED: ${method} ${url}`);
      console.error(`[CoupangAPI] Signed path: ${path}`);
      console.error(`[CoupangAPI] Signed query: ${queryString.slice(0, 300)}`);
      console.error(`[CoupangAPI] Headers: X-Requested-By=${vendorId || "none"}, X-MARKET=KR`);
      console.error(`[CoupangAPI] Response body: ${text.slice(0, 500)}`);
      throw new Error(errorMsg);
    }

    const json = text ? JSON.parse(text) : {};
    return json as CoupangApiResponse<T>;
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      throw new Error("Coupang API 요청 시간 초과 (60초)");
    }
    throw err;
  }
}

// ==================== API Test (Connection Check) ====================

/**
 * API 연결 테스트 — settlement-histories를 경량 호출
 * vendorId를 콘솔에 찍어 Wing 업체코드와 일치하는지 확인할 수 있도록 함
 */
export async function testCoupangConnection(
  accessKey: string,
  secretKey: string,
  vendorId: string
): Promise<{ success: boolean; message: string }> {
  try {
    const yearMonth = getCurrentYearMonthKST();
    console.log(`[CoupangAPI] testCoupangConnection vendorId="${vendorId}", yearMonth="${yearMonth}"`);

    await coupangRequest(
      "GET",
      "/v2/providers/marketplace_openapi/apis/api/v1/settlement-histories",
      { revenueRecognitionYearMonth: yearMonth },
      accessKey,
      secretKey,
      vendorId
    );

    return { success: true, message: `API 연결 성공! vendorId=${vendorId}` };
  } catch (err: any) {
    return { success: false, message: `API 연결 실패: ${err.message}` };
  }
}

/**
 * 개별 API 테스트 — 실사용할 API를 각각 확인
 * 쿠팡은 API별로 실패 원인이 다를 수 있음
 */
export async function testCoupangApis(
  accessKey: string,
  secretKey: string,
  vendorId: string
): Promise<{ settlement: string; revenue: string; ordersheets: string }> {
  const results = { settlement: "", revenue: "", ordersheets: "" };

  // 1) settlement-histories
  try {
    const yearMonth = getCurrentYearMonthKST();
    await coupangRequest(
      "GET",
      "/v2/providers/marketplace_openapi/apis/api/v1/settlement-histories",
      { revenueRecognitionYearMonth: yearMonth },
      accessKey, secretKey, vendorId
    );
    results.settlement = "OK";
  } catch (err: any) {
    results.settlement = `FAIL: ${err.message?.slice(0, 120)}`;
  }

  // 2) revenue-history
  try {
    const yesterday = getYesterdayStr();
    await coupangRequest(
      "GET",
      "/v2/providers/openapi/apis/api/v1/revenue-history",
      {
        vendorId,
        recognitionDateFrom: yesterday,
        recognitionDateTo: yesterday,
        token: "",
        maxPerPage: "1",
      },
      accessKey, secretKey, vendorId
    );
    results.revenue = "OK";
  } catch (err: any) {
    results.revenue = `FAIL: ${err.message?.slice(0, 120)}`;
  }

  // 3) ordersheets (by Day) — buildQueryString으로 인코딩 통일
  try {
    const yesterday = getYesterdayStr();
    await coupangRequest(
      "GET",
      `/v2/providers/openapi/apis/api/v5/vendors/${vendorId}/ordersheets`,
      {
        createdAtFrom: `${yesterday}+09:00`,
        createdAtTo: `${yesterday}+09:00`,
        maxPerPage: "1",
        status: "ACCEPT",
      },
      accessKey, secretKey, vendorId
    );
    results.ordersheets = "OK";
  } catch (err: any) {
    results.ordersheets = `FAIL: ${err.message?.slice(0, 120)}`;
  }

  return results;
}

// ==================== Order List (Ordersheets) ====================
export interface CoupangOrderItem {
  vendorItemPackageId: number;
  vendorItemPackageName: string;
  productId: number;
  vendorItemId: number;
  vendorItemName: string;
  shippingCount: number;
  salesPrice: { currencyCode: string; units: number; nanos: number };
  orderPrice: { currencyCode: string; units: number; nanos: number };
  discountPrice?: { currencyCode: string; units: number; nanos: number } | null;
  sellerProductId: number;
  sellerProductName: string;
  sellerProductItemName: string;
  canceled: boolean;
  cancelCount: number;
}

export interface CoupangOrder {
  shipmentBoxId: number;
  orderId: number;
  orderedAt: string;
  paidAt: string;
  status: string;
  orderItems: CoupangOrderItem[];
}

/**
 * 주문 목록 조회 (일 단위 페이징 — by day)
 * GET /v2/providers/openapi/apis/api/v5/vendors/{vendorId}/ordersheets
 *
 * by Day 모드:
 *   createdAtFrom=YYYY-MM-DD+09:00  (encodeURIComponent → %2B09%3A00)
 *   createdAtTo=YYYY-MM-DD+09:00
 *   status=ACCEPT|INSTRUCT|DEPARTURE|...
 *   maxPerPage=50 (1~100)
 *   nextToken= (다음 페이지)
 *
 * ★ buildQueryString()로 params를 만들어 서명과 URL이 완전 일치하도록 함
 *   rawQuery로 수동 인코딩하면 %2B vs %2B09:00 vs %2B09%3A00 불일치 위험
 */
export async function fetchOrders(
  accessKey: string,
  secretKey: string,
  vendorId: string,
  dateFrom: string,  // YYYY-MM-DD (KST)
  dateTo: string,    // YYYY-MM-DD (KST)
  status?: string
): Promise<CoupangOrder[]> {
  if (!vendorId) throw new Error("vendorId가 필요합니다.");
  if (!isValidDateFormat(dateFrom)) throw new Error(`잘못된 시작일 형식: ${dateFrom} (YYYY-MM-DD 필요)`);
  if (!isValidDateFormat(dateTo)) throw new Error(`잘못된 종료일 형식: ${dateTo} (YYYY-MM-DD 필요)`);

  console.log(`[CoupangAPI] fetchOrders vendorId="${vendorId}", dateFrom="${dateFrom}", dateTo="${dateTo}", status="${status || "ACCEPT"}"`);

  const allOrders: CoupangOrder[] = [];
  const path = `/v2/providers/openapi/apis/api/v5/vendors/${vendorId}/ordersheets`;

  // By Day API 사용 (공식 예시: createdAtFrom=2025-07-21+09:00)
  // buildQueryString으로 params를 만들면 encodeURIComponent가
  // "+"를 "%2B"로, ":"를 "%3A"로 변환 → 서명과 URL이 반드시 일치
  let nextToken: string | undefined;

  do {
    const params: Record<string, string> = {
      createdAtFrom: `${dateFrom}+09:00`,
      createdAtTo: `${dateTo}+09:00`,
      maxPerPage: "50",
      status: status || "ACCEPT",
    };
    if (nextToken) params.nextToken = nextToken;

    console.log(`[CoupangAPI] fetchOrders (byDay) params=${JSON.stringify(params)}`);

    const result = await coupangRequest<CoupangOrder[]>(
      "GET", path, params, accessKey, secretKey, vendorId
    );

    if (result.data && Array.isArray(result.data)) {
      allOrders.push(...result.data);
    }

    nextToken = result.nextToken || undefined;
  } while (nextToken);

  return allOrders;
}

/**
 * 모든 상태의 주문을 가져오기 (여러 status를 순회)
 */
export async function fetchAllStatusOrders(
  accessKey: string,
  secretKey: string,
  vendorId: string,
  dateFrom: string,
  dateTo: string,
): Promise<CoupangOrder[]> {
  const statuses = ["ACCEPT", "INSTRUCT", "DEPARTURE", "DELIVERING", "FINAL_DELIVERY", "NONE_TRACKING"];
  const allOrders: CoupangOrder[] = [];
  const seenOrderIds = new Set<number>();
  let lastError: Error | null = null;

  for (const status of statuses) {
    try {
      const orders = await fetchOrders(accessKey, secretKey, vendorId, dateFrom, dateTo, status);
      for (const order of orders) {
        if (!seenOrderIds.has(order.orderId)) {
          seenOrderIds.add(order.orderId);
          allOrders.push(order);
        }
      }
      console.log(`[CoupangAPI] fetchAllStatusOrders status=${status}: ${orders.length} orders`);
    } catch (err: any) {
      console.log(`[CoupangAPI] fetchOrders status=${status} error: ${err.message}`);
      lastError = err;
    }
  }

  if (allOrders.length === 0 && lastError) {
    throw lastError;
  }

  return allOrders;
}

// ==================== Sales Detail (Revenue History) ====================
export interface CoupangSalesItem {
  taxType: string;
  productId: number;
  productName: string;
  vendorItemId: number;
  vendorItemName: string;
  salePrice: number;
  quantity: number;
  saleAmount: number;
  serviceFee: number;
  serviceFeeVat: number;
  serviceFeeRatio: number;
  settlementAmount: number;
  sellerDiscountCoupon: number;
  downloadableCoupon: number;
  coupangDiscountCoupon: number;
}

export interface CoupangSalesRecord {
  orderId: number;
  saleType: string; // SALE or REFUND
  saleDate: string;
  recognitionDate: string;
  settlementDate: string;
  deliveryFee: {
    amount: number;
    fee: number;
    feeVat: number;
    settlementAmount: number;
  };
  items: CoupangSalesItem[];
}

/**
 * 매출 상세 조회 (매출 인식 기준)
 * GET /v2/providers/openapi/apis/api/v1/revenue-history
 *
 * 필수(O): vendorId, recognitionDateFrom, recognitionDateTo, token
 * 선택: maxPerPage (기본 50)
 *
 * token은 첫 페이지에도 반드시 빈 문자열로 전송해야 함
 * recognitionDateTo는 반드시 전일(어제) 이전
 */
export async function fetchSalesDetail(
  accessKey: string,
  secretKey: string,
  vendorId: string,
  dateFrom: string,
  dateTo: string
): Promise<CoupangSalesRecord[]> {
  if (!vendorId) throw new Error("vendorId가 필요합니다.");
  if (!isValidDateFormat(dateFrom)) throw new Error(`잘못된 시작일 형식: ${dateFrom}`);
  if (!isValidDateFormat(dateTo)) throw new Error(`잘못된 종료일 형식: ${dateTo}`);

  const yesterday = getYesterdayStr();
  const clampedTo = dateTo > yesterday ? yesterday : dateTo;

  if (dateFrom > clampedTo) {
    throw new Error(`매출 상세는 전일(${yesterday})까지만 조회 가능합니다. dateFrom=${dateFrom}이 범위를 초과합니다.`);
  }

  const range = daysBetween(dateFrom, clampedTo);
  if (range > 31) {
    throw new Error(`날짜 범위가 31일을 초과합니다 (${range}일). 범위를 줄여주세요.`);
  }

  console.log(`[CoupangAPI] fetchSalesDetail vendorId="${vendorId}", ${dateFrom} ~ ${clampedTo} (원래 dateTo: ${dateTo})`);

  const allRecords: CoupangSalesRecord[] = [];
  let token = "";
  let hasNext = true;

  while (hasNext) {
    const params: Record<string, string> = {
      vendorId,
      recognitionDateFrom: dateFrom,
      recognitionDateTo: clampedTo,
      token,      // 첫 페이지: "" → URL에 token= 으로 전송 (Required!)
      maxPerPage: "50",
    };

    const result = await coupangRequest<CoupangSalesRecord[]>(
      "GET",
      "/v2/providers/openapi/apis/api/v1/revenue-history",
      params,
      accessKey,
      secretKey,
      vendorId
    );

    if (result.data && Array.isArray(result.data)) {
      allRecords.push(...result.data);
    }

    hasNext = result.hasNext === true;
    token = result.nextToken || "";
  }

  return allRecords;
}

// ==================== Settlement Histories ====================
export interface CoupangSettlementRecord {
  settlementType: string;
  settlementDate: string;
  revenueRecognitionYearMonth: string;
  revenueRecognitionDateFrom: string;
  revenueRecognitionDateTo: string;
  totalSale: number;
  serviceFee: number;
  settlementTargetAmount: number;
  settlementAmount: number;
  lastAmount: number;
  finalAmount: number;
  status: string;
  sellerDiscountCoupon: number;
  downloadableCoupon: number;
  deductionAmount: number;
}

/**
 * 정산 내역 조회
 * GET /v2/providers/marketplace_openapi/apis/api/v1/settlement-histories
 *
 * 필수: revenueRecognitionYearMonth (YYYY-MM)
 */
export async function fetchSettlementHistories(
  accessKey: string,
  secretKey: string,
  vendorId: string,
  yearMonth: string
): Promise<CoupangSettlementRecord[]> {
  if (!isValidYearMonthFormat(yearMonth)) {
    throw new Error(`잘못된 정산월 형식: ${yearMonth} (YYYY-MM 필요)`);
  }

  const currentYM = getCurrentYearMonthKST();
  if (yearMonth > currentYM) {
    throw new Error(`미래 월(${yearMonth})은 조회할 수 없습니다. 현재 월(${currentYM}) 이전으로 지정하세요.`);
  }

  const result = await coupangRequest<CoupangSettlementRecord[]>(
    "GET",
    "/v2/providers/marketplace_openapi/apis/api/v1/settlement-histories",
    { revenueRecognitionYearMonth: yearMonth },
    accessKey,
    secretKey,
    vendorId
  );

  if (Array.isArray(result)) {
    return result as CoupangSettlementRecord[];
  }
  if (result.data && Array.isArray(result.data)) {
    return result.data;
  }
  return [];
}

// ==================== Aggregation Helpers ====================

/** Aggregate orders into daily sales per vendorItemId */
export function aggregateOrdersToDailySales(
  orders: CoupangOrder[],
  dateStr: string
): Map<string, { vendorItemId: string; productName: string; sellerProductId: string; qty: number; grossSales: number; orderCount: number }> {
  const map = new Map<string, { vendorItemId: string; productName: string; sellerProductId: string; qty: number; grossSales: number; orderCount: number }>();

  for (const order of orders) {
    for (const item of order.orderItems) {
      if (item.canceled) continue;
      const vid = String(item.vendorItemId);
      const existing = map.get(vid);
      const salePrice = item.salesPrice?.units || item.orderPrice?.units || 0;
      const qty = item.shippingCount || 1;

      if (existing) {
        existing.qty += qty;
        existing.grossSales += salePrice * qty;
        existing.orderCount += 1;
      } else {
        map.set(vid, {
          vendorItemId: vid,
          productName: item.vendorItemName || item.sellerProductName || "",
          sellerProductId: String(item.sellerProductId || ""),
          qty,
          grossSales: salePrice * qty,
          orderCount: 1,
        });
      }
    }
  }

  return map;
}

/**
 * Aggregate sales detail (revenue-history) into daily sales per vendorItemId
 *
 * ★ grossSales는 saleAmount 사용 (이미 수량 반영된 총매출)
 *   salePrice는 "총 판매가(수량 반영)"이지만, saleAmount는 "쿠팡 할인 차감 후 매출"
 *   saleAmount가 없을 때만 salePrice 사용
 */
export function aggregateSalesDetailToDaily(
  records: CoupangSalesRecord[]
): Map<string, Map<string, {
  vendorItemId: string;
  productName: string;
  productId: string;
  qty: number;
  grossSales: number;
  orderCount: number;
  serviceFee: number;
  settlementAmount: number;
}>> {
  const result = new Map<string, Map<string, any>>();

  for (const record of records) {
    const date = record.recognitionDate;
    if (!date) continue;
    const isRefund = record.saleType === "REFUND";
    const multiplier = isRefund ? -1 : 1;

    if (!result.has(date)) {
      result.set(date, new Map());
    }
    const dateMap = result.get(date)!;

    for (const item of record.items) {
      if (!item.vendorItemId) continue;
      const vid = String(item.vendorItemId);
      const existing = dateMap.get(vid);

      // ★ saleAmount = 실제 매출 (수량×단가 - 쿠팡 할인), salePrice = 수량 반영 총 판매가
      // saleAmount가 있으면 사용, 없으면 salePrice fallback
      const itemGrossSales = item.saleAmount || item.salePrice || 0;

      if (existing) {
        existing.qty += (item.quantity || 0) * multiplier;
        existing.grossSales += itemGrossSales * multiplier;
        existing.orderCount += multiplier;
        existing.serviceFee += ((item.serviceFee || 0) + (item.serviceFeeVat || 0)) * multiplier;
        existing.settlementAmount += (item.settlementAmount || 0) * multiplier;
      } else {
        dateMap.set(vid, {
          vendorItemId: vid,
          productName: item.vendorItemName || item.productName || "",
          productId: String(item.productId || ""),
          qty: (item.quantity || 0) * multiplier,
          grossSales: itemGrossSales * multiplier,
          orderCount: multiplier,
          serviceFee: ((item.serviceFee || 0) + (item.serviceFeeVat || 0)) * multiplier,
          settlementAmount: (item.settlementAmount || 0) * multiplier,
        });
      }
    }
  }

  return result;
}
