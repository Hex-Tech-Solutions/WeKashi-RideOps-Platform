/**
 * "Is this camera view good enough to START a live face check?"
 *
 * Every live check that reaches Amazon Rekognition is billed whether it passes
 * or fails. This gate runs free, on the phone, BEFORE a session is created: it
 * looks at the camera preview and only lets the driver start when the basics
 * that make Rekognition reject a check are fine — one face, a good distance,
 * facing the camera, eyes open, steady, lit evenly (not dark, not blown out, no
 * light behind). It cannot predict every Rekognition failure (it can't see how
 * the colour flashes land), but it removes the avoidable ones.
 *
 * Pure functions only (numbers in, verdict out) so every threshold is testable
 * without a camera. The camera + model wiring is in FaceReadinessCheck.tsx.
 */

/** Tunable limits. Distances are fractions of the frame width/height. */
export const READY = {
  /** Face width / frame width: smaller = too far, larger = too close. */
  faceWidthMin: 0.28,
  faceWidthMax: 0.62,
  /** Face centre may be this far from the frame centre (fraction of the frame). */
  centerX: 0.18,
  centerY: 0.22,
  /** Head turn / tilt limits in degrees. */
  yawMax: 16,
  pitchMax: 16,
  rollMax: 20,
  /** Blink score (0 open - 1 closed) above which the eyes count as closed. */
  eyesClosedAbove: 0.55,
  /** Mean face brightness (0-255): below = dark, above = too bright. */
  faceLumaMin: 70,
  faceLumaMax: 185,
  /** Share of face pixels that are blown out (>= 245). */
  clippedMax: 0.08,
  /** Background brighter than the face by this much = light behind the person. */
  backlightGap: 55,
  /** Left half vs right half of the face: bigger gap = one side lit. */
  sideGap: 50,
  /** Face centre may move at most this much (fraction of width) between samples. */
  stillness: 0.025,
  /** Good for this many samples in a row (at ~5 per second) before "ready". */
  goodSamplesNeeded: 6,
} as const;

export type ReadyIssue =
  | 'no_face' | 'multiple_faces' | 'too_far' | 'too_close' | 'off_center'
  | 'head_turned' | 'head_tilted' | 'eyes_closed' | 'too_dark' | 'too_bright'
  | 'backlight' | 'uneven_light' | 'moving';

/** What to tell the driver, in the order we'd want them fixed. */
export const READY_HINTS: Record<ReadyIssue, string> = {
  no_face: 'Show your face to the camera',
  multiple_faces: 'Only you should be in the picture',
  too_far: 'Move the phone a little closer',
  too_close: 'Move the phone a little further away',
  off_center: 'Centre your face on the screen',
  head_turned: 'Look straight at the camera',
  head_tilted: 'Hold your head level and look straight',
  eyes_closed: 'Keep your eyes open',
  too_dark: 'Too dark. Face a light and turn the screen brightness up',
  too_bright: 'Too bright. Move away from strong light or the sun',
  backlight: 'Light behind you. Turn so the light is in front of you',
  uneven_light: 'Light is only on one side of your face. Face the light',
  moving: 'Hold still',
};

/** Order matters: the first failing rule is the one shown. */
const ISSUE_ORDER: ReadyIssue[] = [
  'no_face', 'multiple_faces', 'too_far', 'too_close', 'off_center',
  'head_turned', 'head_tilted', 'eyes_closed',
  'backlight', 'too_dark', 'too_bright', 'uneven_light', 'moving',
];

// ─── Measuring ───────────────────────────────────────────────────────────────

/** Grey level of an RGBA pixel (Rec. 601). */
export const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

export interface Light {
  /** Mean brightness of the face area, 0-255. */
  faceMean: number;
  /** Share of face pixels at >= 245 (blown out). */
  clipped: number;
  /** Mean brightness of everything outside the face area. */
  backgroundMean: number;
  /** Mean brightness of the left / right half of the face area. */
  leftMean: number;
  rightMean: number;
}

/**
 * Brightness figures from an RGBA frame (canvas getImageData) and the face box
 * (pixel coordinates inside that frame).
 */
export function measureLight(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  box: { x: number; y: number; w: number; h: number },
): Light {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(width, Math.ceil(box.x + box.w));
  const y1 = Math.min(height, Math.ceil(box.y + box.h));
  const mid = (x0 + x1) / 2;

  let fSum = 0, fN = 0, clip = 0, lSum = 0, lN = 0, rSum = 0, rN = 0, bSum = 0, bN = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const l = luma(rgba[i], rgba[i + 1], rgba[i + 2]);
      const inFace = x >= x0 && x < x1 && y >= y0 && y < y1;
      if (inFace) {
        fSum += l; fN++;
        if (l >= 245) clip++;
        if (x < mid) { lSum += l; lN++; } else { rSum += l; rN++; }
      } else {
        bSum += l; bN++;
      }
    }
  }
  const mean = (s: number, n: number, fallback: number) => (n > 0 ? s / n : fallback);
  const faceMean = mean(fSum, fN, 0);
  return {
    faceMean,
    clipped: fN > 0 ? clip / fN : 0,
    backgroundMean: mean(bSum, bN, faceMean),
    leftMean: mean(lSum, lN, faceMean),
    rightMean: mean(rSum, rN, faceMean),
  };
}

