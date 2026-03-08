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
      <Route path="/sourcing-helper" component={SourcingHelper} />
      <Route path="/extension" component={ExtensionDashboard} />
      <Route path="/extension-guide" component={ExtensionGuide} />
      <Route path="/manual" component={Manual} />
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
