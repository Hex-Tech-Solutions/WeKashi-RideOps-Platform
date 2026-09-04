import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import Landing from "./pages/Landing";
import Auth from "./pages/Auth";
import DriverApp from "./pages/driver/DriverApp";
import NotFound from "./pages/NotFound.tsx";

import SupervisorLayout from "./pages/supervisor/SupervisorLayout";
import SupervisorDashboard from "./pages/supervisor/Dashboard";
import Roster from "./pages/supervisor/Roster";
import RoutesPage from "./pages/supervisor/Routes";
import SupervisorLive from "./pages/supervisor/Live";
import Reports from "./pages/supervisor/Reports";
import SupervisorSettings from "./pages/supervisor/Settings";
import SavedGroups from "./pages/supervisor/SavedGroups";
import SupervisorPayments from "./pages/supervisor/Payments";

import VendorLayout from "./pages/vendor/VendorLayout";
import VendorDashboard from "./pages/vendor/Dashboard";
import Approvals from "./pages/vendor/Approvals";
import Drivers from "./pages/vendor/Drivers";
import Fleet from "./pages/vendor/Fleet";
import VendorRides from "./pages/vendor/Rides";
import Earnings from "./pages/vendor/Earnings";
import VendorSettings from "./pages/vendor/Settings";

import AdminLayout from "./pages/admin/AdminLayout";
import AdminDashboard from "./pages/admin/Dashboard";
import Live from "./pages/admin/Live";
import Vendors from "./pages/admin/Vendors";
import Supervisors from "./pages/admin/Supervisors";
import AdminDrivers from "./pages/admin/AdminDrivers";
import Payouts from "./pages/admin/Payouts";
import Analytics from "./pages/admin/Analytics";
import Safety from "./pages/admin/Safety";
import AdminSettings from "./pages/admin/Settings";
import RegistrationRequests from "./pages/admin/RegistrationRequests";
import SupervisorIssues from "./pages/supervisor/Issues";
import VendorIssues from "./pages/vendor/Issues";
import AdminIssues from "./pages/admin/Issues";

// Public legal/policy pages — must stay outside ProtectedRoute so a payment
// gateway reviewer can open them without an account.
import About from "./pages/legal/About";
import PrivacyPolicy from "./pages/legal/PrivacyPolicy";
import RefundPolicy from "./pages/legal/RefundPolicy";
import ShippingAndReturns from "./pages/legal/ShippingAndReturns";
import Terms from "./pages/legal/Terms";

import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/driver/*" element={<DriverApp />} />

            {/* Public policy pages */}
            <Route path="/about" element={<About />} />
            <Route path="/privacy-policy" element={<PrivacyPolicy />} />
            <Route path="/refund-policy" element={<RefundPolicy />} />
            <Route path="/shipping-and-returns" element={<ShippingAndReturns />} />
            <Route path="/terms" element={<Terms />} />

            <Route path="/supervisor" element={<ProtectedRoute requiredRole="supervisor"><SupervisorLayout /></ProtectedRoute>}>
              <Route index element={<SupervisorDashboard />} />
              <Route path="roster" element={<Roster />} />
              <Route path="routes" element={<RoutesPage />} />
              <Route path="live" element={<SupervisorLive />} />
              <Route path="dispatch" element={<SupervisorLive />} />
              <Route path="pending" element={<SupervisorLive />} />
              <Route path="scheduled" element={<SupervisorLive />} />
              <Route path="reports" element={<Reports />} />
              <Route path="issues" element={<SupervisorIssues />} />
              <Route path="saved-groups" element={<SavedGroups />} />
              <Route path="payments" element={<SupervisorPayments />} />
              <Route path="settings" element={<SupervisorSettings />} />
            </Route>

            <Route path="/vendor" element={<ProtectedRoute requiredRole="vendor"><VendorLayout /></ProtectedRoute>}>
              <Route index element={<VendorDashboard />} />
              <Route path="approvals" element={<Approvals />} />
              <Route path="drivers" element={<Drivers />} />
              <Route path="fleet" element={<Fleet />} />
              <Route path="rides" element={<VendorRides />} />
              <Route path="earnings" element={<Earnings />} />
              <Route path="issues" element={<VendorIssues />} />
              <Route path="settings" element={<VendorSettings />} />
            </Route>

            <Route path="/admin" element={<ProtectedRoute requiredRole="admin"><AdminLayout /></ProtectedRoute>}>
              <Route index element={<AdminDashboard />} />
              <Route path="live" element={<Live />} />
              <Route path="registration-requests" element={<RegistrationRequests />} />
              <Route path="vendors" element={<Vendors />} />
              <Route path="supervisors" element={<Supervisors />} />
              <Route path="drivers" element={<AdminDrivers />} />
              <Route path="payouts" element={<Payouts />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="safety" element={<Safety />} />
              <Route path="issues" element={<AdminIssues />} />
              <Route path="settings" element={<AdminSettings />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
