/**
 * FFmpeg 영상 후처리 엔진
 *
 * 1. 여러 클립 이어붙이기 (사진별 Minimax 영상 or 단일 영상 반복)
 * 2. 자막 오버레이 (SRT → ASS 변환, 한글 폰트)
 * 3. BGM 삽입
 * 4. CTA 텍스트/로고 오버레이
 * 5. 세로형(9:16) 리사이즈
 */

import { execSync, exec } from "child_process";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const UPLOADS_DIR = path.join(process.cwd(), "uploads", "marketing");
const VIDEOS_DIR = path.join(UPLOADS_DIR, "videos");
const TEMP_DIR = path.join(UPLOADS_DIR, "temp");
const FONT_PATH = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc";

// 디렉토리 생성
for (const dir of [VIDEOS_DIR, TEMP_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

interface PostProcessInput {
  rawVideoUrl: string;          // Minimax에서 받은 원본 영상 URL
  subtitleLines?: string[];     // 자막 텍스트 배열
  bgmPath?: string;             // BGM 파일 경로
  ctaText?: string;             // CTA 문구 ("지금 주문하세요!")
  brandName?: string;           // 브랜드명 (상단 표시)
  productName?: string;         // 상품명
  outputFormat?: "vertical" | "square"; // 세로(9:16) or 정사각(1:1)
}

interface PostProcessResult {
  success: boolean;
  outputPath?: string;
  outputUrl?: string;
  error?: string;
}

/**
 * 원본 영상 다운로드
 */
async function downloadVideo(url: string): Promise<string> {
  const filename = `raw_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.mp4`;
  const filePath = path.join(TEMP_DIR, filename);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`영상 다운로드 실패: ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

/**
 * 자막 ASS 파일 생성
 */
function generateSubtitleFile(lines: string[], videoDuration: number): string {
  const assPath = path.join(TEMP_DIR, `sub_${Date.now()}.ass`);
  const secondsPerLine = videoDuration / lines.length;

  let assContent = `[Script Info]
Title: Marketing Subtitle
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Noto Sans CJK KR Bold,60,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,40,40,80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  lines.forEach((line, i) => {
    const start = formatAssTime(i * secondsPerLine);
    const end = formatAssTime((i + 1) * secondsPerLine);
    assContent += `Dialogue: 0,${start},${end},Default,,0,0,0,,${line}\n`;
  });

  fs.writeFileSync(assPath, assContent, "utf-8");
  return assPath;
}

function formatAssTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/**
 * 영상 길이 가져오기
 */
function getVideoDuration(filePath: string): number {
  try {
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: "utf-8" }
    ).trim();
    return parseFloat(result) || 10;
  } catch {
    return 10;
  }
}

/**
 * 메인 후처리 함수
 */
export async function postProcessVideo(input: PostProcessInput): Promise<PostProcessResult> {
  try {
    console.log("[FFmpeg] Starting post-processing...");

    // 1. 원본 영상 다운로드
    const rawPath = await downloadVideo(input.rawVideoUrl);
    const duration = getVideoDuration(rawPath);
    console.log(`[FFmpeg] Downloaded: ${rawPath}, duration: ${duration}s`);

    // 2. FFmpeg 필터 체인 구성
    const filters: string[] = [];
    const inputs: string[] = [`-i "${rawPath}"`];
    let audioInput = "";

    // 세로형 리사이즈 (9:16)
    if (input.outputFormat !== "square") {
      filters.push("scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black");
    } else {
      filters.push("scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2:black");
    }

    // 3. 자막 추가
    if (input.subtitleLines && input.subtitleLines.length > 0) {
      const assPath = generateSubtitleFile(input.subtitleLines, duration);
      filters.push(`ass='${assPath}'`);
    }

    // 4. 브랜드명 상단 표시
    if (input.brandName) {
      const fontFile = fs.existsSync(FONT_PATH) ? `:fontfile='${FONT_PATH}'` : "";
      filters.push(
        `drawtext=text='${input.brandName}':fontsize=36${fontFile}:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=60`
      );
    }

    // 5. CTA 문구 하단 표시 (마지막 3초)
    if (input.ctaText) {
      const ctaStart = Math.max(0, duration - 3);
      const fontFile = fs.existsSync(FONT_PATH) ? `:fontfile='${FONT_PATH}'` : "";
      filters.push(
        `drawtext=text='${input.ctaText}':fontsize=48${fontFile}:fontcolor=yellow:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h-200:enable='between(t,${ctaStart},${duration})'`
      );
    }

    // 6. BGM 삽입
    if (input.bgmPath && fs.existsSync(input.bgmPath)) {
      inputs.push(`-i "${input.bgmPath}"`);
      audioInput = `-filter_complex "[1:a]volume=0.3,afade=t=out:st=${duration - 1}:d=1[bgm]" -map 0:v -map "[bgm]"`;
    }

    // 출력 파일
    const outputFilename = `final_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.mp4`;
    const outputPath = path.join(VIDEOS_DIR, outputFilename);
    const outputUrl = `/uploads/marketing/videos/${outputFilename}`;

    // FFmpeg 명령 구성
    const filterChain = filters.length > 0 ? `-vf "${filters.join(",")}"` : "";
    const cmd = `ffmpeg -y ${inputs.join(" ")} ${filterChain} ${audioInput} -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart -t ${duration} "${outputPath}" 2>&1`;

    console.log("[FFmpeg] Command:", cmd);

    // 실행 (최대 60초)
    execSync(cmd, { timeout: 60000 });

    // 임시 파일 정리
    try { fs.unlinkSync(rawPath); } catch {}

    console.log(`[FFmpeg] Done: ${outputUrl}`);
    return { success: true, outputPath, outputUrl };
  } catch (err: any) {
    console.error("[FFmpeg] Error:", err.message);
    return { success: false, error: err.message?.slice(0, 500) };
  }
}

