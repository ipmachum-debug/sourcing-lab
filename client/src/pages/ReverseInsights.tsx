import { useState } from "react";
import { Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { domesticSearchLinks } from "@/lib/domesticSearch";
import { SOURCING_KEYWORDS } from "@/lib/sourcingKeywords";
import {
  Compass,
  Search,
  TrendingUp,
  Ruler,
  DollarSign,
  Store,
  ChevronDown,
  ExternalLink,
  Gavel,
  ShieldCheck,
  Waves,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Sparkles,
  Star,
  Bot,
} from "lucide-react";

const usd = (n: number | null | undefined) =>
  n == null ? "-" : `$${Math.round(n).toLocaleString("en-US")}`;
const signedUsd = (n: number) =>
  `${n > 0 ? "+" : n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

interface BestSize { size: string; krMm: number | null; profit: number; bid: number; price: number; bidAvailable: boolean; unbid: boolean; }
interface Model {
  normKey: string; brand: string; productName: string; category: string | null;
  soldCount: number; avgUsd: number; lowUsd: number; highUsd: number; sizeCount: number;
  profitUsd: number | null; minProfitUsd: number | null; bestProfitUsd: number | null; lowestBidUsd: number | null; bidAvailCnt: number;
  unbidCnt: number; localSeller: number; riskScore: number;
  safe: boolean; blue: boolean; risk: boolean; bidRec: boolean;
  recommendBidUsd: number | null; bestSizes: BestSize[];
  scores: Scores;
}
interface Scores { demand: number; stability: number; authenticity: number; size: number; grade: string; }
interface Band { label: string; models: number; totalSold: number; }
interface Size { size: string; krMm: number | null; models: number; demand: number; medianUsd: number; }
type Counts = { all: number; hot: number; margin: number; safe: number; blue: number; risk: number; bid: number; };
type Filter = "all" | "hot" | "margin" | "safe" | "blue" | "risk" | "bid";

const FILTERS: { key: Filter; label: string; icon: any }[] = [
  { key: "all", label: "전체", icon: Compass },
  { key: "hot", label: "고회전", icon: TrendingUp },
  { key: "margin", label: "고마진", icon: DollarSign },
  { key: "bid", label: "입찰 추천", icon: Gavel },
  { key: "safe", label: "안전", icon: ShieldCheck },
  { key: "blue", label: "블루오션", icon: Waves },
  { key: "risk", label: "위험", icon: AlertTriangle },
];

export default function ReverseInsights() {
  // 브랜드 관리에서 넘어온 ?brand= 로 초기 필터 (브랜드→모델 드릴다운)
  const initBrand = (() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("brand") ?? "";
  })();
  const [term, setTerm] = useState(initBrand);
  const [search, setSearch] = useState(initBrand);
  const [category, setCategory] = useState("전체");
  const [filter, setFilter] = useState<Filter>("all");
  const [openSize, setOpenSize] = useState<string | null>(null);

  const q = trpc.reverseDeals.catalogInsights.useQuery({
    search: search || undefined,
    category: category === "전체" ? undefined : category,
    filter,
    limit: 40,
  });
  const changes = trpc.reverseDeals.catalogChanges.useQuery({ search: search || undefined });
  const data = q.data as
    | { models: Model[]; counts: Counts; bands: Band[]; sizes: Size[];
        categories: { name: string; count: number }[];
        summary: { totalModels: number; totalSold: number; avgUsd: number }; }
    | undefined;

  const doSearch = () => setSearch(term.trim());
  const maxBandSold = Math.max(1, ...(data?.bands.map(b => b.totalSold) ?? [1]));
  const cd = changes.data as
    | { changes: any[]; hasPrev: boolean; snapshots: number; curDate: string | null; prevDate: string | null }
    | undefined;

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10">
        <div className="max-w-6xl mx-auto space-y-6">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest neon-chip neon-magenta px-3 py-1 rounded-full uppercase">
              <Compass className="h-3.5 w-3.5" /> Discovery
            </span>
            <h1 className="text-3xl sm:text-4xl font-black mt-4 neon-text">상품 발굴 · 입찰 추천</h1>
            <p className="text-slate-300/80 mt-2">
              판매자 자료로 <b className="text-white">고회전·고마진·안전·블루오션</b>을 골라내고,{" "}
              <b className="text-fuchsia-300">입찰 추천가</b>까지. 브랜드로 검색해 오늘 살 상품을 뽑으세요.
            </p>
          </div>

          {/* 검색 + 카테고리 */}
          <div className="glass rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <input
                  value={term}
                  onChange={e => setTerm(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && doSearch()}
                  placeholder="브랜드·상품 검색 (예: 크록스, 발렌시아가)"
                  className="w-full rounded-lg border border-white/15 bg-white/5 pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-fuchsia-400/60"
                />
              </div>
              <button onClick={doSearch} className="neon-btn rounded-lg px-4 py-2.5 text-sm font-semibold">검색</button>
              {search && <button onClick={() => { setTerm(""); setSearch(""); }} className="text-sm text-slate-400 hover:text-white px-2">초기화</button>}
            </div>
            {data?.categories && data.categories.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {["전체", ...data.categories.map(c => c.name)].map(name => (
                  <button key={name} onClick={() => setCategory(name)}
                    className={`rounded-full px-2.5 py-1 text-[12px] transition-all ${
                      category === name ? "bg-fuchsia-500/25 text-fuchsia-100 ring-1 ring-fuchsia-400/40" : "text-slate-400 hover:text-slate-200 bg-white/5"}`}>
                    {name}{name !== "전체" && <span className="ml-1 opacity-60">{data.categories.find(c => c.name === name)?.count}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 대표 모델 키워드 퀵픽 */}
          <KeywordPicker
            active={search}
            onPick={q => { setTerm(q); setSearch(q); }}
          />

          {/* 변화 감지 (직전 업로드 대비) */}
          {cd?.hasPrev && cd.changes.length > 0 && <ChangesPanel cd={cd} />}

          {q.isLoading ? (
            <div className="text-center text-slate-500 py-16">집계 중…</div>
          ) : !data || data.summary.totalModels === 0 ? (
            <EmptyState />
          ) : (
            <>
              {/* 요약 */}
              <div className="grid grid-cols-3 gap-3">
                <Tile label="상품(모델)" value={data.summary.totalModels.toLocaleString()} />
                <Tile label="누적 중국 판매량" value={data.summary.totalSold.toLocaleString()} tone="good" />
                <Tile label="중앙 시세" value={usd(data.summary.avgUsd)} tone="mag" />
              </div>

              {/* 발굴 필터 탭 */}
              <div className="flex flex-wrap items-center gap-2">
                {FILTERS.map(f => (
                  <button key={f.key} onClick={() => setFilter(f.key)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                      filter === f.key ? "neon-chip neon-magenta text-white" : "text-slate-400 hover:text-slate-200 bg-white/5"}`}>
                    <f.icon className="h-3.5 w-3.5" />
                    {f.label}
                    <span className="text-[11px] opacity-70">{data.counts[f.key].toLocaleString()}</span>
                  </button>
                ))}
              </div>

              {/* 모델 랭킹 / 발굴 결과 */}
              <div className="glass rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[860px]">
                    <thead className="bg-white/5 text-xs text-slate-400">
                      <tr>
                        <th className="text-left font-medium px-3 py-2.5">모델</th>
                        <th className="text-right font-medium px-3 py-2.5">판매량</th>
                        <th className="text-right font-medium px-3 py-2.5">시세($)</th>
                        <th className="text-right font-medium px-3 py-2.5" title="POIZON 예상 정산액 = 판매가−수수료. 국내 매입가 미반영(실순익 아님).">정산(예상)</th>
                        <th className="text-right font-medium px-3 py-2.5">최저입찰</th>
                        {filter === "bid" && <th className="text-right font-medium px-3 py-2.5">추천입찰</th>}
                        <th className="text-center font-medium px-3 py-2.5">경쟁/리스크</th>
                        <th className="text-center font-medium px-3 py-2.5">소싱</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.models.map(m => (
                        <ModelRow key={m.normKey} m={m} bid={filter === "bid"}
                          open={openSize === m.normKey}
                          onToggle={() => setOpenSize(openSize === m.normKey ? null : m.normKey)} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 가격대·사이즈 분포 */}
              <div className="grid lg:grid-cols-2 gap-6">
                <Panel icon={DollarSign} title="가격대별 수요" hint="모델 중앙가 기준 · 막대=총 판매량">
                  <div className="space-y-2.5">
                    {data.bands.map(b => (
                      <div key={b.label}>
                        <div className="flex items-center justify-between text-[13px] mb-1">
                          <span className="text-slate-200 font-medium">{b.label}</span>
                          <span className="text-slate-400">{b.totalSold.toLocaleString()} <span className="text-slate-600">· {b.models}모델</span></span>
                        </div>
                        <div className="h-2.5 rounded-full bg-white/8 overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-fuchsia-500 to-cyan-400" style={{ width: `${Math.round((b.totalSold / maxBandSold) * 100)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </Panel>
                <Panel icon={Ruler} title="사이즈 분포" hint="인기 모델이 취급하는 사이즈 (수요가중)">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    {data.sizes.slice(0, 12).map(s => {
                      const max = Math.max(1, ...data.sizes.map(x => x.demand));
                      return (
                        <div key={s.size}>
                          <div className="flex items-center justify-between text-[13px] mb-1">
                            <span className="text-slate-200 font-medium truncate">
                              {s.size}
                              {s.krMm && <span className="text-emerald-300/70 ml-1">{s.krMm}mm</span>}
                            </span>
                            <span className="text-slate-500 text-[11px]">{s.models}모델</span>
                          </div>
                          <div className="h-2 rounded-full bg-white/8 overflow-hidden">
                            <div className="h-full bg-emerald-400/80" style={{ width: `${Math.round((s.demand / max) * 100)}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Panel>
              </div>

              <div className="text-[11px] text-slate-500 space-y-1">
                <p>
                  💡 한 줄의 시세·입찰·정산은 <b className="text-slate-400">대표 사이즈(거래가 중앙값) 한 개의 실제 값</b>입니다 —
                  사이즈마다 값이 달라 섞으면 어긋나 보여요. 사이즈별 차이는 상품명을 눌러 펼쳐 보세요.
                </p>
                <p>
                  ⚠️ <b className="text-slate-400">정산(예상)</b>은 POIZON "예상 수익" = <b className="text-slate-400">판매가 − 수수료(≈$10)</b>이고
                  <b className="text-slate-400"> 국내 매입가는 안 뺀 값</b>입니다. <b className="text-white">실순익 = 정산 − 국내 매입가</b> →
                  <Link href="/reverse/queue" className="underline text-fuchsia-300 ml-1">소싱 큐에서 확인 →</Link>
                </p>
                <p>입찰 추천 조건: 정산(예상) ≥$20 · 중국 판매량 ≥10 · 현지 판매자 적음 · 입찰 가능 · 미입찰.</p>
              </div>
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

function KeywordPicker({ active, onPick }: { active: string; onPick: (q: string) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="glass rounded-2xl p-4">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-fuchsia-300" />
        <h2 className="text-sm font-semibold text-slate-100">대표 모델 키워드</h2>
        <span className="text-[11px] text-slate-500">클릭하면 카탈로그 검색</span>
        <ChevronDown className={`h-4 w-4 text-slate-500 ml-auto transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-3 space-y-2.5">
          {SOURCING_KEYWORDS.map(b => (
            <div key={b.brand} className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => onPick(b.brand)}
                className="text-[12px] font-bold text-slate-200 mr-1 hover:text-fuchsia-200 shrink-0"
              >
                {b.emoji} {b.brand}
              </button>
              {b.models.map(m => {
                const on = active === m.q;
                return (
                  <button
                    key={m.label}
                    onClick={() => onPick(m.q)}
                    title={`검색: ${m.q}`}
                    className={`rounded-full px-2.5 py-1 text-[12px] transition-all ${
                      on
                        ? "bg-fuchsia-500/25 text-fuchsia-100 ring-1 ring-fuchsia-400/40"
                        : "text-slate-300 bg-white/5 hover:bg-white/10"
                    }`}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ModelRow({ m, bid, open, onToggle }: { m: Model; bid: boolean; open: boolean; onToggle: () => void }) {
  const riskTone = m.riskScore >= 60 ? "text-red-400" : m.riskScore >= 35 ? "text-amber-300" : "text-emerald-300";
  return (
    <>
      <tr className="border-t border-white/8 hover:bg-white/[0.02]">
        <td className="px-3 py-2.5">
          <button onClick={onToggle} className="text-left w-full group">
            <p className="text-slate-100 truncate max-w-[300px] group-hover:text-fuchsia-200 flex items-center gap-1">
              <GradeBadge grade={m.scores.grade} />
              {m.productName}
              <ChevronDown className={`h-3 w-3 text-slate-600 transition-transform ${open ? "rotate-180" : ""}`} />
            </p>
            <p className="text-[11px] text-slate-500">
              {m.brand || "-"}{m.category ? ` · ${m.category}` : ""} · 사이즈 {m.sizeCount}
              {m.blue && <span className="text-cyan-400/80 ml-1">블루오션</span>}
              {m.safe && <span className="text-emerald-400/80 ml-1">안전</span>}
              {m.bidRec && <span className="text-fuchsia-300 ml-1">입찰추천</span>}
              {m.avgUsd > 0 && m.avgUsd <= 111 && <span className="text-amber-400/80 ml-1" title="판매가 약 15만원 이하 — 최소 수수료 타격">저가주의</span>}
            </p>
          </button>
        </td>
        <td className="text-right px-3 py-2.5 font-semibold text-emerald-300">{m.soldCount.toLocaleString()}</td>
        <td className="text-right px-3 py-2.5 text-fuchsia-200">{usd(m.avgUsd)}</td>
        <td className={`text-right px-3 py-2.5 ${(m.profitUsd ?? 0) > 0 ? "text-emerald-300" : "text-slate-500"}`}>
          {m.minProfitUsd != null && m.bestProfitUsd != null && m.bestProfitUsd !== m.minProfitUsd ? (
            <>
              <span>{usd(m.minProfitUsd)}–{usd(m.bestProfitUsd)}</span>
              <span className="block text-[10px] text-slate-600">사이즈별 · 대표 {usd(m.profitUsd)}</span>
            </>
          ) : (
            usd(m.profitUsd)
          )}
        </td>
        <td className="text-right px-3 py-2.5 text-slate-300">{usd(m.lowestBidUsd)}</td>
        {bid && (
          <td className="text-right px-3 py-2.5">
            {m.recommendBidUsd != null ? <span className="font-bold text-fuchsia-200">{usd(m.recommendBidUsd)}</span> : <span className="text-slate-600">-</span>}
          </td>
        )}
        <td className="text-center px-3 py-2.5">
          <span className="text-[12px] text-slate-400">{m.localSeller > 0 ? `현지 ${m.localSeller.toLocaleString()}` : "경쟁 낮음"}</span>
          <span className={`block text-[10px] font-semibold ${riskTone}`}>리스크 {m.riskScore}</span>
        </td>
        <td className="px-3 py-2.5">
          <div className="flex justify-center"><FindDomestic name={m.productName} brand={m.brand} /></div>
        </td>
      </tr>
      {open && (
        <tr className="bg-white/[0.03]">
          <td colSpan={bid ? 8 : 7} className="px-3 py-3">
            {/* 위험 별점 + AI 판단 */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-3 pb-3 border-b border-white/8">
              <StarRow label="판매량" n={m.scores.demand} />
              <StarRow label="가격안정" n={m.scores.stability} />
              <StarRow label="가품안전" n={m.scores.authenticity} />
              <StarRow label="사이즈" n={m.scores.size} />
              <span className="inline-flex items-center gap-1 text-[12px] text-slate-300">
                최종 <GradeBadge grade={m.scores.grade} />
              </span>
              <AiReason m={m} />
            </div>
            <p className="text-[11px] text-slate-400 mb-2 flex items-center gap-1"><Ruler className="h-3 w-3" /> 사이즈 추천 (정산·입찰 공백 순 · 입찰가≫거래가는 희귀/저유동)</p>
            <div className="flex flex-wrap gap-2">
              {m.bestSizes.length === 0 && <span className="text-[12px] text-slate-500">사이즈별 데이터 없음</span>}
              {m.bestSizes.map(s => (
                <div key={s.size} className={`rounded-lg border px-2.5 py-1.5 text-[12px] ${s.unbid ? "border-fuchsia-400/40 bg-fuchsia-500/10" : "border-white/10 bg-white/5"}`}>
                  <span className="font-semibold text-slate-100">{s.size}</span>
                  {s.krMm && <span className="text-emerald-300/70 ml-1" title="한국 mm(KR 표기 기준)">{s.krMm}mm</span>}
                  <span className="text-slate-500 ml-2">거래가 {usd(s.price)}</span>
                  <span className="text-slate-400 ml-2">정산 {usd(s.profit)}</span>
                  <span className="text-slate-500 ml-2">입찰 {usd(s.bid)}</span>
                  {s.unbid && <span className="text-fuchsia-300 ml-2">미입찰</span>}
                  {s.bidAvailable && <span className="text-emerald-300 ml-1">가능</span>}
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function GradeBadge({ grade }: { grade: string }) {
  const tone =
    grade === "A+" || grade === "A"
      ? "bg-emerald-500/20 text-emerald-200 ring-emerald-400/40"
      : grade === "B"
        ? "bg-cyan-500/15 text-cyan-200 ring-cyan-400/30"
        : grade === "C"
          ? "bg-amber-500/15 text-amber-200 ring-amber-400/30"
          : "bg-red-500/15 text-red-300 ring-red-400/30";
  return (
    <span className={`shrink-0 inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-black ring-1 ${tone}`} title="종합 등급(판매·안정·가품·사이즈)">
      {grade}
    </span>
  );
}

function StarRow({ label, n }: { label: string; n: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
      {label}
      <span className="inline-flex">
        {[1, 2, 3, 4, 5].map(i => (
          <Star
            key={i}
            className={`h-3 w-3 ${i <= n ? "text-amber-300 fill-amber-300" : "text-slate-700"}`}
          />
        ))}
      </span>
    </span>
  );
}

function AiReason({ m }: { m: Model }) {
  const mut = trpc.reverseDeals.aiReason.useMutation();
  const r = mut.data;
  const verdictTone =
    r?.verdict === "추천"
      ? "text-emerald-300"
      : r?.verdict === "주의"
        ? "text-red-300"
        : "text-amber-300";
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        onClick={() =>
          mut.mutate({
            productName: m.productName,
            brand: m.brand || undefined,
            category: m.category || undefined,
            soldCount: m.soldCount,
            avgUsd: m.avgUsd,
            profitUsd: m.profitUsd,
            localSeller: m.localSeller,
            grade: m.scores.grade,
            riskScore: m.riskScore,
          })
        }
        disabled={mut.isPending}
        className="inline-flex items-center gap-1 text-[12px] font-semibold rounded-full px-2.5 py-1 bg-fuchsia-500/15 text-fuchsia-200 hover:bg-fuchsia-500/25 disabled:opacity-50"
      >
        <Bot className="h-3.5 w-3.5" />
        {mut.isPending ? "판단 중…" : "AI 판단"}
      </button>
      {r && (
        <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 max-w-md">
          <p className="text-[13px] font-semibold flex items-center gap-1.5">
            <span className={verdictTone}>{r.verdict}</span>
            <span className="text-slate-200">{r.headline}</span>
            {r.source === "rule" && <span className="text-[10px] text-slate-600">(규칙)</span>}
          </p>
          {r.bullets.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {r.bullets.map((b: string, i: number) => (
                <li key={i} className="text-[12px] text-slate-400 flex gap-1">
                  <span className="text-fuchsia-400">·</span>
                  {b}
                </li>
              ))}
            </ul>
          )}
          {r.qtyHint && <p className="text-[11px] text-cyan-300/80 mt-1">📦 {r.qtyHint}</p>}
        </div>
      )}
    </span>
  );
}

function ChangesPanel({ cd }: { cd: { changes: any[]; snapshots: number; curDate: string | null; prevDate: string | null } }) {
  const [open, setOpen] = useState(true);
  const improved = cd.changes.filter(c => c.good > 0);
  return (
    <div className="glass rounded-2xl p-4 sm:p-5 ring-1 ring-fuchsia-400/30">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-fuchsia-300" />
        <h2 className="text-sm font-semibold text-slate-100">이번 업로드에서 좋아진 상품</h2>
        <span className="text-[11px] text-slate-500">{cd.prevDate} → {cd.curDate} · {improved.length}건</span>
        <ChevronDown className={`h-4 w-4 text-slate-500 ml-auto transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-3 grid sm:grid-cols-2 gap-2">
          {improved.slice(0, 12).map((c, i) => (
            <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-sm text-slate-100 truncate">{c.productName}<span className="text-slate-500 text-[11px]">{c.size ? ` · ${c.size}` : ""}</span></p>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px]">
                {c.bidDelta < 0 && <span className="text-emerald-300 flex items-center gap-0.5"><ArrowDownRight className="h-3 w-3" />최저입찰 {signedUsd(c.bidDelta)}</span>}
                {c.profitDelta > 0 && <span className="text-emerald-300 flex items-center gap-0.5"><ArrowUpRight className="h-3 w-3" />수익 {signedUsd(c.profitDelta)}</span>}
                {c.soldDelta > 0 && <span className="text-cyan-300">판매 +{c.soldDelta.toLocaleString()}</span>}
                {c.localDelta < 0 && <span className="text-emerald-300">경쟁 {c.localDelta}</span>}
                {c.newlyBidable && <span className="text-fuchsia-300">입찰 가능 전환</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Panel({ icon: Icon, title, hint, children }: { icon: any; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-2xl p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="h-4 w-4 text-fuchsia-300" />
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
        {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function FindDomestic({ name, brand }: { name: string; brand: string }) {
  const [open, setOpen] = useState(false);
  const links = domesticSearchLinks(name, brand);
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 text-[12px] font-semibold rounded-full px-2.5 py-1 bg-fuchsia-500/15 text-fuchsia-200 hover:bg-fuchsia-500/25">
        <Store className="h-3 w-3" /> 국내가 <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-40 rounded-xl border border-white/15 bg-slate-900/95 backdrop-blur p-1 shadow-xl">
            {links.map(l => (
              <a key={l.label} href={l.url} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}
                className="flex items-center justify-between px-2.5 py-1.5 text-[13px] text-slate-200 rounded-lg hover:bg-white/10">
                {l.label}<ExternalLink className="h-3 w-3 text-slate-500" />
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "good" | "mag" }) {
  const c = tone === "good" ? "text-emerald-300" : tone === "mag" ? "text-fuchsia-200" : "text-white";
  return (
    <div className="glass rounded-xl p-3">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className={`text-2xl font-black mt-1 ${c}`}>{value}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="glass rounded-2xl p-8 text-center">
      <Compass className="h-8 w-8 text-slate-500 mx-auto mb-3" />
      <p className="text-slate-300 font-medium">집계할 카탈로그가 없어요</p>
      <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
        <Link href="/reverse/seller" className="underline text-fuchsia-300">판매자센터 엑셀</Link>을 올리면
        발굴 필터·입찰 추천·변화 감지가 여기 표시됩니다.
      </p>
    </div>
  );
}
