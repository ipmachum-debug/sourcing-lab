import DashboardLayout from "@/components/DashboardLayout";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { Search, Dices, Calculator, Package, ArrowRight, Sparkles } from "lucide-react";

const ACTIONS = [
  { icon: Search, emoji: "🔎", title: "원픽 소싱", desc: "지금 뜨는 쿠팡 키워드를 데이터로 골라드려요", path: "/sourcing", tone: "cyan" },
  { icon: Dices, emoji: "🎲", title: "재고 배팅", desc: "언제·얼마나 발주할지 3단계로 추천", path: "/inventory-bet", tone: "magenta" },
  { icon: Calculator, emoji: "🧮", title: "계산기", desc: "마진·순수익을 빠르게 계산", path: "/quick-margin", tone: "violet" },
  { icon: Package, emoji: "📌", title: "내 소싱", desc: "관심 상품·테스트 후보 관리", path: "/my-sourcing", tone: "emerald" },
];

const STEPS = [
  { n: 1, title: "팔릴 상품 찾기", desc: "원픽 소싱으로 수익성 높은 키워드 발굴", path: "/sourcing" },
  { n: 2, title: "마진 확인", desc: "빠른 마진으로 남는 장사인지 체크", path: "/quick-margin" },
  { n: 3, title: "발주 결정", desc: "재고 배팅으로 얼마나 걸지 판단", path: "/inventory-bet" },
];

const GLOW: Record<string, string> = {
  cyan: "rgba(34,211,238,0.55)",
  magenta: "rgba(217,70,239,0.55)",
  violet: "rgba(168,85,247,0.55)",
  emerald: "rgba(52,211,153,0.5)",
};
const ICON_TINT: Record<string, string> = {
  cyan: "text-cyan-300",
  magenta: "text-fuchsia-300",
  violet: "text-violet-300",
  emerald: "text-emerald-300",
};

export default function Home() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const name = (user as any)?.name || "셀러";

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10">
        <div className="max-w-5xl mx-auto space-y-10">
          {/* 히어로 */}
          <div className="pt-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest neon-chip neon-cyan px-3 py-1 rounded-full uppercase">
              <Sparkles className="h-3.5 w-3.5" /> Sourcing Lab
            </span>
            <h1 className="text-4xl sm:text-5xl font-black mt-5 tracking-tight text-white">
              반가워요, <span className="neon-text">{name}</span>님 👋
            </h1>
            <p className="text-slate-300/80 mt-3 text-lg">오늘도 팔릴 상품, 데이터로 찾아드릴게요.</p>
          </div>

          {/* 3단계로 시작 */}
          <section>
            <h2 className="text-sm font-semibold text-slate-400 tracking-widest mb-3">3단계로 시작하기</h2>
            <div className="grid sm:grid-cols-3 gap-3">
              {STEPS.map((s, i) => (
                <button
                  key={s.n}
                  onClick={() => setLocation(s.path)}
                  className="glass glass-hover rounded-2xl p-5 text-left relative"
                >
                  <span className="h-9 w-9 rounded-full grid place-items-center text-sm font-black text-white"
                    style={{ background: "linear-gradient(135deg,#06b6d4,#a855f7)", boxShadow: "0 0 16px rgba(168,85,247,0.5)" }}>
                    {s.n}
                  </span>
                  <p className="font-bold text-white mt-3">{s.title}</p>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">{s.desc}</p>
                  {i < STEPS.length - 1 && (
                    <ArrowRight className="hidden sm:block absolute -right-2.5 top-1/2 h-5 w-5 text-slate-600" />
                  )}
                </button>
              ))}
            </div>
          </section>

          {/* 핵심 도구 */}
          <section>
            <h2 className="text-sm font-semibold text-slate-400 tracking-widest mb-3">바로가기</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {ACTIONS.map(a => (
                <button
                  key={a.path}
                  onClick={() => setLocation(a.path)}
                  className="glass glass-hover rounded-2xl p-6 text-left flex items-center gap-4 group"
                >
                  <span
                    className="h-14 w-14 rounded-2xl grid place-items-center text-2xl shrink-0 border border-white/10"
                    style={{ boxShadow: `0 0 22px ${GLOW[a.tone]}`, background: "rgba(255,255,255,0.04)" }}
                  >
                    {a.emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <a.icon className={`h-4 w-4 ${ICON_TINT[a.tone]}`} />
                      <span className="font-bold text-lg text-white">{a.title}</span>
                    </div>
                    <p className="text-sm text-slate-400 mt-1 leading-relaxed">{a.desc}</p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-slate-600 group-hover:text-cyan-300 transition-colors shrink-0" />
                </button>
              ))}
            </div>
          </section>

          <p className="text-center text-xs text-slate-500 pt-2">
            더 많은 기능은 왼쪽 <b className="text-slate-400">고급</b> 메뉴에서 열 수 있어요.
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}
