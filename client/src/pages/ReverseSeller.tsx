import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { KRW_USD_RATE } from "@shared/const";
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
  skuId?: string;
  barcode?: string;
  productName: string;
  brand?: string;
  category?: string;
  size?: string;
  priceUsd: number;
  soldCount: number;
  expectedProfitUsd?: number;
  lowestBidUsd?: number;
  bidAvailable?: boolean;
  bidStatus?: string;
  localSellerCount?: number;
}

type Currency = "USD" | "KRW";

// 셀에서 숫자만 추출 (통화기호·문자·콤마 제거). 음수·소수 유지.
function rawNumber(v: unknown): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const neg = /^-|^\(/.test(s);
  const digits = s.replace(/[^0-9.]/g, "");
  if (!digits) return null;
  const n = parseFloat(digits);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

// ★ POIZON 한국 로케일 엑셀은 금액이 "KRW162,000"·"162,000원" 문자열.
//   셀에 KRW/₩/원 마커 → KRW / $ 마커 → USD / 없으면 파일 통화(fileCur) 적용.
//   KRW면 환율로 나눠 USD로 정규화(엔진은 중국시장 달러 기준).
function parseMoney(
  v: unknown,
  fileCur: Currency,
  rate = KRW_USD_RATE
): number | undefined {
  const n = rawNumber(v);
  if (n === null) return undefined;
  const s = String(v ?? "");
  const isKrw = /krw|₩|원/i.test(s);
  const isUsd = /\$/.test(s);
  const cur: Currency = isKrw ? "KRW" : isUsd ? "USD" : fileCur;
  return cur === "KRW" ? Math.round(n / rate) : Math.round(n);
}

// 파일 통화 감지: 금액 컬럼(거래가/입찰/수익) 원본 셀을 스캔.
//   KRW/₩/원 마커 있으면 KRW, $ 있으면 USD, 없으면 값 크기로 판정(중앙값>3000 → KRW).
function detectCurrency(samples: unknown[]): Currency {
  let krwMark = 0, usdMark = 0;
  const nums: number[] = [];
  for (const v of samples) {
    const s = String(v ?? "");
    if (/krw|₩|원/i.test(s)) krwMark++;
    else if (/\$/.test(s)) usdMark++;
    const n = rawNumber(v);
    if (n != null && n > 0) nums.push(Math.abs(n));
  }
  if (krwMark > usdMark && krwMark > 0) return "KRW";
  if (usdMark > 0) return "USD";
  if (nums.length) {
    const sorted = nums.sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    return med > 3000 ? "KRW" : "USD"; // USD 시세는 보통 수백, KRW는 수만~수십만
  }
  return "USD";
}

// 입찰 가능 여부: 1/Y/가능 → true, 0/N/불가 → false
function parseBool(v: unknown): boolean | undefined {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return undefined;
  if (/^(1|y|yes|true|가능|예|o|available)/.test(s)) return true;
  if (/^(0|n|no|false|불가|아니오|x|unavailable)/.test(s)) return false;
  return undefined;
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
    if (idx.spuId == null && /^spuid|spu.*id/.test(h)) idx.spuId = i;
    else if (idx.skuId == null && /^skuid|sku.*id/.test(h)) idx.skuId = i;
    else if (idx.barcode == null && /바코드|barcode|gtin/.test(h)) idx.barcode = i;
    else if (idx.productName == null && /^상품명|productname/.test(h))
      idx.productName = i;
    else if (idx.brand == null && /브랜드|brand/.test(h)) idx.brand = i;
    else if (idx.category == null && /대분류|카테고리대|category.*1|maincategory/.test(h))
      idx.category = i;
    else if (idx.size == null && /사이즈|옵션|색상|size/.test(h)) idx.size = i;
    else if (idx.priceUsd == null && /평균거래가|30일|거래가|avgprice/.test(h))
      idx.priceUsd = i;
    else if (idx.expectedProfit == null && /예상수익|예상\s*수익|expected.*profit|estprofit/.test(h))
      idx.expectedProfit = i;
    else if (idx.lowestBid == null && /최저입찰|최저\s*입찰|현재.*입찰|lowest.*bid|lowbid/.test(h))
      idx.lowestBid = i;
    else if (idx.bidAvailable == null && /입찰가능|입찰\s*가능|bid.*available|입찰여부/.test(h))
      idx.bidAvailable = i;
    else if (idx.bidStatus == null && /입찰상태|입찰\s*상태|bid.*status/.test(h))
      idx.bidStatus = i;
    else if (idx.localSeller == null && /현지판매자|현지\s*판매자|local.*seller/.test(h))
      idx.localSeller = i;
    else if (idx.soldCount == null && /중국총판매량|총판매량|중국.*판매|판매량|soldcount|salesvolume/.test(h))
      idx.soldCount = i;
  });
  return idx;
}

