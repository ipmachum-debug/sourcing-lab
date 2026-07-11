import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { PackagePlus, AlertTriangle } from "lucide-react";

/**
 * 직접 입찰 등록 (Manual Listing/Direct) — skuId + 판매가 + 수량으로 POIZON에 리스팅 생성.
 * ★실제 주문(돈)이 생성됨 → window.confirm 재확인 + 서버 confirm 게이트.
 */
export default function ListingCreate({ ready }: { ready: boolean }) {
  const create = trpc.reverseDeals.poizonCreateListing.useMutation();
  const [f, setF] = useState({ skuId: "", price: "", quantity: "1", currency: "USD", countryCode: "US" });
  const [lastNo, setLastNo] = useState<string | null>(null);

  const submit = async () => {
    const skuId = f.skuId.trim();
    const price = Number(f.price);
    const quantity = Number(f.quantity);
    if (!skuId) return toast.error("skuId를 입력하세요.");
    if (!(price > 0)) return toast.error("판매가를 입력하세요.");
    if (!(quantity > 0)) return toast.error("수량을 입력하세요.");
    // 최소단위 환산: USD 등은 센트(×100), KRW는 원 그대로.
    const minor = f.currency !== "KRW" ? Math.round(price * 100) : Math.round(price);
    const unit = f.currency === "KRW" ? "₩" : "$";
    if (
      !window.confirm(
        `⚠️ POIZON에 실제 리스팅을 등록합니다.\nSKU ${skuId}\n판매가 ${unit}${price.toLocaleString()} · 수량 ${quantity}\n방어선(손익분기) 이상인지 확인하셨나요? 진행할까요?`
      )
    )
      return;
    try {
      const res = await create.mutateAsync({
        skuId,
        price: minor,
        quantity,
        currency: f.currency,
        countryCode: f.countryCode,
        confirm: true,
      });
      if (res.ok) {
        setLastNo(res.sellerBiddingNo);
        toast.success(`등록 요청 완료 — 입찰번호 ${res.sellerBiddingNo}`);
      } else {
        toast.error("등록 응답에 입찰번호가 없습니다. POIZON에서 확인하세요.");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "리스팅 등록 실패");
    }
  };

  return (
    <div className="glass rounded-2xl p-5 ring-1 ring-fuchsia-400/25">
      <div className="flex items-center gap-2 mb-1">
        <PackagePlus className="h-4 w-4 text-fuchsia-300" />
        <h2 className="text-sm font-semibold text-slate-100">직접 입찰 등록 (실주문)</h2>
        <span className="text-[11px] text-slate-500">skuId + 판매가 + 수량 → POIZON 리스팅 생성</span>
      </div>
      <div className="rounded-lg bg-amber-500/10 border border-amber-400/20 px-3 py-1.5 text-[11px] text-amber-200 inline-flex items-center gap-1.5 mb-3">
        <AlertTriangle className="h-3.5 w-3.5" /> 실제 리스팅이 생성됩니다. 반드시 방어선(손익분기) 이상 가격으로.
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <input value={f.skuId} onChange={e => setF({ ...f, skuId: e.target.value })} placeholder="skuId *"
          className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-fuchsia-400/50" />
        <input type="number" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} placeholder={`판매가 (${f.currency})`}
          className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-fuchsia-400/50" />
        <select value={f.currency} onChange={e => setF({ ...f, currency: e.target.value })}
          className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-sm text-white outline-none focus:border-fuchsia-400/50">
          {["USD", "KRW", "CNY", "HKD", "JPY", "SGD", "EUR"].map(c => <option key={c} value={c} className="bg-[#0a0b1e]">{c}</option>)}
        </select>
        <input type="number" value={f.quantity} onChange={e => setF({ ...f, quantity: e.target.value })} placeholder="수량"
          className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-fuchsia-400/50" />
        <input value={f.countryCode} onChange={e => setF({ ...f, countryCode: e.target.value })} placeholder="판매지역(US)"
          className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-fuchsia-400/50" />
      </div>
      <div className="flex items-center gap-3 mt-3">
        <button onClick={submit} disabled={!ready || create.isPending}
          className="neon-btn rounded-lg px-4 py-2 text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-40">
          <PackagePlus className="h-4 w-4" /> {create.isPending ? "등록 중…" : "리스팅 등록"}
        </button>
        {lastNo && <span className="text-[12px] text-emerald-300">✅ 최근 등록 입찰번호 {lastNo}</span>}
      </div>
      <p className="text-[11px] text-slate-500 mt-2">
        판매가는 표시 통화 단위로 입력(예: $31.00). 서버가 최소단위로 환산해 전송합니다.
        {" "}쓰기 인터페이스가 콘솔에서 <b className="text-slate-400">테스트 미통과(测试未通过)</b>면 권한 거부될 수 있습니다.
      </p>
    </div>
  );
}
