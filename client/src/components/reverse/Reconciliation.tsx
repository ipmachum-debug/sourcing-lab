import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Receipt, RefreshCw } from "lucide-react";

const fmt = (n: number) => Math.round((n || 0) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

/**
 * 실시간 정산 내역 조회 — POIZON이 실제 지급한 정산액(stmt_fee)·수수료를 기간별로.
 * "예상"이 아닌 "실제 받은 돈"을 보여준다.
 */
export default function Reconciliation({ ready }: { ready: boolean }) {
  const [start, setStart] = useState(daysAgo(30));
  const [end, setEnd] = useState(today());
  const q = trpc.reverseDeals.poizonReconciliation.useQuery(
    { startDate: start, endDate: end, pageSize: 50 },
    { enabled: false }
  );
  const d = q.data as any;
  const rows = (d?.rows ?? []) as any[];
  const t = d?.totals;

  return (
    <div className="glass rounded-2xl p-5 ring-1 ring-emerald-400/25">
      <div className="flex items-center gap-2 mb-3">
        <Receipt className="h-4 w-4 text-emerald-300" />
        <h2 className="text-sm font-semibold text-slate-100">실시간 정산 내역 (실제 받은 돈)</h2>
        <span className="text-[11px] text-slate-500">POIZON이 지급한 정산액·수수료</span>
      </div>
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <label className="block">
          <span className="text-[11px] text-slate-400">시작일</span>
          <input type="date" value={start} onChange={e => setStart(e.target.value)}
            className="mt-1 block rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-sm text-white outline-none focus:border-emerald-400/50" />
        </label>
        <label className="block">
          <span className="text-[11px] text-slate-400">종료일</span>
          <input type="date" value={end} onChange={e => setEnd(e.target.value)}
            className="mt-1 block rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-sm text-white outline-none focus:border-emerald-400/50" />
        </label>
        <button onClick={() => q.refetch()} disabled={!ready || q.isFetching}
          className="neon-btn rounded-lg px-4 py-2 text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-40">
          <RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} /> {q.isFetching ? "조회 중…" : "정산 조회"}
        </button>
      </div>

      {d?.note && <p className="text-[12px] text-amber-300">{d.note}</p>}

      {t && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          <Sum label="건수" value={`${t.count}건 / 총 ${d.total}`} />
          <Sum label="판매 합계" value={fmt(t.saleSum).toLocaleString()} />
          <Sum label="정산 합계 (실수령)" value={fmt(t.settleSum).toLocaleString()} tone="good" />
          <Sum label="수수료 합계" value={fmt(t.feeSum).toLocaleString()} tone="danger" />
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-white/5 text-xs text-slate-400">
              <tr>
                <th className="text-left font-medium px-3 py-2">주문 / 상품</th>
                <th className="text-center font-medium px-3 py-2">사이즈</th>
                <th className="text-right font-medium px-3 py-2">판매가</th>
                <th className="text-right font-medium px-3 py-2">정산액</th>
                <th className="text-right font-medium px-3 py-2">수수료</th>
                <th className="text-center font-medium px-3 py-2">상태</th>
                <th className="text-center font-medium px-3 py-2">정산일</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.orderNo ?? i} className="border-t border-white/8">
                  <td className="px-3 py-2">
                    <p className="text-slate-100 truncate max-w-[240px]">{r.productName ?? "-"}</p>
                    <p className="text-[11px] text-slate-500">{r.orderNo}{r.articleNumber ? ` · ${r.articleNumber}` : ""}</p>
                  </td>
                  <td className="text-center px-3 py-2 text-slate-300">{r.size ?? "-"}</td>
                  <td className="text-right px-3 py-2 text-slate-300">{fmt(r.salePrice).toLocaleString()}</td>
                  <td className="text-right px-3 py-2 font-semibold text-emerald-300">{fmt(r.settleAmount).toLocaleString()}</td>
                  <td className="text-right px-3 py-2 text-red-300">-{fmt(r.totalFee).toLocaleString()}</td>
                  <td className="text-center px-3 py-2 text-[11px] text-slate-400">{r.status ?? "-"}</td>
                  <td className="text-center px-3 py-2 text-[11px] text-slate-500">{r.settleTime ? String(r.settleTime).slice(0, 10) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-slate-600 mt-2">
        정산액 = POIZON이 수수료 제외 후 실제 지급한 금액(stmt_fee). 통화는 정산 채널 기준입니다.
        다음 단계: 주문의 상품번호로 내 매입 로트와 매칭 → 실이익(정산액 − 매입가) 자동 집계.
      </p>
    </div>
  );
}

function Sum({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "good" | "danger" }) {
  const c = tone === "good" ? "text-emerald-300" : tone === "danger" ? "text-red-400" : "text-slate-100";
  return (
    <div className="glass rounded-xl p-3">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className={`text-base font-black mt-1 ${c}`}>{value}</p>
    </div>
  );
}
