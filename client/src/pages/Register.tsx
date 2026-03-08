import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CHARACTERS } from "../lib/characters";
import { Sparkles } from "lucide-react";

export default function Register() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [userMemo, setUserMemo] = useState("");

  useEffect(() => {
    document.body.classList.add('pastel-gradient-bg');
    return () => { document.body.classList.remove('pastel-gradient-bg'); };
  }, []);

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: () => {
      toast.success("회원가입이 완료되었습니다! 관리자 승인 후 로그인할 수 있습니다. ✨");
      setLocation("/login");
    },
    onError: (error) => {
      toast.error(error.message || "회원가입에 실패했습니다.");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) { toast.error("비밀번호가 일치하지 않습니다."); return; }
    if (password.length < 8) { toast.error("비밀번호는 최소 8자 이상이어야 합니다."); return; }
    registerMutation.mutate({ email, password, name: name || undefined, userMemo: userMemo || undefined });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[10%] left-[5%] w-32 h-32 rounded-full bg-pink-200/20 animate-float" />
        <div className="absolute top-[20%] right-[10%] w-24 h-24 rounded-full bg-purple-200/20 animate-float" style={{ animationDelay: '2s' }} />
      </div>

      <div className="absolute top-10 right-10 opacity-15 animate-float hidden md:block">
        <img src={CHARACTERS.HOME_HERO} alt="" className="w-28 h-28" />
      </div>

      <Card className="w-full max-w-md shadow-2xl shadow-pink-200/30 border-2 border-pink-100/60 bg-white/90 backdrop-blur-sm rounded-3xl overflow-hidden relative z-10">
        <div className="h-1.5 bg-gradient-to-r from-pink-400 via-fuchsia-400 to-purple-500" />
        <CardHeader className="text-center space-y-2 pt-6">
          <CardTitle className="text-3xl font-bold gradient-text flex items-center justify-center gap-2">
            <Sparkles className="h-6 w-6 text-pink-400 animate-sparkle" />
            회원가입
          </CardTitle>
          <CardDescription className="text-base text-pink-400/80">
            소싱 관리 시스템에 가입하세요
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium text-gray-600">이메일 *</Label>
              <Input id="email" type="email" placeholder="example@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required className="pretty-input rounded-xl" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name" className="text-sm font-medium text-gray-600">이름 (선택)</Label>
              <Input id="name" type="text" placeholder="홍길동" value={name} onChange={(e) => setName(e.target.value)} className="pretty-input rounded-xl" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium text-gray-600">비밀번호 *</Label>
              <Input id="password" type="password" placeholder="최소 8자 이상" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="pretty-input rounded-xl" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-sm font-medium text-gray-600">비밀번호 확인 *</Label>
              <Input id="confirmPassword" type="password" placeholder="비밀번호 재입력" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} className="pretty-input rounded-xl" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="userMemo" className="text-sm font-medium text-gray-600">소속 및 역할 (선택)</Label>
              <Textarea id="userMemo" placeholder="예: 소속: OO회사, 역할: 구매담당자" value={userMemo} onChange={(e) => setUserMemo(e.target.value)} rows={3} maxLength={500} className="pretty-input rounded-xl resize-none" />
              <p className="text-xs text-muted-foreground">관리자가 승인 시 참고할 정보를 입력해주세요.</p>
            </div>
            <Button type="submit" className="w-full bg-gradient-to-r from-pink-500 via-fuchsia-500 to-purple-500 hover:from-pink-600 hover:via-fuchsia-600 hover:to-purple-600 text-white font-semibold py-5 rounded-xl shadow-lg shadow-pink-200/50 transition-all hover:scale-[1.02]" disabled={registerMutation.isPending}>
              {registerMutation.isPending ? "가입 중..." : "✨ 회원가입"}
            </Button>
            <div className="text-center text-sm text-gray-500">
              이미 계정이 있으신가요?{" "}
              <Link href="/login" className="text-pink-500 hover:text-pink-600 font-semibold hover:underline">로그인</Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
