-- ==================== 판매량 추정 시스템 (Sales Estimation System) ====================
-- Track 2: 쿠팡 판매량 추정 엔진
-- 리뷰 증가량, 순위, 품절 여부, 가격 안정성 기반 판매량 추정

-- 1) 카테고리별 리뷰 작성률 (ext_category_review_rates)
-- 카테고리마다 리뷰 작성 비율이 다름 → 판매량 역산에 사용
CREATE TABLE IF NOT EXISTS `ext_category_review_rates` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `category_key` VARCHAR(100) NOT NULL,          -- 카테고리 식별 키 (예: '생활용품', '뷰티', '전자기기')
  `category_name` VARCHAR(255) NOT NULL,         -- 표시용 한국어 이름
  `review_rate` DECIMAL(6,4) NOT NULL DEFAULT 0.0200,  -- 리뷰 작성률 (기본 2%)
  `confidence` ENUM('low', 'medium', 'high') NOT NULL DEFAULT 'medium',  -- 신뢰도
  `sample_count` INT DEFAULT 0,                  -- 산출 근거 샘플 수
  `notes` TEXT,                                  -- 참고사항
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_category_key` (`category_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 기본 카테고리별 리뷰 작성률 시드 데이터
INSERT IGNORE INTO `ext_category_review_rates` (`category_key`, `category_name`, `review_rate`, `confidence`, `notes`) VALUES
  ('생활용품',     '생활용품',       0.0200, 'medium', '일반적인 생활용품 평균'),
  ('뷰티',         '뷰티/화장품',   0.0350, 'medium', '뷰티 카테고리는 리뷰율 높음'),
  ('전자기기',     '전자기기',       0.0150, 'medium', '전자기기는 리뷰율 낮음'),
  ('패션의류',     '패션의류',       0.0250, 'medium', '패션 카테고리 평균'),
  ('패션잡화',     '패션잡화',       0.0230, 'medium', '패션잡화 평균'),
  ('식품',         '식품',           0.0100, 'medium', '식품은 리뷰율 매우 낮음'),
  ('유아동',       '유아동',         0.0300, 'medium', '유아동 카테고리 리뷰율 높음'),
  ('스포츠',       '스포츠/레저',    0.0180, 'medium', '스포츠/레저 평균'),
  ('가구인테리어', '가구/인테리어',  0.0120, 'medium', '가구/인테리어 리뷰율 낮음'),
  ('주방',         '주방용품',       0.0220, 'medium', '주방용품 평균'),
  ('반려동물',     '반려동물',       0.0280, 'medium', '반려동물 카테고리'),
  ('문구완구',     '문구/완구',      0.0200, 'medium', '문구/완구 평균'),
  ('자동차',       '자동차용품',     0.0140, 'medium', '자동차용품 리뷰율 낮음'),
  ('헬스',         '헬스/건강식품',  0.0250, 'medium', '건강식품 리뷰율'),
  ('기타',         '기타',           0.0200, 'medium', '기본값');

-- 2) 판매량 추정 결과 (ext_product_sales_estimates)
-- 일별 배치로 계산된 판매량 추정 결과 저장
CREATE TABLE IF NOT EXISTS `ext_product_sales_estimates` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `tracking_id` INT NOT NULL,                      -- ext_product_trackings FK
  `estimate_date` VARCHAR(10) NOT NULL,            -- YYYY-MM-DD (추정 기준일)

  -- 입력 지표 (계산에 사용된 원시 데이터)
  `review_delta_7d` INT DEFAULT 0,                 -- 7일간 리뷰 증가량
  `review_delta_30d` INT DEFAULT 0,                -- 30일간 리뷰 증가량
  `avg_rank` DECIMAL(8,2) DEFAULT 0,               -- 기간 내 평균 순위
  `sold_out_days` INT DEFAULT 0,                   -- 품절 일수 (30일 기준)
  `price_change_rate` DECIMAL(5,4) DEFAULT 0,      -- 가격 변동률 (표준편차/평균)
  `current_price` INT DEFAULT 0,                   -- 현재 판매가
  `current_review_count` INT DEFAULT 0,            -- 현재 총 리뷰 수
  `current_rating` DECIMAL(3,1) DEFAULT 0,         -- 현재 평점

  -- 카테고리 리뷰율
  `category_key` VARCHAR(100),                     -- 적용된 카테고리
  `review_rate` DECIMAL(6,4) DEFAULT 0.0200,       -- 적용된 리뷰율

  -- 추정 결과
  `estimated_daily_sales` DECIMAL(10,2) DEFAULT 0, -- 추정 일일 판매량
  `estimated_monthly_sales` DECIMAL(12,2) DEFAULT 0, -- 추정 월간 판매량 (일 × 30)
  `estimated_monthly_revenue` DECIMAL(14,0) DEFAULT 0, -- 추정 월 매출 (월판매량 × 현재가)

  -- 부스트 팩터 (디버깅/분석용)
  `base_daily_sales` DECIMAL(10,2) DEFAULT 0,      -- 기본 일판매 (부스트 전)
  `rank_boost` DECIMAL(5,3) DEFAULT 1.000,         -- 순위 부스트 계수
  `sold_out_boost` DECIMAL(5,3) DEFAULT 1.000,     -- 품절 부스트 계수
  `price_boost` DECIMAL(5,3) DEFAULT 1.000,        -- 가격안정성 부스트 계수

  -- 판매력 스코어
  `sales_power_score` DECIMAL(6,2) DEFAULT 0,      -- 판매력 점수 (0~100)
  `sales_grade` ENUM('VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH') DEFAULT 'MEDIUM',

  -- 추세 지표
  `trend_direction` ENUM('rising', 'stable', 'declining') DEFAULT 'stable',  -- 추세 방향
  `surge_flag` BOOLEAN DEFAULT FALSE,              -- 급등 플래그

  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY `uq_tracking_date` (`tracking_id`, `estimate_date`),
  INDEX `idx_user_date` (`user_id`, `estimate_date`),
  INDEX `idx_user_grade` (`user_id`, `sales_grade`),
  INDEX `idx_sales_power` (`user_id`, `sales_power_score` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
