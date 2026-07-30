import { Outlet } from "react-router-dom";
import { LayoutDashboard, MapPin, Users, Building2, Briefcase, Wallet, BarChart3, Shield, Settings, AlertTriangle, UserPlus } from "lucide-react";
import { RoleLayout, NavItem } from "@/components/RoleLayout";
import { useAuth } from "@/hooks/useAuth";
import { useRegistrationRequests } from "@/lib/queries";

export default function AdminLayout() {
  const { profile } = useAuth();
  const { data } = useRegistrationRequests("pending");
  const pendingCount = data?.requests?.length ?? 0;

  const nav: NavItem[] = [
    { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
    { to: "/admin/live", label: "Live Tracking", icon: MapPin },
    { to: "/admin/registration-requests", label: "Account Requests", icon: UserPlus, badge: pendingCount || undefined },
    { to: "/admin/vendors", label: "Vendors", icon: Building2 },
    { to: "/admin/supervisors", label: "Supervisors", icon: Briefcase },
    { to: "/admin/drivers", label: "Drivers", icon: Users },
    { to: "/admin/payouts", label: "Vendor Payouts", icon: Wallet },
    { to: "/admin/analytics", label: "Analytics", icon: BarChart3 },
    { to: "/admin/safety", label: "Safety & SOS", icon: Shield },
    { to: "/admin/issues", label: "Issues", icon: AlertTriangle },
    { to: "/admin/settings", label: "Settings", icon: Settings },
  ];

  return (
    <RoleLayout role="Admin" nav={nav} user={{ name: profile?.full_name ?? "Admin", sub: "Platform Ops" }}>
      <Outlet />
    </RoleLayout>
  );
}
