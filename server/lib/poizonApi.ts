// ============================================================
// poizonApi.ts — POIZON Open Platform 연동 (Phase 2, 스캐폴드)
// ============================================================
// 판매자센터 수동 엑셀(Phase 1)을 대체할 자동 동기화. 자격증명이 세팅되면 활성화된다.
//   필요 env: POIZON_APP_KEY, POIZON_APP_SECRET, POIZON_ACCESS_TOKEN
//   (선택) POIZON_API_BASE (기본 https://open.poizon.com)
//
// ⚠️ Sign 알고리즘은 POIZON 공식 "Sign 문서" 기준으로 최종 검증 필요.
//    아래는 오픈플랫폼 공통 패턴(파라미터 사전정렬 → key+value 연결 → secret 래핑 → MD5 대문자).
//    실제 서명 규칙이 다르면 sign()만 교체하면 되도록 격리해 둠.

import crypto from "crypto";

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

/**
 * 공통 서명. 파라미터를 key 사전순 정렬 → "k1v1k2v2..." 연결 →
 * 앞뒤로 appSecret 래핑 → MD5 대문자. (공식 Sign 문서로 검증 필요)
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

/** 공통 파라미터(app_key/access_token/timestamp/language/timeZone) + sign 조립 */
function buildParams(
  cfg: PoizonApiConfig,
  body: Record<string, string | number>
): Record<string, string | number> {
  // timestamp는 호출부에서 주입(테스트 결정성 위해). 여기선 필수 공통 파라미터만.
  const base: Record<string, string | number> = {
    app_key: cfg.appKey,
    access_token: cfg.accessToken,
    language: "ko",
    timeZone: "Asia/Seoul",
    ...body,
  };
  return { ...base, sign: sign(base, cfg.appSecret) };
}

export interface SellerLikeRow {
  spuId?: string;
  barcode?: string;
  productName: string;
  brand?: string;
  category?: string;
  size?: string;
  priceUsd: number;
  soldCount: number;
}

/**
 * SPU 단위 SKU 기본정보 조회 → sellerImport와 동일한 형태로 정규화해서 반환.
 * 자격증명이 없으면 명확히 실패(placeholder 데이터 반환 금지).
 * @param timestampMs 호출 시각(ms) — 서명 파라미터. 호출부에서 Date.now() 주입.
 */
export async function fetchSkuBasicInfoBySpu(
  spuId: string,
  timestampMs: number
): Promise<SellerLikeRow[]> {
  const cfg = readConfig();
  if (!cfg) {
    throw new Error(
      "POIZON Open API 자격증명이 없습니다. POIZON_APP_KEY/POIZON_APP_SECRET/POIZON_ACCESS_TOKEN 를 설정하세요."
    );
  }
  const params = buildParams(cfg, {
    spuId,
    timestamp: timestampMs,
  });
  const url = `${cfg.base}/dop/api/v1/pop/api/v1/intl-commodity/intl/sku/sku-basic-info/by-spu`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    throw new Error(`POIZON API ${res.status}: ${await res.text().catch(() => "")}`);
  }
  const json: any = await res.json();
  // ⚠️ 실제 응답 스키마는 문서/샘플로 확정 필요. 방어적으로 매핑.
  const list: any[] = json?.data?.skuList ?? json?.data ?? [];
  return list
    .map((it: any): SellerLikeRow | null => {
      const productName = String(it.spuName ?? it.productName ?? "").trim();
      if (!productName) return null;
      return {
        spuId: String(it.spuId ?? spuId),
        barcode: it.barcode ? String(it.barcode) : undefined,
        productName: productName.slice(0, 300),
        brand: it.brandName ? String(it.brandName).slice(0, 100) : undefined,
        category: it.categoryName ? String(it.categoryName).slice(0, 40) : undefined,
        size: it.sizeName ? String(it.sizeName).slice(0, 40) : undefined,
        priceUsd: Number(it.avgPrice ?? it.price ?? 0) || 0,
        soldCount: Number(it.soldCount ?? it.salesVolume ?? 0) || 0,
      };
    })
    .filter((r): r is SellerLikeRow => r !== null);
}
