import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import {
  TrendingUp, TrendingDown, DollarSign, ShoppingCart, Package,
  ChevronLeft, ChevronRight, Calendar, Sparkles, BarChart3,
  Download, FileText, CalendarDays, CalendarRange,
  Save, RotateCcw, CheckCircle, Pencil, Square, CheckSquare,
} from "lucide-react";

// ──────────── Constants & Helpers ────────────
const TODAY = new Date().toISOString().split("T")[0];
const MONTH_NAMES = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

function formatNum(n: number): string { return n.toLocaleString("ko-KR"); }
function getWeekday(dateStr: string): string {
  const days = ["일","월","화","수","목","금","토"];
  return days[new Date(dateStr).getDay()];
}
function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr); d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}
function getWeekRange(dateStr: string) {
  const d = new Date(dateStr);
  const day = d.getDay();
  const mon = new Date(d); mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return { start: mon.toISOString().split("T")[0], end: sun.toISOString().split("T")[0] };
}
function getMonthRange(year: number, month: number) {
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${year}-${String(month).padStart(2,"0")}-01`,
    end: `${year}-${String(month).padStart(2,"0")}-${String(lastDay).padStart(2,"0")}`,
  };
}

// ──────────── CSV Download ────────────
function downloadCSV(filename: string, headers: string[], rows: string[][]) {
  const BOM = "\uFEFF";
  const csv = BOM + [headers.join(","), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  toast.success(`${filename} 다운로드 완료`);
}

// ──────────── Types ────────────
type ViewMode = "daily" | "weekly" | "monthly" | "yearly";

interface SaleItem {
  productId: number; productName: string; category: string | null;
  status: string; saleId: number | null; sellPrice: number; margin: number;
  quantity: number; dailyRevenue: number; dailyProfit: number; memo: string | null;
}

interface ReportItem {
  productId: number; productName: string; category: string | null;
  totalQuantity: number; totalRevenue: number; totalProfit: number;
  avgMargin: number; salesDays: number; avgSellPrice?: number;
}

// ──────────── Summary Cards Component ────────────
function SummaryCards({ qty, rev, prof, label }: { qty: number; rev: number; prof: number; label?: string }) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <Card className="pretty-card overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-blue-300 to-cyan-300" />
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">{label ? `${label} ` : ""}총 판매량</p>
              <p className="text-2xl font-bold text-blue-600 mt-1">{formatNum(qty)}<span className="text-sm font-normal text-muted-foreground ml-1">개</span></p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-100 to-cyan-100 flex items-center justify-center">
              <ShoppingCart className="h-5 w-5 text-blue-500" />
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className="pretty-card overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-purple-300 to-fuchsia-300" />
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">{label ? `${label} ` : ""}총 매출</p>
              <p className="text-2xl font-bold text-purple-600 mt-1">{formatNum(rev)}<span className="text-sm font-normal text-muted-foreground ml-1">원</span></p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-100 to-fuchsia-100 flex items-center justify-center">
              <DollarSign className="h-5 w-5 text-purple-500" />
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className="pretty-card overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-pink-400 to-rose-400" />
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">{label ? `${label} ` : ""}총 수익</p>
              <p className={`text-2xl font-bold mt-1 ${prof >= 0 ? "text-pink-600" : "text-red-500"}`}>
                {formatNum(prof)}<span className="text-sm font-normal text-muted-foreground ml-1">원</span>
              </p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-pink-100 to-rose-100 flex items-center justify-center">
              {prof >= 0 ? <TrendingUp className="h-5 w-5 text-pink-500" /> : <TrendingDown className="h-5 w-5 text-red-500" />}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ──────────── Report Table Component ────────────
function ReportTable({ items, periodLabel }: { items: ReportItem[]; periodLabel: string }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-3 text-muted-foreground">
        <Package className="h-10 w-10 text-pink-300" />
        <p className="text-sm">{periodLabel} 판매 데이터가 없습니다.</p>
      </div>
    );
  }
  const totQty = items.reduce((s,i)=>s+i.totalQuantity,0);
  const totRev = items.reduce((s,i)=>s+i.totalRevenue,0);
  const totProf = items.reduce((s,i)=>s+i.totalProfit,0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gradient-to-r from-pink-50/80 to-purple-50/80 border-b border-pink-100/50">
            <th className="text-left px-4 py-3 font-medium text-pink-700 w-8">#</th>
            <th className="text-left px-4 py-3 font-medium text-pink-700">상품</th>
            <th className="text-right px-4 py-3 font-medium text-pink-700 w-24">평균 마진</th>
            <th className="text-right px-4 py-3 font-medium text-blue-700 w-24">총 판매량</th>
            <th className="text-right px-4 py-3 font-medium text-purple-700 w-28">총 매출</th>
            <th className="text-right px-4 py-3 font-medium text-pink-700 w-28">총 수익</th>
            <th className="text-center px-4 py-3 font-medium text-muted-foreground w-20">판매일수</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={item.productId} className="border-b border-pink-50/80 hover:bg-pink-50/30 transition-colors">
              <td className="px-4 py-2.5 text-xs text-muted-foreground">{idx+1}</td>
              <td className="px-4 py-2.5">
                <p className="font-medium truncate max-w-[200px]">{item.productName}</p>
                {item.category && <p className="text-xs text-muted-foreground">{item.category}</p>}
              </td>
              <td className="px-4 py-2.5 text-right font-mono text-xs text-pink-600 font-semibold">{formatNum(item.avgMargin)}원</td>
              <td className="px-4 py-2.5 text-right font-mono text-xs text-blue-600 font-semibold">{formatNum(item.totalQuantity)}</td>
              <td className="px-4 py-2.5 text-right font-mono text-xs text-purple-600">{formatNum(item.totalRevenue)}원</td>
              <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold">
                <span className={item.totalProfit >= 0 ? "text-pink-600" : "text-red-500"}>{formatNum(item.totalProfit)}원</span>
              </td>
              <td className="px-4 py-2.5 text-center text-xs text-muted-foreground">{item.salesDays}일</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-gradient-to-r from-pink-50 to-purple-50 border-t-2 border-pink-200/50">
            <td className="px-4 py-3.5"></td>
            <td className="px-4 py-3.5 font-bold gradient-text flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-pink-400" /> 합계 ({items.length}개 상품)
            </td>
            <td className="px-4 py-3.5"></td>
            <td className="px-4 py-3.5 text-right font-bold text-blue-600 font-mono">{formatNum(totQty)}</td>
            <td className="px-4 py-3.5 text-right font-bold text-purple-600 font-mono">{formatNum(totRev)}원</td>
            <td className="px-4 py-3.5 text-right font-bold font-mono">
              <span className={totProf >= 0 ? "text-pink-600" : "text-red-500"}>{formatNum(totProf)}원</span>
            </td>
            <td className="px-4 py-3.5"></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ──────────── Period Breakdown Component (daily rows for weekly, weekly rows for monthly, monthly rows for yearly) ────────────
function PeriodBreakdown({
  rows, labelFn, onRowClick, activeKey, title, icon,
}: {
  rows: { key: string; label: string; qty: number; rev: number; prof: number }[];
  labelFn?: (r: any) => string;
  onRowClick?: (key: string) => void;
  activeKey?: string;
  title: string;
  icon: React.ReactNode;
}) {
  if (rows.length === 0) return null;
  const totalQty = rows.reduce((s,r)=>s+r.qty,0);
  const totalRev = rows.reduce((s,r)=>s+r.rev,0);
  const totalProf = rows.reduce((s,r)=>s+r.prof,0);

  return (
    <Card className="pretty-card overflow-hidden">
      <div className="h-1 bg-gradient-to-r from-amber-300 to-orange-300" />
      <CardHeader className="pb-2">
        <CardTitle className="text-sm gradient-text-soft flex items-center gap-2">
          {icon} {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5">
          {rows.map(r => (
            <div
              key={r.key}
              className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                r.key === activeKey
                  ? "bg-gradient-to-r from-pink-50 to-purple-50 border border-pink-200"
                  : onRowClick ? "hover:bg-pink-50/40 cursor-pointer" : ""
              }`}
              onClick={() => onRowClick?.(r.key)}
            >
              <span className="font-medium">{r.label}</span>
              <div className="flex gap-6 text-xs">
                <span className="text-blue-600 w-16 text-right">{formatNum(r.qty)}개</span>
                <span className="text-purple-600 w-24 text-right">{formatNum(r.rev)}원</span>
                <span className={`font-semibold w-24 text-right ${r.prof >= 0 ? "text-pink-600" : "text-red-500"}`}>
                  {formatNum(r.prof)}원
                </span>
              </div>
            </div>
          ))}
          {/* Total row */}
          <div className="flex items-center justify-between px-3 py-2 rounded-lg text-sm bg-gradient-to-r from-pink-50 to-purple-50 border border-pink-200/50 mt-2">
            <span className="font-bold gradient-text">합계</span>
            <div className="flex gap-6 text-xs font-bold">
              <span className="text-blue-600 w-16 text-right">{formatNum(totalQty)}개</span>
              <span className="text-purple-600 w-24 text-right">{formatNum(totalRev)}원</span>
              <span className={`w-24 text-right ${totalProf >= 0 ? "text-pink-600" : "text-red-500"}`}>{formatNum(totalProf)}원</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ──────────── MAIN COMPONENT ────────────
