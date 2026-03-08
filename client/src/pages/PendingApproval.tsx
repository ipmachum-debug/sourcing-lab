import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { CHARACTERS } from "../lib/characters";
import { Clock, Mail, Sparkles, Heart, ArrowLeft, Package, TrendingUp, CalendarCheck, Star } from "lucide-react";
import { useEffect } from "react";

export default function PendingApproval() {
  useEffect(() => {
    document.body.classList.add('pastel-gradient-bg');
    return () => { document.body.classList.remove('pastel-gradient-bg'); };
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      {/* Floating decorative elements */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[8%] left-[5%] w-36 h-36 rounded-full bg-pink-200/20 animate-float" style={{ animationDelay: '0s' }} />
        <div className="absolute top-[15%] right-[10%] w-28 h-28 rounded-full bg-purple-200/20 animate-float" style={{ animationDelay: '2s' }} />
        <div className="absolute bottom-[20%] left-[12%] w-24 h-24 rounded-full bg-fuchsia-200/20 animate-float" style={{ animationDelay: '4s' }} />
        <div className="absolute bottom-[10%] right-[8%] w-20 h-20 rounded-full bg-rose-200/15 animate-float" style={{ animationDelay: '1s' }} />
      </div>

      {/* Character decoration */}
      <div className="absolute top-10 right-10 opacity-15 animate-float hidden md:block">
        <img src={CHARACTERS.LOADING} alt="" className="w-32 h-32 drop-shadow-md" />
      </div>

      <Card className="w-full max-w-2xl shadow-2xl shadow-pink-200/30 border-2 border-pink-100/60 bg-white/90 backdrop-blur-sm rounded-3xl overflow-hidden relative z-10">
        <div className="h-1.5 bg-gradient-to-r from-pink-400 via-fuchsia-400 to-purple-500" />
        
        <CardHeader className="text-center space-y-4 pt-8">
          {/* Animated clock icon */}
          <div className="flex justify-center">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-pink-100 via-fuchsia-100 to-purple-100 flex items-center justify-center shadow-inner border border-pink-200/40 animate-float">
              <Clock className="w-9 h-9 text-pink-500" />
            </div>
          </div>
          <CardTitle className="text-3xl font-bold gradient-text flex items-center justify-center gap-2">
            <Sparkles className="h-6 w-6 text-pink-400 animate-sparkle" />
            관리자 승인 대기 중
          </CardTitle>
          <CardDescription className="text-base text-pink-400/80 max-w-md mx-auto">
            회원가입이 완료되었습니다! 관리자 승인 후 시스템을 이용하실 수 있습니다.
          </CardDescription>
        </CardHeader>

        <CardContent className="px-8 pb-8 space-y-6">
          {/* System intro */}
          <Card className="pretty-card border-pink-100/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Heart className="h-4 w-4 text-pink-400" />
                <span className="gradient-text-soft">Sourcing Lab 소개</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground leading-relaxed">
                데일리 소싱 & 주간 리뷰 시스템입니다. 매일 상품을 소싱하고 분석하여 
                자동 점수 계산, 마진 분석, 주간 리뷰로 효율적인 소싱 관리가 가능합니다.
              </p>
            </CardContent>
          </Card>

          {/* Features grid */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: <Package className="h-5 w-5 text-pink-500" />, title: "데일리 소싱", desc: "매일 상품 분석 & 등록", gradient: "from-pink-50 to-rose-50", border: "border-pink-200/40" },
              { icon: <Star className="h-5 w-5 text-purple-500" />, title: "자동 점수", desc: "AI 기반 점수 계산", gradient: "from-purple-50 to-fuchsia-50", border: "border-purple-200/40" },
              { icon: <TrendingUp className="h-5 w-5 text-fuchsia-500" />, title: "마진 분석", desc: "시나리오별 수익성 분석", gradient: "from-fuchsia-50 to-pink-50", border: "border-fuchsia-200/40" },
              { icon: <CalendarCheck className="h-5 w-5 text-rose-500" />, title: "주간 리뷰", desc: "주간 성과 리뷰 & 전략", gradient: "from-rose-50 to-pink-50", border: "border-rose-200/40" },
            ].map(item => (
              <div key={item.title} className={`bg-gradient-to-br ${item.gradient} p-4 rounded-2xl border ${item.border} transition-all hover:shadow-md hover:-translate-y-0.5`}>
                <div className="flex items-center gap-2 mb-1.5">
                  {item.icon}
                  <p className="font-semibold text-sm">{item.title}</p>
                </div>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>

          {/* Contact */}
          <Card className="pretty-card border-pink-100/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Mail className="h-4 w-4 text-pink-400" />
                <span className="gradient-text-soft">이용 문의</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-gradient-to-r from-pink-50 to-purple-50 rounded-xl p-4 border border-pink-100/50">
                <p className="text-sm text-muted-foreground">
                  시스템 이용 승인 또는 문의사항이 있으시면 관리자에게 연락해주세요.
                </p>
                <p className="mt-2 font-semibold text-pink-600 text-sm">
                  관리자 이메일: ipmachum@gmail.com
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Back to login */}
          <div className="pt-2">
            <Link href="/login">
              <Button
                variant="outline"
                className="w-full border-pink-200 text-pink-600 hover:bg-pink-50 rounded-xl py-5 font-medium transition-all hover:scale-[1.01]"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                로그인 페이지로 돌아가기
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
