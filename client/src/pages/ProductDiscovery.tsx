import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2, Zap, ThumbsUp, ThumbsDown, Eye, Trash2,
  RefreshCw, CheckCircle, XCircle, Clock, Star, ArrowRight,
  TrendingUp, AlertTriangle, Lightbulb, Target, Package,
  ShieldAlert, Sparkles, BarChart3, Search, Rocket,
} from "lucide-react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined || n === 0) return "-";
  return n.toLocaleString("ko-KR");
}

function gradeColor(g: string) {
  return g === "S" ? "text-yellow-500" : g === "A" ? "text-green-500" : g === "B" ? "text-blue-500" : g === "C" ? "text-gray-500" : "text-red-400";
}

function verdictBadge(v: string) {
  if (v === "strong_buy") return <Badge className="bg-red-600 text-white text-xs">강력 추천</Badge>;
  if (v === "buy") return <Badge className="bg-green-600 text-white text-xs">추천</Badge>;
  if (v === "watch") return <Badge className="bg-yellow-600 text-white text-xs">관망</Badge>;
  return <Badge variant="outline" className="text-xs">패스</Badge>;
}

function statusBadge(s: string) {
  const m: Record<string, { cls: string; icon: any; label: string }> = {
    pending: { cls: "bg-gray-200 text-gray-700", icon: Clock, label: "대기" },
    crawling_search: { cls: "bg-blue-600 text-white", icon: Loader2, label: "검색 크롤링" },
    filtering: { cls: "bg-purple-600 text-white", icon: Target, label: "필터링" },
    crawling_detail: { cls: "bg-blue-600 text-white", icon: Loader2, label: "상세 크롤링" },
    analyzing: { cls: "bg-orange-600 text-white", icon: Sparkles, label: "AI 분석" },
    completed: { cls: "bg-green-600 text-white", icon: CheckCircle, label: "완료" },
    failed: { cls: "bg-red-600 text-white", icon: XCircle, label: "실패" },
  };
  const x = m[s] || { cls: "bg-gray-200", icon: Clock, label: s };
  const Icon = x.icon;
  const spin = s === "crawling_search" || s === "crawling_detail" ? "animate-spin" : s === "analyzing" ? "animate-pulse" : "";
  return <Badge className={`${x.cls} text-xs`}><Icon className={`w-3 h-3 mr-1 ${spin}`} />{x.label}</Badge>;
}

