// Upload an Android App Bundle to Google Play and release it, using the
// Google Play Developer API with a service account.
//
//   node scripts/play-publish.mjs --check
//       read-only: show what is on the production track, change nothing
//   node scripts/play-publish.mjs --aab <file> --notes "<text>" [--rollout 1] [--track production]
//       upload the bundle, create the release, send it for review
//
// The key is read from secrets/play-publisher.json (git-ignored) or the path in
// PLAY_SERVICE_ACCOUNT_JSON. Nothing from the key is ever printed.
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const jwt = require('jsonwebtoken');

const PACKAGE = 'in.wekashi.driver';
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;
const UPLOAD = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}`;

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
};
const has = (name) => process.argv.includes(`--${name}`);

const keyPath = process.env.PLAY_SERVICE_ACCOUNT_JSON || new URL('../secrets/play-publisher.json', import.meta.url);
if (!existsSync(keyPath)) { console.error('Service account key not found'); process.exit(1); }

async function accessToken() {
  const sa = JSON.parse(readFileSync(keyPath, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 },
    sa.private_key, { algorithm: 'RS256' },
  );
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Sign-in failed (${res.status}): ${body.error_description || body.error}`);
  return body.access_token;
}

let TOKEN;
async function call(method, url, body, headers = {}) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body && !(body instanceof Buffer) ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body instanceof Buffer ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${url.replace(API, '').replace(UPLOAD, '')} -> ${res.status}: ${json.error?.message || text}`);
  return json;
}

function showTrack(t) {
  console.log(`track: ${t.track}`);
  for (const r of t.releases || []) {
    const notes = (r.releaseNotes || []).map((n) => n.language).join(',') || '-';
    const pct = r.userFraction ? ` ${Math.round(r.userFraction * 100)}%` : '';
    console.log(`  release "${r.name || ''}" versionCodes=${(r.versionCodes || []).join(',')} status=${r.status}${pct} notes=[${notes}]`);
  }
}

async function main() {
  TOKEN = await accessToken();
  const trackName = arg('track', 'production');
  const edit = await call('POST', `${API}/edits`, {});
  const E = `${API}/edits/${edit.id}`;
  try {
    const track = await call('GET', `${E}/tracks/${trackName}`);
    showTrack(track);
    const bundles = await call('GET', `${E}/bundles`);
    const codes = (bundles.bundles || []).map((b) => b.versionCode);
    console.log(`bundles on Play: versionCodes ${codes.sort((a, b) => a - b).join(', ') || 'none'}`);

    if (has('check')) { await call('DELETE', E); console.log('check only: nothing changed'); return; }

    const aab = arg('aab');
    const notes = arg('notes');
    if (!aab || !existsSync(aab)) throw new Error('--aab <file> is required');
    if (!notes) throw new Error('--notes "<text>" is required');
    const rollout = Number(arg('rollout', '1'));
    if (!(rollout > 0 && rollout <= 1)) throw new Error('--rollout must be between 0 and 1');

    console.log(`uploading ${aab} ...`);
    const up = await call('POST', `${UPLOAD}/edits/${edit.id}/bundles?uploadType=media`,
      readFileSync(aab), { 'Content-Type': 'application/octet-stream' });
    console.log(`uploaded: versionCode ${up.versionCode}`);
    if (codes.includes(up.versionCode)) throw new Error(`versionCode ${up.versionCode} was already uploaded`);

    // Release notes must use a language the store listing has; reuse the one
    // from the current release.
    const details = await call('GET', `${E}/details`);
    const lang = arg('lang') || track.releases?.find((r) => r.releaseNotes?.length)?.releaseNotes[0].language || details.defaultLanguage || 'en-US';
    console.log(`release notes language: ${lang}`);
    const release = {
      versionCodes: [String(up.versionCode)],
      status: rollout === 1 ? 'completed' : 'inProgress',
      ...(rollout < 1 ? { userFraction: rollout } : {}),
      releaseNotes: [{ language: lang, text: notes }],
    };
    const updated = await call('PUT', `${E}/tracks/${trackName}`, { track: trackName, releases: [release] });
    showTrack(updated);

    const done = await call('POST', `${E}:commit`);
    console.log(`committed edit ${done.id}: sent to Google for review`);
  } catch (err) {
    await call('DELETE', E).catch(() => {});
    throw err;
  }
}

main().catch((err) => { console.error(`FAILED: ${err.message}`); process.exit(1); });