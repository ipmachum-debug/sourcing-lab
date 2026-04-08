import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useState } from "react";
import { toast } from "sonner";
import {
  Video, Plus, Play, CheckCircle2, Loader2, Send,
  Image, Sparkles, Music, Type, Trash2, RefreshCw,
} from "lucide-react";

const STYLE_OPTIONS = [
  { value: "instagram_reel", label: "인스타 릴스", desc: "감성적, 세로형" },
  { value: "tiktok", label: "틱톡", desc: "훅 강조, 트렌디" },
  { value: "youtube_shorts", label: "유튜브 쇼츠", desc: "정보성+재미" },
  { value: "product_showcase", label: "상품 쇼케이스", desc: "고급 조명, 슬로우모션" },
  { value: "unboxing", label: "언박싱", desc: "기대감 조성" },
  { value: "review", label: "후기/체험", desc: "리얼 리뷰" },
];

const MOOD_OPTIONS = [
  { value: "upbeat", label: "신나는" },
  { value: "calm", label: "잔잔한" },
  { value: "luxury", label: "고급스러운" },
  { value: "cute", label: "귀여운" },
  { value: "trendy", label: "트렌디" },
  { value: "emotional", label: "감성적" },
];

const STATUS_MAP: Record<string, { label: string; color: string; icon: any }> = {
  selecting: { label: "이미지 선택 중", color: "text-blue-500", icon: Image },
  scripting: { label: "스토리 생성 중", color: "text-purple-500", icon: Type },
  prompting: { label: "프롬프트 준비", color: "text-orange-500", icon: Sparkles },
  generating: { label: "영상 생성 중", color: "text-yellow-500", icon: Loader2 },
  processing: { label: "후처리 중", color: "text-cyan-500", icon: Music },
  completed: { label: "완성!", color: "text-green-500", icon: CheckCircle2 },
  failed: { label: "실패", color: "text-red-500", icon: Trash2 },
};

