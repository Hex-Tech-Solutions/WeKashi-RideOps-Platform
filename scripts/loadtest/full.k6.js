// Full-app, READ-ONLY load test against production.
//
// Simulates, all at the same time:
//   - drivers with the app open: the screens' real polling (offers, rides,
//     scheduled, rentals, SOS/issues, credits, stats) + a GPS ping each cycle
//   - supervisors on their console: live-ops, rides, rentals, issues,
//     pending payments, and the heavy dashboard
//   - long-lived Socket.IO connections (/driver and /supervisor)
// The driver count steps up (default 500 -> 1000 -> 2000 -> 3000 -> 4000) to
// find where it breaks. The run ABORTS itself if errors pass 5% or p95 passes
// 3s, so production isn't left broken.
//
// SAFE BY DESIGN: only GET requests, plus GPS pings from FAKE driver ids
// (unknown ids update no rows). Real ids are used only for GETs and for
// sockets, which change nothing. No rides, SMS, pushes, or payments.
//
// Tokens: fulltokens.json (made on the server, see the instructions).
//
//   k6 run -e BASE_URL=https://wekashi.in -e SMOKE=1 scripts/loadtest/full.k6.js
//   k6 run -e BASE_URL=https://wekashi.in scripts/loadtest/full.k6.js
//
// Options (-e NAME=value):
//   DRIVER_STEPS  comma list of concurrent drivers-with-app-open (default 500,1000,2000,3000,4000)
//   SUPERVISORS   concurrent supervisor consoles (default 50)
//   SOCKETS       socket connections to hold (default 500)

import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Trend, Rate } from 'k6/metrics';

const load = (key) => new SharedArray(key, () => JSON.parse(open('./fulltokens.json'))[key] || []);
const fakeDrivers = load('fakeDrivers');
const realDrivers = load('realDrivers');
const realSupervisors = load('realSupervisors');
const fakeSupervisors = load('fakeSupervisors');

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const WS_BASE = BASE.replace(/^http/, 'ws');
const SMOKE = __ENV.SMOKE === '1';
const STEPS = SMOKE ? [100] : (__ENV.DRIVER_STEPS || '500,1000,2000,3000,4000').split(',').map(Number);
const SUPERVISORS = parseInt(__ENV.SUPERVISORS || (SMOKE ? '10' : '50'), 10);
const SOCKETS = parseInt(__ENV.SOCKETS || (SMOKE ? '20' : '500'), 10);

const DRIVER_CYCLE_S = 8;  // fastest driver-screen poll interval
const SUP_CYCLE_S = 15;    // live-ops / rides / rentals poll interval

// Driver stages: each step = 1m ramp + 2m hold (smoke: 20s + 30s).
// STEP_RAMP / STEP_HOLD: seconds per step (default 60 / 120).
const RAMP_S = SMOKE ? 20 : parseInt(__ENV.STEP_RAMP || '60', 10);
const HOLD_S = SMOKE ? 30 : parseInt(__ENV.STEP_HOLD || '120', 10);
const stages = [];
for (const n of STEPS) {
  stages.push({ target: Math.ceil(n / DRIVER_CYCLE_S), duration: `${RAMP_S}s` });
  stages.push({ target: Math.ceil(n / DRIVER_CYCLE_S), duration: `${HOLD_S}s` });
}
stages.push({ target: 0, duration: '20s' });
const totalSec = STEPS.length * (RAMP_S + HOLD_S) + 20;

// Real supervisors carry real data (the heavy, realistic case). The API rate
// limit is 3000 req / 15 min per user, so each real account can only stand in
// for a few consoles; the rest use fake ids (same queries, empty results).
const realSupShare = realSupervisors.length
  ? Math.min(1, (6 * realSupervisors.length) / SUPERVISORS)
  : 0;

const rateLimited = new Counter('rate_limited_429');

const scenarios = {
  driver_app: {
    executor: 'ramping-arrival-rate',
    startRate: 1,
    timeUnit: '1s',
    preAllocatedVUs: 100,
    maxVUs: 2500,
    stages,
    exec: 'driverCycle',
  },
  supervisor_app: {
    executor: 'constant-arrival-rate',
    rate: SUPERVISORS,
    timeUnit: `${SUP_CYCLE_S}s`,
    duration: `${totalSec}s`,
    preAllocatedVUs: 20,
    maxVUs: 300,
    exec: 'supervisorCycle',
  },
};

if (SOCKETS > 0 && realDrivers.length + realSupervisors.length > 0) {
  scenarios.sockets = {
    executor: 'per-vu-iterations',
    vus: SOCKETS,
    iterations: 1,
    maxDuration: `${totalSec + 60}s`,
    exec: 'socket',
  };
}

