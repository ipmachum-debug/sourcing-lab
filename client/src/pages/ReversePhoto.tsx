import { useState } from "react";
import { Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ScanLine, Camera, Sparkles, Star, Calculator, X, Loader2 } from "lucide-react";

const won = (n: number) => `${Math.round(n || 0).toLocaleString("ko-KR")}원`;
const cny = (n: number) => `$${Math.round(n || 0).toLocaleString("en-US")}`;

const VERDICT: Record<string, { label: string; cls: string; dot: string }> = {
  buy: { label: "추천", cls: "ring-emerald-400/40", dot: "bg-emerald-400" },
  watch: { label: "확인", cls: "ring-cyan-400/30", dot: "bg-cyan-400" },
  skip: { label: "비추천", cls: "ring-white/10", dot: "bg-slate-500" },
  no_market: { label: "시세없음", cls: "ring-amber-400/25", dot: "bg-amber-400" },
};

interface Item {
  normKey: string; productName: string; brand: string | null; articleNumber: string | null; color: string | null; sizes: string | null;
  listPrice: number; salePrice: number; discountPct: number; buyKrw: number; verdict: string;
  deal: null | { stableCny: number; revenueKrw: number; netProfitKrw: number; marginPct: number; grade: string; recommendQty: number; stars: number; hasObservations: boolean };
}
interface ScanResult { images: number; detected: number; items: Item[]; counts: { buy: number; watch: number; skip: number; noMarket: number } }

function compress(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1100;
      let { width, height } = img;
      if (width > max || height > max) { const s = max / Math.max(width, height); width = Math.round(width * s); height = Math.round(height * s); }
      const c = document.createElement("canvas");
      c.width = width; c.height = height;
      c.getContext("2d")!.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("이미지 로드 실패")); };
    img.src = url;
  });
}

