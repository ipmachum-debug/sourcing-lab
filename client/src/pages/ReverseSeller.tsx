import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Upload,
  FileSpreadsheet,
  Check,
  Store,
  Loader2,
  Info,
} from "lucide-react";

const usd = (n: number) => `$${Math.round(n || 0).toLocaleString("en-US")}`;

interface SellerRow {
  spuId?: string;
  barcode?: string;
  productName: string;
  brand?: string;
  category?: string;
  size?: string;
  priceUsd: number;
  soldCount: number;
}

// "$345" · "345.0" · "1,234" → 345 / 1234
function parseUsd(v: unknown): number {
  const s = String(v ?? "").replace(/[$,\s₩¥]/g, "");
  const m = s.match(/([0-9]+(?:\.[0-9]+)?)/);
  return m ? Math.round(parseFloat(m[1])) : 0;
}

// 중국 총 판매량: "<5"→5, "300+"→300, "53,000+"→53000, "--"/""→0
function parseSold(v: unknown): number {
  const s = String(v ?? "").trim();
  if (!s || s === "--" || s === "-") return 0;
  const m = s.replace(/,/g, "").match(/([0-9]+)/);
  return m ? parseInt(m[1], 10) : 0;
}

// POIZON 판매자센터 컬럼 헤더 매칭 (전체 내보내기 엑셀)
function colIndex(headers: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  headers.forEach((raw, i) => {
    const h = String(raw || "").trim().toLowerCase().replace(/\s+/g, "");
    if (idx.spuId == null && /spuid/.test(h)) idx.spuId = i;
    else if (idx.barcode == null && /바코드|barcode|gtin/.test(h)) idx.barcode = i;
    else if (idx.productName == null && /^상품명|productname/.test(h))
      idx.productName = i;
    else if (idx.brand == null && /브랜드|brand/.test(h)) idx.brand = i;
    else if (idx.category == null && /대분류|카테고리대|category.*1|maincategory/.test(h))
      idx.category = i;
    else if (idx.size == null && /사이즈|옵션|색상|size/.test(h)) idx.size = i;
    else if (idx.priceUsd == null && /평균거래가|30일|거래가|avgprice/.test(h))
      idx.priceUsd = i;
    else if (idx.soldCount == null && /중국총판매량|총판매량|중국.*판매|판매량|soldcount|salesvolume/.test(h))
      idx.soldCount = i;
  });
  return idx;
}

async function parseWorkbook(
  buf: ArrayBuffer
): Promise<{ rows: SellerRow[]; skipped: number }> {
  // xlsx(SheetJS ~600KB)는 업로드 시에만 지연 로드 → 초기 번들 경량화
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    blankrows: false,
    defval: "",
  });
  if (aoa.length < 2) return { rows: [], skipped: 0 };
  const headers = (aoa[0] as unknown[]).map(c => String(c ?? ""));
  const idx = colIndex(headers);
  const rows: SellerRow[] = [];
  let skipped = 0;
  for (let i = 1; i < aoa.length; i++) {
    const cells = aoa[i] as unknown[];
    const name =
      idx.productName != null
        ? String(cells[idx.productName] ?? "").trim()
        : "";
    if (!name) {
      skipped++;
      continue;
    }
    rows.push({
      spuId:
        idx.spuId != null
          ? String(cells[idx.spuId] ?? "").trim().slice(0, 60) || undefined
          : undefined,
      barcode:
        idx.barcode != null
          ? String(cells[idx.barcode] ?? "").trim().slice(0, 40) || undefined
          : undefined,
      productName: name.slice(0, 300),
      brand:
        idx.brand != null
          ? String(cells[idx.brand] ?? "").trim().slice(0, 100) || undefined
          : undefined,
      category:
        idx.category != null
          ? String(cells[idx.category] ?? "").trim().slice(0, 40) || undefined
          : undefined,
      size:
        idx.size != null
          ? String(cells[idx.size] ?? "").trim().slice(0, 40) || undefined
          : undefined,
      priceUsd: idx.priceUsd != null ? parseUsd(cells[idx.priceUsd]) : 0,
      soldCount: idx.soldCount != null ? parseSold(cells[idx.soldCount]) : 0,
    });
  }
  return { rows, skipped };
}

const CHUNK = 1000;

