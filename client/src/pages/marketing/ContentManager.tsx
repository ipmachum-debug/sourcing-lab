import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Sparkles, Trash2, CheckCircle2, Clock, FileText } from "lucide-react";

const PLATFORMS = [
  { value: "instagram", label: "인스타그램", emoji: "📸" },
  { value: "youtube", label: "유튜브", emoji: "🎬" },
  { value: "tiktok", label: "틱톡", emoji: "🎵" },
  { value: "naver_blog", label: "네이버 블로그", emoji: "📝" },
  { value: "naver_cafe", label: "네이버 카페", emoji: "☕" },
  { value: "kakao", label: "카카오채널", emoji: "💬" },
] as const;

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft: { label: "초안", color: "secondary" },
  approved: { label: "승인됨", color: "default" },
  scheduled: { label: "예약됨", color: "outline" },
  published: { label: "발행됨", color: "default" },
  failed: { label: "실패", color: "destructive" },
  archived: { label: "보관", color: "secondary" },
};

export default function ContentManager() {
  const [showGenerate, setShowGenerate] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<string>("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [contentType, setContentType] = useState("promotional");
  const [customPrompt, setCustomPrompt] = useState("");

  const utils = trpc.useUtils();
  const contents = trpc.marketing.content.list.useQuery();
  const products = trpc.marketing.products.list.useQuery();
  const generateMut = trpc.marketing.content.generate.useMutation({
    onSuccess: (data) => {
      toast.success("콘텐츠가 생성되었습니다!");
      setShowGenerate(false);
      utils.marketing.content.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteMut = trpc.marketing.content.delete.useMutation({
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      utils.marketing.content.list.invalidate();
    },
  });
  const statusMut = trpc.marketing.content.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("상태가 변경되었습니다.");
      utils.marketing.content.list.invalidate();
    },
  });

  const togglePlatform = (p: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
    );
  };

  const handleGenerate = () => {
    if (!selectedProduct || selectedPlatforms.length === 0) {
      toast.error("상품과 플랫폼을 선택하세요.");
      return;
    }
    generateMut.mutate({
      productId: Number(selectedProduct),
      platforms: selectedPlatforms as any,
      contentType: contentType as any,
      customPrompt: customPrompt || undefined,
    });
  };

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">콘텐츠 제작</h1>
            <p className="text-muted-foreground text-sm mt-1">AI 카피 생성 + 영상 제작</p>
          </div>
          <div className="flex gap-2">
            <a href="/marketing/video">
              <Button variant="outline" size="sm">🎬 영상 스튜디오</Button>
            </a>
            <a href="/marketing/calendar">
              <Button variant="outline" size="sm">📅 캘린더</Button>
            </a>
          </div>
          <Dialog open={showGenerate} onOpenChange={setShowGenerate}>
            <DialogTrigger asChild>
              <Button>
                <Sparkles className="h-4 w-4 mr-1" />
                AI 콘텐츠 생성
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>AI 콘텐츠 생성</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {/* 상품 선택 */}
                <div>
                  <label className="text-sm font-medium mb-1 block">상품 선택</label>
                  <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                    <SelectTrigger>
                      <SelectValue placeholder="상품을 선택하세요" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.data?.map(p => (
                        <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {(!products.data || products.data.length === 0) && (
                    <p className="text-xs text-muted-foreground mt-1">먼저 설정에서 상품을 등록하세요.</p>
                  )}
                </div>

                {/* 플랫폼 선택 */}
                <div>
                  <label className="text-sm font-medium mb-1 block">대상 플랫폼</label>
                  <div className="flex flex-wrap gap-2">
                    {PLATFORMS.map(p => (
                      <Badge
                        key={p.value}
                        variant={selectedPlatforms.includes(p.value) ? "default" : "outline"}
                        className="cursor-pointer select-none"
                        onClick={() => togglePlatform(p.value)}
                      >
                        {p.emoji} {p.label}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* 콘텐츠 유형 */}
                <div>
                  <label className="text-sm font-medium mb-1 block">콘텐츠 유형</label>
                  <Select value={contentType} onValueChange={setContentType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="promotional">판매 촉진형</SelectItem>
                      <SelectItem value="storytelling">스토리텔링형</SelectItem>
                      <SelectItem value="educational">정보/교육형</SelectItem>
                      <SelectItem value="event">이벤트/프로모션형</SelectItem>
                      <SelectItem value="review">후기/체험형</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* 커스텀 프롬프트 */}
                <div>
                  <label className="text-sm font-medium mb-1 block">추가 요구사항 (선택)</label>
                  <Textarea
                    value={customPrompt}
                    onChange={e => setCustomPrompt(e.target.value)}
                    placeholder="예: 봄 시즌 감성으로, 30대 여성 타겟, 선물세트 강조"
                    rows={3}
                  />
                </div>

                <Button
                  className="w-full"
                  onClick={handleGenerate}
                  disabled={generateMut.isPending}
                >
                  {generateMut.isPending ? "생성 중..." : "🚀 AI 콘텐츠 생성"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* 콘텐츠 목록 */}
        {contents.data?.length === 0 && (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>아직 생성된 콘텐츠가 없습니다.</p>
              <p className="text-sm">AI 콘텐츠 생성 버튼을 눌러 시작하세요.</p>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {contents.data?.map(content => (
            <Card key={content.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={STATUS_MAP[content.status]?.color as any || "secondary"}>
                        {STATUS_MAP[content.status]?.label || content.status}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {content.sourceType === "ai_generated" ? "🤖 AI" : "✍️ 수동"}
                      </Badge>
                      {content.aiScore && (
                        <Badge variant="outline" className="text-xs">
                          점수: {content.aiScore}
                        </Badge>
                      )}
                    </div>
                    <h3 className="font-medium text-sm truncate">{content.masterTitle || "제목 없음"}</h3>
                    {content.masterHook && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-1">🪝 {content.masterHook}</p>
                    )}
                    {content.masterBody && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{content.masterBody}</p>
                    )}
                    {(content.hashtags as string[])?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {(content.hashtags as string[]).slice(0, 5).map((tag, i) => (
                          <span key={i} className="text-xs text-blue-600 dark:text-blue-400">{tag.startsWith("#") ? tag : `#${tag}`}</span>
                        ))}
                        {(content.hashtags as string[]).length > 5 && (
                          <span className="text-xs text-muted-foreground">+{(content.hashtags as string[]).length - 5}</span>
                        )}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">{content.createdAt}</p>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    {content.status === "draft" && (
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => statusMut.mutate({ ids: [content.id], status: "approved" })}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => deleteMut.mutate({ id: content.id })}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
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
