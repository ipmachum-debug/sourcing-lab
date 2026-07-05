import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, Upload, FileDown, ClipboardPaste, X } from "lucide-react";
import {
  mapRows,
  readFileText,
  downloadCsv,
  toCsv,
  type FieldSpec,
} from "@/lib/csv";

interface Props {
  /** 다운로드 파일명(확장자 자동) */
  filename: string;
  /** 내보낼 데이터 — 호출 시점의 최신값 반환 */
  onExport: () => { headers: string[]; rows: (string | number | null | undefined)[][] };
  /** 가져오기 컬럼 스펙 (없으면 업로드 버튼 숨김) */
  importSpecs?: FieldSpec[];
  /** 필수 컬럼 key (이 값 없으면 행 제외) */
  requiredKey?: string;
  /** 템플릿 헤더 라벨 (다운로드용) */
  templateHeaders?: string[];
  /** 예시 행(선택) */
  templateExample?: (string | number)[][];
  /** 파싱된 행 업로드 처리 */
  onImport?: (rows: Record<string, any>[]) => void;
  importing?: boolean;
  /** 미리보기 컬럼(표시용 key 순서). 없으면 spec key 순 */
  previewKeys?: string[];
}

export default function ImportExportBar({
  filename,
  onExport,
  importSpecs,
  requiredKey = "productName",
  templateHeaders,
  templateExample,
  onImport,
  importing,
  previewKeys,
}: Props) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");

  const parsed = useMemo(
    () => (importSpecs ? mapRows(raw, importSpecs, requiredKey) : { rows: [], skipped: 0 }),
    [raw, importSpecs, requiredKey]
  );

  const doExport = () => {
    const { headers, rows } = onExport();
    if (rows.length === 0) return toast.info("내보낼 데이터가 없어요");
    downloadCsv(filename, toCsv(headers, rows));
    toast.success(`${rows.length}건 다운로드`);
  };

  const doTemplate = () => {
    if (!templateHeaders) return;
    downloadCsv(
      filename.replace(/\.csv$/, "") + "_템플릿",
      toCsv(templateHeaders, templateExample ?? [])
    );
  };

  const onFile = async (f: File) => setRaw(await readFileText(f));

  const doImport = () => {
    if (!onImport) return;
    if (parsed.rows.length === 0) return toast.error("가져올 행이 없어요");
    onImport(parsed.rows);
  };

  const keys = previewKeys ?? importSpecs?.map(s => s.key) ?? [];

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <button
          onClick={doExport}
          className="neon-chip rounded-lg px-3 py-1.5 text-sm text-slate-200 flex items-center gap-1.5"
        >
          <Download className="h-4 w-4" /> 다운로드
        </button>
        {importSpecs && onImport && (
          <button
            onClick={() => setOpen(o => !o)}
            className="neon-chip rounded-lg px-3 py-1.5 text-sm text-slate-200 flex items-center gap-1.5"
          >
            <Upload className="h-4 w-4" /> 업로드
          </button>
        )}
      </div>

      {open && importSpecs && onImport && (
        <div className="absolute right-0 z-30 mt-2 w-[min(92vw,540px)] glass rounded-2xl p-4 shadow-2xl border border-white/10">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-slate-100">엑셀 / CSV 업로드</p>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-2">
            {templateHeaders && (
              <button onClick={doTemplate} className="neon-chip rounded-lg px-2.5 py-1.5 text-xs text-slate-200 flex items-center gap-1.5">
                <FileDown className="h-3.5 w-3.5" /> 템플릿
              </button>
            )}
            <label className="neon-chip rounded-lg px-2.5 py-1.5 text-xs text-slate-200 flex items-center gap-1.5 cursor-pointer">
              <Upload className="h-3.5 w-3.5" /> CSV 파일
              <input type="file" accept=".csv,text/csv" className="hidden"
                onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
            <span className="text-[11px] text-slate-500 flex items-center gap-1">
              <ClipboardPaste className="h-3.5 w-3.5" /> 엑셀 복사→붙여넣기 OK
            </span>
          </div>

          <textarea
            value={raw}
            onChange={e => setRaw(e.target.value)}
            placeholder={"엑셀에서 헤더 포함 범위를 복사해 붙여넣으세요"}
            className="w-full h-28 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-slate-600 outline-none focus:border-fuchsia-400/60 font-mono resize-y"
          />

          {parsed.rows.length > 0 && (
            <div className="mt-2 max-h-32 overflow-auto rounded-lg border border-white/10">
              <table className="w-full text-[11px]">
                <thead className="bg-white/5 text-slate-400 sticky top-0">
                  <tr>{keys.map(k => <th key={k} className="text-left px-2 py-1 font-medium">{k}</th>)}</tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 8).map((r, i) => (
                    <tr key={i} className="border-t border-white/8">
                      {keys.map(k => <td key={k} className="px-2 py-1 text-slate-300 truncate max-w-[120px]">{String(r[k] ?? "")}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between mt-3">
            <p className="text-xs text-slate-400">
              인식 <b className="text-emerald-300">{parsed.rows.length}</b>건
              {parsed.skipped > 0 && <span className="text-amber-400"> · 무시 {parsed.skipped}</span>}
            </p>
            <button onClick={doImport} disabled={importing || parsed.rows.length === 0}
              className="neon-btn rounded-lg px-4 py-1.5 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-40">
              <Upload className="h-4 w-4" /> {importing ? "업로드 중…" : `${parsed.rows.length}건 등록`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
