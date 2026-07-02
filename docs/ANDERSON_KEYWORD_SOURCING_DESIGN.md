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

등급(표현):
  S+ ≥ 85  슈퍼 원픽
  S  ≥ 70  강력 원픽
  A  ≥ 55  유망 원픽
  B  ≥ 40  테스트 원픽
  C  < 40  관찰 키워드
```

> 브랜딩: "꿀통키워드" → **"원픽키워드"**. 등급 라벨은 위 표현으로 노출.

### 4.1 인증/규제 체크 (중국 소싱 필수)

키워드/카테고리에서 필요한 국내 인증을 자동 감지해 결과 카드에 경고
(`shared/certifications.ts` · `detectCerts()`):

| 카테고리 | 체크 | 수준 |
|---|---|---|
| 전자제품 | KC 인증(전기용품 안전) | 필수 |
| 어린이제품 | 어린이 KC | 필수 |
| 식품접촉용품 | 식약처 수입신고 | 필수 |
| 화장품 | 책임판매업 등록 | 필수 |
| 의료/건강 | 의료기기/건기식 허가 | 위험 |
| 배터리 | KC + 항공운송(UN38.3) | 위험 |
| 섬유 | 표시사항(혼용률 등) | 필수 |

- 접힘 카드: 감지 시 `⚠️ 인증확인` 뱃지.
- 펼침 카드: 필수/위험 구분 + 사유 + "실제 품목 기준 재확인" 안내.

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

## 7. 제품 철학 & 수집 모델 (확정)

### 7.1 두 원칙

1. **UX는 극단적으로 단순하게** — "너무 복잡하면 안 쓰게 된다."
   초보자 메인은 딱 3개(꿀통키워드 소싱 · 계산기 · 내 관심). 복잡한 기능은 "고급" 뒤로 숨김.
   AI는 챗봇이 아니라 **결정론적 필터+랭킹**, LLM은 결과 요약 한 줄 정도의 얇은 옵션만.
2. **데이터는 뒤에서 체계적으로** — 단순한 화면 아래, 수집·집계는 자동으로 돌아간다.

### 7.2 수집은 "크롤링"이 아니라 "읽기" — 이미 구현됨

별도 크롤러 서버 없음. 유저의 실제 쿠팡 사용에 올라타 두 갈래로 수집:

| 모드 | 트리거 | 성격 | 구현 (기존) |
|---|---|---|---|
| **A. 검색 읽기** | 유저가 쿠팡에서 검색할 때마다 | 넓고 얕음 | `snapshots.saveSnapshot`, `discovery.submitSearchResults` → `ext_search_snapshots` → `ext_keyword_daily_stats` |
| **B. 관심 추적** | 관심키워드/관심제품 등록 시 | 좁고 깊음(지속 갱신) | `ext_watch_keywords`(수집주기+**적응형 주기**), `getUncollectedKeywords` / `ext_product_trackings` + `ext_product_daily_snapshots` |

- **A**로 시장 전반의 스냅샷이 자연히 쌓이고, **B**로 유저가 찜한 것은 정밀 시계열이 쌓인다.
- 관심키워드는 `adaptive_interval_hours`로 **자주 보는 키워드일수록 자주 갱신** → 낭비 없이 체계적.
- ⇒ "크롤링 따로 안 하고 검색에 입혀 계속 읽는다"는 요구가 **이미 코드에 존재**. 신규 개발 대상 아님.

### 7.3 유일한 구조 변경 — 시장 데이터를 "공유 풀"로

현재 집계 테이블이 `user_id` 스코프라 A유저 수집이 B유저에게 안 보임(초보자 = 빈 화면).

| 데이터 | 전환 |
|---|---|
| 시장 집계(키워드 통계·상품 판매추정) | **전체 공유 풀** (user_id 제거, `query+date`/`product_id+date`로 dedupe) |
| 개인 데이터(관심키워드·관심제품·내 마진) | **유저별 유지** |

→ 이 전환 하나로 "검색이 곧 수집"이 전원에게 축적되어, 초보자도 즉시 결과를 본다.
(중간 규모 마이그레이션 1건. 개인 워치는 그대로 두고 집계 테이블만 전역화.)

### 7.4 남은 TODO

- **계절성 신호** — 스키마에 시즌 지표 부재 → `keyword_search_volume_history` 월별 편차로 산출(태그용).
- **콜드스타트 시드** — 런칭 초기 공유 풀이 얇을 때, 대표 카테고리 키워드를 사전 수집/적재.

---

## 8. 단계별 구현 계획

| 단계 | 산출물 | 상태 |
|---|---|---|
| P0 | 본 설계도 확정 · 등급 가중치/티어 임계값 합의 | 진행 중 |
| P1 | **시장 집계 테이블 공유 풀 전환** (§7.3 마이그레이션) | |
| P2 | 백엔드 `honeypotSearch`/`honeypotStats` + 등급 로직 (공유 풀 조회) | |
| P3 | 프론트 3개 페이지(위저드·로딩·결과) + 컴포넌트 | |
| P4 | 초보자 메인 단순화 — 3개 핵심만 노출, 나머지 "고급" 탭으로 | |
| P5 | 콜드스타트 시드 + 계절성 신호 + 로켓공백 임계 튜닝 | |
| P6 | (별건) "재고 배팅 AI" — 사양 정의 후 착수 | |

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
