import { useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Scale, TriangleAlert, Search, Check } from "lucide-react";

// 역직구 아비트리지 순익 계산 — 국내매입 → POIZON 판매 기준.
const DEFAULT_FEE = 6;      // POIZON 셀러 수수료: 판매 5% + 결제 1%
const DEFAULT_RATE = 1350;  // POIZON 판매 시장=중국(득물) → 시세 $, 환율(원/$)로 환산

function calc(i: {
  buyKRW: number; poizonCNY: number; rate: number; feePct: number;
  intlShip: number; rejectPct: number; roundtripShip: number; vatRefund: boolean;
}) {
  const poizonKRW = Math.round(i.poizonCNY * i.rate);
  const fee = Math.round(poizonKRW * i.feePct / 100);
  const vat = i.vatRefund ? Math.round(i.buyKRW * 10 / 110) : 0; // 매입가 포함 부가세 환급
  const gross = poizonKRW - fee - i.buyKRW - i.intlShip + vat;   // 검수 통과 시 순익
  const p = Math.min(1, Math.max(0, i.rejectPct / 100));
  const expected = Math.round(gross * (1 - p) - i.roundtripShip * p); // 검수 리스크 반영 기대순익
  const marginRate = poizonKRW > 0 ? (gross / poizonKRW) * 100 : 0;
  return { poizonKRW, fee, vat, gross, expected, marginRate };
}

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

