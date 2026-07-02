-- 0023_market_shared_pool.sql
-- 전 유저 공유 시장 풀 (길 B — 안전한 추가 방식, 기존 테이블 미변경)
-- 유저별 ext_keyword_daily_stats / ext_product_sales_estimates 를 병합해 채운다.

CREATE TABLE IF NOT EXISTS `market_keyword_stats` (
  `id` int AUTO_INCREMENT NOT NULL,
  `keyword` varchar(255) NOT NULL,
  `normalized_keyword` varchar(255) NOT NULL,
  `category_hint` varchar(100),
  `product_count` int DEFAULT 0,
  `avg_price` int DEFAULT 0,
  `min_price` int DEFAULT 0,
  `max_price` int DEFAULT 0,
  `median_price` int DEFAULT 0,
  `total_review_sum` int DEFAULT 0,
  `avg_review` int DEFAULT 0,
  `top_product_review_count` int DEFAULT 0,
  `competition_score` int DEFAULT 0,
  `competition_level` enum('easy','medium','hard') DEFAULT 'medium',
  `rocket_count` int DEFAULT 0,
  `sales_estimate_daily` int DEFAULT 0,
  `monthly_sales` int DEFAULT 0,
  `monthly_revenue` decimal(16,0) DEFAULT 0,
  `keyword_score` int DEFAULT 0,
  `demand_score` int DEFAULT 0,
  `honeypot_score` int DEFAULT 0,
  `grade` enum('S_PLUS','S','A','B','C') DEFAULT 'C',
  `spike_level` varchar(20) DEFAULT 'normal',
  `contributor_count` int DEFAULT 0,
  `sample_snapshot_count` int DEFAULT 0,
  `last_observed_date` varchar(10),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `market_keyword_stats_id` PRIMARY KEY(`id`),
  CONSTRAINT `market_keyword_stats_normalized_keyword_unique` UNIQUE(`normalized_keyword`)
);

CREATE INDEX `idx_mks_grade` ON `market_keyword_stats` (`grade`);
CREATE INDEX `idx_mks_category` ON `market_keyword_stats` (`category_hint`);
CREATE INDEX `idx_mks_revenue` ON `market_keyword_stats` (`monthly_revenue`);
CREATE INDEX `idx_mks_toprev` ON `market_keyword_stats` (`top_product_review_count`);

CREATE TABLE IF NOT EXISTS `market_product_stats` (
  `id` int AUTO_INCREMENT NOT NULL,
  `normalized_keyword` varchar(255) NOT NULL,
  `coupang_product_id` varchar(50) NOT NULL,
  `product_name` varchar(500) NOT NULL,
  `price` int DEFAULT 0,
  `review_count` int DEFAULT 0,
  `rating` decimal(3,1) DEFAULT 0,
  `est_monthly_sales` int DEFAULT 0,
  `est_monthly_revenue` decimal(16,0) DEFAULT 0,
  `sales_grade` enum('VERY_LOW','LOW','MEDIUM','HIGH','VERY_HIGH') DEFAULT 'MEDIUM',
  `rank_in_keyword` int DEFAULT 0,
  `last_observed_date` varchar(10),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `market_product_stats_id` PRIMARY KEY(`id`),
  CONSTRAINT `market_product_stats_kw_pid_unique` UNIQUE(`normalized_keyword`,`coupang_product_id`)
);

CREATE INDEX `idx_mps_keyword` ON `market_product_stats` (`normalized_keyword`);
