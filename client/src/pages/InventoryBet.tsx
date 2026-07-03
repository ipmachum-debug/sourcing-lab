import { useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Dices, TriangleAlert, ShieldCheck, Scale, Flame } from "lucide-react";

type Trend = "rising" | "stable" | "declining";

const DEFAULT_LEAD = 20; // 1688 소싱 배송·통관 감안 기본 리드타임
const SAFETY_DAYS = 5;

function computeBet(input: { dailySales: number; currentStock: number; leadTimeDays: number; trend: Trend }) {
  const { dailySales, currentStock, leadTimeDays, trend } = input;
  const daysUntilStockout = dailySales > 0 ? currentStock / dailySales : Infinity;
  const safetyStock = Math.round(dailySales * SAFETY_DAYS);
  const reorderPoint = Math.round(dailySales * leadTimeDays + safetyStock);
  const needReorderNow = currentStock <= reorderPoint;
  const stockoutRisk = daysUntilStockout < leadTimeDays;
  const growthFactor = trend === "rising" ? 1.4 : trend === "declining" ? 0.7 : 1.0;
  const qty = (coverDays: number, factor = 1) =>
    Math.max(0, Math.ceil(dailySales * coverDays * factor - currentStock));
  return {
    daysUntilStockout, safetyStock, reorderPoint, needReorderNow, stockoutRisk, growthFactor,
    bets: {
      conservative: qty(leadTimeDays + 7),
      balanced: qty(leadTimeDays + 21),
      aggressive: qty(leadTimeDays + 45, growthFactor),
    },
  };
}

const num = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString("ko-KR") : "∞");

