import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { calibrateSales } from "@/lib/salesCalibration";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Search, Gem, TrendingUp, Sparkles, Loader2, Plus,
  AlertCircle, Zap, ThumbsUp, ThumbsDown, Eye, Trash2,
  RefreshCw, CheckCircle, XCircle, Clock, Star, ArrowRight,
} from "lucide-react";
import { toast } from "sonner";

type MainTab = "candidates" | "validated" | "recommended";

function formatNum(n: number | null | undefined) {
  if (n === null || n === undefined || n === 0) return "-";
  return n.toLocaleString("ko-KR");
}

function gradeColor(score: number): string {
  if (score >= 80) return "text-yellow-500";
  if (score >= 60) return "text-green-500";
  if (score >= 40) return "text-blue-500";
  if (score >= 20) return "text-gray-500";
  return "text-red-400";
}

function gradeBadge(score: number): string {
  if (score >= 80) return "S";
  if (score >= 60) return "A";
  if (score >= 40) return "B";
  if (score >= 20) return "C";
  return "D";
}

function statusBadge(status: string) {
  switch (status) {
    case "pending": return <Badge variant="outline" className="text-xs"><Clock className="w-3 h-3 mr-1" />대기</Badge>;
    case "validated": return <Badge className="bg-green-600 text-xs"><CheckCircle className="w-3 h-3 mr-1" />검증됨</Badge>;
    case "rejected": return <Badge variant="destructive" className="text-xs"><XCircle className="w-3 h-3 mr-1" />탈락</Badge>;
    case "recommended": return <Badge className="bg-purple-600 text-xs"><Star className="w-3 h-3 mr-1" />추천</Badge>;
    default: return <Badge variant="outline" className="text-xs">{status}</Badge>;
  }
}

