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
const FONT_PATH = "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Bold.ttc";

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
      const brandFile = path.join(TEMP_DIR, `brand_${Date.now()}.txt`);
      fs.writeFileSync(brandFile, input.brandName, "utf-8");
      const fontFile = fs.existsSync(FONT_PATH) ? `:fontfile='${FONT_PATH}'` : "";
      filters.push(
        `drawtext=textfile='${brandFile}':fontsize=36${fontFile}:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=60`
      );
    }

    // 5. CTA 문구 하단 표시 (마지막 3초)
    if (input.ctaText) {
      const ctaFile = path.join(TEMP_DIR, `cta_${Date.now()}.txt`);
      fs.writeFileSync(ctaFile, input.ctaText, "utf-8");
      const ctaStart = Math.max(0, duration - 3);
      const fontFile = fs.existsSync(FONT_PATH) ? `:fontfile='${FONT_PATH}'` : "";
      filters.push(
        `drawtext=textfile='${ctaFile}':fontsize=48${fontFile}:fontcolor=yellow:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h-200:enable='between(t\\,${ctaStart}\\,${duration})'`
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
 * 프로급 숏폼 영상 생성 (릴스/쇼츠 스타일)
 *
 * Ken Burns 효과 (줌인/줌아웃/팬) + 빠른 컷 전환 + 장면별 텍스트
 * 구조:
 *   [0~2초] 훅 텍스트 + 사진1 줌인
 *   [2~4초] 사진2 + 자막1 + 좌→우 팬
 *   [4~6초] 사진3 + 자막2 + 줌아웃
 *   [6~8초] 사진4 + 자막3 + 우→좌 팬
 *   [8~10초] 사진5 + CTA + 줌인
 *   + BGM 전체
 */
export async function createShortsVideo(
  images: string[],
  subtitleLines: string[],
  options: {
    secondsPerImage?: number;
    hookText?: string;         // 첫 장면 훅 텍스트
    brandName?: string;
    ctaText?: string;
    bgmPath?: string;
    productName?: string;
  } = {}
): Promise<PostProcessResult> {
  try {
    const spi = options.secondsPerImage || 2.5;
    const imgCount = Math.min(images.length, 6); // 최대 6장
    const totalDuration = imgCount * spi;
    const W = 1080;
    const H = 1920;

    console.log(`[FFmpeg Shorts] Creating ${imgCount} clips, ${spi}s each, total ${totalDuration}s`);

    // 이미지 다운로드
    const localImages: string[] = [];
    for (const img of images.slice(0, imgCount)) {
      if (img.startsWith("/")) {
        const fullPath = path.join(process.cwd(), img);
        if (fs.existsSync(fullPath)) { localImages.push(fullPath); continue; }
      }
      try {
        const url = img.startsWith("http") ? img : `https://lumiriz.kr${img}`;
        const res = await fetch(url);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          const tmpPath = path.join(TEMP_DIR, `img_${Date.now()}_${crypto.randomBytes(3).toString("hex")}.jpg`);
          fs.writeFileSync(tmpPath, buf);
          localImages.push(tmpPath);
        }
      } catch {}
    }

    if (localImages.length === 0) return { success: false, error: "이미지 없음" };

    // 각 이미지별 Ken Burns 클립 생성
    const clipPaths: string[] = [];
    const kenBurnsEffects = [
      "zoompan=z='min(zoom+0.002,1.3)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=DURATION:s=WxH:fps=30", // 중앙 줌인
      "zoompan=z='1.3':x='if(eq(on,0),0,x+2)':y='ih/2-(ih/zoom/2)':d=DURATION:s=WxH:fps=30", // 좌→우 팬
      "zoompan=z='if(eq(on,0),1.3,zoom-0.002)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=DURATION:s=WxH:fps=30", // 줌아웃
      "zoompan=z='1.3':x='if(eq(on,0),iw,x-2)':y='ih/2-(ih/zoom/2)':d=DURATION:s=WxH:fps=30", // 우→좌 팬
      "zoompan=z='min(zoom+0.003,1.4)':x='iw/4-(iw/zoom/4)':y='ih/4-(ih/zoom/4)':d=DURATION:s=WxH:fps=30", // 좌상단 줌인
      "zoompan=z='1.2':x='iw/2-(iw/zoom/2)':y='if(eq(on,0),0,y+1)':d=DURATION:s=WxH:fps=30", // 위→아래 팬
    ];

    for (let i = 0; i < localImages.length; i++) {
      const clipPath = path.join(TEMP_DIR, `clip_${Date.now()}_${i}.mp4`);
      const frames = Math.round(spi * 30); // 30fps
      const effect = kenBurnsEffects[i % kenBurnsEffects.length]
        .replace(/DURATION/g, String(frames))
        .replace(/WxH/g, `${W}x${H}`);

      // 텍스트 오버레이 준비
      let textFilter = "";
      const fontOpt = fs.existsSync(FONT_PATH) ? `:fontfile='${FONT_PATH}'` : "";

      if (i === 0 && options.hookText) {
        // 첫 장면: 훅 텍스트 (크게, 중앙)
        const hookFile = path.join(TEMP_DIR, `hook_${Date.now()}.txt`);
        fs.writeFileSync(hookFile, options.hookText, "utf-8");
        textFilter = `,drawtext=textfile='${hookFile}':fontsize=56${fontOpt}:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=(h-text_h)/2`;
      } else if (i === localImages.length - 1 && options.ctaText) {
        // 마지막 장면: CTA
        const ctaFile = path.join(TEMP_DIR, `cta2_${Date.now()}_${i}.txt`);
        fs.writeFileSync(ctaFile, options.ctaText, "utf-8");
        textFilter = `,drawtext=textfile='${ctaFile}':fontsize=52${fontOpt}:fontcolor=yellow:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h*3/4`;
      } else if (subtitleLines[i - 1]) {
        // 중간 장면: 자막
        const subFile = path.join(TEMP_DIR, `stxt_${Date.now()}_${i}.txt`);
        fs.writeFileSync(subFile, subtitleLines[i - 1], "utf-8");
        textFilter = `,drawtext=textfile='${subFile}':fontsize=44${fontOpt}:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=h*3/4`;
      }

      // 브랜드명 (전 장면 공통)
      let brandFilter = "";
      if (options.brandName) {
        const brandFile = path.join(TEMP_DIR, `br_${Date.now()}_${i}.txt`);
        fs.writeFileSync(brandFile, options.brandName, "utf-8");
        brandFilter = `,drawtext=textfile='${brandFile}':fontsize=28${fontOpt}:fontcolor=white@0.8:borderw=1:bordercolor=black:x=(w-text_w)/2:y=50`;
      }

      const cmd = `ffmpeg -y -loop 1 -i "${localImages[i]}" -vf "${effect},format=yuv420p${textFilter}${brandFilter}" -t ${spi} -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p "${clipPath}" 2>&1`;

      console.log(`[FFmpeg Shorts] Clip ${i + 1}/${localImages.length}`);
      execSync(cmd, { timeout: 30000 });
      clipPaths.push(clipPath);
    }

    // 클립들을 xfade로 이어붙이기 (크로스페이드 전환 0.3초)
    const outputFilename = `shorts_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.mp4`;
    const outputPath = path.join(VIDEOS_DIR, outputFilename);
    const outputUrl = `/uploads/marketing/videos/${outputFilename}`;

    if (clipPaths.length === 1) {
      // 1개면 그냥 복사
      fs.copyFileSync(clipPaths[0], outputPath);
    } else {
      // 여러 개 연결 — concat 방식 (xfade는 복잡하므로 단순 concat + 짧은 fade)
      const concatPath = path.join(TEMP_DIR, `shorts_concat_${Date.now()}.txt`);
      const concatContent = clipPaths.map(p => `file '${p}'`).join("\n");
      fs.writeFileSync(concatPath, concatContent);

      let concatCmd = `ffmpeg -y -f concat -safe 0 -i "${concatPath}"`;

      // BGM 추가
      if (options.bgmPath && fs.existsSync(options.bgmPath)) {
        concatCmd += ` -i "${options.bgmPath}" -filter_complex "[1:a]volume=0.25,afade=t=in:d=0.5,afade=t=out:st=${totalDuration - 1}:d=1[bgm]" -map 0:v -map "[bgm]" -shortest`;
      }

      concatCmd += ` -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart -t ${totalDuration} "${outputPath}" 2>&1`;

      console.log("[FFmpeg Shorts] Concatenating clips...");
      execSync(concatCmd, { timeout: 60000 });

      // concat 파일 정리
      try { fs.unlinkSync(concatPath); } catch {}
    }

    // 임시 클립 정리
    for (const p of clipPaths) { try { fs.unlinkSync(p); } catch {} }

    console.log(`[FFmpeg Shorts] Done: ${outputUrl}`);
    return { success: true, outputPath, outputUrl };
  } catch (err: any) {
    console.error("[FFmpeg Shorts] Error:", err.message?.slice(0, 500));
    return { success: false, error: err.message?.slice(0, 500) };
  }
}
