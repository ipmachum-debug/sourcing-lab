import { boolean, decimal, int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

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
  // v8.0: 셀러라이프 수준 시장 데이터
  totalProductCount: int("total_product_count").default(0),    // 쿠팡 검색 총 상품수 (헤더)
  minPrice: int("min_price").default(0),
  maxPrice: int("max_price").default(0),
  medianPrice: int("median_price").default(0),
  totalReviewSum: int("total_review_sum").default(0),          // 리뷰 합계
  maxReviewCount: int("max_review_count").default(0),          // 최대 리뷰 상품
  minReviewCount: int("min_review_count").default(0),          // 최소 리뷰 (>0)
  avgRatingAll: decimal("avg_rating_all", { precision: 3, scale: 2 }).default("0"),
  rocketCount: int("rocket_count").default(0),                 // 로켓배송
  sellerRocketCount: int("seller_rocket_count").default(0),    // 판매자로켓
  globalRocketCount: int("global_rocket_count").default(0),    // 로켓직구
  normalDeliveryCount: int("normal_delivery_count").default(0),// 일반국내배송
  overseasDeliveryCount: int("overseas_delivery_count").default(0), // 해외직구
  priceDistributionJson: json("price_distribution_json"),      // 가격 분포
  reviewDistributionJson: json("review_distribution_json"),    // 리뷰 분포
  highReviewCount: int("high_review_count").default(0),        // 리뷰100+ 상품 수
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
});

export type ExtSearchSnapshot = typeof extSearchSnapshots.$inferSelect;
export type InsertExtSearchSnapshot = typeof extSearchSnapshots.$inferInsert;

// ==================== 검색량 월별 히스토리 (keyword_search_volume_history) ====================
export const keywordSearchVolumeHistory = mysqlTable("keyword_search_volume_history", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  keyword: varchar("keyword", { length: 255 }).notNull(),
  source: mysqlEnum("source", ["naver", "coupang_ads", "estimated"]).default("naver").notNull(),
  yearMonth: varchar("year_month", { length: 7 }).notNull(),   // YYYY-MM
  pcSearch: int("pc_search").default(0),
  mobileSearch: int("mobile_search").default(0),
  totalSearch: int("total_search").default(0),
  competitionIndex: varchar("competition_index", { length: 20 }),
  avgCpc: decimal("avg_cpc", { precision: 12, scale: 2 }).default("0"),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
});

export type KeywordSearchVolumeHistory = typeof keywordSearchVolumeHistory.$inferSelect;
export type InsertKeywordSearchVolumeHistory = typeof keywordSearchVolumeHistory.$inferInsert;

// ==================== 쿠팡 애즈 CPC 캐시 (keyword_cpc_cache) ====================
export const keywordCpcCache = mysqlTable("keyword_cpc_cache", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  keyword: varchar("keyword", { length: 255 }).notNull(),
  categoryId: varchar("category_id", { length: 50 }),
  categoryName: varchar("category_name", { length: 255 }),
  suggestedBid: int("suggested_bid").default(0),               // 추천 입찰가
  minBid: int("min_bid").default(0),
  maxBid: int("max_bid").default(0),
  estimatedImpressions: int("estimated_impressions").default(0),
  estimatedClicks: int("estimated_clicks").default(0),
  estimatedCtr: decimal("estimated_ctr", { precision: 6, scale: 4 }).default("0"),
  competitionLevel: varchar("competition_level", { length: 20 }),
  collectedAt: timestamp("collected_at", tsOpts).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", tsOpts).notNull(),
});

export type KeywordCpcCache = typeof keywordCpcCache.$inferSelect;
export type InsertKeywordCpcCache = typeof keywordCpcCache.$inferInsert;

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
  // ★ v7.6.0: 정규화 + 판매추정 + 이동평균 (단일 truth 테이블)
  baseProductCount: int("base_product_count").default(0),             // 기준 상품수 (P70)
  normalizedReviewSum: int("normalized_review_sum").default(0),       // 상품수 보정 리뷰합
  coverageRatio: decimal("coverage_ratio", { precision: 6, scale: 4 }).default("0"),
  reviewDeltaObserved: int("review_delta_observed").default(0),       // 원시 관측 delta
  reviewDeltaUsed: int("review_delta_used").default(0),               // 실제 사용된 delta
  salesEstimateMa7: int("sales_estimate_ma7").default(0),             // 7일 이동평균 판매추정
  salesEstimateMa30: int("sales_estimate_ma30").default(0),           // 30일 이동평균 판매추정
  isProvisional: boolean("is_provisional").default(false),            // 임시 보간값 여부
  isFinalized: boolean("is_finalized").default(false),                // 확정값 여부
  provisionalReason: varchar("provisional_reason", { length: 50 }),   // provisional 사유
  dataStatus: varchar("data_status", { length: 30 }).default("raw_valid"), // raw_valid/interpolated/provisional/anomaly/missing
  spikeRatio: decimal("spike_ratio", { precision: 8, scale: 2 }).default("0"),
  spikeLevel: varchar("spike_level", { length: 20 }).default("normal"), // normal/rising/surging/explosive
  anchorPrevDate: varchar("anchor_prev_date", { length: 10 }),        // 이전 정상 앵커 날짜
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
  // 적응형 수집 스케줄러 (v7.3.4)
  nextCollectAt: timestamp("next_collect_at", tsOpts),
  adaptiveIntervalHours: int("adaptive_interval_hours"),
  volatilityScore: int("volatility_score").notNull().default(0),
  priorityScore: int("priority_score").default(0),
  // 핀(고정) 키워드 — 배치 수집 시 최우선 수집 대상
  isPinned: boolean("is_pinned").notNull().default(false),
  pinOrder: int("pin_order").notNull().default(0),
  // 라운드로빈 그룹 번호 (id % GROUP_COUNT로 자동 배정)
  groupNo: int("group_no").notNull().default(0),
  // 키워드 마스터 연결 + 감시 상태
  keywordMasterId: int("keyword_master_id"),
  watchReason: varchar("watch_reason", { length: 100 }),
  watchStatus: mysqlEnum("watch_status", [
    "watching", "promoted", "expired", "paused",
  ]).default("watching").notNull(),
  // 타임스탬프
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type ExtWatchKeyword = typeof extWatchKeywords.$inferSelect;
export type InsertExtWatchKeyword = typeof extWatchKeywords.$inferInsert;

