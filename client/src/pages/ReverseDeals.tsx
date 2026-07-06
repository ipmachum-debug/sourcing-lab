import { useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Flame, Settings2, Star, TrendingUp, Info, Calculator } from "lucide-react";
import ImportExportBar from "@/components/ImportExportBar";

const won = (n: number) => `${Math.round(n || 0).toLocaleString("ko-KR")}원`;

// 서버 reverseProfit 엔진과 동일한 기본 코스트 (즉석 계산기 미러)
// POIZON(한국)이 원화라 환산 불필요: rate=1, 환전손실=0
const DEFAULT_COST = {
  rate: 1,
  poizonFeePct: 9,
  chinaShipKrw: 5000,
  fxLossPct: 0,
  packingKrw: 1000,
  inspectRiskPct: 3,
};
type Cost = typeof DEFAULT_COST;

function calcProfit(domesticBuyKrw: number, stableCny: number, c: Cost) {
  const revenueKrw = Math.round(stableCny * c.rate);
  const feeKrw = Math.round((revenueKrw * c.poizonFeePct) / 100);
  const fxLossKrw = Math.round((revenueKrw * c.fxLossPct) / 100);
  const inspectRiskKrw = Math.round((revenueKrw * c.inspectRiskPct) / 100);
  const deductKrw = feeKrw + c.chinaShipKrw + fxLossKrw + c.packingKrw + inspectRiskKrw;
  const netProfitKrw = revenueKrw - domesticBuyKrw - deductKrw;
  const marginPct = domesticBuyKrw > 0 ? Math.round((netProfitKrw / domesticBuyKrw) * 1000) / 10 : 0;
  return { revenueKrw, deductKrw, netProfitKrw, marginPct };
}

const GRADE_STYLE: Record<string, string> = {
  A: "bg-emerald-400 text-emerald-950",
  B: "bg-cyan-400 text-cyan-950",
  C: "bg-amber-400 text-amber-950",
  D: "bg-slate-600 text-slate-200",
};
const SOURCE_LABEL: Record<string, string> = {
  watchlist: "워치리스트", musinsa: "무신사", abcmart: "ABC마트", crocs: "크록스",
  nike: "나이키", adidas: "아디다스", newbalance: "뉴발란스", lfmall: "LF몰",
  lotteon: "롯데ON", ssg: "SSG", "29cm": "29CM", other: "기타",
};

interface Deal {
  normKey: string; brand: string; productName: string; source: string; imageUrl: string | null;
  domesticBuyKrw: number; stableCny: number; avg30Cny: number; volume30: number; volatilityPct: number;
  revenueKrw: number; deductKrw: number; netProfitKrw: number; marginPct: number;
  grade: "A" | "B" | "C" | "D"; recommendQty: number; stars: number; hasObservations: boolean;
}

