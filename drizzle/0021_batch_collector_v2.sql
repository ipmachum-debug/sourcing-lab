-- v8.0: 배치 수집 엔진 v2 — 핀 키워드 + 3티어 스케줄링 + 라운드로빈
ALTER TABLE `ext_watch_keywords` ADD COLUMN `is_pinned` BOOLEAN NOT NULL DEFAULT FALSE AFTER `priority_score`;
ALTER TABLE `ext_watch_keywords` ADD COLUMN `pin_order` INT NOT NULL DEFAULT 0 AFTER `is_pinned`;
ALTER TABLE `ext_watch_keywords` ADD COLUMN `group_no` INT NOT NULL DEFAULT 0 AFTER `pin_order`;

-- group_no 초기값: id % 5 (5그룹 라운드로빈)
UPDATE `ext_watch_keywords` SET `group_no` = `id` % 5;

-- 배치 수집 상태 테이블 (유저별 라운드로빈 이월 + 일일 카운트)
CREATE TABLE IF NOT EXISTS `ext_batch_state` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `current_group_turn` INT NOT NULL DEFAULT 0,
  `total_collected_today` INT NOT NULL DEFAULT 0,
  `rounds_today` INT NOT NULL DEFAULT 0,
  `last_batch_completed_at` TIMESTAMP NULL,
  `state_date` VARCHAR(10) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  UNIQUE KEY `uq_batch_state_user` (`user_id`)
);
