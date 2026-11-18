/**
 * Phase 2 face check screen: the driver takes a selfie, the server compares it
 * with their verified Profile Photo (backend/src/services/faceCheck.service.ts).
 *
 * Full screen. Used when going online (if a check is due) and when the 2-hour
 * check runs out while online.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Camera, Loader2, ScanFace, CheckCircle2, XCircle, Sun, Glasses, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { useSubmitFaceCheck } from "@/lib/queries";
import { ApiError } from "@/lib/api";
import {
  isCameraAvailable, takePhoto, CameraError, prepareUploadPhoto, FACE_CHECK_CAPTURE,
} from "@/lib/nativeCamera";
import { openAppSettings } from "@/lib/deviceLocation";

export function DriverFaceCheck({
  consentGiven,
  goOnline,
  initialFile,
  initialConsent,
  onPassed,
  onClose,
}: {
  consentGiven: boolean;
  /** Consent given before Android restarted the app (goes with initialFile). */
  initialConsent?: boolean;
  /** Going online after this check (kept if Android restarts the app). */
  goOnline: boolean;
  /** A selfie that arrived after Android restarted the app: sent straight away. */
  initialFile?: File | null;
  onPassed: () => void;
  onClose: () => void;
}) {
  const submit = useSubmitFaceCheck();
  // A restored selfie (initialFile) was only taken after the box was ticked.
  const [agreed, setAgreed] = useState(consentGiven || !!initialConsent);
  const [shooting, setShooting] = useState(false);
  const [failMessage, setFailMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sentInitial = useRef(false);
  const busy = shooting || submit.isPending;

  const send = (file: File) => {
    setFailMessage(null);
    submit.mutate(
      { file, consent: agreed || consentGiven },
      {
        onSuccess: (r) => {
          if (r.passed) {
            toast.success("Face verified");
            onPassed();
          } else {
            setFailMessage(r.message ?? "Face check failed. Please try again.");
          }
        },
        onError: (e) => setFailMessage(e instanceof ApiError ? e.message : "Could not send the selfie. Check your internet and try again."),
      },
    );
  };

  useEffect(() => {
    if (initialFile && !sentInitial.current) {
      sentInitial.current = true;
      send(initialFile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const snap = async () => {
    if (!agreed) { toast.error("Tick the box to agree first"); return; }
    if (!isCameraAvailable()) {
      // Older app version (no camera plugin) or browser: the phone's camera
      // through a file input that asks for the front camera.
      fileRef.current?.click();
      return;
    }
    setShooting(true);
    try {
      const file = await takePhoto({
        name: "selfie",
        front: true,
        pending: { docType: FACE_CHECK_CAPTURE, goOnline, consent: agreed },
      });
      if (file) send(file);
    } catch (e) {
      if (e instanceof CameraError && e.kind === "denied") {
        toast.error("Camera permission is off", {
          action: { label: "Settings", onClick: () => { void openAppSettings(); } },
        });
      } else {
        toast.error("Could not open the camera. Try again.");
      }
    } finally {
      setShooting(false);
    }
  };

  const onPicked = async (f?: File) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!f) return;
    try {
      send(await prepareUploadPhoto(f, "selfie"));
    } catch {
      toast.error("Could not read the photo. Try again.");
    }
  };

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
          Take a selfie. We compare it with your Profile Photo. You need this on your first go-online
          each day and every 2 hours while online. Until then you won't get, accept or start rides.
        </p>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border p-3 text-xs"><Sun className="h-5 w-5 mx-auto mb-1 text-gold" />Good light</div>
          <div className="rounded-lg border p-3 text-xs"><Smartphone className="h-5 w-5 mx-auto mb-1 text-gold" />Phone at eye level</div>
          <div className="rounded-lg border p-3 text-xs"><Glasses className="h-5 w-5 mx-auto mb-1 text-gold" />No sunglasses or mask</div>
        </div>

        {failMessage && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{failMessage}</span>
          </div>
        )}
        {submit.isSuccess && submit.data?.passed && (
          <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 p-3 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" /> Verified
          </div>
        )}

        {!consentGiven && (
          <label className="flex items-start gap-2.5 cursor-pointer rounded-lg border p-3">
            <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-0.5 shrink-0" />
            <span className="text-xs leading-relaxed">
              I agree that Wekashi Cabs may take my selfie and compare it with my Profile Photo using an
              automatic face-matching service, to confirm that I am the driver on duty. Selfies are
              deleted after 30 days.
            </span>
          </label>
        )}
      </div>

      <div className="border-t px-5 py-4 space-y-2 bg-background">
        <Button
          className="w-full bg-gold text-gold-foreground hover:bg-gold/90 disabled:opacity-50"
          disabled={busy || !agreed}
          onClick={snap}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          {submit.isPending ? "Checking…" : failMessage ? "Try again" : "Take selfie"}
        </Button>
        <Button variant="ghost" className="w-full" onClick={onClose} disabled={submit.isPending}>
          {goOnline ? "Cancel, stay offline" : "Later"}
        </Button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={(e) => void onPicked(e.target.files?.[0])}
      />
    </div>
  );
}