/**
 * 이미지 슬라이드쇼 영상 생성 (Minimax 없이 사진만으로)
 * 사진 여러 장 → 각 3초씩 페이드 전환 → 자막/BGM
 */
export async function createSlideshowVideo(
  images: string[],
  subtitleLines: string[],
  options: {
    secondsPerImage?: number;
    brandName?: string;
    ctaText?: string;
    bgmPath?: string;
    outputFormat?: "vertical" | "square";
  } = {}
): Promise<PostProcessResult> {
  try {
    const spi = options.secondsPerImage || 3;
    const totalDuration = images.length * spi;
    const isVertical = options.outputFormat !== "square";
    const resolution = isVertical ? "1080x1920" : "1080x1080";

    // 이미지 다운로드 (로컬 경로면 그대로, URL이면 다운로드)
    const localImages: string[] = [];
    for (const img of images) {
      if (img.startsWith("/")) {
        const fullPath = path.join(process.cwd(), img);
        if (fs.existsSync(fullPath)) { localImages.push(fullPath); continue; }
      }
      // URL인 경우 다운로드
      try {
        const res = await fetch(img.startsWith("http") ? img : `https://lumiriz.kr${img}`);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          const tmpPath = path.join(TEMP_DIR, `img_${Date.now()}_${crypto.randomBytes(3).toString("hex")}.jpg`);
          fs.writeFileSync(tmpPath, buf);
          localImages.push(tmpPath);
        }
      } catch {}
    }

    if (localImages.length === 0) return { success: false, error: "이미지 없음" };

    // concat 리스트 생성
    const concatPath = path.join(TEMP_DIR, `concat_${Date.now()}.txt`);
    const concatContent = localImages.map(p => `file '${p}'\nduration ${spi}`).join("\n");
    fs.writeFileSync(concatPath, concatContent + `\nfile '${localImages[localImages.length - 1]}'`);

    const outputFilename = `slide_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.mp4`;
    const outputPath = path.join(VIDEOS_DIR, outputFilename);
    const outputUrl = `/uploads/marketing/videos/${outputFilename}`;

    // 필터
    const filters: string[] = [];
    filters.push(`scale=${resolution.replace("x", ":")}:force_original_aspect_ratio=decrease,pad=${resolution.replace("x", ":")}:(ow-iw)/2:(oh-ih)/2:black`);
    filters.push("format=yuv420p");

    // 자막
    if (subtitleLines.length > 0) {
      const assPath = generateSubtitleFile(subtitleLines, totalDuration);
      filters.push(`ass='${assPath}'`);
    }

    // 브랜드명
    if (options.brandName) {
      const fontFile = fs.existsSync(FONT_PATH) ? `:fontfile='${FONT_PATH}'` : "";
      filters.push(`drawtext=text='${options.brandName}':fontsize=36${fontFile}:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=60`);
    }

    // CTA
    if (options.ctaText) {
      const ctaStart = Math.max(0, totalDuration - 3);
      const fontFile = fs.existsSync(FONT_PATH) ? `:fontfile='${FONT_PATH}'` : "";
      filters.push(`drawtext=text='${options.ctaText}':fontsize=48${fontFile}:fontcolor=yellow:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h-200:enable='between(t,${ctaStart},${totalDuration})'`);
    }

    let audioCmd = "";
    if (options.bgmPath && fs.existsSync(options.bgmPath)) {
      audioCmd = `-i "${options.bgmPath}" -filter_complex "[1:a]volume=0.3,afade=t=out:st=${totalDuration - 1}:d=1[bgm]" -map 0:v -map "[bgm]"`;
    }

    const filterChain = `-vf "${filters.join(",")}"`;
    const cmd = `ffmpeg -y -f concat -safe 0 -i "${concatPath}" ${audioCmd} ${filterChain} -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart -t ${totalDuration} "${outputPath}" 2>&1`;

    console.log("[FFmpeg Slideshow] Command:", cmd);
    execSync(cmd, { timeout: 60000 });

    // 정리
    try { fs.unlinkSync(concatPath); } catch {}

    return { success: true, outputPath, outputUrl };
  } catch (err: any) {
    console.error("[FFmpeg Slideshow] Error:", err.message);
    return { success: false, error: err.message?.slice(0, 500) };
  }
}
