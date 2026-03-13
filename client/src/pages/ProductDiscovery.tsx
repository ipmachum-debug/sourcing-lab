import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Search, Loader2, Zap, ThumbsUp, ThumbsDown, Eye, Trash2,
  RefreshCw, CheckCircle, XCircle, Clock, Star, ArrowRight,
  TrendingUp, AlertTriangle, Lightbulb, Target, Package,
  ShieldAlert, Sparkles, BarChart3, Rocket, Brain,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";

function formatNum(n: number | null | undefined) {
  if (n === null || n === undefined || n === 0) return "-";
  return n.toLocaleString("ko-KR");
}

function gradeColor(grade: string): string {
  switch (grade) {
    case "S": return "text-yellow-500";
    case "A": return "text-green-500";
    case "B": return "text-blue-500";
    case "C": return "text-gray-500";
    default: return "text-red-400";
  }
}

function verdictLabel(verdict: string) {
  switch (verdict) {
    case "strong_buy": return <Badge className="bg-red-600 text-white text-xs">강력 추천</Badge>;
    case "buy": return <Badge className="bg-green-600 text-white text-xs">추천</Badge>;
    case "watch": return <Badge className="bg-yellow-600 text-white text-xs">관망</Badge>;
    case "pass": return <Badge variant="outline" className="text-xs">패스</Badge>;
    default: return null;
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "pending": return <Badge variant="outline" className="text-xs"><Clock className="w-3 h-3 mr-1" />대기</Badge>;
    case "crawling_search": return <Badge className="bg-blue-600 text-white text-xs"><Loader2 className="w-3 h-3 mr-1 animate-spin" />검색 크롤링</Badge>;
    case "filtering": return <Badge className="bg-purple-600 text-white text-xs"><Target className="w-3 h-3 mr-1" />필터링</Badge>;
    case "crawling_detail": return <Badge className="bg-blue-600 text-white text-xs"><Loader2 className="w-3 h-3 mr-1 animate-spin" />상세 크롤링</Badge>;
    case "analyzing": return <Badge className="bg-orange-600 text-white text-xs"><Sparkles className="w-3 h-3 mr-1 animate-pulse" />AI 분석</Badge>;
    case "completed": return <Badge className="bg-green-600 text-white text-xs"><CheckCircle className="w-3 h-3 mr-1" />완료</Badge>;
    case "failed": return <Badge className="bg-red-600 text-white text-xs"><XCircle className="w-3 h-3 mr-1" />실패</Badge>;
    default: return <Badge variant="outline" className="text-xs">{status}</Badge>;
  }
}

function competitionBadge(level: string) {
  if (level === "easy") return <Badge className="bg-green-100 text-green-700 text-xs">약함</Badge>;
  if (level === "hard") return <Badge className="bg-red-100 text-red-700 text-xs">강함</Badge>;
  return <Badge className="bg-yellow-100 text-yellow-700 text-xs">보통</Badge>;
}

