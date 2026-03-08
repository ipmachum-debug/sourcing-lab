CREATE TABLE `product_keyword_links` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` int NOT NULL,
	`keyword_index` int NOT NULL,
	`link_type` enum('coupang','1688') NOT NULL,
	`slot` int NOT NULL,
	`url` text NOT NULL,
	`memo` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `product_keyword_links_id` PRIMARY KEY(`id`)
);
