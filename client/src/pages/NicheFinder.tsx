import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Search, Gem, TrendingUp, ShieldCheck, AlertTriangle, Sparkles,
  ArrowUpRight, Filter, BarChart3, Star,
} from "lucide-react";
import { toast } from "sonner";

function formatPrice(n: number | null | undefined) {
  if (n === null || n === undefined) return "-";
  return n.toLocaleString("ko-KR") + "원";
}

type SortKey = "opportunity" | "demand_score" | "sales_estimate" | "competition_score" | "avg_price";

/** 기회 점수 계산: 수요 높고 + 경쟁 낮고 + 판매 추정 높음 */
function calcOpportunityScore(kw: any): number {
  const demand = Number(kw.demandScore) || 0;
  const competition = Number(kw.competitionScore) || 0;
  const sales = Number(kw.salesEstimate) || 0;
  const reviewGrowth = Number(kw.reviewGrowth) || 0;
  const adRatio = Number(kw.adRatio) || 0;

  // 수요가 높을수록 좋음
  let score = demand * 0.3;
  // 경쟁이 낮을수록 좋음 (역수)
  score += (100 - competition) * 0.25;
  // 판매 추정 점수 (로그 스케일)
  score += Math.min(30, Math.log10(sales + 1) * 15);
  // 리뷰 증가량 보너스
  score += Math.min(15, reviewGrowth * 0.5);
  // 광고 비율 낮으면 보너스
  if (adRatio < 0.15) score += 5;

  return Math.round(Math.min(100, Math.max(0, score)));
}

function getOpportunityGrade(score: number): { label: string; color: string; emoji: string } {
  if (score >= 70) return { label: "블루오션", emoji: "💎", color: "text-blue-600 bg-blue-50 border-blue-200" };
  if (score >= 55) return { label: "유망", emoji: "🌟", color: "text-green-600 bg-green-50 border-green-200" };
  if (score >= 40) return { label: "보통", emoji: "📊", color: "text-amber-600 bg-amber-50 border-amber-200" };
  if (score >= 25) return { label: "경쟁적", emoji: "⚔️", color: "text-orange-600 bg-orange-50 border-orange-200" };
  return { label: "레드오션", emoji: "🔴", color: "text-red-600 bg-red-50 border-red-200" };
}

