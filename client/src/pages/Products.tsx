import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Search, Package, Plus, Star, Sparkles, Trash2, Eye, Pencil, Save, RotateCcw, X, AlertTriangle, Target, Trophy, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  draft: { label: "초안", className: "bg-gray-100 text-gray-600 border-gray-200" },
  reviewing: { label: "검토중", className: "bg-purple-100 text-purple-700 border-purple-200" },
  test_candidate: { label: "테스트후보", className: "bg-pink-100 text-pink-700 border-pink-200" },
  testing: { label: "테스트중", className: "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200" },
  hold: { label: "보류", className: "bg-amber-100 text-amber-700 border-amber-200" },
  dropped: { label: "폐기", className: "bg-red-100 text-red-600 border-red-200" },
  selected: { label: "선정", className: "bg-gradient-to-r from-pink-200 to-purple-200 text-pink-800 border-pink-300 font-semibold" },
};

const CATEGORIES = [
  "생활용품", "주방용품", "욕실용품", "수납/정리", "인테리어", "조명",
  "전자기기", "스마트홈", "반려동물", "유아/아동", "건강/뷰티", "스포츠/아웃도어",
  "캠핑", "자동차", "사무용품", "패션소품", "가방/파우치", "시즌상품", "기타",
];

interface EditFormData {
  recordDate: string;
  category: string;
  productName: string;
  priority: "low" | "medium" | "high";
  keyword1: string;
  keyword2: string;
  keyword3: string;
  targetCustomer: string;
  seasonality: string;
  competitionLevel: "low" | "medium" | "high" | "very_high";
  differentiationLevel: "low" | "medium" | "high";
  thumbnailMemo: string;
  detailPoint: string;
  giftIdea: string;
  improvementNote: string;
  developmentNote: string;
  finalOpinion: string;
  coupangUrl: string;
  referenceUrl: string;
}

function calcPreviewScore(f: EditFormData) {
  let s = 0;
  if (f.keyword1) s += 5; if (f.keyword2) s += 5; if (f.keyword3) s += 5;
  const comp: Record<string, number> = { low: 20, medium: 12, high: 6, very_high: 2 };
  s += comp[f.competitionLevel] || 12;
  const diff: Record<string, number> = { high: 20, medium: 12, low: 4 };
  s += diff[f.differentiationLevel] || 12;
  if (f.thumbnailMemo.length > 5) s += 5;
  if (f.detailPoint.length > 5) s += 5;
  if (f.finalOpinion.length > 5) s += 5;
  if (f.improvementNote.length > 5) s += 8;
  if (f.developmentNote.length > 5) s += 7;
  if (f.targetCustomer) s += 3;
  if (f.giftIdea) s += 3;
  if (f.category) s += 3;
  if (f.coupangUrl || f.referenceUrl) s += 3;
  if (f.keyword1 && f.keyword2 && f.keyword3) s += 3;
  return Math.min(s, 100);
}

function gradeOf(score: number) {
  if (score >= 90) return "S";
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  return "D";
}

function getScoreColor(score: number) {
  if (score >= 85) return "from-pink-500 to-rose-500";
  if (score >= 70) return "from-purple-500 to-fuchsia-500";
  if (score >= 55) return "from-amber-400 to-orange-400";
  return "from-gray-400 to-gray-500";
}

