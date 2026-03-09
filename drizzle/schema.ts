import { boolean, decimal, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

// ★ MySQL 서버가 KST(+09:00)로 동작하며, drizzle-orm의 timestamp()는
//   내부적으로 `new Date(value + "+0000")`으로 UTC 강제 변환하여 9시간 오차 발생.
//   모든 timestamp에 .mode("string")을 사용해 KST 문자열 그대로 전달.
//   → 클라이언트에서는 "2026-03-07 19:33:36" 형태의 KST 문자열을 받아 표시.
const tsOpts = { mode: "string" as const };

// ==================== Users (기존 인증 시스템 유지) ====================
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }).unique(),
  password: varchar("password", { length: 255 }),
  userMemo: text("userMemo"),
  profileImage: text("profileImage"),
  adminMemo: text("adminMemo"),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  approved: boolean("approved").default(false).notNull(),
  isSuperAdmin: boolean("isSuperAdmin").default(false).notNull(),
  passwordResetToken: varchar("passwordResetToken", { length: 255 }),
  passwordResetExpires: timestamp("passwordResetExpires", tsOpts),
  createdAt: timestamp("createdAt", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", tsOpts).defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn", tsOpts).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ==================== Products (핵심 메인 테이블) ====================
export const products = mysqlTable("products", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  recordDate: varchar("record_date", { length: 10 }).notNull(), // YYYY-MM-DD
  weekday: varchar("weekday", { length: 3 }), // Mon, Tue, ...
  weekKey: varchar("week_key", { length: 10 }), // 2026-W10
  category: varchar("category", { length: 100 }),
  productName: varchar("product_name", { length: 500 }).notNull(),
  status: mysqlEnum("status", [
    "draft", "reviewing", "test_candidate", "testing", "hold", "dropped", "selected"
  ]).default("draft").notNull(),
  priority: mysqlEnum("priority", ["low", "medium", "high"]).default("medium").notNull(),
  keyword1: varchar("keyword1", { length: 100 }),
  keyword2: varchar("keyword2", { length: 100 }),
  keyword3: varchar("keyword3", { length: 100 }),
  targetCustomer: text("target_customer"),
  seasonality: varchar("seasonality", { length: 50 }),
  competitionLevel: mysqlEnum("competition_level", ["low", "medium", "high", "very_high"]).default("medium"),
  differentiationLevel: mysqlEnum("differentiation_level", ["low", "medium", "high"]).default("medium"),
  thumbnailMemo: text("thumbnail_memo"),
  detailPoint: text("detail_point"),
  giftIdea: text("gift_idea"),
  improvementNote: text("improvement_note"),
  developmentNote: text("development_note"),
  finalOpinion: text("final_opinion"),
  score: int("score").default(0),
  scoreGrade: varchar("score_grade", { length: 2 }), // S, A, B, C, D
  coupangUrl: text("coupang_url"),
  referenceUrl: text("reference_url"),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type Product = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;

// ==================== Product Competitors ====================
export const productCompetitors = mysqlTable("product_competitors", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("product_id").notNull(),
  name: varchar("name", { length: 255 }),
  url: text("url"),
  price: decimal("price", { precision: 10, scale: 0 }),
  reviewCount: int("review_count"),
  rating: decimal("rating", { precision: 3, scale: 2 }),
  estimatedSales: int("estimated_sales"),
  thumbnailFeature: text("thumbnail_feature"),
  detailFeature: text("detail_feature"),
  strengths: text("strengths"),
  weaknesses: text("weaknesses"),
  freeGift: text("free_gift"),
  memo: text("memo"),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
});

export type ProductCompetitor = typeof productCompetitors.$inferSelect;
export type InsertProductCompetitor = typeof productCompetitors.$inferInsert;

// ==================== Product Suppliers (1688) ====================
export const productSuppliers = mysqlTable("product_suppliers", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("product_id").notNull(),
  supplierName: varchar("supplier_name", { length: 255 }),
  url1688: text("url_1688"),
  moq: int("moq"),
  unitCost: decimal("unit_cost", { precision: 10, scale: 0 }),
  internationalShippingCost: decimal("international_shipping_cost", { precision: 10, scale: 0 }),
  packagingCustomizable: boolean("packaging_customizable").default(false),
  oemAvailable: boolean("oem_available").default(false),
  leadTimeDays: int("lead_time_days"),
  qualityMemo: text("quality_memo"),
  sampleRequested: boolean("sample_requested").default(false),
  memo: text("memo"),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
});

export type ProductSupplier = typeof productSuppliers.$inferSelect;
export type InsertProductSupplier = typeof productSuppliers.$inferInsert;

