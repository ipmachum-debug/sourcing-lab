import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Edit2, Building2, Package, Link2 } from "lucide-react";

const PLATFORM_OPTIONS = [
  { value: "instagram", label: "인스타그램", emoji: "📸" },
  { value: "youtube", label: "유튜브", emoji: "🎬" },
  { value: "tiktok", label: "틱톡", emoji: "🎵" },
  { value: "naver_blog", label: "네이버 블로그", emoji: "📝" },
  { value: "naver_cafe", label: "네이버 카페", emoji: "☕" },
  { value: "kakao", label: "카카오채널", emoji: "💬" },
] as const;

function BrandsTab() {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [tone, setTone] = useState("friendly");
  const [keywords, setKeywords] = useState("");

  const utils = trpc.useUtils();
  const brands = trpc.marketing.brands.list.useQuery();
  const createBrand = trpc.marketing.brands.create.useMutation({
    onSuccess: () => {
      toast.success("브랜드가 등록되었습니다.");
      setShowAdd(false);
      setName(""); setDesc(""); setKeywords("");
      utils.marketing.brands.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteBrand = trpc.marketing.brands.delete.useMutation({
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      utils.marketing.brands.list.invalidate();
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">등록된 브랜드</h3>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" />브랜드 추가</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>브랜드 등록</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder="브랜드명" value={name} onChange={e => setName(e.target.value)} />
              <Textarea placeholder="브랜드 설명" value={desc} onChange={e => setDesc(e.target.value)} rows={2} />
              <Select value={tone} onValueChange={setTone}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="casual">캐주얼</SelectItem>
                  <SelectItem value="premium">프리미엄</SelectItem>
                  <SelectItem value="friendly">친근한</SelectItem>
                  <SelectItem value="professional">전문적</SelectItem>
                  <SelectItem value="b2b">B2B</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="키워드 (쉼표 구분)" value={keywords} onChange={e => setKeywords(e.target.value)} />
              <Button className="w-full" disabled={!name || createBrand.isPending}
                onClick={() => createBrand.mutate({
                  name, description: desc || undefined,
                  toneOfVoice: tone as any,
                  keywords: keywords ? keywords.split(",").map(k => k.trim()).filter(Boolean) : undefined,
                })}>
                {createBrand.isPending ? "등록 중..." : "등록"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      {brands.data?.length === 0 && (
        <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">등록된 브랜드가 없습니다.</CardContent></Card>
      )}
      {brands.data?.map(brand => (
        <Card key={brand.id}>
          <CardContent className="p-3 flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="font-medium">{brand.name}</span>
                <Badge variant="outline" className="text-xs">{brand.toneOfVoice}</Badge>
              </div>
              {brand.description && <p className="text-xs text-muted-foreground mt-1">{brand.description}</p>}
              {(brand.keywords as string[])?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {[...new Set(brand.keywords as string[])].map((k, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">{k}</Badge>
                  ))}
                </div>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => deleteBrand.mutate({ id: brand.id })}>
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ProductsTab() {
  const [showAdd, setShowAdd] = useState(false);
  const [brandId, setBrandId] = useState("");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [features, setFeatures] = useState("");
  const [target, setTarget] = useState("");
  const [price, setPrice] = useState("");
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const utils = trpc.useUtils();
  const brands = trpc.marketing.brands.list.useQuery();
  const products = trpc.marketing.products.list.useQuery();
  const createProduct = trpc.marketing.products.create.useMutation({
    onSuccess: () => {
      toast.success("상품이 등록되었습니다.");
      setShowAdd(false);
      setName(""); setDesc(""); setFeatures(""); setTarget(""); setPrice("");
      setUploadedImages([]);
      utils.marketing.products.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteProduct = trpc.marketing.products.delete.useMutation({
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      utils.marketing.products.list.invalidate();
    },
  });

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (uploadedImages.length + files.length > 10) {
      toast.error("최대 10장까지 업로드 가능합니다.");
      return;
    }
    setUploading(true);
    try {
      const base64Images: string[] = [];
      for (const file of Array.from(files)) {
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        base64Images.push(base64);
      }
      const res = await fetch("/api/marketing/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: base64Images, brandId: brandId ? Number(brandId) : undefined }),
      });
      const data = await res.json();
      if (data.success) {
        setUploadedImages(prev => [...prev, ...data.urls]);
        toast.success(`${data.count}장 업로드 완료`);
      } else {
        toast.error(data.error || "업로드 실패");
      }
    } catch (err: any) {
      toast.error("업로드 실패: " + err.message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">등록된 상품</h3>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" />상품 추가</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>상품 등록</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Select value={brandId} onValueChange={setBrandId}>
                <SelectTrigger><SelectValue placeholder="브랜드 선택" /></SelectTrigger>
                <SelectContent>
                  {brands.data?.map(b => (
                    <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input placeholder="상품명" value={name} onChange={e => setName(e.target.value)} />
              <Textarea placeholder="상품 설명" value={desc} onChange={e => setDesc(e.target.value)} rows={2} />
              <Input placeholder="특징 (쉼표 구분: 쫀득함, 무설탕, 수제)" value={features} onChange={e => setFeatures(e.target.value)} />
              <Input placeholder="타겟 고객 (예: 30~40대 여성)" value={target} onChange={e => setTarget(e.target.value)} />
              <Input placeholder="가격" type="number" value={price} onChange={e => setPrice(e.target.value)} />

              {/* 사진 업로드 */}
              <div>
                <label className="text-sm font-medium mb-1 block">상품 사진 (최대 10장)</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {uploadedImages.map((url, i) => (
                    <div key={i} className="relative w-16 h-16 rounded-md overflow-hidden border group">
                      <img src={url} alt={`상품 사진 ${i + 1}`} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setUploadedImages(prev => prev.filter((_, idx) => idx !== i))}
                        className="absolute inset-0 bg-black/50 text-white text-xs opacity-0 group-hover:opacity-100 flex items-center justify-center transition"
                      >삭제</button>
                    </div>
                  ))}
                  {uploadedImages.length < 10 && (
                    <label className="w-16 h-16 rounded-md border-2 border-dashed flex items-center justify-center cursor-pointer hover:bg-muted/50 transition">
                      <input type="file" accept="image/*" multiple className="hidden" onChange={handleImageSelect} disabled={uploading} />
                      {uploading ? <span className="text-xs">...</span> : <Plus className="h-5 w-5 text-muted-foreground" />}
                    </label>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{uploadedImages.length}/10장 · 인스타/블로그에 직접 사용하거나 AI 영상 생성 소재로 활용됩니다</p>
              </div>

              <Button className="w-full" disabled={!brandId || !name || createProduct.isPending}
                onClick={() => createProduct.mutate({
                  brandId: Number(brandId), name,
                  description: desc || undefined,
                  features: features ? features.split(",").map(f => f.trim()).filter(Boolean) : undefined,
                  targetAudience: target || undefined,
                  price: price || undefined,
                  imageUrls: uploadedImages.length > 0 ? uploadedImages : undefined,
                })}>
                {createProduct.isPending ? "등록 중..." : "등록"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      {products.data?.length === 0 && (
        <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">등록된 상품이 없습니다. 브랜드를 먼저 등록하세요.</CardContent></Card>
      )}
      {products.data?.map(product => {
        const images = (product.imageUrls as string[]) || [];
        return (
          <Card key={product.id}>
            <CardContent className="p-3">
              <div className="flex items-start gap-3">
                {/* 사진 썸네일 */}
                {images.length > 0 ? (
                  <div className="flex gap-1 shrink-0">
                    {images.slice(0, 3).map((url, i) => (
                      <img key={i} src={url} alt="" className="w-12 h-12 rounded object-cover border" />
                    ))}
                    {images.length > 3 && (
                      <div className="w-12 h-12 rounded border bg-muted flex items-center justify-center text-xs text-muted-foreground">
                        +{images.length - 3}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="w-12 h-12 rounded border bg-muted flex items-center justify-center shrink-0">
                    <Package className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{product.name}</span>
                    {product.price && <Badge variant="outline" className="text-xs">{Number(product.price).toLocaleString()}원</Badge>}
                    <span className="text-xs text-muted-foreground">{images.length}장</span>
                  </div>
                  {product.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{product.description}</p>}
                  {(product.features as string[])?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(product.features as string[]).map((f, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">{f}</Badge>
                      ))}
                    </div>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={() => deleteProduct.mutate({ id: product.id })}>
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function AccountsTab() {
  const [showAdd, setShowAdd] = useState(false);
  const [platform, setPlatform] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accessToken, setAccessToken] = useState("");

  const utils = trpc.useUtils();
  const accounts = trpc.marketing.channels.listAccounts.useQuery();
  const addAccount = trpc.marketing.channels.addAccount.useMutation({
    onSuccess: () => {
      toast.success("계정이 연동되었습니다.");
      setShowAdd(false);
      setPlatform(""); setAccountName(""); setAccessToken("");
      utils.marketing.channels.listAccounts.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteAccount = trpc.marketing.channels.deleteAccount.useMutation({
    onSuccess: () => {
      toast.success("연동이 해제되었습니다.");
      utils.marketing.channels.listAccounts.invalidate();
    },
  });

  const statusColor = (s: string) => {
    if (s === "active") return "default";
    if (s === "expired") return "secondary";
    return "destructive";
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">연동된 계정</h3>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" />계정 연동</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>소셜미디어 계정 연동</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger><SelectValue placeholder="플랫폼 선택" /></SelectTrigger>
                <SelectContent>
                  {PLATFORM_OPTIONS.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.emoji} {p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input placeholder="계정명 / 채널명" value={accountName} onChange={e => setAccountName(e.target.value)} />
              <Input placeholder="Access Token (선택)" value={accessToken} onChange={e => setAccessToken(e.target.value)} type="password" />
              <p className="text-xs text-muted-foreground">API 토큰은 각 플랫폼의 개발자 콘솔에서 발급받을 수 있습니다.</p>
              <Button className="w-full" disabled={!platform || !accountName || addAccount.isPending}
                onClick={() => addAccount.mutate({
                  platform: platform as any,
                  accountName,
                  accessToken: accessToken || undefined,
                })}>
                {addAccount.isPending ? "연동 중..." : "연동하기"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      {accounts.data?.length === 0 && (
        <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">연동된 계정이 없습니다.</CardContent></Card>
      )}
      {accounts.data?.map(acc => {
        const pl = PLATFORM_OPTIONS.find(p => p.value === acc.platform);
        return (
          <Card key={acc.id}>
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xl">{pl?.emoji || "📱"}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{acc.accountName}</span>
                    <Badge variant={statusColor(acc.status) as any} className="text-xs">{acc.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{pl?.label || acc.platform}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => deleteAccount.mutate({ id: acc.id })}>
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export default function MarketingSettings() {
  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-5xl">
        <div>
          <h1 className="text-2xl font-bold">마케팅 설정</h1>
          <p className="text-muted-foreground text-sm mt-1">브랜드, 상품, 소셜 계정을 관리합니다</p>
        </div>
        <Tabs defaultValue="brands">
          <TabsList>
            <TabsTrigger value="brands">브랜드</TabsTrigger>
            <TabsTrigger value="products">상품</TabsTrigger>
            <TabsTrigger value="accounts">계정 연동</TabsTrigger>
            <TabsTrigger value="schedule">스케줄</TabsTrigger>
          </TabsList>
          <TabsContent value="brands" className="mt-4"><BrandsTab /></TabsContent>
          <TabsContent value="products" className="mt-4"><ProductsTab /></TabsContent>
          <TabsContent value="accounts" className="mt-4"><AccountsTab /></TabsContent>
          <TabsContent value="schedule" className="mt-4">
            <div className="text-center text-muted-foreground py-8 text-sm">
              채널별 예약 발행 규칙은 <a href="/marketing/calendar" className="text-blue-600 hover:underline">콘텐츠 캘린더</a>에서 관리합니다.
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
