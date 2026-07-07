import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Globe2, Camera, Scale, Store, ListChecks, BarChart3, Package, Ship, Sparkles, Flame, Activity, Bell, ArrowRight } from "lucide-react";

// 역직구 채널 홈 — 판매자 카탈로그(엑셀) 주도 소싱 엔진.
const TOOLS = [
  { icon: Store, emoji: "🏬", title: "판매자 엑셀", desc: "POIZON 판매자센터 전체 내보내기 → 카탈로그 시딩", path: "/reverse/seller" },
  { icon: BarChart3, emoji: "📊", title: "상품 발굴", desc: "고회전·고마진·안전·블루오션 필터 + 입찰 추천", path: "/reverse/insights" },
  { icon: ListChecks, emoji: "🧭", title: "소싱 큐", desc: "국내가만 잡으면 딜 — 발굴/딜 우선순위 + 추천 수량", path: "/reverse/queue" },
  { icon: Camera, emoji: "📸", title: "사진 소싱", desc: "매장 가격표 사진 → AI OCR → 즉시 매입 판단", path: "/reverse/photo" },
  { icon: Scale, emoji: "⚖️", title: "정밀 계산기", desc: "검수 탈락·부가세 환급까지 반영한 진짜 순익", path: "/reverse/arbitrage" },
  { icon: Activity, emoji: "📊", title: "내 상품 관리", desc: "내 SKU 매일 스냅샷 · 추이 그래프 · 알림", path: "/reverse/my-products" },
  { icon: Package, emoji: "📦", title: "매입 관리", desc: "매입·검수·판매 기록 → 검수탈락률·회전일 축적", path: "/reverse/purchases" },
  { icon: Ship, emoji: "🌏", title: "수출 관리", desc: "채널별 판매·정산·회계", path: "/reverse/exports" },
];

const SEV_STYLE: Record<string, string> = {
  high: "border-red-400/40 bg-red-500/10",
  med: "border-amber-400/30 bg-amber-500/10",
  info: "border-emerald-400/25 bg-emerald-500/10",
};
const SEV_DOT: Record<string, string> = { high: "bg-red-400", med: "bg-amber-400", info: "bg-emerald-400" };

interface AlertRow {
  skuId: number; productName: string; brand: string | null;
  type: string; deltaPct: number; latestCny: number; severity: string; message: string;
}

interface SurgeAlert {
  normKey: string; productName: string; brand: string | null; category: string;
  type: "price_surge" | "sold_surge" | "new_hot"; deltaPct: number; latestCny: number; soldCount: number;
  severity: string; message: string;
}
const SURGE_TAG: Record<string, { label: string; cls: string }> = {
  price_surge: { label: "시세급등", cls: "bg-orange-500/20 text-orange-300" },
  sold_surge: { label: "판매급증", cls: "bg-cyan-500/20 text-cyan-300" },
  new_hot: { label: "신규급부상", cls: "bg-fuchsia-500/20 text-fuchsia-300" },
};