export default function ReversePhoto() {
  const utils = trpc.useUtils();
  const [imgs, setImgs] = useState<string[]>([]);
  const [result, setResult] = useState<ScanResult | null>(null);

  const scanMut = trpc.photoSourcing.scan.useMutation({
    onSuccess: r => { setResult(r as ScanResult); utils.reverseDeals.todayDeals.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const watchMut = trpc.reversePurchase.skuCreate.useMutation({
    onSuccess: () => toast.success("워치리스트 추가"),
    onError: e => toast.error(e.message),
  });

  const onPick = async (files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files).slice(0, 12);
    try {
      const compressed = await Promise.all(arr.map(compress));
      setImgs(prev => [...prev, ...compressed].slice(0, 12));
    } catch { toast.error("이미지 처리 실패"); }
  };

  const run = () => { if (!imgs.length) return toast.error("사진을 먼저 올리세요"); setResult(null); scanMut.mutate({ images: imgs, rate: 1350 }); };
  const reset = () => { setImgs([]); setResult(null); };

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10">
        <div className="max-w-5xl mx-auto space-y-6">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest neon-chip neon-magenta px-3 py-1 rounded-full uppercase">
              <ScanLine className="h-3.5 w-3.5" /> Photo Sourcing
            </span>
            <h1 className="text-3xl sm:text-4xl font-black mt-4 neon-text">사진 소싱</h1>
            <p className="text-slate-300/80 mt-2">
              매장 가격표를 <b className="text-white">사진만 찍어 올리면</b> AI가 상품·가격·할인을 읽고 POIZON과 비교해 <b className="text-fuchsia-300">살까/말까/몇 개</b>까지 판단합니다.
            </p>
            <p className="text-[11px] text-slate-500 mt-1.5">엑셀 만들 필요 없이 — 아울렛 → 사진 → 업로드 → 추천. (최대 12장)</p>
          </div>

          {/* 업로드 */}
          <div className="glass rounded-2xl p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <label className="neon-btn rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5 cursor-pointer">
                <Camera className="h-4 w-4" /> 사진 촬영/선택
                <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={e => onPick(e.target.files)} />
              </label>
              {imgs.length > 0 && (
                <>
                  <button onClick={run} disabled={scanMut.isPending}
                    className="neon-chip rounded-lg px-4 py-2 text-sm font-semibold text-slate-100 flex items-center gap-1.5 disabled:opacity-50">
                    {scanMut.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> 인식 중… ({imgs.length}장)</> : <><Sparkles className="h-4 w-4" /> AI 인식 {imgs.length}장</>}
                  </button>
                  <button onClick={reset} className="text-slate-500 hover:text-red-400 text-sm px-2">초기화</button>
                </>
              )}
            </div>
            {imgs.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {imgs.map((src, i) => (
                  <div key={i} className="relative">
                    <img src={src} alt="" className="h-20 w-20 object-cover rounded-lg border border-white/10" />
                    <button onClick={() => setImgs(prev => prev.filter((_, j) => j !== i))}
                      className="absolute -top-1.5 -right-1.5 h-5 w-5 grid place-items-center rounded-full bg-slate-900 border border-white/20 text-slate-300 hover:text-red-400">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {scanMut.isPending && <p className="text-[11px] text-slate-500 mt-2">AI가 가격표를 읽고 POIZON과 비교 중… 보통 5~15초.</p>}
          </div>

          {/* 결과 */}
          {result && (
            <>
              <div className="glass rounded-2xl p-4">
                <p className="text-sm text-slate-200">
                  사진 <b className="text-white">{result.images}장</b> → 상품 <b className="text-white">{result.detected}개</b> 검출 ·
                  <span className="text-emerald-300"> 추천 {result.counts.buy}</span> ·
                  <span className="text-cyan-300"> 확인 {result.counts.watch}</span> ·
                  <span className="text-slate-400"> 비추천 {result.counts.skip}</span> ·
                  <span className="text-amber-300"> 시세없음 {result.counts.noMarket}</span>
                </p>
                <Link href="/reverse/deals" className="text-[11px] text-fuchsia-300 hover:underline">→ 오늘 사야 할 상품에도 반영됨</Link>
              </div>

              {result.detected === 0 ? (
                <div className="glass rounded-2xl p-8 text-center text-slate-400 text-sm">
                  가격표를 인식하지 못했어요. 가격·상품명이 선명하게 나오도록 다시 찍어보세요.
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {result.items.map((it, i) => {
                    const v = VERDICT[it.verdict] ?? VERDICT.no_market;
                    return (
                      <div key={i} className={`glass rounded-2xl p-4 ring-1 ${v.cls}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[11px] text-slate-500">{it.brand || "-"}{it.color ? ` · ${it.color}` : ""}</p>
                            <p className="font-bold text-slate-100 leading-tight line-clamp-2">{it.productName}</p>
                            {it.articleNumber && <p className="text-[11px] text-cyan-300/80 mt-0.5">모델번호 {it.articleNumber}</p>}
                            {it.sizes && <p className="text-[11px] text-slate-500 mt-0.5">사이즈 {it.sizes}</p>}
                          </div>
                          <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-slate-200">
                            <span className={`h-2 w-2 rounded-full ${v.dot}`} />{v.label}
                          </span>
                        </div>

                        <div className="mt-2 space-y-1 text-sm">
                          <Row label="국내가" value={<>{won(it.buyKrw)}{it.discountPct > 0 && <span className="text-[11px] text-emerald-300"> (−{it.discountPct}%)</span>}</>} />
                          {it.deal ? (
                            <>
                              <Row label="POIZON 안정가" value={<>{won(it.deal.revenueKrw)} <span className="text-slate-600 text-[11px]">({cny(it.deal.stableCny)})</span></>} />
                              <div className="border-t border-white/10 my-1" />
                              <Row label="예상 순익" value={<b className={it.deal.netProfitKrw >= 0 ? "text-emerald-300" : "text-red-400"}>{won(it.deal.netProfitKrw)}</b>} />
                              <Row label="마진율" value={<b className={it.deal.marginPct >= 30 ? "text-emerald-300" : "text-amber-300"}>{it.deal.marginPct.toFixed(1)}%</b>} />
                            </>
                          ) : (
                            <p className="text-[11px] text-amber-300/80 mt-1">POIZON 시세 데이터 없음 — 관측이 쌓이면 판단됩니다</p>
                          )}
                        </div>

                        <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between">
                          {it.deal ? (
                            <div className="flex items-center gap-0.5">
                              {[1, 2, 3, 4, 5].map(n => <Star key={n} className={`h-3.5 w-3.5 ${n <= it.deal!.stars ? "fill-amber-300 text-amber-300" : "text-slate-700"}`} />)}
                              {it.deal.recommendQty > 0 && <span className="text-[11px] text-fuchsia-200 ml-1.5">{it.deal.recommendQty}개 추천</span>}
                            </div>
                          ) : <span />}
                          <button
                            onClick={() => watchMut.mutate({ productName: it.productName, brand: it.brand || undefined, sku: it.articleNumber || undefined, domesticPrice: it.buyKrw, poizonCny: it.deal?.stableCny || 0, rate: 1350, feePct: 6 })}
                            className="text-[11px] neon-chip rounded-lg px-2 py-1 text-slate-200 flex items-center gap-1">
                            <Star className="h-3 w-3" /> 워치
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {!result && !scanMut.isPending && (
            <div className="glass rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-2"><Calculator className="h-4 w-4 text-fuchsia-300" /><h2 className="text-sm font-semibold text-slate-100">이렇게 써요</h2></div>
              <ol className="text-sm text-slate-400 space-y-1.5 list-decimal ml-4">
                <li>아울렛·매장에서 <b className="text-slate-200">가격표를 사진</b>으로 찍기 (여러 장 OK)</li>
                <li>업로드 → <b className="text-slate-200">AI 인식</b> → 상품·가격·할인 자동 추출</li>
                <li>POIZON 시세와 비교해 <b className="text-slate-200">순익·마진·추천 수량</b> 즉시 판단</li>
                <li>추천 상품은 <b className="text-slate-200">워치리스트</b>·<b className="text-slate-200">오늘 사야 할 상품</b>으로</li>
              </ol>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-400 text-[13px]">{label}</span>
      <span>{value}</span>
    </div>
  );
}
