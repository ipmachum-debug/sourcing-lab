import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import {
  Package, FlaskConical, TrendingUp, CalendarCheck,
  AlertTriangle, Sparkles, Star, Crown, DollarSign,
  ShoppingCart, Zap, CheckCircle, AlertCircle, Clock,
  ArrowRight, Search, Layers, Eye, Target,
  ChevronRight, BarChart3, Activity, Flame,
} from "lucide-react";
import { useLocation } from "wouter";
import { useState } from "react";

function fmt(n: number): string { return n.toLocaleString("ko-KR"); }
function fmtWon(n: number): string {
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}억`;
  if (n >= 10000) return `${Math.round(n / 10000).toLocaleString()}만`;
  return fmt(n);
}
function formatDate(d: Date | string | null): string {
  if (!d) return "-";
  const s = String(d);
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (m) {
    const [, y, mo, day, hh, mm] = m;
    const h = Number(hh);
    const ampm = h < 12 ? "오전" : "오후";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${Number(mo)}.${Number(day)} ${ampm} ${h12}:${mm}`;
  }
  return new Date(d).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

type SalesTab = "daily" | "weekly" | "monthly";

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  draft: { label: "초안", className: "bg-gray-100 text-gray-600 border-gray-200" },
  reviewing: { label: "검토중", className: "bg-purple-100 text-purple-700 border-purple-200" },
  test_candidate: { label: "테스트후보", className: "bg-pink-100 text-pink-700 border-pink-200" },
  testing: { label: "테스트중", className: "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200" },
  hold: { label: "보류", className: "bg-amber-100 text-amber-700 border-amber-200" },
  dropped: { label: "폐기", className: "bg-red-100 text-red-600 border-red-200" },
  selected: { label: "선정", className: "bg-emerald-100 text-emerald-700 border-emerald-200 font-semibold" },
};

function StatusBadge({ status }: { status: string }) {
  const { label, className } = STATUS_MAP[status] || { label: status, className: "bg-gray-100 text-gray-600" };
  return <Badge className={`text-[10px] ${className}`}>{label}</Badge>;
}

