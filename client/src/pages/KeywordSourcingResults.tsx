import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ChevronDown, ArrowRight, Rocket } from "lucide-react";

type TierKey = "beginner" | "intermediate" | "advanced" | "trend";

interface TopProduct {
  coupangProductId: string;
  productName: string;
  price: number;
  reviewCount: number;
  estMonthlySales: number;
  estMonthlyRevenue: number;
  rankInKeyword: number;
}
interface Item {
  keyword: string;
  normalizedKeyword: string;
  grade: string;
  tier: string;
  category: string | null;
  stats: {
    productCount: number;
    avgPrice: number;
    totalReviewSum: number;
    topProductReviewCount: number;
    competitionLevel: string;
    monthlySales: number;
    monthlyRevenue: number;
    honeypotScore: number;
    contributorCount: number;
    lastObservedDate: string | null;
  };
  topProducts: TopProduct[];
}

const TIER_LABEL: Record<string, string> = {
  beginner: "초보 키워드",
  intermediate: "중수 키워드",
  advanced: "고수 키워드",
  trend: "트렌드 키워드",
};

const GRADE_STYLE: Record<string, string> = {
  S_PLUS: "bg-amber-400 text-amber-950",
  S: "bg-emerald-400 text-emerald-950",
  A: "bg-teal-400 text-teal-950",
  B: "bg-gray-300 text-gray-700",
  C: "bg-gray-200 text-gray-500",
};
const GRADE_LABEL: Record<string, string> = { S_PLUS: "S+", S: "S", A: "A", B: "B", C: "C" };

function won(n: number) {
  if (!n) return "-";
  if (n >= 10000) return `${Math.round(n / 10000).toLocaleString()}만원`;
  return `${n.toLocaleString()}원`;
}
function num(n: number) {
  return (n ?? 0).toLocaleString("ko-KR");
}

function parseParams() {
  const sp = new URLSearchParams(window.location.search);
  const tier = (sp.get("tier") ?? "beginner") as TierKey;
  const maxReview = Number(sp.get("maxReview") ?? 500);
  const categories = (sp.get("categories") ?? "").split(",").filter(Boolean);
  const tags = (sp.get("tags") ?? "").split(",").filter(Boolean) as any[];
  return { tier, maxReview, categories, tags };
}

export default function KeywordSourcingResults() {
  const [, setLocation] = useLocation();
  const input = useMemo(parseParams, []);
  const stats = trpc.sourcingWizard.honeypotStats.useQuery();
  const search = trpc.sourcingWizard.honeypotSearch.useQuery(
    { tier: input.tier, maxReview: input.maxReview, categories: input.categories, tags: input.tags },
    { refetchOnWindowFocus: false }
  );

  if (search.isLoading) {
    return (
      <DashboardLayout>
        <LoadingView
          tier={input.tier}
          keywords={stats.data?.keywords ?? 0}
          categories={stats.data?.categories ?? 0}
          products={stats.data?.products ?? 0}
        />
      </DashboardLayout>
    );
  }

  const data = search.data as { totalFound: number; items: Item[] } | undefined;
  const items = data?.items ?? [];

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-5 pb-16">
        {/* 헤더 */}
        <div className="text-center pt-4">
          <CheckCircle2 className="h-12 w-12 text-emerald-400 mx-auto" />
          <h1 className="text-2xl md:text-3xl font-bold mt-4">소싱 완료! 꿀통키워드를 찾았습니다</h1>
          <span className="inline-block mt-3 text-sm font-semibold text-emerald-700 bg-emerald-50 px-4 py-1.5 rounded-full">
            {data?.totalFound ?? 0}개 꿀통키워드 발견
          </span>
          <p className="text-xs text-muted-foreground mt-2">클릭하여 효자상품을 확인하세요 ↓</p>
        </div>

        {items.length === 0 ? (
          <EmptyState onRetry={() => setLocation("/sourcing")} />
        ) : (
          <div className="space-y-3">
            {items.map(item => (
              <KeywordCard key={item.normalizedKeyword} item={item} />
            ))}
          </div>
        )}

        <div className="text-center pt-4">
          <Button
            variant="outline"
            onClick={() => setLocation("/sourcing")}
            className="rounded-full px-6"
          >
            <Rocket className="h-4 w-4 mr-2" /> AI 소싱 한번더 하기
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}

