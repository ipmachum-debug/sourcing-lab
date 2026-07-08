// ============================================================
// poizonApi.ts — POIZON Open Platform 클라이언트 (승인 즉시 가동 준비)
// ============================================================
// 통합 방식: "Seller Integration with POIZON"(우리가 POIZON API 호출).
// 권한: Default 패키지 1개 = 50+ 인터페이스 통합 승인(현재 已申请=심사 대기).
//   승인되면 아래 함수들은 Access Token만 채우면 바로 동작한다.
//
// 역경매 워크플로우에 실제 필요한 핵심 5(우선 구현):
//   1) SPU by Article Number(fuzzy)   — 상품번호/국내가로 POIZON SPU 찾기
//   2) SPU by globalSpuId              — SPU 상세
//   3) (Lowest Price) Recommendations  — 방어선/목표가 기반 최저 입찰가 추천
//   4) Submit Automatic Bidding        — 자동 입찰 실행
//   5) Listing list / Cancel Listing   — 내 입찰 조회·취소
//
// 필요 env (App Secret/Token은 서버 .env에만 — 코드/깃/PR 금지):
//   POIZON_APP_KEY, POIZON_APP_SECRET, POIZON_ACCESS_TOKEN
//   (선택) POIZON_API_BASE (기본 https://open.poizon.com)
//
// ⚠️ 각 인터페이스의 실제 URL/method/파라미터/응답 스키마는 POIZON 문서(파란 링크)
//    확정 전이라 아래 POIZON_API 맵의 path/method는 "추정 placeholder"다.
//    문서 확인 후 이 맵과 각 함수의 body/스키마만 고치면 된다(호출·서명·에러는 그대로).
//    서명 규칙도 공식 Sign Tool 기준 최종 검증 필요 — 다르면 sign()만 교체.

import crypto from "crypto";
import { z } from "zod";

// ── 설정 ────────────────────────────────────────────────
export interface PoizonApiConfig {
  appKey: string;
  appSecret: string;
  accessToken: string;
  base: string;
}

export function readConfig(): PoizonApiConfig | null {
  const appKey = process.env.POIZON_APP_KEY;
  const appSecret = process.env.POIZON_APP_SECRET;
  const accessToken = process.env.POIZON_ACCESS_TOKEN;
  if (!appKey || !appSecret || !accessToken) return null;
  return {
    appKey,
    appSecret,
    accessToken,
    base: process.env.POIZON_API_BASE || "https://open.poizon.com",
  };
}

export function isConfigured(): boolean {
  return readConfig() !== null;
}

/** 자격증명 준비 상태 세분화 — UI 안내용. */
export function readiness(): {
  appKey: boolean;
  appSecret: boolean;
  accessToken: boolean;
  ready: boolean;
} {
  const appKey = !!process.env.POIZON_APP_KEY;
  const appSecret = !!process.env.POIZON_APP_SECRET;
  const accessToken = !!process.env.POIZON_ACCESS_TOKEN;
  // ★ Poizon Sellers 인증(자체 개발 툴) = App Key + Secret + 서명. access_token 불필요.
  //   (ERP/ISV OAuth 방식일 때만 access_token 사용) → 가동 준비 = key+secret만으로 충족.
  return { appKey, appSecret, accessToken, ready: appKey && appSecret };
}

// ── 엔드포인트 맵 (문서 확정 시 여기만 수정) ──────────────
// ✅ 확정 prefix: /dop/api/v1/pop/api/v1/...  (recommend-bid/batchPrice 문서로 확인)
// ⚠️ 표시는 여전히 추정 suffix — 각 문서 링크로 확정 필요.
export const POIZON_API = {
  // ⭐ 핵심 5 (역경매 워크플로우)
  spuByArticleNumber: { path: "/dop/api/v1/pop/api/v1/intl-commodity/intl/spu/spu-basic-info/by-article-number", method: "POST" }, // ✅ 확정
  spuByGlobalSpuId: { path: "/dop/api/v1/pop/api/v1/intl-commodity/intl/spu/spu-basic-info/by-global-spu-id", method: "POST" }, // ⚠️ 패턴 추정
  listingRecommendBatch: { path: "/dop/api/v1/pop/api/v1/recommend-bid/batchPrice", method: "POST" }, // ✅ 확정
  submitAutoBid: { path: "/dop/api/v1/pop/api/v1/bidding/auto/submit", method: "POST" }, // ⚠️ 추정
  autoFollowBidSubmit: { path: "/dop/api/v1/pop/api/v1/auto-follow-bidding/submit", method: "POST" }, // ✅ 확정
  listingList: { path: "/dop/api/v1/pop/api/v1/retrieve-bid/general-type-bidding-list/simple", method: "POST" }, // ✅ 확정
  cancelListing: { path: "/dop/api/v1/pop/api/v1/cancel-bid/cancel-bidding", method: "POST" }, // ✅ 확정

  // 확장(Default 포함) — 필요 시 순차 구현
  skuSpuByBarcode: { path: "/dop/api/v1/commodity/query-by-barcode", method: "POST" },
  skuBasicInfoBySku: { path: "/dop/api/v1/pop/api/v1/intl-commodity/intl/sku/sku-basic-info/by-sku", method: "POST" }, // ⚠️ 패턴 추정
  orderListV2: { path: "/dop/api/v1/order/list/v2", method: "POST" },
  orderConfirm: { path: "/dop/api/v1/order/confirm", method: "POST" },
  realtimeReconciliation: { path: "/dop/api/v1/bill/realtime/list", method: "POST" },
  hostedUnmatched: { path: "/dop/api/v1/hosted/unmatched/list", method: "POST" },
  hostedRecommendMatch: { path: "/dop/api/v1/hosted/recommend-match/list", method: "POST" },
  hostedConfirmMatch: { path: "/dop/api/v1/hosted/confirm-match", method: "POST" },
} as const;

