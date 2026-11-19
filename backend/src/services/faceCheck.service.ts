/**
 * Phase 2: automatic face check WITH a liveness test.
 *
 * The driver does a short live video selfie (Amazon Rekognition Face Liveness,
 * Mumbai region: face in an oval + colour flashes on the screen), which a photo,
 * a screen or a recorded video can't pass. The "reference image" Rekognition
 * takes from that live video is then checked for quality and compared with the
 * driver's VERIFIED Profile Photo document. A pass is good for 2 hours and never
 * past midnight IST, so the driver checks on the first go-online of the day and
 * then every 2 hours.
 *
 * Flow:
 *   1. POST /driver/face-check/session  -> startLivenessSession(): creates the
 *      Rekognition session and gives the app 15-minute credentials that can ONLY
 *      stream that video (STS AssumeRole into FACE_LIVENESS_ROLE_ARN).
 *   2. The app streams the video straight to Rekognition (Amplify component).
 *   3. POST /driver/face-check/complete -> completeLivenessSession(): the
 *      session must be the one we created for THIS driver (single use), then
 *      the liveness score and the face match are checked.
 * There is deliberately NO way to submit a plain photo.
 *
 * Without a valid check the driver:
 *   - gets no ride or rental broadcasts,
 *   - can't accept or claim a ride or rental,
 *   - can't start a ride or rental they already hold.
 * A trip already in progress can still be finished. A supervisor may still
 * assign a ride; the driver can't start it until they pass.
 *
 * Switched on with FACE_CHECK_ENABLED=true, AWS_REGION and
 * FACE_LIVENESS_ROLE_ARN in .env.prod. On an AWS server there are no access
 * keys: the instance's IAM role is used. While it is off, every gate here lets
 * the driver through.
 *
 * Reference images are deleted 30 days after they were taken (the result row stays).
 */
import path from 'path';
import { randomUUID } from 'crypto';
import { redis } from '../lib/redis';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { AppError, TooManyRequestsError, ValidationError } from '../types';
import { readStoredFile, deleteFromAzureBlob, saveBufferFile } from '../lib/storage';
import { notifyFaceCheckDue } from './driverNotice.service';

// ─── Settings ────────────────────────────────────────────────────────────────

export function isFaceCheckEnabled(): boolean {
  return process.env.FACE_CHECK_ENABLED === 'true';
}

/** How long a passed check lasts. */
export const FACE_CHECK_VALID_MS = 2 * 60 * 60 * 1000;
/** Selfies older than this are deleted. */
export const SELFIE_RETENTION_DAYS = 30;
/** Minimum Rekognition similarity (0–100) to count as the same person. */
export const MATCH_THRESHOLD = 90;
/** Face checks a driver may START per hour (keeps the AWS bill bounded). */
export const MAX_ATTEMPTS_PER_HOUR = 10;
/** Liveness score (0–100) Rekognition must reach. Tunable with FACE_LIVENESS_MIN_CONFIDENCE. */
export function livenessMinConfidence(): number {
  const n = Number(process.env.FACE_LIVENESS_MIN_CONFIDENCE);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 90;
}
/** A started session must be finished within this many seconds. */
const SESSION_TTL_S = 300;
const sessionKey = (sessionId: string) => `facecheck:liveness:${sessionId}`;
const startsKey = (driverId: string) => `facecheck:starts:${driverId}`;
/** Consecutive "different person" results that raise a flag for the vendor/admin. */
export const MISMATCH_FLAG_AFTER = 3;

/** Error code the app uses to open the face-check screen. */
export const FACE_CHECK_REQUIRED = 'FACE_CHECK_REQUIRED';

export class FaceCheckRequiredError extends AppError {
  constructor(message = "Face check due. Take a quick selfie to confirm it's you.") {
    super(403, message, FACE_CHECK_REQUIRED);
  }
}

// ─── Validity window ─────────────────────────────────────────────────────────

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The next midnight in India after `t`. */
export function nextIstMidnight(t: Date): Date {
  const ist = new Date(t.getTime() + IST_OFFSET_MS);
  const midnightIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 1);
  return new Date(midnightIst - IST_OFFSET_MS);
}

