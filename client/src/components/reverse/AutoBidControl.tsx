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

const FOLLOW_TYPES: { value: 6 | 7 | 8; label: string; hint: string }[] = [
  { value: 8, label: "방어적 (한 단계 아래)", hint: "최저가보다 한 단계 낮게 — 방어선까지만" },
  { value: 7, label: "최저가 추종", hint: "중국 최저가를 그대로 따라감" },
  { value: 6, label: "기본", hint: "플랫폼 기본 추종" },
];

/**
 * 자동입찰(자동추종) 관제 — 내 POIZON 리스팅에 방어선(lowestPrice)을 두고
 * 자동추종을 켜고/끈다. 모든 쓰기 동작은 window.confirm으로 재확인.
 */
export default function AutoBidControl({ ready }: { ready: boolean }) {
  const listings = trpc.reverseDeals.poizonListings.useQuery(
    {},
    { enabled: ready, refetchOnWindowFocus: false }
  );
  const start = trpc.reverseDeals.poizonAutoFollowStart.useMutation();
  const stop = trpc.reverseDeals.poizonAutoFollowStop.useMutation();
  const cancel = trpc.reverseDeals.poizonCancelListing.useMutation();

  const [open, setOpen] = useState<string | null>(null);
  const [floor, setFloor] = useState<Record<string, string>>({});
  const [ftype, setFtype] = useState<Record<string, 6 | 7 | 8>>({});

  const data = listings.data as
    | { ready: boolean; items: Listing[]; note: string }
    | undefined;
  const items = data?.items ?? [];
  const busy = start.isPending || stop.isPending || cancel.isPending;

  const refetch = () => listings.refetch();

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
          <button
            onClick={refetch}
            disabled={listings.isFetching}
            className="ml-auto text-[11px] text-slate-400 hover:text-emerald-300 inline-flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${listings.isFetching ? "animate-spin" : ""}`} />
            새로고침
          </button>
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
                    </p>
                  </div>
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
