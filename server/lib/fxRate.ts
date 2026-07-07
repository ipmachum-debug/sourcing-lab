// ============================================================
// fxRate.ts — USD→KRW 실시간 환율 (일 단위 캐시 + 폴백)
// ============================================================
// 판매자 엑셀 KRW↔USD 정규화·$ 표시·엔진 기본 환율에 사용.
//   ※ KRW 원본 엑셀은 순이익이 환율 중립(왕복 상쇄)이라 환율은 주로 $ 표시·USD 엑셀 정확도에 영향.

import { KRW_USD_RATE } from "@shared/const";

interface FxCache {
  rate: number;
  source: "live" | "fallback";
  at: number; // epoch ms
}
let cache: FxCache | null = null;
const TTL_MS = 6 * 60 * 60 * 1000; // 6시간

// 무료 공개 API (키 불필요). 실패 시 폴백 상수.
async function fetchLive(): Promise<number | null> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const krw = Number(json?.rates?.KRW);
    // 상식 범위(±) 밖이면 무시 — 잘못된 응답 방어
    if (Number.isFinite(krw) && krw > 800 && krw < 2500) return Math.round(krw);
    return null;
  } catch {
    return null;
  }
}

/** USD→KRW 환율 (6h 캐시). 실패하면 폴백 상수(KRW_USD_RATE). */
export async function getKrwUsdRate(): Promise<FxCache> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache;
  const live = await fetchLive();
  cache = live
    ? { rate: live, source: "live", at: now }
    : { rate: cache?.rate ?? KRW_USD_RATE, source: "fallback", at: now };
  return cache;
}
