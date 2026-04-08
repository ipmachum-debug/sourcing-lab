/**
 * 영상 제작 파이프라인
 *
 * 1. AI 베스트 컷 선택 (10장 → 3~5장)
 * 2. 스토리 자동 생성
 * 3. 영상 프롬프트 생성
 * 4. Kling API 호출 → 영상 생성
 * 5. 자막 자동 삽입
 * 6. BGM 자동 선택
 * 7. 발행 큐 이동
 */

import { getDb } from "../../db";
import { mktVideoJobs, mktProducts, mktBrands } from "../../../drizzle/schema";
import { eq, sql } from "drizzle-orm";

const VIDEO_STYLES: Record<string, string> = {
  instagram_reel: "인스타그램 릴스 스타일. 세로형(9:16), 빠른 컷 전환, 감성적, 15초.",
  tiktok: "틱톡 스타일. 세로형(9:16), 훅 강조, 트렌디, 임팩트 있는 시작, 15초.",
  youtube_shorts: "유튜브 쇼츠 스타일. 세로형(9:16), 정보성+재미, 30초.",
  product_showcase: "상품 쇼케이스. food commercial style, cinematic lighting, macro shot, 슬로우모션, 디테일 클로즈업, 15초.",
  unboxing: "언박싱 스타일. 기대감 조성, 포장→오픈→상품 등장, 30초.",
  review: "후기/체험 스타일. 실제 사용 장면, before/after, 리얼 리뷰, 30초.",
};

/**
 * Step 1: AI가 베스트 컷 3~5장 선택
 */
export async function selectBestCuts(
  images: string[], product: any, brand: any
): Promise<{ selected: string[]; reason: string }> {
  const apiUrl = "https://api.openai.com/v1/chat/completions";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // API 없으면 앞에서 3~5장 선택
    return { selected: images.slice(0, Math.min(5, images.length)), reason: "AI API 없음 — 순서대로 선택" };
  }

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `당신은 소셜미디어 영상 제작 전문가입니다. 상품 사진 목록에서 영상에 가장 적합한 3~5장을 선택합니다.
JSON 응답: {"selectedIndices": [0, 2, 4], "reason": "선택 이유"}
인덱스는 0부터 시작합니다.`,
          },
          {
            role: "user",
            content: `상품: ${product?.name || "미지정"}
브랜드: ${brand?.name || "미지정"}
사진 ${images.length}장이 있습니다 (인덱스 0~${images.length - 1}).
영상 제작에 가장 좋은 3~5장을 선택해주세요.
고려사항: 다양한 앵글, 클로즈업+전체샷 혼합, 가장 매력적인 컷 우선`,
          },
        ],
        temperature: 0.5,
        max_tokens: 300,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) throw new Error("AI API error");
    const data = await res.json();
    const result = JSON.parse(data.choices?.[0]?.message?.content || "{}");
    const indices: number[] = result.selectedIndices || [0, 1, 2];
    const selected = indices.filter(i => i < images.length).map(i => images[i]);

    return {
      selected: selected.length > 0 ? selected : images.slice(0, 3),
      reason: result.reason || "",
    };
  } catch {
    return { selected: images.slice(0, Math.min(5, images.length)), reason: "폴백 — 순서대로 선택" };
  }
}

/**
 * Step 2: 스토리 자동 생성
 */
