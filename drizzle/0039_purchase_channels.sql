-- 0039_purchase_channels.sql
-- 매입 관리: 판매처(sell_channel)를 enum → varchar 로 확장.
--   기존 enum(poizon/danggeun/amazon/other)은 쇼피 등 신규 채널을 못 담음.
--   varchar(16)으로 바꿔 POIZON/쇼피/당근 등 자유 확장. 기존 값은 문자열로 보존됨.
--   매입처(buy_channel)는 이미 varchar(80) 자유입력 — 스키마 변경 없이 UI 프리셋만 추가.

ALTER TABLE `reverse_purchases` MODIFY COLUMN `sell_channel` varchar(16) NULL;
