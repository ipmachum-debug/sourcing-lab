import { useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { FlaskConical, Play, Pause, X, Star, RefreshCw, Loader2 } from "lucide-react";

export default function TestCandidates() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  const { data, isLoading, refetch } = trpc.sourcing.list.useQuery({
    minScore: 70,
    limit: 100,
  });

  const changeStatus = trpc.sourcing.changeStatus.useMutation({
    onSuccess: () => {
      toast.success("상태가 변경되었습니다!");
      utils.sourcing.list.invalidate();
    },
  });

  const recalcMut = trpc.sourcing.recalculateScores.useMutation({
    onSuccess: (res) => {
      utils.sourcing.list.invalidate();
      utils.sourcing.stats.invalidate();
      if (res.promoted > 0) {
        toast.success(`점수 재계산 완료! ${res.updated}개 갱신, ${res.promoted}개 테스트후보 승격`);
      } else if (res.updated > 0) {
        toast.success(`점수 재계산 완료! ${res.updated}/${res.total}개 갱신`);
      } else {
        toast.info("모든 상품 점수가 최신 상태입니다.");
      }
    },
    onError: (e) => toast.error(e.message),
  });

  // 페이지 진입 시 자동 재계산 (최초 1회)
  useEffect(() => {
    recalcMut.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight gradient-text flex items-center gap-2">
              <span className="text-2xl">🧪</span>
              테스트 후보
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              점수 70점 이상 자동 분류 (시장 데이터 + 분석 완성도 기반)
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-pink-200 text-pink-600 hover:bg-pink-50"
            onClick={() => recalcMut.mutate()}
            disabled={recalcMut.isPending}
          >
            {recalcMut.isPending
              ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> 재계산중...</>
              : <><RefreshCw className="h-3.5 w-3.5 mr-1" /> 점수 재계산</>}
          </Button>
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
                    {p.status && p.status !== "test_candidate" && (
                      <Badge className={`text-[10px] ${
                        p.status === "selected" ? "bg-green-100 text-green-700 border-green-200" :
                        p.status === "testing" ? "bg-blue-100 text-blue-700 border-blue-200" :
                        p.status === "reviewing" ? "bg-purple-100 text-purple-700 border-purple-200" :
                        "bg-gray-100 text-gray-600 border-gray-200"
                      }`}>
                        {p.status === "selected" ? "채택됨" : p.status === "testing" ? "테스트중" : p.status === "reviewing" ? "검토중" : p.status}
                      </Badge>
                    )}
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
            <p className="text-sm mt-1 text-pink-400">70점 이상 상품이 자동으로 분류됩니다</p>
            <p className="text-xs mt-2 text-gray-400">검색수요 페이지에서 키워드를 소싱 등록하면 시장 데이터 기반으로 점수가 산출됩니다</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
