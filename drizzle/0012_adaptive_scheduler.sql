-- ============================================================
-- 0012: Adaptive Collection Scheduler
-- 키워드별 적응형 수집 주기 + 우선순위 점수 컬럼 추가
-- ============================================================

-- ext_watch_keywords 테이블에 priority_score 컬럼 추가
-- (next_collect_at, adaptive_interval_hours, volatility_score는 이미 존재)
ALTER TABLE `ext_watch_keywords`
  ADD COLUMN IF NOT EXISTS `priority_score` INT DEFAULT 0 AFTER `volatility_score`;

-- 인덱스: next_collect_at 기반 수집 대상 조회 최적화
ALTER TABLE `ext_watch_keywords`
  ADD INDEX IF NOT EXISTS `idx_watch_next_collect` (`user_id`, `next_collect_at`, `priority_score` DESC);
