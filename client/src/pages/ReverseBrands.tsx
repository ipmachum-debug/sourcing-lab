import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Tag, Search, Flame, AlertTriangle, ArrowRight, Package } from "lucide-react";

const usd = (n: number) => `$${Math.round(n || 0).toLocaleString("en-US")}`;
const num = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");

// 브랜드 표시용 이모지 (없으면 기본값)
const BRAND_EMOJI: Record<string, string> = {
  크록스: "🐊", crocs: "🐊", 나이키: "✔️", nike: "✔️", 푸마: "🐆", puma: "🐆",
  아디다스: "🅰️", adidas: "🅰️", 뉴발란스: "Ⓝ", newbalance: "Ⓝ",
  아식스: "🅰", asics: "🅰", MLB: "⚾", 뉴에라: "🧢",
  newera: "🧢", 반스: "🛹", vans: "🛹", 컨버스: "⭐", converse: "⭐",
};
const emojiOf = (b: string) =>
  BRAND_EMOJI[b] ?? BRAND_EMOJI[b.toLowerCase()] ?? "🏷️";

interface BrandRow {
  brand: string; spuCount: number; totalSold: number; medianUsd: number;
  avgProfitUsd: number | null; recCount: number; riskCount: number;
}
interface Totals { brands: number; spuCount: number; totalSold: number; recCount: number; }

export default function ReverseBrands() {
  const [, navigate] = useLocation();
  const [term, setTerm] = useState("");

  const q = trpc.reverseDeals.brandDashboard.useQuery({ limit: 120 });
  const data = q.data as { brands: BrandRow[]; totals: Totals } | undefined;

  const brands = useMemo(() => {
    const rows = data?.brands ?? [];
    const t = term.trim().toLowerCase();
    return t ? rows.filter(b => b.brand.toLowerCase().includes(t)) : rows;
  }, [data, term]);

  const openBrand = (brand: string) =>
    navigate(`/reverse/insights?brand=${encodeURIComponent(brand)}`);

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* 헤더 */}
          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest neon-chip neon-magenta px-3 py-1 rounded-full uppercase">
              <Tag className="h-3.5 w-3.5" /> Brand Control
            </span>
            <h1 className="text-3xl sm:text-4xl font-black mt-4 neon-text">브랜드 관리</h1>
            <p className="text-slate-300/80 mt-2 max-w-2xl">
              카탈로그를 <b className="text-white">브랜드 단위 관제탑</b>으로 봅니다 — 어느 브랜드가
              팔리고, 마진이 좋고, 추천·주의가 몇 개인지. 브랜드를 누르면 그 브랜드의
              <b className="text-fuchsia-300"> 모델·SKU·사이즈</b> 발굴로 들어갑니다.
            </p>
          </div>

          {/* 요약 */}
          {data?.totals && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Tile label="🏷 브랜드" value={num(data.totals.brands)} />
              <Tile label="📦 총 상품(SPU)" value={num(data.totals.spuCount)} />
              <Tile label="🔥 누적 판매량" value={num(data.totals.totalSold)} tone="deal" />
              <Tile label="⭐ 입찰 추천" value={num(data.totals.recCount)} tone="hunt" />
            </div>
          )}

          {/* 검색 */}
          <div className="glass rounded-2xl p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input
                value={term}
                onChange={e => setTerm(e.target.value)}
                placeholder="브랜드 검색 (예: 크록스, 나이키)"
                className="w-full rounded-lg border border-white/15 bg-white/5 pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-fuchsia-400/60"
              />
            </div>
          </div>

          {/* 브랜드 그리드 */}
          {q.isLoading ? (
            <div className="text-center text-slate-500 py-16">불러오는 중…</div>
          ) : brands.length === 0 ? (
            <EmptyState hasData={!!data && data.totals.spuCount > 0} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {brands.map(b => (
                <button
                  key={b.brand}
                  onClick={() => openBrand(b.brand)}
                  className="group glass rounded-2xl p-4 text-left hover:ring-1 hover:ring-fuchsia-400/40 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-2xl shrink-0">{emojiOf(b.brand)}</span>
                      <span className="font-bold text-slate-100 truncate">{b.brand}</span>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-600 group-hover:text-fuchsia-300 shrink-0" />
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-4">
                    <Stat label="판매량" value={num(b.totalSold)} tone="deal" />
                    <Stat label="상품수" value={num(b.spuCount)} icon={Package} />
                    <Stat label="대표 시세" value={usd(b.medianUsd)} />
                    <Stat
                      label="평균 정산"
                      value={b.avgProfitUsd != null ? usd(b.avgProfitUsd) : "-"}
                    />
                  </div>

                  <div className="flex items-center gap-2 mt-3">
                    {b.recCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold neon-chip neon-magenta rounded-full px-2 py-0.5">
                        <Flame className="h-3 w-3" /> 추천 {b.recCount}
                      </span>
                    )}
                    {b.riskCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-amber-300/90 bg-amber-500/10 rounded-full px-2 py-0.5">
                        <AlertTriangle className="h-3 w-3" /> 주의 {b.riskCount}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

function Tile({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "hunt" | "deal" }) {
  const c = tone === "hunt" ? "text-fuchsia-200" : tone === "deal" ? "text-emerald-300" : "text-white";
  return (
    <div className="glass rounded-xl p-3">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className={`text-2xl font-black mt-1 ${c}`}>{value}</p>
    </div>
  );
}

function Stat({ label, value, tone = "normal", icon: Icon }: { label: string; value: string; tone?: "normal" | "deal"; icon?: any }) {
  return (
    <div className="rounded-lg bg-white/5 px-2.5 py-1.5">
      <p className="text-[10px] text-slate-500 flex items-center gap-1">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </p>
      <p className={`text-sm font-bold mt-0.5 ${tone === "deal" ? "text-emerald-300" : "text-slate-100"}`}>
        {value}
      </p>
    </div>
  );
}

function EmptyState({ hasData }: { hasData: boolean }) {
  return (
    <div className="glass rounded-2xl p-8 text-center">
      <Tag className="h-8 w-8 text-slate-500 mx-auto mb-3" />
      {hasData ? (
        <p className="text-slate-300 font-medium">검색과 일치하는 브랜드가 없어요</p>
      ) : (
        <>
          <p className="text-slate-300 font-medium">카탈로그가 아직 비어 있어요</p>
          <p className="text-sm text-slate-500 mt-2">
            판매자센터 엑셀을 올리면 브랜드별 관제탑이 여기 생깁니다.
          </p>
        </>
      )}
    </div>
  );
}
