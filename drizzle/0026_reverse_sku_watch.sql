-- 0026_reverse_sku_watch.sql
-- 역직구 SKU 워치풀 (아비트리지 후보). 국내가 × POIZON 스프레드 랭킹.

CREATE TABLE IF NOT EXISTS `reverse_sku_watch` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `brand` varchar(100),
  `product_name` varchar(300) NOT NULL,
  `sku` varchar(120),
  `category` varchar(80),
  `domestic_price` int DEFAULT 0,
  `poizon_cny` int DEFAULT 0,
  `rate` int DEFAULT 190,
  `fee_pct` int DEFAULT 9,
  `note` varchar(300),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `reverse_sku_watch_id` PRIMARY KEY(`id`)
);

CREATE INDEX `idx_rsw_user` ON `reverse_sku_watch` (`user_id`);