function scoreBar(score: number, max = 100) {
  const pct = Math.min(score / max * 100, 100);
  const color = pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-yellow-500" : "bg-red-400";
  return (
    <div className="w-full bg-gray-200 rounded-full h-2">
      <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function ProductDiscovery() {
  const [selectedJob, setSelectedJob] = useState<number | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [decisionMemo, setDecisionMemo] = useState("");
  const [tab, setTab] = useState<"discover" | "jobs" | "pending">("discover");

  const overview = trpc.extension.overview.useQuery();
  const discovered = trpc.extension.discoverKeywords.useQuery(undefined, { staleTime: 60000 });
  const jobs = trpc.extension.listJobs.useQuery({ limit: 20 });
  const jobDetail = trpc.extension.getJobDetail.useQuery({ jobId: selectedJob! }, { enabled: !!selectedJob });
  const pendingProducts = trpc.extension.listProducts.useQuery({ decision: "pending", limit: 50 });

  const approve = trpc.extension.approveKeyword.useMutation({
    onSuccess: (_, v) => {
      toast.success(`"${v.keyword}" 검토 승인됨 — 확장프로그램이 자동 크롤링합니다!`);
      discovered.refetch(); jobs.refetch(); overview.refetch();
    },
    onError: e => toast.error(e.message),
  });

  const decide = trpc.extension.decide.useMutation({
    onSuccess: (_, v) => {
      toast.success(v.decision === "track" ? "추적 등록됨" : "거절됨");
      setSelectedProduct(null); setDecisionMemo("");
      jobs.refetch(); jobDetail.refetch(); pendingProducts.refetch(); overview.refetch();
    },
    onError: e => toast.error(e.message),
  });

  const deleteJob = trpc.extension.deleteJob.useMutation({
    onSuccess: () => { toast.success("삭제됨"); setSelectedJob(null); jobs.refetch(); overview.refetch(); },
  });

  const ov = overview.data;
  const keywords = discovered.data || [];
  const jobList = jobs.data || [];
  const detail = jobDetail.data;
  const pending = pendingProducts.data || [];

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
        {/* 헤더 */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Zap className="w-6 h-6 text-yellow-500" />AI 제품 발견
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              AI가 기존 수집 데이터에서 유망 키워드를 자동 발견 → 검토 승인 → 확장프로그램 자동 크롤링 → 상세 분석
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => { discovered.refetch(); jobs.refetch(); overview.refetch(); pendingProducts.refetch(); }}>
            <RefreshCw className="w-4 h-4 mr-1" />새로고침
          </Button>
        </div>

        {/* 요약 */}
        {ov && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: "AI 발견", value: keywords.length, color: "text-yellow-500" },
              { label: "진행 중", value: ov.pendingJobs, color: "text-blue-500" },
              { label: "발견 제품", value: ov.totalProducts, color: "text-green-500" },
              { label: "판단 대기", value: ov.pendingDecision, color: "text-orange-500" },
              { label: "추적 중", value: ov.tracked, color: "text-purple-500" },
            ].map(s => (
              <Card key={s.label}><CardContent className="p-3 text-center">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={`text-xl font-bold ${s.color}`}>{fmt(s.value)}</p>
              </CardContent></Card>
            ))}
          </div>
        )}

        {/* 탭 */}
        <div className="flex gap-1 border-b pb-1">
          {([
            { key: "discover" as const, label: "AI 발견 키워드", count: keywords.length, icon: Sparkles },
            { key: "jobs" as const, label: "크롤링 작업", count: jobList.length, icon: Target },
            { key: "pending" as const, label: "판단 대기", count: pending.length, icon: AlertTriangle },
          ]).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-sm rounded-t flex items-center gap-1.5 transition-colors ${
                tab === t.key ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
              {t.count > 0 && <Badge variant="outline" className="text-[10px] ml-1 py-0">{t.count}</Badge>}
            </button>
          ))}
        </div>

        {/* ═══ 탭 1: AI 발견 키워드 ═══ */}
        {tab === "discover" && (
          <div className="space-y-3">
            {discovered.isLoading ? (
              <div className="text-center py-12 text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />AI가 유망 키워드를 분석 중...
              </div>
            ) : keywords.length === 0 ? (
              <Card><CardContent className="p-8 text-center text-muted-foreground">
                <Sparkles className="w-8 h-8 mx-auto mb-3 text-yellow-400" />
                <p className="font-medium">아직 발견된 키워드가 없습니다</p>
                <p className="text-sm mt-1">확장프로그램으로 키워드를 수집하면 AI가 자동으로 유망 키워드를 찾아냅니다.</p>
              </CardContent></Card>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  AI가 기존 수집 데이터를 분석하여 <strong className="text-foreground">{keywords.length}개</strong>의 유망 키워드를 발견했습니다.
                  "검토" 버튼을 누르면 확장프로그램이 자동으로 쿠팡에서 크롤링합니다.
                </p>
                {keywords.map((kw: any, i: number) => (
                  <Card key={kw.keyword} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-lg font-bold">{kw.keyword}</span>
                            <Badge className={
                              kw.discoveryScore >= 70 ? "bg-green-600 text-white" :
                              kw.discoveryScore >= 50 ? "bg-yellow-600 text-white" :
                              "bg-gray-500 text-white"
                            }>
                              {kw.discoveryScore}점
                            </Badge>
                            {kw.stats?.competitionLevel === "easy" && <Badge className="bg-green-100 text-green-700 text-[10px]">진입 기회</Badge>}
                          </div>

                          {scoreBar(kw.discoveryScore)}

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2 text-xs text-muted-foreground">
                            <span>수요 <strong className="text-foreground">{kw.stats?.demandScore || 0}</strong></span>
                            <span>경쟁 <strong className="text-foreground">{kw.stats?.competitionScore || 0}</strong></span>
                            <span>MA7매출 <strong className="text-foreground">{fmt(kw.stats?.salesEstimateMa7)}</strong></span>
                            <span>평균가 <strong className="text-foreground">{fmt(kw.stats?.avgPrice)}원</strong></span>
                          </div>

                          <div className="flex flex-wrap gap-1 mt-2">
                            {(kw.reasons || []).slice(0, 3).map((r: string, j: number) => (
                              <span key={j} className="text-[11px] px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded">
                                {r}
                              </span>
                            ))}
                          </div>
                        </div>

                        <Button
                          size="sm"
                          className="bg-green-600 hover:bg-green-700 text-white flex-shrink-0"
                          onClick={() => approve.mutate({
                            keyword: kw.keyword,
                            discoveryScore: kw.discoveryScore,
                            reasons: kw.reasons,
                            stats: kw.stats,
                          })}
                          disabled={approve.isPending}
                        >
                          {approve.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4 mr-1" />}
                          검토
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══ 탭 2: 크롤링 작업 ═══ */}
        {tab === "jobs" && (
          <div className="space-y-3">
            {jobList.length === 0 ? (
              <Card><CardContent className="p-8 text-center text-muted-foreground">
                크롤링 작업이 없습니다. AI 발견 탭에서 키워드를 검토하세요.
              </CardContent></Card>
            ) : (
              <>
                <div className="space-y-2">
                  {jobList.map((j: any) => (
                    <Card
                      key={j.id}
                      className={`cursor-pointer hover:bg-muted/50 transition-colors ${selectedJob === j.id ? "ring-2 ring-primary" : ""}`}
                      onClick={() => setSelectedJob(selectedJob === j.id ? null : j.id)}
                    >
                      <CardContent className="p-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {statusBadge(j.status)}
                          <span className="font-medium">{j.keyword}</span>
                          {j.filterCriteria?.selectedCount > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {j.filterCriteria.totalItems || 0}개 중 {j.filterCriteria.selectedCount}개 선별
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {j.detailCrawledCount > 0 && <span>상세 {j.detailCrawledCount}개</span>}
                          {j.createdAt && <span>{String(j.createdAt).slice(5, 16)}</span>}
                          {(j.status === "completed" || j.status === "failed") && (
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
                              onClick={e => { e.stopPropagation(); deleteJob.mutate({ jobId: j.id }); }}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* 작업 상세 */}
                {selectedJob && detail && (
                  <div className="space-y-3">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <Target className="w-5 h-5" /> "{detail.job.keyword}" 분석 결과
                    </h3>

                    {detail.job.aiAnalysisJson && <MarketCard analysis={detail.job.aiAnalysisJson as any} />}

                    {detail.job.errorMessage && (
                      <Card className="border-red-300 bg-red-50"><CardContent className="p-3 text-sm text-red-600">
                        <XCircle className="w-4 h-4 inline mr-1" />{String(detail.job.errorMessage)}
                      </CardContent></Card>
                    )}

                    {detail.products.length > 0 && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {detail.products.map((p: any) => (
                          <ProductCard key={p.id} product={p} onSelect={setSelectedProduct} />
                        ))}
                      </div>
                    )}

                    {detail.job.status === "pending" && (
                      <Card className="bg-blue-50 dark:bg-blue-900/20 border-blue-200">
                        <CardContent className="p-4 text-center">
                          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-500" />
                          <p className="font-medium">확장프로그램 크롤링 대기 중</p>
                          <p className="text-sm text-muted-foreground mt-1">
                            Chrome 확장프로그램이 실행 중이면 자동으로 크롤링이 시작됩니다.
                          </p>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ═══ 탭 3: 판단 대기 ═══ */}
        {tab === "pending" && (
          <div>
            {pending.length === 0 ? (
              <Card><CardContent className="p-8 text-center text-muted-foreground">
                판단 대기 중인 제품이 없습니다.
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
          <ProductDialog
            product={selectedProduct}
            onClose={() => { setSelectedProduct(null); setDecisionMemo(""); }}
            onDecide={(d) => decide.mutate({ productId: selectedProduct.id, decision: d, memo: decisionMemo || undefined })}
            memo={decisionMemo}
            setMemo={setDecisionMemo}
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
      className={`cursor-pointer hover:shadow-md transition-shadow ${
        p.userDecision === "track" ? "border-green-400" : p.userDecision === "reject" ? "border-red-300 opacity-60" : ""
      }`}
      onClick={() => onSelect(p)}
    >
      <CardContent className="p-3">
        <div className="flex gap-3">
          {p.imageUrl && (
            <img src={p.imageUrl} alt="" className="w-14 h-14 object-cover rounded flex-shrink-0"
              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`text-lg font-bold ${gradeColor(p.aiGrade || "D")}`}>{p.aiGrade || "?"}</span>
              <span className="text-sm">{p.aiScore}점</span>
              {verdictBadge(p.aiVerdict)}
              {p.userDecision === "track" && <Badge className="bg-green-600 text-white text-[10px]">추적 중</Badge>}
            </div>
            <p className="text-sm truncate">{p.productTitle}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
              <span>{fmt(p.price)}원</span>
              <span>리뷰 {fmt(p.reviewCount)}</span>
              {p.isRocket && <Rocket className="w-3 h-3 text-blue-500" />}
              {p.searchRank > 0 && <span>#{p.searchRank}</span>}
            </div>
          </div>
        </div>
        {p.aiReasonJson && Array.isArray(p.aiReasonJson) && (
          <div className="mt-1.5 space-y-0.5">
            {(p.aiReasonJson as any[]).slice(0, 2).map((r: any, i: number) => (
              <p key={i} className={`text-[11px] ${r.type === "positive" ? "text-green-600" : r.type === "negative" ? "text-red-500" : "text-muted-foreground"}`}>
                {r.type === "positive" ? "+" : r.type === "negative" ? "-" : "~"} {r.text}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MarketCard({ analysis }: { analysis: any }) {
  const mo = analysis?.marketOverview;
  if (!mo) return null;
  return (
    <Card className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20">
      <CardContent className="p-4">
        <h3 className="font-semibold mb-2 flex items-center gap-2"><TrendingUp className="w-4 h-4" /> 시장 개요</h3>
        <p className="text-sm mb-3">{mo.summary}</p>
        <div className="grid grid-cols-3 gap-3 text-center text-sm">
          <div>
            <p className="text-xs text-muted-foreground">경쟁</p>
            <p className={`font-semibold ${mo.competitionLevel === "low" ? "text-green-600" : mo.competitionLevel === "high" ? "text-red-500" : "text-yellow-600"}`}>
              {mo.competitionLevel === "low" ? "낮음" : mo.competitionLevel === "high" ? "높음" : "보통"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">시장</p>
            <p className="font-semibold">{mo.marketSize === "small" ? "소형" : mo.marketSize === "large" ? "대형" : "중형"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">진입</p>
            <p className={`font-semibold ${mo.entryDifficulty === "easy" ? "text-green-600" : mo.entryDifficulty === "hard" ? "text-red-500" : "text-yellow-600"}`}>
              {mo.entryDifficulty === "easy" ? "쉬움" : mo.entryDifficulty === "hard" ? "어려움" : "보통"}
            </p>
          </div>
        </div>
        {analysis.topRecommendation && (
          <div className="mt-3 p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded text-sm">
            <Star className="w-4 h-4 inline text-yellow-500 mr-1" /><strong>최고 추천:</strong> {analysis.topRecommendation.reason}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProductDialog({ product: p, onClose, onDecide, memo, setMemo, isDeciding }: {
  product: any; onClose: () => void; onDecide: (d: "track" | "reject") => void;
  memo: string; setMemo: (v: string) => void; isDeciding: boolean;
}) {
  const reasons = (p.aiReasonJson || []) as any[];
  const risks = (p.aiRiskJson || []) as any[];
  const opps = (p.aiOpportunityJson || []) as any[];

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className={`text-2xl font-bold ${gradeColor(p.aiGrade || "D")}`}>{p.aiGrade}</span>
            <span>{p.aiScore}점</span>
            {verdictBadge(p.aiVerdict)}
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-4">
          {p.imageUrl && <img src={p.imageUrl} alt="" className="w-24 h-24 object-cover rounded"
            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />}
          <div className="flex-1">
            <p className="font-medium">{p.productTitle}</p>
            <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
              <div><span className="text-muted-foreground">가격:</span> {fmt(p.price)}원</div>
              <div><span className="text-muted-foreground">리뷰:</span> {fmt(p.reviewCount)}</div>
              <div><span className="text-muted-foreground">평점:</span> {Number(p.rating).toFixed(1)}</div>
              <div><span className="text-muted-foreground">순위:</span> #{p.searchRank || "-"}</div>
              {p.sellerName && <div><span className="text-muted-foreground">판매자:</span> {p.sellerName}</div>}
              {p.deliveryType && <div><span className="text-muted-foreground">배송:</span> {p.deliveryType}</div>}
            </div>
          </div>
        </div>

        {reasons.length > 0 && (
          <div>
            <h4 className="font-semibold text-sm mb-2 flex items-center gap-1"><Lightbulb className="w-4 h-4 text-yellow-500" /> 분석 근거</h4>
            <div className="space-y-1">
              {reasons.map((r: any, i: number) => (
                <div key={i} className={`text-sm p-2 rounded ${
                  r.type === "positive" ? "bg-green-50 dark:bg-green-900/20 text-green-700" :
                  r.type === "negative" ? "bg-red-50 dark:bg-red-900/20 text-red-700" : "bg-gray-50 text-muted-foreground"
                }`}>
                  {r.type === "positive" ? <CheckCircle className="w-3 h-3 inline mr-1" /> : r.type === "negative" ? <XCircle className="w-3 h-3 inline mr-1" /> : null}
                  {r.text}
                </div>
              ))}
            </div>
          </div>
        )}

        {risks.length > 0 && (
          <div>
            <h4 className="font-semibold text-sm mb-2 flex items-center gap-1"><ShieldAlert className="w-4 h-4 text-red-500" /> 리스크</h4>
            {risks.map((r: any, i: number) => (
              <div key={i} className="text-sm p-2 rounded bg-red-50 dark:bg-red-900/20 mb-1">
                <Badge variant="outline" className={`text-[10px] mr-1 py-0 ${r.level === "high" ? "border-red-400 text-red-500" : "border-yellow-400 text-yellow-600"}`}>
                  {r.level === "high" ? "높음" : r.level === "medium" ? "보통" : "낮음"}
                </Badge>{r.text}
              </div>
            ))}
          </div>
        )}

        {opps.length > 0 && (
          <div>
            <h4 className="font-semibold text-sm mb-2 flex items-center gap-1"><Sparkles className="w-4 h-4 text-purple-500" /> 기회</h4>
            {opps.map((o: any, i: number) => (
              <div key={i} className="text-sm p-2 rounded bg-purple-50 dark:bg-purple-900/20 mb-1">
                <Sparkles className="w-3 h-3 inline mr-1 text-purple-500" />{o.text}
              </div>
            ))}
          </div>
        )}

        {p.userDecision === "pending" && (
          <div className="space-y-3 pt-2 border-t">
            <Textarea placeholder="메모 (선택)" value={memo} onChange={e => setMemo(e.target.value)} rows={2} />
            <div className="flex gap-2">
              <Button className="flex-1 bg-green-600 hover:bg-green-700" onClick={() => onDecide("track")} disabled={isDeciding}>
                {isDeciding ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ThumbsUp className="w-4 h-4 mr-1" />}매일 추적
              </Button>
              <Button variant="outline" className="flex-1 text-red-500 border-red-300" onClick={() => onDecide("reject")} disabled={isDeciding}>
                <ThumbsDown className="w-4 h-4 mr-1" />거절
              </Button>
            </div>
          </div>
        )}

        {p.userDecision !== "pending" && (
          <div className="pt-2 border-t text-sm text-muted-foreground">
            {p.userDecision === "track"
              ? <p><CheckCircle className="w-4 h-4 inline text-green-500 mr-1" />추적 등록됨</p>
              : <p><XCircle className="w-4 h-4 inline text-red-400 mr-1" />거절됨</p>}
            {p.userMemo && <p className="mt-1">메모: {p.userMemo}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
