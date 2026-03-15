import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Download, Chrome, ChevronDown, ChevronUp, Search, Star,
  BarChart3, Calculator, Server, Rocket, Eye, Target,
  TrendingUp, Info, Sparkles, Bell, HelpCircle, BookOpen,
  Monitor, ArrowRight, CheckCircle2, MousePointerClick,
  Layers, Zap, Database, LineChart, Trash2, Activity, Filter,
  RefreshCw
} from "lucide-react";

const EXTENSION_VERSION = "8.5.0";
const EXTENSION_ZIP_URL = "/coupang-helper-extension-v8.5.0.zip";

// ===== 공통 컴포넌트 =====
function Section({ id, icon: Icon, title, children, defaultOpen = false }: {
  id: string; icon: React.ComponentType<any>; title: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card id={id} className="overflow-hidden border-l-4 border-l-indigo-400">
      <button className="w-full flex items-center gap-3 p-4 md:p-5 text-left hover:bg-gray-50/60 transition-colors" onClick={() => setOpen(!open)}>
        <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
          <Icon className="h-5 w-5 text-indigo-600" />
        </div>
        <span className="font-bold text-base flex-1">{title}</span>
        {open ? <ChevronUp className="h-5 w-5 text-gray-400" /> : <ChevronDown className="h-5 w-5 text-gray-400" />}
      </button>
      {open && <CardContent className="pt-0 pb-5 px-5 border-t">{children}</CardContent>}
    </Card>
  );
}

function StepCard({ num, title, desc, color = "bg-indigo-500" }: { num: number; title: string; desc: string; color?: string }) {
  return (
    <div className="flex gap-3 items-start">
      <div className={`w-8 h-8 rounded-full ${color} text-white flex items-center justify-center text-sm font-bold shrink-0 mt-0.5`}>{num}</div>
      <div>
        <div className="font-semibold text-sm">{title}</div>
        <div className="text-xs text-gray-500 mt-1 leading-relaxed">{desc}</div>
      </div>
    </div>
  );
}

function FeatureCard({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="bg-white border rounded-xl p-3 hover:shadow-md transition-shadow">
      <div className="text-2xl mb-1.5">{icon}</div>
      <div className="font-semibold text-xs">{title}</div>
      <div className="text-[10px] text-gray-400 mt-0.5 leading-relaxed">{desc}</div>
    </div>
  );
}

