import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useLocation } from "wouter";
import { Check, Rocket, Sparkles } from "lucide-react";

type TierKey = "beginner" | "intermediate" | "advanced" | "trend";

const TIERS: {
  key: TierKey;
  badge: string;
  name: string;
  dot: string;
  glow: string;
  range: string;
  desc: string;
}[] = [
  { key: "beginner", badge: "🌱 소자본", name: "새싹 원픽", dot: "#34d399", glow: "rgba(52,211,153,0.6)", range: "월 300만~1,000만", desc: "적은 자본으로 안전하게 첫 발을 떼는 시장" },
  { key: "intermediate", badge: "📈 성장", name: "성장 원픽", dot: "#38bdf8", glow: "rgba(56,189,248,0.6)", range: "월 1,000만~3,000만", desc: "수요가 검증돼 규모를 키우기 좋은 시장" },
  { key: "advanced", badge: "🏆 대형", name: "메이저 원픽", dot: "#fb7185", glow: "rgba(251,113,133,0.6)", range: "월 3,000만+", desc: "경쟁을 뚫고 큰 매출을 노리는 시장" },
  { key: "trend", badge: "⚡ 급부상", name: "라이징 원픽", dot: "#c084fc", glow: "rgba(192,132,252,0.65)", range: "리뷰 50↓ · 월 3,000만+", desc: "리뷰는 적은데 매출이 터지는 신흥 시장" },
];

const CATEGORIES = [
  "화장품/미용", "출산/육아", "패션의류", "패션잡화", "스포츠/레저",
  "여가/생활편의", "생활/건강", "디지털/가전", "가구/인테리어",
];

const TAGS: { key: string; label: string }[] = [
  { key: "surge", label: "🔥 급상승" },
  { key: "new", label: "✨ 신규 진입" },
  { key: "blue_ocean", label: "🌊 블루오션" },
  { key: "seasonal", label: "🗓️ 시즌템" },
  { key: "rocket_gap", label: "🚀 로켓 공백" },
  { key: "high_price", label: "💎 고단가" },
];

