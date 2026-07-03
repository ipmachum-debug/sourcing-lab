-- 0024_market_scan_queue.sql
-- R5: 심화수집(on-expand) 서버 큐 + 공유 상품 상세 풀.
-- 웹앱이 큐에 등록 → 확장이 폴링 픽업 → 상세 수집 후 상세 풀에 저장.
-- 기존 테이블 미변경(추가 전용).

CREATE TABLE IF NOT EXISTS `market_scan_queue` (
  `id` int AUTO_INCREMENT NOT NULL,
  `scan_type` enum('product_detail') NOT NULL DEFAULT 'product_detail',
  `target_id` varchar(50) NOT NULL,
  `keyword` varchar(255),
  `status` enum('pending','running','done','failed') NOT NULL DEFAULT 'pending',
  `priority` int DEFAULT 50,
  `requested_by` int,
  `attempts` int DEFAULT 0,
  `running_expires_at` timestamp NULL,
  `last_error` varchar(500),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `market_scan_queue_id` PRIMARY KEY(`id`),
  CONSTRAINT `market_scan_queue_target_id_unique` UNIQUE(`target_id`)
);

CREATE INDEX `idx_msq_status` ON `market_scan_queue` (`status`, `priority`);

CREATE TABLE IF NOT EXISTS `market_shared_product_details_pool` (
  `id` int AUTO_INCREMENT NOT NULL,
  `coupang_product_id` varchar(50) NOT NULL,
  `product_name` varchar(500),
  `main_image_url` varchar(1000),
  `current_price` int DEFAULT 0,
  `seller_name` varchar(255),
  `seller_grade` varchar(50),
  `seller_product_count` int DEFAULT 0,
  `option_count` int DEFAULT 0,
  `option_json` json,
  `delivery_type` varchar(30),
  `origin_country` varchar(100),
  `brand` varchar(255),
  `category_path` varchar(500),
  `detail_images_count` int DEFAULT 0,
  `rating` decimal(3,1) DEFAULT 0,
  `review_count` int DEFAULT 0,
  `discovered_via_keyword` varchar(255),
  `first_scanned_at` timestamp NOT NULL DEFAULT (now()),
  `last_scanned_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `market_product_details_id` PRIMARY KEY(`id`),
  CONSTRAINT `market_product_details_pid_unique` UNIQUE(`coupang_product_id`)
);