// ==================== Product Margin Scenarios ====================
export const productMarginScenarios = mysqlTable("product_margin_scenarios", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("product_id").notNull(),
  label: mysqlEnum("label", ["conservative", "normal", "aggressive"]).default("normal").notNull(),
  supplyCost: decimal("supply_cost", { precision: 10, scale: 0 }).default("0"),
  internationalShippingCost: decimal("international_shipping_cost", { precision: 10, scale: 0 }).default("0"),
  domesticShippingCost: decimal("domestic_shipping_cost", { precision: 10, scale: 0 }).default("0"),
  packagingCost: decimal("packaging_cost", { precision: 10, scale: 0 }).default("0"),
  materialCost: decimal("material_cost", { precision: 10, scale: 0 }).default("0"),
  otherCost: decimal("other_cost", { precision: 10, scale: 0 }).default("0"),
  feeRate: decimal("fee_rate", { precision: 5, scale: 2 }).default("10.80"),
  adRate: decimal("ad_rate", { precision: 5, scale: 2 }).default("15.00"),
  sellPrice: decimal("sell_price", { precision: 10, scale: 0 }).default("0"),
  totalCost: decimal("total_cost", { precision: 10, scale: 0 }).default("0"),
  feeAmount: decimal("fee_amount", { precision: 10, scale: 0 }).default("0"),
  adAmount: decimal("ad_amount", { precision: 10, scale: 0 }).default("0"),
  profit: decimal("profit", { precision: 10, scale: 0 }).default("0"),
  marginRate: decimal("margin_rate", { precision: 5, scale: 2 }).default("0"),
  breakEvenAdRate: decimal("break_even_ad_rate", { precision: 5, scale: 2 }).default("0"),
  isPrimary: boolean("is_primary").default(false),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
});

export type ProductMarginScenario = typeof productMarginScenarios.$inferSelect;
export type InsertProductMarginScenario = typeof productMarginScenarios.$inferInsert;

// ==================== Product Notes ====================
export const productNotes = mysqlTable("product_notes", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("product_id").notNull(),
  type: mysqlEnum("type", ["improvement", "development", "memo", "review"]).default("memo").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
});

export type ProductNote = typeof productNotes.$inferSelect;
export type InsertProductNote = typeof productNotes.$inferInsert;

// ==================== Product Keyword Links (키워드별 쿠팡/1688 URL) ====================
export const productKeywordLinks = mysqlTable("product_keyword_links", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("product_id").notNull(),
  keywordIndex: int("keyword_index").notNull(), // 1, 2, 3
  linkType: mysqlEnum("link_type", ["coupang", "1688"]).notNull(),
  slot: int("slot").notNull(), // 1~10
  url: text("url").notNull(),
  memo: varchar("memo", { length: 255 }),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
});

export type ProductKeywordLink = typeof productKeywordLinks.$inferSelect;
export type InsertProductKeywordLink = typeof productKeywordLinks.$inferInsert;

// ==================== Platform Accounts (1688/AliExpress) ====================
export const platformAccounts = mysqlTable("platform_accounts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  platform: mysqlEnum("platform", ["aliexpress", "1688"]).notNull(),
  accountName: varchar("account_name", { length: 255 }),
  username: varchar("username", { length: 255 }).notNull(),
  encryptedPassword: text("encrypted_password").notNull(),
  loginStatus: mysqlEnum("login_status", ["not_logged_in", "logged_in", "failed", "expired"]).default("not_logged_in").notNull(),
  lastLoginAt: timestamp("last_login_at", tsOpts),
  sessionExpiresAt: timestamp("session_expires_at", tsOpts),
  sessionData: text("session_data"),
  captchaApiKey: varchar("captcha_api_key", { length: 255 }),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type PlatformAccount = typeof platformAccounts.$inferSelect;
export type InsertPlatformAccount = typeof platformAccounts.$inferInsert;

// ==================== Coupang API Settings (레거시 — 하위호환 유지) ====================
export const coupangApiSettings = mysqlTable("coupang_api_settings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  accessKey: varchar("access_key", { length: 255 }),
  secretKey: text("secret_key"),
  priceChangeThresholdPercent: decimal("price_change_threshold_percent", { precision: 5, scale: 2 }).default("3.00"),
  priceChangeThresholdAmount: decimal("price_change_threshold_amount", { precision: 10, scale: 2 }).default("1000.00"),
  checkTime: varchar("check_time", { length: 10 }).default("09:10"),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});
export type CoupangApiSetting = typeof coupangApiSettings.$inferSelect;

// ================================================================
//  쿠팡 분석 시스템 (경영판단툴)
//  쿠팡윙 = 운영 원장  /  내 시스템 = 분석·판단·손익·기록
// ================================================================