// ==================== [DEPRECATED 2026-03-15] Extension: 키워드 일별 상태 (ext_keyword_daily_status) ====================
// ⚠ 구 sum-diff 방식 (393배 오차). ext_keyword_daily_stats가 단일 진실 테이블.
// batchCollector.ts의 deprecated 함수에서만 사용됨.
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
  // ★ v7.5.0: 상품수 정규화 + 음수 보정 + 이동평균
  baseProductCount: int("base_product_count").default(0),
  normalizedReviewSum: int("normalized_review_sum").default(0),
  coverageRatio: decimal("coverage_ratio", { precision: 6, scale: 4 }).default("0"),
  reviewDeltaObserved: int("review_delta_observed").default(0),
  reviewDeltaUsed: int("review_delta_used").default(0),
  salesEstimateMa7: int("sales_estimate_ma7").default(0),
  salesEstimateMa30: int("sales_estimate_ma30").default(0),
  isProvisional: boolean("is_provisional").default(false),
  provisionalReason: varchar("provisional_reason", { length: 50 }),
  dataStatus: varchar("data_status", { length: 30 }).default("raw_valid"),
  // 타임스탬프
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type ExtKeywordDailyStatus = typeof extKeywordDailyStatus.$inferSelect;
export type InsertExtKeywordDailyStatus = typeof extKeywordDailyStatus.$inferInsert;

// ==================== [DEPRECATED 2026-03-15] Extension: 키워드 메트릭 (ext_keyword_metrics) ====================
// ⚠ 미사용 (0행). ext_keyword_daily_stats에서 직접 MA/spike 처리.
export const extKeywordMetrics = mysqlTable("ext_keyword_metrics", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  keyword: varchar("keyword", { length: 255 }).notNull(),
  metricDate: varchar("metric_date", { length: 10 }).notNull(), // YYYY-MM-DD
  // 리뷰 델타
  reviewDelta: int("review_delta").notNull().default(0),
  reviewDeltaEma7: decimal("review_delta_ema7", { precision: 14, scale: 4 }).default("0"),
  reviewDeltaEma30: decimal("review_delta_ema30", { precision: 14, scale: 4 }).default("0"),
  // 판매 추정
  salesEstimate: int("sales_estimate").notNull().default(0),
  salesEstimateEma7: decimal("sales_estimate_ema7", { precision: 14, scale: 4 }).default("0"),
  salesEstimateEma30: decimal("sales_estimate_ema30", { precision: 14, scale: 4 }).default("0"),
  // 비율 지표
  adRatio: decimal("ad_ratio", { precision: 8, scale: 4 }).default("0"),
  newProductRatio: decimal("new_product_ratio", { precision: 8, scale: 4 }).default("0"),
  priceSpread: int("price_spread").default(0),
  // 급등 탐지
  rollingMean30: decimal("rolling_mean_30", { precision: 14, scale: 4 }).default("0"),
  rollingStd30: decimal("rolling_std_30", { precision: 14, scale: 4 }).default("0"),
  spikeScore: decimal("spike_score", { precision: 14, scale: 4 }).default("0"),
  alertLevel: mysqlEnum("alert_level", ["normal", "spike", "explosion"]).default("normal").notNull(),
  // 타임스탬프
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type ExtKeywordMetric = typeof extKeywordMetrics.$inferSelect;
export type InsertExtKeywordMetric = typeof extKeywordMetrics.$inferInsert;

// ==================== [DEPRECATED 2026-03-15] Extension: 키워드 알림 (ext_keyword_alerts) ====================
// ⚠ 미사용 (0행). ext_keyword_daily_stats.spike_level에서 직접 처리.
export const extKeywordAlerts = mysqlTable("ext_keyword_alerts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  keyword: varchar("keyword", { length: 255 }).notNull(),
  alertDate: varchar("alert_date", { length: 10 }).notNull(), // YYYY-MM-DD
  alertType: mysqlEnum("alert_type", [
    "sales_spike", "sales_explosion", "price_drop", "competition_jump",
  ]).notNull(),
  alertScore: decimal("alert_score", { precision: 14, scale: 4 }).default("0"),
  message: varchar("message", { length: 500 }),
  isRead: boolean("is_read").default(false).notNull(),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
});

export type ExtKeywordAlert = typeof extKeywordAlerts.$inferSelect;
export type InsertExtKeywordAlert = typeof extKeywordAlerts.$inferInsert;

// ==================== 마진 계산 이력 (margin_calc_history) ====================
// 마진 계산기에서 저장한 계산 이력
export const marginCalcHistory = mysqlTable("margin_calc_history", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  itemName: varchar("item_name", { length: 200 }).default("").notNull(),
  // 입력값
  sellingPrice: int("selling_price").notNull(),           // 판매가
  costPrice: int("cost_price").notNull(),                 // 원가
  feeRate: decimal("fee_rate", { precision: 5, scale: 2 }).notNull(), // 판매수수료율 %
  fulfillmentFee: int("fulfillment_fee").notNull(),       // 입출고비 (VAT 별도)
  shippingFee: int("shipping_fee").notNull(),             // 배송비 (VAT 별도)
  expectedSales: int("expected_sales").notNull().default(100), // 예상판매량
  returnRate: decimal("return_rate", { precision: 5, scale: 2 }).notNull().default("0"), // 반품률 %
  returnCollectionFee: int("return_collection_fee").notNull().default(0), // 반품회수비
  // 계산 결과 스냅샷
  fulfillmentVat: int("fulfillment_vat").notNull(),       // 입출고비용 VAT
  salesCommission: int("sales_commission").notNull(),     // 판매수수료
  salesCommissionVat: int("sales_commission_vat").notNull(), // 판매수수료 VAT
  vat: int("vat").notNull(),                              // 부가세
  margin: int("margin").notNull(),                        // 마진
  marginRate: decimal("margin_rate", { precision: 5, scale: 2 }).notNull(), // 마진율 %
  minAdRoi: decimal("min_ad_roi", { precision: 7, scale: 2 }).notNull().default("0"), // 최소광고수익률 %
  totalMargin: int("total_margin").notNull().default(0),  // 총마진 (마진 × 예상판매량)
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
});