export type PoizonEndpointKey = keyof typeof POIZON_API;

// 하위호환: 이전 워크플로우 별칭
export const POIZON_ENDPOINTS = {
  commodity: POIZON_API.spuByArticleNumber.path,
  recommendBid: POIZON_API.listingRecommendBatch.path,
  submitBid: POIZON_API.submitAutoBid.path,
  orderDelivery: POIZON_API.orderListV2.path,
  bill: POIZON_API.realtimeReconciliation.path,
};

// ── 에러 ────────────────────────────────────────────────
export class PoizonApiError extends Error {
  code: string | number;
  raw?: unknown;
  constructor(code: string | number, message: string, raw?: unknown) {
    super(message);
    this.name = "PoizonApiError";
    this.code = code;
    this.raw = raw;
  }
}

/** HTTP status·API code·메시지로 사용자 친화적 한국어 안내 생성. */
function friendlyError(status: number, code: unknown, msg: string): string {
  const c = String(code ?? "");
  const m = msg || "";
  if (/token/i.test(m) && /(expir|invalid|missing|无效|过期)/i.test(m))
    return "Access Token이 만료/무효입니다. Seller Authorization으로 토큰을 재발급해 POIZON_ACCESS_TOKEN을 갱신하세요.";
  if (status === 401 || c === "40001" || c === "401")
    return "인증 실패(401). Access Token이 없거나 만료됐습니다 — 토큰 재발급 후 .env 갱신.";
  if (
    status === 403 ||
    c === "40003" ||
    /(permission|not.*author|unauthor|no.*access|未授权|已申请|审核)/i.test(m)
  )
    return "이 API 권한이 아직 승인되지 않았습니다(Default 패키지 심사 대기/미승인). POIZON 콘솔에서 권한 패키지 승인 여부를 확인하세요.";
  if (/sign/i.test(m) || c === "40002" || /(签名|签)/i.test(m))
    return "서명(sign) 검증 실패입니다. Sign 알고리즘·App Secret을 공식 Sign Tool 기준으로 확인하세요.";
  if (status === 429 || /(rate|frequ|too many|限流|频繁)/i.test(m))
    return "요청이 너무 잦습니다(rate limit). 잠시 후 재시도하세요.";
  if (/(ip|whitelist|白名单)/i.test(m))
    return "IP 화이트리스트 문제입니다. 서버 공인 IP(49.50.130.101)가 POIZON에 등록됐는지 확인하세요.";
  return m || `POIZON API 오류 (status ${status}${c ? `, code ${c}` : ""}).`;
}

// ── 서명 (공식 Step 4 알고리즘) ─────────────────────────
// 1) 전체 파라미터(인증+비즈니스, app_key·timestamp 포함) 중 빈 값 제외
// 2) 키 ASCII 오름차순 정렬 → key=urlencode(value)&... 로 연결 (stringA)
//    · 값이 배열이면 원소를 콤마로 join (객체 원소는 compact JSON)
//    · URL 인코딩은 Java URLEncoder 호환: 공백은 '+' (encodeURIComponent의 %20→+)
// 3) 끝에 appSecret 붙임 → MD5(32) → 대문자
function signValue(val: unknown): string {
  if (Array.isArray(val)) {
    return val
      .map(el => (el !== null && typeof el === "object" ? JSON.stringify(el) : String(el)))
      .join(",");
  }
  if (val !== null && typeof val === "object") return JSON.stringify(val);
  return String(val);
}
function urlEncodeJava(s: string): string {
  // Java URLEncoder 호환: 공백 → '+', 나머지는 encodeURIComponent
  return encodeURIComponent(s).replace(/%20/g, "+");
}
/** 서명 대상 문자열(stringA, secret 붙이기 전) — 디버그/Sign Tool 비교용. */
export function signPreimage(params: Record<string, unknown>): string {
  const keys = Object.keys(params)
    .filter(k => k !== "sign" && params[k] != null && params[k] !== "")
    .sort(); // ASCII 오름차순
  return keys
    .map(k => `${urlEncodeJava(k)}=${urlEncodeJava(signValue(params[k]))}`)
    .join("&");
}
export function sign(params: Record<string, unknown>, appSecret: string): string {
  const stringSignTemp = signPreimage(params) + appSecret;
  return crypto
    .createHash("md5")
    .update(stringSignTemp, "utf8")
    .digest("hex")
    .toUpperCase();
}

