/**
 * Phase 2 face check screen. The driver does a short LIVE video selfie (face in
 * an oval, colour flashes on the screen). A photo, a screen or a recorded video
 * can't pass it. The server then matches the live face with the verified
 * Profile Photo (backend/src/services/faceCheck.service.ts).
 *
 * Full screen. Used when going online (if a check is due) and when the 2-hour
 * check runs out while online.
 */
import { Suspense, lazy, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, ScanFace, XCircle, Sun, Glasses, Smartphone, Camera } from "lucide-react";
import { toast } from "sonner";
import { useStartFaceCheck, useCompleteFaceCheck, type LivenessSession } from "@/lib/queries";
import { ApiError } from "@/lib/api";
import { openAppSettings } from "@/lib/deviceLocation";
import type { LivenessFailure } from "./LivenessWidget";

// Loaded only when a check starts: it brings a few MB of AWS component + model.
const LivenessWidget = lazy(() => import("./LivenessWidget"));

/** Messages for the component's own error states. */
function livenessErrorMessage(state: string): { text: string; cameraSettings?: boolean } {
  switch (state) {
    case "CAMERA_ACCESS_ERROR":
      return { text: "The camera is off for Wekashi Cabs. Allow the camera in your phone settings, then try again.", cameraSettings: true };
    case "MOBILE_LANDSCAPE_ERROR":
      return { text: "Hold your phone upright (portrait) and try again." };
    case "FACE_DISTANCE_ERROR":
      return { text: "You were too close to the camera. Hold the phone at arm's length and try again." };
    case "MULTIPLE_FACES_ERROR":
      return { text: "Only you should be in the picture. Try again." };
    case "TIMEOUT":
    case "FRESHNESS_TIMEOUT":
      return { text: "That took too long. Fit your face in the oval quickly and try again." };
    case "CAMERA_FRAMERATE_ERROR":
      return { text: "Your camera can't do the live check. Close other apps and try again." };
    case "CONNECTION_TIMEOUT":
    case "SERVER_ERROR":
      return { text: "Could not connect. Check your internet and try again." };
    default:
      return { text: "The live check did not finish. Please try again." };
  }
}

export function DriverFaceCheck({
  consentGiven,
  goOnline,
  onPassed,
  onClose,
}: {
  consentGiven: boolean;
  /** Going online after this check. */
  goOnline: boolean;
  onPassed: () => void;
  onClose: () => void;
}) {
  const start = useStartFaceCheck();
  const complete = useCompleteFaceCheck();
  const [agreed, setAgreed] = useState(consentGiven);
  const [session, setSession] = useState<LivenessSession | null>(null);
  const [checking, setChecking] = useState(false);
  const [fail, setFail] = useState<{ text: string; cameraSettings?: boolean } | null>(null);

  // Every attempt needs a NEW session (a session can be used once).
  const begin = () => {
    if (!agreed) { toast.error("Tick the box to agree first"); return; }
    setFail(null);
    start.mutate(agreed || consentGiven, {
      onSuccess: (s) => setSession(s),
      onError: (e) => setFail({ text: e instanceof ApiError ? e.message : "Could not start the face check. Check your internet and try again." }),
    });
  };

  const finish = async () => {
    if (!session) return;
    setChecking(true);
    try {
      const r = await complete.mutateAsync(session.sessionId);
      if (r.passed) {
        toast.success("Face verified");
        onPassed();
        return;
      }
      setFail({ text: r.message ?? "Face check failed. Please try again." });
    } catch (e) {
      setFail({ text: e instanceof ApiError ? e.message : "Could not finish the face check. Check your internet and try again." });
    } finally {
      setSession(null);
      setChecking(false);
    }
  };

  const onWidgetError = (e: LivenessFailure) => {
    setFail(livenessErrorMessage(e.state));
    setSession(null);
  };

  // The live video fills the screen.
  if (session && !checking) {
    return (
      <div className="fixed inset-0 z-[130] bg-background overflow-y-auto">
        <Suspense
          fallback={
            <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-gold" /> Getting the camera ready…
            </div>
          }
        >
          <LivenessWidget
            session={session}
            onAnalysisComplete={finish}
            onError={onWidgetError}
            onCancel={() => setSession(null)}
          />
        </Suspense>
      </div>
    );
  }

  const busy = start.isPending || checking;

  return (
    <div className="fixed inset-0 z-[130] bg-background flex flex-col">
      <div className="px-5 pt-6 pb-4 border-b">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-md bg-gradient-gold flex items-center justify-center shrink-0">
            <ScanFace className="h-5 w-5 text-gold-foreground" />
          </div>
          <div className="min-w-0">
            <div className="font-bold tracking-tight">Face check</div>
            <div className="text-xs text-muted-foreground">Confirm it's you before taking rides</div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
        <p className="text-sm text-muted-foreground">
          You'll do a short live video selfie: fit your face in the oval and keep still while the screen
          flashes colours. We match it with your Profile Photo. You need this on your first go-online each
          day and every 2 hours while online. Until then you won't get, accept or start rides.
        </p>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border p-3 text-xs"><Sun className="h-5 w-5 mx-auto mb-1 text-gold" />Good light, screen brightness up</div>
          <div className="rounded-lg border p-3 text-xs"><Smartphone className="h-5 w-5 mx-auto mb-1 text-gold" />Phone upright at eye level</div>
          <div className="rounded-lg border p-3 text-xs"><Glasses className="h-5 w-5 mx-auto mb-1 text-gold" />No sunglasses or mask</div>
        </div>

        {fail && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive space-y-2">
            <div className="flex items-start gap-2">
              <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{fail.text}</span>
            </div>
            {fail.cameraSettings && (
              <Button size="sm" variant="outline" onClick={() => void openAppSettings()}>Open settings</Button>
            )}
          </div>
        )}

        {!consentGiven && (
          <label className="flex items-start gap-2.5 cursor-pointer rounded-lg border p-3">
            <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-0.5 shrink-0" />
            <span className="text-xs leading-relaxed">
              I agree that Wekashi Cabs may record a short live video selfie and compare my face with my
              Profile Photo using an automatic face-matching service, to confirm that I am the driver on
              duty. The face image is deleted after 30 days.
            </span>
          </label>
        )}
      </div>

      <div className="border-t px-5 py-4 space-y-2 bg-background">
        <Button
          className="w-full bg-gold text-gold-foreground hover:bg-gold/90 disabled:opacity-50"
          disabled={busy || !agreed}
          onClick={begin}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          {checking ? "Checking…" : start.isPending ? "Starting…" : fail ? "Try again" : "Start live check"}
        </Button>
        <Button variant="ghost" className="w-full" onClick={onClose} disabled={busy}>
          {goOnline ? "Cancel, stay offline" : "Later"}
        </Button>
      </div>
    </div>
  );
}
