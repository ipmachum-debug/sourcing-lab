/**
 * SourcingFormModal - 소싱 등록 모달
 * 대시보드의 검색수요/AI추천/리뷰분석/후보 데이터를 기반으로 소싱 폼을 자동 완성
 */
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Save, RotateCcw, Sparkles, Star, Target, Trophy, AlertTriangle, Loader2, Wand2 } from "lucide-react";

const CATEGORIES = [
  "생활용품", "주방용품", "욕실용품", "수납/정리", "인테리어", "조명",
  "전자기기", "스마트홈", "반려동물", "유아/아동", "건강/뷰티", "스포츠/아웃도어",
  "캠핑", "자동차", "사무용품", "패션소품", "가방/파우치", "시즌상품", "기타",
];

interface FormData {
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

const TODAY = new Date().toISOString().split("T")[0];

const defaultForm: FormData = {
  recordDate: TODAY,
  category: "",
  productName: "",
  priority: "medium",
  keyword1: "",
  keyword2: "",
  keyword3: "",
  targetCustomer: "",
  seasonality: "연중",
  competitionLevel: "medium",
  differentiationLevel: "medium",
  thumbnailMemo: "",
  detailPoint: "",
  giftIdea: "",
  improvementNote: "",
  developmentNote: "",
  finalOpinion: "",
  coupangUrl: "",
  referenceUrl: "",
};

interface MarketDataState {
  keywordScore?: number;
  competitionScore?: number;
  demandScore?: number;
  salesEstimate?: number;
  reviewGrowth?: number;
}

function calcPreviewScore(f: FormData, market?: MarketDataState) {
  let s = 0;

  // A. 시장 기회 (45점)
  if (market) {
    const ks = Math.max(0, Math.min(100, market.keywordScore ?? 0));
    s += Math.round((ks / 100) * 20);
    const cs = Math.max(0, Math.min(100, market.competitionScore ?? 50));
    s += Math.round(((100 - cs) / 100) * 15);
    const se = Math.max(0, market.salesEstimate ?? 0);
    if (se > 0) s += Math.min(10, Math.round(Math.log10(se + 1) * 2.7));
  }

  // B. 분석 완성도 (35점)
  if (f.keyword1) s += 3; if (f.keyword2) s += 3; if (f.keyword3) s += 3;
  if (f.thumbnailMemo.length > 5) s += 4;
  if (f.detailPoint.length > 5) s += 4;
  if (f.finalOpinion.length > 5) s += 4;
  if (f.developmentNote.length > 5) s += 4;
  if (f.targetCustomer) s += 2;
  if (f.giftIdea) s += 2;
  if (f.category) s += 2;
  if (f.coupangUrl || f.referenceUrl) s += 2;
  if (f.keyword1 && f.keyword2 && f.keyword3) s += 2;

  // C. 차별화 전략 (20점)
  const diff: Record<string, number> = { high: 12, medium: 7, low: 3 };
  s += diff[f.differentiationLevel] || 7;
  if (f.improvementNote.length > 5) s += 8;

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
  if (score >= 80) return "from-pink-500 to-rose-500";
  if (score >= 65) return "from-purple-500 to-fuchsia-500";
  if (score >= 45) return "from-amber-400 to-orange-400";
  return "from-gray-400 to-gray-500";
}

export interface SourcingFormModalProps {
  open: boolean;
  onClose: () => void;
  /** Pre-fill data passed from dashboard context */
  prefillData?: Record<string, any>;
  /** Edit mode: existing product to update */
  editProduct?: any;
  onSuccess?: () => void;
}

export default function SourcingFormModal({ open, onClose, prefillData, editProduct, onSuccess }: SourcingFormModalProps) {
  const [form, setForm] = useState<FormData>(defaultForm);
  const [marketData, setMarketData] = useState<MarketDataState | undefined>(undefined);
  const [isGenerating, setIsGenerating] = useState(false);
  const utils = trpc.useUtils();

  const createMut = trpc.sourcing.create.useMutation({
    onSuccess: () => {
      toast.success("소싱 상품 등록 완료!");
      utils.sourcing.list.invalidate();
      utils.sourcing.stats.invalidate();
      utils.dashboard.summary.invalidate();
      onSuccess?.();
      onClose();
      setForm(defaultForm);
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMut = trpc.sourcing.update.useMutation({
    onSuccess: () => {
      toast.success("소싱 상품 수정 완료!");
      utils.sourcing.list.invalidate();
      utils.sourcing.stats.invalidate();
      onSuccess?.();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const generateMut = trpc.sourcing.generateFromDashboard.useMutation({
    onSuccess: (data) => {
      setForm(prev => ({
        ...prev,
        ...Object.fromEntries(
          Object.entries(data).filter(([_, v]) => v !== undefined && v !== null && v !== "")
        ),
      } as FormData));
      setIsGenerating(false);
      toast.success("AI 자동 분석 완료! 내용을 검토하고 수정하세요.");
    },
    onError: (e) => {
      setIsGenerating(false);
      toast.error(e.message);
    },
  });

  const aiAutoFillMut = trpc.sourcing.aiAutoFill.useMutation({
    onSuccess: (data) => {
      setForm(prev => ({
        ...prev,
        ...Object.fromEntries(
          Object.entries(data).filter(([_, v]) => v !== undefined && v !== null && v !== "")
        ),
      } as FormData));
      setIsGenerating(false);
      toast.success("AI 자동 채우기 완료! 내용을 확인하세요.");
    },
    onError: (e) => {
      setIsGenerating(false);
      toast.error(e.message);
    },
  });

  const handleAiAutoFill = () => {
    setIsGenerating(true);
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

  // When modal opens with prefill data, auto-generate
  useEffect(() => {
    if (open && prefillData && !editProduct) {
      setForm(defaultForm);
      // 시장 데이터 캡처 (키워드 소스에서 전달된 경우)
      if (prefillData.keywordScore != null || prefillData.demandScore != null) {
        setMarketData({
          keywordScore: prefillData.keywordScore,
          competitionScore: prefillData.competitionScore,
          demandScore: prefillData.demandScore,
          salesEstimate: prefillData.salesEstimate,
          reviewGrowth: prefillData.reviewGrowth,
        });
      } else {
        setMarketData(undefined);
      }
      setIsGenerating(true);
      generateMut.mutate(prefillData as any);
    } else if (open && editProduct) {
      // Edit mode: populate form from existing product
      setForm({
        recordDate: editProduct.recordDate || TODAY,
        category: editProduct.category || "",
        productName: editProduct.productName || "",
        priority: editProduct.priority || "medium",
        keyword1: editProduct.keyword1 || "",
        keyword2: editProduct.keyword2 || "",
        keyword3: editProduct.keyword3 || "",
        targetCustomer: editProduct.targetCustomer || "",
        seasonality: editProduct.seasonality || "연중",
        competitionLevel: editProduct.competitionLevel || "medium",
        differentiationLevel: editProduct.differentiationLevel || "medium",
        thumbnailMemo: editProduct.thumbnailMemo || "",
        detailPoint: editProduct.detailPoint || "",
        giftIdea: editProduct.giftIdea || "",
        improvementNote: editProduct.improvementNote || "",
        developmentNote: editProduct.developmentNote || "",
        finalOpinion: editProduct.finalOpinion || "",
        coupangUrl: editProduct.coupangUrl || "",
        referenceUrl: editProduct.referenceUrl || "",
      });
    } else if (!open) {
      // Reset when closing
    }
  }, [open, prefillData, editProduct]);

  const score = calcPreviewScore(form, marketData);
  const grade = gradeOf(score);
  const set = (k: keyof FormData, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSave = () => {
    if (!form.productName) {
      toast.error("상품명을 입력하세요");
      return;
    }
    if (editProduct) {
      updateMut.mutate({ id: editProduct.id, ...form });
    } else {
      createMut.mutate({
        ...form,
        ...(marketData ? {
          marketKeywordScore: marketData.keywordScore,
          marketCompetitionScore: marketData.competitionScore,
          marketDemandScore: marketData.demandScore,
          marketSalesEstimate: marketData.salesEstimate,
          marketReviewGrowth: marketData.reviewGrowth,
        } : {}),
      });
    }
  };

  const isSaving = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-5 w-5 text-pink-500" />
            {editProduct ? "소싱 상품 수정" : "소싱 상품 등록"}
            {isGenerating && (
              <Badge className="bg-pink-100 text-pink-700 gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> AI 분석중...
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-3">
          {/* Left: Form fields */}
          <div className="lg:col-span-2 space-y-4">
            {/* AI Auto-fill Button */}
            <div className="flex items-center gap-2 bg-gradient-to-r from-pink-50 to-purple-50 rounded-xl p-3 border border-pink-100/50">
              <Wand2 className="h-4 w-4 text-pink-500" />
              <span className="text-xs text-pink-700 flex-1">수집된 데이터를 기반으로 AI가 폼을 자동으로 채워줍니다</span>
              <Button size="sm" onClick={handleAiAutoFill} disabled={isGenerating || (!form.productName && !form.keyword1)}
                className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white rounded-lg text-xs px-4">
                {isGenerating ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> 분석중...</> : <><Sparkles className="h-3 w-3 mr-1" /> AI 자동채우기</>}
              </Button>
            </div>

            {/* Basic Info */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <span>📋</span> 기본 정보
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">상품명 *</Label>
                  <Input value={form.productName} onChange={e => set("productName", e.target.value)} placeholder="상품명을 입력하세요" className="h-8 text-xs mt-1" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">타겟 고객</Label>
                    <Input value={form.targetCustomer} onChange={e => set("targetCustomer", e.target.value)} placeholder="30대 여성 등" className="h-8 text-xs mt-1" />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">시즌성</Label>
                    <Input value={form.seasonality} onChange={e => set("seasonality", e.target.value)} placeholder="연중/여름" className="h-8 text-xs mt-1" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Competition & Differentiation */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5"><span>⚔️</span> 경쟁 & 차별화</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
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
                </div>
                <div className="w-1/2 pr-1.5">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          <Button variant="outline" size="sm" onClick={() => setForm(defaultForm)}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" /> 초기화
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>취소</Button>
          <Button size="sm" onClick={handleSave} disabled={!form.productName || isSaving}
            className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white">
            <Save className="h-3.5 w-3.5 mr-1" />
            {isSaving ? "저장중..." : editProduct ? "수정 저장" : "소싱 등록"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