const p95 = (ms) => [`p(95)<${ms}`];
export const options = {
  scenarios,
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    // Safety brake: stop the test before it takes production down.
    // NO_ABORT=1 disables it (used for the API-restart phase, where errors are expected).
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: __ENV.NO_ABORT !== '1', delayAbortEval: '30s' }],
    http_req_duration: [{ threshold: `p(95)<${__ENV.ABORT_P95 || 3000}`, abortOnFail: __ENV.NO_ABORT !== '1', delayAbortEval: '30s' }],
    // Per-endpoint numbers (listed in the summary).
    'http_req_duration{name:gps_ping}': p95(500),
    'http_req_duration{name:drv_offers}': p95(1000),
    'http_req_duration{name:drv_rides}': p95(1000),
    'http_req_duration{name:drv_scheduled}': p95(1000),
    'http_req_duration{name:drv_rentals_available}': p95(1000),
    'http_req_duration{name:drv_rentals_mine}': p95(1000),
    'http_req_duration{name:drv_issues}': p95(1000),
    'http_req_duration{name:drv_credits}': p95(1000),
    'http_req_duration{name:drv_stats}': p95(1000),
    'http_req_duration{name:sup_dashboard}': p95(2000),
    'http_req_duration{name:sup_live_ops}': p95(1500),
    'http_req_duration{name:sup_rides}': p95(1500),
    'http_req_duration{name:sup_rentals}': p95(1500),
    'http_req_duration{name:sup_issues}': p95(1500),
    'http_req_duration{name:sup_payments}': p95(1500),
    rate_limited_429: ['count<1'],
  },
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const auth = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

// /driver/rentals/available answers 404 for a driver id that doesn't exist
// (our fake drivers); for them that is the correct response, not a failure.
const FAKE_OK = new Set(['drv_rentals_available']);
const ok200or404 = http.expectedStatuses(200, 404);

function get(path, name, token) {
  const params = { headers: auth(token), tags: { name }, timeout: '20s' };
  if (FAKE_OK.has(name)) params.responseCallback = ok200or404;
  return ['GET', `${BASE}${path}`, null, params];
}

function record(responses) {
  for (const r of responses) {
    if (r.status === 429) rateLimited.add(1);
  }
  check(responses, {
    'all ok': (rs) => rs.every((r) => r.status === 200 || (r.status === 404 && r.url.includes('/driver/rentals/available'))),
  });
}

// One driver's 8-second polling cycle. Fake ids only, so the GPS ping can
// never move a real driver or mark one online.
export function driverCycle() {
  const token = pick(fakeDrivers);
  const reqs = [
    get('/api/driver/offers', 'drv_offers', token),
    get('/api/driver/rides', 'drv_rides', token),
    get('/api/driver/scheduled', 'drv_scheduled', token),
    get('/api/driver/rentals/available', 'drv_rentals_available', token),
    get('/api/driver/rentals/mine', 'drv_rentals_mine', token),
    get('/api/issues', 'drv_issues', token),
    ['POST', `${BASE}/api/driver/location`,
      JSON.stringify({ lat: 12.9 + Math.random() * 0.2, lng: 77.5 + Math.random() * 0.2 }),
      { headers: auth(token), tags: { name: 'gps_ping' }, timeout: '20s' }],
  ];
  if (Math.random() < DRIVER_CYCLE_S / 30) reqs.push(get('/api/driver/credits', 'drv_credits', token));
  if (Math.random() < DRIVER_CYCLE_S / 60) reqs.push(get('/api/driver/stats', 'drv_stats', token));
  record(http.batch(reqs));
}

// One supervisor console's 15-second cycle; the dashboard polls every 30s.
export function supervisorCycle() {
  const useReal = Math.random() < realSupShare;
  const token = useReal ? pick(realSupervisors) : pick(fakeSupervisors);
  const reqs = [
    get('/api/supervisor/live-ops', 'sup_live_ops', token),
    get('/api/rides?page=1&limit=20', 'sup_rides', token),
    get('/api/supervisor/rentals', 'sup_rentals', token),
    get('/api/issues', 'sup_issues', token),
    get('/api/payments/pending', 'sup_payments', token),
  ];
  if (Math.random() < 0.5) reqs.push(get('/api/supervisor/dashboard', 'sup_dashboard', token));
  record(http.batch(reqs));
}

// Socket.IO (EIO=4) over a raw websocket: join the namespace, answer pings,
// hold for the whole test. Real ids only (the driver handshake checks the DB).
// Like the real socket.io client, a dropped socket reconnects after a random
// 1-5s delay, so an API restart shows how fast every client gets back.
const wsJoinTime = new Trend('ws_join_time', true);
const wsJoined = new Rate('ws_joined');
const wsReconnects = new Counter('ws_reconnects');
const wsConnectFailed = new Counter('ws_connect_failed');

export function socket() {
  const useDriver = realDrivers.length > 0 && (__VU % 5 !== 0 || realSupervisors.length === 0);
  const ns = useDriver ? '/driver' : '/supervisor';
  const token = useDriver ? realDrivers[__VU % realDrivers.length] : realSupervisors[__VU % realSupervisors.length];
  const end = Date.now() + (totalSec - 15) * 1000;
  sleep(Math.random() * 10); // spread the initial handshakes over 10s

  let first = true;
  while (Date.now() < end - 2000) {
    if (!first) { wsReconnects.add(1); sleep(1 + Math.random() * 4); }
    first = false;
    const t0 = Date.now();
    let joined = false;
    const res = ws.connect(`${WS_BASE}/socket.io/?EIO=4&transport=websocket`, {}, (s) => {
      s.on('message', (msg) => {
        if (msg === '2') s.send('3');
        else if (msg.startsWith('0')) s.send(`40${ns},${JSON.stringify({ token })}`);
        else if (msg.startsWith(`40${ns}`) && !joined) { joined = true; wsJoinTime.add(Date.now() - t0); }
      });
      s.setTimeout(() => s.close(), Math.max(1000, end - Date.now()));
    });
    if (!res || res.status !== 101) wsConnectFailed.add(1);
    wsJoined.add(joined);
  }
}