/** A check passed at `passedAt` is good until 2 hours later, or midnight IST if sooner. */
export function faceCheckValidUntil(passedAt: Date): Date {
  const twoHours = new Date(passedAt.getTime() + FACE_CHECK_VALID_MS);
  const midnight = nextIstMidnight(passedAt);
  return twoHours < midnight ? twoHours : midnight;
}

// ─── Gates ───────────────────────────────────────────────────────────────────

/**
 * SQL condition "this driver has a valid face check" for a query on the
 * drivers table. `table` is a fixed identifier (never user input). TRUE while
 * the feature is off.
 */
export function faceCheckOkSql(table: 'drivers' | 'd'): Prisma.Sql {
  if (!isFaceCheckEnabled()) return Prisma.sql`TRUE`;
  return Prisma.sql`(${Prisma.raw(table)}.face_check_valid_until IS NOT NULL AND ${Prisma.raw(table)}.face_check_valid_until > NOW())`;
}

/** True if the driver may take/start rides as far as the face check goes. */
export async function hasValidFaceCheck(driverId: string, db: Prisma.TransactionClient = prisma): Promise<boolean> {
  if (!isFaceCheckEnabled()) return true;
  const d = await db.driver.findUnique({ where: { id: driverId }, select: { faceCheckValidUntil: true } });
  return !!d?.faceCheckValidUntil && d.faceCheckValidUntil.getTime() > Date.now();
}

/** Throw FACE_CHECK_REQUIRED (403) unless the driver has a valid check. */
export async function assertFaceCheckValid(driverId: string, db: Prisma.TransactionClient = prisma): Promise<void> {
  if (!(await hasValidFaceCheck(driverId, db))) throw new FaceCheckRequiredError();
}

/** Newest VERIFIED Profile Photo — the face the selfie is compared with. */
async function verifiedProfilePhoto(driverId: string) {
  return prisma.driverDocument.findFirst({
    where: { driverId, type: 'photo', status: 'verified' },
    orderBy: { createdAt: 'desc' },
    select: { fileUrl: true },
  });
}

/**
 * Going online needs a valid check only once the driver HAS a verified
 * Profile Photo. Before that their KYC isn't approved, so they get no rides
 * anyway, and there is nothing to compare with.
 */
export async function assertCanGoOnline(driverId: string): Promise<void> {
  if (!isFaceCheckEnabled()) return;
  if (!(await verifiedProfilePhoto(driverId))) return;
  await assertFaceCheckValid(driverId);
}

/** Face-check state for GET /driver/me. */
export async function getFaceCheckState(driverId: string, d: { faceCheckValidUntil: Date | null; faceConsentAt: Date | null }) {
  const enabled = isFaceCheckEnabled();
  const required = enabled && !!(await verifiedProfilePhoto(driverId));
  const valid = !!d.faceCheckValidUntil && d.faceCheckValidUntil.getTime() > Date.now();
  return {
    enabled,
    /** False until a Profile Photo is verified (nothing to compare with). */
    required,
    validUntil: valid ? d.faceCheckValidUntil : null,
    due: required && !valid,
    consentGiven: !!d.faceConsentAt,
  };
}

// ─── Selfie rules ("moderate") ───────────────────────────────────────────────

export type FaceCheckReason =
  | 'no_face' | 'multiple_faces' | 'too_small' | 'too_dark' | 'blurry' | 'pose'
  | 'sunglasses' | 'covered' | 'eyes_closed' | 'no_match' | 'too_bright' | 'liveness_failed'
  | 'profile_photo_unusable' | 'no_profile_photo' | 'service_error';

