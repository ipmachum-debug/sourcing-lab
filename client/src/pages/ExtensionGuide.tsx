import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Download, Chrome, ChevronDown, ChevronUp,
  Search, Star, BarChart3, ShoppingBag, Calculator,
  Server, Rocket, Eye, Trash2, Filter, ArrowUpDown,
  MonitorSmartphone, Target, TrendingUp, Info,
  Sparkles, Brain, Bell, HelpCircle, Clock,
  Zap, LineChart, DollarSign, Package, Globe,
  Gem, Activity, FileText, Settings, Shield,
} from "lucide-react";

const EXTENSION_VERSION = "8.5.0";
const EXTENSION_ZIP_URL = `/coupang-helper-extension-v${EXTENSION_VERSION}.zip`;
const EXTENSION_FILE_SIZE = "184KB";

function AccordionSection({
  icon: Icon,
  title,
  badge,
  defaultOpen = false,
  children,
}: {
  icon: React.ComponentType<any>;
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <Card className="overflow-hidden">
      <button
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-50/50 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <Icon className="h-5 w-5 text-indigo-500 shrink-0" />
        <span className="font-semibold text-sm flex-1">{title}</span>
        {badge && (
          <Badge className="bg-green-100 text-green-700 text-[10px] mr-1">{badge}</Badge>
        )}
        {isOpen ? (
          <ChevronUp className="h-4 w-4 text-gray-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-gray-400" />
        )}
      </button>
      {isOpen && (
        <CardContent className="pt-0 pb-4 px-4 border-t">
          {children}
        </CardContent>
      )}
    </Card>
  );
}

function Step({ num, title, desc }: { num: number; title: string; desc: string }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="w-7 h-7 rounded-full bg-indigo-500 text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
        {num}
      </div>
      <div>
        <div className="font-semibold text-sm">{title}</div>
        <div className="text-xs text-gray-500 mt-0.5 leading-relaxed">{desc}</div>
      </div>
    </div>
  );
}