export default function DailyProfitBoard() {
  const [selectedDate, setSelectedDate] = useState(TODAY);
  const [editingQty, setEditingQty] = useState<Record<number, string>>({});
  const [savedQty, setSavedQty] = useState<Record<number, string>>({});
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
  const [editingIds, setEditingIds] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>("daily");
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [showAll, setShowAll] = useState(true);

  // ── Derived date ranges ──
  const weekRange = useMemo(() => getWeekRange(selectedDate), [selectedDate]);
  const monthRange = useMemo(() => getMonthRange(selectedYear, selectedMonth), [selectedYear, selectedMonth]);

  // ── API: Daily ──
  const { data: dailyData, isLoading: dailyLoading, refetch: refetchDaily } = trpc.dailyProfit.getByDate.useQuery(
    { date: selectedDate }, { refetchOnWindowFocus: false, enabled: viewMode === "daily" }
  );

  // ── API: Weekly ──
  const { data: weeklyReport, isLoading: weeklyLoading } = trpc.dailyProfit.getWeeklyReport.useQuery(
    { startDate: weekRange.start, endDate: weekRange.end }, { enabled: viewMode === "weekly" }
  );

  // ── API: Monthly ──
  const { data: monthlyReport, isLoading: monthlyLoading } = trpc.dailyProfit.getMonthlyReport.useQuery(
    { year: selectedYear, month: selectedMonth }, { enabled: viewMode === "monthly" }
  );

  // ── API: Yearly ──
  const { data: yearlyReport, isLoading: yearlyLoading } = trpc.dailyProfit.getYearlyReport.useQuery(
    { year: selectedYear }, { enabled: viewMode === "yearly" }
  );

  // ── API: Export ──
  const exportRange = useMemo(() => {
    if (viewMode === "daily") return { startDate: selectedDate, endDate: selectedDate };
    if (viewMode === "weekly") return { startDate: weekRange.start, endDate: weekRange.end };
    if (viewMode === "monthly") return { startDate: monthRange.start, endDate: monthRange.end };
    return { startDate: `${selectedYear}-01-01`, endDate: `${selectedYear}-12-31` };
  }, [viewMode, selectedDate, weekRange, monthRange, selectedYear]);

  const { refetch: fetchExport } = trpc.dailyProfit.getExportData.useQuery(
    exportRange, { enabled: false }
  );

  const upsertSale = trpc.dailyProfit.upsertSale.useMutation({
    onSuccess: () => refetchDaily(),
    onError: (e) => toast.error(e.message),
  });

  // ── Enter edit mode for a product ──
  const enterEditMode = useCallback((productId: number) => {
    setEditingIds(prev => {
      const next = new Set(prev);
      next.add(productId);
      return next;
    });
    // Also check the product
    setCheckedIds(prev => {
      const next = new Set(prev);
      next.add(productId);
      return next;
    });
  }, []);

  // ── Daily editing ──
  const handleQuantityChange = useCallback((item: SaleItem, value: string) => {
    setEditingQty(prev => ({ ...prev, [item.productId]: value }));
    // Auto-check product when user edits quantity
    setCheckedIds(prev => {
      const next = new Set(prev);
      next.add(item.productId);
      return next;
    });
    // Keep in editing mode
    setEditingIds(prev => {
      const next = new Set(prev);
      next.add(item.productId);
      return next;
    });
  }, []);

  const handleQuantitySave = useCallback((item: SaleItem) => {
    const qtyStr = editingQty[item.productId] ?? "0";
    const qty = parseInt(qtyStr, 10);
    if (isNaN(qty) || qty < 0) return;
    upsertSale.mutate({ productId: item.productId, date: selectedDate, quantity: qty, sellPrice: item.sellPrice, margin: item.margin });
    // Mark as saved
    setSavedQty(prev => ({ ...prev, [item.productId]: String(qty) }));
    setEditingQty(prev => ({ ...prev, [item.productId]: String(qty) }));
    // Exit edit mode & uncheck after save
    setEditingIds(prev => {
      const next = new Set(prev);
      next.delete(item.productId);
      return next;
    });
    setCheckedIds(prev => {
      const next = new Set(prev);
      next.delete(item.productId);
      return next;
    });
  }, [editingQty, selectedDate, upsertSale]);

  // Initialize from server data
  useEffect(() => {
    if (dailyData?.items) {
      const init: Record<number, string> = {};
      dailyData.items.forEach(i => { init[i.productId] = String(i.quantity); });
      setEditingQty(init);
      setSavedQty(init);
      setCheckedIds(new Set());
      setEditingIds(new Set());
    }
  }, [dailyData]);

  const items = dailyData?.items || [];
  const liveSummary = items.reduce((acc, item) => {
    const qty = parseInt(editingQty[item.productId] || "0", 10) || 0;
    return {
      totalQuantity: acc.totalQuantity + qty,
      totalRevenue: acc.totalRevenue + item.sellPrice * qty,
      totalProfit: acc.totalProfit + item.margin * qty,
    };
  }, { totalQuantity: 0, totalRevenue: 0, totalProfit: 0 });

  // ── Save checked items ──
  const handleSaveChecked = useCallback(() => {
    if (checkedIds.size === 0) { toast.info("선택된 항목이 없습니다"); return; }
    const toSave = items.filter(item => checkedIds.has(item.productId));
    toSave.forEach(item => {
      const qty = parseInt(editingQty[item.productId] || "0", 10) || 0;
      upsertSale.mutate({ productId: item.productId, date: selectedDate, quantity: qty, sellPrice: item.sellPrice, margin: item.margin });
    });
    // Update saved state & clear checks & exit edit mode
    const newSaved = { ...savedQty };
    const newEditing = { ...editingQty };
    toSave.forEach(item => {
      const val = String(parseInt(editingQty[item.productId] || "0", 10) || 0);
      newSaved[item.productId] = val;
      newEditing[item.productId] = val;
    });
    setSavedQty(newSaved);
    setEditingQty(newEditing);
    setCheckedIds(new Set());
    setEditingIds(new Set());
    toast.success(`${toSave.length}개 항목 저장 완료`);
  }, [checkedIds, items, editingQty, savedQty, selectedDate, upsertSale]);

  // ── Reset: restore to saved values ──
  const handleResetAll = useCallback(() => {
    setEditingQty({ ...savedQty });
    setCheckedIds(new Set());
    setEditingIds(new Set());
    toast.info("입력값이 저장된 값으로 복원되었습니다");
  }, [savedQty]);

  // ── Toggle check (also enters edit mode when checking) ──
  const toggleCheck = useCallback((productId: number) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      const wasChecked = next.has(productId);
      if (wasChecked) {
        next.delete(productId);
        // Also exit edit mode when unchecking
        setEditingIds(p => {
          const n = new Set(p);
          n.delete(productId);
          return n;
        });
        // Restore to saved value when unchecking
        setEditingQty(p => ({ ...p, [productId]: savedQty[productId] ?? "0" }));
      } else {
        next.add(productId);
        // Enter edit mode when checking
        setEditingIds(p => {
          const n = new Set(p);
          n.add(productId);
          return n;
        });
      }
      return next;
    });
  }, [savedQty]);

  // ── Check if there are unsaved changes or items in edit mode ──
  const hasChanges = useMemo(() => {
    if (editingIds.size > 0) return true;
    return items.some(item => {
      const current = editingQty[item.productId] ?? "";
      const saved = savedQty[item.productId] ?? "";
      return current !== saved;
    });
  }, [items, editingQty, savedQty, editingIds]);

  // ── Check if item is in edit mode (explicit tracking) ──
  const isInEditMode = useCallback((productId: number) => {
    return editingIds.has(productId);
  }, [editingIds]);

  const displayItems = showAll ? items : items.filter(i => i.quantity > 0 || (editingQty[i.productId] && parseInt(editingQty[i.productId]) > 0));

  // ── Download handler ──
  const handleDownload = useCallback(async () => {
    try {
      if (viewMode === "daily") {
        // Download current daily view
        const activeItems = items.filter(i => {
          const qty = parseInt(editingQty[i.productId] || "0", 10) || 0;
          return qty > 0;
        });
        if (activeItems.length === 0) { toast.error("다운로드할 데이터가 없습니다."); return; }
        const headers = ["날짜","상품명","카테고리","판매가","마진","판매량","매출","수익"];
        const rows = activeItems.map(i => {
          const qty = parseInt(editingQty[i.productId] || "0", 10) || 0;
          return [selectedDate, i.productName, i.category || "", String(i.sellPrice), String(i.margin), String(qty), String(i.sellPrice * qty), String(i.margin * qty)];
        });
        downloadCSV(`daily-profit_${selectedDate}.csv`, headers, rows);
      } else if (viewMode === "weekly" && weeklyReport) {
        const headers = ["상품명","카테고리","평균마진","총판매량","총매출","총수익","판매일수"];
        const rows = weeklyReport.items.map(i => [i.productName, i.category||"", String(i.avgMargin), String(i.totalQuantity), String(i.totalRevenue), String(i.totalProfit), String(i.salesDays)]);
        downloadCSV(`weekly-profit_${weekRange.start}_${weekRange.end}.csv`, headers, rows);
      } else if (viewMode === "monthly" && monthlyReport) {
        const headers = ["상품명","카테고리","평균마진","총판매량","총매출","총수익","판매일수"];
        const rows = monthlyReport.items.map(i => [i.productName, i.category||"", String(i.avgMargin), String(i.totalQuantity), String(i.totalRevenue), String(i.totalProfit), String(i.salesDays)]);
        downloadCSV(`monthly-profit_${selectedYear}-${String(selectedMonth).padStart(2,"0")}.csv`, headers, rows);
      } else if (viewMode === "yearly" && yearlyReport) {
        const headers = ["상품명","카테고리","평균마진","총판매량","총매출","총수익","판매일수"];
        const rows = yearlyReport.items.map(i => [i.productName, i.category||"", String(i.avgMargin), String(i.totalQuantity), String(i.totalRevenue), String(i.totalProfit), String(i.salesDays)]);
        downloadCSV(`yearly-profit_${selectedYear}.csv`, headers, rows);
      }
    } catch { toast.error("다운로드 중 오류가 발생했습니다."); }
  }, [viewMode, items, editingQty, selectedDate, weeklyReport, monthlyReport, yearlyReport, weekRange, selectedYear, selectedMonth]);

  // ── Full export download handler ──
  const handleFullExport = useCallback(async () => {
    try {
      const result = await fetchExport();
      const data = result.data;
      if (!data || data.length === 0) { toast.error("다운로드할 데이터가 없습니다."); return; }
      const headers = ["날짜","상품명","카테고리","판매가","마진","판매량","매출","수익","메모"];
      const rows = data.map(r => [r.saleDate, r.productName, r.category, String(r.sellPrice), String(r.margin), String(r.quantity), String(r.dailyRevenue), String(r.dailyProfit), r.memo]);
      const label = viewMode === "daily" ? selectedDate : viewMode === "weekly" ? `${weekRange.start}_${weekRange.end}` : viewMode === "monthly" ? `${selectedYear}-${String(selectedMonth).padStart(2,"0")}` : String(selectedYear);
      downloadCSV(`profit-detail_${label}.csv`, headers, rows);
    } catch { toast.error("다운로드 중 오류가 발생했습니다."); }
  }, [fetchExport, viewMode, selectedDate, weekRange, selectedYear, selectedMonth]);

  // ── Weekly breakdown rows ──
  const weeklyBreakdownRows = useMemo(() => {
    if (!weeklyReport?.daily) return [];
    return weeklyReport.daily.map(d => ({
      key: d.saleDate,
      label: `${d.saleDate} (${getWeekday(d.saleDate)})`,
      qty: d.totalQuantity || 0, rev: d.totalRevenue || 0, prof: d.totalProfit || 0,
    }));
  }, [weeklyReport]);

  // ── Monthly breakdown rows (weeks) ──
  const monthlyBreakdownRows = useMemo(() => {
    if (!monthlyReport?.weekly) return [];
    return monthlyReport.weekly.map((w: any) => ({
      key: w.weekNum,
      label: `${w.weekNum} (${w.weekStart} ~ ${w.weekEnd})`,
      qty: w.totalQuantity || 0, rev: w.totalRevenue || 0, prof: w.totalProfit || 0,
    }));
  }, [monthlyReport]);

  // ── Yearly breakdown rows (months) ──
  const yearlyBreakdownRows = useMemo(() => {
    if (!yearlyReport?.monthly) return [];
    return yearlyReport.monthly.map((m: any) => ({
      key: String(m.monthNum),
      label: `${selectedYear}년 ${MONTH_NAMES[(m.monthNum || 1) - 1]}`,
      qty: m.totalQuantity || 0, rev: m.totalRevenue || 0, prof: m.totalProfit || 0,
    }));
  }, [yearlyReport, selectedYear]);

  // ── Loading state ──
  const isLoading = viewMode === "daily" ? dailyLoading : viewMode === "weekly" ? weeklyLoading : viewMode === "monthly" ? monthlyLoading : yearlyLoading;

  // ── Grand totals ──
  const grandTotal = useMemo(() => {
    if (viewMode === "daily") return liveSummary;
    if (viewMode === "weekly") return weeklyReport?.grandTotal || { totalQuantity: 0, totalRevenue: 0, totalProfit: 0 };
    if (viewMode === "monthly") return monthlyReport?.grandTotal || { totalQuantity: 0, totalRevenue: 0, totalProfit: 0 };
    return yearlyReport?.grandTotal || { totalQuantity: 0, totalRevenue: 0, totalProfit: 0 };
  }, [viewMode, liveSummary, weeklyReport, monthlyReport, yearlyReport]);

  // ──────────── Render ────────────
  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight gradient-text flex items-center gap-2">
              <span className="text-2xl">&#x1F4B0;</span> Daily Profit Board
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {viewMode === "daily" ? "판매량을 입력하면 자동 선택 & 수익 자동 계산"
               : viewMode === "weekly" ? `주간 리포트: ${weekRange.start} ~ ${weekRange.end}`
               : viewMode === "monthly" ? `월간 리포트: ${selectedYear}년 ${selectedMonth}월`
               : `연간 리포트: ${selectedYear}년`}
            </p>
          </div>

          {/* Download buttons */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline" size="sm"
              onClick={handleDownload}
              className="border-pink-200 text-pink-600 hover:bg-pink-50 rounded-xl text-xs"
            >
              <Download className="h-3.5 w-3.5 mr-1" /> 요약 CSV
            </Button>
            <Button
              variant="outline" size="sm"
              onClick={handleFullExport}
              className="border-purple-200 text-purple-600 hover:bg-purple-50 rounded-xl text-xs"
            >
              <FileText className="h-3.5 w-3.5 mr-1" /> 상세 CSV
            </Button>
          </div>
        </div>

        {/* View Mode Tabs */}
        <div className="flex gap-1.5 bg-gradient-to-r from-pink-50 to-purple-50 rounded-xl p-1 border border-pink-100/50 w-fit">
          {([
            { key: "daily" as ViewMode, icon: Calendar, label: "일별" },
            { key: "weekly" as ViewMode, icon: CalendarDays, label: "주간" },
            { key: "monthly" as ViewMode, icon: CalendarRange, label: "월간" },
            { key: "yearly" as ViewMode, icon: BarChart3, label: "연간" },
          ]).map(tab => (
            <Button
              key={tab.key} size="sm"
              variant={viewMode === tab.key ? "default" : "ghost"}
              className={viewMode === tab.key ? "bg-white text-pink-700 shadow-sm rounded-lg" : "text-muted-foreground rounded-lg"}
              onClick={() => setViewMode(tab.key)}
            >
              <tab.icon className="h-3.5 w-3.5 mr-1" /> {tab.label}
            </Button>
          ))}
        </div>

        {/* Date/Period Selector */}
        <Card className="pretty-card overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-pink-300 via-purple-300 to-fuchsia-300" />
          <CardContent className="py-3 flex items-center justify-between">
            {viewMode === "daily" ? (
              <>
                <Button variant="ghost" size="icon" onClick={() => setSelectedDate(shiftDate(selectedDate, -1))} className="hover:bg-pink-50 rounded-xl">
                  <ChevronLeft className="h-5 w-5 text-pink-500" />
                </Button>
                <div className="flex items-center gap-3">
                  <Input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="pretty-input text-center font-medium w-44" />
                  <Badge className="bg-gradient-to-r from-pink-100 to-purple-100 text-pink-700 border-pink-200 px-3">{getWeekday(selectedDate)}요일</Badge>
                  {selectedDate !== TODAY ? (
                    <Button variant="outline" size="sm" onClick={() => setSelectedDate(TODAY)} className="border-pink-200 text-pink-600 hover:bg-pink-50 rounded-lg text-xs">오늘</Button>
                  ) : null}
                </div>
                <Button variant="ghost" size="icon" onClick={() => setSelectedDate(shiftDate(selectedDate, 1))} className="hover:bg-pink-50 rounded-xl">
                  <ChevronRight className="h-5 w-5 text-pink-500" />
                </Button>
              </>
            ) : viewMode === "weekly" ? (
              <>
                <Button variant="ghost" size="icon" onClick={() => setSelectedDate(shiftDate(selectedDate, -7))} className="hover:bg-pink-50 rounded-xl">
                  <ChevronLeft className="h-5 w-5 text-pink-500" />
                </Button>
                <div className="flex items-center gap-3">
                  <Badge className="bg-gradient-to-r from-pink-100 to-purple-100 text-pink-700 border-pink-200 px-4 py-1.5 text-sm font-medium">
                    {weekRange.start} ~ {weekRange.end}
                  </Badge>
                  <Button variant="outline" size="sm" onClick={() => setSelectedDate(TODAY)} className="border-pink-200 text-pink-600 hover:bg-pink-50 rounded-lg text-xs">이번 주</Button>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setSelectedDate(shiftDate(selectedDate, 7))} className="hover:bg-pink-50 rounded-xl">
                  <ChevronRight className="h-5 w-5 text-pink-500" />
                </Button>
              </>
            ) : viewMode === "monthly" ? (
              <>
                <Button variant="ghost" size="icon" onClick={() => {
                  if (selectedMonth === 1) { setSelectedMonth(12); setSelectedYear(y => y - 1); } else setSelectedMonth(m => m - 1);
                }} className="hover:bg-pink-50 rounded-xl">
                  <ChevronLeft className="h-5 w-5 text-pink-500" />
                </Button>
                <div className="flex items-center gap-3">
                  <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))} className="pretty-input text-center font-medium px-3 py-1.5 rounded-lg text-sm">
                    {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => <option key={y} value={y}>{y}년</option>)}
                  </select>
                  <select value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))} className="pretty-input text-center font-medium px-3 py-1.5 rounded-lg text-sm">
                    {MONTH_NAMES.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
                  </select>
                  <Button variant="outline" size="sm" onClick={() => { setSelectedYear(new Date().getFullYear()); setSelectedMonth(new Date().getMonth()+1); }} className="border-pink-200 text-pink-600 hover:bg-pink-50 rounded-lg text-xs">이번 달</Button>
                </div>
                <Button variant="ghost" size="icon" onClick={() => {
                  if (selectedMonth === 12) { setSelectedMonth(1); setSelectedYear(y => y + 1); } else setSelectedMonth(m => m + 1);
                }} className="hover:bg-pink-50 rounded-xl">
                  <ChevronRight className="h-5 w-5 text-pink-500" />
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="icon" onClick={() => setSelectedYear(y => y - 1)} className="hover:bg-pink-50 rounded-xl">
                  <ChevronLeft className="h-5 w-5 text-pink-500" />
                </Button>
                <div className="flex items-center gap-3">
                  <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))} className="pretty-input text-center font-medium px-4 py-1.5 rounded-lg text-sm">
                    {Array.from({ length: 7 }, (_, i) => new Date().getFullYear() - 3 + i).map(y => <option key={y} value={y}>{y}년</option>)}
                  </select>
                  <Button variant="outline" size="sm" onClick={() => setSelectedYear(new Date().getFullYear())} className="border-pink-200 text-pink-600 hover:bg-pink-50 rounded-lg text-xs">올해</Button>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setSelectedYear(y => y + 1)} className="hover:bg-pink-50 rounded-xl">
                  <ChevronRight className="h-5 w-5 text-pink-500" />
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* Summary Cards */}
        <SummaryCards
          qty={grandTotal.totalQuantity} rev={grandTotal.totalRevenue} prof={grandTotal.totalProfit}
          label={viewMode === "daily" ? undefined : viewMode === "weekly" ? "주간" : viewMode === "monthly" ? "월간" : "연간"}
        />

        {/* Loading */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-32 gap-3">
            <div className="cute-dots"><div className="cute-dot" /><div className="cute-dot" /><div className="cute-dot" /></div>
            <p className="text-sm text-pink-400">데이터를 불러오는 중...</p>
          </div>
        ) : null}

        {/* DAILY VIEW */}
        {viewMode === "daily" && !isLoading ? (
          <>
            <div className="flex items-center gap-3 flex-wrap">
              <Button variant="outline" size="sm" onClick={() => setShowAll(!showAll)} className="border-pink-200 text-pink-600 hover:bg-pink-50 rounded-xl text-xs">
                <Package className="h-3.5 w-3.5 mr-1" />
                {showAll ? `전체 상품 (${items.length})` : `판매 상품만 (${displayItems.length})`}
              </Button>
              <div className="flex items-center gap-2 ml-auto">
                {checkedIds.size > 0 && (
                  <Badge className="bg-pink-50 text-pink-600 border-pink-200 text-xs">{checkedIds.size}개 선택됨</Badge>
                )}
                <Button variant="outline" size="sm" onClick={handleResetAll} disabled={!hasChanges} className="border-gray-200 text-gray-600 hover:bg-gray-50 rounded-xl text-xs disabled:opacity-40">
                  <RotateCcw className="h-3.5 w-3.5 mr-1" /> 되돌리기
                </Button>
                <Button size="sm" onClick={handleSaveChecked} disabled={checkedIds.size === 0 || upsertSale.isPending} className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white rounded-xl text-xs shadow-sm disabled:opacity-40">
                  <Save className="h-3.5 w-3.5 mr-1" /> 선택 저장 ({checkedIds.size})
                </Button>
              </div>
            </div>

            <Card className="pretty-card overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-pink-300 via-purple-300 to-fuchsia-300" />
              <CardContent className="p-0">
                {displayItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-32 gap-3 text-muted-foreground">
                    <Package className="h-10 w-10 text-pink-300" />
                    <p className="text-sm">등록된 상품이 없습니다.</p>
                    <p className="text-xs">데일리 소싱에서 상품을 먼저 등록해주세요.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gradient-to-r from-pink-50/80 to-purple-50/80 border-b border-pink-100/50">
                          <th className="text-center px-2 py-3 font-medium text-pink-700 w-10">
                            <button
                              onClick={() => {
                                if (checkedIds.size === displayItems.length && displayItems.length > 0) {
                                  setCheckedIds(new Set());
                                  setEditingIds(new Set());
                                  // Restore all to saved values
                                  const restored: Record<number, string> = { ...editingQty };
                                  displayItems.forEach(i => { restored[i.productId] = savedQty[i.productId] ?? "0"; });
                                  setEditingQty(restored);
                                } else {
                                  const allIds = new Set(displayItems.map(i => i.productId));
                                  setCheckedIds(allIds);
                                  setEditingIds(new Set(allIds));
                                }
                              }}
                              className="hover:bg-pink-100 rounded p-0.5 transition-colors"
                            >
                              {checkedIds.size === displayItems.length && displayItems.length > 0
                                ? <CheckSquare className="h-4 w-4 text-pink-500" />
                                : <Square className="h-4 w-4 text-gray-400" />}
                            </button>
                          </th>
                          <th className="text-left px-4 py-3 font-medium text-pink-700">상품</th>
                          <th className="text-right px-4 py-3 font-medium text-pink-700 w-28">판매가</th>
                          <th className="text-right px-4 py-3 font-medium text-pink-700 w-28">마진</th>
                          <th className="text-center px-4 py-3 font-medium text-pink-700 w-32">판매량</th>
                          <th className="text-right px-4 py-3 font-medium text-purple-700 w-32">일매출</th>
                          <th className="text-right px-4 py-3 font-medium text-pink-700 w-32">일수익</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayItems.map(item => {
                          const qty = parseInt(editingQty[item.productId] || "0", 10) || 0;
                          const liveRevenue = item.sellPrice * qty;
                          const liveProfit = item.margin * qty;
                          const hasMargin = item.margin > 0;
                          const edited = isInEditMode(item.productId);
                          const checked = checkedIds.has(item.productId);
                          return (
                            <tr key={item.productId} className={`border-b border-pink-50/80 transition-colors ${
                              checked ? "bg-pink-50/40" : qty > 0 ? "bg-white" : "bg-gray-50/30"
                            } hover:bg-pink-50/30`}>
                              <td className="px-2 py-3 text-center">
                                <button onClick={() => toggleCheck(item.productId)} className="hover:bg-pink-100 rounded p-0.5 transition-colors">
                                  {checked
                                    ? <CheckSquare className="h-4 w-4 text-pink-500" />
                                    : <Square className="h-4 w-4 text-gray-300" />}
                                </button>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="min-w-0">
                                    <p className="font-medium truncate max-w-[200px]">{item.productName}</p>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                      {item.category && <span className="text-xs text-muted-foreground">{item.category}</span>}
                                      {!hasMargin && <Badge variant="outline" className="text-[10px] border-amber-200 text-amber-600 px-1.5 py-0">마진 미설정</Badge>}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right text-muted-foreground font-mono text-xs">{item.sellPrice > 0 ? `${formatNum(item.sellPrice)}원` : "-"}</td>
                              <td className="px-4 py-3 text-right font-mono text-xs">
                                <span className={hasMargin ? "text-pink-600 font-semibold" : "text-muted-foreground"}>{hasMargin ? `${formatNum(item.margin)}원` : "-"}</span>
                              </td>
                              <td className="px-2 py-2 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  {edited ? (
                                    <>
                                      <Input
                                        type="number" min={0}
                                        value={editingQty[item.productId] ?? ""}
                                        onChange={e => handleQuantityChange(item, e.target.value)}
                                        onKeyDown={e => { if (e.key === "Enter") handleQuantitySave(item); }}
                                        placeholder="0"
                                        className="pretty-input text-center w-20 h-8 text-sm font-semibold border-pink-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-auto [&::-webkit-inner-spin-button]:appearance-auto"
                                        autoFocus
                                      />
                                      <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-500 hover:bg-emerald-50 shrink-0" onClick={() => handleQuantitySave(item)} title="저장">
                                        <CheckCircle className="h-4 w-4" />
                                      </Button>
                                    </>
                                  ) : (
                                    <div className="flex items-center gap-1">
                                      <span className="font-semibold text-sm w-12 text-center">{editingQty[item.productId] || "0"}</span>
                                      <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-pink-500 hover:bg-pink-50 shrink-0" onClick={() => enterEditMode(item.productId)} title="수정하기">
                                        <Pencil className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-xs text-purple-600">{qty > 0 ? `${formatNum(liveRevenue)}원` : "-"}</td>
                              <td className="px-4 py-3 text-right font-mono text-xs">
                                <span className={`font-semibold ${liveProfit > 0 ? "text-pink-600" : liveProfit < 0 ? "text-red-500" : "text-muted-foreground"}`}>{qty > 0 ? `${formatNum(liveProfit)}원` : "-"}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-gradient-to-r from-pink-50 to-purple-50 border-t-2 border-pink-200/50">
                          <td className="px-2 py-3.5"></td>
                          <td className="px-4 py-3.5 font-bold gradient-text flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-pink-400" /> 합계</td>
                          <td className="px-4 py-3.5 text-right"></td>
                          <td className="px-4 py-3.5 text-right"></td>
                          <td className="px-4 py-3.5 text-center font-bold text-blue-600">{formatNum(liveSummary.totalQuantity)}</td>
                          <td className="px-4 py-3.5 text-right font-bold text-purple-600 font-mono">{formatNum(liveSummary.totalRevenue)}원</td>
                          <td className="px-4 py-3.5 text-right font-bold font-mono">
                            <span className={liveSummary.totalProfit >= 0 ? "text-pink-600" : "text-red-500"}>{formatNum(liveSummary.totalProfit)}원</span>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        ) : null}

        {/* WEEKLY VIEW */}
        {viewMode === "weekly" && !isLoading && weeklyReport ? (
          <>
            <PeriodBreakdown
              rows={weeklyBreakdownRows}
              onRowClick={(key) => { setSelectedDate(key); setViewMode("daily"); }}
              activeKey={selectedDate}
              title={`일별 내역 (${weekRange.start} ~ ${weekRange.end})`}
              icon={<CalendarDays className="h-4 w-4 text-amber-500" />}
            />
            <Card className="pretty-card overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-pink-300 via-purple-300 to-fuchsia-300" />
              <CardHeader className="pb-2">
                <CardTitle className="text-sm gradient-text-soft flex items-center gap-2">
                  <Package className="h-4 w-4 text-pink-500" /> 상품별 주간 실적
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ReportTable items={weeklyReport.items} periodLabel="주간" />
              </CardContent>
            </Card>
          </>
        ) : null}

        {/* MONTHLY VIEW */}
        {viewMode === "monthly" && !isLoading && monthlyReport ? (
          <>
            <PeriodBreakdown
              rows={monthlyBreakdownRows}
              title={`주별 내역 (${selectedYear}년 ${selectedMonth}월)`}
              icon={<CalendarRange className="h-4 w-4 text-amber-500" />}
            />
            <Card className="pretty-card overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-pink-300 via-purple-300 to-fuchsia-300" />
              <CardHeader className="pb-2">
                <CardTitle className="text-sm gradient-text-soft flex items-center gap-2">
                  <Package className="h-4 w-4 text-pink-500" /> 상품별 월간 실적
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ReportTable items={monthlyReport.items} periodLabel="월간" />
              </CardContent>
            </Card>
          </>
        ) : null}

        {/* YEARLY VIEW */}
        {viewMode === "yearly" && !isLoading && yearlyReport ? (
          <>
            <PeriodBreakdown
              rows={yearlyBreakdownRows}
              onRowClick={(key) => { setSelectedMonth(Number(key)); setViewMode("monthly"); }}
              title={`월별 내역 (${selectedYear}년)`}
              icon={<BarChart3 className="h-4 w-4 text-amber-500" />}
            />
            <Card className="pretty-card overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-pink-300 via-purple-300 to-fuchsia-300" />
              <CardHeader className="pb-2">
                <CardTitle className="text-sm gradient-text-soft flex items-center gap-2">
                  <Package className="h-4 w-4 text-pink-500" /> 상품별 연간 실적
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ReportTable items={yearlyReport.items} periodLabel="연간" />
              </CardContent>
            </Card>
          </>
        ) : null}

        {/* Tip */}
        <div className="text-xs text-muted-foreground bg-gradient-to-r from-pink-50 to-purple-50 rounded-xl p-3 border border-pink-100/50">
          <span className="font-medium gradient-text-soft">&#x1F4A1; TIP</span>
          <span className="ml-2">
            {viewMode === "daily" ? "체크박스 선택 또는 연필 아이콘 클릭 → 수량 입력 → '선택 저장' 클릭. 되돌리기로 마지막 저장값 복원."
             : viewMode === "weekly" ? "일별 행을 클릭하면 해당 날짜의 일별 뷰로 이동합니다. CSV 다운로드로 주간 리포트를 저장하세요."
             : viewMode === "monthly" ? "월간 리포트에서 주별 매출 추이와 상품별 실적을 확인하세요. CSV로 내보낼 수 있습니다."
             : "월별 행을 클릭하면 해당 월의 월간 뷰로 이동합니다. 연간 수익 추이를 한눈에 파악하세요."}
          </span>
        </div>
      </div>
    </DashboardLayout>
  );
}