export default function NicheFinder() {
  const [tab, setTab] = useState<MainTab>("candidates");
  const [searchText, setSearchText] = useState("");
  const [manualInput, setManualInput] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [detailKeyword, setDetailKeyword] = useState<any>(null);
  const [page, setPage] = useState(1);
  const perPage = 30;

  // API calls
  const overview = trpc.keywordDiscovery.overview.useQuery();
  const naverConfig = trpc.keywordDiscovery.checkNaverApiConfig.useQuery();

  const candidatesQuery = trpc.keywordDiscovery.listCandidates.useQuery({
    search: searchText,
    status: tab === "candidates" ? "pending" : tab === "validated" ? "validated" : "recommended",
    sortBy: "priority",
    sortDir: "desc",
    page,
    perPage,
  });

  const validationQueue = trpc.keywordDiscovery.getValidationQueue.useQuery({ limit: 20 });

  const validateMutation = trpc.keywordDiscovery.validateWithNaver.useMutation({
    onSuccess: data => {
      toast.success(`검증 완료: ${data.validated}건 통과, ${data.rejected}건 탈락, ${data.recommendedInserted}건 추천`);
      candidatesQuery.refetch();
      overview.refetch();
      validationQueue.refetch();
      setSelectedIds([]);
    },
    onError: err => toast.error(`검증 실패: ${err.message}`),
  });

  const addManualMutation = trpc.keywordDiscovery.addManualKeywords.useMutation({
    onSuccess: data => {
      toast.success(`${data.inserted}건 등록 완료`);
      setManualInput("");
      candidatesQuery.refetch();
      overview.refetch();
    },
    onError: err => toast.error(`등록 실패: ${err.message}`),
  });

  const acceptMutation = trpc.keywordDiscovery.acceptRecommendation.useMutation({
    onSuccess: () => {
      toast.success("추천 키워드를 후보로 전환했습니다");
      candidatesQuery.refetch();
      overview.refetch();
      setSelectedIds([]);
    },
  });

  const promoteMutation = trpc.keywordDiscovery.promoteToWatch.useMutation({
    onSuccess: data => {
      toast.success(`${data.promoted}건 감시 목록에 추가`);
      setSelectedIds([]);
    },
  });

  const deleteMutation = trpc.keywordDiscovery.deleteKeywords.useMutation({
    onSuccess: () => {
      toast.success("삭제 완료");
      candidatesQuery.refetch();
      overview.refetch();
      setSelectedIds([]);
    },
  });

  const cleanExpiredMutation = trpc.keywordDiscovery.cleanExpiredRecommendations.useMutation({
    onSuccess: data => {
      toast.success(`만료된 추천 ${data.deleted}건 정리 완료`);
      candidatesQuery.refetch();
      overview.refetch();
    },
  });

  const items = candidatesQuery.data?.items || [];
  const totalPages = candidatesQuery.data?.totalPages || 1;
  const totalItems = candidatesQuery.data?.total || 0;
  const isLoading = candidatesQuery.isLoading;

  function toggleSelect(id: number) {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    );
  }

  function selectAll() {
    if (selectedIds.length === items.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(items.map(i => i.id));
    }
  }

  function handleAddManual() {
    const keywords = manualInput.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    if (!keywords.length) return;
    addManualMutation.mutate({ keywords });
  }

  function handleValidateSelected() {
    if (!selectedIds.length) {
      toast.error("검증할 키워드를 선택하세요");
      return;
    }
    validateMutation.mutate({ keywordIds: selectedIds });
  }

  function handleValidateQueue() {
    const queueIds = validationQueue.data?.map(k => k.id) || [];
    if (!queueIds.length) {
      toast.error("검증 대기 중인 키워드가 없습니다");
      return;
    }
    validateMutation.mutate({ keywordIds: queueIds.slice(0, 20) });
  }

  const stats = overview.data;

  return (
    <DashboardLayout>
      <div className="space-y-4">
        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Gem className="w-6 h-6 text-purple-500" />
              니치파인더
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              쿠팡 후보 키워드 → 네이버 검증 → 추천 관리
            </p>
          </div>

          {/* 네이버 API 상태 */}
          {naverConfig.data && (
            <Badge variant={naverConfig.data.configured ? "default" : "destructive"} className="text-xs">
              {naverConfig.data.configured ? "네이버 API 연결됨" : "네이버 API 미설정"}
            </Badge>
          )}
        </div>

        {/* 요약 카드 */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card className="cursor-pointer hover:border-primary" onClick={() => setTab("candidates")}>
              <CardContent className="p-3 text-center">
                <div className="text-2xl font-bold">{stats.totalKeywords}</div>
                <div className="text-xs text-muted-foreground">전체</div>
              </CardContent>
            </Card>
            <Card className="cursor-pointer hover:border-primary" onClick={() => setTab("candidates")}>
              <CardContent className="p-3 text-center">
                <div className="text-2xl font-bold text-yellow-500">{stats.pendingCount}</div>
                <div className="text-xs text-muted-foreground">대기중</div>
              </CardContent>
            </Card>
            <Card className="cursor-pointer hover:border-primary" onClick={() => setTab("validated")}>
              <CardContent className="p-3 text-center">
                <div className="text-2xl font-bold text-green-500">{stats.validatedCount}</div>
                <div className="text-xs text-muted-foreground">검증됨</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <div className="text-2xl font-bold text-red-400">{stats.rejectedCount}</div>
                <div className="text-xs text-muted-foreground">탈락</div>
              </CardContent>
            </Card>
            <Card className="cursor-pointer hover:border-primary" onClick={() => setTab("recommended")}>
              <CardContent className="p-3 text-center">
                <div className="text-2xl font-bold text-purple-500">{stats.recommendedCount}</div>
                <div className="text-xs text-muted-foreground">추천</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 탭 */}
        <div className="flex gap-2 border-b pb-2">
          {([
            { key: "candidates", label: "후보 (대기)", icon: Clock },
            { key: "validated", label: "검증 완료", icon: CheckCircle },
            { key: "recommended", label: "추천 키워드", icon: Star },
          ] as const).map(t => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setSelectedIds([]); setPage(1); }}
              className={`px-4 py-2 rounded-t text-sm font-medium flex items-center gap-1.5 transition-colors ${
                tab === t.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        {/* 액션 바 */}
        <div className="flex flex-wrap items-center gap-2">
          {/* 검색 */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="키워드 검색..."
              value={searchText}
              onChange={e => { setSearchText(e.target.value); setPage(1); }}
              className="pl-9 h-9"
            />
          </div>

          {/* 수동 추가 */}
          {tab === "candidates" && (
            <div className="flex items-center gap-1">
              <Input
                placeholder="키워드 직접 추가 (콤마 구분)"
                value={manualInput}
                onChange={e => setManualInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAddManual()}
                className="h-9 w-60"
              />
              <Button size="sm" variant="outline" onClick={handleAddManual} disabled={addManualMutation.isPending}>
                <Plus className="w-3.5 h-3.5 mr-1" />추가
              </Button>
            </div>
          )}

          {/* 선택 액션 */}
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-1">
              <Badge variant="secondary" className="text-xs">{selectedIds.length}건 선택</Badge>
              {tab === "candidates" && (
                <Button
                  size="sm"
                  onClick={handleValidateSelected}
                  disabled={validateMutation.isPending}
                >
                  {validateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Zap className="w-3.5 h-3.5 mr-1" />}
                  네이버 검증
                </Button>
              )}
              {tab === "validated" && (
                <Button
                  size="sm"
                  onClick={() => promoteMutation.mutate({ keywordIds: selectedIds })}
                  disabled={promoteMutation.isPending}
                >
                  <Eye className="w-3.5 h-3.5 mr-1" />감시 추가
                </Button>
              )}
              {tab === "recommended" && (
                <Button
                  size="sm"
                  onClick={() => acceptMutation.mutate({ keywordIds: selectedIds })}
                  disabled={acceptMutation.isPending}
                >
                  <ThumbsUp className="w-3.5 h-3.5 mr-1" />수락
                </Button>
              )}
              <Button
                size="sm"
                variant="destructive"
                onClick={() => deleteMutation.mutate({ ids: selectedIds })}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" />삭제
              </Button>
            </div>
          )}

          <div className="ml-auto flex gap-1">
            {tab === "candidates" && (
              <Button
                size="sm"
                variant="default"
                onClick={handleValidateQueue}
                disabled={validateMutation.isPending || !validationQueue.data?.length}
              >
                {validateMutation.isPending
                  ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                  : <Sparkles className="w-3.5 h-3.5 mr-1" />}
                자동 검증 ({validationQueue.data?.length || 0}건)
              </Button>
            )}
            {tab === "recommended" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => cleanExpiredMutation.mutate()}
                disabled={cleanExpiredMutation.isPending}
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1" />만료 정리
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => { selectAll(); }}>
              {selectedIds.length === items.length ? "선택 해제" : "전체 선택"}
            </Button>
          </div>
        </div>

        {/* 키워드 목록 */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
              {tab === "candidates" && "대기 중인 후보 키워드가 없습니다. 위에서 직접 추가하거나 크롬 익스텐션으로 수집하세요."}
              {tab === "validated" && "검증 완료된 키워드가 없습니다. 후보 탭에서 네이버 검증을 실행하세요."}
              {tab === "recommended" && "추천 키워드가 없습니다. 검증 시 네이버 연관 키워드가 자동 추천됩니다."}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {items.map(item => {
              const m = item.metrics;
              const finalScore = Number(m?.finalScore || 0);
              const coupangScore = Number(m?.coupangBaseScore || 0);
              const naverScore = Number(m?.naverValidationScore || 0);
              const totalSearch = m?.naverTotalSearch || 0;

              // 클라이언트 보정
              const cal = m ? calibrateSales({
                reviewDelta: m.coupangTop10ReviewDelta || 0,
                productCount: m.coupangProductCount || 0,
                avgPrice: m.coupangAvgPrice || 0,
                categoryHint: item.categoryHint || undefined,
                naverTotalSearch: totalSearch,
                naverCompetition: m.naverCompetitionIndex || undefined,
              }) : null;

              const selected = selectedIds.includes(item.id);

              return (
                <Card
                  key={item.id}
                  className={`transition-all cursor-pointer ${selected ? "border-primary bg-primary/5" : "hover:border-muted-foreground/30"}`}
                  onClick={() => toggleSelect(item.id)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center gap-3">
                      {/* 체크박스 영역 */}
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                        selected ? "border-primary bg-primary text-white" : "border-muted-foreground/30"
                      }`}>
                        {selected && <CheckCircle className="w-3.5 h-3.5" />}
                      </div>

                      {/* 점수 */}
                      <div className="text-center flex-shrink-0 w-12">
                        <div className={`text-lg font-bold ${gradeColor(finalScore)}`}>
                          {gradeBadge(finalScore)}
                        </div>
                        <div className="text-[10px] text-muted-foreground">{finalScore.toFixed(0)}점</div>
                      </div>

                      {/* 키워드 + 상태 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{item.keyword}</span>
                          {statusBadge(item.validationStatus)}
                          {item.sourceType === "extension" && <Badge variant="outline" className="text-[10px]">EXT</Badge>}
                          {item.sourceType === "manual" && <Badge variant="outline" className="text-[10px]">수동</Badge>}
                        </div>
                        {item.canonicalKeyword && (
                          <div className="text-xs text-muted-foreground">대표: {item.canonicalKeyword}</div>
                        )}
                      </div>

                      {/* 점수 바 */}
                      <div className="hidden md:flex items-center gap-3 flex-shrink-0">
                        <div className="text-center">
                          <div className="text-xs font-medium">{coupangScore.toFixed(0)}</div>
                          <div className="text-[10px] text-muted-foreground">쿠팡</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs font-medium">{naverScore.toFixed(0)}</div>
                          <div className="text-[10px] text-muted-foreground">네이버</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs font-medium">{formatNum(totalSearch)}</div>
                          <div className="text-[10px] text-muted-foreground">월검색량</div>
                        </div>
                        {cal && (
                          <div className="text-center">
                            <div className="text-xs font-medium">{formatNum(cal.correctedSalesEst)}</div>
                            <div className="text-[10px] text-muted-foreground">추정판매</div>
                          </div>
                        )}
                        {cal && (
                          <Badge variant="outline" className="text-[10px]">
                            {cal.surgeLabel}
                          </Badge>
                        )}
                      </div>

                      {/* 상세 버튼 */}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="flex-shrink-0"
                        onClick={e => { e.stopPropagation(); setDetailKeyword(item); }}
                      >
                        <ArrowRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              이전
            </Button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 7) {
                  pageNum = i + 1;
                } else if (page <= 4) {
                  pageNum = i + 1;
                } else if (page >= totalPages - 3) {
                  pageNum = totalPages - 6 + i;
                } else {
                  pageNum = page - 3 + i;
                }
                return (
                  <Button
                    key={pageNum}
                    size="sm"
                    variant={pageNum === page ? "default" : "outline"}
                    className="w-9 h-9"
                    onClick={() => setPage(pageNum)}
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            >
              다음
            </Button>
            <span className="text-xs text-muted-foreground ml-2">
              총 {formatNum(totalItems)}건
            </span>
          </div>
        )}

        {/* 상세 다이얼로그 */}
        <Dialog open={!!detailKeyword} onOpenChange={() => setDetailKeyword(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Gem className="w-5 h-5 text-purple-500" />
                {detailKeyword?.keyword}
              </DialogTitle>
            </DialogHeader>
            {detailKeyword && <KeywordDetailView item={detailKeyword} />}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

function KeywordDetailView({ item }: { item: any }) {
  const m = item.metrics;
  const finalScore = Number(m?.finalScore || 0);
  const coupangScore = Number(m?.coupangBaseScore || 0);
  const naverScore = Number(m?.naverValidationScore || 0);

  const cal = m ? calibrateSales({
    reviewDelta: m.coupangTop10ReviewDelta || 0,
    productCount: m.coupangProductCount || 0,
    avgPrice: m.coupangAvgPrice || 0,
    categoryHint: item.categoryHint || undefined,
    naverTotalSearch: m.naverTotalSearch || 0,
    naverCompetition: m.naverCompetitionIndex || undefined,
  }) : null;

  return (
    <div className="space-y-4">
      {/* 상태 + 등급 */}
      <div className="flex items-center gap-3">
        {statusBadge(item.validationStatus)}
        <span className={`text-2xl font-bold ${gradeColor(finalScore)}`}>
          {gradeBadge(finalScore)} ({finalScore.toFixed(1)}점)
        </span>
      </div>

      {/* 점수 분해 */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-sm font-medium mb-2">쿠팡 기본 점수 (70%)</div>
            <div className="text-2xl font-bold text-blue-500">{coupangScore.toFixed(1)}</div>
            {m && (
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                <div>상품수: {formatNum(m.coupangProductCount)}</div>
                <div>평균가: {formatNum(m.coupangAvgPrice)}원</div>
                <div>리뷰합: {formatNum(m.coupangTop10ReviewSum)}</div>
                <div>리뷰증가: {formatNum(m.coupangTop10ReviewDelta)}</div>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-sm font-medium mb-2">네이버 검증 점수 (30%)</div>
            <div className="text-2xl font-bold text-green-500">{naverScore.toFixed(1)}</div>
            {m && (
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                <div>PC 검색: {formatNum(m.naverPcSearch)}</div>
                <div>모바일 검색: {formatNum(m.naverMobileSearch)}</div>
                <div>총 검색: {formatNum(m.naverTotalSearch)}</div>
                <div>경쟁도: {m.naverCompetitionIndex || "-"}</div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 세부 점수 */}
      {m && (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "시장갭", value: Number(m.marketGapScore || 0) },
            { label: "트렌드", value: Number(m.trendScore || 0) },
            { label: "숨은아이템", value: Number(m.hiddenScore || 0) },
            { label: "소싱점수", value: Number(m.sourcingScore || 0) },
          ].map(s => (
            <div key={s.label} className="text-center p-2 bg-muted/50 rounded">
              <div className="text-sm font-bold">{s.value.toFixed(0)}</div>
              <div className="text-[10px] text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* 판매추정 보정 */}
      {cal && (
        <Card>
          <CardContent className="p-3">
            <div className="text-sm font-medium mb-2">판매추정 보정</div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-lg font-bold">{formatNum(cal.baseSalesEst)}</div>
                <div className="text-[10px] text-muted-foreground">기본추정</div>
              </div>
              <div>
                <div className="text-lg font-bold text-blue-500">{formatNum(cal.correctedSalesEst)}</div>
                <div className="text-[10px] text-muted-foreground">보정추정</div>
              </div>
              <div>
                <Badge variant={
                  cal.confidence === "high" ? "default" :
                  cal.confidence === "medium" ? "secondary" : "destructive"
                } className="text-xs">
                  {cal.surgeLabel}
                </Badge>
                <div className="text-[10px] text-muted-foreground mt-1">신뢰도: {cal.confidence}</div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">{cal.confidenceReason}</p>
          </CardContent>
        </Card>
      )}

      {/* 메타 정보 */}
      <div className="text-xs text-muted-foreground space-y-1">
        <div>소스: {item.sourceType} | 우선순위: {item.validationPriority}</div>
        <div>최초 등록: {item.firstSeenAt ? new Date(item.firstSeenAt).toLocaleDateString("ko-KR") : "-"}</div>
        {item.lastValidatedAt && <div>마지막 검증: {new Date(item.lastValidatedAt).toLocaleString("ko-KR")}</div>}
        {item.recommendedExpiresAt && <div>추천 만료: {new Date(item.recommendedExpiresAt).toLocaleString("ko-KR")}</div>}
      </div>
    </div>
  );
}
