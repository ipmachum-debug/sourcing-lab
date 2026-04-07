import type { MktProduct, MktBrand } from "../../../drizzle/schema";

type Platform = "instagram" | "youtube" | "tiktok" | "naver_blog" | "naver_cafe" | "kakao";

interface GenerateInput {
  product: MktProduct;
  brand: MktBrand | null;
  platforms: Platform[];
  contentType: "promotional" | "storytelling" | "educational" | "event" | "review";
  customPrompt?: string;
}

interface ChannelPost {
  platform: Platform;
  title?: string;
  caption?: string;
  description?: string;
  hashtags?: string[];
}

interface GenerateResult {
  masterTitle: string;
  masterHook: string;
  masterBody: string;
  hashtags: string[];
  script?: string;
  channelPosts: ChannelPost[];
  aiScore?: number;
}

const PLATFORM_SPECS: Record<Platform, { maxCaption: number; hashtagLimit: number; name: string }> = {
  instagram: { maxCaption: 2200, hashtagLimit: 30, name: "인스타그램" },
  youtube: { maxCaption: 5000, hashtagLimit: 15, name: "유튜브" },
  tiktok: { maxCaption: 4000, hashtagLimit: 20, name: "틱톡" },
  naver_blog: { maxCaption: 50000, hashtagLimit: 10, name: "네이버 블로그" },
  naver_cafe: { maxCaption: 50000, hashtagLimit: 10, name: "네이버 카페" },
  kakao: { maxCaption: 2000, hashtagLimit: 0, name: "카카오채널" },
};

const TONE_MAP: Record<string, string> = {
  casual: "친근하고 가벼운 톤. 이모지를 적극 활용. 구어체 사용.",
  premium: "고급스럽고 세련된 톤. 과장 없이 절제된 표현. 브랜드 가치 강조.",
  friendly: "따뜻하고 친절한 톤. 고객 입장에서 공감하며 설명.",
  professional: "전문적이고 신뢰감 있는 톤. 데이터와 근거 기반.",
  b2b: "비즈니스 톤. 효율성과 ROI 중심. 간결하고 명확.",
};

const CONTENT_TYPE_MAP: Record<string, string> = {
  promotional: "제품 판매 촉진 콘텐츠. 구매 욕구 자극, 혜택 강조, CTA 포함.",
  storytelling: "스토리텔링형 콘텐츠. 제품 탄생 배경, 제조 과정, 사용 후기 등 이야기 중심.",
  educational: "정보성/교육 콘텐츠. 유용한 팁, 사용법, 비교 분석 등 지식 공유.",
  event: "이벤트/프로모션 콘텐츠. 할인, 증정, 한정 판매 등 긴급성/희소성 강조.",
  review: "후기/체험 콘텐츠. 실제 사용 경험, before/after, 솔직한 평가.",
};

function buildSystemPrompt(brand: MktBrand | null): string {
  const tone = brand?.toneOfVoice ? TONE_MAP[brand.toneOfVoice] || TONE_MAP.friendly : TONE_MAP.friendly;
  const forbidden = (brand?.forbiddenWords as string[])?.length
    ? `\n금칙어 (절대 사용 금지): ${(brand.forbiddenWords as string[]).join(", ")}`
    : "";
  const keywords = (brand?.keywords as string[])?.length
    ? `\n브랜드 키워드: ${(brand.keywords as string[]).join(", ")}`
    : "";

  return `당신은 한국 소셜미디어 마케팅 전문 카피라이터입니다.

브랜드: ${brand?.name || "미지정"}
톤앤매너: ${tone}${keywords}${forbidden}

규칙:
1. 한국어로 작성
2. 각 플랫폼 특성에 맞게 최적화
3. 해시태그는 한국어 + 영어 혼합
4. 훅(첫 문장)은 스크롤을 멈추게 하는 강력한 한 줄
5. CTA(행동유도)를 반드시 포함
6. 반드시 JSON 형식으로 응답`;
}

function buildUserPrompt(input: GenerateInput): string {
  const { product, platforms, contentType, customPrompt } = input;
  const features = (product.features as string[])?.join(", ") || "미지정";
  const platformNames = platforms.map(p => PLATFORM_SPECS[p].name).join(", ");

  return `다음 상품의 마케팅 콘텐츠를 생성해주세요.

상품명: ${product.name}
설명: ${product.description || "없음"}
특징: ${features}
타겟 고객: ${product.targetAudience || "미지정"}
가격: ${product.price || "미지정"}
카테고리: ${product.category || "미지정"}
시즌성: ${product.seasonality || "연중"}

콘텐츠 유형: ${CONTENT_TYPE_MAP[contentType]}
대상 플랫폼: ${platformNames}
${customPrompt ? `\n추가 요구사항: ${customPrompt}` : ""}

다음 JSON 형식으로 응답해주세요:
{
  "masterTitle": "대표 제목",
  "masterHook": "스크롤 멈추는 훅 문장",
  "masterBody": "본문 내용 (200-500자)",
  "hashtags": ["해시태그1", "해시태그2", ...],
  "script": "영상용 대본 (15-60초 분량, 해당 시에만)",
  "aiScore": 85,
  "channelPosts": [
    ${platforms.map(p => `{
      "platform": "${p}",
      "title": "${PLATFORM_SPECS[p].name}용 제목",
      "caption": "${PLATFORM_SPECS[p].name}용 캡션 (${PLATFORM_SPECS[p].maxCaption}자 이내)",
      "description": "상세 설명",
      "hashtags": ["플랫폼 최적화 해시태그", ...] (최대 ${PLATFORM_SPECS[p].hashtagLimit}개)
    }`).join(",\n    ")}
  ]
}`;
}

async function callLLM(systemPrompt: string, userPrompt: string): Promise<any> {
  const apiUrl = process.env.BUILT_IN_FORGE_API_URL;
  const apiKey = process.env.BUILT_IN_FORGE_API_KEY;

  if (!apiUrl || !apiKey) {
    throw new Error("AI API 설정이 없습니다. BUILT_IN_FORGE_API_URL과 BUILT_IN_FORGE_API_KEY를 확인하세요.");
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.8,
      max_tokens: 4000,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`AI API 에러: ${response.status} — ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI 응답이 비어있습니다.");
  return JSON.parse(content);
}

export async function generateContent(input: GenerateInput): Promise<GenerateResult> {
  const systemPrompt = buildSystemPrompt(input.brand);
  const userPrompt = buildUserPrompt(input);

  const result = await callLLM(systemPrompt, userPrompt);

  return {
    masterTitle: result.masterTitle || input.product.name,
    masterHook: result.masterHook || "",
    masterBody: result.masterBody || "",
    hashtags: result.hashtags || [],
    script: result.script || undefined,
    channelPosts: (result.channelPosts || []).map((p: any) => ({
      platform: p.platform,
      title: p.title,
      caption: p.caption,
      description: p.description,
      hashtags: p.hashtags,
    })),
    aiScore: result.aiScore || undefined,
  };
}
