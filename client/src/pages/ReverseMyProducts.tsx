import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { LineChart, Plus, Trash2, ShieldCheck, Bell, Save, Power, RefreshCw, Zap } from "lucide-react";
import ImportExportBar from "@/components/ImportExportBar";
import type { FieldSpec } from "@/lib/csv";
import Sparkline, { trendOf, TrendArrow } from "@/components/Sparkline";

const won = (n: number) => `${Math.round(n || 0).toLocaleString("ko-KR")}원`;
// POIZON 역직구(국내 매입 → POIZON 판매) 기준 라벨.
const PLATFORM_LABEL: Record<string, string> = { poizon: "POIZON 판매", domestic: "국내 매입", coupang: "쿠팡" };
const PLATFORM_ORDER = ["poizon", "domestic", "coupang"];

const MYP_SPECS: FieldSpec[] = [
  { key: "productName", alias: /(상품명|상품|productname|name|모델)/ },
  { key: "brand", alias: /^(브랜드|brand)/ },
  { key: "sku", alias: /(sku|품번|모델번호|skuid)/ },
  { key: "externalId", alias: /(상품id|externalid|spu|코드)/ },
  { key: "myPriceKrw", alias: /(국내매입가|매입가|원가|내판매가|판매가|내가격|price)/, type: "number" },
  { key: "targetStock", alias: /(목표재고|안전재고|재고기준|targetstock)/, type: "number" },
];

interface Prod {
  id: number; platform: string | null; productName: string; brand: string | null;
  sku: string | null; myPriceKrw: number | null; targetStock: number | null; active: boolean;
}
interface SeriesPt { d: string; revenue: number; units: number; stock: number; cny: number; comp: number }
interface DashItem {
  product: Prod;
  latest: { revenueKrw: number; unitsSold: number; stock: number; rankPos: number; poizonPriceCny: number; competitorLowKrw: number; capturedDate: string } | null;
  series: SeriesPt[];
  poizonDeltaPct: number; stockLow: boolean; undercut: boolean;
}