export default function ReverseSeller() {
  const [rows, setRows] = useState<SellerRow[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [result, setResult] = useState<{
    observations: number;
    spus: number;
    pool: number;
  } | null>(null);

  const [onlyTradable, setOnlyTradable] = useState(true);
  const importMut = trpc.reverseDeals.sellerImport.useMutation();
  const apiStatus = trpc.reverseDeals.openApiStatus.useQuery();

  // 실제로 거래되는 것만: 시세($) + 판매량 둘 다 있는 SKU (죽은 SKU 제외)
  const tradable = rows.filter(r => r.priceUsd > 0 && r.soldCount > 0);
  const active = onlyTradable ? tradable : rows;

  const onFile = async (f: File) => {
    setParsing(true);
    setResult(null);
    setProgress(null);
    setFileName(f.name);
    try {
      const buf = await f.arrayBuffer();
      const { rows: parsed, skipped: sk } = await parseWorkbook(buf);
      setRows(parsed);
      setSkipped(sk);
      if (parsed.length === 0)
        toast.error("인식된 행이 없어요. 판매자센터 '전체 내보내기' 엑셀이 맞는지 확인하세요.");
      else toast.success(`${parsed.length.toLocaleString()}개 SKU 인식`);
    } catch (e: any) {
      toast.error(`엑셀 읽기 실패: ${e?.message ?? e}`);
    } finally {
      setParsing(false);
    }
  };

  const upload = async () => {
    const up = active;
    if (up.length === 0) return toast.error("업로드할 행이 없어요");
    const chunks: SellerRow[][] = [];
    for (let i = 0; i < up.length; i += CHUNK) chunks.push(up.slice(i, i + CHUNK));
    setProgress({ done: 0, total: up.length });
    let observations = 0,
      spus = 0,
      pool = 0;
    try {
      for (let c = 0; c < chunks.length; c++) {
        const r = await importMut.mutateAsync({ rows: chunks[c] });
        observations += r.observations;
        spus += r.spus;
        pool += r.pool;
        setProgress({
          done: Math.min(up.length, (c + 1) * CHUNK),
          total: up.length,
        });
      }
      setResult({ observations, spus, pool });
      setProgress(null);
      toast.success(`업로드 완료 · 관측 ${observations.toLocaleString()}건`);
    } catch (e: any) {
      setProgress(null);
      toast.error(`업로드 중단: ${e?.message ?? e}`);
    }
  };

  const busy = importMut.isPending || !!progress;

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10">
        <div className="max-w-5xl mx-auto space-y-6">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest neon-chip neon-magenta px-3 py-1 rounded-full uppercase">
              <Store className="h-3.5 w-3.5" /> Seller Excel
            </span>
            <h1 className="text-3xl font-black mt-4 neon-text">판매자센터 엑셀 업로드</h1>
            <p className="text-slate-300/80 mt-2">
              POIZON <b className="text-white">판매자센터 → 전체 내보내기</b> 엑셀을 그대로 올리세요.
              공식 <b className="text-fuchsia-300">30일 평균 거래가($)</b>·중국 판매량·카테고리를
              <b className="text-white"> SPU_ID 기준</b>으로 정확히 적립합니다.
            </p>
          </div>

          <div className="glass rounded-2xl p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="neon-btn rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5 cursor-pointer">
                {parsing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                엑셀 파일 선택 (.xlsx)
                <input
                  type="file"
                  accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  disabled={parsing || busy}
                  onChange={e => e.target.files?.[0] && onFile(e.target.files[0])}
                />
              </label>
              {fileName && (
                <span className="text-[13px] text-slate-400 flex items-center gap-1.5">
                  <FileSpreadsheet className="h-4 w-4 text-fuchsia-300" />
                  {fileName}
                </span>
              )}
            </div>
            <p className="text-[12px] text-slate-400 flex items-start gap-1.5">
              <Info className="h-4 w-4 mt-0.5 shrink-0 text-fuchsia-300" />
              시세는 <b className="text-slate-200">중국 시장(득물) 달러($)</b> 기준입니다. 순이익은
              환율(원/$)로 환산해 <b className="text-white">소싱 큐 · 오늘 사야 할 상품</b>에 반영돼요.
            </p>
            {apiStatus.data && (
              <p className="text-[11px] text-slate-500 flex items-start gap-1.5">
                <span className={`mt-1 h-2 w-2 rounded-full shrink-0 ${apiStatus.data.configured ? "bg-emerald-400" : "bg-slate-600"}`} />
                <span>
                  <b className="text-slate-400">자동 동기화(Phase 2):</b> {apiStatus.data.note}
                </span>
              </p>
            )}
          </div>

          {rows.length > 0 && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Tile label="인식 SKU" value={rows.length.toLocaleString()} />
                <Tile label="거래 SKU (시세+판매량)" value={tradable.length.toLocaleString()} tone="good" />
                <Tile
                  label="상품(SPU)"
                  value={new Set(active.map(r => r.spuId || r.productName)).size.toLocaleString()}
                />
                <Tile
                  label="업로드 대상"
                  value={active.length.toLocaleString()}
                  tone="good"
                />
              </div>

              {/* 죽은 SKU(시세·판매량 없음) 제외 토글 */}
              <label className="glass rounded-xl px-4 py-3 flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyTradable}
                  onChange={e => setOnlyTradable(e.target.checked)}
                  className="accent-fuchsia-500 h-4 w-4"
                />
                <span className="text-sm text-slate-200">
                  <b className="text-white">거래되는 것만 올리기</b> — 시세($)·판매량이 모두 있는 SKU만.
                  {rows.length > tradable.length && (
                    <span className="text-slate-400">
                      {" "}죽은 SKU {(rows.length - tradable.length).toLocaleString()}개 제외.
                    </span>
                  )}
                </span>
              </label>

              <div className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  {progress && (
                    <div>
                      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full bg-fuchsia-400 transition-all"
                          style={{
                            width: `${Math.round((progress.done / progress.total) * 100)}%`,
                          }}
                        />
                      </div>
                      <p className="text-[12px] text-slate-400 mt-1">
                        업로드 중… {progress.done.toLocaleString()} /{" "}
                        {progress.total.toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>
                <button
                  onClick={upload}
                  disabled={busy || active.length === 0}
                  className="neon-btn rounded-lg px-5 py-2 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-40 shrink-0"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {busy ? "업로드 중…" : `${active.length.toLocaleString()}개 업로드`}
                </button>
              </div>

              {result && (
                <p className="text-sm text-emerald-300 flex items-center gap-1.5 flex-wrap">
                  <Check className="h-4 w-4" /> 완료 — 관측{" "}
                  {result.observations.toLocaleString()}건 · 상품 {result.spus.toLocaleString()}개 ·
                  시세 풀 {result.pool.toLocaleString()}건 적립.
                  <a href="/reverse/queue" className="underline text-fuchsia-300">
                    소싱 큐에서 발굴 대상 보기 →
                  </a>
                </p>
              )}

              <div className="glass rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[720px]">
                    <thead className="bg-white/5 text-xs text-slate-400">
                      <tr>
                        <th className="text-left font-medium px-3 py-2.5">SPU / 상품</th>
                        <th className="text-center font-medium px-3 py-2.5">카테고리</th>
                        <th className="text-center font-medium px-3 py-2.5">사이즈</th>
                        <th className="text-right font-medium px-3 py-2.5">30일 평균가</th>
                        <th className="text-right font-medium px-3 py-2.5">중국 판매량</th>
                      </tr>
                    </thead>
                    <tbody>
                      {active.slice(0, 30).map((r, i) => (
                        <tr key={i} className="border-t border-white/8">
                          <td className="px-3 py-2">
                            <p className="text-slate-100 truncate max-w-[300px]">
                              {r.productName}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {r.brand || "-"}
                              {r.spuId && (
                                <span className="text-slate-600"> · SPU {r.spuId}</span>
                              )}
                              {r.barcode && (
                                <span className="text-slate-600"> · {r.barcode}</span>
                              )}
                            </p>
                          </td>
                          <td className="text-center px-3 py-2 text-slate-400 text-xs">
                            {r.category || "-"}
                          </td>
                          <td className="text-center px-3 py-2 text-slate-300">
                            {r.size || "-"}
                          </td>
                          <td className="text-right px-3 py-2 text-emerald-300 font-medium">
                            {r.priceUsd ? usd(r.priceUsd) : "-"}
                          </td>
                          <td className="text-right px-3 py-2 text-slate-400">
                            {r.soldCount ? r.soldCount.toLocaleString() : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {active.length > 30 && (
                  <p className="text-center text-[11px] text-slate-500 py-2">
                    …외 {(active.length - 30).toLocaleString()}건
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

function Tile({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: string;
  tone?: "normal" | "good" | "warn";
}) {
  const c =
    tone === "good"
      ? "text-emerald-300"
      : tone === "warn"
        ? "text-amber-300"
        : "text-white";
  return (
    <div className="glass rounded-xl p-3">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className={`text-lg font-black mt-1 ${c}`}>{value}</p>
    </div>
  );
}