export default function Products() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);

  const { data, isLoading } = trpc.sourcing.list.useQuery({
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    category: categoryFilter !== "all" ? categoryFilter : undefined,
    limit: 200,
  });

  const utils = trpc.useUtils();
  const deleteMut = trpc.sourcing.delete.useMutation({
    onSuccess: () => { toast.success("상품이 삭제되었습니다"); utils.sourcing.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const categories = Array.from(new Set(data?.items?.map(p => p.category).filter(Boolean) || []));

  const openEditModal = (product: any) => {
    setEditingProduct(product);
    setEditModalOpen(true);
  };

  return (
    <DashboardLayout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight gradient-text flex items-center gap-2">
              <span className="text-2xl">📦</span>
              전체 상품
            </h1>
            <p className="text-muted-foreground text-sm mt-1">{data?.total || 0}개의 상품</p>
          </div>
          <Button onClick={() => setLocation("/daily")} className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white shadow-md shadow-pink-200/50 rounded-xl">
            <Plus className="h-4 w-4 mr-1.5" /> 새 상품 등록
          </Button>
        </div>

        {/* Filters */}
        <Card className="pretty-card">
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-wrap gap-3">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-pink-300" />
                  <Input className="pl-9 pretty-input" placeholder="상품명 검색..." value={search} onChange={e => setSearch(e.target.value)} />
                </div>
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px] pretty-input"><SelectValue placeholder="상태" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체 상태</SelectItem>
                  {Object.entries(STATUS_MAP).map(([key, { label }]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[140px] pretty-input"><SelectValue placeholder="카테고리" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체 카테고리</SelectItem>
                  {categories.map(c => <SelectItem key={c!} value={c!}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="pretty-card overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center h-32 gap-3">
                <div className="cute-dots">
                  <div className="cute-dot" />
                  <div className="cute-dot" />
                  <div className="cute-dot" />
                </div>
              </div>
            ) : data?.items && data.items.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow className="bg-gradient-to-r from-pink-50/80 to-purple-50/80 border-b border-pink-100/50">
                    <TableHead className="w-[100px] text-pink-600/80 font-medium">날짜</TableHead>
                    <TableHead className="w-[100px] text-pink-600/80 font-medium">카테고리</TableHead>
                    <TableHead className="text-pink-600/80 font-medium">상품명</TableHead>
                    <TableHead className="w-[200px] text-pink-600/80 font-medium">키워드</TableHead>
                    <TableHead className="w-[60px] text-center text-pink-600/80 font-medium">점수</TableHead>
                    <TableHead className="w-[60px] text-center text-pink-600/80 font-medium">등급</TableHead>
                    <TableHead className="w-[90px] text-center text-pink-600/80 font-medium">상태</TableHead>
                    <TableHead className="w-[130px] text-center text-pink-600/80 font-medium">관리</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map(p => {
                    const st = STATUS_MAP[p.status] || { label: p.status, className: "bg-gray-100 text-gray-600" };
                    return (
                      <TableRow key={p.id} className="cursor-pointer pretty-table-row border-b border-pink-50" onClick={() => setLocation(`/products/${p.id}`)}>
                        <TableCell className="text-xs text-muted-foreground">{p.recordDate}</TableCell>
                        <TableCell>
                          <Badge className="text-xs bg-pink-50 text-pink-600 border-pink-200">{p.category || "미분류"}</Badge>
                        </TableCell>
                        <TableCell className="font-medium">{p.productName}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {[p.keyword1, p.keyword2, p.keyword3].filter(Boolean).join(", ")}
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`font-bold ${(p.score || 0) >= 85 ? "text-pink-500" : (p.score || 0) >= 70 ? "text-purple-500" : "text-muted-foreground"}`}>{p.score}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge className={`text-xs ${
                            p.scoreGrade === "S" ? "bg-gradient-to-r from-pink-100 to-rose-100 text-pink-700 border-pink-200" :
                            p.scoreGrade === "A" ? "bg-purple-100 text-purple-700 border-purple-200" :
                            "bg-gray-100 text-gray-600 border-gray-200"
                          }`}>
                            {p.scoreGrade === "S" && <Star className="h-2.5 w-2.5 mr-0.5" />}
                            {p.scoreGrade}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge className={`text-xs ${st.className}`}>{st.label}</Badge>
                        </TableCell>
                        <TableCell className="text-center" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-pink-500 hover:text-pink-700 hover:bg-pink-50" onClick={() => openEditModal(p)} title="수정하기">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-500 hover:text-blue-700 hover:bg-blue-50" onClick={() => setLocation(`/products/${p.id}`)}>
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => {
                              if (confirm(`"${p.productName}" 상품을 삭제하시겠습니까?`)) deleteMut.mutate({ id: p.id });
                            }}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-16 text-muted-foreground">
                <Package className="h-12 w-12 mx-auto mb-3 text-pink-200" />
                <p className="font-medium">등록된 상품이 없습니다</p>
                <p className="text-sm mt-1 text-pink-400">첫 상품을 등록해보세요!</p>
                <Button variant="outline" className="mt-4 border-pink-200 text-pink-600 hover:bg-pink-50 rounded-xl" onClick={() => setLocation("/daily")}>
                  <Sparkles className="h-4 w-4 mr-1.5" /> 첫 상품 등록하기
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Edit Modal */}
      <ProductEditModal
        open={editModalOpen}
        onClose={() => { setEditModalOpen(false); setEditingProduct(null); }}
        product={editingProduct}
        onSuccess={() => utils.sourcing.list.invalidate()}
      />
    </DashboardLayout>
  );
}

// ==================== Product Edit Modal ====================

interface ProductEditModalProps {
  open: boolean;
  onClose: () => void;
  product: any;
  onSuccess?: () => void;
}

function ProductEditModal({ open, onClose, product, onSuccess }: ProductEditModalProps) {
  const TODAY = new Date().toISOString().split("T")[0];
  const defaultForm: EditFormData = {
    recordDate: TODAY, category: "", productName: "", priority: "medium",
    keyword1: "", keyword2: "", keyword3: "", targetCustomer: "", seasonality: "",
    competitionLevel: "medium", differentiationLevel: "medium",
    thumbnailMemo: "", detailPoint: "", giftIdea: "",
    improvementNote: "", developmentNote: "", finalOpinion: "",
    coupangUrl: "", referenceUrl: "",
  };

  const [form, setForm] = useState<EditFormData>(defaultForm);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const utils = trpc.useUtils();

  const updateMut = trpc.sourcing.update.useMutation({
    onSuccess: () => {
      toast.success("상품이 수정되었습니다!");
      utils.sourcing.list.invalidate();
      utils.sourcing.stats.invalidate();
      onSuccess?.();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const changeStatusMut = trpc.sourcing.changeStatus.useMutation({
    onSuccess: () => {
      toast.success("상태가 변경되었습니다!");
      utils.sourcing.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const aiAutoFillMut = trpc.sourcing.aiAutoFill.useMutation({
    onSuccess: (data) => {
      setForm(prev => ({
        ...prev,
        ...Object.fromEntries(
          Object.entries(data).filter(([_, v]) => v !== undefined && v !== null && v !== "")
        ),
      } as EditFormData));
      setIsAiLoading(false);
      toast.success("AI 자동 채우기 완료! 수정된 내용을 확인하세요.");
    },
    onError: (e) => {
      setIsAiLoading(false);
      toast.error(e.message);
    },
  });

  // Load product data when modal opens
  useEffect(() => {
    if (open && product) {
      setForm({
        recordDate: product.recordDate || TODAY,
        category: product.category || "",
        productName: product.productName || "",
        priority: product.priority || "medium",
        keyword1: product.keyword1 || "",
        keyword2: product.keyword2 || "",
        keyword3: product.keyword3 || "",
        targetCustomer: product.targetCustomer || "",
        seasonality: product.seasonality || "",
        competitionLevel: product.competitionLevel || "medium",
        differentiationLevel: product.differentiationLevel || "medium",
        thumbnailMemo: product.thumbnailMemo || "",
        detailPoint: product.detailPoint || "",
        giftIdea: product.giftIdea || "",
        improvementNote: product.improvementNote || "",
        developmentNote: product.developmentNote || "",
        finalOpinion: product.finalOpinion || "",
        coupangUrl: product.coupangUrl || "",
        referenceUrl: product.referenceUrl || "",
      });
    }
  }, [open, product]);

  const score = calcPreviewScore(form);
  const grade = gradeOf(score);
  const set = (k: keyof EditFormData, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSave = () => {
    if (!form.productName) {
      toast.error("상품명을 입력하세요");
      return;
    }
    updateMut.mutate({ id: product.id, ...form });
  };

  const handleAiAutoFill = () => {
    setIsAiLoading(true);
    aiAutoFillMut.mutate({
      productName: form.productName,
      keyword1: form.keyword1,
      keyword2: form.keyword2,
      keyword3: form.keyword3,
      category: form.category,
      existingData: {
        thumbnailMemo: form.thumbnailMemo,
        detailPoint: form.detailPoint,
        improvementNote: form.improvementNote,
        developmentNote: form.developmentNote,
        finalOpinion: form.finalOpinion,
        competitionLevel: form.competitionLevel,
        differentiationLevel: form.differentiationLevel,
      },
    });
  };

  if (!product) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Pencil className="h-5 w-5 text-pink-500" />
            상품 수정하기
            <Badge className="ml-2 bg-pink-50 text-pink-600 border-pink-200">ID: {product.id}</Badge>
            {isAiLoading && (
              <Badge className="bg-pink-100 text-pink-700 gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> AI 분석중...
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-3">
          {/* Left: Form fields */}
          <div className="lg:col-span-2 space-y-4">
            {/* AI Auto-fill Button */}
            <div className="flex items-center gap-2 bg-gradient-to-r from-pink-50 to-purple-50 rounded-xl p-3 border border-pink-100/50">
              <Wand2 className="h-4 w-4 text-pink-500" />
              <span className="text-sm text-pink-700 flex-1">수집된 데이터를 기반으로 AI가 폼을 자동으로 채워줍니다</span>
              <Button size="sm" onClick={handleAiAutoFill} disabled={isAiLoading || (!form.productName && !form.keyword1)}
                className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white rounded-lg text-xs px-4">
                {isAiLoading ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> 분석중...</> : <><Sparkles className="h-3 w-3 mr-1" /> AI 자동채우기</>}
              </Button>
            </div>

            {/* Basic Info */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5"><span>📋</span> 기본 정보</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">날짜</Label>
                    <Input type="date" value={form.recordDate} onChange={e => set("recordDate", e.target.value)} className="h-8 text-xs mt-1" />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">카테고리</Label>
                    <Select value={form.category} onValueChange={v => set("category", v)}>
                      <SelectTrigger className="h-8 text-xs mt-1"><SelectValue placeholder="선택" /></SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">상태 변경</Label>
                    <Select value={product.status} onValueChange={v => changeStatusMut.mutate({ id: product.id, status: v as any })}>
                      <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(STATUS_MAP).map(([k, { label }]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">상품명 *</Label>
                  <Input value={form.productName} onChange={e => set("productName", e.target.value)} placeholder="상품명을 입력하세요" className="h-8 text-xs mt-1" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">키워드 1 *</Label>
                    <Input value={form.keyword1} onChange={e => set("keyword1", e.target.value)} placeholder="핵심" className="h-8 text-xs mt-1" />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">키워드 2</Label>
                    <Input value={form.keyword2} onChange={e => set("keyword2", e.target.value)} placeholder="보조" className="h-8 text-xs mt-1" />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">키워드 3</Label>
                    <Input value={form.keyword3} onChange={e => set("keyword3", e.target.value)} placeholder="롱테일" className="h-8 text-xs mt-1" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">타겟 고객</Label>
                    <Input value={form.targetCustomer} onChange={e => set("targetCustomer", e.target.value)} placeholder="30대 여성 등" className="h-8 text-xs mt-1" />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">시즌성</Label>
                    <Input value={form.seasonality} onChange={e => set("seasonality", e.target.value)} placeholder="연중/여름/겨울" className="h-8 text-xs mt-1" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Competition & Differentiation */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5"><span>⚔️</span> 경쟁 & 차별화</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-[10px] text-muted-foreground">경쟁도</Label>
                  <Select value={form.competitionLevel} onValueChange={v => set("competitionLevel", v)}>
                    <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">낮음 (20점)</SelectItem>
                      <SelectItem value="medium">보통 (12점)</SelectItem>
                      <SelectItem value="high">높음 (6점)</SelectItem>
                      <SelectItem value="very_high">매우높음 (2점)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">차별화</Label>
                  <Select value={form.differentiationLevel} onValueChange={v => set("differentiationLevel", v)}>
                    <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="high">높음 (20점)</SelectItem>
                      <SelectItem value="medium">보통 (12점)</SelectItem>
                      <SelectItem value="low">낮음 (4점)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">우선순위</Label>
                  <Select value={form.priority} onValueChange={v => set("priority", v)}>
                    <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="high">높음</SelectItem>
                      <SelectItem value="medium">보통</SelectItem>
                      <SelectItem value="low">낮음</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Analysis & Notes */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5"><span>🔍</span> 분석 & 메모</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-[10px] text-muted-foreground">썸네일/시장 분석</Label>
                  <Textarea value={form.thumbnailMemo} onChange={e => set("thumbnailMemo", e.target.value)} placeholder="경쟁사 썸네일 특징, 시장 분석" rows={3} className="text-xs mt-1" />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">상세페이지 포인트 / 기회 분석</Label>
                  <Textarea value={form.detailPoint} onChange={e => set("detailPoint", e.target.value)} placeholder="상세페이지 구성, 소싱 기회" rows={3} className="text-xs mt-1" />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">단점 보완 방안 *</Label>
                  <Textarea value={form.improvementNote} onChange={e => set("improvementNote", e.target.value)} placeholder="경쟁사 단점 분석 및 보완 전략" rows={3} className="text-xs mt-1" />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">개발 노트 *</Label>
                  <Textarea value={form.developmentNote} onChange={e => set("developmentNote", e.target.value)} placeholder="상품 개발 방향, OEM/ODM 포인트" rows={3} className="text-xs mt-1" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">증정품 아이디어</Label>
                    <Textarea value={form.giftIdea} onChange={e => set("giftIdea", e.target.value)} placeholder="사은품, 증정품" rows={2} className="text-xs mt-1" />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">최종 의견</Label>
                    <Textarea value={form.finalOpinion} onChange={e => set("finalOpinion", e.target.value)} placeholder="종합 판단" rows={2} className="text-xs mt-1" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Links */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5"><span>🔗</span> 참고 링크</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[10px] text-muted-foreground">쿠팡 링크</Label>
                  <Input value={form.coupangUrl} onChange={e => set("coupangUrl", e.target.value)} placeholder="https://www.coupang.com/..." className="h-8 text-xs mt-1" />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">참고 링크</Label>
                  <Input value={form.referenceUrl} onChange={e => set("referenceUrl", e.target.value)} placeholder="https://..." className="h-8 text-xs mt-1" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: Score panel */}
          <div className="space-y-3">
            <Card className="sticky top-0">
              <div className={`h-1.5 bg-gradient-to-r ${getScoreColor(score)}`} />
              <CardContent className="pt-4 space-y-4">
                <div className="text-center">
                  <div className={`text-5xl font-bold bg-gradient-to-r ${getScoreColor(score)} bg-clip-text text-transparent`}>
                    {score}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">/ 100점</div>
                  {product.score !== score && (
                    <div className="text-xs mt-1">
                      <span className="text-muted-foreground">기존: {product.score}점 → </span>
                      <span className={score > product.score ? "text-green-600 font-medium" : score < product.score ? "text-red-500 font-medium" : ""}>
                        {score > product.score ? `+${score - product.score}` : score < product.score ? `${score - product.score}` : "변동없음"}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex justify-center gap-2">
                  <Badge className={`text-sm px-3 py-1 bg-gradient-to-r ${getScoreColor(score)} text-white border-0`}>
                    {grade === "S" ? <Trophy className="h-3.5 w-3.5 mr-1" /> : grade === "A" ? <Star className="h-3.5 w-3.5 mr-1" /> : <Target className="h-3.5 w-3.5 mr-1" />}
                    {grade} 등급
                  </Badge>
                </div>

                {/* Score breakdown */}
                <div className="text-[10px] space-y-1.5 text-muted-foreground">
                  {[
                    { label: "키워드", value: [form.keyword1, form.keyword2, form.keyword3].filter(Boolean).length * 5, max: 15 },
                    { label: "경쟁도", value: { low: 20, medium: 12, high: 6, very_high: 2 }[form.competitionLevel] || 0, max: 20 },
                    { label: "차별화", value: { high: 20, medium: 12, low: 4 }[form.differentiationLevel] || 0, max: 20 },
                    { label: "메모", value: [form.thumbnailMemo, form.detailPoint, form.finalOpinion].filter(v => v.length > 5).length * 5, max: 15 },
                    { label: "개발노트", value: (form.improvementNote.length > 5 ? 8 : 0) + (form.developmentNote.length > 5 ? 7 : 0), max: 15 },
                  ].map(item => (
                    <div key={item.label}>
                      <div className="flex justify-between mb-0.5">
                        <span>{item.label}</span>
                        <span className="font-medium">{item.value}/{item.max}</span>
                      </div>
                      <div className="h-1 bg-pink-100 rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full bg-gradient-to-r ${item.value >= item.max * 0.8 ? "from-pink-400 to-rose-400" : item.value >= item.max * 0.5 ? "from-purple-400 to-fuchsia-400" : "from-gray-300 to-gray-400"} transition-all duration-500`}
                          style={{ width: `${(item.value / item.max) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Warnings */}
                {(!form.keyword1 || !form.keyword2 || !form.keyword3) && (
                  <div className="flex items-center gap-1.5 text-[10px] text-amber-600 bg-amber-50 rounded-lg px-2 py-1.5">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    키워드 3개 입력 시 보너스 3점
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <DialogFooter className="flex gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => {
            if (product) {
              setForm({
                recordDate: product.recordDate || TODAY,
                category: product.category || "",
                productName: product.productName || "",
                priority: product.priority || "medium",
                keyword1: product.keyword1 || "",
                keyword2: product.keyword2 || "",
                keyword3: product.keyword3 || "",
                targetCustomer: product.targetCustomer || "",
                seasonality: product.seasonality || "",
                competitionLevel: product.competitionLevel || "medium",
                differentiationLevel: product.differentiationLevel || "medium",
                thumbnailMemo: product.thumbnailMemo || "",
                detailPoint: product.detailPoint || "",
                giftIdea: product.giftIdea || "",
                improvementNote: product.improvementNote || "",
                developmentNote: product.developmentNote || "",
                finalOpinion: product.finalOpinion || "",
                coupangUrl: product.coupangUrl || "",
                referenceUrl: product.referenceUrl || "",
              });
            }
          }}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" /> 원래대로
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>취소</Button>
          <Button size="sm" onClick={handleSave} disabled={!form.productName || updateMut.isPending}
            className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white">
            <Save className="h-3.5 w-3.5 mr-1" />
            {updateMut.isPending ? "저장중..." : "수정 저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
