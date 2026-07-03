import { useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useLocation } from "wouter";
import Products from "./Products";
import TestCandidates from "./TestCandidates";
import DailySourcing from "./DailySourcing";

const VALID = ["products", "candidates", "daily"] as const;

// 📌 내 소싱 — 관심 상품·테스트 후보·데일리 소싱을 탭 하나로 통합.
// 각 페이지를 embedded 모드로 재사용(레이아웃 중복 없음).
export default function MySourcing() {
  const [, setLocation] = useLocation();
  const initial = useMemo(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    return (VALID as readonly string[]).includes(t ?? "") ? (t as string) : "products";
  }, []);

  const onChange = (v: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", v);
    setLocation(`/my-sourcing?tab=${v}`);
  };

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold gradient-text">📌 내 소싱</h1>
          <p className="text-sm text-muted-foreground">관심 상품 · 테스트 후보 · 데일리 소싱을 한 곳에서 관리하세요</p>
        </div>
        <Tabs defaultValue={initial} onValueChange={onChange}>
          <TabsList>
            <TabsTrigger value="products">📦 관심 상품</TabsTrigger>
            <TabsTrigger value="candidates">🧪 테스트 후보</TabsTrigger>
            <TabsTrigger value="daily">📝 데일리 소싱</TabsTrigger>
          </TabsList>
          <TabsContent value="products" className="mt-4">
            <Products embedded />
          </TabsContent>
          <TabsContent value="candidates" className="mt-4">
            <TestCandidates embedded />
          </TabsContent>
          <TabsContent value="daily" className="mt-4">
            <DailySourcing embedded />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