function KeywordCard({ item }: { item: Item }) {
  const [open, setOpen] = useState(false);
  const s = item.stats;
  return (
    <Card className="overflow-hidden">
      {/* 접힘: 3줄 요약 */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-3 px-4 py-4 text-left transition-colors ${
          open ? "bg-pink-50/40" : "hover:bg-gray-50"
        }`}
      >
        <span className={`h-8 w-8 rounded-lg text-xs font-bold flex items-center justify-center shrink-0 ${GRADE_STYLE[item.grade] ?? GRADE_STYLE.C}`}>
          {GRADE_LABEL[item.grade] ?? item.grade}
        </span>
        <span className="font-bold text-lg flex-1 truncate">{item.keyword}</span>
        <div className="hidden sm:flex items-center gap-6 text-right shrink-0">
          <Mini label="판매량" value={num(s.monthlySales)} />
          <Mini label="리뷰수" value={num(s.totalReviewSum)} accent />
          <Mini label="상품수" value={`${num(s.productCount)}개`} />
        </div>
        <ChevronDown className={`h-5 w-5 text-gray-400 transition-transform ml-2 ${open ? "rotate-180" : ""}`} />
      </button>

      {/* 펼침: 상세 */}
      {open && (
        <div className="px-4 pb-5 pt-1 border-t">
          <div className="flex items-center gap-2 my-4">
            <h3 className="text-2xl font-bold">{item.keyword}</h3>
            <span className="text-[11px] font-semibold text-pink-600 bg-pink-50 px-2 py-0.5 rounded ml-auto">
              {TIER_LABEL[item.tier] ?? item.tier}
            </span>
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${GRADE_STYLE[item.grade] ?? GRADE_STYLE.C}`}>
              {GRADE_LABEL[item.grade] ?? item.grade} GRADE
            </span>
          </div>

          {/* 5개 스탯 */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="총판매량" value={`${num(s.monthlySales)}개`} />
            <Stat label="총리뷰수" value={num(s.totalReviewSum)} accent />
            <Stat
              label="상품수"
              value={`${num(s.productCount)}개`}
              sub={s.competitionLevel === "easy" ? "🟢 Low Competition" : s.competitionLevel === "hard" ? "🔴 High Competition" : "🟡 Medium"}
            />
            <Stat label="평균가" value={won(s.avgPrice)} amber />
            <Stat label="총 월매출" value={won(s.monthlyRevenue)} amber sub={`Top ${num(s.monthlySales)}개/월`} />
          </div>

          {/* 효자상품 */}
          {item.topProducts.length > 0 && (
            <div className="mt-5">
              <p className="font-bold text-sm mb-2">
                효자상품 리스트 <span className="text-xs text-muted-foreground">Top {item.topProducts.length}</span>
              </p>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-muted-foreground">
                    <tr>
                      <th className="text-left font-medium px-3 py-2">상품명</th>
                      <th className="text-right font-medium px-3 py-2">가격</th>
                      <th className="text-right font-medium px-3 py-2">리뷰</th>
                      <th className="text-right font-medium px-3 py-2">월판매</th>
                      <th className="text-right font-medium px-3 py-2">월매출</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {item.topProducts.map((p, i) => (
                      <tr key={p.coupangProductId || i} className="border-t">
                        <td className="px-3 py-2.5">
                          <span className="text-gray-400 mr-1.5">{i + 1}</span>
                          <span className="truncate">{p.productName}</span>
                        </td>
                        <td className="text-right px-3 py-2.5">{won(p.price)}</td>
                        <td className="text-right px-3 py-2.5">{num(p.reviewCount)}</td>
                        <td className="text-right px-3 py-2.5 font-semibold">{num(p.estMonthlySales)}</td>
                        <td className="text-right px-3 py-2.5 text-amber-600 font-semibold">{won(p.estMonthlyRevenue)}</td>
                        <td className="text-right px-3 py-2.5">
                          {p.coupangProductId && (
                            <a
                              href={`https://www.coupang.com/vp/products/${p.coupangProductId}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-full border hover:bg-pink-50"
                            >
                              <ArrowRight className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {s.contributorCount > 0 && (
            <p className="text-[11px] text-muted-foreground mt-3">
              👥 {s.contributorCount}명의 검색 데이터로 집계 · 최근 관측 {s.lastObservedDate ?? "-"}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function Mini({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={`font-bold text-sm ${accent ? "text-amber-600" : ""}`}>{value}</p>
    </div>
  );
}

function Stat({ label, value, sub, accent, amber }: { label: string; value: string; sub?: string; accent?: boolean; amber?: boolean }) {
  return (
    <div className="rounded-xl border bg-gray-50/60 p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold mt-1 ${accent ? "text-amber-600" : amber ? "text-amber-600" : ""}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function EmptyState({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="p-10 text-center">
      <p className="text-4xl">🐝</p>
      <p className="font-semibold mt-3">조건에 맞는 꿀통키워드가 아직 없어요</p>
      <p className="text-sm text-muted-foreground mt-1">
        공유 데이터가 쌓일수록 결과가 풍부해집니다. 조건을 넓혀 다시 시도해보세요.
      </p>
      <Button variant="outline" onClick={onRetry} className="mt-4 rounded-full">
        조건 바꿔서 다시
      </Button>
    </Card>
  );
}

function LoadingView({ tier, keywords, categories, products }: { tier: string; keywords: number; categories: number; products: number }) {
  const [pct, setPct] = useState(8);
  useEffect(() => {
    const id = setInterval(() => setPct(p => (p >= 92 ? 92 : p + Math.floor(Math.random() * 12) + 3)), 320);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="max-w-2xl mx-auto text-center pt-10 space-y-6">
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full">
        ● AI SOURCING ENGINE
      </span>
      <div>
        <span className="inline-block text-xs font-semibold text-pink-600 bg-pink-50 px-3 py-1 rounded-full mb-4">
          {TIER_LABEL[tier] ?? tier}
        </span>
        <h1 className="text-3xl font-bold">쿠팡 키워드 DB 분석 중..</h1>
        <p className="text-sm text-muted-foreground mt-2">키워드 필터링 중...</p>
      </div>
      <div className="text-right">
        <span className="text-4xl font-bold text-emerald-500">{Math.min(pct, 99)}%</span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full bg-gradient-to-r from-emerald-400 to-teal-400 transition-all" style={{ width: `${Math.min(pct, 99)}%` }} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Counter label="KEYWORDS" value={keywords} />
        <Counter label="CATEGORIES" value={categories} />
        <Counter label="PRODUCTS" value={products} />
      </div>
      <div className="rounded-xl bg-gray-900 text-emerald-300 text-left text-xs font-mono p-4 leading-relaxed">
        <p className="text-gray-500">AI Sourcing Engine v2.0</p>
        <p className="mt-2">▸ Connecting to shared keyword pool…</p>
        <p>▸ Filtering {num(keywords)} keywords…</p>
      </div>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-[10px] text-muted-foreground tracking-wider">{label}</p>
      <p className="text-2xl font-bold text-teal-500 mt-1">{num(value)}</p>
    </div>
  );
}