/** 서명 디버그: 고정 파라미터로 stringA·sign 산출(secret 값은 노출 안 함). Sign Tool과 비교용. */
export function signDebug(): {
  params: Record<string, unknown>;
  stringA: string;
  sign: string;
  hasSecret: boolean;
  secretLen: number;
  appKeyTail: string;
} {
  const appKey = process.env.POIZON_APP_KEY || "";
  const secret = process.env.POIZON_APP_SECRET || "";
  const params: Record<string, unknown> = {
    app_key: appKey,
    timestamp: 1700000000000, // 고정값 — Sign Tool에 동일 입력
    articleNumber: "FJ4170-004",
    region: "US",
    pageNum: 1,
    pageSize: 20,
    language: "ko",
    timeZone: "Asia/Seoul",
  };
  return {
    params,
    stringA: signPreimage(params),
    sign: sign(params, secret),
    hasSecret: !!secret,
    secretLen: secret.length,
    appKeyTail: appKey ? appKey.slice(-4) : "",
  };
}

/** 인증 공통 파라미터(app_key/timestamp/language/timeZone[/access_token]). sign은 별도로 전체 위에서 계산.
 *  Poizon Sellers 방식은 access_token 없이 동작 → 토큰이 있을 때만 포함. */
function authParamsOf(
  cfg: PoizonApiConfig,
  timestampMs: number
): Record<string, string | number> {
  const p: Record<string, string | number> = {
    app_key: cfg.appKey,
    timestamp: timestampMs,
    language: "ko",
    timeZone: "Asia/Seoul",
  };
  if (cfg.accessToken) p.access_token = cfg.accessToken;
  return p;
}

// ── 범용 호출기 ─────────────────────────────────────────
export interface CallOpts<T> {
  /** 서명 타임스탬프(ms). 미지정 시 Date.now(). */
  timestampMs?: number;
  /** 응답 data 검증 스키마(선택). 불일치 시 PoizonApiError. */
  schema?: z.ZodType<T>;
  /** 타임아웃(ms). 기본 15000. */
  timeoutMs?: number;
}

/**
 * POIZON 오픈플랫폼 범용 호출.
 *   - 인증 파라미터는 쿼리스트링(서명 포함), 비즈니스 파라미터는 JSON 바디.
 *   - HTTP·비즈니스 code 모두 검사 → 실패 시 친화적 PoizonApiError.
 *   - schema 주면 응답 data를 Zod 검증해 타입 보장.
 * 자격증명 없으면 즉시 실패(placeholder 데이터 반환 금지).
 */
/** access_token 해석: DB 저장 토큰(자동갱신) 우선 → env 폴백. */
async function resolveAccessTokenFor(): Promise<string> {
  try {
    const store = await import("./poizonTokenStore");
    const t = await store.resolveAccessToken();
    if (t) return t;
  } catch {
    // DB 미연결/스토어 오류 → env 폴백
  }
  return process.env.POIZON_ACCESS_TOKEN || "";
}

export async function callPoizon<T = unknown>(
  ep: { path: string; method: string },
  bizParams: Record<string, unknown>,
  opts: CallOpts<T> = {}
): Promise<T> {
  const appKey = process.env.POIZON_APP_KEY;
  const appSecret = process.env.POIZON_APP_SECRET;
  if (!appKey || !appSecret) {
    throw new PoizonApiError(
      "MISSING_CREDENTIALS",
      "POIZON_APP_KEY/POIZON_APP_SECRET 미설정 — 서버 .env에 설정 필요."
    );
  }
  // ★ Poizon Sellers 인증(자체 개발 툴): access_token 불필요 — App Key+Secret+서명만.
  //   토큰이 있으면(ERP/ISV 방식) 함께 실어 보내고, 없으면 생략.
  const accessToken = await resolveAccessTokenFor(); // "" 가능
  const cfg: PoizonApiConfig = {
    appKey,
    appSecret,
    accessToken,
    base: process.env.POIZON_API_BASE || "https://open.poizon.com",
  };
  const timestamp = opts.timestampMs ?? Date.now();
  const auth = authParamsOf(cfg, timestamp);
  // ★ 모든 파라미터(인증+비즈니스)를 하나의 객체로 → 서명(공식 Step 4: "all data as JSON object").
  const allParams = { ...bizParams, ...auth };
  const signature = sign(allParams, cfg.appSecret);
  // 전체 파라미터 + sign을 단일 JSON 바디로 전송(분리 없이). 쿼리스트링 미사용.
  const bodyObj = { ...allParams, sign: signature };
  const url = `${cfg.base}${ep.path}`;
  const method = (ep.method || "POST").toUpperCase();

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(bodyObj),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
    });
  } catch (e: any) {
    throw new PoizonApiError(
      "NETWORK",
      `POIZON API 연결 실패: ${e?.message ?? e}. (프록시·타임아웃·IP 화이트리스트 확인)`
    );
  }

  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* 비 JSON 응답 */
  }
  const code = json?.code ?? json?.errorCode ?? json?.status;
  const msg = String(json?.msg ?? json?.message ?? json?.errorMsg ?? text ?? "");
  const okCode =
    code == null ||
    code === 0 ||
    code === 200 ||
    code === "0" ||
    code === "200" ||
    code === "SUCCESS" ||
    json?.success === true;

  if (!res.ok || !okCode) {
    throw new PoizonApiError(
      code ?? res.status,
      friendlyError(res.status, code, msg),
      json ?? text
    );
  }

  const data = json?.data ?? json?.result ?? json;
  if (opts.schema) {
    const parsed = opts.schema.safeParse(data);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .slice(0, 3)
        .map(i => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      throw new PoizonApiError(
        "SCHEMA_MISMATCH",
        `POIZON 응답 스키마 불일치(문서와 대조 필요): ${detail}`,
        data
      );
    }
    return parsed.data;
  }
  return data as T;
}

