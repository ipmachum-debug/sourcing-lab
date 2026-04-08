/**
 * FFmpeg 영상 후처리 엔진
 *
 * 1. 여러 클립 이어붙이기 (사진별 Minimax 영상 or 단일 영상 반복)
 * 2. 자막 오버레이 (ASS 자막 방식, 한글 폰트)
 * 3. BGM 삽입
 * 4. CTA 텍스트/로고 오버레이
 * 5. 세로형(9:16) 리사이즈
 *
 * NOTE: drawtext 필터는 이 FFmpeg 빌드에서 미지원.
 *       모든 텍스트 오버레이는 ASS 자막 파일 + ass 필터로 처리.
 */

import { execSync, exec } from "child_process";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const UPLOADS_DIR = path.join(process.cwd(), "uploads", "marketing");
const VIDEOS_DIR = path.join(UPLOADS_DIR, "videos");
const TEMP_DIR = path.join(UPLOADS_DIR, "temp");
const FONT_NAME = "Noto Sans CJK KR Bold";

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

// ─── ASS 헬퍼 함수들 ───

function formatAssTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/**
 * ASS 파일 헤더 생성
 * @param resX 영상 가로
 * @param resY 영상 세로
 * @param styles 스타일 정의 배열
 */
function assHeader(resX: number, resY: number, styles: string[]): string {
  return `[Script Info]
Title: Marketing Video Overlay
ScriptType: v4.00+
PlayResX: ${resX}
PlayResY: ${resY}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styles.join("\n")}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}

/**
 * ASS 색상 (AABBGGRR 형식)
 * 입력: hex RGB (예: "FFFFFF")
 * 출력: &H00BBGGRR (불투명) or &HAABBGGRR
 */
function assColor(hex: string, alpha: number = 0): string {
  const r = hex.slice(0, 2);
  const g = hex.slice(2, 4);
  const b = hex.slice(4, 6);
  const a = alpha.toString(16).padStart(2, "0").toUpperCase();
  return `&H${a}${b}${g}${r}`;
}

/**
 * 멀티레이어 ASS 자막 파일 생성 (모든 텍스트를 하나의 ASS에)
 */
function createOverlayAss(
  resX: number,
  resY: number,
  duration: number,
  options: {
    subtitleLines?: string[];
    brandName?: string;
    ctaText?: string;
    ctaStartTime?: number;
  }
): string {
  const assPath = path.join(TEMP_DIR, `overlay_${Date.now()}_${crypto.randomBytes(3).toString("hex")}.ass`);
  const start = formatAssTime(0);
  const end = formatAssTime(duration);

  // 스타일 정의
  const styles: string[] = [];

  // 자막 스타일: 하단 중앙, 흰색, 검정 테두리
  // Alignment 2 = 하단 중앙
  styles.push(
    `Style: Subtitle,${FONT_NAME},60,${assColor("FFFFFF")},${assColor("0000FF")},${assColor("000000")},${assColor("000000", 0x80)},-1,0,0,0,100,100,0,0,1,3,1,2,40,40,80,1`
  );

  // 브랜드명 스타일: 상단 중앙, 흰색 80% 투명, 작은 글씨
  // Alignment 8 = 상단 중앙
  styles.push(
    `Style: Brand,${FONT_NAME},36,${assColor("FFFFFF", 0x33)},${assColor("FFFFFF")},${assColor("000000")},${assColor("000000", 0x80)},-1,0,0,0,100,100,0,0,1,2,1,8,40,40,60,1`
  );

  // CTA 스타일: 하단 중앙, 노란색, 큰 글씨, 검정 테두리
  // Alignment 2 = 하단 중앙, MarginV 200으로 올림
  styles.push(
    `Style: CTA,${FONT_NAME},48,${assColor("00FFFF")},${assColor("0000FF")},${assColor("000000")},${assColor("000000", 0x80)},-1,0,0,0,100,100,0,0,1,3,1,2,40,40,200,1`
  );

  let content = assHeader(resX, resY, styles);

  // 자막 이벤트
  if (options.subtitleLines && options.subtitleLines.length > 0) {
    const secondsPerLine = duration / options.subtitleLines.length;
    options.subtitleLines.forEach((line, i) => {
      const ls = formatAssTime(i * secondsPerLine);
      const le = formatAssTime((i + 1) * secondsPerLine);
      content += `Dialogue: 0,${ls},${le},Subtitle,,0,0,0,,${line}\n`;
    });
  }

  // 브랜드명 이벤트 (전체 영상)
  if (options.brandName) {
    content += `Dialogue: 1,${start},${end},Brand,,0,0,0,,${options.brandName}\n`;
  }

  // CTA 이벤트 (마지막 N초)
  if (options.ctaText) {
    const ctaStart = formatAssTime(options.ctaStartTime ?? Math.max(0, duration - 3));
    content += `Dialogue: 2,${ctaStart},${end},CTA,,0,0,0,,${options.ctaText}\n`;
  }

  fs.writeFileSync(assPath, content, "utf-8");
  return assPath;
}

/**
 * 단일 클립용 ASS 파일 생성 (Ken Burns 숏폼용)
 * 클립 전체 시간에 대해 텍스트 오버레이
 */
function createClipAss(
  resX: number,
  resY: number,
  clipDuration: number,
  textEntries: Array<{
    text: string;
    style: "Hook" | "Subtitle" | "CTA" | "Brand";
  }>
): string {
  const assPath = path.join(TEMP_DIR, `clip_ass_${Date.now()}_${crypto.randomBytes(3).toString("hex")}.ass`);
  const start = formatAssTime(0);
  const end = formatAssTime(clipDuration);

  const styles: string[] = [];

  // 훅 텍스트: 중앙 크게, 흰색 + 검정 테두리
  // Alignment 5 = 정중앙
  styles.push(
    `Style: Hook,${FONT_NAME},56,${assColor("FFFFFF")},${assColor("0000FF")},${assColor("000000")},${assColor("000000", 0x80)},-1,0,0,0,100,100,0,0,1,3,1,5,40,40,40,1`
  );

  // 자막: 하단 3/4 지점
  // Alignment 2 = 하단 중앙, MarginV로 위치 조정
  styles.push(
    `Style: Subtitle,${FONT_NAME},44,${assColor("FFFFFF")},${assColor("0000FF")},${assColor("000000")},${assColor("000000", 0x80)},-1,0,0,0,100,100,0,0,1,2,1,2,40,40,${Math.round(resY * 0.25)},1`
  );

  // CTA: 하단 3/4, 노란색
  styles.push(
    `Style: CTA,${FONT_NAME},52,${assColor("00FFFF")},${assColor("0000FF")},${assColor("000000")},${assColor("000000", 0x80)},-1,0,0,0,100,100,0,0,1,3,1,2,40,40,${Math.round(resY * 0.25)},1`
  );

  // 브랜드: 상단 작게
  // Alignment 8 = 상단 중앙
  styles.push(
    `Style: Brand,${FONT_NAME},28,${assColor("FFFFFF", 0x33)},${assColor("FFFFFF")},${assColor("000000")},${assColor("000000", 0x80)},-1,0,0,0,100,100,0,0,1,1,1,8,40,40,50,1`
  );

  let content = assHeader(resX, resY, styles);

  for (const entry of textEntries) {
    content += `Dialogue: 0,${start},${end},${entry.style},,0,0,0,,${entry.text}\n`;
  }

  fs.writeFileSync(assPath, content, "utf-8");
  return assPath;
}

// ─── 영상 유틸리티 ───

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

// ─── 메인 후처리 ───

/**
 * 메인 후처리 함수
 * Minimax 원본 영상에 자막/브랜드/CTA/BGM 추가
 */
export async function postProcessVideo(input: PostProcessInput): Promise<PostProcessResult> {
  try {
    console.log("[FFmpeg] Starting post-processing...");

    // 1. 원본 영상 다운로드
    const rawPath = await downloadVideo(input.rawVideoUrl);
    const duration = getVideoDuration(rawPath);
    console.log(`[FFmpeg] Downloaded: ${rawPath}, duration: ${duration}s`);

    const isSquare = input.outputFormat === "square";
    const W = 1080;
    const H = isSquare ? 1080 : 1920;

    // 2. FFmpeg 필터 체인 구성
    const filters: string[] = [];
    const inputs: string[] = [`-i "${rawPath}"`];
    let audioInput = "";

    // 세로형/정사각 리사이즈
    filters.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black`);

    // 3. 텍스트 오버레이 (ASS 자막 방식 — drawtext 미지원)
    const hasText = (input.subtitleLines && input.subtitleLines.length > 0) || input.brandName || input.ctaText;
    if (hasText) {
      const assPath = createOverlayAss(W, H, duration, {
        subtitleLines: input.subtitleLines,
        brandName: input.brandName,
        ctaText: input.ctaText,
        ctaStartTime: Math.max(0, duration - 3),
      });
      // ass 필터 경로에서 특수문자 이스케이프 (: → \\:)
      const escapedAssPath = assPath.replace(/:/g, "\\:").replace(/\\/g, "/").replace(/\//g, "/");
      filters.push(`ass='${assPath}'`);
    }

    // 4. BGM 삽입
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

    // 실행 (최대 120초)
    execSync(cmd, { timeout: 120000 });

    // 임시 파일 정리
    try { fs.unlinkSync(rawPath); } catch {}

    console.log(`[FFmpeg] Done: ${outputUrl}`);
    return { success: true, outputPath, outputUrl };
  } catch (err: any) {
    console.error("[FFmpeg] Error:", err.message?.slice(0, 1000));
    return { success: false, error: err.message?.slice(0, 1000) };
  }
}