/** Head angles in degrees from a MediaPipe 4x4 column-major face matrix. */
export function headAngles(m: ArrayLike<number>): { yaw: number; pitch: number; roll: number } {
  // Rotation part, R[row][col] = m[col * 4 + row].
  const r = (row: number, col: number) => m[col * 4 + row];
  const deg = (v: number) => (v * 180) / Math.PI;
  return {
    yaw: deg(Math.atan2(r(0, 2), r(2, 2))),
    pitch: deg(Math.asin(Math.max(-1, Math.min(1, -r(1, 2))))),
    roll: deg(Math.atan2(r(1, 0), r(0, 0))),
  };
}

// ─── Deciding ────────────────────────────────────────────────────────────────

export interface Sample {
  faces: number;
  /** Face box as fractions of the frame (0-1). Undefined when there is no face. */
  box?: { cx: number; cy: number; w: number };
  yaw?: number;
  pitch?: number;
  roll?: number;
  /** Blink scores 0 (open) - 1 (closed). */
  blinkLeft?: number;
  blinkRight?: number;
  light?: Light;
  /** How far the face centre moved since the previous sample (fraction of width). */
  movement?: number;
}

/** The first thing wrong with this sample, or null when it is good. */
export function firstIssue(s: Sample): ReadyIssue | null {
  const fail = new Set<ReadyIssue>();
  if (s.faces === 0 || !s.box) fail.add('no_face');
  else if (s.faces > 1) fail.add('multiple_faces');
  else {
    const b = s.box;
    if (b.w < READY.faceWidthMin) fail.add('too_far');
    if (b.w > READY.faceWidthMax) fail.add('too_close');
    if (Math.abs(b.cx - 0.5) > READY.centerX || Math.abs(b.cy - 0.5) > READY.centerY) fail.add('off_center');
    if (s.yaw != null && Math.abs(s.yaw) > READY.yawMax) fail.add('head_turned');
    if (s.pitch != null && Math.abs(s.pitch) > READY.pitchMax) fail.add('head_turned');
    if (s.roll != null && Math.abs(s.roll) > READY.rollMax) fail.add('head_tilted');
    if (s.blinkLeft != null && s.blinkRight != null
      && (s.blinkLeft + s.blinkRight) / 2 > READY.eyesClosedAbove) fail.add('eyes_closed');
    const l = s.light;
    if (l) {
      if (l.backgroundMean - l.faceMean > READY.backlightGap) fail.add('backlight');
      else if (l.faceMean < READY.faceLumaMin) fail.add('too_dark');
      if (l.faceMean > READY.faceLumaMax || l.clipped > READY.clippedMax) fail.add('too_bright');
      if (Math.abs(l.leftMean - l.rightMean) > READY.sideGap) fail.add('uneven_light');
    }
    if (s.movement != null && s.movement > READY.stillness) fail.add('moving');
  }
  return ISSUE_ORDER.find((i) => fail.has(i)) ?? null;
}

/**
 * Keeps a run of good samples. `ready` turns true after
 * READY.goodSamplesNeeded in a row and drops the moment one sample is bad.
 */
export class ReadinessTracker {
  private good = 0;
  issue: ReadyIssue | null = 'no_face';
  ready = false;

  push(s: Sample): { ready: boolean; issue: ReadyIssue | null; progress: number } {
    this.issue = firstIssue(s);
    this.good = this.issue ? 0 : this.good + 1;
    this.ready = this.good >= READY.goodSamplesNeeded;
    return { ready: this.ready, issue: this.issue, progress: Math.min(1, this.good / READY.goodSamplesNeeded) };
  }

  reset() { this.good = 0; this.ready = false; this.issue = 'no_face'; }
}

/** Compact numbers to log with a session, so real failures can be tuned later. */
export function summarise(s: Sample) {
  const r = (n: number | undefined, d = 2) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);
  return {
    faceW: r(s.box?.w),
    yaw: r(s.yaw, 0), pitch: r(s.pitch, 0),
    faceLuma: r(s.light?.faceMean, 0),
    bgLuma: r(s.light?.backgroundMean, 0),
    clipped: r(s.light?.clipped, 3),
    sideGap: s.light ? r(Math.abs(s.light.leftMean - s.light.rightMean), 0) : null,
  };
}