// ── 응답 스키마 (문서 확정 전 permissive) ────────────────
const zSpu = z
  .object({
    spuId: z.union([z.string(), z.number()]).optional(),
    globalSpuId: z.union([z.string(), z.number()]).optional(),
    spuName: z.string().optional(),
    articleNumber: z.string().optional(),
    brandName: z.string().optional(),
  })
  .passthrough();
const zSpuList = z
  .object({ list: z.array(zSpu).optional(), total: z.number().optional() })
  .passthrough();

// ✅ 확정 응답: data = 시장별 최저가 참조 배열.
//   가격 단위는 최소단위(분/센트)일 수 있음 — 엔진 연동 시 ÷100 여부 검증 필요.
const zRecommend = z
  .object({
    skuId: z.union([z.string(), z.number()]).optional(),
    globalSkuId: z.union([z.string(), z.number()]).optional(),
    globalMinPrice: z.number().optional(), // 글로벌(중국) 최저가
    localMinPrice: z.number().optional(), // 현지(판매지역) 최저가
    otherPlatformMinPrice: z.number().optional(), // 타 플랫폼 최저가
    asiaMinPrice: z.number().optional(), // 아시아 최저가
    usMinPrice: z.number().optional(), // 미국 최저가
  })
  .passthrough();
const zRecommendList = z.array(zRecommend);

const zSubmitResult = z
  .object({
    success: z.boolean().optional(),
    listingNo: z.union([z.string(), z.number()]).optional(),
    failList: z.array(z.any()).optional(),
  })
  .passthrough();

// ✅ 확정 응답: data.list[] + lastOffsetId(다음 커서) + pageSize.
//   ★ sellerBiddingNo = auto-follow-bidding/submit의 biddingNo (자동추종 연결 키).
//   price는 통화 최소단위(KRW=원 그대로, USD=센트 ÷100).
const zListingItem = z
  .object({
    sellerBiddingNo: z.string().optional(),
    biddingType: z.number().optional(),
    tradeStatus: z.number().optional(), // 1=취소, 2=성공
    spuId: z.union([z.string(), z.number()]).optional(),
    skuId: z.union([z.string(), z.number()]).optional(),
    globalSpuId: z.union([z.string(), z.number()]).optional(),
    globalSkuId: z.union([z.string(), z.number()]).optional(),
    price: z.number().optional(),
    currency: z.string().optional(),
    saleType: z.number().optional(),
    onSaleQuantity: z.number().optional(),
    merchantSpuId: z.string().optional(),
    merchantSkuId: z.string().optional(),
    is_auto_bidding: z.boolean().optional(),
    created_time: z.number().optional(),
  })
  .passthrough();
const zListingList = z
  .object({
    list: z.array(zListingItem).optional(),
    lastOffsetId: z.number().optional(),
    pageSize: z.number().optional(),
  })
  .passthrough();

// ── 핵심 5 (승인 즉시 사용) ─────────────────────────────

/** 1) 상품번호(articleNumber) fuzzy 검색 → SPU 목록. 국내가로 POIZON 상품 찾을 때. */
export async function querySpuByArticleNumber(
  articleNumber: string,
  region = "US",
  opts: CallOpts<z.infer<typeof zSpuList>> = {}
) {
  return callPoizon(
    POIZON_API.spuByArticleNumber,
    { articleNumber, region, pageNum: 1, pageSize: 20 },
    { schema: zSpuList, ...opts }
  );
}

/** 2) globalSpuId 배치 → SPU 상세(다국어). */
export async function querySpuByGlobalSpuId(
  globalSpuIds: (string | number)[],
  region = "US",
  opts: CallOpts<z.infer<typeof zSpuList>> = {}
) {
  return callPoizon(
    POIZON_API.spuByGlobalSpuId,
    { globalSpuIds, region, language: "ko" },
    { schema: zSpuList, ...opts }
  );
}