// ==================== 1) 쿠팡 API 계정 (coupang_api_accounts) ====================
// 복수 Wing 계정의 OPEN API 키만 관리 (운영은 쿠팡윙에서)
export const coupangAccounts = mysqlTable("coupang_api_accounts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  accountName: varchar("account_name", { length: 255 }).notNull(),  // "메인스토어", "2호점"
  vendorId: varchar("vendor_id", { length: 100 }),                   // 쿠팡 Wing 업체코드
  accessKey: varchar("access_key", { length: 255 }),                 // OPEN API Access Key
  secretKey: text("secret_key"),                                     // OPEN API Secret Key
  wingLoginId: varchar("wing_login_id", { length: 255 }),            // 쿠팡 Wing 로그인 ID
  companyName: varchar("company_name", { length: 255 }),             // 업체명
  apiUrl: varchar("api_url", { length: 500 }),                       // API URL (wing.coupang.com)
  ipAddress: varchar("ip_address", { length: 500 }),                 // IP 주소 (쉼표 구분)
  isActive: boolean("is_active").default(true).notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  memo: text("memo"),
  lastSyncAt: timestamp("last_sync_at", tsOpts),                             // 마지막 동기화 시각
  apiStatus: mysqlEnum("api_status", ["active", "error", "expired", "not_tested"]).default("not_tested").notNull(),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});
export type CoupangAccount = typeof coupangAccounts.$inferSelect;

// ==================== 2) 내 상품 ↔ 쿠팡 상품 연결 (product_channel_mappings) ====================
// 소싱한 상품이 실제 쿠팡에서 어떤 상품 ID인지 연결 — 핵심 테이블
export const productChannelMappings = mysqlTable("product_channel_mappings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  accountId: int("account_id").notNull(),                            // coupang_api_accounts FK
  internalProductId: int("internal_product_id"),                     // products.id (소싱 상품)
  sellerProductId: varchar("seller_product_id", { length: 100 }),    // 쿠팡 등록상품 ID
  vendorItemId: varchar("vendor_item_id", { length: 100 }),          // 쿠팡 벤더아이템 ID (옵션별)
  coupangProductName: varchar("coupang_product_name", { length: 500 }), // 쿠팡에 노출되는 상품명
  coupangUrl: text("coupang_url"),
  isActive: boolean("is_active").default(true).notNull(),
  memo: text("memo"),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});
export type ProductChannelMapping = typeof productChannelMappings.$inferSelect;

// ==================== 3) 일별 판매 집계 (cp_daily_sales) ====================
// 데일리 수익 = 판매량 + 매출 → 마진 분석의 기반
export const cpDailySales = mysqlTable("cp_daily_sales", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  accountId: int("account_id").notNull(),
  mappingId: int("mapping_id").notNull(),                            // product_channel_mappings FK
  saleDate: varchar("sale_date", { length: 10 }).notNull(),          // YYYY-MM-DD
  quantity: int("quantity").default(0).notNull(),                    // 판매량
  grossSales: decimal("gross_sales", { precision: 14, scale: 0 }).default("0"),  // 매출총액
  orderCount: int("order_count").default(0),                         // 주문건수
  adSpend: decimal("ad_spend", { precision: 12, scale: 0 }).default("0"),        // 광고비 (수동입력)
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});
export type CpDailySale = typeof cpDailySales.$inferSelect;

// ==================== 4) 정산 집계 (cp_daily_settlements) ====================
// 실제 정산 기준 손익 = 마진 비교의 핵심
export const cpDailySettlements = mysqlTable("cp_daily_settlements", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  accountId: int("account_id").notNull(),
  mappingId: int("mapping_id"),                                       // product_channel_mappings FK (null이면 전체)
  settlementDate: varchar("settlement_date", { length: 10 }).notNull(), // YYYY-MM-DD
  grossAmount: decimal("gross_amount", { precision: 14, scale: 0 }).default("0"),      // 정산 매출
  commissionAmount: decimal("commission_amount", { precision: 12, scale: 0 }).default("0"), // 수수료
  shippingAmount: decimal("shipping_amount", { precision: 12, scale: 0 }).default("0"),     // 배송비
  payoutAmount: decimal("payout_amount", { precision: 14, scale: 0 }).default("0"),         // 실정산금액
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});
export type CpDailySettlement = typeof cpDailySettlements.$inferSelect;

// ==================== 5) 동기화 이력 (coupang_sync_jobs) ====================
// API 연동 안정성 추적
export const coupangSyncJobs = mysqlTable("coupang_sync_jobs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  accountId: int("account_id").notNull(),
  jobType: mysqlEnum("job_type", ["sales", "settlements", "products", "orders", "all"]).notNull(),
  status: mysqlEnum("status", ["running", "success", "failed"]).default("running").notNull(),
  startedAt: timestamp("started_at", tsOpts).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", tsOpts),
  recordCount: int("record_count").default(0),
  errorMessage: text("error_message"),
});
export type CoupangSyncJob = typeof coupangSyncJobs.$inferSelect;

