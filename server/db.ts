import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, sql } from "drizzle-orm";
import { users, type User } from "../drizzle/schema";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      // MySQL 서버가 KST(+09:00)로 동작 — NOW()가 KST를 반환
      // mysql2의 timezone을 '+09:00'으로 설정하면 DB에서 읽은 timestamp를
      // KST(+09:00)로 해석하여 올바른 JS Date 객체를 생성
      // 주의: PM2에서 TZ 환경변수가 없으면 'local'은 UTC가 되므로 명시적으로 지정
      const pool = mysql.createPool({
        uri: process.env.DATABASE_URL,
        timezone: "+09:00",
      });
      _db = drizzle(pool);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

/** openId로 사용자 조회 (SDK 인증에서 사용) */
export async function getUserByOpenId(openId: string): Promise<User | null> {
  const db = await getDb();
  if (!db) return null;
  const [user] = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return user || null;
}

/** 사용자 upsert (lastSignedIn 등 업데이트) */
export async function upsertUser(data: { openId: string | null }): Promise<void> {
  const db = await getDb();
  if (!db || !data.openId) return;
  await db.update(users)
    .set({ lastSignedIn: sql`NOW()` } as any)
    .where(eq(users.openId, data.openId));
}
