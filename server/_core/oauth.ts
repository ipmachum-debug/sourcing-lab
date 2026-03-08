import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
  // OAuth 로그인 완전 차단 - 로컬 인증만 사용
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    res.status(403).json({ 
      error: "OAuth login is disabled. Please use local authentication.",
      message: "이 시스템은 로컬 인증만 지원합니다. OAuth 로그인은 비활성화되었습니다."
    });
  });
}
