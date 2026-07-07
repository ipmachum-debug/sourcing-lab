import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { domesticSearchLinks } from "@/lib/domesticSearch";
import { toCsv, downloadCsv, stamp } from "@/lib/csv";
import {
  ListChecks,
  Search,
  Compass,
  Flame,
  ExternalLink,
  ChevronDown,
  ScanBarcode,
  Store,
  Shield,
  Download,
} from "lucide-react";

const usd = (n: number) => `$${Math.round(n || 0).toLocaleString("en-US")}`;
const won = (n: number) => `${Math.round(n || 0).toLocaleString("ko-KR")}원`;

const SOURCE_LABEL: Record<string, string> = {
  watchlist: "워치리스트", musinsa: "무신사", abcmart: "ABC마트", crocs: "크록스",
  nike: "나이키", adidas: "아디다스", newbalance: "뉴발란스", lfmall: "LF몰",
  lotteon: "롯데ON", ssg: "SSG", "29cm": "29CM", seller: "판매자", other: "기타",
};

interface Row {
  groupKey: string; normKey: string; spuId: string | null;
  brand: string; productName: string; category: string | null;
  imageUrl: string | null; sizeCount: number;
  stableUsd: number; lowUsd: number; highUsd: number;
  soldCount: number; volatilityPct: number;
  hasDomestic: boolean; domesticBuyKrw: number; domesticSource: string | null;
  domesticUrl: string | null; matchBy: "barcode" | "name" | null;
  netProfitKrw: number; marginPct: number; grade: string; recommendQty: number;
  revenueKrw: number; feeKrw: number; vatRefundKrw: number;
  floorBidUsd: number; targetBidUsd: number;
  status: "hunt" | "deal" | "thin";
}

type Status = "hunt" | "deal" | "all";