function GradeBadge({ grade, label, className }: { grade: string; label: string; className: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded ${className}`}>{grade}</span>
      <span className="text-xs text-gray-500">{label}</span>
    </div>
  );
}

export default function ExtensionGuide() {
  return (
    <DashboardLayout>
      <div className="space-y-4 max-w-4xl mx-auto">
        {/* 히어로 섹션 */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 text-white p-8 md:p-10">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-40 h-40 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-4xl">🐢</span>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold">소싱 헬퍼 v{EXTENSION_VERSION}</h1>
                <p className="text-white/80 text-sm mt-1">Coupang Sourcing Helper Chrome Extension</p>
              </div>
            </div>
            <p className="text-white/90 text-sm md:text-base leading-relaxed max-w-xl mb-6">
              쿠팡 검색 결과 자동 분석, AI 제품 발견, 시장 데이터(검색량/CPC),
              마진 계산, 니치 파인더, <strong>GPT-4o AI 분석</strong>까지 — 쿠팡 소싱의 모든 것을 한 곳에서.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <a href={EXTENSION_ZIP_URL} download>
                <Button className="bg-white text-indigo-700 hover:bg-white/90 font-bold shadow-lg gap-2">
                  <Download className="h-4 w-4" />
                  다운로드 v{EXTENSION_VERSION}
                  <span className="text-xs font-normal opacity-70">({EXTENSION_FILE_SIZE})</span>
                </Button>
              </a>
              <Badge className="bg-white/20 text-white border-white/30 hover:bg-white/30">
                <Chrome className="h-3 w-3 mr-1" />
                Chrome 전용
              </Badge>
              <Badge className="bg-white/20 text-white border-white/30 hover:bg-white/30">
                v{EXTENSION_VERSION}
              </Badge>
            </div>
          </div>
        </div>

        {/* 주요 기능 요약 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { icon: "📊", label: "경쟁도 분석", desc: "자동 점수 산출" },
            { icon: "🔮", label: "AI 제품 발견", desc: "자동 키워드 발굴" },
            { icon: "💎", label: "니치 파인더", desc: "틈새시장 분석" },
            { icon: "📈", label: "시장 데이터", desc: "검색량/CPC/가격분포" },
            { icon: "⭐", label: "소싱 점수", desc: "A~F 등급 평가" },
            { icon: "🔍", label: "1688 연결", desc: "중국 소싱처 검색" },
            { icon: "🧮", label: "마진 계산기", desc: "실시간 수익 계산" },
            { icon: "📉", label: "순위 추적", desc: "키워드 순위 모니터링" },
            { icon: "☁️", label: "서버 동기화", desc: "데이터 영구 저장" },
            { icon: "🤖", label: "AI 리뷰 분석", desc: "고객 니즈/불만 파악" },
            { icon: "📄", label: "PDF 보고서", desc: "소싱 분석 보고서" },
            { icon: "🔔", label: "알림 센터", desc: "실시간 변동 알림" },
          ].map((f, i) => (
            <Card key={i} className="text-center p-3">
              <div className="text-2xl mb-1">{f.icon}</div>
              <div className="font-semibold text-xs">{f.label}</div>
              <div className="text-[10px] text-gray-400 mt-0.5">{f.desc}</div>
            </Card>
          ))}
        </div>

        {/* 사용 설명서 */}
        <div>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Info className="h-5 w-5 text-indigo-500" />
            사용 설명서
          </h2>

          <div className="space-y-3">
            {/* 1. 설치 방법 */}
            <AccordionSection icon={Chrome} title="1. 설치 방법" defaultOpen={true}>
              <div className="space-y-4 mt-3">
                <Step num={1} title="확장프로그램 파일 다운로드" desc={`위의 다운로드 버튼을 클릭하여 coupang-helper-extension-v${EXTENSION_VERSION}.zip 파일을 받습니다.`} />
                <Step num={2} title="압축 해제" desc="다운로드한 zip 파일의 압축을 풀어줍니다." />
                <Step num={3} title="Chrome 확장프로그램 페이지 열기" desc="Chrome 주소창에 chrome://extensions 입력 후 이동합니다." />
                <Step num={4} title="개발자 모드 활성화" desc="우측 상단의 '개발자 모드' 토글을 켜세요." />
                <Step num={5} title="확장프로그램 로드" desc="좌측 상단 '압축해제된 확장 프로그램을 로드합니다' 클릭 → 압축 해제한 폴더를 선택합니다." />
                <Step num={6} title="사이드 패널 열기" desc="쿠팡 사이트에 접속 후, Chrome 우측 상단의 퍼즐 아이콘 → 'Coupang Sourcing Helper' 클릭으로 사이드 패널을 엽니다." />
                <Step num={7} title="서버 로그인" desc="사이드패널의 '서버' 탭에서 lumiriz.kr 계정으로 로그인하세요. 로그인해야 AI 제품 발견, 시장 데이터, 서버 동기화가 활성화됩니다." />

                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mt-4">
                  <div className="flex gap-2 text-xs">
                    <span className="text-amber-600 font-bold">💡 팁:</span>
                    <span className="text-amber-700">
                      퍼즐 아이콘 옆의 📌 핀 버튼을 클릭하면 도구 모음에 항상 표시됩니다.
                      업데이트 시에는 기존 확장프로그램을 제거하고 새로 로드하세요.
                    </span>
                  </div>
                </div>
              </div>
            </AccordionSection>

            {/* 2. 분석 탭 */}
            <AccordionSection icon={BarChart3} title="2. 📊 분석 탭 — 경쟁도 분석">
              <div className="space-y-4 mt-3">
                <p className="text-sm text-gray-600">
                  쿠팡에서 키워드를 검색하면 <strong>자동으로 상위 36개 상품</strong>을 분석합니다.
                  분석 결과는 자동으로 서버에 동기화되어 웹 대시보드에서도 확인 가능합니다.
                </p>

                <div className="space-y-3">
                  <div>
                    <h4 className="font-semibold text-sm flex items-center gap-2 mb-2">
                      <Target className="h-4 w-4 text-indigo-500" /> 경쟁 강도 (0~100점)
                    </h4>
                    <p className="text-xs text-gray-500 mb-2">
                      평균 리뷰수, 리뷰100+ 비율, 평균 평점, 광고 비율로 자동 계산됩니다.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Badge className="bg-green-100 text-green-700 hover:bg-green-100">약함 — 소싱 기회!</Badge>
                      <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">보통 — 진입 가능</Badge>
                      <Badge className="bg-red-100 text-red-700 hover:bg-red-100">강함 — 차별화 필요</Badge>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold text-sm flex items-center gap-2 mb-2">
                      <Star className="h-4 w-4 text-amber-500" /> 소싱 점수 (A~F 등급)
                    </h4>
                    <p className="text-xs text-gray-500 mb-2">
                      각 상품의 리뷰, 평점, 가격 비율, 광고 여부, 로켓배송을 종합하여 소싱 난이도를 평가합니다.
                    </p>
                    <div className="space-y-1">
                      <GradeBadge grade="A (80+)" label="매우 좋음 — 소싱 강력 추천" className="bg-green-100 text-green-700" />
                      <GradeBadge grade="B (65+)" label="좋음 — 소싱 추천" className="bg-blue-100 text-blue-700" />
                      <GradeBadge grade="C (50+)" label="보통 — 검토 필요" className="bg-gray-100 text-gray-700" />
                      <GradeBadge grade="D (35+)" label="어려움 — 신중히 판단" className="bg-amber-100 text-amber-700" />
                      <GradeBadge grade="F (35미만)" label="매우 어려움 — 비추천" className="bg-red-100 text-red-700" />
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold text-sm flex items-center gap-2 mb-2">
                      <Filter className="h-4 w-4 text-gray-500" /> 필터 & 정렬
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-gray-50 rounded-lg p-2">
                        <strong>광고 제외</strong> — 광고 상품 숨기기
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2">
                        <strong>소싱쉬운것</strong> — 점수 60점 이상만
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2">
                        <strong>상위 N개</strong> — 5/10/20/36개 선택
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2">
                        <strong>정렬</strong> — 가격/리뷰/평점/소싱점수
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold text-sm flex items-center gap-2 mb-2">
                      <Activity className="h-4 w-4 text-blue-500" /> 자동 수집되는 데이터 (v8.1 확장)
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {[
                        "총 상품 수 (totalProductCount)",
                        "최저가 / 최고가 / 중앙가",
                        "가격 분포 히스토그램",
                        "리뷰 분포 데이터",
                        "평균 평점 (전체)",
                        "로켓배송 비율",
                        "광고 비율",
                        "배송 유형별 분류",
                      ].map((item, i) => (
                        <div key={i} className="bg-blue-50 rounded-lg px-3 py-2 flex items-center gap-2">
                          <span className="text-blue-500">+</span> {item}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </AccordionSection>

            {/* 3. AI 제품 발견 (v8.1 NEW) */}
            <AccordionSection icon={Zap} title="3. 🔮 AI 제품 발견 (v8.1 NEW)" badge="NEW">
              <div className="space-y-4 mt-3">
                <div className="flex items-center gap-2 mb-2">
                  <Badge className="bg-yellow-100 text-yellow-700 text-xs">AI 자동 키워드 발굴</Badge>
                  <Badge className="bg-blue-100 text-blue-700 text-xs">자동 크롤링</Badge>
                  <Badge className="bg-purple-100 text-purple-700 text-xs">AI 분석 + 추천</Badge>
                </div>
                <p className="text-sm text-gray-600">
                  기존에 수집된 검색 데이터를 AI가 분석하여 <strong>유망 키워드를 자동으로 발견</strong>하고,
                  검토 승인 시 확장프로그램이 <strong>자동으로 쿠팡 크롤링 → AI 분석 → 추천 제품 선정</strong>까지 수행합니다.
                </p>

                <div>
                  <h4 className="font-semibold text-sm mb-3">전체 워크플로우</h4>
                  <div className="relative">
                    {[
                      { num: 1, title: "AI 키워드 발견", desc: "기존 수집 데이터에서 수요/경쟁/성장률 분석 → 유망 키워드 자동 발굴", color: "bg-yellow-500" },
                      { num: 2, title: "유저 검토 승인", desc: "AI 발견 탭에서 키워드별 발견 점수/이유/통계 확인 → '검토' 버튼 클릭", color: "bg-blue-500" },
                      { num: 3, title: "확장 자동 크롤링", desc: "확장프로그램이 1분 이내 자동 감지 → 쿠팡에서 해당 키워드 검색 크롤링", color: "bg-indigo-500" },
                      { num: 4, title: "1차 필터링", desc: "광고 제외, 리뷰/가격/평점/랭크/로켓 기반 점수로 상위 8개 제품 선별", color: "bg-purple-500" },
                      { num: 5, title: "AI 시장 분석", desc: "GPT가 경쟁 강도, 진입 난이도, 시장 규모 분석 (실패 시 규칙기반 자동 대체)", color: "bg-emerald-500" },
                      { num: 6, title: "제품별 추천", desc: "S~D 등급, 강력추천/추천/관망/패스 판정, 리스크/기회 요인, 소싱 팁 제공", color: "bg-orange-500" },
                      { num: 7, title: "유저 결정", desc: "'추적' → 일일 모니터링 자동 등록 / '거절' → 제외", color: "bg-pink-500" },
                    ].map((step, i, arr) => (
                      <div key={i} className="flex gap-3 relative">
                        {i < arr.length - 1 && (
                          <div className="absolute left-3.5 top-8 w-0.5 h-[calc(100%-8px)] bg-gray-200" />
                        )}
                        <div className={`w-7 h-7 rounded-full ${step.color} text-white flex items-center justify-center text-xs font-bold shrink-0 z-10`}>
                          {step.num}
                        </div>
                        <div className="pb-4">
                          <div className="font-semibold text-sm">{step.title}</div>
                          <div className="text-xs text-gray-500 mt-0.5">{step.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold text-sm mb-2">웹 대시보드 (AI 제품 발견 페이지)</h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {[
                      "AI 발견 키워드 목록 + 발견 점수",
                      "수동 키워드 입력 분석",
                      "크롤링 작업 목록 + 상태 표시",
                      "키워드별 Top 1,2 추천 제품 인라인",
                      "시장 개요 (경쟁/규모/진입난이도)",
                      "제품 카드: 등급/점수/리스크/기회",
                      "추적/거절 의사결정 + 메모",
                      "재분석 + 삭제 기능",
                    ].map((item, i) => (
                      <div key={i} className="bg-yellow-50 rounded-lg px-3 py-2 flex items-center gap-2">
                        <span className="text-yellow-600">🔮</span> {item}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <div className="flex gap-2 text-xs">
                    <span className="text-yellow-600 font-bold">⚡ 필수 조건:</span>
                    <span className="text-yellow-700">
                      확장프로그램이 열려 있고, 서버에 로그인된 상태여야 합니다. 쿠팡 탭이 열려 있으면 자동으로 새 탭에서 크롤링합니다.
                      '배치 ON' 토글이 켜져 있으면 1분 간격으로 대기 중인 작업을 자동 감지합니다.
                    </span>
                  </div>
                </div>
              </div>
            </AccordionSection>

            {/* 4. 니치 파인더 + 시장 데이터 */}
            <AccordionSection icon={Gem} title="4. 💎 니치 파인더 + 시장 데이터 (v8.1 NEW)" badge="NEW">
              <div className="space-y-4 mt-3">
                <p className="text-sm text-gray-600">
                  검색 수요 데이터를 기반으로 <strong>틈새시장(니치)</strong>을 발견하고,
                  키워드별 <strong>상세 시장 데이터</strong>를 분석합니다.
                </p>

                <div>
                  <h4 className="font-semibold text-sm mb-2">니치 키워드 분석</h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {[
                      "종합 점수 기반 키워드 정렬",
                      "수요 점수 / 경쟁 점수 / 성장률",
                      "예상 판매량 (MA7/MA30)",
                      "경쟁 강도별 필터 (easy/medium/hard)",
                    ].map((item, i) => (
                      <div key={i} className="bg-purple-50 rounded-lg px-3 py-2 flex items-center gap-2">
                        <span className="text-purple-500">💎</span> {item}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                    <LineChart className="h-4 w-4 text-blue-500" /> 시장 데이터 탭
                  </h4>
                  <p className="text-xs text-gray-500 mb-2">
                    키워드를 선택하면 '시장 데이터' 탭에서 셀러라이프 수준의 상세 분석을 확인합니다.
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {[
                      { icon: "📊", label: "검색량 트렌드 (네이버)", desc: "월별 검색량 추이 차트" },
                      { icon: "💰", label: "가격 통계", desc: "최저가/최고가/중앙가/평균가" },
                      { icon: "⭐", label: "리뷰 통계", desc: "평균 리뷰수/평점/리뷰 분포" },
                      { icon: "📦", label: "배송 유형 분류", desc: "로켓/셀러로켓/일반/해외 비율" },
                      { icon: "📈", label: "가격 분포 히스토그램", desc: "가격대별 상품 수 시각화" },
                      { icon: "💲", label: "CPC 광고 데이터", desc: "쿠팡 애즈 키워드별 입찰가" },
                    ].map((item, i) => (
                      <div key={i} className="bg-blue-50 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-1 mb-0.5">
                          <span>{item.icon}</span>
                          <strong>{item.label}</strong>
                        </div>
                        <div className="text-gray-500">{item.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="flex gap-2 text-xs">
                    <span className="text-blue-600 font-bold">💡 검색량 수집:</span>
                    <span className="text-blue-700">
                      시장 데이터 탭에서 '수집' 버튼을 누르면 네이버 키워드 API에서 월별 검색량을 자동으로 가져옵니다.
                      CPC 데이터는 쿠팡 애즈(advertising.coupang.com)에서 해당 키워드를 검색하면 자동 수집됩니다.
                    </span>
                  </div>
                </div>
              </div>
            </AccordionSection>

            {/* 5. 검색 수요 */}
            <AccordionSection icon={Activity} title="5. 📊 검색 수요 — 키워드 수집 & 배치">
              <div className="space-y-4 mt-3">
                <p className="text-sm text-gray-600">
                  확장프로그램의 <strong>배치 수집 기능</strong>으로 등록된 키워드를 자동으로 순차 크롤링합니다.
                  수집된 데이터는 일별 통계로 자동 집계됩니다.
                </p>

                <div>
                  <h4 className="font-semibold text-sm mb-2">수집 방식</h4>
                  <div className="space-y-2 text-xs">
                    <div className="bg-gray-50 rounded-lg p-3">
                      <strong className="text-indigo-600">배치 자동 수집:</strong> '배치 ON' 토글 활성화 → 키워드 목록을 N개씩 라운드로 순차 크롤링.
                      인간 행동 모방 딜레이(지수분포 + 피로도 + 시간대 가중치)로 봇 탐지 회피.
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <strong className="text-indigo-600">수동 검색:</strong> 쿠팡에서 직접 키워드를 검색하면 자동으로 스냅샷이 저장됩니다.
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold text-sm mb-2">자동 집계 통계 (키워드별)</h4>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    {[
                      "리뷰 증가량 (일별)", "판매 추정치", "경쟁도 점수",
                      "수요 점수 (0-100)", "종합 점수", "성장률 (급등 감지)",
                      "MA7 / MA30 이동평균", "스파이크 탐지", "EMA 스무딩",
                    ].map((item, i) => (
                      <div key={i} className="bg-gray-50 rounded-lg px-3 py-2 text-center">{item}</div>
                    ))}
                  </div>
                </div>

                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <div className="flex gap-2 text-xs">
                    <span className="text-green-600 font-bold">💡 팁:</span>
                    <span className="text-green-700">
                      배치 수집 옵션에서 '1개씩' 또는 '2개씩~전체' 라운드 단위를 선택할 수 있습니다.
                      실패 키워드는 자동으로 재수집 대상이 됩니다.
                    </span>
                  </div>
                </div>
              </div>
            </AccordionSection>

            {/* 6. 후보 탭 */}
            <AccordionSection icon={Star} title="6. ⭐ 후보 탭 — 소싱 후보 관리">
              <div className="space-y-3 mt-3">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">⭐</div>
                  <div>
                    <strong className="text-sm">후보 저장</strong>
                    <p className="text-xs text-gray-500">분석 탭이나 상세 탭에서 ⭐ 버튼을 누르면 후보로 저장됩니다. 최대 500개까지 저장 가능합니다.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">🔍</div>
                  <div>
                    <strong className="text-sm">1688 찾기</strong>
                    <p className="text-xs text-gray-500">상품 제목에서 핵심 키워드를 자동 추출하여 1688.com에서 유사 중국 소싱처를 검색합니다. CNINSIDER(1688 한국 파트너)도 지원됩니다.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </div>
                  <div>
                    <strong className="text-sm">후보 삭제</strong>
                    <p className="text-xs text-gray-500">불필요한 후보는 삭제 버튼으로 정리할 수 있습니다.</p>
                  </div>
                </div>
              </div>
            </AccordionSection>

            {/* 7. 순위 추적 */}
            <AccordionSection icon={TrendingUp} title="7. 📈 순위 탭 — 키워드 순위 추적">
              <div className="space-y-4 mt-3">
                <p className="text-sm text-gray-600">
                  특정 키워드에서 내 상품의 순위 변화를 추적할 수 있습니다.
                </p>
                <div className="space-y-3">
                  <Step num={1} title="키워드 등록" desc="순위 탭에서 추적할 검색 키워드와 (선택) 타겟 상품 ID를 입력 후 '+ 추가'를 누릅니다." />
                  <Step num={2} title="자동 기록" desc="쿠팡에서 해당 키워드를 검색할 때마다 자동으로 순위가 기록됩니다. 6시간 주기 자동 추적도 지원됩니다." />
                  <Step num={3} title="순위 확인" desc="'📊 보기' 버튼으로 최신 순위를 확인하세요. 타겟 상품은 보라색으로 강조됩니다." />
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="flex gap-2 text-xs">
                    <span className="text-blue-600 font-bold">💡 팁:</span>
                    <span className="text-blue-700">
                      분석 탭에서 상품 옆의 📈 버튼으로도 바로 순위 추적을 등록할 수 있습니다.
                      AI 제품 발견에서 '추적' 결정을 내리면 자동으로 순위 추적에 등록됩니다.
                    </span>
                  </div>
                </div>
              </div>
            </AccordionSection>

            {/* 8. 상세 탭 */}
            <AccordionSection icon={Eye} title="8. 🔍 상세 탭 — 상품 상세 분석">
              <div className="space-y-3 mt-3">
                <p className="text-sm text-gray-600">
                  쿠팡 상품 상세 페이지 (예: <code className="bg-gray-100 px-1 rounded text-xs">coupang.com/vp/products/12345</code>)를 열면 자동으로 파싱합니다.
                </p>
                <div>
                  <h4 className="font-semibold text-sm mb-2">파싱되는 정보</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      "판매자명", "카테고리 경로", "원래가격 / 할인율",
                      "로켓배송 / 무료배송", "옵션 수", "구매 건수",
                      "평점 / 리뷰 수", "가격·리뷰 변동 이력",
                    ].map((item, i) => (
                      <div key={i} className="text-xs bg-gray-50 rounded-lg px-3 py-2 flex items-center gap-2">
                        <span className="text-indigo-500">•</span> {item}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                  <div className="flex gap-2 text-xs">
                    <span className="text-purple-600 font-bold">📊 가격 변동:</span>
                    <span className="text-purple-700">
                      같은 상품을 여러 번 방문하면 가격과 리뷰 변화를 시간순으로 확인할 수 있습니다.
                    </span>
                  </div>
                </div>
              </div>
            </AccordionSection>

            {/* 9. 마진 계산기 */}
            <AccordionSection icon={Calculator} title="9. 🧮 마진 탭 — 마진 계산기">
              <div className="space-y-4 mt-3">
                <p className="text-sm text-gray-600">
                  1688 원가 → 쿠팡 판매가 기준으로 예상 순이익과 마진율을 계산합니다.
                  웹 대시보드의 마진 계산기 페이지에서도 동일 기능을 사용할 수 있습니다.
                </p>
                <div className="overflow-hidden rounded-lg border">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">입력 항목</th>
                        <th className="px-3 py-2 text-left font-semibold">설명</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      <tr><td className="px-3 py-2 font-medium">1688 원가 (CNY)</td><td className="px-3 py-2 text-gray-500">상품 원가 (위안)</td></tr>
                      <tr><td className="px-3 py-2 font-medium">환율 (CNY→KRW)</td><td className="px-3 py-2 text-gray-500">기본값 190</td></tr>
                      <tr><td className="px-3 py-2 font-medium">국제배송비 (원)</td><td className="px-3 py-2 text-gray-500">1건당 배송비 (기본 3,000원)</td></tr>
                      <tr><td className="px-3 py-2 font-medium">관부가세율 (%)</td><td className="px-3 py-2 text-gray-500">기본값 10%</td></tr>
                      <tr><td className="px-3 py-2 font-medium">쿠팡 판매가 (원)</td><td className="px-3 py-2 text-gray-500">예상 판매가</td></tr>
                      <tr><td className="px-3 py-2 font-medium">쿠팡 수수료율 (%)</td><td className="px-3 py-2 text-gray-500">카테고리별 (기본 10.8%)</td></tr>
                    </tbody>
                  </table>
                </div>
                <div>
                  <h4 className="font-semibold text-sm mb-2">계산 결과</h4>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="bg-gray-50 rounded-lg p-2 text-center">원가 (KRW)</div>
                    <div className="bg-gray-50 rounded-lg p-2 text-center">배송비</div>
                    <div className="bg-gray-50 rounded-lg p-2 text-center">관부가세</div>
                    <div className="bg-indigo-50 rounded-lg p-2 text-center font-bold text-indigo-700">총 원가</div>
                    <div className="bg-gray-50 rounded-lg p-2 text-center">수수료</div>
                    <div className="bg-green-50 rounded-lg p-2 text-center font-bold text-green-700">순이익 / 마진율</div>
                  </div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="flex gap-2 text-xs">
                    <span className="text-amber-600 font-bold">💡:</span>
                    <span className="text-amber-700">
                      결과가 <span className="text-green-600 font-bold">초록색</span>이면 이익,
                      <span className="text-red-600 font-bold"> 빨간색</span>이면 손해입니다.
                    </span>
                  </div>
                </div>
              </div>
            </AccordionSection>

            {/* 10. 쿠팡 애즈 CPC 자동 수집 */}
            <AccordionSection icon={DollarSign} title="10. 💲 쿠팡 애즈 CPC 자동 수집 (v8.1 NEW)" badge="NEW">
              <div className="space-y-3 mt-3">
                <p className="text-sm text-gray-600">
                  <strong>advertising.coupang.com</strong> (쿠팡 애즈 키워드 플래너)에서 키워드를 검색하면
                  CPC 입찰가 데이터가 <strong>자동으로 수집</strong>되어 서버에 저장됩니다.
                </p>
                <div className="space-y-3">
                  <Step num={1} title="쿠팡 애즈 접속" desc="advertising.coupang.com에 접속하여 WING 계정으로 로그인합니다." />
                  <Step num={2} title="키워드 검색" desc="키워드 플래너에서 관심 키워드를 검색합니다." />
                  <Step num={3} title="자동 수집" desc="확장프로그램이 CPC 데이터(입찰가, 경쟁도)를 자동으로 감지하여 서버에 저장합니다." />
                  <Step num={4} title="시장 데이터에서 확인" desc="니치 파인더의 '시장 데이터' 탭에서 CPC 광고 비용을 확인할 수 있습니다." />
                </div>
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <div className="flex gap-2 text-xs">
                    <span className="text-green-600 font-bold">💡:</span>
                    <span className="text-green-700">
                      CPC 데이터와 마진 계산을 결합하면 광고비 포함 수익성을 정확히 판단할 수 있습니다.
                    </span>
                  </div>
                </div>
              </div>
            </AccordionSection>

            {/* 11. 서버 연동 */}
            <AccordionSection icon={Server} title="11. 🔗 서버 탭 — 서버 연동">
              <div className="space-y-3 mt-3">
                <p className="text-sm text-gray-600">
                  lumiriz.kr 계정으로 로그인하면 모든 데이터가 서버에 자동 동기화됩니다.
                </p>
                <div>
                  <h4 className="font-semibold text-sm mb-2">동기화되는 데이터</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      "검색 스냅샷 (15+ 필드 포함)",
                      "소싱 후보 목록 및 상태",
                      "순위 추적 데이터",
                      "상품 상세 가격/리뷰 변동",
                      "CPC 광고 데이터",
                      "AI 제품 발견 작업 상태",
                      "검색량 히스토리",
                      "키워드별 시장 데이터",
                    ].map((item, i) => (
                      <div key={i} className="text-xs bg-gray-50 rounded-lg px-3 py-2 flex items-center gap-2">
                        <span className="text-green-500">✅</span> {item}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                    <MonitorSmartphone className="h-4 w-4" /> 웹 대시보드 메뉴
                  </h4>
                  <p className="text-xs text-gray-500 mb-2">
                    서버에 로그인하면 <strong>lumiriz.kr</strong>의 웹 대시보드에서 아래 기능을 사용할 수 있습니다.
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {[
                      { icon: "📊", label: "검색 수요", desc: "키워드 수집/통계/배치" },
                      { icon: "💎", label: "니치 파인더", desc: "틈새시장 분석 + 시장 데이터" },
                      { icon: "🔮", label: "AI 제품 발견", desc: "자동 키워드→크롤링→추천" },
                      { icon: "💰", label: "마진 계산기", desc: "1688→쿠팡 수익 계산" },
                      { icon: "📝", label: "데일리 소싱", desc: "일일 소싱 활동 기록" },
                      { icon: "📦", label: "전체 상품", desc: "등록 상품 관리" },
                      { icon: "🧪", label: "테스트 후보", desc: "소싱 후보 평가" },
                      { icon: "🔬", label: "헬퍼 대시보드", desc: "확장프로그램 통계" },
                      { icon: "🐢", label: "소싱 헬퍼", desc: "확장프로그램 관리" },
                      { icon: "🏠", label: "대시보드", desc: "판매 현황 개요" },
                      { icon: "💰", label: "Daily Profit", desc: "일일 수익 추적" },
                      { icon: "📅", label: "주간 리뷰", desc: "주간 성과 리뷰" },
                    ].map((item, i) => (
                      <div key={i} className="bg-gray-50 rounded-lg p-2">
                        <span>{item.icon}</span> <strong>{item.label}</strong> — {item.desc}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </AccordionSection>

            {/* 12. AI 리뷰 분석 */}
            <AccordionSection icon={Sparkles} title="12. 🤖 AI 리뷰 분석 (GPT-4o-mini)">
              <div className="space-y-3 mt-3">
                <div className="flex items-center gap-2 mb-2">
                  <Badge className="bg-emerald-100 text-emerald-700 text-xs">OpenAI GPT-4o-mini</Badge>
                  <Badge variant="outline" className="text-xs">자동 폴백: 규칙기반 엔진</Badge>
                </div>
                <p className="text-sm text-gray-600">
                  검색 데이터를 기반으로 <strong>OpenAI GPT-4o-mini가 자동으로 고객 니즈, 불만, 소싱 기회</strong>를 분석합니다.
                  API 장애 시 규칙 기반 분석으로 자동 폴백됩니다.
                </p>
                <div>
                  <h4 className="font-semibold text-sm mb-2">분석 결과 항목</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      "고객 불만 (Pain Points)",
                      "고객 니즈 분석",
                      "소싱 기회 도출",
                      "긍정/부정 요소",
                      "가격 민감도 분석",
                      "추천 액션 플랜",
                      "품질 우려사항",
                      "시장 개요 통계",
                    ].map((item, i) => (
                      <div key={i} className="text-xs bg-emerald-50 rounded-lg px-3 py-2 flex items-center gap-2">
                        <span className="text-emerald-500">✨</span> {item}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                  <div className="flex gap-2 text-xs">
                    <span className="text-emerald-600 font-bold">💡 사용법:</span>
                    <span className="text-emerald-700">
                      AI 제품 발견에서 자동 실행되거나, 웹 대시보드의 AI 분석 기능에서 수동으로 실행할 수 있습니다.
                    </span>
                  </div>
                </div>
              </div>
            </AccordionSection>

            {/* 13. PDF 보고서 */}
            <AccordionSection icon={FileText} title="13. 📄 PDF 보고서">
              <div className="space-y-3 mt-3">
                <p className="text-sm text-gray-600">
                  소싱 분석 데이터를 <strong>PDF 보고서</strong>로 다운로드할 수 있습니다.
                </p>
                <div>
                  <h4 className="font-semibold text-sm mb-2">보고서 포함 내용</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      "검색 통계 요약",
                      "TOP 키워드 분석",
                      "소싱 후보 현황",
                      "AI 리뷰 분석 결과",
                      "활동 요약 (7일)",
                      "자동 페이지 번호",
                    ].map((item, i) => (
                      <div key={i} className="text-xs bg-blue-50 rounded-lg px-3 py-2 flex items-center gap-2">
                        <span className="text-blue-500">📋</span> {item}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </AccordionSection>

            {/* 14. 알림 센터 */}
            <AccordionSection icon={Bell} title="14. 🔔 알림 센터">
              <div className="space-y-3 mt-3">
                <p className="text-sm text-gray-600">
                  순위 변동, 가격 변화, AI 분석 완료, AI 발견 크롤링 완료 등의 이벤트를 <strong>실시간 알림</strong>으로 확인합니다.
                </p>
                <div>
                  <h4 className="font-semibold text-sm mb-2">알림 유형</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { icon: "📊", label: "순위 변동 알림" },
                      { icon: "💰", label: "가격 변동 알림" },
                      { icon: "🆕", label: "신규 경쟁자 알림" },
                      { icon: "🔮", label: "AI 분석 완료 알림" },
                      { icon: "🎯", label: "마일스톤 알림" },
                      { icon: "⚙️", label: "시스템 알림" },
                    ].map((item, i) => (
                      <div key={i} className="text-xs bg-amber-50 rounded-lg px-3 py-2 flex items-center gap-2">
                        <span>{item.icon}</span> {item.label}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </AccordionSection>

            {/* 15. 추천 워크플로우 */}
            <AccordionSection icon={Rocket} title="15. 🚀 추천 소싱 워크플로우 (v8.1)">
              <div className="mt-3">
                <div className="relative">
                  {[
                    { num: 1, title: "배치 수집 시작", desc: "확장프로그램에서 '배치 ON' → 키워드 자동 순차 크롤링으로 데이터 축적", color: "bg-gray-500" },
                    { num: 2, title: "AI 유망 키워드 발견", desc: "AI 제품 발견 페이지에서 자동 추천된 키워드 확인", color: "bg-yellow-500" },
                    { num: 3, title: "키워드 검토 승인", desc: "'검토' 버튼 → 확장프로그램이 자동 크롤링 + AI 분석 실행", color: "bg-blue-500" },
                    { num: 4, title: "추천 제품 확인", desc: "키워드별 Top 1, 2 추천 제품 + 시장 개요 확인 (S/A/B등급, 리스크/기회)", color: "bg-indigo-500" },
                    { num: 5, title: "니치 파인더 심화 분석", desc: "시장 데이터 탭에서 검색량 트렌드, 가격 분포, CPC 확인", color: "bg-purple-500" },
                    { num: 6, title: "1688 소싱처 검색", desc: "후보 탭에서 '🔍 1688' 버튼으로 중국 소싱처 찾기", color: "bg-orange-500" },
                    { num: 7, title: "마진 계산", desc: "마진 탭/페이지에서 1688원가 → 쿠팡판매가 수익률 확인", color: "bg-amber-500" },
                    { num: 8, title: "추적 등록 & 판매", desc: "AI 발견에서 '추적' 결정 → 자동 순위 추적 시작, 판매 개시", color: "bg-green-500" },
                    { num: 9, title: "일일 모니터링", desc: "Daily Profit + 주간 리뷰 + 알림 센터로 성과 관리", color: "bg-pink-500" },
                  ].map((step, i, arr) => (
                    <div key={i} className="flex gap-3 relative">
                      {i < arr.length - 1 && (
                        <div className="absolute left-3.5 top-8 w-0.5 h-[calc(100%-8px)] bg-gray-200" />
                      )}
                      <div className={`w-7 h-7 rounded-full ${step.color} text-white flex items-center justify-center text-xs font-bold shrink-0 z-10`}>
                        {step.num}
                      </div>
                      <div className="pb-5">
                        <div className="font-semibold text-sm">{step.title}</div>
                        <div className="text-xs text-gray-500 mt-0.5">{step.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </AccordionSection>

            {/* 16. FAQ */}
            <AccordionSection icon={HelpCircle} title="16. ❓ 자주 묻는 질문 (FAQ)">
              <div className="space-y-4 mt-3">
                {[
                  {
                    q: "Chrome 웹 스토어에 없나요?",
                    a: "아직 Chrome 웹 스토어에 출시되지 않았습니다. ZIP 파일을 다운로드한 후 '압축해제된 확장 프로그램 로드' 방식으로 설치해주세요.",
                  },
                  {
                    q: "쿠팡 이외의 사이트에서도 동작하나요?",
                    a: "쿠팡 검색 결과 페이지(coupang.com)와 상품 상세 페이지에서 동작합니다. 또한 쿠팡 애즈(advertising.coupang.com)에서 CPC 데이터를 자동 수집합니다.",
                  },
                  {
                    q: "데이터는 어디에 저장되나요?",
                    a: "서버 탭에서 로그인하면 lumiriz.kr 서버에 안전하게 저장됩니다. 로그인하지 않으면 브라우저 로컬 저장소에만 저장됩니다.",
                  },
                  {
                    q: "AI 제품 발견이 크롤링을 시작하지 않아요.",
                    a: "1) 확장프로그램이 열려 있는지 확인, 2) 서버에 로그인 되어 있는지 확인, 3) '배치 ON' 토글이 켜져 있는지 확인, 4) 쿠팡 탭이 열려 있는지 확인하세요. 1분 이내에 자동으로 대기 작업을 감지합니다.",
                  },
                  {
                    q: "AI 분석에 비용이 발생하나요?",
                    a: "AI 분석은 무료로 제공됩니다. OpenAI GPT-4o-mini 기반으로 동작하며, API 장애 시 규칙 기반 분석으로 자동 대체됩니다.",
                  },
                  {
                    q: "검색량 데이터는 어디서 가져오나요?",
                    a: "네이버 키워드 API에서 월별 검색량을 가져옵니다. 니치 파인더의 '시장 데이터' 탭에서 '수집' 버튼을 클릭하세요.",
                  },
                  {
                    q: "CPC 데이터는 어떻게 수집하나요?",
                    a: "쿠팡 애즈(advertising.coupang.com)의 키워드 플래너에서 키워드를 검색하면 확장프로그램이 자동으로 CPC 입찰가를 감지하여 서버에 저장합니다.",
                  },
                  {
                    q: "업데이트는 어떻게 하나요?",
                    a: "새 버전 ZIP을 다운로드한 후, chrome://extensions에서 기존 확장프로그램을 제거하고 새로 로드하면 됩니다. 서버 데이터는 유지됩니다.",
                  },
                  {
                    q: "추천 제품의 S/A/B 등급은 어떻게 결정되나요?",
                    a: "리뷰 수(진입 장벽), 가격대(마진 가능성), 평점, 검색 순위, 로켓배송 여부를 종합하여 점수를 산출합니다. 90+ S등급, 70+ A등급, 50+ B등급입니다.",
                  },
                ].map((faq, i) => (
                  <div key={i} className="border rounded-lg p-3">
                    <div className="font-semibold text-sm flex items-center gap-2">
                      <span className="text-indigo-500 font-bold">Q.</span> {faq.q}
                    </div>
                    <div className="text-xs text-gray-600 mt-2 leading-relaxed flex items-start gap-2">
                      <span className="text-emerald-500 font-bold shrink-0">A.</span> {faq.a}
                    </div>
                  </div>
                ))}
              </div>
            </AccordionSection>

            {/* 17. 버전 기록 */}
            <AccordionSection icon={Clock} title="17. 📌 버전 기록">
              <div className="space-y-3 mt-3">
                {[
                  {
                    version: "v8.5.0",
                    date: "2026-03-15",
                    badge: "Latest",
                    changes: [
                      "🔧 사이드패널 모듈 분할: sidepanel.js 2680줄 → 6개 파일 (utils, analysis, demand, wing, tabs, main)",
                      "📊 사이드패널 탭 정리: 미사용 5개 탭 제거 → 6개 탭 (분석, 수집, WING, 이력, 마진, 서버)",
                      "🔄 수집 탭 자동/수동 서브탭 분리: 배치 자동수집 + 수동 키워드별 수집 UI 분리",
                      "⚡ 플로팅 패널 배치 수집: 자동 수집 시작/중지 버튼 + 실시간 진행률 바 추가",
                      "🗄️ ext_keyword_daily_stats 전면 마이그레이션: watch.router, batchCollector, 사이드패널 모두 전환",
                      "🏷️ 미수집 라벨 개선: '미수집' → '신규(미배치)' (개요), '오늘 미수집' (탭), '오늘 수집 안 된 키워드' (배너)",
                      "📈 backfillDemandScores API 추가: demandScore=0 과거 데이터 자동 재계산",
                      "⚠️ 레거시 정리: ext_keyword_daily_status, ext_keyword_metrics, ext_keyword_alerts DEPRECATED 표시",
                    ],
                  },
                  {
                    version: "v8.4.4",
                    date: "2026-03-14",
                    changes: [
                      "🔍 검색량 추정 엔진 v1: Simple(네이버×0.33) → Hybrid(네이버 50% + 리뷰역산 35% + 자동완성 15%) 자동 전환",
                      "📊 Hybrid 전환 프로그레스: 축적일/델타/정합 3개 조건별 미니 바 표시",
                      "🌐 네이버 API 공백 키워드 자동 처리: '현금 파우치' → '현금파우치' 변환 후 호출",
                      "🏷️ 네이버 미등록 키워드 구분: [네이버 미등록] 배지로 검색량 추정 불가 안내",
                      "⚡ directVolume: DB timing 이슈 우회 — 네이버 API 결과를 응답에 직접 포함",
                      "🎯 경쟁강도 사이드패널 동기화: 구간별 고정점수 → 연속 스케일(log/선형) 통일",
                      "📈 히스토그램 개선: 바 위 카운트 숫자 표시 + 바 영역 높이 확장",
                      "🔧 Per-Product Matched Delta 엔진: 상품별 리뷰 증가량만 추적 (구성 변동 노이즈 제거)",
                      "📉 MA7/MA30 재계산: per-product delta 기반, interpolated 제외한 정확한 이동평균",
                    ],
                  },
                  {
                    version: "v8.1.0",
                    date: "2026-03-14",
                    changes: [
                      "🔮 AI 제품 발견 시스템: 자동 키워드 발굴 → 검토 승인 → 확장 자동 크롤링 → AI 분석 → 추천/추적",
                      "💎 니치 파인더 + 시장 데이터 탭: 검색량 트렌드, 가격/리뷰 통계, 가격분포 히스토그램, 배송유형 분석",
                      "💲 쿠팡 애즈 CPC 자동 수집 (content-coupang-ads.js): advertising.coupang.com 키워드 플래너 연동",
                      "📊 스냅샷 확장: totalProductCount, minPrice, maxPrice, medianPrice, priceDistribution, reviewDistribution 등 15+ 필드",
                      "🔗 서버 tRPC: fetchSearchVolume, getSearchVolumeHistory, saveCpcData, getCpcData, getKeywordMarketData, getKeywordsMarketSummary 6개 프로시저",
                      "🗄️ DB: keyword_search_volume_history, keyword_cpc_cache 테이블 추가 (Migration 0020)",
                      "🤖 AI 분석: GPT 시장 개요 + 제품별 S~D 등급/강력추천~패스 판정 + 규칙기반 폴백",
                      "📋 크롤링 작업 목록에 Top 1, 2 추천 제품 인라인 표시",
                      "🔔 확장프로그램 discoveryPolling 알람 (1분 간격 자동 폴링)",
                      "🌐 manifest.json: advertising.coupang.com 호스트 권한 추가",
                    ],
                  },
                  {
                    version: "v7.4.1",
                    date: "2026-03-12",
                    changes: [
                      "인간 행동 모방 딜레이 전면 개편 (봇 탐지 회피 강화)",
                      "지수분포 + 피로도 + 시간대 가중치 + 지터 적용",
                      "좀비 감지: 키워드 수 × 40초 × 1.5 동적 임계값",
                      "수요탭 → 수집탭 이름/순서 변경, 배치 1개씩 옵션 추가",
                    ],
                  },
                  {
                    version: "v7.4.0",
                    date: "2026-03-12",
                    changes: [
                      "수집 시작 오류 수정 (Service Worker 메시지 타임아웃 해결)",
                      "탭 내 DOMParser 기반 파싱 (리뷰/평점 100% 정상 수집)",
                      "키워드 메트릭 엔진: EMA 스무딩 + 판매 추정 + 급등 탐지",
                      "검색수요 독립 페이지 + 사이드바 카테고리 재편",
                      "마진 계산기 + 니치 파인더 페이지 추가",
                    ],
                  },
                  {
                    version: "v7.3.x",
                    date: "2026-03-10",
                    changes: [
                      "종합점수 통합: 서버/확장 동일 점수 표시",
                      "실패 키워드 우선 재수집 + 통계 리셋 버그 수정",
                      "수집 시작 실패 수정 (sendMsg 재시도 로직)",
                      "DOMParser 기반 파싱 전환 (리뷰율 90%+ 정상화)",
                    ],
                  },
                  {
                    version: "v7.2.x",
                    date: "2026-03-10",
                    changes: [
                      "하이브리드 수집 아키텍처: Background HTML Fetch + DOMParser",
                      "V2 DOM 자동 감지, 6종 배송 분류, 모바일 리뷰 API",
                      "N개씩 라운드 수집 + 딜레이 최적화 (수집 속도 2배)",
                      "declarativeNetRequest 헤더 스푸핑 (3규칙)",
                    ],
                  },
                  {
                    version: "v6.6.x",
                    date: "2026-03-09",
                    changes: [
                      "평점 파싱률 수정: SVG 별점 6가지 감지 방법",
                      "자동 수집 전면 개편: 배치 실행 UI + useRef 즉시 중지",
                      "배치 로직: computeKeywordDailyStats 기반 실제 통계 갱신",
                    ],
                  },
                  {
                    version: "v5.x",
                    date: "2026-03-08",
                    changes: [
                      "내 상품 자동 추적 시스템 + 일일 스냅샷",
                      "검색 수요 추정 시스템 구축 (일별 통계 자동 계산)",
                      "1688 한국어 직접 전달 (번역 로직 제거)",
                      "가격/평점 파싱 전면 재작성 (React SPA 호환)",
                      "마켓 대시보드 패널 + 셀록홈즈 스타일 UI",
                    ],
                  },
                  {
                    version: "v3.x ~ v4.0",
                    date: "2026-03-01 ~ 07",
                    changes: [
                      "핵심 기능 출시: 검색 분석, 후보 관리, 순위 추적",
                      "WING 셀러센터 인기상품 데이터 수집",
                      "OpenAI GPT-4o-mini AI 리뷰 분석",
                      "PDF 보고서 + 알림 센터",
                      "서버 동기화 + 웹 대시보드 7개 탭",
                    ],
                  },
                ].map((ver, i) => (
                  <div key={i} className="border rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge className={i === 0 ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600"}>{ver.version}</Badge>
                      {ver.badge && <Badge className="bg-green-100 text-green-700 text-[10px]">{ver.badge}</Badge>}
                      <span className="text-xs text-gray-400 ml-auto">{ver.date}</span>
                    </div>
                    <ul className="space-y-1">
                      {ver.changes.map((c, j) => (
                        <li key={j} className="text-xs text-gray-600 flex items-start gap-1.5">
                          <span className="text-indigo-400 mt-0.5">{"\u2022"}</span> {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </AccordionSection>
          </div>
        </div>

        {/* 하단 다운로드 CTA */}
        <Card className="border-indigo-200 bg-gradient-to-r from-indigo-50 to-purple-50">
          <CardContent className="py-6 flex flex-col md:flex-row items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-lg">지금 바로 시작하세요!</h3>
              <p className="text-sm text-gray-500 mt-1">
                쿠팡 소싱을 더 스마트하게. 소싱 헬퍼 v{EXTENSION_VERSION}
              </p>
            </div>
            <a href={EXTENSION_ZIP_URL} download>
              <Button size="lg" className="bg-indigo-600 hover:bg-indigo-700 gap-2 shadow-lg">
                <Download className="h-5 w-5" />
                확장프로그램 다운로드
              </Button>
            </a>
          </CardContent>
        </Card>

        {/* 푸터 */}
        <div className="text-center text-xs text-gray-400 pb-4">
          Coupang Sourcing Helper v{EXTENSION_VERSION} · lumiriz.kr
        </div>
      </div>
    </DashboardLayout>
  );
}
