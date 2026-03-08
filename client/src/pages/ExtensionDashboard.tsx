import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Search, Star, TrendingUp, Package, ArrowUpRight, ArrowDownRight,
  Trash2, Target, BarChart3, Eye, ExternalLink, Download,
  Brain, Bell, Users, ChevronDown, ChevronUp, Minus,
  FileDown, Activity, Lightbulb, Zap, AlertTriangle, CheckCircle,
  FileText, BellRing, BellOff, Clock, Shield, Sparkles,
  ThumbsUp, ThumbsDown, Info, X, ChevronRight
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, AreaChart, Area, Legend, PieChart, Pie, Cell, RadarChart,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from "recharts";

const statusLabels: Record<string, string> = {
  new: "신규", reviewing: "검토중", contacted_supplier: "공급처 연락",
  sample_ordered: "샘플 주문", dropped: "탈락", selected: "선정",
};
const statusColors: Record<string, string> = {
  new: "bg-blue-100 text-blue-700", reviewing: "bg-amber-100 text-amber-700",
  contacted_supplier: "bg-indigo-100 text-indigo-700", sample_ordered: "bg-pink-100 text-pink-700",
  dropped: "bg-gray-100 text-gray-500", selected: "bg-green-100 text-green-700",
};
const competitionColors: Record<string, string> = { easy: "bg-green-100 text-green-700", medium: "bg-yellow-100 text-yellow-700", hard: "bg-red-100 text-red-700" };
const competitionLabels: Record<string, string> = { easy: "약함", medium: "보통", hard: "강함" };

const notifTypeIcons: Record<string, string> = {
  rank_change: "📊", price_change: "💰", new_competitor: "🆕",
  ai_recommendation: "🔮", milestone: "🎯", system: "⚙️",
};
const notifPriorityColors: Record<string, string> = {
  low: "border-gray-200", medium: "border-blue-200", high: "border-red-200",
};
const severityColors: Record<string, string> = {
  low: "bg-green-100 text-green-700", medium: "bg-yellow-100 text-yellow-700", high: "bg-red-100 text-red-700",
};
const potentialColors: Record<string, string> = {
  low: "bg-gray-100 text-gray-700", medium: "bg-blue-100 text-blue-700", high: "bg-green-100 text-green-700",
};
const PIE_COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899"];

function formatPrice(n: number | null | undefined) {
  if (n === null || n === undefined) return "-";
  return n.toLocaleString("ko-KR") + "원";
}

function ChangeIndicator({ value }: { value: number | null }) {
  if (value === null || value === 0) return <Minus className="w-3 h-3 text-gray-400" />;
  if (value > 0) return <span className="flex items-center gap-0.5 text-green-600 text-xs font-bold"><ArrowUpRight className="w-3 h-3" />+{value}</span>;
  return <span className="flex items-center gap-0.5 text-red-600 text-xs font-bold"><ArrowDownRight className="w-3 h-3" />{value}</span>;
}

type TabKey = "overview" | "trends" | "candidates" | "ranking" | "competitors" | "ai" | "reviews" | "notifications" | "history" | "wing";