export type MarginCalcHistory = typeof marginCalcHistory.$inferSelect;
export type InsertMarginCalcHistory = typeof marginCalcHistory.$inferInsert;

// ==================== 키워드 마스터 (keyword_master) ====================
// 모든 키워드 풀의 메인 테이블: 네이버/쿠팡/수동 소스 통합
export const keywordMaster = mysqlTable("keyword_master", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  keyword: varchar("keyword", { length: 255 }).notNull(),
  normalizedKeyword: varchar("normalized_keyword", { length: 255 }).notNull(),
  sourceType: mysqlEnum("source_type", [
    "naver_api", "coupang_autocomplete", "manual", "china", "extension",
  ]).default("manual").notNull(),
  rootKeyword: varchar("root_keyword", { length: 255 }),
  keywordDepth: int("keyword_depth").default(0),
  categoryHint: varchar("category_hint", { length: 100 }),
  validationStatus: mysqlEnum("validation_status", [
    "pending", "validated", "rejected", "recommended",
  ]).default("pending").notNull(),
  canonicalKeyword: varchar("canonical_keyword", { length: 255 }),
  validationPriority: int("validation_priority").default(50).notNull(),
  lastValidatedAt: timestamp("last_validated_at", tsOpts),
  recommendedExpiresAt: timestamp("recommended_expires_at", tsOpts),
  isActive: boolean("is_active").default(true).notNull(),
  firstSeenAt: timestamp("first_seen_at", tsOpts).defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at", tsOpts).defaultNow().notNull(),
});

export type KeywordMaster = typeof keywordMaster.$inferSelect;
export type InsertKeywordMaster = typeof keywordMaster.$inferInsert;

// ==================== 키워드 일별 지표 (keyword_daily_metrics) ====================
// 네이버 검색량 + 쿠팡 상품/리뷰/가격 + 점수 통합 일별 스냅샷
export const keywordDailyMetrics = mysqlTable("keyword_daily_metrics", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  keywordId: int("keyword_id").notNull(),
  metricDate: varchar("metric_date", { length: 10 }).notNull(), // YYYY-MM-DD
  // 네이버 광고 데이터
  naverPcSearch: int("naver_pc_search").default(0),
  naverMobileSearch: int("naver_mobile_search").default(0),
  naverTotalSearch: int("naver_total_search").default(0),
  naverAvgCpc: decimal("naver_avg_cpc", { precision: 12, scale: 2 }).default("0"),
  naverCompetitionIndex: varchar("naver_competition_index", { length: 20 }), // LOW/MID/HIGH
  // 쿠팡 데이터
  coupangProductCount: int("coupang_product_count").default(0),
  coupangSellerCount: int("coupang_seller_count").default(0),
  coupangAvgPrice: int("coupang_avg_price").default(0),
  coupangMedianPrice: int("coupang_median_price").default(0),
  coupangTop10ReviewSum: int("coupang_top10_review_sum").default(0),
  coupangTop10ReviewDelta: int("coupang_top10_review_delta").default(0),
  coupangNewProduct30d: int("coupang_new_product_30d").default(0),
  coupangNewProductReview30d: int("coupang_new_product_review_30d").default(0),
  coupangOutOfStockCount: int("coupang_out_of_stock_count").default(0),
  // 점수
  marketGapScore: decimal("market_gap_score", { precision: 10, scale: 4 }).default("0"),
  trendScore: decimal("trend_score", { precision: 10, scale: 4 }).default("0"),
  hiddenScore: decimal("hidden_score", { precision: 10, scale: 4 }).default("0"),
  sourcingScore: decimal("sourcing_score", { precision: 10, scale: 4 }).default("0"),
  finalScore: decimal("final_score", { precision: 10, scale: 4 }).default("0"),
  coupangBaseScore: decimal("coupang_base_score", { precision: 10, scale: 4 }).default("0"),
  naverValidationScore: decimal("naver_validation_score", { precision: 10, scale: 4 }).default("0"),
  validationPassed: boolean("validation_passed"),
  rejectReason: varchar("reject_reason", { length: 100 }),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
});

export type KeywordDailyMetric = typeof keywordDailyMetrics.$inferSelect;
export type InsertKeywordDailyMetric = typeof keywordDailyMetrics.$inferInsert;

// ==================== 키워드 확장 관계 (keyword_relation) ====================
export const keywordRelation = mysqlTable("keyword_relation", {
  id: int("id").autoincrement().primaryKey(),
  parentKeywordId: int("parent_keyword_id").notNull(),
  childKeywordId: int("child_keyword_id").notNull(),
  relationType: mysqlEnum("relation_type", [
    "related", "autocomplete", "attribute_expand", "recursive",
  ]).notNull(),
  weight: decimal("weight", { precision: 10, scale: 4 }).default("0"),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
});

export type KeywordRelation = typeof keywordRelation.$inferSelect;
export type InsertKeywordRelation = typeof keywordRelation.$inferInsert;

// ==================== 키워드 소싱 후보 (keyword_sourcing_candidate) ====================
export const keywordSourcingCandidate = mysqlTable("keyword_sourcing_candidate", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  keywordId: int("keyword_id").notNull(),
  sourcePlatform: mysqlEnum("source_platform", ["1688", "aliexpress", "other"]).default("1688").notNull(),
  sourceKeyword: varchar("source_keyword", { length: 255 }),
  sourceProductName: varchar("source_product_name", { length: 500 }),
  sourcePrice: decimal("source_price", { precision: 12, scale: 2 }).default("0"),
  moq: int("moq").default(0),
  shippingType: varchar("shipping_type", { length: 50 }),
  confidenceScore: decimal("confidence_score", { precision: 10, scale: 4 }).default("0"),
  marginEstimate: decimal("margin_estimate", { precision: 10, scale: 2 }).default("0"),
  memo: text("memo"),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
});

export type KeywordSourcingCandidate = typeof keywordSourcingCandidate.$inferSelect;
export type InsertKeywordSourcingCandidate = typeof keywordSourcingCandidate.$inferInsert;

