import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw, Send, XCircle, Clock, CheckCircle2, AlertTriangle, Zap, BarChart3 } from "lucide-react";

const PLATFORM_LABELS: Record<string, { label: string; emoji: string }> = {
  instagram: { label: "인스타그램", emoji: "📸" },
  youtube: { label: "유튜브", emoji: "🎬" },
  tiktok: { label: "틱톡", emoji: "🎵" },
  naver_blog: { label: "블로그", emoji: "📝" },
  naver_cafe: { label: "카페", emoji: "☕" },
  kakao: { label: "카카오", emoji: "💬" },
};

const STATUS_ICONS: Record<string, any> = {
  queued: { icon: Clock, color: "text-yellow-500", label: "대기" },
  publishing: { icon: Send, color: "text-blue-500", label: "발행 중" },
  published: { icon: CheckCircle2, color: "text-green-500", label: "완료" },
  failed: { icon: AlertTriangle, color: "text-red-500", label: "실패" },
  cancelled: { icon: XCircle, color: "text-gray-500", label: "취소" },
};

export default function PublishQueue() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");

  const utils = trpc.useUtils();
  const posts = trpc.marketing.channels.listPosts.useQuery(
    {
      ...(statusFilter !== "all" ? { status: statusFilter as any } : {}),
      ...(platformFilter !== "all" ? { platform: platformFilter as any } : {}),
    },
  );

  const updateStatus = trpc.marketing.channels.updatePostStatus.useMutation({
    onSuccess: () => {
      toast.success("상태가 변경되었습니다.");
      utils.marketing.channels.listPosts.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const triggerPublish = trpc.marketing.scheduler.triggerPublish.useMutation({
    onSuccess: () => {
      toast.success("발행이 완료되었습니다!");
      utils.marketing.channels.listPosts.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const collectAnalytics = trpc.marketing.scheduler.collectAnalytics.useMutation({
    onSuccess: (data) => {
      if (data.success) toast.success("성과 데이터를 수집했습니다.");
      else toast.error("성과 수집에 실패했습니다.");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">발행 큐</h1>
            <p className="text-muted-foreground text-sm mt-1">예약/대기/발행된 콘텐츠를 관리합니다</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => posts.refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" />
            새로고침
          </Button>
        </div>

        {/* 필터 */}
        <div className="flex gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="상태" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 상태</SelectItem>
              <SelectItem value="queued">대기</SelectItem>
              <SelectItem value="publishing">발행 중</SelectItem>
              <SelectItem value="published">완료</SelectItem>
              <SelectItem value="failed">실패</SelectItem>
              <SelectItem value="cancelled">취소</SelectItem>
            </SelectContent>
          </Select>
          <Select value={platformFilter} onValueChange={setPlatformFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="플랫폼" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 플랫폼</SelectItem>
              {Object.entries(PLATFORM_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.emoji} {v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 발행 목록 */}
        {posts.data?.length === 0 && (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              <Send className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>발행 큐가 비어있습니다.</p>
              <p className="text-sm">콘텐츠를 생성하면 자동으로 발행 큐에 추가됩니다.</p>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {posts.data?.map(post => {
            const s = STATUS_ICONS[post.publishStatus] || STATUS_ICONS.queued;
            const StatusIcon = s.icon;
            const pl = PLATFORM_LABELS[post.platform] || { label: post.platform, emoji: "📱" };

            return (
              <Card key={post.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <StatusIcon className={`h-4 w-4 ${s.color}`} />
                        <Badge variant="outline">{pl.emoji} {pl.label}</Badge>
                        <Badge variant="secondary" className="text-xs">{s.label}</Badge>
                        {post.scheduledAt && (
                          <span className="text-xs text-muted-foreground">
                            예약: {post.scheduledAt}
                          </span>
                        )}
                      </div>
                      <h3 className="font-medium text-sm truncate">{post.title || post.caption?.slice(0, 60) || "제목 없음"}</h3>
                      {post.caption && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{post.caption}</p>
                      )}
                      {(post.hashtags as string[])?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(post.hashtags as string[]).slice(0, 5).map((tag, i) => (
                            <span key={i} className="text-xs text-blue-600 dark:text-blue-400">{tag.startsWith("#") ? tag : `#${tag}`}</span>
                          ))}
                        </div>
                      )}
                      {post.errorMessage && (
                        <p className="text-xs text-red-500 mt-1">❌ {post.errorMessage}</p>
                      )}
                      {post.remotePostUrl && (
                        <a href={post.remotePostUrl} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline mt-1 inline-block">
                          게시물 보기 →
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      {post.publishStatus === "queued" && (
                        <Button variant="default" size="sm"
                          disabled={triggerPublish.isPending}
                          onClick={() => triggerPublish.mutate({ postId: post.id })}>
                          <Zap className="h-3 w-3 mr-1" />
                          즉시 발행
                        </Button>
                      )}
                      {post.publishStatus === "failed" && (
                        <Button variant="outline" size="sm"
                          onClick={() => updateStatus.mutate({ id: post.id, publishStatus: "queued" })}>
                          <RefreshCw className="h-3 w-3 mr-1" />
                          재시도
                        </Button>
                      )}
                      {post.publishStatus === "published" && (
                        <Button variant="ghost" size="sm"
                          disabled={collectAnalytics.isPending}
                          onClick={() => collectAnalytics.mutate({ postId: post.id })}>
                          <BarChart3 className="h-3 w-3 mr-1" />
                          성과 수집
                        </Button>
                      )}
                      {post.publishStatus === "queued" && (
                        <Button variant="ghost" size="sm"
                          onClick={() => updateStatus.mutate({ id: post.id, publishStatus: "cancelled" })}>
                          <XCircle className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </DashboardLayout>
  );
}
