import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Star, Trash2, Search, Copy, Eye, Image, FileText, Target } from "lucide-react";

// ======================== 베스트 카피 탭 ========================
function CopyLibraryTab() {
  const [showAdd, setShowAdd] = useState(false);
  const [category, setCategory] = useState("hook");
  const [text, setText] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const utils = trpc.useUtils();
  const copies = trpc.marketing.library.copy.list.useQuery({
    ...(categoryFilter !== "all" ? { category: categoryFilter as any } : {}),
    ...(searchFilter ? { search: searchFilter } : {}),
  });
  const saveCopy = trpc.marketing.library.copy.save.useMutation({
    onSuccess: () => {
      toast.success("저장되었습니다.");
      setShowAdd(false); setText("");
      utils.marketing.library.copy.list.invalidate();
    },
  });
  const toggleFav = trpc.marketing.library.copy.toggleFavorite.useMutation({
    onSuccess: () => utils.marketing.library.copy.list.invalidate(),
  });
  const deleteCopy = trpc.marketing.library.copy.delete.useMutation({
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      utils.marketing.library.copy.list.invalidate();
    },
  });

  const categoryLabels: Record<string, string> = {
    hook: "훅", caption: "캡션", cta: "CTA", hashtag_set: "해시태그",
    script: "대본", title: "제목", description: "설명",
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="카피 검색..."
            value={searchFilter} onChange={e => setSearchFilter(e.target.value)} />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체</SelectItem>
            {Object.entries(categoryLabels).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" />추가</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>베스트 카피 저장</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(categoryLabels).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Textarea placeholder="카피 내용" value={text} onChange={e => setText(e.target.value)} rows={4} />
              <Button className="w-full" disabled={!text} onClick={() => saveCopy.mutate({ category: category as any, text })}>
                저장
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {copies.data?.length === 0 && (
        <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">
          저장된 카피가 없습니다. 잘 된 카피를 저장해두면 재활용할 수 있습니다.
        </CardContent></Card>
      )}

      <div className="space-y-2">
        {copies.data?.map(copy => (
          <Card key={copy.id}>
            <CardContent className="p-3 flex items-start gap-3">
              <Button variant="ghost" size="sm" className="mt-0.5 p-1"
                onClick={() => toggleFav.mutate({ id: copy.id })}>
                <Star className={`h-4 w-4 ${copy.isFavorite ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
              </Button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-xs">{categoryLabels[copy.category] || copy.category}</Badge>
                  {copy.platform && <Badge variant="secondary" className="text-xs">{copy.platform}</Badge>}
                  {copy.performanceScore && (
                    <Badge variant="secondary" className="text-xs">점수: {copy.performanceScore}</Badge>
                  )}
                </div>
                <p className="text-sm whitespace-pre-wrap">{copy.text}</p>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm"
                  onClick={() => { navigator.clipboard.writeText(copy.text); toast.success("복사됨"); }}>
                  <Copy className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => deleteCopy.mutate({ id: copy.id })}>
                  <Trash2 className="h-3 w-3 text-red-500" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ======================== 미디어 라이브러리 탭 ========================
function MediaLibraryTab() {
  const [showUpload, setShowUpload] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [type, setType] = useState("image");
  const [folder, setFolder] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  const utils = trpc.useUtils();
  const assets = trpc.marketing.library.media.list.useQuery(
    typeFilter !== "all" ? { type: typeFilter as any } : undefined
  );
  const folders = trpc.marketing.library.media.listFolders.useQuery();
  const upload = trpc.marketing.library.media.upload.useMutation({
    onSuccess: () => {
      toast.success("등록되었습니다.");
      setShowUpload(false); setName(""); setUrl("");
      utils.marketing.library.media.list.invalidate();
    },
  });
  const deleteAsset = trpc.marketing.library.media.delete.useMutation({
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      utils.marketing.library.media.list.invalidate();
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체</SelectItem>
            <SelectItem value="image">이미지</SelectItem>
            <SelectItem value="video">영상</SelectItem>
            <SelectItem value="template">템플릿</SelectItem>
            <SelectItem value="document">문서</SelectItem>
          </SelectContent>
        </Select>
        <Dialog open={showUpload} onOpenChange={setShowUpload}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" />등록</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>미디어 등록</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder="이름" value={name} onChange={e => setName(e.target.value)} />
              <Input placeholder="URL (이미지/영상 주소)" value={url} onChange={e => setUrl(e.target.value)} />
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="image">이미지</SelectItem>
                  <SelectItem value="video">영상</SelectItem>
                  <SelectItem value="template">템플릿</SelectItem>
                  <SelectItem value="document">문서</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="폴더 (선택)" value={folder} onChange={e => setFolder(e.target.value)} />
              <Button className="w-full" disabled={!name || !url}
                onClick={() => upload.mutate({ name, url, type: type as any, folder: folder || undefined })}>
                등록
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {assets.data?.length === 0 && (
        <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">
          미디어가 없습니다. 이미지, 영상, 템플릿을 등록하세요.
        </CardContent></Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {assets.data?.map(asset => (
          <Card key={asset.id} className="group relative overflow-hidden">
            <CardContent className="p-0">
              {asset.type === "image" ? (
                <div className="aspect-square bg-muted flex items-center justify-center overflow-hidden">
                  <img src={asset.url} alt={asset.name} className="w-full h-full object-cover" loading="lazy" />
                </div>
              ) : (
                <div className="aspect-square bg-muted flex items-center justify-center">
                  {asset.type === "video" ? <span className="text-3xl">🎬</span> :
                    asset.type === "template" ? <span className="text-3xl">📐</span> :
                      <span className="text-3xl">📄</span>}
                </div>
              )}
              <div className="p-2">
                <p className="text-xs font-medium truncate">{asset.name}</p>
                <div className="flex items-center justify-between mt-1">
                  <Badge variant="outline" className="text-[10px]">{asset.type}</Badge>
                  {asset.folder && <span className="text-[10px] text-muted-foreground">{asset.folder}</span>}
                </div>
              </div>
              <Button variant="ghost" size="sm"
                className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition"
                onClick={() => deleteAsset.mutate({ id: asset.id })}>
                <Trash2 className="h-3 w-3 text-red-500" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ======================== 경쟁사 모니터링 탭 ========================
function CompetitorsTab() {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState("instagram");
  const [handle, setHandle] = useState("");
  const [url, setUrl] = useState("");

  const utils = trpc.useUtils();
  const competitors = trpc.marketing.library.competitors.list.useQuery();
  const addComp = trpc.marketing.library.competitors.add.useMutation({
    onSuccess: () => {
      toast.success("경쟁사가 추가되었습니다.");
      setShowAdd(false); setName(""); setHandle(""); setUrl("");
      utils.marketing.library.competitors.list.invalidate();
    },
  });
  const analyze = trpc.marketing.library.competitors.analyze.useMutation({
    onSuccess: (data) => {
      toast.success("AI 분석이 완료되었습니다.");
      utils.marketing.library.competitors.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteComp = trpc.marketing.library.competitors.delete.useMutation({
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      utils.marketing.library.competitors.list.invalidate();
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" />경쟁사 추가</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>경쟁사 등록</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder="경쟁사명" value={name} onChange={e => setName(e.target.value)} />
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="instagram">인스타그램</SelectItem>
                  <SelectItem value="youtube">유튜브</SelectItem>
                  <SelectItem value="tiktok">틱톡</SelectItem>
                  <SelectItem value="naver_blog">블로그</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="@핸들 (선택)" value={handle} onChange={e => setHandle(e.target.value)} />
              <Input placeholder="채널 URL (선택)" value={url} onChange={e => setUrl(e.target.value)} />
              <Button className="w-full" disabled={!name}
                onClick={() => addComp.mutate({
                  name, platform: platform as any,
                  accountHandle: handle || undefined, accountUrl: url || undefined,
                })}>
                추가
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {competitors.data?.length === 0 && (
        <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">
          등록된 경쟁사가 없습니다. 경쟁사를 추가하면 AI가 강점/약점을 분석해줍니다.
        </CardContent></Card>
      )}

      <div className="space-y-3">
        {competitors.data?.map(comp => (
          <Card key={comp.id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-muted-foreground" />
                  <h3 className="font-medium">{comp.name}</h3>
                  <Badge variant="outline" className="text-xs">{comp.platform}</Badge>
                  {comp.accountHandle && <span className="text-xs text-muted-foreground">@{comp.accountHandle}</span>}
                </div>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm"
                    disabled={analyze.isPending}
                    onClick={() => analyze.mutate({ id: comp.id })}>
                    {analyze.isPending ? "분석 중..." : "AI 분석"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => deleteComp.mutate({ id: comp.id })}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </div>
              {(comp.followers || comp.avgLikes) && (
                <div className="flex gap-4 text-sm text-muted-foreground mb-2">
                  {comp.followers && <span>팔로워: {comp.followers.toLocaleString()}</span>}
                  {comp.avgLikes && <span>평균 좋아요: {comp.avgLikes.toLocaleString()}</span>}
                  {comp.postingFrequency && <span>발행 빈도: {comp.postingFrequency}</span>}
                </div>
              )}
              {comp.strengths && (
                <div className="p-2 bg-green-50 dark:bg-green-950/20 rounded text-sm mb-1">
                  <span className="font-medium text-green-700 dark:text-green-400">강점:</span> {comp.strengths}
                </div>
              )}
              {comp.weaknesses && (
                <div className="p-2 bg-red-50 dark:bg-red-950/20 rounded text-sm">
                  <span className="font-medium text-red-700 dark:text-red-400">약점:</span> {comp.weaknesses}
                </div>
              )}
              {comp.lastCheckedAt && (
                <p className="text-xs text-muted-foreground mt-2">마지막 분석: {comp.lastCheckedAt}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ======================== 메인 페이지 ========================
export default function LibraryPage() {
  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">자료실</h1>
          <p className="text-muted-foreground text-sm mt-1">베스트 카피, 미디어, 경쟁사 분석을 한곳에서 관리</p>
        </div>
        <Tabs defaultValue="copy">
          <TabsList>
            <TabsTrigger value="copy">베스트 카피</TabsTrigger>
            <TabsTrigger value="media">미디어</TabsTrigger>
            <TabsTrigger value="competitors">경쟁사</TabsTrigger>
          </TabsList>
          <TabsContent value="copy" className="mt-4"><CopyLibraryTab /></TabsContent>
          <TabsContent value="media" className="mt-4"><MediaLibraryTab /></TabsContent>
          <TabsContent value="competitors" className="mt-4"><CompetitorsTab /></TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
