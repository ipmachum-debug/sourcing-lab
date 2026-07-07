-- POIZON OAuth 토큰 저장 (Seller Authorization 결과)
CREATE TABLE IF NOT EXISTS `poizon_oauth_token` (
  `id` int AUTO_INCREMENT NOT NULL PRIMARY KEY,
  `provider` varchar(20) NOT NULL DEFAULT 'poizon',
  `open_id` varchar(64),
  `access_token` text NOT NULL,
  `refresh_token` text,
  `access_expires_at` timestamp NULL,
  `refresh_expires_at` timestamp NULL,
  `scope` varchar(60),
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `uq_poizon_oauth_provider` UNIQUE (`provider`)
);
