-- 적응형 수집 스케줄러: next_collect_at 기반 우선순위 계산
ALTER TABLE `ext_watch_keywords`
  ADD COLUMN `next_collect_at` TIMESTAMP NULL DEFAULT NULL AFTER `composite_score`,
  ADD COLUMN `adaptive_interval_hours` INT NULL DEFAULT NULL AFTER `next_collect_at`,
  ADD COLUMN `volatility_score` INT NOT NULL DEFAULT 0 AFTER `adaptive_interval_hours`;

-- 인덱스: next_collect_at 기반 배치 선택 최적화
CREATE INDEX `idx_ewk_next_collect` ON `ext_watch_keywords` (`user_id`, `is_active`, `next_collect_at`);
