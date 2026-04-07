import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Flame, TrendingUp, Zap, ArrowRight, RefreshCw, Share2, Eye, Heart, Clock } from "lucide-react";

const PLATFORM_EMOJI: Record<string, string> = {
  instagram: "📸", youtube: "🎬", tiktok: "🎵",
  naver_blog: "📝", naver_cafe: "☕", kakao: "💬",
};

export default function ViralMonitor() {
  const activeViral = trpc.marketing.viral.monitor.activeViral.useQuery();
  const topPosts = trpc.marketing.viral.monitor.topPosts.useQuery({ days: 7 });
  const viralLog = trpc.marketing.viral.monitor.getLog.useQuery({ limit: 20 });
  const crossPosts = trpc.marketing.viral.monitor.crossPosts.useQuery();

  const scoreMut = trpc.marketing.viral.monitor.scorePost.useMutation({
    onSuccess: () => {
      activeViral.refetch();
      topPosts.refetch();
    },
  });

  const scoreColor = (score: number) => {
    if (score >= 80) return "text-red-500";
    if (score >= 60) return "text-orange-500";
    if (score >= 40) return "text-yellow-500";
    return "text-gray-400";
  };

  const eventTypeLabels: Record<string, { label: string; color: string }> = {
    viral_detected: { label: "바이럴 감지", color: "bg-red-100 text-red-700" },
    boost_triggered: { label: "부스팅", color: "bg-purple-100 text-purple-700" },
    cross_posted: { label: "크로스포스팅", color: "bg-blue-100 text-blue-700" },
    content_published: { label: "발행", color: "bg-green-100 text-green-700" },
    review_collected: { label: "리뷰 수집", color: "bg-yellow-100 text-yellow-700" },
    trend_detected: { label: "트렌드", color: "bg-cyan-100 text-cyan-700" },
    auto_responded: { label: "자동응답", color: "bg-indigo-100 text-indigo-700" },
    content_created: { label: "콘텐츠", color: "bg-gray-100 text-gray-700" },
    feedback_generated: { label: "AI분석", color: "bg-emerald-100 text-emerald-700" },
  };

  return (
    <DashboardLayout>
      <div className="p-4 space-y-4 max-w-full mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Flame className="h-6 w-6 text-red-500" /> 바이럴 모니터
            </h1>
            <p className="text-muted-foreground text-sm mt-1">실시간 확산 추적 + 자동 부스팅 + 크로스 포스팅</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => { activeViral.refetch(); topPosts.refetch(); viralLog.refetch(); }}>
            <RefreshCw className="h-4 w-4 mr-1" />새로고침
          </Button>
        </div>

        {/* 현재 바이럴 중 */}
        {activeViral.data && activeViral.data.length > 0 && (
          <Card className="border-red-200 bg-red-50/50 dark:bg-red-950/10 dark:border-red-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Flame className="h-5 w-5 text-red-500 animate-pulse" /> 지금 터지고 있는 게시물
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {activeViral.data.map(v => (
                <div key={v.id} className="flex items-center justify-between p-3 bg-white dark:bg-gray-900 rounded-lg border">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{PLATFORM_EMOJI[v.platform] || "📱"}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`text-2xl font-bold ${scoreColor(v.viralScore)}`}>{v.viralScore}</span>
                        <Badge variant="destructive" className="text-xs">바이럴</Badge>
                      </div>
                      <div className="flex gap-3 text-xs text-muted-foreground mt-1">
                        <span>속도: {Number(v.velocity).toFixed(1)}/hr</span>
                        <span>참여율: {Number(v.engagementRate).toFixed(1)}%</span>
                        <span>공유율: {Number(v.shareRatio).toFixed(1)}%</span>
                      </div>
                    </div>
                  </div>
                  {v.isBoosted && <Badge variant="secondary">부스팅 중</Badge>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Top 게시물 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="h-5 w-5" /> 바이럴 스코어 Top
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topPosts.data?.length === 0 && (
              <p className="text-center text-muted-foreground py-6 text-sm">
                발행된 게시물이 쌓이면 바이럴 스코어가 표시됩니다.
              </p>
            )}
            <div className="space-y-2">
              {topPosts.data?.map((v, i) => (
                <div key={v.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/30">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-muted-foreground w-6">{i + 1}</span>
                    <span>{PLATFORM_EMOJI[v.platform] || "📱"}</span>
                    <span className={`text-xl font-bold ${scoreColor(v.viralScore)}`}>{v.viralScore}</span>
                    <div className="text-xs text-muted-foreground">
                      <span>참여 {Number(v.engagementRate).toFixed(1)}%</span>
                      <span className="mx-1">·</span>
                      <span>공유 {Number(v.shareRatio).toFixed(1)}%</span>
                    </div>
                  </div>
                  {v.isViral && <Flame className="h-4 w-4 text-red-500" />}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 크로스 포스팅 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Share2 className="h-5 w-5" /> 크로스 포스팅
              </CardTitle>
            </CardHeader>
            <CardContent>
              {crossPosts.data?.length === 0 && (
                <p className="text-center text-muted-foreground py-4 text-sm">
                  바이럴 감지 시 자동으로 다른 채널에 변환됩니다.
                </p>
              )}
              <div className="space-y-2">
                {crossPosts.data?.map(cp => (
                  <div key={cp.id} className="flex items-center gap-2 p-2 border rounded text-sm">
                    <span>{PLATFORM_EMOJI[cp.sourcePlatform]}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span>{PLATFORM_EMOJI[cp.targetPlatform]}</span>
                    <Badge variant={
                      cp.status === "published" ? "default" :
                      cp.status === "ready" ? "secondary" :
                      cp.status === "failed" ? "destructive" : "outline"
                    } className="text-xs ml-auto">{cp.status}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* 바이럴 로그 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5" /> 활동 타임라인
              </CardTitle>
            </CardHeader>
            <CardContent className="max-h-[400px] overflow-y-auto">
              {viralLog.data?.length === 0 && (
                <p className="text-center text-muted-foreground py-4 text-sm">
                  아직 활동이 없습니다.
                </p>
              )}
              <div className="space-y-2">
                {viralLog.data?.map(log => {
                  const et = eventTypeLabels[log.eventType] || { label: log.eventType, color: "bg-gray-100" };
                  return (
                    <div key={log.id} className="flex items-start gap-2 p-2 text-sm">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${et.color}`}>
                        {et.label}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm line-clamp-2">{log.summary}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{log.createdAt}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
