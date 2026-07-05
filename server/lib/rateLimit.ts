// ============================================================
// rateLimit.ts — 경량 인메모리 슬라이딩 윈도우 레이트 리미터
// ============================================================
// 확장 스케줄러/크론이 snapshotSubmit 등을 남발하지 못하도록 최후 방벽.
// 단일 프로세스 기준(pm2 단일 인스턴스). 다중 인스턴스면 Redis로 승격 필요.

interface Bucket {
  hits: number[];
}

const store = new Map<string, Bucket>();

// 메모리 누수 방지: 주기적으로 오래된 버킷 제거
let lastSweep = Date.now();
function sweep(windowMs: number) {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of store) {
    b.hits = b.hits.filter(t => now - t < windowMs);
    if (b.hits.length === 0) store.delete(k);
  }
}

/**
 * @returns { ok, remaining, retryAfterSec } — ok=false면 한도 초과.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { ok: boolean; remaining: number; retryAfterSec: number } {
  const now = Date.now();
  sweep(windowMs);
  const b = store.get(key) ?? { hits: [] };
  b.hits = b.hits.filter(t => now - t < windowMs);
  if (b.hits.length >= limit) {
    const oldest = b.hits[0];
    store.set(key, b);
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
    };
  }
  b.hits.push(now);
  store.set(key, b);
  return { ok: true, remaining: limit - b.hits.length, retryAfterSec: 0 };
}
