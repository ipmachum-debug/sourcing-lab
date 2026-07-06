import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import ImportExportBar from "@/components/ImportExportBar";
import Sparkline from "@/components/Sparkline";
import type { FieldSpec } from "@/lib/csv";
import { BarChart3, Package2, TrendingUp, Trash2 } from "lucide-react";
import { toast } from "sonner";

const SALES_SPECS: FieldSpec[] = [
  { key: "orderDate", alias: /(주문일|판매일|결제일|날짜|date|订单|时间|结算)/ },
  { key: "productName", alias: /(상품명|상품|품명|商品|product|name|title|모델)/ },
  { key: "brand", alias: /^(브랜드|brand|品牌)/ },
  { key: "sku", alias: /(sku|품번|货号|品番|모델번호|article)/ },
  { key: "size", alias: /(사이즈|尺码|size|치수)/ },
  { key: "qty", alias: /(수량|数量|qty|quantity|판매량|件数)/, type: "number" },
  { key: "salePrice", alias: /(판매가|단가|成交|售价|金额|price|amount|판매금액)/, type: "number" },
  { key: "settleAmount", alias: /(정산|결제금액|实付|settle|结算金额)/, type: "number" },
  { key: "externalOrderId", alias: /(주문번호|订单号|orderid|주문id)/ },
];

interface SkuRow {
  normKey: string; productName: string; brand: string | null;
  qty: number; revenue: number; myAvg: number; marketP50: number; vsMarketPct: number | null; lastDate: string;
  turnoverDays: number | null;
}
interface ChannelRow { channel: string; qty: number; revenue: number; settle: number; orders: number; avgPrice: number; net: number }
interface MonthRow {
  month: string; revenue: number; settle: number; net: number; cost: number; profit: number;
  qty: number; orders: number; marginPct: number; costCoveragePct: number;
}
interface Summary {
  trend: { d: string; qty: number; revenue: number }[];
  bySku: SkuRow[];
  totals: { orders: number; qty: number; revenue: number };
  matched: number; currency: string;
  channels: ChannelRow[]; monthly: MonthRow[]; avgTurnoverDays: number | null;
}

const CH_LABEL: Record<string, string> = { poizon: "POIZON", shopee: "Shopee", other: "기타" };

