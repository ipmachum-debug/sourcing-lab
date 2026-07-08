import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Package, Plus, Trash2, Check, X, Clock } from "lucide-react";
import ImportExportBar from "@/components/ImportExportBar";
import type { FieldSpec } from "@/lib/csv";

const BUY_SPECS: FieldSpec[] = [
  { key: "brand", alias: /^(브랜드|brand)/ },
  { key: "productName", alias: /(상품명|상품|productname|name|모델)/ },
  { key: "buyChannel", alias: /(매입처|구매처|채널|channel|몰)/ },
  { key: "buyPrice", alias: /(매입가|단가|buyprice|가격)/, type: "number" },
  { key: "qty", alias: /(수량|qty|개수)/, type: "number" },
  { key: "buyDate", alias: /(매입일|구매일|날짜|date)/ },
];

interface Row {
  id: number;
  brand: string | null;
  productName: string;
  buyChannel: string | null;
  buyPrice: number | null;
  qty: number | null;
  buyDate: string | null;
  condition: string | null;
  inspectStatus: string | null;
  sellChannel: string | null;
  soldPrice: number | null;
  sellDate: string | null;
  status: string;
}

const STATUS_LABEL: Record<string, string> = {
  purchased: "매입", inspecting: "검수중", listed: "판매중", sold: "판매완료", settled: "정산완료", returned: "반품",
};
const STATUS_OPTS = ["purchased", "inspecting", "listed", "sold", "settled", "returned"];

// 매입처 프리셋 (자유입력 허용 — datalist). 판매처(POIZON/쇼피/당근)와 분리.
const BUY_SOURCES = ["B2B(오프라인)", "아울렛", "ABC마트", "브랜드 홈페이지", "쿠팡", "다나와", "무신사"];
const SELL_CHANNELS: { v: string; l: string }[] = [
  { v: "poizon", l: "POIZON" },
  { v: "shopee", l: "쇼피" },
  { v: "danggeun", l: "당근" },
];
const sellLabel = (v: string | null) => SELL_CHANNELS.find(c => c.v === v)?.l ?? (v || "");

// 상태별 뷰 — 별도 페이지 없이 검수/재고/판매 관리를 탭으로.
const VIEWS: { key: string; label: string; emoji: string; match: (s: string) => boolean }[] = [
  { key: "all", label: "전체", emoji: "📋", match: () => true },
  { key: "inspect", label: "검수", emoji: "🔍", match: s => s === "purchased" || s === "inspecting" },
  { key: "stock", label: "재고·판매중", emoji: "📦", match: s => s === "listed" },
  { key: "sold", label: "판매완료", emoji: "✅", match: s => s === "sold" || s === "settled" },
  { key: "returned", label: "반품", emoji: "↩️", match: s => s === "returned" },
];

const won = (n: number) => `${Math.round(n || 0).toLocaleString("ko-KR")}원`;
const today = () => new Date().toISOString().slice(0, 10);