// ─── 프로급 숏폼 영상 (Ken Burns) ───

/**
 * 프로급 숏폼 영상 생성 (릴스/쇼츠 스타일)
 *
 * Ken Burns 효과 (줌인/줌아웃/팬) + 빠른 컷 전환 + 장면별 텍스트
 * 구조:
 *   [0~2.5초] 훅 텍스트 + 사진1 줌인
 *   [2.5~5초] 사진2 + 자막1 + 좌→우 팬
 *   [5~7.5초] 사진3 + 자막2 + 줌아웃
 *   [7.5~10초] 사진4 + 자막3 + 우→좌 팬
 *   [10~12.5초] 사진5 + CTA + 줌인
 *   + BGM 전체
 *
 * NOTE: 모든 텍스트는 ASS 자막으로 처리 (drawtext 미지원)
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

      // ASS 자막으로 텍스트 오버레이 준비
      const textEntries: Array<{ text: string; style: "Hook" | "Subtitle" | "CTA" | "Brand" }> = [];

      if (i === 0 && options.hookText) {
        textEntries.push({ text: options.hookText, style: "Hook" });
      } else if (i === localImages.length - 1 && options.ctaText) {
        textEntries.push({ text: options.ctaText, style: "CTA" });
      } else if (subtitleLines[i - 1]) {
        textEntries.push({ text: subtitleLines[i - 1], style: "Subtitle" });
      }

      if (options.brandName) {
        textEntries.push({ text: options.brandName, style: "Brand" });
      }

      // ASS 필터 구성
      let assFilter = "";
      if (textEntries.length > 0) {
        const assPath = createClipAss(W, H, spi, textEntries);
        assFilter = `,ass='${assPath}'`;
      }

      const cmd = `ffmpeg -y -loop 1 -i "${localImages[i]}" -vf "${effect},format=yuv420p${assFilter}" -t ${spi} -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p "${clipPath}" 2>&1`;

      console.log(`[FFmpeg Shorts] Clip ${i + 1}/${localImages.length}`);
      try {
        execSync(cmd, { timeout: 30000 });
        clipPaths.push(clipPath);
      } catch (clipErr: any) {
        // 클립 실패 시 텍스트 없이 재시도
        console.warn(`[FFmpeg Shorts] Clip ${i + 1} with text failed, retrying without text...`);
        const fallbackCmd = `ffmpeg -y -loop 1 -i "${localImages[i]}" -vf "${effect},format=yuv420p" -t ${spi} -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p "${clipPath}" 2>&1`;
        try {
          execSync(fallbackCmd, { timeout: 30000 });
          clipPaths.push(clipPath);
        } catch (fallbackErr: any) {
          console.error(`[FFmpeg Shorts] Clip ${i + 1} completely failed:`, fallbackErr.message?.slice(0, 300));
        }
      }
    }

    if (clipPaths.length === 0) return { success: false, error: "모든 클립 생성 실패" };

    // 클립들 이어붙이기
    const outputFilename = `shorts_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.mp4`;
    const outputPath = path.join(VIDEOS_DIR, outputFilename);
    const outputUrl = `/uploads/marketing/videos/${outputFilename}`;

    if (clipPaths.length === 1) {
      fs.copyFileSync(clipPaths[0], outputPath);
    } else {
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
      execSync(concatCmd, { timeout: 120000 });

      try { fs.unlinkSync(concatPath); } catch {}
    }

    // 임시 클립 정리
    for (const p of clipPaths) { try { fs.unlinkSync(p); } catch {} }

    console.log(`[FFmpeg Shorts] Done: ${outputUrl}`);
    return { success: true, outputPath, outputUrl };
  } catch (err: any) {
    console.error("[FFmpeg Shorts] Error:", err.message?.slice(0, 1000));
    return { success: false, error: err.message?.slice(0, 1000) };
  }
}
