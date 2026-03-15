import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Pin, PinOff, Plus, Trash2, Activity,
} from "lucide-react";
import { calibrateSales } from "@/lib/salesCalibration";

function formatPrice(n: number | null | undefined) {
  if (n === null || n === undefined) return "-";
  return n.toLocaleString("ko-KR") + "원";
}

interface KeywordTableProps {
  keywords: any[];
  selectedKw: string | null;
  selectedDeleteKws: Set<string>;
  onSelectKw: (kw: string) => void;
  onToggleDelete: (kw: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onTogglePin: (watchId: number, isPinned: boolean) => void;
  onOpenSourcing: (prefill: Record<string, any>) => void;
  onDeleteKw: (query: string) => void;
}

export default function KeywordTable({
  keywords, selectedKw, selectedDeleteKws,
  onSelectKw, onToggleDelete, onSelectAll, onDeselectAll,
  onTogglePin, onOpenSourcing, onDeleteKw,
}: KeywordTableProps) {
  if (!keywords.length) {
    return (
      <div className="text-center py-10 text-gray-400">
        <Activity className="w-10 h-10 mx-auto mb-2 opacity-20" />
        <p className="text-sm font-medium">데이터가 없습니다</p>
        <p className="text-[10px] mt-1">쿠팡에서 검색한 뒤 "통계 계산" 버튼을 눌러주세요</p>
      </div>
    );
  }

  const allChecked = selectedDeleteKws.size > 0 && selectedDeleteKws.size === keywords.length;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b bg-gray-50 text-gray-500 text-[10px]">
            <th className="p-2 text-center w-8">
              <input type="checkbox" checked={allChecked}
                onChange={e => e.target.checked ? onSelectAll() : onDeselectAll()} />
            </th>
            <th className="p-2 text-left">키워드</th>
            <th className="p-2 text-center">상품수</th>
            <th className="p-2 text-center">평균가</th>
            <th className="p-2 text-center">리뷰증가</th>
            <th className="p-2 text-center">판매추정</th>
            <th className="p-2 text-center">검색량</th>
            <th className="p-2 text-center">경쟁도</th>
            <th className="p-2 text-center">수요</th>
            <th className="p-2 text-center">종합</th>
            <th className="p-2 text-center">-</th>
          </tr>
        </thead>
        <tbody>
          {keywords.map((kw: any) => {
            const isSelected = selectedKw === kw.query;
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
              <tr key={kw.id ?? `uncollected-${kw.query}`}
                className={`border-b cursor-pointer transition ${isSelected ? "bg-orange-50 ring-1 ring-orange-200" : "hover:bg-gray-50"}`}
                onClick={() => onSelectKw(kw.query)}>
                <td className="p-2 text-center" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={isChecked}
                    onChange={() => onToggleDelete(kw.query)} />
                </td>
                <td className="p-2 font-medium text-indigo-600 max-w-[160px]">
                  <div className="flex items-center gap-1">
                    {kw.isPinned && <Pin className="w-3 h-3 text-amber-500 flex-shrink-0" />}
                    <span className="truncate">"{kw.query}"</span>
                    {kw.dataStatus === "uncollected" && (
                      <Badge className="text-[7px] px-1 py-0 bg-red-50 text-red-600 border border-red-200 flex-shrink-0">미수집</Badge>
                    )}
                  </div>
                </td>
                <td className="p-2 text-center">{kw.productCount || 0}</td>
                <td className="p-2 text-center text-red-500 font-medium">{formatPrice(kw.avgPrice)}</td>
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
                  {kw.monthlySearchVolume != null ? (
                    <span className="font-medium text-purple-600">{kw.monthlySearchVolume.toLocaleString()}</span>
                  ) : (
                    <span className="text-gray-300 text-[9px]">-</span>
                  )}
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
                    <Button variant="ghost" size="sm"
                      className={`h-5 w-5 p-0 ${kw.isPinned ? "text-amber-500" : "text-gray-300 hover:text-amber-400"}`}
                      title={kw.isPinned ? "핀 해제" : "핀 고정 (배치 최우선)"}
                      disabled={!kw.watchId}
                      onClick={() => kw.watchId && onTogglePin(kw.watchId, !kw.isPinned)}>
                      {kw.isPinned ? <Pin className="w-3 h-3" /> : <PinOff className="w-3 h-3" />}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-pink-500" title="소싱 등록"
                      onClick={() => onOpenSourcing({
                        source: "keyword", keyword: kw.query,
                        productCount: kw.productCount, avgPrice: kw.avgPrice,
                        competitionScore: kw.competitionScore, demandScore: kw.demandScore,
                        keywordScore: kw.keywordScore, salesEstimate: cal.correctedSalesEst,
                        reviewGrowth: kw.reviewGrowth, competitionLevel: kw.competitionLevel,
                      })}>
                      <Plus className="w-3 h-3" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-red-400"
                      onClick={() => { if (confirm(`"${kw.query}" 키워드를 삭제할까요?`)) onDeleteKw(kw.query); }}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
