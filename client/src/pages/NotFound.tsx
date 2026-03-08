import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Home, Sparkles, Heart } from "lucide-react";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { CHARACTERS } from "@/lib/characters";

export default function NotFound() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    document.body.classList.add('pastel-gradient-bg');
    return () => { document.body.classList.remove('pastel-gradient-bg'); };
  }, []);

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 relative">
      {/* Floating decorative elements */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[10%] left-[8%] w-32 h-32 rounded-full bg-pink-200/20 animate-float" style={{ animationDelay: '0s' }} />
        <div className="absolute top-[20%] right-[12%] w-24 h-24 rounded-full bg-purple-200/20 animate-float" style={{ animationDelay: '2s' }} />
        <div className="absolute bottom-[15%] left-[15%] w-20 h-20 rounded-full bg-fuchsia-200/20 animate-float" style={{ animationDelay: '4s' }} />
      </div>

      <Card className="w-full max-w-lg shadow-2xl shadow-pink-200/30 border-2 border-pink-100/60 bg-white/90 backdrop-blur-sm rounded-3xl overflow-hidden relative z-10">
        <div className="h-1.5 bg-gradient-to-r from-pink-400 via-fuchsia-400 to-purple-500" />
        <CardContent className="pt-10 pb-10 text-center space-y-6">
          {/* Character illustration */}
          <div className="flex justify-center">
            <div className="w-28 h-28 bg-gradient-to-br from-pink-50 to-purple-50 rounded-3xl p-5 shadow-inner border border-pink-100/40 animate-float">
              <img src={CHARACTERS.EMPTY_STATE} alt="404" className="w-full h-full object-contain drop-shadow-md" />
            </div>
          </div>

          {/* 404 text */}
          <div>
            <h1 className="text-6xl font-bold gradient-text">404</h1>
            <h2 className="text-xl font-semibold text-gray-600 mt-2 flex items-center justify-center gap-2">
              <Heart className="h-4 w-4 text-pink-400" />
              페이지를 찾을 수 없습니다
            </h2>
          </div>

          <p className="text-muted-foreground text-sm leading-relaxed max-w-sm mx-auto">
            찾으시는 페이지가 존재하지 않거나 이동되었을 수 있습니다.
            <br />
            홈으로 돌아가서 다시 시도해주세요!
          </p>

          <Button
            onClick={() => setLocation("/")}
            className="bg-gradient-to-r from-pink-500 via-fuchsia-500 to-purple-500 hover:from-pink-600 hover:via-fuchsia-600 hover:to-purple-600 text-white font-semibold px-8 py-5 rounded-xl shadow-lg shadow-pink-200/50 transition-all duration-300 hover:shadow-xl hover:scale-[1.02]"
          >
            <Home className="w-4 h-4 mr-2" />
            홈으로 돌아가기
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
