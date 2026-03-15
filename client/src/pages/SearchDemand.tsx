import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import SourcingFormModal from "@/components/SourcingFormModal";
import BatchStatusCard from "@/components/BatchStatusCard";
import KeywordTable from "@/components/KeywordTable";
import KeywordDetailPanel from "@/components/KeywordDetailPanel";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Activity, Zap, Trash2, Loader2, Square,
} from "lucide-react";
import { ChevronLeft, ChevronRight } from "lucide-react";

function formatPrice(n: number | null | undefined) {
  if (n === null || n === undefined) return "-";
  return n.toLocaleString("ko-KR") + "원";
}

// ===== Korean Initial Consonant (Chosung) Extraction =====
const CHOSUNG_LIST = [
  "\u3131","\u3132","\u3134","\u3137","\u3138","\u3139","\u3141","\u3142","\u3143","\u3145","\u3146",
  "\u3147","\u3148","\u3149","\u314A","\u314B","\u314C","\u314D","\u314E",
];
const CHOSUNG_GROUP: Record<string, string> = {
  "\u3132": "\u3131", "\u3138": "\u3137", "\u3143": "\u3142", "\u3146": "\u3145", "\u3149": "\u3148",
};
const CHOSUNG_TABS = ["\u3131","\u3134","\u3137","\u3139","\u3141","\u3142","\u3145","\u3147","\u3148","\u314A","\u314B","\u314C","\u314D","\u314E"];

function getChosung(char: string): string | null {
  const code = char.charCodeAt(0);
  if (code >= 0xAC00 && code <= 0xD7A3) {
    const chosungIdx = Math.floor((code - 0xAC00) / (21 * 28));
    const raw = CHOSUNG_LIST[chosungIdx];
    return CHOSUNG_GROUP[raw] || raw;
  }
  return null;
}

function getKeywordGroup(query: string): string {
  if (!query) return "ETC";
  const first = query.charAt(0);
  const chosung = getChosung(first);
  if (chosung) return chosung;
  if (/[a-zA-Z]/.test(first)) return "ABC";
  if (/[0-9]/.test(first)) return "123";
  return "ETC";
}

