/**
 * Going online (Phase 2) and the 2-hourly face check.
 *
 * Tapping Online:  Rules & Regulations (every time)  ->  face check if due  ->
 * online. Closing either screen leaves the driver offline.
 *
 * While online, when the face check runs out the selfie screen opens by itself
 * (not during a trip in progress: it waits until the trip ends) and a banner
 * stays up until the driver passes. The server blocks rides meanwhile.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ScanFace } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useDriverMe, useDriverRides, useDriverRentalsMine, useGoOnline, faceCheckDue,
} from "@/lib/queries";
import { ApiError } from "@/lib/api";
import { getDevicePosition } from "@/lib/deviceLocation";
import { setOnlineNotification } from "@/lib/nativeAuth";
import DriverTerms from "./DriverTerms";
import { DriverFaceCheck } from "./DriverFaceCheck";

interface OnlineFlow {
  /** Start the go-online steps (after the permission check). */
  startGoOnline: () => void;
  /** Open the selfie screen (banner button / notification tap). */
  openFaceCheck: () => void;
  /** Going online is in progress. */
  busy: boolean;
  /** Face check needed now (rides are paused). */
  faceDue: boolean;
}

const Ctx = createContext<OnlineFlow>({
  startGoOnline: () => {},
  openFaceCheck: () => {},
  busy: false,
  faceDue: false,
});

export const useOnlineFlow = () => useContext(Ctx);

type Step = null | { kind: "rules" } | { kind: "face"; goOnline: boolean };

export function OnlineFlowProvider({ children }: { children: ReactNode }) {
  const { data: me } = useDriverMe();
  const { data: ridesData } = useDriverRides();
  const { data: rentalsMine } = useDriverRentalsMine();
  const goOnline = useGoOnline();
  const [step, setStep] = useState<Step>(null);
  const [locating, setLocating] = useState(false);

  // Re-render when the current check runs out.
  const [now, setNow] = useState(() => Date.now());
  const validUntil = me?.faceCheck?.validUntil ?? null;
  useEffect(() => {
    if (!validUntil) return;
    const ms = new Date(validUntil).getTime() - Date.now();
    if (ms <= 0) return;
    const t = setTimeout(() => setNow(Date.now()), Math.min(ms + 1000, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [validUntil]);
  const faceDue = faceCheckDue(me?.faceCheck, now);
  const online = me?.isOnline ?? false;

  const onTrip =
    (ridesData?.rides ?? []).some((r) => r.status === "in_progress") ||
    (rentalsMine?.rentals ?? []).some((r) => r.status === "in_progress");

  const finishGoOnline = useCallback(async () => {
    setLocating(true);
    try {
      const loc = await getDevicePosition();
      goOnline.mutate({ ...loc, acceptedRules: true }, {
        onSuccess: () => {
          toast.success("You're online — live location shared");
          // Persistent "You're online" notification (and the quick-assist bubble).
          void setOnlineNotification(true);
        },
        onError: (e) => {
          if (e instanceof ApiError && e.code === "FACE_CHECK_REQUIRED") {
            setStep({ kind: "face", goOnline: true });
            return;
          }
          toast.error(e instanceof Error ? e.message : "Failed");
        },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not get your location");
    } finally {
      setLocating(false);
    }
  }, [goOnline]);

  const acceptRules = () => {
    if (faceCheckDue(me?.faceCheck)) setStep({ kind: "face", goOnline: true });
    else { setStep(null); void finishGoOnline(); }
  };

  const facePassed = (goingOnline: boolean) => {
    setStep(null);
    if (goingOnline) void finishGoOnline();
  };

  // While online: open the selfie screen once per expiry, but never mid-trip.
  const autoOpenedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!online || !faceDue || onTrip || step) return;
    const key = validUntil ?? "none";
    if (autoOpenedFor.current === key) return;
    autoOpenedFor.current = key;
    setStep({ kind: "face", goOnline: false });
  }, [online, faceDue, onTrip, step, validUntil]);

  // Any action the server refused for a missing face check (accept, claim,
  // start trip, ...) opens the selfie screen.
  const qc = useQueryClient();
  useEffect(() => {
    return qc.getMutationCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "error") return;
      const err = event.action.error;
      // (Going online sets its own step with goOnline: true, which replaces this.)
      if (err instanceof ApiError && err.code === "FACE_CHECK_REQUIRED") {
        setStep((s) => s ?? { kind: "face", goOnline: false });
      }
    });
  }, [qc]);


  // Stable functions: DriverShell uses openFaceCheck in an effect.
  const startGoOnline = useCallback(() => setStep({ kind: "rules" }), []);
  const openFaceCheck = useCallback(() => setStep({ kind: "face", goOnline: false }), []);
  const value = useMemo<OnlineFlow>(() => ({
    startGoOnline,
    openFaceCheck,
    busy: locating || goOnline.isPending,
    faceDue,
  }), [startGoOnline, openFaceCheck, locating, goOnline.isPending, faceDue]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {step?.kind === "rules" && (
        <div className="fixed inset-0 z-[130] bg-background overflow-y-auto">
          <DriverTerms driverName={me?.fullName} onAccept={acceptRules} onCancel={() => setStep(null)} />
        </div>
      )}
      {step?.kind === "face" && (
        <DriverFaceCheck
          consentGiven={!!me?.faceCheck?.consentGiven}
          goOnline={step.goOnline}
          onPassed={() => facePassed(step.goOnline)}
          onClose={() => setStep(null)}
        />
      )}
    </Ctx.Provider>
  );
}

/** Shown while online and the face check is due: rides are paused until it passes. */
export function FaceCheckDueBanner() {
  const { faceDue, openFaceCheck } = useOnlineFlow();
  const { data: me } = useDriverMe();
  if (!faceDue || !me?.isOnline) return null;
  return (
    <button
      type="button"
      onClick={openFaceCheck}
      className="w-full flex items-center gap-3 rounded-lg border border-warning/50 bg-warning/10 p-3 text-left"
    >
      <ScanFace className="h-5 w-5 text-warning shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold">Face check due — rides paused</span>
        <span className="block text-xs text-muted-foreground">Tap to take a quick selfie. You won't get or start rides until you do.</span>
      </span>
    </button>
  );
}