export const REASON_MESSAGES: Record<FaceCheckReason, string> = {
  no_face: 'We could not find a face. Hold the phone at eye level and look at the camera.',
  multiple_faces: 'Only you should be in the photo. Make sure nobody else is in the picture.',
  too_small: 'Your face is too small in the photo. Hold the phone a little closer.',
  too_dark: 'The photo is too dark. Move to a brighter place or face a light.',
  blurry: 'The photo is blurry. Hold the phone still and try again.',
  pose: 'Look straight at the camera, not to the side, up or down.',
  sunglasses: 'Please take off your sunglasses. Normal glasses are fine.',
  covered: "Your face is covered. Remove your mask or anything in front of your face.",
  eyes_closed: 'Your eyes look closed. Keep them open and try again.',
  no_match: "This doesn't match your Profile Photo. Make sure it's you, in good light, and try again.",
  too_bright: 'Too much light or glare on your face. Move out of direct sun and try again.',
  liveness_failed: "We couldn't confirm a live face. Hold the phone at eye level, fit your face in the oval, keep still during the colour flashes and try again.",
  profile_photo_unusable: 'Your Profile Photo can\'t be used for the face check. Ask your vendor to reject it, then upload a clear JPG or PNG photo of your face.',
  no_profile_photo: 'Your Profile Photo is not verified yet, so there is nothing to compare with.',
  service_error: 'The face check is not working right now. Please try again in a minute.',
};

/** The parts of a Rekognition FaceDetail used here. */
export interface FaceDetailLite {
  Confidence?: number;
  BoundingBox?: { Width?: number; Height?: number };
  Quality?: { Brightness?: number; Sharpness?: number };
  Pose?: { Yaw?: number; Pitch?: number };
  Sunglasses?: { Value?: boolean; Confidence?: number };
  FaceOccluded?: { Value?: boolean; Confidence?: number };
  EyesOpen?: { Value?: boolean; Confidence?: number };
}

const area = (f: FaceDetailLite) => (f.BoundingBox?.Width ?? 0) * (f.BoundingBox?.Height ?? 0);

/**
 * Moderate quality rules for the selfie. Returns null when it is good enough
 * to compare, otherwise the reason it isn't.
 */
export function evaluateSelfie(faces: FaceDetailLite[]): FaceCheckReason | null {
  const real = faces.filter((f) => (f.Confidence ?? 0) >= 90);
  if (real.length === 0) return 'no_face';
  const sorted = [...real].sort((a, b) => area(b) - area(a));
  const main = sorted[0];
  // A small face far in the background (a passer-by) is ignored.
  if (sorted.slice(1).some((f) => area(f) > area(main) * 0.25)) return 'multiple_faces';
  if ((main.BoundingBox?.Width ?? 0) < 0.12) return 'too_small';
  if ((main.Quality?.Brightness ?? 100) < 20) return 'too_dark';
  if ((main.Quality?.Sharpness ?? 100) < 8) return 'blurry';
  if (Math.abs(main.Pose?.Yaw ?? 0) > 35 || Math.abs(main.Pose?.Pitch ?? 0) > 35) return 'pose';
  if (main.Sunglasses?.Value && (main.Sunglasses.Confidence ?? 0) >= 85) return 'sunglasses';
  if (main.FaceOccluded?.Value && (main.FaceOccluded.Confidence ?? 0) >= 85) return 'covered';
  if (main.EyesOpen?.Value === false && (main.EyesOpen.Confidence ?? 0) >= 90) return 'eyes_closed';
  return null;
}

/** Rekognition liveness feedback codes -> our reasons (first mapped code wins). */
const FEEDBACK_REASON: Record<string, FaceCheckReason> = {
  LOW_LIGHTING_DETECTED: 'too_dark',
  HIGH_LIGHTING_DETECTED: 'too_bright',
  FACE_OBSTRUCTION_DETECTED: 'covered',
  EYES_CLOSED_DETECTED: 'eyes_closed',
  FACE_NOT_ALIGNED: 'pose',
  FACE_NOT_VISIBLE: 'no_face',
  LOW_VIDEO_QUALITY_DETECTED: 'blurry',
};

/**
 * Did the live video pass? null = yes. Otherwise the reason, using
 * Rekognition's own retry hints when it gave any. Pure, so it is easy to test.
 */
