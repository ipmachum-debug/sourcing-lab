import "./env"; // dotenv is loaded here before ENV is used
import express from "express";
import { createServer } from "http";
import net from "net";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Trust proxy (behind Nginx)
  app.set("trust proxy", 1);

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));

  // OAuth callback
  registerOAuthRoutes(app);

  // ============================================================
  // Image proxy & cache for 1688 image search
  // 쿠팡 CDN 이미지를 다운로드 → 서버에 캐시 → 공개 URL 제공
  // 1688은 Alibaba 이미지만 직접 인식하므로, 우리 서버에서 접근 가능한 URL을 만들어야 함
  // ============================================================

  // 캐시 디렉토리 생성
  const imageCacheDir = path.join(process.cwd(), "dist", "public", "image-cache");
  if (!fs.existsSync(imageCacheDir)) {
    fs.mkdirSync(imageCacheDir, { recursive: true });
  }

  // 정적 파일 서빙 (이미지 캐시)
  app.use("/image-cache", express.static(imageCacheDir, {
    maxAge: "7d",
    setHeaders: (res) => {
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Cache-Control", "public, max-age=604800");
    },
  }));

  // 1) 기본 이미지 프록시 (스트리밍) - 직접 이미지 전달
  app.get("/api/image-proxy", async (req, res) => {
    try {
      const imageUrl = req.query.url as string;
      if (!imageUrl) {
        return res.status(400).json({ error: "url parameter required" });
      }
      const allowed = [
        "coupangcdn.com",
        "thumbnail.coupangcdn.com",
        "image.coupangcdn.com",
        "img.coupang.com",
        "coupang.com",
      ];
      const urlObj = new URL(imageUrl);
      if (!allowed.some((d) => urlObj.hostname.endsWith(d))) {
        return res.status(403).json({ error: "Domain not allowed" });
      }

      const response = await fetch(imageUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "image/*,*/*",
          Referer: "https://www.coupang.com/",
        },
      });

      if (!response.ok) {
        return res
          .status(response.status)
          .json({ error: "Failed to fetch image" });
      }

      const contentType = response.headers.get("content-type") || "image/jpeg";
      const buffer = Buffer.from(await response.arrayBuffer());

      res.set({
        "Content-Type": contentType,
        "Content-Length": buffer.length.toString(),
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      });
      res.send(buffer);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 2) 이미지 캐시 API - 쿠팡 이미지를 서버에 저장 후 공개 URL 반환
  //    1688이 이 URL을 직접 접근할 수 있음
  app.get("/api/image-cache", async (req, res) => {
    try {
      const imageUrl = req.query.url as string;
      if (!imageUrl) {
        return res.status(400).json({ error: "url parameter required" });
      }
      const allowed = [
        "coupangcdn.com",
        "thumbnail.coupangcdn.com",
        "image.coupangcdn.com",
        "img.coupang.com",
        "coupang.com",
      ];
      const urlObj = new URL(imageUrl);
      if (!allowed.some((d) => urlObj.hostname.endsWith(d))) {
        return res.status(403).json({ error: "Domain not allowed" });
      }

      // URL 해시로 캐시 키 생성
      const hash = crypto.createHash("md5").update(imageUrl).digest("hex");
      const ext = imageUrl.match(/\.(jpe?g|png|gif|webp)/i)?.[1] || "jpg";
      const filename = `${hash}.${ext}`;
      const filepath = path.join(imageCacheDir, filename);

      // 이미 캐시된 경우 바로 URL 반환
      if (fs.existsSync(filepath)) {
        const publicUrl = `https://lumiriz.kr/image-cache/${filename}`;
        return res.json({ success: true, url: publicUrl, cached: true });
      }

      // 쿠팡에서 이미지 다운로드
      const response = await fetch(imageUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "image/*,*/*",
          Referer: "https://www.coupang.com/",
        },
      });

      if (!response.ok) {
        return res
          .status(response.status)
          .json({ error: "Failed to fetch image from Coupang" });
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(filepath, buffer);

      const publicUrl = `https://lumiriz.kr/image-cache/${filename}`;
      return res.json({ success: true, url: publicUrl, cached: false });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 3) 캐시 정리 (7일 이상 된 파일 삭제) - 주기적 호출용
  app.get("/api/image-cache/cleanup", async (_req, res) => {
    try {
      const maxAge = 7 * 24 * 60 * 60 * 1000; // 7일
      const now = Date.now();
      let cleaned = 0;
      const files = fs.readdirSync(imageCacheDir);
      for (const file of files) {
        const fp = path.join(imageCacheDir, file);
        const stat = fs.statSync(fp);
        if (now - stat.mtimeMs > maxAge) {
          fs.unlinkSync(fp);
          cleaned++;
        }
      }
      res.json({ success: true, cleaned, remaining: files.length - cleaned });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // Deploy Webhook — GitHub push → 자동 배포
  // POST /api/deploy?secret=<DEPLOY_SECRET>
  // 서버에서 git pull, build, pm2 restart 실행
  // ============================================================
  app.post("/api/deploy", async (req, res) => {
    const secret = req.query.secret || req.headers["x-deploy-secret"];
    const expected = process.env.DEPLOY_SECRET || "sourcing-lab-deploy-2026";

    if (secret !== expected) {
      return res.status(403).json({ error: "Invalid deploy secret" });
    }

    try {
      const { execSync } = await import("child_process");
      const cwd = process.cwd();
      const log: string[] = [];

      // Step 1: git reset + pull (clean any local changes like rebuilt zips)
      log.push("[1/5] git reset + pull...");
      execSync("git checkout -- . 2>&1 || true", { cwd, timeout: 10000 });
      const pullResult = execSync("git pull origin main", { cwd, timeout: 30000 }).toString();
      log.push(pullResult.trim());

      // Step 2: install dependencies
      log.push("[2/5] pnpm install...");
      const installResult = execSync("pnpm install --frozen-lockfile 2>&1 || pnpm install 2>&1", { cwd, timeout: 60000 }).toString();
      log.push(installResult.trim().slice(-200));

      // Step 3: DB migrations
      log.push("[3/5] DB migrations...");
      try {
        execSync("mysql -u root sourcing_lab < drizzle/0009_product_tracking.sql 2>&1 || true", { cwd, timeout: 15000 });
        log.push("migration 0009 applied (or already exists)");
      } catch (migErr: any) {
        log.push("migration: " + (migErr.message || "").slice(0, 200));
      }

      // Step 4: build
      log.push("[4/5] pnpm run build...");
      const buildResult = execSync("pnpm run build 2>&1", { cwd, timeout: 120000 }).toString();
      log.push(buildResult.trim().slice(-300));

      // Step 5: pm2 restart (graceful, will apply to next process)
      log.push("[5/5] pm2 restart...");
      try {
        execSync("pm2 restart sourcing-lab --update-env 2>&1 || pm2 restart all 2>&1", { cwd, timeout: 15000 });
        log.push("pm2 restart OK");
      } catch (pm2Err: any) {
        log.push("pm2 restart: " + (pm2Err.stderr?.toString() || pm2Err.message).slice(0, 200));
      }

      res.json({ success: true, log, timestamp: new Date().toISOString() });
    } catch (err: any) {
      res.status(500).json({ error: err.message, stderr: err.stderr?.toString().slice(0, 500) });
    }
  });

  // Deploy status check
  app.get("/api/deploy/status", (_req, res) => {
    res.json({
      version: "5.7.0",
      deployed: new Date().toISOString(),
      node: process.version,
      uptime: process.uptime(),
    });
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
