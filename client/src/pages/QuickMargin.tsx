import { useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useLocation } from "wouter";
import { Calculator, ArrowRight, Sliders } from "lucide-react";

// 초보용 "빠른 마진" — 3칸만 넣으면 남는 돈 즉시.
// 쿠팡 수수료는 대표값(카테고리 평균 ~11%)을 기본으로, 필요하면 조정.
const DEFAULT_FEE = 11; // %

function calc(sellingPrice: number, costPrice: number, feePct: number) {
  const fee = Math.round((sellingPrice * feePct) / 100);
  const vat = Math.round(((sellingPrice - costPrice) * 0.1) / 1.1); // 부가세 근사(공급가 기준 간이)
  const margin = sellingPrice - costPrice - fee - Math.max(0, vat);
  const marginRate = sellingPrice > 0 ? (margin / sellingPrice) * 100 : 0;
  return { fee, vat: Math.max(0, vat), margin, marginRate };
}

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

export default function QuickMargin() {
  const [, setLocation] = useLocation();
  const [selling, setSelling] = useState(19900);
  const [cost, setCost] = useState(6000);
  const [fee, setFee] = useState(DEFAULT_FEE);

  const r = useMemo(() => calc(selling, cost, fee), [selling, cost, fee]);
  const good = r.marginRate >= 25;
  const ok = r.marginRate >= 12 && r.marginRate < 25;

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10">
        <div className="max-w-2xl mx-auto space-y-7">
          <div className="text-center">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest neon-chip neon-cyan px-3 py-1 rounded-full uppercase">
              <Calculator className="h-3.5 w-3.5" /> Quick Margin
            </span>
            <h1 className="text-4xl font-black mt-4 neon-text">빠른 마진</h1>
            <p className="text-slate-300/80 mt-2">3칸만 넣으면 남는 돈이 바로 나와요</p>
          </div>

          {/* 입력 3칸 */}
          <div className="glass rounded-2xl p-6 space-y-5">
            <MoneyRow label="쿠팡 판매가" value={selling} onChange={setSelling} accent />
            <MoneyRow label="상품 원가 (사입가·배송 포함)" value={cost} onChange={setCost} />
            <div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-200">쿠팡 수수료</label>
                <span className="text-sm font-bold text-white">{fee}%</span>
              </div>
              <input
                type="range" min={5} max={20} step={0.5} value={fee}
                onChange={e => setFee(Number(e.target.value))}
                className="w-full mt-2 cursor-pointer" style={{ accentColor: "#a855f7" }}
              />
              <p className="text-[11px] text-slate-500 mt-1">카테고리마다 다름 · 보통 10~12%</p>
            </div>
          </div>

          {/* 결과 */}
          <div className={`glass rounded-2xl p-6 text-center ${good ? "glass-active" : ""}`}>
            <p className="text-sm text-slate-400">남는 돈 (개당 순마진)</p>
            <p className={`text-5xl font-black mt-2 ${r.margin > 0 ? "neon-text" : "text-red-400"}`}>
              {won(r.margin)}
            </p>
            <div className="inline-flex items-center gap-2 mt-3">
              <span className={`text-sm font-bold px-3 py-1 rounded-full ${
                good ? "bg-emerald-400 text-emerald-950" : ok ? "bg-amber-400 text-amber-950" : "bg-red-500 text-white"
              }`}>
                마진율 {r.marginRate.toFixed(1)}%
              </span>
              <span className="text-sm text-slate-400">
                {good ? "👍 좋아요" : ok ? "🤔 보통" : "⚠️ 아슬아슬"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-5 text-left">
              <Break label="수수료" value={won(r.fee)} />
              <Break label="부가세(근사)" value={won(r.vat)} />
            </div>
          </div>

          {/* 상세 계산기로 */}
          <button
            onClick={() => setLocation("/margin")}
            className="neon-chip w-full rounded-xl px-4 py-3 text-sm text-slate-200 flex items-center justify-center gap-2"
          >
            <Sliders className="h-4 w-4" /> 환율·광고·반품까지 상세 계산 <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}

function MoneyRow({ label, value, onChange, accent }: { label: string; value: number; onChange: (v: number) => void; accent?: boolean }) {
  return (
    <div>
      <label className="text-sm font-medium text-slate-200">{label}</label>
      <div className="mt-1.5 relative">
        <input
          type="number" min={0} value={value}
          onChange={e => onChange(Math.max(0, Number(e.target.value)))}
          className={`w-full rounded-lg border bg-white/5 pl-3 pr-10 py-3 text-lg font-bold text-white outline-none transition-colors ${
            accent ? "border-cyan-400/40 focus:border-cyan-400/70" : "border-white/15 focus:border-cyan-400/60"
          } focus:bg-white/10`}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">원</span>
      </div>
    </div>
  );
}

function Break({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className="text-sm font-semibold text-slate-200 mt-0.5">−{value}</p>
    </div>
  );
}
