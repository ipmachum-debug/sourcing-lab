import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { trpc } from "../lib/trpc";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { toast } from "sonner";
import { Sparkles, Lock, CheckCircle2, ArrowLeft, AlertTriangle } from "lucide-react";

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    document.body.classList.add('pastel-gradient-bg');
    return () => { document.body.classList.remove('pastel-gradient-bg'); };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(search);
    const tokenParam = params.get("token");
    if (tokenParam) {
      setToken(tokenParam);
    }
  }, [search]);

  const resetPassword = trpc.auth.resetPassword.useMutation({
    onSuccess: () => {
      setIsSuccess(true);
      toast.success("비밀번호가 성공적으로 변경되었습니다! ✨");
    },
    onError: (error) => {
      toast.error(error.message || "오류가 발생했습니다.");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      toast.error("유효하지 않은 토큰입니다.");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("비밀번호는 최소 8자 이상이어야 합니다.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("비밀번호가 일치하지 않습니다.");
      return;
    }
    resetPassword.mutate({ token, newPassword });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      {/* Floating decorative elements */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[10%] left-[5%] w-32 h-32 rounded-full bg-pink-200/20 animate-float" style={{ animationDelay: '0s' }} />
        <div className="absolute top-[20%] right-[10%] w-24 h-24 rounded-full bg-purple-200/20 animate-float" style={{ animationDelay: '2s' }} />
        <div className="absolute bottom-[15%] left-[15%] w-20 h-20 rounded-full bg-fuchsia-200/20 animate-float" style={{ animationDelay: '4s' }} />
      </div>

      <Card className="w-full max-w-md shadow-2xl shadow-pink-200/30 border-2 border-pink-100/60 bg-white/90 backdrop-blur-sm rounded-3xl overflow-hidden relative z-10">
        <div className="h-1.5 bg-gradient-to-r from-pink-400 via-fuchsia-400 to-purple-500" />

        <CardHeader className="text-center space-y-3 pt-8 pb-2">
          <div className="flex justify-center mb-2">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-pink-100 via-fuchsia-100 to-purple-100 flex items-center justify-center shadow-inner border border-pink-200/40">
              {isSuccess ? (
                <CheckCircle2 className="h-7 w-7 text-emerald-500" />
              ) : (
                <Lock className="h-7 w-7 text-pink-500" />
              )}
            </div>
          </div>
          <CardTitle className="text-3xl font-bold gradient-text flex items-center justify-center gap-2">
            <Sparkles className="h-6 w-6 text-pink-400 animate-sparkle" />
            비밀번호 재설정
          </CardTitle>
          <CardDescription className="text-base text-pink-400/80">
            {isSuccess ? "비밀번호가 변경되었습니다" : "새로운 비밀번호를 입력해주세요"}
          </CardDescription>
        </CardHeader>

        <CardContent className="px-7 pb-7">
          {isSuccess ? (
            <div className="space-y-5">
              <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200/60 rounded-2xl p-5 text-center space-y-2">
                <p className="text-emerald-800 font-semibold">
                  비밀번호가 성공적으로 변경되었습니다!
                </p>
                <p className="text-emerald-600 text-sm">
                  새 비밀번호로 로그인해주세요.
                </p>
              </div>
              <Button
                onClick={() => setLocation("/login")}
                className="w-full bg-gradient-to-r from-pink-500 via-fuchsia-500 to-purple-500 hover:from-pink-600 hover:via-fuchsia-600 hover:to-purple-600 text-white font-semibold py-5 rounded-xl shadow-lg shadow-pink-200/50 transition-all hover:scale-[1.02]"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                로그인 페이지로 이동
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {!token && (
                <div className="bg-gradient-to-r from-red-50 to-rose-50 border border-red-200/60 rounded-2xl p-4 text-center space-y-1">
                  <div className="flex justify-center mb-1">
                    <AlertTriangle className="h-5 w-5 text-red-400" />
                  </div>
                  <p className="text-red-800 font-semibold text-sm">유효하지 않은 링크입니다.</p>
                  <p className="text-red-600 text-xs">비밀번호 재설정을 다시 요청해주세요.</p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="newPassword" className="text-sm font-medium text-gray-600 flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 text-pink-400" />
                  새 비밀번호
                </Label>
                <Input
                  id="newPassword"
                  type="password"
                  placeholder="최소 8자 이상"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  className="pretty-input rounded-xl h-11"
                  disabled={!token}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-sm font-medium text-gray-600 flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 text-pink-400" />
                  새 비밀번호 확인
                </Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="비밀번호 재입력"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="pretty-input rounded-xl h-11"
                  disabled={!token}
                />
              </div>

              <Button
                type="submit"
                className="w-full bg-gradient-to-r from-pink-500 via-fuchsia-500 to-purple-500 hover:from-pink-600 hover:via-fuchsia-600 hover:to-purple-600 text-white font-semibold py-5 rounded-xl shadow-lg shadow-pink-200/50 transition-all hover:scale-[1.02]"
                disabled={resetPassword.isPending || !token}
              >
                {resetPassword.isPending ? (
                  <span className="flex items-center gap-2">
                    <div className="cute-dots">
                      <div className="cute-dot" style={{ width: 6, height: 6, background: 'white' }} />
                      <div className="cute-dot" style={{ width: 6, height: 6, background: 'white' }} />
                      <div className="cute-dot" style={{ width: 6, height: 6, background: 'white' }} />
                    </div>
                    변경 중...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    비밀번호 변경
                  </span>
                )}
              </Button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => setLocation("/forgot-password")}
                  className="text-sm text-pink-500 hover:text-pink-600 hover:underline transition-colors font-medium"
                >
                  재설정 링크 다시 받기
                </button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
