import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";
import { Save, RotateCcw, AlertTriangle, Sparkles, Star, Target, Trophy, ShoppingBag, Factory, Plus, Trash2, ExternalLink, Wand2, Loader2 } from "lucide-react";

const TODAY = new Date().toISOString().split("T")[0];

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

interface KeywordLinkDraft {
  url: string;
  memo: string;
}

interface KeywordLinksState {
  [key: string]: KeywordLinkDraft[]; // e.g. "1_coupang", "2_1688"
}

const defaultForm: FormData = {
  recordDate: TODAY,
  category: "",
  productName: "",
  priority: "medium",
  keyword1: "",
  keyword2: "",
  keyword3: "",
  targetCustomer: "",
  seasonality: "",
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

function calcPreviewScore(f: FormData) {
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

function statusOf(score: number) {
  if (score >= 85) return "테스트 후보";
  if (score >= 70) return "검토중";
  if (score >= 55) return "보류";
  return "초안";
}

function getScoreColor(score: number) {
  if (score >= 85) return "from-pink-500 to-rose-500";
  if (score >= 70) return "from-purple-500 to-fuchsia-500";
  if (score >= 55) return "from-amber-400 to-orange-400";
  return "from-gray-400 to-gray-500";
}

function getGradeIcon(grade: string) {
  if (grade === "S") return <Trophy className="h-4 w-4" />;
  if (grade === "A") return <Star className="h-4 w-4" />;
  return <Target className="h-4 w-4" />;
}

export default function DailySourcing() {
  const [form, setForm] = useState<FormData>(defaultForm);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const utils = trpc.useUtils();
  const createMut = trpc.sourcing.create.useMutation({
    onSuccess: () => {
      toast.success("상품이 등록되었습니다! ✨");
      setForm(defaultForm);
      utils.dashboard.summary.invalidate();
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
      } as FormData));
      setIsAiLoading(false);
      toast.success("AI 자동 채우기 완료! 내용을 확인하세요.");
    },
    onError: (e) => {
      setIsAiLoading(false);
      toast.error(e.message);
    },
  });

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

  const score = calcPreviewScore(form);
  const grade = gradeOf(score);
  const autoStatus = statusOf(score);

  const warnings: string[] = [];
  if (!form.keyword1 || !form.keyword2 || !form.keyword3) warnings.push("키워드 3개 필수");
  if (!form.improvementNote) warnings.push("단점보완 미입력");
  if (!form.developmentNote) warnings.push("개발노트 미입력");

  const set = (k: keyof FormData, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  return (
    <DashboardLayout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight gradient-text flex items-center gap-2">
            <span className="text-2xl">📝</span>
            데일리 소싱
          </h1>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleAiAutoFill} disabled={isAiLoading || (!form.productName && !form.keyword1)}
              className="border-pink-200 text-pink-600 hover:bg-pink-50">
              {isAiLoading ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> AI 분석중...</> : <><Wand2 className="h-4 w-4 mr-1" /> AI 자동채우기</>}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setForm(defaultForm)} className="border-pink-200 text-pink-600 hover:bg-pink-50">
              <RotateCcw className="h-4 w-4 mr-1" /> 초기화
            </Button>
            <Button size="sm" onClick={() => createMut.mutate(form)} disabled={!form.productName || createMut.isPending}
              className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white shadow-md shadow-pink-200/50">
              <Save className="h-4 w-4 mr-1" /> {createMut.isPending ? "저장중..." : "저장"}
            </Button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left: Input area */}
          <div className="lg:col-span-2 space-y-4">
            {/* Basic info */}
            <Card className="pretty-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <span>📋</span> <span className="gradient-text-soft">기본 정보</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">날짜</Label>
                    <Input type="date" value={form.recordDate} onChange={e => set("recordDate", e.target.value)} className="pretty-input mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">카테고리</Label>
                    <Select value={form.category} onValueChange={v => set("category", v)}>
                      <SelectTrigger className="pretty-input mt-1"><SelectValue placeholder="카테고리 선택" /></SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">상품명 *</Label>
                  <Input value={form.productName} onChange={e => set("productName", e.target.value)} placeholder="상품명을 입력하세요" className="pretty-input mt-1" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">키워드 1 *</Label>
                    <Input value={form.keyword1} onChange={e => set("keyword1", e.target.value)} placeholder="핵심" className="pretty-input mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">키워드 2 *</Label>
                    <Input value={form.keyword2} onChange={e => set("keyword2", e.target.value)} placeholder="보조" className="pretty-input mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">키워드 3 *</Label>
                    <Input value={form.keyword3} onChange={e => set("keyword3", e.target.value)} placeholder="롱테일" className="pretty-input mt-1" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">타겟 고객</Label>
                    <Input value={form.targetCustomer} onChange={e => set("targetCustomer", e.target.value)} placeholder="30대 여성 등" className="pretty-input mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">시즌성</Label>
                    <Input value={form.seasonality} onChange={e => set("seasonality", e.target.value)} placeholder="연중/여름/겨울 등" className="pretty-input mt-1" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Evaluation */}
            <Card className="pretty-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <span>⚔️</span> <span className="gradient-text-soft">경쟁 & 차별화 평가</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">경쟁도</Label>
                  <Select value={form.competitionLevel} onValueChange={v => set("competitionLevel", v)}>
                    <SelectTrigger className="pretty-input mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">낮음 (20점)</SelectItem>
                      <SelectItem value="medium">보통 (12점)</SelectItem>
                      <SelectItem value="high">높음 (6점)</SelectItem>
                      <SelectItem value="very_high">매우높음 (2점)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">차별화 가능성</Label>
                  <Select value={form.differentiationLevel} onValueChange={v => set("differentiationLevel", v)}>
                    <SelectTrigger className="pretty-input mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="high">높음 (20점)</SelectItem>
                      <SelectItem value="medium">보통 (12점)</SelectItem>
                      <SelectItem value="low">낮음 (4점)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Analysis */}
            <Card className="pretty-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <span>🔍</span> <span className="gradient-text-soft">분석 & 메모</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">썸네일 분석</Label>
                  <Textarea value={form.thumbnailMemo} onChange={e => set("thumbnailMemo", e.target.value)} placeholder="경쟁사 썸네일 특징, 차별화 포인트" rows={2} className="pretty-input mt-1" />
                </div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">상세페이지 포인트</Label>
                  <Textarea value={form.detailPoint} onChange={e => set("detailPoint", e.target.value)} placeholder="상세페이지 구성, 강조할 내용" rows={2} className="pretty-input mt-1" />
                </div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">증정품 아이디어</Label>
                  <Textarea value={form.giftIdea} onChange={e => set("giftIdea", e.target.value)} placeholder="사은품, 증정품 아이디어" rows={2} className="pretty-input mt-1" />
                </div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">단점 보완 방안 *</Label>
                  <Textarea value={form.improvementNote} onChange={e => set("improvementNote", e.target.value)} placeholder="경쟁사 단점 분석 및 보완 전략" rows={3} className="pretty-input mt-1" />
                </div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">개발 노트 *</Label>
                  <Textarea value={form.developmentNote} onChange={e => set("developmentNote", e.target.value)} placeholder="상품 개발 방향, OEM/ODM 포인트" rows={3} className="pretty-input mt-1" />
                </div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">최종 의견</Label>
                  <Textarea value={form.finalOpinion} onChange={e => set("finalOpinion", e.target.value)} placeholder="종합 판단, 진행 여부" rows={2} className="pretty-input mt-1" />
                </div>
              </CardContent>
            </Card>

            {/* Reference links — keyword-based */}
            <Card className="pretty-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <span>🔗</span> <span className="gradient-text-soft">참고 링크</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">쿠팡 링크</Label>
                  <Input value={form.coupangUrl} onChange={e => set("coupangUrl", e.target.value)} placeholder="https://www.coupang.com/..." className="pretty-input mt-1" />
                </div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">참고 링크 (1688 등)</Label>
                  <Input value={form.referenceUrl} onChange={e => set("referenceUrl", e.target.value)} placeholder="https://..." className="pretty-input mt-1" />
                </div>
                <div className="bg-gradient-to-r from-pink-50 to-purple-50 rounded-xl p-3 border border-pink-100/50">
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <ShoppingBag className="h-3.5 w-3.5 text-pink-400" />
                    <span>키워드별 상세 링크 (쿠팡 10개 + 1688 10개)는 저장 후 <strong className="text-pink-600">상품 상세</strong> 페이지의 "키워드링크" 탭에서 관리할 수 있습니다.</span>
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: Score panel */}
          <div className="space-y-4">
            <Card className="sticky top-20 pretty-card overflow-hidden">
              <div className={`h-1.5 bg-gradient-to-r ${getScoreColor(score)}`} />
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-pink-400" />
                  <span className="gradient-text-soft">실시간 점수</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Score display */}
                <div className="text-center py-3">
                  <div className={`text-6xl font-bold bg-gradient-to-r ${getScoreColor(score)} bg-clip-text text-transparent`}>
                    {score}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">/ 100점</div>
                </div>

                {/* Grade & Status */}
                <div className="flex justify-center gap-3">
                  <Badge className={`text-base px-4 py-1.5 bg-gradient-to-r ${getScoreColor(score)} text-white border-0 shadow-md`}>
                    {getGradeIcon(grade)}
                    <span className="ml-1">{grade} 등급</span>
                  </Badge>
                </div>

                <div className="rounded-xl bg-gradient-to-r from-pink-50 to-purple-50 p-3.5 text-center border border-pink-100/50">
                  <p className="text-xs text-muted-foreground">추천 상태</p>
                  <p className="font-semibold mt-0.5 gradient-text">{autoStatus}</p>
                </div>

                {/* Warnings */}
                {warnings.length > 0 && (
                  <div className="space-y-2">
                    {warnings.map((w, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        <span className="text-xs">{w}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Score breakdown */}
                <div className="text-xs space-y-2 text-muted-foreground">
                  {[
                    { label: "키워드", value: [form.keyword1, form.keyword2, form.keyword3].filter(Boolean).length * 5, max: 15 },
                    { label: "경쟁도", value: { low: 20, medium: 12, high: 6, very_high: 2 }[form.competitionLevel] || 0, max: 20 },
                    { label: "차별화", value: { high: 20, medium: 12, low: 4 }[form.differentiationLevel] || 0, max: 20 },
                    { label: "메모 완성도", value: [form.thumbnailMemo, form.detailPoint, form.finalOpinion].filter(v => v.length > 5).length * 5, max: 15 },
                    { label: "개발노트", value: (form.improvementNote.length > 5 ? 8 : 0) + (form.developmentNote.length > 5 ? 7 : 0), max: 15 },
                  ].map(item => (
                    <div key={item.label}>
                      <div className="flex justify-between mb-1">
                        <span>{item.label}</span>
                        <span className="font-medium">{item.value}/{item.max}</span>
                      </div>
                      <div className="h-1.5 bg-pink-100 rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full bg-gradient-to-r ${item.value >= item.max * 0.8 ? "from-pink-400 to-rose-400" : item.value >= item.max * 0.5 ? "from-purple-400 to-fuchsia-400" : "from-gray-300 to-gray-400"} transition-all duration-500`}
                          style={{ width: `${(item.value / item.max) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <Button className="w-full bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white shadow-lg shadow-pink-200/40 rounded-xl py-6" 
                  size="lg" onClick={() => createMut.mutate(form)} disabled={!form.productName || createMut.isPending}>
                  <Sparkles className="h-4 w-4 mr-2" />
                  {createMut.isPending ? "저장중..." : "상품 저장"}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
