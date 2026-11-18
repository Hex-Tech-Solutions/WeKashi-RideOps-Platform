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

/**
 * Open the camera and return the picture as a JPEG File ready to upload, or
 * null if the driver backed out. Throws CameraError if the permission was
 * refused or the camera failed.
 *
 * `front` asks for the selfie camera (profile photo); some phones' camera apps
 * ignore it.
 */
export async function takePhoto(opts: { name: string; front?: boolean }): Promise<File | null> {
  const { Camera, CameraResultType, CameraSource, CameraDirection } = await import("@capacitor/camera");
  try {
    const photo = await Camera.getPhoto({
      quality: 85,
      resultType: CameraResultType.Base64,
      source: CameraSource.Camera,
      direction: opts.front ? CameraDirection.Front : CameraDirection.Rear,
      correctOrientation: true,
      saveToGallery: false,
    });
    if (!photo.base64String) return null;
    const raw = base64ToBlob(photo.base64String, `image/${photo.format || "jpeg"}`);
    const jpeg = await toUploadJpeg(raw);
    const safe = opts.name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase() || "photo";
    return new File([jpeg], `${safe}.jpg`, { type: "image/jpeg" });
  } catch (e: any) {
    if (e instanceof CameraError) throw e;
    const msg = String(e?.message ?? e ?? "");
    if (/cancel/i.test(msg)) return null; // driver closed the camera
    if (/denied|permission/i.test(msg)) {
      throw new CameraError("Camera permission is off. Turn it on for Wekashi Cabs in your phone's app settings.", "denied");
    }
    throw new CameraError("Could not open the camera. Try again, or choose a file instead.", "failed");
  }
}
