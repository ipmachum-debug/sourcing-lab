import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { BarChart3, Eye, Heart, MessageSquare, MousePointerClick, Share2, TrendingUp } from "lucide-react";

const PLATFORM_LABELS: Record<string, { label: string; emoji: string; color: string }> = {
  instagram: { label: "인스타그램", emoji: "📸", color: "bg-pink-100 text-pink-700" },
  youtube: { label: "유튜브", emoji: "🎬", color: "bg-red-100 text-red-700" },
  tiktok: { label: "틱톡", emoji: "🎵", color: "bg-cyan-100 text-cyan-700" },
  naver_blog: { label: "블로그", emoji: "📝", color: "bg-green-100 text-green-700" },
  naver_cafe: { label: "카페", emoji: "☕", color: "bg-yellow-100 text-yellow-700" },
  kakao: { label: "카카오", emoji: "💬", color: "bg-amber-100 text-amber-700" },
};

export default function MarketingAnalytics() {
  const [period, setPeriod] = useState("7");

  const summary = trpc.marketing.analytics.getSummary.useQuery({ days: Number(period) });
  const byPlatform = trpc.marketing.analytics.getByPlatform.useQuery({ days: Number(period) });
  const feedback = trpc.marketing.analytics.listFeedback.useQuery();

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">성과 분석</h1>
            <p className="text-muted-foreground text-sm mt-1">채널별/콘텐츠별 마케팅 성과를 분석합니다</p>
          </div>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">최근 7일</SelectItem>
              <SelectItem value="14">최근 14일</SelectItem>
              <SelectItem value="30">최근 30일</SelectItem>
              <SelectItem value="90">최근 90일</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 종합 요약 */}
        {summary.data && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { icon: Eye, label: "조회수", value: summary.data.stats.totalViews, color: "text-blue-500" },
              { icon: Heart, label: "좋아요", value: summary.data.stats.totalLikes, color: "text-red-500" },
              { icon: MessageSquare, label: "댓글", value: summary.data.stats.totalComments, color: "text-orange-500" },
              { icon: Share2, label: "공유", value: summary.data.stats.totalShares, color: "text-purple-500" },
              { icon: MousePointerClick, label: "클릭", value: summary.data.stats.totalClicks, color: "text-green-500" },
              { icon: TrendingUp, label: "전환", value: summary.data.stats.totalConversions, color: "text-indigo-500" },
            ].map((item, i) => (
              <Card key={i}>
                <CardContent className="p-3 text-center">
                  <item.icon className={`h-4 w-4 mx-auto ${item.color} mb-1`} />
                  <p className="text-xl font-bold">{Number(item.value).toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* 발행 현황 */}
        {summary.data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">총 콘텐츠</p>
                <p className="text-2xl font-bold">{summary.data.totalContent}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">발행 완료</p>
                <p className="text-2xl font-bold text-green-600">{summary.data.published}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">대기 중</p>
                <p className="text-2xl font-bold text-yellow-600">{summary.data.queued}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">실패</p>
                <p className="text-2xl font-bold text-red-600">{summary.data.failed}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 플랫폼별 성과 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              플랫폼별 성과
            </CardTitle>
          </CardHeader>
          <CardContent>
            {byPlatform.data?.length === 0 && (
              <p className="text-center text-muted-foreground py-8 text-sm">
                아직 수집된 성과 데이터가 없습니다. 콘텐츠를 발행하면 여기에 표시됩니다.
              </p>
            )}
            <div className="space-y-3">
              {byPlatform.data?.map((row, i) => {
                const pl = PLATFORM_LABELS[row.platform] || { label: row.platform, emoji: "📱", color: "bg-gray-100" };
                return (
                  <div key={i} className="flex items-center gap-4 p-3 bg-muted/30 rounded-lg">
                    <span className={`px-2 py-1 rounded text-sm font-medium ${pl.color}`}>
                      {pl.emoji} {pl.label}
                    </span>
                    <div className="grid grid-cols-4 gap-4 flex-1 text-center">
                      <div>
                        <p className="text-sm font-bold">{Number(row.totalViews).toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">조회</p>
                      </div>
                      <div>
                        <p className="text-sm font-bold">{Number(row.totalLikes).toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">좋아요</p>
                      </div>
                      <div>
                        <p className="text-sm font-bold">{Number(row.totalClicks).toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">클릭</p>
                      </div>
                      <div>
                        <p className="text-sm font-bold">{Number(row.postCount)}</p>
                        <p className="text-xs text-muted-foreground">게시물</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* AI 피드백 */}
        {feedback.data && feedback.data.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">🤖 AI 성과 분석</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {feedback.data.slice(0, 5).map(fb => (
                <div key={fb.id} className="p-3 border rounded-lg text-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium">점수: {fb.score}/10</span>
                    <span className="text-xs text-muted-foreground">{fb.platform}</span>
                  </div>
                  {fb.reason && <p className="text-muted-foreground">{fb.reason}</p>}
                  {fb.bestHook && <p className="text-green-600 mt-1">✅ 잘된 훅: {fb.bestHook}</p>}
                  {fb.badPattern && <p className="text-red-600 mt-1">❌ 개선점: {fb.badPattern}</p>}
                  {fb.recommendedAction && <p className="text-blue-600 mt-1">💡 추천: {fb.recommendedAction}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
