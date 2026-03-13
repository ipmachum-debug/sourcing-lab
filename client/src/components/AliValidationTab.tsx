/**
 * AliValidationTab — 알리 검증 탭
 *
 * 키워드 상세에서 알리 검증/추천/매핑 정보를 보여주는 컴포넌트
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2, ExternalLink, Link2, Star, TrendingUp,
  Package, ShoppingCart, CheckCircle, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

interface AliValidationTabProps {
  keywordId: number;
  keyword: string;
  canonicalKeyword?: string;
}

function formatNum(n: number | null | undefined) {
  if (n === null || n === undefined || n === 0) return "-";
  return n.toLocaleString("ko-KR");
}

function scoreColor(score: number) {
  if (score >= 0.8) return "text-green-600";
  if (score >= 0.6) return "text-blue-500";
  if (score >= 0.4) return "text-yellow-600";
  return "text-red-500";
}

function scoreBg(score: number) {
  if (score >= 0.8) return "bg-green-50 border-green-200";
  if (score >= 0.6) return "bg-blue-50 border-blue-200";
  if (score >= 0.4) return "bg-yellow-50 border-yellow-200";
  return "bg-red-50 border-red-200";
}

export default function AliValidationTab({ keywordId, keyword, canonicalKeyword }: AliValidationTabProps) {
  const [connectingUrl, setConnectingUrl] = useState<string | null>(null);

  const summary = trpc.aliValidation.getKeywordAliSummary.useQuery(
    { keywordId },
    { enabled: keywordId > 0 },
  );

  const createMappingMut = trpc.aliValidation.createMapping.useMutation({
    onSuccess: () => {
      toast.success("알리 상품이 연결되었습니다.");
      setConnectingUrl(null);
      summary.refetch();
    },
    onError: e => {
      toast.error(e.message || "연결 실패");
      setConnectingUrl(null);
    },
  });

  const updateMappingMut = trpc.aliValidation.updateMapping.useMutation({
    onSuccess: () => {
      toast.success("매핑이 업데이트되었습니다.");
      summary.refetch();
    },
  });

  if (summary.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (summary.error) {
    return (
      <div className="text-sm text-red-500 py-4 text-center">
        데이터를 불러올 수 없습니다: {summary.error.message}
      </div>
    );
  }

  const data = summary.data;
  if (!data) return null;

  const coupangAvgPrice = data.metrics?.coupangAvgPrice
    ? Number(data.metrics.coupangAvgPrice) : 0;

  return (
    <div className="space-y-4">
      {/* 상단: 키워드 정보 + 쿠팡 데이터 */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-xs font-semibold text-muted-foreground mb-1">쿠팡 키워드</div>
            <div className="text-sm font-bold">{data.keyword.keyword}</div>
            {data.keyword.canonicalKeyword && (
              <div className="text-xs text-muted-foreground mt-1">
                정규화: {data.keyword.canonicalKeyword}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs font-semibold text-muted-foreground mb-1">쿠팡 시장</div>
            <div className="text-sm font-bold">
              평균가 {coupangAvgPrice > 0 ? formatNum(coupangAvgPrice) + "원" : "-"}
            </div>
            {data.metrics && (
              <div className="text-xs text-muted-foreground mt-1">
                상품수: {formatNum(data.metrics.coupangProductCount)} | 리뷰합: {formatNum(data.metrics.coupangTop10ReviewSum)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 검색어 추천 */}
      <Card>
        <CardContent className="p-3">
          <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
            <Package className="w-3 h-3" />
            추천 알리 검색어
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.searchQueries.map((q, i) => (
              <a
                key={i}
                href={`https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(q)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-indigo-50 text-indigo-700 rounded-md hover:bg-indigo-100 transition-colors border border-indigo-200"
              >
                {q}
                <ExternalLink className="w-3 h-3" />
              </a>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 연결된 알리 상품 */}
      {data.mappings.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
              <Link2 className="w-3 h-3" />
              연결된 알리 상품 ({data.mappings.length}개)
            </div>
            <div className="space-y-2">
              {data.mappings.map(m => {
                const price = Number(m.selectedPrice) || 0;
                const totalCost = Number(m.selectedTotalCost) || 0;
                const marginRatio = totalCost > 0 && coupangAvgPrice > 0
                  ? (coupangAvgPrice / totalCost).toFixed(1) : "-";

                return (
                  <div
                    key={m.id}
                    className={`p-2.5 rounded-lg border text-xs ${m.isPrimary ? "border-blue-300 bg-blue-50" : "border-gray-200"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          {m.isPrimary && <Badge variant="default" className="text-[9px] px-1 py-0">주력</Badge>}
                          <Badge variant="outline" className="text-[9px] px-1 py-0">{m.matchDirection === "forward" ? "정방향" : "역방향"}</Badge>
                          <span className={`font-bold ${scoreColor(Number(m.matchScore))}`}>
                            {(Number(m.matchScore) * 100).toFixed(0)}점
                          </span>
                        </div>
                        <a
                          href={m.aliProductUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline truncate block"
                        >
                          {m.aliProductTitle.substring(0, 60)}...
                        </a>
                        <div className="flex items-center gap-3 mt-1 text-muted-foreground">
                          <span>${price.toFixed(2)}</span>
                          <span>주문 {formatNum(m.selectedOrderCount)}</span>
                          <span>마진비 {marginRatio}x</span>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {!m.isPrimary && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[10px] px-2"
                            onClick={() => updateMappingMut.mutate({
                              mappingId: m.id,
                              isPrimary: true,
                            })}
                          >
                            주력 전환
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 추천 알리 상품 (캐시된 결과) */}
      {data.cachedResults.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
              <ShoppingCart className="w-3 h-3" />
              추천 알리 상품 ({data.cachedResults.length}개)
            </div>
            <div className="space-y-2">
              {data.cachedResults.slice(0, 10).map(r => {
                const score = Number(r.matchScore) || 0;
                const price = Number(r.priceMin) || 0;
                const exchangeRate = 1350;
                const totalCostKRW = Math.round(price * exchangeRate * 1.08) + 6000;
                const marginRatio = coupangAvgPrice > 0 && totalCostKRW > 0
                  ? (coupangAvgPrice / totalCostKRW).toFixed(1) : "-";
                const isConnecting = connectingUrl === r.productUrl;
                const alreadyMapped = data.mappings.some(m =>
                  m.aliProductUrl === r.productUrl,
                );

                return (
                  <div
                    key={r.id}
                    className={`p-2.5 rounded-lg border ${scoreBg(score)} text-xs`}
                  >
                    <div className="flex items-start gap-2">
                      {r.productImageUrl && (
                        <img
                          src={r.productImageUrl}
                          alt=""
                          className="w-12 h-12 rounded object-cover flex-shrink-0"
                          loading="lazy"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className={`font-bold ${scoreColor(score)}`}>
                            {(score * 100).toFixed(0)}점
                          </span>
                          {Number(r.attributeMatchScore) >= 0.7 && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 border-green-300 text-green-700">속성일치</Badge>
                          )}
                        </div>
                        <a
                          href={r.productUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline line-clamp-2"
                        >
                          {r.productTitle.substring(0, 80)}
                        </a>
                        <div className="flex items-center gap-3 mt-1 text-muted-foreground">
                          <span className="font-semibold text-red-600">${price.toFixed(2)}</span>
                          <span>주문 {formatNum(r.orderCount)}</span>
                          <span>평점 {Number(r.rating).toFixed(1)}</span>
                          <span>마진비 {marginRatio}x</span>
                        </div>
                      </div>
                      <div>
                        {alreadyMapped ? (
                          <Badge variant="secondary" className="text-[9px]">
                            <CheckCircle className="w-3 h-3 mr-0.5" /> 연결됨
                          </Badge>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[10px] px-2"
                            disabled={isConnecting}
                            onClick={() => {
                              setConnectingUrl(r.productUrl);
                              createMappingMut.mutate({
                                keywordId,
                                aliProductUrl: r.productUrl,
                                aliProductTitle: r.productTitle,
                                selectedPrice: price,
                                selectedOrderCount: r.orderCount || 0,
                                selectedRating: Number(r.rating) || 0,
                                matchScore: score,
                                matchDirection: "forward",
                                isPrimary: data.mappings.length === 0,
                              });
                            }}
                          >
                            {isConnecting ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <>
                                <Link2 className="w-3 h-3 mr-0.5" /> 연결
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 데이터 없을 때 */}
      {data.cachedResults.length === 0 && data.mappings.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <div className="text-sm">아직 알리 검색 결과가 없습니다.</div>
          <div className="text-xs mt-1">
            확장프로그램에서 알리 검색 후 결과가 자동으로 연동됩니다.
          </div>
          <div className="flex flex-wrap justify-center gap-1.5 mt-3">
            {data.searchQueries.slice(0, 3).map((q, i) => (
              <a
                key={i}
                href={`https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(q)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs bg-indigo-500 text-white rounded-md hover:bg-indigo-600 transition-colors"
              >
                {q} 검색하기
                <ExternalLink className="w-3 h-3" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
