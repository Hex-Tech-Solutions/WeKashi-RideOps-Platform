// k6 load test for the driver GPS ping path (the dominant load on this app).
//
//   node scripts/loadtest/make-tokens.mjs --count 3000 --secret <JWT_ACCESS_SECRET>
//   k6 run -e BASE_URL=https://staging.example.com scripts/loadtest/gps.k6.js
//
// Options (-e NAME=value):
//   BASE_URL   target (default http://localhost:3000)
//   PEAK_RPS   peak pings per second (default 300 = ~3000 drivers at 10s)
//   HOLD       time to hold the peak (default 3m)
//   SOCKETS    number of Socket.IO driver connections to hold (default 0 = off;
//              needs tokens made from REAL driver ids via --ids)
//
// What to watch while it runs (on the server):
//   docker stats                      -> api CPU near 100% of one core = Node ceiling
//   docker compose exec postgres psql -U $POSTGRES_USER -c "select count(*), state from pg_stat_activity group by 2"
//   docker compose exec redis redis-cli slowlog get 10

import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Trend, Rate } from 'k6/metrics';

const tokens = new SharedArray('tokens', () => JSON.parse(open('./tokens.json')));

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const PEAK = parseInt(__ENV.PEAK_RPS || '300', 10);
const HOLD = __ENV.HOLD || '3m';
const SOCKETS = parseInt(__ENV.SOCKETS || '0', 10);

const pingLatency = new Trend('ping_latency', true);
const pingFail = new Rate('ping_failed');

const SMOKE = __ENV.SMOKE === '1'; // ~1 minute sanity run

const stages = SMOKE
  ? [
      { target: PEAK, duration: '15s' },
      { target: PEAK, duration: '30s' },
      { target: 0, duration: '5s' },
    ]
  : [
      { target: Math.round(PEAK / 3), duration: '1m' },
      { target: PEAK, duration: '2m' },
      { target: PEAK, duration: HOLD },
      { target: Math.round(PEAK * 2), duration: '2m' }, // push past target to find the ceiling
      { target: Math.round(PEAK * 2), duration: '2m' },
      { target: 0, duration: '30s' },
    ];

const scenarios = {
  gps_pings: {
    executor: 'ramping-arrival-rate',
    startRate: 20,
    timeUnit: '1s',
    preAllocatedVUs: 200,
    maxVUs: 1500,
    stages,
    exec: 'ping',
  },
  health: {
    executor: 'constant-arrival-rate',
    rate: 1, timeUnit: '1s', duration: SMOKE ? '50s' : '10m',
    preAllocatedVUs: 2, maxVUs: 5,
    exec: 'health',
  },
};

if (SOCKETS > 0) {
  scenarios.sockets = {
    executor: 'per-vu-iterations',
    vus: SOCKETS, iterations: 1, maxDuration: '10m',
    exec: 'socket',
  };
}

export const options = {
  scenarios,
  thresholds: {
    ping_failed: ['rate<0.01'],
    ping_latency: ['p(95)<500', 'p(99)<1500'],
    'http_req_duration{name:health}': ['p(95)<1000'],
  },
};

export function ping() {
  const token = tokens[Math.floor(Math.random() * tokens.length)];
  // Roughly Bengaluru, with jitter so positions differ.
  const body = JSON.stringify({
    lat: 12.9 + Math.random() * 0.2,
    lng: 77.5 + Math.random() * 0.2,
  });
  const res = http.post(`${BASE}/api/driver/location`, body, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    tags: { name: 'ping' },
    timeout: '15s',
  });
  const ok = check(res, { 'ping 200': (r) => r.status === 200 });
  pingFail.add(!ok);
  pingLatency.add(res.timings.duration);
}

export function health() {
  const res = http.get(`${BASE}/health`, { tags: { name: 'health' } });
  check(res, { 'health 200': (r) => r.status === 200 });
}

// Minimal Socket.IO (EIO=4) client over a raw websocket: connect to /driver,
// answer engine.io pings, and stay connected for the test.
export function socket() {
  const token = tokens[(__VU - 1) % tokens.length];
  const url = BASE.replace(/^http/, 'ws') + '/socket.io/?EIO=4&transport=websocket';
  const res = ws.connect(url, {}, (s) => {
    s.on('message', (msg) => {
      if (msg === '2') s.send('3');                       // engine.io ping -> pong
      if (msg.startsWith('0')) s.send(`40/driver,${JSON.stringify({ token })}`); // open -> join namespace
    });
    s.setTimeout(() => s.close(), 9 * 60 * 1000);
  });
  check(res, { 'ws upgraded': (r) => r && r.status === 101 });
  sleep(1);
}