export default function ProductDiscovery() {
  const [activeTab, setActiveTab] = useState<"discover" | "jobs" | "products">("discover");
  const [selectedJob, setSelectedJob] = useState<number | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [decisionMemo, setDecisionMemo] = useState("");
  const [expandedKeyword, setExpandedKeyword] = useState<string | null>(null);

  // Queries
  const overview = trpc.extension.overview.useQuery();
  const discovered = trpc.extension.discoverKeywords.useQuery(undefined, {
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const jobs = trpc.extension.listJobs.useQuery({ limit: 20 });
  const jobDetail = trpc.extension.getJobDetail.useQuery(
    { jobId: selectedJob! },
    { enabled: !!selectedJob }
  );
  const pendingProducts = trpc.extension.listProducts.useQuery({ decision: "pending", limit: 50 });

  // Mutations
  const approveKeyword = trpc.extension.approveKeyword.useMutation({
    onSuccess: (_, vars) => {
      toast.success(`"${vars.keyword}" 검토 승인! 확장프로그램이 자동 크롤링을 시작합니다.`);
      discovered.refetch();
      jobs.refetch();
      overview.refetch();
    },
    onError: e => toast.error(e.message),
  });

  const decide = trpc.extension.decide.useMutation({
    onSuccess: (_, vars) => {
      toast.success(vars.decision === "track" ? "추적 등록됨" : "거절됨");
      setSelectedProduct(null);
      setDecisionMemo("");
      jobs.refetch();
      jobDetail.refetch();
      pendingProducts.refetch();
      overview.refetch();
    },
    onError: e => toast.error(e.message),
  });

  const deleteJob = trpc.extension.deleteJob.useMutation({
    onSuccess: () => {
      toast.success("작업 삭제됨");
      setSelectedJob(null);
      jobs.refetch();
      overview.refetch();
    },
    onError: e => toast.error(e.message),
  });

  const ov = overview.data;
  const keywords = discovered.data || [];
  const jobList = jobs.data || [];
  const detail = jobDetail.data;
  const pending = pendingProducts.data || [];

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
        {/* 헤더 */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Brain className="w-6 h-6 text-purple-500" />
              AI 제품 발견
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              기존 크롤링 데이터에서 AI가 유망 키워드를 자동 발견 → 검토 승인 → 확장프로그램 자동 크롤링 → 상세 분석
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { discovered.refetch(); jobs.refetch(); overview.refetch(); pendingProducts.refetch(); }}
          >
            <RefreshCw className="w-4 h-4 mr-1" />새로고침
          </Button>
        </div>

        {/* 요약 카드 */}
        {ov && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card><CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">AI 발견</p>
              <p className="text-xl font-bold text-purple-500">{keywords.length}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">크롤링 중</p>
              <p className="text-xl font-bold text-blue-500">{formatNum(ov.pendingJobs)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">발견 제품</p>
              <p className="text-xl font-bold text-green-500">{formatNum(ov.totalProducts)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">판단 대기</p>
              <p className="text-xl font-bold text-orange-500">{formatNum(ov.pendingDecision)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">추적 중</p>
              <p className="text-xl font-bold text-emerald-500">{formatNum(ov.tracked)}</p>
            </CardContent></Card>
          </div>
        )}

        {/* 탭 네비게이션 */}
        <div className="flex gap-1 bg-muted p-1 rounded-lg">
          {([
            { key: "discover", label: "AI 발견 키워드", icon: Brain, count: keywords.length },
            { key: "jobs", label: "크롤링 작업", icon: Rocket, count: jobList.length },
            { key: "products", label: "판단 대기", icon: AlertTriangle, count: pending.length },
          ] as const).map(tab => (
            <button
              key={tab.key}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab(tab.key)}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {tab.count > 0 && (
                <span className="bg-primary/10 text-primary text-xs px-1.5 py-0.5 rounded-full">{tab.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* === 탭: AI 발견 키워드 === */}
        {activeTab === "discover" && (
          <div className="space-y-3">
            {discovered.isLoading ? (
              <Card><CardContent className="p-8 text-center">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">AI가 유망 키워드를 분석하고 있습니다...</p>
              </CardContent></Card>
            ) : keywords.length === 0 ? (
              <Card><CardContent className="p-8 text-center text-muted-foreground">
                <Brain className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="font-medium">아직 발견된 키워드가 없습니다</p>
                <p className="text-xs mt-1">검색 수요 분석에서 최소 2일 이상의 데이터가 필요합니다.</p>
              </CardContent></Card>
            ) : (
              <div className="space-y-2">
                {keywords.map((kw: any) => (
                  <Card
                    key={kw.keyword}
                    className="hover:shadow-md transition-shadow"
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          {/* 발견 점수 */}
                          <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${
                            kw.discoveryScore >= 70 ? "bg-gradient-to-br from-yellow-400 to-orange-500" :
                            kw.discoveryScore >= 50 ? "bg-gradient-to-br from-green-400 to-emerald-500" :
                            kw.discoveryScore >= 35 ? "bg-gradient-to-br from-blue-400 to-blue-500" :
                            "bg-gradient-to-br from-gray-400 to-gray-500"
                          }`}>
                            {kw.discoveryScore}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-semibold text-base">{kw.keyword}</span>
                              {competitionBadge(kw.competitionLevel)}
                              {kw.discoveryScore >= 60 && <Badge className="bg-yellow-100 text-yellow-700 text-[10px]">HOT</Badge>}
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span>수요 <strong className="text-foreground">{kw.demandScore}</strong></span>
                              <span>키워드 <strong className="text-foreground">{kw.keywordScore}</strong></span>
                              <span>경쟁 <strong className="text-foreground">{kw.competitionScore}</strong></span>
                              <span>MA7 <strong className="text-foreground">{formatNum(kw.salesEstimateMa7)}</strong></span>
                              <span>평균가 <strong className="text-foreground">{formatNum(kw.avgPrice)}원</strong></span>
                              <span>상품 <strong className="text-foreground">{kw.productCount}개</strong></span>
                            </div>

                            {/* 발견 이유 */}
                            {kw.reasons.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {kw.reasons.slice(0, 3).map((r: string, i: number) => (
                                  <span key={i} className="text-[10px] bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded">
                                    {r}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* 검토 승인 버튼 */}
                        <Button
                          className="ml-3 bg-purple-600 hover:bg-purple-700 flex-shrink-0"
                          size="sm"
                          onClick={() => approveKeyword.mutate({ keyword: kw.keyword })}
                          disabled={approveKeyword.isPending}
                        >
                          {approveKeyword.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin mr-1" />
                          ) : (
                            <Zap className="w-4 h-4 mr-1" />
                          )}
                          검토 승인
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* === 탭: 크롤링 작업 === */}
        {activeTab === "jobs" && (
          <div className="space-y-3">
            {jobList.length === 0 ? (
              <Card><CardContent className="p-8 text-center text-muted-foreground">
                <Rocket className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="font-medium">크롤링 작업이 없습니다</p>
                <p className="text-xs mt-1">AI 발견 탭에서 키워드를 승인하면 자동으로 크롤링이 시작됩니다.</p>
              </CardContent></Card>
            ) : (
              <div className="space-y-2">
                {jobList.map((j: any) => (
                  <Card
                    key={j.id}
                    className={`cursor-pointer hover:bg-muted/50 transition-colors ${selectedJob === j.id ? "ring-2 ring-primary" : ""}`}
                    onClick={() => setSelectedJob(selectedJob === j.id ? null : j.id)}
                  >
                    <CardContent className="p-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {statusLabel(j.status)}
                        <span className="font-medium">{j.keyword}</span>
                        {j.filterCriteria && (
                          <span className="text-xs text-muted-foreground">
                            {(j.filterCriteria as any)?.totalItems || 0}개 중 {(j.filterCriteria as any)?.selectedCount || 0}개 선별
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {j.detailCrawledCount > 0 && <span>상세 {j.detailCrawledCount}개</span>}
                        {j.createdAt && <span>{String(j.createdAt).slice(5, 16)}</span>}
                        {(j.status === "completed" || j.status === "failed") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={e => { e.stopPropagation(); deleteJob.mutate({ jobId: j.id }); }}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* 선택된 작업 상세 */}
            {selectedJob && detail && (
              <div className="space-y-3 mt-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Target className="w-5 h-5" />
                  "{detail.job.keyword}" 분석 결과
                </h2>

                {detail.job.aiAnalysisJson && (
                  <MarketOverviewCard analysis={detail.job.aiAnalysisJson as any} />
                )}

                {detail.job.errorMessage && (
                  <Card className="border-red-300 bg-red-50 dark:bg-red-900/20">
                    <CardContent className="p-3 text-sm text-red-600">
                      <XCircle className="w-4 h-4 inline mr-1" />
                      {String(detail.job.errorMessage)}
                    </CardContent>
                  </Card>
                )}

                {detail.products.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {detail.products.map((p: any) => (
                      <ProductCard key={p.id} product={p} onSelect={setSelectedProduct} />
                    ))}
                  </div>
                )}

                {detail.job.status === "pending" && (
                  <Card className="border-blue-300 bg-blue-50 dark:bg-blue-900/20">
                    <CardContent className="p-4 text-sm">
                      <Loader2 className="w-4 h-4 inline mr-2 animate-spin text-blue-500" />
                      확장프로그램이 크롤링을 대기 중입니다. 사이드패널이 열려있는지 확인하세요.
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </div>
        )}

        {/* === 탭: 판단 대기 제품 === */}
        {activeTab === "products" && (
          <div className="space-y-3">
            {pending.length === 0 ? (
              <Card><CardContent className="p-8 text-center text-muted-foreground">
                <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="font-medium">판단 대기 제품이 없습니다</p>
                <p className="text-xs mt-1">크롤링 완료 후 AI가 분석한 제품이 여기에 표시됩니다.</p>
              </CardContent></Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {pending.map((p: any) => (
                  <ProductCard key={p.id} product={p} onSelect={setSelectedProduct} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* 제품 상세 다이얼로그 */}
        {selectedProduct && (
          <ProductDetailDialog
            product={selectedProduct}
            onClose={() => { setSelectedProduct(null); setDecisionMemo(""); }}
            onDecide={(decision) => {
              decide.mutate({
                productId: selectedProduct.id,
                decision,
                memo: decisionMemo || undefined,
              });
            }}
            decisionMemo={decisionMemo}
            setDecisionMemo={setDecisionMemo}
            isDeciding={decide.isPending}
          />
        )}
      </div>
    </DashboardLayout>
  );
}

// ============================================================
//  서브 컴포넌트
// ============================================================

function ProductCard({ product: p, onSelect }: { product: any; onSelect: (p: any) => void }) {
  return (
    <Card
      className={`cursor-pointer hover:shadow-md transition-shadow ${p.userDecision === "track" ? "border-green-400" : p.userDecision === "reject" ? "border-red-300 opacity-60" : ""}`}
      onClick={() => onSelect(p)}
    >
      <CardContent className="p-3">
        <div className="flex gap-3">
          {p.imageUrl && (
            <img src={p.imageUrl} alt="" className="w-16 h-16 object-cover rounded flex-shrink-0"
              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-lg font-bold ${gradeColor(p.aiGrade || "D")}`}>{p.aiGrade || "?"}</span>
              <span className="text-sm font-medium">{p.aiScore}점</span>
              {verdictLabel(p.aiVerdict)}
              {p.userDecision === "track" && <Badge className="bg-green-600 text-white text-xs">추적 중</Badge>}
              {p.userDecision === "reject" && <Badge variant="outline" className="text-xs text-red-500">거절</Badge>}
            </div>
            <p className="text-sm truncate">{p.productTitle}</p>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
              <span>{formatNum(p.price)}원</span>
              <span>리뷰 {formatNum(p.reviewCount)}</span>
              {p.rating > 0 && <span>{Number(p.rating).toFixed(1)}점</span>}
              {p.isRocket && <Badge variant="outline" className="text-[10px] py-0">로켓</Badge>}
              {p.searchRank > 0 && <span>#{p.searchRank}</span>}
            </div>
          </div>
        </div>

        {p.aiReasonJson && Array.isArray(p.aiReasonJson) && p.aiReasonJson.length > 0 && (
          <div className="mt-2 space-y-1">
            {(p.aiReasonJson as any[]).slice(0, 2).map((r: any, i: number) => (
              <p key={i} className={`text-xs ${r.type === "positive" ? "text-green-600" : r.type === "negative" ? "text-red-500" : "text-muted-foreground"}`}>
                {r.type === "positive" ? "+" : r.type === "negative" ? "-" : "~"} {r.text}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MarketOverviewCard({ analysis }: { analysis: any }) {
  const mo = analysis?.marketOverview;
  if (!mo) return null;

  const levelColor = mo.competitionLevel === "low" ? "text-green-600" : mo.competitionLevel === "high" ? "text-red-500" : "text-yellow-600";
  const diffColor = mo.entryDifficulty === "easy" ? "text-green-600" : mo.entryDifficulty === "hard" ? "text-red-500" : "text-yellow-600";

  return (
    <Card className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20">
      <CardContent className="p-4">
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <TrendingUp className="w-4 h-4" /> 시장 개요
        </h3>
        <p className="text-sm mb-3">{mo.summary}</p>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-xs text-muted-foreground">경쟁 강도</p>
            <p className={`font-semibold ${levelColor}`}>
              {mo.competitionLevel === "low" ? "낮음" : mo.competitionLevel === "high" ? "높음" : "보통"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">시장 규모</p>
            <p className="font-semibold">
              {mo.marketSize === "small" ? "소형" : mo.marketSize === "large" ? "대형" : "중형"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">진입 난이도</p>
            <p className={`font-semibold ${diffColor}`}>
              {mo.entryDifficulty === "easy" ? "쉬움" : mo.entryDifficulty === "hard" ? "어려움" : "보통"}
            </p>
          </div>
        </div>
        {analysis.topRecommendation && (
          <div className="mt-3 p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded text-sm">
            <Star className="w-4 h-4 inline text-yellow-500 mr-1" />
            <strong>최고 추천:</strong> {analysis.topRecommendation.reason}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProductDetailDialog({
  product: p, onClose, onDecide, decisionMemo, setDecisionMemo, isDeciding,
}: {
  product: any; onClose: () => void; onDecide: (d: "track" | "reject") => void;
  decisionMemo: string; setDecisionMemo: (v: string) => void; isDeciding: boolean;
}) {
  const reasons = (p.aiReasonJson || []) as any[];
  const risks = (p.aiRiskJson || []) as any[];
  const opportunities = (p.aiOpportunityJson || []) as any[];

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className={`text-2xl font-bold ${gradeColor(p.aiGrade || "D")}`}>{p.aiGrade}</span>
            <span>{p.aiScore}점</span>
            {verdictLabel(p.aiVerdict)}
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-4">
          {p.imageUrl && (
            <img src={p.imageUrl} alt="" className="w-24 h-24 object-cover rounded"
              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
          )}
          <div className="flex-1">
            <p className="font-medium">{p.productTitle}</p>
            <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
              <div><span className="text-muted-foreground">가격:</span> {formatNum(p.price)}원</div>
              <div><span className="text-muted-foreground">리뷰:</span> {formatNum(p.reviewCount)}개</div>
              <div><span className="text-muted-foreground">평점:</span> {Number(p.rating).toFixed(1)}</div>
              <div><span className="text-muted-foreground">순위:</span> #{p.searchRank || "-"}</div>
              {p.sellerName && <div><span className="text-muted-foreground">판매자:</span> {p.sellerName}</div>}
              {p.deliveryType && <div><span className="text-muted-foreground">배송:</span> {p.deliveryType}</div>}
              {p.estimatedMonthlySales > 0 && <div><span className="text-muted-foreground">예상 월매출:</span> {formatNum(p.estimatedMonthlySales)}개</div>}
              {Number(p.estimatedMarginPercent) > 0 && <div><span className="text-muted-foreground">예상 마진:</span> {Number(p.estimatedMarginPercent).toFixed(0)}%</div>}
            </div>
          </div>
        </div>

        {reasons.length > 0 && (
          <div>
            <h4 className="font-semibold text-sm mb-2 flex items-center gap-1"><Lightbulb className="w-4 h-4 text-yellow-500" /> 분석 근거</h4>
            <div className="space-y-1">
              {reasons.map((r: any, i: number) => (
                <div key={i} className={`text-sm p-2 rounded ${r.type === "positive" ? "bg-green-50 dark:bg-green-900/20 text-green-700" : r.type === "negative" ? "bg-red-50 dark:bg-red-900/20 text-red-700" : "bg-gray-50 dark:bg-gray-800"}`}>
                  {r.type === "positive" ? <CheckCircle className="w-3 h-3 inline mr-1" /> : r.type === "negative" ? <XCircle className="w-3 h-3 inline mr-1" /> : <ArrowRight className="w-3 h-3 inline mr-1" />}
                  {r.category && <Badge variant="outline" className="text-[10px] mr-1 py-0">{r.category}</Badge>}
                  {r.text}
                </div>
              ))}
            </div>
          </div>
        )}

        {risks.length > 0 && (
          <div>
            <h4 className="font-semibold text-sm mb-2 flex items-center gap-1"><ShieldAlert className="w-4 h-4 text-red-500" /> 리스크</h4>
            <div className="space-y-1">
              {risks.map((r: any, i: number) => (
                <div key={i} className="text-sm p-2 rounded bg-red-50 dark:bg-red-900/20">
                  <Badge variant="outline" className={`text-[10px] mr-1 py-0 ${r.level === "high" ? "border-red-400 text-red-500" : r.level === "medium" ? "border-yellow-400 text-yellow-600" : ""}`}>
                    {r.level === "high" ? "높음" : r.level === "medium" ? "보통" : "낮음"}
                  </Badge>
                  {r.text}
                </div>
              ))}
            </div>
          </div>
        )}

        {opportunities.length > 0 && (
          <div>
            <h4 className="font-semibold text-sm mb-2 flex items-center gap-1"><Sparkles className="w-4 h-4 text-purple-500" /> 기회 요인</h4>
            <div className="space-y-1">
              {opportunities.map((o: any, i: number) => (
                <div key={i} className="text-sm p-2 rounded bg-purple-50 dark:bg-purple-900/20">
                  <Sparkles className="w-3 h-3 inline mr-1 text-purple-500" />{o.text}
                </div>
              ))}
            </div>
          </div>
        )}

        {p.userDecision === "pending" && (
          <div className="space-y-3 pt-2 border-t">
            <Textarea placeholder="메모 (선택)" value={decisionMemo} onChange={e => setDecisionMemo(e.target.value)} rows={2} />
            <div className="flex gap-2">
              <Button className="flex-1 bg-green-600 hover:bg-green-700" onClick={() => onDecide("track")} disabled={isDeciding}>
                {isDeciding ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ThumbsUp className="w-4 h-4 mr-1" />}
                매일 추적
              </Button>
              <Button variant="outline" className="flex-1 text-red-500 border-red-300 hover:bg-red-50" onClick={() => onDecide("reject")} disabled={isDeciding}>
                {isDeciding ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ThumbsDown className="w-4 h-4 mr-1" />}
                거절
              </Button>
            </div>
          </div>
        )}

        {p.userDecision !== "pending" && (
          <div className="pt-2 border-t text-sm text-muted-foreground">
            {p.userDecision === "track" ? (
              <p><CheckCircle className="w-4 h-4 inline text-green-500 mr-1" />추적 등록됨 {p.decidedAt ? `(${String(p.decidedAt).slice(0, 16)})` : ""}</p>
            ) : (
              <p><XCircle className="w-4 h-4 inline text-red-400 mr-1" />거절됨 {p.decidedAt ? `(${String(p.decidedAt).slice(0, 16)})` : ""}</p>
            )}
            {p.userMemo && <p className="mt-1">메모: {p.userMemo}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
