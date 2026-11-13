/**
 * Driver identity — normalisation + duplicate detection (zero tolerance).
 *
 * One person = one driver account on the whole platform. These keys must be
 * unique across every driver that is not 'removed' (blacklisted / expired
 * accounts keep theirs reserved, so a blocked driver can't rejoin elsewhere):
 *   phone, alt phone (cross-checked against each other), DL number,
 *   Aadhaar / Gov ID (matched by keyed hash — never stored in plain text),
 *   UPI VPA.
 *
 * Matching is done on normalised values in SQL so legacy rows stored in mixed
 * formats (e.g. "+9741194444" vs "919741194444") are still caught. Database
 * unique indexes are added at the fresh-start migration; until then this check
 * is the guard for every new write.
 */
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { logger } from './logger';
import { ValidationError, ConflictError } from '../types';

/** Shown to the user. Deliberately reveals nothing about the other account. */
export const IDENTITY_CONFLICT_MESSAGE =
  'These details are already linked to an existing Wekashi account. Contact your vendor or support.';

// ─── Phone ────────────────────────────────────────────────────────────────────

/**
 * Canonical Indian mobile: "+91" + 10 digits starting 6–9. Accepts 10 digits,
 * 91XXXXXXXXXX, +91XXXXXXXXXX, 0XXXXXXXXXX, with spaces/dashes. Returns null if
 * it isn't a valid Indian mobile.
 */
export function normalizeIndianMobile(input: string | null | undefined): string | null {
  if (!input) return null;
  let d = input.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (!/^[6-9]\d{9}$/.test(d)) return null;
  return `+91${d}`;
}

/** Like normalizeIndianMobile but throws a ValidationError with a clear message. */
export function requireIndianMobile(input: string, label = 'Phone number'): string {
  const p = normalizeIndianMobile(input);
  if (!p) throw new ValidationError(`${label} must be a valid 10-digit Indian mobile number`);
  return p;
}

const last10 = (canonical: string) => canonical.slice(-10);

// ─── DL / Gov ID / VPA ───────────────────────────────────────────────────────

