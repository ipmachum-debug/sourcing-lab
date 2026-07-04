import DashboardLayout from "@/components/DashboardLayout";
import { useAuth } from "@/_core/hooks/useAuth";
import { Globe2, Camera, Scale, Dices, Package, Ship, Sparkles } from "lucide-react";

// 역직구 채널 홈 — 국내매입 → 해외판매(POIZON·당근·아마존). 도구는 순차 오픈.
const TOOLS = [
  { icon: Camera, emoji: "📸", title: "오늘의 SKU TOP100", desc: "국내가 × POIZON 스프레드로 오늘 살 SKU 랭킹", status: "준비중" },
  { icon: Scale, emoji: "⚖️", title: "아비트리지 계산", desc: "POIZON 수수료·검수탈락·부가세환급까지 반영한 순익", status: "준비중" },
  { icon: Dices, emoji: "🎲", title: "베팅 사이징", desc: "자금 회전 기준으로 SKU별 매입 수량 추천", status: "준비중" },
  { icon: Package, emoji: "📦", title: "매입 관리", desc: "발품·매입·검수·정산을 한 곳에서", status: "준비중" },
  { icon: Ship, emoji: "🌏", title: "수출 관리", desc: "POIZON·당근 판매·회전율·회계", status: "준비중" },
];

const STEPS = [
  { n: 1, title: "국내 싸게 매입", desc: "아울렛·무신사 할인 상품 확보" },
  { n: 2, title: "해외 시세 비교", desc: "POIZON·당근으로 순익 확인" },
  { n: 3, title: "회전 맞춰 베팅", desc: "자금 묶임 없이 매입량 결정" },
];

export default function Reverse() {
  const { user } = useAuth();
  const name = (user as any)?.name || "셀러";

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10">
        <div className="max-w-5xl mx-auto space-y-10">
          {/* 히어로 */}
          <div className="pt-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest neon-chip neon-magenta px-3 py-1 rounded-full uppercase">
              <Globe2 className="h-3.5 w-3.5" /> Reverse Export
            </span>
            <h1 className="text-4xl sm:text-5xl font-black mt-5 tracking-tight text-white">
              역직구, <span className="neon-text">데이터로</span> 팝니다
            </h1>
            <p className="text-slate-300/80 mt-3 text-lg">
              {name}님, 국내에서 싸게 사서 해외(POIZON·당근)에 파는 걸 한 곳에서.
            </p>
            <span className="inline-flex items-center gap-1.5 mt-4 text-xs neon-chip px-3 py-1 rounded-full text-amber-300 border border-amber-400/30 bg-amber-400/5">
              <Sparkles className="h-3.5 w-3.5" /> 새 채널 · 도구 순차 오픈 중
            </span>
          </div>

          {/* 3단계 */}
          <section>
            <h2 className="text-sm font-semibold text-slate-400 tracking-widest mb-3">역직구 3단계</h2>
            <div className="grid sm:grid-cols-3 gap-3">
              {STEPS.map(s => (
                <div key={s.n} className="glass rounded-2xl p-5">
                  <span className="h-9 w-9 rounded-full grid place-items-center text-sm font-black text-white"
                    style={{ background: "linear-gradient(135deg,#db2777,#a855f7)", boxShadow: "0 0 16px rgba(217,70,239,0.5)" }}>
                    {s.n}
                  </span>
                  <p className="font-bold text-white mt-3">{s.title}</p>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* 도구 (준비중) */}
          <section>
            <h2 className="text-sm font-semibold text-slate-400 tracking-widest mb-3">도구</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {TOOLS.map(t => (
                <div key={t.title} className="glass rounded-2xl p-6 flex items-center gap-4 opacity-90">
                  <span className="h-14 w-14 rounded-2xl grid place-items-center text-2xl shrink-0 border border-white/10"
                    style={{ boxShadow: "0 0 22px rgba(217,70,239,0.35)", background: "rgba(255,255,255,0.04)" }}>
                    {t.emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <t.icon className="h-4 w-4 text-fuchsia-300" />
                      <span className="font-bold text-lg text-white">{t.title}</span>
                      <span className="text-[10px] font-semibold text-amber-300 bg-amber-400/10 border border-amber-400/25 px-1.5 py-0.5 rounded-full">
                        {t.status}
                      </span>
                    </div>
                    <p className="text-sm text-slate-400 mt-1 leading-relaxed">{t.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <p className="text-center text-xs text-slate-500 pt-2">
            대부분의 도구는 <b className="text-slate-400">쿠팡 채널의 엔진(원픽 랭킹·마진·베팅)</b>을 재활용합니다 — 피드만 바꾸면 됩니다.
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}
