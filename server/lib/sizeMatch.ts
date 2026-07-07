// ============================================================
// sizeMatch.ts — POIZON SKU 사이즈 정제 + 한국(mm) 매칭
// ============================================================
// POIZON 사이즈 칼럼은 색상·사이즈·변형이 뒤섞인 원문 속성 문자열이다.
//   예) "색상:블랙 (신발 플라워 사이즈);사이즈:EU 37-38"
//       "사이즈:KR 300;색상:블랙 + 신발 플라워"
// 표기 단위도 상품마다 제각각(KR mm / EU / US). 여기서 사이즈만 뽑아 정제하고,
// 한국 mm는 신뢰 가능한 경우(이미 KR/mm 표기)만 숫자로 환산한다.
//   ※ EU·US→KR은 브랜드별 편차(크록스 EU→KR ≠ 나이키)가 커서 자동 변환하지 않는다.
//     (잘못된 사이즈 매입 방지) — 브랜드별 대조표는 판매자 가이드 참조.

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
 * 정제된 사이즈 라벨 → 한국 mm(신발). 이미 KR/mm 표기이거나 단위 없는 200~360 숫자만 환산.
 * EU/US/UK/JP 등 다른 규격은 브랜드 편차가 커서 null(자동 변환 안 함).
 */
export function krMmOf(label: string | null | undefined): number | null {
  if (!label) return null;
  const up = label.toUpperCase();
  const nums = (label.match(/\d{2,3}/g) ?? []).map(Number);
  if (nums.length === 0) return null;
  const n = nums[0];
  const hasKr = /KR|MM|한국/.test(up);
  const hasForeign = /EU|US|UK|JP|CN|FR|CM/.test(up);
  if (hasKr && n >= 150 && n <= 360) return n;
  if (!hasForeign && !hasKr && n >= 200 && n <= 360) return n; // 단위 없는 mm로 간주
  return null;
}

export interface SizeInfo {
  label: string | null; // 정제 사이즈
  krMm: number | null; // 한국 mm(신뢰 가능 시)
}

export function parseSize(raw: string | null | undefined): SizeInfo {
  const label = cleanSizeLabel(raw);
  return { label, krMm: krMmOf(label) };
}