export default function ReverseArbitrage() {
  const [buyKRW, setBuyKRW] = useState(45000);
  const [poizonCNY, setPoizonCNY] = useState(345);
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [feePct, setFeePct] = useState(DEFAULT_FEE);
  const [intlShip, setIntlShip] = useState(3000);
  const [rejectPct, setRejectPct] = useState(8);
  const [roundtripShip, setRoundtripShip] = useState(12000);
  const [vatRefund, setVatRefund] = useState(true);

  // 카탈로그(판매자 엑셀)에서 안정가($) 불러오기
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const lookup = trpc.reverseDeals.catalogInsights.useQuery(
    { search: search || undefined, limit: 8 },
    { enabled: !!search }
  );
  const matches = (lookup.data?.models ?? []) as {
    normKey: string; productName: string; brand: string; soldCount: number; avgUsd: number;
  }[];

  const r = useMemo(
    () => calc({ buyKRW, poizonCNY, rate, feePct, intlShip, rejectPct, roundtripShip, vatRefund }),
    [buyKRW, poizonCNY, rate, feePct, intlShip, rejectPct, roundtripShip, vatRefund]
  );
  const good = r.expected >= 15000 && r.marginRate >= 20;
  const ok = r.expected > 0 && !good;

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10">
        <div className="max-w-4xl mx-auto space-y-6">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest neon-chip neon-magenta px-3 py-1 rounded-full uppercase">
              <Scale className="h-3.5 w-3.5" /> Arbitrage
            </span>
            <h1 className="text-3xl font-black mt-4 neon-text">정밀 수익 계산기</h1>
            <p className="text-slate-300/80 mt-2">국내 매입 → POIZON 판매, <b className="text-white">검수 탈락·부가세 환급까지</b> 반영한 진짜 순익. 카탈로그에서 안정가($)를 바로 불러오세요.</p>
          </div>

          {/* 카탈로그에서 안정가 불러오기 */}
          <div className="glass rounded-2xl p-4">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <input
                  value={term}
                  onChange={e => setTerm(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && setSearch(term.trim())}
                  placeholder="판매자 카탈로그에서 상품 검색 (예: 크록스)"
                  className="w-full rounded-lg border border-white/15 bg-white/5 pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-fuchsia-400/60"
                />
              </div>
              <button onClick={() => setSearch(term.trim())} className="neon-btn rounded-lg px-4 py-2.5 text-sm font-semibold">검색</button>
            </div>
            {search && matches.length > 0 && (
              <div className="mt-2 space-y-1 max-h-56 overflow-y-auto">
                {matches.map(m => (
                  <button
                    key={m.normKey}
                    onClick={() => { setPoizonCNY(m.avgUsd); setPicked(m.productName); }}
                    className="w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-white/8"
                  >
                    <span className="min-w-0">
                      <span className="text-slate-100 truncate block">{m.productName}</span>
                      <span className="text-[11px] text-slate-500">{m.brand || "-"} · 판매량 {m.soldCount.toLocaleString()}</span>
                    </span>
                    <span className="text-fuchsia-200 font-semibold shrink-0">${m.avgUsd.toLocaleString("en-US")}</span>
                  </button>
                ))}
              </div>
            )}
            {search && !lookup.isLoading && matches.length === 0 && (
              <p className="text-[12px] text-slate-500 mt-2">일치하는 상품이 없어요. 판매자 엑셀을 먼저 올리면 여기서 검색돼요.</p>
            )}
            {picked && (
              <p className="text-[12px] text-emerald-300 mt-2 flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5" /> <b>{picked}</b> 안정가(${poizonCNY}) 적용됨
              </p>
            )}
          </div>

          {/* 입력 */}
          <div className="glass rounded-2xl p-5 grid sm:grid-cols-2 gap-4">
            <Num label="국내 매입가 (원)" value={buyKRW} onChange={setBuyKRW} />
            <Num label="POIZON 안정 판매가 ($)" value={poizonCNY} onChange={setPoizonCNY} />
            <Num label="환율 (원/$)" value={rate} onChange={setRate} />
            <Num label="배송비 (원)" value={intlShip} onChange={setIntlShip} />
            <Slide label="POIZON 수수료" value={feePct} onChange={setFeePct} min={3} max={20} step={0.5} suffix="%" />
            <Slide label="검수 탈락률" value={rejectPct} onChange={setRejectPct} min={0} max={40} step={1} suffix="%" />
            <Num label="탈락 시 왕복배송 (원)" value={roundtripShip} onChange={setRoundtripShip} />
            <label className="flex items-center gap-2 mt-6 cursor-pointer">
              <input type="checkbox" checked={vatRefund} onChange={e => setVatRefund(e.target.checked)} className="accent-fuchsia-500 h-4 w-4" />
              <span className="text-sm text-slate-200">부가세 환급(수출 영세율) 반영 <span className="text-slate-500">+{won(r.vat)}</span></span>
            </label>
          </div>

          {/* 결과 */}
          <div className={`glass rounded-2xl p-6 text-center ${good ? "glass-active" : ""}`}>
            <p className="text-sm text-slate-400">검수 리스크 반영 기대순익 (개당)</p>
            <p className={`text-5xl font-black mt-2 ${r.expected > 0 ? "neon-text" : "text-red-400"}`}>{won(r.expected)}</p>
            <div className="inline-flex items-center gap-2 mt-3">
              <span className={`text-sm font-bold px-3 py-1 rounded-full ${good ? "bg-emerald-400 text-emerald-950" : ok ? "bg-amber-400 text-amber-950" : "bg-red-500 text-white"}`}>
                마진율 {r.marginRate.toFixed(1)}%
              </span>
              <span className="text-sm text-slate-400">{good ? "👍 좋아요" : ok ? "🤔 보통" : "⚠️ 위험"}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 text-left">
              <Break label="POIZON 원화" value={won(r.poizonKRW)} plus />
              <Break label="수수료" value={`−${won(r.fee)}`} />
              <Break label="검수 통과 시 순익" value={won(r.gross)} plus />
              <Break label="부가세 환급" value={`+${won(r.vat)}`} plus />
            </div>
          </div>

          {rejectPct >= 15 && (
            <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 flex items-start gap-2">
              <TriangleAlert className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-200">
                검수 탈락률 {rejectPct}%는 높은 편이에요. 브랜드·등급별 실제 탈락 데이터를 쌓으면 이 숫자가 진짜 순익을 좌우합니다.
              </div>
            </div>
          )}
          <p className="text-[11px] text-slate-500">ⓘ 참고용 추정치. POIZON 수수료·환율·검수기준은 시점/브랜드별로 다릅니다.</p>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Num({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="text-sm font-medium text-slate-200">{label}</label>
      <input type="number" min={0} value={value} onChange={e => onChange(Math.max(0, Number(e.target.value)))}
        className="mt-1.5 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-white outline-none focus:border-fuchsia-400/60 focus:bg-white/10 transition-colors" />
    </div>
  );
}

function Slide({ label, value, onChange, min, max, step, suffix }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; suffix: string }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-slate-200">{label}</label>
        <span className="text-sm font-bold text-white">{value}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))}
        className="w-full mt-2 cursor-pointer" style={{ accentColor: "#d946ef" }} />
    </div>
  );
}

function Break({ label, value, plus }: { label: string; value: string; plus?: boolean }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className={`text-sm font-semibold mt-0.5 ${plus ? "text-slate-200" : "text-slate-300"}`}>{value}</p>
    </div>
  );
}
