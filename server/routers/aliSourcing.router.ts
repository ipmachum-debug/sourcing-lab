import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  aliSearchCache,
  keywordAliMapping,
  keywordAliTrackingSnapshot,
  keywordMaster,
  keywordDailyMetrics,
  extWatchKeywords,
} from "../../drizzle/schema";
import { and, desc, eq, like, sql, inArray, asc, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

// ===== 영어↔한국어 속성 사전 (확장판) =====
const EN_TO_KO: Record<string, string> = {
  // 가전/전자
  "vacuum cleaner": "청소기", "air purifier": "공기청정기",
  "humidifier": "가습기", "dehumidifier": "제습기",
  "wireless": "무선", "bluetooth": "블루투스", "charger": "충전기",
  "cable": "케이블", "earphone": "이어폰", "headphone": "헤드폰",
  "speaker": "스피커", "mouse": "마우스", "keyboard": "키보드",
  "power bank": "보조배터리", "phone case": "케이스", "phone stand": "거치대",
  "adapter": "어댑터", "converter": "변환기", "router": "라우터",
  "camera": "카메라", "tripod": "삼각대", "drone": "드론",
  "projector": "프로젝터", "monitor": "모니터", "tablet": "태블릿",
  "smart watch": "스마트워치", "fitness tracker": "피트니스트래커",
  "robot vacuum": "로봇청소기", "handheld vacuum": "핸디청소기",
  "car vacuum": "차량용 청소기", "mini vacuum": "미니청소기",
  "portable fan": "휴대용 선풍기", "desk fan": "탁상 선풍기",
  "led light": "LED 조명", "desk lamp": "탁상 램프",
  "night light": "수면등", "ring light": "링라이트",
  // 주방
  "kitchen": "주방", "cooking": "요리", "pot": "냄비", "pan": "프라이팬",
  "frying pan": "프라이팬", "knife": "칼", "scissors": "가위",
  "cup": "컵", "mug": "머그컵", "tumbler": "텀블러",
  "water bottle": "물병", "thermos": "보온병",
  "spoon": "숟가락", "fork": "포크", "chopsticks": "젓가락",
  "plate": "접시", "bowl": "그릇", "lunch box": "도시락",
  "cutting board": "도마", "peeler": "필러", "grater": "강판",
  "blender": "블렌더", "mixer": "믹서", "juicer": "착즙기",
  "coffee maker": "커피메이커", "kettle": "주전자",
  "food container": "밀폐용기", "storage container": "수납함",
  "ice tray": "얼음틀", "silicone mold": "실리콘몰드",
  // 수납/정리
  "storage": "수납", "organizer": "정리함", "shelf": "선반",
  "rack": "거치대", "drawer": "서랍", "basket": "바구니",
  "box": "박스", "container": "용기", "case": "케이스",
  "bag": "가방", "pouch": "파우치",
  // 욕실/청소
  "cleaning": "청소", "mop": "걸레", "brush": "솔", "sponge": "스펀지",
  "towel": "수건", "bath towel": "목욕수건",
  "soap dispenser": "비누디스펜서", "shower head": "샤워헤드",
  "toothbrush": "칫솔", "tooth brush holder": "칫솔꽂이",
  "toilet": "화장실", "bathroom": "욕실",
  "hook": "후크", "hanger": "행거", "mirror": "거울",
  // 침실/인테리어
  "pillow": "베개", "cushion": "쿠션", "blanket": "이불",
  "mattress": "매트리스", "bed sheet": "침대시트",
  "curtain": "커튼", "rug": "러그", "carpet": "카펫",
  "lamp": "램프", "light": "조명", "led": "LED",
  "wall sticker": "벽스티커", "wall clock": "벽시계",
  "photo frame": "액자", "vase": "화병",
  // 패션/의류
  "t-shirt": "티셔츠", "shirt": "셔츠", "jacket": "자켓", "coat": "코트",
  "pants": "바지", "jeans": "청바지", "shorts": "반바지",
  "dress": "원피스", "skirt": "치마", "sweater": "스웨터",
  "hoodie": "후디", "vest": "조끼",
  "sneakers": "운동화", "shoes": "신발", "slippers": "슬리퍼",
  "sandals": "샌들", "boots": "부츠",
  "mask": "마스크", "gloves": "장갑", "belt": "벨트",
  "scarf": "스카프", "hat": "모자", "cap": "모자",
  "sunglasses": "선글라스", "watch": "시계",
  "backpack": "백팩", "wallet": "지갑", "purse": "지갑",
  "sock": "양말", "socks": "양말", "underwear": "속옷",
  // 액세서리
  "necklace": "목걸이", "ring": "반지", "bracelet": "팔찌",
  "earring": "귀걸이", "brooch": "브로치", "pendant": "펜던트",
  "hair clip": "헤어클립", "hair band": "머리띠",
  // 문구/사무
  "pen": "펜", "pencil": "연필", "notebook": "노트",
  "tape": "테이프", "sticker": "스티커", "stamp": "도장",
  "ruler": "자", "eraser": "지우개", "glue": "풀",
  "file folder": "파일폴더", "paper": "종이",
  // 스포츠/아웃도어
  "yoga mat": "요가매트", "dumbbell": "아령",
  "resistance band": "저항밴드", "jump rope": "줄넘기",
  "tent": "텐트", "camping": "캠핑", "sleeping bag": "침낭",
  "fishing": "낚시", "hiking": "등산",
  "bicycle": "자전거", "helmet": "헬멧",
  "swimming": "수영", "goggle": "고글", "goggles": "고글",
  // 차량
  "car": "차량용", "vehicle": "자동차",
  "car mount": "차량거치대", "car charger": "차량충전기",
  "dash cam": "블랙박스", "gps": "GPS",
  "car seat": "카시트", "sun visor": "썬바이저",
  "steering wheel cover": "핸들커버",
  // 반려동물
  "pet": "반려동물", "dog": "강아지", "cat": "고양이",
  "pet bed": "반려동물침대", "pet toy": "반려동물장난감",
  "leash": "리드줄", "collar": "목줄",
  "pet food bowl": "밥그릇", "cat litter": "고양이모래",
  // 장난감/완구
  "toy": "장난감", "puzzle": "퍼즐", "building blocks": "레고",
  "rc car": "RC카", "remote control": "리모컨",
  "action figure": "피규어", "doll": "인형",
  "board game": "보드게임", "card game": "카드게임",
  // 수식어/속성
  "portable": "휴대용", "foldable": "접이식",
  "mini": "미니", "large": "대형", "small": "소형",
  "waterproof": "방수", "rechargeable": "충전식",
  "automatic": "자동", "manual": "수동",
  "electric": "전동", "cordless": "무선",
  "stainless steel": "스테인리스", "silicone": "실리콘",
  "plastic": "플라스틱", "wooden": "원목", "bamboo": "대나무",
  "multi": "다용도", "adjustable": "조절식",
};

const KO_TO_EN: Record<string, string> = {};
for (const [en, ko] of Object.entries(EN_TO_KO)) {
  KO_TO_EN[ko] = en;
}

// 한국어 키워드 → 알리 검색어 세트 생성
function generateAliSearchQueries(koKeyword: string): string[] {
  const queries: string[] = [];
  const koLower = koKeyword.toLowerCase().trim();

  // 1. 직접 매핑: 한국어 토큰 → 영어
  const koTokens = koLower.split(/\s+/);
  const enTokens: string[] = [];

  // 2단어 조합 우선
  const used = new Set<number>();
  for (let i = 0; i < koTokens.length - 1; i++) {
    const twoWord = koTokens[i] + " " + koTokens[i + 1];
    if (KO_TO_EN[twoWord]) {
      enTokens.push(KO_TO_EN[twoWord]);
      used.add(i);
      used.add(i + 1);
    }
  }
  // 1단어
  for (let i = 0; i < koTokens.length; i++) {
    if (used.has(i)) continue;
    if (KO_TO_EN[koTokens[i]]) {
      enTokens.push(KO_TO_EN[koTokens[i]]);
    }
  }

  if (enTokens.length > 0) {
    queries.push(enTokens.join(" ")); // 원문 번역형
    if (enTokens.length > 2) {
      queries.push(enTokens.slice(0, 2).join(" ")); // 핵심 2어
    }
  }

  // 2. 한국어 그대로 (알리도 한국어 검색 지원)
  queries.push(koKeyword.trim());

  // 중복 제거
  return [...new Set(queries)].slice(0, 4);
}

// 알리 제목 → 한국어 키워드 변환 (역방향)
function aliTitleToKorean(aliTitle: string): string[] {
  if (!aliTitle) return [];
  const cleaned = aliTitle.toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/g, " ")
    .replace(/\d+\s*(pcs|packs?|sets?|pieces?|lot|pairs?|sheets?)\b/gi, "")
    .replace(/\d+(ml|g|kg|cm|mm|oz|l|inch|w|v|mah)\b/gi, "")
    .trim();

  const words = cleaned.split(/\s+/).filter(w => w.length > 1);
  const koWords: string[] = [];
  const usedIdx = new Set<number>();

  // 3단어 조합
  for (let i = 0; i < words.length - 2; i++) {
    const three = words[i] + " " + words[i + 1] + " " + words[i + 2];
    if (EN_TO_KO[three]) {
      koWords.push(EN_TO_KO[three]);
      usedIdx.add(i); usedIdx.add(i + 1); usedIdx.add(i + 2);
    }
  }
  // 2단어 조합
  for (let i = 0; i < words.length - 1; i++) {
    if (usedIdx.has(i) || usedIdx.has(i + 1)) continue;
    const two = words[i] + " " + words[i + 1];
    if (EN_TO_KO[two]) {
      koWords.push(EN_TO_KO[two]);
      usedIdx.add(i); usedIdx.add(i + 1);
    }
  }
  // 1단어
  for (let i = 0; i < words.length; i++) {
    if (usedIdx.has(i)) continue;
    if (EN_TO_KO[words[i]]) {
      koWords.push(EN_TO_KO[words[i]]);
      usedIdx.add(i);
    }
  }

  return koWords;
}

