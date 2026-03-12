-- 키워드 메트릭: EMA 스무딩 + 판매 추정 + 급등 탐지
CREATE TABLE `ext_keyword_metrics` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `keyword` VARCHAR(255) NOT NULL,
  `metric_date` VARCHAR(10) NOT NULL,
  `review_delta` INT NOT NULL DEFAULT 0,
  `review_delta_ema7` DECIMAL(14,4) DEFAULT 0,
  `review_delta_ema30` DECIMAL(14,4) DEFAULT 0,
  `sales_estimate` INT NOT NULL DEFAULT 0,
  `sales_estimate_ema7` DECIMAL(14,4) DEFAULT 0,
  `sales_estimate_ema30` DECIMAL(14,4) DEFAULT 0,
  `ad_ratio` DECIMAL(8,4) DEFAULT 0,
  `new_product_ratio` DECIMAL(8,4) DEFAULT 0,
  `price_spread` INT DEFAULT 0,
  `rolling_mean_30` DECIMAL(14,4) DEFAULT 0,
  `rolling_std_30` DECIMAL(14,4) DEFAULT 0,
  `spike_score` DECIMAL(14,4) DEFAULT 0,
  `alert_level` ENUM('normal','spike','explosion') NOT NULL DEFAULT 'normal',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_keyword_metric_date` (`user_id`, `keyword`, `metric_date`),
  KEY `idx_metric_date` (`metric_date`),
  KEY `idx_alert_level` (`user_id`, `alert_level`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 키워드 알림: 급등/폭발/가격붕괴/경쟁폭증
CREATE TABLE `ext_keyword_alerts` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `keyword` VARCHAR(255) NOT NULL,
  `alert_date` VARCHAR(10) NOT NULL,
  `alert_type` ENUM('sales_spike','sales_explosion','price_drop','competition_jump') NOT NULL,
  `alert_score` DECIMAL(14,4) DEFAULT 0,
  `message` VARCHAR(500) DEFAULT NULL,
  `is_read` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_keyword_alert` (`user_id`, `keyword`, `alert_date`, `alert_type`),
  KEY `idx_alert_date` (`user_id`, `alert_date`),
  KEY `idx_unread` (`user_id`, `is_read`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
