// ============================================================
// watchScheduler.ts — 발굴 워치 시세 자동수집 스케줄러
// ============================================================
// 부팅 시 시작, 6시간마다 전체 워치의 POIZON 시세를 순차 자동수집.
//   일별 스냅샷 upsert라 하루 여러 번 돌아도 오늘 값만 갱신 → 안전.
//   POIZON 자격증명 없으면 조용히 skip.

import { getDb } from "../db";
import { collectAllWatches } from "../lib/watchCollector";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

const INTERVAL_MS = 6 * 60 * 60_000; // 6시간
const BOOT_DELAY_MS = 60_000; // 부팅 60초 후 첫 실행

async function runOnce() {
  if (running) return; // 중복 실행 방지
  running = true;
  try {
    const db = await getDb();
    if (!db) return;
    const { updated, total } = await collectAllWatches(db);
    if (total > 0) {
      // eslint-disable-next-line no-console
      console.log(`[watchScheduler] 자동수집 완료 — ${updated}/${total}건 갱신`);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[watchScheduler] 수집 오류:`, (e as any)?.message ?? e);
  } finally {
    running = false;
  }
}

export function startWatchScheduler() {
  if (timer) return;
  setTimeout(runOnce, BOOT_DELAY_MS);
  timer = setInterval(runOnce, INTERVAL_MS);
  // eslint-disable-next-line no-console
  console.log("[watchScheduler] 발굴 워치 자동수집 스케줄러 시작 (6시간 주기)");
}

export function stopWatchScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
