-- ============================================================
-- Migration 0017: Review Normalization Engine (v7.5.0)
-- ============================================================
-- 상품수 정규화, 음수 보정, 이동평균 판매 추정

ALTER TABLE `ext_keyword_daily_status`
  ADD COLUMN `base_product_count` INT DEFAULT 0,
  ADD COLUMN `normalized_review_sum` INT DEFAULT 0,
  ADD COLUMN `coverage_ratio` DECIMAL(6,4) DEFAULT 0,
  ADD COLUMN `review_delta_observed` INT DEFAULT 0,
  ADD COLUMN `review_delta_used` INT DEFAULT 0,
  ADD COLUMN `sales_estimate_ma7` INT DEFAULT 0,
  ADD COLUMN `sales_estimate_ma30` INT DEFAULT 0,
  ADD COLUMN `is_provisional` BOOLEAN DEFAULT FALSE,
  ADD COLUMN `provisional_reason` VARCHAR(50) NULL,
  ADD COLUMN `data_status` VARCHAR(30) DEFAULT 'raw_valid';