/** 최저가 추천 요청 파라미터 (문서 batchPrice 샘플 기준). */
export interface RecommendParams {
  /** DW skuId 배열(최대 20). skuIds/globalSkuIdList 중 하나 필수. skuIds 권장. */
  globalSkuIdList?: (string | number)[];
  region?: string; // "US"
  currency?: string; // "USD"
  countryCode?: string; // "US"
  biddingType?: number; // 샘플 20
  saleType?: number; // 샘플 7
  uid?: number; // 판매자 uid(미지정 시 env POIZON_UID)
}

/**
 * 3) 최저가 기반 입찰 추천(배치) — 방어선/목표가 판단의 POIZON 측 기준값.
 *   경로 ✅확정: /dop/api/v1/pop/api/v1/recommend-bid/batchPrice
 *   바디: skuIds[](또는 globalSkuIdList) · region · currency · countryCode · biddingType · saleType · uid.
 *   ⚠️ biddingType/saleType 의미·응답 스키마는 문서로 최종 확정.
 */
export async function queryListingRecommendations(
  skuIds: (string | number)[],
  params: RecommendParams = {},
  opts: CallOpts<z.infer<typeof zRecommendList>> = {}
) {
  const skus = (skuIds ?? []).slice(0, 20).map(Number).filter(Number.isFinite);
  const globals = (params.globalSkuIdList ?? []).slice(0, 20).map(Number).filter(Number.isFinite);
  if (skus.length === 0 && globals.length === 0)
    throw new PoizonApiError(
      "EMPTY",
      "skuIds 또는 globalSkuIdList 중 하나는 필요합니다(최대 20개, skuIds 권장)."
    );
  const uid =
    params.uid ??
    (process.env.POIZON_UID ? Number(process.env.POIZON_UID) : undefined);
  const body: Record<string, unknown> = {
    language: "ko",
    timeZone: "Asia/Seoul",
    region: params.region ?? "US",
    currency: params.currency ?? "USD",
    countryCode: params.countryCode ?? "US",
    biddingType: params.biddingType ?? 20,
    saleType: params.saleType ?? 7,
  };
  if (skus.length) body.skuIds = skus;
  if (globals.length) body.globalSkuIdList = globals;
  if (uid != null && Number.isFinite(uid)) body.uid = uid;
  return callPoizon(POIZON_API.listingRecommendBatch, body, {
    schema: zRecommendList,
    ...opts,
  });
}

export interface AutoBidItem {
  skuId: string | number;
  /** 판매가/입찰가(현지 통화 최소단위 여부는 문서 확인). */
  price: number;
  quantity?: number;
}

/** 4) 자동 입찰 제출. 우리 엔진의 방어선 이상 가격만 넣어 호출. */
export async function submitAutoBidding(
  items: AutoBidItem[],
  region = "US",
  opts: CallOpts<z.infer<typeof zSubmitResult>> = {}
) {
  if (items.length === 0)
    throw new PoizonApiError("EMPTY", "입찰할 항목이 없습니다.");
  return callPoizon(
    POIZON_API.submitAutoBid,
    { region, items },
    { schema: zSubmitResult, ...opts }
  );
}

// followType: 7=중국 최저가 추종, 8=중국 최저가보다 항상 한 단계 낮게(방어선까지만).
export type FollowType = 6 | 7 | 8 | number;

export interface AutoFollowBidParams {
  /** 입찰 번호(내 리스팅). Query listing list에서 획득. */
  biddingNo: string;
  /** 추종 하한가 = 방어선. 이 아래로는 자동 추종하지 않음(우리 엔진 floorBid). */
  lowestPrice: number;
  /** 7=중국 최저가 추종 · 8=한 단계 아래. 기본 8(방어적). */
  followType?: FollowType;
  /** true=자동추종 시작 · false=자동추종 취소. */
  autoSwitch?: boolean;
  /** 발송지: US·CN·HK·TW·MO·JP·KR·FR·IT·GB·ES·DE. */
  countryCode?: string;
  /** 리스팅 통화: CNY·USD·HKD·JPY·SGD·EUR·KRW. */
  currency?: string;
}

const zBoolResult = z.boolean();

/**
 * 4b) 자동 추종 입찰 제출 — ★역경매 자동화 핵심.
 *   경로 ✅확정: /dop/api/v1/pop/api/v1/auto-follow-bidding/submit
 *   followType 8 + lowestPrice(방어선)로 "최저가 추격 금지, 방어선까지만" 구현.
 *   autoSwitch=false로 호출하면 해당 자동추종 취소.
 *   응답 data=boolean(성공 여부).
 */
export async function submitAutoFollowBid(
  params: AutoFollowBidParams,
  opts: CallOpts<boolean> = {}
) {
  if (!params.biddingNo)
    throw new PoizonApiError("EMPTY", "biddingNo(입찰 번호)가 필요합니다.");
  if (!(params.lowestPrice > 0))
    throw new PoizonApiError("EMPTY", "lowestPrice(방어선)는 0보다 커야 합니다.");
  return callPoizon(
    POIZON_API.autoFollowBidSubmit,
    {
      biddingNo: params.biddingNo,
      lowestPrice: Math.round(params.lowestPrice),
      followType: params.followType ?? 8,
      autoSwitch: params.autoSwitch ?? true,
      countryCode: params.countryCode ?? "US",
      currency: params.currency ?? "USD",
    },
    { schema: zBoolResult, ...opts }
  );
}