export function evaluateLiveness(
  r: { status?: string; confidence?: number | null; feedbackCodes?: string[] },
  minConfidence = livenessMinConfidence(),
): FaceCheckReason | null {
  if (r.status === 'SUCCEEDED' && (r.confidence ?? 0) >= minConfidence) return null;
  for (const code of r.feedbackCodes ?? []) {
    if (FEEDBACK_REASON[code]) return FEEDBACK_REASON[code];
  }
  return 'liveness_failed';
}

// ─── Rekognition ─────────────────────────────────────────────────────────────

type RekModule = typeof import('@aws-sdk/client-rekognition');
let rek: { mod: RekModule; client: InstanceType<RekModule['RekognitionClient']> } | null = null;

async function rekognition() {
  if (!rek) {
    const mod = await import('@aws-sdk/client-rekognition');
    // Credentials: the server's IAM role (default AWS credential chain).
    const client = new mod.RekognitionClient({ region: process.env.AWS_REGION || 'ap-south-1' });
    rek = { mod, client };
  }
  return rek;
}

const isJpegOrPng = (fileUrl: string) => ['.jpg', '.jpeg', '.png'].includes(path.extname(fileUrl).toLowerCase());

/** Compare a selfie with the driver's verified Profile Photo. Never throws for a bad photo. */
async function compareWithProfile(
  driverId: string,
  selfie: Buffer,
): Promise<{ passed: boolean; reason: FaceCheckReason | null; similarity: number | null }> {
  const profile = await verifiedProfilePhoto(driverId);
  if (!profile) return { passed: false, reason: 'no_profile_photo', similarity: null };
  if (!isJpegOrPng(profile.fileUrl)) return { passed: false, reason: 'profile_photo_unusable', similarity: null };

  const { mod, client } = await rekognition();
  try {
    const det = await client.send(new mod.DetectFacesCommand({
      Image: { Bytes: selfie },
      Attributes: ['DEFAULT', 'SUNGLASSES', 'FACE_OCCLUDED', 'EYES_OPEN'],
    }));
    const bad = evaluateSelfie((det.FaceDetails ?? []) as FaceDetailLite[]);
    if (bad) return { passed: false, reason: bad, similarity: null };

    const profileBytes = await readStoredFile(profile.fileUrl);
    const cmp = await client.send(new mod.CompareFacesCommand({
      SourceImage: { Bytes: selfie },
      TargetImage: { Bytes: profileBytes },
      SimilarityThreshold: 0,
    }));
    const matches = cmp.FaceMatches ?? [];
    if (matches.length === 0 && (cmp.UnmatchedFaces ?? []).length === 0) {
      // No face found in the Profile Photo itself.
      return { passed: false, reason: 'profile_photo_unusable', similarity: null };
    }
    const best = Math.max(0, ...matches.map((m) => m.Similarity ?? 0));
    const similarity = Math.round(best * 10) / 10;
    return best >= MATCH_THRESHOLD
      ? { passed: true, reason: null, similarity }
      : { passed: false, reason: 'no_match', similarity };
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'InvalidParameterException') return { passed: false, reason: 'no_face', similarity: null };
    if (name === 'InvalidImageFormatException' || name === 'ImageTooLargeException') {
      return { passed: false, reason: 'profile_photo_unusable', similarity: null };
    }
    logger.error({ err, driverId }, 'Face check: Rekognition call failed');
    return { passed: false, reason: 'service_error', similarity: null };
  }
}

// ─── Running a check ─────────────────────────────────────────────────────────

/** Keep a driver's one-time consent (needed before the first check). */
async function ensureConsent(driverId: string, consent: boolean): Promise<void> {
  const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { faceConsentAt: true } });
  if (driver?.faceConsentAt) return;
  if (!consent) throw new ValidationError('Please agree to the face check first');
  await prisma.driver.update({ where: { id: driverId }, data: { faceConsentAt: new Date() } });
}

const unavailable = () =>
  new AppError(503, REASON_MESSAGES.service_error, 'FACE_CHECK_UNAVAILABLE');