// 매칭 점수 계산
function calcMatchScore(opts: {
  koKeywords: string[];
  aliTitle: string;
  coupangAvgPrice?: number;
  aliPriceKrw?: number;
  orderCount?: number;
  rating?: number;
}): {
  matchScore: number;
  titleMatchScore: number;
  attributeMatchScore: number;
  priceFitScore: number;
} {
  const aliLower = opts.aliTitle.toLowerCase();

  // 1. 제목 유사도 (40%)
  let titleHits = 0;
  for (const kw of opts.koKeywords) {
    const enWords = KO_TO_EN[kw];
    if (enWords && aliLower.includes(enWords.split(" ")[0])) titleHits++;
  }
  const titleMatchScore = Math.min(100, (titleHits / Math.max(opts.koKeywords.length, 1)) * 100);

  // 2. 속성 매칭 (25%) — 수식어 단어가 얼마나 들어있는지
  const attrs = ["wireless", "portable", "mini", "foldable", "waterproof",
    "rechargeable", "electric", "automatic", "stainless", "silicone", "large",
    "cordless", "adjustable", "bamboo", "wooden"];
  let attrHits = 0;
  let attrTotal = 0;
  for (const a of attrs) {
    if (aliLower.includes(a)) {
      if (opts.koKeywords.some(k => {
        const mapped = KO_TO_EN[k];
        return mapped && mapped.includes(a);
      })) attrHits++;
      attrTotal++;
    }
  }
  const attributeMatchScore = attrTotal > 0 ? Math.min(100, (attrHits / attrTotal) * 100) : 50;

  // 3. 가격 적합도 (15%)
  let priceFitScore = 50;
  if (opts.coupangAvgPrice && opts.aliPriceKrw && opts.aliPriceKrw > 0) {
    const ratio = opts.coupangAvgPrice / opts.aliPriceKrw;
    if (ratio >= 3) priceFitScore = 100;
    else if (ratio >= 2.5) priceFitScore = 80;
    else if (ratio >= 2) priceFitScore = 60;
    else if (ratio >= 1.5) priceFitScore = 30;
    else priceFitScore = 10;
  }

  // 4. 주문수 신호 (10%)
  let orderSignal = 30;
  if (opts.orderCount) {
    if (opts.orderCount >= 1000) orderSignal = 100;
    else if (opts.orderCount >= 500) orderSignal = 80;
    else if (opts.orderCount >= 100) orderSignal = 60;
    else if (opts.orderCount >= 10) orderSignal = 40;
  }

  // 5. 평점 (5%)
  let ratingSignal = 50;
  if (opts.rating) {
    if (opts.rating >= 4.8) ratingSignal = 100;
    else if (opts.rating >= 4.5) ratingSignal = 80;
    else if (opts.rating >= 4.0) ratingSignal = 60;
    else ratingSignal = 30;
  }

  const matchScore =
    titleMatchScore * 0.40 +
    attributeMatchScore * 0.25 +
    priceFitScore * 0.15 +
    orderSignal * 0.10 +
    ratingSignal * 0.05 +
    50 * 0.05; // shipping placeholder

  return {
    matchScore: Math.round(matchScore * 100) / 100,
    titleMatchScore: Math.round(titleMatchScore * 100) / 100,
    attributeMatchScore: Math.round(attributeMatchScore * 100) / 100,
    priceFitScore: Math.round(priceFitScore * 100) / 100,
  };
}