type KwTabMode = "all" | "chosung" | "uncollected";
const ITEMS_PER_PAGE = 50;

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

  // ===== Tab & Pagination State =====
  const [kwTabMode, setKwTabMode] = useState<KwTabMode>("all");
  const [kwChosungFilter, setKwChosungFilter] = useState<string>("\u3131");
  const [kwPage, setKwPage] = useState(1);

  // ===== Queries =====
  const keywordStatsList = trpc.extension.listKeywordStats.useQuery(
    { search: demandSearch || undefined, sortBy: demandSort, sortDir: "desc", limit: 500 },
  );
  const keywordStatsOverview = trpc.extension.keywordStatsOverview.useQuery();
  const autoCollectInfo = trpc.extension.autoCollectStats.useQuery();
  const keywordDailyStats = trpc.extension.getKeywordDailyStats.useQuery(
    { query: demandSelectedKw || "", days: demandDays },
    { enabled: !!demandSelectedKw },
  );
  const marketOverview = trpc.extension.getLatestMarketOverview.useQuery(
    { query: demandSelectedKw || "" },
    { enabled: !!demandSelectedKw },
  );
  const searchVolume = trpc.extension.getKeywordSearchVolume.useQuery(
    { query: demandSelectedKw || "" },
    { enabled: !!demandSelectedKw },
  );
  const uncollectedKws = trpc.extension.getUncollectedKeywords.useQuery();

  // ===== Mutations =====
  const bulkCompute = trpc.extension.bulkComputeStats.useMutation();
  const rebuildDailyStats = trpc.extension.rebuildDailyStats.useMutation();
  const fetchSearchVolumeMut = trpc.extension.fetchSearchVolume.useMutation();
  const boostUncollected = trpc.extension.boostUncollectedPriority.useMutation();
  const togglePin = trpc.extension.togglePinKeyword.useMutation({
    onSuccess: () => { keywordStatsList.refetch(); },
  });
  const deleteKeyword = trpc.extension.deleteKeyword.useMutation({
    onSuccess: () => {
      keywordStatsList.refetch(); keywordStatsOverview.refetch();
      toast.success("키워드가 삭제되었습니다");
    },
    onError: (err: any) => toast.error(err.message || "삭제 실패"),
  });
  const deleteKeywords = trpc.extension.deleteKeywords.useMutation({
    onSuccess: (data: any) => {
      setSelectedDeleteKws(new Set());
      toast.success(`${data.count}개 키워드 삭제 완료`);
      keywordStatsList.refetch(); keywordStatsOverview.refetch();
    },
    onError: (err: any) => toast.error(err.message || "삭제 실패"),
  });

  // ===== 검색량 자동 수집: 데이터 없으면 네이버 API 자동 호출 =====
  const autoFetchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (
      demandSelectedKw &&
      searchVolume.isFetched &&
      !searchVolume.data &&
      !fetchSearchVolumeMut.isPending &&
      !autoFetchedRef.current.has(demandSelectedKw)
    ) {
      autoFetchedRef.current.add(demandSelectedKw);
      fetchSearchVolumeMut.mutate(
        { keywords: [demandSelectedKw] },
        { onSuccess: () => searchVolume.refetch() },
      );
    }
  }, [demandSelectedKw, searchVolume.isFetched, searchVolume.data]);

  // ===== Filtered & Paginated keyword list =====
  useEffect(() => { setKwPage(1); }, [kwTabMode, kwChosungFilter, demandSearch, demandSort]);

  const { filteredKws, totalPages, paginatedKws, chosungCounts } = useMemo(() => {
    const allKws = (keywordStatsList.data as any[]) || [];

    const counts: Record<string, number> = {};
    for (const tab of CHOSUNG_TABS) counts[tab] = 0;
    counts["ABC"] = 0; counts["123"] = 0; counts["ETC"] = 0;
    for (const kw of allKws) {
      const grp = getKeywordGroup(kw.query);
      if (counts[grp] !== undefined) counts[grp]++;
      else counts["ETC"] = (counts["ETC"] || 0) + 1;
    }

    let filtered = allKws;
    if (kwTabMode === "chosung") {
      filtered = allKws.filter(kw => getKeywordGroup(kw.query) === kwChosungFilter);
      filtered = [...filtered].sort((a, b) => a.query.localeCompare(b.query, "ko"));
    } else if (kwTabMode === "uncollected") {
      const uncollectedList = uncollectedKws.data?.uncollectedKeywords || [];
      const uncollectedSet = new Set(uncollectedList);
      // 1) daily_stats에 존재하는 미수집 키워드
      const fromStats = allKws.filter(kw => uncollectedSet.has(kw.query));
      // 2) daily_stats에 없는 미수집 키워드 → 플레이스홀더 행 생성
      const inStatsSet = new Set(fromStats.map(kw => kw.query));
      const placeholders = uncollectedList
        .filter(kw => !inStatsSet.has(kw))
        .map(kw => ({
          query: kw,
          keywordScore: 0, demandScore: 0, reviewGrowth: 0,
          salesEstimate: 0, competitionScore: 0, avgPrice: 0,
          productCount: 0, totalReviewSum: 0, dataStatus: "uncollected",
          isPinned: false, pinOrder: 0, watchId: null,
        }));
      filtered = [...fromStats, ...placeholders].sort((a, b) => a.query.localeCompare(b.query, "ko"));
    }

    const total = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
    const page = Math.min(kwPage, total);
    const start = (page - 1) * ITEMS_PER_PAGE;
    const paginated = filtered.slice(start, start + ITEMS_PER_PAGE);

    return { filteredKws: filtered, totalPages: total, paginatedKws: paginated, chosungCounts: counts };
  }, [keywordStatsList.data, kwTabMode, kwChosungFilter, kwPage, uncollectedKws.data]);

  const [rebuildRunning, setRebuildRunning] = useState(false);
  const handleRebuildNormalized = useCallback(async () => {
    if (rebuildRunning) return;
    setRebuildRunning(true);
    try {
      toast.info("정규화 재계산 시작...");
      const r = await rebuildDailyStats.mutateAsync({ days: Math.max(demandDays, 90) });
      toast.success(`재계산 완료: ${r.rebuilt}건 (${r.keywords}개 키워드)`);
      keywordStatsList.refetch(); keywordStatsOverview.refetch();
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
        if (statsStoppedRef.current) { toast.info("통계 처리 중지됨"); break; }
        const result = await bulkCompute.mutateAsync({ offset, limit });
        setStatsProgress({ current: result.offset + result.computed, total: result.total, round: result.round, totalRounds: result.totalRounds });
        hasMore = result.hasMore;
        offset = result.nextOffset;
      }
      if (!statsStoppedRef.current) {
        toast.success("전체 통계 갱신 완료!");
        keywordStatsList.refetch(); keywordStatsOverview.refetch();
        if (demandSelectedKw) keywordDailyStats.refetch();
      }
    } catch (err: any) { toast.error(`통계 오류: ${err.message}`); }
    finally { setStatsRunning(false); }
  }, [statsRunning, demandSelectedKw]);

  const handleStopStats = () => { statsStoppedRef.current = true; };

  const refreshAll = () => {
    keywordStatsList.refetch();
    keywordStatsOverview.refetch();
    autoCollectInfo.refetch();
    uncollectedKws.refetch();
    if (demandSelectedKw) { keywordDailyStats.refetch(); marketOverview.refetch(); searchVolume.refetch(); }
    toast.success("데이터 갱신됨");
  };

  const openSourcingModal = (prefill?: Record<string, any>, edit?: any) => {
    setSourcingPrefillData(prefill);
    setSourcingEditProduct(edit);
    setSourcingModalOpen(true);
  };

  const overview = keywordStatsOverview.data;
  const aci = autoCollectInfo.data;

  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-[1600px] mx-auto">
        {/* 헤더 + 액션 */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Activity className="w-6 h-6 text-orange-500" /> 검색 수요 분석
            </h2>
            <p className="text-xs text-gray-500 mt-1">쿠팡 검색 데이터 기반 · 리뷰 증가량으로 판매량 추정 · 3-티어 배치 수집</p>
          </div>
          <div className="flex items-center gap-2">
            {!statsRunning ? (
              <>
                <Button size="sm" className="text-xs bg-orange-600 hover:bg-orange-700 gap-1.5" onClick={handleAutoStats}>
                  <Zap className="w-3 h-3" /> 통계 계산
                </Button>
                <Button size="sm" variant="outline" className="text-xs gap-1.5 border-purple-300 text-purple-600 hover:bg-purple-50"
                  onClick={handleRebuildNormalized} disabled={rebuildRunning || rebuildDailyStats.isPending}>
                  {rebuildRunning ? "재계산중..." : "정규화 재계산"}
                </Button>
                <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={refreshAll}>
                  <Activity className="w-3 h-3" /> 새로고침
                </Button>
              </>
            ) : (
              <Button size="sm" variant="destructive" className="text-xs gap-1.5" onClick={handleStopStats}>
                <Square className="w-3 h-3" fill="currentColor" /> 중지
              </Button>
            )}
            {selectedDeleteKws.size > 0 && (
              <Button variant="destructive" size="sm" className="text-xs gap-1"
                onClick={() => {
                  if (confirm(`선택한 ${selectedDeleteKws.size}개 키워드를 삭제할까요?`))
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
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-orange-500" />
                  <span className="text-xs font-semibold text-gray-700">통계 갱신 중...</span>
                </div>
                <span className="text-xs font-medium text-orange-600">
                  라운드 {statsProgress.round}/{statsProgress.totalRounds} | {statsProgress.current}/{statsProgress.total}
                </span>
              </div>
              <Progress value={statsProgress.total > 0 ? (statsProgress.current / statsProgress.total) * 100 : 0} className="h-2" />
            </CardContent>
          </Card>
        )}

        {/* 배치 엔진 상태 + 개요 카드 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {aci && <BatchStatusCard data={aci} />}
          {overview && (
            <div className="lg:col-span-2 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {[
                { label: "추적 키워드", value: overview.totalKeywords ?? 0, color: "text-indigo-600" },
                { label: "평균 수요점수", value: overview.avgDemandScore ?? 0, color: "text-orange-600" },
                { label: "평균 키워드점수", value: overview.avgKeywordScore ?? 0, color: "text-purple-600" },
                { label: "평균 경쟁도", value: overview.avgCompetition ?? 0, color: "text-red-600" },
                { label: "추정 총 판매량", value: (overview.totalSalesEstimate ?? 0).toLocaleString(), color: "text-green-600" },
                { label: "총 리뷰 증가", value: (overview.totalReviewGrowth ?? 0).toLocaleString(), color: "text-blue-600" },
                { label: "평균가", value: formatPrice(overview.avgPrice), color: "text-amber-600" },
                { label: "신규(미배치)", value: aci?.neverCollected ?? 0, color: "text-gray-500" },
              ].map((s, i) => (
                <Card key={i}><CardContent className="pt-3 pb-3 text-center">
                  <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{s.label}</div>
                </CardContent></Card>
              ))}
            </div>
          )}
        </div>

        {/* 메인 콘텐츠 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 좌측: 키워드 목록 */}
          <div className="lg:col-span-2 space-y-3">
            {/* 탭: 전체 / ㄱㄴㄷ / 미수집 */}
            <div className="flex items-center gap-1 flex-wrap">
              <button
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition ${kwTabMode === "all" ? "bg-indigo-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                onClick={() => setKwTabMode("all")}>
                전체 <span className="text-[9px] opacity-80">({(keywordStatsList.data as any[])?.length || 0})</span>
              </button>
              <button
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition ${kwTabMode === "chosung" ? "bg-indigo-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                onClick={() => setKwTabMode("chosung")}>
                ㄱㄴㄷ순
              </button>
              {(uncollectedKws.data?.uncollectedCount || 0) > 0 && (
                <button
                  className={`px-3 py-1.5 text-xs rounded-lg font-medium transition flex items-center gap-1 ${kwTabMode === "uncollected" ? "bg-red-600 text-white shadow-sm" : "bg-red-50 text-red-600 hover:bg-red-100 border border-red-200"}`}
                  onClick={() => { setKwTabMode("uncollected"); uncollectedKws.refetch(); }}>
                  오늘 미수집
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${kwTabMode === "uncollected" ? "bg-white/20" : "bg-red-100 text-red-700"}`}>
                    {uncollectedKws.data?.uncollectedCount}
                  </span>
                </button>
              )}
            </div>

            {/* ㄱㄴㄷ 초성 필터 */}
            {kwTabMode === "chosung" && (
              <div className="flex items-center gap-0.5 flex-wrap">
                {CHOSUNG_TABS.map(ch => (
                  <button key={ch}
                    className={`px-2 py-1 text-[11px] rounded-md font-medium transition min-w-[28px] ${
                      kwChosungFilter === ch
                        ? "bg-orange-500 text-white shadow-sm"
                        : chosungCounts[ch] > 0
                          ? "bg-gray-100 text-gray-700 hover:bg-orange-100"
                          : "bg-gray-50 text-gray-300 cursor-default"
                    }`}
                    onClick={() => chosungCounts[ch] > 0 && setKwChosungFilter(ch)}>
                    {ch}
                    {chosungCounts[ch] > 0 && <span className="text-[8px] ml-0.5 opacity-60">{chosungCounts[ch]}</span>}
                  </button>
                ))}
                {chosungCounts["ABC"] > 0 && (
                  <button
                    className={`px-2 py-1 text-[11px] rounded-md font-medium transition ${kwChosungFilter === "ABC" ? "bg-orange-500 text-white shadow-sm" : "bg-gray-100 text-gray-700 hover:bg-orange-100"}`}
                    onClick={() => setKwChosungFilter("ABC")}>
                    ABC<span className="text-[8px] ml-0.5 opacity-60">{chosungCounts["ABC"]}</span>
                  </button>
                )}
                {chosungCounts["123"] > 0 && (
                  <button
                    className={`px-2 py-1 text-[11px] rounded-md font-medium transition ${kwChosungFilter === "123" ? "bg-orange-500 text-white shadow-sm" : "bg-gray-100 text-gray-700 hover:bg-orange-100"}`}
                    onClick={() => setKwChosungFilter("123")}>
                    0-9<span className="text-[8px] ml-0.5 opacity-60">{chosungCounts["123"]}</span>
                  </button>
                )}
              </div>
            )}

            {/* 미수집 키워드 안내 배너 */}
            {kwTabMode === "uncollected" && uncollectedKws.data && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-[11px] text-red-800">
                    <p className="font-semibold mb-0.5">
                      오늘 수집 안 된 키워드 {uncollectedKws.data.uncollectedCount}개
                      <span className="font-normal text-red-600 ml-1">
                        (전체 {uncollectedKws.data.total}개 중 {uncollectedKws.data.collectedCount}개 수집완료)
                      </span>
                    </p>
                    <p className="text-[10px] text-red-600">
                      확장프로그램 수집 탭에서 "미수집 키워드" 라디오 선택 후 수집하면 미수집 키워드만 자동 수집됩니다.
                    </p>
                  </div>
                  <Button size="sm" className="text-[10px] h-7 gap-1 bg-orange-600 hover:bg-orange-700 text-white"
                    disabled={boostUncollected.isPending}
                    onClick={async () => {
                      try {
                        const r = await boostUncollected.mutateAsync();
                        toast.success(`${r.boosted}개 키워드 우선 수집 예약 완료!`);
                        uncollectedKws.refetch();
                      } catch (err: any) { toast.error(`우선 수집 예약 실패: ${err.message}`); }
                    }}>
                    <Zap className="w-3 h-3" />
                    {boostUncollected.isPending ? "처리중..." : "다음 수집에 우선 포함"}
                  </Button>
                </div>
              </div>
            )}

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
              <span className="text-[10px] text-gray-400 ml-auto">
                {filteredKws.length}개 {kwTabMode === "all" && totalPages > 1 ? `(${kwPage}/${totalPages} 페이지)` : ""}
              </span>
            </div>

            {/* 키워드 테이블 */}
            <Card>
              <CardContent className="p-0">
                <KeywordTable
                  keywords={paginatedKws}
                  selectedKw={demandSelectedKw}
                  selectedDeleteKws={selectedDeleteKws}
                  onSelectKw={setDemandSelectedKw}
                  onToggleDelete={kw => {
                    const next = new Set(selectedDeleteKws);
                    if (next.has(kw)) next.delete(kw); else next.add(kw);
                    setSelectedDeleteKws(next);
                  }}
                  onSelectAll={() => setSelectedDeleteKws(new Set(paginatedKws.map((k: any) => k.query)))}
                  onDeselectAll={() => setSelectedDeleteKws(new Set())}
                  onTogglePin={(watchId, isPinned) => togglePin.mutate({ keywordId: watchId, isPinned })}
                  onOpenSourcing={prefill => openSourcingModal(prefill)}
                  onDeleteKw={query => deleteKeyword.mutate({ query })}
                />
              </CardContent>
            </Card>

            {/* 페이지네이션 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <Button variant="outline" size="sm" className="h-7 w-7 p-0"
                  disabled={kwPage <= 1} onClick={() => setKwPage(p => Math.max(1, p - 1))}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => {
                  const p = totalPages <= 10 ? i + 1
                    : kwPage <= 5 ? i + 1
                    : kwPage >= totalPages - 4 ? totalPages - 9 + i
                    : kwPage - 4 + i;
                  return (
                    <Button key={p} variant={kwPage === p ? "default" : "outline"}
                      size="sm" className={`h-7 min-w-[28px] text-[10px] p-0 ${kwPage === p ? "bg-orange-600" : ""}`}
                      onClick={() => setKwPage(p)}>
                      {p}
                    </Button>
                  );
                })}
                <Button variant="outline" size="sm" className="h-7 w-7 p-0"
                  disabled={kwPage >= totalPages} onClick={() => setKwPage(p => Math.min(totalPages, p + 1))}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>

          {/* 우측: 선택된 키워드 상세 */}
          <div className="space-y-4 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
            {demandSelectedKw ? (
              <KeywordDetailPanel
                keyword={demandSelectedKw}
                days={demandDays}
                onChangeDays={setDemandDays}
                dailyStats={keywordDailyStats.data as any[] | undefined}
                marketOverview={marketOverview.data}
                searchVolume={searchVolume.data}
                searchVolumeLoading={fetchSearchVolumeMut.isPending}
              />
            ) : (
              <Card className="border-dashed">
                <CardContent className="py-16 text-center text-gray-400">
                  <Activity className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="text-sm font-medium">키워드를 선택하세요</p>
                  <p className="text-[10px] mt-1">좌측 목록에서 키워드를 클릭하면<br/>일별 추이 그래프가 표시됩니다.</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

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
