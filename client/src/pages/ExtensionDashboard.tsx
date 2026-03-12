import { useState, useEffect, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import SourcingFormModal from "@/components/SourcingFormModal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Search, Star, TrendingUp, Package, ArrowUpRight, ArrowDownRight,
  Trash2, Target, BarChart3, Eye, ExternalLink, Download,
  Brain, Bell, Users, ChevronDown, ChevronUp, Minus,
  FileDown, Activity, Lightbulb, Zap, AlertTriangle, CheckCircle,
  FileText, BellRing, BellOff, Clock, Shield, Sparkles, Play, Square, Loader2, Settings2,
  ThumbsUp, ThumbsDown, Info, X, ChevronRight, Plus, Edit3, ShoppingBag, Layers
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

type TabKey = "overview" | "demand" | "trends" | "candidates" | "ranking" | "competitors" | "ai" | "insights" | "myproducts" | "reviews" | "notifications" | "history" | "wing" | "sourcing";

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
  const [demandSelectedKw, setDemandSelectedKw] = useState<string | null>(null);
  const [demandDays, setDemandDays] = useState(30);
  const [demandSearch, setDemandSearch] = useState("");
  const [demandSort, setDemandSort] = useState<"keyword_score" | "demand_score" | "review_growth" | "sales_estimate" | "competition_score" | "avg_price">("keyword_score");
  const [selectedDeleteKws, setSelectedDeleteKws] = useState<Set<string>>(new Set());
  // v5.7: 100개 단위 라운드 자동 통계 처리
  const [statsRunning, setStatsRunning] = useState(false);
  const [statsProgress, setStatsProgress] = useState({ current: 0, total: 0, round: 0, totalRounds: 0 });
  const statsStoppedRef = useRef(false);
  // Sourcing modal state
  const [sourcingModalOpen, setSourcingModalOpen] = useState(false);
  const [sourcingPrefillData, setSourcingPrefillData] = useState<Record<string, any> | undefined>(undefined);
  const [sourcingEditProduct, setSourcingEditProduct] = useState<any>(undefined);
  const [sourcingSearch, setSourcingSearch] = useState("");
  const [sourcingStatusFilter, setSourcingStatusFilter] = useState<string>("all");
  const [sourcingPage, setSourcingPage] = useState(0);

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

  // Sourcing queries
  const sourcingList = trpc.sourcing.list.useQuery(
    { search: sourcingSearch || undefined, status: sourcingStatusFilter === "all" ? undefined : sourcingStatusFilter, limit: 20, offset: sourcingPage * 20 },
    { enabled: activeTab === "sourcing" }
  );
  const sourcingStats = trpc.sourcing.stats.useQuery(
    undefined,
    { enabled: activeTab === "sourcing" || activeTab === "overview" }
  );
  const sourcingDelete = trpc.sourcing.delete.useMutation({
    onSuccess: () => { sourcingList.refetch(); sourcingStats.refetch(); toast.success("삭제 완료"); },
    onError: (err: any) => toast.error(err.message || "삭제 실패"),
  });
  const sourcingChangeStatus = trpc.sourcing.changeStatus.useMutation({
    onSuccess: () => { sourcingList.refetch(); sourcingStats.refetch(); toast.success("상태 변경됨"); },
    onError: (err: any) => toast.error(err.message || "상태 변경 실패"),
  });
  const openSourcingModal = (prefill?: Record<string, any>, edit?: any) => {
    setSourcingPrefillData(prefill);
    setSourcingEditProduct(edit);
    setSourcingModalOpen(true);
  };
  const stats = searchStats.data;
  const cStats = candidateStats.data;
  const activity = activitySummary.data;

  // Search Demand queries
  const keywordStatsList = trpc.extension.listKeywordStats.useQuery(
    { search: demandSearch || undefined, sortBy: demandSort, sortDir: "desc", limit: 100 },
    { enabled: activeTab === "demand" || activeTab === "overview" }
  );
  const keywordStatsOverview = trpc.extension.keywordStatsOverview.useQuery(
    undefined, { enabled: activeTab === "demand" || activeTab === "overview" }
  );
  // v5.7: 자동수집 상태 (마지막 수집/통계 갱신 시각)
  const autoCollectInfo = trpc.extension.autoCollectStats.useQuery(
    undefined, { enabled: activeTab === "demand" }
  );

  const keywordDailyStats = trpc.extension.getKeywordDailyStats.useQuery(
    { query: demandSelectedKw || "", days: demandDays },
    { enabled: !!demandSelectedKw && activeTab === "demand" }
  );

  // AI 인사이트
  const aiInsights = trpc.extension.aiInsights.useQuery(
    undefined,
    { enabled: activeTab === "insights" || activeTab === "overview" }
  );
  const dataAccumulation = trpc.extension.dataAccumulationStatus.useQuery(
    undefined,
    { enabled: activeTab === "insights" }
  );

  // 내 상품 추적
  const productTrackings = trpc.extension.listProductTrackings.useQuery(
    { activeOnly: true, limit: 50 },
    { enabled: activeTab === "myproducts" || activeTab === "overview" }
  );
  const trackingOverview = trpc.extension.productTrackingOverview.useQuery(
    undefined,
    { enabled: activeTab === "myproducts" || activeTab === "overview" }
  );
  const [selectedTrackingId, setSelectedTrackingId] = useState<number | null>(null);
  const trackingDetail = trpc.extension.getProductTrackingDetail.useQuery(
    { id: selectedTrackingId || 0, days: 30 },
    { enabled: !!selectedTrackingId && activeTab === "myproducts" }
  );
  const autoRegister = trpc.extension.autoRegisterTrackings.useMutation({
    onSuccess: (data) => {
      productTrackings.refetch(); trackingOverview.refetch();
      toast.success(data.message || `${data.registered}개 상품 자동 등록`);
    },
    onError: (err: any) => toast.error(err.message || "자동 등록 실패"),
  });
  const removeTracking = trpc.extension.removeProductTracking.useMutation({
    onSuccess: () => { productTrackings.refetch(); trackingOverview.refetch(); toast.success("추적 해제됨"); },
    onError: (err: any) => toast.error(err.message || "추적 해제 실패"),
  });
  const analyzeTracked = trpc.extension.analyzeTrackedProduct.useMutation({
    onSuccess: (data) => { productTrackings.refetch(); if (selectedTrackingId) trackingDetail.refetch(); toast.success("분석 완료"); },
    onError: (err: any) => toast.error(err.message || "분석 실패"),
  });

  // v5.7: bulkComputeStats — 100개 단위 라운드 자동 통계 처리
  const bulkCompute = trpc.extension.bulkComputeStats.useMutation();

  const handleAutoStats = useCallback(async () => {
    if (statsRunning) return;
    setStatsRunning(true);
    statsStoppedRef.current = false;
    setStatsProgress({ current: 0, total: 0, round: 0, totalRounds: 0 });

    try {
      let offset = 0;
      const limit = 100;
      let hasMore = true;

      while (hasMore) {
        if (statsStoppedRef.current) {
          toast.info("통계 처리 중지됨");
          break;
        }

        const result = await bulkCompute.mutateAsync({ offset, limit });
        setStatsProgress({
          current: result.offset + result.computed,
          total: result.total,
          round: result.round,
          totalRounds: result.totalRounds,
        });

        hasMore = result.hasMore;
        offset = result.nextOffset;
      }

      if (!statsStoppedRef.current) {
        toast.success("전체 통계 갱신 완료!");
      }
    } catch (err: any) {
      toast.error(`통계 계산 오류: ${err.message}`);
    } finally {
      setStatsRunning(false);
      keywordStatsList.refetch();
      keywordStatsOverview.refetch();
      if (demandSelectedKw) keywordDailyStats.refetch();
    }
  }, [statsRunning]);

  const handleStopStats = useCallback(() => {
    statsStoppedRef.current = true;
  }, []);

  const deleteKeyword = trpc.extension.deleteKeyword.useMutation({
    onSuccess: (data) => {
      keywordStatsList.refetch(); keywordStatsOverview.refetch(); snapshots.refetch(); searchStats.refetch();
      toast.success(`"${data.query}" 키워드 삭제 완료`);
      if (demandSelectedKw === data.query) setDemandSelectedKw(null);
    },
    onError: (err: any) => toast.error(err.message || "삭제 실패"),
  });
  const deleteKeywords = trpc.extension.deleteKeywords.useMutation({
    onSuccess: (data) => {
      keywordStatsList.refetch(); keywordStatsOverview.refetch(); snapshots.refetch(); searchStats.refetch();
      setSelectedDeleteKws(new Set());
      toast.success(`${data.count}개 키워드 삭제 완료`);
    },
    onError: (err: any) => toast.error(err.message || "삭제 실패"),
  });

  const tabs: { key: TabKey; label: string; icon: any; badge?: number }[] = [
    { key: "overview", label: "대시보드", icon: BarChart3 },
    { key: "demand", label: "검색 수요", icon: Activity },
    { key: "insights", label: "AI 인사이트", icon: Lightbulb },
    { key: "trends", label: "트렌드", icon: TrendingUp },
    { key: "candidates", label: "소싱 후보", icon: Star },
    { key: "myproducts", label: "내 상품 추적", icon: Package },
    { key: "ranking", label: "순위 추적", icon: Target },
    { key: "competitors", label: "경쟁자", icon: Users },
    { key: "ai", label: "AI 추천", icon: Brain },
    { key: "reviews", label: "리뷰 분석", icon: Sparkles },
    { key: "notifications", label: "알림", icon: Bell, badge: unreadCount.data?.count || 0 },
    { key: "wing", label: "WING", icon: Eye },
    { key: "history", label: "검색 이력", icon: Search },
    { key: "sourcing", label: "소싱 관리", icon: Layers },
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
        doc.text(`Coupang Sourcing Helper v5.1 | lumiriz.kr | Page ${i}/${pageCount}`, pageWidth / 2, 290, { align: "center" });
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

            <Badge variant="outline" className="text-xs">v5.6</Badge>
          </div>
        </div>

        {/* 탭 네비게이션 - 좌우 드래그 스크롤 */}
        <div className="relative">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 overflow-x-auto scrollbar-hide"
            style={{ WebkitOverflowScrolling: 'touch' }}>
            {tabs.map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-all whitespace-nowrap relative shrink-0 ${
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
          {/* 스크롤 가능 표시 - 우측 그라디언트 */}
          <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-gray-100 to-transparent rounded-r-lg pointer-events-none" />
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

            {/* 검색 수요 추정 미리보기 */}
            {keywordStatsList.data && keywordStatsList.data.length > 0 && (
              <Card className="border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Activity className="w-4 h-4 text-orange-500" /> 검색 수요 추정 TOP 5
                    <Button variant="ghost" size="sm" className="text-xs ml-auto" onClick={() => setActiveTab("demand")}>
                      전체 보기
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {(keywordStatsList.data as any[]).slice(0, 5).map((kw: any, i: number) => (
                      <div key={i} className="bg-white rounded-lg p-2.5 shadow-sm flex items-center gap-3">
                        <span className="w-5 h-5 bg-orange-100 text-orange-700 rounded-full text-[10px] flex items-center justify-center font-bold shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">"{kw.query}"</div>
                          <div className="text-[10px] text-gray-500 flex items-center gap-2 mt-0.5">
                            <span>상품 {kw.productCount}</span>
                            <span className="text-red-500">{formatPrice(kw.avgPrice)}</span>
                            <span className="text-green-600">리뷰+{kw.reviewGrowth || 0}</span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xs font-bold text-purple-600">{kw.keywordScore || 0}점</div>
                          <div className="text-[9px] text-gray-400">종합점수</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

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

        {/* ===== 검색 수요 추정 탭 ===== */}
        {activeTab === "demand" && (
          <>
            {/* 헤더 + 액션 */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Activity className="w-5 h-5 text-orange-500" /> 검색 수요 추정
                  <Badge variant="outline" className="text-[10px] border-orange-300 text-orange-600">Beta</Badge>
                </h2>
                <p className="text-xs text-gray-500 mt-1">쿠팡 검색 데이터 기반 · 리뷰 증가량으로 판매량 추정 · 키워드별 경쟁·수요 분석</p>
              </div>
              <div className="flex items-center gap-2">
                {!statsRunning ? (
                  <Button size="sm" className="text-xs bg-orange-600 hover:bg-orange-700 gap-1.5"
                    onClick={handleAutoStats}>
                    <Zap className="w-3 h-3" />
                    통계 계산
                  </Button>
                ) : (
                  <Button size="sm" variant="destructive" className="text-xs gap-1.5"
                    onClick={handleStopStats}>
                    <Square className="w-3 h-3" fill="currentColor" />
                    중지
                  </Button>
                )}
                {selectedDeleteKws.size > 0 && (
                  <Button variant="destructive" size="sm" className="text-xs gap-1"
                    onClick={() => {
                      if (confirm(`선택한 ${selectedDeleteKws.size}개 키워드를 삭제할까요?\n스냅샷 + 일별통계가 모두 삭제됩니다.`))
                        deleteKeywords.mutate({ queries: Array.from(selectedDeleteKws) });
                    }}>
                    <Trash2 className="w-3 h-3" /> {selectedDeleteKws.size}개 삭제
                  </Button>
                )}
              </div>
            </div>

            {/* ===== 통계 처리 상태 (라운드 진행 시 표시) ===== */}
            {statsRunning && (
              <Card className="border-orange-200 bg-gradient-to-r from-orange-50/50 to-amber-50/50">
                <CardContent className="pt-4 pb-4">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-orange-500" />
                        <span className="text-xs font-semibold text-gray-700">
                          통계 자동 갱신 중... (100개 단위 라운드)
                        </span>
                      </div>
                      <span className="text-xs font-medium text-orange-600">
                        라운드 {statsProgress.round}/{statsProgress.totalRounds} | {statsProgress.current}/{statsProgress.total}
                      </span>
                    </div>
                    <Progress
                      value={statsProgress.total > 0 ? (statsProgress.current / statsProgress.total) * 100 : 0}
                      className="h-2"
                    />
                    <p className="text-[10px] text-gray-400">
                      100개씩 순차 처리 중입니다. 확장프로그램 자동수집 완료 시 서버에서 자동 갱신됩니다.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 자동 처리 안내 + 새로고침 + v7.3.3 업데이트 안내 */}
            {!statsRunning && (
              <Card className="border-blue-100 bg-blue-50/30">
                <CardContent className="pt-3 pb-3">
                  <div className="flex flex-col gap-2">
                    {/* 마지막 갱신 시각 + 새로고침 */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[11px] text-gray-600">
                        <Clock className="w-3.5 h-3.5 text-blue-500" />
                        <span>
                          마지막 수집: <b>{autoCollectInfo.data?.lastCollectedAt ? new Date(autoCollectInfo.data.lastCollectedAt).toLocaleString("ko-KR") : "-"}</b>
                          {autoCollectInfo.data?.collectedToday ? ` (오늘 ${autoCollectInfo.data.collectedToday}건)` : ""}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-[10px] h-7 gap-1 border-blue-200 text-blue-600 hover:bg-blue-50"
                        onClick={() => {
                          keywordStatsList.refetch();
                          keywordStatsOverview.refetch();
                          autoCollectInfo.refetch();
                          if (demandSelectedKw) keywordDailyStats.refetch();
                          toast.success("데이터 갱신됨");
                        }}>
                        <Activity className="w-3 h-3" />
                        새로고침
                      </Button>
                    </div>

                    {/* v7.3.3 업데이트 안내 */}
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <Sparkles className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                      <div className="text-[10px] text-amber-800">
                        <p className="font-semibold mb-0.5">확장프로그램 v7.3.3 업데이트 안내</p>
                        <p>자동수집 완료 시 서버 통계가 <b>자동 갱신</b>됩니다. 확장프로그램을 v7.3.3으로 업데이트하면 수집 후 별도 작업 없이 이 페이지에 자동 반영됩니다.</p>
                        <p className="mt-1 text-amber-600">업데이트 전에는 수집 후 위 "통계 계산" 또는 "새로고침" 버튼을 사용해주세요.</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 개요 카드 */}
            {keywordStatsOverview.data && (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                {[
                  { label: "추적 키워드", value: keywordStatsOverview.data.totalKeywords ?? 0, color: "text-indigo-600" },
                  { label: "평균 수요점수", value: keywordStatsOverview.data.avgDemandScore ?? 0, color: "text-orange-600" },
                  { label: "평균 키워드점수", value: keywordStatsOverview.data.avgKeywordScore ?? 0, color: "text-purple-600" },
                  { label: "평균 경쟁도", value: keywordStatsOverview.data.avgCompetition ?? 0, color: "text-red-600" },
                  { label: "추정 총 판매량", value: (keywordStatsOverview.data.totalSalesEstimate ?? 0).toLocaleString(), color: "text-green-600" },
                  { label: "총 리뷰 증가", value: (keywordStatsOverview.data.totalReviewGrowth ?? 0).toLocaleString(), color: "text-blue-600" },
                  { label: "평균가", value: formatPrice(keywordStatsOverview.data.avgPrice), color: "text-amber-600" },
                ].map((s, i) => (
                  <Card key={i}><CardContent className="pt-3 pb-3 text-center">
                    <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">{s.label}</div>
                  </CardContent></Card>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* 좌측: 키워드 목록 */}
              <div className="lg:col-span-2 space-y-3">
                {/* 검색 + 정렬 */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Input placeholder="키워드 검색..." value={demandSearch}
                    onChange={e => setDemandSearch(e.target.value)}
                    className="h-8 text-xs flex-1 min-w-[150px] max-w-[250px]" />
                  <div className="flex gap-1 text-[10px]">
                    {([
                      ["keyword_score", "종합점수"],
                      ["demand_score", "수요점수"],
                      ["review_growth", "리뷰증가"],
                      ["sales_estimate", "판매추정"],
                      ["competition_score", "경쟁도"],
                      ["avg_price", "평균가"],
                    ] as const).map(([key, label]) => (
                      <button key={key}
                        className={`px-2 py-1 rounded-full transition ${demandSort === key ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                        onClick={() => setDemandSort(key)}>{label}</button>
                    ))}
                  </div>
                </div>

                {/* 키워드 테이블 */}
                <Card>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b bg-gray-50 text-gray-500 text-[10px]">

                            <th className="p-2 text-center w-8" title="삭제 선택">
                              <input type="checkbox"
                                checked={selectedDeleteKws.size > 0 && selectedDeleteKws.size === (keywordStatsList.data?.length || 0)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedDeleteKws(new Set((keywordStatsList.data || []).map((k: any) => k.query)));
                                  } else {
                                    setSelectedDeleteKws(new Set());
                                  }
                                }} />
                            </th>
                            <th className="p-2 text-left">키워드</th>
                            <th className="p-2 text-center">상품수</th>
                            <th className="p-2 text-center">평균가</th>
                            <th className="p-2 text-center">평점</th>
                            <th className="p-2 text-center">리뷰증가</th>
                            <th className="p-2 text-center">판매추정</th>
                            <th className="p-2 text-center">경쟁도</th>
                            <th className="p-2 text-center">수요</th>
                            <th className="p-2 text-center">종합</th>
                            <th className="p-2 text-center">-</th>
                          </tr>
                        </thead>
                        <tbody>
                          {!keywordStatsList.data?.length ? (
                            <tr><td colSpan={12} className="text-center py-10 text-gray-400">
                              <Activity className="w-10 h-10 mx-auto mb-2 opacity-20" />
                              <p className="text-sm font-medium">데이터가 없습니다</p>
                              <p className="text-[10px] mt-1">쿠팡에서 검색한 뒤 "통계 계산" 버튼을 눌러주세요</p>
                            </td></tr>
                          ) : (
                            (keywordStatsList.data as any[]).map((kw: any) => {
                              const isSelected = demandSelectedKw === kw.query;
                              const isChecked = selectedDeleteKws.has(kw.query);
                              return (
                                <tr key={kw.id}
                                  className={`border-b cursor-pointer transition ${isSelected ? 'bg-orange-50 ring-1 ring-orange-200' : 'hover:bg-gray-50'}`}
                                  onClick={() => setDemandSelectedKw(kw.query)}>

                                  <td className="p-2 text-center" onClick={(e) => e.stopPropagation()}>
                                    <input type="checkbox" checked={isChecked}
                                      onChange={() => {
                                        const next = new Set(selectedDeleteKws);
                                        if (isChecked) next.delete(kw.query); else next.add(kw.query);
                                        setSelectedDeleteKws(next);
                                      }} />
                                  </td>
                                  <td className="p-2 font-medium text-indigo-600 max-w-[140px] truncate">"{kw.query}"</td>
                                  <td className="p-2 text-center">{kw.productCount || 0}</td>
                                  <td className="p-2 text-center text-red-500 font-medium">{formatPrice(kw.avgPrice)}</td>
                                  <td className="p-2 text-center">{kw.avgRating || '-'}</td>
                                  <td className="p-2 text-center">
                                    {(kw.reviewGrowth || 0) > 0 ? (
                                      <span className="text-green-600 font-bold">+{kw.reviewGrowth}</span>
                                    ) : <span className="text-gray-400">0</span>}
                                  </td>
                                  <td className="p-2 text-center">
                                    {(kw.salesEstimate || 0) > 0 ? (
                                      <span className="font-bold text-blue-600">{kw.salesEstimate?.toLocaleString()}</span>
                                    ) : <span className="text-gray-400">0</span>}
                                  </td>
                                  <td className="p-2 text-center">
                                    <Badge className={`text-[9px] ${
                                      kw.competitionLevel === 'easy' ? 'bg-green-100 text-green-700' :
                                      kw.competitionLevel === 'hard' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                                    }`}>{kw.competitionScore || 0}</Badge>
                                  </td>
                                  <td className="p-2 text-center">
                                    <span className={`font-bold text-sm ${
                                      (kw.demandScore || 0) >= 60 ? 'text-green-600' :
                                      (kw.demandScore || 0) >= 30 ? 'text-orange-500' : 'text-gray-400'
                                    }`}>{kw.demandScore || 0}</span>
                                  </td>
                                  <td className="p-2 text-center">
                                    <span className={`font-bold text-sm ${
                                      (kw.keywordScore || 0) >= 60 ? 'text-purple-600' :
                                      (kw.keywordScore || 0) >= 30 ? 'text-indigo-500' : 'text-gray-400'
                                    }`}>{kw.keywordScore || 0}</span>
                                  </td>
                                  <td className="p-2 text-center" onClick={(e) => e.stopPropagation()}>
                                    <div className="flex gap-0.5 justify-center">
                                      <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-pink-500" title="소싱 등록"
                                        onClick={() => openSourcingModal({
                                          source: "keyword", keyword: kw.query,
                                          productCount: kw.productCount, avgPrice: kw.avgPrice,
                                          competitionScore: kw.competitionScore, demandScore: kw.demandScore,
                                          keywordScore: kw.keywordScore, salesEstimate: kw.salesEstimate,
                                          reviewGrowth: kw.reviewGrowth, competitionLevel: kw.competitionLevel,
                                        })}>
                                        <Plus className="w-3 h-3" />
                                      </Button>
                                      <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-red-400"
                                        onClick={() => { if (confirm(`"${kw.query}" 키워드를 삭제할까요?`)) deleteKeyword.mutate({ query: kw.query }); }}>
                                        <Trash2 className="w-3 h-3" />
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* 우측: 선택된 키워드 상세 */}
              <div className="space-y-4">
                {demandSelectedKw ? (
                  <>
                    <Card className="border-orange-200">
                      <CardHeader className="pb-2 bg-gradient-to-r from-orange-50 to-amber-50">
                        <CardTitle className="text-sm font-bold flex items-center gap-2">
                          <Activity className="w-4 h-4 text-orange-500" />
                          "{demandSelectedKw}" 추이
                        </CardTitle>
                        <div className="flex gap-1 mt-1">
                          {[7, 14, 30, 60].map(d => (
                            <button key={d} className={`px-2 py-0.5 text-[10px] rounded-full ${demandDays === d ? 'bg-orange-600 text-white' : 'bg-gray-100'}`}
                              onClick={() => setDemandDays(d)}>{d}일</button>
                          ))}
                        </div>
                      </CardHeader>
                      <CardContent className="pt-3">
                        {keywordDailyStats.data && keywordDailyStats.data.length > 1 ? (
                          <div className="space-y-4">
                            {/* 리뷰 증가 + 판매 추정 그래프 */}
                            <div>
                              <div className="text-[10px] font-semibold text-gray-500 mb-1">리뷰 증가 / 판매 추정</div>
                              <ResponsiveContainer width="100%" height={160}>
                                <BarChart data={keywordDailyStats.data}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                  <XAxis dataKey="statDate" tick={{ fontSize: 9 }} tickFormatter={(v) => v.slice(5)} />
                                  <YAxis tick={{ fontSize: 9 }} />
                                  <Tooltip contentStyle={{ fontSize: 11 }} />
                                  <Legend wrapperStyle={{ fontSize: 10 }} />
                                  <Bar dataKey="reviewGrowth" fill="#16a34a" name="리뷰 증가" radius={[3, 3, 0, 0]} />
                                  <Bar dataKey="salesEstimate" fill="#2563eb" name="판매 추정" radius={[3, 3, 0, 0]} />
                                </BarChart>
                              </ResponsiveContainer>
                            </div>

                            {/* 경쟁도 + 수요 점수 라인 */}
                            <div>
                              <div className="text-[10px] font-semibold text-gray-500 mb-1">경쟁도 / 수요점수 / 종합점수</div>
                              <ResponsiveContainer width="100%" height={140}>
                                <LineChart data={keywordDailyStats.data}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                  <XAxis dataKey="statDate" tick={{ fontSize: 9 }} tickFormatter={(v) => v.slice(5)} />
                                  <YAxis tick={{ fontSize: 9 }} domain={[0, 100]} />
                                  <Tooltip contentStyle={{ fontSize: 11 }} />
                                  <Legend wrapperStyle={{ fontSize: 10 }} />
                                  <Line type="monotone" dataKey="competitionScore" stroke="#ef4444" strokeWidth={2} name="경쟁도" dot={{ r: 2 }} />
                                  <Line type="monotone" dataKey="demandScore" stroke="#f97316" strokeWidth={2} name="수요점수" dot={{ r: 2 }} />
                                  <Line type="monotone" dataKey="keywordScore" stroke="#8b5cf6" strokeWidth={2} name="종합점수" dot={{ r: 2 }} />
                                </LineChart>
                              </ResponsiveContainer>
                            </div>

                            {/* 평균가 추이 */}
                            <div>
                              <div className="text-[10px] font-semibold text-gray-500 mb-1">평균가 / 상품수 추이</div>
                              <ResponsiveContainer width="100%" height={130}>
                                <AreaChart data={keywordDailyStats.data}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                  <XAxis dataKey="statDate" tick={{ fontSize: 9 }} tickFormatter={(v) => v.slice(5)} />
                                  <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                                  <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: number) => formatPrice(v)} />
                                  <Area type="monotone" dataKey="avgPrice" stroke="#d97706" fill="#fef3c7" name="평균가" />
                                </AreaChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        ) : (
                          <div className="py-8 text-center text-gray-400">
                            <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
                            <p className="text-xs">일별 데이터가 부족합니다.</p>
                            <p className="text-[10px] mt-1">"통계 계산" 버튼으로 데이터를 생성하세요.</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* 선택된 키워드 상세 데이터 테이블 */}
                    {keywordDailyStats.data && keywordDailyStats.data.length > 0 && (
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-xs font-semibold">일별 상세 데이터</CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                          <div className="max-h-48 overflow-y-auto">
                            <table className="w-full text-[10px]">
                              <thead className="sticky top-0 bg-white"><tr className="border-b text-gray-500">
                                <th className="p-1.5">날짜</th><th className="p-1.5">상품</th><th className="p-1.5">평균가</th>
                                <th className="p-1.5">리뷰+</th><th className="p-1.5">판매</th><th className="p-1.5">경쟁</th><th className="p-1.5">수요</th>
                              </tr></thead>
                              <tbody>
                                {(keywordDailyStats.data as any[]).slice().reverse().map((d: any, i: number) => (
                                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                                    <td className="p-1.5 text-gray-500">{d.statDate?.slice(5)}</td>
                                    <td className="p-1.5 text-center">{d.productCount}</td>
                                    <td className="p-1.5 text-center">{formatPrice(d.avgPrice)}</td>
                                    <td className="p-1.5 text-center font-medium text-green-600">{d.reviewGrowth > 0 ? `+${d.reviewGrowth}` : '0'}</td>
                                    <td className="p-1.5 text-center font-medium text-blue-600">{d.salesEstimate || 0}</td>
                                    <td className="p-1.5 text-center">{d.competitionScore}</td>
                                    <td className="p-1.5 text-center font-bold text-orange-600">{d.demandScore}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </>
                ) : (
                  <Card className="border-dashed">
                    <CardContent className="py-16 text-center text-gray-400">
                      <Activity className="w-12 h-12 mx-auto mb-3 opacity-20" />
                      <p className="text-sm font-medium">키워드를 선택하세요</p>
                      <p className="text-[10px] mt-1">좌측 목록에서 키워드를 클릭하면<br/>일별 추이 그래프가 표시됩니다.</p>
                    </CardContent>
                  </Card>
                )}

                {/* 점수 설명 카드 */}
                <Card className="bg-gray-50">
                  <CardContent className="pt-3 pb-3">
                    <div className="text-[10px] font-semibold text-gray-600 mb-2 flex items-center gap-1"><Info className="w-3 h-3" /> 점수 산출 기준</div>
                    <div className="space-y-1.5 text-[10px] text-gray-500">
                      <div><span className="font-medium text-orange-600">수요점수</span>: 리뷰 증가량 기반 (증가량 × 20 = 추정 판매량)</div>
                      <div><span className="font-medium text-purple-600">종합점수</span>: 리뷰증가×0.5 + 상품당리뷰×30 + (1-광고비율)×20</div>
                      <div><span className="font-medium text-green-600">판매추정</span>: 리뷰 증가량 × 20 (리뷰 1개 = 판매 15~25건)</div>
                      <div><span className="font-medium text-red-600">경쟁도</span>: 리뷰수·평점·광고비율 종합 (0=블루오션, 100=레드오션)</div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </>
        )}


        {/* ===== AI 인사이트 탭 ===== */}
        {activeTab === "insights" && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-yellow-500" /> AI 인사이트
              </h2>
              <Badge variant="outline" className="text-xs">{aiInsights.data?.summary || "데이터 분석 중..."}</Badge>
            </div>

            {dataAccumulation.data && (
              <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Info className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" />
                    <div className="space-y-2 w-full">
                      <h3 className="font-bold text-sm text-blue-800">데이터 축적 현황</h3>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                          { v: dataAccumulation.data.dayCount + "일", l: "축적 기간", c: "text-blue-700" },
                          { v: dataAccumulation.data.totalKeywords + "개", l: "추적 키워드", c: "text-blue-700" },
                          { v: dataAccumulation.data.totalSnapshots + "건", l: "총 스냅샷", c: "text-blue-700" },
                          { v: dataAccumulation.data.keywordsWithGrowth + "개", l: "리뷰증가 감지", c: "text-green-700" },
                        ].map((d, i) => (
                          <div key={i} className="text-center">
                            <div className={`text-xl font-bold ${d.c}`}>{d.v}</div>
                            <div className="text-xs text-blue-500">{d.l}</div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 space-y-1 text-xs text-blue-600">
                        <p><strong>리뷰증가:</strong> {dataAccumulation.data.explanation?.reviewGrowth}</p>
                        <p><strong>판매추정:</strong> {dataAccumulation.data.explanation?.salesEstimate}</p>
                        <p><strong>수요점수:</strong> {dataAccumulation.data.explanation?.demandScore}</p>
                        <p><strong>평점 파싱:</strong> {dataAccumulation.data.explanation?.rating}</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {aiInsights.data?.insights && (aiInsights.data.insights as any[]).length > 0 && (
              <div className="space-y-2">
                {(aiInsights.data.insights as any[]).map((ins: any, i: number) => (
                  <Card key={i} className={`border-l-4 ${ins.type === "positive" ? "border-l-green-500 bg-green-50" : ins.type === "warning" ? "border-l-orange-500 bg-orange-50" : ins.type === "suggestion" ? "border-l-purple-500 bg-purple-50" : "border-l-blue-500 bg-blue-50"}`}>
                    <CardContent className="p-3 flex items-start gap-2">
                      <span className="text-lg">{ins.icon}</span>
                      <div><h4 className="font-bold text-sm">{ins.title}</h4><p className="text-xs text-gray-600 mt-0.5">{ins.message}</p></div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {aiInsights.data?.missedOpportunities && (aiInsights.data.missedOpportunities as any[]).length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Target className="w-4 h-4 text-green-500" /> 놓친 기회 ({(aiInsights.data.missedOpportunities as any[]).length}건)</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {(aiInsights.data.missedOpportunities as any[]).map((opp: any, i: number) => (
                    <div key={i} className="flex items-start gap-3 p-3 bg-green-50 rounded-lg border border-green-100">
                      <div className="text-center shrink-0"><div className={`text-lg font-bold ${opp.score >= 80 ? "text-green-600" : "text-yellow-600"}`}>{opp.score}</div><div className="text-[10px] text-gray-500">점수</div></div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2"><span className="font-bold text-sm">"{opp.keyword}"</span><Badge variant="outline" className="text-[10px]">{opp.type === "low_competition" ? "낮은 경쟁" : opp.type === "ad_opportunity" ? "광고 기회" : "고마진"}</Badge></div>
                        <p className="text-xs text-gray-600 mt-1">{opp.reason}</p>
                        <div className="flex gap-3 mt-1 text-[10px] text-gray-400"><span>상품 {opp.totalItems}개</span><span>평균가 {(opp.avgPrice||0).toLocaleString()}원</span></div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {aiInsights.data?.derivativeProducts && (aiInsights.data.derivativeProducts as any[]).length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Zap className="w-4 h-4 text-purple-500" /> 파생 상품 제안 ({(aiInsights.data.derivativeProducts as any[]).length}건)</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {(aiInsights.data.derivativeProducts as any[]).map((prod: any, i: number) => (
                    <div key={i} className="flex items-start gap-3 p-3 bg-purple-50 rounded-lg border border-purple-100">
                      <div className="text-center shrink-0"><div className="text-lg font-bold text-purple-600">{prod.confidence}%</div><div className="text-[10px] text-gray-500">신뢰도</div></div>
                      <div className="flex-1">
                        <div className="font-bold text-sm text-purple-800">{prod.suggestion} <a href={`https://www.coupang.com/np/search?q=${encodeURIComponent(prod.suggestion)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-purple-500 hover:text-purple-700 ml-1"><ExternalLink className="w-3 h-3" /></a></div>
                        <p className="text-xs text-gray-600 mt-1">{prod.reason}</p>
                        <div className="text-[10px] text-gray-400 mt-1">원본: "{prod.keyword}" {prod.occurrences ? `· ${prod.occurrences}회 출현` : ""}</div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {aiInsights.data?.competitorAlerts && (aiInsights.data.competitorAlerts as any[]).length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-orange-500" /> 경쟁자 동향 ({(aiInsights.data.competitorAlerts as any[]).length}건)</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {(aiInsights.data.competitorAlerts as any[]).map((al: any, i: number) => (
                    <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border ${al.severity === "warning" ? "bg-orange-50 border-orange-100" : "bg-blue-50 border-blue-100"}`}>
                      <span className="text-lg">{al.type === "review_surge" ? "📈" : "💰"}</span>
                      <div><span className="font-bold text-sm">"{al.keyword}"</span><p className="text-xs text-gray-600 mt-0.5">{al.message}</p></div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            <Card className="bg-gradient-to-r from-gray-50 to-slate-50 border-gray-200">
              <CardContent className="p-4 flex items-start gap-3">
                <Shield className="w-5 h-5 text-gray-500 mt-0.5 shrink-0" />
                <div>
                  <h4 className="font-bold text-sm text-gray-700">쿠팡 과거 데이터 추론</h4>
                  <p className="text-xs text-gray-500 mt-1">쿠팡 검색 API는 현재 시점의 결과만 반환하며, 네트워크 응답에 과거 이력은 포함되지 않습니다. <strong>매일 검색하여 데이터를 축적</strong>하는 것이 유일한 방법입니다. 확장프로그램이 매 검색 시 자동으로 스냅샷을 저장하고, 전일 대비 리뷰증가·가격변동·순위변동을 계산합니다.</p>
                  <p className="text-xs text-gray-500 mt-1"><strong>팁:</strong> 6시간마다 자동 순위 추적이 동작합니다. 더 정확한 데이터를 위해 매일 1~2회 관심 키워드를 검색해주세요.</p>
                </div>
              </CardContent>
            </Card>
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
                        <Button variant="outline" size="sm" className="h-7 text-xs ml-auto text-pink-600 border-pink-200 hover:bg-pink-50 gap-0.5"
                          onClick={() => openSourcingModal({
                            source: "candidate",
                            candidateTitle: c.title,
                            candidatePrice: c.price,
                            candidateCategory: c.category,
                            candidateUrl: c.coupangUrl,
                            candidateSearchQuery: c.searchQuery,
                          })}>
                          <Plus className="w-3 h-3" /> 소싱 등록
                        </Button>
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
                            <Button variant="outline" size="sm" className="h-6 text-[10px] text-pink-600 border-pink-200 hover:bg-pink-50 shrink-0 gap-0.5"
                              onClick={() => openSourcingModal({
                                source: "ai_recommendation",
                                aiTitle: item.query || item.title,
                                keyword: item.query || item.title,
                                aiReason: item.reason,
                                aiType: rec.type,
                                aiScore: item.score,
                              })}>
                              <Plus className="w-2.5 h-2.5" /> 소싱
                            </Button>
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
                          <Button variant="outline" size="sm" className="h-7 text-xs text-pink-600 border-pink-200 hover:bg-pink-50 gap-1"
                            onClick={() => openSourcingModal({
                              source: "review_analysis",
                              reviewQuery: analysis.query,
                              summaryText: analysis.summaryText,
                              opportunities: analysis.opportunities,
                              painPoints: analysis.painPoints,
                              customerNeeds: analysis.customerNeeds,
                              recommendations: analysis.recommendations,
                              commonPraises: analysis.commonPraises,
                              commonComplaints: analysis.commonComplaints,
                              qualityConcerns: analysis.qualityConcerns,
                              marketOverview: analysis.marketOverview,
                              priceSensitivity: analysis.priceSensitivity,
                            })}>
                            <Plus className="w-3 h-3" /> 소싱 등록
                          </Button>
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

        {/* ===== 내 상품 추적 탭 ===== */}
        {activeTab === "myproducts" && (
          <>
            {/* 상단 요약 카드 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <Card className="p-4">
                <p className="text-xs text-gray-500 mb-1">추적 상품</p>
                <p className="text-2xl font-bold text-indigo-600">{trackingOverview.data?.totalProducts || 0}</p>
                <div className="flex gap-2 mt-1 text-[10px] text-gray-400">
                  <span>소싱 {trackingOverview.data?.bySource?.product || 0}</span>
                  <span>후보 {trackingOverview.data?.bySource?.candidate || 0}</span>
                  <span>매핑 {trackingOverview.data?.bySource?.coupang_mapping || 0}</span>
                </div>
              </Card>
              <Card className="p-4">
                <p className="text-xs text-gray-500 mb-1">가격 변동</p>
                <p className="text-2xl font-bold text-amber-600">{trackingOverview.data?.priceAlerts || 0}건</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs text-gray-500 mb-1">순위 변동</p>
                <p className="text-2xl font-bold text-green-600">{trackingOverview.data?.rankAlerts || 0}건</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs text-gray-500 mb-1">리뷰 증가</p>
                <p className="text-2xl font-bold text-blue-600">{trackingOverview.data?.reviewGrowing || 0}건</p>
              </Card>
            </div>

            {/* 자동 등록 버튼 */}
            <Card className="mb-4">
              <CardContent className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="text-sm font-semibold flex items-center gap-2"><Zap className="w-4 h-4 text-amber-500" /> 자동 상품 추적</h3>
                    <p className="text-xs text-gray-500 mt-1">소싱 상품, 소싱 후보, 쿠팡 매핑을 자동으로 추적에 등록합니다.</p>
                  </div>
                  <Button size="sm" onClick={() => autoRegister.mutate()} disabled={autoRegister.isPending} className="gap-1">
                    <Zap className="w-3 h-3" /> {autoRegister.isPending ? "등록 중..." : "자동 등록 실행"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {selectedTrackingId && trackingDetail.data ? (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setSelectedTrackingId(null)} className="text-xs">← 목록</Button>
                      {trackingDetail.data.tracking.productName}
                    </CardTitle>
                    <Button size="sm" variant="outline" onClick={() => analyzeTracked.mutate({ trackingId: selectedTrackingId })}
                      disabled={analyzeTracked.isPending} className="gap-1 text-xs">
                      <Brain className="w-3 h-3" /> AI 분석
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                    <div className="text-center p-3 bg-gray-50 rounded">
                      <p className="text-xs text-gray-500">가격</p>
                      <p className="text-lg font-bold">{formatPrice(trackingDetail.data.tracking.latestPrice)}</p>
                      <ChangeIndicator value={trackingDetail.data.tracking.priceChange} />
                    </div>
                    <div className="text-center p-3 bg-gray-50 rounded">
                      <p className="text-xs text-gray-500">평점</p>
                      <p className="text-lg font-bold">{trackingDetail.data.tracking.latestRating || '-'}</p>
                    </div>
                    <div className="text-center p-3 bg-gray-50 rounded">
                      <p className="text-xs text-gray-500">리뷰</p>
                      <p className="text-lg font-bold">{(trackingDetail.data.tracking.latestReviewCount || 0).toLocaleString()}</p>
                      <ChangeIndicator value={trackingDetail.data.tracking.reviewChange} />
                    </div>
                    <div className="text-center p-3 bg-gray-50 rounded">
                      <p className="text-xs text-gray-500">순위</p>
                      <p className="text-lg font-bold">{trackingDetail.data.tracking.latestRank || '-'}위</p>
                      <ChangeIndicator value={trackingDetail.data.tracking.rankChange} />
                    </div>
                    <div className="text-center p-3 bg-gray-50 rounded">
                      <p className="text-xs text-gray-500">경쟁자</p>
                      <p className="text-lg font-bold">{trackingDetail.data.tracking.competitorCount || 0}</p>
                    </div>
                  </div>
                  <div className="mb-4">
                    <p className="text-xs font-semibold text-gray-600 mb-2">추적 키워드</p>
                    <div className="flex flex-wrap gap-1">
                      {(trackingDetail.data.tracking.keywords || []).map((kw: string) => (
                        <Badge key={kw} variant="outline" className="text-xs">{kw}</Badge>
                      ))}
                    </div>
                  </div>
                  {trackingDetail.data.history.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-gray-600 mb-2">일별 추이</p>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={trackingDetail.data.history}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey="snapshotDate" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} />
                            <Tooltip />
                            <Line type="monotone" dataKey="price" name="가격" stroke="#6366f1" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="reviewCount" name="리뷰" stroke="#10b981" strokeWidth={2} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                  {trackingDetail.data.tracking.similarProducts?.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-gray-600 mb-2">경쟁/유사 상품 비교</p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead><tr className="border-b bg-gray-50 text-gray-500">
                            <th className="text-left p-2">#</th><th className="text-left p-2">상품명</th>
                            <th className="text-center p-2">가격</th><th className="text-center p-2">리뷰</th>
                            <th className="text-center p-2">광고</th><th className="text-center p-2">로켓</th>
                          </tr></thead>
                          <tbody>
                            {trackingDetail.data.tracking.similarProducts.map((p: any, idx: number) => (
                              <tr key={idx} className="border-b hover:bg-gray-50">
                                <td className="p-2 font-bold">#{p.rank || idx + 1}</td>
                                <td className="p-2 truncate max-w-[200px]">{p.title}</td>
                                <td className="p-2 text-center">{formatPrice(p.price)}</td>
                                <td className="p-2 text-center">{(p.reviewCount||0).toLocaleString()}</td>
                                <td className="p-2 text-center">{p.isAd ? 'AD' : '-'}</td>
                                <td className="p-2 text-center">{p.isRocket ? '🚀' : '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {trackingDetail.data.tracking.aiSuggestion && (
                    <div className="p-3 bg-amber-50 rounded border border-amber-200">
                      <p className="text-xs font-semibold text-amber-700 mb-1 flex items-center gap-1"><Brain className="w-3 h-3" /> AI 제안</p>
                      {trackingDetail.data.tracking.aiSuggestion.split('\n').map((line: string, i: number) => (
                        <p key={i} className="text-xs text-amber-800 mb-0.5">• {line}</p>
                      ))}
                    </div>
                  )}
                  {trackingDetail.data.keywordStats.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-semibold text-gray-600 mb-2">키워드별 시장 현황</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {trackingDetail.data.keywordStats.map((ks: any) => (
                          <div key={ks.keyword} className="p-3 bg-gray-50 rounded border text-xs">
                            <p className="font-semibold text-indigo-600 mb-1">"{ks.keyword}"</p>
                            <div className="grid grid-cols-3 gap-1 text-gray-600">
                              <span>경쟁도: {ks.competitionScore}</span>
                              <span>평균가: {formatPrice(ks.avgPrice)}</span>
                              <span>리뷰증가: {ks.reviewGrowth||0}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Package className="w-4 h-4" /> 추적 상품 목록
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b bg-gray-50 text-xs text-gray-500">
                        <th className="text-left p-3">상품명</th><th className="text-center p-3">소스</th>
                        <th className="text-center p-3">가격</th><th className="text-center p-3">리뷰</th>
                        <th className="text-center p-3">순위</th><th className="text-center p-3">가격변동</th>
                        <th className="text-center p-3">리뷰변동</th><th className="text-center p-3">경쟁자</th>
                        <th className="text-center p-3">작업</th>
                      </tr></thead>
                      <tbody>
                        {productTrackings.data?.length ? productTrackings.data.map((t: any) => (
                          <tr key={t.id} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedTrackingId(t.id)}>
                            <td className="p-3">
                              <p className="font-medium text-indigo-600 truncate max-w-[200px]">{t.productName}</p>
                              {t.coupangProductId && <p className="text-[10px] text-gray-400">ID: {t.coupangProductId}</p>}
                            </td>
                            <td className="p-3 text-center">
                              <Badge variant="outline" className="text-[10px]">
                                {{ product: '소싱', candidate: '후보', coupang_mapping: '매핑', manual: '수동' }[t.sourceType as string] || t.sourceType}
                              </Badge>
                            </td>
                            <td className="p-3 text-center text-xs">{formatPrice(t.latestPrice)}</td>
                            <td className="p-3 text-center text-xs">{(t.latestReviewCount||0).toLocaleString()}</td>
                            <td className="p-3 text-center text-xs">{t.latestRank > 0 ? `${t.latestRank}위` : '-'}</td>
                            <td className="p-3 text-center"><ChangeIndicator value={t.priceChange} /></td>
                            <td className="p-3 text-center"><ChangeIndicator value={t.reviewChange} /></td>
                            <td className="p-3 text-center text-xs">{t.competitorCount||0}</td>
                            <td className="p-3 text-center" onClick={e => e.stopPropagation()}>
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-500"
                                onClick={() => { if(confirm('추적 해제?')) removeTracking.mutate({ id: t.id }); }}>
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </td>
                          </tr>
                        )) : (
                          <tr><td colSpan={9} className="text-center py-8 text-gray-400">
                            추적 중인 상품이 없습니다. "자동 등록 실행" 버튼을 눌러주세요.
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="mt-4">
              <CardContent className="p-4">
                <p className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1"><Info className="w-3 h-3" /> 작동 방식</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-gray-500">
                  <div><p className="font-medium text-gray-700 mb-1">자동 등록</p>
                    <p>• 소싱 상품/후보/쿠팡 매핑에서 자동 등록</p>
                    <p>• 상품명에서 키워드 자동 추출</p></div>
                  <div><p className="font-medium text-gray-700 mb-1">일일 자동 수집</p>
                    <p>• 관련 키워드 검색 시 자동 매칭/수집</p>
                    <p>• 가격/리뷰/순위 변동 → 알림 생성</p></div>
                </div>
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

        {/* ===== 소싱 관리 탭 ===== */}
        {activeTab === "sourcing" && (
          <>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Layers className="w-5 h-5 text-pink-500" /> 소싱 관리
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">등록된 소싱 상품을 관리합니다</p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" className="text-xs bg-gradient-to-r from-pink-500 to-purple-500 text-white gap-1"
                  onClick={() => openSourcingModal()}>
                  <Plus className="w-3 h-3" /> 새 소싱 등록
                </Button>
              </div>
            </div>

            {/* Stats Cards */}
            {sourcingStats.data && (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
                {[
                  { label: "전체", value: sourcingStats.data.total, color: "text-gray-700" },
                  { label: "초안", value: sourcingStats.data.draft, color: "text-gray-500" },
                  { label: "검토중", value: sourcingStats.data.reviewing, color: "text-amber-600" },
                  { label: "테스트후보", value: sourcingStats.data.testCandidate, color: "text-pink-600" },
                  { label: "테스트중", value: sourcingStats.data.testing, color: "text-indigo-600" },
                  { label: "선정", value: sourcingStats.data.selected, color: "text-green-600" },
                  { label: "보류", value: sourcingStats.data.hold, color: "text-orange-600" },
                  { label: "평균점수", value: sourcingStats.data.avgScore, color: "text-purple-600" },
                ].map((s, i) => (
                  <Card key={i}><CardContent className="pt-2 pb-2 text-center">
                    <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
                    <div className="text-[9px] text-gray-500">{s.label}</div>
                  </CardContent></Card>
                ))}
              </div>
            )}

            {/* Filters */}
            <div className="flex items-center gap-2 flex-wrap">
              <Input placeholder="상품명 검색..." value={sourcingSearch}
                onChange={e => { setSourcingSearch(e.target.value); setSourcingPage(0); }}
                className="h-8 text-xs w-52" />
              <div className="flex gap-1">
                {[
                  { key: "all", label: "전체" },
                  { key: "draft", label: "초안" },
                  { key: "reviewing", label: "검토중" },
                  { key: "test_candidate", label: "테스트후보" },
                  { key: "testing", label: "테스트중" },
                  { key: "selected", label: "선정" },
                  { key: "hold", label: "보류" },
                  { key: "dropped", label: "탈락" },
                ].map(s => (
                  <button key={s.key}
                    className={`px-2 py-1 text-[10px] rounded-full transition ${sourcingStatusFilter === s.key ? 'bg-pink-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    onClick={() => { setSourcingStatusFilter(s.key); setSourcingPage(0); }}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Products Table */}
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-gray-50 text-[10px] text-gray-500">
                        <th className="p-2 text-left">상품명</th>
                        <th className="p-2 text-center">카테고리</th>
                        <th className="p-2 text-center">키워드</th>
                        <th className="p-2 text-center">경쟁</th>
                        <th className="p-2 text-center">차별화</th>
                        <th className="p-2 text-center">점수</th>
                        <th className="p-2 text-center">등급</th>
                        <th className="p-2 text-center">상태</th>
                        <th className="p-2 text-center">날짜</th>
                        <th className="p-2 text-center">관리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!sourcingList.data?.items?.length ? (
                        <tr><td colSpan={10} className="text-center py-12 text-gray-400">
                          <Layers className="w-10 h-10 mx-auto mb-2 opacity-20" />
                          <p className="text-sm font-medium">소싱 상품이 없습니다</p>
                          <p className="text-[10px] mt-1">"새 소싱 등록" 버튼으로 등록하거나,<br/>검색수요/AI추천/리뷰분석에서 소싱 등록할 수 있습니다.</p>
                        </td></tr>
                      ) : (
                        sourcingList.data.items.map((p: any) => {
                          const compLabel: Record<string, string> = { low: "낮음", medium: "보통", high: "높음", very_high: "매우높음" };
                          const diffLabel: Record<string, string> = { low: "낮음", medium: "보통", high: "높음" };
                          const gradeColor: Record<string, string> = {
                            S: "bg-pink-100 text-pink-700", A: "bg-purple-100 text-purple-700",
                            B: "bg-indigo-100 text-indigo-700", C: "bg-amber-100 text-amber-700", D: "bg-gray-100 text-gray-500"
                          };
                          const sStatusLabels: Record<string, string> = {
                            draft: "초안", reviewing: "검토중", test_candidate: "테스트후보",
                            testing: "테스트중", hold: "보류", dropped: "탈락", selected: "선정",
                          };
                          const sStatusColors: Record<string, string> = {
                            draft: "bg-gray-100 text-gray-600", reviewing: "bg-amber-100 text-amber-700",
                            test_candidate: "bg-pink-100 text-pink-700", testing: "bg-indigo-100 text-indigo-700",
                            hold: "bg-orange-100 text-orange-700", dropped: "bg-red-100 text-red-600",
                            selected: "bg-green-100 text-green-700",
                          };
                          return (
                            <tr key={p.id} className="border-b hover:bg-gray-50 transition">
                              <td className="p-2">
                                <div className="font-medium text-sm line-clamp-1 max-w-[200px]" title={p.productName}>{p.productName}</div>
                                {p.coupangUrl && (
                                  <a href={p.coupangUrl} target="_blank" rel="noreferrer" className="text-[9px] text-indigo-500 hover:underline flex items-center gap-0.5 mt-0.5">
                                    <ExternalLink className="w-2.5 h-2.5" /> 쿠팡
                                  </a>
                                )}
                              </td>
                              <td className="p-2 text-center"><Badge variant="outline" className="text-[9px]">{p.category || "-"}</Badge></td>
                              <td className="p-2 text-center">
                                <div className="text-[9px] text-gray-600 max-w-[120px] truncate" title={[p.keyword1, p.keyword2, p.keyword3].filter(Boolean).join(", ")}>
                                  {[p.keyword1, p.keyword2, p.keyword3].filter(Boolean).join(", ") || "-"}
                                </div>
                              </td>
                              <td className="p-2 text-center"><Badge variant="outline" className="text-[9px]">{compLabel[p.competitionLevel] || "-"}</Badge></td>
                              <td className="p-2 text-center"><Badge variant="outline" className="text-[9px]">{diffLabel[p.differentiationLevel] || "-"}</Badge></td>
                              <td className="p-2 text-center font-bold text-sm">{p.score || 0}</td>
                              <td className="p-2 text-center"><Badge className={`text-[9px] ${gradeColor[p.scoreGrade] || "bg-gray-100"}`}>{p.scoreGrade || "?"}</Badge></td>
                              <td className="p-2 text-center">
                                <Select value={p.status} onValueChange={(val) => sourcingChangeStatus.mutate({ id: p.id, status: val as any })}>
                                  <SelectTrigger className="h-6 text-[10px] w-20 border-0 bg-transparent"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {Object.entries(sStatusLabels).map(([k, v]) => (
                                      <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="p-2 text-center text-[10px] text-gray-400">{p.recordDate}</td>
                              <td className="p-2 text-center">
                                <div className="flex gap-1 justify-center">
                                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-indigo-600"
                                    onClick={() => openSourcingModal(undefined, p)}>
                                    <Edit3 className="w-3 h-3" />
                                  </Button>
                                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-400"
                                    onClick={() => { if (confirm("삭제하시겠습니까?")) sourcingDelete.mutate({ id: p.id }); }}>
                                    <Trash2 className="w-3 h-3" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                {/* Pagination */}
                {sourcingList.data && sourcingList.data.total > 20 && (
                  <div className="flex items-center justify-between p-3 border-t">
                    <span className="text-[10px] text-gray-400">총 {sourcingList.data.total}개</span>
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" className="h-6 text-[10px]"
                        disabled={sourcingPage === 0}
                        onClick={() => setSourcingPage(p => p - 1)}>이전</Button>
                      <span className="text-[10px] text-gray-500 px-2 py-1">
                        {sourcingPage + 1} / {Math.ceil(sourcingList.data.total / 20)}
                      </span>
                      <Button variant="outline" size="sm" className="h-6 text-[10px]"
                        disabled={(sourcingPage + 1) * 20 >= sourcingList.data.total}
                        onClick={() => setSourcingPage(p => p + 1)}>다음</Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Grade / Category Distribution */}
            {sourcingStats.data && (sourcingStats.data.grades?.length > 0 || sourcingStats.data.categories?.length > 0) && (
              <div className="grid md:grid-cols-2 gap-4">
                {sourcingStats.data.grades?.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">등급 분포</CardTitle></CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={180}>
                        <PieChart>
                          <Pie data={sourcingStats.data.grades.map((g: any) => ({ name: g.grade + "등급", value: g.count }))} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={65} innerRadius={30}>
                            {sourcingStats.data.grades.map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                          </Pie>
                          <Tooltip contentStyle={{ fontSize: 11 }} />
                          <Legend wrapperStyle={{ fontSize: 10 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}
                {sourcingStats.data.categories?.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">카테고리 분포</CardTitle></CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={sourcingStats.data.categories.slice(0, 8)} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis type="number" tick={{ fontSize: 10 }} />
                          <YAxis type="category" dataKey="category" tick={{ fontSize: 10 }} width={80} />
                          <Tooltip contentStyle={{ fontSize: 11 }} />
                          <Bar dataKey="count" fill="#ec4899" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </>
        )}

        {/* Sourcing Form Modal */}
        <SourcingFormModal
          open={sourcingModalOpen}
          onClose={() => { setSourcingModalOpen(false); setSourcingPrefillData(undefined); setSourcingEditProduct(undefined); }}
          prefillData={sourcingPrefillData}
          editProduct={sourcingEditProduct}
          onSuccess={() => { sourcingList.refetch(); sourcingStats.refetch(); }}
        />
      </div>
    </DashboardLayout>
  );
}
