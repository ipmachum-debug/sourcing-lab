import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Building, Users, Briefcase, Phone, Mail } from "lucide-react";

const STATUS_MAP: Record<string, { label: string; variant: string }> = {
  active: { label: "활성", variant: "default" },
  paused: { label: "일시정지", variant: "secondary" },
  completed: { label: "완료", variant: "outline" },
  prospect: { label: "잠재고객", variant: "secondary" },
};

export default function ClientManager() {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [industry, setIndustry] = useState("");
  const [budget, setBudget] = useState("");
  const [memo, setMemo] = useState("");

  const utils = trpc.useUtils();
  const clients = trpc.marketing.clients.list.useQuery();
  const createClient = trpc.marketing.clients.create.useMutation({
    onSuccess: () => {
      toast.success("고객사가 등록되었습니다.");
      setShowAdd(false);
      setName(""); setContactName(""); setContactEmail(""); setContactPhone("");
      setIndustry(""); setBudget(""); setMemo("");
      utils.marketing.clients.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteClient = trpc.marketing.clients.delete.useMutation({
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      utils.marketing.clients.list.invalidate();
    },
  });

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">고객사 관리</h1>
            <p className="text-muted-foreground text-sm mt-1">에이전시 모드 — 여러 고객사를 한곳에서 관리</p>
          </div>
          <Dialog open={showAdd} onOpenChange={setShowAdd}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-1" />고객사 추가</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>고객사 등록</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <Input placeholder="회사명 *" value={name} onChange={e => setName(e.target.value)} />
                <Input placeholder="담당자명" value={contactName} onChange={e => setContactName(e.target.value)} />
                <Input placeholder="이메일" type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} />
                <Input placeholder="전화번호" value={contactPhone} onChange={e => setContactPhone(e.target.value)} />
                <Input placeholder="업종 (예: 식품, 패션, IT)" value={industry} onChange={e => setIndustry(e.target.value)} />
                <Input placeholder="월 예산 (원)" type="number" value={budget} onChange={e => setBudget(e.target.value)} />
                <Textarea placeholder="메모" value={memo} onChange={e => setMemo(e.target.value)} rows={2} />
                <Button className="w-full" disabled={!name || createClient.isPending}
                  onClick={() => createClient.mutate({
                    name, contactName: contactName || undefined,
                    contactEmail: contactEmail || undefined,
                    contactPhone: contactPhone || undefined,
                    industry: industry || undefined,
                    monthlyBudget: budget || undefined,
                    memo: memo || undefined,
                  })}>
                  {createClient.isPending ? "등록 중..." : "등록"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {clients.data?.length === 0 && (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              <Building className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>등록된 고객사가 없습니다.</p>
              <p className="text-sm">고객사를 추가하면 브랜드/캠페인/리포트를 고객사별로 관리할 수 있습니다.</p>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {clients.data?.map(client => {
            const s = STATUS_MAP[client.status] || STATUS_MAP.active;
            return (
              <Card key={client.id} className="hover:shadow-md transition">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Building className="h-5 w-5 text-muted-foreground" />
                        <h3 className="font-semibold">{client.name}</h3>
                        <Badge variant={s.variant as any} className="text-xs">{s.label}</Badge>
                      </div>
                      {client.industry && (
                        <div className="flex items-center gap-1 text-sm text-muted-foreground mb-1">
                          <Briefcase className="h-3 w-3" /> {client.industry}
                        </div>
                      )}
                      {client.contactName && (
                        <div className="flex items-center gap-1 text-sm text-muted-foreground mb-1">
                          <Users className="h-3 w-3" /> {client.contactName}
                        </div>
                      )}
                      {client.contactEmail && (
                        <div className="flex items-center gap-1 text-sm text-muted-foreground mb-1">
                          <Mail className="h-3 w-3" /> {client.contactEmail}
                        </div>
                      )}
                      {client.contactPhone && (
                        <div className="flex items-center gap-1 text-sm text-muted-foreground mb-1">
                          <Phone className="h-3 w-3" /> {client.contactPhone}
                        </div>
                      )}
                      {client.monthlyBudget && (
                        <p className="text-sm font-medium mt-2">
                          월 예산: {Number(client.monthlyBudget).toLocaleString()}원
                        </p>
                      )}
                      {client.memo && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{client.memo}</p>
                      )}
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => deleteClient.mutate({ id: client.id })}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
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