// ==================== 알리 검증 엔진 (Ali Validation Engine) ====================

// 알리 검색 캐시 — 쿠팡 키워드 → 알리 검색 결과 (TTL 캐시)
export const aliSearchCache = mysqlTable("ali_search_cache", {
  id: int("id").autoincrement().primaryKey(),
  keywordId: int("keyword_id").notNull(),
  searchQuery: varchar("search_query", { length: 255 }).notNull(),
  resultRank: int("result_rank").notNull(),
  productUrl: varchar("product_url", { length: 1000 }).notNull(),
  productTitle: varchar("product_title", { length: 1000 }).notNull(),
  productImageUrl: varchar("product_image_url", { length: 1000 }),
  priceMin: decimal("price_min", { precision: 12, scale: 2 }).default("0"),
  priceMax: decimal("price_max", { precision: 12, scale: 2 }).default("0"),
  orderCount: int("order_count").default(0),
  rating: decimal("rating", { precision: 4, scale: 2 }).default("0"),
  shippingSummary: varchar("shipping_summary", { length: 255 }),
  matchScore: decimal("match_score", { precision: 10, scale: 4 }).default("0"),
  titleMatchScore: decimal("title_match_score", { precision: 10, scale: 4 }).default("0"),
  attributeMatchScore: decimal("attribute_match_score", { precision: 10, scale: 4 }).default("0"),
  priceFitScore: decimal("price_fit_score", { precision: 10, scale: 4 }).default("0"),
  orderSignalScore: decimal("order_signal_score", { precision: 10, scale: 4 }).default("0"),
  shippingFitScore: decimal("shipping_fit_score", { precision: 10, scale: 4 }).default("0"),
  collectedAt: timestamp("collected_at", tsOpts).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", tsOpts).notNull(),
});

export type AliSearchCache = typeof aliSearchCache.$inferSelect;
export type InsertAliSearchCache = typeof aliSearchCache.$inferInsert;

// 알리 상품 캐시 — 확장프로그램에서 수집한 알리 상품 (역방향 매칭용)
export const aliProductCache = mysqlTable("ali_product_cache", {
  id: int("id").autoincrement().primaryKey(),
  aliProductId: varchar("ali_product_id", { length: 100 }),
  productUrl: varchar("product_url", { length: 1000 }).notNull(),
  title: varchar("title", { length: 1000 }).notNull(),
  titleKo: varchar("title_ko", { length: 1000 }),
  priceMin: decimal("price_min", { precision: 12, scale: 2 }).default("0"),
  priceMax: decimal("price_max", { precision: 12, scale: 2 }).default("0"),
  orderCount: int("order_count").default(0),
  rating: decimal("rating", { precision: 4, scale: 2 }).default("0"),
  categoryText: varchar("category_text", { length: 255 }),
  attributesJson: json("attributes_json"),
  imageUrl: varchar("image_url", { length: 1000 }),
  sourceType: mysqlEnum("source_type", ["page", "search", "extension"]).default("page").notNull(),
  collectedAt: timestamp("collected_at", tsOpts).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", tsOpts),
});

export type AliProductCache = typeof aliProductCache.$inferSelect;
export type InsertAliProductCache = typeof aliProductCache.$inferInsert;

// 알리→쿠팡 키워드 역방향 매칭 후보
export const aliKeywordMatchCandidate = mysqlTable("ali_keyword_match_candidate", {
  id: int("id").autoincrement().primaryKey(),
  aliCacheId: int("ali_cache_id").notNull(),
  keywordId: int("keyword_id").notNull(),
  keywordSimilarityScore: decimal("keyword_similarity_score", { precision: 10, scale: 4 }).default("0"),
  attributeOverlapScore: decimal("attribute_overlap_score", { precision: 10, scale: 4 }).default("0"),
  priceFitScore: decimal("price_fit_score", { precision: 10, scale: 4 }).default("0"),
  categoryFitScore: decimal("category_fit_score", { precision: 10, scale: 4 }).default("0"),
  marketFitScore: decimal("market_fit_score", { precision: 10, scale: 4 }).default("0"),
  finalMatchScore: decimal("final_match_score", { precision: 10, scale: 4 }).default("0"),
  isSelected: boolean("is_selected").default(false),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
});

export type AliKeywordMatchCandidate = typeof aliKeywordMatchCandidate.$inferSelect;
export type InsertAliKeywordMatchCandidate = typeof aliKeywordMatchCandidate.$inferInsert;

