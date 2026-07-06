import { useMemo, useState } from "react";
import { Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Camera, Plus, Trash2, LineChart } from "lucide-react";
import ImportExportBar from "@/components/ImportExportBar";
import type { FieldSpec } from "@/lib/csv";

const SKU_SPECS: FieldSpec[] = [
  { key: "brand", alias: /^(브랜드|brand)/ },
  { key: "productName", alias: /(상품명|상품|productname|name|모델)/ },
  { key: "domesticPrice", alias: /(국내|매입가|특가|domesticprice)/, type: "number" },
  { key: "poizonCny", alias: /(poizon|시세|위안|cny|판매가)/, type: "number" },
  { key: "rate", alias: /(환율|rate)/, type: "number" },
  { key: "feePct", alias: /(수수료|fee)/, type: "number" },
];

interface Sku {
  id: number; brand: string | null; productName: string; sku: string | null; category: string | null;
  domesticPrice: number | null; poizonCny: number | null; rate: number | null; feePct: number | null;
}

const won = (n: number) => `${Math.round(n || 0).toLocaleString("ko-KR")}원`;

function spreadOf(s: Sku) {
  // POIZON 시세는 중국시장 $ → 환율(원/$)로 매출 환산
  const poizonKRW = Math.round((s.poizonCny || 0) * (s.rate || 1350));
  const net = Math.round(poizonKRW * (1 - (s.feePct || 9) / 100) - (s.domesticPrice || 0));
  const marginRate = poizonKRW > 0 ? (net / poizonKRW) * 100 : 0;
  return { poizonKRW, net, marginRate };
}
function grade(net: number, mr: number): string {
  if (net >= 40000 && mr >= 25) return "S";
  if (net >= 20000 && mr >= 15) return "A";
  if (net > 0) return "B";
  return "C";
}
const GRADE_STYLE: Record<string, string> = {
  S: "bg-amber-400 text-amber-950", A: "bg-emerald-400 text-emerald-950", B: "bg-cyan-400 text-cyan-950", C: "bg-slate-500/50 text-slate-200",
};