export default function ReverseSales() {
  const utils = trpc.useUtils();
  const [channel, setChannel] = useState<"poizon" | "shopee" | "other">("poizon");
  const [currency, setCurrency] = useState("KRW");
  const [days, setDays] = useState(90);
  const [rate, setRate] = useState(1);
  const q = trpc.salesReport.summary.useQuery({ days, rate });
  const d = q.data as Summary | undefined;
  const unit = (n: number, c: string) => (c === "KRW" ? `${Math.round(n).toLocaleString()}원` : c === "CNY" ? `¥${Math.round(n).toLocaleString()}` : `${Math.round(n).toLocaleString()} ${c}`);
  const cur = (n: number) => unit(n, currency);
  const money = (n: number) => unit(n, d?.currency || "KRW");

  const inv = () => utils.salesReport.summary.invalidate();
  const importMut = trpc.salesReport.bulkImport.useMutation({
    onSuccess: () => { toast.success("업로드 완료"); inv(); },
    onError: e => toast.error(e.message),
  });
  const removeSkuMut = trpc.salesReport.removeBySku.useMutation({ onSuccess: () => { toast.success("삭제됨"); inv(); }, onError: e => toast.error(e.message) });
  const clearMut = trpc.salesReport.clear.useMutation({ onSuccess: () => { toast.success("삭제 완료"); inv(); }, onError: e => toast.error(e.message) });

  const clearChannel = () => { if (confirm(`${CH_LABEL[channel]} 채널의 판매 데이터를 모두 삭제할까요?`)) clearMut.mutate({ channel }); };
  const clearAll = () => { if (confirm("업로드한 모든 판매 데이터를 삭제할까요? (되돌릴 수 없습니다)")) clearMut.mutate({}); };

  const qtySeries = (d?.trend ?? []).map(t => t.qty);
  const revSeries = (d?.trend ?? []).map(t => t.revenue);

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest neon-chip neon-magenta px-3 py-1 rounded-full uppercase">
                <BarChart3 className="h-3.5 w-3.5" /> Sales Analysis
              </span>
              <h1 className="text-3xl font-black mt-4 neon-text">판매 분석</h1>
              <p className="text-slate-300/80 mt-2">
                POIZON·쇼피에서 <b className="text-white">판매 내역을 엑셀로 내려받아 업로드</b>하면 판매량 추이 + <b className="text-fuchsia-300">시장 시세 대비 분석</b>까지.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select value={channel} onChange={e => setChannel(e.target.value as any)}
                className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-sm text-white outline-none focus:border-fuchsia-400/60">
                <option value="poizon" className="bg-[#0a0b1e]">POIZON</option>
                <option value="shopee" className="bg-[#0a0b1e]">Shopee</option>
                <option value="other" className="bg-[#0a0b1e]">기타</option>
              </select>
              <select value={currency} onChange={e => setCurrency(e.target.value)}
                className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-sm text-white outline-none focus:border-fuchsia-400/60">
                {["KRW", "CNY", "USD"].map(c => <option key={c} value={c} className="bg-[#0a0b1e]">{c}</option>)}
              </select>
              <ImportExportBar
                filename={`판매분석_${channel}`}
                importSpecs={SALES_SPECS}
                requiredKey="productName"
                importing={importMut.isPending}
                templateHeaders={["주문일", "상품명", "브랜드", "SKU", "사이즈", "수량", "판매가", "정산금액"]}
                templateExample={[["2026-07-01", "크록스 클래식 클로그 블랙", "크록스", "10001", "260", 1, 380, 350]]}
                onImport={rows => importMut.mutate({
                  channel, currency,
                  rows: rows.map(r => ({
                    orderDate: String(r.orderDate || ""), productName: r.productName,
                    brand: r.brand || undefined, sku: r.sku || undefined, size: r.size || undefined,
                    qty: r.qty > 0 ? r.qty : 1, salePrice: r.salePrice || 0, settleAmount: r.settleAmount || 0,
                    externalOrderId: r.externalOrderId || undefined,
                  })),
                })}
                onExport={() => ({
                  headers: ["상품", "브랜드", "판매량", "매출", "내평균가", "시장P50", "대비%", "회전일", "최근판매"],
                  rows: (d?.bySku ?? []).map(s => [s.productName, s.brand || "", s.qty, s.revenue, s.myAvg, s.marketP50, s.vsMarketPct ?? "", s.turnoverDays ?? "", s.lastDate]),
                })}
              />
            </div>
          </div>

          {/* 기간 + 원가환산 환율 */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1">
              {[30, 90, 180].map(r => (
                <button key={r} onClick={() => setDays(r)}
                  className={`text-xs px-3 py-1 rounded-lg border ${days === r ? "bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-400/50" : "border-white/10 text-slate-400"}`}>
                  {r}일
                </button>
              ))}
            </div>
            {currency !== "KRW" && (
              <label className="flex items-center gap-1.5 text-xs text-slate-400">
                원가환산 환율(원/{currency === "CNY" ? "위안" : currency})
                <input type="number" value={rate} onChange={e => setRate(Number(e.target.value) || 1)}
                  className="w-16 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-white outline-none focus:border-fuchsia-400/60" />
              </label>
            )}
            {d && d.totals.orders > 0 && (
              <div className="flex items-center gap-1.5 ml-auto">
                <button onClick={clearChannel} disabled={clearMut.isPending}
                  className="text-[11px] text-slate-400 hover:text-red-300 border border-white/10 rounded-lg px-2.5 py-1.5 flex items-center gap-1">
                  <Trash2 className="h-3.5 w-3.5" /> {CH_LABEL[channel]} 삭제
                </button>
                <button onClick={clearAll} disabled={clearMut.isPending}
                  className="text-[11px] text-slate-400 hover:text-red-300 border border-white/10 rounded-lg px-2.5 py-1.5">
                  전체 삭제
                </button>
              </div>
            )}
          </div>

          {!d || d.totals.orders === 0 ? (
            <div className="glass rounded-2xl p-8 text-center">
              <Package2 className="h-8 w-8 text-slate-500 mx-auto mb-3" />
              <p className="text-slate-300 font-medium">판매 내역을 올려보세요</p>
              <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
                POIZON/쇼피 판매자센터 → 주문·정산 내역 <b className="text-slate-300">엑셀 다운로드</b> → 위 <b className="text-slate-300">업로드</b> 버튼.
                주문일·상품명·수량·판매가만 있으면 자동 분석됩니다. (열 이름 한글/중문 자동 인식)
              </p>
            </div>
          ) : (
            <>
              {/* 요약 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Tile label="총 판매량" value={`${d.totals.qty.toLocaleString()}개`} />
                <Tile label="총 매출" value={money(d.totals.revenue)} tone="good" />
                <Tile label="평균 회전일" value={d.avgTurnoverDays != null ? `${d.avgTurnoverDays}일` : "-"} />
                <Tile label="시장 매칭" value={`${d.matched}/${d.bySku.length} SKU`} />
              </div>

              {/* 채널별 실적 */}
              {d.channels.length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold text-slate-100 mb-2">채널별 실적</h2>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {d.channels.map(c => (
                      <div key={c.channel} className="glass rounded-2xl p-4">
                        <p className="font-bold text-white">{CH_LABEL[c.channel] || c.channel}</p>
                        <p className="text-2xl font-black neon-text mt-1">{money(c.net)}</p>
                        <p className="text-xs text-slate-400 mt-1">
                          {c.qty}개 · {c.orders}건 · 평균 {cur(c.avgPrice)}
                          {c.settle > 0 && <span className="text-slate-500"> · 정산 {money(c.settle)}</span>}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 월별 손익계산서 */}
              {d.monthly.length > 0 && (
                <div className="glass rounded-2xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-white/10">
                    <h2 className="text-sm font-semibold text-slate-100">월별 손익계산서</h2>
                    <p className="text-[11px] text-slate-500">순이익 = 수령액(정산 없으면 매출) − 매입원가{currency !== "KRW" ? `(환율 ${rate} 환산)` : ""}. 원가는 매입 관리와 매칭된 SKU만 반영.</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[640px]">
                      <thead className="bg-white/5 text-xs text-slate-400">
                        <tr>
                          <th className="text-left font-medium px-3 py-2.5">월</th>
                          <th className="text-right font-medium px-3 py-2.5">판매량</th>
                          <th className="text-right font-medium px-3 py-2.5">매출</th>
                          <th className="text-right font-medium px-3 py-2.5">원가</th>
                          <th className="text-right font-medium px-3 py-2.5">순이익</th>
                          <th className="text-center font-medium px-3 py-2.5">마진</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.monthly.map(m => (
                          <tr key={m.month} className="border-t border-white/8">
                            <td className="px-3 py-2 font-medium text-slate-100">{m.month}</td>
                            <td className="text-right px-3 py-2 text-slate-300">{m.qty}</td>
                            <td className="text-right px-3 py-2 text-slate-300">{money(m.net)}</td>
                            <td className="text-right px-3 py-2 text-slate-400">
                              {m.cost ? money(m.cost) : "-"}
                              {m.cost > 0 && m.costCoveragePct < 100 && <span className="text-[10px] text-amber-400/80"> ({m.costCoveragePct}%)</span>}
                            </td>
                            <td className={`text-right px-3 py-2 font-bold ${m.cost ? (m.profit >= 0 ? "text-emerald-300" : "text-red-400") : "text-slate-500"}`}>
                              {m.cost ? money(m.profit) : "원가 미매칭"}
                            </td>
                            <td className="text-center px-3 py-2">
                              {m.cost ? <span className={`text-xs font-semibold ${m.marginPct >= 0 ? "text-emerald-300" : "text-red-400"}`}>{m.marginPct}%</span> : <span className="text-slate-600 text-xs">-</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 추이 */}
              <div className="glass rounded-2xl p-4 sm:p-5">
                <div className="flex items-center gap-2 mb-2"><TrendingUp className="h-4 w-4 text-fuchsia-300" /><h2 className="text-sm font-semibold text-slate-100">판매 추이 ({d.trend.length}일)</h2></div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-[11px] text-slate-400 mb-1">판매량</p>
                    <Sparkline values={qtySeries} width={320} height={54} className="w-full text-cyan-300/40" color="#67e8f9" />
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-400 mb-1">매출</p>
                    <Sparkline values={revSeries} width={320} height={54} className="w-full text-fuchsia-300/40" color="#e879f9" />
                  </div>
                </div>
              </div>

              {/* SKU별 + 시장 매칭 */}
              <div className="glass rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[760px]">
                    <thead className="bg-white/5 text-xs text-slate-400">
                      <tr>
                        <th className="text-left font-medium px-3 py-2.5">상품 / 브랜드</th>
                        <th className="text-right font-medium px-3 py-2.5">판매량</th>
                        <th className="text-right font-medium px-3 py-2.5">매출</th>
                        <th className="text-right font-medium px-3 py-2.5">내 평균가</th>
                        <th className="text-right font-medium px-3 py-2.5">시장 P50</th>
                        <th className="text-center font-medium px-3 py-2.5">시장 대비</th>
                        <th className="text-right font-medium px-3 py-2.5">회전일</th>
                        <th className="px-3 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {d.bySku.map(s => (
                        <tr key={s.normKey} className="border-t border-white/8">
                          <td className="px-3 py-2">
                            <p className="text-slate-100 truncate max-w-[260px]">{s.productName}</p>
                            <p className="text-[11px] text-slate-500">{s.brand || "-"} · 최근 {s.lastDate}</p>
                          </td>
                          <td className="text-right px-3 py-2 font-semibold text-slate-100">{s.qty}</td>
                          <td className="text-right px-3 py-2 text-slate-300">{money(s.revenue)}</td>
                          <td className="text-right px-3 py-2 text-slate-300">{s.myAvg ? cur(s.myAvg) : "-"}</td>
                          <td className="text-right px-3 py-2 text-slate-400">{s.marketP50 ? `${s.marketP50.toLocaleString()}원` : "-"}</td>
                          <td className="text-center px-3 py-2">
                            {s.vsMarketPct == null ? <span className="text-slate-600 text-xs">미매칭</span> : (
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.vsMarketPct >= 0 ? "bg-emerald-400/15 text-emerald-300" : "bg-amber-400/15 text-amber-300"}`}>
                                {s.vsMarketPct > 0 ? "+" : ""}{s.vsMarketPct}%
                              </span>
                            )}
                          </td>
                          <td className="text-right px-3 py-2 text-slate-400">{s.turnoverDays != null ? `${s.turnoverDays}일` : "-"}</td>
                          <td className="text-right px-3 py-2">
                            <button onClick={() => { if (confirm(`"${s.productName}" 판매 기록을 삭제할까요?`)) removeSkuMut.mutate({ normKey: s.normKey }); }}
                              className="text-slate-600 hover:text-red-400 transition-colors" title="이 상품 판매 데이터 삭제">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-slate-500 px-3 py-2">💡 <b className="text-slate-400">시장 대비</b> = 내 실판매 평균가 vs 프로그램이 수집한 POIZON 시세 중앙값(P50). +면 시장보다 비싸게, −면 싸게 판 것.</p>
              </div>
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

function Tile({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "good" }) {
  return (
    <div className="glass rounded-xl p-3">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className={`text-lg font-black mt-1 ${tone === "good" ? "text-emerald-300" : "text-white"}`}>{value}</p>
    </div>
  );
}