export default function ReverseMyProducts() {
  const utils = trpc.useUtils();
  const listQ = trpc.myProducts.list.useQuery();
  const dashQ = trpc.myProducts.dashboard.useQuery();
  const prods = (listQ.data ?? []) as Prod[];
  const dash = dashQ.data as { items: DashItem[]; alerts: { type: string; product: string; detail: string }[]; scanConfig: any } | undefined;
  const cfg = dash?.scanConfig;
  const activeN = prods.filter(p => p.active).length;

  const inv = () => { utils.myProducts.list.invalidate(); utils.myProducts.dashboard.invalidate(); };
  const createMut = trpc.myProducts.create.useMutation({ onSuccess: r => { toast.success(r.capped ? "등록(비활성 — 활성 상한 초과)" : "상품 등록"); inv(); }, onError: e => toast.error(e.message) });
  const updateMut = trpc.myProducts.update.useMutation({ onSuccess: inv, onError: e => toast.error(e.message) });
  const removeMut = trpc.myProducts.remove.useMutation({ onSuccess: () => { toast.success("삭제"); inv(); } });
  const bulkMut = trpc.myProducts.bulkCreate.useMutation({ onSuccess: r => { toast.success(`${r.count}건 업로드`); inv(); }, onError: e => toast.error(e.message) });
  const snapMut = trpc.myProducts.snapshotSubmit.useMutation({ onSuccess: () => { toast.success("오늘 기록 저장"); inv(); }, onError: e => toast.error(e.message) });
  // POIZON API 자동 동기화
  const syncStatus = trpc.myProducts.poizonSyncStatus.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const syncMut = trpc.myProducts.syncPoizon.useMutation({
    onSuccess: r => { toast.success(r.message); inv(); },
    onError: e => toast.error(e.message),
  });
  const apiReady = !!syncStatus.data?.ready;

  const [f, setF] = useState({ platform: "poizon", productName: "", brand: "", myPriceKrw: "", targetStock: "" });
  const add = () => {
    if (!f.productName.trim()) return toast.error("상품명을 입력하세요");
    createMut.mutate({
      platform: f.platform as any, productName: f.productName, brand: f.brand || undefined,
      myPriceKrw: Number(f.myPriceKrw) || 0, targetStock: Number(f.targetStock) || 0,
    });
    setF({ platform: "poizon", productName: "", brand: "", myPriceKrw: "", targetStock: "" });
  };

  // 오늘 기록 인라인 입력 (상품별)
  const [snap, setSnap] = useState<Record<number, { stock: string; cny: string; comp: string }>>({});
  const saveSnap = (id: number) => {
    const s = snap[id] || { stock: "", cny: "", comp: "" };
    snapMut.mutate({
      myProductId: id, source: "manual",
      stock: Number(s.stock) || 0, poizonPriceCny: Number(s.cny) || 0, competitorLowKrw: Number(s.comp) || 0,
    });
  };
  const itemOf = (id: number) => dash?.items.find(it => it.product.id === id);

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest neon-chip neon-magenta px-3 py-1 rounded-full uppercase">
                <LineChart className="h-3.5 w-3.5" /> My Products
              </span>
              <h1 className="text-3xl font-black mt-4 neon-text">내 상품 관리</h1>
              <p className="text-slate-300/80 mt-2">
                <b className="text-white">국내 매입 → POIZON 판매</b> SKU의 매입가·시세·재고를
                <b className="text-white"> 매일 1회</b> 확인해 추이를 쌓습니다.
                활성 <b className="text-fuchsia-300">{activeN}/{cfg?.maxActiveSkus ?? 50}</b>개
              </p>
            </div>
            <ImportExportBar
              filename="내상품"
              importSpecs={MYP_SPECS}
              requiredKey="productName"
              importing={bulkMut.isPending}
              templateHeaders={["상품명", "브랜드", "SKU", "상품ID", "국내 매입가", "목표재고"]}
              templateExample={[["크록스 클래식 클로그 블랙", "크록스", "10001-001", "", 39000, 5]]}
              onImport={rows => bulkMut.mutate({ rows: rows.map(r => ({
                productName: r.productName, brand: r.brand || undefined, sku: r.sku || undefined,
                externalId: r.externalId || undefined, myPriceKrw: r.myPriceKrw || 0, targetStock: r.targetStock || 0,
              })) })}
              onExport={() => ({
                headers: ["상품명", "브랜드", "구분", "국내매입가", "목표재고", "재고", "POIZON시세($)", "국내경쟁최저", "활성"],
                rows: prods.map(p => {
                  const it = itemOf(p.id);
                  return [p.productName, p.brand || "", PLATFORM_LABEL[p.platform || "poizon"], p.myPriceKrw || 0,
                    p.targetStock || 0, it?.latest?.stock ?? "", it?.latest?.poizonPriceCny ?? "", it?.latest?.competitorLowKrw ?? "", p.active ? "Y" : "N"];
                }),
              })}
            />
          </div>

          {/* 안전장치 배너 */}
          {cfg && (
            <div className="glass rounded-2xl p-4 border border-emerald-400/20">
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="h-4 w-4 text-emerald-300" />
                <p className="text-sm font-semibold text-emerald-200">밴 방지 안전장치 (코드로 강제)</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-slate-300">
                <Guard>SKU 최대 {cfg.maxActiveSkus}개</Guard>
                <Guard>하루 {cfg.frequencyPerDay}회만</Guard>
                <Guard>딜레이 {cfg.minDelayMs / 1000}~{cfg.maxDelayMs / 1000}초/페이지</Guard>
                <Guard>실패 시 즉시 중단</Guard>
                <Guard>동시 접속 금지</Guard>
                <Guard>무차별 검색 금지</Guard>
                <Guard>CAPTCHA→사람 처리</Guard>
                <Guard>숫자만 저장(HTML✗)</Guard>
              </div>
            </div>
          )}

          {/* POIZON API 자동 동기화 */}
          <div className={`glass rounded-2xl p-4 border ${apiReady ? "border-fuchsia-400/30" : "border-white/10"}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Zap className={`h-4 w-4 ${apiReady ? "text-fuchsia-300" : "text-slate-500"}`} />
                <div>
                  <p className="text-sm font-semibold text-slate-100">
                    POIZON 자동 동기화
                    {apiReady ? (
                      <span className="ml-2 text-[11px] text-fuchsia-300">연동됨</span>
                    ) : (
                      <span className="ml-2 text-[11px] text-amber-300">연결 필요</span>
                    )}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {apiReady
                      ? "sku 칸에 POIZON skuId(숫자)를 넣은 활성 상품의 시세($)를 API로 한 번에 갱신합니다."
                      : "서버 .env에 App Key/Secret 설정 시(Poizon Sellers 인증), 시세를 API로 자동 채웁니다."}
                  </p>
                </div>
              </div>
              <button
                onClick={() => syncMut.mutate()}
                disabled={!apiReady || syncMut.isPending}
                className="neon-btn rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-40 shrink-0"
                title={apiReady ? "POIZON API로 시세 갱신" : "승인·인증 후 활성화"}
              >
                <RefreshCw className={`h-4 w-4 ${syncMut.isPending ? "animate-spin" : ""}`} />
                {syncMut.isPending ? "동기화 중…" : "지금 동기화"}
              </button>
            </div>
          </div>

          {/* 알림 */}
          {dash && dash.alerts.length > 0 && (
            <div className="glass rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2"><Bell className="h-4 w-4 text-amber-300" /><p className="text-sm font-semibold text-amber-200">알림 {dash.alerts.length}건</p></div>
              <ul className="space-y-1.5">
                {dash.alerts.map((a, i) => (
                  <li key={i} className="text-sm flex items-center gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${a.type === "stock" ? "bg-red-500/20 text-red-300" : a.type === "undercut" ? "bg-amber-500/20 text-amber-300" : "bg-cyan-500/20 text-cyan-300"}`}>
                      {a.type === "stock" ? "품절임박" : a.type === "undercut" ? "가격열세" : "시세하락"}
                    </span>
                    <b className="text-slate-100">{a.product}</b>
                    <span className="text-slate-400">{a.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 판매 현황 카드 (추이 시각화) */}
          {dash && dash.items.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <LineChart className="h-4 w-4 text-fuchsia-300" />
                <h2 className="text-sm font-semibold text-slate-100">판매 현황</h2>
                <span className="text-[11px] text-slate-500">최근 30일 추이 · 데이터가 쌓일수록 선명해집니다</span>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {dash.items.map(it => <SkuCard key={it.product.id} it={it} />)}
              </div>
            </div>
          )}

          {/* 등록 */}
          <div className="glass rounded-2xl p-4">
            <div className="grid sm:grid-cols-6 gap-2">
              <select value={f.platform} onChange={e => setF({ ...f, platform: e.target.value })}
                className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-fuchsia-400/60">
                {PLATFORM_ORDER.map(p => <option key={p} value={p} className="bg-[#0a0b1e]">{PLATFORM_LABEL[p]}</option>)}
              </select>
              <In placeholder="상품명 *" value={f.productName} onChange={v => setF({ ...f, productName: v })} span2 />
              <In placeholder="브랜드" value={f.brand} onChange={v => setF({ ...f, brand: v })} />
              <In placeholder="국내 매입가 ₩" value={f.myPriceKrw} onChange={v => setF({ ...f, myPriceKrw: v })} type="number" />
              <In placeholder="목표재고" value={f.targetStock} onChange={v => setF({ ...f, targetStock: v })} type="number" />
            </div>
            <div className="flex justify-end mt-2">
              <button onClick={add} disabled={createMut.isPending} className="neon-btn rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5">
                <Plus className="h-4 w-4" /> 상품 추가
              </button>
            </div>
          </div>

          {/* 목록 + 오늘 기록 */}
          <div className="glass rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead className="bg-white/5 text-xs text-slate-400">
                  <tr>
                    <th className="text-left font-medium px-3 py-2.5">상품 / 브랜드</th>
                    <th className="text-right font-medium px-3 py-2.5">국내 매입가</th>
                    <th className="text-center font-medium px-3 py-2.5" colSpan={3}>오늘 기록 (재고 · POIZON 시세$ · 국내 경쟁최저)</th>
                    <th className="text-right font-medium px-3 py-2.5">POIZON 판매(매출/개수)</th>
                    <th className="text-center font-medium px-3 py-2.5">시세 7일</th>
                    <th className="text-center font-medium px-3 py-2.5">활성</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {prods.length === 0 && <tr><td colSpan={9} className="text-center text-slate-500 py-10">관찰할 내 상품을 위에서 추가하세요.</td></tr>}
                  {prods.map(p => {
                    const it = itemOf(p.id);
                    const s = snap[p.id] || { stock: "", cny: "", comp: "" };
                    const set = (k: string, v: string) => setSnap(prev => ({ ...prev, [p.id]: { ...s, [k]: v } }));
                    return (
                      <tr key={p.id} className={`border-t border-white/8 ${!p.active ? "opacity-45" : ""}`}>
                        <td className="px-3 py-2">
                          <p className="font-medium text-slate-100 truncate max-w-[220px]">{p.productName}</p>
                          <p className="text-[11px] text-slate-500">{PLATFORM_LABEL[p.platform || "poizon"]}{p.brand ? ` · ${p.brand}` : ""}</p>
                        </td>
                        <td className="text-right px-3 py-2 text-slate-300">{won(p.myPriceKrw || 0)}</td>
                        <td className="px-1 py-2"><Mini placeholder={String(it?.latest?.stock ?? "재고")} value={s.stock} onChange={v => set("stock", v)} /></td>
                        <td className="px-1 py-2"><Mini placeholder={String(it?.latest?.poizonPriceCny ?? "$")} value={s.cny} onChange={v => set("cny", v)} /></td>
                        <td className="px-1 py-2">
                          <div className="flex items-center gap-1">
                            <Mini placeholder={String(it?.latest?.competitorLowKrw ?? "국내경쟁")} value={s.comp} onChange={v => set("comp", v)} />
                            <button onClick={() => saveSnap(p.id)} className="text-fuchsia-300 hover:text-fuchsia-200"><Save className="h-4 w-4" /></button>
                          </div>
                        </td>
                        <td className="text-right px-3 py-2 text-slate-300">
                          {it?.latest ? <>{won(it.latest.revenueKrw)}<span className="text-slate-500 text-[11px]"> / {it.latest.unitsSold}개</span></> : <span className="text-slate-600">-</span>}
                        </td>
                        <td className="text-center px-3 py-2">
                          {it && it.poizonDeltaPct !== 0 ? (
                            <span className={`text-xs font-semibold ${it.poizonDeltaPct < 0 ? "text-red-300" : "text-emerald-300"}`}>{it.poizonDeltaPct > 0 ? "+" : ""}{it.poizonDeltaPct}%</span>
                          ) : <span className="text-slate-600 text-xs">-</span>}
                        </td>
                        <td className="text-center px-3 py-2">
                          <button onClick={() => updateMut.mutate({ id: p.id, active: !p.active })}
                            className={`h-6 w-6 grid place-items-center rounded-md border transition-all ${p.active ? "bg-emerald-500/25 text-emerald-200 border-emerald-400/50" : "border-white/10 text-slate-500"}`}>
                            <Power className="h-3.5 w-3.5" />
                          </button>
                        </td>
                        <td className="text-right px-3 py-2">
                          <button onClick={() => removeMut.mutate({ id: p.id })} className="text-slate-500 hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[11px] text-slate-500">💡 채우는 3가지: <b className="text-slate-400">수동/CSV</b> · <b className="text-slate-400">확장 스케줄러</b> · <b className="text-fuchsia-300">POIZON API(연동 시 자동)</b>. sku 칸에 POIZON skuId를 넣은 상품의 시세($)가 위 '지금 동기화'로 채워집니다.</p>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Guard({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span>{children}</div>;
}

function statusOf(it: DashItem): { dot: string; ring: string; label: string; tone: string } {
  const unitsDown = trendOf(it.series.map(p => p.units)).dir === "down";
  if (it.undercut || it.stockLow || it.poizonDeltaPct <= -20)
    return { dot: "bg-red-400", ring: "ring-red-400/40", label: "🔴 검토", tone: "text-red-300" };
  if (it.poizonDeltaPct <= -5 || unitsDown)
    return { dot: "bg-amber-400", ring: "ring-amber-400/30", label: "🟡 관찰", tone: "text-amber-300" };
  return { dot: "bg-emerald-400", ring: "ring-emerald-400/20", label: "🟢 안정", tone: "text-emerald-300" };
}

function SkuCard({ it }: { it: DashItem }) {
  const s = it.series;
  const hasData = s.length > 0;
  const latest = it.latest;
  const st = statusOf(it);
  const avgUnits = s.length ? Math.round((s.reduce((a, p) => a + p.units, 0) / s.length) * 10) / 10 : 0;
  const summary = !hasData
    ? "데이터 수집 대기 — 확장 스캔/수동 기록 시 채워집니다"
    : `재고 ${latest?.stock ?? 0}개 · 하루 평균 ${avgUnits}건${it.poizonDeltaPct ? ` · 시세 7일 ${it.poizonDeltaPct > 0 ? "+" : ""}${it.poizonDeltaPct}%` : ""}`;
  return (
    <div className={`glass rounded-2xl p-4 ring-1 ${st.ring}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${st.dot}`} />
            <p className="font-bold text-slate-100 truncate max-w-[180px]">{it.product.productName}</p>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">{it.product.brand || "-"}</p>
        </div>
        <span className={`text-[11px] font-semibold ${st.tone}`}>{st.label}</span>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-3">
        <Metric label="판매(₩)" values={s.map(p => p.revenue)} value={latest ? won(latest.revenueKrw) : "-"} />
        <Metric label="재고" values={s.map(p => p.stock)} value={latest ? `${latest.stock}개` : "-"} />
        <Metric label="POIZON 시세($)" values={s.map(p => p.cny)} value={latest?.poizonPriceCny ? `$${latest.poizonPriceCny.toLocaleString("en-US")}` : "-"} />
      </div>

      <p className={`text-[11px] mt-3 ${hasData ? "text-slate-400" : "text-slate-600"}`}>{summary}</p>
    </div>
  );
}

function Metric({ label, values, value }: { label: string; values: number[]; value: string }) {
  const t = trendOf(values);
  return (
    <div className="text-slate-400">
      <div className="flex items-center justify-between text-[10px] mb-0.5">
        <span>{label}</span>
        <TrendArrow dir={t.dir} />
      </div>
      <Sparkline values={values} width={92} height={24} className="w-full text-slate-500" />
      <p className="text-[11px] font-semibold text-slate-200 mt-0.5">{value}</p>
    </div>
  );
}
function In({ placeholder, value, onChange, type, span2 }: { placeholder: string; value: string; onChange: (v: string) => void; type?: string; span2?: boolean }) {
  return <input type={type || "text"} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}
    className={`rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-fuchsia-400/60 ${span2 ? "sm:col-span-2" : ""}`} />;
}
function Mini({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (v: string) => void }) {
  return <input type="number" placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}
    className="w-20 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-white placeholder:text-slate-600 outline-none focus:border-fuchsia-400/60" />;
}
