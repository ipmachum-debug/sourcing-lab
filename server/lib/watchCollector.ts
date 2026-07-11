// ============================================================
// watchCollector.ts — 발굴 워치 시세 자동수집 (수동/스케줄 공용)
// ============================================================
// 모델번호(sku)로 POIZON SPU 검색 → skuId → batchPrice → 최저 시세($).
//   poizonCny(관례상 USD) 갱신 + 일별 스냅샷 저장(변동폭 추적).
//   순차 실행(밴 안전) — 스케줄 실행 시 호출 간 짧은 지연.

import { and, eq } from "drizzle-orm";
import { reverseSkuWatch, reverseWatchSnapshot } from "../../drizzle/schema";
import {
  readiness,
  querySpuByArticleNumber,
  queryListingRecommendations,
} from "./poizonApi";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** 모델번호로 POIZON 최저 시세($) 조회. 실패 시 null. */
export async function fetchWatchPriceUsd(articleNumber: string): Promise<number | null> {
  const spuRes: any = await querySpuByArticleNumber(articleNumber, "US");
  const list: any[] = Array.isArray(spuRes) ? spuRes : (spuRes?.list ?? []);
  const skuIds: any[] = (list[0]?.skuIdList ?? []).slice(0, 20);
  if (skuIds.length === 0) return null;
  const recs: any = await queryListingRecommendations(skuIds);
  const arr: any[] = Array.isArray(recs) ? recs : (recs?.list ?? []);
  const lows = arr
    .map(rec => {
      const cands = [rec?.usMinPrice, rec?.globalMinPrice, rec?.asiaMinPrice, rec?.localMinPrice]
        .filter((v: any) => typeof v === "number" && v > 0)
        .map((v: number) => v / 100);
      return cands.length ? Math.min(...cands) : null;
    })
    .filter((v): v is number => v != null);
  return lows.length ? Math.round(Math.min(...lows)) : null;
}

/** 한 워치 행 갱신 — 시세 조회 → poizonCny 갱신 + 스냅샷 upsert. 성공 시 시세 반환. */
async function collectRow(db: any, row: any): Promise<number | null> {
  const art = String(row.sku ?? "").trim();
  if (!art) return null;
  const usd = await fetchWatchPriceUsd(art);
  if (usd == null || usd <= 0) return null;
  await db
    .update(reverseSkuWatch)
    .set({ poizonCny: usd })
    .where(and(eq(reverseSkuWatch.id, row.id), eq(reverseSkuWatch.userId, row.userId)));
  await db
    .insert(reverseWatchSnapshot)
    .values({ watchId: row.id, capturedDate: today(), sellUsd: usd })
    .onDuplicateKeyUpdate({ set: { sellUsd: usd } });
  return usd;
}

/** 특정 유저의 워치 전체 수집(수동 트리거). */
export async function collectWatchesForUser(
  db: any,
  uid: number,
  delayMs = 0
): Promise<{ updated: number; total: number; skipped: number; results: any[] }> {
  const rows = await db.select().from(reverseSkuWatch).where(eq(reverseSkuWatch.userId, uid)).limit(100);
  const targets = rows.filter((x: any) => x.sku && String(x.sku).trim());
  let updated = 0;
  const results: any[] = [];
  for (const row of targets) {
    try {
      const usd = await collectRow(db, row);
      if (usd != null) updated++;
      results.push({ id: row.id, sku: String(row.sku), sellUsd: usd, ok: usd != null });
    } catch {
      results.push({ id: row.id, sku: String(row.sku), sellUsd: null, ok: false });
    }
    if (delayMs > 0) await sleep(delayMs);
  }
  return { updated, total: targets.length, skipped: rows.length - targets.length, results };
}

/** 전체 유저 워치 수집(스케줄). 밴 안전을 위해 호출 간 지연. */
export async function collectAllWatches(db: any): Promise<{ updated: number; total: number }> {
  if (!readiness().ready && !(readiness().appKey && readiness().appSecret)) {
    return { updated: 0, total: 0 };
  }
  const rows = await db.select().from(reverseSkuWatch).limit(500);
  const targets = rows.filter((x: any) => x.sku && String(x.sku).trim());
  let updated = 0;
  for (const row of targets) {
    try {
      const usd = await collectRow(db, row);
      if (usd != null) updated++;
    } catch {
      /* 개별 실패 무시 — 다음 행 계속 */
    }
    await sleep(1500); // 순차 + 1.5s 지연 (밴 안전)
  }
  return { updated, total: targets.length };
}
