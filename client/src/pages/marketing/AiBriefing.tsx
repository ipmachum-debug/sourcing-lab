import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, AlertTriangle, CheckCircle2, Info, ArrowRight, Bot } from "lucide-react";
import { toast } from "sonner";

export default function AiBriefing() {
  const utils = trpc.useUtils();
  const briefing = trpc.marketing.briefing.getToday.useQuery();
  const history = trpc.marketing.briefing.list.useQuery();
  const regenerate = trpc.marketing.briefing.regenerate.useMutation({
    onSuccess: () => {
      toast.success("브리핑이 새로 생성되었습니다.");
      utils.marketing.briefing.getToday.invalidate();
      utils.marketing.briefing.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const markRead = trpc.marketing.briefing.markRead.useMutation({
    onSuccess: () => utils.marketing.briefing.getToday.invalidate(),
  });

  const alertIcon = (level: string) => {
    if (level === "danger") return <AlertTriangle className="h-4 w-4 text-red-500" />;
    if (level === "warning") return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    return <Info className="h-4 w-4 text-blue-500" />;
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-5xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">AI 브리핑</h1>
            <p className="text-muted-foreground text-sm mt-1">매일 AI가 분석하는 마케팅 현황 리포트</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => regenerate.mutate()} disabled={regenerate.isPending}>
            <RefreshCw className={`h-4 w-4 mr-1 ${regenerate.isPending ? "animate-spin" : ""}`} />
            다시 생성
          </Button>
        </div>

        {/* 오늘 브리핑 */}
        {briefing.data && (
          <Card className="border-blue-200 bg-gradient-to-br from-blue-50/80 to-indigo-50/50 dark:from-blue-950/30 dark:to-indigo-950/20 dark:border-blue-800">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Bot className="h-5 w-5" />
                  오늘의 브리핑 — {briefing.data.briefingDate}
                </CardTitle>
                {!briefing.data.isRead && (
                  <Badge variant="default" className="text-xs cursor-pointer"
                    onClick={() => markRead.mutate({ id: briefing.data!.id })}>
                    NEW
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* 요약 */}
              <p className="text-sm leading-relaxed">{briefing.data.summary}</p>

              {/* 알림 */}
              {(briefing.data.alerts as any[])?.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">알림</p>
                  {(briefing.data.alerts as any[]).map((alert: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 p-2 bg-white/70 dark:bg-gray-900/50 rounded-md">
                      {alertIcon(alert.level)}
                      <span className="text-sm">{alert.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* 할 일 */}
              {(briefing.data.actionItems as any[])?.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">오늘 할 일</p>
                  {(briefing.data.actionItems as any[]).map((item: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-white/70 dark:bg-gray-900/50 rounded-md border">
                      <div className="flex items-center gap-2">
                        <Badge variant={item.priority === "high" ? "destructive" : item.priority === "medium" ? "secondary" : "outline"} className="text-xs">
                          {item.priority === "high" ? "긴급" : item.priority === "medium" ? "보통" : "낮음"}
                        </Badge>
                        <div>
                          <p className="text-sm font-medium">{item.title}</p>
                          <p className="text-xs text-muted-foreground">{item.description}</p>
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </div>
                  ))}
                </div>
              )}

              {/* 추천 */}
              {(briefing.data.recommendations as any[])?.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">AI 추천</p>
                  {(briefing.data.recommendations as any[]).map((rec: any, i: number) => (
                    <div key={i} className="p-3 bg-white/70 dark:bg-gray-900/50 rounded-md border text-sm">
                      <p className="font-medium">{rec.content}</p>
                      <p className="text-xs text-muted-foreground mt-1">이유: {rec.reason}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 히스토리 */}
        {history.data && history.data.length > 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">이전 브리핑</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {history.data.filter(b => b.briefingDate !== briefing.data?.briefingDate).map(b => (
                <div key={b.id} className="p-3 border rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{b.briefingDate}</span>
                    {b.isRead ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <Badge variant="secondary" className="text-xs">미읽음</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2">{b.summary}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