export interface ListingListParams {
  region?: string; // 지역 코드(예 "KR")
  pageSize?: number;
  /** 페이지 커서. 첫 호출 0, 다음은 직전 응답의 lastOffsetId. */
  exclusiveStartOffsetId?: number;
  /** 1=취소, 2=성공(기본 2). */
  tradeStatus?: number;
  biddingType?: number;
  saleType?: number;
  merchantSpuId?: string;
  /** 사용 시 merchantSpuId 함께 필요. */
  merchantSkuId?: string;
  spuIds?: (string | number)[];
  skuIds?: (string | number)[];
  sellerBiddingNoList?: string[];
}

/**
 * 5a) 내 입찰(리스팅) 목록 — 간이 버전.
 *   경로 ✅확정: /dop/api/v1/pop/api/v1/retrieve-bid/general-type-bidding-list/simple
 *   커서 페이징(exclusiveStartOffsetId → 응답 lastOffsetId).
 *   ★ 응답 item.sellerBiddingNo = 자동추종 입찰의 biddingNo.
 */
export async function queryListingList(
  params: ListingListParams = {},
  opts: CallOpts<z.infer<typeof zListingList>> = {}
) {
  const body: Record<string, unknown> = {
    language: "ko",
    timeZone: "Asia/Seoul",
    region: params.region ?? "KR",
    pageSize: params.pageSize ?? 50,
    exclusiveStartOffsetId: params.exclusiveStartOffsetId ?? 0,
    tradeStatus: params.tradeStatus ?? 2,
  };
  if (params.biddingType != null) body.biddingType = params.biddingType;
  if (params.saleType != null) body.saleType = params.saleType;
  if (params.merchantSpuId) body.merchantSpuId = params.merchantSpuId;
  if (params.merchantSkuId) body.merchantSkuId = params.merchantSkuId;
  if (params.spuIds?.length) body.spuIds = params.spuIds.slice(0, 10);
  if (params.skuIds?.length) body.skuIds = params.skuIds.slice(0, 20);
  if (params.sellerBiddingNoList?.length)
    body.sellerBiddingNoList = params.sellerBiddingNoList;
  return callPoizon(POIZON_API.listingList, body, { schema: zListingList, ...opts });
}

/**
 * 5b) 입찰(리스팅) 취소 — 단일 sellerBiddingNo.
 *   경로 ✅확정: /dop/api/v1/pop/api/v1/cancel-bid/cancel-bidding
 *   바디 { sellerBiddingNo } · 응답 data=boolean.
 */
export async function cancelListing(
  sellerBiddingNo: string,
  opts: CallOpts<boolean> = {}
) {
  if (!sellerBiddingNo)
    throw new PoizonApiError("EMPTY", "취소할 sellerBiddingNo가 필요합니다.");
  return callPoizon(
    POIZON_API.cancelListing,
    { sellerBiddingNo },
    { schema: zBoolResult, ...opts }
  );
}

// ── Seller Authorization (OAuth2 authorization_code) ────
// ✅확정 흐름(ERP/ISV, authorization_code grant):
//   1) 인증 페이지 /authorize 로 판매자 로그인·동의 → redirect_uri?code=...&state=...
//   2) POST /api/v1/h5/passport/v1/oauth2/token (JSON) → access_token/refresh_token
//   3) POST /api/v1/h5/passport/v1/oauth2/refresh_token 로 갱신
//   ※ 토큰 교환/갱신은 sign 불필요 — client_id(appKey)+client_secret(appSecret) 직접.
//   Callback: https://lumiriz.kr/api/poizon/callback (라우트 배선 필요)
export const POIZON_OAUTH = {
  authorize: "/authorize", // ✅ 확인 (호스트 루트)
  token: "/api/v1/h5/passport/v1/oauth2/token", // ✅ 확인
  refreshToken: "/api/v1/h5/passport/v1/oauth2/refresh_token", // ✅ 확인
};

/**
 * OAuth redirect_uri — 앱 콘솔의 Redirect URL과 정확히 일치해야 함.
 *   기본값: https://lumiriz.kr/api/poizon/callback (우리 콜백 라우트)
 *   콘솔이 다른 값만 허용하면 env POIZON_REDIRECT_URI로 덮어쓰기(코드 수정 불필요).
 */
export function redirectUri(): string {
  return process.env.POIZON_REDIRECT_URI || "https://lumiriz.kr/api/poizon/callback";
}

