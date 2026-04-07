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
  Calendar, Building, FlaskConical as Flask, FileBarChart, Library,
  Flame, TrendingUp as TrendIcon, MessageSquare,
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
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
    <div className="mb-4 rounded-xl border border-pink-200 bg-gradient-to-r from-pink-50 to-purple-50 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="text-2xl mt-0.5">🧩</span>
          <div>
            <p className="font-semibold text-sm text-pink-800">
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

type MenuItem = {
  icon: any;
  label: string;
  path: string;
  emoji: string;
  superAdminOnly?: boolean;
  group?: string;
};

const menuItems: MenuItem[] = [
  // 소싱
  { icon: Activity, label: "검색 수요", path: "/demand", emoji: "📊", group: "소싱" },
  { icon: Gem, label: "니치 파인더", path: "/niche-finder", emoji: "💎", group: "소싱" },
  { icon: Sparkles, label: "AI 제품 발견", path: "/discovery", emoji: "🔍", group: "소싱" },
  { icon: Calculator, label: "마진 계산기", path: "/margin", emoji: "💰", group: "소싱" },
  { icon: FileText, label: "데일리 소싱", path: "/daily", emoji: "📝", group: "소싱" },
  { icon: Package, label: "전체 상품", path: "/products", emoji: "📦", group: "소싱" },
  { icon: FlaskConical, label: "테스트 후보", path: "/test-candidates", emoji: "🧪", group: "소싱" },
  // 시장 분석
  { icon: BarChart3, label: "헬퍼 대시보드", path: "/extension", emoji: "🔬", group: "시장 분석" },
  { icon: Puzzle, label: "소싱 헬퍼", path: "/sourcing-helper", emoji: "🐢", group: "시장 분석" },
  // 판매 관리
  { icon: LayoutDashboard, label: "대시보드", path: "/dashboard", emoji: "🏠", group: "판매 관리" },
  { icon: TrendingUp, label: "Daily Profit", path: "/daily-profit", emoji: "💰", group: "판매 관리" },
  { icon: ShoppingBag, label: "쿠팡 관리", path: "/coupang", emoji: "🛍️", group: "판매 관리" },
  { icon: CalendarCheck, label: "주간 리뷰", path: "/weekly-review", emoji: "📅", group: "판매 관리" },
  // 마케팅
  { icon: Megaphone, label: "마케팅 Today", path: "/marketing", emoji: "📢", group: "마케팅" },
  { icon: PenTool, label: "콘텐츠 생성", path: "/marketing/content", emoji: "✍️", group: "마케팅" },
  { icon: Send, label: "발행 큐", path: "/marketing/queue", emoji: "📤", group: "마케팅" },
  { icon: BarChart3, label: "성과 분석", path: "/marketing/analytics", emoji: "📊", group: "마케팅" },
  { icon: Bot, label: "AI 브리핑", path: "/marketing/briefing", emoji: "🤖", group: "마케팅" },
  { icon: Calendar, label: "콘텐츠 캘린더", path: "/marketing/calendar", emoji: "📅", group: "마케팅" },
  { icon: Flask, label: "A/B 테스트", path: "/marketing/ab-test", emoji: "🧪", group: "마케팅" },
  { icon: FileBarChart, label: "성과 리포트", path: "/marketing/reports", emoji: "📋", group: "마케팅" },
  { icon: Library, label: "자료실", path: "/marketing/library", emoji: "📚", group: "마케팅" },
  // 바이럴
  { icon: Flame, label: "바이럴 모니터", path: "/marketing/viral", emoji: "🔥", group: "바이럴" },
  { icon: TrendIcon, label: "트렌드 감지", path: "/marketing/trends", emoji: "📈", group: "바이럴" },
  { icon: MessageSquare, label: "리뷰/후기", path: "/marketing/reviews", emoji: "💬", group: "바이럴" },
  // 마케팅 설정
  { icon: Building, label: "고객사 관리", path: "/marketing/clients", emoji: "🏢", group: "마케팅" },
  { icon: Sliders, label: "마케팅 설정", path: "/marketing/settings", emoji: "⚙️", group: "마케팅" },
  // 도구
  { icon: BookOpen, label: "확장프로그램", path: "/extension-guide", emoji: "🧩", group: "도구" },
  { icon: BookOpen, label: "사용 매뉴얼", path: "/manual", emoji: "📖", group: "도구" },
  { icon: User, label: "내 프로필", path: "/profile", emoji: "👤", group: "도구" },
  { icon: Settings, label: "계정 설정", path: "/settings/accounts", emoji: "⚙️", group: "도구" },
  { icon: Users, label: "사용자 관리", path: "/user-management", superAdminOnly: true, emoji: "👥", group: "도구" },
];

const menuGroups = ["소싱", "시장 분석", "판매 관리", "마케팅", "바이럴", "도구"];

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
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
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
          <SidebarHeader className="h-16 justify-center border-b border-pink-100/50">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-pink-50 rounded-xl transition-colors shrink-0"
              >
                <PanelLeft className="h-4 w-4 text-pink-400" />
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
            <SidebarMenu className="px-2 py-1">
              {menuGroups.map(group => {
                const groupItems = menuItems
                  .filter(item => item.group === group)
                  .filter(item => !item.superAdminOnly || user?.isSuperAdmin);
                if (!groupItems.length) return null;
                return (
                  <div key={group}>
                    {!isCollapsed && (
                      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-3 pt-3 pb-1">
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
                            className={`h-10 transition-all font-normal rounded-xl my-0.5 ${
                              isActive
                                ? "bg-gradient-to-r from-pink-50 to-purple-50 text-pink-700 font-medium border border-pink-100/60"
                                : "hover:bg-pink-50/50"
                            }`}
                          >
                            <item.icon className={`h-4 w-4 transition-all ${
                              isActive ? "text-pink-500" : "text-muted-foreground"
                            }`} />
                            <span className="flex items-center gap-2">
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
          <SidebarFooter className="p-3 border-t border-pink-100/50">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-pink-50/60 transition-all w-full text-left group-data-[collapsible=icon]:justify-center">
                  <Avatar className="h-11 w-11 border-2 border-pink-200 shrink-0 shadow-sm">
                    {(user as any)?.profileImage ? (
                      <AvatarImage src={(user as any).profileImage} alt={user?.name || ""} className="object-cover" />
                    ) : null}
                    <AvatarFallback className="text-sm font-bold bg-gradient-to-br from-pink-400 to-purple-500 text-white">
                      {user?.name?.charAt(0).toUpperCase() || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate">{user?.name || "-"}</p>
                    <p className="text-xs text-pink-400/80 truncate mt-0.5">{user?.email || "-"}</p>
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
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-pink-300/30 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => { if (!isCollapsed) setIsResizing(true); }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset className="flex flex-col min-h-screen pastel-page-bg">
        {/* Mobile header */}
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b border-pink-100/50 bg-white/80 backdrop-blur-md px-4 lg:hidden">
          <button onClick={toggleSidebar} className="h-9 w-9 flex items-center justify-center hover:bg-pink-50 rounded-xl">
            <PanelLeft className="h-5 w-5 text-pink-400" />
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
