import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, ChevronDown, ArrowRight, Rocket, ShieldAlert } from "lucide-react";
import { detectCerts } from "@shared/certifications";

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
  beginner: "새싹 원픽",
  intermediate: "성장 원픽",
  advanced: "메이저 원픽",
  trend: "라이징 원픽",
};

const GRADE_STYLE: Record<string, string> = {
  S_PLUS: "bg-amber-400 text-amber-950 shadow-[0_0_16px_rgba(251,191,36,0.5)]",
  S: "bg-emerald-400 text-emerald-950 shadow-[0_0_16px_rgba(52,211,153,0.45)]",
  A: "bg-cyan-400 text-cyan-950 shadow-[0_0_16px_rgba(34,211,238,0.45)]",
  B: "bg-slate-300 text-slate-800",
  C: "bg-slate-500/50 text-slate-200",
};
const GRADE_LABEL: Record<string, string> = {
  S_PLUS: "슈퍼 원픽",
  S: "강력 원픽",
  A: "유망 원픽",
  B: "테스트 원픽",
  C: "관찰 키워드",
};

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

  const data = search.data as { totalFound: number; items: Item[] } | undefined;
  const items = data?.items ?? [];

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10">
        {search.isLoading ? (
          <LoadingView
            tier={input.tier}
            keywords={stats.data?.keywords ?? 0}
            categories={stats.data?.categories ?? 0}
            products={stats.data?.products ?? 0}
          />
        ) : (
          <div className="max-w-5xl mx-auto space-y-6">
            {/* 헤더 */}
            <div className="text-center pt-2">
              <div className="relative inline-grid place-items-center">
                <span className="absolute h-16 w-16 rounded-full bg-emerald-400/30 blur-xl animate-neon-pulse" />
                <CheckCircle2 className="h-12 w-12 text-emerald-300 relative" />
              </div>
              <h1 className="text-3xl sm:text-4xl font-black mt-4 neon-text">원픽키워드를 찾았어요!</h1>
              <span className="inline-block mt-3 text-sm font-semibold neon-chip neon-cyan px-4 py-1.5 rounded-full">
                {data?.totalFound ?? 0}개 원픽키워드 발견
              </span>
              <p className="text-xs text-slate-400 mt-2">카드를 눌러 효자상품·심화정보를 확인하세요 ↓</p>
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
              <button
                onClick={() => setLocation("/sourcing")}
                className="neon-chip rounded-full px-6 py-2.5 text-sm text-slate-200 inline-flex items-center gap-2"
              >
                <Rocket className="h-4 w-4" /> 다시 원픽 찾기
              </button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function KeywordCard({ item }: { item: Item }) {
  const [open, setOpen] = useState(false);
  const s = item.stats;
  const certs = detectCerts(`${item.keyword} ${item.category ?? ""}`);

  const productIds = item.topProducts.map(p => p.coupangProductId).filter(Boolean);
  const enqueue = trpc.sourcingWizard.enqueueDeepScan.useMutation();
  const scanQuery = trpc.sourcingWizard.getDeepScanStatus.useQuery(
    { productIds },
    {
      enabled: open && productIds.length > 0,
      refetchInterval: (q: any) => {
        const d = q?.state?.data;
        return d && d.doneCount >= d.total ? false : 3000;
      },
    }
  );
  useEffect(() => {
    if (open && productIds.length) enqueue.mutate({ productIds, keyword: item.keyword });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const scan = scanQuery.data as
    | { total: number; doneCount: number; details: any[]; statusByProduct: Record<string, string> }
    | undefined;
  const detailById = new Map<string, any>((scan?.details ?? []).map(d => [d.coupangProductId, d]));

  return (
    <div className="glass glass-hover rounded-2xl overflow-hidden">
      {/* 접힘: 3줄 요약 */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-4 text-left"
      >
        <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap shrink-0 ${GRADE_STYLE[item.grade] ?? GRADE_STYLE.C}`}>
          {GRADE_LABEL[item.grade] ?? item.grade}
        </span>
        <span className="font-bold text-lg text-white truncate">{item.keyword}</span>
        {certs.length > 0 && (
          <span
            title={certs.map(c => c.cert).join(", ")}
            className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-300 bg-amber-400/10 border border-amber-400/30 px-2 py-0.5 rounded-full shrink-0"
          >
            <ShieldAlert className="h-3 w-3" /> 인증확인
          </span>
        )}
        <span className="flex-1" />
        <div className="hidden sm:flex items-center gap-6 text-right shrink-0">
          <Mini label="판매량" value={num(s.monthlySales)} />
          <Mini label="리뷰수" value={num(s.totalReviewSum)} accent />
          <Mini label="상품수" value={`${num(s.productCount)}개`} />
        </div>
        <ChevronDown className={`h-5 w-5 text-slate-400 transition-transform ml-2 ${open ? "rotate-180" : ""}`} />
      </button>

      {/* 펼침: 상세 */}
      {open && (
        <div className="px-4 pb-5 pt-1 border-t border-white/10">
          <div className="flex items-center gap-2 my-4">
            <h3 className="text-2xl font-black text-white">{item.keyword}</h3>
            <span className="text-[11px] font-semibold neon-chip neon-cyan px-2 py-0.5 rounded-full ml-auto">
              {TIER_LABEL[item.tier] ?? item.tier}
            </span>
            <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${GRADE_STYLE[item.grade] ?? GRADE_STYLE.C}`}>
              {GRADE_LABEL[item.grade] ?? item.grade}
            </span>
          </div>

          {/* 5개 스탯 */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="총판매량" value={`${num(s.monthlySales)}개`} />
            <Stat label="총리뷰수" value={num(s.totalReviewSum)} accent />
            <Stat
              label="상품수"
              value={`${num(s.productCount)}개`}
              sub={s.competitionLevel === "easy" ? "🟢 경쟁 낮음" : s.competitionLevel === "hard" ? "🔴 경쟁 높음" : "🟡 보통"}
            />
            <Stat label="평균가" value={won(s.avgPrice)} amber />
            <Stat label="총 월매출" value={won(s.monthlyRevenue)} amber sub={`Top ${num(s.monthlySales)}개/월`} />
          </div>

          {/* 인증/규제 체크 */}
          <div className="mt-5">
            <p className="font-bold text-sm mb-2 flex items-center gap-1.5 text-white">
              <ShieldAlert className="h-4 w-4 text-amber-400" /> 인증 / 규제 체크
            </p>
            {certs.length === 0 ? (
              <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-2.5 text-sm text-emerald-200">
                ✅ 감지된 필수 인증 없음 — 그래도 실제 품목 기준으로 재확인하세요.
              </div>
            ) : (
              <div className="space-y-2">
                {certs.map(c => (
                  <div
                    key={c.category}
                    className={`rounded-lg border px-3 py-2.5 ${c.level === "required" ? "border-red-400/25 bg-red-400/5" : "border-amber-400/25 bg-amber-400/5"}`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${c.level === "required" ? "bg-red-500 text-white" : "bg-amber-400 text-amber-950"}`}>
                        {c.level === "required" ? "필수" : "위험"}
                      </span>
                      <span className="font-semibold text-sm text-white">{c.category}</span>
                      <span className="text-sm text-slate-300">→ {c.cert}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{c.note}</p>
                  </div>
                ))}
                <p className="text-[11px] text-slate-500">⚠️ 키워드 기반 자동 감지입니다. 판매 전 품목 정확 분류로 최종 확인하세요.</p>
              </div>
            )}
          </div>

          {/* 효자상품 */}
          {item.topProducts.length > 0 && (
            <div className="mt-5">
              <p className="font-bold text-sm mb-2 text-white">
                효자상품 <span className="text-xs text-slate-400">Top {item.topProducts.length}</span>
              </p>
              <div className="overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full text-sm">
                  <thead className="bg-white/5 text-xs text-slate-400">
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
                      <tr key={p.coupangProductId || i} className="border-t border-white/8">
                        <td className="px-3 py-2.5 text-slate-200">
                          <span className="text-slate-500 mr-1.5">{i + 1}</span>
                          <span className="truncate">{p.productName}</span>
                        </td>
                        <td className="text-right px-3 py-2.5 text-slate-300">{won(p.price)}</td>
                        <td className="text-right px-3 py-2.5 text-slate-300">{num(p.reviewCount)}</td>
                        <td className="text-right px-3 py-2.5 font-semibold text-white">{num(p.estMonthlySales)}</td>
                        <td className="text-right px-3 py-2.5 text-amber-300 font-semibold">{won(p.estMonthlyRevenue)}</td>
                        <td className="text-right px-3 py-2.5">
                          {p.coupangProductId && (
                            <a
                              href={`https://www.coupang.com/vp/products/${p.coupangProductId}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/15 hover:border-cyan-400/60 hover:bg-cyan-400/10 text-slate-300"
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

          {/* 심화 정보 */}
          {productIds.length > 0 && (
            <div className="mt-5">
              <p className="font-bold text-sm mb-2 flex items-center gap-2 text-white">
                🔬 심화 정보
                {scan && scan.doneCount < scan.total && (
                  <span className="text-[11px] text-slate-400 font-normal">
                    수집 중 {scan.doneCount}/{scan.total} · 쿠팡 열려있으면 자동 진행
                  </span>
                )}
              </p>
              <div className="space-y-2">
                {item.topProducts.map((p, i) => {
                  const d = detailById.get(p.coupangProductId);
                  return (
                    <div key={p.coupangProductId || i} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                      <p className="font-medium text-sm truncate text-slate-200">
                        <span className="text-slate-500 mr-1.5">{i + 1}</span>
                        {p.productName}
                      </p>
                      {d ? (
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400 mt-1.5">
                          {d.sellerName && <span>🏪 {d.sellerName}{d.sellerProductCount ? ` · ${num(d.sellerProductCount)}개 상품` : ""}</span>}
                          {d.originCountry && <span>🌏 원산지 {d.originCountry}</span>}
                          {d.brand && <span>🏷️ {d.brand}</span>}
                          {d.deliveryType && <span>🚚 {d.deliveryType}</span>}
                          {d.optionCount ? <span>⚙️ 옵션 {d.optionCount}개</span> : null}
                          {d.categoryPath && <span className="w-full">📂 {d.categoryPath}</span>}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 mt-1">⏳ 수집 대기 중…</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {s.contributorCount > 0 && (
            <p className="text-[11px] text-slate-500 mt-3">
              👥 {s.contributorCount}명의 검색 데이터로 집계 · 최근 관측 {s.lastObservedDate ?? "-"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Mini({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className={`font-bold text-sm ${accent ? "text-amber-300" : "text-slate-100"}`}>{value}</p>
    </div>
  );
}

function Stat({ label, value, sub, accent, amber }: { label: string; value: string; sub?: string; accent?: boolean; amber?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className={`text-xl font-bold mt-1 ${accent || amber ? "text-amber-300" : "text-white"}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

function EmptyState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="glass rounded-2xl p-10 text-center">
      <p className="text-4xl animate-cyber-float">🐝</p>
      <p className="font-semibold mt-3 text-white">조건에 맞는 원픽키워드가 아직 없어요</p>
      <p className="text-sm text-slate-400 mt-1">공유 데이터가 쌓일수록 결과가 풍부해집니다. 조건을 넓혀 다시 시도해보세요.</p>
      <button onClick={onRetry} className="neon-chip mt-4 rounded-full px-5 py-2 text-sm text-slate-200">조건 바꿔서 다시</button>
    </div>
  );
}

function LoadingView({ tier, keywords, categories, products }: { tier: string; keywords: number; categories: number; products: number }) {
  const [pct, setPct] = useState(8);
  useEffect(() => {
    const id = setInterval(() => setPct(p => (p >= 92 ? 92 : p + Math.floor(Math.random() * 12) + 3)), 320);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="max-w-2xl mx-auto text-center pt-6 space-y-6 relative">
      <div className="scanline" />
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold neon-chip neon-cyan px-3 py-1 rounded-full tracking-widest">
        ● ONEPICK ENGINE
      </span>
      <div>
        <span className="inline-block text-xs font-semibold neon-chip neon-magenta px-3 py-1 rounded-full mb-4">
          {TIER_LABEL[tier] ?? tier}
        </span>
        <h1 className="text-3xl sm:text-4xl font-black neon-text">원픽 엔진 가동 중..</h1>
        <p className="text-sm text-slate-400 mt-2">조건에 맞는 키워드를 고르는 중...</p>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500 tracking-widest">ANALYZING</span>
        <span className="text-5xl font-black neon-text">{Math.min(pct, 99)}%</span>
      </div>
      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 99)}%`, background: "linear-gradient(90deg,#22d3ee,#a855f7,#e935c1)" }} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Counter label="KEYWORDS" value={keywords} />
        <Counter label="CATEGORIES" value={categories} />
        <Counter label="PRODUCTS" value={products} />
      </div>
      <div className="glass rounded-xl text-left text-xs font-mono p-4 leading-relaxed text-cyan-300/90">
        <p className="text-slate-500">ONEPICK Engine v2.0</p>
        <p className="mt-2">▸ Connecting to shared keyword pool…</p>
        <p>▸ Filtering {num(keywords)} keywords…</p>
      </div>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="glass rounded-xl p-4">
      <p className="text-[10px] text-slate-500 tracking-widest">{label}</p>
      <p className="text-2xl font-black neon-cyan mt-1">{num(value)}</p>
    </div>
  );
}
