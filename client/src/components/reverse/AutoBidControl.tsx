import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Radar,
  Shield,
  ShieldOff,
  Ban,
  RefreshCw,
  AlertTriangle,
  ChevronDown,
  Calculator,
  Activity,
} from "lucide-react";

interface Listing {
  sellerBiddingNo: string | null;
  spuId: string | number | null;
  skuId: string | number | null;
  merchantSkuId: string | null;
  price: number | null;
  currency: string | null;
  quantity: number | null;
  autoFollow: boolean;
}

interface ScanResult {
  marketLow: number | null;
  band: "room" | "compete" | "limit" | "na";
  recommend: string;
}

const FOLLOW_TYPES: { value: 6 | 7 | 8; label: string; hint: string }[] = [
  { value: 8, label: "방어적 (한 단계 아래)", hint: "최저가보다 한 단계 낮게 — 방어선까지만" },
  { value: 7, label: "최저가 추종", hint: "중국 최저가를 그대로 따라감" },
  { value: 6, label: "기본", hint: "플랫폼 기본 추종" },
];

const CATS = ["운동화", "신발", "의류", "가방", "액세서리", "장난감", "뷰티"];

const BAND_STYLE: Record<ScanResult["band"], { label: string; cls: string }> = {
  room: { label: "🟢 여유", cls: "text-emerald-300 bg-emerald-500/10" },
  compete: { label: "🟡 경쟁", cls: "text-amber-300 bg-amber-500/10" },
  limit: { label: "🔴 한계", cls: "text-red-300 bg-red-500/10" },
  na: { label: "시세 미확인", cls: "text-slate-400 bg-white/5" },
};

/**
 * 자동입찰(자동추종) 관제 — 내 POIZON 리스팅에 방어선(lowestPrice)을 두고
 * 자동추종을 켜고/끈다. 모든 쓰기 동작은 window.confirm으로 재확인.
 */
