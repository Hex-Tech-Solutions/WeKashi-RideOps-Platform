// Generates driver access tokens for the k6 load test.
//
//   node scripts/loadtest/make-tokens.mjs --count 3000 --secret <JWT_ACCESS_SECRET> [--ids ids.txt] [--hours 3]
//
// By default tokens use random UUIDs. That is enough for GPS-ping load: the
// ping path only needs a valid token, and the 60s flush updates by id, so
// unknown ids touch no rows. The optional socket test needs REAL driver ids
// (the handshake checks the drivers table); pass them with --ids (one per line).
//
// Never run the load test against production during business hours.

import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const jwt = require('jsonwebtoken');

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
};

const secret = arg('secret', process.env.JWT_ACCESS_SECRET);
if (!secret) { console.error('Pass --secret or set JWT_ACCESS_SECRET'); process.exit(1); }

const count = parseInt(arg('count', '3000'), 10);
const hours = parseInt(arg('hours', '3'), 10);
const idsFile = arg('ids', null);
const out = arg('out', 'scripts/loadtest/tokens.json');

const ids = idsFile
  ? readFileSync(idsFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  : Array.from({ length: count }, () => randomUUID());

const tokens = ids.map((id) =>
  jwt.sign({ sub: id, role: 'driver', vendorId: '' }, secret, { expiresIn: `${hours}h` }),
);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(tokens));
console.log(`Wrote ${tokens.length} tokens to ${out} (valid ${hours}h)`);
