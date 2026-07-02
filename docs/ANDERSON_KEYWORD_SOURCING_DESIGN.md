# 꿀통키워드 소싱(AI Keyword Sourcing) 설계도

> ANDERSON.ai(`andcoukeyfinder.com`) / 그로스 분석왕 스타일의
> "AI 꿀통키워드 소싱" 기능을 Sourcing Lab 위에 구현하기 위한 전체 설계 문서.

---

## 0. 요약 (한 줄 결론)

**새로 만드는 게 아니라, 이미 있는 데이터·추정엔진 위에 UI를 새로 입히는 작업이다.**
결과 화면이 보여주는 모든 지표(판매량·리뷰수·상품수·평균가·월매출·등급·효자상품)가
현재 DB 테이블 컬럼과 거의 1:1로 존재한다. 관건은 기능이 아니라 **데이터 커버리지**다.

---

## 1. 레퍼런스 사이트 분석 (스크린샷 기준)

### 1.1 입력 — 4단계 위저드 (`/keywords`)

| 스텝 | 항목 | 옵션 / 동작 |
|---|---|---|
| ① | **키워드 티어** (단일 선택) | 초보(월매출 300만~1,000만) · 중수(1,000만~3,000만) · 고수(3,000만+) · 트렌드(리뷰 50↓ + 3,000만+) |
| ② | **효자상품 최대 리뷰수** (슬라이더) | 50 ~ 1,000, 기본 500. "매출 1위 상품의 리뷰가 이 값 이하인 키워드만" |
| ③ | **상품 카테고리** (단일/미선택=전체) | 화장품/미용, 출산/육아, 패션의류, 패션잡화, 스포츠/레저, 여가/생활편의, 생활/건강, 디지털/가전, 가구/인테리어 |
| ④ | **관심 태그** (복수 선택) | 급상승 · 新 신규 · 블루오션 · 계절성 · 로켓공백 · 고단가 |

→ "소싱 시작하기" 클릭 시 조건을 쿼리스트링으로 전달
(`/keywords/loading?tier=beginner&maxReview=100&categories=생활/건강&tags=급상승,新신규,로켓공백`)

### 1.2 처리 — 로딩 연출 (`/keywords/loading`)

- 프로그레스바(%) + 터미널 로그 애니메이션("Connecting to Coupang keyword DB…", "Scanning category…")
- 상단 카운터: KEYWORDS / CATEGORIES / PRODUCTS
- **실제 무거운 연산이라기보다 "분석 중" 연출** — 뒤에서 필터 쿼리 1회 실행

### 1.3 결과 — 등급별 카드 리스트 (`/keywords/results`)

- 헤더: "소싱 완료! 꿀통키워드를 찾았습니다" + "N개 꿀통키워드 발견" 뱃지
- **키워드 카드 (접힘)**: 등급 뱃지(S+/S/A/B) · 키워드명 · 우측 요약(판매량·리뷰수·상품수)
- **키워드 카드 (펼침)**:
  - 티어 뱃지 + 등급 뱃지
  - 5개 스탯 타일: 총판매량 / 총리뷰수 / 상품수(+Low Competition) / 평균가 / 총 월매출(+"Top N개/월")
  - **효자상품 리스트 Top N** — 표 컬럼: 상품명 · 가격 · 리뷰 · 월판매 · 월매출 · AI(→ 쿠팡 상품 링크)
- 하단: "AI 소싱 한번더 하기" 버튼

---

## 2. 데이터 매핑 — 우리 DB에 이미 있는 것

### 2.1 키워드 단위 (카드 요약 + 5개 스탯)

출처: **`ext_keyword_daily_stats`** (+ `keyword_daily_metrics`)

| 결과 화면 | 컬럼 |
|---|---|
| 총판매량 | `ext_keyword_daily_stats.sales_estimate` (= reviewGrowth × 20), `sales_estimate_ma30` |
| 총리뷰수 | `total_review_sum` |
| 상품수 | `product_count` |
| 평균가 | `avg_price` |
| Low/Medium/High Competition | `competition_level` (easy/medium/hard), `competition_score` |
| 총 월매출 | `keyword_daily_metrics` 조인 or Σ(효자상품 monthly_revenue) |
| Top N개/월 | `sales_estimate` (월 환산) |
| 수요 점수 / 종합 점수 | `demand_score`, `keyword_score`(HiddenScore) |

