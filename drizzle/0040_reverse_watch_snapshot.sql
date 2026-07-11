-- 0040_reverse_watch_snapshot.sql
-- 발굴 워치 시세 스냅샷 — 자동수집 때마다 일별 1행 저장 → 변동폭(7일/30일) 추적.
--   (watch_id, captured_date) 유니크로 하루 1행 자연 강제.
CREATE TABLE IF NOT EXISTS `reverse_watch_snapshot` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `watch_id` int NOT NULL,
  `captured_date` varchar(10) NOT NULL,
  `sell_usd` int NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `rws_unique` (`watch_id`, `captured_date`),
  KEY `idx_rws_watch` (`watch_id`)
);