export interface LivenessSessionInfo {
  sessionId: string;
  region: string;
  /** 15-minute credentials that can ONLY stream this liveness video. */
  credentials: { accessKeyId: string; secretAccessKey: string; sessionToken: string; expiration: string };
}

/**
 * Step 1: create a liveness session for this driver and hand the app
 * credentials that can do nothing except stream that video to Rekognition.
 */
export async function startLivenessSession(driverId: string, consent: boolean): Promise<LivenessSessionInfo> {
  if (!isFaceCheckEnabled()) throw new ValidationError('The face check is not switched on');
  const roleArn = process.env.FACE_LIVENESS_ROLE_ARN;
  if (!roleArn) {
    logger.error('Face check: FACE_LIVENESS_ROLE_ARN is not set');
    throw unavailable();
  }

  // Nothing to compare with -> tell the driver why, before spending an AWS call.
  const profile = await verifiedProfilePhoto(driverId);
  if (!profile) throw new ValidationError(REASON_MESSAGES.no_profile_photo);
  if (!isJpegOrPng(profile.fileUrl)) throw new ValidationError(REASON_MESSAGES.profile_photo_unusable);

  await ensureConsent(driverId, consent);

  const starts = await redis.incr(startsKey(driverId));
  if (starts === 1) await redis.expire(startsKey(driverId), 3600);
  if (starts > MAX_ATTEMPTS_PER_HOUR) {
    throw new TooManyRequestsError('Too many tries. Please wait a while and try again.');
  }

  const region = process.env.AWS_REGION || 'ap-south-1';
  try {
    const { mod, client } = await rekognition();
    const created = await client.send(new mod.CreateFaceLivenessSessionCommand({
      ClientRequestToken: randomUUID(),
      // The reference image comes back to us as bytes; nothing is kept in S3.
      Settings: { AuditImagesLimit: 0 },
    }));
    const sessionId = created.SessionId;
    if (!sessionId) throw new Error('Rekognition returned no SessionId');
    // Bind the session to this driver: only they may complete it, once.
    await redis.set(sessionKey(sessionId), driverId, 'EX', SESSION_TTL_S);

    const { STSClient, AssumeRoleCommand } = await import('@aws-sdk/client-sts');
    const sts = new STSClient({ region });
    const out = await sts.send(new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: `driver-${driverId.replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}`,
      DurationSeconds: 900, // the shortest STS allows
      // Even if the role were ever widened, these credentials can do only this.
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Action: 'rekognition:StartFaceLivenessSession', Resource: '*' }],
      }),
    }));
    const c = out.Credentials;
    if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken || !c.Expiration) {
      throw new Error('STS returned no credentials');
    }
    return {
      sessionId,
      region,
      credentials: {
        accessKeyId: c.AccessKeyId,
        secretAccessKey: c.SecretAccessKey,
        sessionToken: c.SessionToken,
        expiration: c.Expiration.toISOString(),
      },
    };
  } catch (err) {
    logger.error({ err, driverId }, 'Face check: could not start a liveness session');
    throw unavailable();
  }
}

export interface FaceCheckResult {
  passed: boolean;
  reason: FaceCheckReason | null;
  message: string | null;
  validUntil: Date | null;
}

/** Store an attempt, and on a pass start the 2-hour window. */
async function recordResult(
  driverId: string,
  result: { passed: boolean; reason: FaceCheckReason | null; similarity: number | null },
  selfieUrl: string | null,
): Promise<FaceCheckResult> {
  await prisma.driverFaceCheck.create({
    data: { driverId, passed: result.passed, reason: result.reason, similarity: result.similarity, selfieUrl },
  });

  let validUntil: Date | null = null;
  if (result.passed) {
    validUntil = faceCheckValidUntil(new Date());
    await prisma.driver.update({ where: { id: driverId }, data: { faceCheckValidUntil: validUntil } });
  } else if (result.reason === 'no_match') {
    await flagRepeatedMismatch(driverId);
  }

  logger.info({ driverId, passed: result.passed, reason: result.reason, similarity: result.similarity }, 'Face check');
  return {
    passed: result.passed,
    reason: result.reason,
    message: result.reason ? REASON_MESSAGES[result.reason] : null,
    validUntil,
  };
}