### 2.2 상품 단위 (효자상품 리스트)

출처: **`ext_product_sales_estimates`** + **`ext_product_trackings`**

| 결과 화면 | 컬럼 |
|---|---|
| 상품명 | `ext_product_trackings.title` |
| 가격 | `ext_product_sales_estimates.current_price` |
| 리뷰 | `current_review_count` |
| 월판매 | `estimated_monthly_sales` |
| 월매출 | `estimated_monthly_revenue` |
| 판매 등급 | `sales_grade` (VERY_LOW…VERY_HIGH) |
| 추세 | `trend_direction`, `surge_flag` |
| 쿠팡 링크 | `ext_product_trackings.product_id` → `coupang.com/vp/products/{id}` |

> **핵심**: ANDERSON의 "리뷰 증가량 → 판매량 추정" 방법론이
> 우리 코드에 이미 구현돼 있다(카테고리 리뷰율 기반 추정 엔진 + 부스트 팩터).

---

## 3. 필터/태그 → 쿼리 조건 매핑

| 입력 | 조건 |
|---|---|
| 티어=초보 | `3,000,000 ≤ 월매출 < 10,000,000` |
| 티어=중수 | `10,000,000 ≤ 월매출 < 30,000,000` |
| 티어=고수 | `월매출 ≥ 30,000,000` |
| 티어=트렌드 | `월매출 ≥ 30,000,000 AND 효자상품 최대리뷰 ≤ 50` |
| 최대 리뷰수 슬라이더 | `MAX(효자상품.current_review_count) ≤ maxReview` |
| 카테고리 | `keyword_master.category_hint = ?` (미선택 시 전체) |
| 급상승 | `ext_keyword_daily_stats.spike_level IN ('rising','surging','explosive')` |
| 新 신규 | `keyword_daily_metrics.coupang_new_product_30d > 0` |
| 블루오션 | `competition_level = 'easy'` |
| 계절성 | (신규 신호 필요 — §7 TODO) |
| 로켓공백 | `rocket_count / product_count < 임계값` |
| 고단가 | `avg_price ≥ 임계값(예: 20,000)` |

---

## 4. 등급 산정 로직 (S+/S/A/B)

기존 `keyword_score`(HiddenScore) 또는 새 "꿀통 스코어" 사용:

```
꿀통스코어 = w1·정규화(월매출)
           + w2·정규화(판매량)
           - w3·정규화(효자상품 최대리뷰)   // 리뷰 적을수록 가점(진입 난이도↓)
           - w4·정규화(competition_score)    // 경쟁 낮을수록 가점
           + w5·spike_boost                  // 급상승 가점

등급:  S+ ≥ 85 · S ≥ 70 · A ≥ 55 · B ≥ 40 · (그 미만 제외)
```

- 가중치는 `server/lib/keywordScorer.ts`의 기존 `scoreKeyword()` 재사용/확장.
- `keyword_daily_metrics.final_score`가 이미 있으니 1차로는 그걸 등급 버킷으로 매핑.

---

## 5. 백엔드 설계 (tRPC)

`server/routers/keywordDiscovery.router.ts`에 프로시저 추가 (기존 라우터 재사용):

```ts
// 꿀통키워드 소싱 — 필터 → 등급별 결과
honeypotSearch: protectedProcedure
  .input(z.object({
    tier: z.enum(["beginner","intermediate","advanced","trend"]),
    maxReview: z.number().int().min(50).max(1000).default(500),
    categories: z.array(z.string()).default([]),   // 미선택=전체
    tags: z.array(z.enum([
      "surge","new","blue_ocean","seasonal","rocket_gap","high_price"
    ])).default([]),
    limit: z.number().int().min(1).max(50).default(20),
  }))
  .query(async ({ ctx, input }) => {
    // 1) ext_keyword_daily_stats 최신 스냅샷 조회 (userId 스코프)
    // 2) tier/maxReview/category/tag 조건 필터
    // 3) 효자상품 Top N (ext_product_sales_estimates) 조인
    // 4) 꿀통스코어 계산 → 등급 버킷 → 정렬
    // 5) { totalFound, items:[{ keyword, grade, tier, stats, topProducts[] }] }
  }),
```

- 통계 프리뷰용 `honeypotStats`(KEYWORDS/CATEGORIES/PRODUCTS 카운터) 1개 추가 — 로딩 화면용.
- 무거운 스캔이 아니라 **인덱스 필터 쿼리 1~2회**. 성능 부담 낮음.

