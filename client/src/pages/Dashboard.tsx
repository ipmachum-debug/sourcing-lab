import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Package, FlaskConical, TrendingUp, TrendingDown, CalendarCheck, AlertTriangle, Sparkles, Star, Crown, Heart, DollarSign, ShoppingCart, Zap, CheckCircle, AlertCircle, RefreshCw, Clock } from "lucide-react";
import { useLocation } from "wouter";
import { useState } from "react";

function formatNum(n: number): string { return n.toLocaleString("ko-KR"); }
function formatDate(d: Date | string | null): string {
  if (!d) return "-";
  const s = String(d);
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (m) {
    const [, y, mo, day, hh, mm, ss] = m;
    const h = Number(hh);
    const ampm = h < 12 ? "오전" : "오후";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${Number(y)}. ${Number(mo)}. ${Number(day)}. ${ampm} ${h12}:${mm}:${ss}`;
  }
  return new Date(d).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

type SalesTab = "daily" | "weekly" | "monthly";

export default function Dashboard() {
  const { data, isLoading } = trpc.dashboard.summary.useQuery();
  const { data: salesData } = trpc.dashboard.salesSummary.useQuery();
  const { data: coupangSummary } = trpc.dashboard.coupangSummary.useQuery();
  const { data: coupangAccounts } = trpc.coupang.listAccounts.useQuery(undefined, { retry: false });
  const [, setLocation] = useLocation();
  const [salesTab, setSalesTab] = useState<SalesTab>("daily");

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <div className="cute-dots">
            <div className="cute-dot" />
            <div className="cute-dot" />
            <div className="cute-dot" />
          </div>
          <p className="text-sm text-pink-400">로딩중...</p>
        </div>
      </DashboardLayout>
    );
  }

  const d = data;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight gradient-text flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-pink-400 animate-sparkle" />
              대시보드
            </h1>
            <p className="text-muted-foreground text-sm mt-1">이번 주: {d?.currentWeek}</p>
          </div>
          {d && !d.weeklyReviewDone ? (
            <Badge className="gap-1.5 py-1.5 px-4 bg-gradient-to-r from-pink-100 to-rose-100 text-pink-700 border border-pink-200 hover:from-pink-200 hover:to-rose-200">
              <AlertTriangle className="h-3.5 w-3.5" />
              주간 리뷰 미작성
            </Badge>
          ) : null}
        </div>

        {/* Summary cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="summary-card cursor-pointer p-5" onClick={() => setLocation("/daily")}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-muted-foreground">이번 주 소싱</span>
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-pink-100 to-pink-200 flex items-center justify-center">
                <Package className="h-5 w-5 text-pink-500" />
              </div>
            </div>
            <div className="text-3xl font-bold gradient-text">{d?.weekSourcedCount || 0}</div>
            <p className="text-xs text-muted-foreground mt-1.5">총 {d?.totalProductCount || 0}개 상품</p>
          </div>

          <div className="summary-card cursor-pointer p-5" onClick={() => setLocation("/test-candidates")}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-muted-foreground">테스트 후보</span>
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-100 to-purple-200 flex items-center justify-center">
                <FlaskConical className="h-5 w-5 text-purple-500" />
              </div>
            </div>
            <div className="text-3xl font-bold gradient-text">{d?.testCandidateCount || 0}</div>
            <p className="text-xs text-muted-foreground mt-1.5">85점 이상 자동 분류</p>
          </div>

          <div className="summary-card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-muted-foreground">이번 주 평균</span>
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-fuchsia-100 to-fuchsia-200 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-fuchsia-500" />
              </div>
            </div>
            <div className="text-3xl font-bold gradient-text">{d?.weekAvgScore || 0}</div>
            <p className="text-xs text-muted-foreground mt-1.5">/ 100점</p>
          </div>

          <div className="summary-card cursor-pointer p-5" onClick={() => setLocation("/weekly-review")}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-muted-foreground">주간 리뷰</span>
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-rose-100 to-rose-200 flex items-center justify-center">
                <CalendarCheck className="h-5 w-5 text-rose-500" />
              </div>
            </div>
            <div className="text-3xl font-bold">
              {d?.weeklyReviewDone ? (
                <span className="text-pink-500">완료</span>
              ) : (
                <span className="text-rose-400">미작성</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">금요일까지 작성</p>
          </div>
        </div>

        {/* Coupang API Status Card - Enhanced with meaningful data */}
        {coupangSummary ? (
          <Card className="pretty-card border-amber-100/60 overflow-hidden cursor-pointer" onClick={() => setLocation("/coupang")}>
            <div className="h-1 bg-gradient-to-r from-amber-300 via-orange-400 to-red-400" />
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-100 to-orange-200 flex items-center justify-center">
                    <Zap className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">쿠팡 판매 현황</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {coupangSummary.accountCount}개 계정 &#xB7; {coupangSummary.monthly.label}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {coupangSummary.hasActiveApi ? (
                    <Badge className="bg-emerald-50 text-emerald-600 border-emerald-200 text-xs"><CheckCircle className="w-3 h-3 mr-1" />API 연결됨</Badge>
                  ) : (
                    <Badge className="bg-amber-50 text-amber-600 border-amber-200 text-xs"><AlertCircle className="w-3 h-3 mr-1" />설정 필요</Badge>
                  )}
                </div>
              </div>
              {/* Data grid */}
              <div className="grid grid-cols-4 gap-3">
                <div className="text-center p-2.5 rounded-xl bg-gradient-to-br from-blue-50/80 to-cyan-50/80 border border-blue-100/40">
                  <p className="text-[10px] text-muted-foreground mb-0.5">오늘 주문</p>
                  <p className="text-lg font-bold text-blue-600">{formatNum(coupangSummary.today.orders)}</p>
                  <p className="text-[10px] text-muted-foreground">건</p>
                </div>
                <div className="text-center p-2.5 rounded-xl bg-gradient-to-br from-purple-50/80 to-pink-50/80 border border-purple-100/40">
                  <p className="text-[10px] text-muted-foreground mb-0.5">오늘 판매</p>
                  <p className="text-lg font-bold text-purple-600">{formatNum(coupangSummary.today.qty)}</p>
                  <p className="text-[10px] text-muted-foreground">개</p>
                </div>
                <div className="text-center p-2.5 rounded-xl bg-gradient-to-br from-amber-50/80 to-orange-50/80 border border-amber-100/40">
                  <p className="text-[10px] text-muted-foreground mb-0.5">월 매출</p>
                  <p className="text-base font-bold text-amber-600">{coupangSummary.monthly.grossSales >= 10000 ? `${formatNum(Math.round(coupangSummary.monthly.grossSales / 10000))}만` : formatNum(coupangSummary.monthly.grossSales)}</p>
                  <p className="text-[10px] text-muted-foreground">원</p>
                </div>
                <div className="text-center p-2.5 rounded-xl bg-gradient-to-br from-emerald-50/80 to-teal-50/80 border border-emerald-100/40">
                  <p className="text-[10px] text-muted-foreground mb-0.5">월 정산</p>
                  <p className="text-base font-bold text-emerald-600">{coupangSummary.monthly.payout >= 10000 ? `${formatNum(Math.round(coupangSummary.monthly.payout / 10000))}만` : formatNum(coupangSummary.monthly.payout)}</p>
                  <p className="text-[10px] text-muted-foreground">원</p>
                </div>
              </div>
              {/* Last sync info */}
              {coupangSummary.lastSync ? (
                <div className="mt-2.5 flex items-center justify-between text-[10px] text-muted-foreground px-1">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    <span>최근 동기화: {formatDate(coupangSummary.lastSync.startedAt)}</span>
                    <Badge className={`text-[9px] py-0 px-1.5 ${coupangSummary.lastSync.status === "success" ? "bg-emerald-50 text-emerald-500 border-emerald-200" : coupangSummary.lastSync.status === "failed" ? "bg-red-50 text-red-400 border-red-200" : "bg-blue-50 text-blue-400 border-blue-200"}`}>
                      {coupangSummary.lastSync.status === "success" ? "성공" : coupangSummary.lastSync.status === "failed" ? "실패" : "진행중"}
                    </Badge>
                    <span>{coupangSummary.lastSync.recordCount || 0}건</span>
                  </div>
                  <span className="text-pink-500 font-medium">상세보기 &rarr;</span>
                </div>
              ) : (
                <p className="mt-2.5 text-[10px] text-amber-600 text-center">아직 동기화한 데이터가 없습니다. 클릭하여 동기화를 시작하세요</p>
              )}
            </CardContent>
          </Card>
        ) : coupangAccounts && coupangAccounts.length > 0 ? (
          <Card className="pretty-card border-amber-100/60 overflow-hidden cursor-pointer" onClick={() => setLocation("/coupang")}>
            <div className="h-1 bg-gradient-to-r from-amber-300 via-orange-400 to-red-400" />
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-100 to-orange-200 flex items-center justify-center">
                    <Zap className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">쿠팡 API 연동</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{coupangAccounts.length}개 계정 등록됨</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {coupangAccounts.some(a => a.apiStatus === "active") ? (
                    <Badge className="bg-emerald-50 text-emerald-600 border-emerald-200 text-xs"><CheckCircle className="w-3 h-3 mr-1" />API 연결됨</Badge>
                  ) : (
                    <Badge className="bg-amber-50 text-amber-600 border-amber-200 text-xs"><AlertCircle className="w-3 h-3 mr-1" />설정 필요</Badge>
                  )}
                  <RefreshCw className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="pretty-card border-dashed border-amber-200 overflow-hidden cursor-pointer hover:border-amber-300 transition-colors" onClick={() => setLocation("/coupang")}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-50 to-orange-100 flex items-center justify-center">
                  <Zap className="h-5 w-5 text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-amber-700">쿠팡 API 연동하기</p>
                  <p className="text-xs text-muted-foreground">쿠팡 매출/주문/정산 데이터를 자동 수집하세요</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Sales Summary Card with Tabs */}
        {salesData ? (
          <Card className="pretty-card border-pink-100/60 overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-pink-300 via-purple-300 to-fuchsia-300" />
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-pink-400" />
                  <span className="gradient-text-soft">판매 수익 현황</span>
                </CardTitle>
                <div className="flex bg-gradient-to-r from-pink-50 to-purple-50 rounded-xl p-1 border border-pink-100/50">
                  {([
                    { key: "daily" as SalesTab, label: "일간" },
                    { key: "weekly" as SalesTab, label: "주간" },
                    { key: "monthly" as SalesTab, label: "월간" },
                  ]).map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setSalesTab(tab.key)}
                      className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        salesTab === tab.key
                          ? "bg-white text-pink-700 shadow-sm"
                          : "text-muted-foreground hover:text-pink-500"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {salesData[salesTab].label}
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-3 rounded-xl bg-gradient-to-br from-pink-50/80 to-rose-50/80 border border-pink-100/40">
                  <div className="flex items-center justify-center gap-1.5 mb-1">
                    <ShoppingCart className="h-3.5 w-3.5 text-pink-400" />
                    <span className="text-xs text-muted-foreground">판매수량</span>
                  </div>
                  <p className="text-xl font-bold gradient-text">{formatNum(salesData[salesTab].totalQuantity)}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">개</p>
                </div>
                <div className="text-center p-3 rounded-xl bg-gradient-to-br from-purple-50/80 to-fuchsia-50/80 border border-purple-100/40">
                  <div className="flex items-center justify-center gap-1.5 mb-1">
                    <TrendingUp className="h-3.5 w-3.5 text-purple-400" />
                    <span className="text-xs text-muted-foreground">매출</span>
                  </div>
                  <p className="text-xl font-bold gradient-text">{formatNum(salesData[salesTab].totalRevenue)}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">원</p>
                </div>
                <div className="text-center p-3 rounded-xl bg-gradient-to-br from-fuchsia-50/80 to-pink-50/80 border border-fuchsia-100/40">
                  <div className="flex items-center justify-center gap-1.5 mb-1">
                    <DollarSign className="h-3.5 w-3.5 text-fuchsia-400" />
                    <span className="text-xs text-muted-foreground">순이익</span>
                  </div>
                  <p className={`text-xl font-bold ${salesData[salesTab].totalProfit > 0 ? "text-pink-500" : salesData[salesTab].totalProfit < 0 ? "text-red-500" : "gradient-text"}`}>
                    {formatNum(salesData[salesTab].totalProfit)}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">원</p>
                </div>
              </div>
              {salesData[salesTab].totalRevenue > 0 && salesData[salesTab].totalProfit !== 0 ? (
                <div className="mt-3 flex items-center justify-center gap-2 text-xs">
                  <span className="text-muted-foreground">이익률</span>
                  <Badge className={`text-xs ${
                    (salesData[salesTab].totalProfit / salesData[salesTab].totalRevenue * 100) >= 20
                      ? "bg-gradient-to-r from-pink-100 to-rose-100 text-pink-700 border-pink-200"
                      : (salesData[salesTab].totalProfit / salesData[salesTab].totalRevenue * 100) >= 10
                        ? "bg-purple-100 text-purple-700 border-purple-200"
                        : "bg-amber-100 text-amber-700 border-amber-200"
                  }`}>
                    {(salesData[salesTab].totalProfit / salesData[salesTab].totalRevenue * 100).toFixed(1)}%
                  </Badge>
                </div>
              ) : null}
              <div className="mt-3 text-center">
                <button
                  onClick={() => setLocation("/daily-profit")}
                  className="text-xs text-pink-500 hover:text-pink-600 hover:underline transition-colors"
                >
                  Daily Profit Board 바로가기 &rarr;
                </button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-5 md:grid-cols-2">
          {/* Top scoring products */}
          <Card className="pretty-card border-pink-100/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Crown className="h-4 w-4 text-pink-400" />
                <span className="gradient-text-soft">고득점 상품 TOP 5</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {d?.topProducts && d.topProducts.length > 0 ? (
                <div className="space-y-2">
                  {d.topProducts.map((p, i) => (
                    <div key={p.id} className="flex items-center gap-3 cursor-pointer hover:bg-pink-50/60 rounded-xl p-2.5 -mx-2 transition-all"
                      onClick={() => setLocation(`/products/${p.id}`)}>
                      <div className={`h-7 w-7 rounded-lg flex items-center justify-center text-xs font-bold text-white ${
                        i === 0 ? "bg-gradient-to-br from-pink-400 to-rose-500" : 
                        i === 1 ? "bg-gradient-to-br from-purple-400 to-fuchsia-500" : 
                        "bg-gradient-to-br from-pink-300 to-purple-400"
                      }`}>{i + 1}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{p.productName}</p>
                        <p className="text-xs text-muted-foreground">{p.category || "미분류"}</p>
                      </div>
                      <Badge className={`text-xs ${
                        p.scoreGrade === "S" ? "bg-gradient-to-r from-pink-100 to-rose-100 text-pink-700 border-pink-200" :
                        p.scoreGrade === "A" ? "bg-gradient-to-r from-purple-100 to-fuchsia-100 text-purple-700 border-purple-200" :
                        "bg-gray-100 text-gray-600 border-gray-200"
                      }`}>
                        {p.scoreGrade === "S" ? <Star className="h-3 w-3 mr-0.5" /> : null}
                        {p.scoreGrade} ({p.score})
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Heart className="h-8 w-8 mx-auto mb-2 text-pink-200" />
                  <p className="text-sm text-muted-foreground">아직 등록된 상품이 없습니다</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent products */}
          <Card className="pretty-card border-purple-100/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="h-4 w-4 text-purple-400" />
                <span className="gradient-text-soft">최근 등록 상품</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {d?.recentProducts && d.recentProducts.length > 0 ? (
                <div className="space-y-2">
                  {d.recentProducts.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 cursor-pointer hover:bg-purple-50/60 rounded-xl p-2.5 -mx-2 transition-all"
                      onClick={() => setLocation(`/products/${p.id}`)}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{p.productName}</p>
                        <p className="text-xs text-muted-foreground">{p.recordDate} | {p.category || "미분류"}</p>
                      </div>
                      <StatusBadge status={p.status} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Package className="h-8 w-8 mx-auto mb-2 text-purple-200" />
                  <p className="text-sm text-muted-foreground">아직 등록된 상품이 없습니다</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Categories */}
          <Card className="pretty-card border-fuchsia-100/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="text-base">&#x1F4CA;</span>
                <span className="gradient-text-soft">이번 주 카테고리</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {d?.categoryStats && d.categoryStats.length > 0 ? (
                <div className="space-y-2.5">
                  {d.categoryStats.map(([cat, count]) => (
                    <div key={cat} className="flex items-center justify-between p-2 rounded-lg hover:bg-fuchsia-50/50 transition-all">
                      <span className="text-sm">{cat}</span>
                      <Badge className="bg-gradient-to-r from-pink-100 to-purple-100 text-pink-700 border-pink-200 text-xs">{count}개</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">데이터 없음</p>
              )}
            </CardContent>
          </Card>

          {/* Keywords */}
          <Card className="pretty-card border-rose-100/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="text-base">&#x1F511;</span>
                <span className="gradient-text-soft">이번 주 키워드 TOP</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {d?.topKeywords && d.topKeywords.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {d.topKeywords.map(([kw, count]) => (
                    <Badge key={kw} className="text-xs bg-gradient-to-r from-pink-50 to-purple-50 text-pink-700 border border-pink-200/60 px-3 py-1">
                      {kw} ({count})
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">데이터 없음</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    draft: { label: "초안", className: "bg-gray-100 text-gray-600 border-gray-200" },
    reviewing: { label: "검토중", className: "bg-purple-100 text-purple-700 border-purple-200" },
    test_candidate: { label: "테스트후보", className: "bg-gradient-to-r from-pink-100 to-rose-100 text-pink-700 border-pink-200" },
    testing: { label: "테스트중", className: "bg-gradient-to-r from-fuchsia-100 to-purple-100 text-fuchsia-700 border-fuchsia-200" },
    hold: { label: "보류", className: "bg-amber-100 text-amber-700 border-amber-200" },
    dropped: { label: "폐기", className: "bg-red-100 text-red-600 border-red-200" },
    selected: { label: "선정", className: "bg-gradient-to-r from-pink-200 to-purple-200 text-pink-800 border-pink-300 font-semibold" },
  };
  const { label, className } = map[status] || { label: status, className: "bg-gray-100 text-gray-600 border-gray-200" };
  return <Badge className={`text-xs ${className}`}>{label}</Badge>;
}
