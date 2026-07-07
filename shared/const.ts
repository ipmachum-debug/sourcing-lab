export const COOKIE_NAME = "app_session_id";

// POIZON 시세 기준 환율 (원/$, KRW per USD). reverseProfit.DEFAULT_COST.rate와 일치 유지.
//   한국 로케일 판매자 엑셀은 금액이 KRW 문자열 → 이 환율로 USD 정규화.
export const KRW_USD_RATE = 1350;
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';
