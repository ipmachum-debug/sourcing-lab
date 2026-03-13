/**
 * Extension 라우터 공통 헬퍼 & 재사용 유틸
 */
import { TRPCError } from "@trpc/server";
import { getDb } from "../../db";

/** Drizzle-ORM decimal/SUM/AVG/COUNT 결과 → number 변환 */
export function N(v: any): number {
  return Number(v) || 0;
}

/** DB 연결 가져오기 (실패 시 TRPCError) */
export async function getDbOrThrow() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DB 연결 실패",
    });
  return db;
}

// ★ v7.6.0: autoComputeKeywordDailyStat, autoMatchTrackedProducts는
// _autoHelpers.ts로 이동. _helpers.ts에서는 N, getDbOrThrow만 export.
