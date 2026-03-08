import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { CHARACTERS } from "@/lib/characters";
import { Sparkles } from "lucide-react";

export default function Landing() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const { data: user, isLoading } = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!isLoading && user) {
      setLocation("/dashboard");
    }
  }, [user, isLoading, setLocation]);
  
  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: () => {
      toast.success("로그인 성공! 환영합니다! ✨");
      window.location.href = "/dashboard";
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("이메일과 비밀번호를 입력해주세요.");
      return;
    }
    loginMutation.mutate({ email, password });
  };

  useEffect(() => {
    document.body.classList.add('pastel-gradient-bg');
    return () => {
      document.body.classList.remove('pastel-gradient-bg');
    };
  }, []);

  if (isLoading || user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <div className="cute-dots">
          <div className="cute-dot" />
          <div className="cute-dot" />
          <div className="cute-dot" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      {/* Decorative floating elements */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[10%] left-[5%] w-32 h-32 rounded-full bg-pink-200/20 animate-float" style={{ animationDelay: '0s' }} />
        <div className="absolute top-[20%] right-[10%] w-24 h-24 rounded-full bg-purple-200/20 animate-float" style={{ animationDelay: '2s' }} />
        <div className="absolute bottom-[15%] left-[15%] w-20 h-20 rounded-full bg-fuchsia-200/20 animate-float" style={{ animationDelay: '4s' }} />
        <div className="absolute bottom-[25%] right-[5%] w-28 h-28 rounded-full bg-rose-200/15 animate-float" style={{ animationDelay: '1s' }} />
      </div>

      <div className="max-w-6xl w-full grid md:grid-cols-2 gap-8 items-center relative z-10">
        {/* Left: Illustration */}
        <div className="flex flex-col items-center justify-center space-y-6 text-center">
          <div className="w-64 h-64 bg-white/60 rounded-3xl p-8 shadow-xl shadow-pink-100/40 backdrop-blur-sm border border-white/60 animate-float">
            <img 
              src={CHARACTERS.EMPTY_STATE} 
              alt="Sourcing Lab" 
              className="w-full h-full object-contain drop-shadow-md"
            />
          </div>
          <div className="space-y-3">
            <h1 className="text-4xl font-bold gradient-text flex items-center justify-center gap-2">
              <Sparkles className="h-7 w-7 text-pink-400 animate-sparkle" />
              Sourcing Lab
            </h1>
            <p className="text-lg text-gray-700 font-medium">
              데일리 소싱 & 주간 리뷰 시스템에 오신 것을 환영합니다!
            </p>
            <p className="text-sm text-gray-500 max-w-md mx-auto leading-relaxed">
              매일 상품을 소싱하고 분석하세요. 자동 점수 계산, 마진 분석,
              주간 리뷰로 효율적인 소싱 관리가 가능합니다.
            </p>
          </div>
        </div>

        {/* Right: Login form */}
        <Card className="shadow-2xl shadow-pink-200/30 border-2 border-pink-100/60 backdrop-blur-sm bg-white/90 rounded-3xl overflow-hidden">
          <div className="h-1.5 bg-gradient-to-r from-pink-400 via-fuchsia-400 to-purple-500" />
          <CardHeader className="space-y-1 pt-6">
            <CardTitle className="text-2xl text-center gradient-text">
              로그인
            </CardTitle>
            <CardDescription className="text-center text-pink-400/80">
              소싱 관리 시스템에 로그인하세요
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium text-gray-600">이메일</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="example@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pretty-input rounded-xl h-11"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-sm font-medium text-gray-600">비밀번호</Label>
                  <a 
                    href="/forgot-password" 
                    className="text-xs text-pink-400 hover:text-pink-500 hover:underline transition-colors"
                  >
                    비밀번호 찾기
                  </a>
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="비밀번호 입력"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pretty-input rounded-xl h-11"
                />
              </div>
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
                    <Sparkles className="h-4 w-4" />
                    로그인
                  </span>
                )}
              </Button>
              <div className="text-center text-sm text-gray-500">
                계정이 없으신가요?{" "}
                <a 
                  href="/register" 
                  className="text-pink-500 hover:text-pink-600 font-semibold hover:underline transition-colors"
                >
                  회원가입
                </a>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Company Info Footer */}
      <div className="fixed bottom-4 left-0 right-0 z-10 text-center text-[11px] text-gray-400 leading-relaxed">
        <p>
          (주)골든터틀컴퍼니 | 대표전화 <a href="tel:032-322-9958" className="hover:text-pink-400">032-322-9958</a> | <a href="mailto:sokoorymall@naver.com" className="hover:text-pink-400">sokoorymall@naver.com</a> | 사업자등록번호 603-81-93743
        </p>
        <p>
          인천광역시 서구 원창로89번길 14-7, 3층 301호 | 통신판매업 2025-인천서구-3547 | <a href="https://goldenturtle.co.kr" target="_blank" rel="noopener" className="hover:text-pink-400">goldenturtle.co.kr</a> | 고객센터 평일 09:00~18:00
        </p>
      </div>
    </div>
  );
}
