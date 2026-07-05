-- 0030_my_products.sql
-- 내 판매/관찰 상품 리스트 — 매일 1회 능동 스냅샷 대상.
-- 안전장치: active 개수는 앱에서 MAX_ACTIVE_SKUS(기본 50)로 제한.

CREATE TABLE IF NOT EXISTS `my_products` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `platform` enum('coupang','poizon','domestic') DEFAULT 'coupang',
  `external_id` varchar(120),
  `product_name` varchar(300) NOT NULL,
  `brand` varchar(100),
  `sku` varchar(120),
  `my_price_krw` int DEFAULT 0,
  `target_stock` int DEFAULT 0,
  `memo` varchar(300),
  `active` boolean NOT NULL DEFAULT true,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `my_products_id` PRIMARY KEY(`id`)
);

CREATE INDEX `idx_myp_user` ON `my_products` (`user_id`);
