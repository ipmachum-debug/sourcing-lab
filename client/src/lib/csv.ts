// ============================================================
// csv.ts — 의존성 없는 CSV/엑셀 붙여넣기 파싱 + 다운로드 유틸
// ============================================================
// 엑셀 → CSV 저장 또는 범위 복사(TSV) 모두 지원. BOM 포함 다운로드(한글 안 깨짐).

export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error);
    r.readAsText(file, "utf-8");
  });
}

/** 탭/콤마 자동 인식 + 따옴표 제거. 첫 줄은 헤더. */
export function parseDelimited(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const split = (l: string) =>
    l.split(delim).map(c => c.trim().replace(/^"(.*)"$/, "$1"));
  const headers = split(lines[0]);
  const rows = lines.slice(1).map(split);
  return { headers, rows };
}

export interface FieldSpec {
  key: string;
  alias: RegExp; // 헤더 매칭 (소문자·공백/괄호 제거 후)
  type?: "number" | "string";
}

function toNum(s: string): number {
  const m = String(s || "").replace(/[,\s₩원¥%]/g, "").match(/(-?[0-9]+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/** 파싱된 표 → 스펙에 따라 객체 배열. requiredKey 없는 행은 제외. */
export function mapRows(
  text: string,
  specs: FieldSpec[],
  requiredKey: string
): { rows: Record<string, any>[]; skipped: number } {
  const { headers, rows } = parseDelimited(text);
  if (rows.length === 0) return { rows: [], skipped: 0 };
  const norm = (h: string) => h.trim().toLowerCase().replace(/[\s()]/g, "");
  const colKey = headers.map(h => {
    const n = norm(h);
    const spec = specs.find(s => s.alias.test(n));
    return spec ? spec.key : null;
  });
  const typeOf = (k: string) => specs.find(s => s.key === k)?.type ?? "string";
  const out: Record<string, any>[] = [];
  let skipped = 0;
  for (const cells of rows) {
    const obj: Record<string, any> = {};
    colKey.forEach((k, idx) => {
      if (!k) return;
      const raw = cells[idx] ?? "";
      obj[k] = typeOf(k) === "number" ? toNum(raw) : raw.trim();
    });
    if (!obj[requiredKey] || String(obj[requiredKey]).trim() === "") {
      skipped++;
      continue;
    }
    out.push(obj);
  }
  return { rows: out, skipped };
}

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(
  headers: string[],
  rows: (string | number | null | undefined)[][]
): string {
  const head = headers.map(csvCell).join(",");
  const body = rows.map(r => r.map(csvCell).join(",")).join("\n");
  return head + "\n" + body;
}

/** BOM 포함 CSV 다운로드 (엑셀 한글 정상 표시). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : filename + ".csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}
