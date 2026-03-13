import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Search, Loader2, Zap, ThumbsUp, ThumbsDown, Eye,
  RefreshCw, CheckCircle, XCircle, Clock, Star, ArrowRight,
  TrendingUp, AlertTriangle, Lightbulb, Target, Sparkles,
  BarChart3, Rocket, ShieldAlert, Package, Trash2,
} from "lucide-react";
import { toast } from "sonner";

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
  if (v === "pass") return <Badge variant="outline" className="text-xs">패스</Badge>;
  return null;
}
function statusBadge(s: string) {
  if (s === "pending") return <Badge variant="outline" className="text-xs"><Clock className="w-3 h-3 mr-1" />대기</Badge>;
  if (s === "crawling_search") return <Badge className="bg-blue-600 text-white text-xs"><Loader2 className="w-3 h-3 mr-1 animate-spin" />검색 크롤링</Badge>;
  if (s === "filtering") return <Badge className="bg-purple-600 text-white text-xs"><Target className="w-3 h-3 mr-1" />필터링</Badge>;
  if (s === "crawling_detail") return <Badge className="bg-blue-600 text-white text-xs"><Loader2 className="w-3 h-3 mr-1 animate-spin" />상세 크롤링</Badge>;
  if (s === "analyzing") return <Badge className="bg-orange-600 text-white text-xs"><Sparkles className="w-3 h-3 mr-1 animate-pulse" />AI 분석</Badge>;
  if (s === "completed") return <Badge className="bg-green-600 text-white text-xs"><CheckCircle className="w-3 h-3 mr-1" />완료</Badge>;
  if (s === "failed") return <Badge className="bg-red-600 text-white text-xs"><XCircle className="w-3 h-3 mr-1" />실패</Badge>;
  return <Badge variant="outline" className="text-xs">{s}</Badge>;
}

