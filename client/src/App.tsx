import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Dashboard from "./pages/Dashboard";
import DailySourcing from "./pages/DailySourcing";
import Products from "./pages/Products";
import ProductDetail from "./pages/ProductDetail";
import TestCandidates from "./pages/TestCandidates";
import WeeklyReview from "./pages/WeeklyReview";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Profile from "./pages/Profile";
import PendingApproval from "./pages/PendingApproval";
import Landing from "./pages/Landing";
import UserManagement from "./pages/UserManagement";
import AccountSettings from "./pages/AccountSettings";
import DailyProfitBoard from "./pages/DailyProfitBoard";
import CoupangManager from "./pages/CoupangManager";
import SourcingHelper from "./pages/SourcingHelper";
import ExtensionDashboard from "./pages/ExtensionDashboard";
import ExtensionGuide from "./pages/ExtensionGuide";
import Manual from "./pages/Manual";
import SearchDemand from "./pages/SearchDemand";
import MarginCalculator from "./pages/MarginCalculator";
import NicheFinder from "./pages/NicheFinder";
import ProductDiscovery from "./pages/ProductDiscovery";
import KeywordSourcing from "./pages/KeywordSourcing";
import KeywordSourcingResults from "./pages/KeywordSourcingResults";
import MySourcing from "./pages/MySourcing";
import InventoryBet from "./pages/InventoryBet";
import Home from "./pages/Home";
import QuickMargin from "./pages/QuickMargin";
import Reverse from "./pages/Reverse";
import ReverseArbitrage from "./pages/ReverseArbitrage";
import ReverseBetting from "./pages/ReverseBetting";
import ReversePurchases from "./pages/ReversePurchases";
import ReverseExports from "./pages/ReverseExports";
import ReverseSku from "./pages/ReverseSku";
import ReverseDeals from "./pages/ReverseDeals";
import ReverseImport from "./pages/ReverseImport";
import ReverseMyProducts from "./pages/ReverseMyProducts";
import ReverseMarket from "./pages/ReverseMarket";
import ReverseSkuDetail from "./pages/ReverseSkuDetail";
import MarketingDashboard from "./pages/marketing/MarketingDashboard";
import ContentManager from "./pages/marketing/ContentManager";
import PublishQueue from "./pages/marketing/PublishQueue";
import MarketingAnalytics from "./pages/marketing/MarketingAnalytics";
import MarketingSettings from "./pages/marketing/MarketingSettings";
import AiBriefing from "./pages/marketing/AiBriefing";
import ContentCalendar from "./pages/marketing/ContentCalendar";
import ClientManager from "./pages/marketing/ClientManager";
import AbTestPage from "./pages/marketing/AbTestPage";
import ReportsPage from "./pages/marketing/ReportsPage";
import LibraryPage from "./pages/marketing/LibraryPage";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/login" component={Landing} />
      <Route path="/home" component={Home} />
      <Route path="/reverse" component={Reverse} />
      <Route path="/reverse/arbitrage" component={ReverseArbitrage} />
      <Route path="/reverse/betting" component={ReverseBetting} />
      <Route path="/reverse/purchases" component={ReversePurchases} />
      <Route path="/reverse/exports" component={ReverseExports} />
      <Route path="/reverse/sku" component={ReverseSku} />
      <Route path="/reverse/sku/:id" component={ReverseSkuDetail} />
      <Route path="/reverse/deals" component={ReverseDeals} />
      <Route path="/reverse/import" component={ReverseImport} />
      <Route path="/reverse/my-products" component={ReverseMyProducts} />
      <Route path="/reverse/market" component={ReverseMarket} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/daily" component={DailySourcing as any} />
      <Route path="/daily-profit" component={DailyProfitBoard} />
      <Route path="/products" component={Products as any} />
      <Route path="/products/:id" component={ProductDetail} />
      <Route path="/test-candidates" component={TestCandidates as any} />
      <Route path="/weekly-review" component={WeeklyReview} />
      <Route path="/register" component={Register} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/profile" component={Profile} />
      <Route path="/pending-approval" component={PendingApproval} />
      <Route path="/user-management" component={UserManagement} />
      <Route path="/settings/accounts" component={AccountSettings} />
      <Route path="/coupang" component={CoupangManager} />
      <Route path="/demand" component={SearchDemand} />
      <Route path="/quick-margin" component={QuickMargin} />
      <Route path="/margin" component={MarginCalculator} />
      <Route path="/sourcing" component={KeywordSourcing} />
      <Route path="/sourcing/results" component={KeywordSourcingResults} />
      <Route path="/my-sourcing" component={MySourcing} />
      <Route path="/inventory-bet" component={InventoryBet} />
      <Route path="/niche-finder" component={NicheFinder} />
      <Route path="/discovery" component={ProductDiscovery} />
      <Route path="/sourcing-helper" component={SourcingHelper} />
      <Route path="/extension" component={ExtensionDashboard} />
      <Route path="/extension-guide" component={ExtensionGuide} />
      <Route path="/manual" component={Manual} />
      <Route path="/marketing" component={MarketingDashboard} />
      <Route path="/marketing/content" component={ContentManager} />
      <Route path="/marketing/queue" component={PublishQueue} />
      <Route path="/marketing/analytics" component={MarketingAnalytics} />
      <Route path="/marketing/settings" component={MarketingSettings} />
      <Route path="/marketing/briefing" component={AiBriefing} />
      <Route path="/marketing/calendar" component={ContentCalendar} />
      <Route path="/marketing/clients" component={ClientManager} />
      <Route path="/marketing/ab-test" component={AbTestPage} />
      <Route path="/marketing/reports" component={ReportsPage} />
      <Route path="/marketing/library" component={LibraryPage} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
