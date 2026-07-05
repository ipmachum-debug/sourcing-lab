-- 0032_poizon_trending.sql
-- POIZON 랭킹·트렌드 정찰 — 유저가 본 랭킹/신상 페이지 상품을 패시브로 적립(공유).
-- "뭘 팔지" 발굴용. 능동 크롤 없이 본 페이지만 → 밴 리스크↓.

CREATE TABLE IF NOT EXISTS `poizon_trending` (
  `id` int AUTO_INCREMENT NOT NULL,
  `norm_key` varchar(255) NOT NULL,
  `product_name` varchar(300) NOT NULL,
  `brand` varchar(100),
  `rank_pos` int DEFAULT 0,
  `category` varchar(80),
  `is_new` boolean DEFAULT false,
  `trending_score` int DEFAULT 0,
  `price_cny` int DEFAULT 0,
  `sold_count` int DEFAULT 0,
  `image_url` varchar(1000),
  `source` varchar(30) DEFAULT 'extension',
  `observed_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `poizon_trending_id` PRIMARY KEY(`id`)
);

CREATE INDEX `idx_ptr_obs_rank` ON `poizon_trending` (`observed_at`, `rank_pos`);
CREATE INDEX `idx_ptr_key` ON `poizon_trending` (`norm_key`);
