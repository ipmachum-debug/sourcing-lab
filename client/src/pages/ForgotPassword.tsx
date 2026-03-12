import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "../lib/trpc";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { toast } from "sonner";
import { CHARACTERS } from "../lib/characters";
import { Sparkles, Mail, KeyRound, ArrowLeft, CheckCircle2 } from "lucide-react";

export default function ForgotPassword() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);

  useEffect(() => {
    document.body.classList.add('pastel-gradient-bg');
    return () => { document.body.classList.remove('pastel-gradient-bg'); };
  }, []);

  const requestReset = trpc.auth.requestPasswordReset.useMutation({
    onSuccess: (data) => {
      setIsSubmitted(true);
      toast.success("재설정 링크가 전송되었습니다! ✨");
      if (data.resetToken) {
        console.log("[개발 모드] 비밀번호 재설정 토큰:", data.resetToken);
        console.log("[개발 모드] 재설정 URL:", `/reset-password?token=${data.resetToken}`);
      }
    },
    onError: (error) => {
      toast.error(error.message || "오류가 발생했습니다.");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast.error("이메일을 입력해주세요.");
      return;
    }
    requestReset.mutate({ email });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      {/* Floating decorative elements */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[10%] left-[5%] w-32 h-32 rounded-full bg-pink-200/20 animate-float" style={{ animationDelay: '0s' }} />
        <div className="absolute top-[20%] right-[10%] w-24 h-24 rounded-full bg-purple-200/20 animate-float" style={{ animationDelay: '2s' }} />
        <div className="absolute bottom-[15%] left-[15%] w-20 h-20 rounded-full bg-fuchsia-200/20 animate-float" style={{ animationDelay: '4s' }} />
      </div>

      {/* Character decoration */}
      <div className="hidden lg:block absolute top-10 left-10 opacity-15 animate-float">
        <img src={CHARACTERS.EMPTY_STATE} alt="" className="w-28 h-28 drop-shadow-md" />
      </div>

      <Card className="w-full max-w-md shadow-2xl shadow-pink-200/30 border-2 border-pink-100/60 bg-white/90 backdrop-blur-sm rounded-3xl overflow-hidden relative z-10">
        <div className="h-1.5 bg-gradient-to-r from-pink-400 via-fuchsia-400 to-purple-500" />

        <CardHeader className="text-center space-y-3 pt-8 pb-2">
          <div className="flex justify-center mb-2">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-pink-100 via-fuchsia-100 to-purple-100 flex items-center justify-center shadow-inner border border-pink-200/40">
              {isSubmitted ? (
                <CheckCircle2 className="h-7 w-7 text-emerald-500" />
              ) : (
                <KeyRound className="h-7 w-7 text-pink-500" />
              )}
            </div>
          </div>
          <CardTitle className="text-3xl font-bold gradient-text flex items-center justify-center gap-2">
            <Sparkles className="h-6 w-6 text-pink-400 animate-sparkle" />
            비밀번호 찾기
          </CardTitle>
          <CardDescription className="text-base text-pink-400/80">
            {isSubmitted ? "이메일을 확인해주세요" : "가입하신 이메일 주소를 입력해주세요"}
          </CardDescription>
        </CardHeader>

        <CardContent className="px-7 pb-7">
          {isSubmitted ? (
            <div className="space-y-5">
              <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200/60 rounded-2xl p-5 text-center space-y-2">
                <div className="flex justify-center mb-2">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                    <Mail className="h-5 w-5 text-emerald-600" />
                  </div>
                </div>
                <p className="text-emerald-800 font-semibold">
                  비밀번호 재설정 링크가 전송되었습니다!
                </p>
                <p className="text-emerald-600 text-sm">
                  이메일을 확인하여 비밀번호를 재설정해주세요.
                </p>
              </div>
              <Button
                onClick={() => setLocation("/login")}
                className="w-full bg-gradient-to-r from-pink-500 via-fuchsia-500 to-purple-500 hover:from-pink-600 hover:via-fuchsia-600 hover:to-purple-600 text-white font-semibold py-5 rounded-xl shadow-lg shadow-pink-200/50 transition-all hover:scale-[1.02]"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                로그인 페이지로 돌아가기
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
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

              <Button
                type="submit"
                className="w-full bg-gradient-to-r from-pink-500 via-fuchsia-500 to-purple-500 hover:from-pink-600 hover:via-fuchsia-600 hover:to-purple-600 text-white font-semibold py-5 rounded-xl shadow-lg shadow-pink-200/50 transition-all hover:scale-[1.02]"
                disabled={requestReset.isPending}
              >
                {requestReset.isPending ? (
                  <span className="flex items-center gap-2">
                    <div className="cute-dots">
                      <div className="cute-dot" style={{ width: 6, height: 6, background: 'white' }} />
                      <div className="cute-dot" style={{ width: 6, height: 6, background: 'white' }} />
                      <div className="cute-dot" style={{ width: 6, height: 6, background: 'white' }} />
                    </div>
                    전송 중...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    재설정 링크 받기
                  </span>
                )}
              </Button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => setLocation("/login")}
                  className="text-sm text-pink-500 hover:text-pink-600 hover:underline transition-colors font-medium"
                >
                  <ArrowLeft className="h-3 w-3 inline mr-1" />
                  로그인 페이지로 돌아가기
                </button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
