import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Gavel, Search, CheckCircle2, XCircle, Star } from "lucide-react";

interface Result {
  category: string | null;
  sellUsd: number;
  revenueKrw: number;
  feeKrw: number;
  deductKrw: number;
  vatRefundKrw: number;
  netProfitKrw: number;
  marginPct: number;
  breakEvenUsd: number;
  target30Usd: number;
  sellable: boolean;
  verdict: string;
}

const won = (n: number) => `${Math.round(n || 0).toLocaleString("ko-KR")}원`;

/**
 * 단건 판매가능 판정기 — 기타 사이트에서 찾은 모델/국내가/POIZON 시세($)를 넣으면
 * POIZON 중국 판매 기준으로 실이익·판매가능을 즉시 판정.
 */
export default function SellabilityCheck() {
  const utils = trpc.useUtils();
  const [f, setF] = useState({ productName: "", brand: "", buyKrw: "", sellUsd: "", size: "" });
  const [res, setRes] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    const buyKrw = Number(f.buyKrw);
    const sellUsd = Number(f.sellUsd);
    if (!f.productName.trim()) return toast.error("모델/상품명을 입력하세요.");
    if (!(buyKrw > 0)) return toast.error("국내 매입가(₩)를 입력하세요.");
    if (!(sellUsd > 0)) return toast.error("POIZON 시세($)를 입력하세요.");
    setLoading(true);
    try {
      const r = await utils.reverseDeals.sellabilityCheck.fetch({
        productName: f.productName,
        brand: f.brand || undefined,
        buyKrw,
        sellUsd,
        size: f.size || undefined,
      });
      setRes(r as Result);
    } catch (e: any) {
      toast.error(e?.message ?? "판정 실패");
    } finally {
      setLoading(false);
    }
  };

  const q = encodeURIComponent(`${f.brand} ${f.productName}`.trim());
  const findLinks = [
    { label: "다나와", url: `https://search.danawa.com/dsearch.php?query=${q}` },
    { label: "네이버", url: `https://search.shopping.naver.com/search/all?query=${q}` },
    { label: "무신사", url: `https://www.musinsa.com/search/musinsa/integration?q=${q}` },
  ];

  const V = res
    ? res.verdict === "추천"
      ? { cls: "text-emerald-300 bg-emerald-500/10 border-emerald-400/30", icon: <Star className="h-4 w-4" />, label: "🟢 추천 (판매가능)" }
      : res.verdict === "가능"
        ? { cls: "text-emerald-200 bg-emerald-500/10 border-emerald-400/20", icon: <CheckCircle2 className="h-4 w-4" />, label: "🟢 판매가능" }
        : { cls: "text-red-300 bg-red-500/10 border-red-400/30", icon: <XCircle className="h-4 w-4" />, label: "🔴 판매 불가 (손해)" }
    : null;

  return (
    <div className="glass rounded-2xl p-5 ring-1 ring-cyan-400/25">
      <div className="flex items-center gap-2 mb-1">
        <Gavel className="h-4 w-4 text-cyan-300" />
        <h2 className="text-sm font-semibold text-slate-100">단건 판매가능 판정 (POIZON 중국)</h2>
        <span className="text-[11px] text-slate-500">모델·국내가·시세($) → 실이익 즉시 판정</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mt-3">
        <input value={f.productName} onChange={e => setF({ ...f, productName: e.target.value })} placeholder="모델/상품명 *"
          className="col-span-2 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-400/50" />
        <input value={f.brand} onChange={e => setF({ ...f, brand: e.target.value })} placeholder="브랜드"
          className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-400/50" />
        <input type="number" value={f.buyKrw} onChange={e => setF({ ...f, buyKrw: e.target.value })} placeholder="국내 매입가 ₩"
          className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-400/50" />
        <input type="number" value={f.sellUsd} onChange={e => setF({ ...f, sellUsd: e.target.value })} placeholder="POIZON 시세 $"
          className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-400/50" />
        <input value={f.size} onChange={e => setF({ ...f, size: e.target.value })} placeholder="사이즈(선택)"
          className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-400/50" />
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button onClick={run} disabled={loading}
          className="neon-btn rounded-lg px-4 py-2 text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
          <Gavel className={`h-4 w-4 ${loading ? "animate-pulse" : ""}`} /> {loading ? "판정 중…" : "판정"}
        </button>
        {q.length > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Search className="h-3.5 w-3.5" /> 국내가 찾기:
            {findLinks.map(l => (
              <a key={l.label} href={l.url} target="_blank" rel="noreferrer" className="underline hover:text-cyan-300">{l.label}</a>
            ))}
          </div>
        )}
      </div>

      {res && V && (
        <div className="mt-4 space-y-3">
          <div className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold ${V.cls}`}>
            {V.icon} {V.label}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="실이익" value={won(res.netProfitKrw)} tone={res.netProfitKrw >= 0 ? "good" : "danger"} />
            <Stat label="마진율" value={`${res.marginPct}%`} tone={res.marginPct >= 25 ? "good" : res.marginPct >= 0 ? "normal" : "danger"} />
            <Stat label="손익분기가" value={`$${res.breakEvenUsd.toLocaleString()}`} />
            <Stat label="마진30% 목표가" value={`$${res.target30Usd.toLocaleString()}`} />
          </div>
          <p className="text-[11px] text-slate-500">
            판매가 ${res.sellUsd} = {won(res.revenueKrw)} · 총 차감 {won(res.deductKrw)}(수수료·중국배송·환손실 등) · 부가세환급 +{won(res.vatRefundKrw)}
            {res.category ? ` · 카테고리 ${res.category}` : ""}
          </p>
          {!res.sellable && (
            <p className="text-[12px] text-red-300">
              🔴 이 매입가·시세로는 손해입니다. 손익분기 ${res.breakEvenUsd} 이상에 팔거나, 국내를 더 싸게 조달해야 판매가능해집니다.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "good" | "danger" }) {
  const c = tone === "good" ? "text-emerald-300" : tone === "danger" ? "text-red-400" : "text-slate-100";
  return (
    <div className="rounded-lg bg-white/5 px-3 py-2">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className={`text-sm font-bold ${c}`}>{value}</p>
    </div>
  );
}