---

## 6. 프론트엔드 설계

### 6.1 라우트 (wouter, `client/src/App.tsx`)

```
/keyword-sourcing            → KeywordSourcing.tsx      (4단계 위저드)
/keyword-sourcing/loading    → KeywordSourcingLoading.tsx (연출)
/keyword-sourcing/results    → KeywordSourcingResults.tsx (등급별 결과)
```

> 기존 `/niche-finder`(NicheFinder.tsx)는 내부 관리자용으로 유지,
> 신규 3개 페이지는 판매자 대상 "제품형" UI로 분리.

### 6.2 컴포넌트 (shadcn/ui 재사용)

- `TierCard` — 티어 선택 카드 (Radio 그룹)
- `ReviewSlider` — shadcn Slider
- `CategoryGrid` · `TagChips` — Toggle/Badge
- `HoneypotKeywordCard` — Accordion(접힘/펼침) + 등급 뱃지
- `StatTile` ×5 — 스탯 타일 (dataviz 스킬로 스파크라인)
- `TopProductsTable` — 효자상품 표 + 쿠팡 링크
- `SourcingLoader` — 프로그레스 + 터미널 로그 연출

### 6.3 데이터 흐름

위저드 상태 → `trpc.keywordDiscovery.honeypotStats`(로딩) →
`trpc.keywordDiscovery.honeypotSearch`(결과). 쿼리스트링으로 상태 보존.

---

## 7. 관건 · TODO — 데이터 커버리지

ANDERSON은 사전 수집한 쿠팡 키워드 DB(키워드 2,536·카테고리 515·상품 980)를 조회한다.
우리는 **크롬 확장으로 유저 브라우징 시점에 수집**하므로 초기 데이터가 적다.

대응:
1. **시드 데이터** — 시연/QA용으로 대표 키워드 세트를 `ext_keyword_daily_stats` +
   `ext_product_sales_estimates`에 미리 적재(카테고리별 N개).
2. **확장 수집 선행** — 릴리스 전 확장으로 인기 카테고리 키워드를 미리 크롤.
3. **계절성 신호** — 현재 스키마에 시즌 지표 부재 → `keyword_search_volume_history`
   기반 월별 편차로 계산하는 로직 신규 추가 필요(태그 "계절성"용).

---

## 8. 단계별 구현 계획

| 단계 | 산출물 | 상태 |
|---|---|---|
| P0 | 본 설계도 확정 · 등급 가중치/티어 임계값 합의 | 진행 중 |
| P1 | 백엔드 `honeypotSearch`/`honeypotStats` + 등급 로직 | |
| P2 | 프론트 3개 페이지(위저드·로딩·결과) + 컴포넌트 | |
| P3 | 시드 데이터 적재 + 실데이터 연결 검증 | |
| P4 | 계절성 신호 · 로켓공백 임계 튜닝 | |
| P5 | (별건) "재고 배팅 AI" — 사양 정의 후 착수 | |

---

## 9. "재고 배팅 AI" (별건)

5개 광고 도구 중 유일하게 우리에게 없는 기능. 이름상 **판매 속도·리드타임 기반
발주량/재고 추천**으로 추정되나, 정확한 입력·출력 사양이 필요.
`ext_product_sales_estimates`(일판매 추정)와 `cp_daily_sales`(실판매)가 있으므로
재고 소진일·권장 발주량 계산의 데이터 기반은 확보돼 있음. → 사양 확정 후 P5에서 진행.

---

## 부록 A. "크롬에서 소스 볼 수 있나?"에 대한 답

- 기술적으로 이 환경에 헤드리스 Chromium이 있으나, **샌드박스 아웃바운드
  프록시가 해당 도메인 터널을 차단**(플레인 요청도 사이트가 403 봇차단)하여
  여기서 직접 브라우징은 불가.
- 또한 대상 프론트엔드는 **압축된 React 번들**이라 소스 열람의 실익이 낮고,
  타사 코드 복제는 IP 리스크가 있음.
- 결론: **제공해주신 스크린샷 = 정확한 UI 사양**, **우리 기존 DB/엔진 = 데이터·로직**
  두 가지로 충분히 동등 기능을 클린하게 구현 가능. 소스 열람 불필요.