// ==================== Daily Sales (일일 판매 데이터 — 기존 소싱 시스템) ====================
export const dailySales = mysqlTable("daily_sales", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  productId: int("product_id").notNull(),
  saleDate: varchar("sale_date", { length: 10 }).notNull(), // YYYY-MM-DD
  quantity: int("quantity").default(0).notNull(),
  sellPrice: decimal("sell_price", { precision: 10, scale: 0 }).default("0"), // 판매가 (스냅샷)
  margin: decimal("margin", { precision: 10, scale: 0 }).default("0"),       // 개당 마진
  dailyRevenue: decimal("daily_revenue", { precision: 12, scale: 0 }).default("0"), // 일매출 = sellPrice × quantity
  dailyProfit: decimal("daily_profit", { precision: 12, scale: 0 }).default("0"),   // 일수익 = margin × quantity
  memo: text("memo"),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type DailySale = typeof dailySales.$inferSelect;
export type InsertDailySale = typeof dailySales.$inferInsert;

// ==================== Weekly Reviews ====================
export const weeklyReviews = mysqlTable("weekly_reviews", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  weekKey: varchar("week_key", { length: 10 }).notNull(), // 2026-W10
  startDate: varchar("start_date", { length: 10 }).notNull(),
  endDate: varchar("end_date", { length: 10 }).notNull(),
  totalSourcedCount: int("total_sourced_count").default(0),
  topCategory: text("top_category"),
  orderedKeywords: text("ordered_keywords"),
  exposedKeywords: text("exposed_keywords"),
  bestConvertedProducts: text("best_converted_products"),
  dropProducts: text("drop_products"),
  nextWeekCategories: text("next_week_categories"),
  nextWeekKeywords: text("next_week_keywords"),
  actionItems: text("action_items"),
  reviewMemo: text("review_memo"),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type WeeklyReview = typeof weeklyReviews.$inferSelect;
export type InsertWeeklyReview = typeof weeklyReviews.$inferInsert;

// ==================== Extension: 검색 스냅샷 (ext_search_snapshots) ====================
// 크롬 확장프로그램에서 쿠팡 검색 시 자동 저장되는 스냅샷
export const extSearchSnapshots = mysqlTable("ext_search_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  query: varchar("query", { length: 255 }).notNull(),
  totalItems: int("total_items").default(0).notNull(),
  avgPrice: int("avg_price").default(0),
  avgRating: decimal("avg_rating", { precision: 3, scale: 1 }).default("0"),
  avgReview: int("avg_review").default(0),
  highReviewRatio: int("high_review_ratio").default(0),       // 리뷰100+ 비율 (%)
  adCount: int("ad_count").default(0),
  competitionScore: int("competition_score").default(0),       // 경쟁 강도 0~100
  competitionLevel: mysqlEnum("competition_level", ["easy", "medium", "hard"]).default("medium"),
  itemsJson: text("items_json"),                               // 상품 목록 JSON
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
});

export type ExtSearchSnapshot = typeof extSearchSnapshots.$inferSelect;
export type InsertExtSearchSnapshot = typeof extSearchSnapshots.$inferInsert;

// ==================== Extension: 소싱 후보 (ext_candidates) ====================
// 확장프로그램에서 ⭐ 저장한 소싱 후보 → 서버에 동기화
export const extCandidates = mysqlTable("ext_candidates", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  productId: varchar("coupang_product_id", { length: 50 }),     // 쿠팡 상품ID
  title: varchar("title", { length: 500 }),
  price: int("price").default(0),
  rating: decimal("rating", { precision: 3, scale: 1 }).default("0"),
  reviewCount: int("review_count").default(0),
  imageUrl: text("image_url"),
  coupangUrl: text("coupang_url"),
  sourcingScore: int("sourcing_score").default(0),              // 소싱 점수 0~100
  sourcingGrade: varchar("sourcing_grade", { length: 2 }),      // A~F
  searchQuery: varchar("search_query", { length: 255 }),        // 어떤 검색어에서 발견했는지
  status: mysqlEnum("status", ["new", "reviewing", "contacted_supplier", "sample_ordered", "dropped", "selected"]).default("new").notNull(),
  memo: text("memo"),
  supplierUrl: text("supplier_url"),                            // 1688 공급처 URL
  estimatedCostCny: decimal("estimated_cost_cny", { precision: 10, scale: 2 }),
  estimatedMarginRate: decimal("estimated_margin_rate", { precision: 5, scale: 2 }),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type ExtCandidate = typeof extCandidates.$inferSelect;
export type InsertExtCandidate = typeof extCandidates.$inferInsert;

// ==================== Extension: 순위 추적 (ext_rank_trackings) ====================
// 특정 검색어에서 특정 상품의 순위를 시간대별로 추적
export const extRankTrackings = mysqlTable("ext_rank_trackings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  query: varchar("query", { length: 255 }).notNull(),           // 검색어
  coupangProductId: varchar("coupang_product_id", { length: 50 }).notNull(),
  title: varchar("title", { length: 500 }),
  position: int("position").notNull(),                           // 순위
  price: int("price").default(0),
  rating: decimal("rating", { precision: 3, scale: 1 }).default("0"),
  reviewCount: int("review_count").default(0),
  isAd: boolean("is_ad").default(false),
  isRocket: boolean("is_rocket").default(false),
  capturedAt: timestamp("captured_at", tsOpts).defaultNow().notNull(),
});

export type ExtRankTracking = typeof extRankTrackings.$inferSelect;
export type InsertExtRankTracking = typeof extRankTrackings.$inferInsert;

// ==================== Extension: 순위 추적 키워드 (ext_tracked_keywords) ====================
// 사용자가 추적하기로 등록한 키워드 목록
export const extTrackedKeywords = mysqlTable("ext_tracked_keywords", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  query: varchar("query", { length: 255 }).notNull(),
  targetProductId: varchar("target_product_id", { length: 50 }),  // 내 상품 ID (추적 대상)
  targetProductName: varchar("target_product_name", { length: 500 }),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
});