// 쿠팡 키워드 ↔ 알리 상품 매핑 (운영자 선택, 영구 저장)
export const keywordAliMapping = mysqlTable("keyword_ali_mapping", {
  id: int("id").autoincrement().primaryKey(),
  keywordId: int("keyword_id").notNull(),
  aliProductUrl: varchar("ali_product_url", { length: 1000 }).notNull(),
  aliProductId: varchar("ali_product_id", { length: 100 }),
  aliProductTitle: varchar("ali_product_title", { length: 1000 }).notNull(),
  selectedPrice: decimal("selected_price", { precision: 12, scale: 2 }).default("0"),
  selectedShippingFee: decimal("selected_shipping_fee", { precision: 12, scale: 2 }).default("0"),
  selectedTotalCost: decimal("selected_total_cost", { precision: 12, scale: 2 }).default("0"),
  selectedOrderCount: int("selected_order_count").default(0),
  selectedRating: decimal("selected_rating", { precision: 4, scale: 2 }).default("0"),
  matchScore: decimal("match_score", { precision: 10, scale: 4 }).default("0"),
  matchDirection: mysqlEnum("match_direction", ["forward", "reverse"]).default("forward").notNull(),
  isPrimary: boolean("is_primary").default(false),
  mappingStatus: mysqlEnum("mapping_status", ["active", "inactive", "dropped"]).default("active").notNull(),
  trackingEnabled: boolean("tracking_enabled").default(true),
  selectedBy: varchar("selected_by", { length: 100 }),
  selectedReason: varchar("selected_reason", { length: 255 }),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type KeywordAliMapping = typeof keywordAliMapping.$inferSelect;
export type InsertKeywordAliMapping = typeof keywordAliMapping.$inferInsert;

// 알리 매핑 URL 추적 스냅샷 (가격/재고/배송 변화 추적)
export const keywordAliTrackingSnapshot = mysqlTable("keyword_ali_tracking_snapshot", {
  id: int("id").autoincrement().primaryKey(),
  mappingId: int("mapping_id").notNull(),
  snapshotAt: timestamp("snapshot_at", tsOpts).notNull(),
  priceMin: decimal("price_min", { precision: 12, scale: 2 }).default("0"),
  priceMax: decimal("price_max", { precision: 12, scale: 2 }).default("0"),
  shippingFee: decimal("shipping_fee", { precision: 12, scale: 2 }).default("0"),
  totalCost: decimal("total_cost", { precision: 12, scale: 2 }).default("0"),
  orderCount: int("order_count").default(0),
  rating: decimal("rating", { precision: 4, scale: 2 }).default("0"),
  stockText: varchar("stock_text", { length: 255 }),
  deliveryText: varchar("delivery_text", { length: 255 }),
  availabilityStatus: mysqlEnum("availability_status", ["available", "low_stock", "out_of_stock", "unknown"]).default("unknown").notNull(),
  priceChangeRate: decimal("price_change_rate", { precision: 10, scale: 4 }).default("0"),
  orderVelocity: decimal("order_velocity", { precision: 10, scale: 4 }).default("0"),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
});

export type KeywordAliTrackingSnapshot = typeof keywordAliTrackingSnapshot.$inferSelect;
export type InsertKeywordAliTrackingSnapshot = typeof keywordAliTrackingSnapshot.$inferInsert;

// ==================== AI 제품 발견 작업 큐 (ext_discovery_jobs) ====================
// 서버 → 확장프로그램 크롤링 명령 큐
export const extDiscoveryJobs = mysqlTable("ext_discovery_jobs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  keyword: varchar("keyword", { length: 255 }).notNull(),
  status: mysqlEnum("status", [
    "pending",         // 확장 프로그램이 아직 수신 안 함
    "crawling_search", // 검색 결과 크롤링 중
    "filtering",       // 1차 필터링 완료, 상세 크롤링 대기
    "crawling_detail", // 상세 페이지 크롤링 중
    "analyzing",       // AI 분석 중
    "completed",       // 분석 완료
    "failed",          // 실패
  ]).default("pending").notNull(),
  // 크롤링 설정
  maxPages: int("max_pages").default(2),           // 검색 결과 최대 페이지
  maxDetailProducts: int("max_detail_products").default(8), // 상세 크롤링 최대 상품 수
  // 검색 결과 (확장에서 전송)
  searchResultsJson: json("search_results_json"),  // 전체 검색 결과
  searchSummaryJson: json("search_summary_json"),  // 요약 통계
  // 1차 필터링 결과
  filteredProductIds: json("filtered_product_ids"), // 상세 크롤링 대상 ID 배열
  filterCriteria: json("filter_criteria"),          // 적용된 필터 조건
  // 상세 크롤링 결과 (확장에서 전송)
  detailResultsJson: json("detail_results_json"),   // 상세 페이지 데이터
  detailCrawledCount: int("detail_crawled_count").default(0),
  // AI 분석 결과
  aiAnalysisJson: json("ai_analysis_json"),         // AI 분석 전체 결과
  // 메타
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", tsOpts),
  completedAt: timestamp("completed_at", tsOpts),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type ExtDiscoveryJob = typeof extDiscoveryJobs.$inferSelect;
export type InsertExtDiscoveryJob = typeof extDiscoveryJobs.$inferInsert;

// ==================== AI 발견 제품 (ext_discovery_products) ====================
// AI가 분석한 개별 추천 제품 + 유저 판단 (추적/거절)
export const extDiscoveryProducts = mysqlTable("ext_discovery_products", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  jobId: int("job_id").notNull(),               // ext_discovery_jobs FK
  keyword: varchar("keyword", { length: 255 }).notNull(),
  // 제품 기본 정보
  coupangProductId: varchar("coupang_product_id", { length: 50 }).notNull(),
  productTitle: varchar("product_title", { length: 1000 }).notNull(),
  productUrl: text("product_url"),
  imageUrl: text("image_url"),
  price: int("price").default(0),
  originalPrice: int("original_price").default(0),
  rating: decimal("rating", { precision: 3, scale: 1 }).default("0"),
  reviewCount: int("review_count").default(0),
  // 상세 데이터 (크롤링)
  sellerName: varchar("seller_name", { length: 255 }),
  deliveryType: varchar("delivery_type", { length: 50 }),  // rocket, free, standard
  categoryPath: varchar("category_path", { length: 500 }),
  optionCount: int("option_count").default(0),
  detailDataJson: json("detail_data_json"),       // 전체 상세 데이터
  // 검색 순위 정보
  searchRank: int("search_rank").default(0),
  isAd: boolean("is_ad").default(false),
  isRocket: boolean("is_rocket").default(false),
  // AI 분석 결과
  aiScore: int("ai_score").default(0),            // 0~100
  aiGrade: varchar("ai_grade", { length: 2 }),    // S/A/B/C/D
  aiVerdict: mysqlEnum("ai_verdict", ["strong_buy", "buy", "watch", "pass"]).default("watch"),
  aiReasonJson: json("ai_reason_json"),           // 디테일 근거 배열
  aiRiskJson: json("ai_risk_json"),               // 리스크 배열
  aiOpportunityJson: json("ai_opportunity_json"), // 기회 요인 배열
  estimatedMonthlySales: int("estimated_monthly_sales").default(0),
  estimatedMarginPercent: decimal("estimated_margin_percent", { precision: 5, scale: 2 }).default("0"),
  // 유저 판단
  userDecision: mysqlEnum("user_decision", [
    "pending",    // 미결정
    "track",      // 매일 추적
    "reject",     // 거절
  ]).default("pending").notNull(),
  userMemo: text("user_memo"),
  trackingId: int("tracking_id"),                 // ext_product_trackings FK (추적 시)
  decidedAt: timestamp("decided_at", tsOpts),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type ExtDiscoveryProduct = typeof extDiscoveryProducts.$inferSelect;
export type InsertExtDiscoveryProduct = typeof extDiscoveryProducts.$inferInsert;

// ==================== Extension: 배치 수집 상태 (ext_batch_state) ====================
// 유저별 배치 수집 상태 — 라운드로빈 그룹 이월, 일일 수집 카운트 추적
export const extBatchState = mysqlTable("ext_batch_state", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  // 라운드로빈 그룹 턴 (다음 배치에서 우선 처리할 그룹 번호)
  currentGroupTurn: int("current_group_turn").notNull().default(0),
  // 오늘 총 수집 키워드 수
  totalCollectedToday: int("total_collected_today").notNull().default(0),
  // 오늘 배치 실행 횟수
  roundsToday: int("rounds_today").notNull().default(0),
  // 마지막 배치 완료 시각
  lastBatchCompletedAt: timestamp("last_batch_completed_at", tsOpts),
  // 오늘 날짜 (리셋 기준)
  stateDate: varchar("state_date", { length: 10 }).notNull(), // YYYY-MM-DD
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type ExtBatchState = typeof extBatchState.$inferSelect;

// ============================================================
// ==================== Marketing Automation ====================
// ============================================================

// ==================== Marketing: 소셜 계정 연동 (mkt_accounts) ====================
export const mktAccounts = mysqlTable("mkt_accounts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  platform: mysqlEnum("platform", ["instagram", "youtube", "tiktok", "naver_blog", "naver_cafe", "kakao"]).notNull(),
  accountName: varchar("account_name", { length: 255 }).notNull(),
  accountId: varchar("account_id", { length: 255 }), // 플랫폼별 고유 ID
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at", tsOpts),
  meta: json("meta"), // pageId, businessId, channelId 등
  status: mysqlEnum("status", ["active", "expired", "error", "disconnected"]).default("active").notNull(),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type MktAccount = typeof mktAccounts.$inferSelect;
export type InsertMktAccount = typeof mktAccounts.$inferInsert;

// ==================== Marketing: 브랜드 (mkt_brands) ====================
export const mktBrands = mysqlTable("mkt_brands", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  toneOfVoice: mysqlEnum("tone_of_voice", ["casual", "premium", "friendly", "professional", "b2b"]).default("friendly").notNull(),
  keywords: json("keywords"), // string[] — 대표 키워드
  forbiddenWords: json("forbidden_words"), // string[] — 금칙어
  ctaStyle: mysqlEnum("cta_style", ["purchase", "inquiry", "visit", "follow", "custom"]).default("purchase").notNull(),
  logoUrl: text("logo_url"),
  colorPrimary: varchar("color_primary", { length: 7 }), // #hex
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type MktBrand = typeof mktBrands.$inferSelect;
export type InsertMktBrand = typeof mktBrands.$inferInsert;

// ==================== Marketing: 상품/서비스 (mkt_products) ====================
export const mktProducts = mysqlTable("mkt_products", {
  id: int("id").autoincrement().primaryKey(),
  brandId: int("brand_id").notNull(),
  userId: int("user_id").notNull(),
  name: varchar("name", { length: 500 }).notNull(),
  description: text("description"),
  features: json("features"), // string[] — 특징 (쫀득함, 무설탕 등)
  targetAudience: text("target_audience"),
  price: decimal("price", { precision: 12, scale: 0 }),
  landingUrl: text("landing_url"),
  imageUrls: json("image_urls"), // string[]
  category: varchar("category", { length: 100 }),
  seasonality: varchar("seasonality", { length: 100 }), // 봄, 추석, 연중 등
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type MktProduct = typeof mktProducts.$inferSelect;
export type InsertMktProduct = typeof mktProducts.$inferInsert;

// ==================== Marketing: 캠페인 (mkt_campaigns) ====================
export const mktCampaigns = mysqlTable("mkt_campaigns", {
  id: int("id").autoincrement().primaryKey(),
  brandId: int("brand_id").notNull(),
  userId: int("user_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  goal: mysqlEnum("goal", ["sales", "inquiry", "followers", "launch", "awareness", "engagement"]).default("sales").notNull(),
  startDate: varchar("start_date", { length: 10 }), // YYYY-MM-DD
  endDate: varchar("end_date", { length: 10 }),
  status: mysqlEnum("status", ["draft", "active", "paused", "completed"]).default("draft").notNull(),
  memo: text("memo"),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type MktCampaign = typeof mktCampaigns.$inferSelect;
export type InsertMktCampaign = typeof mktCampaigns.$inferInsert;

// ==================== Marketing: 콘텐츠 원본 (mkt_content_items) ====================
export const mktContentItems = mysqlTable("mkt_content_items", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaign_id"),
  productId: int("product_id"),
  userId: int("user_id").notNull(),
  sourceType: mysqlEnum("source_type", ["product", "event", "manual", "ai_generated"]).default("ai_generated").notNull(),
  masterTitle: varchar("master_title", { length: 500 }),
  masterHook: text("master_hook"), // 훅 문구
  masterBody: text("master_body"), // 본문
  hashtags: json("hashtags"), // string[]
  script: text("script"), // 영상 대본
  imagePrompt: text("image_prompt"), // AI 이미지 생성용
  videoPrompt: text("video_prompt"), // AI 영상 생성용
  status: mysqlEnum("status", ["draft", "approved", "scheduled", "published", "failed", "archived"]).default("draft").notNull(),
  aiScore: int("ai_score"), // AI 품질 점수 (0-100)
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type MktContentItem = typeof mktContentItems.$inferSelect;
export type InsertMktContentItem = typeof mktContentItems.$inferInsert;

// ==================== Marketing: 채널별 발행 (mkt_channel_posts) ====================
export const mktChannelPosts = mysqlTable("mkt_channel_posts", {
  id: int("id").autoincrement().primaryKey(),
  contentItemId: int("content_item_id").notNull(),
  accountId: int("account_id"), // mkt_accounts.id
  userId: int("user_id").notNull(),
  platform: mysqlEnum("platform", ["instagram", "youtube", "tiktok", "naver_blog", "naver_cafe", "kakao"]).notNull(),
  title: varchar("title", { length: 500 }),
  caption: text("caption"),
  description: text("description"),
  hashtags: json("hashtags"), // string[]
  mediaPaths: json("media_paths"), // string[] — 업로드할 미디어 경로
  scheduledAt: timestamp("scheduled_at", tsOpts),
  publishedAt: timestamp("published_at", tsOpts),
  remotePostId: varchar("remote_post_id", { length: 255 }), // 플랫폼에서 받은 게시물 ID
  remotePostUrl: text("remote_post_url"),
  publishStatus: mysqlEnum("publish_status", ["queued", "publishing", "published", "failed", "cancelled"]).default("queued").notNull(),
  errorMessage: text("error_message"),
  retryCount: int("retry_count").default(0).notNull(),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type MktChannelPost = typeof mktChannelPosts.$inferSelect;
export type InsertMktChannelPost = typeof mktChannelPosts.$inferInsert;

// ==================== Marketing: 성과 스냅샷 (mkt_analytics) ====================
export const mktAnalytics = mysqlTable("mkt_analytics", {
  id: int("id").autoincrement().primaryKey(),
  channelPostId: int("channel_post_id").notNull(),
  platform: mysqlEnum("platform", ["instagram", "youtube", "tiktok", "naver_blog", "naver_cafe", "kakao"]).notNull(),
  views: int("views").default(0).notNull(),
  likes: int("likes").default(0).notNull(),
  comments: int("comments").default(0).notNull(),
  shares: int("shares").default(0).notNull(),
  clicks: int("clicks").default(0).notNull(),
  conversions: int("conversions").default(0).notNull(),
  reach: int("reach").default(0),
  impressions: int("impressions").default(0),
  ctr: decimal("ctr", { precision: 5, scale: 2 }), // Click-through rate %
  capturedAt: timestamp("captured_at", tsOpts).defaultNow().notNull(),
});

export type MktAnalytic = typeof mktAnalytics.$inferSelect;
export type InsertMktAnalytic = typeof mktAnalytics.$inferInsert;

// ==================== Marketing: AI 학습 피드백 (mkt_ai_feedback) ====================
export const mktAiFeedback = mysqlTable("mkt_ai_feedback", {
  id: int("id").autoincrement().primaryKey(),
  contentItemId: int("content_item_id").notNull(),
  userId: int("user_id").notNull(),
  platform: mysqlEnum("platform", ["instagram", "youtube", "tiktok", "naver_blog", "naver_cafe", "kakao"]).notNull(),
  score: int("score"), // 1-10 성과 점수
  reason: text("reason"), // AI 분석 이유
  bestHook: text("best_hook"), // 잘 먹힌 훅
  badPattern: text("bad_pattern"), // 실패 패턴
  recommendedAction: text("recommended_action"), // 다음 추천 액션
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
});

export type MktAiFeedback = typeof mktAiFeedback.$inferSelect;
export type InsertMktAiFeedback = typeof mktAiFeedback.$inferInsert;

// ==================== Marketing: AI 브리핑 (mkt_briefings) ====================
export const mktBriefings = mysqlTable("mkt_briefings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  briefingDate: varchar("briefing_date", { length: 10 }).notNull(), // YYYY-MM-DD
  summary: text("summary").notNull(), // AI 요약 텍스트
  actionItems: json("action_items"), // { type, title, description, priority, link }[]
  alerts: json("alerts"), // { level, message, productId? }[]
  recommendations: json("recommendations"), // { type, content, reason }[]
  isRead: boolean("is_read").default(false).notNull(),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
});

export type MktBriefing = typeof mktBriefings.$inferSelect;
export type InsertMktBriefing = typeof mktBriefings.$inferInsert;

// ==================== Marketing: 예약 발행 규칙 (mkt_schedule_rules) ====================
export const mktScheduleRules = mysqlTable("mkt_schedule_rules", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  brandId: int("brand_id"),
  name: varchar("name", { length: 255 }).notNull(),
  platform: mysqlEnum("platform", ["instagram", "youtube", "tiktok", "naver_blog", "naver_cafe", "kakao"]).notNull(),
  frequency: mysqlEnum("frequency", ["daily", "weekdays", "weekly", "biweekly", "monthly", "custom"]).default("daily").notNull(),
  preferredTimes: json("preferred_times"), // string[] — ["09:00", "12:00", "18:00"]
  maxPostsPerDay: int("max_posts_per_day").default(3).notNull(),
  autoApprove: boolean("auto_approve").default(false).notNull(), // 자동 승인 모드
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type MktScheduleRule = typeof mktScheduleRules.$inferSelect;
export type InsertMktScheduleRule = typeof mktScheduleRules.$inferInsert;

// ==================== Marketing: 클라이언트/고객사 (mkt_clients) ====================
// 에이전시 모드 — 여러 고객사를 관리
export const mktClients = mysqlTable("mkt_clients", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(), // 에이전시 운영자
  name: varchar("name", { length: 255 }).notNull(),
  contactName: varchar("contact_name", { length: 100 }), // 담당자명
  contactEmail: varchar("contact_email", { length: 320 }),
  contactPhone: varchar("contact_phone", { length: 20 }),
  industry: varchar("industry", { length: 100 }), // 업종
  monthlyBudget: decimal("monthly_budget", { precision: 12, scale: 0 }),
  contractStart: varchar("contract_start", { length: 10 }), // YYYY-MM-DD
  contractEnd: varchar("contract_end", { length: 10 }),
  status: mysqlEnum("status", ["active", "paused", "completed", "prospect"]).default("active").notNull(),
  memo: text("memo"),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type MktClient = typeof mktClients.$inferSelect;
export type InsertMktClient = typeof mktClients.$inferInsert;

// ==================== Marketing: 미디어 라이브러리 (mkt_media_assets) ====================
export const mktMediaAssets = mysqlTable("mkt_media_assets", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  brandId: int("brand_id"),
  clientId: int("client_id"),
  name: varchar("name", { length: 255 }).notNull(),
  type: mysqlEnum("type", ["image", "video", "template", "document", "audio"]).notNull(),
  url: text("url").notNull(), // 파일 경로 or URL
  thumbnailUrl: text("thumbnail_url"),
  mimeType: varchar("mime_type", { length: 100 }),
  fileSize: int("file_size"), // bytes
  width: int("width"),
  height: int("height"),
  duration: int("duration"), // 영상 길이 (초)
  tags: json("tags"), // string[] — 검색용 태그
  folder: varchar("folder", { length: 255 }), // 폴더 분류
  usageCount: int("usage_count").default(0).notNull(), // 사용 횟수
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
});

export type MktMediaAsset = typeof mktMediaAssets.$inferSelect;
export type InsertMktMediaAsset = typeof mktMediaAssets.$inferInsert;

// ==================== Marketing: 콘텐츠 캘린더 (mkt_calendar_events) ====================
export const mktCalendarEvents = mysqlTable("mkt_calendar_events", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  brandId: int("brand_id"),
  clientId: int("client_id"),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  eventDate: varchar("event_date", { length: 10 }).notNull(), // YYYY-MM-DD
  eventTime: varchar("event_time", { length: 5 }), // HH:mm
  type: mysqlEnum("type", [
    "post", "story", "reel", "shorts", "live", "blog",
    "meeting", "deadline", "holiday", "promotion", "memo",
  ]).default("post").notNull(),
  platform: mysqlEnum("platform", ["instagram", "youtube", "tiktok", "naver_blog", "naver_cafe", "kakao", "all"]),
  contentItemId: int("content_item_id"), // 연결된 콘텐츠
  channelPostId: int("channel_post_id"), // 연결된 발행
  color: varchar("color", { length: 7 }), // #hex 캘린더 색상
  status: mysqlEnum("status", ["planned", "in_progress", "done", "cancelled"]).default("planned").notNull(),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type MktCalendarEvent = typeof mktCalendarEvents.$inferSelect;
export type InsertMktCalendarEvent = typeof mktCalendarEvents.$inferInsert;

// ==================== Marketing: A/B 테스트 (mkt_ab_tests) ====================
export const mktAbTests = mysqlTable("mkt_ab_tests", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  campaignId: int("campaign_id"),
  name: varchar("name", { length: 255 }).notNull(),
  platform: mysqlEnum("platform", ["instagram", "youtube", "tiktok", "naver_blog", "naver_cafe", "kakao"]).notNull(),
  variantA: json("variant_a"), // { title, caption, hashtags, mediaUrl }
  variantB: json("variant_b"),
  variantAPostId: int("variant_a_post_id"), // mkt_channel_posts.id
  variantBPostId: int("variant_b_post_id"),
  winnerVariant: mysqlEnum("winner_variant", ["a", "b"]),
  winnerMetric: mysqlEnum("winner_metric", ["views", "likes", "clicks", "conversions", "ctr"]).default("clicks").notNull(),
  testDurationHours: int("test_duration_hours").default(48).notNull(),
  autoExpandWinner: boolean("auto_expand_winner").default(false).notNull(), // 승자 자동 확산
  status: mysqlEnum("status", ["draft", "running", "completed", "cancelled"]).default("draft").notNull(),
  startedAt: timestamp("started_at", tsOpts),
  completedAt: timestamp("completed_at", tsOpts),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
});

export type MktAbTest = typeof mktAbTests.$inferSelect;
export type InsertMktAbTest = typeof mktAbTests.$inferInsert;

// ==================== Marketing: 성과 리포트 (mkt_reports) ====================
export const mktReports = mysqlTable("mkt_reports", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  clientId: int("client_id"),
  brandId: int("brand_id"),
  title: varchar("title", { length: 255 }).notNull(),
  periodStart: varchar("period_start", { length: 10 }).notNull(),
  periodEnd: varchar("period_end", { length: 10 }).notNull(),
  summary: text("summary"), // AI 생성 요약
  highlights: json("highlights"), // { metric, value, change, comment }[]
  platformBreakdown: json("platform_breakdown"), // 플랫폼별 성과
  topContent: json("top_content"), // 베스트 콘텐츠 목록
  recommendations: json("recommendations"), // AI 추천
  status: mysqlEnum("status", ["draft", "finalized", "sent"]).default("draft").notNull(),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
});

export type MktReport = typeof mktReports.$inferSelect;
export type InsertMktReport = typeof mktReports.$inferInsert;

// ==================== Marketing: 베스트 카피 라이브러리 (mkt_copy_library) ====================
export const mktCopyLibrary = mysqlTable("mkt_copy_library", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  brandId: int("brand_id"),
  sourceContentId: int("source_content_id"), // 원본 콘텐츠 ID
  category: mysqlEnum("category", ["hook", "caption", "cta", "hashtag_set", "script", "title", "description"]).notNull(),
  platform: mysqlEnum("platform", ["instagram", "youtube", "tiktok", "naver_blog", "naver_cafe", "kakao", "all"]),
  text: text("text").notNull(),
  performanceScore: int("performance_score"), // 성과 점수
  tags: json("tags"), // string[]
  usageCount: int("usage_count").default(0).notNull(),
  isFavorite: boolean("is_favorite").default(false).notNull(),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
});

export type MktCopyLibraryItem = typeof mktCopyLibrary.$inferSelect;
export type InsertMktCopyLibraryItem = typeof mktCopyLibrary.$inferInsert;

// ==================== Marketing: 경쟁사 모니터링 (mkt_competitors) ====================
export const mktCompetitors = mysqlTable("mkt_competitors", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  brandId: int("brand_id"),
  name: varchar("name", { length: 255 }).notNull(),
  platform: mysqlEnum("platform", ["instagram", "youtube", "tiktok", "naver_blog", "naver_cafe", "kakao"]).notNull(),
  accountUrl: text("account_url"), // 경쟁사 채널 URL
  accountHandle: varchar("account_handle", { length: 255 }), // @핸들
  followers: int("followers"),
  avgLikes: int("avg_likes"),
  avgComments: int("avg_comments"),
  postingFrequency: varchar("posting_frequency", { length: 50 }), // "하루 2회" 등
  strengths: text("strengths"), // AI 분석 강점
  weaknesses: text("weaknesses"), // AI 분석 약점
  lastCheckedAt: timestamp("last_checked_at", tsOpts),
  createdAt: timestamp("created_at", tsOpts).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", tsOpts).defaultNow().onUpdateNow().notNull(),
});

export type MktCompetitor = typeof mktCompetitors.$inferSelect;
export type InsertMktCompetitor = typeof mktCompetitors.$inferInsert;
