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
  { key: "beginner", badge: "입문추천", badgeColor: "text-green-600 bg-green-50", name: "초보 키워드", dot: "bg-green-500", range: "월매출 300만~1,000만", desc: "소자본으로 시작하기 좋은 안전한 시장" },
  { key: "intermediate", badge: "안정매출", badgeColor: "text-yellow-600 bg-yellow-50", name: "중수 키워드", dot: "bg-yellow-500", range: "월매출 1,000만~3,000만", desc: "매출 규모가 검증된 중급 시장" },
  { key: "advanced", badge: "고수익", badgeColor: "text-red-600 bg-red-50", name: "고수 키워드", dot: "bg-red-500", range: "월매출 3,000만+", desc: "큰 매출을 노리는 경쟁 시장" },
  { key: "trend", badge: "급성장", badgeColor: "text-purple-600 bg-purple-50", name: "트렌드 키워드", dot: "bg-purple-500", range: "리뷰 50 이하 + 3,000만+", desc: "리뷰가 적지만 매출이 터지는 신규 시장" },
];

const CATEGORIES = [
  "화장품/미용", "출산/육아", "패션의류", "패션잡화", "스포츠/레저",
  "여가/생활편의", "생활/건강", "디지털/가전", "가구/인테리어",
];

const TAGS: { key: string; label: string }[] = [
  { key: "surge", label: "🔥 급상승" },
  { key: "new", label: "🆕 新 신규" },
  { key: "blue_ocean", label: "💎 블루오션" },
  { key: "seasonal", label: "🗓️ 계절성" },
  { key: "rocket_gap", label: "🚀 로켓공백" },
  { key: "high_price", label: "👑 고단가" },
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
            🔎 AI 소싱
          </span>
          <h1 className="text-3xl font-bold mt-4 gradient-text">AI 꿀통키워드 소싱</h1>
          <p className="text-muted-foreground mt-2">AI가 수익성 높은 쿠팡 키워드를 찾아드립니다</p>
        </div>

        {/* ① 티어 */}
        <section>
          <StepTitle n={1} title="어떤 키워드를 찾으시나요?" sub="원하는 키워드 티어를 하나 선택해주세요" />
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
          <StepTitle n={2} title="효자상품 최대 리뷰수" sub="매출 1위 효자상품의 리뷰가 이 수 이하인 꿀통키워드만 보여드립니다" />
          <Card className="p-6 mt-4">
            <div className="flex items-end justify-between mb-4">
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground tracking-wider">MAX REVIEWS</p>
                <p className="text-4xl font-bold text-pink-500 mt-1">
                  {maxReview.toLocaleString()}<span className="text-base text-muted-foreground ml-1">개</span>
                </p>
              </div>
              <span className="text-xs text-green-600 bg-green-50 px-2.5 py-1 rounded-full">
                ⓘ 리뷰가 적을수록 진입 난이도가 낮아요!
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
          <StepTitle n={3} title="소싱할 상품 카테고리" sub="특정 카테고리만 소싱하려면 선택하세요 (미선택 시 전체)" />
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
          <StepTitle n={4} title="관심 태그 선택" sub="(복수 선택 가능)" />
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
              <span className="flex items-center gap-2">소싱 시작하기 <Rocket className="h-4 w-4" /></span>
            ) : (
              "키워드 티어를 선택해주세요"
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