export default function InventoryBet() {
  const [dailySales, setDailySales] = useState(10);
  const [currentStock, setCurrentStock] = useState(100);
  const [leadTimeDays, setLeadTimeDays] = useState(DEFAULT_LEAD);
  const [trend, setTrend] = useState<Trend>("stable");

  const r = useMemo(
    () => computeBet({ dailySales, currentStock, leadTimeDays, trend }),
    [dailySales, currentStock, leadTimeDays, trend]
  );

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10">
        <div className="max-w-4xl mx-auto space-y-7">
          <div className="text-center sm:text-left">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest neon-chip neon-magenta px-3 py-1 rounded-full uppercase">
              <Dices className="h-3.5 w-3.5" /> Betting Engine
            </span>
            <h1 className="text-4xl font-black mt-4 neon-text">재고 배팅 AI</h1>
            <p className="text-slate-300/80 mt-2">
              판매 속도·리드타임으로 <b className="text-white">언제·얼마나 발주할지</b>를 배팅 3단계로 추천합니다
            </p>
          </div>

          {/* 입력 */}
          <div className="glass rounded-2xl p-5">
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="일 판매량 (개/일)" hint="최근 평균 · 추적 데이터 연동은 곧 지원">
                <NumInput value={dailySales} onChange={v => setDailySales(v)} min={0} />
              </Field>
              <Field label="현재 재고 (개)">
                <NumInput value={currentStock} onChange={v => setCurrentStock(v)} min={0} />
              </Field>
              <Field label="리드타임 (일)" hint="발주→입고 · 1688 기준 기본 20일">
                <NumInput value={leadTimeDays} onChange={v => setLeadTimeDays(Math.max(1, v))} min={1} />
              </Field>
              <Field label="판매 추세">
                <div className="flex gap-2">
                  {([
                    { k: "rising", t: "📈 상승" },
                    { k: "stable", t: "➡️ 유지" },
                    { k: "declining", t: "📉 하락" },
                  ] as { k: Trend; t: string }[]).map(o => (
                    <button
                      key={o.k}
                      onClick={() => setTrend(o.k)}
                      className={`neon-chip ${trend === o.k ? "neon-chip-on" : "text-slate-200"} flex-1 rounded-lg px-2 py-2.5 text-sm`}
                    >
                      {o.t}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          </div>

          {/* 핵심 지표 */}
          <div className="grid sm:grid-cols-3 gap-3">
            <Stat label="예상 소진일" value={Number.isFinite(r.daysUntilStockout) ? `${num(r.daysUntilStockout)}일 후` : "판매 없음"} tone={r.stockoutRisk ? "danger" : "normal"} />
            <Stat label="재발주 시점(ROP)" value={`재고 ${num(r.reorderPoint)}개`} sub={`안전재고 ${num(r.safetyStock)}개 포함`} />
            <Stat label="발주 판단" value={r.needReorderNow ? "지금 발주!" : "여유 있음"} tone={r.needReorderNow ? "danger" : "good"} />
          </div>

          {r.stockoutRisk && (
            <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 flex items-start gap-2">
              <TriangleAlert className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
              <div className="text-sm text-red-200">
                <b className="text-red-100">품절 위험!</b> 리드타임({leadTimeDays}일)보다 빨리 소진됩니다. 지금 발주해도 입고 전 품절될 수 있어요.
              </div>
            </div>
          )}

          {/* 배팅 3단계 */}
          <div>
            <h2 className="font-bold text-lg mb-3 text-white">💰 배팅 3단계 — 권장 발주량</h2>
            <div className="grid sm:grid-cols-3 gap-3">
              <BetCard icon={<ShieldCheck className="h-5 w-5" />} name="보수 배팅" tone="emerald" qty={r.bets.conservative} cover="리드타임 + 7일" desc="재고 부담 최소. 품절만 겨우 막는 수준" />
              <BetCard icon={<Scale className="h-5 w-5" />} name="균형 배팅" tone="cyan" qty={r.bets.balanced} cover="리드타임 + 21일" desc="표준 추천. 대부분 상황에 적합" highlight />
              <BetCard icon={<Flame className="h-5 w-5" />} name="공격 배팅" tone="rose" qty={r.bets.aggressive} cover={`리드타임 + 45일${r.growthFactor !== 1 ? ` ×${r.growthFactor}` : ""}`} desc={trend === "rising" ? "상승세에 크게 베팅. 품절 방지 우선" : "대량 확보. 과재고 리스크 주의"} />
            </div>
            <p className="text-[11px] text-slate-500 mt-3">
              ⓘ 발주량 = 일판매량 × 커버기간 − 현재재고. 공격 배팅은 추세 성장계수를 반영합니다. 참고용 추정치입니다.
            </p>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium text-slate-200">{label}</label>
      {hint && <span className="text-[11px] text-slate-500 ml-1.5">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function NumInput({ value, onChange, min }: { value: number; onChange: (v: number) => void; min: number }) {
  return (
    <input
      type="number"
      min={min}
      value={value}
      onChange={e => onChange(Math.max(min, Number(e.target.value)))}
      className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-white outline-none focus:border-cyan-400/60 focus:bg-white/10 transition-colors"
    />
  );
}

function Stat({ label, value, sub, tone = "normal" }: { label: string; value: string; sub?: string; tone?: "normal" | "danger" | "good" }) {
  const color = tone === "danger" ? "text-red-400" : tone === "good" ? "text-emerald-300" : "text-white";
  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-2xl font-black mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

function BetCard({ icon, name, tone, qty, cover, desc, highlight }: {
  icon: React.ReactNode; name: string; tone: string; qty: number; cover: string; desc: string; highlight?: boolean;
}) {
  const text: Record<string, string> = { emerald: "text-emerald-300", cyan: "text-cyan-300", rose: "text-rose-300" };
  return (
    <div className={`glass glass-hover rounded-2xl p-4 ${highlight ? "glass-active" : ""}`}>
      <div className={`flex items-center gap-2 font-semibold ${text[tone]}`}>
        {icon} {name}
        {highlight && <span className="text-[10px] neon-chip neon-cyan px-1.5 py-0.5 rounded-full ml-auto">추천</span>}
      </div>
      <p className="text-3xl font-black mt-3 text-white">
        {qty.toLocaleString("ko-KR")}<span className="text-base text-slate-400 ml-1 font-medium">개</span>
      </p>
      <p className="text-xs text-slate-400 mt-1">{cover} 커버</p>
      <p className="text-[11px] text-slate-500 mt-2">{desc}</p>
    </div>
  );
}
