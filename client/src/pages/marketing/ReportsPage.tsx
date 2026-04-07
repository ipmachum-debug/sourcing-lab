import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, FileText, Trash2, CheckCircle2, Send } from "lucide-react";

export default function ReportsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [title, setTitle] = useState("");
  const [selectedReport, setSelectedReport] = useState<number | null>(null);

  const utils = trpc.useUtils();
  const reports = trpc.marketing.reports.list.useQuery();
  const reportDetail = trpc.marketing.reports.getById.useQuery(
    { id: selectedReport! },
    { enabled: !!selectedReport }
  );
  const generate = trpc.marketing.reports.generate.useMutation({
    onSuccess: () => {
      toast.success("리포트가 생성되었습니다.");
      setShowCreate(false);
      setPeriodStart(""); setPeriodEnd(""); setTitle("");
      utils.marketing.reports.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const updateStatus = trpc.marketing.reports.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("상태가 변경되었습니다.");
      utils.marketing.reports.list.invalidate();
    },
  });
  const deleteReport = trpc.marketing.reports.delete.useMutation({
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      setSelectedReport(null);
      utils.marketing.reports.list.invalidate();
    },
  });

  const statusMap: Record<string, { label: string; variant: string }> = {
    draft: { label: "초안", variant: "secondary" },
    finalized: { label: "확정", variant: "default" },
    sent: { label: "전송됨", variant: "outline" },
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">성과 리포트</h1>
            <p className="text-muted-foreground text-sm mt-1">AI가 기간별 마케팅 성과 리포트를 자동 생성합니다</p>
          </div>
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-1" />리포트 생성</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>성과 리포트 생성</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <Input placeholder="리포트 제목 (선택)" value={title} onChange={e => setTitle(e.target.value)} />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium block mb-1">시작일</label>
                    <Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">종료일</label>
                    <Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
                  </div>
                </div>
                <Button className="w-full" disabled={!periodStart || !periodEnd || generate.isPending}
                  onClick={() => generate.mutate({
                    periodStart, periodEnd, title: title || undefined,
                  })}>
                  {generate.isPending ? "AI 리포트 생성 중..." : "AI 리포트 생성"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 리포트 목록 */}
          <div className="space-y-3">
            {reports.data?.length === 0 && (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground text-sm">
                  <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  리포트가 없습니다.
                </CardContent>
              </Card>
            )}
            {reports.data?.map(report => {
              const s = statusMap[report.status] || statusMap.draft;
              return (
                <Card key={report.id}
                  className={`cursor-pointer transition ${selectedReport === report.id ? "ring-2 ring-blue-500" : "hover:shadow-md"}`}
                  onClick={() => setSelectedReport(report.id)}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant={s.variant as any} className="text-xs">{s.label}</Badge>
                        </div>
                        <h3 className="text-sm font-medium line-clamp-1">{report.title}</h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          {report.periodStart} ~ {report.periodEnd}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm"
                        onClick={(e) => { e.stopPropagation(); deleteReport.mutate({ id: report.id }); }}>
                        <Trash2 className="h-3 w-3 text-red-500" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* 리포트 상세 */}
          <div className="lg:col-span-2">
            {!selectedReport && (
              <Card>
                <CardContent className="p-12 text-center text-muted-foreground">
                  리포트를 선택하세요.
                </CardContent>
              </Card>
            )}
            {reportDetail.data && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{reportDetail.data.title}</CardTitle>
                    <div className="flex gap-1">
                      {reportDetail.data.status === "draft" && (
                        <Button size="sm" variant="outline"
                          onClick={() => updateStatus.mutate({ id: reportDetail.data!.id, status: "finalized" })}>
                          <CheckCircle2 className="h-3 w-3 mr-1" />확정
                        </Button>
                      )}
                      {reportDetail.data.status === "finalized" && (
                        <Button size="sm" variant="outline"
                          onClick={() => updateStatus.mutate({ id: reportDetail.data!.id, status: "sent" })}>
                          <Send className="h-3 w-3 mr-1" />전송 완료
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {reportDetail.data.periodStart} ~ {reportDetail.data.periodEnd}
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* 요약 */}
                  <div className="p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                    <p className="text-sm leading-relaxed">{reportDetail.data.summary}</p>
                  </div>

                  {/* 하이라이트 */}
                  {(reportDetail.data.highlights as any[])?.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2">주요 지표</h4>
                      <div className="grid grid-cols-2 gap-2">
                        {(reportDetail.data.highlights as any[]).map((h: any, i: number) => (
                          <div key={i} className="p-3 border rounded-lg">
                            <p className="text-xs text-muted-foreground">{h.metric}</p>
                            <p className="text-lg font-bold">{h.value}</p>
                            {h.change && <p className="text-xs text-green-600">{h.change}</p>}
                            {h.comment && <p className="text-xs text-muted-foreground">{h.comment}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 플랫폼별 */}
                  {(reportDetail.data.platformBreakdown as any[])?.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2">플랫폼별 성과</h4>
                      <div className="space-y-2">
                        {(reportDetail.data.platformBreakdown as any[]).map((p: any, i: number) => (
                          <div key={i} className="flex items-center justify-between p-2 border rounded text-sm">
                            <Badge variant="outline">{p.platform}</Badge>
                            <span>조회 {Number(p.totalViews).toLocaleString()}</span>
                            <span>좋아요 {Number(p.totalLikes).toLocaleString()}</span>
                            <span>클릭 {Number(p.totalClicks).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 추천 */}
                  {(reportDetail.data.recommendations as any[])?.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2">AI 추천</h4>
                      {(reportDetail.data.recommendations as any[]).map((r: any, i: number) => (
                        <div key={i} className="p-3 border rounded-lg text-sm mb-2">
                          <p className="font-medium">{r.content}</p>
                          <p className="text-xs text-muted-foreground mt-1">{r.reason}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
