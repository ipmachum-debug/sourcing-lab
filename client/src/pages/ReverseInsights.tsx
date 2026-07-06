import { useState } from "react";
import { Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { domesticSearchLinks } from "@/lib/domesticSearch";
import {
  BarChart3,
  Search,
  TrendingUp,
  Ruler,
  DollarSign,
  Store,
  ChevronDown,
  ExternalLink,
} from "lucide-react";

const usd = (n: number) => `$${Math.round(n || 0).toLocaleString("en-US")}`;

interface Model {
  normKey: string; brand: string; productName: string; category: string | null;
  soldCount: number; avgUsd: number; lowUsd: number; highUsd: number; sizeCount: number;
}
interface Band { label: string; lo: number; hi: number | null; models: number; totalSold: number; }
interface Size { size: string; models: number; demand: number; medianUsd: number; }

export default function ReverseInsights() {
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("전체");

  const q = trpc.reverseDeals.catalogInsights.useQuery({
    search: search || undefined,
    category: category === "전체" ? undefined : category,
    limit: 30,
  });
  const data = q.data as
    | {
        models: Model[]; bands: Band[]; sizes: Size[];
        categories: { name: string; count: number }[];
        summary: { totalModels: number; totalSold: number; avgUsd: number };
      }
    | undefined;

  const doSearch = () => setSearch(term.trim());
  const maxBandSold = Math.max(1, ...(data?.bands.map(b => b.totalSold) ?? [1]));
  const maxSizeDemand = Math.max(1, ...(data?.sizes.map(s => s.demand) ?? [1]));

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10">
        <div className="max-w-6xl mx-auto space-y-6">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest neon-chip neon-magenta px-3 py-1 rounded-full uppercase">
              <BarChart3 className="h-3.5 w-3.5" /> Sourcing Insights
            </span>
            <h1 className="text-3xl sm:text-4xl font-black mt-4 neon-text">소싱 인사이트</h1>
            <p className="text-slate-300/80 mt-2">
              판매자 다운로드 자료로 <b className="text-white">중국에서 뭐가·어느 가격대가·어느 사이즈가</b>{" "}
              잘 팔리는지 한눈에. 브랜드로 검색해 소싱 후보를 뽑으세요. (시세는 중국시장 $)
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
              {search && (
                <button onClick={() => { setTerm(""); setSearch(""); }} className="text-sm text-slate-400 hover:text-white px-2">초기화</button>
              )}
            </div>
            {data?.categories && data.categories.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {["전체", ...data.categories.map(c => c.name)].map(name => (
                  <button
                    key={name}
                    onClick={() => setCategory(name)}
                    className={`rounded-full px-2.5 py-1 text-[12px] transition-all ${
                      category === name
                        ? "bg-fuchsia-500/25 text-fuchsia-100 ring-1 ring-fuchsia-400/40"
                        : "text-slate-400 hover:text-slate-200 bg-white/5"
                    }`}
                  >
                    {name}
                    {name !== "전체" && (
                      <span className="ml-1 opacity-60">{data.categories.find(c => c.name === name)?.count}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

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

              <div className="grid lg:grid-cols-2 gap-6">
                {/* ② 가격대별 수요 */}
                <Panel icon={DollarSign} title="가격대별 수요" hint="모델 중앙가 기준 · 막대=총 판매량">
                  <div className="space-y-2.5">
                    {data.bands.map(b => (
                      <div key={b.label}>
                        <div className="flex items-center justify-between text-[13px] mb-1">
                          <span className="text-slate-200 font-medium">{b.label}</span>
                          <span className="text-slate-400">
                            {b.totalSold.toLocaleString()} <span className="text-slate-600">· {b.models}모델</span>
                          </span>
                        </div>
                        <div className="h-2.5 rounded-full bg-white/8 overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-fuchsia-500 to-cyan-400"
                            style={{ width: `${Math.round((b.totalSold / maxBandSold) * 100)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </Panel>

                {/* ③ 사이즈 분포 */}
                <Panel icon={Ruler} title="사이즈 분포" hint="인기 모델이 취급하는 사이즈 (수요가중)">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    {data.sizes.slice(0, 12).map(s => (
                      <div key={s.size}>
                        <div className="flex items-center justify-between text-[13px] mb-1">
                          <span className="text-slate-200 font-medium truncate">{s.size}</span>
                          <span className="text-slate-500 text-[11px]">{s.models}모델</span>
                        </div>
                        <div className="h-2 rounded-full bg-white/8 overflow-hidden">
                          <div className="h-full bg-emerald-400/80"
                            style={{ width: `${Math.round((s.demand / maxSizeDemand) * 100)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  {data.sizes.length === 0 && <p className="text-sm text-slate-500">사이즈 데이터 없음</p>}
                </Panel>
              </div>

              {/* ① 모델 판매량 랭킹 */}
              <Panel icon={TrendingUp} title="잘 팔리는 모델 (판매량 순)" hint="바로 국내가를 찾아 소싱하세요">
                <div className="overflow-x-auto -mx-1">
                  <table className="w-full text-sm min-w-[680px]">
                    <thead className="text-xs text-slate-400">
                      <tr>
                        <th className="text-left font-medium px-2 py-2 w-8">#</th>
                        <th className="text-left font-medium px-2 py-2">모델</th>
                        <th className="text-right font-medium px-2 py-2">판매량</th>
                        <th className="text-right font-medium px-2 py-2">시세($)</th>
                        <th className="text-center font-medium px-2 py-2">사이즈</th>
                        <th className="text-center font-medium px-2 py-2">소싱</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.models.map((m, i) => (
                        <tr key={m.normKey} className="border-t border-white/8">
                          <td className="px-2 py-2 text-slate-500">{i + 1}</td>
                          <td className="px-2 py-2">
                            <p className="text-slate-100 truncate max-w-[300px]">{m.productName}</p>
                            <p className="text-[11px] text-slate-500">{m.brand || "-"}{m.category ? ` · ${m.category}` : ""}</p>
                          </td>
                          <td className="text-right px-2 py-2 font-semibold text-emerald-300">{m.soldCount.toLocaleString()}</td>
                          <td className="text-right px-2 py-2 text-fuchsia-200">
                            {usd(m.avgUsd)}
                            {m.highUsd > m.lowUsd && (
                              <span className="block text-[10px] text-slate-600">{usd(m.lowUsd)}~{usd(m.highUsd)}</span>
                            )}
                          </td>
                          <td className="text-center px-2 py-2 text-slate-400">{m.sizeCount || "-"}</td>
                          <td className="px-2 py-2">
                            <div className="flex justify-center">
                              <FindDomestic name={m.productName} brand={m.brand} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <p className="text-[11px] text-slate-500">
                💡 판매량은 <b className="text-slate-400">SPU(상품) 단위 중국 총계</b>입니다. 사이즈별 순수 판매량은
                원자료에 없어 <b className="text-slate-400">인기 모델의 사이즈 취급도(수요가중)</b>로 표시했어요.
                <Link href="/reverse/queue" className="underline text-fuchsia-300 ml-1">소싱 큐에서 매입 판단 →</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

function Panel({
  icon: Icon, title, hint, children,
}: { icon: any; title: string; hint?: string; children: React.ReactNode }) {
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
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 text-[12px] font-semibold rounded-full px-2.5 py-1 bg-fuchsia-500/15 text-fuchsia-200 hover:bg-fuchsia-500/25"
      >
        <Store className="h-3 w-3" /> 국내가
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-40 rounded-xl border border-white/15 bg-slate-900/95 backdrop-blur p-1 shadow-xl">
            {links.map(l => (
              <a key={l.label} href={l.url} target="_blank" rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="flex items-center justify-between px-2.5 py-1.5 text-[13px] text-slate-200 rounded-lg hover:bg-white/10">
                {l.label}
                <ExternalLink className="h-3 w-3 text-slate-500" />
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
      <BarChart3 className="h-8 w-8 text-slate-500 mx-auto mb-3" />
      <p className="text-slate-300 font-medium">집계할 카탈로그가 없어요</p>
      <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
        <Link href="/reverse/seller" className="underline text-fuchsia-300">판매자센터 엑셀</Link>을 올리면
        판매량·가격대·사이즈 인사이트가 여기 표시됩니다.
      </p>
    </div>
  );
}
