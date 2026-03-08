-- ext_product_trackings: 내 상품 자동 추적 시스템
-- 등록/판매/데일리소싱 제품을 연결하여 자동 키워드 등록 및 일일 데이터 수집
CREATE TABLE IF NOT EXISTS `ext_product_trackings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `source_type` ENUM('product', 'candidate', 'coupang_mapping', 'manual') NOT NULL DEFAULT 'manual',
  `source_id` INT,                                    -- products.id / ext_candidates.id / product_channel_mappings.id
  `product_name` VARCHAR(500) NOT NULL,
  `coupang_product_id` VARCHAR(50),                   -- 쿠팡 상품 ID
  `coupang_url` TEXT,
  `image_url` TEXT,
  -- 자동 등록된 키워드들
  `keywords` TEXT,                                     -- JSON array of keyword strings
  -- 최신 추적 데이터 (마지막 스냅샷 기준)
  `latest_price` INT DEFAULT 0,
  `latest_rating` DECIMAL(3,1) DEFAULT 0,
  `latest_review_count` INT DEFAULT 0,
  `latest_rank` INT DEFAULT 0,                         -- 대표 키워드 최신 순위
  `latest_rank_keyword` VARCHAR(255),                  -- 순위 추적 대표 키워드
  -- 전일 대비 변동
  `price_change` INT DEFAULT 0,
  `review_change` INT DEFAULT 0,
  `rank_change` INT DEFAULT 0,
  -- 경쟁 분석 요약
  `competitor_count` INT DEFAULT 0,                    -- 관련 경쟁자 수
  `similar_products_json` TEXT,                         -- 유사 상품 JSON (최대 10개)
  `competitor_summary_json` TEXT,                       -- 경쟁자 요약 JSON
  -- AI 분석
  `ai_suggestion` TEXT,                                -- AI 제안 텍스트
  `ai_updated_at` TIMESTAMP NULL,
  -- 상태
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `last_tracked_at` TIMESTAMP NULL,
  `track_frequency` ENUM('daily', 'weekly') NOT NULL DEFAULT 'daily',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_user_active` (`user_id`, `is_active`),
  INDEX `idx_user_source` (`user_id`, `source_type`, `source_id`),
  INDEX `idx_coupang_pid` (`user_id`, `coupang_product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ext_product_daily_snapshots: 추적 상품의 일일 스냅샷 (히스토리)
CREATE TABLE IF NOT EXISTS `ext_product_daily_snapshots` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `tracking_id` INT NOT NULL,                          -- ext_product_trackings FK
  `snapshot_date` VARCHAR(10) NOT NULL,                -- YYYY-MM-DD
  `price` INT DEFAULT 0,
  `rating` DECIMAL(3,1) DEFAULT 0,
  `review_count` INT DEFAULT 0,
  `rank_position` INT DEFAULT 0,                       -- 대표 키워드 순위
  `rank_keyword` VARCHAR(255),
  `competitor_count` INT DEFAULT 0,
  `similar_avg_price` INT DEFAULT 0,
  `similar_avg_review` INT DEFAULT 0,
  `ad_count` INT DEFAULT 0,
  `data_json` TEXT,                                     -- 추가 상세 데이터 JSON
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_tracking_date` (`tracking_id`, `snapshot_date`),
  INDEX `idx_user_date` (`user_id`, `snapshot_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