export default function ReverseDeals() {
  const [cost, setCost] = useState<Cost>(DEFAULT_COST);
  const [showSettings, setShowSettings] = useState(false);
  const [minMargin, setMinMargin] = useState(30);
  const [onlyRec, setOnlyRec] = useState(false);

  const q = trpc.reverseDeals.todayDeals.useQuery({
    ...cost, minMargin, onlyRecommended: onlyRec, limit: 20,
  });
  const data = q.data as { deals: Deal[]; totalCandidates: number; withObservations: number } | undefined;
  const deals = data?.deals ?? [];

  // 즉석 매입 계산기
  const [calc, setCalc] = useState({ buy: "", stable: "" });
  const calcRes = useMemo(() => {
    const b = Number(calc.buy) || 0, s = Number(calc.stable) || 0;
    if (b <= 0 || s <= 0) return null;
    return calcProfit(b, s, cost);
  }, [calc, cost]);

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* 헤더 */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest neon-chip neon-magenta px-3 py-1 rounded-full uppercase">
                <Flame className="h-3.5 w-3.5" /> Buy Signals
              </span>
              <h1 className="text-3xl sm:text-4xl font-black mt-4 neon-text">오늘 사야 할 상품</h1>
              <p className="text-slate-300/80 mt-2">
                감으로 사지 말고 <b className="text-white">숫자로</b> 삽니다. POIZON <b className="text-fuchsia-300">안정 판매가(최근 30일 하위 25%)</b> 기준으로
                순이익·마진율·추천 매입 수량을 계산해요.
              </p>
              <p className="text-[11px] text-slate-500 mt-1.5">
                후보 {data?.totalCandidates ?? 0}개 · 실측 시세 보유 {data?.withObservations ?? 0}개
              </p>
            </div>
            <ImportExportBar
              filename="오늘사야할상품_발주서"
              onExport={() => ({
                headers: ["브랜드", "상품", "국내특가", "안정판매가(원)", "예상순이익", "마진율(%)", "안정성", "추천수량"],
                rows: deals.map(d => [
                  d.brand || "", d.productName, d.domesticBuyKrw, d.revenueKrw,
                  d.netProfitKrw, d.marginPct.toFixed(1), d.grade, d.recommendQty,
                ]),
              })}
            />
          </div>

          {/* 즉석 매입 계산기 */}
          <div className="glass rounded-2xl p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-3">
              <Calculator className="h-4 w-4 text-fuchsia-300" />
              <h2 className="text-sm font-semibold text-slate-100">즉석 매입 계산기</h2>
              <span className="text-[11px] text-slate-500">국내 특가 + POIZON 안정가 → 순이익</span>
            </div>
            <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
              <Field label="국내 매입가 (원)">
                <input type="number" value={calc.buy} onChange={e => setCalc({ ...calc, buy: e.target.value })}
                  placeholder="34900" className="calc-in" />
              </Field>
              <Field label="POIZON 안정 판매가 (원)">
                <input type="number" value={calc.stable} onChange={e => setCalc({ ...calc, stable: e.target.value })}
                  placeholder="380" className="calc-in" />
              </Field>
              {calcRes && (
                <div className="text-right">
                  <p className="text-[11px] text-slate-500">예상 순이익 / 마진율</p>
                  <p className={`text-2xl font-black ${calcRes.netProfitKrw >= 0 ? "text-emerald-300" : "text-red-400"}`}>
                    {won(calcRes.netProfitKrw)}
                  </p>
                  <p className={`text-sm font-bold ${calcRes.marginPct >= 30 ? "text-emerald-300" : calcRes.marginPct > 0 ? "text-amber-300" : "text-red-400"}`}>
                    마진율 {calcRes.marginPct.toFixed(1)}%
                  </p>
                </div>
              )}
            </div>
            {calcRes && (
              <p className="text-[11px] text-slate-500 mt-2">
                매출 {won(calcRes.revenueKrw)} − 매입 {won(Number(calc.buy))} − 수수료·배송·포장·검수 {won(calcRes.deductKrw)} = <b className="text-slate-300">{won(calcRes.netProfitKrw)}</b>
              </p>
            )}
          </div>

          {/* 코스트 설정 + 필터 */}
          <div className="glass rounded-2xl p-4">
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={() => setShowSettings(s => !s)} className="neon-chip rounded-lg px-3 py-1.5 text-sm text-slate-200 flex items-center gap-1.5">
                <Settings2 className="h-4 w-4" /> 코스트 설정
              </button>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                최소 마진율
                <input type="number" value={minMargin} onChange={e => setMinMargin(Number(e.target.value) || 0)}
                  className="w-16 calc-in !py-1" /> %
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input type="checkbox" checked={onlyRec} onChange={e => setOnlyRec(e.target.checked)} className="accent-fuchsia-500" />
                추천(매입수량 &gt; 0)만
              </label>
            </div>
            {showSettings && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mt-3">
                <CostIn label="수수료(%)" v={cost.poizonFeePct} on={v => setCost({ ...cost, poizonFeePct: v })} step={0.5} />
                <CostIn label="배송비(원)" v={cost.chinaShipKrw} on={v => setCost({ ...cost, chinaShipKrw: v })} step={500} />
                <CostIn label="포장비(원)" v={cost.packingKrw} on={v => setCost({ ...cost, packingKrw: v })} step={500} />
                <CostIn label="검수리스크(%)" v={cost.inspectRiskPct} on={v => setCost({ ...cost, inspectRiskPct: v })} step={0.5} />
              </div>
            )}
          </div>

          {/* 추천 카드 */}
          {q.isLoading ? (
            <div className="text-center text-slate-500 py-16">계산 중…</div>
          ) : deals.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {deals.map((d, i) => (
                <DealCard key={d.normKey} d={d} rank={i + 1} />
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .calc-in { border-radius: 0.5rem; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.05); padding: 0.5rem 0.75rem; font-size: 0.875rem; color: #fff; outline: none; width: 100%; }
        .calc-in::placeholder { color: #64748b; }
        .calc-in:focus { border-color: rgba(232,121,249,0.6); }
      `}</style>
    </DashboardLayout>
  );
}

function DealCard({ d, rank }: { d: Deal; rank: number }) {
  const rec = d.recommendQty > 0;
  return (
    <div className={`glass rounded-2xl p-4 relative overflow-hidden ${rec ? "ring-1 ring-fuchsia-400/40" : ""}`}>
      {rank <= 3 && (
        <span className="absolute top-3 right-3 text-[11px] font-bold text-fuchsia-300/80">#{rank}</span>
      )}
      <div className="flex items-start justify-between gap-2 pr-6">
        <div className="min-w-0">
          <p className="text-[11px] text-slate-500">{d.brand || "-"}</p>
          <p className="font-bold text-slate-100 leading-tight line-clamp-2">{d.productName}</p>
        </div>
        <span className={`shrink-0 inline-grid place-items-center h-7 w-7 rounded-lg text-xs font-black ${GRADE_STYLE[d.grade]}`} title="판매 안정성 등급">{d.grade}</span>
      </div>

      <div className="flex items-center gap-1 mt-2">
        {[1, 2, 3, 4, 5].map(n => (
          <Star key={n} className={`h-3.5 w-3.5 ${n <= d.stars ? "fill-amber-300 text-amber-300" : "text-slate-700"}`} />
        ))}
        <span className="text-[10px] text-slate-500 ml-1">{SOURCE_LABEL[d.source] ?? d.source}</span>
      </div>

      <div className="mt-3 space-y-1.5 text-sm">
        <Row label="국내 특가" value={won(d.domesticBuyKrw)} />
        <Row label="POIZON 안정 판매가" value={<>{won(d.revenueKrw)}</>} />
        <Row label="예상 수수료·배송비" value={<span className="text-slate-400">−{won(d.deductKrw)}</span>} />
        <div className="border-t border-white/10 my-1.5" />
        <Row label="예상 순이익" value={<b className={d.netProfitKrw >= 0 ? "text-emerald-300" : "text-red-400"}>{won(d.netProfitKrw)}</b>} big />
        <Row label="마진율" value={<b className={d.marginPct >= 30 ? "text-emerald-300" : "text-amber-300"}>{d.marginPct.toFixed(1)}%</b>} />
      </div>

      <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between">
        <div className="text-[11px] text-slate-500">
          거래량 {d.volume30} · 변동 {d.volatilityPct.toFixed(0)}%
          {!d.hasObservations && <span className="text-amber-400/80"> · 수동 시세</span>}
        </div>
        {rec ? (
          <span className="inline-flex items-center gap-1 text-sm font-bold text-fuchsia-200 bg-fuchsia-500/15 rounded-lg px-2.5 py-1">
            <TrendingUp className="h-3.5 w-3.5" /> {d.recommendQty}개 추천
          </span>
        ) : (
          <span className="text-xs text-slate-500 bg-white/5 rounded-lg px-2.5 py-1">매입 보류</span>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, big }: { label: string; value: React.ReactNode; big?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-400 text-[13px]">{label}</span>
      <span className={big ? "text-lg" : ""}>{value}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] text-slate-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

function CostIn({ label, v, on, step }: { label: string; v: number; on: (v: number) => void; step?: number }) {
  return (
    <label className="block">
      <span className="block text-[10px] text-slate-500 mb-0.5">{label}</span>
      <input type="number" step={step ?? 1} value={v} onChange={e => on(Number(e.target.value) || 0)} className="calc-in !py-1.5" />
    </label>
  );
}

function EmptyState() {
  return (
    <div className="glass rounded-2xl p-8 text-center">
      <Info className="h-8 w-8 text-slate-500 mx-auto mb-3" />
      <p className="text-slate-300 font-medium">아직 추천할 딜이 충분하지 않아요</p>
      <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
        <b className="text-slate-300">오늘의 SKU</b>에 상품(국내가+POIZON 시세)을 넣거나,
        확장 프로그램으로 국내몰·POIZON 페이지를 <b className="text-slate-300">보기만 해도</b> 시세가 쌓이며
        여기 자동으로 추천이 뜹니다. (패시브 수집)
      </p>
    </div>
  );
}