export async function generateStory(
  selectedImages: string[], product: any, brand: any, style: string
): Promise<{ script: string; subtitles: string }> {
  const apiUrl = "https://api.openai.com/v1/chat/completions";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { script: `${product?.name || "상품"} 소개 영상`, subtitles: "" };
  }

  const styleDesc = VIDEO_STYLES[style] || VIDEO_STYLES.instagram_reel;

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `소셜미디어 숏폼 영상 스토리텔러. 상품 사진으로 만들 영상의 스토리와 자막을 생성합니다.
JSON 응답:
{
  "script": "장면별 설명 (장면1: ..., 장면2: ..., 장면3: ...)",
  "subtitles": "자막 텍스트 (줄바꿈으로 구분, 각 3초 분량)",
  "mood": "영상 전체 분위기 설명"
}`,
        },
        {
          role: "user",
          content: `상품: ${product?.name}
설명: ${product?.description || "없음"}
특징: ${JSON.stringify(product?.features || [])}
브랜드 톤: ${brand?.toneOfVoice || "friendly"}
영상 스타일: ${styleDesc}
사진 수: ${selectedImages.length}장

이 사진들로 만들 숏폼 영상의 스토리와 자막을 생성해주세요.`,
        },
      ],
      temperature: 0.8,
      max_tokens: 1000,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) throw new Error("Story generation failed");
  const data = await res.json();
  const result = JSON.parse(data.choices?.[0]?.message?.content || "{}");
  return {
    script: result.script || "",
    subtitles: result.subtitles || "",
  };
}

/**
 * Step 3: Minimax (Hailuo) 영상 프롬프트 생성
 * - 카메라 명령어 [Static shot], [Push in] 등 활용
 * - 조명/분위기 구체적 제어
 * - 네거티브 프롬프트 포함
 */
export async function generateVideoPrompt(
  product: any, brand: any, script: string, style: string
): Promise<string> {
  const apiUrl = "https://api.openai.com/v1/chat/completions";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return `[Static shot] A close-up of ${product?.name || "Korean dessert"} on a clean white surface, soft natural window lighting from the left, shallow depth of field, no camera movement, studio food photography style, 4K quality.`;
  }

  const styleDesc = VIDEO_STYLES[style] || VIDEO_STYLES.instagram_reel;

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a professional food videographer creating prompts for the MiniMax Hailuo AI video model (image-to-video).

CRITICAL RULES:
1. The prompt must describe WHAT HAPPENS to the EXISTING image — subtle, realistic motion only.
2. The first frame image is already provided. DO NOT describe what is in the image. Describe the MOTION and ATMOSPHERE only.
3. Use Minimax camera commands: [Static shot], [Push in], [Pull out], [Pan left], [Pan right], [Tilt up], [Tilt down], [Zoom in], [Zoom out], [Tracking shot]
4. Use ONLY ONE camera command maximum. [Static shot] is safest for food products.
5. Keep motion MINIMAL — food doesn't move much. Focus on: steam, light changes, subtle shadow shifts, gentle rotation.

MUST AVOID (causes artifacts):
- "lens flare", "light leak", "sun rays", "bloom effect", "glow"
- "fast zoom", "rapid movement", "dynamic camera", "handheld"
- "morphing", "transformation", "shape change"
- "blurry", "dreamy haze", "soft focus", "bokeh movement"
- Any mention of multiple scenes or cuts (this is ONE continuous 6-10 second clip)

GOOD EXAMPLES:
- "[Static shot] Soft ambient lighting gently shifts across the dessert surface, subtle steam rises from the fresh cream, shallow depth of field, studio food photography, 4K."
- "[Zoom in] Slow gentle zoom into the cream filling detail, natural window lighting from left, crisp sharp focus maintained throughout, professional food commercial quality."

Respond in JSON: {"prompt": "English prompt under 200 words"}`,
        },
        {
          role: "user",
          content: `Product: ${product?.name}
Description: ${product?.description || "Korean premium dessert"}
Features: ${JSON.stringify(product?.features || [])}
Style: ${styleDesc}
Brand tone: ${brand?.toneOfVoice || "friendly"}

