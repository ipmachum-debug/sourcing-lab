-- 0028_domestic_price_pool.sql
-- 공유 국내 최저가 풀 — 역직구 소싱의 국내 매입가 절반.
-- 유저가 본 국내몰(무신사/ABC마트/크록스/나이키/…) 상품가를 패시브로 공유.
-- (norm_key, source) 유니크 → 상품별·소스별 1행. 상품별 MIN 실구매가로 최저가 산출.

CREATE TABLE IF NOT EXISTS `domestic_price_pool` (
  `id` int AUTO_INCREMENT NOT NULL,
  `norm_key` varchar(255) NOT NULL,
  `source` varchar(40) NOT NULL,
  `brand` varchar(100),
  `product_name` varchar(300) NOT NULL,
  `sku` varchar(120),
  `list_price` int DEFAULT 0,
  `sale_price` int DEFAULT 0,
  `coupon_price` int DEFAULT 0,
  `discount_pct` int DEFAULT 0,
  `image_url` varchar(1000),
  `product_url` varchar(1000),
  `in_stock` boolean DEFAULT true,
  `observe_count` int DEFAULT 0,
  `last_observed_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `domestic_price_pool_id` PRIMARY KEY(`id`),
  CONSTRAINT `dpp_src_key_unique` UNIQUE(`norm_key`, `source`)
);

CREATE INDEX `idx_dpp_name` ON `domestic_price_pool` (`product_name`);
