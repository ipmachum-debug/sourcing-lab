/**
 * ============================================================
 * Deep Scan Service (R5 — 심화수집 큐)
 * ============================================================
 *
 * 웹앱 결과 카드 펼침 → enqueueDeepScan() → market_scan_queue.
 * 확장 폴링 → pollDeepScanTask() (pending/좀비 픽업) → 쿠팡 상세 수집 →
 * submitDeepScanResult() → market_shared_product_details_pool 저장 + done.
 *
 * 원칙:
 *   - 상세는 상품 고유 → product_id 유니크(키워드 무관, 중복 재수집 방지).
 *   - 캐시 신선도 TTL_DAYS 이내면 재수집 안 함.
 *   - running 좀비(유저가 쿠팡 닫음) → running_expires_at 지나면 재픽업.
 */

import { getDb } from "../db";
import { marketScanQueue, marketProductDetails } from "../../drizzle/schema";
import { and, or, eq, gte, lt, inArray, desc, asc, sql } from "drizzle-orm";

export const TTL_DAYS = 14; // 상세 캐시 신선도 (구조 정보라 길게)
export const RUNNING_TIMEOUT_MIN = 10; // running 좀비 복구 기한

const freshCutoff = () => sql`NOW() - INTERVAL ${TTL_DAYS} DAY`;

export interface DeepScanDetail {
  productName?: string;
  mainImageUrl?: string;
  currentPrice?: number;
  sellerName?: string;
  sellerGrade?: string;
  sellerProductCount?: number;
  optionCount?: number;
  optionJson?: unknown;
  deliveryType?: string;
  originCountry?: string;
  brand?: string;
  categoryPath?: string;
  detailImagesCount?: number;
  rating?: number;
  reviewCount?: number;
  discoveredViaKeyword?: string;
}

/**
 * 웹앱: 상품들을 심화수집 큐에 등록. 캐시 신선한 건 스킵.
 */
export async function enqueueDeepScan(opts: {
  productIds: string[];
  keyword?: string;
  userId?: number;
}): Promise<{ cached: number; queued: number }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const productIds = [...new Set(opts.productIds.filter(Boolean))];
  if (!productIds.length) return { cached: 0, queued: 0 };

  // 캐시 신선한 상품
  const fresh = await db
    .select({ pid: marketProductDetails.coupangProductId })
    .from(marketProductDetails)
    .where(and(inArray(marketProductDetails.coupangProductId, productIds), gte(marketProductDetails.lastScannedAt, freshCutoff())));
  const freshSet = new Set(fresh.map(f => f.pid));

  const toQueue = productIds.filter(p => !freshSet.has(p));
  for (const pid of toQueue) {
    await db
      .insert(marketScanQueue)
      .values({
        targetId: pid,
        keyword: opts.keyword ?? null,
        requestedBy: opts.userId ?? null,
        status: "pending",
      })
      .onDuplicateKeyUpdate({
        set: {
          keyword: opts.keyword ?? null,
          requestedBy: opts.userId ?? null,
          // 유효한 running이면 유지, 아니면 pending으로 되살림
          status: sql`IF(status = 'running' AND running_expires_at IS NOT NULL AND running_expires_at > NOW(), status, 'pending')`,
          updatedAt: sql`NOW()`,
        },
      });
  }

  return { cached: freshSet.size, queued: toQueue.length };
}

/**
 * 웹앱: 폴링 — 상품별 캐시 상세 + 큐 상태 반환.
 */
