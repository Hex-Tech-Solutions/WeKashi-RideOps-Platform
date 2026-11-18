/**
 * FRESH START — delete ALL application data and create the three first
 * accounts (admin, supervisor, vendor). DESTRUCTIVE AND IRREVERSIBLE: take a
 * pg_dump first. Never run this on a database holding real customer data.
 *
 * Default is a DRY RUN: it only prints what would be deleted.
 *
 *   node dist/scripts/freshStart.js                     # dry run
 *   WIPE_CONFIRM=DELETE-ALL-DATA node dist/scripts/freshStart.js --run [--include-paid-orders]
 *
 * Inputs (environment variables; passwords are never taken from the command line):
 *   ADMIN_EMAIL ADMIN_PASSWORD [ADMIN_NAME]
 *   SUPERVISOR_EMAIL SUPERVISOR_PASSWORD [SUPERVISOR_NAME] [SUPERVISOR_ORG]
 *   VENDOR_EMAIL VENDOR_PASSWORD [VENDOR_COMPANY] [VENDOR_CONTACT_NAME] [VENDOR_PHONE]
 *
 * Kept: the _prisma_migrations history and PostGIS's spatial_ref_sys (so the
 * schema, migrations and unique indexes stay). Everything else is emptied, and
 * the app's Redis database is flushed (OTPs, rate limits, session blocks).
 */
import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { createVendorAccount } from '../services/admin.service';

export const KEEP_TABLES = ['_prisma_migrations', 'spatial_ref_sys'] as const;
export const CONFIRM_PHRASE = 'DELETE-ALL-DATA';
const BCRYPT_ROUNDS = 12; // same as auth.service / admin.service

/** One TRUNCATE for every table (CASCADE handles foreign keys). Names come from pg_tables. */
export function buildTruncateSql(tables: string[]): string {
  const quoted = tables.map((t) => `"${t.replace(/"/g, '""')}"`).join(', ');
  return `TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`;
}

export interface FreshStartConfig {
  admin: { email: string; password: string; name: string };
  supervisor: { email: string; password: string; name: string; org: string };
  vendor: { email: string; password: string; company: string; contactName: string; phone: string };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Read + validate the inputs. Returns the config, or a list of problems. */
export function readConfig(env: NodeJS.ProcessEnv): { config?: FreshStartConfig; errors: string[] } {
  const get = (k: string, d = '') => (env[k] ?? d).trim();
  const errors: string[] = [];
  const config: FreshStartConfig = {
    admin: { email: get('ADMIN_EMAIL').toLowerCase(), password: env.ADMIN_PASSWORD ?? '', name: get('ADMIN_NAME', 'Wekashi Admin') },
    supervisor: {
      email: get('SUPERVISOR_EMAIL').toLowerCase(), password: env.SUPERVISOR_PASSWORD ?? '',
      name: get('SUPERVISOR_NAME', 'Shreenivas HN'), org: get('SUPERVISOR_ORG', 'Wekashi Cabs'),
    },
    vendor: {
      email: get('VENDOR_EMAIL').toLowerCase(), password: env.VENDOR_PASSWORD ?? '',
      company: get('VENDOR_COMPANY', 'Wekashi Cabs'), contactName: get('VENDOR_CONTACT_NAME', 'Wekashi Operations'),
      phone: get('VENDOR_PHONE', ''),
    },
  };
  for (const [label, a] of [['ADMIN', config.admin], ['SUPERVISOR', config.supervisor], ['VENDOR', config.vendor]] as const) {
    if (!EMAIL_RE.test(a.email)) errors.push(`${label}_EMAIL is missing or not a valid email`);
    if (a.password.length < 8) errors.push(`${label}_PASSWORD must be at least 8 characters`);
  }
  const emails = [config.admin.email, config.supervisor.email, config.vendor.email];
  if (new Set(emails).size !== emails.length) errors.push('The three emails must be different');
  return { config: errors.length ? undefined : config, errors };
}

async function listTables(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
  `;
  return rows.map((r) => r.tablename).filter((t) => !(KEEP_TABLES as readonly string[]).includes(t));
}

async function countRows(table: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(`SELECT count(*)::bigint AS c FROM "${table.replace(/"/g, '""')}"`);
  return Number(rows[0]?.c ?? 0);
}

