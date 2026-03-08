import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { FlaskConical, Play, Pause, X, Star, Sparkles } from "lucide-react";

export default function TestCandidates() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.sourcing.list.useQuery({
    status: "test_candidate",
    limit: 100,
  });

  const changeStatus = trpc.sourcing.changeStatus.useMutation({
    onSuccess: () => {
      toast.success("상태가 변경되었습니다! ✨");
      utils.sourcing.list.invalidate();
    },
  });

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight gradient-text flex items-center gap-2">
            <span className="text-2xl">🧪</span>
            테스트 후보
          </h1>
          <p className="text-muted-foreground text-sm mt-1">점수 85점 이상 자동 분류된 상품</p>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-32 gap-3">
            <div className="cute-dots"><div className="cute-dot" /><div className="cute-dot" /><div className="cute-dot" /></div>
          </div>
        ) : data?.items && data.items.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {data.items.map(p => (
              <Card key={p.id} className="pretty-card group overflow-hidden">
                <div className="h-1 bg-gradient-to-r from-pink-400 via-fuchsia-400 to-purple-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                <CardContent className="pt-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="cursor-pointer flex-1 min-w-0" onClick={() => setLocation(`/products/${p.id}`)}>
                      <p className="font-semibold hover:text-pink-600 transition-colors truncate">{p.productName}</p>
                      <p className="text-xs text-muted-foreground">{p.recordDate} | {p.category || "미분류"}</p>
                    </div>
                    <Badge className={`text-base px-3 py-1 ml-2 shadow-sm ${
                      p.scoreGrade === "S" ? "bg-gradient-to-r from-pink-400 to-rose-500 text-white border-0" :
                      "bg-gradient-to-r from-purple-400 to-fuchsia-500 text-white border-0"
                    }`}>
                      {p.scoreGrade === "S" && <Star className="h-3 w-3 mr-0.5" />}
                      {p.scoreGrade} {p.score}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {[p.keyword1, p.keyword2, p.keyword3].filter(Boolean).map((kw, i) => (
                      <Badge key={i} className="text-xs bg-pink-50 text-pink-600 border-pink-200">{kw}</Badge>
                    ))}
                  </div>

                  {p.finalOpinion && (
                    <p className="text-xs text-muted-foreground line-clamp-2 bg-purple-50/50 rounded-lg p-2">{p.finalOpinion}</p>
                  )}

                  <div className="flex gap-2 pt-1">
                    <Button size="sm" className="flex-1 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white rounded-xl shadow-sm"
                      onClick={() => changeStatus.mutate({ id: p.id, status: "testing" })}>
                      <Play className="h-3.5 w-3.5 mr-1" /> 테스트 시작
                    </Button>
                    <Button size="sm" variant="outline" className="border-pink-200 text-pink-500 hover:bg-pink-50 rounded-xl"
                      onClick={() => changeStatus.mutate({ id: p.id, status: "hold" })}>
                      <Pause className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="outline" className="border-red-200 text-red-400 hover:bg-red-50 rounded-xl"
                      onClick={() => changeStatus.mutate({ id: p.id, status: "dropped" })}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-20 text-muted-foreground">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-pink-100 to-purple-100 mx-auto mb-4 flex items-center justify-center">
              <FlaskConical className="h-10 w-10 text-pink-300" />
            </div>
            <p className="font-medium text-lg">테스트 후보 상품이 없습니다</p>
            <p className="text-sm mt-1 text-pink-400">85점 이상 상품이 자동으로 분류됩니다</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
