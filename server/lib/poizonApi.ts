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
  return { appKey, appSecret, accessToken, ready: appKey && appSecret && accessToken };
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

// ── 서명 ────────────────────────────────────────────────
/**
 * 공통 서명. 파라미터 key 사전순 정렬 → "k1v1k2v2..." 연결 →
 * 앞뒤 appSecret 래핑 → MD5 대문자. (공식 Sign Tool로 최종 검증 필요)
 */
export function sign(
  params: Record<string, string | number>,
  appSecret: string
): string {
  const keys = Object.keys(params)
    .filter(k => k !== "sign" && params[k] !== "" && params[k] != null)
    .sort();
  const joined = keys.map(k => `${k}${params[k]}`).join("");
  const raw = `${appSecret}${joined}${appSecret}`;
  return crypto.createHash("md5").update(raw, "utf8").digest("hex").toUpperCase();
}

/** 공통(인증) 파라미터 + sign 조립. sign은 인증 파라미터 위에서 계산(비즈니스 바디 제외). */
function buildAuthParams(
  cfg: PoizonApiConfig,
  timestampMs: number
): Record<string, string | number> {
  const base: Record<string, string | number> = {
    app_key: cfg.appKey,
    access_token: cfg.accessToken,
    timestamp: timestampMs,
    language: "ko",
    timeZone: "Asia/Seoul",
  };
  return { ...base, sign: sign(base, cfg.appSecret) };
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
export async function callPoizon<T = unknown>(
  ep: { path: string; method: string },
  bizParams: Record<string, unknown>,
  opts: CallOpts<T> = {}
): Promise<T> {
  const cfg = readConfig();
  if (!cfg) {
    throw new PoizonApiError(
      "MISSING_CREDENTIALS",
      "POIZON 자격증명 미설정 — POIZON_APP_KEY/POIZON_APP_SECRET/POIZON_ACCESS_TOKEN 필요. (App Secret·Token은 서버 .env에만)"
    );
  }
  const timestamp = opts.timestampMs ?? Date.now();
  const auth = buildAuthParams(cfg, timestamp);
  const qs = new URLSearchParams(
    Object.entries(auth).map(([k, v]) => [k, String(v)])
  ).toString();
  const url = `${cfg.base}${ep.path}?${qs}`;
  const method = (ep.method || "POST").toUpperCase();

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(bizParams),
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

// ── Seller Authorization (Access Token 발급) 스캐폴드 ────
// 승인 후 OAuth 흐름: 인증 URL로 판매자 동의 → callback(code) → 토큰 교환.
//   Callback: https://lumiriz.kr/api/poizon/callback (라우트 별도 배선 필요)
//   ⚠️ authorize/token 엔드포인트·파라미터는 문서 확정 후 채움.
export const POIZON_OAUTH = {
  authorize: "/dop/oauth/authorize", // 추정
  token: "/dop/oauth/token", // 추정
  redirectUri: "https://lumiriz.kr/api/poizon/callback",
};

/** 판매자 인증 동의 URL 생성(리다이렉트용). */
export function buildAuthorizeUrl(state = ""): string | null {
  const appKey = process.env.POIZON_APP_KEY;
  if (!appKey) return null;
  const base = process.env.POIZON_API_BASE || "https://open.poizon.com";
  const qs = new URLSearchParams({
    app_key: appKey,
    redirect_uri: POIZON_OAUTH.redirectUri,
    response_type: "code",
    ...(state ? { state } : {}),
  }).toString();
  return `${base}${POIZON_OAUTH.authorize}?${qs}`;
}

/**
 * OAuth code → Access Token 교환(스캐폴드).
 * 반환 토큰은 서버가 .env/보안저장소에 반영해야 함(여기서 저장하지 않음).
 * ⚠️ token 엔드포인트/파라미터/응답은 문서 확정 후 수정.
 */
export async function exchangeCodeForToken(
  code: string,
  timestampMs = Date.now()
): Promise<{ accessToken: string; expiresAt: number | null; raw: unknown }> {
  const appKey = process.env.POIZON_APP_KEY;
  const appSecret = process.env.POIZON_APP_SECRET;
  if (!appKey || !appSecret)
    throw new PoizonApiError(
      "MISSING_CREDENTIALS",
      "토큰 교환에는 POIZON_APP_KEY/POIZON_APP_SECRET 필요."
    );
  const base = process.env.POIZON_API_BASE || "https://open.poizon.com";
  const params: Record<string, string | number> = {
    app_key: appKey,
    code,
    grant_type: "authorization_code",
    redirect_uri: POIZON_OAUTH.redirectUri,
    timestamp: timestampMs,
  };
  const signed = { ...params, sign: sign(params, appSecret) };
  const qs = new URLSearchParams(
    Object.entries(signed).map(([k, v]) => [k, String(v)])
  ).toString();
  let res: Response;
  try {
    res = await fetch(`${base}${POIZON_OAUTH.token}?${qs}`, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
    });
  } catch (e: any) {
    throw new PoizonApiError("NETWORK", `토큰 교환 연결 실패: ${e?.message ?? e}`);
  }
  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* noop */
  }
  const token = json?.data?.accessToken ?? json?.access_token ?? json?.data?.access_token;
  if (!res.ok || !token) {
    throw new PoizonApiError(
      json?.code ?? res.status,
      friendlyError(res.status, json?.code, String(json?.msg ?? text ?? "토큰 교환 실패")),
      json ?? text
    );
  }
  const expiresIn = Number(json?.data?.expiresIn ?? json?.expires_in ?? 0);
  return {
    accessToken: String(token),
    expiresAt: expiresIn > 0 ? timestampMs + expiresIn * 1000 : null,
    raw: json,
  };
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
      const msg = e instanceof PoizonApiError ? e.message : String(e?.message ?? e);
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
