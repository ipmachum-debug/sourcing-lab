-- 0033_sales_records.sql
-- 판매 리포트 — 판매 사이트(POIZON·쇼피)에서 엑셀로 내려받아 업로드한 실판매 라인.
-- 판매량 추이 + 시장 데이터(poizon_sale_observations) norm_key 매칭 분석.

CREATE TABLE IF NOT EXISTS `sales_records` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `channel` varchar(30) DEFAULT 'poizon',
  `order_date` varchar(10) NOT NULL,
  `norm_key` varchar(255) NOT NULL,
  `product_name` varchar(300) NOT NULL,
  `brand` varchar(100),
  `sku` varchar(120),
  `size` varchar(40),
  `qty` int DEFAULT 1,
  `sale_price` int DEFAULT 0,
  `currency` varchar(8) DEFAULT 'CNY',
  `settle_amount` int DEFAULT 0,
  `external_order_id` varchar(120),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `sales_records_id` PRIMARY KEY(`id`)
);

CREATE INDEX `idx_sr_user_date` ON `sales_records` (`user_id`, `order_date`);
CREATE INDEX `idx_sr_key` ON `sales_records` (`norm_key`);
