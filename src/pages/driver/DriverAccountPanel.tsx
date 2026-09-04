/**
 * DriverAccountPanel — a left-sliding drawer opened from the "Account" tab.
 *
 * Left rail lists the sections (Profile · Vehicle info · Wallet & Ride Earnings
 * · Recent trips); the right pane shows the selected section. The rail is
 * collapsible via the chevron button — collapsed it shows just icons, expanded
 * it shows labels. The "Proudly Made in India · Karnataka" watermark lives at
 * the bottom of the rail.
 *
 * Sections reuse the existing cards from DriverAccount (Profile summary +
 * personal/licence details, VehicleCard, WalletSection) and the extracted
 * DriverRecentTrips list — nothing is duplicated, just relocated.
 */
import { useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useDriverMe } from "@/lib/queries";
import { useDriverAuth } from "./useDriverAuth";
import {
  ProfileSummaryCard, ProfileDetailsCard, VehicleCard, WalletSection,
  KycExpiredBanner, SignOutButton,
} from "./DriverAccount";
import { DriverRecentTrips } from "./DriverRecentTrips";
import { MadeInIndiaWatermark } from "@/components/MadeInIndiaWatermark";
import { User, Car, Wallet, History, ChevronsLeft, ChevronsRight } from "lucide-react";

type Section = "profile" | "vehicle" | "wallet" | "trips";

const SECTIONS: { key: Section; label: string; Icon: typeof User }[] = [
  { key: "profile", label: "Profile",               Icon: User },
  { key: "vehicle", label: "Vehicle info",          Icon: Car },
  { key: "wallet",  label: "Wallet & Ride Earnings", Icon: Wallet },
  { key: "trips",   label: "Recent trips",          Icon: History },
];

export function DriverAccountPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [section, setSection] = useState<Section>("profile");
  const [collapsed, setCollapsed] = useState(false);
  const { session } = useDriverAuth();
  const { data: me } = useDriverMe();
  const kycExpired = me?.kycStatus === "expired";

  const activeMeta = SECTIONS.find((s) => s.key === section)!;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="p-0 w-full max-w-md sm:max-w-md flex flex-row gap-0"
      >
        {/* Left rail — collapsible nav */}
        <div
          className={cn(
            "bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border shrink-0 transition-[width] duration-200",
            collapsed ? "w-[64px]" : "w-40",
          )}
        >
          <div className={cn("h-14 flex items-center border-b border-sidebar-border", collapsed ? "justify-center px-0" : "px-4")}>
            {!collapsed && <span className="font-semibold text-white text-sm">Account</span>}
          </div>

          <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
            {SECTIONS.map(({ key, label, Icon }) => {
              const active = section === key;
              return (
                <button
                  key={key}
                  onClick={() => setSection(key)}
                  title={label}
                  className={cn(
                    "w-full flex items-center gap-2 rounded-md text-sm transition-colors",
                    collapsed ? "justify-center px-0 py-2.5" : "px-2.5 py-2 text-left",
                    active
                      ? "bg-sidebar-accent text-gold font-medium"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="truncate leading-tight">{label}</span>}
                </button>
              );
            })}
          </nav>

          <div className="p-2 border-t border-sidebar-border space-y-2">
            {/* Watermark inside the left panel */}
            <MadeInIndiaWatermark collapsed={collapsed} />
            <button
              onClick={() => setCollapsed((c) => !c)}
              title={collapsed ? "Expand" : "Collapse"}
              className={cn(
                "w-full flex items-center gap-2 text-xs text-sidebar-foreground/60 hover:text-gold px-2.5 py-2 rounded-md hover:bg-sidebar-accent/40",
                collapsed && "justify-center px-0",
              )}
            >
              {collapsed ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
              {!collapsed && "Collapse"}
            </button>
          </div>
        </div>

        {/* Right pane — selected section */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="h-14 flex items-center gap-2 px-4 border-b shrink-0">
            <activeMeta.Icon className="h-4 w-4 text-gold" />
            <span className="font-semibold text-sm">{activeMeta.label}</span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {section === "profile" && (
              <>
                <KycExpiredBanner kycExpired={kycExpired} />
                <ProfileSummaryCard me={me} fullName={session?.fullName} />
                <ProfileDetailsCard me={me} />
                <SignOutButton />
              </>
            )}

            {section === "vehicle" && (
              <VehicleCard
                currentType={me?.vehicleType}
                currentSeats={me?.seats}
                driverId={me?.id ?? session?.id}
              />
            )}

            {section === "wallet" && <WalletSection />}

            {section === "trips" && <DriverRecentTrips />}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
