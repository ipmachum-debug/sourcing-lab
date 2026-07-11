import { trpc } from "@/lib/trpc";
import { FileSearch } from "lucide-react";

/**
 * 시세/권장 원본 필드 확인 — batchPrice(Listing Recommendations) 응답의 모든 키를 노출.
 * "운영 제안(예상판매량·점유율)이 오픈 API에 있는지" 판별용 진단.
 */
export default function RecommendRaw({ ready }: { ready: boolean }) {
  const q = trpc.reverseDeals.poizonRecommendRaw.useQuery(undefined, { enabled: false });
  const d = q.data as any;

  return (
    <div className="glass rounded-2xl p-5 ring-1 ring-cyan-400/20">
      <div className="flex items-center gap-2 mb-2">
        <FileSearch className="h-4 w-4 text-cyan-300" />
        <h2 className="text-sm font-semibold text-slate-100">시세 응답 원본 필드 확인</h2>
        <button
          onClick={() => q.refetch()}
          disabled={!ready || q.isFetching}
          className="ml-auto text-[11px] font-semibold text-cyan-300 hover:text-cyan-200 disabled:opacity-40"
        >
          {q.isFetching ? "조회 중…" : "내 SKU로 조회"}
        </button>
      </div>
      <p className="text-[12px] text-slate-400 mb-3">
        내 리스팅 skuId로 batchPrice를 호출해 POIZON이 주는 모든 필드를 확인합니다. 예상판매량·점유율
        필드가 있으면 운영 제안을 앱에 넣을 수 있습니다.
      </p>
      {d && (
        <div className="space-y-2">
          {d.note && <p className="text-[12px] text-amber-300">{d.note}</p>}
          {d.keys?.length > 0 && (
            <>
              <p className="text-[12px] text-slate-300">
                SKU {d.skuIds?.length}개 · 응답 {d.count}건 · 필드 {d.keys.length}개:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {d.keys.map((k: string) => (
                  <span key={k} className="text-[11px] px-2 py-0.5 rounded bg-white/5 text-cyan-200">{k}</span>
                ))}
              </div>
              <pre className="text-[10px] text-slate-400 bg-black/30 rounded-lg p-2 overflow-x-auto max-h-48">
                {JSON.stringify(d.sample, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
