// ============================================================
// poizonTokenStore.ts — POIZON OAuth 토큰 DB 저장/조회/자동갱신
// ============================================================
// Seller Authorization(authorization_code) 결과를 DB에 저장하고,
// API 호출 시 유효한 access_token을 반환한다. 만료 임박 시 refresh_token으로 자동 갱신.
//   ※ poizonApi는 이 모듈을 동적 import로만 참조(순환 의존 방지).

import { getDb } from "../db";
import { poizonOauthToken } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { refreshAccessToken, type OAuthTokens } from "./poizonApi";

const PROVIDER = "poizon";
const REFRESH_BUFFER_MS = 24 * 60 * 60 * 1000; // 만료 1일 전 갱신

// epoch ms → KST "YYYY-MM-DD HH:MM:SS" (schema는 KST 문자열 저장)
function kstStr(ms: number | null): string | null {
  if (!ms) return null;
  return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
}
// KST datetime 문자열 → epoch ms
function kstMs(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(String(s).replace(" ", "T") + "+09:00");
  return Number.isFinite(t) ? t : null;
}

/** 토큰 저장(provider당 1행 upsert). */
export async function saveTokens(tk: OAuthTokens): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB 연결 없음 — 토큰 저장 실패");
  const row = {
    provider: PROVIDER,
    openId: tk.openId ?? null,
    accessToken: tk.accessToken,
    refreshToken: tk.refreshToken ?? null,
    accessExpiresAt: kstStr(tk.accessTokenExpiresAt),
    refreshExpiresAt: kstStr(tk.refreshTokenExpiresAt),
    scope: null as string | null,
  };
  await db
    .insert(poizonOauthToken)
    .values(row)
    .onDuplicateKeyUpdate({
      set: {
        openId: row.openId,
        accessToken: row.accessToken,
        refreshToken: row.refreshToken,
        accessExpiresAt: row.accessExpiresAt,
        refreshExpiresAt: row.refreshExpiresAt,
      },
    });
}

export interface StoredTokenInfo {
  hasToken: boolean;
  openId: string | null;
  accessExpiresAt: string | null;
  refreshExpiresAt: string | null;
  accessExpired: boolean;
}

/** 저장 토큰 메타(만료 여부 포함) — 상태 표시용. */
export async function getStoredInfo(): Promise<StoredTokenInfo> {
  const db = await getDb();
  if (!db) return { hasToken: false, openId: null, accessExpiresAt: null, refreshExpiresAt: null, accessExpired: false };
  const rows = await db
    .select()
    .from(poizonOauthToken)
    .where(eq(poizonOauthToken.provider, PROVIDER))
    .limit(1);
  const r = rows[0];
  if (!r) return { hasToken: false, openId: null, accessExpiresAt: null, refreshExpiresAt: null, accessExpired: false };
  const exp = kstMs(r.accessExpiresAt);
  return {
    hasToken: !!r.accessToken,
    openId: r.openId ?? null,
    accessExpiresAt: r.accessExpiresAt ?? null,
    refreshExpiresAt: r.refreshExpiresAt ?? null,
    accessExpired: exp != null && Date.now() > exp,
  };
}

/** 유효한 access_token 반환. 만료 임박+refresh 가능 시 자동 갱신 후 저장. 없으면 null. */
export async function resolveAccessToken(): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(poizonOauthToken)
    .where(eq(poizonOauthToken.provider, PROVIDER))
    .limit(1);
  const r = rows[0];
  if (!r?.accessToken) return null;
  const exp = kstMs(r.accessExpiresAt);
  const now = Date.now();
  if (r.refreshToken && exp != null && now > exp - REFRESH_BUFFER_MS) {
    try {
      const fresh = await refreshAccessToken(r.refreshToken, now);
      await saveTokens(fresh);
      return fresh.accessToken;
    } catch {
      // 갱신 실패 → 기존 토큰 그대로 시도(아직 유효할 수 있음)
    }
  }
  return r.accessToken;
}
