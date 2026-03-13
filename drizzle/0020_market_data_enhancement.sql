-- v8.0: 키워드별 셀러라이프 수준 시장 데이터 확장

-- 1. ext_search_snapshots에 풍부한 시장 데이터 컬럼 추가
ALTER TABLE `ext_search_snapshots`
  ADD COLUMN `total_product_count` int DEFAULT 0 COMMENT '쿠팡 검색 결과 총 상품수 (페이지 헤더)',
  ADD COLUMN `min_price` int DEFAULT 0,
  ADD COLUMN `max_price` int DEFAULT 0,
  ADD COLUMN `median_price` int DEFAULT 0,
  ADD COLUMN `total_review_sum` int DEFAULT 0 COMMENT '전체 리뷰 합계',
  ADD COLUMN `max_review_count` int DEFAULT 0 COMMENT '최대 리뷰 상품',
  ADD COLUMN `min_review_count` int DEFAULT 0 COMMENT '최소 리뷰 상품 (리뷰 있는 중)',
  ADD COLUMN `avg_rating_all` decimal(3,2) DEFAULT 0 COMMENT '전체 평균 평점',
  ADD COLUMN `rocket_count` int DEFAULT 0 COMMENT '로켓배송 수',
  ADD COLUMN `seller_rocket_count` int DEFAULT 0 COMMENT '판매자로켓 수',
  ADD COLUMN `global_rocket_count` int DEFAULT 0 COMMENT '로켓직구 수',
  ADD COLUMN `normal_delivery_count` int DEFAULT 0 COMMENT '일반국내배송 수',
  ADD COLUMN `overseas_delivery_count` int DEFAULT 0 COMMENT '해외직구 수',
  ADD COLUMN `price_distribution_json` json COMMENT '가격 구간별 분포 [{range, count}]',
  ADD COLUMN `review_distribution_json` json COMMENT '리뷰 구간별 분포',
  ADD COLUMN `high_review_count` int DEFAULT 0 COMMENT '리뷰 100+ 상품 수';

-- 2. 네이버 검색량 월별 히스토리 테이블
CREATE TABLE IF NOT EXISTS `keyword_search_volume_history` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `user_id` int NOT NULL,
  `keyword` varchar(255) NOT NULL,
  `source` enum('naver','coupang_ads','estimated') NOT NULL DEFAULT 'naver',
  `year_month` varchar(7) NOT NULL COMMENT 'YYYY-MM',
  `pc_search` int DEFAULT 0,
  `mobile_search` int DEFAULT 0,
  `total_search` int DEFAULT 0,
  `competition_index` varchar(20) COMMENT 'LOW/MID/HIGH',
  `avg_cpc` decimal(12,2) DEFAULT 0 COMMENT '평균 CPC (네이버 기준)',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_volume_history` (`user_id`, `keyword`, `source`, `year_month`),
  INDEX `idx_volume_keyword` (`user_id`, `keyword`, `year_month`)
);

-- 3. 쿠팡 애즈 CPC 데이터 캐시
CREATE TABLE IF NOT EXISTS `keyword_cpc_cache` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `user_id` int NOT NULL,
  `keyword` varchar(255) NOT NULL,
  `category_id` varchar(50) COMMENT '쿠팡 카테고리 ID',
  `category_name` varchar(255) COMMENT '카테고리명',
  `suggested_bid` int DEFAULT 0 COMMENT '추천 입찰가 (원)',
  `min_bid` int DEFAULT 0 COMMENT '최소 입찰가',
  `max_bid` int DEFAULT 0 COMMENT '최대 입찰가',
  `estimated_impressions` int DEFAULT 0 COMMENT '예상 노출수',
  `estimated_clicks` int DEFAULT 0 COMMENT '예상 클릭수',
  `estimated_ctr` decimal(6,4) DEFAULT 0 COMMENT '예상 CTR',
  `competition_level` varchar(20) COMMENT '경쟁 수준',
  `collected_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` timestamp NOT NULL,
  INDEX `idx_cpc_keyword` (`user_id`, `keyword`),
  INDEX `idx_cpc_expires` (`expires_at`)
);
