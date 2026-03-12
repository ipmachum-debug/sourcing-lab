-- 키워드 검증 파이프라인: 확장(expansion) → 검증(validation) 전환
-- keyword_master: 검증 상태 + 추천 TTL 관리
-- keyword_daily_metrics: 쿠팡 기본점수 + 네이버 검증점수 분리

ALTER TABLE `keyword_master`
  ADD COLUMN `validation_status` ENUM('pending','validated','rejected','recommended') NOT NULL DEFAULT 'pending' AFTER `category_hint`,
  ADD COLUMN `canonical_keyword` VARCHAR(255) NULL AFTER `validation_status`,
  ADD COLUMN `validation_priority` INT NOT NULL DEFAULT 50 AFTER `canonical_keyword`,
  ADD COLUMN `last_validated_at` TIMESTAMP NULL AFTER `validation_priority`,
  ADD COLUMN `recommended_expires_at` TIMESTAMP NULL AFTER `last_validated_at`,
  ADD INDEX `idx_km_validation` (`user_id`, `validation_status`),
  ADD INDEX `idx_km_priority` (`user_id`, `validation_priority` DESC);

ALTER TABLE `keyword_daily_metrics`
  ADD COLUMN `coupang_base_score` DECIMAL(10,4) DEFAULT 0 AFTER `final_score`,
  ADD COLUMN `naver_validation_score` DECIMAL(10,4) DEFAULT 0 AFTER `coupang_base_score`,
  ADD COLUMN `validation_passed` BOOLEAN DEFAULT NULL AFTER `naver_validation_score`,
  ADD COLUMN `reject_reason` VARCHAR(100) NULL AFTER `validation_passed`;

-- ext_watch_keywords: 키워드 마스터 연결 + 감시 이유/상태
ALTER TABLE `ext_watch_keywords`
  ADD COLUMN `keyword_master_id` INT NULL AFTER `keyword`,
  ADD COLUMN `watch_reason` VARCHAR(100) NULL AFTER `keyword_master_id`,
  ADD COLUMN `watch_status` ENUM('watching','promoted','expired','paused') NOT NULL DEFAULT 'watching' AFTER `watch_reason`;
