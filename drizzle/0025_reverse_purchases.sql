-- 0025_reverse_purchases.sql
-- 역직구 매입 관리 (국내매입 → 검수 → 해외판매) 운영 로그.

CREATE TABLE IF NOT EXISTS `reverse_purchases` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `brand` varchar(100),
  `product_name` varchar(300) NOT NULL,
  `sku` varchar(120),
  `buy_channel` varchar(80),
  `buy_price` int DEFAULT 0,
  `qty` int DEFAULT 1,
  `buy_date` varchar(10),
  `condition` enum('new','a_grade','b_grade') DEFAULT 'new',
  `inspect_status` enum('pending','pass','fail') DEFAULT 'pending',
  `sell_channel` enum('poizon','danggeun','amazon','other'),
  `list_price` int DEFAULT 0,
  `sold_price` int DEFAULT 0,
  `sell_date` varchar(10),
  `status` enum('purchased','inspecting','listed','sold','settled','returned') NOT NULL DEFAULT 'purchased',
  `memo` varchar(500),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `reverse_purchases_id` PRIMARY KEY(`id`)
);

CREATE INDEX `idx_rp_user_status` ON `reverse_purchases` (`user_id`, `status`);
CREATE INDEX `idx_rp_user_brand` ON `reverse_purchases` (`user_id`, `brand`);