/**
 * Step 3: the app says the video was sent. Fetch the verdict from Rekognition
 * (never trusting the app), then check liveness, photo quality and the match.
 */
export async function completeLivenessSession(driverId: string, sessionId: string): Promise<FaceCheckResult> {
  if (!isFaceCheckEnabled()) throw new ValidationError('The face check is not switched on');

  // Single use, and only by the driver it was created for.
  const owner = await redis.getdel(sessionKey(sessionId));
  if (owner !== driverId) {
    throw new ValidationError('This face check expired. Please start again.');
  }

  let res;
  try {
    const { mod, client } = await rekognition();
    res = await client.send(new mod.GetFaceLivenessSessionResultsCommand({ SessionId: sessionId }));
  } catch (err) {
    logger.error({ err, driverId }, 'Face check: could not read the liveness result');
    throw unavailable();
  }

  const feedbackCodes = ((res as { Feedback?: Array<{ Code?: string }> }).Feedback ?? [])
    .map((f) => f.Code ?? '')
    .filter(Boolean);
  const confidence = res.Confidence ?? null;
  const liveReason = evaluateLiveness({ status: res.Status, confidence, feedbackCodes });

  // The frame Rekognition took from the live video (kept 30 days for the vendor).
  const refBytes = res.ReferenceImage?.Bytes ? Buffer.from(res.ReferenceImage.Bytes) : null;
  const selfieUrl = refBytes ? await saveBufferFile(refBytes, '.jpg', 'image/jpeg').catch(() => null) : null;

  if (liveReason) {
    logger.warn({ driverId, status: res.Status, confidence, feedbackCodes }, 'Face check: liveness not confirmed');
    return recordResult(driverId, { passed: false, reason: liveReason, similarity: null }, selfieUrl);
  }
  if (!refBytes) {
    logger.error({ driverId }, 'Face check: liveness passed but no reference image came back');
    throw unavailable();
  }

  logger.info({ driverId, confidence }, 'Face check: liveness confirmed');
  const match = await compareWithProfile(driverId, refBytes);
  if (match.reason === 'service_error') throw unavailable();
  return recordResult(driverId, match, selfieUrl);
}

/**
 * MISMATCH_FLAG_AFTER "different person" results in a row (ignoring
 * quality retries like a dark photo) raise one open 'face_mismatch' flag.
 * The vendor sees it in the driver's details; admins in Duplicate flags.
 */
async function flagRepeatedMismatch(driverId: string): Promise<void> {
  try {
    const recent = await prisma.driverFaceCheck.findMany({
      where: { driverId, OR: [{ passed: true }, { reason: 'no_match' }] },
      orderBy: { createdAt: 'desc' },
      take: MISMATCH_FLAG_AFTER,
      select: { passed: true },
    });
    if (recent.length < MISMATCH_FLAG_AFTER || recent.some((r) => r.passed)) return;
    const open = await prisma.identityFlag.findFirst({ where: { kind: 'face_mismatch', driverId, resolvedAt: null } });
    if (open) return;
    await prisma.identityFlag.create({
      data: {
        kind: 'face_mismatch',
        driverId,
        otherDriverId: null,
        detail: `${MISMATCH_FLAG_AFTER} selfies in a row did not match the Profile Photo`,
      },
    });
    logger.warn({ driverId }, 'Face check: repeated mismatch flagged');
  } catch (err) {
    logger.error({ err, driverId }, 'Face check: could not flag mismatch');
  }
}

