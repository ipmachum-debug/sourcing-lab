import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CHARACTERS } from "../lib/characters";
import { Sparkles, Heart, Lock, Mail } from "lucide-react";

export default function Login() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    document.body.classList.add('pastel-gradient-bg');
    return () => { document.body.classList.remove('pastel-gradient-bg'); };
  }, []);

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: () => {
      toast.success("로그인 성공! 환영합니다! ✨");
      window.location.href = "/dashboard";
    },
    onError: (error) => {
      toast.error(error.message || "로그인에 실패했습니다.");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("이메일과 비밀번호를 입력해주세요.");
      return;
    }
    loginMutation.mutate({ email, password });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      {/* Floating decorative elements */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[8%] left-[8%] w-36 h-36 rounded-full bg-pink-200/20 animate-float" style={{ animationDelay: '0s' }} />
        <div className="absolute top-[15%] right-[12%] w-28 h-28 rounded-full bg-purple-200/20 animate-float" style={{ animationDelay: '2s' }} />
        <div className="absolute bottom-[20%] left-[10%] w-24 h-24 rounded-full bg-fuchsia-200/20 animate-float" style={{ animationDelay: '4s' }} />
        <div className="absolute bottom-[30%] right-[8%] w-32 h-32 rounded-full bg-rose-200/15 animate-float" style={{ animationDelay: '1s' }} />
        <div className="absolute top-[50%] left-[50%] w-20 h-20 rounded-full bg-violet-200/10 animate-float" style={{ animationDelay: '3s' }} />
      </div>

      {/* Character decoration */}
      <div className="absolute top-10 left-10 opacity-15 animate-float hidden md:block">
        <img src={CHARACTERS.HOME_HERO} alt="" className="w-28 h-28 drop-shadow-md" />
      </div>

      <Card className="w-full max-w-md shadow-2xl shadow-pink-200/30 border-2 border-pink-100/60 bg-white/90 backdrop-blur-sm rounded-3xl overflow-hidden relative z-10">
        {/* Gradient top bar */}
        <div className="h-1.5 bg-gradient-to-r from-pink-400 via-fuchsia-400 to-purple-500" />
        
        <CardHeader className="text-center space-y-3 pt-8 pb-2">
          {/* Cute lock icon */}
          <div className="flex justify-center mb-2">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-pink-100 via-fuchsia-100 to-purple-100 flex items-center justify-center shadow-inner border border-pink-200/40">
              <Lock className="h-7 w-7 text-pink-500" />
            </div>
          </div>
          <CardTitle className="text-3xl font-bold gradient-text flex items-center justify-center gap-2">
            <Sparkles className="h-6 w-6 text-pink-400 animate-sparkle" />
            로그인
          </CardTitle>
          <CardDescription className="text-base text-pink-400/80">
            소싱 관리 시스템에 로그인하세요
          </CardDescription>
        </CardHeader>
        
        <CardContent className="px-7 pb-7">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium text-gray-600 flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5 text-pink-400" />
                이메일
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="example@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="pretty-input rounded-xl h-11"
              />
            </div>

            {/* Password */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-sm font-medium text-gray-600 flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 text-pink-400" />
                  비밀번호
                </Label>
                <Link href="/forgot-password" className="text-xs text-pink-400 hover:text-pink-500 hover:underline transition-colors">
                  비밀번호 찾기
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="비밀번호 입력"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="pretty-input rounded-xl h-11"
              />
            </div>

            {/* Submit button */}
            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-pink-500 via-fuchsia-500 to-purple-500 hover:from-pink-600 hover:via-fuchsia-600 hover:to-purple-600 text-white font-semibold py-6 rounded-xl shadow-lg shadow-pink-200/50 transition-all duration-300 hover:shadow-xl hover:scale-[1.02]"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <div className="cute-dots">
                    <div className="cute-dot" style={{ width: 6, height: 6, background: 'white' }} />
                    <div className="cute-dot" style={{ width: 6, height: 6, background: 'white' }} />
                    <div className="cute-dot" style={{ width: 6, height: 6, background: 'white' }} />
                  </div>
                  로그인 중...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Heart className="h-4 w-4" />
                  로그인
                </span>
              )}
            </Button>

            {/* Divider */}
            <div className="relative flex items-center gap-4 py-1">
              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-pink-200 to-transparent" />
            </div>

            {/* Register link */}
            <div className="text-center text-sm text-gray-500">
              계정이 없으신가요?{" "}
              <Link href="/register" className="text-pink-500 hover:text-pink-600 font-semibold hover:underline transition-colors">
                회원가입
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Company Info Footer */}
      <div className="absolute bottom-4 left-0 right-0 z-10">
        <div className="max-w-lg mx-auto px-6 text-center">
          <div className="bg-white/60 backdrop-blur-sm rounded-2xl px-5 py-4 border border-pink-100/40 shadow-sm">
            <p className="text-xs font-semibold text-gray-500 mb-1.5">주식회사 골든터틀컴퍼니</p>
            <div className="text-[10px] text-gray-400 space-y-0.5 leading-relaxed">
              <p>인천광역시 서구 원창로89번길 14-7 (원창동) 3층 301호</p>
              <p>
                대표전화{" "}
                <a href="tel:032-322-9958" className="text-pink-400 hover:underline">032-322-9958</a>
                {" | "}
                <a href="mailto:sokoorymall@naver.com" className="text-pink-400 hover:underline">sokoorymall@naver.com</a>
              </p>
              <p>
                사업자등록번호 603-81-93743 | 통신판매업 2025-인천서구-3547
              </p>
              <p className="flex items-center justify-center gap-1.5 mt-1">
                <a href="https://goldenturtle.co.kr" target="_blank" rel="noopener" className="text-pink-400 hover:underline">goldenturtle.co.kr</a>
                {" | "}
                <a href="https://haccpone.com" target="_blank" rel="noopener" className="text-pink-400 hover:underline">haccpone.com</a>
              </p>
              <p className="text-gray-300 mt-1">고객센터 평일 09:00~18:00 (점심 12:00~13:00)</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
