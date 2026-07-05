import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Ship, CheckCircle2 } from "lucide-react";
import ImportExportBar from "@/components/ImportExportBar";

interface Row {
  id: number; productName: string; brand: string | null;
  buyPrice: number | null; soldPrice: number | null; sellChannel: string | null;
  buyDate: string | null; sellDate: string | null; status: string;
}

const CH_LABEL: Record<string, string> = { poizon: "POIZON", danggeun: "당근", amazon: "아마존", other: "기타" };
const won = (n: number) => `${Math.round(n || 0).toLocaleString("ko-KR")}원`;
function turnDays(r: Row): number | null {
  if (!r.sellDate || !r.buyDate) return null;
  const d = (new Date(r.sellDate).getTime() - new Date(r.buyDate).getTime()) / 86400000;
  return Number.isFinite(d) ? Math.round(d) : null;
}

export default function ReverseExports() {
  const utils = trpc.useUtils();
  const list = trpc.reversePurchase.list.useQuery({ status: "all", search: "", limit: 300 });
  const rows = ((list.data ?? []) as Row[]).filter(r => ["listed", "sold", "settled"].includes(r.status));
  const settleMut = trpc.reversePurchase.update.useMutation({
    onSuccess: () => { toast.success("정산완료"); utils.reversePurchase.list.invalidate(); utils.reversePurchase.stats.invalidate(); },
    onError: e => toast.error(e.message),
  });

  const soldRows = rows.filter(r => r.status === "sold" || r.status === "settled");
  const revenue = soldRows.reduce((a, r) => a + (r.soldPrice || 0), 0);
  const profit = soldRows.reduce((a, r) => a + ((r.soldPrice || 0) - (r.buyPrice || 0)), 0);
  const pendingSettle = rows.filter(r => r.status === "sold").length;

  // 채널별 집계
  const channels = ["poizon", "danggeun", "amazon", "other"].map(ch => {
    const cr = soldRows.filter(r => (r.sellChannel || "other") === ch);
    return { ch, count: cr.length, revenue: cr.reduce((a, r) => a + (r.soldPrice || 0), 0), profit: cr.reduce((a, r) => a + ((r.soldPrice || 0) - (r.buyPrice || 0)), 0) };
  }).filter(c => c.count > 0);

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest neon-chip neon-magenta px-3 py-1 rounded-full uppercase">
                <Ship className="h-3.5 w-3.5" /> Exports
              </span>
              <h1 className="text-3xl font-black mt-4 neon-text">수출 관리</h1>
              <p className="text-slate-300/80 mt-2">판매·정산·회계를 채널별로 — 매입 관리에 기록한 판매 건이 여기로 흘러옵니다</p>
            </div>
            <ImportExportBar
              filename="판매정산내역"
              onExport={() => ({
                headers: ["상품", "브랜드", "채널", "판매가", "매입가", "순익", "회전일", "상태", "매입일", "판매일"],
                rows: rows.map(r => [
                  r.productName, r.brand || "", r.sellChannel ? CH_LABEL[r.sellChannel] : "",
                  r.soldPrice || 0, r.buyPrice || 0, (r.soldPrice || 0) - (r.buyPrice || 0),
                  turnDays(r) ?? "", r.status, r.buyDate || "", r.sellDate || "",
                ]),
              })}
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile label="총 매출" value={won(revenue)} />
            <Tile label="총 순익" value={won(profit)} tone="good" />
            <Tile label="판매 건수" value={`${soldRows.length}건`} />
            <Tile label="정산 대기" value={`${pendingSettle}건`} tone={pendingSettle > 0 ? "danger" : "normal"} />
          </div>

          {/* 채널별 회계 */}
          {channels.length > 0 && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {channels.map(c => (
                <div key={c.ch} className="glass rounded-2xl p-4">
                  <p className="font-bold text-white">{CH_LABEL[c.ch]}</p>
                  <p className="text-2xl font-black neon-text mt-1">{won(c.revenue)}</p>
                  <p className="text-xs text-slate-400 mt-1">{c.count}건 · 순익 <b className="text-emerald-300">{won(c.profit)}</b></p>
                </div>
              ))}
            </div>
          )}

          {/* 판매 목록 */}
          <div className="glass rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="bg-white/5 text-xs text-slate-400">
                  <tr>
                    <th className="text-left font-medium px-3 py-2.5">상품</th>
                    <th className="text-center font-medium px-3 py-2.5">채널</th>
                    <th className="text-right font-medium px-3 py-2.5">판매가</th>
                    <th className="text-right font-medium px-3 py-2.5">순익</th>
                    <th className="text-center font-medium px-3 py-2.5">회전일</th>
                    <th className="text-center font-medium px-3 py-2.5">정산</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={6} className="text-center text-slate-500 py-10">판매 중/완료 건이 없어요. 매입 관리에서 상태를 판매중/판매완료로 바꿔보세요.</td></tr>}
                  {rows.map(r => {
                    const p = (r.soldPrice || 0) - (r.buyPrice || 0);
                    const td = turnDays(r);
                    const sold = r.status === "sold" || r.status === "settled";
                    return (
                      <tr key={r.id} className="border-t border-white/8">
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-slate-100 truncate max-w-[260px]">{r.productName}</p>
                          <p className="text-[11px] text-slate-500">{r.brand || "-"}</p>
                        </td>
                        <td className="text-center px-3 py-2.5 text-slate-300">{r.sellChannel ? CH_LABEL[r.sellChannel] : "-"}</td>
                        <td className="text-right px-3 py-2.5 text-slate-200">{sold ? won(r.soldPrice || 0) : <span className="text-slate-500">판매중</span>}</td>
                        <td className={`text-right px-3 py-2.5 font-semibold ${sold ? (p >= 0 ? "text-emerald-300" : "text-red-400") : "text-slate-600"}`}>{sold ? won(p) : "-"}</td>
                        <td className="text-center px-3 py-2.5 text-slate-300">{td != null ? `${td}일` : "-"}</td>
                        <td className="text-center px-3 py-2.5">
                          {r.status === "settled" ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> 완료</span>
                          ) : r.status === "sold" ? (
                            <button onClick={() => settleMut.mutate({ id: r.id, status: "settled" })}
                              className="text-[11px] neon-chip neon-magenta px-2 py-1 rounded-full">정산 처리</button>
                          ) : <span className="text-slate-600 text-[11px]">-</span>}
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
  const c = tone === "good" ? "text-emerald-300" : tone === "danger" ? "text-amber-300" : "text-white";
  return (
    <div className="glass rounded-xl p-3">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className={`text-lg font-black mt-1 ${c}`}>{value}</p>
    </div>
  );
}
