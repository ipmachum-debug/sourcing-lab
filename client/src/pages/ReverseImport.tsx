import { useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, Download, ClipboardPaste, Check } from "lucide-react";

const won = (n: number) => `${Math.round(n || 0).toLocaleString("ko-KR")}원`;

// 소스 라벨 → 코드
type Source = "musinsa" | "abcmart" | "crocs" | "nike" | "adidas" | "newbalance" | "lfmall" | "lotteon" | "ssg" | "29cm" | "other";
const SOURCE_MAP: Record<string, Source> = {
  무신사: "musinsa", musinsa: "musinsa",
  "abc마트": "abcmart", abc: "abcmart", abcmart: "abcmart",
  크록스: "crocs", crocs: "crocs",
  나이키: "nike", nike: "nike",
  아디다스: "adidas", adidas: "adidas",
  뉴발란스: "newbalance", newbalance: "newbalance", 뉴발: "newbalance",
  lf몰: "lfmall", lf: "lfmall", lfmall: "lfmall",
  롯데on: "lotteon", 롯데: "lotteon", lotteon: "lotteon",
  ssg: "ssg", 신세계: "ssg",
  "29cm": "29cm",
};
function toSource(s: string): Source {
  const k = (s || "").trim().toLowerCase();
  return SOURCE_MAP[k] ?? "other";
}

// 헤더 별칭 → 필드
function headerKey(h: string): string | null {
  const k = h.trim().toLowerCase().replace(/[\s()]/g, "");
  if (/^(브랜드|brand)/.test(k)) return "brand";
  if (/^(상품명|상품|productname|name|모델)/.test(k)) return "productName";
  if (/^(사이즈|size|치수)/.test(k)) return "size";
  if (/(국내매입가|국내가|매입가|특가|domesticprice|국내)/.test(k)) return "domesticPrice";
  if (/(소스|구매처|국내소스|source|몰)/.test(k)) return "source";
  if (/(poizon|포이즌|시세|위안|cny|판매가)/.test(k)) return "poizonCny";
  if (/(거래량|판매량|soldcount|volume|30일)/.test(k)) return "soldCount30d";
  return null;
}

interface Row {
  brand?: string; productName: string; size?: string;
  domesticPrice: number; source: Source; poizonCny: number; soldCount30d: number;
}