function MarketSurge() {
  const [cat, setCat] = useState<string>("전체");
  const q = trpc.poizonTrending.surgeAlerts.useQuery(undefined, { refetchOnWindowFocus: false });
  const d = q.data as { alerts: SurgeAlert[]; total: number } | undefined;
  if (!d || d.alerts.length === 0) return null;
  const cats = ["전체", ...Array.from(new Set(d.alerts.map(a => a.category)))];
  const shown = cat === "전체" ? d.alerts : d.alerts.filter(a => a.category === cat);
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <Flame className="h-4 w-4 text-orange-300" />
        <h2 className="text-sm font-semibold text-slate-100 tracking-wide">시장 급상승</h2>
        <span className="text-[11px] text-slate-500">POIZON 시세·판매 급변 {d.total}건</span>
        <Link href="/reverse/insights" className="ml-auto text-[11px] text-fuchsia-300 flex items-center gap-0.5 hover:underline">
          소싱 인사이트 <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {cats.length > 2 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {cats.map(c => (
            <button key={c} onClick={() => setCat(c)}
              className={`text-[11px] px-2.5 py-1 rounded-lg border ${cat === c ? "bg-orange-500/20 text-orange-200 border-orange-400/40" : "border-white/10 text-slate-400"}`}>{c}</button>
          ))}
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-2.5">
        {shown.slice(0, 8).map((a, i) => {
          const t = SURGE_TAG[a.type];
          return (
            <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-3 flex items-start gap-2.5">
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${t.cls}`}>{t.label}</span>
              <div className="min-w-0">
                <p className="font-semibold text-slate-100 text-sm truncate">{a.productName}</p>
                <p className="text-[12px] text-slate-300">{a.message}</p>
                <p className="text-[10px] text-slate-500">{a.brand || ""}{a.brand ? " · " : ""}{a.category}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function WatchlistAlerts() {
  const q = trpc.reverseDeals.watchAlerts.useQuery(undefined, { refetchOnWindowFocus: false });
  const d = q.data as { alerts: AlertRow[]; watched: number; withData: number } | undefined;
  if (!d || d.watched === 0) return null;
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <Bell className="h-4 w-4 text-fuchsia-300" />
        <h2 className="text-sm font-semibold text-slate-100 tracking-wide">워치리스트 알림</h2>
        <span className="text-[11px] text-slate-500">감시 {d.watched}개 · 시세 표본 {d.withData}개</span>
        <Link href="/reverse/queue" className="ml-auto text-[11px] text-fuchsia-300 flex items-center gap-0.5 hover:underline">
          소싱 큐 <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {d.alerts.length === 0 ? (
        <div className="glass rounded-2xl p-4 text-sm text-slate-400">
          ✅ 조용합니다 — 워치리스트 SKU에 ±10% 시세 변동·판매 급증 없음. (시세가 쌓이면 자동 감지)
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-2.5">
          {d.alerts.slice(0, 8).map((a, i) => (
            <div key={i} className={`rounded-xl border p-3 flex items-start gap-2.5 ${SEV_STYLE[a.severity]}`}>
              <span className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${SEV_DOT[a.severity]}`} />
              <div className="min-w-0">
                <p className="font-semibold text-slate-100 text-sm truncate">{a.productName}</p>
                <p className="text-[12px] text-slate-300">{a.message}</p>
                <p className="text-[10px] text-slate-500">{a.brand || ""}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// 종합 관제 대시보드 — 소싱(브랜드·카탈로그·추천) + 운영(매입·순익·회전) 한눈에.
function CommandDeck() {
  const brand = trpc.reverseDeals.brandDashboard.useQuery({ limit: 1 }, { refetchOnWindowFocus: false });
  const stats = trpc.reversePurchase.stats.useQuery(undefined, { refetchOnWindowFocus: false });
  const bt = brand.data?.totals as { brands: number; spuCount: number; totalSold: number; recCount: number } | undefined;
  const st = stats.data as
    | { total: number; buyAmount: number; soldCount: number; netProfit: number; avgTurnDays: number | null }
    | undefined;
  const won = (n: number) => `${Math.round(n || 0).toLocaleString("ko-KR")}원`;
  const num = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");
  const tiles: { emoji: string; label: string; value: string; href: string; tone?: string }[] = [
    { emoji: "🏷", label: "브랜드", value: bt ? num(bt.brands) : "…", href: "/reverse/brands" },
    { emoji: "📦", label: "카탈로그 상품", value: bt ? num(bt.spuCount) : "…", href: "/reverse/insights" },
    { emoji: "⭐", label: "입찰 추천", value: bt ? num(bt.recCount) : "…", href: "/reverse/queue", tone: "hunt" },
    { emoji: "🛒", label: "매입 건수", value: st ? num(st.total) : "…", href: "/reverse/purchases" },
    { emoji: "💵", label: "누적 순익", value: st ? won(st.netProfit) : "…", href: "/reverse/purchases", tone: "deal" },
    { emoji: "🔄", label: "평균 회전일", value: st?.avgTurnDays != null ? `${st.avgTurnDays}일` : "-", href: "/reverse/purchases" },
  ];
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="h-4 w-4 text-fuchsia-300" />
        <h2 className="text-sm font-semibold text-slate-100 tracking-wide">오늘의 관제</h2>
        <span className="text-[11px] text-slate-500">소싱 → 매입 → 판매 한눈에</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {tiles.map(t => (
          <Link
            key={t.label}
            href={t.href}
            className="glass rounded-xl p-3 hover:ring-1 hover:ring-fuchsia-400/30 transition-all"
          >
            <p className="text-[11px] text-slate-400">{t.emoji} {t.label}</p>
            <p className={`text-xl font-black mt-1 ${t.tone === "deal" ? "text-emerald-300" : t.tone === "hunt" ? "text-fuchsia-200" : "text-white"}`}>
              {t.value}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

const STEPS = [
  { n: 1, title: "카탈로그 확보", desc: "판매자 엑셀로 뭐가·얼마에 팔리나 시딩" },
  { n: 2, title: "국내가 발굴", desc: "소싱 큐에서 국내 싸게 살 곳 찾기" },
  { n: 3, title: "수요 맞춰 매입", desc: "추천 수량으로 재고 리스크 없이 베팅" },
];

export default function Reverse() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const name = (user as any)?.name || "셀러";

  return (
    <DashboardLayout>
      <div className="cyber-stage p-6 sm:p-10">
        <div className="max-w-5xl mx-auto space-y-10">
          {/* 히어로 */}
          <div className="pt-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest neon-chip neon-magenta px-3 py-1 rounded-full uppercase">
              <Globe2 className="h-3.5 w-3.5" /> Reverse Export
            </span>
            <h1 className="text-4xl sm:text-5xl font-black mt-5 tracking-tight text-white">
              역직구, <span className="neon-text">데이터로</span> 팝니다
            </h1>
            <p className="text-slate-300/80 mt-3 text-lg">
              {name}님, 국내에서 싸게 사서 해외(POIZON·당근)에 파는 걸 한 곳에서.
            </p>
            <span className="inline-flex items-center gap-1.5 mt-4 text-xs neon-chip px-3 py-1 rounded-full text-amber-300 border border-amber-400/30 bg-amber-400/5">
              <Sparkles className="h-3.5 w-3.5" /> 새 채널 · 도구 순차 오픈 중
            </span>
          </div>

          {/* 종합 관제 대시보드 */}
          <CommandDeck />

          {/* 워치리스트 알림 (앱 메인 표시) */}
          <WatchlistAlerts />

          {/* 시장 급상승 알림 */}
          <MarketSurge />

          {/* 3단계 */}
          <section>
            <h2 className="text-sm font-semibold text-slate-400 tracking-widest mb-3">역직구 3단계</h2>
            <div className="grid sm:grid-cols-3 gap-3">
              {STEPS.map(s => (
                <div key={s.n} className="glass rounded-2xl p-5">
                  <span className="h-9 w-9 rounded-full grid place-items-center text-sm font-black text-white"
                    style={{ background: "linear-gradient(135deg,#db2777,#a855f7)", boxShadow: "0 0 16px rgba(217,70,239,0.5)" }}>
                    {s.n}
                  </span>
                  <p className="font-bold text-white mt-3">{s.title}</p>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* 도구 (준비중) */}
          <section>
            <h2 className="text-sm font-semibold text-slate-400 tracking-widest mb-3">도구</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {TOOLS.map(t => {
                const ready = !!t.path;
                return (
                  <button
                    key={t.title}
                    onClick={() => ready && setLocation(t.path!)}
                    disabled={!ready}
                    className={`glass rounded-2xl p-6 flex items-center gap-4 text-left ${ready ? "glass-hover" : "opacity-70 cursor-default"}`}
                  >
                    <span className="h-14 w-14 rounded-2xl grid place-items-center text-2xl shrink-0 border border-white/10"
                      style={{ boxShadow: "0 0 22px rgba(217,70,239,0.35)", background: "rgba(255,255,255,0.04)" }}>
                      {t.emoji}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <t.icon className="h-4 w-4 text-fuchsia-300" />
                        <span className="font-bold text-lg text-white">{t.title}</span>
                        {ready ? (
                          <span className="text-[10px] font-semibold text-emerald-300 bg-emerald-400/10 border border-emerald-400/25 px-1.5 py-0.5 rounded-full">사용가능</span>
                        ) : (
                          <span className="text-[10px] font-semibold text-amber-300 bg-amber-400/10 border border-amber-400/25 px-1.5 py-0.5 rounded-full">준비중</span>
                        )}
                      </div>
                      <p className="text-sm text-slate-400 mt-1 leading-relaxed">{t.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <p className="text-center text-xs text-slate-500 pt-2">
            엔진은 <b className="text-slate-400">판매자 카탈로그(엑셀)</b> 하나로 돕니다 — 뭐가 팔리는지는 자료가 답을 갖고 있고, 남은 건 <b className="text-slate-400">국내가 발굴</b>뿐.
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}