export default function VideoStudio() {
  const [showCreate, setShowCreate] = useState(false);
  const [productId, setProductId] = useState("");
  const [style, setStyle] = useState("instagram_reel");
  const [mood, setMood] = useState("trendy");
  const [duration, setDuration] = useState("15");

  const utils = trpc.useUtils();
  const products = trpc.marketing.products.list.useQuery();
  const jobs = trpc.marketing.video.list.useQuery();

  const createJob = trpc.marketing.video.create.useMutation({
    onSuccess: (data) => {
      toast.success("영상 제작이 시작되었습니다!");
      setShowCreate(false);
      utils.marketing.video.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const startGen = trpc.marketing.video.startGeneration.useMutation({
    onSuccess: () => {
      toast.success("Kling AI 영상 생성 시작! 1~5분 소요됩니다.");
      utils.marketing.video.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const sendToQueue = trpc.marketing.video.sendToQueue.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.count}개 채널 발행 큐에 추가되었습니다.`);
      utils.marketing.video.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteJob = trpc.marketing.video.delete.useMutation({
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      utils.marketing.video.list.invalidate();
    },
  });

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Video className="h-6 w-6 text-purple-500" /> 영상 스튜디오
            </h1>
            <p className="text-muted-foreground text-sm mt-1">사진 → AI 영상 자동 생성 → 자막/BGM → 발행</p>
          </div>
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-1" />영상 만들기</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>AI 영상 제작</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">상품 선택</label>
                  <Select value={productId} onValueChange={setProductId}>
                    <SelectTrigger><SelectValue placeholder="상품을 선택하세요" /></SelectTrigger>
                    <SelectContent>
                      {products.data?.map(p => {
                        const imgs = (p.imageUrls as string[]) || [];
                        return (
                          <SelectItem key={p.id} value={String(p.id)}>
                            {p.name} ({imgs.length}장)
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1 block">영상 스타일</label>
                  <Select value={style} onValueChange={setStyle}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STYLE_OPTIONS.map(s => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label} — {s.desc}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium mb-1 block">BGM 분위기</label>
                    <Select value={mood} onValueChange={setMood}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MOOD_OPTIONS.map(m => (
                          <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">길이 (초)</label>
                    <Select value={duration} onValueChange={setDuration}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5초</SelectItem>
                        <SelectItem value="10">10초</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button className="w-full" disabled={!productId || createJob.isPending}
                  onClick={() => createJob.mutate({
                    productId: Number(productId),
                    videoStyle: style as any,
                    videoDuration: Number(duration),
                    bgmMood: mood as any,
                  })}>
                  {createJob.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-1 animate-spin" />AI가 준비 중...</>
                  ) : (
                    <><Sparkles className="h-4 w-4 mr-1" />영상 제작 시작</>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* 파이프라인 설명 */}
        <div className="flex gap-1 text-xs text-muted-foreground overflow-x-auto pb-1">
          {["사진 업로드", "→", "베스트 컷 선택", "→", "스토리 생성", "→", "영상 프롬프트", "→", "AI 영상 생성", "→", "자막+BGM", "→", "발행"].map((s, i) => (
            <span key={i} className={s === "→" ? "text-muted-foreground/50" : "bg-muted px-2 py-0.5 rounded whitespace-nowrap"}>{s}</span>
          ))}
        </div>

        {/* 작업 목록 */}
        {jobs.data?.length === 0 && (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              <Video className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>영상 작업이 없습니다.</p>
              <p className="text-sm">"영상 만들기"를 눌러 상품 사진으로 AI 영상을 만들어보세요.</p>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {jobs.data?.map(job => {
            const st = STATUS_MAP[job.status] || STATUS_MAP.selecting;
            const StatusIcon = st.icon;
            const selectedImgs = (job.selectedImages as string[]) || [];

            return (
              <Card key={job.id}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    {/* 선택된 이미지 미리보기 */}
                    <div className="flex gap-1 shrink-0">
                      {selectedImgs.slice(0, 3).map((url, i) => (
                        <img key={i} src={url} alt="" className="w-16 h-16 rounded object-cover border" />
                      ))}
                      {selectedImgs.length === 0 && (
                        <div className="w-16 h-16 rounded border bg-muted flex items-center justify-center">
                          <Image className="h-6 w-6 text-muted-foreground" />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* 상태 */}
                      <div className="flex items-center gap-2 mb-1">
                        <StatusIcon className={`h-4 w-4 ${st.color} ${job.status === "generating" ? "animate-spin" : ""}`} />
                        <Badge variant={job.status === "completed" ? "default" : job.status === "failed" ? "destructive" : "secondary"}>
                          {st.label}
                        </Badge>
                        <Badge variant="outline" className="text-xs">{job.videoStyle}</Badge>
                        <Badge variant="outline" className="text-xs">{job.videoDuration}초</Badge>
                        <Badge variant="outline" className="text-xs">{job.bgmMood}</Badge>
                      </div>

                      {/* 스토리 */}
                      {job.storyScript && (
                        <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{job.storyScript}</p>
                      )}

                      {/* 프롬프트 */}
                      {job.videoPrompt && (
                        <p className="text-xs text-blue-600 dark:text-blue-400 line-clamp-1 mt-1">
                          Prompt: {job.videoPrompt}
                        </p>
                      )}

                      {/* 자막 미리보기 */}
                      {job.subtitleText && (
                        <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                          자막: {job.subtitleText.split("\n").slice(0, 2).join(" | ")}
                        </p>
                      )}

                      {/* 완성 영상 */}
                      {job.finalVideoUrl && (
                        <div className="mt-2">
                          <video src={job.finalVideoUrl} controls className="w-full max-w-xs rounded-lg border" />
                        </div>
                      )}

                      {/* 에러 */}
                      {job.errorMessage && (
                        <p className="text-xs text-red-500 mt-1">{job.errorMessage}</p>
                      )}

                      <p className="text-[10px] text-muted-foreground mt-1">{job.createdAt}</p>
                    </div>

                    {/* 액션 버튼 */}
                    <div className="flex flex-col gap-1 shrink-0">
                      {job.status === "prompting" && (
                        <Button size="sm" onClick={() => startGen.mutate({ jobId: job.id })}
                          disabled={startGen.isPending}>
                          <Play className="h-3 w-3 mr-1" />생성 시작
                        </Button>
                      )}
                      {job.status === "generating" && (
                        <Button size="sm" variant="outline" onClick={() => utils.marketing.video.list.invalidate()}>
                          <RefreshCw className="h-3 w-3 mr-1" />상태 확인
                        </Button>
                      )}
                      {job.status === "completed" && job.finalVideoUrl && (
                        <Button size="sm" onClick={() => sendToQueue.mutate({
                          jobId: job.id,
                          platforms: ["instagram", "tiktok", "youtube"],
                        })} disabled={sendToQueue.isPending}>
                          <Send className="h-3 w-3 mr-1" />발행 큐
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => deleteJob.mutate({ id: job.id })}>
                        <Trash2 className="h-3 w-3 text-red-500" />
                      </Button>
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
