import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState, useMemo } from "react";
import {
  Plus, Trash2, Pencil, Check, X, Star,
  Key, Shield, TestTube, Sparkles, ShoppingBag,
  CheckCircle, XCircle, AlertCircle, Clock,
  Eye, EyeOff, Copy, ExternalLink, Link2,
  TrendingUp, BarChart3, ChevronLeft, ChevronRight,
  Settings, RefreshCw, ArrowRightLeft, Calendar,
  Trophy, Target, Zap, DollarSign, Package,
  ArrowUpRight, ArrowDownRight, Minus,
  Download, CloudDownload, Loader2,
} from "lucide-react";

// ==================== Helpers ====================
function formatNum(n: number | string): string { return Number(n).toLocaleString("ko-KR"); }
function formatDate(d: Date | string | null): string {
  if (!d) return "-";
  // drizzle mode:"string"으로 KST 문자열("2026-03-07 19:53:10")이 그대로 옴
  const s = String(d);
  // "YYYY-MM-DD HH:MM:SS" 형태를 한국어로 변환
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (m) {
    const [, y, mo, day, hh, mm, ss] = m;
    const h = Number(hh);
    const ampm = h < 12 ? "오전" : "오후";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${Number(y)}. ${Number(mo)}. ${Number(day)}. ${ampm} ${h12}:${mm}:${ss}`;
  }
  // fallback: ISO format 등
  return new Date(d).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}
function maskKey(key: string | null): string { if (!key) return "-"; if (key.length <= 12) return key.slice(0, 4) + "****" + key.slice(-4); return key.slice(0, 8) + "..." + key.slice(-4); }

// ★ KST 기준 날짜 계산 (UTC toISOString은 한국 시간과 하루 어긋남 위험)
function toKSTDateStr(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}
const TODAY = toKSTDateStr(new Date());
const YESTERDAY = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return toKSTDateStr(d); })();

function getWeekRange(d: Date = new Date()) {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay();
  const mon = new Date(kst); mon.setUTCDate(kst.getUTCDate() - (day === 0 ? 6 : day - 1));
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
  return { start: mon.toISOString().slice(0, 10), end: sun.toISOString().slice(0, 10) };
}
function getMonthRange(d: Date = new Date()) {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear(), m = kst.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${y}-${String(m).padStart(2, "0")}-01`, end: `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}` };
}

type ViewTab = "dashboard" | "mappings" | "sales" | "report" | "settings";

const apiStatusBadge = (status: string) => {
  switch (status) {
    case "active": return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]"><CheckCircle className="w-3 h-3 mr-1" />OK</Badge>;
    case "error": return <Badge className="bg-red-50 text-red-700 border-red-200 text-[10px]"><XCircle className="w-3 h-3 mr-1" />ERR</Badge>;
    case "expired": return <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]"><Clock className="w-3 h-3 mr-1" />EXP</Badge>;
    default: return <Badge className="bg-gray-100 text-gray-600 border-gray-200 text-[10px]"><AlertCircle className="w-3 h-3 mr-1" />N/A</Badge>;
  }
};

function ProfitBadge({ value }: { value: number }) {
  if (value > 0) return <Badge className="bg-emerald-50 text-emerald-600 border-emerald-200 text-[10px]"><ArrowUpRight className="w-3 h-3 mr-0.5" />+{formatNum(value)}</Badge>;
  if (value < 0) return <Badge className="bg-red-50 text-red-500 border-red-200 text-[10px]"><ArrowDownRight className="w-3 h-3 mr-0.5" />{formatNum(value)}</Badge>;
  return <Badge className="bg-gray-50 text-gray-400 border-gray-200 text-[10px]"><Minus className="w-3 h-3 mr-0.5" />0</Badge>;
}

// Mini bar chart for trend visualization
function MiniBar({ values, color = "pink" }: { values: number[]; color?: string }) {
  if (values.length === 0) return <span className="text-[10px] text-muted-foreground">-</span>;
  const max = Math.max(...values, 1);
  const colors: Record<string, string> = {
    pink: "bg-pink-400", blue: "bg-blue-400", emerald: "bg-emerald-400", purple: "bg-purple-400",
  };
  return (
    <div className="flex items-end gap-[2px] h-6">
      {values.slice(-14).map((v, i) => (
        <div key={i} className={`w-[4px] rounded-t-sm ${colors[color] || "bg-pink-400"} transition-all`}
          style={{ height: `${Math.max((v / max) * 100, 4)}%`, opacity: 0.4 + (i / values.length) * 0.6 }}
          title={`${formatNum(v)}`} />
      ))}
    </div>
  );
}

