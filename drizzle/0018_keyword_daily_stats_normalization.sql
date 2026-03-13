-- 0018: ext_keyword_daily_stats 정규화 컬럼 추가 (v7.6.0)
-- MySQL 5.7 호환: 개별 ALTER, 이미 존재하면 무시

-- 프로시저로 안전하게 컬럼 추가
DELIMITER //
CREATE PROCEDURE add_columns_0018()
BEGIN
  -- base_product_count
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='ext_keyword_daily_stats' AND column_name='base_product_count') THEN
    ALTER TABLE `ext_keyword_daily_stats` ADD COLUMN `base_product_count` int DEFAULT 0;
  END IF;
  -- normalized_review_sum
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='ext_keyword_daily_stats' AND column_name='normalized_review_sum') THEN
    ALTER TABLE `ext_keyword_daily_stats` ADD COLUMN `normalized_review_sum` int DEFAULT 0;
  END IF;
  -- coverage_ratio
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='ext_keyword_daily_stats' AND column_name='coverage_ratio') THEN
    ALTER TABLE `ext_keyword_daily_stats` ADD COLUMN `coverage_ratio` decimal(6,4) DEFAULT '0';
  END IF;
  -- review_delta_observed
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='ext_keyword_daily_stats' AND column_name='review_delta_observed') THEN
    ALTER TABLE `ext_keyword_daily_stats` ADD COLUMN `review_delta_observed` int DEFAULT 0;
  END IF;
  -- review_delta_used
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='ext_keyword_daily_stats' AND column_name='review_delta_used') THEN
    ALTER TABLE `ext_keyword_daily_stats` ADD COLUMN `review_delta_used` int DEFAULT 0;
  END IF;
  -- sales_estimate_ma7
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='ext_keyword_daily_stats' AND column_name='sales_estimate_ma7') THEN
    ALTER TABLE `ext_keyword_daily_stats` ADD COLUMN `sales_estimate_ma7` int DEFAULT 0;
  END IF;
  -- sales_estimate_ma30
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='ext_keyword_daily_stats' AND column_name='sales_estimate_ma30') THEN
    ALTER TABLE `ext_keyword_daily_stats` ADD COLUMN `sales_estimate_ma30` int DEFAULT 0;
  END IF;
  -- is_provisional
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='ext_keyword_daily_stats' AND column_name='is_provisional') THEN
    ALTER TABLE `ext_keyword_daily_stats` ADD COLUMN `is_provisional` tinyint(1) DEFAULT 0;
  END IF;
  -- is_finalized
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='ext_keyword_daily_stats' AND column_name='is_finalized') THEN
    ALTER TABLE `ext_keyword_daily_stats` ADD COLUMN `is_finalized` tinyint(1) DEFAULT 0;
  END IF;
  -- provisional_reason
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='ext_keyword_daily_stats' AND column_name='provisional_reason') THEN
    ALTER TABLE `ext_keyword_daily_stats` ADD COLUMN `provisional_reason` varchar(50);
  END IF;
  -- data_status
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='ext_keyword_daily_stats' AND column_name='data_status') THEN
    ALTER TABLE `ext_keyword_daily_stats` ADD COLUMN `data_status` varchar(30) DEFAULT 'raw_valid';
  END IF;
  -- spike_ratio
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='ext_keyword_daily_stats' AND column_name='spike_ratio') THEN
    ALTER TABLE `ext_keyword_daily_stats` ADD COLUMN `spike_ratio` decimal(8,2) DEFAULT '0';
  END IF;
  -- spike_level
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='ext_keyword_daily_stats' AND column_name='spike_level') THEN
    ALTER TABLE `ext_keyword_daily_stats` ADD COLUMN `spike_level` varchar(20) DEFAULT 'normal';
  END IF;
  -- anchor_prev_date
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='ext_keyword_daily_stats' AND column_name='anchor_prev_date') THEN
    ALTER TABLE `ext_keyword_daily_stats` ADD COLUMN `anchor_prev_date` varchar(10);
  END IF;
END //
DELIMITER ;

CALL add_columns_0018();
DROP PROCEDURE IF EXISTS add_columns_0018;