export default function ExtensionDashboard() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAllSnapshots, setShowAllSnapshots] = useState(false);
  const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null);
  const [rankDays, setRankDays] = useState(7);
  const [trendDays, setTrendDays] = useState(30);
  const [competitorKeyword, setCompetitorKeyword] = useState<string | null>(null);
  const [reviewQuery, setReviewQuery] = useState("");
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [selectedRankProduct, setSelectedRankProduct] = useState<string | null>(null);
  const [wingKeyword, setWingKeyword] = useState("");

  // ===== Queries =====
  const searchStats = trpc.extension.searchStats.useQuery();
  const candidateStats = trpc.extension.candidateStats.useQuery();
  const candidates = trpc.extension.listCandidates.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter as any, limit: 50,
  });
  const snapshots = trpc.extension.listSnapshots.useQuery({
    limit: showAllSnapshots ? 50 : 10, query: searchQuery || undefined,
  });
  const trackedKeywords = trpc.extension.listTrackedKeywords.useQuery();
  const latestRanking = trpc.extension.getLatestRanking.useQuery(
    { query: selectedKeyword || "" }, { enabled: !!selectedKeyword }
  );
  const rankHistory = trpc.extension.getRankHistory.useQuery(
    { query: selectedKeyword || "", days: rankDays }, { enabled: !!selectedKeyword }
  );
  const rankTrendChart = trpc.extension.rankTrendChart.useQuery(
    { query: selectedKeyword || "", coupangProductId: selectedRankProduct || "", days: rankDays },
    { enabled: !!selectedKeyword && !!selectedRankProduct }
  );

  // Phase 5 queries
  const searchTrends = trpc.extension.searchTrends.useQuery(
    { days: trendDays }, { enabled: activeTab === "trends" || activeTab === "overview" }
  );
  const aiRecommendations = trpc.extension.aiSourcingRecommendation.useQuery(
    undefined, { enabled: activeTab === "ai" || activeTab === "overview" }
  );
  const activitySummary = trpc.extension.activitySummary.useQuery(
    { days: 7 }, { enabled: activeTab === "overview" }
  );
  const competitorData = trpc.extension.competitorMonitor.useQuery(
    { query: competitorKeyword || "", days: 7, topN: 10 },
    { enabled: !!competitorKeyword && activeTab === "competitors" }
  );

  // Phase 6 queries
  const reviewAnalyses = trpc.extension.getReviewAnalysis.useQuery(
    { limit: 20 }, { enabled: activeTab === "reviews" || activeTab === "overview" }
  );
  const notifications = trpc.extension.listNotifications.useQuery(
    { limit: 50, unreadOnly: false }, { enabled: activeTab === "notifications" || showNotifPanel }
  );
  const unreadCount = trpc.extension.unreadNotificationCount.useQuery(
    undefined, { refetchInterval: 30000 }
  );
  const reportData = trpc.extension.getReportData.useQuery(
    { days: 30 }, { enabled: pdfGenerating }
  );

  // WING queries
  const wingSearches = trpc.extension.listWingSearches.useQuery(
    { keyword: wingKeyword || undefined, limit: 30 },
    { enabled: activeTab === "wing" || activeTab === "overview" }
  );
  const wingStats = trpc.extension.wingStats.useQuery(
    undefined, { enabled: activeTab === "wing" || activeTab === "overview" }
  );

  // WING mutations
  const deleteWingSearch = trpc.extension.deleteWingSearch.useMutation({
    onSuccess: () => { wingSearches.refetch(); wingStats.refetch(); toast.success("삭제됨"); },
    onError: (err: any) => toast.error(err.message || "삭제 실패"),
  });
  const deleteAllWingSearches = trpc.extension.deleteAllWingSearches.useMutation({
    onSuccess: () => { wingSearches.refetch(); wingStats.refetch(); toast.success("전체 삭제됨"); },
    onError: (err: any) => toast.error(err.message || "삭제 실패"),
  });

  // ===== Mutations =====
  const updateCandidate = trpc.extension.updateCandidate.useMutation({
    onSuccess: () => { candidates.refetch(); candidateStats.refetch(); toast.success("상태 변경됨"); },
    onError: (err) => toast.error(err.message || "상태 변경 실패"),
  });
  const promoteToProduct = trpc.extension.promoteToProduct.useMutation({
    onSuccess: (data) => { candidates.refetch(); candidateStats.refetch(); toast.success(data.message || "소싱 상품 등록 완료"); },
    onError: (err) => toast.error(err.message),
  });
  const removeCandidate = trpc.extension.removeCandidate.useMutation({
    onSuccess: () => { candidates.refetch(); candidateStats.refetch(); toast.success("삭제됨"); },
    onError: (err) => toast.error(err.message || "삭제 실패"),
  });
  const removeTrackedKeyword = trpc.extension.removeTrackedKeyword.useMutation({
    onSuccess: () => { trackedKeywords.refetch(); toast.success("추적 키워드 삭제됨"); },
    onError: (err) => toast.error(err.message || "키워드 삭제 실패"),
  });
  const analyzeReviews = trpc.extension.analyzeReviews.useMutation({
    onSuccess: () => {
      reviewAnalyses.refetch();
      notifications.refetch();
      unreadCount.refetch();
      toast.success("AI 리뷰 분석 완료!");
    },
    onError: (err) => toast.error(err.message),
  });
  const markRead = trpc.extension.markNotificationRead.useMutation({
    onSuccess: () => { notifications.refetch(); unreadCount.refetch(); },
    onError: (err) => toast.error(err.message || "알림 읽음 처리 실패"),
  });
  const markAllRead = trpc.extension.markAllNotificationsRead.useMutation({
    onSuccess: () => { notifications.refetch(); unreadCount.refetch(); toast.success("모든 알림 읽음 처리됨"); },
    onError: (err) => toast.error(err.message || "알림 읽음 처리 실패"),
  });
  const deleteNotification = trpc.extension.deleteNotification.useMutation({
    onSuccess: () => { notifications.refetch(); unreadCount.refetch(); },
    onError: (err) => toast.error(err.message || "알림 삭제 실패"),
  });
  const cleanOldNotifs = trpc.extension.cleanOldNotifications.useMutation({
    onSuccess: () => { notifications.refetch(); unreadCount.refetch(); toast.success("오래된 알림 정리됨"); },
    onError: (err) => toast.error(err.message || "알림 정리 실패"),
  });

  const stats = searchStats.data;
  const cStats = candidateStats.data;
  const activity = activitySummary.data;

  const tabs: { key: TabKey; label: string; icon: any; badge?: number }[] = [
    { key: "overview", label: "대시보드", icon: BarChart3 },
    { key: "trends", label: "트렌드", icon: TrendingUp },
    { key: "candidates", label: "소싱 후보", icon: Star },
    { key: "ranking", label: "순위 추적", icon: Target },
    { key: "competitors", label: "경쟁자", icon: Users },
    { key: "ai", label: "AI 추천", icon: Brain },
    { key: "reviews", label: "리뷰 분석", icon: Sparkles },
    { key: "notifications", label: "알림", icon: Bell, badge: unreadCount.data?.count || 0 },
    { key: "wing", label: "WING", icon: Eye },
    { key: "history", label: "검색 이력", icon: Search },
  ];

  // CSV Export helper
  function exportCSV(data: any[], filename: string) {
    if (!data?.length) { toast.error("내보낼 데이터가 없습니다"); return; }
    const keys = Object.keys(data[0]);
    const bom = '\uFEFF';
    const csv = bom + keys.join(',') + '\n' + data.map(row =>
      keys.map(k => {
        const v = row[k];
        if (typeof v === 'string' && (v.includes(',') || v.includes('"'))) return `"${v.replace(/"/g, '""')}"`;
        return v ?? '';
      }).join(',')
    ).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV 다운로드 완료");
  }

  // PDF generation using jsPDF
  const generatePDF = useCallback(async () => {
    setPdfGenerating(true);
    toast.info("PDF 보고서 생성 중...");
    try {
      const { default: jsPDF } = await import("jspdf");
      const autoTableModule = await import("jspdf-autotable");
      const autoTable = autoTableModule.default || autoTableModule;

      const doc = new jsPDF("p", "mm", "a4");
      const pageWidth = doc.internal.pageSize.getWidth();
      let y = 20;

      // Title
      doc.setFontSize(20);
      doc.setTextColor(99, 102, 241);
      doc.text("Coupang Sourcing Helper Report", pageWidth / 2, y, { align: "center" });
      y += 10;
      doc.setFontSize(10);
      doc.setTextColor(128, 128, 128);
      doc.text(`Generated: ${new Date().toLocaleString("ko-KR")} | Period: Last 30 days`, pageWidth / 2, y, { align: "center" });
      y += 15;

      // Search Stats
      doc.setFontSize(14);
      doc.setTextColor(0, 0, 0);
      doc.text("1. Search Statistics", 15, y);
      y += 8;

      const sData = stats;
      if (sData) {
        autoTable(doc, {
          startY: y,
          head: [["Total Searches", "Unique Queries", "Avg Competition", "Avg Price"]],
          body: [[
            sData.totalSearches ?? 0,
            sData.uniqueQueries ?? 0,
            sData.avgCompetition ?? "-",
            formatPrice(sData.avgPrice as any),
          ]],
          theme: "grid",
          headStyles: { fillColor: [99, 102, 241] },
          margin: { left: 15, right: 15 },
        });
        y = (doc as any).lastAutoTable?.finalY + 10 || y + 25;
      }

      // Top Keywords
      if (sData?.topQueries?.length) {
        doc.setFontSize(14);
        doc.text("2. Top Keywords", 15, y);
        y += 8;
        autoTable(doc, {
          startY: y,
          head: [["Keyword", "Count", "Avg Competition"]],
          body: (sData.topQueries as any[]).map((q: any) => [
            q.query, q.count, q.avgCompetition ?? "-",
          ]),
          theme: "grid",
          headStyles: { fillColor: [245, 158, 11] },
          margin: { left: 15, right: 15 },
        });
        y = (doc as any).lastAutoTable?.finalY + 10 || y + 40;
      }

      // Candidate Stats
      const cs = cStats;
      if (cs) {
        if (y > 240) { doc.addPage(); y = 20; }
        doc.setFontSize(14);
        doc.text("3. Sourcing Candidates", 15, y);
        y += 8;
        autoTable(doc, {
          startY: y,
          head: [["Total", "Avg Score", "Avg Price"]],
          body: [[cs.total ?? 0, cs.avgScore ?? "-", formatPrice(cs.avgPrice as any)]],
          theme: "grid",
          headStyles: { fillColor: [16, 185, 129] },
          margin: { left: 15, right: 15 },
        });
        y = (doc as any).lastAutoTable?.finalY + 10 || y + 25;

        if ((cs.statusCounts as any[])?.length) {
          autoTable(doc, {
            startY: y,
            head: [["Status", "Count"]],
            body: (cs.statusCounts as any[]).map((s: any) => [
              statusLabels[s.status] || s.status, s.count,
            ]),
            theme: "grid",
            headStyles: { fillColor: [139, 92, 246] },
            margin: { left: 15, right: 15 },
          });
          y = (doc as any).lastAutoTable?.finalY + 10 || y + 30;
        }
      }

      // AI Review Analyses
      const reviews = reviewAnalyses.data;
      if (reviews?.length) {
        if (y > 200) { doc.addPage(); y = 20; }
        doc.setFontSize(14);
        doc.text("4. AI Review Analyses", 15, y);
        y += 8;
        for (const analysis of reviews.slice(0, 3) as any[]) {
          if (y > 250) { doc.addPage(); y = 20; }
          doc.setFontSize(11);
          doc.setTextColor(99, 102, 241);
          doc.text(`Keyword: "${analysis.query}"`, 15, y);
          y += 6;
          doc.setFontSize(9);
          doc.setTextColor(80, 80, 80);
          const summaryLines = doc.splitTextToSize(analysis.summaryText || "", pageWidth - 30);
          doc.text(summaryLines, 15, y);
          y += summaryLines.length * 4 + 6;
          doc.setTextColor(0, 0, 0);

          if (analysis.opportunities?.length) {
            autoTable(doc, {
              startY: y,
              head: [["Opportunity", "Potential"]],
              body: analysis.opportunities.slice(0, 3).map((o: any) => [o.title, o.potential]),
              theme: "grid",
              headStyles: { fillColor: [16, 185, 129] },
              margin: { left: 15, right: 15 },
              styles: { fontSize: 8 },
            });
            y = (doc as any).lastAutoTable?.finalY + 8 || y + 20;
          }
        }
      }

      // Activity Summary
      if (activity) {
        if (y > 230) { doc.addPage(); y = 20; }
        doc.setFontSize(14);
        doc.setTextColor(0, 0, 0);
        doc.text("5. Activity Summary (7 Days)", 15, y);
        y += 8;
        autoTable(doc, {
          startY: y,
          head: [["Searches", "Candidates", "Rank Records", "Product Details"]],
          body: [[activity.searches, activity.candidates, activity.rankRecords, activity.productDetails]],
          theme: "grid",
          headStyles: { fillColor: [99, 102, 241] },
          margin: { left: 15, right: 15 },
        });
        y = (doc as any).lastAutoTable?.finalY + 10 || y + 25;
      }

      // Footer
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(180, 180, 180);
        doc.text(`Coupang Sourcing Helper v5.0 | lumiriz.kr | Page ${i}/${pageCount}`, pageWidth / 2, 290, { align: "center" });
      }

      doc.save(`sourcing_report_${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success("PDF 보고서 다운로드 완료!");
    } catch (err: any) {
      console.error("PDF generation error:", err);
      toast.error("PDF 생성 실패: " + (err.message || "알 수 없는 오류"));
    } finally {
      setPdfGenerating(false);
    }
  }, [stats, cStats, reviewAnalyses.data, activity]);

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6">
        {/* 페이지 헤더 */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold">🐢 소싱 헬퍼 대시보드</h1>
            <p className="text-gray-500 text-sm mt-1">Chrome 확장프로그램 · 쿠팡 검색 분석 · 순위 추적 · AI 소싱 추천 · 리뷰 분석 · 알림</p>
          </div>
          <div className="flex items-center gap-2">
            {/* 알림 벨 */}
            <div className="relative">
              <Button variant="ghost" size="sm" className="relative"
                onClick={() => setShowNotifPanel(!showNotifPanel)}>
                <Bell className="w-5 h-5" />
                {(unreadCount.data?.count || 0) > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                    {unreadCount.data!.count > 99 ? "99+" : unreadCount.data!.count}
                  </span>
                )}
              </Button>

              {/* 알림 드롭다운 */}
              {showNotifPanel && (
                <div className="absolute right-0 top-10 w-80 bg-white rounded-xl shadow-2xl border z-50 max-h-96 overflow-hidden">
                  <div className="p-3 border-b bg-gray-50 flex items-center justify-between">
                    <span className="font-semibold text-sm">알림 센터</span>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="text-xs h-6 px-2"
                        onClick={() => markAllRead.mutate()}>모두 읽음</Button>
                      <Button variant="ghost" size="sm" className="text-xs h-6 px-2"
                        onClick={() => setShowNotifPanel(false)}><X className="w-3 h-3" /></Button>
                    </div>
                  </div>
                  <div className="overflow-y-auto max-h-72">
                    {!notifications.data?.length ? (
                      <div className="p-6 text-center text-gray-400 text-sm">
                        <BellOff className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        알림이 없습니다
                      </div>
                    ) : (
                      notifications.data.slice(0, 10).map((n: any) => (
                        <div key={n.id}
                          className={`p-3 border-b hover:bg-gray-50 transition cursor-pointer ${!n.isRead ? 'bg-blue-50/50' : ''}`}
                          onClick={() => { if (!n.isRead) markRead.mutate({ id: n.id }); }}>
                          <div className="flex items-start gap-2">
                            <span className="text-lg">{notifTypeIcons[n.type] || "📌"}</span>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-xs line-clamp-1">{n.title}</div>
                              <div className="text-[11px] text-gray-500 line-clamp-2 mt-0.5">{n.message}</div>
                              <div className="text-[10px] text-gray-400 mt-1">
                                {new Date(n.createdAt).toLocaleString("ko-KR", {
                                  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
                                })}
                              </div>
                            </div>
                            {!n.isRead && <span className="w-2 h-2 bg-blue-500 rounded-full mt-1 shrink-0" />}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="p-2 border-t bg-gray-50">
                    <Button variant="ghost" size="sm" className="w-full text-xs text-indigo-600"
                      onClick={() => { setActiveTab("notifications"); setShowNotifPanel(false); }}>
                      모든 알림 보기 <ChevronRight className="w-3 h-3 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* PDF 보고서 */}
            <Button variant="outline" size="sm" className="text-xs gap-1"
              onClick={generatePDF} disabled={pdfGenerating}>
              <FileText className="w-3.5 h-3.5" />
              {pdfGenerating ? "생성중..." : "PDF 보고서"}
            </Button>

            <Badge variant="outline" className="text-xs">v5.0</Badge>
          </div>
        </div>

        {/* 탭 네비게이션 */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-all whitespace-nowrap relative ${
                activeTab === t.key ? "bg-white text-indigo-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}>
              <t.icon className="w-3.5 h-3.5" />{t.label}
              {t.badge ? (
                <span className="bg-red-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center ml-0.5">
                  {t.badge > 9 ? "9+" : t.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {/* ===== 대시보드 탭 ===== */}
        {activeTab === "overview" && (
          <>
            {/* 활동 요약 배너 */}
            {activity && (
              <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl p-5 text-white">
                <h3 className="font-bold text-lg mb-2 flex items-center gap-2"><Activity className="w-5 h-5" /> 최근 7일 활동</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div><div className="text-2xl font-bold">{activity.searches}</div><div className="text-white/70 text-xs">검색 분석</div></div>
                  <div><div className="text-2xl font-bold">{activity.candidates}</div><div className="text-white/70 text-xs">후보 저장</div></div>
                  <div><div className="text-2xl font-bold">{activity.rankRecords}</div><div className="text-white/70 text-xs">순위 기록</div></div>
                  <div><div className="text-2xl font-bold">{activity.productDetails}</div><div className="text-white/70 text-xs">상세 파싱</div></div>
                </div>
              </div>
            )}

            {/* 통계 카드 */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <Card><CardContent className="pt-4 pb-4 text-center">
                <div className="text-2xl font-bold text-indigo-600">{stats?.totalSearches ?? 0}</div>
                <div className="text-xs text-gray-500 mt-1">총 검색</div>
              </CardContent></Card>
              <Card><CardContent className="pt-4 pb-4 text-center">
                <div className="text-2xl font-bold text-indigo-600">{stats?.uniqueQueries ?? 0}</div>
                <div className="text-xs text-gray-500 mt-1">검색어 수</div>
              </CardContent></Card>
              <Card><CardContent className="pt-4 pb-4 text-center">
                <div className="text-2xl font-bold text-indigo-600">{stats?.avgCompetition ?? '-'}</div>
                <div className="text-xs text-gray-500 mt-1">평균 경쟁도</div>
              </CardContent></Card>
              <Card><CardContent className="pt-4 pb-4 text-center">
                <div className="text-2xl font-bold text-amber-600">{cStats?.total ?? 0}</div>
                <div className="text-xs text-gray-500 mt-1">저장 후보</div>
              </CardContent></Card>
              <Card><CardContent className="pt-4 pb-4 text-center">
                <div className="text-2xl font-bold text-green-600">{cStats?.avgScore ?? '-'}</div>
                <div className="text-xs text-gray-500 mt-1">평균 소싱점수</div>
              </CardContent></Card>
              <Card><CardContent className="pt-4 pb-4 text-center">
                <div className="text-2xl font-bold text-purple-600">{trackedKeywords.data?.length ?? 0}</div>
                <div className="text-xs text-gray-500 mt-1">추적 키워드</div>
              </CardContent></Card>
            </div>

            {/* 검색 트렌드 미니 차트 */}
            {searchTrends.data && searchTrends.data.length > 1 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    검색 트렌드 (30일)
                    <Button variant="ghost" size="sm" className="text-xs ml-auto" onClick={() => setActiveTab("trends")}>
                      자세히 보기
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={searchTrends.data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip contentStyle={{ fontSize: 12 }} />
                      <Area type="monotone" dataKey="count" stroke="#6366f1" fill="#e0e7ff" name="검색 횟수" />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* AI 추천 + 리뷰 분석 미리보기 */}
            <div className="grid md:grid-cols-2 gap-4">
              {/* AI 추천 */}
              {aiRecommendations.data?.recommendations?.length ? (
                <Card className="border-indigo-200 bg-gradient-to-r from-indigo-50 to-purple-50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Brain className="w-4 h-4 text-indigo-500" /> AI 소싱 추천
                      <Button variant="ghost" size="sm" className="text-xs ml-auto" onClick={() => setActiveTab("ai")}>
                        전체 보기
                      </Button>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {aiRecommendations.data.recommendations.slice(0, 2).map((rec: any, i: number) => (
                        <div key={i} className="bg-white rounded-lg p-3 shadow-sm">
                          <div className="font-semibold text-sm mb-1">{rec.title}</div>
                          <div className="text-xs text-gray-500">{rec.items?.length || 0}개 항목</div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              {/* 최근 리뷰 분석 */}
              {reviewAnalyses.data?.length ? (
                <Card className="border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-emerald-500" /> 최근 리뷰 분석
                      <Badge className="bg-emerald-100 text-emerald-700 text-[9px] px-1.5 py-0">GPT</Badge>
                      <Button variant="ghost" size="sm" className="text-xs ml-auto" onClick={() => setActiveTab("reviews")}>
                        전체 보기
                      </Button>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {(reviewAnalyses.data as any[]).slice(0, 2).map((a: any, i: number) => (
                        <div key={i} className="bg-white rounded-lg p-3 shadow-sm">
                          <div className="flex items-center justify-between mb-1">
                            <div className="font-semibold text-sm">"{a.query}"</div>
                            {a.aiPowered !== false && <Badge className="bg-emerald-100 text-emerald-700 text-[9px]">AI</Badge>}
                          </div>
                          <div className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                            <span>{a.opportunities?.length || 0}개 기회</span>
                            <span>{a.painPoints?.length || 0}개 주의</span>
                            <span>{a.recommendations?.length || 0}개 추천</span>
                          </div>
                          {a.summaryText && (
                            <p className="text-[11px] text-gray-500 mt-1 line-clamp-2">{a.summaryText}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ) : null}
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              {/* 자주 검색한 키워드 */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">자주 검색한 키워드 TOP 10</CardTitle>
                </CardHeader>
                <CardContent>
                  {stats?.topQueries?.length ? (
                    <div className="space-y-2">
                      {(stats.topQueries as any[]).map((q: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-sm py-1.5 border-b border-gray-50 last:border-0">
                          <span className="text-xs text-gray-400 w-5">{i + 1}</span>
                          <span className="font-medium text-indigo-600 flex-1">"{q.query}"</span>
                          <span className="text-xs text-gray-400">{q.count}회</span>
                          <Badge variant="outline" className="text-[10px]">경쟁 {q.avgCompetition ?? '-'}점</Badge>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-sm text-gray-400 text-center py-8">검색 기록이 없습니다</p>}
                </CardContent>
              </Card>

              {/* 후보 상태별 현황 */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">후보 상태별 현황</CardTitle></CardHeader>
                <CardContent>
                  {cStats?.statusCounts?.length ? (
                    <div className="space-y-3">
                      {(cStats.statusCounts as any[]).map((s: any) => (
                        <div key={s.status} className="flex items-center justify-between">
                          <Badge className={`${statusColors[s.status] || 'bg-gray-100'} text-xs`}>{statusLabels[s.status] || s.status}</Badge>
                          <span className="text-lg font-bold">{s.count}</span>
                        </div>
                      ))}
                      <div className="pt-2 border-t text-sm text-gray-500">
                        평균 소싱점수: <strong>{cStats.avgScore || '-'}</strong> · 평균가: <strong>{formatPrice(cStats.avgPrice as any)}</strong>
                      </div>
                    </div>
                  ) : <p className="text-sm text-gray-400 text-center py-8">후보가 없습니다</p>}
                </CardContent>
              </Card>
            </div>
          </>
        )}

        {/* ===== 트렌드 탭 ===== */}
        {activeTab === "trends" && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold flex items-center gap-2"><TrendingUp className="w-5 h-5" /> 검색 트렌드</h2>
              <div className="flex gap-1">
                {[7, 14, 30, 60].map(d => (
                  <button key={d} className={`px-3 py-1 text-xs rounded-full ${trendDays === d ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}
                    onClick={() => setTrendDays(d)}>{d}일</button>
                ))}
              </div>
            </div>

            {searchTrends.data && searchTrends.data.length > 0 ? (
              <div className="grid gap-4">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">일별 검색 횟수</CardTitle></CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={searchTrends.data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip contentStyle={{ fontSize: 12 }} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="count" fill="#6366f1" name="검색 횟수" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="uniqueQueries" fill="#a5b4fc" name="검색어 수" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">평균 경쟁도 변화</CardTitle></CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <LineChart data={searchTrends.data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                        <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                        <Tooltip contentStyle={{ fontSize: 12 }} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Line type="monotone" dataKey="avgCompetition" stroke="#f59e0b" strokeWidth={2} name="평균 경쟁도" dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">평균 가격 추이</CardTitle></CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <AreaChart data={searchTrends.data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                        <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => formatPrice(v)} />
                        <Area type="monotone" dataKey="avgPrice" stroke="#16a34a" fill="#dcfce7" name="평균 가격" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <Card><CardContent className="py-16 text-center text-gray-400">
                <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>검색 데이터가 쌓이면 트렌드를 확인할 수 있습니다.</p>
              </CardContent></Card>
            )}
          </>
        )}

        {/* ===== 소싱 후보 탭 ===== */}
        {activeTab === "candidates" && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-lg">소싱 후보 관리</CardTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button variant="outline" size="sm" className="text-xs gap-1"
                    onClick={() => candidates.data && exportCSV(candidates.data as any[], `candidates_${new Date().toISOString().slice(0, 10)}.csv`)}>
                    <FileDown className="w-3 h-3" /> CSV
                  </Button>
                  {(cStats?.statusCounts as any[] || []).map((s: any) => (
                    <span key={s.status}
                      className={`text-xs px-2 py-1 rounded-full cursor-pointer ${statusColors[s.status] || 'bg-gray-100'} ${statusFilter === s.status ? 'ring-2 ring-indigo-400' : ''}`}
                      onClick={() => setStatusFilter(statusFilter === s.status ? "all" : s.status)}>
                      {statusLabels[s.status] || s.status} {s.count}
                    </span>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {!candidates.data?.length ? (
                <div className="text-center py-8 text-gray-400">소싱 후보가 없습니다.<br />Chrome 확장프로그램에서 상품을 저장하세요.</div>
              ) : (
                <div className="space-y-3">
                  {candidates.data.map((c: any) => (
                    <div key={c.id} className="border rounded-lg p-3 hover:shadow-sm transition-shadow">
                      <div className="flex gap-3">
                        {c.imageUrl && <img src={c.imageUrl} alt="" className="w-16 h-16 rounded-lg object-cover bg-gray-100 flex-shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <Badge variant="outline" className={`text-[10px] ${statusColors[c.status]}`}>{statusLabels[c.status]}</Badge>
                            {c.sourcingGrade && <Badge variant="secondary" className="text-[10px]">소싱 {c.sourcingGrade} ({c.sourcingScore}점)</Badge>}
                            {c.searchQuery && <span className="text-[10px] text-gray-400">"{c.searchQuery}"</span>}
                          </div>
                          <div className="font-semibold text-sm line-clamp-2">{c.title}</div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                            <span className="font-bold text-red-500">{formatPrice(c.price)}</span>
                            <span>평점 {c.rating || '-'}</span>
                            <span>리뷰 {c.reviewCount?.toLocaleString() || '0'}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-2 pt-2 border-t flex-wrap">
                        <Select value={c.status} onValueChange={(val) => updateCandidate.mutate({ id: c.id, status: val as any })}>
                          <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
                          <SelectContent>{Object.entries(statusLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                        </Select>
                        {c.coupangUrl && (
                          <a href={c.coupangUrl} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline flex items-center gap-0.5">
                            쿠팡 <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                        <Button variant="outline" size="sm" className="h-7 text-xs ml-auto"
                          onClick={() => { if (confirm("소싱 상품 등록?")) promoteToProduct.mutate({ candidateId: c.id }); }}>승격</Button>
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-red-500"
                          onClick={() => { if (confirm("삭제?")) removeCandidate.mutate({ id: c.id }); }}><Trash2 className="w-3 h-3" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ===== 순위 추적 탭 ===== */}
        {activeTab === "ranking" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2"><Target className="w-4 h-4" /> 추적 키워드</CardTitle>
                </CardHeader>
                <CardContent>
                  {!trackedKeywords.data?.length ? (
                    <p className="text-gray-400 text-sm text-center py-4">추적 키워드가 없습니다.</p>
                  ) : (
                    <div className="space-y-2">
                      {(trackedKeywords.data as any[]).map((kw: any) => (
                        <div key={kw.id}
                          className={`flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition ${
                            selectedKeyword === kw.query ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-gray-50'}`}
                          onClick={() => setSelectedKeyword(kw.query)}>
                          <div className="min-w-0">
                            <div className="font-medium text-sm text-indigo-600 truncate">"{kw.query}"</div>
                            {kw.targetProductName && <div className="text-[10px] text-gray-400 truncate mt-0.5">타겟: {kw.targetProductName}</div>}
                          </div>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-400"
                            onClick={(e) => { e.stopPropagation(); if (confirm("추적 삭제?")) removeTrackedKeyword.mutate({ id: kw.id }); }}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="lg:col-span-2 space-y-4">
              {selectedKeyword ? (
                <>
                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-semibold">"{selectedKeyword}" 최신 순위</CardTitle>
                        <Badge variant="outline" className="text-xs">{latestRanking.data?.length || 0}개 상품</Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {!latestRanking.data?.length ? (
                        <p className="text-gray-400 text-sm text-center py-4">순위 데이터가 없습니다.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead><tr className="border-b bg-gray-50 text-xs text-gray-500">
                              <th className="text-center p-2 w-12">순위</th>
                              <th className="text-left p-2">상품명</th>
                              <th className="text-center p-2">가격</th>
                              <th className="text-center p-2">리뷰</th>
                              <th className="text-center p-2">평점</th>
                              <th className="text-center p-2">표시</th>
                            </tr></thead>
                            <tbody>
                              {(latestRanking.data as any[]).map((r: any) => {
                                const tkData = (trackedKeywords.data as any[])?.find((k: any) => k.query === selectedKeyword);
                                const isTarget = tkData?.targetProductId && r.coupangProductId === tkData.targetProductId;
                                return (
                                  <tr key={r.id} className={`border-b ${isTarget ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}>
                                    <td className="p-2 text-center font-bold text-indigo-600">#{r.position}</td>
                                    <td className="p-2"><div className="font-medium text-xs line-clamp-1">{r.title || r.coupangProductId}</div></td>
                                    <td className="p-2 text-center text-xs font-semibold text-red-500">{formatPrice(r.price)}</td>
                                    <td className="p-2 text-center text-xs">{r.reviewCount}</td>
                                    <td className="p-2 text-center text-xs">{r.rating}</td>
                                    <td className="p-2 text-center">
                                      <div className="flex gap-1 justify-center">
                                        {r.isAd && <Badge variant="outline" className="text-[9px] border-amber-300 text-amber-600">AD</Badge>}
                                        {r.isRocket && <span className="text-[10px]">🚀</span>}
                                        {isTarget && <Badge className="text-[9px] bg-indigo-600">타겟</Badge>}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* 순위 트렌드 차트 */}
                  {selectedRankProduct && rankTrendChart.data && rankTrendChart.data.length > 1 && (
                    <Card className="border-indigo-200">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm font-semibold flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-indigo-500" /> 순위 트렌드 차트
                            <Badge variant="outline" className="text-[10px]">{selectedRankProduct}</Badge>
                          </CardTitle>
                          <Button variant="ghost" size="sm" className="h-6 text-[10px] text-gray-400"
                            onClick={() => setSelectedRankProduct(null)}>닫기</Button>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={200}>
                          <LineChart data={rankTrendChart.data}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                            <YAxis tick={{ fontSize: 10 }} reversed domain={[1, 'auto']} />
                            <Tooltip contentStyle={{ fontSize: 12 }} />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Line type="monotone" dataKey="avgPosition" stroke="#6366f1" strokeWidth={2} name="평균 순위" dot={{ r: 3 }} />
                          </LineChart>
                        </ResponsiveContainer>
                        <p className="text-[10px] text-gray-400 text-center mt-1">* 순위가 낮을수록(1에 가까울수록) 좋습니다</p>
                      </CardContent>
                    </Card>
                  )}

                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-semibold">순위 변동 히스토리</CardTitle>
                        <div className="flex gap-1">
                          {[7, 14, 30].map(d => (
                            <button key={d} className={`px-2 py-1 text-xs rounded ${rankDays === d ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}
                              onClick={() => setRankDays(d)}>{d}일</button>
                          ))}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {!rankHistory.data?.length ? (
                        <p className="text-gray-400 text-sm text-center py-4">해당 기간의 순위 데이터가 없습니다.</p>
                      ) : (
                        <div className="max-h-64 overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-white"><tr className="border-b text-gray-500">
                              <th className="text-left p-1.5">시간</th><th className="text-center p-1.5">순위</th>
                              <th className="text-left p-1.5">상품</th><th className="text-center p-1.5">가격</th><th className="text-center p-1.5">리뷰</th>
                            </tr></thead>
                            <tbody>
                              {(rankHistory.data as any[]).slice(0, 100).map((r: any, i: number) => (
                                <tr key={i} className={`border-b border-gray-50 hover:bg-gray-50 cursor-pointer ${selectedRankProduct === r.coupangProductId ? 'bg-indigo-50' : ''}`}
                                  onClick={() => setSelectedRankProduct(r.coupangProductId)}>
                                  <td className="p-1.5 text-gray-400">{new Date(r.capturedAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                                  <td className="p-1.5 text-center font-bold text-indigo-600">#{r.position}</td>
                                  <td className="p-1.5 truncate max-w-[200px]">{r.title || r.coupangProductId}</td>
                                  <td className="p-1.5 text-center">{formatPrice(r.price)}</td>
                                  <td className="p-1.5 text-center">{r.reviewCount}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <p className="text-[10px] text-gray-400 text-center mt-2">* 행을 클릭하면 해당 상품의 순위 트렌드 차트가 표시됩니다</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </>
              ) : (
                <Card><CardContent className="py-16 text-center text-gray-400">
                  <Target className="w-12 h-12 mx-auto mb-3 opacity-30" /><p>좌측에서 추적 키워드를 선택하세요</p>
                </CardContent></Card>
              )}
            </div>
          </div>
        )}

        {/* ===== 경쟁자 모니터링 탭 ===== */}
        {activeTab === "competitors" && (
          <>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg font-bold flex items-center gap-2"><Users className="w-5 h-5" /> 경쟁자 모니터링</h2>
            </div>

            <div className="flex flex-wrap gap-2">
              {(trackedKeywords.data as any[] || []).map((kw: any) => (
                <button key={kw.id}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
                    competitorKeyword === kw.query ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  onClick={() => setCompetitorKeyword(kw.query)}>
                  "{kw.query}"
                </button>
              ))}
              {!trackedKeywords.data?.length && (
                <p className="text-sm text-gray-400">추적 중인 키워드가 없습니다. 확장프로그램에서 키워드를 등록하세요.</p>
              )}
            </div>

            {competitorKeyword && competitorData.data ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">
                    "{competitorKeyword}" 상위 {competitorData.data.totalTracked}개 상품 비교
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {!competitorData.data.latest.length ? (
                    <p className="text-gray-400 text-sm text-center py-8">경쟁자 데이터가 없습니다.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="border-b bg-gray-50 text-xs text-gray-500">
                          <th className="text-center p-2 w-12">순위</th>
                          <th className="text-left p-2">상품명</th>
                          <th className="text-center p-2">가격</th>
                          <th className="text-center p-2">가격변동</th>
                          <th className="text-center p-2">리뷰</th>
                          <th className="text-center p-2">리뷰변동</th>
                          <th className="text-center p-2">순위변동</th>
                          <th className="text-center p-2">표시</th>
                        </tr></thead>
                        <tbody>
                          {competitorData.data.latest.map((item: any) => (
                            <tr key={item.id} className="border-b hover:bg-gray-50">
                              <td className="p-2 text-center font-bold text-indigo-600">#{item.position}</td>
                              <td className="p-2"><div className="text-xs line-clamp-1 font-medium">{item.title || item.coupangProductId}</div></td>
                              <td className="p-2 text-center text-xs font-semibold">{formatPrice(item.price)}</td>
                              <td className="p-2 text-center">{item.priceChange !== null ? <ChangeIndicator value={-item.priceChange} /> : '-'}</td>
                              <td className="p-2 text-center text-xs">{item.reviewCount}</td>
                              <td className="p-2 text-center">{item.reviewChange !== null ? <ChangeIndicator value={item.reviewChange} /> : '-'}</td>
                              <td className="p-2 text-center">
                                {item.positionChange !== null ? (
                                  <span className={`text-xs font-bold ${item.positionChange > 0 ? 'text-green-600' : item.positionChange < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                                    {item.positionChange > 0 ? `+${item.positionChange}` : item.positionChange < 0 ? `${item.positionChange}` : '-'}
                                  </span>
                                ) : '-'}
                              </td>
                              <td className="p-2 text-center">
                                <div className="flex gap-1 justify-center">
                                  {item.isAd && <Badge variant="outline" className="text-[9px] border-amber-300 text-amber-600">AD</Badge>}
                                  {item.isRocket && <span className="text-[10px]">🚀</span>}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : competitorKeyword ? (
              <Card><CardContent className="py-8 text-center text-gray-400">로딩중...</CardContent></Card>
            ) : null}
          </>
        )}

        {/* ===== AI 추천 탭 ===== */}
        {activeTab === "ai" && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold flex items-center gap-2"><Brain className="w-5 h-5 text-indigo-500" /> AI 소싱 추천</h2>
              <Badge variant="outline" className="text-xs">축적된 데이터 기반 분석</Badge>
            </div>

            {aiRecommendations.isLoading ? (
              <Card><CardContent className="py-16 text-center text-gray-400">분석중...</CardContent></Card>
            ) : !aiRecommendations.data?.recommendations?.length ? (
              <Card className="border-dashed">
                <CardContent className="py-16 text-center text-gray-400">
                  <Brain className="w-16 h-16 mx-auto mb-4 opacity-20" />
                  <h3 className="font-semibold text-lg mb-2">아직 추천을 생성할 데이터가 부족합니다</h3>
                  <p className="text-sm">쿠팡에서 더 많은 키워드를 검색하고 후보를 저장해 보세요.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {aiRecommendations.data.recommendations.map((rec: any, i: number) => (
                  <Card key={i} className={`${rec.type === 'blueocean' ? 'border-green-200 bg-green-50/30' : rec.type === 'high_margin' ? 'border-amber-200 bg-amber-50/30' : 'border-indigo-200 bg-indigo-50/30'}`}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base font-bold">{rec.title}</CardTitle>
                      <p className="text-sm text-gray-500">{rec.description}</p>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {rec.items.map((item: any, j: number) => (
                          <div key={j} className="bg-white rounded-lg p-3 shadow-sm flex items-center justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-sm truncate">{item.query || item.title}</div>
                              <div className="text-xs text-gray-500 mt-0.5">{item.reason}</div>
                            </div>
                            {item.avgPrice && <span className="text-xs font-bold text-red-500">{formatPrice(item.avgPrice)}</span>}
                            {item.score !== undefined && (
                              <Badge variant="outline" className="text-xs shrink-0">경쟁 {item.score}점</Badge>
                            )}
                            {item.sourcingGrade && (
                              <Badge className="text-xs bg-indigo-100 text-indigo-700 shrink-0">
                                {item.sourcingGrade} ({item.sourcingScore}점)
                              </Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {/* ===== AI 리뷰 분석 탭 (Phase 6) ===== */}
        {activeTab === "reviews" && (
          <>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-emerald-500" /> AI 리뷰 분석
                <Badge className="bg-emerald-100 text-emerald-700 text-[9px] px-1.5 py-0">GPT-4o</Badge>
              </h2>
              <div className="flex items-center gap-2">
                <Input placeholder="분석할 키워드 입력..." value={reviewQuery}
                  onChange={e => setReviewQuery(e.target.value)}
                  className="h-8 text-sm w-52"
                  onKeyDown={e => { if (e.key === 'Enter' && reviewQuery.trim()) analyzeReviews.mutate({ query: reviewQuery.trim() }); }} />
                <Button size="sm" className="text-xs bg-emerald-600 hover:bg-emerald-700 gap-1.5"
                  disabled={!reviewQuery.trim() || analyzeReviews.isPending}
                  onClick={() => analyzeReviews.mutate({ query: reviewQuery.trim() })}>
                  <Sparkles className="w-3 h-3" />
                  {analyzeReviews.isPending ? "GPT 분석중..." : "AI 분석 실행"}
                </Button>
              </div>
            </div>

            {/* 분석 결과 목록 */}
            {!reviewAnalyses.data?.length ? (
              <Card className="border-dashed">
                <CardContent className="py-16 text-center text-gray-400">
                  <Sparkles className="w-16 h-16 mx-auto mb-4 opacity-20" />
                  <h3 className="font-semibold text-lg mb-2">아직 리뷰 분석 결과가 없습니다</h3>
                  <p className="text-sm">위 입력창에 키워드를 입력하고 "AI 분석 실행"을 눌러보세요.</p>
                  <p className="text-xs text-gray-400 mt-2">검색 스냅샷 데이터를 기반으로 고객 니즈, 불만, 기회를 분석합니다.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                {(reviewAnalyses.data as any[]).map((analysis: any, idx: number) => (
                  <Card key={analysis.id || idx} className="border-emerald-100">
                    {/* 분석 헤더 */}
                    <CardHeader className="pb-3 bg-gradient-to-r from-emerald-50 to-teal-50">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <CardTitle className="text-base font-bold flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-emerald-500" />
                            "{analysis.query}" 리뷰 분석
                            {analysis.aiPowered !== false && (
                              <Badge className="bg-emerald-100 text-emerald-700 text-[9px] px-1.5 py-0">AI Powered</Badge>
                            )}
                            {analysis.aiPowered === false && (
                              <Badge variant="outline" className="text-[9px] px-1.5 py-0">규칙기반</Badge>
                            )}
                          </CardTitle>
                          <div className="text-xs text-gray-500 mt-1 flex items-center gap-3 flex-wrap">
                            <span>{analysis.totalProductsAnalyzed}개 상품 분석</span>
                            <span>평균 평점 {analysis.avgRating}</span>
                            <span>평균 리뷰 {analysis.avgReviewCount}개</span>
                            <span>{new Date(analysis.createdAt).toLocaleString("ko-KR")}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-xs">
                            가격 민감도: {analysis.priceSensitivity === 'high' ? '높음' : analysis.priceSensitivity === 'medium' ? '보통' : '낮음'}
                          </Badge>
                          {analysis.trendInsight && (
                            <Badge variant="outline" className="text-xs border-indigo-200 text-indigo-600">
                              {analysis.trendInsight}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent className="pt-4 space-y-5">
                      {/* 시장 개요 */}
                      {analysis.marketOverview && (
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                          <div className="bg-indigo-50 rounded-lg p-2.5 text-center">
                            <div className="text-lg font-bold text-indigo-700">{analysis.marketOverview.totalItems || analysis.totalProductsAnalyzed}</div>
                            <div className="text-[10px] text-gray-500">분석 상품</div>
                          </div>
                          <div className="bg-indigo-50 rounded-lg p-2.5 text-center">
                            <div className="text-lg font-bold text-indigo-700">{analysis.marketOverview.competitionScore ?? '-'}</div>
                            <div className="text-[10px] text-gray-500">경쟁도</div>
                          </div>
                          <div className="bg-amber-50 rounded-lg p-2.5 text-center">
                            <div className="text-sm font-bold text-amber-700">{formatPrice(analysis.marketOverview.avgPrice)}</div>
                            <div className="text-[10px] text-gray-500">평균가</div>
                          </div>
                          <div className="bg-green-50 rounded-lg p-2.5 text-center">
                            <div className="text-lg font-bold text-green-700">{analysis.marketOverview.adRatio ?? '-'}%</div>
                            <div className="text-[10px] text-gray-500">광고 비율</div>
                          </div>
                          <div className="bg-purple-50 rounded-lg p-2.5 text-center">
                            <div className="text-lg font-bold text-purple-700">{analysis.marketOverview.rocketRatio ?? '-'}%</div>
                            <div className="text-[10px] text-gray-500">로켓배송</div>
                          </div>
                          <div className="bg-red-50 rounded-lg p-2.5 text-center">
                            <div className="text-lg font-bold text-red-700">{analysis.marketOverview.highReviewRatio ?? '-'}%</div>
                            <div className="text-[10px] text-gray-500">리뷰100+</div>
                          </div>
                        </div>
                      )}

                      {/* 요약 */}
                      {analysis.summaryText && (
                        <div className="bg-gray-50 rounded-lg p-4">
                          <div className="text-sm font-semibold mb-2 flex items-center gap-2">
                            <Info className="w-4 h-4 text-blue-500" /> 요약
                          </div>
                          <p className="text-sm text-gray-700 leading-relaxed">{analysis.summaryText}</p>
                        </div>
                      )}

                      <div className="grid md:grid-cols-2 gap-4">
                        {/* 기회 */}
                        {analysis.opportunities?.length > 0 && (
                          <div className="bg-green-50 rounded-lg p-4">
                            <div className="text-sm font-semibold mb-3 flex items-center gap-2 text-green-700">
                              <Lightbulb className="w-4 h-4" /> 소싱 기회 ({analysis.opportunities.length})
                            </div>
                            <div className="space-y-2">
                              {analysis.opportunities.map((o: any, i: number) => (
                                <div key={i} className="bg-white rounded-md p-3 shadow-sm">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="font-medium text-sm">{o.title}</span>
                                    <Badge className={`text-[10px] ${potentialColors[o.potential]}`}>{o.potential}</Badge>
                                  </div>
                                  <p className="text-xs text-gray-600">{o.description}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 주의 사항 */}
                        {analysis.painPoints?.length > 0 && (
                          <div className="bg-red-50 rounded-lg p-4">
                            <div className="text-sm font-semibold mb-3 flex items-center gap-2 text-red-700">
                              <AlertTriangle className="w-4 h-4" /> 주의 사항 ({analysis.painPoints.length})
                            </div>
                            <div className="space-y-2">
                              {analysis.painPoints.map((p: any, i: number) => (
                                <div key={i} className="bg-white rounded-md p-3 shadow-sm">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="font-medium text-sm">{p.point}</span>
                                    <Badge className={`text-[10px] ${severityColors[p.severity]}`}>{p.severity}</Badge>
                                  </div>
                                  <p className="text-xs text-gray-600">{p.detail}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="grid md:grid-cols-2 gap-4">
                        {/* 고객 니즈 */}
                        {analysis.customerNeeds?.length > 0 && (
                          <div className="bg-blue-50 rounded-lg p-4">
                            <div className="text-sm font-semibold mb-3 flex items-center gap-2 text-blue-700">
                              <ThumbsUp className="w-4 h-4" /> 고객 니즈 ({analysis.customerNeeds.length})
                            </div>
                            <div className="space-y-2">
                              {analysis.customerNeeds.map((n: any, i: number) => (
                                <div key={i} className="bg-white rounded-md p-3 shadow-sm">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="font-medium text-sm">{n.need}</span>
                                    <Badge variant="outline" className="text-[10px]">{n.priority}</Badge>
                                  </div>
                                  <p className="text-xs text-gray-600">{n.insight}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 추천 액션 */}
                        {analysis.recommendations?.length > 0 && (
                          <div className="bg-purple-50 rounded-lg p-4">
                            <div className="text-sm font-semibold mb-3 flex items-center gap-2 text-purple-700">
                              <Zap className="w-4 h-4" /> 추천 액션 ({analysis.recommendations.length})
                            </div>
                            <div className="space-y-2">
                              {analysis.recommendations.map((r: any, i: number) => (
                                <div key={i} className="bg-white rounded-md p-3 shadow-sm">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="font-medium text-sm">{r.action}</span>
                                    <Badge variant="outline" className={`text-[10px] ${r.priority === 'high' ? 'border-red-300 text-red-600' : ''}`}>{r.priority}</Badge>
                                  </div>
                                  <p className="text-xs text-gray-600">{r.expectedImpact}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 칭찬/불만/품질우려 */}
                      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {analysis.commonPraises?.length > 0 && (
                          <div className="rounded-lg border p-3">
                            <div className="text-xs font-semibold mb-2 flex items-center gap-1 text-green-600">
                              <ThumbsUp className="w-3 h-3" /> 긍정적 요소
                            </div>
                            <ul className="space-y-1">
                              {analysis.commonPraises.map((p: string, i: number) => (
                                <li key={i} className="text-xs text-gray-600 flex items-start gap-1">
                                  <CheckCircle className="w-3 h-3 text-green-400 mt-0.5 shrink-0" /> {p}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {analysis.commonComplaints?.length > 0 && (
                          <div className="rounded-lg border p-3">
                            <div className="text-xs font-semibold mb-2 flex items-center gap-1 text-red-600">
                              <ThumbsDown className="w-3 h-3" /> 부정적 요소
                            </div>
                            <ul className="space-y-1">
                              {analysis.commonComplaints.map((c: string, i: number) => (
                                <li key={i} className="text-xs text-gray-600 flex items-start gap-1">
                                  <AlertTriangle className="w-3 h-3 text-red-400 mt-0.5 shrink-0" /> {c}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {analysis.qualityConcerns?.length > 0 && (
                          <div className="rounded-lg border border-amber-200 p-3">
                            <div className="text-xs font-semibold mb-2 flex items-center gap-1 text-amber-600">
                              <Shield className="w-3 h-3" /> 품질 우려사항
                            </div>
                            <ul className="space-y-1">
                              {analysis.qualityConcerns.map((q: string, i: number) => (
                                <li key={i} className="text-xs text-gray-600 flex items-start gap-1">
                                  <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" /> {q}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {/* ===== 알림 센터 탭 (Phase 6) ===== */}
        {activeTab === "notifications" && (
          <>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Bell className="w-5 h-5" /> 알림 센터
                {(unreadCount.data?.count || 0) > 0 && (
                  <Badge className="bg-red-500 text-white text-xs">{unreadCount.data!.count} 미읽음</Badge>
                )}
              </h2>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="text-xs gap-1"
                  onClick={() => markAllRead.mutate()}>
                  <CheckCircle className="w-3 h-3" /> 모두 읽음
                </Button>
                <Button variant="outline" size="sm" className="text-xs gap-1 text-red-500"
                  onClick={() => { if (confirm("30일 이상된 알림을 삭제할까요?")) cleanOldNotifs.mutate(); }}>
                  <Trash2 className="w-3 h-3" /> 오래된 알림 정리
                </Button>
              </div>
            </div>

            {!notifications.data?.length ? (
              <Card className="border-dashed">
                <CardContent className="py-16 text-center text-gray-400">
                  <BellOff className="w-16 h-16 mx-auto mb-4 opacity-20" />
                  <h3 className="font-semibold text-lg mb-2">알림이 없습니다</h3>
                  <p className="text-sm">순위 변동, 가격 변화, AI 분석 완료 시 자동으로 알림이 생성됩니다.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {(notifications.data as any[]).map((n: any) => (
                  <Card key={n.id} className={`transition-all hover:shadow-md ${!n.isRead ? 'bg-blue-50/40 border-blue-200' : ''} ${notifPriorityColors[n.priority] || ''}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <span className="text-2xl">{notifTypeIcons[n.type] || "📌"}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-sm">{n.title}</span>
                            {!n.isRead && <span className="w-2 h-2 bg-blue-500 rounded-full" />}
                            <Badge variant="outline" className={`text-[10px] ml-auto ${
                              n.priority === 'high' ? 'border-red-300 text-red-600' :
                              n.priority === 'medium' ? 'border-blue-300 text-blue-600' : 'border-gray-300'
                            }`}>{n.priority}</Badge>
                          </div>
                          <p className="text-sm text-gray-600">{n.message}</p>
                          <div className="flex items-center gap-3 mt-2">
                            <span className="text-xs text-gray-400 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {new Date(n.createdAt).toLocaleString("ko-KR")}
                            </span>
                            <div className="flex gap-1 ml-auto">
                              {!n.isRead && (
                                <Button variant="ghost" size="sm" className="h-6 text-xs text-blue-600"
                                  onClick={() => markRead.mutate({ id: n.id })}>읽음</Button>
                              )}
                              <Button variant="ghost" size="sm" className="h-6 text-xs text-red-400"
                                onClick={() => { if (confirm("삭제?")) deleteNotification.mutate({ id: n.id }); }}>
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {/* ===== WING 인기상품 탭 ===== */}
        {activeTab === "wing" && (
          <>
            {/* 통계 카드 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {[
                { label: "수집 횟수", value: wingStats.data?.totalSearches || 0, icon: Search },
                { label: "키워드", value: wingStats.data?.uniqueKeywords || 0, icon: Package },
                { label: "총 상품", value: wingStats.data?.totalProducts || 0, icon: Eye },
                { label: "평균가", value: wingStats.data?.avgPrice ? `${Number(wingStats.data.avgPrice).toLocaleString()}원` : "-", icon: TrendingUp },
              ].map((s, i) => (
                <Card key={i}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-500">{s.label}</p>
                        <p className="text-lg font-bold">{s.value}</p>
                      </div>
                      <s.icon className="w-5 h-5 text-purple-400" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* TOP 키워드 */}
            {wingStats.data?.topKeywords?.length ? (
              <Card className="mb-4">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">🔥 WING 인기 키워드 TOP 10</CardTitle>
                </CardHeader>
                <CardContent className="p-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {(wingStats.data.topKeywords as any[]).map((kw: any, i: number) => (
                      <div key={i} className="flex items-center justify-between bg-gray-50 rounded p-2 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 bg-purple-100 text-purple-700 rounded-full text-xs flex items-center justify-center font-bold">{i + 1}</span>
                          <span className="font-medium truncate">{kw.keyword || "(없음)"}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span>{kw.count}회</span>
                          {kw.avgPrice > 0 && <span>{Number(kw.avgPrice).toLocaleString()}원</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {/* 카테고리 분포 */}
            {wingStats.data?.categories?.length ? (
              <Card className="mb-4">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">📂 카테고리별 분포</CardTitle>
                </CardHeader>
                <CardContent className="p-3">
                  <div className="flex flex-wrap gap-2">
                    {(wingStats.data.categories as any[]).map((cat: any, i: number) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {cat.category || "미분류"} ({cat.count})
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {/* 일별 수집 차트 */}
            {wingStats.data?.dailySearches?.length ? (
              <Card className="mb-4">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">📊 최근 7일 수집 현황</CardTitle>
                </CardHeader>
                <CardContent className="p-3">
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={(wingStats.data.dailySearches as any[]).map((d: any) => ({
                      date: d.date?.slice(5) || "",
                      count: Number(d.count),
                      products: Number(d.totalProducts),
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#8b5cf6" name="검색 수" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            ) : null}

            {/* 검색 목록 */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-sm font-semibold">📋 WING 인기상품 수집 이력</CardTitle>
                  <div className="flex items-center gap-2">
                    <Input
                      className="h-7 text-xs w-40"
                      placeholder="키워드 검색..."
                      value={wingKeyword}
                      onChange={(e) => setWingKeyword(e.target.value)}
                    />
                    <Button variant="ghost" size="sm" className="text-xs text-red-500"
                      onClick={() => { if (confirm("전체 삭제?")) deleteAllWingSearches.mutate(); }}>
                      <Trash2 className="w-3 h-3 mr-1" /> 전체 삭제
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-3">
                {wingSearches.isLoading ? (
                  <p className="text-center text-sm text-gray-400 py-8">로딩 중...</p>
                ) : !wingSearches.data?.length ? (
                  <p className="text-center text-sm text-gray-400 py-8">WING 인기상품 데이터가 없습니다.<br />WING 셀러센터에서 인기상품검색을 하면 자동 수집됩니다.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-500 border-b">
                          <th className="p-2 text-left">키워드</th>
                          <th className="p-2 text-left">카테고리</th>
                          <th className="p-2 text-right">상품수</th>
                          <th className="p-2 text-right">평균가</th>
                          <th className="p-2 text-right">평점</th>
                          <th className="p-2 text-right">리뷰</th>
                          <th className="p-2 text-center">소스</th>
                          <th className="p-2 text-right">수집일</th>
                          <th className="p-2 text-center">-</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(wingSearches.data as any[]).map((ws: any) => (
                          <tr key={ws.id} className="border-b hover:bg-gray-50">
                            <td className="p-2 font-medium max-w-[140px] truncate">{ws.keyword || "-"}</td>
                            <td className="p-2 text-gray-500 max-w-[100px] truncate">{ws.category || "-"}</td>
                            <td className="p-2 text-right">{ws.totalItems || 0}</td>
                            <td className="p-2 text-right">{ws.avgPrice ? `${Number(ws.avgPrice).toLocaleString()}원` : "-"}</td>
                            <td className="p-2 text-right">{ws.avgRating || "-"}</td>
                            <td className="p-2 text-right">{ws.avgReview || "-"}</td>
                            <td className="p-2 text-center">
                              <Badge variant="secondary" className="text-[10px]">
                                {ws.source === "api" ? "API" : ws.source === "dom_table" ? "DOM" : ws.source || "?"}
                              </Badge>
                            </td>
                            <td className="p-2 text-right text-gray-400">
                              {ws.createdAt ? new Date(ws.createdAt).toLocaleDateString("ko-KR") : "-"}
                            </td>
                            <td className="p-2 text-center">
                              <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-red-400"
                                onClick={() => deleteWingSearch.mutate({ id: ws.id })}>
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {/* ===== 검색 이력 탭 ===== */}
        {activeTab === "history" && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  검색 히스토리
                  <Button variant="ghost" size="sm" className="text-xs ml-2"
                    onClick={() => setShowAllSnapshots(!showAllSnapshots)}>
                    {showAllSnapshots ? <><ChevronUp className="w-3 h-3 mr-1" /> 접기</> : <><ChevronDown className="w-3 h-3 mr-1" /> 더보기</>}
                  </Button>
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="text-xs gap-1"
                    onClick={() => snapshots.data && exportCSV(snapshots.data as any[], `search_history_${new Date().toISOString().slice(0, 10)}.csv`)}>
                    <FileDown className="w-3 h-3" /> CSV
                  </Button>
                  <Input placeholder="검색어 필터..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="h-8 text-sm w-48" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b bg-gray-50 text-xs text-gray-500">
                    <th className="text-left p-3">검색어</th>
                    <th className="text-center p-3">상품수</th>
                    <th className="text-center p-3">평균가</th>
                    <th className="text-center p-3">평점</th>
                    <th className="text-center p-3">평균리뷰</th>
                    <th className="text-center p-3">경쟁도</th>
                    <th className="text-center p-3">시간</th>
                  </tr></thead>
                  <tbody>
                    {snapshots.data?.length ? snapshots.data.map((s: any) => (
                      <tr key={s.id} className="border-b hover:bg-gray-50 transition">
                        <td className="p-3 font-medium text-indigo-600">"{s.query}"</td>
                        <td className="p-3 text-center">{s.totalItems}</td>
                        <td className="p-3 text-center">{formatPrice(s.avgPrice)}</td>
                        <td className="p-3 text-center">{s.avgRating || '-'}</td>
                        <td className="p-3 text-center">{s.avgReview}</td>
                        <td className="p-3 text-center">
                          <Badge className={`${competitionColors[s.competitionLevel] || ''} text-[10px]`}>
                            {competitionLabels[s.competitionLevel] || s.competitionLevel} {s.competitionScore}점
                          </Badge>
                        </td>
                        <td className="p-3 text-center text-xs text-gray-400">{new Date(s.createdAt).toLocaleString('ko-KR')}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={7} className="text-center py-8 text-gray-400">검색 기록이 없습니다</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
