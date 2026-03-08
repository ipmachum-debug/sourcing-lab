CREATE TABLE `alert_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`alerts_enabled` boolean NOT NULL DEFAULT true,
	`new_entry_alert` boolean NOT NULL DEFAULT true,
	`rank_change_alert` boolean NOT NULL DEFAULT true,
	`rank_change_threshold` int NOT NULL DEFAULT 5,
	`browser_notification` boolean NOT NULL DEFAULT true,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `alert_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `collection_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`platform` enum('aliexpress','1688') NOT NULL,
	`collection_type` enum('keyword','category') NOT NULL DEFAULT 'keyword',
	`keyword` varchar(255) NOT NULL,
	`category` varchar(100),
	`target_count` int NOT NULL DEFAULT 100,
	`status` enum('pending','running','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
	`collected_count` int NOT NULL DEFAULT 0,
	`started_at` timestamp,
	`completed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `collection_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `collection_results` (
	`id` int AUTO_INCREMENT NOT NULL,
	`job_id` int NOT NULL,
	`rank` int NOT NULL,
	`title` text NOT NULL,
	`title_ko` text,
	`product_url` text NOT NULL,
	`price` decimal(10,2),
	`currency` varchar(10),
	`sold_count` int,
	`rating` decimal(3,2),
	`review_count` int,
	`store_name` text,
	`category` varchar(255),
	`collected_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `collection_results_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `competitor_products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`platform` enum('aliexpress','1688') NOT NULL,
	`product_url` text NOT NULL,
	`product_name` varchar(500),
	`is_active` int NOT NULL DEFAULT 1,
	`check_frequency` int NOT NULL DEFAULT 24,
	`last_checked_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `competitor_products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `competitor_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` int NOT NULL,
	`price` decimal(10,2),
	`currency` varchar(10),
	`sold_count` int,
	`rating` decimal(3,2),
	`review_count` int,
	`store_name` text,
	`is_available` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `competitor_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `coupang_api_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`access_key` varchar(255),
	`secret_key` text,
	`price_change_threshold_percent` decimal(5,2) DEFAULT '3.00',
	`price_change_threshold_amount` decimal(10,2) DEFAULT '1000.00',
	`check_time` varchar(10) DEFAULT '09:10',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `coupang_api_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `coupang_api_settings_user_id_unique` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `coupang_price_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` varchar(100) NOT NULL,
	`checked_at` timestamp NOT NULL DEFAULT (now()),
	`price` decimal(10,2),
	`currency` varchar(10) NOT NULL DEFAULT 'KRW',
	`is_available` int NOT NULL DEFAULT 1,
	`raw` text,
	CONSTRAINT `coupang_price_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `coupang_watchlist_products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`product_id` varchar(100) NOT NULL,
	`alias_name` varchar(500),
	`product_url` text,
	`is_active` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `coupang_watchlist_products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `error_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`job_id` int,
	`error_type` varchar(100) NOT NULL,
	`error_message` text NOT NULL,
	`stack_trace` text,
	`screenshot` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `error_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `first_seen_products` (
	`product_key` varchar(500) NOT NULL,
	`platform` enum('aliexpress','1688') NOT NULL,
	`first_seen_at` timestamp NOT NULL,
	`first_seen_keyword` varchar(255) NOT NULL,
	`last_seen_at` timestamp NOT NULL,
	`supplier_id` varchar(255),
	`title_latest` text,
	`price_latest` decimal(10,2),
	`product_url_latest` text,
	CONSTRAINT `first_seen_products_product_key` PRIMARY KEY(`product_key`)
);
--> statement-breakpoint
CREATE TABLE `job_queue` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`platform` enum('aliexpress','1688') NOT NULL,
	`keyword` varchar(255) NOT NULL,
	`target_count` int NOT NULL DEFAULT 100,
	`priority` int NOT NULL DEFAULT 0,
	`status` enum('queued','processing','completed','failed','cancelled') NOT NULL DEFAULT 'queued',
	`job_id` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `job_queue_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `keyword_list` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`keyword` varchar(255) NOT NULL,
	`platform` enum('aliexpress','1688','all') NOT NULL DEFAULT 'all',
	`is_active` int NOT NULL DEFAULT 1,
	`priority` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `keyword_list_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `keyword_top_sellers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`keyword` varchar(255) NOT NULL,
	`platform` enum('aliexpress','1688') NOT NULL,
	`seller_id` varchar(255) NOT NULL,
	`seller_name` varchar(255) NOT NULL,
	`seller_url` text,
	`current_rank` int NOT NULL,
	`previous_rank` int,
	`rank_change` int DEFAULT 0,
	`total_sales` int NOT NULL DEFAULT 0,
	`product_count` int NOT NULL DEFAULT 0,
	`avg_price` decimal(10,2),
	`is_new_entry` int NOT NULL DEFAULT 0,
	`last_updated` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `keyword_top_sellers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `platform_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`platform` enum('aliexpress','1688') NOT NULL,
	`account_name` varchar(255),
	`username` varchar(255) NOT NULL,
	`encrypted_password` text NOT NULL,
	`login_status` enum('not_logged_in','logged_in','failed','expired') NOT NULL DEFAULT 'not_logged_in',
	`last_login_at` timestamp,
	`session_expires_at` timestamp,
	`session_data` text,
	`captcha_api_key` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `platform_accounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `popular_keywords` (
	`id` int AUTO_INCREMENT NOT NULL,
	`keyword` varchar(255) NOT NULL,
	`platform` enum('aliexpress','1688') NOT NULL,
	`frequency` int NOT NULL DEFAULT 0,
	`total_sales` int NOT NULL DEFAULT 0,
	`avg_price` decimal(10,2),
	`product_count` int NOT NULL DEFAULT 0,
	`popularity_score` decimal(10,2) NOT NULL DEFAULT '0',
	`analyzed_at` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `popular_keywords_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `price_change_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`product_id` varchar(100) NOT NULL,
	`alias_name` varchar(500),
	`alert_type` enum('price_drop','price_rise','out_of_stock') NOT NULL,
	`previous_price` decimal(10,2),
	`current_price` decimal(10,2),
	`change_percent` decimal(5,2),
	`change_amount` decimal(10,2),
	`is_read` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `price_change_alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`platform` enum('aliexpress','1688') NOT NULL,
	`keyword` varchar(255) NOT NULL,
	`target_count` int NOT NULL DEFAULT 100,
	`cron_expression` varchar(100) NOT NULL,
	`is_active` int NOT NULL DEFAULT 1,
	`last_run_at` timestamp,
	`next_run_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `schedules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `seller_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`keyword` varchar(255) NOT NULL,
	`platform` enum('aliexpress','1688') NOT NULL,
	`seller_id` varchar(255) NOT NULL,
	`seller_name` varchar(255) NOT NULL,
	`alert_type` enum('new_entry','rank_up','rank_down') NOT NULL,
	`previous_rank` int,
	`current_rank` int NOT NULL,
	`rank_change` int NOT NULL DEFAULT 0,
	`is_read` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `seller_alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `seller_rank_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`keyword` varchar(255) NOT NULL,
	`platform` enum('aliexpress','1688') NOT NULL,
	`seller_id` varchar(255) NOT NULL,
	`seller_name` varchar(255) NOT NULL,
	`rank` int NOT NULL,
	`total_sales` int NOT NULL DEFAULT 0,
	`product_count` int NOT NULL DEFAULT 0,
	`recorded_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `seller_rank_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `snapshot_items` (
	`snapshot_id` int NOT NULL,
	`rank` int NOT NULL,
	`product_key` varchar(500) NOT NULL,
	`price` decimal(10,2),
	`sold_count` int,
	`title` text,
	`product_url` text,
	CONSTRAINT `snapshot_items_snapshot_id_rank_pk` PRIMARY KEY(`snapshot_id`,`rank`)
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`platform` enum('aliexpress','1688') NOT NULL,
	`keyword` varchar(255) NOT NULL,
	`sort_mode` varchar(50) NOT NULL DEFAULT 'sales',
	`run_at` timestamp NOT NULL DEFAULT (now()),
	`status` enum('success','partial','failed') NOT NULL DEFAULT 'success',
	`items_collected` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `supplier_products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`supplier_id` int NOT NULL,
	`product_key` varchar(500) NOT NULL,
	`title` text,
	`price` decimal(10,2),
	`product_url` text,
	`image_url` text,
	`sold_count` int DEFAULT 0,
	`first_seen_at` timestamp NOT NULL DEFAULT (now()),
	`last_seen_at` timestamp NOT NULL DEFAULT (now()),
	`is_new` tinyint NOT NULL DEFAULT 1,
	CONSTRAINT `supplier_products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`supplier_id` varchar(255) NOT NULL,
	`platform` enum('aliexpress','1688') NOT NULL,
	`supplier_name` varchar(500),
	`supplier_url` text,
	`trust_score` decimal(5,2) DEFAULT '0',
	`total_sales` int DEFAULT 0,
	`rating` decimal(3,2),
	`response_rate` decimal(5,2),
	`is_active` tinyint NOT NULL DEFAULT 1,
	`last_scanned_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `suppliers_id` PRIMARY KEY(`id`),
	CONSTRAINT `suppliers_supplier_id_unique` UNIQUE(`supplier_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
--> statement-breakpoint
CREATE TABLE `volatility_scores` (
	`id` int AUTO_INCREMENT NOT NULL,
	`platform` enum('aliexpress','1688') NOT NULL,
	`keyword` varchar(255) NOT NULL,
	`calculated_at` timestamp NOT NULL DEFAULT (now()),
	`window_hours` int NOT NULL DEFAULT 24,
	`new_rate` decimal(5,4),
	`top20_churn` decimal(5,4),
	`avg_rank_move` decimal(5,4),
	`price_change` decimal(5,4),
	`volatility_score` decimal(5,4) NOT NULL,
	`volatility_avg_24h` decimal(5,4),
	`volatility_max_24h` decimal(5,4),
	`pair_count` int DEFAULT 0,
	CONSTRAINT `volatility_scores_id` PRIMARY KEY(`id`)
);
