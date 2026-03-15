-- v8.0: 배치 수집 엔진 v2 — 핀 키워드 + 3티어 스케줄링
ALTER TABLE `ext_watch_keywords` ADD COLUMN `is_pinned` BOOLEAN NOT NULL DEFAULT FALSE AFTER `priority_score`;