async function parseWorkbook(
  buf: ArrayBuffer,
  rate: number
): Promise<{ rows: SellerRow[]; skipped: number; currency: Currency; converted: number }> {
  // xlsx(SheetJS ~600KB)는 업로드 시에만 지연 로드 → 초기 번들 경량화
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    blankrows: false,
    defval: "",
  });
  if (aoa.length < 2) return { rows: [], skipped: 0, currency: "USD", converted: 0 };
  const headers = (aoa[0] as unknown[]).map(c => String(c ?? ""));
  const idx = colIndex(headers);
  const body = aoa.slice(1);

  // ★ 파일 통화 감지 — 금액 컬럼(거래가·입찰·수익) 원본 셀 샘플로.
  const moneyCols = [idx.priceUsd, idx.lowestBid, idx.expectedProfit].filter(
    (c): c is number => c != null
  );
  const samples: unknown[] = [];
  for (const row of body) {
    for (const c of moneyCols) samples.push((row as unknown[])[c]);
    if (samples.length > 2000) break;
  }
  const currency = detectCurrency(samples);

  const rows: SellerRow[] = [];
  let skipped = 0;
  let converted = 0;
  for (let i = 0; i < body.length; i++) {
    const cells = body[i] as unknown[];
    const name =
      idx.productName != null
        ? String(cells[idx.productName] ?? "").trim()
        : "";
    if (!name) {
      skipped++;
      continue;
    }
    if (currency === "KRW") converted++;
    rows.push({
      spuId:
        idx.spuId != null
          ? String(cells[idx.spuId] ?? "").trim().slice(0, 60) || undefined
          : undefined,
      skuId:
        idx.skuId != null
          ? String(cells[idx.skuId] ?? "").trim().slice(0, 60) || undefined
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
      priceUsd:
        idx.priceUsd != null ? parseMoney(cells[idx.priceUsd], currency, rate) ?? 0 : 0,
      soldCount: idx.soldCount != null ? parseSold(cells[idx.soldCount]) : 0,
      expectedProfitUsd:
        idx.expectedProfit != null
          ? parseMoney(cells[idx.expectedProfit], currency, rate)
          : undefined,
      lowestBidUsd:
        idx.lowestBid != null ? parseMoney(cells[idx.lowestBid], currency, rate) : undefined,
      bidAvailable:
        idx.bidAvailable != null ? parseBool(cells[idx.bidAvailable]) : undefined,
      bidStatus:
        idx.bidStatus != null
          ? String(cells[idx.bidStatus] ?? "").trim().slice(0, 24) || undefined
          : undefined,
      localSellerCount:
        idx.localSeller != null ? parseSold(cells[idx.localSeller]) : undefined,
    });
  }
  return { rows, skipped, currency, converted };
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
  const [meta, setMeta] = useState<{ currency: Currency; converted: number; rate: number } | null>(null);
  const fx = trpc.reverseDeals.fxRate.useQuery(undefined, { staleTime: 60 * 60 * 1000 });
  const rate = fx.data?.rate ?? KRW_USD_RATE;
  const importMut = trpc.reverseDeals.sellerImport.useMutation();
  const apiStatus = trpc.reverseDeals.openApiStatus.useQuery();
  const clearMut = trpc.reverseDeals.sellerClear.useMutation({
    onSuccess: r =>
      toast.success(`판매자 데이터 초기화 — 관측 ${r.observations.toLocaleString()}건 삭제`),
    onError: e => toast.error(e.message),
  });

  // 살아있는 SKU: 시세·판매량·입찰가 중 하나라도 있는 것 (완전 빈 SKU만 제외)
  //   위험/블루오션 판정엔 판매량 낮은 것도 필요 → 시세+판매 둘 다 요구하지 않음
  const tradable = rows.filter(
    r => r.priceUsd > 0 || r.soldCount > 0 || (r.lowestBidUsd ?? 0) > 0
  );
  const active = onlyTradable ? tradable : rows;

  const onFile = async (f: File) => {
    setParsing(true);
    setResult(null);
    setProgress(null);
    setFileName(f.name);
    try {
      const buf = await f.arrayBuffer();
      const { rows: parsed, skipped: sk, currency, converted } = await parseWorkbook(buf, rate);
      setRows(parsed);
      setSkipped(sk);
      setMeta({ currency, converted, rate });
      if (parsed.length === 0)
        toast.error("인식된 행이 없어요. 판매자센터 '전체 내보내기' 엑셀이 맞는지 확인하세요.");
      else if (currency === "KRW")
        toast.success(`${parsed.length.toLocaleString()}개 SKU 인식 · 원화 엑셀 → $ 자동 환산(÷${rate})`);
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
              <button
                onClick={() => {
                  if (confirm("기존에 올린 판매자 카탈로그를 모두 삭제할까요? (잘못 저장된 데이터 정리용, 확장/수동 데이터는 보존)"))
                    clearMut.mutate();
                }}
                disabled={clearMut.isPending}
                className="ml-auto text-[12px] text-slate-400 hover:text-red-300 underline disabled:opacity-40"
              >
                {clearMut.isPending ? "초기화 중…" : "기존 판매자 데이터 초기화"}
              </button>
            </div>
            <p className="text-[12px] text-slate-400 flex items-start gap-1.5">
              <Info className="h-4 w-4 mt-0.5 shrink-0 text-fuchsia-300" />
              시세는 <b className="text-slate-200">중국 시장(득물) 달러($)</b> 기준입니다. 순이익은
              환율(원/$)로 환산해 <b className="text-white">소싱 큐 · 오늘 사야 할 상품</b>에 반영돼요.
            </p>
            {meta?.currency === "KRW" && meta.converted > 0 && (
              <p className="text-[12px] text-cyan-200 bg-cyan-500/10 rounded-lg px-3 py-2 flex items-start gap-1.5">
                <Info className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  <b>원화(KRW) 엑셀 감지</b> — 금액 {meta.converted.toLocaleString()}행을
                  <b> ÷{meta.rate}{fx.data?.source === "live" ? "(실시간)" : ""}로 $ 자동 환산</b>했습니다.
                  순이익(원)은 환율 변동과 무관하게 정확합니다(왕복 상쇄). USD로 내보내면 그대로 사용.
                </span>
              </p>
            )}
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
                <Tile label="살아있는 SKU (시세·판매·입찰)" value={tradable.length.toLocaleString()} tone="good" />
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
                  <b className="text-white">빈 SKU 제외</b> — 시세·판매량·입찰가 중 하나라도 있는 것만.
                  {rows.length > tradable.length && (
                    <span className="text-slate-400">
                      {" "}완전 빈 SKU {(rows.length - tradable.length).toLocaleString()}개 제외.
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