/** Latest checks for the vendor/admin driver drawer. */
export async function listFaceChecks(driverId: string, take = 10) {
  const [checks, openFlag] = await Promise.all([
    prisma.driverFaceCheck.findMany({
      where: { driverId },
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, passed: true, reason: true, similarity: true, selfieUrl: true, createdAt: true },
    }),
    prisma.identityFlag.findFirst({
      where: { kind: 'face_mismatch', driverId, resolvedAt: null },
      select: { createdAt: true, detail: true },
    }),
  ]);
  return {
    enabled: isFaceCheckEnabled(),
    mismatchFlag: openFlag,
    checks: checks.map((c) => ({
      ...c,
      message: c.reason ? REASON_MESSAGES[c.reason as FaceCheckReason] ?? c.reason : null,
    })),
  };
}

// ─── Sweeper: "face check due" pushes + selfie deletion ──────────────────────

const SWEEP_MS = 5 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;

/**
 * Online drivers whose check ran out get one push per expiry. Drivers in the
 * middle of a trip are skipped until it ends (the next sweep catches them).
 */
export async function sendFaceCheckDueNotices(): Promise<number> {
  if (!isFaceCheckEnabled()) return 0;
  const rows = await prisma.$queryRaw<Array<{ id: string; valid_until: Date | null }>>`
    SELECT d.id, d.face_check_valid_until AS valid_until
    FROM drivers d
    WHERE d.is_online = true
      AND d.status = 'active'
      AND d.kyc_status = 'approved'
      AND (d.face_check_valid_until IS NULL OR d.face_check_valid_until <= NOW())
      AND EXISTS (
        SELECT 1 FROM driver_documents p
        WHERE p.driver_id = d.id AND p.type = 'photo' AND p.status = 'verified'
      )
      AND NOT EXISTS (SELECT 1 FROM rides r WHERE r.driver_id = d.id AND r.status = 'in_progress')
      AND NOT EXISTS (SELECT 1 FROM rentals rt WHERE rt.driver_id = d.id AND rt.status = 'in_progress')
  `;
  let sent = 0;
  for (const r of rows) {
    const ref = `${r.id}:${r.valid_until ? r.valid_until.toISOString() : 'none'}`;
    try {
      // The unique (kind, ref) row makes it once per expiry, even with two API instances.
      await prisma.driverNoticeLog.create({ data: { driverId: r.id, kind: 'face_check_due', ref } });
    } catch {
      continue; // already sent for this expiry
    }
    await notifyFaceCheckDue(r.id);
    sent++;
  }
  return sent;
}

/** Delete selfie files older than SELFIE_RETENTION_DAYS. */
export async function deleteOldSelfies(): Promise<number> {
  const cutoff = new Date(Date.now() - SELFIE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const old = await prisma.driverFaceCheck.findMany({
    where: { createdAt: { lt: cutoff }, selfieUrl: { not: null } },
    select: { id: true, selfieUrl: true },
    take: 500,
  });
  let deleted = 0;
  for (const c of old) {
    try {
      await deleteFromAzureBlob(path.basename(c.selfieUrl!));
    } catch (err) {
      // A file that is already gone is fine; anything else is retried next sweep.
      if ((err as { code?: string; statusCode?: number })?.statusCode !== 404) {
        logger.error({ err, faceCheckId: c.id }, 'Face check: selfie delete failed');
        continue;
      }
    }
    await prisma.driverFaceCheck.update({ where: { id: c.id }, data: { selfieUrl: null } });
    deleted++;
  }
  return deleted;
}

async function sweep(): Promise<void> {
  try {
    const sent = await sendFaceCheckDueNotices();
    if (sent > 0) logger.info({ sent }, 'Face check due notices sent');
  } catch (err) {
    logger.error({ err }, 'Face check due sweep failed');
  }
  try {
    const deleted = await deleteOldSelfies();
    if (deleted > 0) logger.info({ deleted }, 'Old selfies deleted');
  } catch (err) {
    logger.error({ err }, 'Selfie retention sweep failed');
  }
}

export function initFaceCheckSweeper(): void {
  if (timer) return;
  void sweep();
  timer = setInterval(() => void sweep(), SWEEP_MS);
  timer.unref?.();
}

export function stopFaceCheckSweeper(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