export default function ReverseSku() {
  const utils = trpc.useUtils();
  const q = trpc.reversePurchase.skuList.useQuery();
  const skus = (q.data ?? []) as Sku[];
  const inv = () => utils.reversePurchase.skuList.invalidate();
  const createMut = trpc.reversePurchase.skuCreate.useMutation({ onSuccess: () => { toast.success("SKU 추가"); inv(); }, onError: e => toast.error(e.message) });
  const removeMut = trpc.reversePurchase.skuRemove.useMutation({ onSuccess: inv });
  const bulkMut = trpc.reversePurchase.skuBulkCreate.useMutation({ onSuccess: r => { toast.success(`${r.count}건 업로드`); inv(); }, onError: e => toast.error(e.message) });

  const [f, setF] = useState({ brand: "", productName: "", domesticPrice: "", poizonCny: "", rate: "1350", feePct: "9" });
  const lookupPool = async () => {
    if (!f.productName.trim()) return toast.error("상품명을 먼저 입력하세요");
    const res = (await utils.reversePurchase.poizonLookup.fetch({ query: f.productName })) as any[];
    if (res && res.length) {
      const hit = res[0];
      setF(p => ({ ...p, poizonCny: String(hit.priceCny || 0), brand: p.brand || (hit.brand ?? "") }));
      toast.success(`공유 풀 시세 $${(hit.priceCny || 0).toLocaleString("en-US")} (관측 ${hit.observeCount || 1}회)`);
    } else {
      toast.info("공유 풀에 아직 없어요. 직접 넣으면 다른 유저와 공유됩니다.");
    }
  };
  const submit = () => {
    if (!f.productName.trim()) return toast.error("상품명 입력");
    createMut.mutate({
      brand: f.brand || undefined, productName: f.productName,
      domesticPrice: Number(f.domesticPrice) || 0, poizonCny: Number(f.poizonCny) || 0,
      rate: Number(f.rate) || 1350, feePct: Number(f.feePct) || 9,
    });
    setF({ brand: "", productName: "", domesticPrice: "", poizonCny: "", rate: "1350", feePct: "9" });
  };

  const ranked = useMemo(() =>
    skus.map(s => ({ s, ...spreadOf(s) })).sort((a, b) => b.net - a.net),
  [skus]);

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest neon-chip neon-magenta px-3 py-1 rounded-full uppercase">
                <Camera className="h-3.5 w-3.5" /> Today's SKU
              </span>
              <h1 className="text-3xl font-black mt-4 neon-text">오늘의 SKU TOP100</h1>
              <p className="text-slate-300/80 mt-2">아비트리지 후보를 워치리스트에 넣으면 <b className="text-white">스프레드 순으로 랭킹</b>. 오늘 살 것만 위에서 봅니다.</p>
              <p className="text-[11px] text-amber-300/80 mt-1">ⓘ 엑셀로 한 번에 올리거나, 확장이 본 시세를 자동으로 채웁니다</p>
            </div>
            <ImportExportBar
              filename="오늘의SKU"
              importSpecs={SKU_SPECS}
              requiredKey="productName"
              importing={bulkMut.isPending}
              templateHeaders={["브랜드", "상품명", "국내매입가", "POIZON시세($)", "환율(원/$)", "수수료"]}
              templateExample={[["크록스", "크록스 클래식 클로그 블랙", 34900, 45, 1350, 9]]}
              onImport={rows =>
                bulkMut.mutate({
                  rows: rows.map(r => ({
                    brand: r.brand || undefined,
                    productName: r.productName,
                    domesticPrice: r.domesticPrice || 0,
                    poizonCny: r.poizonCny || 0,
                    rate: r.rate > 0 ? r.rate : undefined,
                    feePct: r.feePct > 0 ? r.feePct : undefined,
                  })),
                })
              }
              onExport={() => ({
                headers: ["브랜드", "상품명", "국내가", "POIZON($)", "환율(원/$)", "매출(원)", "순익(원)", "마진율(%)"],
                rows: ranked.map(r => [
                  r.s.brand || "", r.s.productName, r.s.domesticPrice || 0, r.s.poizonCny || 0,
                  r.s.rate || 1350, r.poizonKRW, r.net, r.marginRate.toFixed(1),
                ]),
              })}
            />
          </div>

          {/* 등록 */}
          <div className="glass rounded-2xl p-4">
            <div className="grid sm:grid-cols-6 gap-2">
              <In placeholder="브랜드" value={f.brand} onChange={v => setF({ ...f, brand: v })} />
              <In placeholder="상품명 *" value={f.productName} onChange={v => setF({ ...f, productName: v })} span2 />
              <In placeholder="국내가(원)" value={f.domesticPrice} onChange={v => setF({ ...f, domesticPrice: v })} type="number" />
              <In placeholder="POIZON($)" value={f.poizonCny} onChange={v => setF({ ...f, poizonCny: v })} type="number" />
              <In placeholder="환율" value={f.rate} onChange={v => setF({ ...f, rate: v })} type="number" />
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <button onClick={lookupPool} className="neon-chip rounded-lg px-3 py-2 text-sm text-slate-200 flex items-center gap-1.5">
                🔍 공유 풀에서 시세 찾기
              </button>
              <button onClick={submit} disabled={createMut.isPending} className="neon-btn rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5">
                <Plus className="h-4 w-4" /> SKU 추가
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">💡 POIZON 시세는 <b className="text-slate-400">공유 풀</b>에서 자동으로 찾거나, 직접 넣으면 다른 유저에게도 공유돼요 (패시브 수집).</p>
          </div>

          {/* 랭킹 */}
          <div className="glass rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead className="bg-white/5 text-xs text-slate-400">
                  <tr>
                    <th className="text-left font-medium px-3 py-2.5 w-10">#</th>
                    <th className="text-left font-medium px-3 py-2.5">상품 / 브랜드</th>
                    <th className="text-right font-medium px-3 py-2.5">국내가</th>
                    <th className="text-right font-medium px-3 py-2.5">POIZON</th>
                    <th className="text-right font-medium px-3 py-2.5">스프레드</th>
                    <th className="text-center font-medium px-3 py-2.5">마진율</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {ranked.length === 0 && <tr><td colSpan={7} className="text-center text-slate-500 py-10">워치할 SKU를 위에서 추가하세요.</td></tr>}
                  {ranked.map((r, i) => {
                    const g = grade(r.net, r.marginRate);
                    return (
                      <tr key={r.s.id} className="border-t border-white/8">
                        <td className="px-3 py-2.5">
                          <span className={`inline-grid place-items-center h-6 w-6 rounded-md text-[11px] font-bold ${GRADE_STYLE[g]}`}>{g}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <Link href={`/reverse/sku/${r.s.id}`} className="group inline-flex items-center gap-1.5">
                            <span className="font-medium text-slate-100 truncate max-w-[220px] group-hover:text-fuchsia-300 transition-colors">{r.s.productName}</span>
                            <LineChart className="h-3.5 w-3.5 text-slate-600 group-hover:text-fuchsia-300" />
                          </Link>
                          <p className="text-[11px] text-slate-500">{r.s.brand || "-"}</p>
                        </td>
                        <td className="text-right px-3 py-2.5 text-slate-300">{won(r.s.domesticPrice || 0)}</td>
                        <td className="text-right px-3 py-2.5 text-slate-300">{won(r.poizonKRW)}</td>
                        <td className={`text-right px-3 py-2.5 font-bold ${r.net >= 0 ? "text-emerald-300" : "text-red-400"}`}>{won(r.net)}</td>
                        <td className="text-center px-3 py-2.5">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${r.marginRate >= 20 ? "bg-emerald-400/15 text-emerald-300" : r.marginRate > 0 ? "bg-amber-400/15 text-amber-300" : "bg-red-500/15 text-red-300"}`}>
                            {r.marginRate.toFixed(0)}%
                          </span>
                        </td>
                        <td className="text-right px-3 py-2.5">
                          <button onClick={() => removeMut.mutate({ id: r.s.id })} className="text-slate-500 hover:text-red-400 transition-colors"><Trash2 className="h-4 w-4" /></button>
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

function In({ placeholder, value, onChange, type, span2 }: { placeholder: string; value: string; onChange: (v: string) => void; type?: string; span2?: boolean }) {
  return (
    <input type={type || "text"} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}
      className={`rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-fuchsia-400/60 ${span2 ? "sm:col-span-2" : ""}`} />
  );
}
