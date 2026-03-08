-- Phase 6: Notifications + AI Review Analysis

CREATE TABLE IF NOT EXISTS `ext_notifications` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `type` enum('rank_change','price_change','new_competitor','ai_recommendation','milestone','system') NOT NULL DEFAULT 'system',
  `title` varchar(255) NOT NULL,
  `message` text NOT NULL,
  `data` text,
  `is_read` boolean NOT NULL DEFAULT false,
  `priority` enum('low','medium','high') NOT NULL DEFAULT 'medium',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `ext_notifications_id` PRIMARY KEY(`id`)
);

CREATE TABLE IF NOT EXISTS `ext_review_analyses` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `query` varchar(255) NOT NULL,
  `analysis_type` enum('keyword_review','product_review','category_review') NOT NULL DEFAULT 'keyword_review',
  `total_products_analyzed` int DEFAULT 0,
  `avg_rating` decimal(3,1) DEFAULT '0',
  `avg_review_count` int DEFAULT 0,
  `pain_points` text,
  `customer_needs` text,
  `opportunities` text,
  `common_praises` text,
  `common_complaints` text,
  `price_sensitivity` varchar(50),
  `quality_concerns` text,
  `summary_text` text,
  `recommendations` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `ext_review_analyses_id` PRIMARY KEY(`id`)
);

CREATE INDEX `idx_notif_user_read` ON `ext_notifications` (`user_id`, `is_read`);
CREATE INDEX `idx_notif_user_date` ON `ext_notifications` (`user_id`, `created_at`);
CREATE INDEX `idx_review_user_query` ON `ext_review_analyses` (`user_id`, `query`);
