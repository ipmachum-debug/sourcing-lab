import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Save, BarChart3, Sparkles, TrendingUp, Target, Star } from "lucide-react";

function getCurrentWeekKey(): string {
  const d = new Date();
  const onejan = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${weekNum.toString().padStart(2, "0")}`;
}

function getWeekRange(weekKey: string): { start: string; end: string } {
  const [yearStr, weekStr] = weekKey.split("-W");
  const year = Number(yearStr);
  const week = Number(weekStr);
  const simple = new Date(year, 0, 1 + (week - 1) * 7);
  const dayOfWeek = simple.getDay();
  const start = new Date(simple);
  start.setDate(simple.getDate() - dayOfWeek + 1);
  const end = new Date(start);
  end.setDate(start.getDate() + 4);

  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
  };
}

export default function WeeklyReview() {
  const weekKey = getCurrentWeekKey();
  const { start, end } = getWeekRange(weekKey);

  const { data: review } = trpc.review.getByWeek.useQuery({ weekKey });
  const { data: stats } = trpc.review.getWeekStats.useQuery({ weekKey });
  const utils = trpc.useUtils();

  const [form, setForm] = useState({
    topCategory: "",
    orderedKeywords: "",
    exposedKeywords: "",
    bestConvertedProducts: "",
    dropProducts: "",
    nextWeekCategories: "",
    nextWeekKeywords: "",
    actionItems: "",
    reviewMemo: "",
  });

  useEffect(() => {
    if (review) {
      setForm({
        topCategory: review.topCategory || "",
        orderedKeywords: review.orderedKeywords || "",
        exposedKeywords: review.exposedKeywords || "",
        bestConvertedProducts: review.bestConvertedProducts || "",
        dropProducts: review.dropProducts || "",
        nextWeekCategories: review.nextWeekCategories || "",
        nextWeekKeywords: review.nextWeekKeywords || "",
        actionItems: review.actionItems || "",
        reviewMemo: review.reviewMemo || "",
      });
    }
  }, [review]);

  const upsert = trpc.review.upsert.useMutation({
    onSuccess: () => {
      toast.success("주간 리뷰가 저장되었습니다! ✨");
      utils.review.getByWeek.invalidate({ weekKey });
      utils.dashboard.summary.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const set = (k: keyof typeof form, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight gradient-text flex items-center gap-2">
              <span className="text-2xl">📅</span>
              주간 리뷰
            </h1>
            <p className="text-muted-foreground text-sm mt-1">{weekKey} ({start} ~ {end})</p>
          </div>
          <Button onClick={() => upsert.mutate({ weekKey, startDate: start, endDate: end, ...form })} disabled={upsert.isPending}
            className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white shadow-md shadow-pink-200/50 rounded-xl">
            <Save className="h-4 w-4 mr-2" /> {upsert.isPending ? "저장중..." : "저장"}
          </Button>
        </div>

        {/* Stats summary */}
        <div className="grid gap-4 md:grid-cols-4">
          {[
            { label: "이번 주 소싱", value: stats?.totalCount || 0, icon: <TrendingUp className="h-5 w-5 text-pink-500" />, gradient: "from-pink-100 to-pink-200" },
            { label: "평균 점수", value: stats?.avgScore || 0, icon: <Star className="h-5 w-5 text-purple-500" />, gradient: "from-purple-100 to-purple-200" },
            { label: "80점 이상", value: stats?.highScoreCount || 0, icon: <Sparkles className="h-5 w-5 text-fuchsia-500" />, gradient: "from-fuchsia-100 to-fuchsia-200" },
            { label: "테스트 후보", value: stats?.testCandidateCount || 0, icon: <Target className="h-5 w-5 text-rose-500" />, gradient: "from-rose-100 to-rose-200" },
          ].map(item => (
            <div key={item.label} className="summary-card p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">{item.label}</span>
                <div className={`h-9 w-9 rounded-xl bg-gradient-to-br ${item.gradient} flex items-center justify-center`}>
                  {item.icon}
                </div>
              </div>
              <p className="text-3xl font-bold gradient-text">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          {/* Category stats */}
          <Card className="pretty-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-pink-400" />
                <span className="gradient-text-soft">카테고리별 수량</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {stats?.topCategories && stats.topCategories.length > 0 ? (
                <div className="space-y-2">
                  {stats.topCategories.map(([cat, count]) => (
                    <div key={cat} className="flex items-center justify-between p-2 rounded-lg hover:bg-pink-50/50 transition-all">
                      <span className="text-sm">{cat}</span>
                      <Badge className="bg-gradient-to-r from-pink-100 to-purple-100 text-pink-700 border-pink-200">{count}개</Badge>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground text-center py-6">데이터 없음</p>}
            </CardContent>
          </Card>

          {/* Keyword stats */}
          <Card className="pretty-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="text-base">🔑</span>
                <span className="gradient-text-soft">키워드 빈도 TOP</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {stats?.topKeywords && stats.topKeywords.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {stats.topKeywords.map(([kw, count]) => (
                    <Badge key={kw} className="text-xs bg-gradient-to-r from-pink-50 to-purple-50 text-pink-700 border border-pink-200/60 px-3 py-1">{kw} ({count})</Badge>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground text-center py-6">데이터 없음</p>}
            </CardContent>
          </Card>
        </div>

        {/* Review input fields */}
        <div className="grid gap-4 md:grid-cols-2">
          {[
            { key: "topCategory" as const, label: "잘된 카테고리", emoji: "🏆", placeholder: "이번 주 가장 잘된 카테고리와 이유" },
            { key: "orderedKeywords" as const, label: "주문 키워드", emoji: "🛒", placeholder: "주문 3개 이상 발생한 키워드" },
            { key: "exposedKeywords" as const, label: "노출 키워드", emoji: "👀", placeholder: "노출 높은 키워드" },
            { key: "bestConvertedProducts" as const, label: "잘된 상품", emoji: "💖", placeholder: "전환율 좋은 상품" },
            { key: "dropProducts" as const, label: "버릴 상품", emoji: "🗑️", placeholder: "폐기/보류 할 상품과 이유" },
            { key: "nextWeekCategories" as const, label: "다음 주 카테고리", emoji: "📂", placeholder: "다음 주 집중할 카테고리" },
            { key: "nextWeekKeywords" as const, label: "다음 주 키워드", emoji: "🎯", placeholder: "다음 주 집중할 키워드" },
            { key: "actionItems" as const, label: "액션 아이템 (3개)", emoji: "✅", placeholder: "1. ...\n2. ...\n3. ..." },
          ].map(item => (
            <Card key={item.key} className="pretty-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <span>{item.emoji}</span>
                  <span className="gradient-text-soft">{item.label}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea value={form[item.key]} onChange={e => set(item.key, e.target.value)} placeholder={item.placeholder} rows={3} className="pretty-input" />
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Review memo */}
        <Card className="pretty-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <span>💭</span>
              <span className="gradient-text-soft">회고 메모</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea value={form.reviewMemo} onChange={e => set("reviewMemo", e.target.value)} placeholder="이번 주 전체 회고, 느낀 점, 개선할 점" rows={5} className="pretty-input" />
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button size="lg" onClick={() => upsert.mutate({ weekKey, startDate: start, endDate: end, ...form })} disabled={upsert.isPending}
            className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white shadow-lg shadow-pink-200/40 rounded-xl px-8">
            <Sparkles className="h-4 w-4 mr-2" /> {upsert.isPending ? "저장중..." : "주간 리뷰 저장"}
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