Generate ONE image-to-video prompt. The product photo is already provided as the first frame.
Describe only the subtle motion and atmosphere for a 6-10 second food commercial clip.`,
        },
      ],
      temperature: 0.5,
      max_tokens: 400,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) throw new Error("Prompt generation failed");
  const data = await res.json();
  const result = JSON.parse(data.choices?.[0]?.message?.content || "{}");
  return result.prompt || `[Static shot] Soft natural lighting gently illuminates the product on a clean surface, subtle shadow movement, crisp sharp focus, professional food photography, 4K quality.`;
}

/**
 * Step 4: Minimax (Hailuo) API 호출
 * - 인증: API Key (Bearer)
 * - image-to-video 지원
 */
export async function callVideoApi(
  imageUrl: string, prompt: string, duration: number = 5
): Promise<{ taskId: string } | { error: string }> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    return { error: "MINIMAX_API_KEY를 .env에 추가하세요. (https://platform.minimaxi.com)" };
  }

  try {
    const res = await fetch("https://api.minimax.io/v1/video_generation", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "MiniMax-Hailuo-02",
        first_frame_image: imageUrl,
        prompt,
        prompt_optimizer: false,
        duration: duration <= 6 ? 6 : 10,
        resolution: "768P",
      }),
    });

    const responseText = await res.text();
    console.log("[Minimax API] Response:", res.status, responseText);

    if (!res.ok) {
      return { error: `Minimax API 에러: ${res.status} — ${responseText}` };
    }

    let data: any;
    try { data = JSON.parse(responseText); } catch { return { error: `Minimax 응답 파싱 실패: ${responseText.slice(0, 200)}` }; }

    // task_id 위치가 다를 수 있음
    const taskId = data.task_id || data.data?.task_id || data.id || data.data?.id;
    if (!taskId) {
      const msg = data.base_resp?.status_msg || "알 수 없는 에러";
      const code = data.base_resp?.status_code || "";
      return { error: `Minimax API 실패 (${code}): ${msg}. 응답: ${JSON.stringify(data).slice(0, 300)}` };
    }

    return { taskId };
  } catch (err: any) {
    return { error: err.message };
  }
}

/**
 * Minimax 작업 상태 확인
 */
export async function checkVideoStatus(taskId: string): Promise<{
  status: string;
  videoUrl?: string;
  error?: string;
}> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) return { status: "error", error: "API key missing" };

  try {
    const res = await fetch(`https://api.minimax.io/v1/query/video_generation?task_id=${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) return { status: "error", error: `${res.status}` };
    const data = await res.json();

    if (data.status === "Success") {
      // file_id로 다운로드 URL 가져오기
      let videoUrl: string | undefined;
      if (data.file_id) {
        try {
          const fileRes = await fetch(`https://api.minimax.io/v1/files/retrieve?file_id=${data.file_id}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (fileRes.ok) {
            const fileData = await fileRes.json();
            videoUrl = fileData.file?.download_url;
          }
        } catch {}
        if (!videoUrl) videoUrl = `https://api.minimax.io/v1/files/retrieve?file_id=${data.file_id}`;
      }
      return { status: "completed", videoUrl };
    } else if (data.status === "Fail" || data.status === "Failed") {
      return { status: "failed", error: data.base_resp?.status_msg || data.error_message || "생성 실패" };
    }
    return { status: "processing" };
  } catch (err: any) {
    return { status: "error", error: err.message };
  }
}

/**
 * Step 6: BGM 추천
 */
export function selectBgm(mood: string): { track: string; name: string } {
  // 로열티 프리 BGM 매핑 (실제로는 파일 경로 or URL)
  const BGM_MAP: Record<string, { track: string; name: string }> = {
    upbeat: { track: "/uploads/marketing/bgm/upbeat.mp3", name: "Upbeat Energy" },
    calm: { track: "/uploads/marketing/bgm/calm.mp3", name: "Calm & Peaceful" },
    luxury: { track: "/uploads/marketing/bgm/luxury.mp3", name: "Luxury Feel" },
    cute: { track: "/uploads/marketing/bgm/cute.mp3", name: "Cute & Playful" },
    trendy: { track: "/uploads/marketing/bgm/trendy.mp3", name: "Trendy Beat" },
    emotional: { track: "/uploads/marketing/bgm/emotional.mp3", name: "Emotional Piano" },
  };
  return BGM_MAP[mood] || BGM_MAP.trendy;
}
