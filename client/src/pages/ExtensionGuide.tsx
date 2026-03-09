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
  Sparkles, Brain, Bell, HelpCircle, Clock
} from "lucide-react";

const EXTENSION_VERSION = "7.0.0";
const EXTENSION_ZIP_URL = "/coupang-helper-extension-v7.2.2.zip";
const EXTENSION_FILE_SIZE = "143KB";

function AccordionSection({
  icon: Icon,
  title,
  defaultOpen = false,
  children,
}: {
  icon: React.ComponentType<any>;
  title: string;
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
      <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
        {/* 히어로 섹션 */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 text-white p-8 md:p-10">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-40 h-40 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-4xl">🐢</span>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold">소싱 헬퍼</h1>
                <p className="text-white/80 text-sm mt-1">Coupang Sourcing Helper Chrome Extension</p>
              </div>
            </div>
            <p className="text-white/90 text-sm md:text-base leading-relaxed max-w-xl mb-6">
              쿠팡 검색 결과를 자동 분석하여 경쟁도, 소싱 점수, 1688 소싱처 연결,
              마진 계산, <strong>GPT-4o AI 리뷰 분석</strong>까지 한번에 처리하는 크롬 확장프로그램입니다.
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
            { icon: "⭐", label: "소싱 점수", desc: "A~F 등급 평가" },
            { icon: "🔍", label: "1688 연결", desc: "중국 소싱처 검색" },
            { icon: "🧮", label: "마진 계산기", desc: "실시간 수익 계산" },
            { icon: "📈", label: "순위 추적", desc: "키워드 순위 모니터링" },
            { icon: "🔍", label: "상세 파싱", desc: "상품 정보 자동 수집" },
            { icon: "☁️", label: "서버 동기화", desc: "데이터 영구 저장" },
            { icon: "🔮", label: "AI 리뷰 분석", desc: "고객 니즈/불만 파악" },
            { icon: "📄", label: "PDF 보고서", desc: "소싱 분석 보고서" },
            { icon: "🔔", label: "알림 센터", desc: "실시간 변동 알림" },
            { icon: "📖", label: "가이드 내장", desc: "앱 내 사용법 안내" },
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
                <Step num={1} title="확장프로그램 파일 다운로드" desc="위의 다운로드 버튼을 클릭하여 coupang-helper-extension-v7.2.2.zip 파일을 받습니다." />
                <Step num={2} title="압축 해제" desc="다운로드한 zip 파일의 압축을 풀어줍니다." />
                <Step num={3} title="Chrome 확장프로그램 페이지 열기" desc="Chrome 주소창에 chrome://extensions 입력 후 이동합니다." />
                <Step num={4} title="개발자 모드 활성화" desc="우측 상단의 '개발자 모드' 토글을 켜세요." />
                <Step num={5} title="확장프로그램 로드" desc="좌측 상단 '압축해제된 확장 프로그램을 로드합니다' 클릭 → 압축 해제한 폴더를 선택합니다." />
                <Step num={6} title="사이드 패널 열기" desc="쿠팡 사이트에 접속 후, Chrome 우측 상단의 퍼즐 아이콘 → 'Coupang Sourcing Helper' 클릭으로 사이드 패널을 엽니다." />

                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mt-4">
                  <div className="flex gap-2 text-xs">
                    <span className="text-amber-600 font-bold">💡 팁:</span>
                    <span className="text-amber-700">
                      퍼즐 아이콘 옆의 📌 핀 버튼을 클릭하면 도구 모음에 항상 표시됩니다.
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
                </div>
              </div>
            </AccordionSection>

            {/* 3. 후보 탭 */}
            <AccordionSection icon={Star} title="3. ⭐ 후보 탭 — 소싱 후보 관리">
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
                    <p className="text-xs text-gray-500">상품 제목에서 핵심 키워드를 자동 추출하여 1688.com에서 유사 중국 소싱처를 검색합니다.</p>
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

            {/* 4. 순위 추적 */}
            <AccordionSection icon={TrendingUp} title="4. 📈 순위 탭 — 키워드 순위 추적">
              <div className="space-y-4 mt-3">
                <p className="text-sm text-gray-600">
                  특정 키워드에서 내 상품의 순위 변화를 추적할 수 있습니다.
                </p>
                <div className="space-y-3">
                  <Step num={1} title="키워드 등록" desc="순위 탭에서 추적할 검색 키워드와 (선택) 타겟 상품 ID를 입력 후 '+ 추가'를 누릅니다." />
                  <Step num={2} title="자동 기록" desc="쿠팡에서 해당 키워드를 검색할 때마다 자동으로 순위가 기록됩니다." />
                  <Step num={3} title="순위 확인" desc="'📊 보기' 버튼으로 최신 순위를 확인하세요. 타겟 상품은 보라색으로 강조됩니다." />
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="flex gap-2 text-xs">
                    <span className="text-blue-600 font-bold">💡 팁:</span>
                    <span className="text-blue-700">
                      분석 탭에서 상품 옆의 📈 버튼으로도 바로 순위 추적을 등록할 수 있습니다.
                    </span>
                  </div>
                </div>
              </div>
            </AccordionSection>

            {/* 5. 상세 탭 */}
            <AccordionSection icon={Eye} title="5. 🔍 상세 탭 — 상품 상세 분석">
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

            {/* 6. 마진 계산기 */}
            <AccordionSection icon={Calculator} title="6. 🧮 마진 탭 — 마진 계산기">
              <div className="space-y-4 mt-3">
                <p className="text-sm text-gray-600">
                  1688 원가 → 쿠팡 판매가 기준으로 예상 순이익과 마진율을 계산합니다.
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

            {/* 7. 서버 연동 */}
            <AccordionSection icon={Server} title="7. 🔗 서버 탭 — 서버 연동">
              <div className="space-y-3 mt-3">
                <p className="text-sm text-gray-600">
                  lumiriz.kr 계정으로 로그인하면 모든 데이터가 서버에 자동 동기화됩니다.
                </p>
                <div>
                  <h4 className="font-semibold text-sm mb-2">동기화되는 데이터</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      "검색 스냅샷 (검색어, 상품 목록, 통계)",
                      "소싱 후보 목록 및 상태",
                      "순위 추적 데이터",
                      "상품 상세 가격/리뷰 변동",
                    ].map((item, i) => (
                      <div key={i} className="text-xs bg-gray-50 rounded-lg px-3 py-2 flex items-center gap-2">
                        <span className="text-green-500">✅</span> {item}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                    <MonitorSmartphone className="h-4 w-4" /> 웹 대시보드
                  </h4>
                  <p className="text-xs text-gray-500 mb-2">
                    서버에 로그인하면 <strong>lumiriz.kr</strong>의 웹 대시보드에서 확장프로그램 통계를 확인할 수 있습니다.
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-gray-50 rounded-lg p-2">총 검색 횟수, 검색어 종류</div>
                    <div className="bg-gray-50 rounded-lg p-2">자주 검색한 키워드 TOP 10</div>
                    <div className="bg-gray-50 rounded-lg p-2">후보 상태별 현황 및 관리</div>
                    <div className="bg-gray-50 rounded-lg p-2">순위 추적 이력 (7/14/30일)</div>
                  </div>
                </div>
              </div>
            </AccordionSection>

            {/* 8. AI 리뷰 분석 (Phase 6) */}
            <AccordionSection icon={Sparkles} title="8. 🔮 AI 리뷰 분석 (Phase 6 — GPT-4o-mini)">
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
                <div>
                  <h4 className="font-semibold text-sm mb-2">시장 개요에 포함되는 정보</h4>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="bg-indigo-50 rounded-lg p-2 text-center">분석 상품 수</div>
                    <div className="bg-indigo-50 rounded-lg p-2 text-center">경쟁도 점수</div>
                    <div className="bg-indigo-50 rounded-lg p-2 text-center">평균 판매가</div>
                    <div className="bg-amber-50 rounded-lg p-2 text-center">광고 비율</div>
                    <div className="bg-purple-50 rounded-lg p-2 text-center">로켓배송 비율</div>
                    <div className="bg-red-50 rounded-lg p-2 text-center">리뷰 100+ 비율</div>
                  </div>
                </div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                  <div className="flex gap-2 text-xs">
                    <span className="text-emerald-600 font-bold">💡 사용법:</span>
                    <span className="text-emerald-700">
                      웹 대시보드의 "리뷰 분석" 탭에서 키워드를 입력하고 "AI 분석 실행"을 클릭하세요.
                      GPT가 상위 10개 상품 데이터를 분석하여 맞춤형 소싱 전략을 제안합니다.
                    </span>
                  </div>
                </div>
              </div>
            </AccordionSection>

            {/* 9. PDF 보고서 (Phase 6) */}
            <AccordionSection icon={Info} title="9. 📄 PDF 보고서 (Phase 6 NEW)">
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
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="flex gap-2 text-xs">
                    <span className="text-blue-600 font-bold">💡 사용법:</span>
                    <span className="text-blue-700">
                      대시보드 헤더의 "PDF 보고서" 버튼을 클릭하면 자동으로 생성 및 다운로드됩니다.
                    </span>
                  </div>
                </div>
              </div>
            </AccordionSection>

            {/* 10. 알림 센터 (Phase 6) */}
            <AccordionSection icon={Target} title="10. 🔔 알림 센터 (Phase 6 NEW)">
              <div className="space-y-3 mt-3">
                <p className="text-sm text-gray-600">
                  순위 변동, 가격 변화, AI 분석 완료 등의 이벤트를 <strong>실시간 알림</strong>으로 확인합니다.
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
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="flex gap-2 text-xs">
                    <span className="text-amber-600 font-bold">💡 기능:</span>
                    <span className="text-amber-700">
                      헤더의 🔔 벨 아이콘으로 빠르게 확인하거나, 알림 탭에서 상세 관리할 수 있습니다. 30일 지난 알림은 자동 정리됩니다.
                    </span>
                  </div>
                </div>
              </div>
            </AccordionSection>

            {/* 11. 추천 워크플로우 */}
            <AccordionSection icon={Rocket} title="11. 🚀 추천 소싱 워크플로우">
              <div className="mt-3">
                <div className="relative">
                  {[
                    { num: 1, title: "키워드 검색", desc: "쿠팡에서 소싱할 키워드를 검색합니다.", color: "bg-indigo-500" },
                    { num: 2, title: "경쟁도 확인", desc: "분석 탭에서 경쟁 강도가 '약함' 또는 '보통'인지 확인합니다.", color: "bg-blue-500" },
                    { num: 3, title: "소싱 점수 A~B 상품 선별", desc: "'소싱쉬운것' 필터를 켜고 점수 높은 상품을 ⭐ 저장합니다.", color: "bg-green-500" },
                    { num: 4, title: "AI 리뷰 분석", desc: "대시보드에서 AI 분석을 실행하여 고객 니즈와 기회를 파악합니다.", color: "bg-emerald-500" },
                    { num: 5, title: "1688 소싱처 검색", desc: "'🔍 1688' 버튼으로 중국 소싱처를 찾습니다.", color: "bg-orange-500" },
                    { num: 6, title: "마진 계산", desc: "마진 탭에서 예상 수익률을 확인합니다.", color: "bg-amber-500" },
                    { num: 7, title: "순위 추적 등록", desc: "판매 시작 후 키워드 순위를 추적합니다.", color: "bg-purple-500" },
                    { num: 8, title: "PDF 보고서 & 웹 관리", desc: "대시보드에서 PDF 내려받고 모든 데이터를 통합 관리합니다.", color: "bg-pink-500" },
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

            {/* 12. FAQ */}
            <AccordionSection icon={HelpCircle} title="12. ❓ 자주 묻는 질문 (FAQ)">
              <div className="space-y-4 mt-3">
                {[
                  {
                    q: "Chrome 웹 스토어에 없나요?",
                    a: "아직 Chrome 웹 스토어에 출시되지 않았습니다. ZIP 파일을 다운로드한 후 '압축해제된 확장 프로그램 로드' 방식으로 설치해주세요.",
                  },
                  {
                    q: "쿠팡 이외의 사이트에서도 동작하나요?",
                    a: "아니요. 쿠팡 검색 결과 페이지(coupang.com)\uc5d0서만 동작합니다. 상품 상세 페이지도 지원됩니다.",
                  },
                  {
                    q: "데이터는 어디에 저장되나요?",
                    a: "서버 탭에서 로그인하면 lumiriz.kr 서버에 안전하게 저장됩니다. 로그인하지 않으면 브라우저 로컸 저장소에만 저장됩니다.",
                  },
                  {
                    q: "AI 리뷰 분석에 비용이 발생하나요?",
                    a: "AI 분석은 무료로 제공됩니다. OpenAI GPT-4o-mini 기반으로 동작하며, API 장애 시 규칙 기반 분석으로 자동 대체됩니다.",
                  },
                  {
                    q: "업데이트는 어떻게 하나요?",
                    a: "새 버전 ZIP을 다운로드한 후, chrome://extensions에서 기존 확장프로그램을 제거하고 새로 로드하면 됩니다.",
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

            {/* 13. 버전 기록 */}
            <AccordionSection icon={Clock} title="13. 📌 버전 기록">
              <div className="space-y-3 mt-3">
                {[
                  {
                    version: "v7.2.2",
                    date: "2026-03-10",
                    badge: "Latest",
                    changes: [
                      "하이브리드 수집 아키텍처 대개편 — 셀러라이프 수집 방식 통합",
                      "Background HTML Fetch + DOMParser (content script 의존도 제거)",
                      "V2 DOM 자동 감지: React 기반 신규 DOM 셀렉터 지원",
                      "6종 배송 분류: rocket/seller-rocket/global-rocket/normal/overseas/unknown",
                      "data-badge-id 기반 배송 분류 (이미지 URL/alt 텍스트 폴백)",
                      "모바일 리뷰 API: m.coupang.com JSON → 데스크톱 HTML 폴백",
                      "SSR JSON 파싱: __NEXT_DATA__ script 태그 지원",
                      "declarativeNetRequest 헤더 스푸핑 (데스크톱/모바일/리뷰 API 3규칙)",
                      "배치 수집 순차 처리: 키워드당 28~90초 랜덤 딜레이, 실패 시 2~5분 대기",
                      "자동 수집 UI: 시작/일시정지/중지 버튼 + 실시간 진행률 표시",
                      "aria-label 기반 평점 추출 (React DOM 우선 전략)",
                      "hybrid-parser.js 신규 모듈 (≈28KB)",
                    ],
                  },
                  {
                    version: "v6.6.2",
                    date: "2026-03-09",
                    changes: [
                      "평점 파싱률 저조(12%) 오류 수정 — 쿠팡 2026 DOM 변경 대응",
                      "SVG 별점 감지 대폭 강화: clipPath/gradient/opacity/getComputedStyle 6가지 방법",
                      "getComputedStyle 기반 CSS width% 별점 감지 (인라인 style 없는 경우)",
                      "접근성(a11y) 숨겨진 텍스트에서 평점 추출 (sr-only, blind, aria-valuenow)",
                      "calcParseQuality 개선: 리뷰수 기반 추정값도 유효 파싱으로 인정",
                      "경고 임계값 60% → 30%로 하향 (쿠팡 구조 변경 현실 반영)",
                    ],
                  },
                  {
                    version: "v6.6.0",
                    date: "2026-03-09",
                    changes: [
                      "자동 수집(Auto-Collect) 전면 개편: 순차 키워드 검색 → DOM 파싱 → 다음 키워드 루프",
                      "배치 실행 UI: 전체/선택 모드, 배치 크기(5/10/20/50), 진행률 표시, 중지 버튼",
                      "배치 로직 수정: computeKeywordDailyStats 기반 실제 통계 갱신",
                      "useRef 기반 즉시 중지 플래그 (클로저 문제 해결)",
                      "배치 선택용 오렌지 체크박스 분리 (삭제 체크박스와 독립)",
                      "모바일 반응형: 탭 좌우 드래그 스크롤, 소싱폼 경쟁&차별화 겹침 수정",
                      "검색 수요 탭: 배치 수집 컨트롤 카드 추가",
                      "안전 장치: 키워드당 50~90초 딜레이, 최대 200개, 실패 시 2~5분 재시도",
                    ],
                  },
                  {
                    version: "v5.7.0",
                    date: "2026-03-08",
                    changes: [
                      "내 상품 자동 추적 시스템: 소싱 상품/후보/쿠팡 매핑에서 자동 등록",
                      "상품명 기반 키워드 자동 추출 → 추적 키워드에 자동 등록",
                      "검색 시 추적 상품 자동 매칭 → 유사상품/경쟁자/순위 자동 수집",
                      "일일 스냅샷: 가격/리뷰/순위/경쟁자 수 일별 기록 → 추이 그래프",
                      "AI 분석: 가격 추세/리뷰 동향/순위 변동/경쟁자 비교/파생 키워드 제안",
                      "가격 5%+ 변동, 순위 3위+ 변동 시 자동 알림 생성",
                      "내 상품 추적 대시보드 탭: 요약/목록/상세/차트/경쟁 비교",
                    ],
                  },
                  {
                    version: "v5.6.0",
                    date: "2026-03-08",
                    changes: [
                      "검색 수요 추정(Search Demand Estimation) 시스템 구축",
                      "키워드별 일별 통계 자동 계산: 리뷰 증가량 · 판매 추정 · 경쟁도 · 수요점수 · 종합점수",
                      "스냅샷 저장 시 자동으로 일별 통계 생성 (실시간 누적)",
                      "대시보드에 '검색 수요' 탭 추가: 키워드 목록 + 일별 추이 그래프 + 상세 데이터",
                      "키워드 삭제 기능: 개별 삭제 · 체크박스 일괄 삭제 (스냅샷+통계 동시 제거)",
                      "검색 수요 TOP 5 미리보기를 대시보드 개요에 추가",
                      "HiddenScore 산출: reviewGrowth×0.5 + (avgReview/productCount)×0.3 + (1-adRatio)×0.2",
                    ],
                  },
                  {
                    version: "v5.5.7",
                    date: "2026-03-08",
                    changes: [
                      "1688 한국어 직접 전달: 번역 로직 완전 제거 — 1688이 한국어를 자동 분석/번역해줌",
                      "쿠팡 제품 제목을 그대로 1688에 전달 (예: '마음담아 전통 세뻓돈 어린이 용돈봉투')",
                      "encodeURIComponent 제거 → 공백만 +로 치환, &charset=utf8 사용",
                      "Google Translate 번역 → GBK 깨짐 문제 완전 해결 (원인: UTF-8 percent-encoding을 GBK로 해석)",
                      "CNINSIDER URL 형식 수정: /#/product?keywords=&type=text&searchDiff=1",
                      "소싱 팝업에 쿠팡 검색어를 한국어 키워드로 전달",
                    ],
                  },
                  {
                    version: "v5.5.6",
                    date: "2026-03-08",
                    changes: [
                      "1688 UTF-8 모드: 모든 1688 URL에 &ie=utf8 추가",
                      "CNINSIDER 연동: 1688 공식 한국 파트너 사이트 검색 링크 추가",
                    ],
                  },
                  {
                    version: "v5.5.5",
                    date: "2026-03-08",
                    changes: ["1688 URL 인코딩 버그 수정: encodeURIComponent 제거 (GBK 호환)", "1688은 GBK 인코딩 사용 — UTF-8 percent-encoding이 깨지는 문제 해결", "중국어/한국어 키워드를 raw 문자열으로 전달 (공백만 +로 치환)", "콘텐츠 스크립트 + 사이드패널 + 대량검색 + AI분석 모두 수정", "이미지 검색 URL은 encodeURIComponent 유지 (이미지 URL은 UTF-8 정상)"],
                  },
                  {
                    version: "v5.5.4",
                    date: "2026-03-08",
                    changes: ["1688 키워드 버그 수정: 중국어 매핑 없을 때 한국어가 1688 URL에 그대로 전달되던 문제 해결", "1688 검색 4단계 폴백: 서버AI → 로컬사전 → Google Translate → 한국어", "콘솔에 1688 키워드 변환 과정 상세 로그 추가", "AliExpress 버튼: 중국어 대신 한국어 키워드 사용 (AliExpress는 한국어 지원)", "디버그 강화: 확장 버전·사전 매핑 수 콘솔 출력"],
                  },
                  {
                    version: "v5.5.3",
                    date: "2026-03-08",
                    changes: ["검색 페이지: 가격 파싱 완전 재설계 (엘리먼트 레벨 TreeWalker 기반)", "검색 페이지: 적립금·단위가격·배송비를 DOM 요소 수준에서 정밀 제외", "검색 페이지: 할인가 vs 정가(del태그) 자동 구분", "검색 페이지: 평점 5중 방법 (star width + aria-label + em.rating + filled star + 보수적추정)", "검색 페이지: 리뷰 (N,NNN) 괄호 패턴, 단위가격 괄호 정밀 제외", "검색 페이지: 광고 4중 감지, 로켓 5중 감지, 순위 배지 감지", "상세 페이지: 텍스트 패턴 기반 파싱 전면 재작성 (React SPA 호환)", "상세 페이지: 가격·평점·리뷰수·구매수·판매자·로켓 정확 추출", "상세 페이지: OG 이미지 fallback, 페이지 title fallback", "1688 사전 확장: 드라이어/드라이기/고데기/가전/뷰티 등 70개+ 매핑 추가", "1688 키워드: 브랜드 자동 제거, 복합어 자동 매칭 (헤어+드라이어→헤어드라이어)", "통계: 전체 36개 상품 기준 평균가/평점/리뷰/경쟁도 정확 계산"],
                  },
                  {
                    version: "v5.5.2",
                    date: "2026-03-08",
                    changes: ["파싱 엔진 전면 재작성: 클래스 기반 → 텍스트 패턴 기반 (React SPA 호환)", "가격: 적립금·단위가격·배송비 제거 후 판매가만 추출", "평점: aria-label + em.rating 다중 방법"],
                  },
                  {
                    version: "v5.5.1",
                    date: "2026-03-08",
                    changes: ["가격 파싱 수정 시도 (price-value 클래스)", "평점/리뷰/광고/로켓 클래스 기반 수정 시도"],
                  },
                  {
                    version: "v5.5.0",
                    date: "2026-03-08",
                    changes: ["마켓 대시보드 패널 — 시장 분석 + 미니 차트 + TOP3", "시장 개요: 상품수·평균가·평점·평균리뷰·광고·로켓", "경쟁 강도 시각화: 점수 + 진행 바", "미니 차트: 가격 분포 히스토그램 + 리뷰 분포 히스토그램", "TOP3 상품만 간결 표시 (1688/Ali/저장 버튼)", "패널 드래그 이동 + 접기/펼치기"],
                  },
                  {
                    version: "v5.4.0",
                    date: "2026-03-08",
                    changes: ["셀록홈즈 스타일 플로팅 패널", "모든 상품 스크롤 리스트", "패널 드래그 + 접기/펼치기"],
                  },
                  {
                    version: "v5.3.0",
                    date: "2026-03-08",
                    changes: ["카드별 플로팅 UI — 상품마다 자동 오버레이 표시", "소싱점수 + 가격 + 리뷰 + 1688/저장 버튼", "상단 상태바로 파싱 현황 확인", "서버 자동 전송 (UI는 가볍게, 서버는 무겁게)", "history.pushState 오버라이드 제거 → 쿠팡 React 충돌 해결", "background.js SPA 재주입 제거 → 서비스워커 안정화"],
                  },
                  {
                    version: "v4.0.0",
                    date: "2026-03-08",
                    changes: ["WING 셀러센터 인기상품 데이터 수집", "OpenAI GPT-4o-mini AI 리뷰 분석 연동", "시장 개요 통계 추가"],
                  },
                  {
                    version: "v3.4.0",
                    date: "2026-03-07",
                    changes: ["Phase 6: ext_notifications / ext_review_analyses 테이블 추가", "AI 리뷰 분석 (규칙 기반)", "PDF 보고서 생성", "알림 센터"],
                  },
                  {
                    version: "v3.3.0",
                    date: "2026-03-06",
                    changes: ["Phase 4-5: 트렌드 분석, AI 소싱 추천", "경쟁자 모니터링", "CSV/PDF 내보내기", "웹 대시보드 7개 탭"],
                  },
                  {
                    version: "v3.0.0",
                    date: "2026-03-01",
                    changes: ["Phase 1-3: 핵심 기능 출시", "검색 분석, 후보 관리, 순위 추적", "상세 파싱, 마진 계산기", "서버 동기화"],
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
                          <span className="text-indigo-400 mt-0.5">\u2022</span> {c}
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
          🐢 Coupang Sourcing Helper v{EXTENSION_VERSION} · lumiriz.kr
        </div>
      </div>
    </DashboardLayout>
  );
}
