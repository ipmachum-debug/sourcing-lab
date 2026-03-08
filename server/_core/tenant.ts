/**
 * 단일 테넌트 시스템 헬퍼
 * 모든 사용자가 같은 데이터를 조회하도록 고정된 테넌트 ID 반환
 */

import { ENV } from "./env";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

let cachedTenantId: number | null = null;

/**
 * 고정된 테넌트 ID 반환 (비동기)
 * OWNER_OPEN_ID 환경 변수에 해당하는 사용자의 실제 ID를 데이터베이스에서 조회
 * 성능 최적화를 위해 첫 조회 후 캐싱
 */
export async function getTenantId(): Promise<number> {
  // 캐시된 값이 있으면 반환
  if (cachedTenantId !== null) {
    return cachedTenantId;
  }

  // 데이터베이스에서 OWNER_OPEN_ID에 해당하는 사용자 조회
  const db = await getDb();
  if (!db) {
    throw new Error("Database connection failed");
  }
  
  // 먼저 OWNER_OPEN_ID로 조회 시도
  let [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.openId, ENV.ownerOpenId))
    .limit(1);

  // OWNER_OPEN_ID로 찾지 못하면 isSuperAdmin=true인 사용자 중 가장 작은 ID 사용 (일관성 확보)
  if (!owner) {
    [owner] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.isSuperAdmin, true))
      .orderBy(users.id)
      .limit(1);
  }

  if (!owner) {
    throw new Error(`Owner user not found: ${ENV.ownerOpenId}`);
  }

  // 캐싱
  cachedTenantId = owner.id;
  return owner.id;
}
