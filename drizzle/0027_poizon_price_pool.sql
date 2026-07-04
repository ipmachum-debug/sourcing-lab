-- 0027_poizon_price_pool.sql
-- 공유 POIZON 시세 풀 — 패시브 수집(본 것만) 전 유저 공유.

CREATE TABLE IF NOT EXISTS `poizon_price_pool` (
  `id` int AUTO_INCREMENT NOT NULL,
  `norm_key` varchar(255) NOT NULL,
  `poizon_spu_id` varchar(60),
  `brand` varchar(100),
  `product_name` varchar(300) NOT NULL,
  `price_cny` int DEFAULT 0,
  `low_cny` int DEFAULT 0,
  `image_url` varchar(1000),
  `contributor_count` int DEFAULT 0,
  `observe_count` int DEFAULT 0,
  `source` varchar(30) DEFAULT 'manual',
  `last_observed_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `poizon_price_pool_id` PRIMARY KEY(`id`),
  CONSTRAINT `poizon_price_pool_norm_key_unique` UNIQUE(`norm_key`)
);

CREATE INDEX `idx_ppp_name` ON `poizon_price_pool` (`product_name`);