export const aliSourcingRouter = router({
  // ===== 1. 알리 검색 결과 저장 (확장프로그램 → 서버) =====
  saveSearchResults: protectedProcedure
    .input(z.object({
      keywordId: z.number().int().optional(),
      searchQuery: z.string().min(1).max(255),
      direction: z.enum(["forward", "reverse"]).default("forward"),
      items: z.array(z.object({
        productUrl: z.string().min(1).max(1000),
        productId: z.string().max(100).optional(),
        productTitle: z.string().min(1).max(1000),
        productImageUrl: z.string().max(1000).optional(),
        priceMin: z.number().default(0),
        priceMax: z.number().default(0),
        priceKrw: z.number().int().default(0),
        orderCount: z.number().int().default(0),
        rating: z.number().default(0),
        freeShipping: z.boolean().default(false),
      })).min(1).max(60),
      cacheTtlHours: z.number().int().min(1).max(48).default(24),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const expiresAt = new Date(Date.now() + input.cacheTtlHours * 60 * 60 * 1000)
        .toISOString().replace("T", " ").slice(0, 19);

      // 쿠팡 평균가 조회 (점수 계산용)
      let coupangAvgPrice = 0;
      if (input.keywordId) {
        const [kw] = await db.select({ keyword: keywordMaster.keyword })
          .from(keywordMaster).where(eq(keywordMaster.id, input.keywordId)).limit(1);
        if (kw) {
          const [watch] = await db.select({ avgPrice: extWatchKeywords.latestAvgPrice })
            .from(extWatchKeywords)
            .where(and(eq(extWatchKeywords.userId, ctx.user!.id), eq(extWatchKeywords.keyword, kw.keyword)))
            .limit(1);
          coupangAvgPrice = watch?.avgPrice || 0;
        }
      }

      // 한국어 키워드 토큰 (점수 계산용)
      let koKeywords: string[] = [];
      if (input.keywordId) {
        const [kw] = await db.select({ keyword: keywordMaster.keyword })
          .from(keywordMaster).where(eq(keywordMaster.id, input.keywordId)).limit(1);
        if (kw) koKeywords = kw.keyword.split(/\s+/);
      }

      // 기존 캐시 삭제
      await db.delete(aliSearchCache).where(and(
        eq(aliSearchCache.userId, ctx.user!.id),
        eq(aliSearchCache.searchQuery, input.searchQuery),
      ));

      let saved = 0;
      for (let i = 0; i < input.items.length; i++) {
        const item = input.items[i];
        const scores = calcMatchScore({
          koKeywords,
          aliTitle: item.productTitle,
          coupangAvgPrice,
          aliPriceKrw: item.priceKrw,
          orderCount: item.orderCount,
          rating: item.rating,
        });

        await db.insert(aliSearchCache).values({
          userId: ctx.user!.id,
          keywordId: input.keywordId || null,
          searchQuery: input.searchQuery,
          searchDirection: input.direction,
          resultRank: i + 1,
          productUrl: item.productUrl,
          productId: item.productId || null,
          productTitle: item.productTitle,
          productImageUrl: item.productImageUrl || null,
          priceMin: item.priceMin.toFixed(2),
          priceMax: item.priceMax.toFixed(2),
          priceKrw: item.priceKrw,
          orderCount: item.orderCount,
          rating: item.rating.toFixed(2),
          freeShipping: item.freeShipping,
          matchScore: scores.matchScore.toFixed(4),
          titleMatchScore: scores.titleMatchScore.toFixed(4),
          attributeMatchScore: scores.attributeMatchScore.toFixed(4),
          priceFitScore: scores.priceFitScore.toFixed(4),
          expiresAt,
        });
        saved++;
      }

      return { success: true, saved };
    }),

  // ===== 2. 캐시된 추천 결과 조회 =====
  getCachedResults: protectedProcedure
    .input(z.object({
      keywordId: z.number().int().optional(),
      searchQuery: z.string().max(255).optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const now = new Date().toISOString().replace("T", " ").slice(0, 19);
      const conditions: any[] = [
        eq(aliSearchCache.userId, ctx.user!.id),
        sql`${aliSearchCache.expiresAt} > ${now}`,
      ];

      if (input.keywordId) conditions.push(eq(aliSearchCache.keywordId, input.keywordId));
      if (input.searchQuery) conditions.push(eq(aliSearchCache.searchQuery, input.searchQuery));

      const results = await db.select()
        .from(aliSearchCache)
        .where(and(...conditions))
        .orderBy(desc(aliSearchCache.matchScore))
        .limit(input.limit);

      return results;
    }),

  // ===== 3. 알리 상품 연결 (선택 → 영구 매핑) =====
  linkProduct: protectedProcedure
    .input(z.object({
      keywordId: z.number().int(),
      aliProductUrl: z.string().min(1).max(1000),
      aliProductId: z.string().max(100).optional(),
      aliProductTitle: z.string().min(1).max(1000),
      aliImageUrl: z.string().max(1000).optional(),
      priceUsd: z.number().default(0),
      priceKrw: z.number().int().default(0),
      orderCount: z.number().int().default(0),
      rating: z.number().default(0),
      matchScore: z.number().default(0),
      direction: z.enum(["forward", "reverse"]).default("forward"),
      isPrimary: z.boolean().default(false),
      reason: z.string().max(255).optional(),
      memo: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // is_primary=true면 기존 주력 해제
      if (input.isPrimary) {
        await db.update(keywordAliMapping)
          .set({ isPrimary: false })
          .where(and(
            eq(keywordAliMapping.userId, ctx.user!.id),
            eq(keywordAliMapping.keywordId, input.keywordId),
            eq(keywordAliMapping.isPrimary, true),
          ));
      }

      // 중복 체크
      const [existing] = await db.select({ id: keywordAliMapping.id })
        .from(keywordAliMapping)
        .where(and(
          eq(keywordAliMapping.keywordId, input.keywordId),
          sql`LEFT(${keywordAliMapping.aliProductUrl}, 255) = LEFT(${input.aliProductUrl}, 255)`,
        ))
        .limit(1);

      if (existing) {
        await db.update(keywordAliMapping)
          .set({
            aliProductTitle: input.aliProductTitle,
            selectedPriceUsd: input.priceUsd.toFixed(2),
            selectedPriceKrw: input.priceKrw,
            selectedOrderCount: input.orderCount,
            selectedRating: input.rating.toFixed(2),
            matchScore: input.matchScore.toFixed(4),
            isPrimary: input.isPrimary,
            mappingStatus: "active",
            selectedReason: input.reason || null,
            memo: input.memo || null,
          })
          .where(eq(keywordAliMapping.id, existing.id));
        return { success: true, mappingId: existing.id, updated: true };
      }

      const res = await db.insert(keywordAliMapping).values({
        userId: ctx.user!.id,
        keywordId: input.keywordId,
        aliProductUrl: input.aliProductUrl,
        aliProductId: input.aliProductId || null,
        aliProductTitle: input.aliProductTitle,
        aliImageUrl: input.aliImageUrl || null,
        selectedPriceUsd: input.priceUsd.toFixed(2),
        selectedPriceKrw: input.priceKrw,
        selectedOrderCount: input.orderCount,
        selectedRating: input.rating.toFixed(2),
        matchScore: input.matchScore.toFixed(4),
        matchDirection: input.direction,
        isPrimary: input.isPrimary,
        selectedReason: input.reason || null,
        memo: input.memo || null,
      });

      const mappingId = Number((res as any)[0]?.insertId);
      return { success: true, mappingId, updated: false };
    }),

  // ===== 4. 연결 해제 / 상태 변경 =====
  updateMapping: protectedProcedure
    .input(z.object({
      mappingId: z.number().int(),
      status: z.enum(["active", "paused", "dropped"]).optional(),
      isPrimary: z.boolean().optional(),
      trackingEnabled: z.boolean().optional(),
      memo: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const updates: any = {};
      if (input.status !== undefined) updates.mappingStatus = input.status;
      if (input.isPrimary !== undefined) updates.isPrimary = input.isPrimary;
      if (input.trackingEnabled !== undefined) updates.trackingEnabled = input.trackingEnabled;
      if (input.memo !== undefined) updates.memo = input.memo;

      // is_primary=true면 기존 해제
      if (input.isPrimary) {
        const [mapping] = await db.select({ keywordId: keywordAliMapping.keywordId })
          .from(keywordAliMapping).where(eq(keywordAliMapping.id, input.mappingId)).limit(1);
        if (mapping) {
          await db.update(keywordAliMapping)
            .set({ isPrimary: false })
            .where(and(
              eq(keywordAliMapping.userId, ctx.user!.id),
              eq(keywordAliMapping.keywordId, mapping.keywordId),
              eq(keywordAliMapping.isPrimary, true),
            ));
        }
      }

      await db.update(keywordAliMapping)
        .set(updates)
        .where(and(
          eq(keywordAliMapping.id, input.mappingId),
          eq(keywordAliMapping.userId, ctx.user!.id),
        ));

      return { success: true };
    }),

  // ===== 5. 키워드별 연결된 알리 상품 목록 =====
  getLinkedProducts: protectedProcedure
    .input(z.object({
      keywordId: z.number().int(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const mappings = await db.select()
        .from(keywordAliMapping)
        .where(and(
          eq(keywordAliMapping.userId, ctx.user!.id),
          eq(keywordAliMapping.keywordId, input.keywordId),
        ))
        .orderBy(desc(keywordAliMapping.isPrimary), desc(keywordAliMapping.matchScore));

      // 최신 추적 스냅샷 함께 조회
      const result = [];
      for (const m of mappings) {
        const [lastSnapshot] = await db.select()
          .from(keywordAliTrackingSnapshot)
          .where(eq(keywordAliTrackingSnapshot.mappingId, m.id))
          .orderBy(desc(keywordAliTrackingSnapshot.snapshotAt))
          .limit(1);

        result.push({ ...m, lastSnapshot: lastSnapshot || null });
      }

      return result;
    }),

  // ===== 6. 추적 스냅샷 저장 (확장프로그램 → 서버) =====
  saveTrackingSnapshot: protectedProcedure
    .input(z.object({
      mappingId: z.number().int(),
      priceMinUsd: z.number().default(0),
      priceMaxUsd: z.number().default(0),
      priceKrw: z.number().int().default(0),
      orderCount: z.number().int().default(0),
      rating: z.number().default(0),
      stockStatus: z.string().max(30).default("unknown"),
      deliveryText: z.string().max(255).optional(),
      freeShipping: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const now = new Date().toISOString().replace("T", " ").slice(0, 19);
      await db.insert(keywordAliTrackingSnapshot).values({
        mappingId: input.mappingId,
        snapshotAt: now,
        priceMinUsd: input.priceMinUsd.toFixed(2),
        priceMaxUsd: input.priceMaxUsd.toFixed(2),
        priceKrw: input.priceKrw,
        orderCount: input.orderCount,
        rating: input.rating.toFixed(2),
        stockStatus: input.stockStatus,
        deliveryText: input.deliveryText || null,
        freeShipping: input.freeShipping,
      });

      // 매핑 테이블도 최신값 업데이트
      await db.update(keywordAliMapping)
        .set({
          selectedPriceUsd: input.priceMinUsd.toFixed(2),
          selectedPriceKrw: input.priceKrw,
          selectedOrderCount: input.orderCount,
          selectedRating: input.rating.toFixed(2),
        })
        .where(eq(keywordAliMapping.id, input.mappingId));

      return { success: true };
    }),

  // ===== 7. 추적 이력 조회 =====
  getTrackingHistory: protectedProcedure
    .input(z.object({
      mappingId: z.number().int(),
      limit: z.number().int().min(1).max(100).default(30),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      return db.select()
        .from(keywordAliTrackingSnapshot)
        .where(eq(keywordAliTrackingSnapshot.mappingId, input.mappingId))
        .orderBy(desc(keywordAliTrackingSnapshot.snapshotAt))
        .limit(input.limit);
    }),

  // ===== 8. 역방향: 알리 상품 → 쿠팡 키워드 후보 추천 =====
  reverseMatchToKeywords: protectedProcedure
    .input(z.object({
      aliTitle: z.string().min(1).max(1000),
      aliPrice: z.number().default(0),
      limit: z.number().int().min(1).max(20).default(10),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 알리 제목 → 한국어 키워드 변환
      const koWords = aliTitleToKorean(input.aliTitle);
      if (!koWords.length) return { koWords: [], matches: [] };

      // 키워드 마스터에서 유사 키워드 검색
      const searchTerms = koWords.slice(0, 5);
      const orConditions = searchTerms.map(term =>
        like(keywordMaster.keyword, `%${term}%`),
      );

      const keywords = await db.select()
        .from(keywordMaster)
        .where(and(
          eq(keywordMaster.userId, ctx.user!.id),
          eq(keywordMaster.isActive, true),
          sql`(${sql.join(orConditions, sql` OR `)})`,
        ))
        .limit(50);

      if (!keywords.length) return { koWords, matches: [] };

      // 각 키워드에 매칭 점수 부여
      const scored = keywords.map(kw => {
        const kwTokens = kw.keyword.split(/\s+/);
        const overlap = kwTokens.filter(t => koWords.includes(t)).length;
        const similarity = overlap / Math.max(kwTokens.length, 1) * 100;

        return {
          keywordId: kw.id,
          keyword: kw.keyword,
          validationStatus: kw.validationStatus,
          sourceType: kw.sourceType,
          similarity: Math.round(similarity),
        };
      });

      scored.sort((a, b) => b.similarity - a.similarity);

      // 최신 지표 조인
      const topIds = scored.slice(0, input.limit).map(s => s.keywordId);
      const metrics = await db.select()
        .from(keywordDailyMetrics)
        .where(and(
          eq(keywordDailyMetrics.userId, ctx.user!.id),
          inArray(keywordDailyMetrics.keywordId, topIds),
          sql`(${keywordDailyMetrics.keywordId}, ${keywordDailyMetrics.metricDate}) IN (
            SELECT keyword_id, MAX(metric_date) FROM keyword_daily_metrics
            WHERE user_id = ${ctx.user!.id}
            GROUP BY keyword_id
          )`,
        ));

      const metricsMap = new Map(metrics.map(m => [m.keywordId, m]));

      const matches = scored.slice(0, input.limit).map(s => ({
        ...s,
        metrics: metricsMap.get(s.keywordId) || null,
      }));

      return { koWords, matches };
    }),

  // ===== 9. 검색어 생성 (키워드 → 알리 검색어 세트) =====
  generateSearchQueries: protectedProcedure
    .input(z.object({
      keywordId: z.number().int().optional(),
      keyword: z.string().min(1).max(255).optional(),
    }))
    .query(async ({ ctx, input }) => {
      let keyword = input.keyword || "";

      if (input.keywordId && !keyword) {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const [kw] = await db.select({ keyword: keywordMaster.keyword })
          .from(keywordMaster)
          .where(and(eq(keywordMaster.id, input.keywordId), eq(keywordMaster.userId, ctx.user!.id)))
          .limit(1);
        if (kw) keyword = kw.keyword;
      }

      if (!keyword) return { queries: [] };

      return { queries: generateAliSearchQueries(keyword) };
    }),

  // ===== 10. 만료 캐시 정리 =====
  cleanExpiredCache: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const now = new Date().toISOString().replace("T", " ").slice(0, 19);
      const result = await db.delete(aliSearchCache)
        .where(and(
          eq(aliSearchCache.userId, ctx.user!.id),
          sql`${aliSearchCache.expiresAt} < ${now}`,
        ));

      return { success: true, deleted: (result as any)?.[0]?.affectedRows || 0 };
    }),

  // ===== 11. 추적 대상 목록 (배치 수집용) =====
  getTrackingTargets: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      return db.select({
        mappingId: keywordAliMapping.id,
        aliProductUrl: keywordAliMapping.aliProductUrl,
        aliProductTitle: keywordAliMapping.aliProductTitle,
        keywordId: keywordAliMapping.keywordId,
      })
        .from(keywordAliMapping)
        .where(and(
          eq(keywordAliMapping.userId, ctx.user!.id),
          eq(keywordAliMapping.trackingEnabled, true),
          eq(keywordAliMapping.mappingStatus, "active"),
        ));
    }),

  // ===== 12. 알리 제목 → 한국어 변환 (확장프로그램용 API) =====
  translateTitle: protectedProcedure
    .input(z.object({
      aliTitle: z.string().min(1).max(1000),
    }))
    .query(({ input }) => {
      const koWords = aliTitleToKorean(input.aliTitle);
      return {
        koWords,
        searchKeyword: koWords.slice(0, 3).join(" "),
      };
    }),
});