async function main() {
  const run = process.argv.includes('--run');
  const includePaid = process.argv.includes('--include-paid-orders');

  const { config, errors } = readConfig(process.env);
  if (!config) {
    console.error('Cannot continue:\n - ' + errors.join('\n - '));
    process.exitCode = 1;
    return;
  }

  const tables = await listTables();
  const counts: Array<[string, number]> = [];
  for (const t of tables) counts.push([t, await countRows(t)]);
  const total = counts.reduce((s, [, n]) => s + n, 0);

  const paid = await prisma.packOrder.count({ where: { status: 'paid' } });
  const invoices = await prisma.packOrder.count({ where: { invoiceNo: { not: null } } });

  console.log(run ? '=== FRESH START: REAL RUN ===' : '=== FRESH START: DRY RUN (nothing will be changed) ===');
  console.log(`\nTables that will be EMPTIED (${tables.length}), rows now:`);
  for (const [t, n] of counts.filter(([, n]) => n > 0)) console.log(`  ${t.padEnd(34)} ${n}`);
  console.log(`  ${'(total rows)'.padEnd(34)} ${total}`);
  console.log(`\nKept: ${KEEP_TABLES.join(', ')}`);
  console.log(`\nPaid credit-pack orders: ${paid}   Tax invoices issued: ${invoices}`);
  console.log('\nAccounts that will be created:');
  console.log(`  admin       ${config.admin.email}  (${config.admin.name})`);
  console.log(`  supervisor  ${config.supervisor.email}  (${config.supervisor.name}, ${config.supervisor.org})`);
  console.log(`  vendor      ${config.vendor.email}  (${config.vendor.company}, contact ${config.vendor.contactName}, phone ${config.vendor.phone || 'not set'})`);

  if (!run) {
    console.log('\nDry run only. To really do it:\n  WIPE_CONFIRM=' + CONFIRM_PHRASE + ' node dist/scripts/freshStart.js --run' + (paid > 0 ? ' --include-paid-orders' : ''));
    return;
  }

  // ── Guard rails for the real run ──────────────────────────────────────────
  if (process.env.WIPE_CONFIRM !== CONFIRM_PHRASE) {
    console.error(`\nRefusing: set WIPE_CONFIRM=${CONFIRM_PHRASE} to confirm.`);
    process.exitCode = 1;
    return;
  }
  if (paid > 0 && !includePaid) {
    console.error(`\nRefusing: ${paid} paid pack order(s) and ${invoices} tax invoice(s) exist. Deleting them also deletes the payment and invoice records, and invoice numbers restart at 000001. Re-run with --include-paid-orders if that is intended (and keep your backup).`);
    process.exitCode = 1;
    return;
  }

  // ── 1. Wipe ───────────────────────────────────────────────────────────────
  await prisma.$executeRawUnsafe(buildTruncateSql(tables));
  console.log('\nDatabase emptied.');

  // ── 2. Redis (OTPs, rate limits, block flags, cached active rides) ────────
  try {
    await redis.flushdb();
    console.log('Redis flushed.');
  } catch (err: any) {
    console.warn('Could not flush Redis (continuing):', err?.message ?? err);
  }

  // ── 3. Accounts ───────────────────────────────────────────────────────────
  const adminHash = await bcrypt.hash(config.admin.password, BCRYPT_ROUNDS);
  await prisma.user.create({
    data: { email: config.admin.email, passwordHash: adminHash, role: 'admin', fullName: config.admin.name },
  });

  const supHash = await bcrypt.hash(config.supervisor.password, BCRYPT_ROUNDS);
  await prisma.user.create({
    data: {
      email: config.supervisor.email, passwordHash: supHash, role: 'supervisor',
      fullName: config.supervisor.name, org: config.supervisor.org,
    },
  });

  const vendor = await createVendorAccount({
    company: config.vendor.company,
    contactName: config.vendor.contactName,
    contactEmail: config.vendor.email,
    contactPhone: config.vendor.phone,
    email: config.vendor.email,
    password: config.vendor.password,
  });

  // ── 4. Verify ─────────────────────────────────────────────────────────────
  const users = await prisma.user.findMany({ select: { email: true, role: true, passwordHash: true, isActive: true } });
  const pw: Record<string, string> = {
    [config.admin.email]: config.admin.password,
    [config.supervisor.email]: config.supervisor.password,
    [config.vendor.email]: config.vendor.password,
  };
  console.log('\nAccounts now in the database:');
  for (const u of users) {
    const ok = await bcrypt.compare(pw[u.email] ?? '', u.passwordHash);
    console.log(`  ${u.role.padEnd(11)} ${u.email.padEnd(32)} active=${u.isActive}  password check: ${ok ? 'OK' : 'FAILED'}`);
  }
  console.log(`\nVendor code (drivers need this to sign up): ${vendor.vendorCode}`);
  const left = (await Promise.all((await listTables()).map(async (t) => [t, await countRows(t)] as const))).filter(([, n]) => n > 0);
  console.log('Rows left outside users/vendors:', left.filter(([t]) => !['users', 'vendors'].includes(t)).map(([t, n]) => `${t}=${n}`).join(', ') || 'none');
  console.log('\nDone.');
}

if (require.main === module) {
  main()
    .catch((err) => { console.error('Failed:', err?.message ?? err); process.exitCode = 1; })
    .finally(async () => { await prisma.$disconnect().catch(() => undefined); process.exit(process.exitCode ?? 0); });
}
