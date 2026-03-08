import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { useLocation } from "wouter";
import { Search, Package, Plus, Star, Sparkles, Trash2, Eye } from "lucide-react";
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

export default function Products() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

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

  return (
    <DashboardLayout>
      <div className="space-y-5">
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
                    <TableHead className="w-[100px] text-center text-pink-600/80 font-medium">관리</TableHead>
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
                          <span className={`font-bold ${p.score >= 85 ? "text-pink-500" : p.score >= 70 ? "text-purple-500" : "text-muted-foreground"}`}>{p.score}</span>
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
    </DashboardLayout>
  );
}