export async function getDeepScanStatus(opts: { productIds: string[] }): Promise<{
  total: number;
  doneCount: number;
  details: (typeof marketProductDetails.$inferSelect)[];
  statusByProduct: Record<string, string>;
}> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const productIds = [...new Set(opts.productIds.filter(Boolean))];
  if (!productIds.length) return { total: 0, doneCount: 0, details: [], statusByProduct: {} };

  const details = await db
    .select()
    .from(marketProductDetails)
    .where(and(inArray(marketProductDetails.coupangProductId, productIds), gte(marketProductDetails.lastScannedAt, freshCutoff())));

  const queueRows = await db
    .select({ targetId: marketScanQueue.targetId, status: marketScanQueue.status })
    .from(marketScanQueue)
    .where(inArray(marketScanQueue.targetId, productIds));

  const freshSet = new Set(details.map(d => d.coupangProductId));
  const statusByProduct: Record<string, string> = {};
  for (const pid of productIds) {
    if (freshSet.has(pid)) statusByProduct[pid] = "done";
    else statusByProduct[pid] = queueRows.find(q => q.targetId === pid)?.status ?? "none";
  }

  return { total: productIds.length, doneCount: freshSet.size, details, statusByProduct };
}

/**
 * 확장: 다음 스캔 작업 픽업 (pending 또는 만료된 running).
 * 낙관적 잠금으로 중복 픽업 방지. 없으면 null.
 */
export async function pollDeepScanTask(): Promise<{
  id: number;
  targetId: string;
  keyword: string | null;
} | null> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const claimable = or(
    eq(marketScanQueue.status, "pending"),
    and(eq(marketScanQueue.status, "running"), lt(marketScanQueue.runningExpiresAt, sql`NOW()`))
  );

  const [cand] = await db
    .select({ id: marketScanQueue.id, targetId: marketScanQueue.targetId, keyword: marketScanQueue.keyword })
    .from(marketScanQueue)
    .where(claimable)
    .orderBy(desc(marketScanQueue.priority), asc(marketScanQueue.createdAt))
    .limit(1);

  if (!cand) return null;

  // 낙관적 잠금: 여전히 claimable할 때만 running으로 전환
  await db
    .update(marketScanQueue)
    .set({
      status: "running",
      runningExpiresAt: sql`NOW() + INTERVAL ${RUNNING_TIMEOUT_MIN} MINUTE`,
      attempts: sql`${marketScanQueue.attempts} + 1`,
      updatedAt: sql`NOW()`,
    })
    .where(and(eq(marketScanQueue.id, cand.id), claimable));

  // 우리가 잡았는지 확인
  const [after] = await db
    .select({ status: marketScanQueue.status })
    .from(marketScanQueue)
    .where(eq(marketScanQueue.id, cand.id));

  if (after?.status !== "running") return null; // 다른 워커가 먼저 잡음
  return { id: cand.id, targetId: cand.targetId, keyword: cand.keyword };
}

/**
 * 확장: 스캔 결과 제출 → 상세 풀 upsert + 큐 done.
 */
export async function submitDeepScanResult(opts: {
  targetId: string;
  detail: DeepScanDetail;
}): Promise<{ ok: true }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const d = opts.detail;

  const values = {
    coupangProductId: opts.targetId,
    productName: d.productName ?? null,
    mainImageUrl: d.mainImageUrl ?? null,
    currentPrice: d.currentPrice ?? 0,
    sellerName: d.sellerName ?? null,
    sellerGrade: d.sellerGrade ?? null,
    sellerProductCount: d.sellerProductCount ?? 0,
    optionCount: d.optionCount ?? 0,
    optionJson: (d.optionJson ?? null) as any,
    deliveryType: d.deliveryType ?? null,
    originCountry: d.originCountry ?? null,
    brand: d.brand ?? null,
    categoryPath: d.categoryPath ?? null,
    detailImagesCount: d.detailImagesCount ?? 0,
    rating: String(d.rating ?? 0),
    reviewCount: d.reviewCount ?? 0,
    discoveredViaKeyword: d.discoveredViaKeyword ?? null,
  };

  await db
    .insert(marketProductDetails)
    .values(values)
    .onDuplicateKeyUpdate({ set: { ...values, lastScannedAt: sql`NOW()` } });

  await db
    .update(marketScanQueue)
    .set({ status: "done", runningExpiresAt: null, lastError: null, updatedAt: sql`NOW()` })
    .where(eq(marketScanQueue.targetId, opts.targetId));

  return { ok: true };
}
