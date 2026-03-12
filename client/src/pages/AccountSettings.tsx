import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Key, CheckCircle, XCircle, Clock, AlertCircle, Sparkles, Shield, Trash2, TestTube, Plus, Pencil, Star, Eye, EyeOff, Copy, ShoppingBag, ExternalLink, Zap } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useLocation } from "wouter";

function formatDate(d: Date | string | null): string {
  if (!d) return "-";
  const s = String(d);
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (m) {
    const [, y, mo, day, hh, mm, ss] = m;
    const h = Number(hh);
    const ampm = h < 12 ? "오전" : "오후";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${Number(y)}. ${Number(mo)}. ${Number(day)}. ${ampm} ${h12}:${mm}:${ss}`;
  }
  return new Date(d).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}
function maskKey(key: string | null): string { if (!key) return "-"; if (key.length <= 12) return key.slice(0, 4) + "****" + key.slice(-4); return key.slice(0, 8) + "..." + key.slice(-4); }

export default function AccountSettings() {
  const [, setLocation] = useLocation();
  const [alibaba1688, setAlibaba1688] = useState({ accountName: "", username: "", password: "", captchaApiKey: "" });
  const [aliexpress, setAliexpress] = useState({ accountName: "", username: "", password: "", captchaApiKey: "" });

  const utils = trpc.useUtils();

  // ── Platform accounts (1688 / AliExpress) ──
  const { data: alibaba1688Account } = trpc.accounts.get.useQuery({ platform: "1688" });
  const { data: aliexpressAccount } = trpc.accounts.get.useQuery({ platform: "aliexpress" });

  const saveAccountMutation = trpc.accounts.save.useMutation({
    onSuccess: (_, variables) => {
      utils.accounts.get.invalidate({ platform: variables.platform });
      toast.success(`${variables.platform === "1688" ? "1688" : "AliExpress"} 계정이 저장되었습니다!`);
      if (variables.platform === "1688") setAlibaba1688({ accountName: "", username: "", password: "", captchaApiKey: "" });
      else setAliexpress({ accountName: "", username: "", password: "", captchaApiKey: "" });
    },
    onError: (error) => toast.error(`계정 저장 실패: ${error.message}`),
  });
  const deleteAccountMutation = trpc.accounts.delete.useMutation({
    onSuccess: (_, variables) => { utils.accounts.get.invalidate({ platform: variables.platform }); toast.success(`${variables.platform === "1688" ? "1688" : "AliExpress"} 계정이 삭제되었습니다`); },
    onError: (error) => toast.error(`계정 삭제 실패: ${error.message}`),
  });
  const testLoginMutation = trpc.accounts.testLogin.useMutation({
    onSuccess: (_, variables) => toast.success(`${variables.platform === "1688" ? "1688" : "AliExpress"} 로그인 테스트 성공!`),
    onError: (error) => toast.error(`로그인 테스트 실패: ${error.message}`),
  });

  // ── Coupang Open API accounts ──
  const { data: coupangAccounts } = trpc.coupang.listAccounts.useQuery(undefined, { retry: false });
  const [showCoupangForm, setShowCoupangForm] = useState(false);
  const [editingCoupangId, setEditingCoupangId] = useState<number | null>(null);
  const [showSecret, setShowSecret] = useState<Record<number, boolean>>({});
  const [coupangForm, setCoupangForm] = useState({
    accountName: "", vendorId: "", accessKey: "", secretKey: "",
    wingLoginId: "", companyName: "", apiUrl: "", ipAddress: "", memo: "", isDefault: false,
  });

  const createCoupangMut = trpc.coupang.createAccount.useMutation({
    onSuccess: () => { toast.success("쿠팡 계정 추가 완료!"); resetCoupangForm(); utils.coupang.listAccounts.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const updateCoupangMut = trpc.coupang.updateAccount.useMutation({
    onSuccess: () => { toast.success("쿠팡 계정 수정 완료"); resetCoupangForm(); utils.coupang.listAccounts.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const deleteCoupangMut = trpc.coupang.deleteAccount.useMutation({
    onSuccess: () => { toast.success("쿠팡 계정 삭제됨"); utils.coupang.listAccounts.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const testCoupangMut = trpc.coupang.testApi.useMutation({
    onSuccess: r => { toast.success(r.message); utils.coupang.listAccounts.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const setDefaultCoupangMut = trpc.coupang.setDefault.useMutation({
    onSuccess: () => { toast.success("기본 계정 변경됨"); utils.coupang.listAccounts.invalidate(); },
    onError: e => toast.error(e.message),
  });

  const resetCoupangForm = () => {
    setCoupangForm({ accountName: "", vendorId: "", accessKey: "", secretKey: "", wingLoginId: "", companyName: "", apiUrl: "", ipAddress: "", memo: "", isDefault: false });
    setEditingCoupangId(null); setShowCoupangForm(false);
  };
  const loadCoupangForEdit = (a: any) => {
    setEditingCoupangId(a.id);
    setCoupangForm({ accountName: a.accountName || "", vendorId: a.vendorId || "", accessKey: a.accessKey || "", secretKey: a.secretKey || "", wingLoginId: a.wingLoginId || "", companyName: a.companyName || "", apiUrl: a.apiUrl || "", ipAddress: a.ipAddress || "", memo: a.memo || "", isDefault: a.isDefault || false });
    setShowCoupangForm(true);
  };
  const handleCoupangSubmit = () => {
    if (!coupangForm.accountName.trim()) { toast.error("계정 이름을 입력해주세요"); return; }
    if (editingCoupangId) updateCoupangMut.mutate({ id: editingCoupangId, ...coupangForm });
    else createCoupangMut.mutate(coupangForm);
  };
  const handleCopy = (text: string, label: string) => { navigator.clipboard.writeText(text); toast.success(`${label} 복사됨`); };

  // ── Helpers ──
  const handleSave1688 = () => {
    if (!alibaba1688.username || !alibaba1688.password) { toast.error("사용자명과 비밀번호를 입력해주세요"); return; }
    saveAccountMutation.mutate({ platform: "1688", accountName: alibaba1688.accountName || undefined, username: alibaba1688.username, password: alibaba1688.password, captchaApiKey: alibaba1688.captchaApiKey || undefined });
  };
  const handleSaveAliExpress = () => {
    if (!aliexpress.username || !aliexpress.password) { toast.error("사용자명과 비밀번호를 입력해주세요"); return; }
    saveAccountMutation.mutate({ platform: "aliexpress", accountName: aliexpress.accountName || undefined, username: aliexpress.username, password: aliexpress.password, captchaApiKey: aliexpress.captchaApiKey || undefined });
  };

  const apiStatusBadge = (status: string) => {
    switch (status) {
      case "active": return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]"><CheckCircle className="w-3 h-3 mr-1" />OK</Badge>;
      case "error": return <Badge className="bg-red-50 text-red-700 border-red-200 text-[10px]"><XCircle className="w-3 h-3 mr-1" />ERR</Badge>;
      case "expired": return <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]"><Clock className="w-3 h-3 mr-1" />EXP</Badge>;
      default: return <Badge className="bg-gray-100 text-gray-600 border-gray-200 text-[10px]"><AlertCircle className="w-3 h-3 mr-1" />N/A</Badge>;
    }
  };
  const getLoginStatusBadge = (status?: string) => {
    switch (status) {
      case "logged_in": return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200"><CheckCircle className="w-3 h-3 mr-1" />로그인됨</Badge>;
      case "failed": return <Badge className="bg-red-50 text-red-700 border-red-200"><XCircle className="w-3 h-3 mr-1" />실패</Badge>;
      case "expired": return <Badge className="bg-amber-50 text-amber-700 border-amber-200"><Clock className="w-3 h-3 mr-1" />만료</Badge>;
      default: return <Badge className="bg-gray-100 text-gray-600 border-gray-200"><AlertCircle className="w-3 h-3 mr-1" />미로그인</Badge>;
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-4xl">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight gradient-text flex items-center gap-2">
            <span className="text-2xl">&#x2699;&#xFE0F;</span>
            계정 관리
          </h1>
          <p className="text-muted-foreground text-sm mt-1">쿠팡, 1688, AliExpress 계정 정보를 관리하세요</p>
        </div>

        {/* ══════════ Coupang Open API Accounts ══════════ */}
        <Card className="pretty-card overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-amber-400 via-orange-500 to-red-500" />
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-100 to-orange-200 flex items-center justify-center">
                  <ShoppingBag className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <CardTitle className="text-base"><span className="text-amber-800">쿠팡 OPEN API 계정</span></CardTitle>
                  <CardDescription className="text-[10px] text-muted-foreground">쿠팡 Wing OPEN API 키로 매출/주문/정산 데이터를 자동 수집합니다</CardDescription>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setLocation("/coupang")} className="rounded-xl text-xs border-amber-200 text-amber-600 hover:bg-amber-50">
                  <Zap className="h-3 w-3 mr-1" /> 분석 페이지
                </Button>
                <Button size="sm" onClick={() => { resetCoupangForm(); setShowCoupangForm(true); }} className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl text-xs">
                  <Plus className="h-3 w-3 mr-1" /> 계정 추가
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Account List */}
            {coupangAccounts && coupangAccounts.length > 0 ? (
              <div className="space-y-2">
                {coupangAccounts.map(acc => (
                  <div key={acc.id} className="p-4 rounded-xl border border-amber-100/60 bg-gradient-to-r from-amber-50/30 to-orange-50/30 hover:from-amber-50/60 hover:to-orange-50/60 transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{acc.accountName}</span>
                        {acc.isDefault ? <Badge className="bg-amber-50 text-amber-600 border-amber-200 text-[9px]"><Star className="h-2.5 w-2.5 mr-0.5 fill-amber-500" />기본</Badge> : null}
                        {apiStatusBadge(acc.apiStatus)}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-500 hover:bg-emerald-50 rounded-lg" onClick={() => testCoupangMut.mutate({ id: acc.id })} disabled={testCoupangMut.isPending}>
                          <TestTube className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-pink-500 hover:bg-pink-50 rounded-lg" onClick={() => loadCoupangForEdit(acc)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {!acc.isDefault && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-amber-500 hover:bg-amber-50 rounded-lg" onClick={() => setDefaultCoupangMut.mutate({ id: acc.id })}>
                            <Star className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:bg-red-50 rounded-lg" onClick={() => { if (confirm(`"${acc.accountName}" 계정을 삭제하시겠습니까?`)) deleteCoupangMut.mutate({ id: acc.id }); }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-muted-foreground">
                      <div><span className="text-[10px]">업체코드:</span> <span className="font-mono">{acc.vendorId || "-"}</span></div>
                      <div><span className="text-[10px]">Access Key:</span> <span className="font-mono">{acc.accessKey ? maskKey(acc.accessKey) : "-"}</span></div>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px]">Secret Key:</span>
                        <span className="font-mono">{acc.secretKey ? (showSecret[acc.id] ? acc.secretKey?.slice(0, 20) + "..." : "********") : "-"}</span>
                        {acc.secretKey && (
                          <button onClick={() => setShowSecret(p => ({ ...p, [acc.id]: !p[acc.id] }))} className="text-gray-400 hover:text-pink-500">
                            {showSecret[acc.id] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                          </button>
                        )}
                      </div>
                      <div><span className="text-[10px]">업체명:</span> {acc.companyName || "-"}</div>
                    </div>
                    {acc.lastSyncAt && <p className="text-[10px] text-muted-foreground mt-1.5">마지막 동기화: {formatDate(acc.lastSyncAt)}</p>}
                  </div>
                ))}
              </div>
            ) : !showCoupangForm ? (
              <div className="text-center py-6">
                <ShoppingBag className="h-10 w-10 mx-auto mb-3 text-amber-300" />
                <p className="text-sm text-muted-foreground mb-1">등록된 쿠팡 계정이 없습니다</p>
                <p className="text-xs text-muted-foreground mb-3">OPEN API 키를 등록하면 판매 데이터를 자동 수집할 수 있습니다</p>
              </div>
            ) : null}

            {/* Coupang Account Form */}
            {showCoupangForm ? (
              <div className="p-4 rounded-xl border-2 border-amber-200 bg-gradient-to-r from-amber-50/60 to-orange-50/60 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-amber-800 flex items-center gap-1.5"><Key className="h-4 w-4 text-amber-500" /> {editingCoupangId ? "계정 수정" : "새 쿠팡 계정 등록"}</p>
                  <Button variant="ghost" size="sm" onClick={resetCoupangForm} className="text-muted-foreground hover:bg-amber-100 rounded-lg text-xs">취소</Button>
                </div>
                <div className="p-3 bg-blue-50/60 rounded-lg border border-blue-100/40">
                  <p className="text-[10px] text-blue-600">쿠팡 Wing &rarr; 판매자정보 &rarr; 판매정보 &rarr; OPEN API 키 발급에서 정보를 확인하세요</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs font-medium text-muted-foreground">계정 이름 *</Label><Input placeholder="예: 메인스토어, 2호점" value={coupangForm.accountName} onChange={e => setCoupangForm(p => ({ ...p, accountName: e.target.value }))} className="pretty-input rounded-xl mt-1" /></div>
                  <div><Label className="text-xs font-medium text-muted-foreground">업체코드 (Vendor ID)</Label><Input placeholder="쿠팡 Wing 업체코드" value={coupangForm.vendorId} onChange={e => setCoupangForm(p => ({ ...p, vendorId: e.target.value }))} className="pretty-input rounded-xl mt-1" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs font-medium text-muted-foreground">Wing 로그인 ID</Label><Input placeholder="쿠팡 Wing 로그인 ID" value={coupangForm.wingLoginId} onChange={e => setCoupangForm(p => ({ ...p, wingLoginId: e.target.value }))} className="pretty-input rounded-xl mt-1" /></div>
                  <div><Label className="text-xs font-medium text-muted-foreground">업체명</Label><Input placeholder="업체명" value={coupangForm.companyName} onChange={e => setCoupangForm(p => ({ ...p, companyName: e.target.value }))} className="pretty-input rounded-xl mt-1" /></div>
                </div>
                <div className="p-3 bg-gradient-to-r from-pink-50/60 to-purple-50/60 rounded-lg border border-pink-100/40 space-y-3">
                  <p className="text-xs font-semibold text-pink-700 flex items-center gap-1.5"><Key className="h-3.5 w-3.5 text-pink-500" /> OPEN API 키 정보</p>
                  <div><Label className="text-xs font-medium text-muted-foreground">Access Key</Label><Input placeholder="OPEN API Access Key" value={coupangForm.accessKey} onChange={e => setCoupangForm(p => ({ ...p, accessKey: e.target.value }))} className="pretty-input rounded-xl mt-1 font-mono text-sm" /></div>
                  <div><Label className="text-xs font-medium text-muted-foreground">Secret Key</Label><Input type="password" placeholder="OPEN API Secret Key" value={coupangForm.secretKey} onChange={e => setCoupangForm(p => ({ ...p, secretKey: e.target.value }))} className="pretty-input rounded-xl mt-1 font-mono text-sm" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs font-medium text-muted-foreground">URL</Label><Input placeholder="wing.coupang.com" value={coupangForm.apiUrl} onChange={e => setCoupangForm(p => ({ ...p, apiUrl: e.target.value }))} className="pretty-input rounded-xl mt-1" /></div>
                  <div><Label className="text-xs font-medium text-muted-foreground">IP 주소 (쉼표 구분)</Label><Input placeholder="예) 49.50.130.101" value={coupangForm.ipAddress} onChange={e => setCoupangForm(p => ({ ...p, ipAddress: e.target.value }))} className="pretty-input rounded-xl mt-1" /><p className="text-[10px] text-amber-600 mt-0.5">* 쿠팡에 IP 등록 시 포트 없이 IP만 입력</p></div>
                </div>
                <div><Label className="text-xs font-medium text-muted-foreground">메모</Label><Textarea placeholder="메모 (선택)" value={coupangForm.memo} onChange={e => setCoupangForm(p => ({ ...p, memo: e.target.value }))} rows={2} className="pretty-input rounded-xl mt-1" /></div>
                <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={coupangForm.isDefault} onChange={e => setCoupangForm(p => ({ ...p, isDefault: e.target.checked }))} className="w-4 h-4 rounded border-amber-300 text-amber-500 focus:ring-amber-500" /><span className="text-sm text-muted-foreground">기본 계정으로 설정</span></label>
                <div className="flex gap-2">
                  <Button onClick={handleCoupangSubmit} disabled={createCoupangMut.isPending || updateCoupangMut.isPending} className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl shadow-md shadow-amber-200/40">
                    <Sparkles className="h-4 w-4 mr-1.5" />{editingCoupangId ? "수정 완료" : "계정 등록"}
                  </Button>
                  <Button variant="ghost" onClick={resetCoupangForm} className="rounded-xl text-muted-foreground">취소</Button>
                </div>
              </div>
            ) : null}

            {/* Coupang API Key guide */}
            <div className="p-3 bg-gradient-to-r from-amber-50/60 to-orange-50/60 rounded-xl border border-amber-100/40 text-xs text-amber-700/80 space-y-1">
              <p className="font-semibold text-amber-700 flex items-center gap-1"><Shield className="h-3.5 w-3.5 text-amber-500" /> OPEN API 키 발급 안내</p>
              <ol className="list-decimal list-inside ml-1 space-y-0.5">
                <li><a href="https://wing.coupang.com" target="_blank" rel="noopener noreferrer" className="text-pink-500 hover:underline font-medium">쿠팡 Wing</a> &rarr; 판매자정보 &rarr; 판매정보</li>
                <li>하단 OPEN API 키 발급 &rarr; "자체개발(직접입력)" 선택</li>
                <li>발급된 Access Key / Secret Key를 여기에 입력</li>
                <li><span className="font-semibold">IP 허용 목록에 서버 IP 등록</span> (포트 번호 불필요)</li>
              </ol>
            </div>
          </CardContent>
        </Card>

        {/* ══════════ 1688 Account ══════════ */}
        <Card className="pretty-card overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-pink-400 to-rose-400" />
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-100 to-rose-100 flex items-center justify-center">
                  <Key className="w-5 h-5 text-pink-500" />
                </div>
                <div>
                  <CardTitle className="text-base"><span className="gradient-text-soft">1688 계정</span></CardTitle>
                  <CardDescription className="text-[10px] text-muted-foreground">1688 사이트 로그인 정보 (향후 자동 소싱 기능 예정)</CardDescription>
                </div>
              </div>
              {alibaba1688Account && getLoginStatusBadge(alibaba1688Account.loginStatus)}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {alibaba1688Account ? (
              <div className="space-y-4">
                <div className="p-4 bg-gradient-to-r from-pink-50 to-purple-50 rounded-xl border border-pink-100/50 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">사용자명</span>
                    <span className="font-medium">{alibaba1688Account.username}</span>
                  </div>
                  {alibaba1688Account.lastLoginAt && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">마지막 로그인</span>
                      <span className="text-sm">{formatDate(alibaba1688Account.lastLoginAt)}</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => testLoginMutation.mutate({ platform: "1688" })} disabled={testLoginMutation.isPending} className="border-pink-200 text-pink-600 hover:bg-pink-50 rounded-xl text-xs">
                    <TestTube className="h-3.5 w-3.5 mr-1.5" /> 로그인 테스트
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { if (confirm("1688 계정을 삭제하시겠습니까?")) deleteAccountMutation.mutate({ platform: "1688" }); }} disabled={deleteAccountMutation.isPending} className="border-red-200 text-red-500 hover:bg-red-50 rounded-xl text-xs">
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" /> 계정 삭제
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs font-medium text-muted-foreground">계정 이름 (선택)</Label><Input placeholder="예: 메인 계정" value={alibaba1688.accountName} onChange={(e) => setAlibaba1688({ ...alibaba1688, accountName: e.target.value })} className="pretty-input rounded-xl mt-1" /></div>
                  <div><Label className="text-xs font-medium text-muted-foreground">사용자명 *</Label><Input placeholder="이메일 또는 전화번호" value={alibaba1688.username} onChange={(e) => setAlibaba1688({ ...alibaba1688, username: e.target.value })} className="pretty-input rounded-xl mt-1" /></div>
                </div>
                <div><Label className="text-xs font-medium text-muted-foreground">비밀번호 *</Label><Input type="password" placeholder="********" value={alibaba1688.password} onChange={(e) => setAlibaba1688({ ...alibaba1688, password: e.target.value })} className="pretty-input rounded-xl mt-1" /></div>
                <div><Label className="text-xs font-medium text-muted-foreground">2Captcha API 키 (선택)</Label><Input placeholder="2Captcha API 키" value={alibaba1688.captchaApiKey} onChange={(e) => setAlibaba1688({ ...alibaba1688, captchaApiKey: e.target.value })} className="pretty-input rounded-xl mt-1" /></div>
                <Button onClick={handleSave1688} disabled={saveAccountMutation.isPending} className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white rounded-xl shadow-md shadow-pink-200/40"><Sparkles className="h-4 w-4 mr-1.5" /> 계정 저장</Button>
              </div>
            )}
            <div className="p-2.5 bg-blue-50/40 rounded-lg border border-blue-100/30">
              <p className="text-[10px] text-blue-600">&#x1F6A7; 1688 자동 소싱 기능은 향후 업데이트 예정입니다. 계정을 미리 등록해두세요.</p>
            </div>
          </CardContent>
        </Card>

        {/* ══════════ AliExpress Account ══════════ */}
        <Card className="pretty-card overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-purple-400 to-fuchsia-400" />
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-100 to-fuchsia-100 flex items-center justify-center">
                  <Key className="w-5 h-5 text-purple-500" />
                </div>
                <div>
                  <CardTitle className="text-base"><span className="gradient-text-soft">AliExpress 계정</span></CardTitle>
                  <CardDescription className="text-[10px] text-muted-foreground">AliExpress 로그인 정보 (향후 자동 소싱 기능 예정)</CardDescription>
                </div>
              </div>
              {aliexpressAccount && getLoginStatusBadge(aliexpressAccount.loginStatus)}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {aliexpressAccount ? (
              <div className="space-y-4">
                <div className="p-4 bg-gradient-to-r from-purple-50 to-fuchsia-50 rounded-xl border border-purple-100/50 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">사용자명</span>
                    <span className="font-medium">{aliexpressAccount.username}</span>
                  </div>
                  {aliexpressAccount.lastLoginAt && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">마지막 로그인</span>
                      <span className="text-sm">{formatDate(aliexpressAccount.lastLoginAt)}</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => testLoginMutation.mutate({ platform: "aliexpress" })} disabled={testLoginMutation.isPending} className="border-purple-200 text-purple-600 hover:bg-purple-50 rounded-xl text-xs">
                    <TestTube className="h-3.5 w-3.5 mr-1.5" /> 로그인 테스트
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { if (confirm("AliExpress 계정을 삭제하시겠습니까?")) deleteAccountMutation.mutate({ platform: "aliexpress" }); }} disabled={deleteAccountMutation.isPending} className="border-red-200 text-red-500 hover:bg-red-50 rounded-xl text-xs">
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" /> 계정 삭제
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs font-medium text-muted-foreground">계정 이름 (선택)</Label><Input placeholder="예: 메인 계정" value={aliexpress.accountName} onChange={(e) => setAliexpress({ ...aliexpress, accountName: e.target.value })} className="pretty-input rounded-xl mt-1" /></div>
                  <div><Label className="text-xs font-medium text-muted-foreground">사용자명 *</Label><Input placeholder="이메일 또는 전화번호" value={aliexpress.username} onChange={(e) => setAliexpress({ ...aliexpress, username: e.target.value })} className="pretty-input rounded-xl mt-1" /></div>
                </div>
                <div><Label className="text-xs font-medium text-muted-foreground">비밀번호 *</Label><Input type="password" placeholder="********" value={aliexpress.password} onChange={(e) => setAliexpress({ ...aliexpress, password: e.target.value })} className="pretty-input rounded-xl mt-1" /></div>
                <div><Label className="text-xs font-medium text-muted-foreground">2Captcha API 키 (선택)</Label><Input placeholder="2Captcha API 키" value={aliexpress.captchaApiKey} onChange={(e) => setAliexpress({ ...aliexpress, captchaApiKey: e.target.value })} className="pretty-input rounded-xl mt-1" /></div>
                <Button onClick={handleSaveAliExpress} disabled={saveAccountMutation.isPending} className="bg-gradient-to-r from-purple-500 to-fuchsia-500 hover:from-purple-600 hover:to-fuchsia-600 text-white rounded-xl shadow-md shadow-purple-200/40"><Sparkles className="h-4 w-4 mr-1.5" /> 계정 저장</Button>
              </div>
            )}
            <div className="p-2.5 bg-blue-50/40 rounded-lg border border-blue-100/30">
              <p className="text-[10px] text-blue-600">&#x1F6A7; AliExpress 자동 소싱 기능은 향후 업데이트 예정입니다. 계정을 미리 등록해두세요.</p>
            </div>
          </CardContent>
        </Card>

        {/* Security notice */}
        <Card className="pretty-card border-amber-100/60 overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-amber-300 to-orange-300" />
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-amber-500" />
              <span className="text-amber-700">보안 안내</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-amber-700/80 space-y-1.5">
            <p>&#x2022; 입력하신 비밀번호와 API 키는 암호화되어 안전하게 저장됩니다.</p>
            <p>&#x2022; 쿠팡 OPEN API는 HMAC-SHA256 서명 방식으로 인증되며 비밀번호 노출 위험이 없습니다.</p>
            <p>&#x2022; 계정 정보는 데이터 수집 목적으로만 사용됩니다.</p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
