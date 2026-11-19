/**
 * Free, on-phone "is the camera view good enough?" step shown BEFORE a live
 * face check is started (and billed). See src/lib/faceReadiness.ts for the
 * rules. Uses Google's MediaPipe Face Landmarker, loaded from our own server
 * (public/mediapipe), so nothing about the driver's face leaves the phone here.
 *
 * It opens the front camera, shows a preview with an oval, and tells the driver
 * what to fix. It reports `ready` once the view has been good for about a
 * second. The camera is released when this component unmounts, before the live
 * check opens it again.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  ReadinessTracker, READY, READY_HINTS, headAngles, measureLight, summarise,
  type Sample, type ReadyIssue,
} from "@/lib/faceReadiness";

export type ReadinessSummary = ReturnType<typeof summarise>;

type Landmarker = import("@mediapipe/tasks-vision").FaceLandmarker;

/** Sampling rate for the checks (about 5 a second is plenty and light on the phone). */
const SAMPLE_MS = 200;
const LIGHT_W = 64;
const LIGHT_H = 48;

export function FaceReadinessCheck({
  onStatus,
  onCameraDenied,
}: {
  /** Called when readiness flips, and once when the check can't run at all. */
  onStatus: (s: { ready: boolean; unavailable: boolean; summary: ReadinessSummary | null }) => void;
  onCameraDenied: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [issue, setIssue] = useState<ReadyIssue | null>("no_face");
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<"loading" | "running" | "unavailable">("loading");
  // Keep the latest callbacks without restarting the camera.
  const cb = useRef({ onStatus, onCameraDenied });
  cb.current = { onStatus, onCameraDenied };

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let landmarker: Landmarker | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const tracker = new ReadinessTracker();
    let wasReady = false;
    let prevCenter: { x: number; y: number } | null = null;
    let last: Sample | null = null;

    const canvas = document.createElement("canvas");
    canvas.width = LIGHT_W;
    canvas.height = LIGHT_H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const fail = (denied: boolean) => {
      if (stopped) return;
      if (denied) { cb.current.onCameraDenied(); return; }
      setPhase("unavailable");
      cb.current.onStatus({ ready: false, unavailable: true, summary: null });
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
      } catch (e) {
        const name = (e as { name?: string })?.name;
        fail(name === "NotAllowedError" || name === "SecurityError");
        return;
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }

      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      try { await video.play(); } catch { /* autoplay is allowed for muted inline video */ }

      try {
        const { FilesetResolver, FaceLandmarker } = await import("@mediapipe/tasks-vision");
        const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
        landmarker = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: "/mediapipe/face_landmarker.task", delegate: "CPU" },
          runningMode: "VIDEO",
          numFaces: 2,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });
      } catch {
        fail(false); // model could not load: the gate steps aside rather than block the driver
        return;
      }
      if (stopped) { landmarker?.close(); return; }
      setPhase("running");

      timer = setInterval(() => {
        if (!video.videoWidth || !landmarker || !ctx) return;
        let res;
        try { res = landmarker.detectForVideo(video, performance.now()); } catch { return; }

        const faces = res.faceLandmarks?.length ?? 0;
        const sample: Sample = { faces };
        if (faces > 0) {
          const pts = res.faceLandmarks[0];
          let minX = 1, minY = 1, maxX = 0, maxY = 0;
          for (const p of pts) {
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
          }
          const w = maxX - minX, h = maxY - minY;
          const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
          sample.box = { cx, cy, w };
          sample.movement = prevCenter ? Math.hypot(cx - prevCenter.x, cy - prevCenter.y) : 0;
          prevCenter = { x: cx, y: cy };

          const m = res.facialTransformationMatrixes?.[0]?.data;
          if (m && m.length >= 16) {
            const a = headAngles(m);
            sample.yaw = a.yaw; sample.pitch = a.pitch; sample.roll = a.roll;
          }
          const shapes = res.faceBlendshapes?.[0]?.categories;
          if (shapes) {
            sample.blinkLeft = shapes.find((c) => c.categoryName === "eyeBlinkLeft")?.score;
            sample.blinkRight = shapes.find((c) => c.categoryName === "eyeBlinkRight")?.score;
          }
          ctx.drawImage(video, 0, 0, LIGHT_W, LIGHT_H);
          const px = ctx.getImageData(0, 0, LIGHT_W, LIGHT_H).data;
          sample.light = measureLight(px, LIGHT_W, LIGHT_H, {
            x: minX * LIGHT_W, y: minY * LIGHT_H, w: w * LIGHT_W, h: h * LIGHT_H,
          });
        } else {
          prevCenter = null;
        }

        last = sample;
        const r = tracker.push(sample);
        setIssue(r.issue);
        setProgress(r.progress);
        if (r.ready !== wasReady) {
          wasReady = r.ready;
          cb.current.onStatus({ ready: r.ready, unavailable: false, summary: r.ready && last ? summarise(last) : null });
        }
      }, SAMPLE_MS);
    })();

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      try { landmarker?.close(); } catch { /* ignore */ }
      // Release the camera NOW: the live check opens it again right after this.
      stream?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, []);

  const ok = phase === "running" && issue === null;
  const hint =
    phase === "loading" ? "Getting the camera ready…"
    : phase === "unavailable" ? "Quick check not available. You can continue."
    : issue ? READY_HINTS[issue]
    : progress >= 1 ? "Looks good. Start the live check" : "Hold still…";

  return (
    <div className="space-y-3">
      <div className="relative mx-auto w-full max-w-xs aspect-[3/4] overflow-hidden rounded-2xl bg-black">
        {/* Mirrored like a selfie preview. */}
        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 h-full w-full object-cover [transform:scaleX(-1)]"
        />
        {phase === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Loader2 className="h-6 w-6 animate-spin text-white" />
          </div>
        )}
        <svg viewBox="0 0 100 133" className="absolute inset-0 h-full w-full pointer-events-none">
          <ellipse
            cx="50" cy="66" rx="30" ry="40"
            fill="none"
            stroke={ok ? "#22c55e" : "#ffffff"}
            strokeOpacity={ok ? 1 : 0.7}
            strokeWidth="1.6"
            strokeDasharray={ok ? undefined : "4 3"}
          />
        </svg>
      </div>

      <div className="mx-auto max-w-xs">
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full transition-all ${ok ? "bg-success" : "bg-gold"}`}
            style={{ width: `${Math.round((phase === "unavailable" ? 1 : progress) * 100)}%` }}
          />
        </div>
        <p className={`mt-2 text-center text-sm font-medium ${ok ? "text-success" : "text-foreground"}`}>{hint}</p>
        {phase === "running" && progress > 0 && progress < 1 && !issue && (
          <p className="text-center text-[11px] text-muted-foreground">
            {Math.ceil((1 - progress) * READY.goodSamplesNeeded * (SAMPLE_MS / 1000))} s
          </p>
        )}
      </div>
    </div>
  );
}
