import { Outlet } from "react-router-dom";
import { LayoutDashboard, Users, FileCheck, Car, History, Wallet, Settings, AlertTriangle } from "lucide-react";
import { RoleLayout, NavItem } from "@/components/RoleLayout";
import { useDrivers, useVendorProfile, useExpiringDocs } from "@/lib/queries";
import { useAuth } from "@/hooks/useAuth";

export default function VendorLayout() {
  const { profile } = useAuth();
  const { data } = useDrivers();
  const { data: vendorProfile } = useVendorProfile();
  const pendingKyc = (data?.drivers ?? []).filter((d) => d.status === "pending").length;
  // #13: expiring / expired documents → badge on the Dashboard (list lives there).
  const { data: expiring } = useExpiringDocs();
  const expiringCount = expiring?.documents.length ?? 0;
  const nav: NavItem[] = [
    { to: "/vendor", label: "Dashboard", icon: LayoutDashboard, badge: expiringCount || undefined },
    { to: "/vendor/approvals", label: "Driver Approvals", icon: FileCheck, badge: pendingKyc || undefined },
    { to: "/vendor/drivers", label: "Drivers", icon: Users },
    { to: "/vendor/fleet", label: "Fleet", icon: Car },
    { to: "/vendor/rides", label: "Ride History", icon: History },
    { to: "/vendor/earnings", label: "Earnings", icon: Wallet },
    { to: "/vendor/issues", label: "Issues", icon: AlertTriangle },
    { to: "/vendor/settings", label: "Settings", icon: Settings },
  ];

  // Show "Company · VND-XXXXXX" in the sidebar sub-label when code is available
  const sub = vendorProfile?.vendorCode
    ? `${profile?.org ?? ""} · ${vendorProfile.vendorCode}`
    : (profile?.org ?? "");

  return (
    <RoleLayout role="Vendor" nav={nav} user={{ name: profile?.full_name ?? "Vendor", sub }}>
      <Outlet />
    </RoleLayout>
  );
}