export default function Dashboard() {
  const { data: summary, isLoading } = trpc.dashboard.summary.useQuery();
  const { data: salesData } = trpc.dashboard.salesSummary.useQuery();
  const { data: coupangSummary } = trpc.dashboard.coupangSummary.useQuery();
  const { data: overview } = trpc.dashboard.overview.useQuery();
  const [, nav] = useLocation();
  const [salesTab, setSalesTab] = useState<SalesTab>("daily");

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <div className="cute-dots"><div className="cute-dot" /><div className="cute-dot" /><div className="cute-dot" /></div>
          <p className="text-sm text-pink-400">로딩중...</p>
        </div>
      </DashboardLayout>
    );
  }

  const d = summary;
  const ov = overview;
  const pipe = ov?.pipeline;

  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* ===== Header ===== */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight gradient-text flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-pink-400 animate-sparkle" />
              대시보드
            </h1>
            <p className="text-muted-foreground text-sm mt-1">이번 주: {d?.currentWeek}</p>
          </div>
          {d && !d.weeklyReviewDone && (
            <Badge
              className="gap-1.5 py-1.5 px-4 bg-gradient-to-r from-pink-100 to-rose-100 text-pink-700 border border-pink-200 hover:from-pink-200 hover:to-rose-200 cursor-pointer"
              onClick={() => nav("/weekly-review")}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              주간 리뷰 미작성
            </Badge>
          )}
        </div>

        {/* ===== 1. 핵심 지표 요약 4카드 ===== */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="이번 주 소싱" value={d?.weekSourcedCount || 0} sub={`총 ${fmt(d?.totalProductCount || 0)}개`}
            icon={<Package className="h-5 w-5 text-pink-500" />} gradient="from-pink-100 to-pink-200"
            onClick={() => nav("/daily")}
          />
          <MetricCard
            label="테스트 후보" value={pipe?.testCandidate || 0} sub="80점 이상 자동 분류"
            icon={<FlaskConical className="h-5 w-5 text-purple-500" />} gradient="from-purple-100 to-purple-200"
            onClick={() => nav("/test-candidates")}
          />
          <MetricCard
            label="이번 주 평균" value={d?.weekAvgScore || 0} sub="/ 100점"
            icon={<TrendingUp className="h-5 w-5 text-fuchsia-500" />} gradient="from-fuchsia-100 to-fuchsia-200"
          />
          <MetricCard
            label="주간 리뷰"
            value={d?.weeklyReviewDone ? "완료" : "미작성"}
            valueColor={d?.weeklyReviewDone ? "text-emerald-500" : "text-rose-400"}
            sub="금요일까지 작성"
            icon={<CalendarCheck className="h-5 w-5 text-rose-500" />} gradient="from-rose-100 to-rose-200"
            onClick={() => nav("/weekly-review")}
          />
        </div>

        {/* ===== 2. 소싱 파이프라인 ===== */}
        {pipe && pipe.total > 0 && (
          <Card className="pretty-card border-purple-100/60 overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-purple-300 via-pink-400 to-rose-400" />
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Layers className="h-4 w-4 text-purple-500" />
                  <span className="gradient-text-soft">소싱 파이프라인</span>
                </CardTitle>
                <button onClick={() => nav("/products")} className="text-xs text-pink-500 hover:text-pink-600 flex items-center gap-0.5">
                  전체보기 <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-1 overflow-x-auto pb-1">
                {([
                  { key: "draft", label: "초안", color: "bg-gray-200 text-gray-700", count: pipe.draft },
                  { key: "reviewing", label: "검토", color: "bg-purple-200 text-purple-800", count: pipe.reviewing },
                  { key: "testCandidate", label: "테스트후보", color: "bg-pink-200 text-pink-800", count: pipe.testCandidate },
                  { key: "testing", label: "테스트중", color: "bg-fuchsia-200 text-fuchsia-800", count: pipe.testing },
                  { key: "selected", label: "선정", color: "bg-emerald-200 text-emerald-800", count: pipe.selected },
                ] as const).map((stage, i, arr) => (
                  <div key={stage.key} className="flex items-center gap-1 flex-shrink-0">
                    <div className={`rounded-xl px-3 py-2 text-center min-w-[72px] ${stage.color}`}>
                      <div className="text-lg font-bold">{stage.count}</div>
                      <div className="text-[10px] font-medium">{stage.label}</div>
                    </div>
                    {i < arr.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />}
                  </div>
                ))}
                <div className="ml-2 flex gap-1 flex-shrink-0">
                  <div className="rounded-xl px-2.5 py-2 text-center bg-amber-100 text-amber-700 min-w-[52px]">
                    <div className="text-sm font-bold">{pipe.hold}</div>
                    <div className="text-[10px]">보류</div>
                  </div>
                  <div className="rounded-xl px-2.5 py-2 text-center bg-red-100 text-red-600 min-w-[52px]">
                    <div className="text-sm font-bold">{pipe.dropped}</div>
                    <div className="text-[10px]">폐기</div>
                  </div>
                </div>
              </div>
              {/* 등급 분포 바 */}
              {ov && ov.grades.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-medium text-gray-500">등급 분포</span>
                  </div>
                  <div className="flex h-5 rounded-lg overflow-hidden">
                    {(["S", "A", "B", "C", "D"] as const).map(g => {
                      const item = ov.grades.find(x => x.grade === g);
                      const cnt = item?.count || 0;
                      const pct = pipe.total > 0 ? (cnt / pipe.total) * 100 : 0;
                      if (pct === 0) return null;
                      const colors: Record<string, string> = { S: "bg-pink-400", A: "bg-purple-400", B: "bg-fuchsia-300", C: "bg-amber-300", D: "bg-gray-300" };
                      return (
                        <div key={g} className={`${colors[g]} flex items-center justify-center text-[9px] font-bold text-white`} style={{ width: `${pct}%`, minWidth: pct > 0 ? "20px" : 0 }}>
                          {g}({cnt})
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ===== 3. 쿠팡 판매 + 매출 (가로 2열) ===== */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* 쿠팡 판매 현황 */}
          <CoupangCard coupangSummary={coupangSummary} onNav={nav} />

          {/* 판매 수익 현황 */}
          {salesData && (
            <Card className="pretty-card border-pink-100/60 overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-pink-300 via-purple-300 to-fuchsia-300" />
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-pink-400" />
                    <span className="gradient-text-soft">판매 수익</span>
                  </CardTitle>
                  <div className="flex bg-gradient-to-r from-pink-50 to-purple-50 rounded-lg p-0.5 border border-pink-100/50">
                    {([
                      { key: "daily" as SalesTab, label: "일간" },
                      { key: "weekly" as SalesTab, label: "주간" },
                      { key: "monthly" as SalesTab, label: "월간" },
                    ]).map(tab => (
                      <button
                        key={tab.key}
                        onClick={() => setSalesTab(tab.key)}
                        className={`px-3 py-1 rounded-md text-[11px] font-medium transition-all ${
                          salesTab === tab.key ? "bg-white text-pink-700 shadow-sm" : "text-muted-foreground hover:text-pink-500"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-2">
                  <MiniStat icon={<ShoppingCart className="h-3 w-3 text-pink-400" />} label="판매" value={fmt(salesData[salesTab].totalQuantity)} unit="개" bg="from-pink-50/80 to-rose-50/80 border-pink-100/40" />
                  <MiniStat icon={<TrendingUp className="h-3 w-3 text-purple-400" />} label="매출" value={fmtWon(salesData[salesTab].totalRevenue)} unit="원" bg="from-purple-50/80 to-fuchsia-50/80 border-purple-100/40" />
                  <MiniStat
                    icon={<DollarSign className="h-3 w-3 text-fuchsia-400" />}
                    label="순이익" value={fmtWon(salesData[salesTab].totalProfit)} unit="원"
                    bg="from-fuchsia-50/80 to-pink-50/80 border-fuchsia-100/40"
                    valueColor={salesData[salesTab].totalProfit > 0 ? "text-pink-600" : salesData[salesTab].totalProfit < 0 ? "text-red-500" : undefined}
                  />
                </div>
                {salesData[salesTab].totalRevenue > 0 && salesData[salesTab].totalProfit !== 0 && (
                  <div className="mt-2 flex items-center justify-center gap-2 text-[11px]">
                    <span className="text-muted-foreground">이익률</span>
                    <Badge className="text-[10px] bg-pink-50 text-pink-700 border-pink-200">
                      {(salesData[salesTab].totalProfit / salesData[salesTab].totalRevenue * 100).toFixed(1)}%
                    </Badge>
                  </div>
                )}
                <button onClick={() => nav("/daily-profit")} className="mt-2 w-full text-center text-[11px] text-pink-500 hover:text-pink-600 hover:underline">
                  Daily Profit &rarr;
                </button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ===== 4. 시장 분석 (트렌딩 키워드 + 확장프로그램 통계) ===== */}
        {ov && (ov.trendingKeywords.length > 0 || ov.extension.totalSnapshots > 0) && (
          <Card className="pretty-card border-blue-100/60 overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-blue-300 via-cyan-400 to-teal-400" />
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-blue-500" />
                  <span className="gradient-text-soft">시장 분석</span>
                </CardTitle>
                <button onClick={() => nav("/demand")} className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-0.5">
                  검색수요 <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                {/* 트렌딩 키워드 */}
                <div>
                  <p className="text-[11px] font-medium text-gray-500 mb-2 flex items-center gap-1">
                    <Flame className="h-3 w-3 text-orange-400" /> 트렌딩 키워드 (7일)
                  </p>
                  {ov.trendingKeywords.length > 0 ? (
                    <div className="space-y-1.5">
                      {ov.trendingKeywords.map((kw, i) => (
                        <div key={kw.query} className="flex items-center gap-2 p-2 rounded-lg hover:bg-blue-50/50 transition-all cursor-pointer" onClick={() => nav("/demand")}>
                          <span className={`text-[10px] font-bold w-4 text-center ${i < 3 ? "text-orange-500" : "text-gray-400"}`}>{i + 1}</span>
                          <span className="text-sm font-medium flex-1 truncate">{kw.query}</span>
                          {kw.spikeLevel && kw.spikeLevel !== "normal" && (
                            <Badge className="text-[9px] bg-orange-50 text-orange-600 border-orange-200 px-1.5">
                              {kw.spikeLevel === "explosive" ? "폭발" : kw.spikeLevel === "surging" ? "급등" : "상승"}
                            </Badge>
                          )}
                          <div className="text-right">
                            <div className="text-[11px] font-semibold text-blue-600">{kw.keywordScore}점</div>
                            <div className="text-[9px] text-gray-400">수요 {kw.demandScore}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">키워드 데이터를 수집해보세요</p>
                  )}
                </div>

                {/* 확장프로그램 통계 */}
                <div>
                  <p className="text-[11px] font-medium text-gray-500 mb-2 flex items-center gap-1">
                    <Activity className="h-3 w-3 text-teal-400" /> 확장프로그램 수집 현황
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl p-3 bg-gradient-to-br from-blue-50/80 to-cyan-50/80 border border-blue-100/40 text-center cursor-pointer" onClick={() => nav("/demand")}>
                      <Search className="h-4 w-4 text-blue-400 mx-auto mb-1" />
                      <div className="text-lg font-bold text-blue-600">{fmt(ov.extension.uniqueQueries)}</div>
                      <div className="text-[10px] text-muted-foreground">추적 키워드</div>
                    </div>
                    <div className="rounded-xl p-3 bg-gradient-to-br from-cyan-50/80 to-teal-50/80 border border-cyan-100/40 text-center cursor-pointer" onClick={() => nav("/extension")}>
                      <Eye className="h-4 w-4 text-cyan-400 mx-auto mb-1" />
                      <div className="text-lg font-bold text-cyan-600">{fmt(ov.extension.totalSnapshots)}</div>
                      <div className="text-[10px] text-muted-foreground">시장 스냅샷</div>
                    </div>
                    <div className="rounded-xl p-3 bg-gradient-to-br from-teal-50/80 to-emerald-50/80 border border-teal-100/40 text-center cursor-pointer" onClick={() => nav("/sourcing-helper")}>
                      <Target className="h-4 w-4 text-teal-400 mx-auto mb-1" />
                      <div className="text-lg font-bold text-teal-600">{fmt(ov.extension.candidates.total)}</div>
                      <div className="text-[10px] text-muted-foreground">후보 상품</div>
                    </div>
                    <div className="rounded-xl p-3 bg-gradient-to-br from-emerald-50/80 to-green-50/80 border border-emerald-100/40 text-center cursor-pointer" onClick={() => nav("/sourcing-helper")}>
                      <CheckCircle className="h-4 w-4 text-emerald-400 mx-auto mb-1" />
                      <div className="text-lg font-bold text-emerald-600">{fmt(ov.extension.candidates.selected)}</div>
                      <div className="text-[10px] text-muted-foreground">선정 완료</div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ===== 5. 하단 2열: 고득점 TOP5 + 최근 상품 ===== */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* 고득점 상품 TOP 5 */}
          <Card className="pretty-card border-pink-100/60">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Crown className="h-4 w-4 text-pink-400" />
                  <span className="gradient-text-soft">고득점 상품 TOP 5</span>
                </CardTitle>
                <button onClick={() => nav("/products")} className="text-[11px] text-pink-500 hover:text-pink-600 flex items-center gap-0.5">
                  전체 <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            </CardHeader>
            <CardContent>
              {d?.topProducts && d.topProducts.length > 0 ? (
                <div className="space-y-1">
                  {d.topProducts.map((p, i) => (
                    <div key={p.id} className="flex items-center gap-2.5 cursor-pointer hover:bg-pink-50/60 rounded-lg p-2 -mx-1 transition-all"
                      onClick={() => nav(`/products/${p.id}`)}>
                      <div className={`h-6 w-6 rounded-md flex items-center justify-center text-[10px] font-bold text-white ${
                        i === 0 ? "bg-gradient-to-br from-pink-400 to-rose-500" :
                        i === 1 ? "bg-gradient-to-br from-purple-400 to-fuchsia-500" :
                        "bg-gradient-to-br from-pink-300 to-purple-400"
                      }`}>{i + 1}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{p.productName}</p>
                        <p className="text-[10px] text-muted-foreground">{p.category || "미분류"}</p>
                      </div>
                      <Badge className={`text-[10px] ${
                        p.scoreGrade === "S" ? "bg-pink-100 text-pink-700 border-pink-200" :
                        p.scoreGrade === "A" ? "bg-purple-100 text-purple-700 border-purple-200" :
                        "bg-gray-100 text-gray-600 border-gray-200"
                      }`}>
                        {p.scoreGrade === "S" && <Star className="h-2.5 w-2.5 mr-0.5" />}
                        {p.scoreGrade} ({p.score})
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={<Crown className="h-8 w-8 text-pink-200" />} text="등록된 상품이 없습니다" />
              )}
            </CardContent>
          </Card>

          {/* 최근 등록 상품 */}
          <Card className="pretty-card border-purple-100/60">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Package className="h-4 w-4 text-purple-400" />
                  <span className="gradient-text-soft">최근 등록 상품</span>
                </CardTitle>
                <button onClick={() => nav("/daily")} className="text-[11px] text-purple-500 hover:text-purple-600 flex items-center gap-0.5">
                  소싱하기 <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            </CardHeader>
            <CardContent>
              {d?.recentProducts && d.recentProducts.length > 0 ? (
                <div className="space-y-1">
                  {d.recentProducts.map(p => (
                    <div key={p.id} className="flex items-center gap-2.5 cursor-pointer hover:bg-purple-50/60 rounded-lg p-2 -mx-1 transition-all"
                      onClick={() => nav(`/products/${p.id}`)}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{p.productName}</p>
                        <p className="text-[10px] text-muted-foreground">{p.recordDate} | {p.category || "미분류"}</p>
                      </div>
                      <StatusBadge status={p.status} />
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={<Package className="h-8 w-8 text-purple-200" />} text="등록된 상품이 없습니다" />
              )}
            </CardContent>
          </Card>
        </div>

        {/* ===== 6. 하단 2열: 카테고리 + 키워드 ===== */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="pretty-card border-fuchsia-100/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-fuchsia-400" />
                <span className="gradient-text-soft">이번 주 카테고리</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {d?.categoryStats && d.categoryStats.length > 0 ? (
                <div className="space-y-1.5">
                  {d.categoryStats.map(([cat, count]) => (
                    <div key={cat} className="flex items-center justify-between p-1.5 rounded-lg hover:bg-fuchsia-50/50 transition-all">
                      <span className="text-sm">{cat}</span>
                      <Badge className="bg-pink-50 text-pink-700 border-pink-200 text-[10px]">{count}개</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-6">데이터 없음</p>
              )}
            </CardContent>
          </Card>

          <Card className="pretty-card border-rose-100/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Search className="h-4 w-4 text-rose-400" />
                <span className="gradient-text-soft">이번 주 키워드 TOP</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {d?.topKeywords && d.topKeywords.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {d.topKeywords.map(([kw, count]) => (
                    <Badge key={kw} className="text-[11px] bg-pink-50 text-pink-700 border border-pink-200/60 px-2.5 py-0.5">
                      {kw} ({count})
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-6">데이터 없음</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ===== 7. 퀵 액션 ===== */}
        <Card className="pretty-card border-gray-100/60">
          <CardContent className="py-3">
            <div className="flex flex-wrap gap-2">
              {([
                { label: "데일리 소싱", path: "/daily", icon: <Package className="h-3.5 w-3.5" />, color: "from-pink-500 to-rose-500" },
                { label: "검색 수요", path: "/demand", icon: <Search className="h-3.5 w-3.5" />, color: "from-blue-500 to-cyan-500" },
                { label: "니치 파인더", path: "/niche-finder", icon: <Target className="h-3.5 w-3.5" />, color: "from-purple-500 to-fuchsia-500" },
                { label: "AI 제품 발견", path: "/discovery", icon: <Sparkles className="h-3.5 w-3.5" />, color: "from-amber-500 to-orange-500" },
                { label: "마진 계산기", path: "/margin", icon: <DollarSign className="h-3.5 w-3.5" />, color: "from-emerald-500 to-teal-500" },
                { label: "쿠팡 관리", path: "/coupang", icon: <Zap className="h-3.5 w-3.5" />, color: "from-orange-500 to-red-500" },
              ]).map(item => (
                <button
                  key={item.path}
                  onClick={() => nav(item.path)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r ${item.color} text-white text-xs font-medium hover:opacity-90 transition-opacity shadow-sm`}
                >
                  {item.icon} {item.label}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

/* ===== Sub-components ===== */

function MetricCard({ label, value, sub, icon, gradient, onClick, valueColor }: {
  label: string; value: number | string; sub: string;
  icon: React.ReactNode; gradient: string;
  onClick?: () => void; valueColor?: string;
}) {
  return (
    <div className={`summary-card p-4 ${onClick ? "cursor-pointer" : ""}`} onClick={onClick}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <div className={`h-9 w-9 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center`}>
          {icon}
        </div>
      </div>
      <div className={`text-2xl font-bold ${valueColor || "gradient-text"}`}>{typeof value === "number" ? fmt(value) : value}</div>
      <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}

function MiniStat({ icon, label, value, unit, bg, valueColor }: {
  icon: React.ReactNode; label: string; value: string; unit: string; bg: string; valueColor?: string;
}) {
  return (
    <div className={`text-center p-2.5 rounded-xl bg-gradient-to-br ${bg} border`}>
      <div className="flex items-center justify-center gap-1 mb-0.5">
        {icon}
        <span className="text-[10px] text-muted-foreground">{label}</span>
      </div>
      <p className={`text-base font-bold ${valueColor || "gradient-text"}`}>{value}</p>
      <p className="text-[9px] text-muted-foreground">{unit}</p>
    </div>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="text-center py-6">
      <div className="mx-auto mb-1.5">{icon}</div>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function CoupangCard({ coupangSummary, onNav }: { coupangSummary: any; onNav: (p: string) => void }) {
  if (!coupangSummary) {
    return (
      <Card className="pretty-card border-dashed border-amber-200 overflow-hidden cursor-pointer hover:border-amber-300 transition-colors" onClick={() => onNav("/coupang")}>
        <CardContent className="py-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-50 to-orange-100 flex items-center justify-center">
              <Zap className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-amber-700">쿠팡 API 연동하기</p>
              <p className="text-xs text-muted-foreground">매출/주문/정산 데이터를 자동 수집하세요</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="pretty-card border-amber-100/60 overflow-hidden cursor-pointer" onClick={() => onNav("/coupang")}>
      <div className="h-1 bg-gradient-to-r from-amber-300 via-orange-400 to-red-400" />
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            쿠팡 판매
            <span className="text-[10px] font-normal text-muted-foreground">{coupangSummary.monthly.label}</span>
          </CardTitle>
          {coupangSummary.hasActiveApi ? (
            <Badge className="bg-emerald-50 text-emerald-600 border-emerald-200 text-[10px]"><CheckCircle className="w-2.5 h-2.5 mr-0.5" />연결됨</Badge>
          ) : (
            <Badge className="bg-amber-50 text-amber-600 border-amber-200 text-[10px]"><AlertCircle className="w-2.5 h-2.5 mr-0.5" />설정필요</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-4 gap-2">
          <MiniStat icon={<ShoppingCart className="h-3 w-3 text-blue-400" />} label="오늘 주문" value={fmt(coupangSummary.today.orders)} unit="건" bg="from-blue-50/80 to-cyan-50/80 border-blue-100/40" />
          <MiniStat icon={<Package className="h-3 w-3 text-purple-400" />} label="오늘 판매" value={fmt(coupangSummary.today.qty)} unit="개" bg="from-purple-50/80 to-pink-50/80 border-purple-100/40" />
          <MiniStat icon={<TrendingUp className="h-3 w-3 text-amber-500" />} label="월 매출" value={fmtWon(coupangSummary.monthly.grossSales)} unit="원" bg="from-amber-50/80 to-orange-50/80 border-amber-100/40" />
          <MiniStat icon={<DollarSign className="h-3 w-3 text-emerald-500" />} label="월 정산" value={fmtWon(coupangSummary.monthly.payout)} unit="원" bg="from-emerald-50/80 to-teal-50/80 border-emerald-100/40" />
        </div>
        {coupangSummary.lastSync && (
          <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground px-0.5">
            <div className="flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              <span>동기화: {formatDate(coupangSummary.lastSync.startedAt)}</span>
              <Badge className={`text-[8px] py-0 px-1 ${coupangSummary.lastSync.status === "success" ? "bg-emerald-50 text-emerald-500 border-emerald-200" : "bg-red-50 text-red-400 border-red-200"}`}>
                {coupangSummary.lastSync.status === "success" ? "성공" : "실패"}
              </Badge>
            </div>
            <span className="text-pink-500 font-medium">상세 &rarr;</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
