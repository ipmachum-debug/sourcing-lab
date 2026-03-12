import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { useParams } from "wouter";
import { toast } from "sonner";
import { useState } from "react";
import { ArrowLeft, Plus, Trash2, Calculator, Star, Sparkles, ExternalLink, Link2, ShoppingBag, Factory, ChevronDown, ChevronRight, Pencil, Check, X } from "lucide-react";
import { useLocation } from "wouter";

const STATUS_LABELS: Record<string, string> = {
  draft: "초안", reviewing: "검토중", test_candidate: "테스트후보",
  testing: "테스트중", hold: "보류", dropped: "폐기", selected: "선정",
};

export default function ProductDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.product.getDetail.useQuery({ id });

  const changeStatus = trpc.sourcing.changeStatus.useMutation({
    onSuccess: () => { toast.success("상태가 변경되었습니다! ✨"); utils.product.getDetail.invalidate({ id }); },
  });

  if (isLoading) return (
    <DashboardLayout>
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="cute-dots"><div className="cute-dot" /><div className="cute-dot" /><div className="cute-dot" /></div>
        <p className="text-sm text-pink-400">로딩중...</p>
      </div>
    </DashboardLayout>
  );
  if (!data) return <DashboardLayout><div className="text-center py-12 text-muted-foreground">상품을 찾을 수 없습니다</div></DashboardLayout>;

  const { product: p, competitors, suppliers, marginScenarios, notes, keywordLinks } = data;
  const keywords = [p.keyword1, p.keyword2, p.keyword3].filter(Boolean) as string[];

  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center gap-4 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/products")} className="text-pink-500 hover:text-pink-600 hover:bg-pink-50 rounded-xl">
            <ArrowLeft className="h-4 w-4 mr-1" /> 목록
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold gradient-text truncate">{p.productName}</h1>
            <p className="text-sm text-muted-foreground">{p.recordDate} | {p.category || "미분류"}</p>
          </div>
          <Badge className={`text-lg px-4 py-1.5 ${
            p.scoreGrade === "S" ? "bg-gradient-to-r from-pink-400 to-rose-500 text-white border-0" :
            p.scoreGrade === "A" ? "bg-gradient-to-r from-purple-400 to-fuchsia-500 text-white border-0" :
            "bg-gray-100 text-gray-700 border-gray-200"
          } shadow-md`}>
            {p.scoreGrade === "S" && <Star className="h-4 w-4 mr-1" />}
            {p.scoreGrade} ({p.score}점)
          </Badge>
          <Select value={p.status} onValueChange={v => changeStatus.mutate({ id, status: v as any })}>
            <SelectTrigger className="w-[140px] pretty-input"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <Tabs defaultValue="info">
          <TabsList className="bg-gradient-to-r from-pink-50 to-purple-50 border border-pink-100/50 rounded-xl p-1">
            <TabsTrigger value="info" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-pink-700 data-[state=active]:shadow-sm">📋 기본정보</TabsTrigger>
            <TabsTrigger value="keyword-links" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-pink-700 data-[state=active]:shadow-sm">🔗 키워드링크 ({keywordLinks?.length || 0})</TabsTrigger>
            <TabsTrigger value="competitors" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-pink-700 data-[state=active]:shadow-sm">⚔️ 경쟁사 ({competitors.length})</TabsTrigger>
            <TabsTrigger value="suppliers" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-pink-700 data-[state=active]:shadow-sm">🏭 공급처 ({suppliers.length})</TabsTrigger>
            <TabsTrigger value="margin" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-pink-700 data-[state=active]:shadow-sm">💰 마진분석 ({marginScenarios.length})</TabsTrigger>
            <TabsTrigger value="notes" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-pink-700 data-[state=active]:shadow-sm">📝 노트 ({notes.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="space-y-4 mt-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="pretty-card">
                <CardHeader className="pb-2"><CardTitle className="text-sm gradient-text-soft flex items-center gap-1.5">🔑 키워드</CardTitle></CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {[p.keyword1, p.keyword2, p.keyword3].filter(Boolean).map((kw, i) => (
                    <Badge key={i} className="bg-gradient-to-r from-pink-50 to-purple-50 text-pink-700 border-pink-200 px-3 py-1">{kw}</Badge>
                  ))}
                </CardContent>
              </Card>
              <Card className="pretty-card">
                <CardHeader className="pb-2"><CardTitle className="text-sm gradient-text-soft flex items-center gap-1.5">📊 평가</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between p-2 rounded-lg hover:bg-pink-50/40"><span className="text-muted-foreground">경쟁도</span><span className="font-medium">{p.competitionLevel}</span></div>
                  <div className="flex justify-between p-2 rounded-lg hover:bg-pink-50/40"><span className="text-muted-foreground">차별화</span><span className="font-medium">{p.differentiationLevel}</span></div>
                  <div className="flex justify-between p-2 rounded-lg hover:bg-pink-50/40"><span className="text-muted-foreground">타겟고객</span><span className="font-medium">{p.targetCustomer || "-"}</span></div>
                  <div className="flex justify-between p-2 rounded-lg hover:bg-pink-50/40"><span className="text-muted-foreground">시즌성</span><span className="font-medium">{p.seasonality || "-"}</span></div>
                </CardContent>
              </Card>
            </div>
            {p.thumbnailMemo && <Card className="pretty-card"><CardHeader className="pb-2"><CardTitle className="text-sm gradient-text-soft">🖼️ 썸네일 분석</CardTitle></CardHeader><CardContent className="text-sm whitespace-pre-wrap text-muted-foreground">{p.thumbnailMemo}</CardContent></Card>}
            {p.detailPoint && <Card className="pretty-card"><CardHeader className="pb-2"><CardTitle className="text-sm gradient-text-soft">📄 상세페이지 포인트</CardTitle></CardHeader><CardContent className="text-sm whitespace-pre-wrap text-muted-foreground">{p.detailPoint}</CardContent></Card>}
            {p.improvementNote && <Card className="pretty-card"><CardHeader className="pb-2"><CardTitle className="text-sm gradient-text-soft">🔧 단점 보완</CardTitle></CardHeader><CardContent className="text-sm whitespace-pre-wrap text-muted-foreground">{p.improvementNote}</CardContent></Card>}
            {p.developmentNote && <Card className="pretty-card"><CardHeader className="pb-2"><CardTitle className="text-sm gradient-text-soft">🧪 개발 노트</CardTitle></CardHeader><CardContent className="text-sm whitespace-pre-wrap text-muted-foreground">{p.developmentNote}</CardContent></Card>}
            {p.finalOpinion && <Card className="pretty-card"><CardHeader className="pb-2"><CardTitle className="text-sm gradient-text-soft">💬 최종 의견</CardTitle></CardHeader><CardContent className="text-sm whitespace-pre-wrap text-muted-foreground">{p.finalOpinion}</CardContent></Card>}
            {(p.coupangUrl || p.referenceUrl) && (
              <Card className="pretty-card">
                <CardHeader className="pb-2"><CardTitle className="text-sm gradient-text-soft">🔗 참고 링크</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {p.coupangUrl && <a href={p.coupangUrl} target="_blank" rel="noreferrer" className="text-pink-500 hover:text-pink-600 hover:underline flex items-center gap-1 truncate"><ExternalLink className="h-3 w-3 shrink-0" />{p.coupangUrl}</a>}
                  {p.referenceUrl && <a href={p.referenceUrl} target="_blank" rel="noreferrer" className="text-purple-500 hover:text-purple-600 hover:underline flex items-center gap-1 truncate"><ExternalLink className="h-3 w-3 shrink-0" />{p.referenceUrl}</a>}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="keyword-links" className="mt-4">
            <KeywordLinksSection productId={id} keywords={keywords} keywordLinks={keywordLinks || []} />
          </TabsContent>
          <TabsContent value="competitors" className="mt-4">
            <CompetitorSection productId={id} competitors={competitors} />
          </TabsContent>
          <TabsContent value="suppliers" className="mt-4">
            <SupplierSection productId={id} suppliers={suppliers} />
          </TabsContent>
          <TabsContent value="margin" className="mt-4">
            <MarginSection productId={id} scenarios={marginScenarios} />
          </TabsContent>
          <TabsContent value="notes" className="mt-4">
            <NoteSection productId={id} notes={notes} />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function KeywordLinksSection({ productId, keywords, keywordLinks }: { productId: number; keywords: string[]; keywordLinks: any[] }) {
  const [expandedKw, setExpandedKw] = useState<number | null>(keywords.length > 0 ? 1 : null);
  const [newUrl, setNewUrl] = useState("");
  const [newMemo, setNewMemo] = useState("");
  const [addingFor, setAddingFor] = useState<{ kwIdx: number; type: "coupang" | "1688" } | null>(null);
  const utils = trpc.useUtils();

  const upsert = trpc.product.upsertKeywordLink.useMutation({
    onSuccess: () => { toast.success("링크가 저장되었습니다! ✨"); setNewUrl(""); setNewMemo(""); setAddingFor(null); utils.product.getDetail.invalidate({ id: productId }); },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.product.deleteKeywordLink.useMutation({
    onSuccess: () => { toast.success("삭제되었습니다"); utils.product.getDetail.invalidate({ id: productId }); },
  });

  const getLinksFor = (kwIdx: number, type: "coupang" | "1688") =>
    keywordLinks.filter(l => l.keywordIndex === kwIdx && l.linkType === type)
      .sort((a, b) => a.slot - b.slot);

  const getNextSlot = (kwIdx: number, type: "coupang" | "1688") => {
    const existing = getLinksFor(kwIdx, type);
    if (existing.length >= 10) return null;
    const usedSlots = new Set(existing.map(l => l.slot));
    for (let i = 1; i <= 10; i++) { if (!usedSlots.has(i)) return i; }
    return null;
  };

  const handleAddLink = (kwIdx: number, type: "coupang" | "1688") => {
    const slot = getNextSlot(kwIdx, type);
    if (!slot || !newUrl.trim()) return;
    upsert.mutate({ productId, keywordIndex: kwIdx, linkType: type, slot, url: newUrl.trim(), memo: newMemo.trim() || undefined });
  };

  if (keywords.length === 0) {
    return (
      <Card className="pretty-card">
        <CardContent className="pt-6 text-center text-muted-foreground">
          <Link2 className="h-10 w-10 mx-auto mb-3 text-pink-300" />
          <p className="text-sm">키워드가 등록되지 않았습니다.</p>
          <p className="text-xs mt-1">기본정보 탭에서 키워드를 먼저 입력해주세요.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground bg-gradient-to-r from-pink-50 to-purple-50 rounded-xl p-3 border border-pink-100/50">
        <span className="font-medium gradient-text-soft">💡 키워드별 쿠팡/1688 링크 관리</span>
        <span className="ml-2">— 키워드당 쿠팡 10개, 1688 10개까지 등록 가능합니다.</span>
      </div>

      {keywords.map((kw, idx) => {
        const kwIdx = idx + 1;
        const isExpanded = expandedKw === kwIdx;
        const coupangLinks = getLinksFor(kwIdx, "coupang");
        const links1688 = getLinksFor(kwIdx, "1688");
        const totalLinks = coupangLinks.length + links1688.length;

        return (
          <Card key={kwIdx} className="pretty-card overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-pink-300 via-purple-300 to-fuchsia-300" />
            <CardHeader
              className="pb-2 cursor-pointer hover:bg-pink-50/30 transition-colors"
              onClick={() => setExpandedKw(isExpanded ? null : kwIdx)}
            >
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  {isExpanded ? <ChevronDown className="h-4 w-4 text-pink-400" /> : <ChevronRight className="h-4 w-4 text-pink-400" />}
                  <Badge className="bg-gradient-to-r from-pink-100 to-purple-100 text-pink-700 border-pink-200 px-3 py-0.5">
                    키워드 {kwIdx}
                  </Badge>
                  <span className="gradient-text-soft font-semibold">{kw}</span>
                </CardTitle>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><ShoppingBag className="h-3 w-3 text-pink-400" /> {coupangLinks.length}/10</span>
                  <span className="flex items-center gap-1"><Factory className="h-3 w-3 text-purple-400" /> {links1688.length}/10</span>
                  <Badge variant="outline" className="text-xs border-pink-200 text-pink-600">{totalLinks}개</Badge>
                </div>
              </div>
            </CardHeader>

            {isExpanded && (
              <CardContent className="space-y-4 pt-0">
                {/* Coupang Links */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <ShoppingBag className="h-4 w-4 text-pink-500" />
                    <span className="text-sm font-medium text-pink-600">쿠팡 링크</span>
                    <Badge variant="outline" className="text-xs border-pink-200 text-pink-500">{coupangLinks.length}/10</Badge>
                    {coupangLinks.length < 10 && (
                      <Button
                        variant="ghost" size="sm"
                        className="ml-auto text-xs text-pink-500 hover:text-pink-600 hover:bg-pink-50 h-7 px-2"
                        onClick={(e) => { e.stopPropagation(); setAddingFor(addingFor?.kwIdx === kwIdx && addingFor.type === "coupang" ? null : { kwIdx, type: "coupang" }); setNewUrl(""); setNewMemo(""); }}
                      >
                        <Plus className="h-3 w-3 mr-1" /> 추가
                      </Button>
                    )}
                  </div>

                  {addingFor?.kwIdx === kwIdx && addingFor.type === "coupang" && (
                    <div className="bg-pink-50/50 rounded-xl p-3 space-y-2 border border-pink-100/50">
                      <Input
                        placeholder="https://www.coupang.com/..."
                        value={newUrl}
                        onChange={e => setNewUrl(e.target.value)}
                        className="pretty-input text-sm"
                      />
                      <div className="flex gap-2">
                        <Input
                          placeholder="메모 (선택)"
                          value={newMemo}
                          onChange={e => setNewMemo(e.target.value)}
                          className="pretty-input text-sm flex-1"
                        />
                        <Button
                          size="sm"
                          disabled={!newUrl.trim() || upsert.isPending}
                          onClick={() => handleAddLink(kwIdx, "coupang")}
                          className="bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white rounded-lg text-xs px-4"
                        >
                          {upsert.isPending ? "..." : "저장"}
                        </Button>
                      </div>
                    </div>
                  )}

                  {coupangLinks.length > 0 ? (
                    <div className="space-y-1.5">
                      {coupangLinks.map(link => (
                        <div key={link.id} className="flex items-center gap-2 group bg-white/60 rounded-lg px-3 py-2 border border-pink-100/40 hover:border-pink-200 transition-colors">
                          <span className="text-xs text-pink-400 font-mono w-5 shrink-0">#{link.slot}</span>
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-pink-600 hover:text-pink-700 hover:underline truncate flex-1 flex items-center gap-1.5"
                          >
                            <ExternalLink className="h-3 w-3 shrink-0" />
                            <span className="truncate">{link.memo || link.url}</span>
                          </a>
                          <Button
                            variant="ghost" size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50"
                            onClick={() => del.mutate({ id: link.id })}
                          >
                            <Trash2 className="h-3 w-3 text-red-400" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground pl-6">등록된 쿠팡 링크가 없습니다.</p>
                  )}
                </div>

                <div className="border-t border-pink-100/50" />

                {/* 1688 Links */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Factory className="h-4 w-4 text-purple-500" />
                    <span className="text-sm font-medium text-purple-600">1688 링크</span>
                    <Badge variant="outline" className="text-xs border-purple-200 text-purple-500">{links1688.length}/10</Badge>
                    {links1688.length < 10 && (
                      <Button
                        variant="ghost" size="sm"
                        className="ml-auto text-xs text-purple-500 hover:text-purple-600 hover:bg-purple-50 h-7 px-2"
                        onClick={(e) => { e.stopPropagation(); setAddingFor(addingFor?.kwIdx === kwIdx && addingFor.type === "1688" ? null : { kwIdx, type: "1688" }); setNewUrl(""); setNewMemo(""); }}
                      >
                        <Plus className="h-3 w-3 mr-1" /> 추가
                      </Button>
                    )}
                  </div>

                  {addingFor?.kwIdx === kwIdx && addingFor.type === "1688" && (
                    <div className="bg-purple-50/50 rounded-xl p-3 space-y-2 border border-purple-100/50">
                      <Input
                        placeholder="https://detail.1688.com/..."
                        value={newUrl}
                        onChange={e => setNewUrl(e.target.value)}
                        className="pretty-input text-sm"
                      />
                      <div className="flex gap-2">
                        <Input
                          placeholder="메모 (선택)"
                          value={newMemo}
                          onChange={e => setNewMemo(e.target.value)}
                          className="pretty-input text-sm flex-1"
                        />
                        <Button
                          size="sm"
                          disabled={!newUrl.trim() || upsert.isPending}
                          onClick={() => handleAddLink(kwIdx, "1688")}
                          className="bg-gradient-to-r from-purple-500 to-fuchsia-500 hover:from-purple-600 hover:to-fuchsia-600 text-white rounded-lg text-xs px-4"
                        >
                          {upsert.isPending ? "..." : "저장"}
                        </Button>
                      </div>
                    </div>
                  )}

                  {links1688.length > 0 ? (
                    <div className="space-y-1.5">
                      {links1688.map(link => (
                        <div key={link.id} className="flex items-center gap-2 group bg-white/60 rounded-lg px-3 py-2 border border-purple-100/40 hover:border-purple-200 transition-colors">
                          <span className="text-xs text-purple-400 font-mono w-5 shrink-0">#{link.slot}</span>
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-purple-600 hover:text-purple-700 hover:underline truncate flex-1 flex items-center gap-1.5"
                          >
                            <ExternalLink className="h-3 w-3 shrink-0" />
                            <span className="truncate">{link.memo || link.url}</span>
                          </a>
                          <Button
                            variant="ghost" size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50"
                            onClick={() => del.mutate({ id: link.id })}
                          >
                            <Trash2 className="h-3 w-3 text-red-400" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground pl-6">등록된 1688 링크가 없습니다.</p>
                  )}
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function CompetitorSection({ productId, competitors }: { productId: number; competitors: any[] }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [price, setPrice] = useState("");
  const [memo, setMemo] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editData, setEditData] = useState<{ name: string; url: string; price: string; memo: string }>({ name: "", url: "", price: "", memo: "" });
  const utils = trpc.useUtils();
  const add = trpc.product.addCompetitor.useMutation({
    onSuccess: () => { toast.success("경쟁사가 추가되었습니다! ✨"); setName(""); setUrl(""); setPrice(""); setMemo(""); utils.product.getDetail.invalidate({ id: productId }); },
  });
  const update = trpc.product.updateCompetitor.useMutation({
    onSuccess: () => { toast.success("수정되었습니다 ✨"); setEditingId(null); utils.product.getDetail.invalidate({ id: productId }); },
  });
  const del = trpc.product.deleteCompetitor.useMutation({
    onSuccess: () => { toast.success("삭제되었습니다"); utils.product.getDetail.invalidate({ id: productId }); },
  });

  const startEdit = (c: any) => {
    setEditingId(c.id);
    setEditData({ name: c.name || "", url: c.url || "", price: c.price ? String(Number(c.price)) : "", memo: c.memo || "" });
  };

  return (
    <div className="space-y-4">
      <Card className="pretty-card">
        <CardHeader className="pb-2"><CardTitle className="text-sm gradient-text-soft">⚔️ 경쟁사 추가</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder="경쟁사명" value={name} onChange={e => setName(e.target.value)} className="pretty-input" />
            <Input placeholder="가격 (원)" value={price} onChange={e => setPrice(e.target.value)} className="pretty-input" />
          </div>
          <Input placeholder="상품 URL" value={url} onChange={e => setUrl(e.target.value)} className="pretty-input" />
          <Textarea placeholder="메모 (강점, 약점 등)" value={memo} onChange={e => setMemo(e.target.value)} rows={2} className="pretty-input" />
          <Button size="sm" onClick={() => add.mutate({ productId, name, url, price, memo })} disabled={!name} className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white rounded-xl">
            <Plus className="h-4 w-4 mr-1" /> 추가
          </Button>
        </CardContent>
      </Card>
      {competitors.map(c => (
        <Card key={c.id} className="pretty-card">
          <CardContent className="pt-4">
            {editingId === c.id ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Input placeholder="경쟁사명" value={editData.name} onChange={e => setEditData(p => ({ ...p, name: e.target.value }))} className="pretty-input" />
                  <Input placeholder="가격 (원)" value={editData.price} onChange={e => setEditData(p => ({ ...p, price: e.target.value }))} className="pretty-input" />
                </div>
                <Input placeholder="상품 URL" value={editData.url} onChange={e => setEditData(p => ({ ...p, url: e.target.value }))} className="pretty-input" />
                <Textarea placeholder="메모" value={editData.memo} onChange={e => setEditData(p => ({ ...p, memo: e.target.value }))} rows={2} className="pretty-input" />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => update.mutate({ id: c.id, name: editData.name || undefined, url: editData.url || undefined, price: editData.price || undefined, memo: editData.memo || undefined })} className="bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl text-xs">
                    <Check className="h-3.5 w-3.5 mr-1" /> 저장
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} className="text-muted-foreground rounded-xl text-xs">
                    <X className="h-3.5 w-3.5 mr-1" /> 취소
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <p className="font-medium">{c.name}</p>
                  {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="text-xs text-pink-500 hover:underline truncate block">{c.url}</a>}
                  {c.price && <p className="text-sm mt-1">가격: <span className="font-semibold text-pink-600">{Number(c.price).toLocaleString()}원</span></p>}
                  {c.memo && <p className="text-sm text-muted-foreground mt-1">{c.memo}</p>}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => startEdit(c)} className="hover:bg-pink-50 h-8 w-8"><Pencil className="h-3.5 w-3.5 text-pink-400" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => del.mutate({ id: c.id })} className="hover:bg-red-50 h-8 w-8"><Trash2 className="h-3.5 w-3.5 text-red-400" /></Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function SupplierSection({ productId, suppliers }: { productId: number; suppliers: any[] }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [memo, setMemo] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editData, setEditData] = useState<{ name: string; url: string; unitCost: string; memo: string }>({ name: "", url: "", unitCost: "", memo: "" });
  const utils = trpc.useUtils();
  const add = trpc.product.addSupplier.useMutation({
    onSuccess: () => { toast.success("공급처가 추가되었습니다! ✨"); setName(""); setUrl(""); setUnitCost(""); setMemo(""); utils.product.getDetail.invalidate({ id: productId }); },
  });
  const update = trpc.product.updateSupplier.useMutation({
    onSuccess: () => { toast.success("수정되었습니다 ✨"); setEditingId(null); utils.product.getDetail.invalidate({ id: productId }); },
  });
  const del = trpc.product.deleteSupplier.useMutation({
    onSuccess: () => { toast.success("삭제되었습니다"); utils.product.getDetail.invalidate({ id: productId }); },
  });

  const startEdit = (s: any) => {
    setEditingId(s.id);
    setEditData({ name: s.supplierName || "", url: s.url1688 || "", unitCost: s.unitCost ? String(Number(s.unitCost)) : "", memo: s.memo || "" });
  };

  return (
    <div className="space-y-4">
      <Card className="pretty-card">
        <CardHeader className="pb-2"><CardTitle className="text-sm gradient-text-soft">🏭 공급처 추가</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder="공급처명" value={name} onChange={e => setName(e.target.value)} className="pretty-input" />
            <Input placeholder="단가 (원)" value={unitCost} onChange={e => setUnitCost(e.target.value)} className="pretty-input" />
          </div>
          <Input placeholder="1688 URL" value={url} onChange={e => setUrl(e.target.value)} className="pretty-input" />
          <Textarea placeholder="메모" value={memo} onChange={e => setMemo(e.target.value)} rows={2} className="pretty-input" />
          <Button size="sm" onClick={() => add.mutate({ productId, supplierName: name, url1688: url, unitCost, memo })} disabled={!name} className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white rounded-xl">
            <Plus className="h-4 w-4 mr-1" /> 추가
          </Button>
        </CardContent>
      </Card>
      {suppliers.map(s => (
        <Card key={s.id} className="pretty-card">
          <CardContent className="pt-4">
            {editingId === s.id ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Input placeholder="공급처명" value={editData.name} onChange={e => setEditData(p => ({ ...p, name: e.target.value }))} className="pretty-input" />
                  <Input placeholder="단가 (원)" value={editData.unitCost} onChange={e => setEditData(p => ({ ...p, unitCost: e.target.value }))} className="pretty-input" />
                </div>
                <Input placeholder="1688 URL" value={editData.url} onChange={e => setEditData(p => ({ ...p, url: e.target.value }))} className="pretty-input" />
                <Textarea placeholder="메모" value={editData.memo} onChange={e => setEditData(p => ({ ...p, memo: e.target.value }))} rows={2} className="pretty-input" />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => update.mutate({ id: s.id, supplierName: editData.name || undefined, url1688: editData.url || undefined, unitCost: editData.unitCost || undefined, memo: editData.memo || undefined })} className="bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl text-xs">
                    <Check className="h-3.5 w-3.5 mr-1" /> 저장
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} className="text-muted-foreground rounded-xl text-xs">
                    <X className="h-3.5 w-3.5 mr-1" /> 취소
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <p className="font-medium">{s.supplierName}</p>
                  {s.url1688 && <a href={s.url1688} target="_blank" rel="noreferrer" className="text-xs text-pink-500 hover:underline truncate block">{s.url1688}</a>}
                  {s.unitCost && <p className="text-sm mt-1">단가: <span className="font-semibold text-pink-600">{Number(s.unitCost).toLocaleString()}원</span></p>}
                  {s.memo && <p className="text-sm text-muted-foreground mt-1">{s.memo}</p>}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => startEdit(s)} className="hover:bg-pink-50 h-8 w-8"><Pencil className="h-3.5 w-3.5 text-pink-400" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => del.mutate({ id: s.id })} className="hover:bg-red-50 h-8 w-8"><Trash2 className="h-3.5 w-3.5 text-red-400" /></Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MarginSection({ productId, scenarios }: { productId: number; scenarios: any[] }) {
  const [label, setLabel] = useState<"conservative" | "normal" | "aggressive">("normal");
  const [supplyCost, setSupplyCost] = useState("0");
  const [intlShip, setIntlShip] = useState("0");
  const [domShip, setDomShip] = useState("3000");
  const [pkgCost, setPkgCost] = useState("0");
  const [feeRate, setFeeRate] = useState("10.8");
  const [adRate, setAdRate] = useState("15");
  const [sellPrice, setSellPrice] = useState("0");
  const [editingId, setEditingId] = useState<number | null>(null);
  const utils = trpc.useUtils();

  const upsert = trpc.product.upsertMargin.useMutation({
    onSuccess: (res) => {
      toast.success(`마진이 계산되었습니다! 순이익: ${Number(res.calculated.profit).toLocaleString()}원 ✨`);
      setEditingId(null);
      utils.product.getDetail.invalidate({ id: productId });
    },
  });
  const del = trpc.product.deleteMargin.useMutation({
    onSuccess: () => { toast.success("삭제되었습니다"); utils.product.getDetail.invalidate({ id: productId }); },
  });

  const loadForEdit = (s: any) => {
    setEditingId(s.id);
    setLabel(s.label);
    setSupplyCost(String(Number(s.supplyCost || 0)));
    setIntlShip(String(Number(s.internationalShippingCost || 0)));
    setDomShip(String(Number(s.domesticShippingCost || 0)));
    setPkgCost(String(Number(s.packagingCost || 0)));
    setFeeRate(String(Number(s.feeRate || 10.8)));
    setAdRate(String(Number(s.adRate || 15)));
    setSellPrice(String(Number(s.sellPrice || 0)));
  };

  const resetForm = () => {
    setEditingId(null);
    setLabel("normal"); setSupplyCost("0"); setIntlShip("0"); setDomShip("3000"); setPkgCost("0"); setFeeRate("10.8"); setAdRate("15"); setSellPrice("0");
  };

  return (
    <div className="space-y-4">
      <Card className="pretty-card">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm gradient-text-soft">💰 {editingId ? "마진 시나리오 수정" : "마진 시나리오 추가"}</CardTitle>
            {editingId && (
              <Button variant="ghost" size="sm" onClick={resetForm} className="text-xs text-muted-foreground hover:bg-pink-50 rounded-lg">
                <X className="h-3.5 w-3.5 mr-1" /> 수정 취소 (새로 추가)
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={label} onValueChange={v => setLabel(v as any)}>
            <SelectTrigger className="pretty-input"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="conservative">보수적</SelectItem>
              <SelectItem value="normal">일반</SelectItem>
              <SelectItem value="aggressive">공격적</SelectItem>
            </SelectContent>
          </Select>
          <div className="grid grid-cols-3 gap-3">
            <div><Label className="text-xs text-muted-foreground">공급가</Label><Input value={supplyCost} onChange={e => setSupplyCost(e.target.value)} className="pretty-input mt-1" /></div>
            <div><Label className="text-xs text-muted-foreground">해외배송비</Label><Input value={intlShip} onChange={e => setIntlShip(e.target.value)} className="pretty-input mt-1" /></div>
            <div><Label className="text-xs text-muted-foreground">국내배송비</Label><Input value={domShip} onChange={e => setDomShip(e.target.value)} className="pretty-input mt-1" /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label className="text-xs text-muted-foreground">포장비</Label><Input value={pkgCost} onChange={e => setPkgCost(e.target.value)} className="pretty-input mt-1" /></div>
            <div><Label className="text-xs text-muted-foreground">수수료율(%)</Label><Input value={feeRate} onChange={e => setFeeRate(e.target.value)} className="pretty-input mt-1" /></div>
            <div><Label className="text-xs text-muted-foreground">광고비율(%)</Label><Input value={adRate} onChange={e => setAdRate(e.target.value)} className="pretty-input mt-1" /></div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">판매가</Label>
            <Input value={sellPrice} onChange={e => setSellPrice(e.target.value)} className="pretty-input mt-1 text-lg font-bold" />
          </div>
          <Button size="sm" onClick={() => upsert.mutate({ ...(editingId ? { id: editingId } : {}), productId, label, supplyCost, internationalShippingCost: intlShip, domesticShippingCost: domShip, packagingCost: pkgCost, feeRate, adRate, sellPrice })}
            className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white rounded-xl">
            <Calculator className="h-4 w-4 mr-1" /> {editingId ? "수정 & 재계산" : "계산 & 저장"}
          </Button>
        </CardContent>
      </Card>
      {scenarios.map(s => (
        <Card key={s.id} className={`pretty-card ${editingId === s.id ? "ring-2 ring-pink-300" : ""} ${Number(s.marginRate) < 20 ? "border-l-4 border-l-amber-300" : Number(s.marginRate) >= 30 ? "border-l-4 border-l-pink-400" : ""}`}>
          <CardContent className="pt-4 flex items-start gap-3">
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className="bg-purple-100 text-purple-700 border-purple-200">{{ conservative: "보수적", normal: "일반", aggressive: "공격적" }[s.label as "conservative" | "normal" | "aggressive"] || s.label}</Badge>
                <span className={`text-lg font-bold ${Number(s.marginRate) >= 30 ? "text-pink-500" : Number(s.marginRate) >= 20 ? "text-purple-500" : "text-amber-500"}`}>마진율 {s.marginRate}%</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                <span>판매가: {Number(s.sellPrice).toLocaleString()}</span>
                <span>총원가: {Number(s.totalCost).toLocaleString()}</span>
                <span>수수료: {Number(s.feeAmount).toLocaleString()}</span>
                <span>광고비: {Number(s.adAmount).toLocaleString()}</span>
                <span className={`font-semibold ${Number(s.profit) > 0 ? "text-pink-600" : "text-red-500"}`}>
                  순이익: {Number(s.profit).toLocaleString()}
                </span>
                <span>손익분기: {s.breakEvenAdRate}%</span>
              </div>
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" onClick={() => loadForEdit(s)} className="hover:bg-pink-50 h-8 w-8"><Pencil className="h-3.5 w-3.5 text-pink-400" /></Button>
              <Button variant="ghost" size="icon" onClick={() => del.mutate({ id: s.id })} className="hover:bg-red-50 h-8 w-8"><Trash2 className="h-3.5 w-3.5 text-red-400" /></Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function NoteSection({ productId, notes }: { productId: number; notes: any[] }) {
  const [type, setType] = useState<"improvement" | "development" | "memo" | "review">("memo");
  const [content, setContent] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editData, setEditData] = useState<{ type: string; content: string }>({ type: "memo", content: "" });
  const utils = trpc.useUtils();
  const add = trpc.product.addNote.useMutation({
    onSuccess: () => { toast.success("노트가 추가되었습니다! ✨"); setContent(""); utils.product.getDetail.invalidate({ id: productId }); },
  });
  const update = trpc.product.updateNote.useMutation({
    onSuccess: () => { toast.success("수정되었습니다 ✨"); setEditingId(null); utils.product.getDetail.invalidate({ id: productId }); },
  });
  const del = trpc.product.deleteNote.useMutation({
    onSuccess: () => { toast.success("삭제되었습니다"); utils.product.getDetail.invalidate({ id: productId }); },
  });
  const typeLabels: Record<string, string> = { improvement: "단점보완", development: "개발", memo: "메모", review: "리뷰" };

  return (
    <div className="space-y-4">
      <Card className="pretty-card">
        <CardHeader className="pb-2"><CardTitle className="text-sm gradient-text-soft">📝 노트 추가</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Select value={type} onValueChange={v => setType(v as any)}>
            <SelectTrigger className="pretty-input"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(typeLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Textarea placeholder="내용을 입력하세요" value={content} onChange={e => setContent(e.target.value)} rows={3} className="pretty-input" />
          <Button size="sm" onClick={() => add.mutate({ productId, type, content })} disabled={!content} className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white rounded-xl">
            <Plus className="h-4 w-4 mr-1" /> 추가
          </Button>
        </CardContent>
      </Card>
      {notes.map(n => (
        <Card key={n.id} className="pretty-card">
          <CardContent className="pt-4">
            {editingId === n.id ? (
              <div className="space-y-3">
                <Select value={editData.type} onValueChange={v => setEditData(p => ({ ...p, type: v }))}>
                  <SelectTrigger className="pretty-input"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(typeLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Textarea value={editData.content} onChange={e => setEditData(p => ({ ...p, content: e.target.value }))} rows={3} className="pretty-input" />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => update.mutate({ id: n.id, type: editData.type as any, content: editData.content })} disabled={!editData.content} className="bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl text-xs">
                    <Check className="h-3.5 w-3.5 mr-1" /> 저장
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} className="text-muted-foreground rounded-xl text-xs">
                    <X className="h-3.5 w-3.5 mr-1" /> 취소
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <Badge className="text-xs mb-2 bg-pink-50 text-pink-700 border-pink-200">{typeLabels[n.type] || n.type}</Badge>
                  <p className="text-sm whitespace-pre-wrap">{n.content}</p>
                  <p className="text-xs text-muted-foreground mt-2">{new Date(n.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => { setEditingId(n.id); setEditData({ type: n.type, content: n.content }); }} className="hover:bg-pink-50 h-8 w-8"><Pencil className="h-3.5 w-3.5 text-pink-400" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => del.mutate({ id: n.id })} className="hover:bg-red-50 h-8 w-8"><Trash2 className="h-3.5 w-3.5 text-red-400" /></Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
