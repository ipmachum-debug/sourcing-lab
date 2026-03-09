-- ============================================================
-- 0011: Hybrid Data Collection System
-- 실시간 사용자검색 수집 + 저빈도 배치 보강
-- ============================================================

-- ==================== 1) 검색 이벤트 로그 (ext_search_events) ====================
-- 사용자가 쿠팡에서 검색할 때마다 기록 (개별 상품 레벨)
CREATE TABLE IF NOT EXISTS `ext_search_events` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `user_id` int NOT NULL,
  `keyword` varchar(255) NOT NULL,
  `searched_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `source` varchar(50) NOT NULL DEFAULT 'user_search',       -- user_search | batch | manual
  `page_url` text,
  `total_items` int NOT NULL DEFAULT 0,
  -- 개별 상품 데이터 (최대 36개)
  `items_json` text,                                          -- 전체 상품 리스트 JSON
  -- 집계 통계
  `avg_price` int DEFAULT 0,
  `avg_rating` decimal(3,1) DEFAULT 0.0,
  `avg_review` int DEFAULT 0,
  `total_review_sum` int DEFAULT 0,                           -- 전체 리뷰 합계 (리뷰 증감 계산용)
  `ad_count` int DEFAULT 0,
  `rocket_count` int DEFAULT 0,
  `high_review_count` int DEFAULT 0,                          -- 리뷰 100+ 상품 수
  -- 품질 메타
  `price_parse_rate` int DEFAULT 0,                           -- 가격 파싱 성공률 (%)
  `rating_parse_rate` int DEFAULT 0,                          -- 평점 파싱 성공률 (%)
  `review_parse_rate` int DEFAULT 0,                          -- 리뷰 파싱 성공률 (%)
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_search_events_user_keyword` (`user_id`, `keyword`),
  INDEX `idx_search_events_searched_at` (`searched_at`),
  INDEX `idx_search_events_keyword_date` (`keyword`, `searched_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ==================== 2) 감시 키워드 (ext_watch_keywords) ====================
-- 사용자가 검색한 키워드를 자동 등록 + 배치 수집 대상 관리
CREATE TABLE IF NOT EXISTS `ext_watch_keywords` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `user_id` int NOT NULL,
  `keyword` varchar(255) NOT NULL,
  `priority` int NOT NULL DEFAULT 50,                         -- 0~100, 높을수록 우선
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `collect_interval_hours` int NOT NULL DEFAULT 24,           -- 수집 간격 (시간)
  -- 상태 추적
  `total_search_count` int DEFAULT 0,                         -- 누적 검색 횟수
  `last_searched_at` timestamp NULL,                          -- 마지막 사용자 검색 시각
  `last_collected_at` timestamp NULL,                         -- 마지막 배치 수집 시각
  `last_user_view_at` timestamp NULL,                         -- 마지막 사용자 조회 시각
  -- 최신 집계 데이터 (가장 최근 수집 기준)
  `latest_total_items` int DEFAULT 0,
  `latest_avg_price` int DEFAULT 0,
  `latest_avg_rating` decimal(3,1) DEFAULT 0.0,
  `latest_avg_review` int DEFAULT 0,
  `latest_total_review_sum` int DEFAULT 0,
  `latest_ad_count` int DEFAULT 0,
  `latest_rocket_count` int DEFAULT 0,
  -- 변동 추적 (전일 대비)
  `review_growth_1d` int DEFAULT 0,                           -- 1일 리뷰 증가
  `review_growth_7d` int DEFAULT 0,                           -- 7일 리뷰 증가
  `price_change_1d` int DEFAULT 0,                            -- 1일 가격 변동
  `composite_score` int DEFAULT 0,                            -- 종합 점수 0~100 (배치 우선순위 계산용)
  -- 타임스탬프
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_user_keyword` (`user_id`, `keyword`),
  INDEX `idx_watch_active` (`user_id`, `is_active`),
  INDEX `idx_watch_priority` (`user_id`, `priority` DESC, `last_searched_at` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ==================== 3) 키워드 일별 상태 (ext_keyword_daily_status) ====================
-- 키워드별 일별 집계 — 7일 이상 축적 후 판매량 추정 가능
CREATE TABLE IF NOT EXISTS `ext_keyword_daily_status` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `user_id` int NOT NULL,
  `keyword` varchar(255) NOT NULL,
  `stat_date` varchar(10) NOT NULL,                           -- YYYY-MM-DD
  `source` varchar(50) NOT NULL DEFAULT 'user_search',        -- user_search | batch
  -- 검색 결과 집계
  `total_items` int DEFAULT 0,
  `avg_price` int DEFAULT 0,
  `min_price` int DEFAULT 0,
  `max_price` int DEFAULT 0,
  `avg_rating` decimal(3,1) DEFAULT 0.0,
  `avg_review` int DEFAULT 0,
  `total_review_sum` int DEFAULT 0,                           -- ★ 핵심: 전체 리뷰 합계
  `median_review` int DEFAULT 0,
  -- 상품 분포
  `ad_count` int DEFAULT 0,
  `ad_ratio` decimal(5,2) DEFAULT 0.00,                       -- 광고 비율 (%)
  `rocket_count` int DEFAULT 0,
  `rocket_ratio` decimal(5,2) DEFAULT 0.00,
  `high_review_count` int DEFAULT 0,                          -- 리뷰 100+ 상품 수
  `new_product_count` int DEFAULT 0,                          -- 리뷰 10 미만 신상품 수
  -- 전일 대비 변동
  `review_growth` int DEFAULT 0,                              -- ★ 핵심: 리뷰 증가량 = 오늘 totalReviewSum - 어제 totalReviewSum
  `price_change` int DEFAULT 0,                               -- 평균가 변동
  `item_count_change` int DEFAULT 0,                          -- 상품수 변동
  `rank_change_json` text,                                    -- 상위 10개 상품 순위 변동 JSON
  -- 재고 상태 (품절 감지)
  `out_of_stock_count` int DEFAULT 0,                         -- 품절 상품 수
  `out_of_stock_rate` decimal(5,2) DEFAULT 0.00,
  -- 판매량 추정 (7일 이상 데이터 축적 후 계산)
  `estimated_daily_sales` int DEFAULT 0,                      -- 추정 일일 판매량 = reviewGrowth × 20
  `sales_score` int DEFAULT 0,                                -- 판매력 점수 0~100
  `demand_score` int DEFAULT 0,                               -- 수요 점수 0~100
  -- 경쟁도
  `competition_score` int DEFAULT 0,
  `competition_level` varchar(20) DEFAULT 'medium',
  -- 파싱 품질 메트릭
  `data_quality_score` int DEFAULT 0,                         -- 데이터 품질 점수 0~100
  `price_parse_rate` int DEFAULT 0,
  `rating_parse_rate` int DEFAULT 0,
  `review_parse_rate` int DEFAULT 0,
  -- 원본 상품 스냅샷 (상위 10개)
  `top_products_json` text,                                   -- 상위 10개 상품 스냅샷 JSON
  -- 타임스탬프
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_user_keyword_date` (`user_id`, `keyword`, `stat_date`),
  INDEX `idx_daily_status_date` (`stat_date`),
  INDEX `idx_daily_status_keyword` (`user_id`, `keyword`, `stat_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