/** DL number: uppercase letters + digits only. */
export function normalizeDl(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Aadhaar: exactly 12 digits (spaces allowed on input). */
export function normalizeAadhaar(input: string): string | null {
  const d = input.replace(/\D/g, '');
  return /^\d{12}$/.test(d) ? d : null;
}

/** Display form kept on the record instead of the full number. */
export function maskAadhaar(digits: string): string {
  return `XXXX XXXX ${digits.slice(-4)}`;
}

/** A value that is already masked (unchanged field sent back by the app). */
export function isMaskedAadhaar(input: string): boolean {
  return /^X{4}\s?X{4}\s?\d{4}$/i.test(input.trim());
}

let warnedSecret = false;
function identitySecret(): string {
  const s = process.env.IDENTITY_HASH_SECRET;
  if (s) return s;
  if (!warnedSecret) {
    warnedSecret = true;
    logger.warn('IDENTITY_HASH_SECRET not set — falling back to JWT_ACCESS_SECRET for Aadhaar hashing. Set a dedicated secret and NEVER change it, or existing hashes stop matching.');
  }
  return process.env.JWT_ACCESS_SECRET ?? 'insecure-dev-identity-secret';
}

/** Keyed one-way hash of an Aadhaar number (for duplicate matching only). */
export function hashAadhaar(digits: string): string {
  return crypto.createHmac('sha256', identitySecret()).update(`aadhaar:${digits}`).digest('hex');
}

export function normalizeVpa(input: string): string {
  return input.trim().toLowerCase();
}

// ─── Duplicate detection ─────────────────────────────────────────────────────

export interface IdentityKeys {
  phone?: string | null;      // canonical +91XXXXXXXXXX
  altPhone?: string | null;   // canonical
  dlNumber?: string | null;   // normalised
  aadhaar?: string | null;    // 12 digits (hashed for the check)
  upiVpa?: string | null;     // normalised
}

export interface IdentityConflict {
  field: keyof IdentityKeys;
  driverId: string;
}

/**
 * Find another (non-removed) driver already holding any of these keys.
 * `excludeDriverId` = the driver being edited.
 */
export async function findIdentityConflict(
  keys: IdentityKeys,
  excludeDriverId?: string,
  db: Prisma.TransactionClient = prisma,
): Promise<IdentityConflict | null> {
  const exclude = excludeDriverId ?? '';
  const base = Prisma.sql`status <> 'removed' AND id <> ${exclude}`;
  const digits10 = (col: Prisma.Sql) => Prisma.sql`right(regexp_replace(coalesce(${col}, ''), '\\D', '', 'g'), 10)`;

  const checks: Array<{ field: keyof IdentityKeys; where: Prisma.Sql }> = [];
  for (const field of ['phone', 'altPhone'] as const) {
    const v = keys[field];
    if (!v) continue;
    const n = last10(v);
    checks.push({
      field,
      where: Prisma.sql`(${digits10(Prisma.sql`phone`)} = ${n} OR ${digits10(Prisma.sql`alt_phone`)} = ${n})`,
    });
  }
  if (keys.dlNumber) {
    checks.push({
      field: 'dlNumber',
      where: Prisma.sql`upper(regexp_replace(coalesce(dl_number, ''), '[^A-Za-z0-9]', '', 'g')) = ${keys.dlNumber}`,
    });
  }
  if (keys.aadhaar) {
    const h = hashAadhaar(keys.aadhaar);
    // gov_id_hash for new rows; the plain-digits compare catches legacy rows.
    checks.push({
      field: 'aadhaar',
      where: Prisma.sql`(gov_id_hash = ${h} OR regexp_replace(coalesce(gov_id_number, ''), '\\D', '', 'g') = ${keys.aadhaar})`,
    });
  }
  if (keys.upiVpa) {
    checks.push({ field: 'upiVpa', where: Prisma.sql`lower(coalesce(upi_vpa, '')) = ${keys.upiVpa}` });
  }

  for (const c of checks) {
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM drivers WHERE ${base} AND ${c.where} LIMIT 1
    `;
    if (rows.length > 0) return { field: c.field, driverId: rows[0].id };
  }
  return null;
}

/**
 * Throw a neutral ConflictError if any key is taken. The matched field and
 * account are logged for admins but never returned to the caller.
 */
export async function assertNoIdentityConflict(
  keys: IdentityKeys,
  excludeDriverId?: string,
  context = 'driver',
  db: Prisma.TransactionClient = prisma,
): Promise<void> {
  const hit = await findIdentityConflict(keys, excludeDriverId, db);
  if (!hit) return;
  logger.warn(
    { context, field: hit.field, existingDriverId: hit.driverId, editingDriverId: excludeDriverId ?? null },
    'Duplicate identity blocked',
  );
  throw new ConflictError(IDENTITY_CONFLICT_MESSAGE);
}

/**
 * Find the account for a sign-in phone. Exact canonical match first; otherwise
 * match on the last 10 digits so legacy test rows in other formats still sign
 * in. Removed accounts are invisible.
 */
export async function findDriverByPhone(canonical: string) {
  const exact = await prisma.driver.findFirst({
    where: { phone: canonical, status: { not: 'removed' } },
  });
  if (exact) return exact;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM drivers
    WHERE status <> 'removed'
      AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = ${last10(canonical)}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return prisma.driver.findUnique({ where: { id: rows[0].id } });
}

/** Record a soft "possible duplicate" signal for admins (never blocks). */
export async function flagPossibleDuplicate(input: {
  kind: string;
  driverId: string;
  otherDriverId: string;
  detail?: string;
}): Promise<void> {
  try {
    // One open flag per pair + kind.
    const existing = await prisma.identityFlag.findFirst({
      where: {
        kind: input.kind,
        resolvedAt: null,
        OR: [
          { driverId: input.driverId, otherDriverId: input.otherDriverId },
          { driverId: input.otherDriverId, otherDriverId: input.driverId },
        ],
      },
      select: { id: true },
    });
    if (existing) return;
    await prisma.identityFlag.create({ data: input });
    logger.warn(input, 'Possible duplicate account flagged');
  } catch (err) {
    logger.error({ err, ...input }, 'Could not record identity flag');
  }
}