// ==================== Main ====================
export default function CoupangManager() {
  const utils = trpc.useUtils();
  const { data: accounts, isLoading } = trpc.coupang.listAccounts.useQuery();
  const [activeAccountId, setActiveAccountId] = useState<number | null>(null);
  const [viewTab, setViewTab] = useState<ViewTab>("dashboard");
  const [salesDate, setSalesDate] = useState(TODAY);

  // Report dates
  const thisWeek = useMemo(() => getWeekRange(), []);
  const thisMonth = useMemo(() => getMonthRange(), []);
  const [reportRange, setReportRange] = useState<"week" | "month" | "custom">("week");
  const [customStart, setCustomStart] = useState(thisWeek.start);
  const [customEnd, setCustomEnd] = useState(thisWeek.end);
  const reportDates = useMemo(() => {
    if (reportRange === "week") return thisWeek;
    if (reportRange === "month") return thisMonth;
    return { start: customStart, end: customEnd };
  }, [reportRange, thisWeek, thisMonth, customStart, customEnd]);

  // Forms
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<number | null>(null);
  const [showMappingForm, setShowMappingForm] = useState(false);
  const [editingMappingId, setEditingMappingId] = useState<number | null>(null);
  const [showSecret, setShowSecret] = useState<Record<number, boolean>>({});
  const [accForm, setAccForm] = useState({ accountName: "", vendorId: "", accessKey: "", secretKey: "", wingLoginId: "", companyName: "", apiUrl: "", ipAddress: "", memo: "", isDefault: false });
  const [mapForm, setMapForm] = useState({ internalProductId: "", sellerProductId: "", vendorItemId: "", coupangProductName: "", coupangUrl: "", memo: "" });
  const [editingSales, setEditingSales] = useState<Record<number, { qty: string; grossSales: string; orderCount: string; adSpend: string }>>({});
  const [editingSettle, setEditingSettle] = useState<Record<number, { grossAmount: string; commissionAmount: string; shippingAmount: string }>>({});

  // Auto-select first account
  if (accounts && accounts.length > 0 && activeAccountId === null && !showAccountForm) {
    setActiveAccountId(accounts[0].id);
  }
  const activeAccount = accounts?.find(a => a.id === activeAccountId) || null;

  // ========== Queries ==========
  const { data: dashboard } = trpc.coupang.accountDashboard.useQuery(
    { accountId: activeAccountId! }, { enabled: !!activeAccountId }
  );
  const { data: mappings } = trpc.coupang.listMappings.useQuery(
    { accountId: activeAccountId! }, { enabled: !!activeAccountId }
  );
  const { data: internalProducts } = trpc.coupang.listInternalProducts.useQuery(
    undefined, { enabled: showMappingForm }
  );
  const { data: dailySalesData } = trpc.coupang.getDailySales.useQuery(
    { accountId: activeAccountId!, date: salesDate },
    { enabled: !!activeAccountId && viewTab === "sales" }
  );
  const { data: periodTrend } = trpc.coupang.periodTrend.useQuery(
    { accountId: activeAccountId!, startDate: reportDates.start, endDate: reportDates.end },
    { enabled: !!activeAccountId && viewTab === "report" }
  );
  const { data: productRanking } = trpc.coupang.productRanking.useQuery(
    { accountId: activeAccountId!, startDate: reportDates.start, endDate: reportDates.end },
    { enabled: !!activeAccountId && (viewTab === "report" || viewTab === "dashboard") }
  );
  const { data: syncJobs } = trpc.coupang.listSyncJobs.useQuery(
    { accountId: activeAccountId! },
    { enabled: !!activeAccountId && (viewTab === "settings" || viewTab === "dashboard") }
  );

  // ========== Mutations ==========
  const createAccMut = trpc.coupang.createAccount.useMutation({ onSuccess: () => { toast.success("계정 추가 완료!"); resetAccForm(); utils.coupang.listAccounts.invalidate(); }, onError: e => toast.error(e.message) });
  const updateAccMut = trpc.coupang.updateAccount.useMutation({ onSuccess: () => { toast.success("수정 완료"); resetAccForm(); utils.coupang.listAccounts.invalidate(); }, onError: e => toast.error(e.message) });
  const deleteAccMut = trpc.coupang.deleteAccount.useMutation({ onSuccess: () => { toast.success("삭제됨"); utils.coupang.listAccounts.invalidate(); setActiveAccountId(null); }, onError: e => toast.error(e.message) });
  const testApiMut = trpc.coupang.testApi.useMutation({ onSuccess: r => { toast.success(r.message); utils.coupang.listAccounts.invalidate(); }, onError: e => toast.error(e.message) });
  const testApisMut = trpc.coupang.testApis.useMutation({
    onSuccess: r => {
      const lines = [`정산: ${r.results.settlement}`, `매출: ${r.results.revenue}`, `주문: ${r.results.ordersheets}`];
      if (r.success) toast.success("모든 API 정상!\n" + lines.join("\n"));
      else toast.warning("일부 API 실패:\n" + lines.join("\n"));
      utils.coupang.listAccounts.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const setDefaultMut = trpc.coupang.setDefault.useMutation({ onSuccess: () => { toast.success("기본 계정 변경됨"); utils.coupang.listAccounts.invalidate(); }, onError: e => toast.error(e.message) });

  const createMapMut = trpc.coupang.createMapping.useMutation({ onSuccess: () => { toast.success("매핑 추가!"); resetMapForm(); utils.coupang.listMappings.invalidate(); utils.coupang.accountDashboard.invalidate(); }, onError: e => toast.error(e.message) });
  const updateMapMut = trpc.coupang.updateMapping.useMutation({ onSuccess: () => { toast.success("매핑 수정 완료"); resetMapForm(); utils.coupang.listMappings.invalidate(); }, onError: e => toast.error(e.message) });
  const deleteMapMut = trpc.coupang.deleteMapping.useMutation({ onSuccess: () => { toast.success("매핑 삭제됨"); utils.coupang.listMappings.invalidate(); utils.coupang.accountDashboard.invalidate(); }, onError: e => toast.error(e.message) });
  const upsertSaleMut = trpc.coupang.upsertDailySale.useMutation({ onSuccess: () => { utils.coupang.getDailySales.invalidate(); utils.coupang.accountDashboard.invalidate(); }, onError: e => toast.error(e.message) });
  const upsertSettleMut = trpc.coupang.upsertSettlement.useMutation({ onSuccess: () => { utils.coupang.getDailySales.invalidate(); utils.coupang.accountDashboard.invalidate(); }, onError: e => toast.error(e.message) });

  // ========== Sync Mutations ==========
  const syncOrdersMut = trpc.coupang.syncOrders.useMutation({
    onSuccess: (r) => { toast.success(r.message); utils.coupang.getDailySales.invalidate(); utils.coupang.accountDashboard.invalidate(); utils.coupang.listMappings.invalidate(); utils.coupang.listSyncJobs.invalidate(); utils.coupang.listAccounts.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const syncSalesDetailMut = trpc.coupang.syncSalesDetail.useMutation({
    onSuccess: (r) => { toast.success(r.message); utils.coupang.getDailySales.invalidate(); utils.coupang.accountDashboard.invalidate(); utils.coupang.listMappings.invalidate(); utils.coupang.listSyncJobs.invalidate(); utils.coupang.listAccounts.invalidate(); utils.coupang.periodTrend.invalidate(); utils.coupang.productRanking.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const syncSettlementsMut = trpc.coupang.syncSettlements.useMutation({
    onSuccess: (r) => { toast.success(r.message); utils.coupang.accountDashboard.invalidate(); utils.coupang.listSyncJobs.invalidate(); utils.coupang.listAccounts.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const syncAllMut = trpc.coupang.syncAll.useMutation({
    onSuccess: (r) => {
      if (r.hasError) toast.warning(r.message);
      else toast.success(r.message);
      utils.coupang.getDailySales.invalidate(); utils.coupang.accountDashboard.invalidate(); utils.coupang.listMappings.invalidate(); utils.coupang.listSyncJobs.invalidate(); utils.coupang.listAccounts.invalidate(); utils.coupang.periodTrend.invalidate(); utils.coupang.productRanking.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const isSyncing = syncOrdersMut.isPending || syncSalesDetailMut.isPending || syncSettlementsMut.isPending || syncAllMut.isPending;

  // Sync date range state
  const [syncDateFrom, setSyncDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return toKSTDateStr(d);
  });
  const [syncDateTo, setSyncDateTo] = useState(TODAY);
  const [syncSettleMonth, setSyncSettleMonth] = useState(() => {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;
  });

  // ========== Form helpers ==========
  const resetAccForm = () => { setAccForm({ accountName: "", vendorId: "", accessKey: "", secretKey: "", wingLoginId: "", companyName: "", apiUrl: "", ipAddress: "", memo: "", isDefault: false }); setEditingAccountId(null); setShowAccountForm(false); };
  const resetMapForm = () => { setMapForm({ internalProductId: "", sellerProductId: "", vendorItemId: "", coupangProductName: "", coupangUrl: "", memo: "" }); setEditingMappingId(null); setShowMappingForm(false); };
  const loadAccForEdit = (a: any) => { setEditingAccountId(a.id); setAccForm({ accountName: a.accountName || "", vendorId: a.vendorId || "", accessKey: a.accessKey || "", secretKey: a.secretKey || "", wingLoginId: a.wingLoginId || "", companyName: a.companyName || "", apiUrl: a.apiUrl || "", ipAddress: a.ipAddress || "", memo: a.memo || "", isDefault: a.isDefault || false }); setShowAccountForm(true); setViewTab("settings"); };
  const loadMapForEdit = (m: any) => { setEditingMappingId(m.id); setMapForm({ internalProductId: m.internalProductId ? String(m.internalProductId) : "", sellerProductId: m.sellerProductId || "", vendorItemId: m.vendorItemId || "", coupangProductName: m.coupangProductName || "", coupangUrl: m.coupangUrl || "", memo: m.memo || "" }); setShowMappingForm(true); };

  const handleAccSubmit = () => {
    if (!accForm.accountName.trim()) { toast.error("계정 이름을 입력해주세요"); return; }
    if (editingAccountId) updateAccMut.mutate({ id: editingAccountId, ...accForm });
    else createAccMut.mutate(accForm);
  };
  const handleMapSubmit = () => {
    if (!activeAccountId) return;
    const payload = {
      internalProductId: mapForm.internalProductId ? Number(mapForm.internalProductId) : undefined,
      sellerProductId: mapForm.sellerProductId || undefined,
      vendorItemId: mapForm.vendorItemId || undefined,
      coupangProductName: mapForm.coupangProductName || undefined,
      coupangUrl: mapForm.coupangUrl || undefined,
      memo: mapForm.memo || undefined,
    };
    if (editingMappingId) updateMapMut.mutate({ id: editingMappingId, ...payload });
    else createMapMut.mutate({ accountId: activeAccountId, ...payload });
  };

  const handleSaveSale = (mappingId: number) => {
    if (!activeAccountId) return;
    const s = editingSales[mappingId];
    if (!s) return;
    upsertSaleMut.mutate({ accountId: activeAccountId, mappingId, date: salesDate, quantity: Number(s.qty) || 0, grossSales: Number(s.grossSales) || 0, orderCount: Number(s.orderCount) || 0, adSpend: Number(s.adSpend) || 0 });
    toast.success("판매 데이터 저장");
  };
  const handleSaveSettle = (mappingId: number) => {
    if (!activeAccountId) return;
    const s = editingSettle[mappingId];
    if (!s) return;
    upsertSettleMut.mutate({ accountId: activeAccountId, mappingId, date: salesDate, grossAmount: Number(s.grossAmount) || 0, commissionAmount: Number(s.commissionAmount) || 0, shippingAmount: Number(s.shippingAmount) || 0 });
    toast.success("정산 데이터 저장");
  };

  const handleCopy = (text: string, label: string) => { navigator.clipboard.writeText(text); toast.success(`${label} 복사됨`); };
  const shiftDate = (days: number) => { const d = new Date(salesDate + "T00:00:00+09:00"); d.setDate(d.getDate() + days); setSalesDate(toKSTDateStr(d)); };

  // ==================== Loading ====================
  if (isLoading) {
    return (<DashboardLayout><div className="flex flex-col items-center justify-center h-64 gap-3"><div className="cute-dots"><div className="cute-dot" /><div className="cute-dot" /><div className="cute-dot" /></div><p className="text-sm text-pink-400">로딩중...</p></div></DashboardLayout>);
  }

  // ==================== Render ====================
  return (
    <DashboardLayout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight gradient-text flex items-center gap-2">
              <span className="text-2xl">&#x1F4CA;</span> 쿠팡 분석
            </h1>
            <p className="text-muted-foreground text-sm mt-1">경영판단 &middot; 손익분석 &middot; 판매추적 &mdash; 운영은 쿠팡윙에서</p>
          </div>
          <Button onClick={() => { resetAccForm(); setShowAccountForm(true); setViewTab("settings"); }} className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white rounded-xl shadow-md shadow-pink-200/40">
            <Plus className="h-4 w-4 mr-1.5" /> 계정 추가
          </Button>
        </div>

        {/* Account Tabs */}
        {accounts && accounts.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {accounts.map(acc => (
              <button key={acc.id} onClick={() => { setActiveAccountId(acc.id); setShowAccountForm(false); setViewTab("dashboard"); }}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap shrink-0 ${
                  activeAccountId === acc.id && !showAccountForm ? "bg-white text-pink-700 shadow-md border border-pink-200" : "bg-gradient-to-r from-pink-50/60 to-purple-50/60 text-muted-foreground hover:text-pink-600 border border-transparent hover:border-pink-100"
                }`}>
                <ShoppingBag className={`h-3.5 w-3.5 ${activeAccountId === acc.id ? "text-pink-500" : "text-muted-foreground"}`} />
                {acc.accountName}
                {acc.isDefault ? <Star className="h-3 w-3 text-amber-400 fill-amber-400" /> : null}
                {apiStatusBadge(acc.apiStatus)}
              </button>
            ))}
          </div>
        ) : null}

        {/* Empty */}
        {(!accounts || accounts.length === 0) && !showAccountForm ? (
          <Card className="pretty-card"><CardContent className="pt-8 pb-8 text-center">
            <ShoppingBag className="h-12 w-12 mx-auto mb-4 text-pink-300" />
            <h3 className="text-lg font-semibold gradient-text mb-2">쿠팡 계정을 등록하세요</h3>
            <p className="text-sm text-muted-foreground mb-4">OPEN API 키를 등록하면 판매 데이터를 분석할 수 있습니다.</p>
            <Button onClick={() => { resetAccForm(); setShowAccountForm(true); }} className="bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl"><Plus className="h-4 w-4 mr-1.5" /> 첫 번째 계정 등록</Button>
          </CardContent></Card>
        ) : null}

        {/* View Tab Nav */}
        {activeAccount && !showAccountForm ? (
          <div className="flex gap-1 bg-gradient-to-r from-pink-50/80 to-purple-50/80 p-1 rounded-xl border border-pink-100/40">
            {([
              { key: "dashboard" as ViewTab, label: "대시보드", icon: BarChart3 },
              { key: "mappings" as ViewTab, label: "상품 매핑", icon: ArrowRightLeft },
              { key: "sales" as ViewTab, label: "판매/정산", icon: TrendingUp },
              { key: "report" as ViewTab, label: "리포트", icon: Trophy },
              { key: "settings" as ViewTab, label: "설정", icon: Settings },
            ]).map(tab => (
              <button key={tab.key} onClick={() => { setViewTab(tab.key); setShowMappingForm(false); }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all flex-1 justify-center ${
                  viewTab === tab.key ? "bg-white text-pink-700 shadow-sm" : "text-muted-foreground hover:text-pink-600"
                }`}>
                <tab.icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>
        ) : null}

        {/* ===== DASHBOARD TAB ===== */}
        {activeAccount && viewTab === "dashboard" && !showAccountForm ? (
          <div className="space-y-4">

            {/* Period summary cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {([
                { key: "daily" as const, label: "오늘", emoji: "\uD83D\uDCC5", gradient: "from-blue-400 to-cyan-400" },
                { key: "weekly" as const, label: "이번 주", emoji: "\uD83D\uDCCA", gradient: "from-purple-400 to-pink-400" },
                { key: "monthly" as const, label: "이번 달", emoji: "\uD83D\uDDD3\uFE0F", gradient: "from-emerald-400 to-teal-400" },
              ]).map(period => {
                const d = dashboard?.[period.key];
                const payout = d?.payout || 0;
                const grossSales = d?.grossSales || 0;
                const adSpend = d?.adSpend || 0;
                const commission = d?.commission || 0;
                const netProfit = payout - adSpend;
                const marginRate = grossSales > 0 ? Math.round((netProfit / grossSales) * 10000) / 100 : 0;
                return (
                  <Card key={period.key} className="pretty-card overflow-hidden group hover:shadow-lg transition-shadow">
                    <div className={`h-1 bg-gradient-to-r ${period.gradient}`} />
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1"><span>{period.emoji}</span> {period.label}</span>
                        <ProfitBadge value={netProfit} />
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-baseline"><span className="text-xs text-muted-foreground">판매량</span><span className="text-lg font-bold gradient-text">{formatNum(d?.qty || 0)}<span className="text-xs font-normal text-muted-foreground ml-0.5">개</span></span></div>
                        <div className="flex justify-between items-baseline"><span className="text-xs text-muted-foreground">매출</span><span className="text-sm font-semibold text-blue-600">{formatNum(grossSales)}<span className="text-xs font-normal ml-0.5">원</span></span></div>
                        <div className="flex justify-between items-baseline"><span className="text-xs text-muted-foreground">수수료</span><span className="text-xs text-amber-600">-{formatNum(commission)}</span></div>
                        <div className="flex justify-between items-baseline"><span className="text-xs text-muted-foreground">실정산</span><span className="text-sm font-semibold text-purple-600">{formatNum(payout)}<span className="text-xs font-normal ml-0.5">원</span></span></div>
                        <div className="flex justify-between items-baseline"><span className="text-xs text-muted-foreground">광고비</span><span className="text-sm font-semibold text-amber-600">-{formatNum(adSpend)}<span className="text-xs font-normal ml-0.5">원</span></span></div>
                        <div className="border-t border-pink-100/40 pt-1.5 mt-1.5">
                          <div className="flex justify-between items-baseline">
                            <span className="text-xs font-medium text-muted-foreground">순이익</span>
                            <div className="text-right">
                              <span className={`text-base font-bold ${netProfit >= 0 ? "text-emerald-600" : "text-red-500"}`}>{netProfit >= 0 ? "+" : ""}{formatNum(netProfit)}<span className="text-xs font-normal ml-0.5">원</span></span>
                              {marginRate !== 0 ? <span className={`text-[10px] ml-1 ${marginRate >= 0 ? "text-emerald-500" : "text-red-400"}`}>({marginRate}%)</span> : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Quick stat row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card className="pretty-card"><CardContent className="py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-100 to-cyan-100 flex items-center justify-center"><Link2 className="h-4 w-4 text-blue-500" /></div>
                <div><p className="text-[10px] text-muted-foreground">매핑 상품</p><p className="text-lg font-bold gradient-text">{dashboard?.mappingCount || 0}</p></div>
              </CardContent></Card>
              <Card className="pretty-card"><CardContent className="py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-100 to-green-100 flex items-center justify-center"><CheckCircle className="h-4 w-4 text-emerald-500" /></div>
                <div><p className="text-[10px] text-muted-foreground">활성 상품</p><p className="text-lg font-bold text-emerald-600">{dashboard?.activeMappingCount || 0}</p></div>
              </CardContent></Card>
              <Card className="pretty-card"><CardContent className="py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-100 to-pink-100 flex items-center justify-center"><Target className="h-4 w-4 text-purple-500" /></div>
                <div><p className="text-[10px] text-muted-foreground">ROAS (월)</p><p className="text-lg font-bold text-purple-600">{dashboard?.monthly?.adSpend && Number(dashboard.monthly.adSpend) > 0 ? (Number(dashboard.monthly.grossSales) / Number(dashboard.monthly.adSpend)).toFixed(1) + "x" : "-"}</p></div>
              </CardContent></Card>
              <Card className="pretty-card"><CardContent className="py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center"><Zap className="h-4 w-4 text-amber-500" /></div>
                <div><p className="text-[10px] text-muted-foreground">수수료율 (월)</p><p className="text-lg font-bold text-amber-600">{dashboard?.monthly?.grossSales && Number(dashboard.monthly.grossSales) > 0 ? (Number(dashboard.monthly.commission) / Number(dashboard.monthly.grossSales) * 100).toFixed(1) + "%" : "-"}</p></div>
              </CardContent></Card>
            </div>

            {/* ★ 전체 동기화 — 대시보드 최상단 눈에 띄는 카드 */}
            <Card className="pretty-card overflow-hidden border-2 border-amber-200/60">
              <div className="h-2 bg-gradient-to-r from-amber-400 via-orange-500 to-red-500" />
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-100 to-orange-200 flex items-center justify-center shrink-0">
                      <Zap className="h-5 w-5 text-amber-600" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-amber-800">전체 동기화</span>
                        {activeAccount?.apiStatus === "active" ? (
                          <Badge className="bg-emerald-50 text-emerald-600 border-emerald-200 text-[10px]"><CheckCircle className="w-3 h-3 mr-0.5" />API 연결됨</Badge>
                        ) : (
                          <Badge className="bg-amber-50 text-amber-600 border-amber-200 text-[10px]"><AlertCircle className="w-3 h-3 mr-0.5" />API 테스트 필요</Badge>
                        )}
                        {isSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" /> : null}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">주문 + 매출상세 + 정산을 한번에 수집</p>
                    </div>
                  </div>
                  <Button
                    disabled={isSyncing || activeAccount?.apiStatus !== "active"}
                    onClick={() => {
                      if (!activeAccountId) return;
                      syncAllMut.mutate({ accountId: activeAccountId, dateFrom: syncDateFrom, dateTo: syncDateTo });
                    }}
                    className="bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 hover:from-amber-600 hover:via-orange-600 hover:to-red-600 text-white rounded-2xl text-sm h-10 px-6 shadow-lg shadow-amber-300/50 font-bold tracking-wide transition-all hover:scale-[1.02]">
                    {syncAllMut.isPending ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> 동기화 중...</> : <><Zap className="h-4 w-4 mr-1.5" /> 전체 동기화</>}
                  </Button>
                </div>
                <div className="mt-3 flex items-center gap-3 flex-wrap">
                  <span className="text-xs font-semibold text-amber-700 flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> 기간</span>
                  <Input type="date" value={syncDateFrom} onChange={e => setSyncDateFrom(e.target.value)} className="pretty-input rounded-xl text-sm h-8 w-[140px] border-amber-200 font-medium" />
                  <span className="text-sm text-amber-600 font-bold">~</span>
                  <Input type="date" value={syncDateTo} onChange={e => setSyncDateTo(e.target.value)} max={TODAY} className="pretty-input rounded-xl text-sm h-8 w-[140px] border-amber-200 font-medium" />
                </div>
                {syncDateTo >= TODAY ? (
                  <p className="text-[10px] text-amber-600 mt-2 flex items-center gap-1"><AlertCircle className="h-3 w-3 shrink-0" /> 매출 상세는 전일({YESTERDAY})까지만 조회됩니다.</p>
                ) : null}
                {activeAccount?.apiStatus !== "active" ? (
                  <p className="text-[10px] text-red-600 mt-1 flex items-center gap-1"><AlertCircle className="h-3 w-3 shrink-0" /> <button onClick={() => setViewTab("settings")} className="underline font-semibold">설정</button>에서 API 테스트 먼저 실행하세요</p>
                ) : null}
              </CardContent>
            </Card>

            {/* 개별 동기화 패널 */}
            <Card className="pretty-card overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-blue-300 via-purple-300 to-emerald-300" />
              <CardHeader className="pb-2">
                <CardTitle className="text-sm gradient-text-soft flex items-center gap-2">
                  <CloudDownload className="h-4 w-4 text-cyan-500" /> 개별 동기화
                </CardTitle>
                <CardDescription className="text-[10px] text-muted-foreground">특정 유형만 개별적으로 동기화할 수 있습니다.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* 주문 동기화 */}
                  <div className="p-3 rounded-xl bg-gradient-to-br from-blue-50/80 to-cyan-50/80 border border-blue-100/50 space-y-2 min-w-0">
                    <p className="text-xs font-semibold text-blue-700 flex items-center gap-1.5"><Download className="h-3.5 w-3.5 text-blue-500" /> 주문 동기화</p>
                    <p className="text-[10px] text-blue-600/70">쿠팡 주문 데이터에서 판매량을 가져옵니다</p>
                    <div className="flex gap-1 items-center">
                      <Input type="date" value={syncDateFrom} onChange={e => setSyncDateFrom(e.target.value)} className="pretty-input rounded-lg text-[10px] h-7 flex-1 min-w-0" />
                      <span className="text-[10px] text-muted-foreground leading-7 shrink-0">~</span>
                      <Input type="date" value={syncDateTo} onChange={e => setSyncDateTo(e.target.value)} className="pretty-input rounded-lg text-[10px] h-7 flex-1 min-w-0" />
                    </div>
                    <Button size="sm" disabled={isSyncing || activeAccount?.apiStatus !== "active"}
                      onClick={() => activeAccountId && syncOrdersMut.mutate({ accountId: activeAccountId, dateFrom: syncDateFrom, dateTo: syncDateTo })}
                      className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg text-xs h-8">
                      {syncOrdersMut.isPending ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> 동기화 중...</> : <><RefreshCw className="h-3 w-3 mr-1" /> 주문만 가져오기</>}
                    </Button>
                  </div>

                  {/* 매출 상세 동기화 */}
                  <div className="p-3 rounded-xl bg-gradient-to-br from-purple-50/80 to-pink-50/80 border border-purple-100/50 space-y-2 min-w-0">
                    <p className="text-xs font-semibold text-purple-700 flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5 text-purple-500" /> 매출 상세 동기화</p>
                    <p className="text-[10px] text-purple-600/70">매출 인식 기준 판매+정산 데이터를 가져옵니다</p>
                    <div className="flex gap-1 items-center">
                      <Input type="date" value={syncDateFrom} onChange={e => setSyncDateFrom(e.target.value)} className="pretty-input rounded-lg text-[10px] h-7 flex-1 min-w-0" />
                      <span className="text-[10px] text-muted-foreground leading-7 shrink-0">~</span>
                      <Input type="date" value={syncDateTo} onChange={e => setSyncDateTo(e.target.value)} className="pretty-input rounded-lg text-[10px] h-7 flex-1 min-w-0" />
                    </div>
                    <Button size="sm" disabled={isSyncing || activeAccount?.apiStatus !== "active"}
                      onClick={() => {
                        if (!activeAccountId) return;
                        // Auto-clamp dateTo to yesterday for sales detail
                        const safeDate = syncDateTo >= TODAY ? YESTERDAY : syncDateTo;
                        syncSalesDetailMut.mutate({ accountId: activeAccountId, dateFrom: syncDateFrom, dateTo: safeDate });
                      }}
                      className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg text-xs h-8">
                      {syncSalesDetailMut.isPending ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> 동기화 중...</> : <><RefreshCw className="h-3 w-3 mr-1" /> 매출 상세 가져오기</>}
                    </Button>
                    {syncDateTo >= TODAY ? <p className="text-[9px] text-purple-500/70">* 전일까지 자동 보정됨</p> : null}
                  </div>

                  {/* 정산 내역 동기화 */}
                  <div className="p-3 rounded-xl bg-gradient-to-br from-emerald-50/80 to-teal-50/80 border border-emerald-100/50 space-y-2">
                    <p className="text-xs font-semibold text-emerald-700 flex items-center gap-1.5"><DollarSign className="h-3.5 w-3.5 text-emerald-500" /> 정산 내역 동기화</p>
                    <p className="text-[10px] text-emerald-600/70">월별 정산 요약 데이터를 가져옵니다</p>
                    <div>
                      <Input type="month" value={syncSettleMonth} onChange={e => setSyncSettleMonth(e.target.value)} className="pretty-input rounded-lg text-[10px] h-7" />
                    </div>
                    <Button size="sm" disabled={isSyncing || activeAccount?.apiStatus !== "active"}
                      onClick={() => activeAccountId && syncSettlementsMut.mutate({ accountId: activeAccountId, yearMonth: syncSettleMonth })}
                      className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-lg text-xs h-8">
                      {syncSettlementsMut.isPending ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> 동기화 중...</> : <><RefreshCw className="h-3 w-3 mr-1" /> 정산 가져오기</>}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Top products mini ranking */}
            {productRanking && productRanking.items.length > 0 ? (
              <Card className="pretty-card overflow-hidden">
                <div className="h-1 bg-gradient-to-r from-amber-300 via-orange-300 to-red-300" />
                <CardHeader className="pb-2"><CardTitle className="text-sm gradient-text-soft flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-amber-500" /> 상품별 성과 TOP 5
                  <Badge className="text-[10px] bg-pink-50 text-pink-500 border-pink-200">{reportRange === "week" ? "이번 주" : "이번 달"}</Badge>
                </CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {productRanking.items.slice(0, 5).map((item, idx) => (
                      <div key={item.mappingId} className="flex items-center gap-3 p-2.5 rounded-xl bg-gradient-to-r from-gray-50/50 to-white hover:from-pink-50/30 hover:to-white transition-colors">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                          idx === 0 ? "bg-gradient-to-br from-amber-100 to-yellow-200 text-amber-700" :
                          idx === 1 ? "bg-gradient-to-br from-gray-100 to-gray-200 text-gray-600" :
                          idx === 2 ? "bg-gradient-to-br from-orange-100 to-amber-100 text-orange-700" :
                          "bg-gray-100 text-gray-400"
                        }`}>{idx + 1}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.productName}</p>
                          <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5">
                            <span>{formatNum(item.totalQty)}개 판매</span>
                            <span>매출 {formatNum(item.totalGrossSales)}원</span>
                            {item.roas > 0 ? <span>ROAS {item.roas}x</span> : null}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <ProfitBadge value={item.netProfit} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setViewTab("report")} className="w-full mt-2 text-xs text-pink-500 hover:bg-pink-50 rounded-xl">
                    전체 리포트 보기 <ArrowUpRight className="h-3 w-3 ml-1" />
                  </Button>
                </CardContent>
              </Card>
            ) : null}

            {/* Quick nav */}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setViewTab("mappings")} className="rounded-xl text-xs border-pink-200 text-pink-600 hover:bg-pink-50"><ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" /> 상품 매핑</Button>
              <Button variant="outline" size="sm" onClick={() => setViewTab("sales")} className="rounded-xl text-xs border-emerald-200 text-emerald-600 hover:bg-emerald-50"><TrendingUp className="h-3.5 w-3.5 mr-1.5" /> 판매/정산 입력</Button>
              <Button variant="outline" size="sm" onClick={() => setViewTab("report")} className="rounded-xl text-xs border-purple-200 text-purple-600 hover:bg-purple-50"><Trophy className="h-3.5 w-3.5 mr-1.5" /> 기간 리포트</Button>
              <Button variant="outline" size="sm" onClick={() => setViewTab("settings")} className="rounded-xl text-xs border-blue-200 text-blue-600 hover:bg-blue-50"><Settings className="h-3.5 w-3.5 mr-1.5" /> API 설정</Button>
            </div>

            {/* Recent sync */}
            {dashboard?.recentJobs && dashboard.recentJobs.length > 0 ? (
              <Card className="pretty-card overflow-hidden"><div className="h-1 bg-gradient-to-r from-blue-300 to-cyan-300" />
                <CardHeader className="pb-2"><CardTitle className="text-sm gradient-text-soft flex items-center gap-2"><RefreshCw className="h-4 w-4 text-blue-500" /> 최근 동기화</CardTitle></CardHeader>
                <CardContent><div className="space-y-2">{dashboard.recentJobs.map(j => (
                  <div key={j.id} className="flex items-center justify-between p-2 rounded-lg bg-gray-50/50 text-xs">
                    <div className="flex items-center gap-2"><Badge className={`text-[10px] ${j.status === "success" ? "bg-emerald-50 text-emerald-600" : j.status === "failed" ? "bg-red-50 text-red-500" : "bg-blue-50 text-blue-600"}`}>{j.status === "success" ? "OK" : j.status === "failed" ? "ERR" : "..."}</Badge><span className="text-muted-foreground">{j.jobType}</span></div>
                    <div className="flex items-center gap-3 text-muted-foreground"><span>{j.recordCount}건</span><span>{formatDate(j.startedAt)}</span></div>
                  </div>
                ))}</div></CardContent>
              </Card>
            ) : null}

            {/* Philosophy */}
            <div className="p-3 bg-gradient-to-r from-blue-50/60 to-cyan-50/60 rounded-xl border border-blue-100/40">
              <p className="text-xs text-blue-600"><span className="font-semibold">&#x1F4A1; 시스템 역할:</span> 쿠팡윙은 운영 원장, 이 페이지는 <span className="font-semibold">분석&middot;판단&middot;손익 기록</span> 시스템입니다. 최상단 <span className="text-amber-600 font-semibold">전체 동기화</span> 카드에서 주문+매출+정산을 한번에 수집하세요.</p>
            </div>
          </div>
        ) : null}

        {/* ===== REPORT TAB ===== */}
        {activeAccount && viewTab === "report" && !showAccountForm ? (
          <div className="space-y-4">
            {/* Period selector */}
            <Card className="pretty-card"><CardContent className="py-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Calendar className="h-4 w-4 text-pink-500 shrink-0" />
                {(["week", "month", "custom"] as const).map(r => (
                  <Button key={r} variant={reportRange === r ? "default" : "outline"} size="sm"
                    onClick={() => setReportRange(r)}
                    className={`rounded-xl text-xs ${reportRange === r ? "bg-gradient-to-r from-pink-500 to-purple-500 text-white" : "border-pink-200 text-pink-600 hover:bg-pink-50"}`}>
                    {r === "week" ? "이번 주" : r === "month" ? "이번 달" : "기간 지정"}
                  </Button>
                ))}
                {reportRange === "custom" ? (
                  <>
                    <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="pretty-input rounded-xl w-36 text-xs h-8" />
                    <span className="text-xs text-muted-foreground">~</span>
                    <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="pretty-input rounded-xl w-36 text-xs h-8" />
                  </>
                ) : (
                  <Badge className="text-[10px] bg-pink-50 text-pink-600 border-pink-200 ml-auto">{reportDates.start} ~ {reportDates.end}</Badge>
                )}
              </div>
            </CardContent></Card>

            {/* Grand totals */}
            {periodTrend ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: "판매량", value: periodTrend.grandTotals.totalQty, unit: "개", color: "text-pink-600" },
                  { label: "매출", value: periodTrend.grandTotals.totalGrossSales, unit: "원", color: "text-blue-600" },
                  { label: "주문건", value: periodTrend.grandTotals.totalOrders, unit: "건", color: "text-purple-600" },
                  { label: "광고비", value: periodTrend.grandTotals.totalAdSpend, unit: "원", color: "text-amber-600" },
                  { label: "실정산", value: periodTrend.grandTotals.totalPayout, unit: "원", color: "text-emerald-600" },
                  { label: "수수료", value: periodTrend.grandTotals.totalCommission, unit: "원", color: "text-red-500" },
                ].map(item => (
                  <Card key={item.label} className="pretty-card"><CardContent className="py-3 text-center">
                    <p className="text-[10px] text-muted-foreground mb-1">{item.label}</p>
                    <p className={`text-base font-bold ${item.color}`}>{formatNum(item.value)}<span className="text-[10px] font-normal text-muted-foreground ml-0.5">{item.unit}</span></p>
                  </CardContent></Card>
                ))}
              </div>
            ) : null}

            {/* Daily trend chart (table-based) */}
            {periodTrend && periodTrend.days.length > 0 ? (
              <Card className="pretty-card overflow-hidden">
                <div className="h-1 bg-gradient-to-r from-blue-400 to-purple-400" />
                <CardHeader className="pb-2"><CardTitle className="text-sm gradient-text-soft flex items-center gap-2"><BarChart3 className="h-4 w-4 text-blue-500" /> 일별 추이</CardTitle></CardHeader>
                <CardContent><div className="overflow-x-auto">
                  {/* Mini visual bars */}
                  <div className="flex gap-4 mb-3 p-2 bg-gray-50/50 rounded-xl">
                    <div className="flex-1"><p className="text-[10px] text-muted-foreground mb-1">매출 추이</p><MiniBar values={periodTrend.days.map(d => d.grossSales)} color="blue" /></div>
                    <div className="flex-1"><p className="text-[10px] text-muted-foreground mb-1">판매량 추이</p><MiniBar values={periodTrend.days.map(d => d.qty)} color="pink" /></div>
                    <div className="flex-1"><p className="text-[10px] text-muted-foreground mb-1">정산 추이</p><MiniBar values={periodTrend.days.map(d => d.payout)} color="emerald" /></div>
                  </div>
                  <table className="w-full text-xs"><thead><tr className="bg-gradient-to-r from-pink-50/80 to-purple-50/80 border-b border-pink-100/50">
                    <th className="text-left px-2 py-2 font-medium text-pink-700">날짜</th>
                    <th className="text-right px-2 py-2 font-medium text-pink-700">판매량</th>
                    <th className="text-right px-2 py-2 font-medium text-pink-700">매출</th>
                    <th className="text-right px-2 py-2 font-medium text-pink-700">주문건</th>
                    <th className="text-right px-2 py-2 font-medium text-pink-700">광고비</th>
                    <th className="text-right px-2 py-2 font-medium text-blue-700 border-l border-pink-200">정산</th>
                    <th className="text-right px-2 py-2 font-medium text-blue-700">수수료</th>
                    <th className="text-right px-2 py-2 font-medium text-emerald-700 border-l border-pink-200">순이익</th>
                  </tr></thead><tbody>
                    {periodTrend.days.map(day => {
                      const net = day.payout - day.adSpend;
                      const weekday = new Date(day.date).toLocaleDateString("ko-KR", { weekday: "short" });
                      const isWeekend = ["토", "일"].includes(weekday);
                      return (
                        <tr key={day.date} className={`border-b border-pink-50/80 hover:bg-pink-50/20 transition-colors ${isWeekend ? "bg-blue-50/20" : ""}`}>
                          <td className="px-2 py-1.5 font-medium">{day.date.slice(5)} <span className={`text-[10px] ${isWeekend ? "text-blue-400" : "text-muted-foreground"}`}>({weekday})</span></td>
                          <td className="px-2 py-1.5 text-right font-mono">{formatNum(day.qty)}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-blue-600">{formatNum(day.grossSales)}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{formatNum(day.orders)}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-amber-600">{day.adSpend > 0 ? formatNum(day.adSpend) : "-"}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-purple-600 border-l border-pink-100">{day.payout > 0 ? formatNum(day.payout) : "-"}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-red-400">{day.commission > 0 ? formatNum(day.commission) : "-"}</td>
                          <td className={`px-2 py-1.5 text-right font-mono font-semibold border-l border-pink-100 ${net > 0 ? "text-emerald-600" : net < 0 ? "text-red-500" : "text-gray-400"}`}>{net !== 0 ? (net > 0 ? "+" : "") + formatNum(net) : "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                    <tfoot><tr className="bg-gradient-to-r from-pink-50/80 to-purple-50/80 font-semibold border-t-2 border-pink-200">
                      <td className="px-2 py-2 text-pink-700">합계</td>
                      <td className="px-2 py-2 text-right">{formatNum(periodTrend.grandTotals.totalQty)}</td>
                      <td className="px-2 py-2 text-right text-blue-600">{formatNum(periodTrend.grandTotals.totalGrossSales)}</td>
                      <td className="px-2 py-2 text-right">{formatNum(periodTrend.grandTotals.totalOrders)}</td>
                      <td className="px-2 py-2 text-right text-amber-600">{formatNum(periodTrend.grandTotals.totalAdSpend)}</td>
                      <td className="px-2 py-2 text-right text-purple-600 border-l border-pink-200">{formatNum(periodTrend.grandTotals.totalPayout)}</td>
                      <td className="px-2 py-2 text-right text-red-400">{formatNum(periodTrend.grandTotals.totalCommission)}</td>
                      <td className={`px-2 py-2 text-right border-l border-pink-200 ${(periodTrend.grandTotals.totalPayout - periodTrend.grandTotals.totalAdSpend) >= 0 ? "text-emerald-600" : "text-red-500"}`}>{formatNum(periodTrend.grandTotals.totalPayout - periodTrend.grandTotals.totalAdSpend)}</td>
                    </tr></tfoot>
                  </table>
                </div></CardContent>
              </Card>
            ) : periodTrend ? (
              <Card className="pretty-card"><CardContent className="py-8 text-center">
                <BarChart3 className="h-10 w-10 mx-auto mb-3 text-pink-300" />
                <p className="text-sm text-muted-foreground">선택한 기간에 데이터가 없습니다</p>
                <Button size="sm" className="mt-3 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl" onClick={() => setViewTab("sales")}>판매 데이터 입력하기</Button>
              </CardContent></Card>
            ) : null}

            {/* Product ranking table */}
            {productRanking && productRanking.items.length > 0 ? (
              <Card className="pretty-card overflow-hidden">
                <div className="h-1 bg-gradient-to-r from-amber-400 to-orange-400" />
                <CardHeader className="pb-2"><CardTitle className="text-sm gradient-text-soft flex items-center gap-2"><Trophy className="h-4 w-4 text-amber-500" /> 상품별 성과 랭킹</CardTitle></CardHeader>
                <CardContent><div className="overflow-x-auto">
                  <table className="w-full text-xs"><thead><tr className="bg-gradient-to-r from-amber-50/80 to-orange-50/80 border-b border-amber-100/50">
                    <th className="text-center px-2 py-2 font-medium text-amber-700 w-8">#</th>
                    <th className="text-left px-2 py-2 font-medium text-amber-700">상품</th>
                    <th className="text-right px-2 py-2 font-medium text-amber-700">판매량</th>
                    <th className="text-right px-2 py-2 font-medium text-amber-700">매출</th>
                    <th className="text-right px-2 py-2 font-medium text-amber-700">광고비</th>
                    <th className="text-right px-2 py-2 font-medium text-amber-700">ROAS</th>
                    <th className="text-right px-2 py-2 font-medium text-amber-700">정산</th>
                    <th className="text-right px-2 py-2 font-medium text-amber-700">순이익</th>
                    <th className="text-center px-2 py-2 font-medium text-amber-700">일평균</th>
                  </tr></thead><tbody>
                    {productRanking.items.map((item, idx) => (
                      <tr key={item.mappingId} className="border-b border-amber-50/80 hover:bg-amber-50/20 transition-colors">
                        <td className="px-2 py-2 text-center">
                          <span className={`inline-flex items-center justify-center w-5 h-5 rounded-md text-[10px] font-bold ${
                            idx === 0 ? "bg-amber-100 text-amber-700" : idx === 1 ? "bg-gray-100 text-gray-600" : idx === 2 ? "bg-orange-100 text-orange-600" : "text-gray-400"
                          }`}>{idx + 1}</span>
                        </td>
                        <td className="px-2 py-2"><span className="font-medium text-xs truncate block max-w-[180px]">{item.productName}</span><span className="text-[10px] text-muted-foreground">{item.salesDays}일 판매</span></td>
                        <td className="px-2 py-2 text-right font-mono">{formatNum(item.totalQty)}</td>
                        <td className="px-2 py-2 text-right font-mono text-blue-600">{formatNum(item.totalGrossSales)}</td>
                        <td className="px-2 py-2 text-right font-mono text-amber-600">{item.totalAdSpend > 0 ? formatNum(item.totalAdSpend) : "-"}</td>
                        <td className="px-2 py-2 text-right"><Badge className={`text-[10px] ${item.roas >= 3 ? "bg-emerald-50 text-emerald-600" : item.roas >= 1.5 ? "bg-blue-50 text-blue-600" : item.roas > 0 ? "bg-red-50 text-red-500" : "bg-gray-50 text-gray-400"}`}>{item.roas > 0 ? item.roas + "x" : "-"}</Badge></td>
                        <td className="px-2 py-2 text-right font-mono text-purple-600">{item.totalPayout > 0 ? formatNum(item.totalPayout) : "-"}</td>
                        <td className="px-2 py-2 text-right"><ProfitBadge value={item.netProfit} /></td>
                        <td className="px-2 py-2 text-center text-muted-foreground">{item.avgDailySales}개/일</td>
                      </tr>
                    ))}
                  </tbody></table>
                </div></CardContent>
              </Card>
            ) : null}
          </div>
        ) : null}

        {/* ===== MAPPINGS TAB ===== */}
        {activeAccount && viewTab === "mappings" && !showAccountForm ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold gradient-text-soft flex items-center gap-2"><ArrowRightLeft className="h-4 w-4 text-pink-500" /> 소싱 &#x2194; 쿠팡 상품 매핑</h2>
                <p className="text-xs text-muted-foreground mt-0.5">내 소싱 상품이 쿠팡에서 어떤 상품으로 팔리는지 연결합니다</p>
              </div>
              <Button onClick={() => { resetMapForm(); setShowMappingForm(true); }} className="bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl shadow-md shadow-pink-200/40"><Plus className="h-4 w-4 mr-1.5" /> 매핑 추가</Button>
            </div>

            {/* Mapping Form */}
            {showMappingForm ? (
              <Card className="pretty-card overflow-hidden"><div className="h-1 bg-gradient-to-r from-pink-400 via-purple-400 to-fuchsia-400" />
                <CardHeader className="pb-3"><div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2"><Link2 className="h-4 w-4 text-pink-500" /><span className="gradient-text-soft">{editingMappingId ? "매핑 수정" : "새 매핑 등록"}</span></CardTitle>
                  <Button variant="ghost" size="sm" onClick={resetMapForm} className="text-muted-foreground hover:bg-pink-50 rounded-lg"><X className="h-4 w-4" /></Button>
                </div></CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-4 bg-gradient-to-r from-blue-50/80 to-cyan-50/80 rounded-xl border border-blue-100/50 space-y-3">
                    <p className="text-xs font-semibold text-blue-700 flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5 text-blue-500" /> 소싱 상품 연결 (선택)</p>
                    <div>
                      <Label className="text-xs font-medium text-muted-foreground">내 소싱 상품</Label>
                      <select value={mapForm.internalProductId} onChange={e => setMapForm(p => ({ ...p, internalProductId: e.target.value }))} className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white">
                        <option value="">연결 안함 (나중에 연결 가능)</option>
                        {internalProducts?.map(p => <option key={p.id} value={p.id}>{p.productName} {p.category ? `(${p.category})` : ""}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="p-4 bg-gradient-to-r from-pink-50/80 to-purple-50/80 rounded-xl border border-pink-100/50 space-y-3">
                    <p className="text-xs font-semibold gradient-text-soft flex items-center gap-1.5"><ShoppingBag className="h-3.5 w-3.5 text-pink-500" /> 쿠팡 상품 정보</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label className="text-xs font-medium text-muted-foreground">쿠팡 상품명</Label><Input placeholder="쿠팡에 노출되는 상품명" value={mapForm.coupangProductName} onChange={e => setMapForm(p => ({ ...p, coupangProductName: e.target.value }))} className="pretty-input rounded-xl mt-1" /></div>
                      <div><Label className="text-xs font-medium text-muted-foreground">등록상품 ID</Label><Input placeholder="셀러 상품 ID" value={mapForm.sellerProductId} onChange={e => setMapForm(p => ({ ...p, sellerProductId: e.target.value }))} className="pretty-input rounded-xl mt-1" /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label className="text-xs font-medium text-muted-foreground">벤더아이템 ID</Label><Input placeholder="옵션별 ID" value={mapForm.vendorItemId} onChange={e => setMapForm(p => ({ ...p, vendorItemId: e.target.value }))} className="pretty-input rounded-xl mt-1" /></div>
                      <div><Label className="text-xs font-medium text-muted-foreground">쿠팡 URL</Label><Input placeholder="https://www.coupang.com/..." value={mapForm.coupangUrl} onChange={e => setMapForm(p => ({ ...p, coupangUrl: e.target.value }))} className="pretty-input rounded-xl mt-1" /></div>
                    </div>
                  </div>
                  <div><Label className="text-xs font-medium text-muted-foreground">메모</Label><Textarea placeholder="메모 (선택)" value={mapForm.memo} onChange={e => setMapForm(p => ({ ...p, memo: e.target.value }))} rows={2} className="pretty-input rounded-xl mt-1" /></div>
                  <div className="flex gap-2 pt-2">
                    <Button onClick={handleMapSubmit} disabled={createMapMut.isPending || updateMapMut.isPending} className="bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl shadow-md shadow-pink-200/40"><Sparkles className="h-4 w-4 mr-1.5" />{editingMappingId ? "수정 완료" : "매핑 등록"}</Button>
                    <Button variant="ghost" onClick={resetMapForm} className="rounded-xl text-muted-foreground">취소</Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {/* Mapping list */}
            {mappings && mappings.length > 0 ? (
              <Card className="pretty-card overflow-hidden"><div className="h-1 bg-gradient-to-r from-blue-300 to-cyan-300" />
                <CardHeader className="pb-2"><CardTitle className="text-sm gradient-text-soft flex items-center gap-2"><Link2 className="h-4 w-4 text-blue-500" /> 매핑 목록 <Badge className="text-[10px] bg-pink-50 text-pink-600 border-pink-200">{mappings.length}개</Badge></CardTitle></CardHeader>
                <CardContent><div className="overflow-x-auto">
                  <table className="w-full text-sm"><thead><tr className="bg-gradient-to-r from-pink-50/80 to-purple-50/80 border-b border-pink-100/50">
                    <th className="text-left px-3 py-2 font-medium text-pink-700 text-xs">소싱 상품</th>
                    <th className="text-left px-3 py-2 font-medium text-pink-700 text-xs">쿠팡 상품명</th>
                    <th className="text-center px-3 py-2 font-medium text-pink-700 text-xs">상품 ID</th>
                    <th className="text-center px-3 py-2 font-medium text-pink-700 text-xs">벤더아이템</th>
                    <th className="text-center px-3 py-2 font-medium text-pink-700 text-xs">상태</th>
                    <th className="text-center px-3 py-2 font-medium text-pink-700 text-xs">액션</th>
                  </tr></thead><tbody>
                    {mappings.map(m => (
                      <tr key={m.id} className="border-b border-pink-50/80 hover:bg-pink-50/30 transition-colors">
                        <td className="px-3 py-2.5">{m.internalProductName ? (<><span className="font-medium text-sm truncate block max-w-[150px]">{m.internalProductName}</span>{m.internalProductCategory ? <span className="text-[10px] text-muted-foreground">{m.internalProductCategory}</span> : null}</>) : <span className="text-xs text-muted-foreground italic">미연결</span>}</td>
                        <td className="px-3 py-2.5"><div className="flex items-center gap-1">{m.coupangProductName ? <span className="text-sm truncate block max-w-[180px]">{m.coupangProductName}</span> : <span className="text-xs text-muted-foreground">-</span>}{m.coupangUrl ? <a href={m.coupangUrl} target="_blank" rel="noopener noreferrer" className="text-pink-400 hover:text-pink-600 shrink-0"><ExternalLink className="h-3 w-3" /></a> : null}</div></td>
                        <td className="px-3 py-2.5 text-center text-xs font-mono text-muted-foreground">{m.sellerProductId || "-"}</td>
                        <td className="px-3 py-2.5 text-center text-xs font-mono text-muted-foreground">{m.vendorItemId || "-"}</td>
                        <td className="px-3 py-2.5 text-center">{m.isActive ? <Badge className="text-[10px] bg-emerald-50 text-emerald-600 border-emerald-200">활성</Badge> : <Badge variant="outline" className="text-[10px] text-gray-400">비활성</Badge>}</td>
                        <td className="px-3 py-2.5"><div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-pink-50 rounded-lg" onClick={() => loadMapForEdit(m)}><Pencil className="h-3.5 w-3.5 text-pink-500" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-red-50 rounded-lg" onClick={() => { if (confirm("이 매핑을 삭제하시겠습니까?")) deleteMapMut.mutate({ id: m.id }); }}><Trash2 className="h-3.5 w-3.5 text-red-400" /></Button>
                        </div></td>
                      </tr>
                    ))}
                  </tbody></table>
                </div></CardContent>
              </Card>
            ) : !showMappingForm ? (
              <Card className="pretty-card"><CardContent className="pt-8 pb-8 text-center">
                <ArrowRightLeft className="h-10 w-10 mx-auto mb-3 text-pink-300" />
                <p className="text-sm text-muted-foreground mb-1">아직 매핑된 상품이 없습니다</p>
                <p className="text-xs text-muted-foreground mb-3">소싱 상품과 쿠팡 판매 상품을 연결하세요</p>
                <Button size="sm" className="bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl" onClick={() => { resetMapForm(); setShowMappingForm(true); }}><Plus className="h-3.5 w-3.5 mr-1" /> 매핑 추가</Button>
              </CardContent></Card>
            ) : null}

            <div className="p-3 bg-gradient-to-r from-amber-50/60 to-orange-50/60 rounded-xl border border-amber-100/40">
              <p className="text-xs text-amber-700"><span className="font-semibold">&#x1F4A1; 매핑이란?</span> 소싱한 상품(내부)이 쿠팡에서 어떤 상품 ID로 팔리는지 연결하는 것입니다. 이 연결이 있어야 <span className="font-semibold">판매량 &#x2192; 수익</span> 계산이 가능합니다.</p>
            </div>
          </div>
        ) : null}

        {/* ===== SALES TAB ===== */}
        {activeAccount && viewTab === "sales" && !showAccountForm ? (
          <div className="space-y-4">
            {/* Date selector + sync button */}
            <Card className="pretty-card"><CardContent className="py-3"><div className="flex items-center gap-3 flex-wrap">
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl hover:bg-pink-50" onClick={() => shiftDate(-1)}><ChevronLeft className="h-4 w-4 text-pink-500" /></Button>
              <Input type="date" value={salesDate} onChange={e => setSalesDate(e.target.value)} className="pretty-input rounded-xl w-40" />
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl hover:bg-pink-50" onClick={() => shiftDate(1)}><ChevronRight className="h-4 w-4 text-pink-500" /></Button>
              {salesDate !== TODAY ? <Button variant="outline" size="sm" onClick={() => setSalesDate(TODAY)} className="rounded-xl text-xs border-pink-200 text-pink-600 hover:bg-pink-50">오늘</Button> : null}
              <Badge className="bg-gradient-to-r from-pink-100 to-purple-100 text-pink-700 border-pink-200 text-xs">{new Date(salesDate).toLocaleDateString("ko-KR", { weekday: "short", month: "long", day: "numeric" })}</Badge>
              <div className="ml-auto flex gap-1.5">
                <Button variant="outline" size="sm" disabled={isSyncing || activeAccount?.apiStatus !== "active"}
                  onClick={() => {
                    if (!activeAccountId) return;
                    // revenue-history only allows up to yesterday; use orders for today
                    if (salesDate >= TODAY) {
                      syncOrdersMut.mutate({ accountId: activeAccountId, dateFrom: salesDate, dateTo: salesDate });
                    } else {
                      syncSalesDetailMut.mutate({ accountId: activeAccountId, dateFrom: salesDate, dateTo: salesDate });
                    }
                  }}
                  className="rounded-xl text-xs border-purple-200 text-purple-600 hover:bg-purple-50">
                  {(syncSalesDetailMut.isPending || syncOrdersMut.isPending) ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <CloudDownload className="h-3 w-3 mr-1" />}
                  {salesDate} 동기화 {salesDate >= TODAY ? "(주문)" : "(매출)"}
                </Button>
              </div>
            </div></CardContent></Card>

            {/* Sales summary */}
            {dailySalesData ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card className="pretty-card"><CardContent className="py-3 text-center"><p className="text-xs text-muted-foreground">판매량</p><p className="text-lg font-bold gradient-text">{formatNum(dailySalesData.totals.totalQuantity)}개</p></CardContent></Card>
                <Card className="pretty-card"><CardContent className="py-3 text-center"><p className="text-xs text-muted-foreground">매출</p><p className="text-lg font-bold text-blue-600">{formatNum(dailySalesData.totals.totalGrossSales)}원</p></CardContent></Card>
                <Card className="pretty-card"><CardContent className="py-3 text-center"><p className="text-xs text-muted-foreground">실정산</p><p className="text-lg font-bold text-purple-600">{formatNum(dailySalesData.totals.totalPayoutAmount)}원</p></CardContent></Card>
                <Card className="pretty-card"><CardContent className="py-3 text-center"><p className="text-xs text-muted-foreground">추정수익</p><p className={`text-lg font-bold ${dailySalesData.totals.totalEstimatedProfit >= 0 ? "text-emerald-600" : "text-red-500"}`}>{formatNum(dailySalesData.totals.totalEstimatedProfit)}원</p></CardContent></Card>
              </div>
            ) : null}

            {/* Sales & settlement table */}
            {dailySalesData && dailySalesData.items.length > 0 ? (
              <Card className="pretty-card overflow-hidden"><div className="h-1 bg-gradient-to-r from-emerald-300 to-cyan-300" />
                <CardHeader className="pb-2"><CardTitle className="text-sm gradient-text-soft flex items-center gap-2"><TrendingUp className="h-4 w-4 text-emerald-500" /> 상품별 판매 &middot; 정산</CardTitle>
                  <CardDescription className="text-xs text-pink-400/60">판매량/매출을 입력하면 마진 기반으로 수익이 자동 추정됩니다. Enter로 빠른 저장.</CardDescription></CardHeader>
                <CardContent><div className="overflow-x-auto">
                  <table className="w-full text-sm"><thead><tr className="bg-gradient-to-r from-pink-50/80 to-purple-50/80 border-b border-pink-100/50">
                    <th className="text-left px-2 py-2 font-medium text-pink-700 text-xs">상품</th>
                    <th className="text-center px-2 py-2 font-medium text-pink-700 text-xs w-16">수량</th>
                    <th className="text-center px-2 py-2 font-medium text-pink-700 text-xs w-24">매출</th>
                    <th className="text-center px-2 py-2 font-medium text-pink-700 text-xs w-20">주문건</th>
                    <th className="text-center px-2 py-2 font-medium text-pink-700 text-xs w-20">광고비</th>
                    <th className="text-center px-2 py-2 font-medium text-pink-700 text-xs w-10"></th>
                    <th className="text-center px-2 py-2 font-medium text-blue-700 text-xs w-24 border-l border-pink-200">정산매출</th>
                    <th className="text-center px-2 py-2 font-medium text-blue-700 text-xs w-20">수수료</th>
                    <th className="text-center px-2 py-2 font-medium text-blue-700 text-xs w-20">배송비</th>
                    <th className="text-center px-2 py-2 font-medium text-blue-700 text-xs w-10"></th>
                  </tr></thead><tbody>
                    {dailySalesData.items.map(item => {
                      const sKey = item.mappingId;
                      const sv = editingSales[sKey] || { qty: String(item.quantity), grossSales: String(item.grossSales), orderCount: String(item.orderCount), adSpend: String(item.adSpend) };
                      const stv = editingSettle[sKey] || { grossAmount: String(item.grossAmount), commissionAmount: String(item.commissionAmount), shippingAmount: String(item.shippingAmount) };
                      const displayName = item.coupangProductName || item.internalProductName || `매핑 #${item.mappingId}`;
                      return (
                        <tr key={item.mappingId} className="border-b border-pink-50/80 hover:bg-pink-50/20 transition-colors">
                          <td className="px-2 py-2">
                            <span className="font-medium text-xs truncate block max-w-[130px]">{displayName}</span>
                            {item.marginPerUnit > 0 ? <span className="text-[10px] text-emerald-500">개당 +{formatNum(item.marginPerUnit)}원</span> : null}
                          </td>
                          <td className="px-1 py-2"><Input type="number" min="0" value={sv.qty} onChange={e => setEditingSales(p => ({ ...p, [sKey]: { ...sv, qty: e.target.value } }))} onKeyDown={e => { if (e.key === "Enter") handleSaveSale(sKey); }} className="pretty-input rounded-lg h-7 text-center text-xs w-14" /></td>
                          <td className="px-1 py-2"><Input type="number" min="0" value={sv.grossSales} onChange={e => setEditingSales(p => ({ ...p, [sKey]: { ...sv, grossSales: e.target.value } }))} onKeyDown={e => { if (e.key === "Enter") handleSaveSale(sKey); }} className="pretty-input rounded-lg h-7 text-center text-xs w-22" /></td>
                          <td className="px-1 py-2"><Input type="number" min="0" value={sv.orderCount} onChange={e => setEditingSales(p => ({ ...p, [sKey]: { ...sv, orderCount: e.target.value } }))} className="pretty-input rounded-lg h-7 text-center text-xs w-16" /></td>
                          <td className="px-1 py-2"><Input type="number" min="0" value={sv.adSpend} onChange={e => setEditingSales(p => ({ ...p, [sKey]: { ...sv, adSpend: e.target.value } }))} className="pretty-input rounded-lg h-7 text-center text-xs w-16" /></td>
                          <td className="px-1 py-2 text-center"><Button variant="ghost" size="icon" className="h-6 w-6 rounded-lg hover:bg-emerald-50" onClick={() => handleSaveSale(sKey)} disabled={upsertSaleMut.isPending}><Check className="h-3.5 w-3.5 text-emerald-500" /></Button></td>
                          <td className="px-1 py-2 border-l border-pink-100"><Input type="number" min="0" value={stv.grossAmount} onChange={e => setEditingSettle(p => ({ ...p, [sKey]: { ...stv, grossAmount: e.target.value } }))} onKeyDown={e => { if (e.key === "Enter") handleSaveSettle(sKey); }} className="pretty-input rounded-lg h-7 text-center text-xs w-22" /></td>
                          <td className="px-1 py-2"><Input type="number" min="0" value={stv.commissionAmount} onChange={e => setEditingSettle(p => ({ ...p, [sKey]: { ...stv, commissionAmount: e.target.value } }))} className="pretty-input rounded-lg h-7 text-center text-xs w-16" /></td>
                          <td className="px-1 py-2"><Input type="number" min="0" value={stv.shippingAmount} onChange={e => setEditingSettle(p => ({ ...p, [sKey]: { ...stv, shippingAmount: e.target.value } }))} className="pretty-input rounded-lg h-7 text-center text-xs w-16" /></td>
                          <td className="px-1 py-2 text-center"><Button variant="ghost" size="icon" className="h-6 w-6 rounded-lg hover:bg-blue-50" onClick={() => handleSaveSettle(sKey)} disabled={upsertSettleMut.isPending}><Check className="h-3.5 w-3.5 text-blue-500" /></Button></td>
                        </tr>
                      );
                    })}
                  </tbody></table>
                </div></CardContent>
              </Card>
            ) : dailySalesData ? (
              <Card className="pretty-card"><CardContent className="pt-8 pb-8 text-center">
                <TrendingUp className="h-10 w-10 mx-auto mb-3 text-pink-300" />
                <p className="text-sm text-muted-foreground">매핑된 상품이 없습니다</p>
                <Button size="sm" className="mt-3 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl" onClick={() => setViewTab("mappings")}><ArrowRightLeft className="h-3.5 w-3.5 mr-1" /> 상품 매핑으로 이동</Button>
              </CardContent></Card>
            ) : null}

            <div className="p-3 bg-gradient-to-r from-blue-50/60 to-cyan-50/60 rounded-xl border border-blue-100/40">
              <p className="text-xs text-blue-600"><span className="font-semibold">&#x1F4A1; TIP:</span> 왼쪽 = 판매 데이터 (판매량/매출), 오른쪽 = 정산 데이터 (쿠팡 정산 금액). Enter로 빠른 저장. 추정수익은 소싱 상품의 마진 시나리오 기반.</p>
            </div>
          </div>
        ) : null}

        {/* ===== SETTINGS TAB ===== */}
        {activeAccount && viewTab === "settings" && !showAccountForm ? (
          <div className="space-y-4">
            <Card className="pretty-card overflow-hidden"><div className="h-1 bg-gradient-to-r from-pink-400 via-purple-400 to-fuchsia-400" />
              <CardHeader className="pb-3"><div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-100 to-purple-100 flex items-center justify-center"><ShoppingBag className="w-5 h-5 text-pink-500" /></div>
                  <div><CardTitle className="text-lg flex items-center gap-2"><span className="gradient-text">{activeAccount.accountName}</span>{activeAccount.isDefault ? <Badge className="bg-gradient-to-r from-amber-100 to-yellow-100 text-amber-700 border-amber-200 text-xs"><Star className="h-3 w-3 mr-0.5 fill-amber-500" />기본</Badge> : null}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">{[
                      activeAccount.vendorId ? `업체코드: ${activeAccount.vendorId}` : null,
                      activeAccount.companyName || null,
                      activeAccount.wingLoginId ? `Wing: ${activeAccount.wingLoginId}` : null,
                    ].filter(Boolean).join(" · ") || "업체코드 미설정"}</p></div>
                </div>
                {apiStatusBadge(activeAccount.apiStatus)}
              </div></CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 bg-gradient-to-r from-pink-50/60 to-purple-50/60 rounded-xl border border-pink-100/40 space-y-3">
                  <div className="flex items-center justify-between"><span className="text-xs font-semibold gradient-text-soft flex items-center gap-1.5"><Key className="h-3.5 w-3.5 text-pink-500" /> API 키</span>
                    {activeAccount.lastSyncAt ? <span className="text-[10px] text-muted-foreground">마지막: {formatDate(activeAccount.lastSyncAt)}</span> : null}</div>
                  <div className="grid gap-2.5">
                    <div className="flex items-center justify-between p-2 rounded-lg bg-white/60"><span className="text-xs text-muted-foreground w-24">Access Key</span><div className="flex items-center gap-2"><span className="font-mono text-xs">{activeAccount.accessKey ? maskKey(activeAccount.accessKey) : <span className="text-muted-foreground">미설정</span>}</span>{activeAccount.accessKey ? <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-pink-50" onClick={() => handleCopy(activeAccount.accessKey!, "Access Key")}><Copy className="h-3 w-3 text-pink-400" /></Button> : null}</div></div>
                    <div className="flex items-center justify-between p-2 rounded-lg bg-white/60"><span className="text-xs text-muted-foreground w-24">Secret Key</span><div className="flex items-center gap-2"><span className="font-mono text-xs">{activeAccount.secretKey ? (showSecret[activeAccount.id] ? activeAccount.secretKey : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022") : <span className="text-muted-foreground">미설정</span>}</span>{activeAccount.secretKey ? (<><Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-pink-50" onClick={() => setShowSecret(p => ({ ...p, [activeAccount.id]: !p[activeAccount.id] }))}>{showSecret[activeAccount.id] ? <EyeOff className="h-3 w-3 text-pink-400" /> : <Eye className="h-3 w-3 text-pink-400" />}</Button><Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-pink-50" onClick={() => handleCopy(activeAccount.secretKey!, "Secret Key")}><Copy className="h-3 w-3 text-pink-400" /></Button></>) : null}</div></div>
                  </div>
                </div>
                {/* Account details */}
                {(activeAccount.wingLoginId || activeAccount.companyName || activeAccount.apiUrl || activeAccount.ipAddress) ? (
                  <div className="p-4 bg-gradient-to-r from-blue-50/60 to-cyan-50/60 rounded-xl border border-blue-100/40 space-y-2">
                    <span className="text-xs font-semibold text-blue-700 flex items-center gap-1.5"><Shield className="h-3.5 w-3.5 text-blue-500" /> 계정 상세</span>
                    <div className="grid grid-cols-2 gap-2">
                      {activeAccount.wingLoginId ? <div className="flex items-center justify-between p-2 rounded-lg bg-white/60"><span className="text-xs text-muted-foreground">Wing ID</span><span className="text-xs font-medium">{activeAccount.wingLoginId}</span></div> : null}
                      {activeAccount.companyName ? <div className="flex items-center justify-between p-2 rounded-lg bg-white/60"><span className="text-xs text-muted-foreground">업체명</span><span className="text-xs font-medium">{activeAccount.companyName}</span></div> : null}
                      {activeAccount.apiUrl ? <div className="flex items-center justify-between p-2 rounded-lg bg-white/60"><span className="text-xs text-muted-foreground">URL</span><span className="text-xs font-medium">{activeAccount.apiUrl}</span></div> : null}
                      {activeAccount.ipAddress ? <div className="flex items-center justify-between p-2 rounded-lg bg-white/60"><span className="text-xs text-muted-foreground">IP</span><span className="text-xs font-medium">{activeAccount.ipAddress}</span></div> : null}
                    </div>
                  </div>
                ) : null}
                {activeAccount.memo ? <div className="p-3 bg-amber-50/50 rounded-xl border border-amber-100/50"><p className="text-xs text-amber-700"><span className="font-semibold">메모:</span> {activeAccount.memo}</p></div> : null}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button variant="outline" size="sm" onClick={() => testApiMut.mutate({ id: activeAccount.id })} disabled={testApiMut.isPending} className="border-emerald-200 text-emerald-600 hover:bg-emerald-50 rounded-xl text-xs"><TestTube className="h-3.5 w-3.5 mr-1.5" />{testApiMut.isPending ? "테스트 중..." : "API 테스트"}</Button>
                  <Button variant="outline" size="sm" onClick={() => testApisMut.mutate({ id: activeAccount.id })} disabled={testApisMut.isPending} className="border-blue-200 text-blue-600 hover:bg-blue-50 rounded-xl text-xs"><Shield className="h-3.5 w-3.5 mr-1.5" />{testApisMut.isPending ? "개별 테스트 중..." : "개별 API 테스트"}</Button>
                  <Button variant="outline" size="sm" onClick={() => loadAccForEdit(activeAccount)} className="border-pink-200 text-pink-600 hover:bg-pink-50 rounded-xl text-xs"><Pencil className="h-3.5 w-3.5 mr-1.5" /> 수정</Button>
                  {!activeAccount.isDefault ? <Button variant="outline" size="sm" onClick={() => setDefaultMut.mutate({ id: activeAccount.id })} disabled={setDefaultMut.isPending} className="border-amber-200 text-amber-600 hover:bg-amber-50 rounded-xl text-xs"><Star className="h-3.5 w-3.5 mr-1.5" /> 기본</Button> : null}
                  <Button variant="outline" size="sm" onClick={() => { if (confirm(`"${activeAccount.accountName}" 삭제?`)) deleteAccMut.mutate({ id: activeAccount.id }); }} disabled={deleteAccMut.isPending} className="border-red-200 text-red-500 hover:bg-red-50 rounded-xl text-xs"><Trash2 className="h-3.5 w-3.5 mr-1.5" /> 삭제</Button>
                </div>
                <div className="flex gap-4 text-[10px] text-muted-foreground pt-1"><span>등록: {formatDate(activeAccount.createdAt)}</span><span>수정: {formatDate(activeAccount.updatedAt)}</span></div>
              </CardContent>
            </Card>
            {/* Sync Jobs History */}
            {syncJobs && syncJobs.length > 0 ? (
              <Card className="pretty-card overflow-hidden"><div className="h-1 bg-gradient-to-r from-blue-300 to-cyan-300" />
                <CardHeader className="pb-2"><CardTitle className="text-sm gradient-text-soft flex items-center gap-2"><RefreshCw className="h-4 w-4 text-blue-500" /> 동기화 이력 <Badge className="text-[10px] bg-blue-50 text-blue-600 border-blue-200">{syncJobs.length}건</Badge></CardTitle></CardHeader>
                <CardContent><div className="overflow-x-auto">
                  <table className="w-full text-xs"><thead><tr className="bg-gradient-to-r from-blue-50/80 to-cyan-50/80 border-b border-blue-100/50">
                    <th className="text-left px-2 py-2 font-medium text-blue-700">유형</th>
                    <th className="text-center px-2 py-2 font-medium text-blue-700">상태</th>
                    <th className="text-right px-2 py-2 font-medium text-blue-700">처리건수</th>
                    <th className="text-left px-2 py-2 font-medium text-blue-700">시작</th>
                    <th className="text-left px-2 py-2 font-medium text-blue-700">완료</th>
                    <th className="text-left px-2 py-2 font-medium text-blue-700">에러</th>
                  </tr></thead><tbody>
                    {syncJobs.map(j => (
                      <tr key={j.id} className="border-b border-blue-50/80 hover:bg-blue-50/20 transition-colors">
                        <td className="px-2 py-1.5"><Badge className={`text-[10px] ${j.jobType === "sales" ? "bg-purple-50 text-purple-600 border-purple-200" : j.jobType === "settlements" ? "bg-emerald-50 text-emerald-600 border-emerald-200" : "bg-blue-50 text-blue-600 border-blue-200"}`}>{j.jobType === "sales" ? "판매" : j.jobType === "settlements" ? "정산" : "상품"}</Badge></td>
                        <td className="px-2 py-1.5 text-center"><Badge className={`text-[10px] ${j.status === "success" ? "bg-emerald-50 text-emerald-600" : j.status === "failed" ? "bg-red-50 text-red-500" : "bg-blue-50 text-blue-600"}`}>{j.status === "success" ? "성공" : j.status === "failed" ? "실패" : "진행중"}</Badge></td>
                        <td className="px-2 py-1.5 text-right font-mono">{j.recordCount || 0}건</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{formatDate(j.startedAt)}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{j.finishedAt ? formatDate(j.finishedAt) : "-"}</td>
                        <td className="px-2 py-1.5 text-red-400 max-w-[150px] truncate" title={j.errorMessage || ""}>{j.errorMessage || "-"}</td>
                      </tr>
                    ))}
                  </tbody></table>
                </div></CardContent>
              </Card>
            ) : null}
            <Card className="pretty-card overflow-hidden border-amber-100/60"><div className="h-1 bg-gradient-to-r from-amber-300 to-orange-300" />
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Shield className="h-4 w-4 text-amber-500" /><span className="text-amber-700">OPEN API 키 발급 안내</span></CardTitle></CardHeader>
              <CardContent className="text-xs text-amber-700/80 space-y-2">
                <ol className="list-decimal list-inside space-y-1.5 ml-1">
                  <li><a href="https://wing.coupang.com" target="_blank" rel="noopener noreferrer" className="text-pink-500 hover:underline font-medium">쿠팡 Wing</a> &#x2192; 판매자정보 &#x2192; 판매정보</li>
                  <li>하단 OPEN API 키 발급 &#x2192; "자체개발(직접입력)" 선택</li>
                  <li>발급된 Access Key / Secret Key를 여기에 입력</li>
                  <li><span className="font-semibold">IP 허용 목록에 서버 IP 등록</span> (포트 번호 불필요, IP만 입력)</li>
                  <li>API 테스트 버튼 클릭하여 연결 확인 후 동기화 사용</li>
                </ol>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {/* ===== Account Add/Edit Form ===== */}
        {showAccountForm ? (
          <Card className="pretty-card overflow-hidden"><div className="h-1 bg-gradient-to-r from-pink-400 via-purple-400 to-fuchsia-400" />
            <CardHeader className="pb-3"><div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2"><Key className="h-4 w-4 text-pink-500" /><span className="gradient-text-soft">{editingAccountId ? "계정 수정" : "새 쿠팡 계정 등록"}</span></CardTitle>
              <Button variant="ghost" size="sm" onClick={resetAccForm} className="text-muted-foreground hover:bg-pink-50 rounded-lg"><X className="h-4 w-4" /></Button>
            </div></CardHeader>
            <CardContent className="space-y-4">
              <div className="p-3 bg-gradient-to-r from-blue-50/60 to-cyan-50/60 rounded-xl border border-blue-100/40">
                <p className="text-xs text-blue-600">&#x1F4A1; 쿠팡 Wing &#x2192; 판매자정보 &#x2192; 판매정보 &#x2192; OPEN API 키 발급에서 정보를 확인하세요</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs font-medium text-muted-foreground">계정 이름 *</Label><Input placeholder="예: 메인스토어, 2호점" value={accForm.accountName} onChange={e => setAccForm(p => ({ ...p, accountName: e.target.value }))} className="pretty-input rounded-xl mt-1" /></div>
                <div><Label className="text-xs font-medium text-muted-foreground">업체코드 (Vendor ID)</Label><Input placeholder="쿠팡 Wing 업체코드" value={accForm.vendorId} onChange={e => setAccForm(p => ({ ...p, vendorId: e.target.value }))} className="pretty-input rounded-xl mt-1" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs font-medium text-muted-foreground">Wing 로그인 ID</Label><Input placeholder="쿠팡 Wing 로그인 ID" value={accForm.wingLoginId} onChange={e => setAccForm(p => ({ ...p, wingLoginId: e.target.value }))} className="pretty-input rounded-xl mt-1" /></div>
                <div><Label className="text-xs font-medium text-muted-foreground">업체명</Label><Input placeholder="업체명" value={accForm.companyName} onChange={e => setAccForm(p => ({ ...p, companyName: e.target.value }))} className="pretty-input rounded-xl mt-1" /></div>
              </div>
              <div className="p-4 bg-gradient-to-r from-pink-50/80 to-purple-50/80 rounded-xl border border-pink-100/50 space-y-3">
                <p className="text-xs font-semibold gradient-text-soft flex items-center gap-1.5"><Key className="h-3.5 w-3.5 text-pink-500" /> OPEN API 키 정보</p>
                <div><Label className="text-xs font-medium text-muted-foreground">Access Key</Label><Input placeholder="OPEN API Access Key" value={accForm.accessKey} onChange={e => setAccForm(p => ({ ...p, accessKey: e.target.value }))} className="pretty-input rounded-xl mt-1 font-mono text-sm" /></div>
                <div><Label className="text-xs font-medium text-muted-foreground">Secret Key</Label><Input type="password" placeholder="OPEN API Secret Key" value={accForm.secretKey} onChange={e => setAccForm(p => ({ ...p, secretKey: e.target.value }))} className="pretty-input rounded-xl mt-1 font-mono text-sm" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs font-medium text-muted-foreground">URL</Label><Input placeholder="wing.coupang.com" value={accForm.apiUrl} onChange={e => setAccForm(p => ({ ...p, apiUrl: e.target.value }))} className="pretty-input rounded-xl mt-1" /></div>
                <div><Label className="text-xs font-medium text-muted-foreground">IP 주소 (쉼표 구분)</Label><Input placeholder="예) 49.50.130.101" value={accForm.ipAddress} onChange={e => setAccForm(p => ({ ...p, ipAddress: e.target.value }))} className="pretty-input rounded-xl mt-1" /><p className="text-[10px] text-amber-600 mt-1">* 쿠팡에 IP 등록 시 포트 없이 IP만 입력 (예: 49.50.130.101)</p></div>
              </div>
              <div><Label className="text-xs font-medium text-muted-foreground">메모</Label><Textarea placeholder="메모 (선택)" value={accForm.memo} onChange={e => setAccForm(p => ({ ...p, memo: e.target.value }))} rows={2} className="pretty-input rounded-xl mt-1" /></div>
              <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={accForm.isDefault} onChange={e => setAccForm(p => ({ ...p, isDefault: e.target.checked }))} className="w-4 h-4 rounded border-pink-300 text-pink-500 focus:ring-pink-500" /><span className="text-sm text-muted-foreground">기본 계정으로 설정</span></label>
              <div className="flex gap-2 pt-2">
                <Button onClick={handleAccSubmit} disabled={createAccMut.isPending || updateAccMut.isPending} className="bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl shadow-md shadow-pink-200/40"><Sparkles className="h-4 w-4 mr-1.5" />{editingAccountId ? "수정 완료" : "계정 등록"}</Button>
                <Button variant="ghost" onClick={resetAccForm} className="rounded-xl text-muted-foreground">취소</Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
