import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/useMobile";
import {
  LayoutDashboard, LogOut, PanelLeft, FileText, Package,
  FlaskConical, CalendarCheck, User, Settings, Users, Sparkles, TrendingUp, ShoppingBag, Puzzle, BookOpen, BarChart3,
  Activity, Target, Search, Calculator, Gem, Megaphone, PenTool, Send, Bot, Sliders,
  Calendar, Building, FlaskConical as Flask, FileBarChart, Library, ChevronDown, Dices, Scale, Camera, Ship, Flame, Radar, ScanLine, Store, ListChecks, Tag,
} from "lucide-react";
import { CSSProperties, Fragment, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';

// ★ v8.7.1: 확장프로그램 최신 버전 안내 배너
function ExtensionUpgradeBanner() {
  const { data: versionInfo } = trpc.extension.getExtensionLatestVersion.useQuery(
    undefined,
    { staleTime: 1000 * 60 * 30, refetchOnWindowFocus: false } // 30분 캐시
  );
  const [dismissed, setDismissed] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);

  if (!versionInfo || dismissed) return null;

  const latestVersion = versionInfo.version;
  // 이 버전을 이미 닫았으면 표시하지 않음 (localStorage — 브라우저 종료 후에도 유지)
  const dismissKey = `sh-upgrade-seen-${latestVersion}`;
  if (localStorage.getItem(dismissKey)) return null;

  const handleDismiss = () => {
    localStorage.setItem(dismissKey, '1');
    setDismissed(true);
  };

  return (
    <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="text-2xl mt-0.5">🧩</span>
          <div>
            <p className="font-semibold text-sm text-slate-100">
              소싱 헬퍼 확장프로그램 v{latestVersion} 사용 가능
            </p>
            {showChangelog && versionInfo.changelog && (
              <ul className="mt-2 space-y-1">
                {versionInfo.changelog.map((item: string, i: number) => (
                  <li key={i} className="text-xs text-pink-600 flex items-center gap-1.5">
                    <span className="text-pink-400">✦</span> {item}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-3 mt-2.5">
              <a
                href={versionInfo.downloadUrl}
                download
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pink-500 text-white text-xs font-medium hover:bg-pink-600 transition-colors shadow-sm"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                v{latestVersion} 다운로드
              </a>
              <button
                onClick={() => setShowChangelog(!showChangelog)}
                className="text-xs text-pink-500 hover:text-pink-700 underline decoration-dotted"
              >
                {showChangelog ? '변경사항 접기' : '변경사항 보기'}
              </button>
              <span className="text-[10px] text-gray-400">ZIP 압축해제 → 덮어쓰기 → chrome://extensions 새로고침</span>
            </div>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="text-pink-300 hover:text-pink-500 transition-colors shrink-0 mt-0.5"
          title="닫기"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>
  );
}

// ★ 판매 채널(마켓) 레지스트리 — 확장형. 아마존·일본 등은 여기에 추가만 하면 열림.
type ChannelId = "coupang" | "reverse";
type Channel = { id: ChannelId; label: string; emoji: string; tagline: string };
const CHANNELS: Channel[] = [
  { id: "coupang", label: "쿠팡 로켓그로스", emoji: "🚀", tagline: "수입 → 쿠팡 판매" },
  { id: "reverse", label: "역직구", emoji: "🌏", tagline: "국내매입 → 해외판매" },
  // 향후: { id: "amazon", label: "아마존 US", emoji: "🇺🇸", tagline: "국내 → Amazon" },
];
const CHANNEL_KEY = "biz-channel";

type MenuItem = {
  icon: any;
  label: string;
  path: string;
  emoji: string;
  superAdminOnly?: boolean;
  section: "main" | "advanced";
  group?: string;
  channel?: ChannelId; // 없으면 coupang(기존)로 간주
  hidden?: boolean; // 사이드바에서만 숨김(라우트는 유지) — 레거시/중복 정리용
};

// ★ UX 개편(R1): 초보자용 메인 4개 + 나머지는 "고급"으로 접기.
//   기존 페이지는 삭제하지 않고 고급으로 이동 → 회귀 안전.
const menuItems: MenuItem[] = [
  // ===== 메인 (초보자는 이것만 봐도 됨) =====
  { icon: LayoutDashboard, label: "홈", path: "/home", emoji: "🏠", section: "main" },
  { icon: Gem, label: "소싱", path: "/sourcing", emoji: "🔎", section: "main" },
  { icon: Dices, label: "재고 배팅", path: "/inventory-bet", emoji: "🎲", section: "main" },
  { icon: Calculator, label: "계산기", path: "/quick-margin", emoji: "🧮", section: "main" },
  { icon: Package, label: "내 소싱", path: "/my-sourcing", emoji: "📌", section: "main" },
  { icon: TrendingUp, label: "판매 관리", path: "/dashboard", emoji: "📊", section: "main" },

  // ===== 역직구 채널 — 엔진 우선(입력→인사이트→큐→현장) / 운영. 레거시는 숨김 =====
  { icon: LayoutDashboard, label: "역직구 홈", path: "/reverse", emoji: "🏠", section: "main", channel: "reverse", group: "home" },
  { icon: Tag, label: "브랜드 관리", path: "/reverse/brands", emoji: "🏷", section: "main", channel: "reverse", group: "home" },
  // 엔진 (핵심 흐름)
  { icon: Store, label: "판매자 엑셀", path: "/reverse/seller", emoji: "🏬", section: "main", channel: "reverse", group: "engine" },
  { icon: BarChart3, label: "상품 발굴", path: "/reverse/insights", emoji: "📊", section: "main", channel: "reverse", group: "engine" },
  { icon: ListChecks, label: "소싱 큐", path: "/reverse/queue", emoji: "🧭", section: "main", channel: "reverse", group: "engine" },
  { icon: ScanLine, label: "사진 소싱", path: "/reverse/photo", emoji: "📸", section: "main", channel: "reverse", group: "engine" },
  { icon: Scale, label: "정밀 계산기", path: "/reverse/arbitrage", emoji: "⚖️", section: "main", channel: "reverse", group: "engine" },
  // 운영 (매입 후)
  { icon: Package, label: "매입 관리", path: "/reverse/purchases", emoji: "📦", section: "main", channel: "reverse", group: "ops" },
  { icon: Ship, label: "수출 관리", path: "/reverse/exports", emoji: "🌏", section: "main", channel: "reverse", group: "ops" },
  { icon: BarChart3, label: "판매 분석", path: "/reverse/sales", emoji: "📈", section: "main", channel: "reverse", group: "ops" },
  { icon: Activity, label: "내 상품 관리", path: "/reverse/my-products", emoji: "📊", section: "main", channel: "reverse", group: "ops" },
  { icon: BookOpen, label: "판매자 가이드", path: "/reverse/guide", emoji: "📖", section: "main", channel: "reverse", group: "ops" },
  // 숨김(중복) — 라우트/딥링크는 유지, 사이드바에서만 감춤
  { icon: Flame, label: "오늘 사야 할 상품", path: "/reverse/deals", emoji: "🔥", section: "main", channel: "reverse", group: "ops", hidden: true },
  { icon: FileBarChart, label: "엑셀 업로드", path: "/reverse/import", emoji: "📄", section: "main", channel: "reverse", group: "ops", hidden: true },

  // ===== 고급 (더보기) =====
  // 소싱 상세
  { icon: Sliders, label: "상세 계산기", path: "/margin", emoji: "🧮", section: "advanced", group: "소싱 상세" },
  { icon: Gem, label: "니치 파인더", path: "/niche-finder", emoji: "💎", section: "advanced", group: "소싱 상세" },
  { icon: Activity, label: "검색 수요", path: "/demand", emoji: "📊", section: "advanced", group: "소싱 상세" },
  { icon: Sparkles, label: "AI 제품 발견", path: "/discovery", emoji: "🔍", section: "advanced", group: "소싱 상세" },
  // 시장 분석
  { icon: BarChart3, label: "헬퍼 대시보드", path: "/extension", emoji: "🔬", section: "advanced", group: "시장 분석" },
  { icon: Puzzle, label: "소싱 헬퍼", path: "/sourcing-helper", emoji: "🐢", section: "advanced", group: "시장 분석" },
  // 판매 관리 상세
  { icon: TrendingUp, label: "Daily Profit", path: "/daily-profit", emoji: "💰", section: "advanced", group: "판매 관리 상세" },
  { icon: ShoppingBag, label: "쿠팡 관리", path: "/coupang", emoji: "🛍️", section: "advanced", group: "판매 관리 상세" },
  { icon: CalendarCheck, label: "주간 리뷰", path: "/weekly-review", emoji: "📅", section: "advanced", group: "판매 관리 상세" },
  // 마케팅
  { icon: Megaphone, label: "마케팅 Today", path: "/marketing", emoji: "📢", section: "advanced", group: "마케팅" },
  { icon: PenTool, label: "콘텐츠 생성", path: "/marketing/content", emoji: "✍️", section: "advanced", group: "마케팅" },
  { icon: Send, label: "발행 큐", path: "/marketing/queue", emoji: "📤", section: "advanced", group: "마케팅" },
  { icon: BarChart3, label: "성과 분석", path: "/marketing/analytics", emoji: "📊", section: "advanced", group: "마케팅" },
  { icon: Bot, label: "AI 브리핑", path: "/marketing/briefing", emoji: "🤖", section: "advanced", group: "마케팅" },
  { icon: Calendar, label: "콘텐츠 캘린더", path: "/marketing/calendar", emoji: "📅", section: "advanced", group: "마케팅" },
  { icon: Flask, label: "A/B 테스트", path: "/marketing/ab-test", emoji: "🧪", section: "advanced", group: "마케팅" },
  { icon: FileBarChart, label: "성과 리포트", path: "/marketing/reports", emoji: "📋", section: "advanced", group: "마케팅" },
  { icon: Library, label: "자료실", path: "/marketing/library", emoji: "📚", section: "advanced", group: "마케팅" },
  { icon: Building, label: "고객사 관리", path: "/marketing/clients", emoji: "🏢", section: "advanced", group: "마케팅" },
  { icon: Sliders, label: "마케팅 설정", path: "/marketing/settings", emoji: "⚙️", section: "advanced", group: "마케팅" },
  // 도구
  { icon: BookOpen, label: "확장프로그램", path: "/extension-guide", emoji: "🧩", section: "advanced", group: "도구" },
  { icon: BookOpen, label: "사용 매뉴얼", path: "/manual", emoji: "📖", section: "advanced", group: "도구" },
  { icon: User, label: "내 프로필", path: "/profile", emoji: "👤", section: "advanced", group: "도구" },
  { icon: Settings, label: "계정 설정", path: "/settings/accounts", emoji: "⚙️", section: "advanced", group: "도구" },
  { icon: Users, label: "사용자 관리", path: "/user-management", superAdminOnly: true, emoji: "👥", section: "advanced", group: "도구" },
];

const channelOf = (i: MenuItem): ChannelId => i.channel ?? "coupang";
const mainItemsFor = (ch: ChannelId) =>
  menuItems.filter(i => i.section === "main" && channelOf(i) === ch && !i.hidden);
const advancedGroups = ["소싱 상세", "시장 분석", "판매 관리 상세", "마케팅", "도구"];

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  // Redirect to home if not authenticated (in useEffect to avoid DOM issues)
  useEffect(() => {
    if (!loading && !user) {
      window.location.href = "/";
    }
  }, [loading, user]);

  if (loading || !user) {
    return <DashboardLayoutSkeleton />;
  }

  return (
    <SidebarProvider
      style={{
        "--sidebar-width": `${sidebarWidth}px`,
        "--sidebar": "#0a0b1e",
        "--sidebar-foreground": "#c7cde0",
        "--sidebar-border": "rgba(255,255,255,0.08)",
        "--sidebar-accent": "rgba(255,255,255,0.06)",
        "--sidebar-accent-foreground": "#e6eaf7",
        "--sidebar-ring": "#22d3ee",
      } as CSSProperties}
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({ children, setSidebarWidth }: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const activeMenuItem = menuItems.find(item => item.path === location);
  const isMobile = useIsMobile();

  // 판매 채널(마켓) 전환 — 확장형. 선택 채널의 메뉴만 노출.
  const [channel, setChannel] = useState<ChannelId>(() => {
    if (typeof window !== "undefined" && window.location.pathname.startsWith("/reverse")) return "reverse";
    return ((localStorage.getItem(CHANNEL_KEY) as ChannelId) || "coupang");
  });
  useEffect(() => { localStorage.setItem(CHANNEL_KEY, channel); }, [channel]);
  useEffect(() => {
    // /reverse 딥링크 진입 시 채널 동기화
    if (location.startsWith("/reverse") && channel !== "reverse") setChannel("reverse");
  }, [location]); // eslint-disable-line react-hooks/exhaustive-deps
  const mainItems = mainItemsFor(channel);
  const switchChannel = (id: ChannelId) => {
    setChannel(id);
    setLocation(id === "reverse" ? "/reverse" : "/home");
  };

  // 고급 메뉴 접기/펼치기 — 현재 위치가 고급 항목이면 자동으로 펼쳐 활성 항목이 보이게
  const inAdvanced = menuItems.some(i => i.section === "advanced" && i.path === location);
  const [showAdvanced, setShowAdvanced] = useState(inAdvanced);
  useEffect(() => {
    if (inAdvanced) setShowAdvanced(true);
  }, [inAdvanced]);

  useEffect(() => {
    if (isCollapsed) setIsResizing(false);
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar collapsible="icon" className="border-r-0" disableTransition={isResizing}>
          {/* Sidebar header with logo */}
          <SidebarHeader className="h-16 justify-center border-b border-white/10">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-white/10 rounded-xl transition-colors shrink-0"
              >
                <PanelLeft className="h-4 w-4 text-cyan-300" />
              </button>
              {!isCollapsed && (
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-pink-400 animate-sparkle" />
                  <span className="font-bold tracking-tight text-lg gradient-text">
                    Sourcing Lab
                  </span>
                </div>
              )}
            </div>
          </SidebarHeader>

          {/* Menu items */}
          <SidebarContent className="gap-0 pt-2">
            {/* ===== 판매 채널 스위처 ===== */}
            {!isCollapsed && (
              <div className="px-3 pt-1 pb-2">
                <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-white/5 border border-white/10">
                  {CHANNELS.map(ch => {
                    const on = channel === ch.id;
                    return (
                      <button
                        key={ch.id}
                        onClick={() => switchChannel(ch.id)}
                        title={ch.tagline}
                        className={`rounded-lg py-1.5 text-[12px] font-semibold transition-all ${
                          on
                            ? "bg-white/[0.10] text-white shadow-[0_0_14px_rgba(34,211,238,0.18)] border border-cyan-400/30"
                            : "text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        <span className="mr-1">{ch.emoji}</span>{ch.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <SidebarMenu className="px-2 py-1">
              {/* ===== 메인 (초보자) ===== */}
              {mainItems.map((item, idx) => {
                const isActive = location === item.path;
                const prev = mainItems[idx - 1];
                const showDivider = !isCollapsed && idx > 0 && !!item.group && prev?.group !== item.group;
                return (
                  <Fragment key={item.path}>
                  {showDivider && <div className="my-1.5 mx-3 border-t border-white/10" />}
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => setLocation(item.path)}
                      tooltip={item.label}
                      className={`h-11 transition-all rounded-xl my-0.5 ${
                        isActive
                          ? "bg-white/[0.08] text-white font-semibold border border-cyan-400/30 shadow-[0_0_16px_rgba(34,211,238,0.15)]"
                          : "text-slate-300 hover:bg-white/5 font-medium"
                      }`}
                    >
                      <item.icon className={`h-4 w-4 transition-all ${
                        isActive ? "text-cyan-300" : "text-slate-400"
                      }`} />
                      <span className="flex items-center gap-2">
                        {!isCollapsed && <span className="text-base">{item.emoji}</span>}
                        <span className="text-[15px]">{item.label}</span>
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  </Fragment>
                );
              })}

              {/* ===== 고급 (더보기) 토글 — 쿠팡 채널에만 ===== */}
              {!isCollapsed && channel === "coupang" && (
                <button
                  onClick={() => setShowAdvanced(v => !v)}
                  className="flex items-center justify-between w-full px-3 mt-3 mb-1 py-1.5 text-[11px] font-semibold text-slate-500 hover:text-cyan-300 transition-colors rounded-lg hover:bg-white/5"
                >
                  <span className="uppercase tracking-wider">고급 기능</span>
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                </button>
              )}

              {/* ===== 고급 그룹들 (쿠팡 채널에만) ===== */}
              {showAdvanced && channel === "coupang" && advancedGroups.map(group => {
                const groupItems = menuItems
                  .filter(item => item.section === "advanced" && item.group === group)
                  .filter(item => !item.superAdminOnly || user?.isSuperAdmin);
                if (!groupItems.length) return null;
                return (
                  <div key={group}>
                    {!isCollapsed && (
                      <div className="text-[10px] font-semibold text-gray-300 uppercase tracking-wider px-3 pt-2 pb-1">
                        {group}
                      </div>
                    )}
                    {isCollapsed && <div className="h-2" />}
                    {groupItems.map(item => {
                      const isActive = location === item.path;
                      return (
                        <SidebarMenuItem key={item.path}>
                          <SidebarMenuButton
                            isActive={isActive}
                            onClick={() => setLocation(item.path)}
                            tooltip={item.label}
                            className={`h-9 transition-all font-normal rounded-xl my-0.5 ${
                              isActive
                                ? "bg-white/[0.08] text-white font-medium border border-cyan-400/30"
                                : "text-slate-400 hover:bg-white/5"
                            }`}
                          >
                            <item.icon className={`h-4 w-4 transition-all ${
                              isActive ? "text-cyan-300" : "text-slate-500"
                            }`} />
                            <span className="flex items-center gap-2 text-[13px]">
                              {!isCollapsed && <span className="text-sm">{item.emoji}</span>}
                              {item.label}
                            </span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </div>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          {/* User footer */}
          <SidebarFooter className="p-3 border-t border-white/10">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/5 transition-all w-full text-left group-data-[collapsible=icon]:justify-center">
                  <Avatar className="h-11 w-11 border-2 border-white/15 shrink-0 shadow-sm">
                    {(user as any)?.profileImage ? (
                      <AvatarImage src={(user as any).profileImage} alt={user?.name || ""} className="object-cover" />
                    ) : null}
                    <AvatarFallback className="text-sm font-bold bg-gradient-to-br from-pink-400 to-purple-500 text-white">
                      {user?.name?.charAt(0).toUpperCase() || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate">{user?.name || "-"}</p>
                    <p className="text-xs text-slate-500 truncate mt-0.5">{user?.email || "-"}</p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 border-pink-100">
                <DropdownMenuItem 
                  onClick={async () => { await logout(); window.location.href = "/"; }} 
                  className="cursor-pointer text-pink-600 focus:text-pink-700 focus:bg-pink-50"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>로그아웃</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>

        {/* Resize handle */}
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-cyan-400/30 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => { if (!isCollapsed) setIsResizing(true); }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset className="flex flex-col min-h-screen app-shell-bg">
        {/* Mobile header */}
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-[#0a0b1e]/80 backdrop-blur-md px-4 lg:hidden">
          <button onClick={toggleSidebar} className="h-9 w-9 flex items-center justify-center hover:bg-white/10 rounded-xl">
            <PanelLeft className="h-5 w-5 text-cyan-300" />
          </button>
          {activeMenuItem && (
            <div className="flex items-center gap-2">
              <span className="text-base">{activeMenuItem.emoji}</span>
              <h1 className="text-sm font-semibold gradient-text">{activeMenuItem.label}</h1>
            </div>
          )}
        </header>
        <main className="flex-1 p-4 md:p-6">
          <ExtensionUpgradeBanner />
          {children}
        </main>
      </SidebarInset>
    </>
  );
}