/** 판매자 인증 동의 URL 생성(리다이렉트용). scope=all 고정, redirect_uri는 encodeURIComponent. */
export function buildAuthorizeUrl(state = ""): string | null {
  const appKey = process.env.POIZON_APP_KEY;
  if (!appKey) return null;
  const base = process.env.POIZON_API_BASE || "https://open.poizon.com";
  const parts = [
    `response_type=code`,
    `client_id=${encodeURIComponent(appKey)}`,
    `redirect_uri=${encodeURIComponent(redirectUri())}`,
    `scope=all`,
    ...(state ? [`state=${encodeURIComponent(state)}`] : []),
  ];
  return `${base}${POIZON_OAUTH.authorize}?${parts.join("&")}`;
}

export interface OAuthTokens {
  accessToken: string;
  accessTokenExpiresAt: number | null; // epoch ms
  refreshToken: string | null;
  refreshTokenExpiresAt: number | null;
  openId: string | null;
  raw: unknown;
}

// 토큰 응답(교환·갱신 공통) 파싱.
function parseTokenResponse(json: any, now: number): OAuthTokens {
  const d = json?.data ?? {};
  const at = d.access_token;
  if (!at) {
    throw new PoizonApiError(
      json?.code ?? "TOKEN_FAIL",
      friendlyError(200, json?.code, String(json?.msg ?? "토큰 응답에 access_token 없음")),
      json
    );
  }
  const atExp = Number(d.access_token_expires_in ?? 0);
  const rtExp = Number(d.refresh_token_expires_in ?? 0);
  return {
    accessToken: String(at),
    accessTokenExpiresAt: atExp > 0 ? now + atExp * 1000 : null,
    refreshToken: d.refresh_token ? String(d.refresh_token) : null,
    refreshTokenExpiresAt: rtExp > 0 ? now + rtExp * 1000 : null,
    openId: d.open_id ? String(d.open_id) : null,
    raw: json,
  };
}

async function postJson(path: string, body: Record<string, unknown>, now: number) {
  const base = process.env.POIZON_API_BASE || "https://open.poizon.com";
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e: any) {
    throw new PoizonApiError("NETWORK", `토큰 요청 연결 실패: ${e?.message ?? e}`);
  }
  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* noop */
  }
  const code = json?.code ?? res.status;
  const ok = res.ok && (code === 200 || code === "200" || code == null);
  if (!ok) {
    throw new PoizonApiError(
      code,
      friendlyError(res.status, code, String(json?.msg ?? text ?? "토큰 요청 실패")),
      json ?? text
    );
  }
  return parseTokenResponse(json, now);
}

/**
 * OAuth authorization_code → Access/Refresh Token 교환.
 *   POST /api/v1/h5/passport/v1/oauth2/token
 *   바디 { client_id, client_secret, authorization_code } (JSON, sign 불필요).
 * 반환 토큰은 서버가 .env/보안저장소에 반영해야 함(여기서 저장하지 않음).
 */
export async function exchangeCodeForToken(
  code: string,
  now: number = Date.now()
): Promise<OAuthTokens> {
  const appKey = process.env.POIZON_APP_KEY;
  const appSecret = process.env.POIZON_APP_SECRET;
  if (!appKey || !appSecret)
    throw new PoizonApiError(
      "MISSING_CREDENTIALS",
      "토큰 교환에는 POIZON_APP_KEY/POIZON_APP_SECRET 필요."
    );
  return postJson(
    POIZON_OAUTH.token,
    { client_id: appKey, client_secret: appSecret, authorization_code: code },
    now
  );
}

/**
 * Refresh Token으로 Access Token 갱신(유효기간 내).
 *   POST /api/v1/h5/passport/v1/oauth2/refresh_token
 *   바디 { client_id, client_secret, refresh_token }.
 */
export async function refreshAccessToken(
  refreshToken: string,
  now: number = Date.now()
): Promise<OAuthTokens> {
  const appKey = process.env.POIZON_APP_KEY;
  const appSecret = process.env.POIZON_APP_SECRET;
  if (!appKey || !appSecret)
    throw new PoizonApiError(
      "MISSING_CREDENTIALS",
      "토큰 갱신에는 POIZON_APP_KEY/POIZON_APP_SECRET 필요."
    );
  return postJson(
    POIZON_OAUTH.refreshToken,
    { client_id: appKey, client_secret: appSecret, refresh_token: refreshToken },
    now
  );
}

// ── 카탈로그 동기화용(기존) — SKU 기본정보 → 판매자 엑셀 행 형태 ──
export interface SellerLikeRow {
  spuId?: string;
  skuId?: string;
  barcode?: string;
  productName: string;
  brand?: string;
  category?: string;
  size?: string;
  priceUsd: number;
  soldCount: number;
}

const zSkuBasicList = z
  .object({
    list: z.array(z.any()).optional(),
    skuList: z.array(z.any()).optional(),
  })
  .passthrough();

/**
 * SKU 기본정보 조회 → 카탈로그 동기화(판매자 엑셀 대체).
 *   Business: skuIds[] · region("US"=중국시장 달러) · seller/buyStatusEnable.
 * ⚠️ 응답 필드는 200 샘플로 최종 확정 — 방어적 매핑.
 */
