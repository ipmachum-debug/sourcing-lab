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
import ViralMonitor from "./pages/marketing/ViralMonitor";
import TrendsPage from "./pages/marketing/TrendsPage";
import ReviewsPage from "./pages/marketing/ReviewsPage";
import VideoStudio from "./pages/marketing/VideoStudio";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/login" component={Landing} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/daily" component={DailySourcing} />
      <Route path="/daily-profit" component={DailyProfitBoard} />
      <Route path="/products" component={Products} />
      <Route path="/products/:id" component={ProductDetail} />
      <Route path="/test-candidates" component={TestCandidates} />
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
      <Route path="/margin" component={MarginCalculator} />
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
      <Route path="/marketing/viral" component={ViralMonitor} />
      <Route path="/marketing/trends" component={TrendsPage} />
      <Route path="/marketing/reviews" component={ReviewsPage} />
      <Route path="/marketing/video" component={VideoStudio} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