export default function ReverseQueue() {
  // AI 비서·외부 링크에서 넘어온 ?search= 초기 필터
  const initSearch = (() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("search") ?? "";
  })();
  const [status, setStatus] = useState<Status>("hunt");
  const [category, setCategory] = useState("전체");
  const [term, setTerm] = useState(initSearch);
  const [search, setSearch] = useState(initSearch);

  const fx = trpc.reverseDeals.fxRate.useQuery(undefined, { staleTime: 60 * 60 * 1000 });
  const q = trpc.reverseDeals.sourcingQueue.useQuery({
    status,
    category: category === "전체" ? undefined : category,
    search: search || undefined,
    rate: fx.data?.rate,
    minMargin: 30,
    minSold: 1,
    limit: 100,
  });
  const data = q.data as
    | { rows: Row[]; counts: { hunt: number; deal: number; thin: number; total: number }; categories: { name: string; count: number }[] }
    | undefined;
  const rows = data?.rows ?? [];
  const counts = data?.counts;

  // 국내가 즉시 입력 → 저장하면 해당 상품이 딜로 승격(방어선 계산)
  const utils = trpc.useUtils();
  const domMut = trpc.reverseDeals.domesticSubmit.useMutation({
    onSuccess: () => {
      toast.success("국내가 저장 — 매입 판단·방어선 반영됨");
      utils.reverseDeals.sourcingQueue.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const saveDomestic = (r: Row, priceKrw: number) => {
    if (priceKrw <= 0) return;
    domMut.mutate({
      source: "other",
      brand: r.brand || undefined,
      productName: r.productName,
      listPrice: priceKrw,
      salePrice: priceKrw,
    });
  };

  // 딜 → 매입 확정: 매입 관리(reverse_purchases)에 기록 생성 (소싱→매입 데이터 흐름)
  const [purchasingKey, setPurchasingKey] = useState<string | null>(null);
  const buyMut = trpc.reversePurchase.create.useMutation({
    onSuccess: () => toast.success("매입 관리에 등록됨 — 매입 관리에서 상태를 진행하세요"),
    onError: e => toast.error(e.message),
    onSettled: () => setPurchasingKey(null),
  });
  const confirmPurchase = (r: Row) => {
    setPurchasingKey(r.groupKey);
    buyMut.mutate({
      brand: r.brand || undefined,
      productName: r.productName,
      buyChannel: r.domesticSource ? SOURCE_LABEL[r.domesticSource] ?? r.domesticSource : undefined,
      buyPrice: Math.round(r.domesticBuyKrw),
      qty: r.recommendQty > 0 ? r.recommendQty : 1,
      buyDate: new Date().toISOString().slice(0, 10),
    });
  };

  const doSearch = () => setSearch(term.trim());

  // 일괄입찰 CSV — 국내가 매칭된 상품의 방어 입찰가/목표가 내보내기 (POIZON 최저 입찰가 세팅용)
  const exportBids = () => {
    const withBid = rows.filter(r => r.hasDomestic && r.floorBidUsd > 0);
    if (withBid.length === 0) return;
    const csv = toCsv(
      ["상품명", "브랜드", "SPU", "카테고리", "국내매입가(원)", "안정가($)", "방어선입찰가($)", "목표순익2만가($)", "예상마진(%)", "추천수량"],
      withBid.map(r => [
        r.productName, r.brand, r.spuId ?? "", r.category ?? "",
        r.domesticBuyKrw, r.stableUsd, r.floorBidUsd, r.targetBidUsd,
        r.marginPct.toFixed(1), r.recommendQty,
      ])
    );
    downloadCsv(`소싱_방어입찰가_${stamp()}`, csv);
  };
  const bidCount = rows.filter(r => r.hasDomestic && r.floorBidUsd > 0).length;

  const TABS: { key: Status; label: string; icon: any; count?: number }[] = [
    { key: "hunt", label: "발굴 대상", icon: Compass, count: counts?.hunt },
    { key: "deal", label: "딜 확정", icon: Flame, count: counts?.deal },
    { key: "all", label: "전체", icon: ListChecks, count: counts?.total },
  ];

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* 헤더 */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest neon-chip neon-magenta px-3 py-1 rounded-full uppercase">
                <ListChecks className="h-3.5 w-3.5" /> Sourcing Queue
              </span>
              <h1 className="text-3xl sm:text-4xl font-black mt-4 neon-text">소싱 큐</h1>
              <p className="text-slate-300/80 mt-2 max-w-2xl">
                뭐가 팔리는지는 <b className="text-white">이미 다 압니다</b>(판매자 카탈로그). 이제 질문은
                하나 — <b className="text-fuchsia-300">이 잘 팔리는 걸 국내에서 싸게 어디서 사나</b>.
                국내가가 매칭되면 <b className="text-white">방어 입찰가(이 아래면 손해)</b>까지 계산합니다.
              </p>
            </div>
            <button
              onClick={exportBids}
              disabled={bidCount === 0}
              title="국내가 매칭 상품의 방어/목표 입찰가를 CSV로 — POIZON 일괄입찰·최저 입찰가 세팅에 사용"
              className="neon-btn rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-40 shrink-0"
            >
              <Download className="h-4 w-4" /> 입찰가 CSV {bidCount > 0 && `(${bidCount})`}
            </button>
          </div>

          {/* 요약 */}
          {counts && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Tile label="🧭 발굴 대상" value={counts.hunt.toLocaleString()} tone="hunt" />
              <Tile label="🔥 딜 확정" value={counts.deal.toLocaleString()} tone="deal" />
              <Tile label="카탈로그 상품(SPU)" value={counts.total.toLocaleString()} />
              <Tile label="보류" value={counts.thin.toLocaleString()} />
            </div>
          )}

          {/* 검색 + 상태 탭 */}
          <div className="glass rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <input
                  value={term}
                  onChange={e => setTerm(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && doSearch()}
                  placeholder="상품명·브랜드 검색 (예: 크록스, 발렌시아가)"
                  className="w-full rounded-lg border border-white/15 bg-white/5 pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-fuchsia-400/60"
                />
              </div>
              <button onClick={doSearch} className="neon-btn rounded-lg px-4 py-2.5 text-sm font-semibold">
                검색
              </button>
              {search && (
                <button
                  onClick={() => { setTerm(""); setSearch(""); }}
                  className="text-sm text-slate-400 hover:text-white px-2"
                >
                  초기화
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {TABS.map(t => (
                <button
                  key={t.key}
                  onClick={() => setStatus(t.key)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                    status === t.key
                      ? "neon-chip neon-magenta text-white"
                      : "text-slate-400 hover:text-slate-200 bg-white/5"
                  }`}
                >
                  <t.icon className="h-3.5 w-3.5" />
                  {t.label}
                  {t.count != null && (
                    <span className="text-[11px] opacity-70">{t.count.toLocaleString()}</span>
                  )}
                </button>
              ))}
            </div>

            {/* 카테고리 칩 */}
            {data?.categories && data.categories.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {["전체", ...data.categories.map(c => c.name)].map(name => (
                  <button
                    key={name}
                    onClick={() => setCategory(name)}
                    className={`rounded-full px-2.5 py-1 text-[12px] transition-all ${
                      category === name
                        ? "bg-fuchsia-500/25 text-fuchsia-100 ring-1 ring-fuchsia-400/40"
                        : "text-slate-400 hover:text-slate-200 bg-white/5"
                    }`}
                  >
                    {name}
                    {name !== "전체" && (
                      <span className="ml-1 opacity-60">
                        {data.categories.find(c => c.name === name)?.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 목록 */}
          {q.isLoading ? (
            <div className="text-center text-slate-500 py-16">불러오는 중…</div>
          ) : rows.length === 0 ? (
            <EmptyState hasCatalog={!!counts && counts.total > 0} />
          ) : (
            <div className="glass rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[820px]">
                  <thead className="bg-white/5 text-xs text-slate-400">
                    <tr>
                      <th className="text-left font-medium px-3 py-2.5">상품</th>
                      <th className="text-center font-medium px-3 py-2.5">카테고리</th>
                      <th className="text-right font-medium px-3 py-2.5">판매량</th>
                      <th className="text-right font-medium px-3 py-2.5">POIZON 안정가($)</th>
                      <th className="text-right font-medium px-3 py-2.5">국내 매입가</th>
                      <th className="text-right font-medium px-3 py-2.5">예상마진</th>
                      <th className="text-center font-medium px-3 py-2.5">액션</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <QueueRow
                        key={r.groupKey}
                        r={r}
                        onSaveDomestic={p => saveDomestic(r, p)}
                        saving={domMut.isPending}
                        onPurchase={() => confirmPurchase(r)}
                        purchasing={purchasingKey === r.groupKey}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

function QueueRow({ r, onSaveDomestic, saving, onPurchase, purchasing }: { r: Row; onSaveDomestic: (krw: number) => void; saving: boolean; onPurchase: () => void; purchasing: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
    <tr className="border-t border-white/8 hover:bg-white/[0.02]">
      <td className="px-3 py-2.5">
        <p className="font-medium text-slate-100 truncate max-w-[280px]">{r.productName}</p>
        <p className="text-[11px] text-slate-500 flex items-center gap-1">
          {r.brand || "-"}
          {r.sizeCount > 0 && <span className="text-slate-600">· 사이즈 {r.sizeCount}</span>}
          {r.matchBy === "barcode" && (
            <span className="inline-flex items-center gap-0.5 text-emerald-400/80" title="바코드 정확 매칭">
              <ScanBarcode className="h-3 w-3" /> exact
            </span>
          )}
        </p>
      </td>
      <td className="text-center px-3 py-2.5 text-slate-400 text-xs">{r.category || "-"}</td>
      <td className="text-right px-3 py-2.5 text-slate-300">
        {r.soldCount ? r.soldCount.toLocaleString() : "-"}
      </td>
      <td className="text-right px-3 py-2.5">
        <span className="text-fuchsia-200 font-medium">{usd(r.stableUsd)}</span>
        {r.highUsd > r.lowUsd && (
          <span className="block text-[10px] text-slate-600">
            {usd(r.lowUsd)}~{usd(r.highUsd)}
          </span>
        )}
      </td>
      <td className="text-right px-3 py-2.5">
        {r.hasDomestic ? (
          <span className="text-slate-200">
            {won(r.domesticBuyKrw)}
            {r.domesticSource && (
              <span className="block text-[10px] text-slate-500">
                {SOURCE_LABEL[r.domesticSource] ?? r.domesticSource}
              </span>
            )}
          </span>
        ) : (
          <DomesticEntry
            name={r.productName}
            brand={r.brand}
            onSave={onSaveDomestic}
            saving={saving}
          />
        )}
      </td>
      <td className="text-right px-3 py-2.5">
        {r.hasDomestic ? (
          <button onClick={() => setOpen(o => !o)} className="text-right group" title="실순익 분해 보기">
            <span
              className={`font-bold ${r.marginPct >= 30 ? "text-emerald-300" : r.marginPct > 0 ? "text-amber-300" : "text-red-400"}`}
            >
              {r.marginPct.toFixed(0)}%
              {r.grade !== "-" && <span className="text-[10px] text-slate-500 ml-1">{r.grade}</span>}
              <ChevronDown className={`inline h-3 w-3 text-slate-600 ml-0.5 transition-transform ${open ? "rotate-180" : ""}`} />
            </span>
            <span className="block text-[10px] text-emerald-300/80">순익 {won(r.netProfitKrw)}</span>
            {r.floorBidUsd > 0 && (
              <span className="block text-[10px] text-slate-500" title="이 판매가 아래로 내려가면 손해 — POIZON 최저 입찰가 방어선">
                <Shield className="inline h-2.5 w-2.5 text-cyan-400/70" /> 방어 {usd(r.floorBidUsd)} · 목표 {usd(r.targetBidUsd)}
              </span>
            )}
          </button>
        ) : (
          <span className="text-slate-600 text-xs">-</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center justify-center">
          {r.status === "deal" ? (
            <button
              onClick={onPurchase}
              disabled={purchasing}
              className="inline-flex items-center gap-1 text-[12px] font-semibold neon-chip neon-magenta rounded-full px-2.5 py-1 hover:brightness-110 disabled:opacity-50"
              title="이 수량으로 매입 관리에 등록 (매입처·매입가·수량 자동 채움)"
            >
              <Flame className="h-3 w-3" />
              {purchasing ? "등록 중…" : r.recommendQty > 0 ? `${r.recommendQty}개 매입` : "매입"}
            </button>
          ) : (
            <span className="text-[11px] text-slate-600" title="왼쪽 '국내가 찾기'로 매입가를 확인한 뒤 입력하면 딜로 전환됩니다">
              국내가 입력 대기
            </span>
          )}
        </div>
      </td>
    </tr>
    {open && r.hasDomestic && (
      <tr className="bg-white/[0.03]">
        <td colSpan={7} className="px-3 py-3">
          <NetProfitCard r={r} />
        </td>
      </tr>
    )}
    </>
  );
}

// 실순익 분해 카드 — "내가 얼마 버는가"를 크게. 판매가·수수료·매입가·부가세환급·순이익.
function NetProfitCard({ r }: { r: Row }) {
  const items: { label: string; value: string; tone?: string; sign?: string }[] = [
    { label: "POIZON 판매가(안정)", value: won(r.revenueKrw), sign: "" },
    { label: "POIZON 수수료", value: won(r.feeKrw), tone: "text-red-300", sign: "−" },
    { label: "국내 매입가", value: won(r.domesticBuyKrw), tone: "text-red-300", sign: "−" },
    { label: "부가세 환급", value: won(r.vatRefundKrw), tone: "text-emerald-300", sign: "+" },
  ];
  return (
    <div className="flex flex-wrap items-stretch gap-2">
      {items.map(it => (
        <div key={it.label} className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 min-w-[130px]">
          <p className="text-[10px] text-slate-500">{it.label}</p>
          <p className={`text-sm font-semibold mt-0.5 ${it.tone ?? "text-slate-100"}`}>
            {it.sign}{it.value}
          </p>
        </div>
      ))}
      <div className="rounded-lg bg-emerald-500/15 border border-emerald-400/30 px-4 py-2 min-w-[150px] flex flex-col justify-center">
        <p className="text-[10px] text-emerald-300/80">순이익 (마진 {r.marginPct.toFixed(0)}%)</p>
        <p className="text-xl font-black text-emerald-300 mt-0.5">{won(r.netProfitKrw)}</p>
      </div>
      {r.recommendQty > 0 && (
        <div className="rounded-lg bg-fuchsia-500/15 border border-fuchsia-400/30 px-4 py-2 flex flex-col justify-center">
          <p className="text-[10px] text-fuchsia-300/80">추천 매입</p>
          <p className="text-xl font-black text-fuchsia-200 mt-0.5">
            {r.recommendQty}개
            <span className="text-[11px] font-normal text-slate-400 ml-1">
              (예상 {won(r.netProfitKrw * r.recommendQty)})
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

// 국내가 찾기 + 입력을 한 칸에: 찾기 링크로 매입가 확인 → 바로 아래 입력창에 입력 → 저장.
// (외부 사이트 가격은 브라우저 보안상 자동 수집 불가 → 확인한 값을 여기 직접 입력)
function DomesticEntry({
  name,
  brand,
  onSave,
  saving,
}: {
  name: string;
  brand: string;
  onSave: (krw: number) => void;
  saving: boolean;
}) {
  const [v, setV] = useState("");
  const submit = () => {
    // "149,000원" 처럼 콤마·단위가 붙어도 숫자만 추출
    const n = Number(String(v).replace(/[^\d]/g, "")) || 0;
    if (n > 0) { onSave(n); setV(""); }
  };
  return (
    <div className="flex flex-col items-end gap-1.5">
      <span className="inline-flex items-center gap-1">
        <input
          value={v}
          onChange={e => setV(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit()}
          placeholder="국내가"
          inputMode="numeric"
          title="찾은 국내 매입가(원)를 입력하고 저장 → 방어선 계산 (149,000원 붙여넣기 OK)"
          className="w-24 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[12px] text-right text-white placeholder:text-slate-600 outline-none focus:border-fuchsia-400/60"
        />
        <button
          onClick={submit}
          disabled={saving || !v}
          className="text-[11px] neon-chip rounded-md px-1.5 py-1 text-slate-200 disabled:opacity-40"
        >
          저장
        </button>
      </span>
      <FindDomestic name={name} brand={brand} />
    </div>
  );
}

function FindDomestic({ name, brand }: { name: string; brand: string }) {
  const [open, setOpen] = useState(false);
  const links = domesticSearchLinks(name, brand);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 text-[12px] font-semibold rounded-full px-2.5 py-1 bg-fuchsia-500/15 text-fuchsia-200 hover:bg-fuchsia-500/25"
      >
        <Store className="h-3 w-3" /> 국내가 찾기
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-40 rounded-xl border border-white/15 bg-slate-900/95 backdrop-blur p-1 shadow-xl">
            {links.map(l => (
              <a
                key={l.label}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between px-2.5 py-1.5 text-[13px] text-slate-200 rounded-lg hover:bg-white/10"
                onClick={() => setOpen(false)}
              >
                {l.label}
                <ExternalLink className="h-3 w-3 text-slate-500" />
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: string;
  tone?: "normal" | "hunt" | "deal";
}) {
  const c =
    tone === "hunt" ? "text-fuchsia-200" : tone === "deal" ? "text-emerald-300" : "text-white";
  return (
    <div className="glass rounded-xl p-3">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className={`text-2xl font-black mt-1 ${c}`}>{value}</p>
    </div>
  );
}

function EmptyState({ hasCatalog }: { hasCatalog: boolean }) {
  return (
    <div className="glass rounded-2xl p-8 text-center">
      <Compass className="h-8 w-8 text-slate-500 mx-auto mb-3" />
      {hasCatalog ? (
        <>
          <p className="text-slate-300 font-medium">이 조건에 맞는 상품이 없어요</p>
          <p className="text-sm text-slate-500 mt-2">검색어·카테고리·상태 탭을 바꿔보세요.</p>
        </>
      ) : (
        <>
          <p className="text-slate-300 font-medium">카탈로그가 아직 비어 있어요</p>
          <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
            <Link href="/reverse/seller" className="underline text-fuchsia-300">판매자센터 엑셀</Link>을
            올리면 전체 카탈로그가 여기 소싱 큐로 들어옵니다.
          </p>
        </>
      )}
    </div>
  );
}