function num(s: string): number {
  const m = String(s || "").replace(/[,\s₩원¥$]/g, "").match(/([0-9]+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function parseTable(text: string): { rows: Row[]; errors: number } {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], errors: 0 };
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const split = (l: string) =>
    l.split(delim).map(c => c.trim().replace(/^"(.*)"$/, "$1"));
  const headers = split(lines[0]).map(headerKey);
  const rows: Row[] = [];
  let errors = 0;
  for (let i = 1; i < lines.length; i++) {
    const cells = split(lines[i]);
    const obj: any = {};
    headers.forEach((h, idx) => {
      if (h) obj[h] = cells[idx] ?? "";
    });
    const productName = (obj.productName || "").trim();
    if (!productName) { errors++; continue; }
    rows.push({
      brand: (obj.brand || "").trim() || undefined,
      productName: productName.slice(0, 300),
      size: (obj.size || "").trim() || undefined,
      domesticPrice: num(obj.domesticPrice),
      source: toSource(obj.source),
      poizonCny: num(obj.poizonCny),
      soldCount30d: num(obj.soldCount30d),
    });
  }
  return { rows, errors };
}

const TEMPLATE =
  "브랜드,상품명,사이즈,국내매입가,국내소스,POIZON시세($),30일거래량\n" +
  "크록스,크록스 클래식 클로그 블랙,260,34900,ABC마트,40,45\n" +
  "크록스,크록스 클래식 클로그 화이트,265,32900,크록스,38,38\n" +
  "나이키,나이키 에어포스1 07 화이트,270,89000,나이키,105,60\n";

export default function ReverseImport() {
  const [raw, setRaw] = useState("");
  const [done, setDone] = useState<{ domestic: number; poizon: number } | null>(null);
  const parsed = useMemo(() => parseTable(raw), [raw]);

  const importMut = trpc.reverseDeals.bulkImport.useMutation({
    onSuccess: r => {
      setDone({ domestic: r.domestic, poizon: r.poizon });
      toast.success(`${r.rows}건 업로드 · 국내 ${r.domestic} · POIZON ${r.poizon}`);
    },
    onError: e => toast.error(e.message),
  });

  const onFile = (f: File) => {
    const reader = new FileReader();
    reader.onload = () => setRaw(String(reader.result || ""));
    reader.readAsText(f, "utf-8");
  };

  const downloadTemplate = () => {
    const blob = new Blob(["﻿" + TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "매입후보_템플릿.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const upload = () => {
    if (parsed.rows.length === 0) return toast.error("업로드할 행이 없어요");
    setDone(null);
    importMut.mutate({ rows: parsed.rows });
  };

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10">
        <div className="max-w-5xl mx-auto space-y-6">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest neon-chip neon-magenta px-3 py-1 rounded-full uppercase">
              <FileSpreadsheet className="h-3.5 w-3.5" /> Bulk Import
            </span>
            <h1 className="text-3xl font-black mt-4 neon-text">엑셀 일괄 업로드</h1>
            <p className="text-slate-300/80 mt-2">
              특가 리스트를 <b className="text-white">한 번에 시딩</b>. 크롤 없이 큐레이션한 스테디 SKU가
              바로 <b className="text-fuchsia-300">오늘 사야 할 상품</b>에 반영돼요.
            </p>
          </div>

          {/* 방법 안내 */}
          <div className="glass rounded-2xl p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={downloadTemplate} className="neon-chip rounded-lg px-3 py-2 text-sm text-slate-200 flex items-center gap-1.5">
                <Download className="h-4 w-4" /> 템플릿(CSV) 다운로드
              </button>
              <label className="neon-btn rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5 cursor-pointer">
                <Upload className="h-4 w-4" /> CSV 파일 선택
                <input type="file" accept=".csv,text/csv" className="hidden"
                  onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
              </label>
            </div>
            <p className="text-[12px] text-slate-400 flex items-start gap-1.5">
              <ClipboardPaste className="h-4 w-4 mt-0.5 shrink-0 text-fuchsia-300" />
              엑셀에서 <b className="text-slate-200">범위를 복사(Ctrl+C)</b>해 아래에 붙여넣어도 됩니다. (탭 구분 자동 인식)
            </p>
          </div>

          {/* 붙여넣기 */}
          <div className="glass rounded-2xl p-4">
            <textarea
              value={raw}
              onChange={e => setRaw(e.target.value)}
              placeholder={"브랜드  상품명  사이즈  국내매입가  국내소스  POIZON시세($)  30일거래량\n크록스  크록스 클래식 클로그 블랙  260  34900  ABC마트  40  45"}
              className="w-full h-40 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:border-fuchsia-400/60 font-mono resize-y"
            />
            <div className="flex items-center justify-between mt-3">
              <p className="text-sm text-slate-400">
                인식 <b className="text-emerald-300">{parsed.rows.length}</b>건
                {parsed.errors > 0 && <span className="text-amber-400"> · 무시 {parsed.errors}건(상품명 없음)</span>}
              </p>
              <button onClick={upload} disabled={importMut.isPending || parsed.rows.length === 0}
                className="neon-btn rounded-lg px-5 py-2 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-40">
                <Upload className="h-4 w-4" /> {importMut.isPending ? "업로드 중…" : `${parsed.rows.length}건 업로드`}
              </button>
            </div>
            {done && (
              <p className="text-sm text-emerald-300 mt-2 flex items-center gap-1.5">
                <Check className="h-4 w-4" /> 완료 — 국내 풀 {done.domestic}건 · POIZON 관측 {done.poizon}건 적립.
                <a href="/reverse/deals" className="underline text-fuchsia-300">오늘 사야 할 상품 보기 →</a>
              </p>
            )}
          </div>

          {/* 미리보기 */}
          {parsed.rows.length > 0 && (
            <div className="glass rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead className="bg-white/5 text-xs text-slate-400">
                    <tr>
                      <th className="text-left font-medium px-3 py-2.5">브랜드 / 상품</th>
                      <th className="text-center font-medium px-3 py-2.5">사이즈</th>
                      <th className="text-right font-medium px-3 py-2.5">국내가</th>
                      <th className="text-center font-medium px-3 py-2.5">소스</th>
                      <th className="text-right font-medium px-3 py-2.5">POIZON</th>
                      <th className="text-right font-medium px-3 py-2.5">거래량</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 30).map((r, i) => (
                      <tr key={i} className="border-t border-white/8">
                        <td className="px-3 py-2">
                          <p className="text-slate-100 truncate max-w-[280px]">{r.productName}</p>
                          <p className="text-[11px] text-slate-500">{r.brand || "-"}</p>
                        </td>
                        <td className="text-center px-3 py-2 text-slate-300">{r.size || "-"}</td>
                        <td className="text-right px-3 py-2 text-slate-300">{r.domesticPrice ? won(r.domesticPrice) : "-"}</td>
                        <td className="text-center px-3 py-2 text-slate-400 text-xs">{r.source}</td>
                        <td className="text-right px-3 py-2 text-slate-300">{r.poizonCny ? `$${r.poizonCny.toLocaleString("en-US")}` : "-"}</td>
                        <td className="text-right px-3 py-2 text-slate-400">{r.soldCount30d || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsed.rows.length > 30 && (
                <p className="text-center text-[11px] text-slate-500 py-2">…외 {parsed.rows.length - 30}건</p>
              )}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
