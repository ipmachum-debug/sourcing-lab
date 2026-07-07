-- 0036_catalog_bid_fields.sql
-- 판매자 엑셀의 "입찰/수익/경쟁" 핵심 컬럼 흡수 — 발굴 필터·입찰 추천·모니터링의 데이터 기반.
--   예상 수익 · 현재 중국 최저 입찰가 · 입찰 가능 여부 · 입찰 상태 · 현지 판매자 판매량 · SKU ID.

ALTER TABLE `poizon_sale_observations` ADD COLUMN `sku_id` varchar(60) NULL AFTER `spu_id`;
ALTER TABLE `poizon_sale_observations` ADD COLUMN `expected_profit_usd` int NULL AFTER `sold_count_30d`;
ALTER TABLE `poizon_sale_observations` ADD COLUMN `lowest_bid_usd` int NULL AFTER `expected_profit_usd`;
ALTER TABLE `poizon_sale_observations` ADD COLUMN `bid_available` boolean NULL AFTER `lowest_bid_usd`;
ALTER TABLE `poizon_sale_observations` ADD COLUMN `bid_status` varchar(24) NULL AFTER `bid_available`;
ALTER TABLE `poizon_sale_observations` ADD COLUMN `local_seller_count` int NULL AFTER `bid_status`;

CREATE INDEX `idx_pso_sku` ON `poizon_sale_observations` (`sku_id`);
