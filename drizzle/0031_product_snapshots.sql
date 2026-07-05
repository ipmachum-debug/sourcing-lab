-- 0031_product_snapshots.sql
-- 내 상품 일별 스냅샷. (my_product_id, captured_date, source) 유니크 → "하루 1회" 강제.
-- 원본 HTML이 아니라 필요한 숫자만 저장.

CREATE TABLE IF NOT EXISTS `product_snapshots` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `my_product_id` int NOT NULL,
  `captured_date` varchar(10) NOT NULL,
  `source` varchar(30) DEFAULT 'manual',
  `revenue_krw` int DEFAULT 0,
  `units_sold` int DEFAULT 0,
  `stock` int DEFAULT 0,
  `rank_pos` int DEFAULT 0,
  `review_count` int DEFAULT 0,
  `rating` decimal(3,1),
  `poizon_price_cny` int DEFAULT 0,
  `poizon_sold_30d` int DEFAULT 0,
  `competitor_low_krw` int DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `product_snapshots_id` PRIMARY KEY(`id`),
  CONSTRAINT `ps_product_day_src_unique` UNIQUE(`my_product_id`, `captured_date`, `source`)
);

CREATE INDEX `idx_ps_user_day` ON `product_snapshots` (`user_id`, `captured_date`);
