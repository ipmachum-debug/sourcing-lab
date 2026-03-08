# Sourcing Lab — 프로젝트 매뉴얼

> **Version** : v5.7.0 · **Last Updated** : 2026-03-08
> **URL** : https://lumiriz.kr
> **Repository** : https://github.com/ipmachum-debug/sourcing-lab

---

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [기술 스택](#2-기술-스택)
3. [디렉토리 구조](#3-디렉토리-구조)
4. [환경 설정 (.env)](#4-환경-설정)
5. [로컬 개발 환경 구축](#5-로컬-개발-환경-구축)
6. [데이터베이스 (MySQL + Drizzle)](#6-데이터베이스)
7. [서버 아키텍처 (tRPC + Express)](#7-서버-아키텍처)
8. [클라이언트 (React + Vite)](#8-클라이언트)
9. [크롬 확장프로그램 (Coupang Helper Extension v5.7)](#9-크롬-확장프로그램)
10. [인증 시스템](#10-인증-시스템)
11. [핵심 비즈니스 로직 상세](#11-핵심-비즈니스-로직-상세)
12. [프로덕션 배포](#12-프로덕션-배포)
13. [트러블슈팅](#13-트러블슈팅)

---

## 1. 프로젝트 개요

**Sourcing Lab**은 쿠팡 셀러를 위한 **올인원 소싱 · 판매 관리 플랫폼**입니다.

### 핵심 기능 요약

| 영역 | 기능 | 설명 |
|------|------|------|
| **소싱** | 데일리 소싱 | 매일 상품 아이디어를 기록·평가·관리 |
| | 소싱 코치 | AI 기반 소싱 점수 산출 + 1688 이미지 검색 |
| | 소싱 후보 | 확장프로그램으로 발견한 후보 상품 관리 |
| **판매** | 쿠팡 매니저 | 쿠팡 OPEN API 연동 — 주문/매출/정산 자동 동기화 |
| | 데일리 수익 | 일별 판매·수익·마진 대시보드 |
| | 상품 관리 | 상품별 경쟁자·공급처·마진 시나리오 관리 |
| **분석** | 확장프로그램 대시보드 | 검색 스냅샷, 키워드 추적, 경쟁 분석 |
| | 내 상품 추적 (v5.7) | 등록 상품 자동 추적, 경쟁자 수집, AI 인사이트 |
| | 검색 수요 추정 | 키워드별 검색 수요·트렌드 분석 |
| **관리** | 사용자 관리 | 관리자 승인제 회원가입, 권한 관리 |
| | 계정 설정 | 쿠팡 API 계정 (복수 스토어) 연동 |

---

## 2. 기술 스택

### Backend
| 항목 | 기술 | 버전 |
|------|------|------|
| Runtime | Node.js | v22.x |
| Framework | Express.js | v4.21 |
| API Layer | tRPC | v11.6 |
| ORM | Drizzle ORM | v0.44 |
| Database | MySQL | 8.x |
| Build | esbuild | v0.25 |
| Language | TypeScript | v5.9 |

### Frontend
| 항목 | 기술 | 버전 |
|------|------|------|
| Framework | React | v19.2 |
| Bundler | Vite | v7.1 |
| Router | wouter | v3.7.1 (patched) |
| State/API | TanStack Query + tRPC | v5.90 / v11.6 |
| UI Library | shadcn/ui (Radix + Tailwind) | — |
| Charts | Recharts | v2.15 |
| CSS | Tailwind CSS | v4.1 |

### Chrome Extension
| 항목 | 설명 |
|------|------|
| Manifest | V3 |
| Content Scripts | `content.js` (검색), `content-detail.js` (상세), `content-wing.js` (WING) |
| Background | Service Worker (`background.js`) |
| Side Panel | `sidepanel.html/js/css` |
| API Client | `api-client.js` → lumiriz.kr 서버와 통신 |

### Infrastructure
| 항목 | 내용 |
|------|------|
| 서버 | Ubuntu (49.50.130.101) |
| 프로세스 관리 | PM2 |
| 리버스 프록시 | Nginx |
| 도메인 | lumiriz.kr (HTTPS) |
| 포트 | 내부 3003 → Nginx → 443 |
| 패키지 매니저 | pnpm v10.4 |

---

## 3. 디렉토리 구조

```
sourcing-lab/
├── client/                          # 프론트엔드 (React + Vite)
│   ├── index.html                   # HTML 엔트리
│   ├── public/                      # 정적 파일 (확장프로그램 zip 등)
│   │   └── coupang-helper-extension-v5.7.zip
│   └── src/
│       ├── App.tsx                  # 라우터 정의
│       ├── main.tsx                 # React 엔트리
│       ├── index.css                # 글로벌 스타일
│       ├── const.ts                 # 상수
│       ├── _core/hooks/useAuth.ts   # 인증 훅
│       ├── components/
│       │   ├── DashboardLayout.tsx   # 공통 레이아웃 (사이드바 + 헤더)
│       │   ├── CuteLoading.tsx      # 로딩 애니메이션
│       │   ├── ErrorBoundary.tsx     # 에러 핸들링
│       │   └── ui/                  # shadcn/ui 컴포넌트 (50+개)
│       ├── contexts/ThemeContext.tsx # 다크모드
│       ├── hooks/                   # 커스텀 훅
│       ├── lib/
│       │   ├── trpc.ts              # tRPC 클라이언트 설정
│       │   ├── utils.ts             # 유틸리티 (cn 등)
│       │   └── characters.ts        # 캐릭터 설정
│       └── pages/                   # 19개 페이지
│           ├── Landing.tsx          # 랜딩/로그인
│           ├── Dashboard.tsx        # 메인 대시보드
│           ├── DailySourcing.tsx    # 데일리 소싱
│           ├── Products.tsx         # 상품 목록
│           ├── ProductDetail.tsx    # 상품 상세 (경쟁자/공급처/마진)
│           ├── CoupangManager.tsx   # 쿠팡 연동 관리
│           ├── DailyProfitBoard.tsx # 일일 수익 보드
│           ├── ExtensionDashboard.tsx # 확장프로그램 대시보드 (2443줄)
│           ├── ExtensionGuide.tsx   # 확장프로그램 설치 가이드
│           ├── SourcingHelper.tsx   # AI 소싱 코치
│           ├── AccountSettings.tsx  # 쿠팡 API 계정 설정
│           ├── UserManagement.tsx   # 관리자: 사용자 관리
│           ├── WeeklyReview.tsx     # 주간 리뷰
│           ├── TestCandidates.tsx   # 테스트 후보
│           └── Profile.tsx          # 프로필
│
├── server/                          # 백엔드 (Express + tRPC)
│   ├── _core/                       # 핵심 인프라
│   │   ├── index.ts                 # Express 서버 시작점 (포트/배포웹훅/이미지프록시)
│   │   ├── env.ts                   # 환경변수 로드 (dotenv)
│   │   ├── context.ts               # tRPC 컨텍스트 (req/res/user)
│   │   ├── trpc.ts                  # tRPC 라우터/프로시저 정의
│   │   ├── vite.ts                  # Vite dev 미들웨어 / 정적 파일 서빙
│   │   ├── sdk.ts                   # 세션 토큰 생성/검증 (JWT)
│   │   ├── localAuth.ts             # bcrypt 비밀번호 해싱
│   │   ├── cookies.ts               # 쿠키 옵션 (SameSite, Secure 등)
│   │   ├── oauth.ts                 # OAuth 콜백
│   │   ├── llm.ts                   # OpenAI/LLM 호출 (AI 분석)
│   │   ├── tenant.ts                # 테넌트 설정
│   │   ├── notification.ts          # 알림 시스템
│   │   ├── systemRouter.ts          # 시스템 라우터
│   │   ├── dataApi.ts               # 데이터 API
│   │   ├── map.ts                   # 지도 관련
│   │   ├── imageGeneration.ts       # 이미지 생성
│   │   └── voiceTranscription.ts    # 음성 변환
│   ├── db.ts                        # MySQL 커넥션 풀 (Drizzle + mysql2)
│   ├── scoring.ts                   # 소싱 점수 계산 로직 (100점 만점)
│   ├── lib/
│   │   └── coupangApi.ts            # 쿠팡 OPEN API 클라이언트 (HMAC 서명)
│   ├── routers.ts                   # tRPC 앱 라우터 (모든 서브 라우터 결합)
│   └── routers/                     # 비즈니스 라우터 (11개)
│       ├── extension.router.ts      # ★ 확장프로그램 API (3202줄) — 핵심
│       ├── sourcingCoach.router.ts  # AI 소싱 코치 (1588줄)
│       ├── coupang.router.ts        # 쿠팡 API 연동 (1378줄)
│       ├── dailyProfit.router.ts    # 일일 수익 (397줄)
│       ├── product.router.ts        # 상품 CRUD (377줄)
│       ├── dashboard.router.ts      # 대시보드 집계 (292줄)
│       ├── sourcing.router.ts       # 소싱 관리 (197줄)
│       ├── accounts.router.ts       # 계정 관리 (141줄)
│       ├── review.router.ts         # 리뷰 분석 (139줄)
│       ├── profile.router.ts        # 프로필 (133줄)
│       └── coupangWatchlist.router.ts # 감시 목록 (63줄)
│
├── coupang-helper-extension/         # 크롬 확장프로그램 소스
│   ├── manifest.json                # Chrome Manifest V3
│   ├── background.js                # Service Worker (935줄)
│   ├── content.js                   # 쿠팡 검색 결과 페이지 (1330줄)
│   ├── content-detail.js            # 쿠팡 상품 상세 페이지 (655줄)
│   ├── content-wing.js              # 쿠팡 WING 셀러센터 (885줄)
│   ├── injected-wing.js             # WING 페이지에 주입되는 스크립트 (292줄)
│   ├── api-client.js                # 서버 API 클라이언트 (189줄)
│   ├── sidepanel.js                 # 사이드 패널 로직 (2436줄)
│   ├── sidepanel.html               # 사이드 패널 HTML
│   └── sidepanel.css                # 사이드 패널 스타일
│
├── drizzle/                          # DB 스키마 & 마이그레이션
│   ├── schema.ts                    # ★ Drizzle 테이블 정의 (602줄, 22개 테이블)
│   ├── 0000_early_overlord.sql      # 초기 스키마
│   ├── ...
│   ├── 0008_keyword_daily_stats.sql # 키워드 일별 통계
│   └── 0009_product_tracking.sql    # 내 상품 추적 (v5.7)
│
├── shared/                           # 서버 + 클라이언트 공유
│   ├── types.ts                     # 공용 타입
│   ├── const.ts                     # 공용 상수 (COOKIE_NAME 등)
│   ├── categories.ts                # 카테고리 목록
│   └── _core/errors.ts              # 에러 정의
│
├── patches/                          # pnpm 패치
│   └── wouter@3.7.1.patch           # wouter 라우트 수집 패치
│
├── package.json                      # 의존성 + 스크립트
├── tsconfig.json                     # TypeScript 설정
├── vite.config.ts                    # Vite 설정
├── drizzle.config.ts                 # Drizzle Kit 설정
├── deploy.sh                         # 프로덕션 배포 스크립트
└── .gitignore
```

---

## 4. 환경 설정

### .env 파일 (프로덕션 서버: `/opt/sourcing-lab/.env`)

```env
# ===== 필수 =====
DATABASE_URL=mysql://root:비밀번호@localhost:3306/sourcing_lab
JWT_SECRET=your-jwt-secret-key
NODE_ENV=production

# ===== 쿠팡 OPEN API (계정별로 DB에 저장) =====
# → coupang_api_accounts 테이블에서 관리

# ===== AI (소싱코치/분석) =====
BUILT_IN_FORGE_API_URL=https://api.openai.com/v1
BUILT_IN_FORGE_API_KEY=sk-xxxx

# ===== 앱 설정 =====
VITE_APP_ID=sourcing-lab
DEPLOY_SECRET=sourcing-lab-deploy-2026

# ===== Optional =====
OAUTH_SERVER_URL=
OWNER_OPEN_ID=
```

### 환경변수 로딩 순서

```
server/_core/env.ts → dotenv({ override: true })
 ↓
ENV 객체로 export (appId, cookieSecret, databaseUrl 등)
 ↓
server/_core/index.ts에서 import "./env" (최상단)
```

---

## 5. 로컬 개발 환경 구축

### 사전 요구사항
- Node.js v22+
- pnpm v10.4+ (`corepack enable && corepack prepare pnpm@10.4.1`)
- MySQL 8.x

### 설치 & 실행

```bash
# 1. 저장소 클론
git clone https://github.com/ipmachum-debug/sourcing-lab.git
cd sourcing-lab

# 2. 의존성 설치
pnpm install

# 3. 환경변수 설정
cp .env.example .env   # (없으면 직접 생성)
# DATABASE_URL, JWT_SECRET 최소 설정

# 4. DB 마이그레이션
# 방법 A: drizzle-kit 사용
pnpm db:push

# 방법 B: SQL 직접 실행
mysql -u root -p sourcing_lab < drizzle/0000_early_overlord.sql
# ... 순서대로 0009까지 실행

# 5. 개발 서버 시작
pnpm dev
# → http://localhost:3000
```

### npm scripts

| 명령 | 설명 |
|------|------|
| `pnpm dev` | 개발 서버 (tsx watch + Vite HMR) |
| `pnpm build` | 프로덕션 빌드 (extension zip + vite + esbuild) |
| `pnpm build:extension` | 확장프로그램 zip만 빌드 |
| `pnpm start` | 프로덕션 실행 (`node dist/index.js`) |
| `pnpm check` | TypeScript 타입 체크 |
| `pnpm db:push` | DB 마이그레이션 생성 + 적용 |

---

## 6. 데이터베이스

### 테이블 구조 (22개 테이블)

#### 🔑 핵심 테이블

| 테이블 | 설명 | 주요 컬럼 |
|--------|------|----------|
| `users` | 사용자 | email, password, role, approved, isSuperAdmin |
| `products` | 소싱 상품 | productName, status, keywords, score, scoreGrade |
| `product_channel_mappings` | 내 상품 ↔ 쿠팡 연결 | internalProductId, sellerProductId, vendorItemId |
| `coupang_api_accounts` | 쿠팡 API 계정 | vendorId, accessKey, secretKey |

#### 📊 판매/정산 테이블

| 테이블 | 설명 |
|--------|------|
| `cp_daily_sales` | 일별 판매 (수량, 매출, 주문건수) |
| `cp_daily_settlements` | 일별 정산 (매출, 수수료, 배송비, 정산금) |
| `daily_sales` | 소싱 상품 일일 판매 |
| `coupang_sync_jobs` | API 동기화 이력 |

#### 🔍 확장프로그램 데이터 테이블

| 테이블 | 설명 |
|--------|------|
| `ext_search_snapshots` | 쿠팡 검색 스냅샷 (키워드별 상품 목록) |
| `ext_candidates` | 소싱 후보 (⭐ 저장한 상품) |
| `ext_rank_trackings` | 순위 추적 데이터 |
| `ext_tracked_keywords` | 추적 키워드 목록 |
| `ext_product_details` | 상품 상세 스냅샷 |
| `ext_keyword_daily_stats` | 키워드 일별 통계 (수요 추정) |
| `ext_notifications` | 알림 |
| `ext_review_analyses` | AI 리뷰 분석 캐시 |
| `ext_wing_searches` | WING 인기상품 검색 |
| `ext_product_trackings` ⭐ | 내 상품 자동 추적 (v5.7) |
| `ext_product_daily_snapshots` ⭐ | 추적 상품 일일 스냅샷 (v5.7) |

#### 📝 보조 테이블

| 테이블 | 설명 |
|--------|------|
| `product_competitors` | 경쟁자 상품 |
| `product_suppliers` | 1688 공급처 |
| `product_margin_scenarios` | 마진 시나리오 (보수/일반/공격) |
| `product_notes` | 상품 메모 |
| `product_keyword_links` | 키워드별 URL 링크 |
| `weekly_reviews` | 주간 리뷰 |

### DB 연결 방식

```typescript
// server/db.ts
const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  timezone: "+09:00",    // ★ MySQL이 KST로 동작
});
_db = drizzle(pool);
```

> **주의**: 모든 `timestamp` 컬럼은 `.mode("string")`으로 설정하여 KST 문자열 그대로 전달합니다.  
> 클라이언트에서는 `"2026-03-07 19:33:36"` 형태의 KST 문자열을 받습니다.

### 마이그레이션 수동 실행

```bash
# 서버에서
mysql -u root -p'패스워드' sourcing_lab < drizzle/0009_product_tracking.sql

# drizzle-kit 사용
DATABASE_URL="mysql://root:패스워드@localhost/sourcing_lab" pnpm db:push
```

---

## 7. 서버 아키텍처

### 요청 흐름

```
Client (React / Extension)
    ↓ HTTPS
Nginx (lumiriz.kr:443)
    ↓ proxy_pass
Express (localhost:3003)
    ├─ /api/trpc/*    → tRPC 미들웨어 → Router → DB
    ├─ /api/deploy    → 배포 웹훅
    ├─ /api/auth/*    → OAuth 콜백
    ├─ /image-cache/* → 정적 이미지 캐시
    └─ /*             → Vite (개발) / 정적 파일 (프로덕션)
```

### tRPC 라우터 체계

```
appRouter
├── system              # 시스템 (healthcheck 등)
├── auth                # 인증 (login, register, logout, resetPassword)
├── admin               # 관리자 (listUsers, approveUser, deleteUser 등)
├── sourcing            # 소싱 관리
├── product             # 상품 CRUD + 경쟁자/공급처/마진
├── review              # 리뷰 분석
├── dashboard           # 대시보드 집계
├── profile             # 프로필 수정
├── accounts            # 계정 관리 (1688/AliExpress)
├── coupangWatchlist    # 감시 목록
├── dailyProfit         # 일일 수익 보드
├── coupang             # ★ 쿠팡 API 연동
│   ├── syncAll              # 전체 동기화 (주문→매출→정산)
│   ├── getAccounts          # 계정 목록
│   ├── upsertAccount        # 계정 생성/수정
│   ├── testConnection       # API 연결 테스트
│   ├── fetchProducts        # 상품 목록 조회
│   ├── dashboardData        # 대시보드 데이터
│   └── getSettlements       # 정산 내역
├── extension           # ★ 확장프로그램 API (가장 큰 라우터)
│   ├── saveSnapshot         # 검색 스냅샷 저장 + 키워드 자동등록
│   ├── getSnapshots         # 스냅샷 목록
│   ├── saveCandidate        # 소싱 후보 저장
│   ├── getCandidates        # 후보 목록
│   ├── saveRankTracking     # 순위 추적 저장
│   ├── saveProductDetail    # 상품 상세 저장
│   ├── trackKeyword         # 키워드 추적 등록
│   ├── getKeywordDailyStats # 키워드 일별 통계
│   ├── getDemandEstimation  # 검색 수요 추정
│   ├── getAiInsight         # AI 인사이트
│   ├── getProductTrackings  # 내 상품 추적 목록
│   ├── autoRegisterTracking # 자동 추적 등록
│   ├── saveCompetitorData   # 경쟁자 데이터 저장
│   ├── getAiProductSuggestion # AI 상품 제안
│   └── ... (40+ procedures)
└── sourcingCoach       # ★ AI 소싱 코치
    ├── analyzeProduct       # 상품 AI 분석
    ├── search1688           # 1688 이미지 검색
    ├── getDerivativeIdeas   # 파생 상품 아이디어
    └── ...
```

### 핵심 라우터 상세

#### extension.router.ts (3,202줄) — 가장 중요한 라우터

확장프로그램과 서버 간 모든 데이터 교환을 처리합니다:

- **검색 스냅샷**: 쿠팡 검색 시 상품 목록/가격/평점/리뷰/광고 데이터를 스냅샷으로 저장
- **키워드 자동등록**: `saveSnapshot` 시 해당 키워드를 `ext_tracked_keywords`에 자동 등록
- **소싱 후보**: 검색 결과에서 ⭐한 상품을 후보로 관리
- **순위 추적**: 특정 키워드에서 내 상품의 순위 변동 추적
- **상세 파싱**: 상품 상세 페이지의 가격/평점/리뷰/구매수/판매자 등 파싱 데이터 저장
- **검색 수요 추정**: 일별 키워드 통계를 기반으로 수요 지수 계산
- **내 상품 추적 (v5.7)**: products/candidates/mappings에서 자동으로 추적 대상 등록
- **경쟁자 자동 수집**: 검색 시 추적 상품과 관련된 경쟁/유사 상품을 자동 수집
- **AI 분석**: OpenAI를 활용한 상품 분석 + 경쟁 환경 분석 + 전략 제안

#### coupang.router.ts (1,378줄) — 쿠팡 OPEN API

```
쿠팡 OPEN API ─┬─ 주문 조회 (ordersheets v5)
               ├─ 매출 조회 (revenue-history v1)
               ├─ 정산 조회 (settlement-histories v1)
               └─ 상품 조회 (seller-products)
                    ↓
              HMAC SHA256 서명 생성 (server/lib/coupangApi.ts)
                    ↓
              DB 저장 (cp_daily_sales, cp_daily_settlements)
```

- 서명 생성: `HMAC-SHA256( method + path + timestamp, secretKey )`
- 모든 날짜는 KST(UTC+9) 기준
- 복수 스토어 지원 (`coupang_api_accounts`)

#### sourcingCoach.router.ts (1,588줄) — AI 소싱 코치

- OpenAI GPT를 활용한 상품 분석
- 1688 이미지 역검색 (쿠팡 CDN → 서버 캐시 → 1688 검색)
- 파생 상품 아이디어 생성
- 경쟁 환경 분석

### 소싱 점수 계산 (scoring.ts)

```
총 100점 = 키워드(15) + 경쟁도(20) + 차별화(20) + 메모(15) + 개발노트(15) + 기타(15)

등급: S(90+) A(80+) B(65+) C(50+) D(<50)
자동 상태: test_candidate(85+) → reviewing(70+) → hold(55+) → draft
```

---

## 8. 클라이언트

### 페이지 라우팅

| 경로 | 컴포넌트 | 설명 |
|------|---------|------|
| `/` | Landing | 랜딩 + 로그인 |
| `/dashboard` | Dashboard | 메인 대시보드 (요약 통계) |
| `/daily` | DailySourcing | 데일리 소싱 기록 |
| `/daily-profit` | DailyProfitBoard | 일일 수익 보드 (924줄) |
| `/products` | Products | 상품 목록 |
| `/products/:id` | ProductDetail | 상품 상세 (경쟁자/공급처/마진) |
| `/test-candidates` | TestCandidates | 테스트 후보 관리 |
| `/weekly-review` | WeeklyReview | 주간 리뷰 |
| `/coupang` | CoupangManager | 쿠팡 연동 관리 (1047줄) |
| `/sourcing-helper` | SourcingHelper | AI 소싱 코치 (544줄) |
| `/extension` | ExtensionDashboard | 확장프로그램 대시보드 (2443줄) ★ |
| `/extension-guide` | ExtensionGuide | 확장프로그램 설치/사용 가이드 |
| `/settings/accounts` | AccountSettings | 쿠팡 API 계정 설정 |
| `/user-management` | UserManagement | 관리자 전용 사용자 관리 |
| `/profile` | Profile | 프로필 수정 |
| `/register` | Register | 회원가입 |
| `/forgot-password` | ForgotPassword | 비밀번호 찾기 |
| `/reset-password` | ResetPassword | 비밀번호 재설정 |
| `/pending-approval` | PendingApproval | 승인 대기 안내 |

### 공통 레이아웃 (DashboardLayout.tsx)

로그인된 모든 페이지가 사용하는 공통 레이아웃:
- **사이드바**: 네비게이션 메뉴 (접을 수 있음)
- **헤더**: 사용자 정보 + 다크모드 토글
- **반응형**: 모바일에서는 드로어 방식

### tRPC 클라이언트 설정

```typescript
// client/src/lib/trpc.ts
import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../../server/routers";

export const trpc = createTRPCReact<AppRouter>();
```

사용 예:
```tsx
const { data } = trpc.extension.getSnapshots.useQuery({ limit: 20 });
const mutation = trpc.extension.saveCandidate.useMutation();
```

---

## 9. 크롬 확장프로그램

### 아키텍처

```
┌─ Chrome Browser ──────────────────────────────────────────┐
│                                                           │
│  ┌─ Background (Service Worker) ────────────────────┐    │
│  │  background.js                                    │    │
│  │  - 메시지 라우팅 (content ↔ sidepanel ↔ server)  │    │
│  │  - 로그인 상태 관리 (chrome.storage)              │    │
│  │  - 경쟁자 자동수집 (알람 기반)                    │    │
│  │  - 내 상품 추적 데이터 전송                       │    │
│  └───────────────────────────────────────────────────┘    │
│                                                           │
│  ┌─ Content Scripts ────────────────────────────────┐    │
│  │                                                   │    │
│  │  content.js (쿠팡 검색 결과 페이지)               │    │
│  │  - 상품 리스트 파싱 (가격/평점/리뷰/광고/로켓)    │    │
│  │  - 소싱점수 계산 + 오버레이 표시                  │    │
│  │  - 경쟁 강도 분석                                │    │
│  │  - 마진 추정 계산                                │    │
│  │  - 검색 수요 추정                                │    │
│  │  - ⭐ 소싱 후보 저장                             │    │
│  │  - 추적 상품 경쟁자 자동 수집 (v5.7)             │    │
│  │                                                   │    │
│  │  content-detail.js (쿠팡 상품 상세 페이지)        │    │
│  │  - 상세 정보 파싱 (판매자/구매수/옵션/카테고리)   │    │
│  │  - AI 인사이트 표시                              │    │
│  │  - 파생 상품 제안 표시                            │    │
│  │                                                   │    │
│  │  content-wing.js (쿠팡 WING 셀러센터)            │    │
│  │  - 인기상품 검색 데이터 수집                      │    │
│  │  - API 인터셉트 (injected-wing.js)               │    │
│  │  - 소싱코치 버튼 주입                            │    │
│  └───────────────────────────────────────────────────┘    │
│                                                           │
│  ┌─ Side Panel ─────────────────────────────────────┐    │
│  │  sidepanel.html/js/css                            │    │
│  │  - 실시간 분석 결과 표시                         │    │
│  │  - 순위 추적 현황                                │    │
│  │  - 소싱 후보 관리                                │    │
│  │  - 키워드 분석 요약                              │    │
│  │  - 내 상품 추적 상태 (v5.7)                      │    │
│  └───────────────────────────────────────────────────┘    │
│                                                           │
│  ┌─ API Client ─────────────────────────────────────┐    │
│  │  api-client.js                                    │    │
│  │  - BASE_URL: https://lumiriz.kr                   │    │
│  │  - 인증: credentials: "include" (쿠키 기반)       │    │
│  │  - saveSnapshot, saveCandidate, saveRankTracking  │    │
│  │  - saveProductDetail, trackKeyword                │    │
│  │  - saveCompetitorData (v5.7)                      │    │
│  │  - autoRegisterTracking (v5.7)                    │    │
│  └───────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────┘
```

### 설치 방법

1. `/extension-guide` 페이지에서 zip 다운로드
2. `chrome://extensions/` → 개발자 모드 ON
3. "압축 해제된 확장 프로그램 로드" → 압축 해제된 폴더 선택
4. lumiriz.kr에 로그인 → 확장프로그램 자동 인증

### 데이터 수집 흐름

```
쿠팡 검색 → content.js 파싱 → background.js 전달
    ↓
API Client → POST /api/trpc/extension.saveSnapshot
    ↓
서버: 스냅샷 저장 + 키워드 자동등록 + 추적 상품 매칭 + 경쟁자 데이터 수집
    ↓
ExtensionDashboard에서 결과 확인
```

---

## 10. 인증 시스템

### 로그인 방식
- **로컬 인증**: 이메일 + 비밀번호 (bcrypt 해싱)
- **관리자 승인제**: 가입 후 관리자가 `approved` 플래그를 ON 해야 로그인 가능

### 세션 관리
```
로그인 → JWT 세션 토큰 생성 (365일) → httpOnly 쿠키로 저장
    ↓
모든 요청 → 쿠키 → tRPC context에서 토큰 검증 → ctx.user 설정
    ↓
확장프로그램도 같은 쿠키 사용 (credentials: "include")
```

### 권한 체계

| 레벨 | 설명 |
|------|------|
| `publicProcedure` | 인증 불필요 (로그인, 회원가입) |
| `protectedProcedure` | 로그인 필요 (대부분의 API) |
| `ctx.user.isSuperAdmin` | 슈퍼 관리자 (사용자 관리, 권한 설정) |

---

## 11. 핵심 비즈니스 로직 상세

### A. 데일리 소싱 워크플로

```
1. 데일리 소싱 기록 (상품명, 카테고리, 키워드, 경쟁도 등)
    ↓
2. 자동 점수 계산 (100점) + 등급 (S~D) + 자동 상태 결정
    ↓
3. 상품 상세 관리 (경쟁자 분석, 공급처 조사, 마진 시나리오)
    ↓
4. 테스트 후보 → 쿠팡 등록 → product_channel_mappings 연결
    ↓
5. 판매 추적 (쿠팡 API 동기화) → 수익/마진 분석
```

### B. 쿠팡 API 동기화

```
syncAll (자동/수동)
├── fetchOrders  → 주문 조회 (byMinute + byDay)
│   └── cp_daily_sales에 일별 집계
├── fetchRevenue → 매출 조회
│   └── cp_daily_sales 매출 금액 업데이트
└── fetchSettlements → 정산 조회
    └── cp_daily_settlements에 저장
```

- **자동 동기화**: 서버 시작 시 + 주기적 (cron/interval)
- **수동 동기화**: 대시보드에서 "동기화" 버튼
- **날짜 범위**: 기본 최근 7일, 최대 90일

### C. 검색 수요 추정 시스템 (v5.6)

```
일별 키워드 통계 수집 (ext_keyword_daily_stats)
    ↓
전일 대비 비교
├── 리뷰 증가량 → 추정 판매량 (×20 가중)
├── 평균가 변동
├── 상품 수 변동
└── 광고 비율 변동
    ↓
수요 점수 (0~100) + 키워드 종합 점수 산출
    ↓
대시보드에서 트렌드 차트 + 등급 표시
```

### D. 내 상품 자동 추적 시스템 (v5.7) ⭐

```
자동 등록 소스:
├── products (소싱 상품) → 쿠팡 URL이 있는 상품
├── ext_candidates (소싱 후보) → 쿠팡 상품 ID가 있는 후보
└── product_channel_mappings (쿠팡 연결) → 등록된 쿠팡 상품
    ↓
ext_product_trackings 생성
├── 상품명에서 키워드 자동 추출 → ext_tracked_keywords에 자동 등록
├── 추적 빈도: daily / weekly
└── 활성 상태 관리
    ↓
검색 시 경쟁자 자동 수집 (content.js)
├── 추적 상품의 키워드로 검색 시 자동 매칭
├── 유사 상품 데이터 수집 (가격/평점/리뷰)
└── ext_product_daily_snapshots에 일별 저장
    ↓
AI 분석 & 제안
├── 경쟁 환경 분석
├── 가격 전략 제안
├── 시장 포지셔닝 인사이트
└── 대시보드 "내 상품 추적" 탭에서 확인
```

---

## 12. 프로덕션 배포

### 서버 정보

| 항목 | 값 |
|------|-----|
| IP | 49.50.130.101 |
| SSH | `ssh -p 2222 root@lumiriz.kr` |
| 프로젝트 경로 | `/opt/sourcing-lab` |
| Node.js | v22.22.0 |
| PM2 프로세스명 | `sourcing-lab` |
| Nginx 포트 | 443 → localhost:3003 |

### 배포 방법

#### 방법 1: 웹훅 (원격)
```bash
curl -X POST "https://lumiriz.kr/api/deploy?secret=sourcing-lab-deploy-2026"
```

웹훅 동작 순서:
```
git checkout -- .  →  git pull origin main  →  pnpm install
    →  DB migration (0009)  →  pnpm run build  →  pm2 restart
```

#### 방법 2: SSH (직접)
```bash
ssh -p 2222 root@49.50.130.101
cd /opt/sourcing-lab
bash deploy.sh
```

#### 방법 3: 수동
```bash
ssh -p 2222 root@49.50.130.101
cd /opt/sourcing-lab

git checkout -- .
git pull origin main
pnpm install
mysql -u root -p sourcing_lab < drizzle/0009_product_tracking.sql
pnpm run build
pm2 restart sourcing-lab --update-env
```

### PM2 명령어

```bash
pm2 status                          # 프로세스 상태
pm2 logs sourcing-lab --lines 50    # 최근 로그
pm2 restart sourcing-lab            # 재시작
pm2 stop sourcing-lab               # 중지
pm2 monit                           # 실시간 모니터링
```

### Nginx 설정 위치

```
/etc/nginx/sites-available/lumiriz.kr
```

### 배포 확인

```bash
curl -s https://lumiriz.kr/api/deploy/status | jq
# → {"version":"5.7.0","deployed":"...","node":"v22.22.0","uptime":...}
```

---

## 13. 트러블슈팅

### 자주 발생하는 문제

#### 1. `pnpm install` 패치 에러
```
ERR_PNPM_PATCH_NOT_APPLIED: wouter@3.7.1
```
**원인**: wouter 버전이 3.7.1이 아닌 경우
**해결**: `package.json`에서 `"wouter": "3.7.1"` (caret `^` 없이 고정)

#### 2. 배포 시 git 충돌
```
error: Your local changes to ... would be overwritten by merge
```
**원인**: 서버에서 `pnpm build`가 zip 파일을 재생성하면서 로컬 변경 발생
**해결**: `git checkout -- .` 먼저 실행 (deploy.sh에 포함됨)

#### 3. DB KST 시간 오차 (9시간)
**원인**: `drizzle-orm`이 UTC로 강제 변환
**해결**: 모든 timestamp에 `.mode("string")` 사용 (이미 적용됨)

#### 4. 쿠팡 API HMAC 서명 오류
```
Zero-length key
```
**원인**: `COUPANG_SECRET_KEY`가 비어있거나 로드 안 됨
**해결**: `.env` 파일 확인 + `dotenv({ override: true })` 확인

#### 5. 확장프로그램 인증 실패
**원인**: 브라우저 쿠키가 만료되었거나 도메인 불일치
**해결**: lumiriz.kr에서 다시 로그인 → 확장프로그램 자동 인증

#### 6. PM2 포트 충돌 (3003 already in use)
```bash
pm2 kill && pm2 start ecosystem.config.js
# 또는
lsof -i :3003   # 프로세스 확인
kill -9 <PID>   # 강제 종료
pm2 restart sourcing-lab
```

---

> **문서 끝** — 질문이나 추가 필요한 내용은 GitHub Issue로 등록해 주세요.
