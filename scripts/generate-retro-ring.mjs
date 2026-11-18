// Generates the "retro landline" ride ringer used by the driver app.
//
//   node scripts/generate-retro-ring.mjs
//
// Writes the same WAV to:
//   android/app/src/main/res/raw/retro_ring.wav   (native ride alert + channel sound)
//   public/sounds/retro-ring.wav                  (in-app alert while the app is open)
//
// The sound is synthesised here (no third-party recording, so no licence
// question): an old electromechanical telephone bell. A hammer driven at 25 Hz
// (Indian/UK ringing current) strikes two small bells in turn, 50 strikes a
// second, which gives the classic "brrring". Cadence is the Indian/UK landline
// double ring: 0.4 s ring, 0.2 s gap, 0.4 s ring, 2.0 s gap. Two cycles = 6 s;
// the app loops it while the ride card is up.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const RATE = 22050;
const CYCLES = 2;
const CADENCE = [[0.4, true], [0.2, false], [0.4, true], [2.0, false]];
const HAMMER_HZ = 25;
const STRIKE_DECAY_S = 0.045; // how fast a bell dies between strikes
const TAIL_DECAY_S = 0.25;    // ring-out after the hammer stops

// Two slightly different bells; inharmonic partials like a real small bell.
const BELLS = [
  { f: 1150, partials: [[1, 1.0], [2.32, 0.45], [3.86, 0.25], [5.5, 0.12]], phase: 0 },
  { f: 1310, partials: [[1, 1.0], [2.28, 0.4], [3.9, 0.22], [5.4, 0.1]], phase: 0.5 },
];

const cycleLen = CADENCE.reduce((s, [d]) => s + d, 0);
const total = Math.round(cycleLen * CYCLES * RATE);
const out = new Float64Array(total);

// Is the hammer running at time t?
function ringing(t) {
  let x = t % cycleLen;
  for (const [d, on] of CADENCE) {
    if (x < d) return on;
    x -= d;
  }
  return false;
}

let seed = 1;
const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;

for (const bell of BELLS) {
  let env = 0;
  let click = 0;
  const strikeDecay = Math.exp(-1 / (STRIKE_DECAY_S * RATE));
  const tailDecay = Math.exp(-1 / (TAIL_DECAY_S * RATE));
  const strikePeriod = RATE / HAMMER_HZ;
  const offset = Math.round(bell.phase * strikePeriod);
  for (let n = 0; n < total; n++) {
    const t = n / RATE;
    const on = ringing(t);
    if (on && (n - offset) % Math.round(strikePeriod) === 0) {
      env = Math.min(1.2, env + 0.85);
      click = 1;
    }
    env *= on ? strikeDecay : tailDecay;
    click *= 0.82;
    let s = 0;
    for (const [ratio, amp] of bell.partials) {
      // Higher partials die faster, as in a real bell.
      s += amp * Math.sin(2 * Math.PI * bell.f * ratio * t) * Math.pow(env, 0.6 + ratio * 0.25);
    }
    out[n] += s * 0.5 + noise() * click * 0.08;
  }
}

// Normalise, soft-clip, 5 ms fade in/out.
let peak = 0;
for (const v of out) peak = Math.max(peak, Math.abs(v));
const pcm = Buffer.alloc(total * 2);
const fade = Math.round(0.005 * RATE);
for (let n = 0; n < total; n++) {
  let v = Math.tanh((out[n] / peak) * 1.4) / Math.tanh(1.4);
  if (n < fade) v *= n / fade;
  if (n > total - fade) v *= (total - n) / fade;
  pcm.writeInt16LE(Math.round(v * 0.92 * 32767), n * 2);
}

const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(pcm.length, 40);
const wav = Buffer.concat([header, pcm]);

for (const rel of ["android/app/src/main/res/raw/retro_ring.wav", "public/sounds/retro-ring.wav"]) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, wav);
  console.log(`wrote ${rel} (${wav.length} bytes, ${(total / RATE).toFixed(1)} s)`);
}
