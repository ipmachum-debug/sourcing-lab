-- v8.7: 검색량 조회 성능 개선 인덱스
-- ext_search_snapshots: getKeywordMarketData에서 (userId, query, createdAt DESC) 조회
CREATE INDEX `idx_ess_user_query_created` ON `ext_search_snapshots` (`user_id`, `query`, `created_at` DESC);
-- keyword_search_volume_history: fetchSearchVolume 7일 캐시 조회 + getKeywordMarketData 조회
CREATE INDEX `idx_ksvh_user_source_created` ON `keyword_search_volume_history` (`user_id`, `source`, `created_at`);
CREATE INDEX `idx_ksvh_user_keyword_source` ON `keyword_search_volume_history` (`user_id`, `keyword`, `source`, `year_month`);