export type ExtTrackedKeyword = typeof extTrackedKeywords.$inferSelect;
export type InsertExtTrackedKeyword = typeof extTrackedKeywords.$inferInsert;

// ==================== Extension: 상품 상세 스냅샷 (ext_product_details) ====================
// 쿠팡 상품 상세 페이지에서 파싱한 데이터
export const extProductDetails = mysqlTable("ext_product_details", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  coupangProductId: varchar("coupang_product_id", { length: 50 }).notNull(),
  title: varchar("title", { length: 500 }),
  price: int("price").default(0),
  originalPrice: int("original_price").default(0),              // 정가
  discountRate: int("discount_rate").default(0),                 // 할인율 %
  rating: decimal("rating", { precision: 3, scale: 1 }).default("0"),
  reviewCount: int("review_count").default(0),
  purchaseCount: varchar("purchase_count", { length: 100 }),     // "1,000+명이 구매" 등
  sellerName: varchar("seller_name", { length: 255 }),
  isRocket: boolean("is_rocket").default(false),
  isFreeShipping: boolean("is_free_shipping").default(false),
  categoryPath: varchar("category_path", { length: 500 }),       // 카테고리 경로
  optionCount: int("option_count").default(0),
  imageUrl: text("image_url"),
  detailJson: text("detail_json"),                               // 전체 상세 데이터 JSON
  capturedAt: timestamp("captured_at", tsOpts).defaultNow().notNull(),
});

export type ExtProductDetail = typeof extProductDetails.$inferSelect;
export type InsertExtProductDetail = typeof extProductDetails.$inferInsert;

// ==================== Extension: 알림 센터 (ext_notifications) ====================
export const extNotifications = mysqlTable("ext_notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  type: mysqlEnum("type", [
    "rank_change", "price_change", "new_competitor",
    "ai_recommendation", "milestone", "system"
  ]).default("system").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  data: text("data"),  // JSON payload for extra context
  isRead: boolean("is_read").default(false).notNull(),
  priority: mysqlEnum("priority", ["low", "medium", "high"]).default("medium").notNull(),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
});

export type ExtNotification = typeof extNotifications.$inferSelect;
export type InsertExtNotification = typeof extNotifications.$inferInsert;

// ==================== Extension: AI 리뷰 분석 캐시 (ext_review_analyses) ====================
export const extReviewAnalyses = mysqlTable("ext_review_analyses", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  query: varchar("query", { length: 255 }).notNull(),          // 분석 대상 키워드
  analysisType: mysqlEnum("analysis_type", [
    "keyword_review", "product_review", "category_review"
  ]).default("keyword_review").notNull(),
  totalProductsAnalyzed: int("total_products_analyzed").default(0),
  avgRating: decimal("avg_rating", { precision: 3, scale: 1 }).default("0"),
  avgReviewCount: int("avg_review_count").default(0),
  painPoints: text("pain_points"),         // JSON array of pain points
  customerNeeds: text("customer_needs"),   // JSON array of customer needs
  opportunities: text("opportunities"),     // JSON array of opportunities
  commonPraises: text("common_praises"),   // JSON array of common praises
  commonComplaints: text("common_complaints"), // JSON array
  priceSensitivity: varchar("price_sensitivity", { length: 50 }),  // low/medium/high
  qualityConcerns: text("quality_concerns"), // JSON array
  summaryText: text("summary_text"),       // Full summary
  recommendations: text("recommendations"), // JSON array of actionable recommendations
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
});

export type ExtReviewAnalysis = typeof extReviewAnalyses.$inferSelect;
export type InsertExtReviewAnalysis = typeof extReviewAnalyses.$inferInsert;

// ==================== Extension: WING 인기상품 검색 (ext_wing_searches) ====================
// WING 셀러센터에서 인기상품검색 시 수집된 데이터
export const extWingSearches = mysqlTable("ext_wing_searches", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  keyword: varchar("keyword", { length: 255 }).default(""),          // 검색 키워드
  category: varchar("category", { length: 255 }).default(""),        // 카테고리
  totalItems: int("total_items").default(0).notNull(),               // 총 상품 수
  avgPrice: int("avg_price").default(0),                             // 평균 가격
  avgRating: decimal("avg_rating", { precision: 3, scale: 1 }).default("0"),
  avgReview: int("avg_review").default(0),                           // 평균 리뷰 수
  source: varchar("source", { length: 50 }).default("unknown"),      // api / dom_table / dom_card
  pageUrl: text("page_url"),                                         // WING 페이지 URL
  itemsJson: text("items_json"),                                     // 상품 목록 JSON (최대 50개)
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
});

