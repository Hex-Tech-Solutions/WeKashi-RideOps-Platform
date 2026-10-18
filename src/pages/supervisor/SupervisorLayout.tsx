import { Outlet } from "react-router-dom";
import { LayoutDashboard, Users, Route, Radio, BarChart3, Settings, AlertTriangle, BookOpen, IndianRupee, CarFront } from "lucide-react";
import { RoleLayout, NavItem } from "@/components/RoleLayout";
import { useRides, usePendingPayments } from "@/lib/queries";
import { useAuth } from "@/hooks/useAuth";

export default function SupervisorLayout() {
  const { profile } = useAuth();
  const { data } = useRides({ limit: 100 });
  const { data: paymentsData } = usePendingPayments();
  const rides = data?.rides ?? [];
  // A broadcast whose window has passed OR has no expiry (a stuck row) must not
  // count as live — the server sweeper may lag or the row may be stale.
  const isExpiredBroadcast = (r: typeof rides[number]) =>
    r.status === "broadcasting" &&
    (!r.broadcastExpiresAt || new Date(r.broadcastExpiresAt).getTime() <= Date.now());
  const liveCount = rides.filter(
    (r) => ["broadcasting", "assigned", "in_progress", "pending"].includes(r.status) && !isExpiredBroadcast(r),
  ).length;
  const pendingPayCount = paymentsData?.rides?.length ?? 0;
  const nav: NavItem[] = [
    { to: "/supervisor", label: "Dashboard", icon: LayoutDashboard },
    { to: "/supervisor/roster", label: "Roster", icon: Users },
    { to: "/supervisor/routes", label: "Book a ride", icon: Route },
    { to: "/supervisor/saved-groups", label: "Saved Groups", icon: BookOpen },
    { to: "/supervisor/rentals", label: "Rentals", icon: CarFront },
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