export default function AutoBidControl({ ready }: { ready: boolean }) {
  const utils = trpc.useUtils();
  const listings = trpc.reverseDeals.poizonListings.useQuery(
    {},
    { enabled: ready, refetchOnWindowFocus: false }
  );
  const start = trpc.reverseDeals.poizonAutoFollowStart.useMutation();
  const stop = trpc.reverseDeals.poizonAutoFollowStop.useMutation();
  const cancel = trpc.reverseDeals.poizonCancelListing.useMutation();
  const bandScan = trpc.reverseDeals.poizonBandScan.useMutation();

  const [open, setOpen] = useState<string | null>(null);
  const [floor, setFloor] = useState<Record<string, string>>({});
  const [ftype, setFtype] = useState<Record<string, 6 | 7 | 8>>({});
  // ① 방어선 계산기 입력: 국내 매입가(₩)·카테고리, 계산된 목표가($)
  const [buy, setBuy] = useState<Record<string, string>>({});
  const [cat, setCat] = useState<Record<string, string>>({});
  const [target, setTarget] = useState<Record<string, number>>({});
  const [calcing, setCalcing] = useState<string | null>(null);
  // ② 밴드 스캔 결과 (skuId → 판정)
  const [scan, setScan] = useState<Record<string, ScanResult>>({});

  const data = listings.data as
    | { ready: boolean; items: Listing[]; note: string }
    | undefined;
  const items = data?.items ?? [];
  const busy = start.isPending || stop.isPending || cancel.isPending;

  const refetch = () => listings.refetch();

  // ① 국내 매입가 → 손익분기 방어선($) 계산 후 방어선 필드 자동 채움
  const calcDefense = async (no: string) => {
    const buyKrw = Number(buy[no]);
    if (!(buyKrw > 0)) {
      toast.error("국내 매입가(₩)를 입력하세요.");
      return;
    }
    setCalcing(no);
    try {
      const res = await utils.reverseDeals.poizonDefenseLine.fetch({
        buyKrw,
        category: cat[no] || undefined,
      });
      setFloor(f => ({ ...f, [no]: String(res.floorUsd) }));
      setTarget(t => ({ ...t, [no]: res.targetUsd }));
      toast.success(`손익분기 $${res.floorUsd} · 목표가 $${res.targetUsd} (방어선 적용됨)`);
    } catch (e: any) {
      toast.error(e?.message ?? "방어선 계산 실패");
    } finally {
      setCalcing(null);
    }
  };

  // ② 방어선이 설정된 리스팅들의 시세를 조회해 밴드 판정
  const runBandScan = async () => {
    const scanItems = items
      .filter(x => x.skuId != null && Number(floor[x.sellerBiddingNo ?? ""]) > 0)
      .map(x => ({
        skuId: x.skuId as string | number,
        floorUsd: Number(floor[x.sellerBiddingNo ?? ""]),
        targetUsd: target[x.sellerBiddingNo ?? ""] || undefined,
      }))
      .slice(0, 20);
    if (scanItems.length === 0) {
      toast.error("먼저 리스팅에 방어선을 설정하세요(계산기 또는 직접 입력).");
      return;
    }
    try {
      const res = await bandScan.mutateAsync({ items: scanItems });
      const next: Record<string, ScanResult> = {};
      for (const r of res.results) {
        next[String(r.skuId)] = { marketLow: r.marketLow, band: r.band, recommend: r.recommend };
      }
      setScan(next);
      const limit = res.results.filter(r => r.band === "limit").length;
      const room = res.results.filter(r => r.band === "room").length;
      toast.success(`밴드 스캔 완료 — 🔴 한계 ${limit} · 🟢 여유 ${room}`);
    } catch (e: any) {
      toast.error(e?.message ?? "밴드 스캔 실패");
    }
  };

  const onStart = async (row: Listing) => {
    const no = row.sellerBiddingNo;
    if (!no) return;
    const raw = floor[no];
    const lowestPrice = Number(raw);
    if (!(lowestPrice > 0)) {
      toast.error("방어선(하한가)을 0보다 크게 입력하세요.");
      return;
    }
    if (
      !window.confirm(
        `자동추종을 시작합니다.\n리스팅 ${no}\n방어선 ${lowestPrice.toLocaleString()} ${row.currency ?? "USD"}\n이 아래로는 추격하지 않습니다. 진행할까요?`
      )
    )
      return;
    try {
      const res = await start.mutateAsync({
        biddingNo: no,
        lowestPrice,
        followType: ftype[no] ?? 8,
        currency: row.currency ?? "USD",
        confirm: true,
      });
      if (res.ok) {
        toast.success("자동추종 시작됨 — 방어선 이하 추격 금지");
        refetch();
      } else {
        toast.error("자동추종 응답이 실패로 반환됨");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "자동추종 시작 실패");
    }
  };

  const onStop = async (row: Listing) => {
    const no = row.sellerBiddingNo;
    if (!no) return;
    if (!window.confirm(`자동추종을 중지합니다.\n리스팅 ${no}\n진행할까요?`)) return;
    try {
      const res = await stop.mutateAsync({
        biddingNo: no,
        currency: row.currency ?? "USD",
        confirm: true,
      });
      if (res.ok) {
        toast.success("자동추종 중지됨");
        refetch();
      } else {
        toast.error("중지 응답이 실패로 반환됨");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "자동추종 중지 실패");
    }
  };

  const onCancel = async (row: Listing) => {
    const no = row.sellerBiddingNo;
    if (!no) return;
    if (
      !window.confirm(
        `⚠️ 리스팅을 취소(삭제)합니다.\n${no}\n되돌릴 수 없습니다. 진행할까요?`
      )
    )
      return;
    try {
      const res = await cancel.mutateAsync({ sellerBiddingNo: no, confirm: true });
      if (res.ok) {
        toast.success("리스팅 취소됨");
        refetch();
      } else {
        toast.error("취소 응답이 실패로 반환됨");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "리스팅 취소 실패");
    }
  };

  return (
    <div className="glass rounded-2xl p-5 ring-1 ring-emerald-400/25">
      <div className="flex items-center gap-2 mb-2">
        <span
          className="h-6 w-6 rounded-full grid place-items-center text-xs font-black text-white"
          style={{ background: "linear-gradient(135deg,#059669,#22d3ee)" }}
        >
          2
        </span>
        <h2 className="text-sm font-semibold text-slate-100 inline-flex items-center gap-1.5">
          <Radar className="h-4 w-4 text-emerald-300" /> 자동입찰 관제 (자동추종)
        </h2>
        {ready && (
          <div className="ml-auto flex items-center gap-3">
            {items.length > 0 && (
              <button
                onClick={runBandScan}
                disabled={bandScan.isPending}
                className="text-[11px] font-semibold text-cyan-300 hover:text-cyan-200 inline-flex items-center gap-1 disabled:opacity-50"
              >
                <Activity className={`h-3.5 w-3.5 ${bandScan.isPending ? "animate-pulse" : ""}`} />
                밴드 스캔
              </button>
            )}
            <button
              onClick={refetch}
              disabled={listings.isFetching}
              className="text-[11px] text-slate-400 hover:text-emerald-300 inline-flex items-center gap-1 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${listings.isFetching ? "animate-spin" : ""}`} />
              새로고침
            </button>
          </div>
        )}
      </div>
      <p className="text-[12px] text-slate-400 mb-3">
        내 POIZON 리스팅에 <b className="text-emerald-300">방어선(하한가)</b>을 설정하면, 시세가 내려가도
        방어선 이하로는 자동 추격하지 않습니다. 방어선은 매입원가·수수료 기준 손익분기 이상으로 두세요.
      </p>

      {!ready ? (
        <div className="rounded-lg bg-amber-500/10 border border-amber-400/20 px-3 py-2 text-[12px] text-amber-200 inline-flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> 자격증명·자가진단 통과 후 활성화됩니다.
        </div>
      ) : listings.isLoading ? (
        <p className="text-[12px] text-slate-500">리스팅 불러오는 중…</p>
      ) : data?.note ? (
        <p className="text-[12px] text-amber-300">{data.note}</p>
      ) : items.length === 0 ? (
        <p className="text-[12px] text-slate-500">
          활성 리스팅이 없습니다. POIZON에 상품을 등록(입찰)하면 여기서 자동추종을 관리할 수 있습니다.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((row, i) => {
            const no = row.sellerBiddingNo ?? `row-${i}`;
            const isOpen = open === no;
            const sc = row.skuId != null ? scan[String(row.skuId)] : undefined;
            return (
              <li key={no} className="rounded-lg bg-white/5 overflow-hidden">
                <button
                  onClick={() => setOpen(isOpen ? null : no)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-slate-100 truncate">
                      SKU {String(row.skuId ?? "—")}
                      <span className="text-slate-500"> · SPU {String(row.spuId ?? "—")}</span>
                    </p>
                    <p className="text-[11px] text-slate-500">
                      현재가 {row.price != null ? row.price.toLocaleString() : "—"} {row.currency ?? ""}
                      {row.quantity != null ? ` · 수량 ${row.quantity}` : ""}
                      {sc?.marketLow != null ? ` · 시세 $${sc.marketLow.toLocaleString()}` : ""}
                    </p>
                  </div>
                  {sc && (
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${BAND_STYLE[sc.band].cls}`}>
                      {BAND_STYLE[sc.band].label}
                    </span>
                  )}
                  {row.autoFollow ? (
                    <span className="text-[10px] font-semibold text-emerald-300 inline-flex items-center gap-1 shrink-0">
                      <Shield className="h-3.5 w-3.5" /> 자동추종 ON
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold text-slate-500 inline-flex items-center gap-1 shrink-0">
                      <ShieldOff className="h-3.5 w-3.5" /> OFF
                    </span>
                  )}
                  <ChevronDown className={`h-4 w-4 text-slate-500 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>

                {isOpen && (
                  <div className="border-t border-white/5 px-3 py-3 space-y-3">
                    {/* ① 방어선 계산기 — 국내 매입가 → 손익분기($) */}
                    <div className="rounded-lg bg-cyan-500/5 border border-cyan-400/15 p-2.5 space-y-2">
                      <p className="text-[11px] font-semibold text-cyan-300 inline-flex items-center gap-1">
                        <Calculator className="h-3.5 w-3.5" /> 방어선 계산기 (국내 매입가 → 손익분기)
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <input
                          type="number"
                          inputMode="numeric"
                          value={buy[no] ?? ""}
                          onChange={e => setBuy(b => ({ ...b, [no]: e.target.value }))}
                          placeholder="국내 매입가 ₩"
                          className="rounded-lg bg-black/30 border border-white/10 px-2.5 py-1.5 text-sm text-slate-100 focus:border-cyan-400/50 outline-none"
                        />
                        <select
                          value={cat[no] ?? ""}
                          onChange={e => setCat(c => ({ ...c, [no]: e.target.value }))}
                          className="rounded-lg bg-black/30 border border-white/10 px-2.5 py-1.5 text-sm text-slate-100 focus:border-cyan-400/50 outline-none"
                        >
                          <option value="">카테고리(선택)</option>
                          {CATS.map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => calcDefense(no)}
                          disabled={calcing === no}
                          className="rounded-lg px-3 py-1.5 text-[13px] font-semibold bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50"
                        >
                          {calcing === no ? "계산 중…" : "손익분기 계산 → 방어선"}
                        </button>
                      </div>
                      {target[no] != null && (
                        <p className="text-[10px] text-slate-400">
                          목표순익가(참고): <b className="text-emerald-300">${target[no].toLocaleString()}</b> · 방어선 이상~목표가 사이는 경쟁 구간
                        </p>
                      )}
                    </div>

                    {sc && (
                      <div className={`rounded-lg px-2.5 py-2 text-[12px] ${BAND_STYLE[sc.band].cls}`}>
                        {sc.recommend}
                        {sc.marketLow != null ? ` · 현재 시세 $${sc.marketLow.toLocaleString()}` : ""}
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <label className="block">
                        <span className="text-[11px] text-slate-400">방어선(하한가) · {row.currency ?? "USD"}</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          value={floor[no] ?? ""}
                          onChange={e => setFloor(f => ({ ...f, [no]: e.target.value }))}
                          placeholder="예: 손익분기 가격"
                          className="mt-1 w-full rounded-lg bg-black/30 border border-white/10 px-2.5 py-1.5 text-sm text-slate-100 focus:border-emerald-400/50 outline-none"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[11px] text-slate-400">추종 방식</span>
                        <select
                          value={ftype[no] ?? 8}
                          onChange={e => setFtype(f => ({ ...f, [no]: Number(e.target.value) as 6 | 7 | 8 }))}
                          className="mt-1 w-full rounded-lg bg-black/30 border border-white/10 px-2.5 py-1.5 text-sm text-slate-100 focus:border-emerald-400/50 outline-none"
                        >
                          {FOLLOW_TYPES.map(t => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <p className="text-[10px] text-slate-500">
                      {FOLLOW_TYPES.find(t => t.value === (ftype[no] ?? 8))?.hint}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => onStart(row)}
                        disabled={busy || !row.sellerBiddingNo}
                        className="neon-btn rounded-lg px-3 py-1.5 text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Shield className="h-3.5 w-3.5" /> 자동추종 시작
                      </button>
                      <button
                        onClick={() => onStop(row)}
                        disabled={busy || !row.sellerBiddingNo}
                        className="rounded-lg px-3 py-1.5 text-[13px] font-semibold inline-flex items-center gap-1.5 bg-white/5 text-slate-200 hover:bg-white/10 disabled:opacity-50"
                      >
                        <ShieldOff className="h-3.5 w-3.5" /> 중지
                      </button>
                      <button
                        onClick={() => onCancel(row)}
                        disabled={busy || !row.sellerBiddingNo}
                        className="rounded-lg px-3 py-1.5 text-[13px] font-semibold inline-flex items-center gap-1.5 bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                      >
                        <Ban className="h-3.5 w-3.5" /> 리스팅 취소
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