export type ExtWingSearch = typeof extWingSearches.$inferSelect;
export type InsertExtWingSearch = typeof extWingSearches.$inferInsert;

// ==================== Extension: 키워드 일별 통계 (ext_keyword_daily_stats) ====================
// 키워드별 일별 스냅샷 기반 집계 데이터 — 검색 수요 추정의 핵심
export const extKeywordDailyStats = mysqlTable("ext_keyword_daily_stats", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  query: varchar("query", { length: 255 }).notNull(),
  statDate: varchar("stat_date", { length: 10 }).notNull(),          // YYYY-MM-DD
  snapshotCount: int("snapshot_count").default(0),                    // 해당일 스냅샷 수
  productCount: int("product_count").default(0),                      // 상품 수
  avgPrice: int("avg_price").default(0),                              // 평균가
  avgRating: decimal("avg_rating", { precision: 3, scale: 1 }).default("0"),
  avgReview: int("avg_review").default(0),                            // 평균 리뷰 수
  totalReviewSum: int("total_review_sum").default(0),                 // 전체 리뷰 합계 (리뷰 성장 계산용)
  adCount: int("ad_count").default(0),                                // 광고 상품 수
  adRatio: int("ad_ratio").default(0),                                // 광고 비율 (%)
  rocketCount: int("rocket_count").default(0),                        // 로켓배송 상품 수
  highReviewCount: int("high_review_count").default(0),               // 리뷰100+ 상품 수
  competitionScore: int("competition_score").default(0),              // 경쟁 점수 0~100
  competitionLevel: mysqlEnum("competition_level", ["easy", "medium", "hard"]).default("medium"),
  // 전일 대비 변동 (computed)
  reviewGrowth: int("review_growth").default(0),                      // 리뷰 증가량 (전일 대비 totalReviewSum 차이)
  salesEstimate: int("sales_estimate").default(0),                    // 추정 판매량 = reviewGrowth × 20
  priceChange: int("price_change").default(0),                        // 평균가 변동 (전일 대비)
  productCountChange: int("product_count_change").default(0),         // 상품수 변동
  // 검색 수요 추정 스코어
  demandScore: int("demand_score").default(0),                        // 검색 수요 점수 0~100
  keywordScore: int("keyword_score").default(0),                      // 종합 키워드 점수 (HiddenScore)
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type ExtKeywordDailyStat = typeof extKeywordDailyStats.$inferSelect;
export type InsertExtKeywordDailyStat = typeof extKeywordDailyStats.$inferInsert;

// ==================== Extension: 내 상품 자동 추적 (ext_product_trackings) ====================
// 등록/판매/데일리소싱 제품을 연결하여 자동 키워드 등록 및 일일 데이터 수집
export const extProductTrackings = mysqlTable("ext_product_trackings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  sourceType: mysqlEnum("source_type", ["product", "candidate", "coupang_mapping", "manual"]).default("manual").notNull(),
  sourceId: int("source_id"),
  productName: varchar("product_name", { length: 500 }).notNull(),
  coupangProductId: varchar("coupang_product_id", { length: 50 }),
  coupangUrl: text("coupang_url"),
  imageUrl: text("image_url"),
  keywords: text("keywords"),                          // JSON array of keyword strings
  latestPrice: int("latest_price").default(0),
  latestRating: decimal("latest_rating", { precision: 3, scale: 1 }).default("0"),
  latestReviewCount: int("latest_review_count").default(0),
  latestRank: int("latest_rank").default(0),
  latestRankKeyword: varchar("latest_rank_keyword", { length: 255 }),
  priceChange: int("price_change").default(0),
  reviewChange: int("review_change").default(0),
  rankChange: int("rank_change").default(0),
  competitorCount: int("competitor_count").default(0),
  similarProductsJson: text("similar_products_json"),
  competitorSummaryJson: text("competitor_summary_json"),
  aiSuggestion: text("ai_suggestion"),
  aiUpdatedAt: timestamp("ai_updated_at", tsOpts),
  isActive: boolean("is_active").default(true).notNull(),
  lastTrackedAt: timestamp("last_tracked_at", tsOpts),
  trackFrequency: mysqlEnum("track_frequency", ["daily", "weekly"]).default("daily").notNull(),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type ExtProductTracking = typeof extProductTrackings.$inferSelect;
export type InsertExtProductTracking = typeof extProductTrackings.$inferInsert;

// ==================== Extension: 추적 상품 일일 스냅샷 (ext_product_daily_snapshots) ====================
export const extProductDailySnapshots = mysqlTable("ext_product_daily_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  trackingId: int("tracking_id").notNull(),
  snapshotDate: varchar("snapshot_date", { length: 10 }).notNull(),
  price: int("price").default(0),
  rating: decimal("rating", { precision: 3, scale: 1 }).default("0"),
  reviewCount: int("review_count").default(0),
  rankPosition: int("rank_position").default(0),
  rankKeyword: varchar("rank_keyword", { length: 255 }),
  competitorCount: int("competitor_count").default(0),
  similarAvgPrice: int("similar_avg_price").default(0),
  similarAvgReview: int("similar_avg_review").default(0),
  adCount: int("ad_count").default(0),
  dataJson: text("data_json"),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
});

export type ExtProductDailySnapshot = typeof extProductDailySnapshots.$inferSelect;
export type InsertExtProductDailySnapshot = typeof extProductDailySnapshots.$inferInsert;

// ==================== Extension: 카테고리별 리뷰 작성률 (ext_category_review_rates) ====================
// 카테고리마다 리뷰 작성 비율이 다름 → 판매량 역산에 사용
export const extCategoryReviewRates = mysqlTable("ext_category_review_rates", {
  id: int("id").autoincrement().primaryKey(),
  categoryKey: varchar("category_key", { length: 100 }).notNull(),
  categoryName: varchar("category_name", { length: 255 }).notNull(),
  reviewRate: decimal("review_rate", { precision: 6, scale: 4 }).notNull().default("0.0200"),
  confidence: mysqlEnum("confidence", ["low", "medium", "high"]).default("medium").notNull(),
  sampleCount: int("sample_count").default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type ExtCategoryReviewRate = typeof extCategoryReviewRates.$inferSelect;
export type InsertExtCategoryReviewRate = typeof extCategoryReviewRates.$inferInsert;

// ==================== Extension: 판매량 추정 결과 (ext_product_sales_estimates) ====================
// 일별 배치로 계산된 판매량 추정 결과 저장
export const extProductSalesEstimates = mysqlTable("ext_product_sales_estimates", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  trackingId: int("tracking_id").notNull(),              // ext_product_trackings FK
  estimateDate: varchar("estimate_date", { length: 10 }).notNull(),  // YYYY-MM-DD

  // 입력 지표
  reviewDelta7d: int("review_delta_7d").default(0),
  reviewDelta30d: int("review_delta_30d").default(0),
  avgRank: decimal("avg_rank", { precision: 8, scale: 2 }).default("0"),
  soldOutDays: int("sold_out_days").default(0),
  priceChangeRate: decimal("price_change_rate", { precision: 5, scale: 4 }).default("0"),
  currentPrice: int("current_price").default(0),
  currentReviewCount: int("current_review_count").default(0),
  currentRating: decimal("current_rating", { precision: 3, scale: 1 }).default("0"),

  // 카테고리 리뷰율
  categoryKey: varchar("category_key", { length: 100 }),
  reviewRate: decimal("review_rate", { precision: 6, scale: 4 }).default("0.0200"),

  // 추정 결과
  estimatedDailySales: decimal("estimated_daily_sales", { precision: 10, scale: 2 }).default("0"),
  estimatedMonthlySales: decimal("estimated_monthly_sales", { precision: 12, scale: 2 }).default("0"),
  estimatedMonthlyRevenue: decimal("estimated_monthly_revenue", { precision: 14, scale: 0 }).default("0"),

  // 부스트 팩터
  baseDailySales: decimal("base_daily_sales", { precision: 10, scale: 2 }).default("0"),
  rankBoost: decimal("rank_boost", { precision: 5, scale: 3 }).default("1.000"),
  soldOutBoost: decimal("sold_out_boost", { precision: 5, scale: 3 }).default("1.000"),
  priceBoost: decimal("price_boost", { precision: 5, scale: 3 }).default("1.000"),

  // 판매력 스코어
  salesPowerScore: decimal("sales_power_score", { precision: 6, scale: 2 }).default("0"),
  salesGrade: mysqlEnum("sales_grade", ["VERY_LOW", "LOW", "MEDIUM", "HIGH", "VERY_HIGH"]).default("MEDIUM"),

  // 추세 지표
  trendDirection: mysqlEnum("trend_direction", ["rising", "stable", "declining"]).default("stable"),
  surgeFlag: boolean("surge_flag").default(false),

  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type ExtProductSalesEstimate = typeof extProductSalesEstimates.$inferSelect;
export type InsertExtProductSalesEstimate = typeof extProductSalesEstimates.$inferInsert;

// ==================== Extension: 검색 이벤트 로그 (ext_search_events) ====================
// 사용자가 쿠팡에서 검색할 때마다 기록 — 리얼타임 데이터 수집의 핵심
export const extSearchEvents = mysqlTable("ext_search_events", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  keyword: varchar("keyword", { length: 255 }).notNull(),
  searchedAt: timestamp("searched_at", tsOpts).defaultNow().notNull(),
  source: varchar("source", { length: 50 }).notNull().default("user_search"),
  pageUrl: text("page_url"),
  totalItems: int("total_items").notNull().default(0),
  itemsJson: text("items_json"),
  // 집계 통계
  avgPrice: int("avg_price").default(0),
  avgRating: decimal("avg_rating", { precision: 3, scale: 1 }).default("0"),
  avgReview: int("avg_review").default(0),
  totalReviewSum: int("total_review_sum").default(0),
  adCount: int("ad_count").default(0),
  rocketCount: int("rocket_count").default(0),
  highReviewCount: int("high_review_count").default(0),
  // 파싱 품질
  priceParseRate: int("price_parse_rate").default(0),
  ratingParseRate: int("rating_parse_rate").default(0),
  reviewParseRate: int("review_parse_rate").default(0),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
});

export type ExtSearchEvent = typeof extSearchEvents.$inferSelect;
export type InsertExtSearchEvent = typeof extSearchEvents.$inferInsert;

// ==================== Extension: 감시 키워드 (ext_watch_keywords) ====================
// 자동 등록 + 배치 수집 대상 관리
export const extWatchKeywords = mysqlTable("ext_watch_keywords", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  keyword: varchar("keyword", { length: 255 }).notNull(),
  priority: int("priority").notNull().default(50),
  isActive: boolean("is_active").notNull().default(true),
  collectIntervalHours: int("collect_interval_hours").notNull().default(24),
  // 상태 추적
  totalSearchCount: int("total_search_count").default(0),
  lastSearchedAt: timestamp("last_searched_at", tsOpts),
  lastCollectedAt: timestamp("last_collected_at", tsOpts),
  lastUserViewAt: timestamp("last_user_view_at", tsOpts),
  // 최신 집계
  latestTotalItems: int("latest_total_items").default(0),
  latestAvgPrice: int("latest_avg_price").default(0),
  latestAvgRating: decimal("latest_avg_rating", { precision: 3, scale: 1 }).default("0"),
  latestAvgReview: int("latest_avg_review").default(0),
  latestTotalReviewSum: int("latest_total_review_sum").default(0),
  latestAdCount: int("latest_ad_count").default(0),
  latestRocketCount: int("latest_rocket_count").default(0),
  // 변동 추적
  reviewGrowth1d: int("review_growth_1d").default(0),
  reviewGrowth7d: int("review_growth_7d").default(0),
  priceChange1d: int("price_change_1d").default(0),
  compositeScore: int("composite_score").default(0),
  // 타임스탬프
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type ExtWatchKeyword = typeof extWatchKeywords.$inferSelect;
export type InsertExtWatchKeyword = typeof extWatchKeywords.$inferInsert;

// ==================== Extension: 키워드 일별 상태 (ext_keyword_daily_status) ====================
// 키워드별 일별 집계 — 7일 이상 축적 후 판매량 추정 가능
export const extKeywordDailyStatus = mysqlTable("ext_keyword_daily_status", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  keyword: varchar("keyword", { length: 255 }).notNull(),
  statDate: varchar("stat_date", { length: 10 }).notNull(),
  source: varchar("source", { length: 50 }).notNull().default("user_search"),
  // 검색 결과 집계
  totalItems: int("total_items").default(0),
  avgPrice: int("avg_price").default(0),
  minPrice: int("min_price").default(0),
  maxPrice: int("max_price").default(0),
  avgRating: decimal("avg_rating", { precision: 3, scale: 1 }).default("0"),
  avgReview: int("avg_review").default(0),
  totalReviewSum: int("total_review_sum").default(0),
  medianReview: int("median_review").default(0),
  // 상품 분포
  adCount: int("ad_count").default(0),
  adRatio: decimal("ad_ratio", { precision: 5, scale: 2 }).default("0"),
  rocketCount: int("rocket_count").default(0),
  rocketRatio: decimal("rocket_ratio", { precision: 5, scale: 2 }).default("0"),
  highReviewCount: int("high_review_count").default(0),
  newProductCount: int("new_product_count").default(0),
  // 전일 대비 변동
  reviewGrowth: int("review_growth").default(0),
  priceChange: int("price_change").default(0),
  itemCountChange: int("item_count_change").default(0),
  rankChangeJson: text("rank_change_json"),
  // 재고 상태
  outOfStockCount: int("out_of_stock_count").default(0),
  outOfStockRate: decimal("out_of_stock_rate", { precision: 5, scale: 2 }).default("0"),
  // 판매량 추정
  estimatedDailySales: int("estimated_daily_sales").default(0),
  salesScore: int("sales_score").default(0),
  demandScore: int("demand_score").default(0),
  // 경쟁도
  competitionScore: int("competition_score").default(0),
  competitionLevel: varchar("competition_level", { length: 20 }).default("medium"),
  // 파싱 품질
  dataQualityScore: int("data_quality_score").default(0),
  priceParseRate: int("price_parse_rate").default(0),
  ratingParseRate: int("rating_parse_rate").default(0),
  reviewParseRate: int("review_parse_rate").default(0),
  // 상위 상품 스냅샷
  topProductsJson: text("top_products_json"),
  // 타임스탬프
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type ExtKeywordDailyStatus = typeof extKeywordDailyStatus.$inferSelect;
export type InsertExtKeywordDailyStatus = typeof extKeywordDailyStatus.$inferInsert;
