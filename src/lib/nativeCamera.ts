/**
 * Camera for the Android app (driver document uploads and the profile photo).
 *
 * Only exists inside the APK: the web console has no camera button. Older APKs
 * that were built before the camera plugin was added report it as unavailable,
 * so they keep working with the file picker only.
 *
 * The plugin opens the phone's own camera app and asks for the camera
 * permission the first time it is used.
 */
import { Capacitor } from "@capacitor/core";

/** Server limit for an uploaded file (backend/src/lib/storage.ts MAX_SIZE). */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Longest side of the uploaded picture. A 12 MP photo is far more than a document needs. */
const MAX_EDGE_PX = 1800;

export type CameraFailure = "denied" | "failed";

export class CameraError extends Error {
  constructor(message: string, readonly kind: CameraFailure) {
    super(message);
    this.name = "CameraError";
  }
}

/** True only in an APK that includes the camera plugin. */
export function isCameraAvailable(): boolean {
  try {
    return Capacitor.isNativePlatform?.() === true && Capacitor.isPluginAvailable?.("Camera") === true;
  } catch {
    return false;
  }
}

function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read the photo")); };
    img.src = url;
  });
}

/** Shrink to MAX_EDGE_PX and re-encode as JPEG, lowering quality until it fits the upload limit. */
async function toUploadJpeg(blob: Blob): Promise<Blob> {
  const img = await loadImage(blob);
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return blob;
  ctx.drawImage(img, 0, 0, w, h);

  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", q));
    if (out && out.size <= MAX_UPLOAD_BYTES) return out;
  }
  throw new CameraError("The photo is too large. Try again with the camera set to a lower quality.", "failed");
}

// ─── Recovering a photo after Android restarted the app ──────────────────────
//
// While the phone's camera app is open, Android may kill the Wekashi app to
// free memory (common with the rear camera on low-memory phones). When the
// driver comes back the app starts from scratch: the page reloads, the
// pending getPhoto() promise is gone, and the picture arrives through the
// @capacitor/app "appRestoredResult" event instead. To finish the upload we
// keep what the driver was doing in localStorage before opening the camera.

/** What the driver was uploading when the camera opened. */
export interface PendingCapture {
  docType: string;
  number?: string;
  /** ISO date string as entered (yyyy-mm-dd). */
  expiry?: string;
  at: number;
}

const PENDING_KEY = "wekashi_camera_pending";
/** A capture older than this is ignored (driver walked away). */
const PENDING_TTL_MS = 15 * 60 * 1000;

function savePending(p: PendingCapture): void {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch { /* storage full or blocked */ }
}

export function clearPendingCapture(): void {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
}

/** The capture in progress, if the camera was opened in the last 15 minutes. */
export function getPendingCapture(): PendingCapture | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingCapture;
    if (!p?.docType || typeof p.at !== "number" || Date.now() - p.at > PENDING_TTL_MS) {
      clearPendingCapture();
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

export interface RestoredPhoto { pending: PendingCapture; file: File }

let restored: RestoredPhoto | null = null;
const restoredListeners = new Set<() => void>();
let restoreHooked = false;

async function photoToFile(base64: string, format: string | undefined, name: string): Promise<File> {
  const raw = base64ToBlob(base64, `image/${format || "jpeg"}`);
  const jpeg = await toUploadJpeg(raw);
  const safe = name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase() || "photo";
  return new File([jpeg], `${safe}.jpg`, { type: "image/jpeg" });
}

/**
 * Listen for a photo delivered after an app restart. Call once at start-up.
 * Capacitor keeps the event until a listener is added, so a late call still
 * receives it.
 */
export function initCameraRestore(): void {
  if (restoreHooked || !isCameraAvailable() || !Capacitor.isPluginAvailable?.("App")) return;
  restoreHooked = true;
  void import("@capacitor/app").then(({ App }) =>
    App.addListener("appRestoredResult", async (ev) => {
      if (ev.pluginId !== "Camera" || ev.methodName !== "getPhoto") return;
      const pending = getPendingCapture();
      if (!pending) return;
      const data = ev.data as { base64String?: string; format?: string } | undefined;
      if (!ev.success || !data?.base64String) {
        // Cancelled or failed while the app was away: nothing to upload.
        clearPendingCapture();
        return;
      }
      try {
        const file = await photoToFile(data.base64String, data.format, pending.docType);
        restored = { pending, file };
        restoredListeners.forEach((fn) => fn());
      } catch {
        clearPendingCapture();
      }
    }),
  ).catch(() => { restoreHooked = false; });
}

/** True when a restored photo is waiting to be uploaded. */
export function hasRestoredPhoto(): boolean {
  return restored !== null;
}

/** Take the restored photo (once). */
export function takeRestoredPhoto(): RestoredPhoto | null {
  const r = restored;
  restored = null;
  return r;
}

/** Be told when a restored photo arrives. Returns an unsubscribe function. */
export function onRestoredPhoto(fn: () => void): () => void {
  restoredListeners.add(fn);
  return () => { restoredListeners.delete(fn); };
}

/**
 * Open the camera and return the picture as a JPEG File ready to upload, or
 * null if the driver backed out. Throws CameraError if the permission was
 * refused or the camera failed.
 *
 * `front` asks for the selfie camera (profile photo); some phones' camera apps
 * ignore it. `pending` is saved so the upload can finish if Android restarts
 * the app while the camera is open.
 */
export async function takePhoto(opts: {
  name: string;
  front?: boolean;
  pending?: Omit<PendingCapture, "at">;
}): Promise<File | null> {
  const { Camera, CameraResultType, CameraSource, CameraDirection } = await import("@capacitor/camera");
  if (opts.pending) savePending({ ...opts.pending, at: Date.now() });
  try {
    const photo = await Camera.getPhoto({
      quality: 85,
      // Shrink in native code first: a smaller picture is much less likely to
      // run the phone out of memory on the way back.
      width: MAX_EDGE_PX,
      height: MAX_EDGE_PX,
      resultType: CameraResultType.Base64,
      source: CameraSource.Camera,
      direction: opts.front ? CameraDirection.Front : CameraDirection.Rear,
      correctOrientation: true,
      saveToGallery: false,
    });
    clearPendingCapture();
    if (!photo.base64String) return null;
    return await photoToFile(photo.base64String, photo.format, opts.name);
  } catch (e: any) {
    clearPendingCapture();
    if (e instanceof CameraError) throw e;
    const msg = String(e?.message ?? e ?? "");
    if (/cancel/i.test(msg)) return null; // driver closed the camera
    if (/denied|permission/i.test(msg)) {
      throw new CameraError("Camera permission is off. Turn it on for Wekashi Cabs in your phone's app settings.", "denied");
    }
    throw new CameraError("Could not open the camera. Try again, or choose a file instead.", "failed");
  }
}
