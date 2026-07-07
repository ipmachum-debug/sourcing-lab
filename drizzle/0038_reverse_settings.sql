-- 역직구 사업 설정 (현금 잔고 등)
CREATE TABLE IF NOT EXISTS `reverse_settings` (
  `user_id` int NOT NULL PRIMARY KEY,
  `cash_krw` int NOT NULL DEFAULT 0,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
