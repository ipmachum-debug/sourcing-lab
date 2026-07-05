-- 0029_poizon_sale_observations.sql
-- POIZON 체결 시세 관측 — 안정 판매가(최근 30일 P25)·거래량·변동폭 산출용.
-- 사이즈별 체결 표본 append-only, 공유. "본 것만" 저빈도 적립.

CREATE TABLE IF NOT EXISTS `poizon_sale_observations` (
  `id` int AUTO_INCREMENT NOT NULL,
  `norm_key` varchar(255) NOT NULL,
  `size` varchar(40),
  `brand` varchar(100),
  `product_name` varchar(300) NOT NULL,
  `price_cny` int NOT NULL,
  `sold_count_30d` int DEFAULT 0,
  `source` varchar(30) DEFAULT 'extension',
  `observed_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `poizon_sale_observations_id` PRIMARY KEY(`id`)
);

CREATE INDEX `idx_pso_key` ON `poizon_sale_observations` (`norm_key`);
CREATE INDEX `idx_pso_key_size` ON `poizon_sale_observations` (`norm_key`, `size`);
CREATE INDEX `idx_pso_observed` ON `poizon_sale_observations` (`observed_at`);
