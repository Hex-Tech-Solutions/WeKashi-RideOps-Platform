// Copies the MediaPipe WebAssembly files used by the on-phone face-readiness
// check (src/pages/driver/FaceReadinessCheck.tsx) from node_modules into
// public/mediapipe/wasm, so they are served from our own server (CSP allows
// 'self' only). Run automatically before `npm run dev` and `npm run build`.
// The face model itself (public/mediapipe/face_landmarker.task) is committed.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const to = join(root, "public", "mediapipe", "wasm");

if (!existsSync(from)) {
  console.error(`copy-mediapipe: ${from} not found. Run "npm install" first.`);
  process.exit(1);
}
mkdirSync(to, { recursive: true });
for (const f of [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
]) {
  copyFileSync(join(from, f), join(to, f));
}
console.log("copy-mediapipe: copied 4 files to public/mediapipe/wasm");
