import { useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useLocation } from "wouter";
import { Pin } from "lucide-react";
import Products from "./Products";
import TestCandidates from "./TestCandidates";
import DailySourcing from "./DailySourcing";

const VALID = ["products", "candidates", "daily"] as const;

// 📌 내 소싱 — 관심 상품·테스트 후보·데일리 소싱을 탭 하나로 통합.
// .dark 스코프로 감싸 shadcn 컴포넌트 자동 다크 + cyber-stage 네온 배경.
export default function MySourcing() {
  const [, setLocation] = useLocation();
  const initial = useMemo(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    return (VALID as readonly string[]).includes(t ?? "") ? (t as string) : "products";
  }, []);

  const onChange = (v: string) => setLocation(`/my-sourcing?tab=${v}`);

  return (
    <DashboardLayout>
      <div className="dark cyber-stage p-6 sm:p-10">
        <div className="max-w-6xl mx-auto space-y-6">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest neon-chip neon-cyan px-3 py-1 rounded-full uppercase">
              <Pin className="h-3.5 w-3.5" /> My Sourcing
            </span>
            <h1 className="text-4xl font-black mt-4 neon-text">내 소싱</h1>
            <p className="text-slate-300/80 mt-2">관심 상품 · 테스트 후보 · 데일리 소싱을 한 곳에서 관리하세요</p>
          </div>

          <Tabs defaultValue={initial} onValueChange={onChange}>
            <TabsList className="bg-white/5 border border-white/10 rounded-xl p-1">
              <TabsTrigger value="products" className="data-[state=active]:bg-white/10 data-[state=active]:text-cyan-200 rounded-lg">📦 관심 상품</TabsTrigger>
              <TabsTrigger value="candidates" className="data-[state=active]:bg-white/10 data-[state=active]:text-cyan-200 rounded-lg">🧪 테스트 후보</TabsTrigger>
              <TabsTrigger value="daily" className="data-[state=active]:bg-white/10 data-[state=active]:text-cyan-200 rounded-lg">📝 데일리 소싱</TabsTrigger>
            </TabsList>
            <TabsContent value="products" className="mt-5">
              <Products embedded />
            </TabsContent>
            <TabsContent value="candidates" className="mt-5">
              <TestCandidates embedded />
            </TabsContent>
            <TabsContent value="daily" className="mt-5">
              <DailySourcing embedded />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </DashboardLayout>
  );
}
