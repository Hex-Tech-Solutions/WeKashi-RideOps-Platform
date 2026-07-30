import { Outlet } from "react-router-dom";
import { LayoutDashboard, Users, Route, Radio, BarChart3, Settings, AlertTriangle, BookOpen, IndianRupee } from "lucide-react";
import { RoleLayout, NavItem } from "@/components/RoleLayout";
import { useRides, useRouteTemplates, usePendingPayments } from "@/lib/queries";
import { useAuth } from "@/hooks/useAuth";

export default function SupervisorLayout() {
  const { profile } = useAuth();
  const { data } = useRides({ limit: 100 });
  const { data: templatesData } = useRouteTemplates();
  const { data: paymentsData } = usePendingPayments();
  const rides = data?.rides ?? [];
  const liveCount = rides.filter((r) => ["broadcasting", "assigned", "in_progress", "pending"].includes(r.status)).length;
  const groupCount = templatesData?.templates?.length ?? 0;
  const pendingPayCount = paymentsData?.rides?.length ?? 0;
  const nav: NavItem[] = [
    { to: "/supervisor", label: "Dashboard", icon: LayoutDashboard },
    { to: "/supervisor/roster", label: "Roster", icon: Users },
    { to: "/supervisor/routes", label: "Book a ride", icon: Route },
    { to: "/supervisor/saved-groups", label: "Saved Groups", icon: BookOpen, badge: groupCount || undefined },
    { to: "/supervisor/live", label: "Live rides", icon: Radio, badge: liveCount || undefined },
    { to: "/supervisor/payments", label: "Payments", icon: IndianRupee, badge: pendingPayCount || undefined },
    { to: "/supervisor/reports", label: "Reports", icon: BarChart3 },
    { to: "/supervisor/issues", label: "Issues", icon: AlertTriangle },
    { to: "/supervisor/settings", label: "Settings", icon: Settings },
  ];
  return (
    <RoleLayout role="Supervisor" nav={nav} user={{ name: profile?.full_name ?? "Supervisor", sub: profile?.org ?? "" }}>
      <Outlet />
    </RoleLayout>
  );
}
