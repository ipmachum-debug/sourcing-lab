import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Radar, Plus, Trash2, RefreshCw, Search } from "lucide-react";

const won = (n: number) => `${Math.round(n || 0).toLocaleString("ko-KR")}원`;

interface Row {
  id: number; brand: string | null; productName: string; sku: string | null; category: string | null;
  domesticPrice: number; sellUsd: number; net: number | null; margin: number | null; verdict: string;
}

const V: Record<string, { cls: string; label: string }> = {
  추천: { cls: "text-emerald-300 bg-emerald-500/10", label: "🟢 추천" },
  가능: { cls: "text-emerald-200 bg-emerald-500/10", label: "🟢 가능" },
  불가: { cls: "text-red-300 bg-red-500/10", label: "🔴 불가" },
  미확보: { cls: "text-slate-400 bg-white/5", label: "시세 미확보" },
};

export default function ReverseWatch() {
  const utils = trpc.useUtils();
  const board = trpc.reverseDeals.watchBoard.useQuery();
  const rows = (board.data ?? []) as Row[];

  const inv = () => utils.reverseDeals.watchBoard.invalidate();
  const add = trpc.reversePurchase.skuCreate.useMutation({ onSuccess: () => { toast.success("워치 등록"); inv(); }, onError: e => toast.error(e.message) });
  const remove = trpc.reversePurchase.skuRemove.useMutation({ onSuccess: () => { toast.success("삭제"); inv(); } });
  const collect = trpc.reverseDeals.watchCollect.useMutation({
    onSuccess: r => { toast.success(`${r.updated}/${r.total}건 시세 자동수집 (미확보 ${r.total - r.updated})`); inv(); },
    onError: e => toast.error(e.message),
  });

  const [f, setF] = useState({ sku: "", productName: "", brand: "", category: "", domesticPrice: "" });
  const submit = () => {
    if (!f.productName.trim() && !f.sku.trim()) return toast.error("모델번호 또는 상품명을 입력하세요.");
    add.mutate({
      productName: f.productName || f.sku,
      sku: f.sku || undefined,
      brand: f.brand || undefined,
      category: f.category || undefined,
      domesticPrice: Number(f.domesticPrice) || 0,
    });
    setF({ sku: "", productName: "", brand: "", category: "", domesticPrice: "" });
  };

  const withPrice = rows.filter(r => r.sku).length;

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest neon-chip neon-magenta px-3 py-1 rounded-full uppercase">
                <Radar className="h-3.5 w-3.5" /> Discovery Watch
              </span>
              <h1 className="text-3xl font-black mt-4 neon-text">발굴 워치</h1>
              <p className="text-slate-300/80 mt-2">
                관심 모델을 등록해두면 <b className="text-white">POIZON 시세를 순차 자동수집</b>하고,
                국내 매입가 대비 <b className="text-fuchsia-300">판매가능/불가</b>를 자동 판정합니다.
              </p>
            </div>
            <button
              onClick={() => collect.mutate()}
              disabled={collect.isPending || withPrice === 0}
              title={withPrice ? "모델번호가 있는 워치의 시세를 순차 자동수집" : "모델번호(sku)가 있는 항목이 없습니다"}
              className="neon-btn rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-40 shrink-0"
            >
              <RefreshCw className={`h-4 w-4 ${collect.isPending ? "animate-spin" : ""}`} />
              {collect.isPending ? "수집 중…" : "전체 POIZON 자동수집"}
            </button>
          </div>

          {/* 등록 */}
          <div className="glass rounded-2xl p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              <In placeholder="모델번호 (예: FJ4170-004)" value={f.sku} onChange={v => setF({ ...f, sku: v })} />
              <In placeholder="상품명" value={f.productName} onChange={v => setF({ ...f, productName: v })} />
              <In placeholder="브랜드" value={f.brand} onChange={v => setF({ ...f, brand: v })} />
              <In placeholder="국내 매입가 ₩" value={f.domesticPrice} onChange={v => setF({ ...f, domesticPrice: v })} type="number" />
              <button onClick={submit} disabled={add.isPending}
                className="neon-btn rounded-lg px-4 py-2 text-sm font-semibold flex items-center justify-center gap-1.5">
                <Plus className="h-4 w-4" /> 워치 추가
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-2">
              <Search className="h-3 w-3 inline" /> 모델번호(상품번호)를 넣어야 「자동수집」으로 POIZON 시세가 채워집니다.
            </p>
          </div>

          {/* 목록 */}
          <div className="glass rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead className="bg-white/5 text-xs text-slate-400">
                  <tr>
                    <th className="text-left font-medium px-3 py-2.5">모델 / 브랜드</th>
                    <th className="text-right font-medium px-3 py-2.5">국내 매입가</th>
                    <th className="text-right font-medium px-3 py-2.5">POIZON 시세$</th>
                    <th className="text-right font-medium px-3 py-2.5">예상 순익</th>
                    <th className="text-center font-medium px-3 py-2.5">판정</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={6} className="text-center text-slate-500 py-10">관심 모델을 위에서 등록하세요.</td></tr>}
                  {rows.map(r => {
                    const v = V[r.verdict] ?? V.미확보;
                    return (
                      <tr key={r.id} className="border-t border-white/8">
                        <td className="px-3 py-2.5">
                          <p className="text-slate-100 truncate max-w-[240px]">{r.productName}</p>
                          <p className="text-[11px] text-slate-500">{r.brand || "-"}{r.sku ? ` · ${r.sku}` : ""}{r.category ? ` · ${r.category}` : ""}</p>
                        </td>
                        <td className="text-right px-3 py-2.5 text-slate-300">{won(r.domesticPrice)}</td>
                        <td className="text-right px-3 py-2.5 text-slate-300">{r.sellUsd > 0 ? `$${r.sellUsd.toLocaleString()}` : "-"}</td>
                        <td className={`text-right px-3 py-2.5 font-semibold ${r.net == null ? "text-slate-600" : r.net >= 0 ? "text-emerald-300" : "text-red-400"}`}>
                          {r.net == null ? "-" : `${won(r.net)}${r.margin != null ? ` (${r.margin}%)` : ""}`}
                        </td>
                        <td className="text-center px-3 py-2.5">
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${v.cls}`}>{v.label}</span>
                        </td>
                        <td className="text-right px-3 py-2.5">
                          <button onClick={() => remove.mutate({ id: r.id })} className="text-slate-500 hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[11px] text-slate-600">
            💡 「전체 POIZON 자동수집」은 모델번호가 있는 워치를 <b className="text-slate-400">하나씩 순차</b> 조회합니다(밴 안전).
            반복 수집하면 시세 변동을 추적할 수 있습니다. (자동 스케줄 수집은 다음 단계)
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}

function In({ placeholder, value, onChange, type }: { placeholder: string; value: string; onChange: (v: string) => void; type?: string }) {
  return <input type={type || "text"} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}
    className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-fuchsia-400/60" />;
}
