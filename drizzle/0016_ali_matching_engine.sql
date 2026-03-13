-- 알리 양방향 매칭 엔진: 검색캐시 + 영구매핑 + 추적 스냅샷

-- 1. 알리 검색 캐시 (TTL 기반, 주기적 삭제)
CREATE TABLE `ali_search_cache` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `keyword_id` INT NULL,
  `search_query` VARCHAR(255) NOT NULL,
  `search_direction` ENUM('forward','reverse') NOT NULL DEFAULT 'forward',
  `result_rank` INT NOT NULL DEFAULT 0,
  `product_url` VARCHAR(1000) NOT NULL,
  `product_id` VARCHAR(100) NULL,
  `product_title` VARCHAR(1000) NOT NULL,
  `product_image_url` VARCHAR(1000) NULL,
  `price_min` DECIMAL(12,2) DEFAULT 0,
  `price_max` DECIMAL(12,2) DEFAULT 0,
  `price_krw` INT DEFAULT 0,
  `order_count` INT DEFAULT 0,
  `rating` DECIMAL(4,2) DEFAULT 0,
  `free_shipping` TINYINT(1) DEFAULT 0,
  `match_score` DECIMAL(10,4) DEFAULT 0,
  `title_match_score` DECIMAL(10,4) DEFAULT 0,
  `attribute_match_score` DECIMAL(10,4) DEFAULT 0,
  `price_fit_score` DECIMAL(10,4) DEFAULT 0,
  `collected_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME NOT NULL,
  KEY `idx_asc_user_keyword` (`user_id`, `keyword_id`),
  KEY `idx_asc_expires` (`expires_at`),
  KEY `idx_asc_query` (`search_query`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. 키워드-알리 영구 매핑 (선택된 URL만)
CREATE TABLE `keyword_ali_mapping` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `keyword_id` INT NOT NULL,
  `ali_product_url` VARCHAR(1000) NOT NULL,
  `ali_product_id` VARCHAR(100) NULL,
  `ali_product_title` VARCHAR(1000) NOT NULL,
  `ali_image_url` VARCHAR(1000) NULL,
  `selected_price_usd` DECIMAL(12,2) DEFAULT 0,
  `selected_price_krw` INT DEFAULT 0,
  `selected_order_count` INT DEFAULT 0,
  `selected_rating` DECIMAL(4,2) DEFAULT 0,
  `match_score` DECIMAL(10,4) DEFAULT 0,
  `match_direction` ENUM('forward','reverse') NOT NULL DEFAULT 'forward',
  `is_primary` TINYINT(1) DEFAULT 0,
  `tracking_enabled` TINYINT(1) DEFAULT 1,
  `mapping_status` ENUM('active','paused','dropped') NOT NULL DEFAULT 'active',
  `selected_reason` VARCHAR(255) NULL,
  `memo` TEXT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_kam_keyword_url` (`keyword_id`, `ali_product_url`(255)),
  KEY `idx_kam_user` (`user_id`),
  KEY `idx_kam_tracking` (`user_id`, `tracking_enabled`, `mapping_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. 매핑 URL 추적 스냅샷 (가격/재고/주문 변화)
CREATE TABLE `keyword_ali_tracking_snapshot` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `mapping_id` INT NOT NULL,
  `snapshot_at` DATETIME NOT NULL,
  `price_min_usd` DECIMAL(12,2) DEFAULT 0,
  `price_max_usd` DECIMAL(12,2) DEFAULT 0,
  `price_krw` INT DEFAULT 0,
  `order_count` INT DEFAULT 0,
  `rating` DECIMAL(4,2) DEFAULT 0,
  `stock_status` VARCHAR(30) DEFAULT 'unknown',
  `delivery_text` VARCHAR(255) NULL,
  `free_shipping` TINYINT(1) DEFAULT 0,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_kats_mapping` (`mapping_id`),
  KEY `idx_kats_snapshot` (`snapshot_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
