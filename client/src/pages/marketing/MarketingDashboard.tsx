import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import {
  BarChart3, TrendingUp, AlertTriangle, CheckCircle2,
  ArrowRight, RefreshCw, Eye, Heart, MessageSquare, MousePointerClick,
} from "lucide-react";

export default function MarketingDashboard() {
  const [, navigate] = useLocation();
  const briefing = trpc.marketing.briefing.getToday.useQuery();
  const summary = trpc.marketing.analytics.getSummary.useQuery();
  const queuedPosts = trpc.marketing.channels.listPosts.useQuery({ status: "queued" });

  const alertColor = (level: string) => {
    if (level === "danger") return "destructive";
    if (level === "warning") return "secondary";
    return "outline";
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">마케팅 Today</h1>
            <p className="text-muted-foreground text-sm mt-1">AI 비서가 오늘의 마케팅 현황을 알려드립니다</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => briefing.refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" />
            새로고침
          </Button>
        </div>

        {/* AI 브리핑 카드 */}
        {briefing.data && (
          <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <span className="text-xl">🤖</span> AI 브리핑
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-relaxed">{briefing.data.summary}</p>

              {/* 알림 */}
              {(briefing.data.alerts as any[])?.length > 0 && (
                <div className="space-y-2">
                  {(briefing.data.alerts as any[]).map((alert: any, i: number) => (
                    <div key={i} className="flex items-start gap-2">
                      <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${alert.level === "danger" ? "text-red-500" : "text-yellow-500"}`} />
                      <span className="text-sm">{alert.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* 액션 아이템 */}
              {(briefing.data.actionItems as any[])?.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase">오늘 할 일</p>
                  {(briefing.data.actionItems as any[]).map((item: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-2 bg-white dark:bg-gray-900 rounded-md border">
                      <div className="flex items-center gap-2">
                        <Badge variant={item.priority === "high" ? "destructive" : "secondary"} className="text-xs">
                          {item.priority === "high" ? "긴급" : item.priority === "medium" ? "보통" : "낮음"}
                        </Badge>
                        <div>
                          <p className="text-sm font-medium">{item.title}</p>
                          <p className="text-xs text-muted-foreground">{item.description}</p>
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  ))}
                </div>
              )}

              {/* 추천 */}
              {(briefing.data.recommendations as any[])?.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase">AI 추천</p>
                  {(briefing.data.recommendations as any[]).map((rec: any, i: number) => (
                    <div key={i} className="p-2 bg-white dark:bg-gray-900 rounded-md border text-sm">
                      <p>{rec.content}</p>
                      <p className="text-xs text-muted-foreground mt-1">💡 {rec.reason}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 성과 요약 */}
        {summary.data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <Eye className="h-5 w-5 mx-auto text-blue-500 mb-1" />
                <p className="text-2xl font-bold">{Number(summary.data.stats.totalViews).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">총 조회수 (7일)</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <Heart className="h-5 w-5 mx-auto text-red-500 mb-1" />
                <p className="text-2xl font-bold">{Number(summary.data.stats.totalLikes).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">총 좋아요</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <MousePointerClick className="h-5 w-5 mx-auto text-green-500 mb-1" />
                <p className="text-2xl font-bold">{Number(summary.data.stats.totalClicks).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">총 클릭</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <TrendingUp className="h-5 w-5 mx-auto text-purple-500 mb-1" />
                <p className="text-2xl font-bold">{summary.data.published}</p>
                <p className="text-xs text-muted-foreground">발행 완료</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 빠른 액션 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="cursor-pointer hover:shadow-md transition" onClick={() => navigate("/marketing/content")}>
            <CardContent className="p-5 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                <span className="text-lg">✍️</span>
              </div>
              <div>
                <p className="font-medium text-sm">콘텐츠 생성</p>
                <p className="text-xs text-muted-foreground">AI로 마케팅 카피 만들기</p>
              </div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition" onClick={() => navigate("/marketing/queue")}>
            <CardContent className="p-5 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <span className="text-lg">📤</span>
              </div>
              <div>
                <p className="font-medium text-sm">발행 큐</p>
                <p className="text-xs text-muted-foreground">
                  대기 {queuedPosts.data?.length || 0}건
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition" onClick={() => navigate("/marketing/analytics")}>
            <CardContent className="p-5 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <span className="text-lg">📊</span>
              </div>
              <div>
                <p className="font-medium text-sm">성과 분석</p>
                <p className="text-xs text-muted-foreground">채널별 성과 확인</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