export default function ProductDiscovery() {
  const [selectedJob, setSelectedJob] = useState<number | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [decisionMemo, setDecisionMemo] = useState("");
  const [manualKw, setManualKw] = useState("");
  const [tab, setTab] = useState<"discover" | "jobs" | "pending">("discover");

  const overview = trpc.extension.overview.useQuery();
  const discovered = trpc.extension.discoverKeywords.useQuery(undefined, { staleTime: 60_000 });
  const jobs = trpc.extension.listJobs.useQuery({ limit: 20 });
  const jobDetail = trpc.extension.getJobDetail.useQuery({ jobId: selectedJob! }, { enabled: !!selectedJob });
  const pendingProducts = trpc.extension.listProducts.useQuery({ decision: "pending", limit: 50 });

  const approve = trpc.extension.approveKeyword.useMutation({
    onSuccess: (_, v) => { toast.success(`"${v.keyword}" 검토 승인 — 확장프로그램이 자동 크롤링을 시작합니다`); discovered.refetch(); jobs.refetch(); overview.refetch(); },
    onError: e => toast.error(e.message),
  });
  const createJob = trpc.extension.createJob.useMutation({
    onSuccess: () => { toast.success("수동 분석 작업 생성됨"); setManualKw(""); jobs.refetch(); overview.refetch(); },
    onError: e => toast.error(e.message),
  });
  const decide = trpc.extension.decide.useMutation({
    onSuccess: (_, v) => { toast.success(v.decision === "track" ? "추적 등록됨" : "거절됨"); setSelectedProduct(null); setDecisionMemo(""); jobs.refetch(); jobDetail.refetch(); pendingProducts.refetch(); overview.refetch(); },
    onError: e => toast.error(e.message),
  });
  const deleteJob = trpc.extension.deleteJob.useMutation({
    onSuccess: () => { toast.success("삭제됨"); setSelectedJob(null); jobs.refetch(); overview.refetch(); },
    onError: e => toast.error(e.message),
  });

  const ov = overview.data;
  const kwList = discovered.data || [];
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
              <Zap className="w-6 h-6 text-yellow-500" /> AI 제품 발견
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              AI가 기존 크롤링 데이터에서 유망 키워드를 자동 발견 → 검토 승인 → 확장프로그램이 자동 크롤링
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
              { label: "AI 발견", value: kwList.length, color: "text-yellow-500" },
              { label: "진행 중", value: ov.pendingJobs, color: "text-blue-500" },
              { label: "발견 제품", value: ov.totalProducts, color: "text-green-500" },
              { label: "판단 대기", value: ov.pendingDecision, color: "text-orange-500" },
              { label: "추적 중", value: ov.tracked, color: "text-purple-500" },
            ].map((s, i) => (
              <Card key={i}><CardContent className="p-3 text-center">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={`text-xl font-bold ${s.color}`}>{fmt(s.value)}</p>
              </CardContent></Card>
            ))}
          </div>
        )}

        {/* 탭 네비 */}
        <div className="flex gap-2 border-b pb-2">
          {([
            { key: "discover", label: `AI 발견 키워드 (${kwList.length})`, icon: Sparkles },
            { key: "jobs", label: `크롤링 작업 (${jobList.length})`, icon: BarChart3 },
            { key: "pending", label: `판단 대기 (${pending.length})`, icon: AlertTriangle },
          ] as const).map(t => (
            <Button key={t.key} variant={tab === t.key ? "default" : "ghost"} size="sm" onClick={() => setTab(t.key)}>
              <t.icon className="w-4 h-4 mr-1" />{t.label}
            </Button>
          ))}
        </div>

        {/* ★ 탭 1: AI 발견 키워드 */}
        {tab === "discover" && (
          <div className="space-y-4">
            {discovered.isLoading ? (
              <Card><CardContent className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />AI가 크롤링 데이터에서 유망 키워드를 분석 중...</CardContent></Card>
            ) : kwList.length === 0 ? (
              <Card><CardContent className="p-8 text-center text-muted-foreground">
                <Sparkles className="w-8 h-8 mx-auto mb-3 text-yellow-500" />
                <p className="font-medium">발견된 유망 키워드가 없습니다</p>
                <p className="text-sm mt-1">검색 수요 분석 페이지에서 키워드를 더 등록하고 데이터를 수집하세요.</p>
                <p className="text-xs mt-2 text-muted-foreground">최소 2일 이상 확정 데이터가 필요합니다</p>
              </CardContent></Card>
            ) : (
              <div className="space-y-2">
                {kwList.map((kw: any, idx: number) => (
                  <Card key={kw.keyword} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-lg font-bold text-yellow-600">#{idx + 1}</span>
                            <span className="font-semibold text-base">{kw.keyword}</span>
                            <Badge className="bg-yellow-100 text-yellow-800 text-xs">{kw.discoveryScore}점</Badge>
                          </div>
                          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                            <span>수요 <strong className="text-green-600">{kw.demandScore}</strong></span>
                            <span>종합 <strong className="text-blue-600">{kw.keywordScore}</strong></span>
                            <span>경쟁 <strong className={kw.competitionScore <= 40 ? "text-green-600" : kw.competitionScore >= 70 ? "text-red-500" : "text-yellow-600"}>{kw.competitionScore}</strong></span>
                            <span>MA7 <strong>{fmt(kw.salesMa7)}</strong>개</span>
                            <span>리뷰+{kw.reviewGrowth}/일</span>
                            <span>평균가 {fmt(kw.avgPrice)}원</span>
                            <span>상품 {fmt(kw.avgProductCount)}개</span>
                          </div>
                          {kw.reasons.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {kw.reasons.map((r: string, i: number) => (
                                <Badge key={i} variant="outline" className="text-[10px] text-green-700 border-green-300 bg-green-50">{r}</Badge>
                              ))}
                            </div>
                          )}
                        </div>
                        <Button
                          className="bg-green-600 hover:bg-green-700 flex-shrink-0"
                          onClick={() => approve.mutate({ keyword: kw.keyword })}
                          disabled={approve.isPending}
                        >
                          {approve.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle className="w-4 h-4 mr-1" />}
                          검토 승인
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* 수동 입력 */}
            <Card className="border-dashed">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-2">직접 키워드 입력 (수동)</p>
                <div className="flex gap-2">
                  <Input placeholder="분석할 키워드 입력..." value={manualKw} onChange={e => setManualKw(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && manualKw.trim()) createJob.mutate({ keyword: manualKw.trim() }); }} />
                  <Button variant="outline" onClick={() => { if (manualKw.trim()) createJob.mutate({ keyword: manualKw.trim() }); }}
                    disabled={!manualKw.trim() || createJob.isPending}>
                    {createJob.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ★ 탭 2: 크롤링 작업 */}
        {tab === "jobs" && (
          <div className="space-y-4">
            {jobList.length === 0 ? (
              <Card><CardContent className="p-8 text-center text-muted-foreground">
                아직 크롤링 작업이 없습니다. AI 발견 탭에서 키워드를 승인하세요.
              </CardContent></Card>
            ) : (
              <div className="space-y-2">
                {jobList.map((j: any) => (
                  <Card key={j.id} className={`cursor-pointer hover:bg-muted/50 ${selectedJob === j.id ? "ring-2 ring-primary" : ""}`}
                    onClick={() => setSelectedJob(selectedJob === j.id ? null : j.id)}>
                    <CardContent className="p-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {statusBadge(j.status)}
                        <span className="font-medium">{j.keyword}</span>
                        {j.filterCriteria && <span className="text-xs text-muted-foreground">{(j.filterCriteria as any)?.totalItems || 0}개 중 {(j.filterCriteria as any)?.selectedCount || 0}개 선별</span>}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {j.detailCrawledCount > 0 && <span>상세 {j.detailCrawledCount}개</span>}
                        {j.createdAt && <span>{String(j.createdAt).slice(5, 16)}</span>}
                        {(j.status === "completed" || j.status === "failed") && (
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={e => { e.stopPropagation(); deleteJob.mutate({ jobId: j.id }); }}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* 선택 작업 상세 */}
            {selectedJob && detail && (
              <div className="space-y-3">
                <h2 className="text-lg font-semibold flex items-center gap-2"><Target className="w-5 h-5" />"{detail.job.keyword}" 분석 결과</h2>
                {detail.job.aiAnalysisJson && <MarketOverview analysis={detail.job.aiAnalysisJson as any} />}
                {detail.job.errorMessage && (
                  <Card className="border-red-300 bg-red-50"><CardContent className="p-3 text-sm text-red-600"><XCircle className="w-4 h-4 inline mr-1" />{String(detail.job.errorMessage)}</CardContent></Card>
                )}
                {detail.products.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {detail.products.map((p: any) => <ProductCard key={p.id} p={p} onSelect={setSelectedProduct} />)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ★ 탭 3: 판단 대기 */}
        {tab === "pending" && (
          <div>
            {pending.length === 0 ? (
              <Card><CardContent className="p-8 text-center text-muted-foreground">판단 대기 제품이 없습니다.</CardContent></Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {pending.map((p: any) => <ProductCard key={p.id} p={p} onSelect={setSelectedProduct} />)}
              </div>
            )}
          </div>
        )}

        {/* 제품 상세 다이얼로그 */}
        {selectedProduct && (
          <ProductDetailDialog product={selectedProduct}
            onClose={() => { setSelectedProduct(null); setDecisionMemo(""); }}
            onDecide={d => decide.mutate({ productId: selectedProduct.id, decision: d, memo: decisionMemo || undefined })}
            memo={decisionMemo} setMemo={setDecisionMemo} deciding={decide.isPending} />
        )}
      </div>
    </DashboardLayout>
  );
}

// ==== 서브 컴포넌트 ====

function ProductCard({ p, onSelect }: { p: any; onSelect: (p: any) => void }) {
  return (
    <Card className={`cursor-pointer hover:shadow-md ${p.userDecision === "track" ? "border-green-400" : p.userDecision === "reject" ? "border-red-300 opacity-60" : ""}`}
      onClick={() => onSelect(p)}>
      <CardContent className="p-3">
        <div className="flex gap-3">
          {p.imageUrl && <img src={p.imageUrl} alt="" className="w-16 h-16 object-cover rounded flex-shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-lg font-bold ${gradeColor(p.aiGrade || "D")}`}>{p.aiGrade || "?"}</span>
              <span className="text-sm font-medium">{p.aiScore}점</span>
              {verdictBadge(p.aiVerdict)}
              {p.userDecision === "track" && <Badge className="bg-green-600 text-white text-xs">추적</Badge>}
              {p.userDecision === "reject" && <Badge variant="outline" className="text-xs text-red-500">거절</Badge>}
            </div>
            <p className="text-sm truncate">{p.productTitle}</p>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
              <span>{fmt(p.price)}원</span>
              <span>리뷰 {fmt(p.reviewCount)}</span>
              {p.rating > 0 && <span>{Number(p.rating).toFixed(1)}점</span>}
              {p.isRocket && <Badge variant="outline" className="text-[10px] py-0">로켓</Badge>}
              {p.searchRank > 0 && <span>#{p.searchRank}</span>}
            </div>
          </div>
        </div>
        {p.aiReasonJson?.length > 0 && (
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

function MarketOverview({ analysis }: { analysis: any }) {
  const mo = analysis?.marketOverview;
  if (!mo) return null;
  return (
    <Card className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20">
      <CardContent className="p-4">
        <h3 className="font-semibold mb-2 flex items-center gap-2"><TrendingUp className="w-4 h-4" /> 시장 개요</h3>
        <p className="text-sm mb-3">{mo.summary}</p>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div><p className="text-xs text-muted-foreground">경쟁</p><p className={`font-semibold ${mo.competitionLevel === "low" ? "text-green-600" : mo.competitionLevel === "high" ? "text-red-500" : "text-yellow-600"}`}>{mo.competitionLevel === "low" ? "낮음" : mo.competitionLevel === "high" ? "높음" : "보통"}</p></div>
          <div><p className="text-xs text-muted-foreground">규모</p><p className="font-semibold">{mo.marketSize === "small" ? "소형" : mo.marketSize === "large" ? "대형" : "중형"}</p></div>
          <div><p className="text-xs text-muted-foreground">진입</p><p className={`font-semibold ${mo.entryDifficulty === "easy" ? "text-green-600" : mo.entryDifficulty === "hard" ? "text-red-500" : "text-yellow-600"}`}>{mo.entryDifficulty === "easy" ? "쉬움" : mo.entryDifficulty === "hard" ? "어려움" : "보통"}</p></div>
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

function ProductDetailDialog({ product: p, onClose, onDecide, memo, setMemo, deciding }: {
  product: any; onClose: () => void; onDecide: (d: "track" | "reject") => void;
  memo: string; setMemo: (v: string) => void; deciding: boolean;
}) {
  const reasons = (p.aiReasonJson || []) as any[];
  const risks = (p.aiRiskJson || []) as any[];
  const opps = (p.aiOpportunityJson || []) as any[];
  const detail = p.detailDataJson as any;

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className={`text-2xl font-bold ${gradeColor(p.aiGrade || "D")}`}>{p.aiGrade}</span>
            <span>{p.aiScore}점</span>{verdictBadge(p.aiVerdict)}
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-4">
          {p.imageUrl && <img src={p.imageUrl} alt="" className="w-24 h-24 object-cover rounded" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />}
          <div className="flex-1">
            <p className="font-medium">{p.productTitle}</p>
            <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
              <div><span className="text-muted-foreground">가격:</span> {fmt(p.price)}원</div>
              <div><span className="text-muted-foreground">리뷰:</span> {fmt(p.reviewCount)}개</div>
              <div><span className="text-muted-foreground">평점:</span> {Number(p.rating).toFixed(1)}</div>
              <div><span className="text-muted-foreground">순위:</span> #{p.searchRank || "-"}</div>
              {p.sellerName && <div><span className="text-muted-foreground">판매자:</span> {p.sellerName}</div>}
              {p.deliveryType && <div><span className="text-muted-foreground">배송:</span> {p.deliveryType}</div>}
              {p.estimatedMonthlySales > 0 && <div><span className="text-muted-foreground">월매출:</span> {fmt(p.estimatedMonthlySales)}개</div>}
              {Number(p.estimatedMarginPercent) > 0 && <div><span className="text-muted-foreground">마진:</span> {Number(p.estimatedMarginPercent).toFixed(0)}%</div>}
            </div>
          </div>
        </div>

        {/* 상세 크롤링 데이터 */}
        {detail && (
          <div className="bg-gray-50 dark:bg-gray-800 rounded p-3 space-y-2">
            <h4 className="font-semibold text-sm flex items-center gap-1"><Package className="w-4 h-4" /> 크롤링 상세 데이터</h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {detail.categoryPath && <div className="col-span-2"><span className="text-muted-foreground">카테고리:</span> {detail.categoryPath}</div>}
              {detail.brandName && <div><span className="text-muted-foreground">브랜드:</span> {detail.brandName}</div>}
              {detail.manufacturer && <div><span className="text-muted-foreground">제조사:</span> {detail.manufacturer}</div>}
              {detail.optionCount > 0 && <div><span className="text-muted-foreground">옵션:</span> {detail.optionCount}개</div>}
              {detail.originalPrice > 0 && <div><span className="text-muted-foreground">원가:</span> {fmt(detail.originalPrice)}원</div>}
            </div>
            {detail.reviewSamples?.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-medium mb-1">리뷰 샘플:</p>
                {detail.reviewSamples.slice(0, 3).map((r: any, i: number) => (
                  <p key={i} className="text-xs text-muted-foreground">{"★".repeat(r.rating || 0)} {r.text}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {reasons.length > 0 && (
          <div>
            <h4 className="font-semibold text-sm mb-2 flex items-center gap-1"><Lightbulb className="w-4 h-4 text-yellow-500" /> 분석 근거</h4>
            <div className="space-y-1">
              {reasons.map((r: any, i: number) => (
                <div key={i} className={`text-sm p-2 rounded ${r.type === "positive" ? "bg-green-50 text-green-700" : r.type === "negative" ? "bg-red-50 text-red-700" : "bg-gray-50 text-muted-foreground"}`}>
                  {r.type === "positive" ? <CheckCircle className="w-3 h-3 inline mr-1" /> : r.type === "negative" ? <XCircle className="w-3 h-3 inline mr-1" /> : <ArrowRight className="w-3 h-3 inline mr-1" />}
                  {r.category && <Badge variant="outline" className="text-[10px] mr-1 py-0">{r.category}</Badge>}{r.text}
                </div>
              ))}
            </div>
          </div>
        )}

        {risks.length > 0 && (
          <div>
            <h4 className="font-semibold text-sm mb-2 flex items-center gap-1"><ShieldAlert className="w-4 h-4 text-red-500" /> 리스크</h4>
            {risks.map((r: any, i: number) => (
              <div key={i} className="text-sm p-2 rounded bg-red-50 mb-1">
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
              <div key={i} className="text-sm p-2 rounded bg-purple-50 mb-1"><Sparkles className="w-3 h-3 inline mr-1 text-purple-500" />{o.text}</div>
            ))}
          </div>
        )}

        {p.userDecision === "pending" && (
          <div className="space-y-3 pt-2 border-t">
            <Textarea placeholder="메모 (선택)" value={memo} onChange={e => setMemo(e.target.value)} rows={2} />
            <div className="flex gap-2">
              <Button className="flex-1 bg-green-600 hover:bg-green-700" onClick={() => onDecide("track")} disabled={deciding}>
                {deciding ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ThumbsUp className="w-4 h-4 mr-1" />}매일 추적
              </Button>
              <Button variant="outline" className="flex-1 text-red-500 border-red-300 hover:bg-red-50" onClick={() => onDecide("reject")} disabled={deciding}>
                {deciding ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ThumbsDown className="w-4 h-4 mr-1" />}거절
              </Button>
            </div>
          </div>
        )}

        {p.userDecision !== "pending" && (
          <div className="pt-2 border-t text-sm text-muted-foreground">
            {p.userDecision === "track" ? <p><CheckCircle className="w-4 h-4 inline text-green-500 mr-1" />추적 등록됨</p> : <p><XCircle className="w-4 h-4 inline text-red-400 mr-1" />거절됨</p>}
            {p.userMemo && <p className="mt-1">메모: {p.userMemo}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
