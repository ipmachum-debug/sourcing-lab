import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Link } from "wouter";
import { Radar, Flame, Sparkles, TrendingDown, Star, Calculator, Info } from "lucide-react";

const cny = (n: number) => `¥${Math.round(n || 0).toLocaleString()}`;

interface TrendRow {
  normKey: string; productName: string; brand: string | null;
  rankPos: number | null; priceCny: number | null; soldCount: number | null; imageUrl: string | null;
}
interface SurgeRow {
  normKey: string; productName: string; brand: string | null;
  latestCny: number; prevCny: number; deltaPct: number; soldCount: number;
}

export default function ReverseMarket() {
  const q = trpc.poizonTrending.board.useQuery({ limit: 30 });
  const d = q.data as { today: TrendRow[]; newArrivals: TrendRow[]; surging: SurgeRow[]; totalObserved: number } | undefined;

  const watchMut = trpc.reversePurchase.skuCreate.useMutation({
    onSuccess: () => toast.success("워치리스트에 추가"),
    onError: e => toast.error(e.message),
  });
  const addWatch = (name: string, brand: string | null, priceCny: number) =>
    watchMut.mutate({ productName: name, brand: brand || undefined, domesticPrice: 0, poizonCny: priceCny || 0, rate: 190, feePct: 9 });

  const empty = d && d.today.length === 0 && d.newArrivals.length === 0 && d.surging.length === 0;

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10">
        <div className="max-w-6xl mx-auto space-y-8">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest neon-chip neon-magenta px-3 py-1 rounded-full uppercase">
              <Radar className="h-3.5 w-3.5" /> Market Radar
            </span>
            <h1 className="text-3xl sm:text-4xl font-black mt-4 neon-text">시장 정찰</h1>
            <p className="text-slate-300/80 mt-2">
              POIZON <b className="text-white">랭킹·신상 페이지를 열면</b> 인기·급상승·신상 상품이 자동으로 여기 모입니다. "뭘 팔지"를 시장에서 찾으세요.
            </p>
            <p className="text-[11px] text-slate-500 mt-1.5">관측 상품 {d?.totalObserved ?? 0}개 · 패시브 수집(본 페이지만)</p>
          </div>

          {empty && (
            <div className="glass rounded-2xl p-8 text-center">
              <Info className="h-8 w-8 text-slate-500 mx-auto mb-3" />
              <p className="text-slate-300 font-medium">아직 정찰 데이터가 없어요</p>
              <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
                확장 프로그램(v8.11.0)을 켜고 <b className="text-slate-300">POIZON 인기 랭킹/신상 페이지</b>를 한 번 열어보세요.
                화면에 보이는 상품들이 자동으로 수집돼 급상승·신상이 여기 뜹니다.
              </p>
            </div>
          )}

          {/* 급상승 */}
          {d && d.surging.length > 0 && (
            <Section icon={<Flame className="h-4 w-4 text-orange-300" />} title="🔥 급상승" desc="최근 시세 상승폭 큰 상품">
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {d.surging.map(r => (
                  <div key={r.normKey} className="glass rounded-2xl p-4 ring-1 ring-orange-400/30">
                    <p className="text-[11px] text-slate-500">{r.brand || "-"}</p>
                    <p className="font-bold text-slate-100 leading-tight line-clamp-2">{r.productName}</p>
                    <div className="flex items-end justify-between mt-2">
                      <div>
                        <p className="text-lg font-black text-orange-300">{cny(r.latestCny)} <span className="text-sm font-bold">+{r.deltaPct}%</span></p>
                        <p className="text-[11px] text-slate-500">이전 {cny(r.prevCny)}{r.soldCount ? ` · 판매 ${r.soldCount}` : ""}</p>
                      </div>
                    </div>
                    <CardActions onWatch={() => addWatch(r.productName, r.brand, r.latestCny)} />
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* 신상 */}
          {d && d.newArrivals.length > 0 && (
            <Section icon={<Sparkles className="h-4 w-4 text-cyan-300" />} title="🆕 신상" desc="최근 새로 관측된 상품">
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {d.newArrivals.map(r => (
                  <div key={r.normKey} className="glass rounded-2xl p-4 ring-1 ring-cyan-400/20">
                    <p className="text-[11px] text-slate-500">{r.brand || "-"}</p>
                    <p className="font-bold text-slate-100 leading-tight line-clamp-2">{r.productName}</p>
                    <p className="text-base font-black neon-text mt-2">{r.priceCny ? cny(r.priceCny) : "시세 미상"}{r.soldCount ? <span className="text-[11px] text-slate-400 font-normal"> · 판매 {r.soldCount}</span> : null}</p>
                    <CardActions onWatch={() => addWatch(r.productName, r.brand, r.priceCny || 0)} />
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* 오늘의 인기 랭킹 */}
          {d && d.today.length > 0 && (
            <Section icon={<TrendingDown className="h-4 w-4 rotate-180 text-fuchsia-300" />} title="📈 오늘의 인기 랭킹" desc="POIZON 랭킹 상위">
              <div className="glass rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[560px]">
                    <thead className="bg-white/5 text-xs text-slate-400">
                      <tr>
                        <th className="text-left font-medium px-3 py-2.5 w-12">순위</th>
                        <th className="text-left font-medium px-3 py-2.5">상품 / 브랜드</th>
                        <th className="text-right font-medium px-3 py-2.5">시세</th>
                        <th className="text-right font-medium px-3 py-2.5">판매</th>
                        <th className="px-3 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {d.today.map(r => (
                        <tr key={r.normKey} className="border-t border-white/8">
                          <td className="px-3 py-2 font-bold text-fuchsia-300">{r.rankPos}</td>
                          <td className="px-3 py-2">
                            <p className="text-slate-100 truncate max-w-[280px]">{r.productName}</p>
                            <p className="text-[11px] text-slate-500">{r.brand || "-"}</p>
                          </td>
                          <td className="text-right px-3 py-2 text-slate-200">{r.priceCny ? cny(r.priceCny) : "-"}</td>
                          <td className="text-right px-3 py-2 text-slate-400">{r.soldCount || "-"}</td>
                          <td className="text-right px-3 py-2">
                            <button onClick={() => addWatch(r.productName, r.brand, r.priceCny || 0)} className="text-slate-500 hover:text-amber-300" title="워치리스트 추가">
                              <Star className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </Section>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

function Section({ icon, title, desc, children }: { icon: React.ReactNode; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h2 className="text-lg font-black text-slate-100">{title}</h2>
        <span className="text-[11px] text-slate-500">{desc}</span>
      </div>
      {children}
    </div>
  );
}

function CardActions({ onWatch }: { onWatch: () => void }) {
  return (
    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/10">
      <Link href="/reverse/deals" className="text-[11px] neon-chip rounded-lg px-2.5 py-1.5 text-slate-200 flex items-center gap-1">
        <Calculator className="h-3.5 w-3.5" /> 매입 판단
      </Link>
      <button onClick={onWatch} className="text-[11px] neon-chip rounded-lg px-2.5 py-1.5 text-slate-200 flex items-center gap-1">
        <Star className="h-3.5 w-3.5" /> 워치리스트
      </button>
    </div>
  );
}
