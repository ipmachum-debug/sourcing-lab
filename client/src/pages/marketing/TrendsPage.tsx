import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useState } from "react";
import { toast } from "sonner";
import { TrendingUp, RefreshCw, Sparkles, ArrowUpRight, ArrowDownRight, Minus, Zap } from "lucide-react";

export default function TrendsPage() {
  const [showOnlyActionable, setShowOnlyActionable] = useState(false);
  const utils = trpc.useUtils();
  const trends = trpc.marketing.viral.trends.list.useQuery(
    showOnlyActionable ? { onlyActionable: true } : undefined
  );
  const refreshMut = trpc.marketing.viral.trends.refresh.useMutation({
    onSuccess: () => {
      toast.success("트렌드를 새로 분석했습니다.");
      utils.marketing.viral.trends.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const changeIcon = (change: string | null) => {
    const val = Number(change || 0);
    if (val > 5) return <ArrowUpRight className="h-3 w-3 text-green-500" />;
    if (val < -5) return <ArrowDownRight className="h-3 w-3 text-red-500" />;
    return <Minus className="h-3 w-3 text-gray-400" />;
  };

  const scoreBar = (score: number) => {
    const color = score >= 70 ? "bg-red-500" : score >= 50 ? "bg-orange-500" : score >= 30 ? "bg-yellow-500" : "bg-gray-300";
    return (
      <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${score}%` }} />
      </div>
    );
  };

  return (
    <DashboardLayout>
      <div className="p-4 space-y-4 max-w-full mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <TrendingUp className="h-6 w-6 text-orange-500" /> 트렌드 감지
            </h1>
            <p className="text-muted-foreground text-sm mt-1">내 브랜드와 관련된 실시간 트렌드 키워드</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">활용 가능만</span>
              <Switch checked={showOnlyActionable} onCheckedChange={setShowOnlyActionable} />
            </div>
            <Button variant="outline" size="sm" onClick={() => refreshMut.mutate()}
              disabled={refreshMut.isPending}>
              <RefreshCw className={`h-4 w-4 mr-1 ${refreshMut.isPending ? "animate-spin" : ""}`} />
              분석
            </Button>
          </div>
        </div>

        {trends.data?.length === 0 && (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              <TrendingUp className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>트렌드 데이터가 없습니다.</p>
              <p className="text-sm">브랜드와 상품을 등록하면 AI가 관련 트렌드를 자동으로 분석합니다.</p>
              <Button className="mt-4" onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}>
                <Sparkles className="h-4 w-4 mr-1" />지금 분석하기
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {trends.data?.map(trend => (
            <Card key={trend.id} className={trend.isActionable ? "border-orange-200 dark:border-orange-800" : ""}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="text-center w-12">
                      <p className="text-xl font-bold">{trend.trendScore}</p>
                      <p className="text-[10px] text-muted-foreground">점수</p>
                    </div>
                    {scoreBar(trend.trendScore)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium">{trend.keyword}</h3>
                        <Badge variant="outline" className="text-xs">{trend.category}</Badge>
                        {trend.isActionable && (
                          <Badge variant="default" className="text-xs">
                            <Zap className="h-2.5 w-2.5 mr-0.5" />활용 가능
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {trend.volume && (
                          <span className="text-xs text-muted-foreground">검색량: {trend.volume.toLocaleString()}</span>
                        )}
                        {trend.volumeChange && (
                          <span className="text-xs flex items-center gap-0.5">
                            {changeIcon(trend.volumeChange)}
                            {Number(trend.volumeChange) > 0 ? "+" : ""}{trend.volumeChange}%
                          </span>
                        )}
                      </div>
                      {trend.suggestedAction && (
                        <p className="text-sm text-blue-600 dark:text-blue-400 mt-1">
                          💡 {trend.suggestedAction}
                        </p>
                      )}
                      {(trend.relatedKeywords as string[])?.length > 0 && (
                        <div className="flex gap-1 mt-1">
                          {(trend.relatedKeywords as string[]).slice(0, 5).map((k, i) => (
                            <Badge key={i} variant="secondary" className="text-[10px]">{k}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
