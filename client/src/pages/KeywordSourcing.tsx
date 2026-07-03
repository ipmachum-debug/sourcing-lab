import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, Rocket } from "lucide-react";

type TierKey = "beginner" | "intermediate" | "advanced" | "trend";

const TIERS: {
  key: TierKey;
  badge: string;
  badgeColor: string;
  name: string;
  dot: string;
  range: string;
  desc: string;
}[] = [
  { key: "beginner", badge: "🌱 소자본", badgeColor: "text-green-600 bg-green-50", name: "새싹 원픽", dot: "bg-green-500", range: "월 300만~1,000만", desc: "적은 자본으로 안전하게 첫 발을 떼는 시장" },
  { key: "intermediate", badge: "📈 성장", badgeColor: "text-sky-600 bg-sky-50", name: "성장 원픽", dot: "bg-sky-500", range: "월 1,000만~3,000만", desc: "수요가 검증돼 규모를 키우기 좋은 시장" },
  { key: "advanced", badge: "🏆 대형", badgeColor: "text-rose-600 bg-rose-50", name: "메이저 원픽", dot: "bg-rose-500", range: "월 3,000만+", desc: "경쟁을 뚫고 큰 매출을 노리는 시장" },
  { key: "trend", badge: "⚡ 급부상", badgeColor: "text-violet-600 bg-violet-50", name: "라이징 원픽", dot: "bg-violet-500", range: "리뷰 50↓ · 월 3,000만+", desc: "리뷰는 적은데 매출이 터지는 신흥 시장" },
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
    const params = new URLSearchParams({
      tier,
      maxReview: String(maxReview),
    });
    if (category) params.set("categories", category);
    if (tags.length) params.set("tags", tags.join(","));
    setLocation(`/sourcing/results?${params.toString()}`);
  };

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-8 pb-24">
        {/* 헤더 */}
        <div className="text-center pt-4">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-pink-500 bg-pink-50 px-3 py-1 rounded-full">
            🔎 원픽 엔진
          </span>
          <h1 className="text-3xl font-bold mt-4 gradient-text">오늘의 원픽키워드</h1>
          <p className="text-muted-foreground mt-2">쿠팡 판매 데이터로, 지금 통하는 원픽키워드만 골라드려요</p>
        </div>

        {/* ① 티어 */}
        <section>
          <StepTitle n={1} title="어느 규모의 시장을 노리세요?" sub="매출 규모로 시장 등급을 하나 골라주세요" />
          <div className="grid sm:grid-cols-2 gap-3 mt-4">
            {TIERS.map(t => {
              const active = tier === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTier(t.key)}
                  className={`text-left rounded-2xl border p-5 transition-all ${
                    active
                      ? "border-pink-300 bg-gradient-to-br from-pink-50 to-purple-50 ring-2 ring-pink-200"
                      : "border-gray-200 hover:border-pink-200 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${t.badgeColor}`}>
                      {t.badge}
                    </span>
                    <span className={`h-4 w-4 rounded-full border-2 ${active ? "border-pink-400 bg-pink-400" : "border-gray-300"} flex items-center justify-center`}>
                      {active && <Check className="h-3 w-3 text-white" />}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <span className={`h-2 w-2 rounded-full ${t.dot}`} />
                    <span className="font-bold text-lg">{t.name}</span>
                  </div>
                  <p className="font-semibold text-sm mt-2">{t.range}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t.desc}</p>
                </button>
              );
            })}
          </div>
        </section>

        {/* ② 리뷰 슬라이더 */}
        <section>
          <StepTitle n={2} title="1위 상품 리뷰 상한" sub="1위 상품 리뷰가 이보다 적은(=뚫기 쉬운) 키워드만 골라요" />
          <Card className="p-6 mt-4">
            <div className="flex items-end justify-between mb-4">
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground tracking-wider">MAX REVIEWS</p>
                <p className="text-4xl font-bold text-pink-500 mt-1">
                  {maxReview.toLocaleString()}<span className="text-base text-muted-foreground ml-1">개</span>
                </p>
              </div>
              <span className="text-xs text-green-600 bg-green-50 px-2.5 py-1 rounded-full">
                👍 리뷰가 적을수록 뚫기 쉬워요
              </span>
            </div>
            <input
              type="range"
              value={maxReview}
              onChange={e => setMaxReview(Number(e.target.value))}
              min={50}
              max={1000}
              step={10}
              className="w-full accent-pink-500 cursor-pointer"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-2">
              <span>50</span>
              <span>1,000</span>
            </div>
          </Card>
        </section>

        {/* ③ 카테고리 */}
        <section>
          <StepTitle n={3} title="관심 카테고리" sub="특정 카테고리만 볼거면 선택하세요 (안 고르면 전체)" />
          <div className="grid sm:grid-cols-3 gap-2.5 mt-4">
            {CATEGORIES.map(c => {
              const active = category === c;
              return (
                <button
                  key={c}
                  onClick={() => setCategory(active ? null : c)}
                  className={`rounded-xl border px-4 py-3 text-sm text-left transition-all flex items-center justify-between ${
                    active
                      ? "border-pink-300 bg-pink-50 text-pink-700 font-medium"
                      : "border-gray-200 hover:border-pink-200 bg-white"
                  }`}
                >
                  {c}
                  <span className={`h-4 w-4 rounded-full border ${active ? "border-pink-400 bg-pink-400" : "border-gray-300"} flex items-center justify-center shrink-0`}>
                    {active && <Check className="h-3 w-3 text-white" />}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* ④ 태그 */}
        <section>
          <StepTitle n={4} title="시장 성향 태그" sub="원하는 성향을 골라요 (복수 선택 가능)" />
          <div className="flex flex-wrap gap-2 mt-4">
            {TAGS.map(t => {
              const active = tags.includes(t.key);
              return (
                <button
                  key={t.key}
                  onClick={() => toggleTag(t.key)}
                  className={`rounded-full border px-4 py-2 text-sm transition-all ${
                    active
                      ? "border-pink-300 bg-pink-50 text-pink-700 font-medium"
                      : "border-gray-200 hover:border-pink-200 bg-white"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </section>
      </div>

      {/* 하단 고정 CTA */}
      <div className="fixed bottom-0 left-0 right-0 z-20 bg-white/90 backdrop-blur border-t border-pink-100 p-4">
        <div className="max-w-4xl mx-auto">
          <Button
            onClick={start}
            disabled={!tier}
            className="w-full h-14 text-base font-semibold bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 disabled:opacity-40"
          >
            {tier ? (
              <span className="flex items-center gap-2">원픽 찾기 시작 <Rocket className="h-4 w-4" /></span>
            ) : (
              "먼저 시장 등급을 골라주세요"
            )}
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}

function StepTitle({ n, title, sub }: { n: number; title: string; sub: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="h-6 w-6 rounded-full bg-pink-100 text-pink-600 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
        {n}
      </span>
      <div>
        <h2 className="font-bold text-lg">{title}</h2>
        <p className="text-sm text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}
