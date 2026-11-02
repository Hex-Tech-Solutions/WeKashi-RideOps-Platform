/**
 * DriverPermissions — first-open / pre-online permissions checklist (Step 4).
 *
 * Walks the driver through every permission the app needs to reliably receive
 * and show ride requests, with live granted/needed status and one-tap actions
 * (runtime prompt or deep-link to the right settings page, including OEM
 * autostart). The CRITICAL ones gate going online.
 *
 * On web everything reports granted, so this screen auto-passes.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Bell, MapPin, Navigation, Layers, BatteryCharging, Maximize, RefreshCw, Check, AlertTriangle, ChevronRight,
} from "lucide-react";
import {
  checkAllPermissions, requestNotifications, requestLocation, openSetting, openAutostart,
  type PermStatus,
} from "@/lib/permissions";
import { Capacitor } from "@capacitor/core";

interface Row {
  key: keyof PermStatus;
  label: string;
  why: string;
  icon: typeof Bell;
  critical: boolean;
  action: () => Promise<void>;
  /** autostart has no detectable status — always render as "set up" guidance. */
  statusless?: boolean;
}

export function DriverPermissions({ onAllCriticalGranted }: { onAllCriticalGranted: () => void }) {
  const [status, setStatus] = useState<PermStatus | null>(null);
  const [checking, setChecking] = useState(true);

  const refresh = useCallback(async () => {
    setChecking(true);
    const s = await checkAllPermissions();
    setStatus(s);
    setChecking(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Re-check whenever the app comes back to the foreground (driver returns from
  // a Settings page), so the rows update without a manual refresh.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const rows: Row[] = [
    {
      key: "notifications", label: "Notifications", critical: true, icon: Bell,
      why: "Required to alert you about new rides.",
      action: async () => { await requestNotifications(); await openSettingIfStill("notifications"); },
    },
    {
      key: "location", label: "Location", critical: true, icon: MapPin,
      why: "Share your live position so nearby rides reach you.",
      action: async () => { await requestLocation(); },
    },
    {
      key: "backgroundLocation", label: "Location: Allow all the time", critical: false, icon: Navigation,
      why: "Keeps tracking alive while you navigate in Google Maps.",
      action: async () => { await openSetting("appDetails"); },
    },
    {
      key: "overlay", label: "Display over other apps", critical: true, icon: Layers,
      why: "Lets the ride request pop up over any screen, like Rapido.",
      action: async () => { await openSetting("overlay"); },
    },
    {
      key: "battery", label: "Don't optimize battery", critical: true, icon: BatteryCharging,
      why: "Stops your phone from killing the app in the background.",
      action: async () => { await openSetting("battery"); },
    },
    {
      key: "fullScreenIntent", label: "Full-screen alerts", critical: false, icon: Maximize,
      why: "Wakes the screen for a ride when your phone is locked.",
      action: async () => { await openSetting("fullScreenIntent"); },
    },
    {
      key: "autostart", label: "Autostart / Auto-launch", critical: false, icon: RefreshCw, statusless: true,
      why: "On Realme/Oppo/Vivo/Xiaomi, allow the app to start on its own so rides arrive when it's closed.",
      action: async () => { await openAutostart(); },
    },
  ];

  const value = (k: keyof PermStatus) => (status ? status[k] : undefined);
  const criticalGranted = status
    ? rows.filter((r) => r.critical).every((r) => value(r.key) === true)
    : false;

  // On web (or once all critical are granted), let the caller proceed.
  useEffect(() => {
    if (!Capacitor.isNativePlatform?.()) { onAllCriticalGranted(); return; }
    if (criticalGranted) onAllCriticalGranted();
  }, [criticalGranted, onAllCriticalGranted]);

  const openSettingIfStill = async (key: "notifications") => {
    const s = await checkAllPermissions();
    if (!s.notifications) await openSetting(key);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="max-w-md w-full mx-auto flex-1 flex flex-col p-4">
        <div className="pt-6 pb-4">
          <h1 className="text-xl font-bold">Set up ride alerts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Grant these so ride requests reach you reliably — even when the app is closed.
            {status?.brand ? ` (${titleCase(status.brand)} phone)` : ""}
          </p>
        </div>

        <div className="space-y-2 flex-1">
          {rows.map((r) => {
            const granted = r.statusless ? undefined : value(r.key) === true;
            const Icon = r.icon;
            return (
              <Card key={String(r.key)} className={granted ? "border-success/40" : ""}>
                <CardContent className="p-3 flex items-start gap-3">
                  <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${
                    granted ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
                  }`}>
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{r.label}</span>
                      {r.critical && !granted && (
                        <span className="text-[10px] font-semibold text-destructive uppercase">Required</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{r.why}</div>
                  </div>
                  {granted ? (
                    <Check className="h-5 w-5 text-success shrink-0 mt-1.5" />
                  ) : (
                    <Button size="sm" variant={r.critical ? "default" : "outline"} className="shrink-0"
                      onClick={() => { void r.action(); }}>
                      {r.statusless ? "Set up" : "Allow"} <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="py-4 space-y-2">
          {!criticalGranted && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground justify-center">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
              Grant the required permissions to continue.
            </div>
          )}
          <Button variant="outline" className="w-full" onClick={() => void refresh()} disabled={checking}>
            <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} /> Re-check
          </Button>
          <Button
            className="w-full bg-gold text-gold-foreground hover:bg-gold/90"
            disabled={!criticalGranted}
            onClick={onAllCriticalGranted}
          >
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}

function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
