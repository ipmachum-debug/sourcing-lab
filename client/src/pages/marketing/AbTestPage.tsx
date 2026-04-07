import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Play, Trophy, Trash2, FlaskConical } from "lucide-react";

const PLATFORMS = [
  { value: "instagram", label: "인스타그램" },
  { value: "youtube", label: "유튜브" },
  { value: "tiktok", label: "틱톡" },
  { value: "naver_blog", label: "블로그" },
];

export default function AbTestPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState("instagram");
  const [captionA, setCaptionA] = useState("");
  const [captionB, setCaptionB] = useState("");
  const [metric, setMetric] = useState("clicks");
  const [duration, setDuration] = useState("48");
  const [autoExpand, setAutoExpand] = useState(false);

  const utils = trpc.useUtils();
  const tests = trpc.marketing.abTest.list.useQuery();
  const createTest = trpc.marketing.abTest.create.useMutation({
    onSuccess: () => {
      toast.success("A/B 테스트가 생성되었습니다.");
      setShowCreate(false);
      setName(""); setCaptionA(""); setCaptionB("");
      utils.marketing.abTest.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const startTest = trpc.marketing.abTest.start.useMutation({
    onSuccess: () => {
      toast.success("테스트가 시작되었습니다! 두 변형이 발행 큐에 추가됩니다.");
      utils.marketing.abTest.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const checkResult = trpc.marketing.abTest.checkResult.useMutation({
    onSuccess: (data) => {
      if (data.status === "no_data") {
        toast.info("아직 성과 데이터가 없습니다. 잠시 후 다시 확인하세요.");
      } else {
        toast.success(`테스트 완료! 승자: 변형 ${data.winner?.toUpperCase()} (${data.metric}: A=${data.scoreA}, B=${data.scoreB})`);
      }
      utils.marketing.abTest.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteTest = trpc.marketing.abTest.delete.useMutation({
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      utils.marketing.abTest.list.invalidate();
    },
  });

  const statusMap: Record<string, { label: string; variant: string }> = {
    draft: { label: "준비", variant: "secondary" },
    running: { label: "실행 중", variant: "default" },
    completed: { label: "완료", variant: "outline" },
    cancelled: { label: "취소", variant: "secondary" },
  };

  return (
    <DashboardLayout>
      <div className="p-4 space-y-4 max-w-full mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">A/B 테스트</h1>
            <p className="text-muted-foreground text-sm mt-1">카피 변형을 테스트하고 승자를 자동 확산</p>
          </div>
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-1" />테스트 생성</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>A/B 테스트 생성</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <Input placeholder="테스트명" value={name} onChange={e => setName(e.target.value)} />
                <Select value={platform} onValueChange={setPlatform}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PLATFORMS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div>
                  <label className="text-sm font-medium mb-1 block">변형 A (캡션)</label>
                  <Textarea value={captionA} onChange={e => setCaptionA(e.target.value)} rows={3}
                    placeholder="첫 번째 카피 버전..." />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">변형 B (캡션)</label>
                  <Textarea value={captionB} onChange={e => setCaptionB(e.target.value)} rows={3}
                    placeholder="두 번째 카피 버전..." />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium mb-1 block">판정 기준</label>
                    <Select value={metric} onValueChange={setMetric}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="views">조회수</SelectItem>
                        <SelectItem value="likes">좋아요</SelectItem>
                        <SelectItem value="clicks">클릭</SelectItem>
                        <SelectItem value="conversions">전환</SelectItem>
                        <SelectItem value="ctr">CTR</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">테스트 기간 (시간)</label>
                    <Input type="number" value={duration} onChange={e => setDuration(e.target.value)} min={1} max={168} />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-sm">승자 자동 확산</label>
                  <Switch checked={autoExpand} onCheckedChange={setAutoExpand} />
                </div>
                <Button className="w-full" disabled={!name || !captionA || !captionB || createTest.isPending}
                  onClick={() => createTest.mutate({
                    name, platform: platform as any,
                    variantA: { caption: captionA },
                    variantB: { caption: captionB },
                    winnerMetric: metric as any,
                    testDurationHours: Number(duration),
                    autoExpandWinner: autoExpand,
                  })}>
                  테스트 생성
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {tests.data?.length === 0 && (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              <FlaskConical className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>A/B 테스트가 없습니다.</p>
              <p className="text-sm">두 가지 카피를 동시에 테스트하고 더 잘 되는 걸 찾아보세요.</p>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {tests.data?.map(test => {
            const s = statusMap[test.status] || statusMap.draft;
            const varA = test.variantA as any;
            const varB = test.variantB as any;
            return (
              <Card key={test.id}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium">{test.name}</h3>
                        <Badge variant={s.variant as any}>{s.label}</Badge>
                        <Badge variant="outline" className="text-xs">{test.platform}</Badge>
                        <Badge variant="outline" className="text-xs">기준: {test.winnerMetric}</Badge>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {test.status === "draft" && (
                        <Button size="sm" onClick={() => startTest.mutate({ id: test.id })}>
                          <Play className="h-3 w-3 mr-1" />시작
                        </Button>
                      )}
                      {test.status === "running" && (
                        <Button size="sm" variant="outline" onClick={() => checkResult.mutate({ id: test.id })}>
                          <Trophy className="h-3 w-3 mr-1" />결과 확인
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => deleteTest.mutate({ id: test.id })}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className={`p-3 rounded-lg border ${test.winnerVariant === "a" ? "border-green-500 bg-green-50 dark:bg-green-950/20" : ""}`}>
                      <div className="flex items-center gap-1 mb-1">
                        <Badge variant="outline" className="text-xs">A</Badge>
                        {test.winnerVariant === "a" && <Trophy className="h-3 w-3 text-green-500" />}
                      </div>
                      <p className="text-sm line-clamp-3">{varA?.caption || "내용 없음"}</p>
                    </div>
                    <div className={`p-3 rounded-lg border ${test.winnerVariant === "b" ? "border-green-500 bg-green-50 dark:bg-green-950/20" : ""}`}>
                      <div className="flex items-center gap-1 mb-1">
                        <Badge variant="outline" className="text-xs">B</Badge>
                        {test.winnerVariant === "b" && <Trophy className="h-3 w-3 text-green-500" />}
                      </div>
                      <p className="text-sm line-clamp-3">{varB?.caption || "내용 없음"}</p>
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
