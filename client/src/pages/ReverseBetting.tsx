import { useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Dices, ShieldCheck, Scale, Flame, TriangleAlert } from "lucide-react";

// 역직구 베팅 사이징 — 자금 회전 제약 하에 SKU를 몇 개 매입할지.
function compute(i: { capital: number; buyKRW: number; profitKRW: number; turnDays: number; passPct: number }) {
  const maxQty = i.buyKRW > 0 ? Math.floor(i.capital / i.buyKRW) : 0;
  const pass = Math.min(1, Math.max(0, i.passPct / 100));
  const turns = i.turnDays > 0 ? 30 / i.turnDays : 0; // 월 회전 횟수
  const monthly = (qty: number) => Math.round(qty * i.profitKRW * pass * turns);
  const bets = {
    conservative: Math.floor(maxQty * 0.3),
    balanced: Math.floor(maxQty * 0.6),
    aggressive: maxQty,
  };
  return { maxQty, turns, monthly, bets, slowTurn: i.turnDays > 21 };
}

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const num = (n: number) => Math.round(n).toLocaleString("ko-KR");

export default function ReverseBetting() {
  const [capital, setCapital] = useState(3000000);
  const [buyKRW, setBuyKRW] = useState(45000);
  const [profitKRW, setProfitKRW] = useState(18000);
  const [turnDays, setTurnDays] = useState(14);
  const [passPct, setPassPct] = useState(90);

  const r = useMemo(() => compute({ capital, buyKRW, profitKRW, turnDays, passPct }), [capital, buyKRW, profitKRW, turnDays, passPct]);

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10">
        <div className="max-w-4xl mx-auto space-y-6">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest neon-chip neon-magenta px-3 py-1 rounded-full uppercase">
              <Dices className="h-3.5 w-3.5" /> Bet Sizing
            </span>
            <h1 className="text-3xl font-black mt-4 neon-text">베팅 사이징</h1>
            <p className="text-slate-300/80 mt-2">자금이 <b className="text-white">한 바퀴 도는 속도</b>에 맞춰, 이 SKU를 몇 개 매입할지</p>
          </div>

          <div className="glass rounded-2xl p-5 grid sm:grid-cols-2 gap-4">
            <Num label="가용 운전자금 (원)" value={capital} onChange={setCapital} />
            <Num label="SKU당 매입가 (원)" value={buyKRW} onChange={setBuyKRW} />
            <Num label="SKU당 기대순익 (원)" value={profitKRW} onChange={setProfitKRW} hint="아비트리지 계산 결과" />
            <Num label="회전일 (자금 한바퀴)" value={turnDays} onChange={setTurnDays} hint="매입→판매→정산" />
            <Slide label="검수 통과율" value={passPct} onChange={setPassPct} />
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <Stat label="최대 매입 가능" value={`${num(r.maxQty)}개`} />
            <Stat label="월 회전" value={`${r.turns.toFixed(1)}회`} />
            <Stat label="자금 상태" value={r.slowTurn ? "회전 느림" : "양호"} tone={r.slowTurn ? "danger" : "good"} />
          </div>

          {r.slowTurn && (
            <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 flex items-start gap-2">
              <TriangleAlert className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-200">회전 {turnDays}일은 긴 편 — 자금이 오래 묶입니다. 흑자여도 현금이 안 돌면 흑자도산 위험. 회전 빠른 SKU 위주로.</div>
            </div>
          )}

          <div>
            <h2 className="font-bold text-lg mb-3 text-white">🎲 베팅 3단계 — 권장 매입 수량</h2>
            <div className="grid sm:grid-cols-3 gap-3">
              <Bet icon={<ShieldCheck className="h-5 w-5" />} name="보수 (30%)" tone="emerald" qty={r.bets.conservative} monthly={won(r.monthly(r.bets.conservative))} desc="현금 버퍼 크게, 안전" />
              <Bet icon={<Scale className="h-5 w-5" />} name="균형 (60%)" tone="cyan" qty={r.bets.balanced} monthly={won(r.monthly(r.bets.balanced))} desc="표준 추천" highlight />
              <Bet icon={<Flame className="h-5 w-5" />} name="공격 (전액)" tone="rose" qty={r.bets.aggressive} monthly={won(r.monthly(r.bets.aggressive))} desc="자금 다 태움, 회전 리스크" />
            </div>
            <p className="text-[11px] text-slate-500 mt-3">ⓘ 월 순익 = 수량 × 기대순익 × 검수통과율 × 월회전. 참고용 추정치.</p>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Num({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <div>
      <label className="text-sm font-medium text-slate-200">{label}</label>
      {hint && <span className="text-[11px] text-slate-500 ml-1.5">{hint}</span>}
      <input type="number" min={0} value={value} onChange={e => onChange(Math.max(0, Number(e.target.value)))}
        className="mt-1.5 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-white outline-none focus:border-fuchsia-400/60 focus:bg-white/10 transition-colors" />
    </div>
  );
}

function Slide({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-slate-200">{label}</label>
        <span className="text-sm font-bold text-white">{value}%</span>
      </div>
      <input type="range" min={50} max={100} step={1} value={value} onChange={e => onChange(Number(e.target.value))}
        className="w-full mt-2 cursor-pointer" style={{ accentColor: "#d946ef" }} />
    </div>
  );
}

function Stat({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "danger" | "good" }) {
  const c = tone === "danger" ? "text-red-400" : tone === "good" ? "text-emerald-300" : "text-white";
  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-2xl font-black mt-1 ${c}`}>{value}</p>
    </div>
  );
}

function Bet({ icon, name, tone, qty, monthly, desc, highlight }: { icon: React.ReactNode; name: string; tone: string; qty: number; monthly: string; desc: string; highlight?: boolean }) {
  const t: Record<string, string> = { emerald: "text-emerald-300", cyan: "text-cyan-300", rose: "text-rose-300" };
  return (
    <div className={`glass glass-hover rounded-2xl p-4 ${highlight ? "glass-active" : ""}`}>
      <div className={`flex items-center gap-2 font-semibold ${t[tone]}`}>{icon} {name}
        {highlight && <span className="text-[10px] neon-chip neon-magenta px-1.5 py-0.5 rounded-full ml-auto">추천</span>}
      </div>
      <p className="text-3xl font-black mt-3 text-white">{qty.toLocaleString("ko-KR")}<span className="text-base text-slate-400 ml-1 font-medium">개</span></p>
      <p className="text-xs text-slate-400 mt-1">월 예상 순익 <b className="text-fuchsia-300">{monthly}</b></p>
      <p className="text-[11px] text-slate-500 mt-2">{desc}</p>
    </div>
  );
}
