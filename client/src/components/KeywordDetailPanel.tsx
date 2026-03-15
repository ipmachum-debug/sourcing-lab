import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Info } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, AreaChart, Area, Legend, ComposedChart, ReferenceLine,
} from "recharts";

function formatPrice(n: number | null | undefined) {
  if (n === null || n === undefined) return "-";
  return n.toLocaleString("ko-KR") + "원";
}

interface KeywordDetailPanelProps {
  keyword: string;
  days: number;
  onChangeDays: (days: number) => void;
  dailyStats: any[] | undefined;
  marketOverview: any | undefined;
}

export default function KeywordDetailPanel({
  keyword, days, onChangeDays, dailyStats, marketOverview,
}: KeywordDetailPanelProps) {
  return (
    <>
      <Card className="border-orange-200">
        <CardHeader className="pb-2 bg-gradient-to-r from-orange-50 to-amber-50">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Activity className="w-4 h-4 text-orange-500" />
            "{keyword}" 추이
          </CardTitle>
          <div className="flex gap-1 mt-1 flex-wrap">
            {[7, 14, 30, 60, 90, 180, 365].map(d => (
              <button key={d} className={`px-2 py-0.5 text-[10px] rounded-full ${days === d ? "bg-orange-600 text-white" : "bg-gray-100"}`}
                onClick={() => onChangeDays(d)}>{d <= 60 ? `${d}일` : d === 90 ? "3개월" : d === 180 ? "6개월" : "1년"}</button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="pt-3">
          {dailyStats && dailyStats.length > 0 ? (() => {
            const chartData = dailyStats.filter(
              (d: any) => d.dataStatus !== "baseline" && d.dataStatus !== "missing"
            ).map((d: any) => ({
              ...d,
              reviewGrowthReal: d.dataStatus === "raw_valid" ? d.reviewGrowth : undefined,
              reviewGrowthInterp: d.dataStatus !== "raw_valid" ? d.reviewGrowth : undefined,
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
                <ChartSection title="판매 추정 (7일 이동평균)">
                  <ResponsiveContainer width="100%" height={200}>
                    <ComposedChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="statDate" tick={{ fontSize: 9 }} tickFormatter={v => v.slice(5)} />
                      <YAxis yAxisId="sales" tick={{ fontSize: 9 }} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v} />
                      <YAxis yAxisId="review" orientation="right" tick={{ fontSize: 9, fill: "#22c55e" }} label={{ value: "리뷰증가", angle: 90, position: "insideRight", style: { fontSize: 8, fill: "#22c55e" }, offset: 10 }} />
                      <Tooltip contentStyle={{ fontSize: 11 }} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Bar yAxisId="review" dataKey="reviewGrowthReal" fill="#22c55e" name="리뷰 증가" radius={[3, 3, 0, 0]} stackId="rg" barSize={14} />
                      <Bar yAxisId="review" dataKey="reviewGrowthInterp" fill="#86efac" name="리뷰 증가(보간)" radius={[3, 3, 0, 0]} stackId="rg" fillOpacity={0.45} barSize={14} />
                      <Area yAxisId="sales" type="monotone" dataKey="salesEstimateMa7" fill="#dbeafe" stroke="#2563eb" strokeWidth={2} name="판매추정(MA7)" fillOpacity={0.35} connectNulls />
                      <Line yAxisId="sales" type="monotone" dataKey="salesEstimateMa30" stroke="#f97316" strokeWidth={1.5} strokeDasharray="4 2" name="MA30" dot={false} connectNulls />
                    </ComposedChart>
                  </ResponsiveContainer>
                </ChartSection>

                <ChartSection title="경쟁도 / 수요점수 / 종합점수">
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
                </ChartSection>

                <ChartSection title="평균가 / 상품수 추이">
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
                </ChartSection>

                {/* 시장 개요 */}
                {marketOverview && (
                  <div className="mt-4 pt-3 border-t border-gray-100">
                    <div className="text-[10px] font-semibold text-gray-500 mb-2 flex items-center gap-1.5">
                      시장 개요 ({marketOverview.totalItems}개 분석)
                      {!marketOverview.isToday && (
                        <Badge variant="outline" className="text-[8px] px-1 py-0 border-amber-300 text-amber-600">
                          {marketOverview.snapshotDate?.slice(5)} 기준
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-2 mb-2">
                      <StatBox label="상품수" value={marketOverview.totalItems} color="blue" />
                      <StatBox label="평균가" value={formatPrice(marketOverview.avgPrice)} color="red" />
                      <StatBox label="평균평점" value={`★ ${marketOverview.avgRating.toFixed(1)}`} color="yellow" />
                      <StatBox label="총 리뷰수" value={marketOverview.totalReviewSum.toLocaleString()} color="green" />
                    </div>
                    <div className="bg-gray-50 rounded-lg text-[10px]">
                      <div className="grid grid-cols-2 divide-x divide-gray-200">
                        <div className="p-1.5 flex justify-between">
                          <span className="text-gray-500">가격 범위</span>
                          <span className="font-medium">{formatPrice(marketOverview.minPrice)} ~ {formatPrice(marketOverview.maxPrice)}</span>
                        </div>
                        <div className="p-1.5 flex justify-between">
                          <span className="text-gray-500">광고 비율</span>
                          <span className="font-medium">{marketOverview.adCount}개 ({marketOverview.adRatio}%)</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 divide-x divide-gray-200 border-t border-gray-200">
                        <div className="p-1.5 flex justify-between">
                          <span className="text-gray-500">리뷰 100+</span>
                          <span className="font-medium text-red-600">{marketOverview.highReviewCount}개 ({marketOverview.highReviewRatio}%)</span>
                        </div>
                        <div className="p-1.5 flex justify-between">
                          <span className="text-gray-500">로켓배송</span>
                          <span className="font-medium text-blue-600">{marketOverview.rocketCount}개 ({marketOverview.rocketRatio}%)</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
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

      {/* 일별 상세 데이터 테이블 */}
      {dailyStats && dailyStats.length > 0 && (
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
                  {dailyStats.slice().reverse()
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

      {/* 점수 설명 */}
      <Card className="bg-gray-50">
        <CardContent className="pt-3 pb-3">
          <div className="text-[10px] font-semibold text-gray-600 mb-2 flex items-center gap-1"><Info className="w-3 h-3" /> 키워드 점수 산출 기준</div>
          <div className="space-y-1.5 text-[10px] text-gray-500">
            <div><span className="font-medium text-green-600">리뷰증가</span>: 동일 상품(productId)의 리뷰 변화만 추적</div>
            <div><span className="font-medium text-green-600">판매추정</span>: 리뷰증가 × 20 → MA7 기반 안정화</div>
            <div><span className="font-medium text-orange-600">수요점수</span>: 판매추정 로그스케일(80%) + 시장규모(20%)</div>
            <div><span className="font-medium text-purple-600">종합점수</span>: 성장성(30%) + 시장규모(25%) + 진입용이성(25%) + 수요(20%)</div>
            <div><span className="font-medium text-red-600">경쟁도</span>: 리뷰수(35%) + 고리뷰비율(25%) + 평점(20%) + 광고비율(20%)</div>
            <div className="pt-1 border-t border-gray-200 mt-1"><span className="font-medium text-pink-600">소싱점수</span>: 시장기회(45%) + 분석완성도(35%) + 차별화전략(20%) → 80점↑ 테스트후보</div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function ChartSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-gray-500 mb-1">{title}</div>
      {children}
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string | number; color: string }) {
  const colorMap: Record<string, string> = {
    blue: "bg-blue-50 text-blue-700",
    red: "bg-red-50 text-red-600",
    yellow: "bg-yellow-50 text-yellow-700",
    green: "bg-green-50 text-green-700",
  };
  return (
    <div className={`rounded-lg p-2 text-center ${colorMap[color] || ""}`}>
      <div className="text-sm font-bold">{value}</div>
      <div className="text-[9px] text-gray-500">{label}</div>
    </div>
  );
}
