import { useMemo, useState } from "react";
import { useRoute, Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import PriceBandChart from "@/components/PriceBandChart";
import Sparkline from "@/components/Sparkline";
import { ArrowLeft, Calculator, TrendingUp, Package2, BrainCircuit } from "lucide-react";

const won = (n: number) => `${Math.round(n || 0).toLocaleString("ko-KR")}원`;
const cny = (n: number) => `¥${Math.round(n || 0).toLocaleString()}`;

interface Stats { p25: number; p50: number; p75: number; min: number; max: number; count: number }
interface Detail {
  sku: { id: number; brand: string | null; productName: string; domesticPrice: number; poizonCny: number; rate: number; feePct: number };
  series: { t: number; d: string; price: number; sold: number; size: string | null }[];
  stats30: Stats; stats90: Stats;
  current: { price: number; posPct: number };
  bySize: { size: string; p50: number; latest: number; count: number }[];
}
interface AiAdvice {
  sku: { id: number; brand: string | null; productName: string; color: string | null };
  memory: { buyCount: number; buyQty: number; avgTurnover: number | null; passRate: number | null; avgProfit: number | null; salesQty: number; peakMonth: string | null };
  seasonalByMonth: number[];
  variants: { color: string; qty: number }[];
  verdict: "buy" | "watch" | "hold" | "unknown";
  headline: string;
  reasons: string[];
}

const VERDICT: Record<string, { label: string; cls: string }> = {
  buy: { label: "매입 추천", cls: "bg-emerald-400/15 text-emerald-300 border-emerald-400/40" },
  watch: { label: "마진 확인 후", cls: "bg-cyan-400/15 text-cyan-300 border-cyan-400/40" },
  hold: { label: "관망", cls: "bg-amber-400/15 text-amber-300 border-amber-400/40" },
  unknown: { label: "기록 없음", cls: "bg-slate-500/20 text-slate-300 border-white/15" },
};

export default function ReverseSkuDetail() {
  const [, params] = useRoute("/reverse/sku/:id");
  const id = Number(params?.id);
  const [range, setRange] = useState<30 | 90>(30);
  const q = trpc.reverseDeals.skuDetail.useQuery({ skuId: id }, { enabled: Number.isFinite(id) });
  const d = q.data as Detail | undefined;
  const aiQ = trpc.aiMemory.advise.useQuery({ skuId: id }, { enabled: Number.isFinite(id) });
  const ai = aiQ.data as AiAdvice | undefined;

  const now = Date.now();
  const windowPts = useMemo(
    () => (d ? d.series.filter(s => now - s.t <= range * 86400000) : []),
    [d, range, now]
  );
  const stats = d ? (range === 30 ? d.stats30 : d.stats90) : null;
  const soldSeries = windowPts.map(p => p.sold).filter(n => n > 0);

  if (q.isLoading) return <DashboardLayout><div className="cyber-stage p-10 text-center text-slate-500">불러오는 중…</div></DashboardLayout>;
  if (!d) return <DashboardLayout><div className="cyber-stage p-10 text-center text-slate-500">SKU를 찾을 수 없어요. <Link href="/reverse/sku" className="text-fuchsia-300 underline">워치리스트로</Link></div></DashboardLayout>;

  const cur = d.current;
  const posLabel =
    cur.posPct <= 25 ? { t: "저평가 구간 (매입 유리)", c: "text-emerald-300" }
      : cur.posPct >= 75 ? { t: "고평가 구간 (판매 유리)", c: "text-orange-300" }
        : { t: "중간 구간", c: "text-slate-300" };

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10">
        <div className="max-w-4xl mx-auto space-y-6">
          <Link href="/reverse/sku" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white">
            <ArrowLeft className="h-4 w-4" /> 워치리스트
          </Link>

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] text-slate-500">{d.sku.brand || "-"}</p>
              <h1 className="text-2xl sm:text-3xl font-black neon-text">{d.sku.productName}</h1>
              <p className="text-slate-400 mt-1 text-sm">현재 시세 <b className="text-white">{cny(cur.price)}</b> · 최근 30일 <span className={posLabel.c}>{posLabel.t}</span> (하위 {cur.posPct}%)</p>
            </div>
            <Link href="/reverse/deals" className="neon-btn rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5">
              <Calculator className="h-4 w-4" /> 매입 판단
            </Link>
          </div>

          {/* 🤖 AI 메모리 — "이번에도 살까?" */}
          {ai && (
            <div className="glass rounded-2xl p-4 sm:p-5 ring-1 ring-fuchsia-400/30"
              style={{ background: "linear-gradient(135deg, rgba(232,121,249,0.08), rgba(103,232,249,0.04))" }}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <BrainCircuit className="h-4 w-4 text-fuchsia-300" />
                  <h2 className="text-sm font-semibold text-slate-100">AI 메모리 · 이번에도 살까?</h2>
                </div>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${VERDICT[ai.verdict].cls}`}>{VERDICT[ai.verdict].label}</span>
              </div>
              <p className="text-slate-100 text-[15px] leading-relaxed">{ai.headline}</p>

              {/* 기억 지표 */}
              {(ai.memory.buyCount > 0 || ai.memory.salesQty > 0) && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-3">
                  <MemStat label="누적 매입" value={ai.memory.buyCount > 0 ? `${ai.memory.buyCount}회` : "-"} sub={ai.memory.buyQty ? `${ai.memory.buyQty}개` : ""} />
                  <MemStat label="평균 회전" value={ai.memory.avgTurnover != null ? `${ai.memory.avgTurnover}일` : "-"} />
                  <MemStat label="검수 통과" value={ai.memory.passRate != null ? `${ai.memory.passRate}%` : "-"} />
                  <MemStat label="평균 순익" value={ai.memory.avgProfit != null ? `${ai.memory.avgProfit.toLocaleString()}원` : "-"} good={(ai.memory.avgProfit ?? 0) > 0} />
                  <MemStat label="성수기" value={ai.memory.peakMonth || "-"} />
                </div>
              )}

              {/* 근거 */}
              {ai.reasons.length > 0 && (
                <ul className="flex flex-wrap gap-1.5 mt-3">
                  {ai.reasons.map((r, i) => (
                    <li key={i} className="text-[11px] text-slate-300 border border-white/10 bg-white/5 rounded-full px-2.5 py-1">{r}</li>
                  ))}
                </ul>
              )}

              {/* 컬러 변형 비교 */}
              {ai.variants.length >= 2 && (
                <div className="mt-3 pt-3 border-t border-white/10">
                  <p className="text-[11px] text-slate-500 mb-1.5">같은 모델 컬러별 판매량</p>
                  <div className="flex flex-wrap gap-2">
                    {ai.variants.slice(0, 6).map(v => (
                      <span key={v.color} className={`text-[11px] px-2 py-1 rounded-lg ${v.color === ai.sku.color ? "bg-fuchsia-500/20 text-fuchsia-200 border border-fuchsia-400/40" : "bg-white/5 text-slate-300 border border-white/10"}`}>
                        {v.color} <b>{v.qty}</b>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 안정가 요약 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Tile label={`P25 안정가 (${range}일)`} value={cny(stats!.p25)} tone="good" />
            <Tile label="P50 중앙값" value={cny(stats!.p50)} />
            <Tile label="P75 상단" value={cny(stats!.p75)} />
            <Tile label="표본 수" value={`${stats!.count}건`} />
          </div>

          {/* 차트 */}
          <div className="glass rounded-2xl p-4 sm:p-5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-fuchsia-300" />
                <h2 className="text-sm font-semibold text-slate-100">시세 추이 · 안정가 밴드</h2>
              </div>
              <div className="flex gap-1">
                {[30, 90].map(r => (
                  <button key={r} onClick={() => setRange(r as 30 | 90)}
                    className={`text-xs px-3 py-1 rounded-lg border ${range === r ? "bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-400/50" : "border-white/10 text-slate-400"}`}>
                    {r}일
                  </button>
                ))}
              </div>
            </div>
            <PriceBandChart points={windowPts} band={stats!} />
            <p className="text-[11px] text-slate-500 mt-1">
              <span className="text-emerald-300">P25 안정가</span>는 매입 판단의 보수적 기준 · 현재 시세가 P25 근처면 매입 유리, P75 위면 판매 유리
            </p>
          </div>

          {/* 판매량 추이 */}
          {soldSeries.length >= 2 && (
            <div className="glass rounded-2xl p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-1"><Package2 className="h-4 w-4 text-cyan-300" /><h2 className="text-sm font-semibold text-slate-100">판매량(30일) 추이</h2></div>
              <Sparkline values={soldSeries} width={640} height={60} className="w-full text-cyan-300/40" color="#67e8f9" />
            </div>
          )}

          {/* 사이즈별 */}
          {d.bySize.length > 0 && (
            <div className="glass rounded-2xl p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-slate-100 mb-3">사이즈별 시세 (최근 30일)</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {d.bySize.map(s => (
                  <div key={s.size} className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <p className="text-xs text-slate-400">{s.size}</p>
                    <p className="text-base font-black text-slate-100">{cny(s.latest)}</p>
                    <p className="text-[10px] text-slate-500">중앙값 {cny(s.p50)} · {s.count}건</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

function MemStat({ label, value, sub, good }: { label: string; value: string; sub?: string; good?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-2.5">
      <p className="text-[10px] text-slate-400">{label}</p>
      <p className={`text-sm font-black mt-0.5 ${good ? "text-emerald-300" : "text-white"}`}>{value}{sub ? <span className="text-[10px] font-normal text-slate-500"> {sub}</span> : null}</p>
    </div>
  );
}

function Tile({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "good" }) {
  return (
    <div className="glass rounded-xl p-3">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className={`text-lg font-black mt-1 ${tone === "good" ? "text-emerald-300" : "text-white"}`}>{value}</p>
    </div>
  );
}
