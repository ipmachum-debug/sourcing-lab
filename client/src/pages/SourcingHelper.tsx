import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  Search, Star, TrendingUp, Package, Trash2, Target,
  BarChart3, ExternalLink, Download, Brain, Bell, 
  Activity, Sparkles, Eye, BookOpen, ChevronRight,
  ArrowUpRight, ArrowDownRight, Minus, Puzzle, Zap,
  FileText, BellRing, AlertTriangle, Lightbulb
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
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
const PIE_COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899"];

function formatPrice(n: number | null | undefined) {
  if (n === null || n === undefined) return "-";
  return n.toLocaleString("ko-KR") + "원";
}

export default function SourcingHelper() {
  const [, setLocation] = useLocation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Queries
  const searchStats = trpc.extension.searchStats.useQuery();
  const candidateStats = trpc.extension.candidateStats.useQuery();
  const candidates = trpc.extension.listCandidates.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter as any,
    limit: 50,
  });
  const snapshots = trpc.extension.listSnapshots.useQuery({
    limit: 20,
    query: searchQuery || undefined,
  });
  const trackedKeywords = trpc.extension.listTrackedKeywords.useQuery();
  const activitySummary = trpc.extension.activitySummary.useQuery({ days: 7 });
  const searchTrends = trpc.extension.searchTrends.useQuery({ days: 14 });
  const reviewAnalyses = trpc.extension.getReviewAnalysis.useQuery({ limit: 3 });
  const unreadCount = trpc.extension.unreadNotificationCount.useQuery(undefined, { refetchInterval: 30000 });

  // Mutations
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
  const deleteSnapshot = trpc.extension.deleteSnapshot.useMutation({
    onSuccess: () => { snapshots.refetch(); searchStats.refetch(); toast.success("삭제됨"); },
    onError: (err) => toast.error(err.message || "삭제 실패"),
  });
  const deleteAllSnapshots = trpc.extension.deleteAllSnapshots.useMutation({
    onSuccess: () => { snapshots.refetch(); searchStats.refetch(); toast.success("모든 히스토리 삭제됨"); },
    onError: (err) => toast.error(err.message || "히스토리 삭제 실패"),
  });

  const sStats = searchStats.data;
  const cStats = candidateStats.data;
  const activity = activitySummary.data;

  return (
    <DashboardLayout>
      <div className="space-y-4">
        {/* ===== 페이지 헤더 + 빠른 액세스 ===== */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <span className="text-3xl">🐢</span> 소싱 헬퍼
            </h1>
            <p className="text-gray-500 text-sm mt-1">Chrome 확장프로그램 데이터 · AI 분석 · 소싱 관리 허브</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* 알림 */}
            <Button variant="ghost" size="sm" className="relative gap-1.5" onClick={() => setLocation("/extension")}>
              <Bell className="w-4 h-4" />
              {(unreadCount.data?.count || 0) > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {unreadCount.data!.count > 9 ? "9+" : unreadCount.data!.count}
                </span>
              )}
            </Button>
            {/* 대시보드로 */}
            <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => setLocation("/extension")}>
              <BarChart3 className="w-3.5 h-3.5" /> 대시보드
            </Button>
            {/* 가이드 */}
            <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => setLocation("/extension-guide")}>
              <BookOpen className="w-3.5 h-3.5" /> 가이드
            </Button>
            <Badge variant="outline" className="text-xs">v3.5</Badge>
          </div>
        </div>

        {/* ===== 퀵 네비게이션 카드 ===== */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <button onClick={() => setLocation("/extension")}
            className="text-left border rounded-xl p-4 hover:shadow-md hover:border-indigo-200 transition-all bg-gradient-to-br from-indigo-50 to-white group">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="w-5 h-5 text-indigo-500" />
              <span className="font-semibold text-sm">대시보드</span>
              <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-indigo-400 ml-auto transition-colors" />
            </div>
            <p className="text-xs text-gray-500">트렌드, 경쟁자, AI 추천, 리뷰 분석</p>
          </button>
          <button onClick={() => setLocation("/extension-guide")}
            className="text-left border rounded-xl p-4 hover:shadow-md hover:border-purple-200 transition-all bg-gradient-to-br from-purple-50 to-white group">
            <div className="flex items-center gap-2 mb-2">
              <BookOpen className="w-5 h-5 text-purple-500" />
              <span className="font-semibold text-sm">사용 가이드</span>
              <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-purple-400 ml-auto transition-colors" />
            </div>
            <p className="text-xs text-gray-500">설치 방법, 기능 설명, 워크플로우</p>
          </button>
          <a href="/coupang-helper-extension-v8.7.1.zip" download
            className="text-left border rounded-xl p-4 hover:shadow-md hover:border-green-200 transition-all bg-gradient-to-br from-green-50 to-white group">
            <div className="flex items-center gap-2 mb-2">
              <Download className="w-5 h-5 text-green-500" />
              <span className="font-semibold text-sm">다운로드</span>
              <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-green-400 ml-auto transition-colors" />
            </div>
            <p className="text-xs text-gray-500">Chrome 확장프로그램 v7.2.1</p>
          </a>
          <button onClick={() => setLocation("/extension")}
            className="text-left border rounded-xl p-4 hover:shadow-md hover:border-emerald-200 transition-all bg-gradient-to-br from-emerald-50 to-white group relative">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-5 h-5 text-emerald-500" />
              <span className="font-semibold text-sm">AI 리뷰 분석</span>
              <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-emerald-400 ml-auto transition-colors" />
            </div>
            <p className="text-xs text-gray-500">GPT-4o 기반 시장 분석 & 소싱 전략</p>
            <Badge className="absolute top-2 right-2 bg-emerald-100 text-emerald-700 text-[9px] px-1.5 py-0">NEW</Badge>
          </button>
        </div>

        {/* ===== 활동 요약 + 통계 ===== */}
        {activity && (activity.searches > 0 || activity.candidates > 0) && (
          <div className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-xl p-5 text-white">
            <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
              <Activity className="w-5 h-5" /> 최근 7일 활동
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div><div className="text-2xl font-bold">{activity.searches}</div><div className="text-white/70 text-xs">검색 분석</div></div>
              <div><div className="text-2xl font-bold">{activity.candidates}</div><div className="text-white/70 text-xs">후보 저장</div></div>
              <div><div className="text-2xl font-bold">{activity.rankRecords}</div><div className="text-white/70 text-xs">순위 기록</div></div>
              <div><div className="text-2xl font-bold">{activity.productDetails}</div><div className="text-white/70 text-xs">상세 파싱</div></div>
            </div>
          </div>
        )}

        {/* ===== 통계 카드 ===== */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card><CardContent className="pt-4 pb-4 text-center">
            <div className="text-2xl font-bold text-indigo-600">{sStats?.totalSearches ?? 0}</div>
            <div className="text-xs text-gray-500 mt-1">총 검색</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-4 text-center">
            <div className="text-2xl font-bold text-indigo-600">{sStats?.uniqueQueries ?? 0}</div>
            <div className="text-xs text-gray-500 mt-1">검색어 수</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-4 text-center">
            <div className="text-2xl font-bold text-indigo-600">{sStats?.avgCompetition ?? '-'}</div>
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

        {/* ===== 검색 트렌드 미니 차트 ===== */}
        {searchTrends.data && searchTrends.data.length > 1 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-indigo-500" /> 검색 트렌드 (14일)
                <Button variant="ghost" size="sm" className="text-xs ml-auto gap-1" onClick={() => setLocation("/extension")}>
                  자세히 보기 <ChevronRight className="w-3 h-3" />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={160}>
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

        {/* ===== AI 리뷰 분석 미리보기 + 추적 키워드 ===== */}
        <div className="grid md:grid-cols-2 gap-4">
          {/* 최근 AI 리뷰 분석 */}
          <Card className="border-emerald-200 bg-gradient-to-r from-emerald-50/40 to-teal-50/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-500" /> AI 리뷰 분석
                <Badge className="bg-emerald-100 text-emerald-700 text-[9px] px-1.5 py-0 ml-1">GPT</Badge>
                <Button variant="ghost" size="sm" className="text-xs ml-auto gap-1" onClick={() => setLocation("/extension")}>
                  분석 실행 <ChevronRight className="w-3 h-3" />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!reviewAnalyses.data?.length ? (
                <div className="text-center py-6 text-gray-400">
                  <Sparkles className="w-10 h-10 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">아직 리뷰 분석이 없습니다</p>
                  <p className="text-xs text-gray-400 mt-1">대시보드에서 키워드를 입력하고 AI 분석을 실행하세요</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {(reviewAnalyses.data as any[]).slice(0, 3).map((a: any, i: number) => (
                    <div key={i} className="bg-white rounded-lg p-3 shadow-sm border border-emerald-100">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-sm">"{a.query}"</span>
                        <span className="text-[10px] text-gray-400">
                          {new Date(a.createdAt).toLocaleDateString("ko-KR")}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Lightbulb className="w-3 h-3 text-green-500" />
                          {a.opportunities?.length || 0}개 기회
                        </span>
                        <span className="flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-red-500" />
                          {a.painPoints?.length || 0}개 주의
                        </span>
                        <span className="flex items-center gap-1">
                          <Zap className="w-3 h-3 text-purple-500" />
                          {a.recommendations?.length || 0}개 추천
                        </span>
                      </div>
                      {a.summaryText && (
                        <p className="text-xs text-gray-500 mt-2 line-clamp-2 leading-relaxed">{a.summaryText}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 추적 키워드 */}
          <Card className="border-indigo-200 bg-gradient-to-r from-indigo-50/40 to-purple-50/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Target className="w-4 h-4 text-indigo-500" /> 추적 키워드
                <Badge variant="outline" className="text-[10px] ml-1">{trackedKeywords.data?.length || 0}개</Badge>
                <Button variant="ghost" size="sm" className="text-xs ml-auto gap-1" onClick={() => setLocation("/extension")}>
                  순위 보기 <ChevronRight className="w-3 h-3" />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!trackedKeywords.data?.length ? (
                <div className="text-center py-6 text-gray-400">
                  <Target className="w-10 h-10 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">추적 키워드가 없습니다</p>
                  <p className="text-xs text-gray-400 mt-1">확장프로그램에서 순위 추적할 키워드를 등록하세요</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {(trackedKeywords.data as any[]).slice(0, 6).map((kw: any) => (
                    <div key={kw.id} className="flex items-center justify-between bg-white rounded-lg p-2.5 shadow-sm border border-indigo-100 hover:border-indigo-300 transition cursor-pointer"
                      onClick={() => setLocation("/extension")}>
                      <div className="min-w-0">
                        <div className="font-medium text-sm text-indigo-600 truncate">"{kw.query}"</div>
                        {kw.targetProductName && (
                          <div className="text-[10px] text-gray-400 truncate mt-0.5">
                            <Eye className="w-3 h-3 inline mr-0.5" />
                            {kw.targetProductName}
                          </div>
                        )}
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                    </div>
                  ))}
                  {(trackedKeywords.data?.length || 0) > 6 && (
                    <p className="text-center text-xs text-indigo-500 cursor-pointer hover:underline"
                      onClick={() => setLocation("/extension")}>
                      +{(trackedKeywords.data?.length || 0) - 6}개 더 보기
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ===== 메인 콘텐츠: 소싱 후보 + 검색 히스토리 ===== */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 좌측: 소싱 후보 목록 */}
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Star className="w-5 h-5 text-amber-500" /> 소싱 후보 관리
                  </CardTitle>
                  <div className="flex items-center gap-2 flex-wrap">
                    {(cStats?.statusCounts as any[] || []).map((s: any) => (
                      <span key={s.status}
                        className={`text-xs px-2 py-1 rounded-full cursor-pointer transition-all ${statusColors[s.status] || 'bg-gray-100'} ${statusFilter === s.status ? 'ring-2 ring-indigo-400 shadow-sm' : 'hover:shadow-sm'}`}
                        onClick={() => setStatusFilter(statusFilter === s.status ? "all" : s.status)}>
                        {statusLabels[s.status] || s.status} {s.count}
                      </span>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {candidates.isLoading ? (
                  <div className="text-center py-8 text-gray-400">로딩중...</div>
                ) : !candidates.data?.length ? (
                  <div className="text-center py-12 text-gray-400">
                    <Star className="w-12 h-12 mx-auto mb-3 opacity-20" />
                    <p className="font-medium">소싱 후보가 없습니다</p>
                    <p className="text-sm mt-1">Chrome 확장프로그램에서 상품을 저장하세요</p>
                    <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={() => setLocation("/extension-guide")}>
                      <Puzzle className="w-3.5 h-3.5" /> 확장프로그램 설치하기
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {candidates.data.map((c: any) => (
                      <div key={c.id} className="border rounded-lg p-3 hover:shadow-md transition-shadow">
                        <div className="flex gap-3">
                          {c.imageUrl && (
                            <img src={c.imageUrl} alt="" className="w-16 h-16 rounded-lg object-cover bg-gray-100 flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <Badge variant="outline" className={`text-[10px] ${statusColors[c.status]}`}>
                                {statusLabels[c.status]}
                              </Badge>
                              {c.sourcingGrade && (
                                <Badge variant="secondary" className="text-[10px]">
                                  소싱 {c.sourcingGrade} ({c.sourcingScore}점)
                                </Badge>
                              )}
                              {c.searchQuery && (
                                <span className="text-[10px] text-gray-400">"{c.searchQuery}"</span>
                              )}
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
                            <SelectContent>
                              {Object.entries(statusLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          {c.coupangUrl && (
                            <a href={c.coupangUrl} target="_blank" rel="noreferrer"
                              className="text-xs text-indigo-600 hover:underline flex items-center gap-0.5">
                              쿠팡 <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                          <Button variant="outline" size="sm" className="h-7 text-xs ml-auto"
                            onClick={() => { if (confirm("소싱 상품 등록?")) promoteToProduct.mutate({ candidateId: c.id }); }}>
                            <Package className="w-3 h-3 mr-1" /> 승격
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 text-xs text-red-500"
                            onClick={() => { if (confirm("삭제?")) removeCandidate.mutate({ id: c.id }); }}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* 우측: 자주 검색 키워드 + 후보 현황 + 검색 히스토리 */}
          <div className="space-y-4">
            {/* 자주 검색한 키워드 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Search className="w-4 h-4 text-indigo-500" /> 자주 검색한 키워드 TOP 10
                </CardTitle>
              </CardHeader>
              <CardContent>
                {sStats?.topQueries?.length ? (
                  <div className="space-y-2">
                    {(sStats.topQueries as any[]).map((q: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-sm py-1.5 border-b border-gray-50 last:border-0">
                        <span className="text-xs text-gray-400 w-5 shrink-0">{i + 1}</span>
                        <span className="font-medium text-indigo-600 flex-1 truncate">"{q.query}"</span>
                        <span className="text-xs text-gray-400 shrink-0">{q.count}회</span>
                        <Badge variant="outline" className="text-[10px] shrink-0">경쟁 {q.avgCompetition ?? '-'}</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4 text-gray-400 text-sm">검색 기록이 없습니다</div>
                )}
              </CardContent>
            </Card>

            {/* 후보 상태별 현황 (파이차트) */}
            {cStats?.statusCounts && (cStats.statusCounts as any[]).length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">후보 상태별 현황</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4">
                    <ResponsiveContainer width={120} height={120}>
                      <PieChart>
                        <Pie data={(cStats.statusCounts as any[]).map(s => ({ name: statusLabels[s.status] || s.status, value: s.count }))}
                          dataKey="value" cx="50%" cy="50%" outerRadius={50} innerRadius={25}>
                          {(cStats.statusCounts as any[]).map((_: any, i: number) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-1.5 flex-1">
                      {(cStats.statusCounts as any[]).map((s: any, i: number) => (
                        <div key={s.status} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                            <span>{statusLabels[s.status] || s.status}</span>
                          </div>
                          <span className="font-bold">{s.count}</span>
                        </div>
                      ))}
                      <div className="pt-1.5 border-t text-[11px] text-gray-500">
                        평균 소싱점수: <strong>{cStats.avgScore || '-'}</strong>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 최근 검색 히스토리 */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <FileText className="w-4 h-4 text-gray-500" /> 최근 검색
                  </CardTitle>
                  {snapshots.data && snapshots.data.length > 0 && (
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] text-red-400"
                      onClick={() => { if (confirm("모든 히스토리 삭제?")) deleteAllSnapshots.mutate(); }}>
                      전체 삭제
                    </Button>
                  )}
                </div>
                <Input placeholder="검색어 필터..." value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)} className="mt-2 h-8 text-sm" />
              </CardHeader>
              <CardContent>
                {!snapshots.data?.length ? (
                  <div className="text-center py-4 text-gray-400 text-sm">검색 히스토리 없음</div>
                ) : (
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {snapshots.data.map((s: any) => (
                      <div key={s.id} className="border rounded-lg p-2.5 text-xs hover:bg-gray-50 group relative transition">
                        <button
                          className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-red-500 p-0.5"
                          onClick={(e) => { e.stopPropagation(); deleteSnapshot.mutate({ id: s.id }); }}>
                          <Trash2 className="w-3 h-3" />
                        </button>
                        <div className="font-semibold text-indigo-600">"{s.query}"</div>
                        <div className="flex items-center gap-2 mt-1 text-gray-500 flex-wrap">
                          <span>{s.totalItems}개</span>
                          <span>{formatPrice(s.avgPrice)}</span>
                          <Badge variant="outline" className={`text-[10px] ${
                            s.competitionLevel === 'hard' ? 'border-red-300 text-red-600' :
                            s.competitionLevel === 'medium' ? 'border-amber-300 text-amber-600' :
                            'border-green-300 text-green-600'}`}>
                            {s.competitionLevel === 'hard' ? '강' :
                             s.competitionLevel === 'medium' ? '보통' : '약'}
                            ({s.competitionScore}점)
                          </Badge>
                        </div>
                        <div className="text-gray-300 mt-1">
                          {new Date(s.createdAt).toLocaleString("ko-KR")}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