export default function ReversePurchases() {
  const utils = trpc.useUtils();
  const list = trpc.reversePurchase.list.useQuery({ status: "all", search: "", limit: 200 });
  const stats = trpc.reversePurchase.stats.useQuery();
  const rows = (list.data ?? []) as Row[];

  const invalidate = () => { utils.reversePurchase.list.invalidate(); utils.reversePurchase.stats.invalidate(); };
  const createMut = trpc.reversePurchase.create.useMutation({ onSuccess: () => { toast.success("매입 등록"); invalidate(); }, onError: e => toast.error(e.message) });
  const updateMut = trpc.reversePurchase.update.useMutation({ onSuccess: invalidate, onError: e => toast.error(e.message) });
  const removeMut = trpc.reversePurchase.remove.useMutation({ onSuccess: () => { toast.success("삭제됨"); invalidate(); } });
  const bulkMut = trpc.reversePurchase.bulkCreate.useMutation({ onSuccess: r => { toast.success(`${r.count}건 업로드`); invalidate(); }, onError: e => toast.error(e.message) });

  // 상태별 뷰
  const [view, setView] = useState("all");
  const activeView = VIEWS.find(v => v.key === view) ?? VIEWS[0];
  const shown = rows.filter(r => activeView.match(r.status));

  // 등록 폼 (판매처 기본 POIZON)
  const [f, setF] = useState({ brand: "", productName: "", buyChannel: "", buyPrice: "", qty: "1", condition: "new", sellChannel: "poizon" });
  const submit = () => {
    if (!f.productName.trim()) return toast.error("상품명을 입력하세요");
    createMut.mutate({
      brand: f.brand || undefined,
      productName: f.productName,
      buyChannel: f.buyChannel || undefined,
      buyPrice: Number(f.buyPrice) || 0,
      qty: Number(f.qty) || 1,
      buyDate: today(),
      condition: f.condition as any,
      sellChannel: f.sellChannel || undefined,
    });
    setF({ brand: "", productName: "", buyChannel: "", buyPrice: "", qty: "1", condition: "new", sellChannel: "poizon" });
  };

  const setStatus = (r: Row, status: string) => {
    const patch: any = { id: r.id, status };
    if ((status === "sold" || status === "settled") && !r.sellDate) patch.sellDate = today();
    updateMut.mutate(patch);
  };
  const setInspect = (r: Row, inspectStatus: string) => updateMut.mutate({ id: r.id, inspectStatus: inspectStatus as any });
  const setSold = (r: Row, v: number) => updateMut.mutate({ id: r.id, soldPrice: v });
  const setSellChannel = (r: Row, v: string) => updateMut.mutate({ id: r.id, sellChannel: v });

  const s = stats.data;

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest neon-chip neon-magenta px-3 py-1 rounded-full uppercase">
                <Package className="h-3.5 w-3.5" /> Purchases
              </span>
              <h1 className="text-3xl font-black mt-4 neon-text">매입 관리</h1>
              <p className="text-slate-300/80 mt-2">매입 → 검수 → 판매를 기록하면 <b className="text-white">검수 탈락률·회전일</b>이 쌓여 추천이 똑똑해집니다</p>
            </div>
            <ImportExportBar
              filename="매입내역"
              importSpecs={BUY_SPECS}
              requiredKey="productName"
              importing={bulkMut.isPending}
              templateHeaders={["브랜드", "상품명", "매입처", "매입가", "수량", "매입일"]}
              templateExample={[["크록스", "크록스 클래식 클로그 블랙", "ABC마트", 34900, 20, today()]]}
              onImport={rows =>
                bulkMut.mutate({
                  rows: rows.map(r => ({
                    brand: r.brand || undefined,
                    productName: r.productName,
                    buyChannel: r.buyChannel || undefined,
                    buyPrice: r.buyPrice || 0,
                    qty: r.qty > 0 ? r.qty : 1,
                    buyDate: r.buyDate || today(),
                  })),
                })
              }
              onExport={() => ({
                headers: ["브랜드", "상품명", "매입처", "매입가", "수량", "매입액", "검수", "상태", "판매처", "판매가", "매입일", "판매일"],
                rows: rows.map(r => [
                  r.brand || "", r.productName, r.buyChannel || "", r.buyPrice || 0, r.qty || 1,
                  (r.buyPrice || 0) * (r.qty || 1), r.inspectStatus || "", STATUS_LABEL[r.status] || r.status,
                  sellLabel(r.sellChannel), r.soldPrice || 0, r.buyDate || "", r.sellDate || "",
                ]),
              })}
            />
          </div>

          {/* 요약 */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <Tile label="총 매입" value={`${s?.total ?? 0}건`} />
            <Tile label="매입액" value={won(s?.buyAmount ?? 0)} />
            <Tile label="검수 탈락률" value={s?.inspected ? `${s.inspectFailRate}%` : "-"} tone={s && s.inspectFailRate >= 15 ? "danger" : "normal"} />
            <Tile label="판매완료" value={`${s?.soldCount ?? 0}건`} />
            <Tile label="총 순익" value={won(s?.netProfit ?? 0)} tone="good" />
            <Tile label="평균 회전일" value={s?.avgTurnDays != null ? `${s.avgTurnDays}일` : "-"} />
          </div>

          {/* 등록 폼 */}
          <div className="glass rounded-2xl p-4">
            <datalist id="buy-sources">
              {BUY_SOURCES.map(s => <option key={s} value={s} />)}
            </datalist>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
              <In placeholder="상품명 *" value={f.productName} onChange={v => setF({ ...f, productName: v })} span2 />
              <In placeholder="브랜드" value={f.brand} onChange={v => setF({ ...f, brand: v })} />
              {/* 매입처: 프리셋 + 자유입력 */}
              <input
                list="buy-sources"
                placeholder="매입처 (예: ABC마트·아울렛)"
                value={f.buyChannel}
                onChange={e => setF({ ...f, buyChannel: e.target.value })}
                className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-fuchsia-400/60"
              />
              {/* 판매처 */}
              <select
                value={f.sellChannel}
                title="판매처"
                onChange={e => setF({ ...f, sellChannel: e.target.value })}
                className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-fuchsia-400/60"
              >
                {SELL_CHANNELS.map(c => <option key={c.v} value={c.v} className="bg-[#0a0b1e]">판매 · {c.l}</option>)}
              </select>
              <In placeholder="매입가" value={f.buyPrice} onChange={v => setF({ ...f, buyPrice: v })} type="number" />
              <In placeholder="수량" value={f.qty} onChange={v => setF({ ...f, qty: v })} type="number" />
            </div>
            <div className="flex justify-end mt-2">
              <button onClick={submit} disabled={createMut.isPending}
                className="neon-btn rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5">
                <Plus className="h-4 w-4" /> 매입 등록
              </button>
            </div>
          </div>

          {/* 상태별 뷰 탭 */}
          <div className="flex flex-wrap items-center gap-2">
            {VIEWS.map(v => {
              const n = rows.filter(r => v.match(r.status)).length;
              return (
                <button
                  key={v.key}
                  onClick={() => setView(v.key)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                    view === v.key ? "neon-chip neon-magenta text-white" : "text-slate-400 hover:text-slate-200 bg-white/5"
                  }`}
                >
                  {v.emoji} {v.label}
                  <span className="text-[11px] opacity-70">{n}</span>
                </button>
              );
            })}
          </div>

          {/* 목록 */}
          <div className="glass rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[820px]">
                <thead className="bg-white/5 text-xs text-slate-400">
                  <tr>
                    <th className="text-left font-medium px-3 py-2.5">상품 / 브랜드</th>
                    <th className="text-right font-medium px-3 py-2.5">매입</th>
                    <th className="text-center font-medium px-3 py-2.5">검수</th>
                    <th className="text-center font-medium px-3 py-2.5">상태</th>
                    <th className="text-center font-medium px-3 py-2.5">판매처</th>
                    <th className="text-right font-medium px-3 py-2.5">판매가</th>
                    <th className="text-right font-medium px-3 py-2.5">순익</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 && (
                    <tr><td colSpan={8} className="text-center text-slate-500 py-10">
                      {rows.length === 0 ? "아직 매입 기록이 없어요. 위에서 등록하거나 소싱 큐에서 '매입'을 누르세요." : "이 상태의 매입이 없어요."}
                    </td></tr>
                  )}
                  {shown.map(r => {
                    const buyTotal = (r.buyPrice || 0) * (r.qty || 1);
                    const profit = (r.soldPrice || 0) - (r.buyPrice || 0);
                    const sold = r.status === "sold" || r.status === "settled";
                    return (
                      <tr key={r.id} className="border-t border-white/8">
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-slate-100 truncate max-w-[240px]">{r.productName}</p>
                          <p className="text-[11px] text-slate-500">{r.brand || "-"}{r.buyChannel ? ` · ${r.buyChannel}` : ""}</p>
                        </td>
                        <td className="text-right px-3 py-2.5 text-slate-300">
                          {won(r.buyPrice || 0)}<span className="text-slate-500"> ×{r.qty || 1}</span>
                          <div className="text-[11px] text-slate-500">= {won(buyTotal)}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-center gap-1">
                            <IBtn on={r.inspectStatus === "pending"} onClick={() => setInspect(r, "pending")} tone="slate"><Clock className="h-3 w-3" /></IBtn>
                            <IBtn on={r.inspectStatus === "pass"} onClick={() => setInspect(r, "pass")} tone="emerald"><Check className="h-3 w-3" /></IBtn>
                            <IBtn on={r.inspectStatus === "fail"} onClick={() => setInspect(r, "fail")} tone="red"><X className="h-3 w-3" /></IBtn>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <select value={r.status} onChange={e => setStatus(r, e.target.value)}
                            className="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-xs text-slate-200 outline-none focus:border-fuchsia-400/60">
                            {STATUS_OPTS.map(o => <option key={o} value={o} className="bg-[#0a0b1e]">{STATUS_LABEL[o]}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <select value={r.sellChannel ?? ""} onChange={e => setSellChannel(r, e.target.value)}
                            className="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-xs text-slate-200 outline-none focus:border-fuchsia-400/60">
                            <option value="" className="bg-[#0a0b1e]">—</option>
                            {SELL_CHANNELS.map(c => <option key={c.v} value={c.v} className="bg-[#0a0b1e]">{c.l}</option>)}
                          </select>
                        </td>
                        <td className="text-right px-3 py-2.5">
                          <input type="number" defaultValue={r.soldPrice || 0} disabled={!sold}
                            onBlur={e => { const v = Number(e.target.value) || 0; if (v !== (r.soldPrice || 0)) setSold(r, v); }}
                            className="w-24 text-right rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-xs text-white outline-none focus:border-fuchsia-400/60 disabled:opacity-40" />
                        </td>
                        <td className={`text-right px-3 py-2.5 font-semibold ${sold ? (profit >= 0 ? "text-emerald-300" : "text-red-400") : "text-slate-600"}`}>
                          {sold ? won(profit) : "-"}
                        </td>
                        <td className="text-right px-3 py-2.5">
                          <button onClick={() => removeMut.mutate({ id: r.id })} className="text-slate-500 hover:text-red-400 transition-colors">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Tile({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "good" | "danger" }) {
  const c = tone === "good" ? "text-emerald-300" : tone === "danger" ? "text-red-400" : "text-white";
  return (
    <div className="glass rounded-xl p-3">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className={`text-lg font-black mt-1 ${c}`}>{value}</p>
    </div>
  );
}

function In({ placeholder, value, onChange, type, span2 }: { placeholder: string; value: string; onChange: (v: string) => void; type?: string; span2?: boolean }) {
  return (
    <input
      type={type || "text"} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}
      className={`rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-fuchsia-400/60 ${span2 ? "sm:col-span-2" : ""}`}
    />
  );
}

function IBtn({ on, onClick, tone, children }: { on: boolean; onClick: () => void; tone: string; children: React.ReactNode }) {
  const onCls: Record<string, string> = {
    slate: "bg-slate-500/40 text-slate-100 border-slate-400/40",
    emerald: "bg-emerald-500/30 text-emerald-200 border-emerald-400/50",
    red: "bg-red-500/30 text-red-200 border-red-400/50",
  };
  return (
    <button onClick={onClick} className={`h-6 w-6 grid place-items-center rounded-md border transition-all ${on ? onCls[tone] : "border-white/10 text-slate-500 hover:text-slate-300"}`}>
      {children}
    </button>
  );
}
