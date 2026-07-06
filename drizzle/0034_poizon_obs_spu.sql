-- 0034_poizon_obs_spu.sql
-- POIZON 관측에 SPU_ID 추가 — 판매자 엑셀(전체 내보내기) 정확 매칭키.

ALTER TABLE `poizon_sale_observations` ADD COLUMN `spu_id` varchar(60) NULL AFTER `norm_key`;
CREATE INDEX `idx_pso_spu` ON `poizon_sale_observations` (`spu_id`);

-- 역직구 시세 기준을 중국시장 달러($)로 전환 — 환율 기본값 원/위안(190) → 원/달러(1350).
ALTER TABLE `reverse_sku_watch` ALTER COLUMN `rate` SET DEFAULT 1350;
