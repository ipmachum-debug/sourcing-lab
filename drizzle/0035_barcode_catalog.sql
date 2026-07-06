-- 0035_barcode_catalog.sql
-- 카탈로그 주도 구조: 바코드(GTIN)를 국내↔POIZON exact 매칭 키로 추가.
--   판매자 엑셀 13번 컬럼(바코드) · 국내몰 JSON-LD gtin13 을 저장 → 이름 퍼지 매칭 폴백화.

ALTER TABLE `poizon_sale_observations` ADD COLUMN `barcode` varchar(40) NULL AFTER `spu_id`;
CREATE INDEX `idx_pso_barcode` ON `poizon_sale_observations` (`barcode`);

ALTER TABLE `domestic_price_pool` ADD COLUMN `barcode` varchar(40) NULL AFTER `sku`;
CREATE INDEX `idx_dpp_barcode` ON `domestic_price_pool` (`barcode`);