export async function fetchSkuBasicInfo(
  skuIds: (string | number)[],
  timestampMs: number = Date.now(),
  region = "US"
): Promise<SellerLikeRow[]> {
  const data = await callPoizon(
    POIZON_API.skuBasicInfoBySku,
    {
      skuIds: skuIds.map(id => Number(id)).filter(n => Number.isFinite(n)),
      sellerStatusEnable: true,
      buyStatusEnable: true,
      region,
    },
    { schema: zSkuBasicList, timestampMs }
  );
  const list: any[] = (data as any)?.list ?? (data as any)?.skuList ?? [];
  return list
    .map((it: any): SellerLikeRow | null => {
      const productName = String(it.spuName ?? it.productName ?? it.title ?? "").trim();
      if (!productName) return null;
      return {
        spuId: it.spuId != null ? String(it.spuId) : undefined,
        skuId: it.skuId != null ? String(it.skuId) : undefined,
        barcode: it.barcode ? String(it.barcode) : undefined,
        productName: productName.slice(0, 300),
        brand: it.brandName ? String(it.brandName).slice(0, 100) : undefined,
        category: it.categoryName ? String(it.categoryName).slice(0, 40) : undefined,
        size: it.sizeDesc
          ? String(it.sizeDesc).slice(0, 40)
          : it.sizeName
            ? String(it.sizeName).slice(0, 40)
            : undefined,
        priceUsd: Number(it.avgPrice ?? it.price ?? 0) || 0,
        soldCount: Number(it.soldCount ?? it.salesVolume ?? 0) || 0,
      };
    })
    .filter((r): r is SellerLikeRow => r !== null);
}

// ── 자가진단 (승인/토큰 후 各 인터페이스 "测试未通过"→통과 구동) ──
// POIZON은 인터페이스별 성공 테스트 호출 1회를 요구한다. 자격증명이 채워지면
// 이 함수로 읽기형 핵심 인터페이스를 실제 호출해 연결·서명·권한을 검증한다.
//   쓰기형(입찰 제출/취소)은 파괴적이라 자동 실행하지 않고 '수동 확인' 표기.
export interface SelfTestResult {
  key: string;
  interfaceName: string;
  ok: boolean;
  skipped: boolean;
  message: string;
}

export async function selfTest(
  sampleArticleNumber = "FJ4170-004"
): Promise<{ ready: boolean; results: SelfTestResult[] }> {
  const r = readiness();
  const results: SelfTestResult[] = [];

  const run = async (
    key: string,
    interfaceName: string,
    fn: (() => Promise<unknown>) | null,
    skipMsg?: string
  ) => {
    if (!r.ready) {
      results.push({ key, interfaceName, ok: false, skipped: true, message: "자격증명 미설정 — 승인·토큰 후 실행" });
      return;
    }
    if (!fn) {
      results.push({ key, interfaceName, ok: false, skipped: true, message: skipMsg ?? "수동 확인 필요" });
      return;
    }
    try {
      await fn();
      results.push({ key, interfaceName, ok: true, skipped: false, message: "OK — 연결·서명·권한 정상" });
    } catch (e: any) {
      // POIZON 원본 code·msg를 그대로 노출(진단용) — 서명/권한/토큰 구분에 필수
      let msg = e instanceof PoizonApiError ? e.message : String(e?.message ?? e);
      if (e instanceof PoizonApiError) {
        const raw = e.raw as any;
        const poizonMsg =
          typeof raw === "string"
            ? raw.slice(0, 200)
            : raw?.msg ?? raw?.message ?? raw?.errorMsg ?? "";
        const traceId = typeof raw === "object" ? raw?.trace_id ?? raw?.traceId ?? "" : "";
        msg = `[code=${e.code}] ${poizonMsg ? `POIZON:"${poizonMsg}"` : e.message}${traceId ? ` · trace ${traceId}` : ""}`;
      }
      results.push({ key, interfaceName, ok: false, skipped: false, message: msg });
    }
  };

  // 읽기형(안전) — 실제 호출로 검증
  await run("spuByArticleNumber", "Query SPU Basic Information by Article Number", () =>
    querySpuByArticleNumber(sampleArticleNumber)
  );
  await run("listingList", "Simplified Bidding List Query", () =>
    queryListingList({ pageSize: 1 })
  );
  // id 의존/쓰기형 — 자동 실행 보류
  await run("spuByGlobalSpuId", "Query Spu Basic Information by globalSpuId", null,
    "globalSpuId 필요 — 1번(Article Number) 결과의 id로 이어서 테스트");
  await run("listingRecommendBatch", "(Get Lowest Price) Listing Recommendations - Batch", null,
    "skuId 필요 — SPU 조회 결과로 테스트");
  await run("submitAutoBid", "Submit Automatic Bidding", null,
    "쓰기(입찰) — 실제 소량 페이로드로 통제된 상황에서 별도 확인");
  await run("cancelListing", "Cancel Listing", null,
    "쓰기(취소) — 실제 리스팅으로 별도 확인");

  return { ready: r.ready, results };
}
