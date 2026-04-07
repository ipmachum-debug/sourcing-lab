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
import { Plus, Star, Sparkles, Trash2, ArrowRight, MessageSquare } from "lucide-react";

const SOURCE_LABELS: Record<string, { label: string; emoji: string }> = {
  coupang: { label: "쿠팡", emoji: "🛍️" },
  naver_store: { label: "네이버 스토어", emoji: "🟢" },
  naver_blog: { label: "네이버 블로그", emoji: "📝" },
  instagram: { label: "인스타그램", emoji: "📸" },
  youtube: { label: "유튜브", emoji: "🎬" },
  manual: { label: "수동 입력", emoji: "✍️" },
};

const SENTIMENT_BADGE: Record<string, { label: string; variant: string }> = {
  positive: { label: "긍정", variant: "default" },
  neutral: { label: "중립", variant: "secondary" },
  negative: { label: "부정", variant: "destructive" },
};

export default function ReviewsPage() {
  const [showAdd, setShowAdd] = useState(false);
  const [source, setSource] = useState("manual");
  const [content, setContent] = useState("");
  const [rating, setRating] = useState("5");
  const [reviewer, setReviewer] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sentimentFilter, setSentimentFilter] = useState("all");

  const utils = trpc.useUtils();
  const reviews = trpc.marketing.viral.reviews.list.useQuery(
    sentimentFilter !== "all" ? { sentiment: sentimentFilter as any } : undefined
  );
  const addReview = trpc.marketing.viral.reviews.add.useMutation({
    onSuccess: () => {
      toast.success("리뷰가 등록되고 AI 분석이 시작됩니다.");
      setShowAdd(false); setContent(""); setReviewer(""); setSourceUrl("");
      utils.marketing.viral.reviews.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const analyzeMut = trpc.marketing.viral.reviews.analyze.useMutation({
    onSuccess: () => {
      toast.success("AI 분석 완료");
      utils.marketing.viral.reviews.list.invalidate();
    },
  });
  const convertMut = trpc.marketing.viral.reviews.convertToContent.useMutation({
    onSuccess: (data) => {
      toast.success("리뷰가 마케팅 콘텐츠로 변환되었습니다!");
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteMut = trpc.marketing.viral.reviews.delete.useMutation({
    onSuccess: () => {
      toast.success("삭제됨");
      utils.marketing.viral.reviews.list.invalidate();
    },
  });

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <MessageSquare className="h-6 w-6 text-yellow-500" /> 리뷰/후기 관리
            </h1>
            <p className="text-muted-foreground text-sm mt-1">고객 후기를 수집하고 마케팅 소재로 변환</p>
          </div>
          <div className="flex gap-2">
            <Select value={sentimentFilter} onValueChange={setSentimentFilter}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                <SelectItem value="positive">긍정</SelectItem>
                <SelectItem value="neutral">중립</SelectItem>
                <SelectItem value="negative">부정</SelectItem>
              </SelectContent>
            </Select>
            <Dialog open={showAdd} onOpenChange={setShowAdd}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-1" />리뷰 등록</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>리뷰 등록</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <Select value={source} onValueChange={setSource}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(SOURCE_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v.emoji} {v.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Textarea placeholder="리뷰 내용을 붙여넣으세요" value={content}
                    onChange={e => setContent(e.target.value)} rows={4} />
                  <div className="grid grid-cols-2 gap-3">
                    <Input placeholder="작성자명 (선택)" value={reviewer} onChange={e => setReviewer(e.target.value)} />
                    <Select value={rating} onValueChange={setRating}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[5, 4, 3, 2, 1].map(r => (
                          <SelectItem key={r} value={String(r)}>{"⭐".repeat(r)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Input placeholder="원본 URL (선택)" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} />
                  <Button className="w-full" disabled={!content || addReview.isPending}
                    onClick={() => addReview.mutate({
                      source: source as any, content, rating: Number(rating),
                      reviewerName: reviewer || undefined, sourceUrl: sourceUrl || undefined,
                    })}>
                    등록 + AI 분석
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {reviews.data?.length === 0 && (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>등록된 리뷰가 없습니다.</p>
              <p className="text-sm">쿠팡/네이버 리뷰를 복사해서 등록하면 AI가 분석하고 마케팅 소재로 변환해줍니다.</p>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {reviews.data?.map(review => {
            const src = SOURCE_LABELS[review.source] || { label: review.source, emoji: "📋" };
            const sent = review.sentiment ? SENTIMENT_BADGE[review.sentiment] : null;
            return (
              <Card key={review.id} className={review.isUsable ? "border-green-200 dark:border-green-800" : ""}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm">{src.emoji} {src.label}</span>
                        {review.rating && (
                          <span className="text-xs">{"⭐".repeat(review.rating)}</span>
                        )}
                        {sent && (
                          <Badge variant={sent.variant as any} className="text-xs">{sent.label}</Badge>
                        )}
                        {review.isUsable && (
                          <Badge variant="default" className="text-xs bg-green-600">소재 활용 가능</Badge>
                        )}
                        {review.isUsed && (
                          <Badge variant="secondary" className="text-xs">활용됨</Badge>
                        )}
                        {review.reviewerName && (
                          <span className="text-xs text-muted-foreground">{review.reviewerName}</span>
                        )}
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{review.content}</p>
                      {(review.keywords as string[])?.length > 0 && (
                        <div className="flex gap-1 mt-2">
                          {(review.keywords as string[]).map((k, i) => (
                            <Badge key={i} variant="outline" className="text-[10px]">{k}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 ml-2">
                      {!review.sentiment && (
                        <Button variant="outline" size="sm" onClick={() => analyzeMut.mutate({ id: review.id })}>
                          <Sparkles className="h-3 w-3 mr-1" />분석
                        </Button>
                      )}
                      {review.isUsable && !review.isUsed && (
                        <Button variant="outline" size="sm"
                          disabled={convertMut.isPending}
                          onClick={() => convertMut.mutate({
                            reviewId: review.id, platforms: ["instagram", "naver_blog"],
                          })}>
                          <ArrowRight className="h-3 w-3 mr-1" />콘텐츠 변환
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => deleteMut.mutate({ id: review.id })}>
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
