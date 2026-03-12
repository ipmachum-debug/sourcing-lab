-- ============================================================
-- 0014: Margin Calculator History
-- 마진 계산기 이력 저장 테이블
-- ============================================================

CREATE TABLE IF NOT EXISTS `margin_calc_history` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `item_name` VARCHAR(200) NOT NULL DEFAULT '',
  -- 입력값
  `selling_price` INT NOT NULL,
  `cost_price` INT NOT NULL,
  `fee_rate` DECIMAL(5,2) NOT NULL,
  `fulfillment_fee` INT NOT NULL,
  `shipping_fee` INT NOT NULL,
  `expected_sales` INT NOT NULL DEFAULT 100,
  `return_rate` DECIMAL(5,2) NOT NULL DEFAULT 0,
  `return_collection_fee` INT NOT NULL DEFAULT 0,
  -- 계산 결과 스냅샷
  `fulfillment_vat` INT NOT NULL,
  `sales_commission` INT NOT NULL,
  `sales_commission_vat` INT NOT NULL,
  `vat` INT NOT NULL,
  `margin` INT NOT NULL,
  `margin_rate` DECIMAL(5,2) NOT NULL,
  `min_ad_roi` DECIMAL(7,2) NOT NULL DEFAULT 0,
  `total_margin` INT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_mch_user` (`user_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
