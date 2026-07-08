// ============================================================
// sizeMatch.ts — POIZON SKU 사이즈 정제 + 한국(mm) 매칭/변환
// ============================================================
// POIZON 사이즈 칼럼은 색상·사이즈·변형이 뒤섞인 원문 속성 문자열이다.
//   예) "색상:블랙 (신발 플라워 사이즈);사이즈:EU 37-38"
//       "사이즈:KR 300;색상:블랙 + 신발 플라워"
// 표기 단위도 상품마다 제각각(KR mm / EU / US / CHN). 여기서 사이즈만 뽑아 정제하고,
// 한국 mm로 환산한다.
//   변환 우선순위(안전): ① KR/mm/CHN 직접 표기 → ② EU 범위표 → ③ US(M/W)표.
//   ※ EU·US→KR은 브랜드별 실측 편차가 있으므로, POIZON이 mm/CHN을 직접 주면 항상 그걸 우선.
//     (잘못된 사이즈 매입 방지) EU/US 변환은 아래 POIZON 표준표 기반의 근사값이다.

// ── POIZON 표준 사이즈 변환표 (EU / US(M·W) / CHN=KR(mm) / 발길이cm) ──
//   KR(mm) = CHN = 발길이cm × 10. 이 표를 단일 기준으로 삼는다.
export interface SizeChartRow {
  eu: string; // EU 범위 표기(POIZON 원문과 동일)
  usM: number; // US 남성
  usW: number | null; // US 여성(없으면 null)
  mm: number; // CHN = KR(mm)
  footCm: number; // 발길이(cm)
}
export const SIZE_CHART: SizeChartRow[] = [
  { eu: "33-34", usM: 2, usW: 4, mm: 200, footCm: 20 },
  { eu: "34-35", usM: 3, usW: 5, mm: 210, footCm: 21 },
  { eu: "36-37", usM: 4, usW: 6, mm: 220, footCm: 22 },
  { eu: "37-38", usM: 5, usW: 7, mm: 230, footCm: 23 },
  { eu: "38-39", usM: 6, usW: 8, mm: 240, footCm: 24 },
  { eu: "39-40", usM: 7, usW: 9, mm: 250, footCm: 25 },
  { eu: "41-42", usM: 8, usW: 10, mm: 260, footCm: 26 },
  { eu: "42-43", usM: 9, usW: 11, mm: 270, footCm: 27 },
  { eu: "43-44", usM: 10, usW: 12, mm: 280, footCm: 28 },
  { eu: "45-46", usM: 11, usW: null, mm: 290, footCm: 29 },
  { eu: "46-47", usM: 12, usW: null, mm: 300, footCm: 30 },
  { eu: "48-49", usM: 13, usW: null, mm: 310, footCm: 31 },
];

// 빠른 조회 맵 (기준표에서 파생)
const EU_TO_MM = new Map<string, number>(); // "42-43" → 270 (+ 각 끝값도 보조 등록)
const US_M_TO_MM = new Map<number, number>(); // 9 → 270
const US_W_TO_MM = new Map<number, number>(); // 11 → 270
for (const r of SIZE_CHART) {
  EU_TO_MM.set(r.eu, r.mm);
  US_M_TO_MM.set(r.usM, r.mm);
  if (r.usW != null) US_W_TO_MM.set(r.usW, r.mm);
}

/** key:value 세그먼트에서 key가 정규식에 맞으면 value 반환. */
function segValue(seg: string, keyRe: RegExp): string | null {
  const i = seg.search(/[:：]/);
  if (i < 0) return null;
  const key = seg.slice(0, i);
  if (!keyRe.test(key)) return null;
  return seg.slice(i + 1).trim();
}

