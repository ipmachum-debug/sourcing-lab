-- Ali Validation Engine — 양방향 매칭 + 추적 테이블
-- 정방향: 쿠팡 키워드 → 알리 검색 → 추천
-- 역방향: 알리 상품 → 쿠팡 키워드 후보 추천

-- 1. 알리 검색 캐시 (TTL 기반, 정방향 검색용)
CREATE TABLE IF NOT EXISTS `ali_search_cache` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `keyword_id` int NOT NULL,
  `search_query` varchar(255) NOT NULL,
  `result_rank` int NOT NULL,
  `product_url` varchar(1000) NOT NULL,
  `product_title` varchar(1000) NOT NULL,
  `product_image_url` varchar(1000) NULL,
  `price_min` decimal(12,2) DEFAULT 0,
  `price_max` decimal(12,2) DEFAULT 0,
  `order_count` int DEFAULT 0,
  `rating` decimal(4,2) DEFAULT 0,
  `shipping_summary` varchar(255) NULL,
  `match_score` decimal(10,4) DEFAULT 0,
  `title_match_score` decimal(10,4) DEFAULT 0,
  `attribute_match_score` decimal(10,4) DEFAULT 0,
  `price_fit_score` decimal(10,4) DEFAULT 0,
  `order_signal_score` decimal(10,4) DEFAULT 0,
  `shipping_fit_score` decimal(10,4) DEFAULT 0,
  `collected_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `expires_at` datetime NOT NULL,
  KEY `idx_keyword_id` (`keyword_id`),
  KEY `idx_expires_at` (`expires_at`)
);

-- 2. 알리 상품 캐시 (확장프로그램 수집, 역방향 매칭용)
CREATE TABLE IF NOT EXISTS `ali_product_cache` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `ali_product_id` varchar(100) NULL,
  `product_url` varchar(1000) NOT NULL,
  `title` varchar(1000) NOT NULL,
  `title_ko` varchar(1000) NULL,
  `price_min` decimal(12,2) DEFAULT 0,
  `price_max` decimal(12,2) DEFAULT 0,
  `order_count` int DEFAULT 0,
  `rating` decimal(4,2) DEFAULT 0,
  `category_text` varchar(255) NULL,
  `attributes_json` json NULL,
  `image_url` varchar(1000) NULL,
  `source_type` enum('page','search','extension') DEFAULT 'page',
  `collected_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `expires_at` datetime NULL
);

-- 3. 알리→쿠팡 키워드 역방향 매칭 후보
CREATE TABLE IF NOT EXISTS `ali_keyword_match_candidate` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `ali_cache_id` int NOT NULL,
  `keyword_id` int NOT NULL,
  `keyword_similarity_score` decimal(10,4) DEFAULT 0,
  `attribute_overlap_score` decimal(10,4) DEFAULT 0,
  `price_fit_score` decimal(10,4) DEFAULT 0,
  `category_fit_score` decimal(10,4) DEFAULT 0,
  `market_fit_score` decimal(10,4) DEFAULT 0,
  `final_match_score` decimal(10,4) DEFAULT 0,
  `is_selected` tinyint(1) DEFAULT 0,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_ali_keyword_candidate` (`ali_cache_id`, `keyword_id`),
  KEY `idx_ali_cache_id` (`ali_cache_id`),
  KEY `idx_keyword_id` (`keyword_id`)
);

-- 4. 쿠팡 키워드 ↔ 알리 상품 매핑 (운영자 선택, 영구)
CREATE TABLE IF NOT EXISTS `keyword_ali_mapping` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `keyword_id` int NOT NULL,
  `ali_product_url` varchar(1000) NOT NULL,
  `ali_product_id` varchar(100) NULL,
  `ali_product_title` varchar(1000) NOT NULL,
  `selected_price` decimal(12,2) DEFAULT 0,
  `selected_shipping_fee` decimal(12,2) DEFAULT 0,
  `selected_total_cost` decimal(12,2) DEFAULT 0,
  `selected_order_count` int DEFAULT 0,
  `selected_rating` decimal(4,2) DEFAULT 0,
  `match_score` decimal(10,4) DEFAULT 0,
  `match_direction` enum('forward','reverse') DEFAULT 'forward',
  `is_primary` tinyint(1) DEFAULT 0,
  `mapping_status` enum('active','inactive','dropped') DEFAULT 'active',
  `tracking_enabled` tinyint(1) DEFAULT 1,
  `selected_by` varchar(100) NULL,
  `selected_reason` varchar(255) NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_keyword_url` (`keyword_id`, `ali_product_url`(255)),
  KEY `idx_keyword_id` (`keyword_id`),
  KEY `idx_tracking` (`tracking_enabled`, `mapping_status`)
);

-- 5. 알리 매핑 URL 추적 스냅샷
CREATE TABLE IF NOT EXISTS `keyword_ali_tracking_snapshot` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `mapping_id` int NOT NULL,
  `snapshot_at` datetime NOT NULL,
  `price_min` decimal(12,2) DEFAULT 0,
  `price_max` decimal(12,2) DEFAULT 0,
  `shipping_fee` decimal(12,2) DEFAULT 0,
  `total_cost` decimal(12,2) DEFAULT 0,
  `order_count` int DEFAULT 0,
  `rating` decimal(4,2) DEFAULT 0,
  `stock_text` varchar(255) NULL,
  `delivery_text` varchar(255) NULL,
  `availability_status` enum('available','low_stock','out_of_stock','unknown') DEFAULT 'unknown',
  `price_change_rate` decimal(10,4) DEFAULT 0,
  `order_velocity` decimal(10,4) DEFAULT 0,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_mapping_id` (`mapping_id`),
  KEY `idx_snapshot_at` (`snapshot_at`)
);
