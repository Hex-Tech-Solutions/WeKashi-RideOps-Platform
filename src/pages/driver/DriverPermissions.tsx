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
import { toast } from "sonner";

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

const LOCATION_DISCLOSURE_KEY = "wekashi_location_disclosure_ack";

export function DriverPermissions({ onAllCriticalGranted }: { onAllCriticalGranted: () => void }) {
  const [status, setStatus] = useState<PermStatus | null>(null);
  const [checking, setChecking] = useState(true);
  // Google Play requires a PROMINENT in-app disclosure explaining background
  // ("all the time") location use, shown BEFORE any location permission is
  // requested, with an affirmative accept. Gate the whole checklist behind it.
  const [disclosureAck, setDisclosureAck] = useState(
    () => localStorage.getItem(LOCATION_DISCLOSURE_KEY) === "1",
  );

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
      action: async () => {
        await requestLocation();
        // If the OS dialog didn't grant it (denied before, or suppressed on
        // Samsung), send the driver to app info to allow it manually.
        const s = await checkAllPermissions();
        if (!s.location) await openSetting("location");
      },
    },
    {
      key: "backgroundLocation", label: "Location: Allow all the time", critical: false, icon: Navigation,
      why: "Keeps tracking alive while you navigate in Google Maps.",
      action: async () => { await openSetting("location"); },
    },
    {
      key: "overlay", label: "Display over other apps", critical: true, icon: Layers,
      why: "Lets the ride request pop up over any screen, like Rapido.",
      action: async () => { await openSetting("overlay"); },
    },
    {
      key: "battery", label: "Don't optimize battery", critical: true, icon: BatteryCharging,
      why: "Opens app info — then tap Battery → Unrestricted so your phone doesn't kill the app.",
      action: async () => {
        await openSetting("battery");
        toast("Tap Battery → Unrestricted (or 'Don't optimize')", { duration: 6000 });
      },
    },
    {
      key: "fullScreenIntent", label: "Full-screen alerts", critical: false, icon: Maximize,
      why: "Wakes the screen for a ride when your phone is locked.",
      action: async () => { await openSetting("fullScreenIntent"); },
    },
    {
      key: "autostart", label: "Autostart / Auto-launch", critical: false, icon: RefreshCw, statusless: true,
      why: autostartHint(status?.brand),
      action: async () => {
        const { brand } = await openAutostart();
        toast(autostartHint(brand || status?.brand), { duration: 7000 });
      },
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

  // ── Prominent background-location disclosure (Play policy) ──────────────────
  // Must be shown before requesting location, clearly state what's collected,
  // that it's used in the background ("all the time"), and why.
  if (!disclosureAck) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="max-w-md w-full mx-auto flex-1 flex flex-col p-5">
          <div className="pt-8 pb-4 flex flex-col items-center text-center">
            <div className="h-14 w-14 rounded-2xl bg-gold flex items-center justify-center mb-3">
              <Navigation className="h-7 w-7 text-gold-foreground" />
            </div>
            <h1 className="text-xl font-bold">Location access</h1>
          </div>
          <div className="space-y-4 text-sm text-foreground/90 flex-1">
            <p>
              Wekashi Cabs collects your device <span className="font-semibold">location</span> to
              match you with nearby rides, share your live position with the supervisor during a
              trip, and measure trip distance.
            </p>
            <p>
              To keep this working while you navigate in another app (like Google Maps) or when the
              screen is off, Wekashi Cabs collects location
              <span className="font-semibold"> in the background — "Allow all the time"</span>. A
              persistent notification shows while you're online, and location sharing stops when you
              go offline.
            </p>
            <p className="text-muted-foreground text-xs">
              You can review or change this anytime in your phone's Settings. See our Privacy Policy
              at wekashi.in for details on how data is used.
            </p>
          </div>
          <div className="py-5 space-y-2">
            <Button
              className="w-full bg-gold text-gold-foreground hover:bg-gold/90"
              onClick={() => { localStorage.setItem(LOCATION_DISCLOSURE_KEY, "1"); setDisclosureAck(true); }}
            >
              I understand, continue
            </Button>
          </div>
        </div>
      </div>
    );
  }

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

/** Brand-specific guidance for the Autostart step, since the exact screen name
 *  and location vary by OEM and the deep-link is best-effort. */
function autostartHint(brand?: string): string {
  const b = (brand || "").toLowerCase();
  if (b.includes("oneplus")) {
    return "OnePlus: Settings → Battery → More → Auto-launch (or App auto-launch) → turn ON Wekashi Cabs.";
  }
  if (b.includes("xiaomi") || b.includes("redmi") || b.includes("poco")) {
    return "Xiaomi/Redmi: Settings → Apps → Manage apps → Wekashi Cabs → Autostart → turn ON.";
  }
  if (b.includes("oppo") || b.includes("realme")) {
    return "Realme/Oppo: Settings → Apps → App management → Wekashi Cabs → Allow Auto-launch.";
  }
  if (b.includes("vivo") || b.includes("iqoo")) {
    return "Vivo/iQOO: Settings → Battery → Background power consumption → allow Wekashi Cabs.";
  }
  return "Allow the app to start on its own (Autostart / Auto-launch) so rides arrive when it's closed.";
}
