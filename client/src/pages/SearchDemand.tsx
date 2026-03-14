import { useState, useCallback, useRef, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { calibrateSales } from "@/lib/salesCalibration";
import DashboardLayout from "@/components/DashboardLayout";
import SourcingFormModal from "@/components/SourcingFormModal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Activity, Zap, Trash2, Clock, Loader2, Square, Sparkles, Info, Plus,
  ArrowUpRight, ArrowDownRight, Minus, TrendingUp,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, AreaChart, Area, Legend, ComposedChart,
} from "recharts";

function formatPrice(n: number | null | undefined) {
  if (n === null || n === undefined) return "-";
  return n.toLocaleString("ko-KR") + "원";
}

export default function SearchDemand() {
  // ===== State =====
  const [demandSelectedKw, setDemandSelectedKw] = useState<string | null>(null);
  const [demandDays, setDemandDays] = useState(30);
  const [demandSearch, setDemandSearch] = useState("");
  const [demandSort, setDemandSort] = useState<
    "keyword_score" | "demand_score" | "review_growth" | "sales_estimate" | "competition_score" | "avg_price"
  >("keyword_score");
  const [selectedDeleteKws, setSelectedDeleteKws] = useState<Set<string>>(new Set());
  const [statsRunning, setStatsRunning] = useState(false);
  const [statsProgress, setStatsProgress] = useState({ current: 0, total: 0, round: 0, totalRounds: 0 });
  const statsStoppedRef = useRef(false);
  const [sourcingModalOpen, setSourcingModalOpen] = useState(false);
  const [sourcingPrefillData, setSourcingPrefillData] = useState<Record<string, any> | undefined>(undefined);
  const [sourcingEditProduct, setSourcingEditProduct] = useState<any>(undefined);

  // ===== Queries =====
  const keywordStatsList = trpc.extension.listKeywordStats.useQuery(
    { search: demandSearch || undefined, sortBy: demandSort, sortDir: "desc", limit: 100 },
  );
  const keywordStatsOverview = trpc.extension.keywordStatsOverview.useQuery();
  const autoCollectInfo = trpc.extension.autoCollectStats.useQuery();
  const keywordDailyStats = trpc.extension.getKeywordDailyStats.useQuery(
    { query: demandSelectedKw || "", days: demandDays },
    { enabled: !!demandSelectedKw },
  );
  const searchStats = trpc.extension.searchStats.useQuery();
  const snapshots = trpc.extension.listSnapshots.useQuery({ limit: 10 });

  // ===== Mutations =====
  const bulkCompute = trpc.extension.bulkComputeStats.useMutation();
  const rebuildDailyStats = trpc.extension.rebuildDailyStats.useMutation();

  const [rebuildRunning, setRebuildRunning] = useState(false);
  const handleRebuildNormalized = useCallback(async () => {
    if (rebuildRunning) return;
    setRebuildRunning(true);
    try {
      toast.info("정규화 재계산 시작 (v8.3.1 per-product delta 엔진)...");
      const r = await rebuildDailyStats.mutateAsync({ days: Math.max(demandDays, 90) });
      toast.success(`재계산 완료: ${r.rebuilt}건 (${r.keywords}개 키워드)`);
      keywordStatsList.refetch();
      keywordStatsOverview.refetch();
      if (demandSelectedKw) keywordDailyStats.refetch();
    } catch (err: any) {
      toast.error(`재계산 오류: ${err.message}`);
    } finally {
      setRebuildRunning(false);
    }
  }, [demandDays, demandSelectedKw, rebuildRunning]);

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

  const openSourcingModal = (prefill?: Record<string, any>, edit?: any) => {
    setSourcingPrefillData(prefill);
    setSourcingEditProduct(edit);
    setSourcingModalOpen(true);
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-[1600px] mx-auto">
        {/* 헤더 + 액션 */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Activity className="w-6 h-6 text-orange-500" /> 검색 수요 분석
              <Badge variant="outline" className="text-[10px] border-orange-300 text-orange-600">Beta</Badge>
            </h2>
            <p className="text-xs text-gray-500 mt-1">쿠팡 검색 데이터 기반 · 리뷰 증가량으로 판매량 추정 · 키워드별 경쟁·수요 분석</p>
          </div>
          <div className="flex items-center gap-2">
            {!statsRunning ? (
              <>
                <Button size="sm" className="text-xs bg-orange-600 hover:bg-orange-700 gap-1.5"
                  onClick={handleAutoStats}>
                  <Zap className="w-3 h-3" />
                  통계 계산
                </Button>
                <Button size="sm" variant="outline" className="text-xs gap-1.5 border-purple-300 text-purple-600 hover:bg-purple-50"
                  onClick={handleRebuildNormalized}
                  disabled={rebuildRunning || rebuildDailyStats.isPending}>
                  {rebuildRunning ? "재계산중..." : "정규화 재계산"}
                </Button>
              </>
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

        {/* 통계 처리 상태 */}
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

        {/* 자동 처리 안내 + 새로고침 */}
        {!statsRunning && (
          <Card className="border-blue-100 bg-blue-50/30">
            <CardContent className="pt-3 pb-3">
              <div className="flex flex-col gap-2">
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

                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <Sparkles className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                  <div className="text-[10px] text-amber-800">
                    <p className="font-semibold mb-0.5">확장프로그램 v8.4.4 업데이트 안내</p>
                    <p>자동수집 완료 시 서버 통계가 <b>자동 갱신</b>됩니다. 확장프로그램을 v8.4.4로 업데이트하면 수집 후 별도 작업 없이 이 페이지에 자동 반영됩니다.</p>
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
                    className={`px-2 py-1 rounded-full transition ${demandSort === key ? "bg-orange-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
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
                            onChange={e => {
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
                        <tr><td colSpan={11} className="text-center py-10 text-gray-400">
                          <Activity className="w-10 h-10 mx-auto mb-2 opacity-20" />
                          <p className="text-sm font-medium">데이터가 없습니다</p>
                          <p className="text-[10px] mt-1">쿠팡에서 검색한 뒤 "통계 계산" 버튼을 눌러주세요</p>
                        </td></tr>
                      ) : (
                        (keywordStatsList.data as any[]).map((kw: any) => {
                          const isSelected = demandSelectedKw === kw.query;
                          const isChecked = selectedDeleteKws.has(kw.query);
                          const cal = calibrateSales({
                            reviewDelta: kw.reviewGrowth || 0,
                            productCount: kw.productCount,
                            avgPrice: kw.avgPrice,
                            categoryHint: kw.categoryHint,
                            salesEstimateMa7: kw.salesEstimateMa7,
                            salesEstimateMa30: kw.salesEstimateMa30,
                            dataStatus: kw.dataStatus,
                            isFinalized: kw.isFinalized,
                            spikeLevel: kw.spikeLevel,
                            spikeRatio: kw.spikeRatio ? Number(kw.spikeRatio) : undefined,
                          });
                          return (
                            <tr key={kw.id}
                              className={`border-b cursor-pointer transition ${isSelected ? "bg-orange-50 ring-1 ring-orange-200" : "hover:bg-gray-50"}`}
                              onClick={() => setDemandSelectedKw(kw.query)}>
                              <td className="p-2 text-center" onClick={e => e.stopPropagation()}>
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
                              <td className="p-2 text-center">{kw.avgRating || "-"}</td>
                              <td className="p-2 text-center">
                                {(kw.reviewGrowth || 0) > 0 ? (
                                  <span className="text-green-600 font-bold">+{kw.reviewGrowth}</span>
                                ) : <span className="text-gray-400">0</span>}
                              </td>
                              <td className="p-2 text-center">
                                <div className="flex flex-col items-center">
                                  <span className="font-bold text-blue-600">{cal.correctedSalesEst.toLocaleString()}</span>
                                  <div className="flex items-center gap-0.5 mt-0.5">
                                    <Badge className={`text-[7px] px-1 py-0 border ${
                                      cal.estimateType === "ma7" ? "bg-blue-50 text-blue-600 border-blue-200" :
                                      cal.estimateType === "provisional" ? "bg-amber-50 text-amber-600 border-amber-200" :
                                      "bg-gray-50 text-gray-500 border-gray-200"
                                    }`}>{cal.estimateLabel}</Badge>
                                    {cal.spikeLabel && (
                                      <Badge className={`text-[7px] px-1 py-0 border ${
                                        cal.spikeLabel === "폭발적" ? "bg-red-100 text-red-700 border-red-300 animate-pulse" :
                                        cal.spikeLabel === "급등" ? "bg-orange-100 text-orange-700 border-orange-300" :
                                        "bg-yellow-50 text-yellow-700 border-yellow-200"
                                      }`}>{cal.spikeLabel}</Badge>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="p-2 text-center">
                                <Badge className={`text-[9px] ${
                                  kw.competitionLevel === "easy" ? "bg-green-100 text-green-700" :
                                  kw.competitionLevel === "hard" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"
                                }`}>{kw.competitionScore || 0}</Badge>
                              </td>
                              <td className="p-2 text-center">
                                <span className={`font-bold text-sm ${
                                  (kw.demandScore || 0) >= 60 ? "text-green-600" :
                                  (kw.demandScore || 0) >= 30 ? "text-orange-500" : "text-gray-400"
                                }`}>{kw.demandScore || 0}</span>
                              </td>
                              <td className="p-2 text-center">
                                <span className={`font-bold text-sm ${
                                  (kw.keywordScore || 0) >= 60 ? "text-purple-600" :
                                  (kw.keywordScore || 0) >= 30 ? "text-indigo-500" : "text-gray-400"
                                }`}>{kw.keywordScore || 0}</span>
                              </td>
                              <td className="p-2 text-center" onClick={e => e.stopPropagation()}>
                                <div className="flex gap-0.5 justify-center">
                                  <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-pink-500" title="소싱 등록"
                                    onClick={() => openSourcingModal({
                                      source: "keyword", keyword: kw.query,
                                      productCount: kw.productCount, avgPrice: kw.avgPrice,
                                      competitionScore: kw.competitionScore, demandScore: kw.demandScore,
                                      keywordScore: kw.keywordScore, salesEstimate: cal.correctedSalesEst,
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

          {/* 우측: 선택된 키워드 상세 (스크롤 시 따라옴) */}
          <div className="space-y-4 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
            {demandSelectedKw ? (
              <>
                <Card className="border-orange-200">
                  <CardHeader className="pb-2 bg-gradient-to-r from-orange-50 to-amber-50">
                    <CardTitle className="text-sm font-bold flex items-center gap-2">
                      <Activity className="w-4 h-4 text-orange-500" />
                      "{demandSelectedKw}" 추이
                    </CardTitle>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {[7, 14, 30, 60, 90, 180, 365].map(d => (
                        <button key={d} className={`px-2 py-0.5 text-[10px] rounded-full ${demandDays === d ? "bg-orange-600 text-white" : "bg-gray-100"}`}
                          onClick={() => setDemandDays(d)}>{d <= 60 ? `${d}일` : d === 90 ? "3개월" : d === 180 ? "6개월" : "1년"}</button>
                      ))}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-3">
                    {keywordDailyStats.data && keywordDailyStats.data.length > 0 ? (() => {
                      // ★ v7.7.3: baseline/missing 제외한 차트 데이터
                      const chartData = (keywordDailyStats.data as any[]).filter(
                        (d: any) => d.dataStatus !== "baseline" && d.dataStatus !== "missing"
                      ).map((d: any) => ({
                        ...d,
                        // ★ v8.2.0: 보간 데이터는 별도 필드로 분리 (차트에서 시각 구분)
                        reviewGrowthReal: d.dataStatus === "raw_valid" ? d.reviewGrowth : undefined,
                        reviewGrowthInterp: d.dataStatus !== "raw_valid" ? d.reviewGrowth : undefined,
                        salesMa7Real: d.dataStatus === "raw_valid" ? d.salesEstimateMa7 : undefined,
                        salesMa7Interp: d.dataStatus !== "raw_valid" ? d.salesEstimateMa7 : undefined,
                      }));
                      if (chartData.length < 2) return (
                        <div className="py-8 text-center text-gray-400">
                          <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
                          <p className="text-xs">첫 번째 크롤링이 완료되었습니다.</p>
                          <p className="text-[10px] mt-1">내일부터 일별 추이가 표시됩니다.</p>
                        </div>
                      );
                      return (
                      <div className="space-y-4">
                        {/* 판매 추정 MA7/MA30 그래프 */}
                        <div>
                          <div className="text-[10px] font-semibold text-gray-500 mb-1">판매 추정 (7일 이동평균)</div>
                          <ResponsiveContainer width="100%" height={180}>
                            <ComposedChart data={chartData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                              <XAxis dataKey="statDate" tick={{ fontSize: 9 }} tickFormatter={v => v.slice(5)} />
                              <YAxis tick={{ fontSize: 9 }} />
                              <Tooltip contentStyle={{ fontSize: 11 }} />
                              <Legend wrapperStyle={{ fontSize: 10 }} />
                              <Bar dataKey="reviewGrowthReal" fill="#86efac" name="리뷰 증가" radius={[3, 3, 0, 0]} stackId="rg" />
                              <Bar dataKey="reviewGrowthInterp" fill="#86efac" name="리뷰 증가(보간)" radius={[3, 3, 0, 0]} stackId="rg" fillOpacity={0.25} />
                              <Area type="monotone" dataKey="salesEstimateMa7" fill="#dbeafe" stroke="#2563eb" strokeWidth={2} name="판매추정(MA7)" fillOpacity={0.4} connectNulls />
                              <Line type="monotone" dataKey="salesEstimateMa30" stroke="#f97316" strokeWidth={1.5} strokeDasharray="4 2" name="MA30" dot={false} connectNulls />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>

                        {/* 경쟁도 + 수요 점수 라인 */}
                        <div>
                          <div className="text-[10px] font-semibold text-gray-500 mb-1">경쟁도 / 수요점수 / 종합점수</div>
                          <ResponsiveContainer width="100%" height={140}>
                            <LineChart data={chartData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                              <XAxis dataKey="statDate" tick={{ fontSize: 9 }} tickFormatter={v => v.slice(5)} />
                              <YAxis tick={{ fontSize: 9 }} domain={[0, 100]} />
                              <Tooltip contentStyle={{ fontSize: 11 }} />
                              <Legend wrapperStyle={{ fontSize: 10 }} />
                              <Line type="monotone" dataKey="competitionScore" stroke="#ef4444" strokeWidth={2} name="경쟁도" dot={{ r: 2 }} />
                              <Line type="monotone" dataKey="demandScore" stroke="#f97316" strokeWidth={2} name="수요점수" dot={{ r: 2 }} />
                              <Line type="monotone" dataKey="keywordScore" stroke="#8b5cf6" strokeWidth={2} name="종합점수" dot={{ r: 2 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>

                        {/* 평균가 + 상품수 추이 */}
                        <div>
                          <div className="text-[10px] font-semibold text-gray-500 mb-1">평균가 / 상품수 추이</div>
                          <ResponsiveContainer width="100%" height={130}>
                            <ComposedChart data={chartData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                              <XAxis dataKey="statDate" tick={{ fontSize: 9 }} tickFormatter={v => v.slice(5)} />
                              <YAxis yAxisId="price" tick={{ fontSize: 9 }} tickFormatter={v => `${(v / 1000).toFixed(0)}K`} />
                              <YAxis yAxisId="count" orientation="right" tick={{ fontSize: 9 }} />
                              <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: number, name: string) => name === "평균가" ? formatPrice(v) : v} />
                              <Legend wrapperStyle={{ fontSize: 10 }} />
                              <Area yAxisId="price" type="monotone" dataKey="avgPrice" stroke="#d97706" fill="#fef3c7" name="평균가" />
                              <Line yAxisId="count" type="monotone" dataKey="productCount" stroke="#6366f1" strokeWidth={1.5} dot={{ r: 1.5 }} name="상품수" />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                      );
                    })() : (
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
                      <div className="max-h-64 overflow-y-auto">
                        <table className="w-full text-[10px]">
                          <thead className="sticky top-0 bg-white"><tr className="border-b text-gray-500">
                            <th className="p-1.5">날짜</th><th className="p-1.5">상품</th><th className="p-1.5">평균가</th>
                            <th className="p-1.5">리뷰+</th><th className="p-1.5">판매</th><th className="p-1.5">MA7</th><th className="p-1.5">상태</th>
                          </tr></thead>
                          <tbody>
                            {(keywordDailyStats.data as any[]).slice().reverse()
                              .filter((d: any) => d.dataStatus !== "missing")
                              .map((d: any, i: number) => {
                              const isBaseline = d.dataStatus === "baseline";
                              const statusColor = d.dataStatus === "raw_valid" ? "text-green-600" :
                                d.dataStatus === "interpolated" ? "text-blue-500" :
                                d.dataStatus === "provisional" ? "text-amber-500" :
                                d.dataStatus === "anomaly" ? "text-red-500" :
                                isBaseline ? "text-purple-500" : "text-gray-400";
                              const statusLabel = d.dataStatus === "raw_valid" ? "✓ 확정" :
                                d.dataStatus === "interpolated" ? "~ 보간" :
                                d.dataStatus === "provisional" ? "◌ 임시" :
                                d.dataStatus === "anomaly" ? "⚠ 이상" :
                                isBaseline ? "◆ 기준" : "-";
                              return (
                                <tr key={i} className={`border-b border-gray-50 hover:bg-gray-50 ${d.dataStatus === "interpolated" ? "bg-blue-50/20 opacity-60" : ""} ${d.dataStatus === "provisional" ? "bg-amber-50/30 opacity-70" : ""} ${isBaseline ? "bg-purple-50/30" : ""}`}>
                                  <td className="p-1.5 text-gray-500">{d.statDate?.slice(5)}</td>
                                  <td className="p-1.5 text-center">{d.productCount}</td>
                                  <td className="p-1.5 text-center">{formatPrice(d.avgPrice)}</td>
                                  <td className={`p-1.5 text-center font-medium ${d.dataStatus === "raw_valid" ? "text-green-600" : "text-green-400 italic"}`}>{isBaseline ? "-" : d.reviewGrowth > 0 ? `+${d.reviewGrowth}` : "0"}</td>
                                  <td className={`p-1.5 text-center font-medium ${d.dataStatus === "raw_valid" ? "text-blue-600" : "text-blue-400 italic"}`}>{isBaseline ? "-" : d.salesEstimate || 0}</td>
                                  <td className="p-1.5 text-center font-bold text-indigo-600">{d.salesEstimateMa7 || "-"}</td>
                                  <td className={`p-1.5 text-center font-medium ${statusColor}`}>{statusLabel}</td>
                                </tr>
                              );
                            })}
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
                <div className="text-[10px] font-semibold text-gray-600 mb-2 flex items-center gap-1"><Info className="w-3 h-3" /> 점수 산출 기준 (v8.3.1 Per-Product Delta)</div>
                <div className="space-y-1.5 text-[10px] text-gray-500">
                  <div><span className="font-medium text-green-600">리뷰증가</span>: ★ 동일 상품(productId)의 리뷰 변화만 추적 → 상품 교체 노이즈 완전 제거</div>
                  <div><span className="font-medium text-green-600">판매추정</span>: 리뷰증가 × 20 → MA7(7일 이동평균) 기반 안정화</div>
                  <div><span className="font-medium text-orange-600">수요점수</span>: 판매추정 로그스케일(80%) + 리뷰활력·시장규모·로켓비율(20%)</div>
                  <div><span className="font-medium text-purple-600">종합점수</span>: 성장성(30%) + 시장규모(25%) + 진입용이성(25%) + 수요(20%)</div>
                  <div><span className="font-medium text-red-600">경쟁도</span>: 리뷰수 log(35%) + 고리뷰비율(25%) + 평점(20%) + 광고비율(20%)</div>
                  <div><span className="font-medium text-blue-600">MA7</span>=7일평균(안정) · <span className="font-medium text-amber-600">보간</span>=스냅샷 없는 날(평균값) · <span className="font-medium text-gray-500">이상치</span>=매칭률 30%미만</div>
                  <div><span className="font-medium text-red-500">급등뱃지</span>: today/MA7 비율 — 상승(1.8x) · 급등(2.5x) · 폭발적(4x)</div>
                  <div className="border-t border-gray-200 pt-1 mt-1"><span className="font-medium text-gray-600">📊 Per-Product Delta</span>: 인접 스냅샷의 <b>동일 상품</b> 리뷰를 비교합니다. 상품 교체(일 20-45%)에 의한 왜곡을 제거합니다.</div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Sourcing Form Modal */}
      <SourcingFormModal
        open={sourcingModalOpen}
        onClose={() => {
          setSourcingModalOpen(false);
          setSourcingPrefillData(undefined);
          setSourcingEditProduct(undefined);
        }}
        prefillData={sourcingPrefillData}
        editProduct={sourcingEditProduct}
      />
    </DashboardLayout>
  );
}