export default function KeywordSourcing() {
  const [, setLocation] = useLocation();
  const [tier, setTier] = useState<TierKey | null>(null);
  const [maxReview, setMaxReview] = useState(500);
  const [category, setCategory] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);

  const toggleTag = (k: string) =>
    setTags(prev => (prev.includes(k) ? prev.filter(t => t !== k) : [...prev, k]));

  const start = () => {
    if (!tier) return;
    const params = new URLSearchParams({ tier, maxReview: String(maxReview) });
    if (category) params.set("categories", category);
    if (tags.length) params.set("tags", tags.join(","));
    setLocation(`/sourcing/results?${params.toString()}`);
  };

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10 pb-28">
        <div className="max-w-4xl mx-auto space-y-10">
          {/* 헤더 */}
          <div className="text-center pt-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest neon-chip neon-cyan px-3 py-1 rounded-full uppercase">
              <Sparkles className="h-3.5 w-3.5" /> Onepick Engine
            </span>
            <h1 className="text-4xl sm:text-5xl font-black mt-5 neon-text tracking-tight">오늘의 원픽키워드</h1>
            <p className="text-slate-300/80 mt-3">쿠팡 판매 데이터로, 지금 통하는 원픽키워드만 골라드려요</p>
          </div>

          {/* ① 티어 */}
          <section className="space-y-4">
            <StepTitle n={1} title="어느 규모의 시장을 노리세요?" sub="매출 규모로 시장 등급을 하나 골라주세요" />
            <div className="grid sm:grid-cols-2 gap-4">
              {TIERS.map(t => {
                const active = tier === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => setTier(t.key)}
                    className={`glass glass-hover ${active ? "glass-active" : ""} text-left rounded-2xl p-5`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full neon-chip">{t.badge}</span>
                      <span className={`h-5 w-5 rounded-full flex items-center justify-center border ${active ? "border-transparent" : "border-white/20"}`}
                        style={active ? { background: t.dot, boxShadow: `0 0 14px ${t.glow}` } : {}}>
                        {active && <Check className="h-3 w-3 text-black/80" />}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-4">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.dot, boxShadow: `0 0 12px ${t.glow}` }} />
                      <span className="font-bold text-xl text-white">{t.name}</span>
                    </div>
                    <p className="font-semibold text-sm mt-2 neon-cyan">{t.range}</p>
                    <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{t.desc}</p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ② 리뷰 슬라이더 */}
          <section className="space-y-4">
            <StepTitle n={2} title="1위 상품 리뷰 상한" sub="1위 상품 리뷰가 이보다 적은(=뚫기 쉬운) 키워드만 골라요" />
            <div className="glass rounded-2xl p-6">
              <div className="flex items-end justify-between mb-5">
                <div>
                  <p className="text-[11px] font-semibold text-slate-400 tracking-[0.2em]">MAX REVIEWS</p>
                  <p className="text-5xl font-black mt-1 neon-text">
                    {maxReview.toLocaleString()}<span className="text-base text-slate-400 ml-2 font-medium">개</span>
                  </p>
                </div>
                <span className="text-xs neon-chip neon-cyan px-3 py-1.5 rounded-full">👍 적을수록 뚫기 쉬워요</span>
              </div>
              <input
                type="range"
                value={maxReview}
                onChange={e => setMaxReview(Number(e.target.value))}
                min={50}
                max={1000}
                step={10}
                className="w-full cursor-pointer"
                style={{ accentColor: "#22d3ee" }}
              />
              <div className="flex justify-between text-xs text-slate-500 mt-2">
                <span>50</span>
                <span>1,000</span>
              </div>
            </div>
          </section>

          {/* ③ 카테고리 */}
          <section className="space-y-4">
            <StepTitle n={3} title="관심 카테고리" sub="특정 카테고리만 볼거면 선택하세요 (안 고르면 전체)" />
            <div className="grid sm:grid-cols-3 gap-2.5">
              {CATEGORIES.map(c => {
                const active = category === c;
                return (
                  <button
                    key={c}
                    onClick={() => setCategory(active ? null : c)}
                    className={`neon-chip ${active ? "neon-chip-on" : "text-slate-200"} rounded-xl px-4 py-3 text-sm text-left flex items-center justify-between`}
                  >
                    {c}
                    <span className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ${active ? "border-transparent bg-fuchsia-400" : "border-white/25"}`}>
                      {active && <Check className="h-3 w-3 text-black/80" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ④ 태그 */}
          <section className="space-y-4">
            <StepTitle n={4} title="시장 성향 태그" sub="원하는 성향을 골라요 (복수 선택 가능)" />
            <div className="flex flex-wrap gap-2.5">
              {TAGS.map(t => {
                const active = tags.includes(t.key);
                return (
                  <button
                    key={t.key}
                    onClick={() => toggleTag(t.key)}
                    className={`neon-chip ${active ? "neon-chip-on" : "text-slate-200"} rounded-full px-4 py-2 text-sm`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      {/* 하단 고정 CTA */}
      <div className="fixed bottom-0 left-0 right-0 z-20 bg-[#070a1a]/85 backdrop-blur-xl border-t border-white/10 p-4">
        <div className="max-w-4xl mx-auto">
          <button
            onClick={start}
            disabled={!tier}
            className="neon-btn w-full h-14 rounded-2xl text-base font-bold flex items-center justify-center gap-2"
          >
            {tier ? (
              <>원픽 찾기 시작 <Rocket className="h-4 w-4" /></>
            ) : (
              "먼저 시장 등급을 골라주세요"
            )}
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}

function StepTitle({ n, title, sub }: { n: number; title: string; sub: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="h-7 w-7 rounded-full grid place-items-center shrink-0 text-xs font-black text-white"
        style={{ background: "linear-gradient(135deg,#06b6d4,#a855f7)", boxShadow: "0 0 16px rgba(168,85,247,0.5)" }}>
        {n}
      </span>
      <div>
        <h2 className="font-bold text-lg text-white">{title}</h2>
        <p className="text-sm text-slate-400">{sub}</p>
      </div>
    </div>
  );
}