export default function NicheFinder() {
  const [minDemand, setMinDemand] = useState(20);
  const [maxCompetition, setMaxCompetition] = useState(70);
  const [minSales, setMinSales] = useState(0);
  const [sortBy, setSortBy] = useState<SortKey>("opportunity");
  const [priceRange, setPriceRange] = useState<"all" | "low" | "mid" | "high">("all");

  const keywordStatsList = trpc.extension.listKeywordStats.useQuery(
    { sortBy: "demand_score", sortDir: "desc", limit: 500 },
  );

  // 기회 점수 계산 + 필터링 + 정렬
  const opportunities = useMemo(() => {
    if (!keywordStatsList.data) return [];

    return (keywordStatsList.data as any[])
      .map(kw => ({
        ...kw,
        opportunityScore: calcOpportunityScore(kw),
      }))
      .filter(kw => {
        if ((kw.demandScore || 0) < minDemand) return false;
        if ((kw.competitionScore || 0) > maxCompetition) return false;
        if ((kw.salesEstimate || 0) < minSales) return false;
        if (priceRange === "low" && (kw.avgPrice || 0) > 15000) return false;
        if (priceRange === "mid" && ((kw.avgPrice || 0) < 15000 || (kw.avgPrice || 0) > 50000)) return false;
        if (priceRange === "high" && (kw.avgPrice || 0) < 50000) return false;
        return true;
      })
      .sort((a, b) => {
        switch (sortBy) {
          case "opportunity": return b.opportunityScore - a.opportunityScore;
          case "demand_score": return (b.demandScore || 0) - (a.demandScore || 0);
          case "sales_estimate": return (b.salesEstimate || 0) - (a.salesEstimate || 0);
          case "competition_score": return (a.competitionScore || 0) - (b.competitionScore || 0);
          case "avg_price": return (b.avgPrice || 0) - (a.avgPrice || 0);
          default: return 0;
        }
      });
  }, [keywordStatsList.data, minDemand, maxCompetition, minSales, sortBy, priceRange]);

  const topBlueOcean = opportunities.filter(o => o.opportunityScore >= 70).length;
  const topPromising = opportunities.filter(o => o.opportunityScore >= 55 && o.opportunityScore < 70).length;

  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-[1400px] mx-auto">
        {/* 헤더 */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Gem className="w-6 h-6 text-blue-500" /> 니치 파인더
            </h2>
            <p className="text-xs text-gray-500 mt-1">수요 높고 경쟁 낮은 기회 키워드 자동 발굴 · 블루오션 탐색</p>
          </div>
          <Button variant="outline" size="sm" className="text-xs gap-1"
            onClick={() => { keywordStatsList.refetch(); toast.success("데이터 갱신됨"); }}>
            <Sparkles className="w-3 h-3" /> 새로고침
          </Button>
        </div>

        {/* 요약 카드 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="pt-3 pb-3 text-center">
            <div className="text-2xl font-bold text-indigo-600">{keywordStatsList.data?.length || 0}</div>
            <div className="text-[10px] text-gray-500">전체 키워드</div>
          </CardContent></Card>
          <Card><CardContent className="pt-3 pb-3 text-center">
            <div className="text-2xl font-bold text-green-600">{opportunities.length}</div>
            <div className="text-[10px] text-gray-500">필터 통과</div>
          </CardContent></Card>
          <Card className="border-blue-200 bg-blue-50/30"><CardContent className="pt-3 pb-3 text-center">
            <div className="text-2xl font-bold text-blue-600">{topBlueOcean}</div>
            <div className="text-[10px] text-gray-500">💎 블루오션</div>
          </CardContent></Card>
          <Card className="border-green-200 bg-green-50/30"><CardContent className="pt-3 pb-3 text-center">
            <div className="text-2xl font-bold text-emerald-600">{topPromising}</div>
            <div className="text-[10px] text-gray-500">🌟 유망</div>
          </CardContent></Card>
        </div>

        {/* 필터 */}
        <Card>
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1">
                <Filter className="w-3 h-3 text-gray-400" />
                <span className="text-[10px] font-semibold text-gray-500">필터:</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-gray-500">수요 ≥</span>
                <Input type="number" value={minDemand} onChange={e => setMinDemand(Number(e.target.value))}
                  className="h-7 w-16 text-xs text-center" />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-gray-500">경쟁 ≤</span>
                <Input type="number" value={maxCompetition} onChange={e => setMaxCompetition(Number(e.target.value))}
                  className="h-7 w-16 text-xs text-center" />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-gray-500">판매 ≥</span>
                <Input type="number" value={minSales} onChange={e => setMinSales(Number(e.target.value))}
                  className="h-7 w-16 text-xs text-center" />
              </div>
              <Select value={priceRange} onValueChange={v => setPriceRange(v as any)}>
                <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체 가격</SelectItem>
                  <SelectItem value="low">~1.5만원</SelectItem>
                  <SelectItem value="mid">1.5~5만원</SelectItem>
                  <SelectItem value="high">5만원~</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex gap-1 text-[10px]">
                {([
                  ["opportunity", "기회점수"],
                  ["demand_score", "수요"],
                  ["sales_estimate", "판매"],
                  ["competition_score", "경쟁(낮은순)"],
                  ["avg_price", "가격"],
                ] as const).map(([key, label]) => (
                  <button key={key}
                    className={`px-2 py-1 rounded-full transition ${sortBy === key ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                    onClick={() => setSortBy(key)}>{label}</button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 결과 리스트 */}
        {!opportunities.length ? (
          <Card className="border-dashed">
            <CardContent className="py-16 text-center text-gray-400">
              <Search className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium">조건에 맞는 키워드가 없습니다</p>
              <p className="text-[10px] mt-1">필터 조건을 완화하거나 더 많은 키워드를 수집하세요</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {opportunities.slice(0, 30).map((kw, i) => {
              const grade = getOpportunityGrade(kw.opportunityScore);
              return (
                <Card key={kw.id || i} className={`hover:shadow-md transition-shadow ${i < 3 ? "border-blue-200 ring-1 ring-blue-100" : ""}`}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm text-indigo-700 truncate">
                          {i < 3 && <span className="text-amber-500 mr-1">#{i + 1}</span>}
                          "{kw.query}"
                        </div>
                      </div>
                      <Badge className={`text-[9px] shrink-0 ml-2 border ${grade.color}`}>
                        {grade.emoji} {grade.label}
                      </Badge>
                    </div>

                    {/* 기회 점수 바 */}
                    <div className="mb-3">
                      <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                        <span>기회 점수</span>
                        <span className="font-bold text-blue-600">{kw.opportunityScore}</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            kw.opportunityScore >= 70 ? "bg-blue-500" :
                            kw.opportunityScore >= 55 ? "bg-green-500" :
                            kw.opportunityScore >= 40 ? "bg-amber-500" : "bg-red-400"
                          }`}
                          style={{ width: `${kw.opportunityScore}%` }}
                        />
                      </div>
                    </div>

                    {/* 메트릭 그리드 */}
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="bg-gray-50 rounded-lg py-1.5 px-1">
                        <div className="text-[9px] text-gray-400">수요</div>
                        <div className={`text-xs font-bold ${(kw.demandScore || 0) >= 50 ? "text-green-600" : "text-gray-600"}`}>{kw.demandScore || 0}</div>
                      </div>
                      <div className="bg-gray-50 rounded-lg py-1.5 px-1">
                        <div className="text-[9px] text-gray-400">경쟁</div>
                        <div className={`text-xs font-bold ${(kw.competitionScore || 0) <= 40 ? "text-green-600" : (kw.competitionScore || 0) <= 60 ? "text-amber-600" : "text-red-600"}`}>{kw.competitionScore || 0}</div>
                      </div>
                      <div className="bg-gray-50 rounded-lg py-1.5 px-1">
                        <div className="text-[9px] text-gray-400">판매추정</div>
                        <div className="text-xs font-bold text-blue-600">{(kw.salesEstimate || 0).toLocaleString()}</div>
                      </div>
                    </div>

                    <div className="flex justify-between mt-2 text-[10px] text-gray-500">
                      <span>상품수: {kw.productCount || 0}</span>
                      <span>평균가: {formatPrice(kw.avgPrice)}</span>
                      <span>리뷰+: <span className="text-green-600 font-medium">{kw.reviewGrowth > 0 ? `+${kw.reviewGrowth}` : "0"}</span></span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {opportunities.length > 30 && (
          <p className="text-center text-[10px] text-gray-400">
            상위 30개 표시 중 (전체 {opportunities.length}개)
          </p>
        )}
      </div>
    </DashboardLayout>
  );
}