/** 원문 속성 문자열 → 사이즈만 정제("EU 42-43", "270" 등). 색상·괄호주석 제거. */
export function cleanSizeLabel(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const segs = s
    .split(/[;；]/)
    .map(x => x.trim())
    .filter(Boolean);

  // 1) '사이즈:'/'size:'/'규격:' 키를 가진 세그먼트 우선
  let val: string | null = null;
  for (const seg of segs) {
    const v = segValue(seg, /사이즈|size|규격/i);
    if (v) {
      val = v;
      break;
    }
  }
  // 2) 키가 없으면 색상 세그먼트를 제외한 첫 값
  if (val == null) {
    const nonColor = segs.find(x => {
      const i = x.search(/[:：]/);
      const key = i < 0 ? "" : x.slice(0, i);
      return !/색상|컬러|color/i.test(key);
    });
    val = nonColor ?? segs[0] ?? s;
    const i = val.search(/[:：]/);
    if (i >= 0) val = val.slice(i + 1).trim();
  }

  // 괄호 주석 제거: "(신발 플라워 사이즈)", "(스마트 스타 5개 포함)"
  val = val
    .replace(/[（(][^）)]*[）)]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return val.slice(0, 24) || null;
}

/**
 * 정제된 사이즈 라벨 → 한국 mm(신발).
 *   ① KR/mm/CHN 직접 표기(또는 단위 없는 200~360) → 그 값
 *   ② EU 범위("42-43") → 표준표
 *   ③ US(M9·W11·9) → 표준표(플레인 US 숫자는 남성 기준)
 * 인식 불가면 null.
 */
export function krMmOf(label: string | null | undefined): number | null {
  if (!label) return null;
  const up = label.toUpperCase().replace(/\s+/g, " ").trim();
  const nums = (up.match(/\d{2,3}/g) ?? []).map(Number);

  // ① KR/mm/CHN 직접 표기 → 실측값 우선(반올림/스냅 없음: 265 같은 반사이즈 보존)
  if (/KR|MM|CHN|CN|한국/.test(up)) {
    const n = nums.find(x => x >= 150 && x <= 360);
    if (n != null) return n;
  }

  // ② EU 범위 → 표준표
  const euRange = up.match(/EU\s*(\d{2}\s*-\s*\d{2})/);
  if (euRange) {
    const key = euRange[1].replace(/\s+/g, "");
    const mm = EU_TO_MM.get(key);
    if (mm != null) return mm;
  }

  // ③ US(M/W) → 표준표
  const mM = up.match(/M\s*(\d{1,2})/);
  const mW = up.match(/W\s*(\d{1,2})/);
  if (mM && US_M_TO_MM.has(Number(mM[1]))) return US_M_TO_MM.get(Number(mM[1]))!;
  if (mW && US_W_TO_MM.has(Number(mW[1]))) return US_W_TO_MM.get(Number(mW[1]))!;
  const usPlain = up.match(/US\s*(\d{1,2})/);
  if (usPlain && US_M_TO_MM.has(Number(usPlain[1]))) return US_M_TO_MM.get(Number(usPlain[1]))!;

  // ④ 단위 표기가 전혀 없고 200~360 숫자면 mm로 간주
  if (!/EU|US|UK|JP|FR/.test(up)) {
    const n = nums.find(x => x >= 200 && x <= 360);
    if (n != null) return n;
  }
  return null;
}

/** KR(mm) → 모든 규격(EU/US/발길이) 역변환. 표에 없으면 null. UI 사이즈 가이드용. */
export function sizeSystemsOf(krMm: number | null | undefined): SizeChartRow | null {
  if (krMm == null) return null;
  return SIZE_CHART.find(r => r.mm === krMm) ?? null;
}

export interface SizeInfo {
  label: string | null; // 정제 사이즈(원본 규격 표기)
  krMm: number | null; // 한국 mm
  chart: SizeChartRow | null; // krMm에 대응하는 전체 규격표(있으면)
}

export function parseSize(raw: string | null | undefined): SizeInfo {
  const label = cleanSizeLabel(raw);
  const krMm = krMmOf(label);
  return { label, krMm, chart: sizeSystemsOf(krMm) };
}