function Tip({ children, color = "blue" }: { children: React.ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    blue: "bg-blue-50 border-blue-200 text-blue-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    green: "bg-green-50 border-green-200 text-green-700",
    purple: "bg-purple-50 border-purple-200 text-purple-700",
    red: "bg-red-50 border-red-200 text-red-700",
  };
  return (
    <div className={`rounded-lg p-3 border text-xs leading-relaxed ${colors[color] || colors.blue}`}>
      <span className="font-bold mr-1">TIP</span> {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-xs border-b border-gray-100 last:border-0">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

// ===== 메인 컴포넌트 =====
export default function Manual() {
  const [jumpOpen, setJumpOpen] = useState(false);

  const toc = [
    { id: "install", label: "1. 설치 방법", icon: "📥" },
    { id: "overview", label: "2. 전체 구조", icon: "🗺️" },
    { id: "search-panel", label: "3. 검색 결과 패널", icon: "📊" },
    { id: "sidepanel", label: "4. 사이드패널", icon: "📋" },
    { id: "competition", label: "5. 경쟁도 분석", icon: "🏆" },
    { id: "sourcing-score", label: "6. 소싱 점수", icon: "⭐" },
    { id: "candidates", label: "7. 소싱 후보 관리", icon: "💼" },
    { id: "ranking", label: "8. 순위 추적", icon: "📈" },
    { id: "detail", label: "9. 상세 페이지 파싱", icon: "🔍" },
    { id: "margin", label: "10. 마진 계산기", icon: "🧮" },
    { id: "1688", label: "11. 1688 소싱처 연결", icon: "🇨🇳" },
    { id: "server", label: "12. 서버 연동", icon: "☁️" },
    { id: "demand", label: "13. 검색 수요 추정", icon: "📉" },
    { id: "dashboard", label: "14. 웹 대시보드", icon: "🖥️" },
    { id: "ai", label: "15. AI 리뷰 분석", icon: "🤖" },
    { id: "workflow", label: "16. 추천 워크플로우", icon: "🚀" },
    { id: "faq", label: "17. FAQ", icon: "❓" },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-4xl mx-auto">
        {/* ===== 히어로 ===== */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 text-white p-8 md:p-10">
          <div className="absolute top-0 right-0 w-72 h-72 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
          <div className="relative z-10">
            <Badge className="bg-white/20 text-white border-white/30 mb-3 text-xs">
              <BookOpen className="h-3 w-3 mr-1" /> 사용자 매뉴얼
            </Badge>
            <div className="flex items-center gap-3 mb-4">
              <span className="text-4xl">🐢</span>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold">소싱 헬퍼 매뉴얼</h1>
                <p className="text-white/80 text-sm mt-1">Coupang Sourcing Helper v{EXTENSION_VERSION} 완전 가이드</p>
              </div>
            </div>
            <p className="text-white/90 text-sm leading-relaxed max-w-2xl mb-6">
              쿠팡 검색 결과를 <strong>자동 분석</strong>하여 경쟁도, 소싱 점수, 1688 소싱처 연결, 마진 계산,
              <strong> 검색 수요 추정</strong>, <strong>AI 리뷰 분석</strong>까지 한번에 처리하는 크롬 확장프로그램의
              설치부터 활용까지 모든 것을 안내합니다.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <a href={EXTENSION_ZIP_URL} download>
                <Button className="bg-white text-indigo-700 hover:bg-white/90 font-bold shadow-lg gap-2">
                  <Download className="h-4 w-4" /> 다운로드 v{EXTENSION_VERSION}
                </Button>
              </a>
              <a href="/sourcing-helper-manual.pdf" download>
                <Button className="bg-white/20 text-white hover:bg-white/30 font-bold shadow-lg gap-2 border border-white/30">
                  <BookOpen className="h-4 w-4" /> PDF 매뉴얼 다운로드
                </Button>
              </a>
              <Badge className="bg-white/20 text-white border-white/30">
                <Chrome className="h-3 w-3 mr-1" /> Chrome 전용
              </Badge>
            </div>
          </div>
        </div>

        {/* ===== 빠른 이동 목차 ===== */}
        <Card className="border-indigo-100">
          <button className="w-full flex items-center justify-between p-4 hover:bg-gray-50/50" onClick={() => setJumpOpen(!jumpOpen)}>
            <span className="font-bold text-sm flex items-center gap-2"><Layers className="h-4 w-4 text-indigo-500" /> 목차 (빠른 이동)</span>
            {jumpOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {jumpOpen && (
            <CardContent className="pt-0 pb-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5">
                {toc.map(t => (
                  <a key={t.id} href={`#${t.id}`} className="text-xs py-1.5 px-2.5 rounded-lg hover:bg-indigo-50 transition-colors flex items-center gap-2 text-gray-600 hover:text-indigo-700">
                    <span>{t.icon}</span> {t.label}
                  </a>
                ))}
              </div>
            </CardContent>
          )}
        </Card>

        {/* ===== 주요 기능 요약 카드 ===== */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
          <FeatureCard icon="📊" title="경쟁도 분석" desc="검색 시 자동 점수 산출" />
          <FeatureCard icon="⭐" title="소싱 점수" desc="A~F 등급 자동 평가" />
          <FeatureCard icon="🇨🇳" title="1688 연결" desc="한국어 → 1688 자동 검색" />
          <FeatureCard icon="🧮" title="마진 계산" desc="원가→수익 실시간 계산" />
          <FeatureCard icon="📈" title="순위 추적" desc="키워드별 순위 모니터링" />
          <FeatureCard icon="📉" title="검색 수요" desc="리뷰 증가·판매 추정" />
          <FeatureCard icon="☁️" title="서버 동기화" desc="데이터 영구 보관" />
          <FeatureCard icon="🤖" title="AI 분석" desc="GPT 기반 시장 인사이트" />
        </div>

        {/* ===== 각 섹션 ===== */}
        <div className="space-y-4">

          {/* 1. 설치 방법 */}
          <Section id="install" icon={Download} title="1. 설치 방법" defaultOpen>
            <div className="space-y-4 mt-4">
              <StepCard num={1} title="ZIP 파일 다운로드" desc="이 페이지 상단 또는 '확장프로그램' 페이지에서 다운로드 버튼을 클릭합니다." color="bg-blue-500" />
              <StepCard num={2} title="압축 해제" desc="다운로드한 coupang-helper-extension-v8.5.0.zip의 압축을 풀어줍니다. (폴더 안에 manifest.json 파일이 있어야 합니다)" color="bg-blue-500" />
              <StepCard num={3} title="Chrome 확장프로그램 페이지" desc="Chrome 주소창에 chrome://extensions 입력 후 Enter를 누릅니다." color="bg-blue-500" />
              <StepCard num={4} title="개발자 모드 ON" desc="우측 상단의 '개발자 모드' 토글을 활성화합니다." color="bg-blue-500" />
              <StepCard num={5} title="압축해제된 확장 프로그램 로드" desc="좌측 상단 '압축해제된 확장 프로그램을 로드합니다' 클릭 → 압축 해제한 폴더를 선택합니다." color="bg-blue-500" />
              <StepCard num={6} title="완료! 쿠팡에서 사용" desc="쿠팡(coupang.com)에 접속하여 검색하면 자동으로 분석이 시작됩니다." color="bg-green-500" />

              <Tip color="amber">
                Chrome 도구 모음의 퍼즐 아이콘(🧩) 옆 📌 핀 버튼을 클릭하면 항상 표시됩니다. 확장프로그램 아이콘을 클릭하면 사이드패널이 열립니다.
              </Tip>

              <div className="bg-gray-50 rounded-xl p-4">
                <h4 className="font-bold text-sm mb-2 flex items-center gap-2"><RefreshCw className="h-4 w-4 text-orange-500" /> 업데이트 방법</h4>
                <ol className="space-y-1 text-xs text-gray-600">
                  <li>1. 새 ZIP 파일 다운로드 → 압축 해제</li>
                  <li>2. chrome://extensions → 기존 확장 프로그램의 <strong>새로고침(🔄) 버튼</strong> 클릭</li>
                  <li>3. 또는 기존 확장 제거 후 새 폴더로 다시 로드</li>
                </ol>
              </div>
            </div>
          </Section>

          {/* 2. 전체 구조 */}
          <Section id="overview" icon={Layers} title="2. 전체 구조 한눈에 보기">
            <div className="mt-4 space-y-4">
              <p className="text-sm text-gray-600">소싱 헬퍼는 <strong>3가지 인터페이스</strong>로 구성됩니다:</p>

              <div className="grid gap-3">
                <div className="border rounded-xl p-4 bg-gradient-to-r from-indigo-50 to-white">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500 text-white flex items-center justify-center text-sm font-bold">1</div>
                    <h4 className="font-bold text-sm">검색 결과 패널 (자동)</h4>
                  </div>
                  <p className="text-xs text-gray-500">쿠팡에서 검색하면 <strong>오른쪽에 자동 표시</strong>되는 플로팅 패널. 시장 개요(상품수, 평균가, 리뷰, 경쟁도)와 미니차트, TOP 3 상품을 보여줍니다.</p>
                </div>
                <div className="border rounded-xl p-4 bg-gradient-to-r from-purple-50 to-white">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-purple-500 text-white flex items-center justify-center text-sm font-bold">2</div>
                    <h4 className="font-bold text-sm">사이드패널 (수동)</h4>
                  </div>
                  <p className="text-xs text-gray-500">확장프로그램 아이콘 클릭 시 오른쪽에 열리는 상세 패널. <strong>분석, 후보, 순위, 상세, 마진, 서버, WING</strong> 등 전체 기능이 여기에 있습니다.</p>
                </div>
                <div className="border rounded-xl p-4 bg-gradient-to-r from-pink-50 to-white">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-pink-500 text-white flex items-center justify-center text-sm font-bold">3</div>
                    <h4 className="font-bold text-sm">웹 대시보드 (lumiriz.kr)</h4>
                  </div>
                  <p className="text-xs text-gray-500">서버에 로그인하면 <strong>lumiriz.kr/extension</strong>에서 검색 통계, 키워드 트렌드, 수요 추정, 후보 관리, 순위 이력, AI 분석 등을 <strong>PC/모바일</strong>에서 확인할 수 있습니다.</p>
                </div>
              </div>

              <div className="bg-indigo-50 rounded-xl p-4 text-center text-xs text-indigo-700">
                <strong>데이터 흐름:</strong> 쿠팡 검색 → 확장프로그램이 파싱 → 서버에 자동 전송 → 대시보드에서 확인/관리
              </div>
            </div>
          </Section>

          {/* 3. 검색 결과 패널 */}
          <Section id="search-panel" icon={Monitor} title="3. 검색 결과 패널 (자동 플로팅)">
            <div className="mt-4 space-y-4">
              <p className="text-sm text-gray-600">
                쿠팡에서 키워드를 검색하면 <strong>화면 오른쪽</strong>에 자동으로 분석 패널이 나타납니다.
              </p>

              <h4 className="font-bold text-sm">패널에 표시되는 정보</h4>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { icon: "📦", label: "상품수", desc: "검색된 상품 총 개수" },
                  { icon: "💰", label: "평균 가격", desc: "상위 36개 상품의 평균 판매가" },
                  { icon: "⭐", label: "평균 평점", desc: "상품 평균 별점 (5점 만점)" },
                  { icon: "💬", label: "평균 리뷰", desc: "상품당 평균 리뷰 수" },
                  { icon: "📢", label: "광고 비율", desc: "광고 상품의 비율 (%)" },
                  { icon: "🚀", label: "로켓배송", desc: "로켓배송 상품 비율" },
                  { icon: "🏆", label: "경쟁 강도", desc: "종합 경쟁도 점수 (0~100)" },
                  { icon: "📊", label: "미니 차트", desc: "가격/리뷰 분포 히스토그램" },
                ].map((item, i) => (
                  <div key={i} className="text-xs bg-gray-50 rounded-lg px-3 py-2 flex items-center gap-2">
                    <span>{item.icon}</span>
                    <div>
                      <strong>{item.label}</strong>
                      <span className="text-gray-400 ml-1">{item.desc}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-gray-50 rounded-xl p-4">
                <h4 className="font-bold text-sm mb-2">TOP 3 상품</h4>
                <p className="text-xs text-gray-500">
                  소싱 점수가 가장 높은 상위 3개 상품이 표시됩니다. 각 상품에는:
                </p>
                <ul className="mt-2 space-y-1 text-xs text-gray-600">
                  <li>• <strong>1688 검색</strong> 버튼 — 1688에서 유사 중국 소싱처 바로 검색</li>
                  <li>• <strong>AliExpress 검색</strong> 버튼 — AliExpress에서 검색</li>
                  <li>• <strong>후보 저장(⭐)</strong> 버튼 — 소싱 후보로 저장</li>
                </ul>
              </div>

              <Tip>
                패널은 드래그로 이동 가능하며, 헤더의 − 버튼으로 접을 수 있습니다. 최소화 상태에서 클릭하면 다시 펼쳐집니다.
              </Tip>
            </div>
          </Section>

          {/* 4. 사이드패널 */}
          <Section id="sidepanel" icon={BarChart3} title="4. 사이드패널 상세 기능">
            <div className="mt-4 space-y-4">
              <p className="text-sm text-gray-600">
                확장프로그램 아이콘을 클릭하면 열리는 사이드패널에는 다음 탭이 있습니다:
              </p>
              <div className="space-y-2">
                {[
                  { tab: "분석", icon: "📊", desc: "검색 결과의 전체 상품 목록 + 소싱 점수 + 필터/정렬" },
                  { tab: "후보", icon: "⭐", desc: "저장한 소싱 후보 목록 관리 (삭제, 1688 검색)" },
                  { tab: "순위", icon: "📈", desc: "키워드 순위 추적 등록 및 순위 확인" },
                  { tab: "상세", icon: "🔍", desc: "상품 상세 페이지 파싱 결과 (가격/리뷰 변동)" },
                  { tab: "마진", icon: "🧮", desc: "1688 원가 → 쿠팡 판매가 마진율 계산" },
                  { tab: "서버", icon: "☁️", desc: "lumiriz.kr 로그인 및 동기화 상태 확인" },
                  { tab: "기록", icon: "📝", desc: "로컬 검색 이력 조회" },
                  { tab: "WING", icon: "🦅", desc: "쿠팡 WING 셀러센터 인기상품 데이터" },
                ].map((t, i) => (
                  <div key={i} className="flex items-center gap-3 bg-gray-50 rounded-lg p-3">
                    <span className="text-xl">{t.icon}</span>
                    <div>
                      <span className="font-bold text-sm">{t.tab} 탭</span>
                      <span className="text-xs text-gray-500 ml-2">{t.desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Section>

          {/* 5. 경쟁도 분석 */}
          <Section id="competition" icon={Target} title="5. 경쟁도 분석 (Competition Score)">
            <div className="mt-4 space-y-4">
              <p className="text-sm text-gray-600">
                검색 결과의 상위 <strong>36개 상품</strong>을 분석하여 해당 키워드의 경쟁 강도를 0~100점으로 자동 산출합니다.
              </p>

              <h4 className="font-bold text-sm">산출 기준</h4>
              <div className="overflow-hidden rounded-lg border text-xs">
                <table className="w-full">
                  <thead className="bg-gray-50"><tr><th className="px-3 py-2 text-left">요소</th><th className="px-3 py-2 text-left">기준</th><th className="px-3 py-2 text-right">점수</th></tr></thead>
                  <tbody className="divide-y">
                    <tr><td className="px-3 py-2">평균 리뷰수</td><td className="px-3 py-2 text-gray-500">1000+ / 500+ / 100+ / 30+</td><td className="px-3 py-2 text-right">40 / 30 / 20 / 10</td></tr>
                    <tr><td className="px-3 py-2">리뷰100+ 비율</td><td className="px-3 py-2 text-gray-500">60%+ / 40%+ / 20%+</td><td className="px-3 py-2 text-right">25 / 15 / 8</td></tr>
                    <tr><td className="px-3 py-2">평균 평점</td><td className="px-3 py-2 text-gray-500">4.5+ / 4.0+</td><td className="px-3 py-2 text-right">15 / 8</td></tr>
                    <tr><td className="px-3 py-2">광고 비율</td><td className="px-3 py-2 text-gray-500">30%+ / 15%+</td><td className="px-3 py-2 text-right">20 / 10</td></tr>
                  </tbody>
                </table>
              </div>

              <h4 className="font-bold text-sm">판정 기준</h4>
              <div className="flex flex-wrap gap-2">
                <Badge className="bg-green-100 text-green-700 hover:bg-green-100">0~44 약함 — 소싱 기회!</Badge>
                <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">45~69 보통 — 진입 가능</Badge>
                <Badge className="bg-red-100 text-red-700 hover:bg-red-100">70~100 강함 — 차별화 필요</Badge>
              </div>

              <Tip color="green">
                경쟁도가 <strong>45 이하</strong>인 키워드가 신규 셀러에게 가장 유리합니다. 검색 수요 탭에서 경쟁도+수요를 함께 비교하세요.
              </Tip>
            </div>
          </Section>

          {/* 6. 소싱 점수 */}
          <Section id="sourcing-score" icon={Star} title="6. 소싱 점수 (Sourcing Score A~F)">
            <div className="mt-4 space-y-4">
              <p className="text-sm text-gray-600">
                각 <strong>개별 상품</strong>의 소싱 난이도를 0~100점으로 평가합니다. 경쟁도가 키워드 전체를 보는 것이라면, 소싱 점수는 개별 상품 단위입니다.
              </p>

              <h4 className="font-bold text-sm">산출 기준</h4>
              <div className="overflow-hidden rounded-lg border text-xs">
                <table className="w-full">
                  <thead className="bg-gray-50"><tr><th className="px-3 py-2 text-left">요소</th><th className="px-3 py-2 text-left">좋은 조건</th><th className="px-3 py-2 text-left">나쁜 조건</th></tr></thead>
                  <tbody className="divide-y">
                    <tr><td className="px-3 py-2 font-medium">리뷰 수</td><td className="px-3 py-2 text-green-600">리뷰 0개 → +25점</td><td className="px-3 py-2 text-red-600">1000+ → -25점</td></tr>
                    <tr><td className="px-3 py-2 font-medium">평점</td><td className="px-3 py-2 text-green-600">3.5 미만 → +10점</td><td className="px-3 py-2 text-red-600">4.5+ → -5점</td></tr>
                    <tr><td className="px-3 py-2 font-medium">가격 비율</td><td className="px-3 py-2 text-green-600">평균가 130%+ → +15점</td><td className="px-3 py-2 text-red-600">평균가 70%- → -10점</td></tr>
                    <tr><td className="px-3 py-2 font-medium">광고</td><td className="px-3 py-2 text-green-600">비광고 → 0</td><td className="px-3 py-2 text-red-600">광고 상품 → -10점</td></tr>
                    <tr><td className="px-3 py-2 font-medium">로켓배송</td><td className="px-3 py-2 text-green-600">비로켓 → 0</td><td className="px-3 py-2 text-red-600">로켓 → -5점</td></tr>
                  </tbody>
                </table>
              </div>

              <h4 className="font-bold text-sm">등급표</h4>
              <div className="space-y-1.5">
                {[
                  { grade: "A (80+)", desc: "매우 좋음 — 소싱 강력 추천", cls: "bg-green-100 text-green-700" },
                  { grade: "B (65+)", desc: "좋음 — 소싱 추천", cls: "bg-blue-100 text-blue-700" },
                  { grade: "C (50+)", desc: "보통 — 추가 검토 필요", cls: "bg-gray-100 text-gray-700" },
                  { grade: "D (35+)", desc: "어려움 — 신중히 판단", cls: "bg-amber-100 text-amber-700" },
                  { grade: "F (<35)", desc: "매우 어려움 — 비추천", cls: "bg-red-100 text-red-700" },
                ].map((g, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded ${g.cls}`}>{g.grade}</span>
                    <span className="text-xs text-gray-500">{g.desc}</span>
                  </div>
                ))}
              </div>

              <Tip>
                소싱 점수는 <strong>리뷰가 적고, 평점이 낮고, 가격이 평균보다 높은 상품</strong>일수록 높습니다. = 기존 셀러가 잘 못 팔고 있어서 새로 진입할 기회가 있다는 뜻입니다.
              </Tip>
            </div>
          </Section>

          {/* 7. 소싱 후보 */}
          <Section id="candidates" icon={Star} title="7. 소싱 후보 관리">
            <div className="mt-4 space-y-4">
              <p className="text-sm text-gray-600">소싱 가능성이 높은 상품을 ⭐ 저장하고 관리합니다.</p>
              <StepCard num={1} title="후보 저장" desc="분석 탭, 플로팅 패널, 상세 탭에서 ⭐ 버튼을 클릭하면 후보로 저장됩니다." />
              <StepCard num={2} title="후보 확인" desc="사이드패널 '후보' 탭에서 전체 목록을 확인합니다. (최대 500개)" />
              <StepCard num={3} title="1688 소싱처 찾기" desc="각 후보의 '🔍 1688' 버튼으로 중국 소싱처를 검색합니다." />
              <StepCard num={4} title="불필요한 후보 삭제" desc="🗑️ 버튼으로 필요 없는 후보를 정리합니다." />

              <Tip color="purple">
                서버에 로그인하면 후보 목록이 <strong>서버에 자동 동기화</strong>됩니다. lumiriz.kr 대시보드에서도 관리할 수 있고, 대시보드에서 <strong>'상품으로 등록'</strong> 버튼으로 정식 소싱 상품으로 승격시킬 수 있습니다.
              </Tip>
            </div>
          </Section>

          {/* 8. 순위 추적 */}
          <Section id="ranking" icon={TrendingUp} title="8. 순위 추적 (Rank Tracking)">
            <div className="mt-4 space-y-4">
              <p className="text-sm text-gray-600">
                특정 키워드에서 내 상품(또는 경쟁 상품)의 순위 변화를 자동으로 추적합니다.
              </p>
              <StepCard num={1} title="키워드 등록" desc="사이드패널 '순위' 탭에서 추적할 검색 키워드를 입력합니다. 타겟 상품 ID를 입력하면 해당 상품의 순위를 강조 표시합니다." />
              <StepCard num={2} title="자동 기록" desc="등록된 키워드를 쿠팡에서 검색할 때마다 자동으로 순위가 기록됩니다. 또한 6시간마다 자동으로 수집합니다." />
              <StepCard num={3} title="순위 확인" desc="'📊 보기' 버튼으로 최신 순위를 확인합니다. 타겟 상품은 보라색으로 강조됩니다." />

              <Tip>
                분석 탭에서 상품 옆의 📈 버튼을 누르면 해당 키워드 + 상품 ID로 바로 순위 추적을 등록할 수 있습니다.
              </Tip>

              <div className="bg-gray-50 rounded-xl p-4">
                <h4 className="font-bold text-sm mb-2">순위 변동 알림</h4>
                <p className="text-xs text-gray-500">순위가 3위 이상 변동하면 Chrome 알림이 자동으로 생성됩니다. 대시보드 알림 탭에서도 확인할 수 있습니다.</p>
              </div>
            </div>
          </Section>

          {/* 9. 상세 페이지 파싱 */}
          <Section id="detail" icon={Eye} title="9. 상세 페이지 자동 파싱">
            <div className="mt-4 space-y-4">
              <p className="text-sm text-gray-600">
                쿠팡 상품 상세 페이지(예: coupang.com/vp/products/12345)를 열면 <strong>자동으로 파싱</strong>합니다.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {["상품명/이미지", "판매가/정가/할인율", "평점/리뷰수", "구매건수", "판매자명", "카테고리 경로", "로켓배송 여부", "무료배송 여부", "옵션 수"].map((item, i) => (
                  <div key={i} className="text-xs bg-gray-50 rounded-lg px-3 py-2 flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" /> {item}
                  </div>
                ))}
              </div>

              <Tip color="purple">
                같은 상품을 여러 번 방문하면 <strong>가격/리뷰 변동 이력</strong>이 자동으로 기록됩니다. 사이드패널 '상세' 탭에서 시간순으로 확인할 수 있습니다.
              </Tip>
            </div>
          </Section>

          {/* 10. 마진 계산기 */}
          <Section id="margin" icon={Calculator} title="10. 마진 계산기">
            <div className="mt-4 space-y-4">
              <p className="text-sm text-gray-600">
                1688 원가(CNY)에서 쿠팡 판매가(KRW)까지의 <strong>예상 순이익과 마진율</strong>을 실시간으로 계산합니다.
              </p>

              <div className="overflow-hidden rounded-lg border text-xs">
                <table className="w-full">
                  <thead className="bg-gray-50"><tr><th className="px-3 py-2 text-left">입력 항목</th><th className="px-3 py-2 text-left">설명</th><th className="px-3 py-2 text-right">기본값</th></tr></thead>
                  <tbody className="divide-y">
                    <tr><td className="px-3 py-2">1688 원가</td><td className="px-3 py-2 text-gray-500">상품 원가 (위안, CNY)</td><td className="px-3 py-2 text-right">-</td></tr>
                    <tr><td className="px-3 py-2">환율</td><td className="px-3 py-2 text-gray-500">CNY → KRW 환율</td><td className="px-3 py-2 text-right">190</td></tr>
                    <tr><td className="px-3 py-2">국제배송비</td><td className="px-3 py-2 text-gray-500">1건당 배송비 (원)</td><td className="px-3 py-2 text-right">3,000원</td></tr>
                    <tr><td className="px-3 py-2">관부가세율</td><td className="px-3 py-2 text-gray-500">수입 관세+부가세</td><td className="px-3 py-2 text-right">10%</td></tr>
                    <tr><td className="px-3 py-2">쿠팡 판매가</td><td className="px-3 py-2 text-gray-500">예상 판매가 (원)</td><td className="px-3 py-2 text-right">-</td></tr>
                    <tr><td className="px-3 py-2">쿠팡 수수료</td><td className="px-3 py-2 text-gray-500">카테고리별 판매 수수료</td><td className="px-3 py-2 text-right">10.8%</td></tr>
                  </tbody>
                </table>
              </div>

              <div className="bg-gray-50 rounded-xl p-4 text-xs text-center">
                <strong>계산식:</strong> 순이익 = 판매가 - (원가×환율 + 배송비 + 관부가세) - (판매가 × 수수료율)
                <br />결과가 <span className="text-green-600 font-bold">초록색</span>이면 이익, <span className="text-red-600 font-bold">빨간색</span>이면 손해
              </div>
            </div>
          </Section>

          {/* 11. 1688 소싱처 연결 */}
          <Section id="1688" icon={Search} title="11. 1688 소싱처 연결">
            <div className="mt-4 space-y-4">
              <p className="text-sm text-gray-600">
                쿠팡 상품 제목에서 키워드를 자동 추출하여 <strong>1688.com</strong>에서 유사 중국 소싱처를 검색합니다.
              </p>

              <h4 className="font-bold text-sm">연결 방식 (v5.5.7+)</h4>
              <div className="space-y-2">
                <div className="text-xs bg-orange-50 rounded-lg p-3 flex items-start gap-2">
                  <span className="text-orange-500 font-bold shrink-0">1688</span>
                  <div><strong>한국어 직접 전달</strong> — 쿠팡 제목을 그대로 1688에 전달합니다. 1688이 한국어를 자동 분석/번역해줍니다. (번역 로직 완전 제거)</div>
                </div>
                <div className="text-xs bg-blue-50 rounded-lg p-3 flex items-start gap-2">
                  <span className="text-blue-500 font-bold shrink-0">Ali</span>
                  <div><strong>AliExpress 검색</strong> — 한국어 키워드로 AliExpress를 검색합니다.</div>
                </div>
                <div className="text-xs bg-purple-50 rounded-lg p-3 flex items-start gap-2">
                  <span className="text-purple-500 font-bold shrink-0">CN</span>
                  <div><strong>CNINSIDER 연동</strong> — 1688 공식 한국 파트너 사이트에서 검색합니다.</div>
                </div>
              </div>

              <Tip color="amber">
                플로팅 패널의 TOP 3 상품, 사이드패널 분석 탭의 각 상품, 후보 탭의 각 후보에서 모두 1688 버튼을 사용할 수 있습니다.
              </Tip>
            </div>
          </Section>

          {/* 12. 서버 연동 */}
          <Section id="server" icon={Server} title="12. 서버 연동 (lumiriz.kr)">
            <div className="mt-4 space-y-4">
              <p className="text-sm text-gray-600">
                사이드패널 <strong>'서버' 탭</strong>에서 lumiriz.kr 계정으로 로그인하면 모든 데이터가 자동으로 서버에 동기화됩니다.
              </p>

              <StepCard num={1} title="서버 탭 열기" desc="사이드패널에서 '서버' 탭(☁️)을 클릭합니다." />
              <StepCard num={2} title="로그인" desc="lumiriz.kr 이메일과 비밀번호를 입력하고 로그인합니다." />
              <StepCard num={3} title="자동 동기화 시작" desc="로그인하면 이후 모든 검색, 후보 저장, 순위 추적이 자동으로 서버에 전송됩니다." />

              <h4 className="font-bold text-sm">동기화되는 데이터</h4>
              <div className="grid grid-cols-2 gap-2">
                {[
                  "검색 스냅샷 (검색어+통계+상품목록)",
                  "소싱 후보 목록",
                  "순위 추적 데이터",
                  "상품 상세 가격/리뷰 이력",
                  "WING 인기상품 데이터",
                  "키워드별 일별 통계 (자동 계산)",
                ].map((item, i) => (
                  <div key={i} className="text-xs bg-green-50 rounded-lg px-3 py-2 flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" /> {item}
                  </div>
                ))}
              </div>

              <Tip color="green">
                서버에 로그인한 상태에서 쿠팡 검색을 하면, 스냅샷 저장 → <strong>키워드별 일별 통계가 자동으로 생성</strong>됩니다. 대시보드에서 일별 추이를 확인할 수 있습니다.
              </Tip>
            </div>
          </Section>

          {/* 13. 검색 수요 추정 */}
          <Section id="demand" icon={Activity} title="13. 검색 수요 추정 (v5.6.0 신기능)">
            <div className="mt-4 space-y-4">
              <p className="text-sm text-gray-600">
                키워드별 <strong>일별 통계</strong>를 자동 축적하여 수요 점수, 판매 추정, 리뷰 증가량 등을 계산합니다.
              </p>

              <h4 className="font-bold text-sm">자동 축적 원리</h4>
              <div className="bg-indigo-50 rounded-xl p-4 text-xs space-y-1">
                <p>1. 쿠팡에서 검색 → 확장프로그램이 파싱 → 서버에 스냅샷 저장</p>
                <p>2. 스냅샷 저장 시 <strong>autoComputeKeywordDailyStat()</strong> 자동 실행</p>
                <p>3. ext_keyword_daily_stats 테이블에 일별 통계 누적</p>
                <p>4. 이전 데이터와 비교하여 리뷰 증가량, 가격 변동, 경쟁도 변화 자동 계산</p>
              </div>

              <h4 className="font-bold text-sm">산출되는 지표</h4>
              <div className="overflow-hidden rounded-lg border text-xs">
                <table className="w-full">
                  <thead className="bg-gray-50"><tr><th className="px-3 py-2 text-left">지표</th><th className="px-3 py-2 text-left">설명</th><th className="px-3 py-2 text-left">계산식</th></tr></thead>
                  <tbody className="divide-y">
                    <tr><td className="px-3 py-2 font-medium">리뷰 증가량</td><td className="px-3 py-2 text-gray-500">전일 대비 리뷰 총합 증가</td><td className="px-3 py-2 text-gray-400">오늘 totalReviewSum - 어제</td></tr>
                    <tr><td className="px-3 py-2 font-medium">판매 추정</td><td className="px-3 py-2 text-gray-500">리뷰 증가 기반 판매량 추정</td><td className="px-3 py-2 text-gray-400">reviewGrowth × 20</td></tr>
                    <tr><td className="px-3 py-2 font-medium">수요 점수</td><td className="px-3 py-2 text-gray-500">0~100, 판매추정 기반</td><td className="px-3 py-2 text-gray-400">salesEstimate 기반 구간</td></tr>
                    <tr><td className="px-3 py-2 font-medium">키워드 점수</td><td className="px-3 py-2 text-gray-500">종합 소싱 적합도</td><td className="px-3 py-2 text-gray-400">리뷰증가×0.5 + 가성비×0.3 + 비광고×0.2</td></tr>
                    <tr><td className="px-3 py-2 font-medium">가격 변동</td><td className="px-3 py-2 text-gray-500">전일 대비 평균가 변화</td><td className="px-3 py-2 text-gray-400">오늘 avgPrice - 어제</td></tr>
                  </tbody>
                </table>
              </div>

              <Tip color="green">
                매일 같은 키워드를 꾸준히 검색하면 데이터가 쌓여 <strong>일별 추이 그래프</strong>를 볼 수 있습니다. 대시보드의 "검색 수요" 탭에서 확인하세요.
              </Tip>
            </div>
          </Section>

          {/* 14. 웹 대시보드 */}
          <Section id="dashboard" icon={Monitor} title="14. 웹 대시보드 (lumiriz.kr/extension)">
            <div className="mt-4 space-y-4">
              <p className="text-sm text-gray-600">
                lumiriz.kr에 로그인 후 <strong>헬퍼 대시보드</strong> (좌측 메뉴 📊)에서 모든 수집 데이터를 확인/관리합니다.
              </p>

              <h4 className="font-bold text-sm">대시보드 탭 구성</h4>
              <div className="space-y-2">
                {[
                  { tab: "개요", desc: "전체 요약: 검색 횟수, 후보 수, TOP 키워드, 검색 수요 TOP5, 최근 활동" },
                  { tab: "검색 수요", desc: "키워드별 통계 테이블 (점수/경쟁도/평균가/리뷰 증가), 일별 추이 그래프, 키워드 삭제" },
                  { tab: "트렌드", desc: "키워드별 시간순 변화 (상품수, 평균가, 경쟁도 그래프)" },
                  { tab: "소싱 후보", desc: "후보 목록 관리, 상태 필터, 상품 등록 승격" },
                  { tab: "순위 추적", desc: "키워드별 순위 테이블, 7/14/30일 이력 그래프" },
                  { tab: "경쟁자", desc: "경쟁자 모니터링: 새 진입자, 가격 변동, 리뷰 변화" },
                  { tab: "AI 추천", desc: "AI 기반 소싱 추천 전략" },
                  { tab: "리뷰 분석", desc: "GPT-4o AI 리뷰 분석 실행 및 결과 확인" },
                  { tab: "알림", desc: "순위 변동, 가격 변화 등 실시간 알림 목록" },
                  { tab: "WING", desc: "쿠팡 WING 셀러센터 인기상품 데이터" },
                  { tab: "검색기록", desc: "전체 검색 이력 시간순 조회" },
                ].map((t, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs bg-gray-50 rounded-lg p-2.5">
                    <Badge variant="outline" className="shrink-0 text-[10px]">{t.tab}</Badge>
                    <span className="text-gray-600">{t.desc}</span>
                  </div>
                ))}
              </div>

              <h4 className="font-bold text-sm">내보내기 기능</h4>
              <div className="flex gap-2">
                <Badge className="bg-green-100 text-green-700">CSV 내보내기</Badge>
                <Badge className="bg-red-100 text-red-700">PDF 보고서</Badge>
              </div>
              <p className="text-xs text-gray-500">대시보드 헤더의 버튼으로 전체 데이터를 CSV 또는 PDF로 내려받을 수 있습니다.</p>
            </div>
          </Section>

          {/* 15. AI 리뷰 분석 */}
          <Section id="ai" icon={Sparkles} title="15. AI 리뷰 분석 (GPT-4o-mini)">
            <div className="mt-4 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge className="bg-emerald-100 text-emerald-700 text-xs">OpenAI GPT-4o-mini</Badge>
                <Badge variant="outline" className="text-xs">자동 폴백: 규칙기반</Badge>
              </div>
              <p className="text-sm text-gray-600">
                검색 데이터를 기반으로 <strong>AI가 시장 분석</strong>을 자동으로 수행합니다.
              </p>

              <h4 className="font-bold text-sm">분석 결과 항목</h4>
              <div className="grid grid-cols-2 gap-2">
                {[
                  "고객 불만 (Pain Points)", "고객 니즈 분석",
                  "소싱 기회 도출", "긍정/부정 요소",
                  "가격 민감도 분석", "추천 액션 플랜",
                  "품질 우려사항", "시장 개요 통계",
                ].map((item, i) => (
                  <div key={i} className="text-xs bg-emerald-50 rounded-lg px-3 py-2 flex items-center gap-2">
                    <Sparkles className="h-3 w-3 text-emerald-500 shrink-0" /> {item}
                  </div>
                ))}
              </div>

              <Tip color="green">
                대시보드의 <strong>"리뷰 분석" 탭</strong>에서 키워드를 입력하고 "AI 분석 실행"을 클릭하세요. GPT가 상위 10개 상품 데이터를 분석합니다. API 장애 시 규칙 기반 분석으로 자동 대체됩니다.
              </Tip>
            </div>
          </Section>

          {/* 16. 추천 워크플로우 */}
          <Section id="workflow" icon={Rocket} title="16. 추천 소싱 워크플로우">
            <div className="mt-4">
              <div className="relative">
                {[
                  { num: 1, title: "키워드 검색", desc: "쿠팡에서 소싱할 키워드를 검색합니다. 플로팅 패널에서 시장 개요를 빠르게 확인.", color: "bg-indigo-500" },
                  { num: 2, title: "경쟁도 확인", desc: "경쟁 강도가 '약함(0~44)' 또는 '보통(45~69)'인지 확인. 70 이상이면 차별화 전략 필요.", color: "bg-blue-500" },
                  { num: 3, title: "소싱 점수 A~B 상품 선별", desc: "사이드패널 분석 탭에서 '소싱쉬운것' 필터 → 점수 높은 상품을 ⭐ 후보 저장.", color: "bg-green-500" },
                  { num: 4, title: "1688 소싱처 찾기", desc: "각 후보의 '🔍 1688' 버튼으로 중국 소싱처를 검색. CNINSIDER도 함께 활용.", color: "bg-orange-500" },
                  { num: 5, title: "마진 계산", desc: "마진 탭에서 1688 원가 → 쿠팡 판매가 예상 수익률 확인. 30% 이상이면 GO.", color: "bg-amber-500" },
                  { num: 6, title: "서버 로그인 → 데이터 축적", desc: "서버 탭에서 로그인. 이후 모든 검색이 자동 동기화되어 일별 통계 축적.", color: "bg-purple-500" },
                  { num: 7, title: "검색 수요 분석", desc: "대시보드 '검색 수요' 탭에서 키워드별 점수·수요·경쟁도 비교. 매일 검색하면 추이 확인 가능.", color: "bg-pink-500" },
                  { num: 8, title: "AI 리뷰 분석", desc: "대시보드에서 AI 분석 실행 → 고객 니즈/불만/기회 파악 → 맞춤 전략 수립.", color: "bg-emerald-500" },
                  { num: 9, title: "순위 추적 등록", desc: "판매 시작 후 키워드 순위 추적 등록 → 6시간마다 자동 모니터링.", color: "bg-cyan-500" },
                  { num: 10, title: "PDF 보고서", desc: "대시보드에서 PDF 보고서 다운로드하여 소싱 기록 정리.", color: "bg-gray-500" },
                ].map((step, i, arr) => (
                  <div key={i} className="flex gap-3 relative">
                    {i < arr.length - 1 && <div className="absolute left-4 top-9 w-0.5 h-[calc(100%-12px)] bg-gray-200" />}
                    <div className={`w-8 h-8 rounded-full ${step.color} text-white flex items-center justify-center text-xs font-bold shrink-0 z-10`}>{step.num}</div>
                    <div className="pb-4">
                      <div className="font-semibold text-sm">{step.title}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{step.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Section>

          {/* 17. FAQ */}
          <Section id="faq" icon={HelpCircle} title="17. 자주 묻는 질문 (FAQ)">
            <div className="mt-4 space-y-3">
              {[
                { q: "Chrome 웹 스토어에 없나요?", a: "아직 Chrome 웹 스토어에 출시되지 않았습니다. ZIP 파일을 다운로드한 후 '압축해제된 확장 프로그램 로드' 방식으로 설치해주세요." },
                { q: "쿠팡 이외의 사이트에서도 동작하나요?", a: "아니요. 쿠팡 검색 결과 페이지(coupang.com)와 상품 상세 페이지, WING 셀러센터(wing.coupang.com)에서만 동작합니다." },
                { q: "데이터는 어디에 저장되나요?", a: "서버 탭에서 로그인하면 lumiriz.kr 서버에 안전하게 저장됩니다. 로그인하지 않으면 브라우저 로컬 저장소에만 저장됩니다." },
                { q: "AI 분석에 비용이 드나요?", a: "무료입니다. OpenAI GPT-4o-mini 기반이며, API 장애 시 규칙 기반 분석으로 자동 대체됩니다." },
                { q: "업데이트는 어떻게 하나요?", a: "새 버전 ZIP을 다운로드 → chrome://extensions → 기존 확장 새로고침 버튼(🔄) 클릭, 또는 제거 후 새로 로드합니다." },
                { q: "여러 브라우저에서 사용 가능한가요?", a: "Chrome 전용입니다. 하지만 서버에 로그인하면 데이터가 동기화되므로, lumiriz.kr 대시보드는 어디서든 접속 가능합니다." },
                { q: "검색 수요 데이터가 안 쌓여요", a: "서버 탭에서 로그인 상태인지 확인하세요. 로그인 후 쿠팡에서 검색하면 자동으로 서버에 전송되고 일별 통계가 생성됩니다." },
                { q: "경쟁도와 소싱 점수의 차이는?", a: "경쟁도는 키워드 전체의 경쟁 수준(높을수록 어려움), 소싱 점수는 개별 상품의 소싱 적합도(높을수록 좋음)입니다." },
                { q: "쿠팡 SPA 전환 후 파싱이 안 돼요", a: "확장프로그램이 v5.5.3+ 이상인지 확인하세요. 쿠팡 React SPA 호환 파싱 엔진이 적용된 버전입니다." },
              ].map((faq, i) => (
                <div key={i} className="border rounded-lg p-3">
                  <div className="font-semibold text-sm flex items-start gap-2">
                    <span className="text-indigo-500 font-bold shrink-0">Q.</span> {faq.q}
                  </div>
                  <div className="text-xs text-gray-600 mt-2 leading-relaxed flex items-start gap-2">
                    <span className="text-emerald-500 font-bold shrink-0">A.</span> {faq.a}
                  </div>
                </div>
              ))}
            </div>
          </Section>

        </div>

        {/* ===== 하단 CTA ===== */}
        <Card className="border-indigo-200 bg-gradient-to-r from-indigo-50 to-purple-50">
          <CardContent className="py-6 flex flex-col md:flex-row items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-lg">지금 바로 시작하세요!</h3>
              <p className="text-sm text-gray-500 mt-1">쿠팡 소싱을 더 스마트하게. 소싱 헬퍼 v{EXTENSION_VERSION}</p>
            </div>
            <div className="flex gap-3">
              <a href={EXTENSION_ZIP_URL} download>
                <Button size="lg" className="bg-indigo-600 hover:bg-indigo-700 gap-2 shadow-lg">
                  <Download className="h-5 w-5" /> 다운로드
                </Button>
              </a>
              <a href="/sourcing-helper-manual.pdf" download>
                <Button size="lg" variant="outline" className="gap-2">
                  <BookOpen className="h-5 w-5" /> PDF 매뉴얼
                </Button>
              </a>
              <a href="/extension">
                <Button size="lg" variant="outline" className="gap-2">
                  <BarChart3 className="h-5 w-5" /> 대시보드
                </Button>
              </a>
            </div>
          </CardContent>
        </Card>

        <div className="text-center text-xs text-gray-400 pb-4">
          Coupang Sourcing Helper v{EXTENSION_VERSION} Manual · lumiriz.kr
        </div>
      </div>
    </DashboardLayout>
  );
}
