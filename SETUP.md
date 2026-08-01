# WeKashi RideOps Platform — Setup & Deployment Guide

> **Production status:** Feature-complete, security-hardened, and verified end-to-end locally (auth for all 4 roles, ride booking → accept → OTP pickup/drop → completion → payment → wallet → withdrawal, escort policy, cancellation, SOS — all exercised against a live Docker stack).
>
> **Two hard blockers before going live:**
> - **HTTPS/SSL** — configure nginx with Let's Encrypt or put Cloudflare in front
> - **SMS OTP (Twilio)** — drivers cannot log in without it
>
> **Action required from you before payments work:**
> - Activate a **Razorpay X** account at [x.razorpay.com](https://x.razorpay.com) for driver payouts (separate product from standard Razorpay Payments, separate KYC/approval). Razorpay Route is **not used** — see Payments Architecture below.

---

## What's built

| Module | Status |
|--------|--------|
| Supervisor booking flow (route optimization, Google Maps) | ✅ Complete |
| Driver mobile app (Capacitor Android) | ✅ Complete |
| Live GPS tracking via Socket.io | ✅ Complete |
| OTP pickup/drop verification | ✅ Complete |
| SOS system with rebooking | ✅ Complete |
| Women's safety escort policy | ✅ Complete |
| Razorpay Payments (collection) + Razorpay X Payouts (disbursement) | ✅ Complete (needs Razorpay X account activated) |
| Escort charge (50% of fare, goes to driver) | ✅ Complete |
| Driver KYC — DL, Gov ID, alt phone, document upload | ✅ Complete |
| Document approval flow (vendor/admin) | ✅ Complete |
| OTD reporting, saved groups | ✅ Complete |
| Admin / Vendor / Supervisor / Driver role-based portals | ✅ Complete |
| GPS location buffering (Redis → bulk DB flush every 60s) | ✅ Complete |
| Azure Blob Storage for file uploads | ✅ Complete |
| Security hardening (OWASP Top 10 + Snyk) | ✅ Complete |
| Self-service account registration (vendor/supervisor) | ✅ Complete |
| Multiple office locations | ✅ Complete |
| Saved route groups/templates | ✅ Complete |
| AC surcharge, vehicle type pricing | ✅ Complete |

---

## Project Structure

```
WeKashi-RideOps-Platform/
├── src/                     # React frontend (Vite + TypeScript + shadcn/ui)
│   ├── pages/
│   │   ├── admin/           # Admin portal
│   │   ├── vendor/          # Vendor portal
│   │   ├── supervisor/      # Supervisor booking portal
│   │   └── driver/          # Driver mobile app
│   ├── lib/
│   │   ├── escortPolicy.ts  # Women's safety rule engine (FE mirror)
│   │   ├── pricing.ts       # Fare calculation (FE mirror)
│   │   ├── geo.ts           # Route optimization + safety reorder
│   │   └── queries.ts       # React Query hooks over backend API
│   └── components/
│       └── DriverDetailDrawer.tsx  # Vendor/admin driver KYC review panel
├── backend/
│   ├── src/
│   │   ├── routes/          # Express route handlers
│   │   ├── services/        # Business logic (ride, driver, payment, etc.)
│   │   ├── lib/
│   │   │   ├── escortPolicy.ts   # Women's safety rule engine (authoritative)
│   │   │   ├── pricing.ts        # Fare + escort charge calculation
│   │   │   ├── locationBuffer.ts # GPS Redis buffer → bulk DB flush
│   │   │   ├── storage.ts        # Azure Blob / local disk abstraction
│   │   │   └── sanitize.ts       # XSS sanitization
│   │   └── middleware/      # Auth, rate limiting, role guards
│   └── prisma/
│       ├── schema.prisma    # Database schema
│       ├── migrations/      # All applied migrations
│       └── seed.ts          # Demo data seeder
├── android/                 # Capacitor Android wrapper (driver app APK)
├── docker/                  # nginx config
├── docker-compose.yml       # Local dev: Postgres + Redis containers only
├── docker-compose.prod.yml  # Production: API + nginx (DB/Redis = Azure managed)
├── .env.prod.example        # Template for production environment variables
├── API_REFERENCE.md         # Complete API documentation (60+ endpoints)
└── PRODUCTION_ISSUES.txt    # Known issues, technical debt, pending features
```

---

## Pricing Model

| Component | Calculation |
|-----------|------------|
| Base fare | Direct slab: 0–10km @₹50/km · 11–15 @₹45 · 16–20 @₹40 · 21–25 @₹35 · 26+ @₹30 |
| Vehicle surcharge | Hatchback +₹3/km · Sedan +₹5/km · SUV +₹7/km |
| Minimum fare | ₹500 (floor regardless of distance) |
| AC surcharge | +₹100 flat (optional) |
| Escort charge | +50% of driver fare (when women's safety escort is required) |
| Platform fee | ₹20 flat (retained by platform) |

**Money flow:**
```
Supervisor pays = Driver fare + Escort charge (if any) + Platform fee
Driver receives = Driver fare + Escort charge (escort charge goes to driver)
Platform retains = Platform fee only (₹20)
```

**Example (escort ride, 16.2 km, Sedan):**
```
Driver fare    = ₹729  (16.2 × ₹45/km)
Escort charge  = ₹364.5  (50% of ₹729)
Platform fee   = ₹20
Supervisor pays = ₹1,113.5
Driver receives = ₹1,093.5
```

---

## Payments Architecture (Razorpay Payments + Razorpay X Payouts)

Two separate Razorpay products, two separate credential pairs. **Razorpay Route is not used anywhere.**

| Product | Purpose | Credentials |
|---------|---------|-------------|
| Razorpay Payments (Standard Checkout) | Collect the ride fare from the supervisor | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |
| Razorpay X Payouts (Composite Payout API) | Driver withdraws their wallet balance to their own bank/UPI | `RAZORPAY_X_KEY_ID`, `RAZORPAY_X_KEY_SECRET`, `RAZORPAY_X_ACCOUNT_NUMBER`, `RAZORPAY_X_WEBHOOK_SECRET` |

**Flow:**
1. Supervisor pays the full ride amount via Standard Checkout → money lands in the platform's Razorpay account.
2. On confirmed payment, the driver's **in-app wallet** is credited with `driverFare + escortCharge`. The platform keeps only the `platformFee` (₹20).
3. Driver taps **Withdraw** in the app → backend calls the Razorpay X Composite Payout API directly (no fund-account pre-registration step — the API accepts bank/UPI details inline per payout call).
4. Razorpay X charges a payout fee, which is **passed on to the driver**, not absorbed by the platform:
   - ₹5 flat fee + 18% GST = **₹5.90 per payout**
   - Driver requests to withdraw ₹X → wallet is debited ₹(X + 5.90) → driver's bank/UPI receives exactly ₹X
   - Example: wallet has ₹750, driver withdraws ₹744.10 → wallet debited ₹750.00 (744.10 + 5.90) → bank receives ₹744.10
   - Minimum withdrawal: ₹1 (so minimum wallet balance needed is ₹6.90)
5. If the Razorpay X API call fails, the wallet debit is rolled back atomically — no money is lost in transit.
6. The `payout-webhook` endpoint listens for `payout.failed` / `payout.reversed` and refunds the wallet if a payout fails asynchronously after being queued.

**Local dev / mock mode:** If `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` are blank, `/payments/rides/:id/initiate` and `/confirm` run in mock mode (no real Razorpay call, `isMock: true` in the response). If `RAZORPAY_X_KEY_ID`/`RAZORPAY_X_KEY_SECRET` are blank, `/payments/driver/withdraw` runs in mock mode the same way. This is the default in `backend/.env` for local development. **Note:** if you set *real but invalid* keys, the code will attempt the live Razorpay API and surface whatever error Razorpay returns (e.g. `Authentication failed`) — it does not silently fall back to mock mode just because a call fails.

---

## Women's Safety Escort Policy

Escort is required **only** when the ride time is in the restricted window (**19:00–07:00**) AND a female passenger is in a dangerous position in the final route:

| Ride type | Dangerous position | Safe positions |
|-----------|-------------------|----------------|
| Login | seq=0 (first pickup — female alone with driver before others board) | All other positions |
| Logout | Last stop (last drop — female alone with driver after others exit) | All other positions |

**Auto-reorder:** The system automatically puts a male at seq=0 (login) and drops females first (logout). Supervisor can override.

**Hard block:** If escort is required but no escort name is entered, the Broadcast button is disabled. Backend re-validates on ride creation — cannot be bypassed.

**Escort charge:** 50% of driver fare, goes to the driver.

**Per-stop time:** Women's safety window is checked against the per-stop pickup time set beside each employee in Step 2. Female employees must have a stop time set before proceeding to Step 3.

---

## Local Development

### Prerequisites
- Node.js 22+
- Docker Desktop (for Postgres + Redis containers)

### 1. Clone and install
```cmd
git clone https://github.com/Hex-Tech-Solutions/WeKashi-RideOps-Platform.git
cd WeKashi-RideOps-Platform
npm install
cd backend && npm install && cd ..
```

### 2. Start Postgres + Redis
```cmd
docker compose up -d
```

> **Port conflict note:** If you already have a native PostgreSQL or Redis install running on your machine (common on Windows dev boxes), it will bind ports 5432/6379 first and the Docker containers' port mappings will silently fail to publish (the container still runs, but `localhost:5432`/`6379` reaches your native install, not the container). Check with `docker inspect <container> --format "{{json .NetworkSettings.Ports}}"` — if the host port list is empty, something else already owns that port. Either stop the native service or point `DATABASE_URL`/`REDIS_URL` at a different port.

### 3. Configure backend environment
`backend/.env` is already committed for local dev. Verify it contains:
```env
DATABASE_URL=postgresql://rideops:rideops@localhost:5432/rideops
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=change-me-access-secret
JWT_REFRESH_SECRET=change-me-refresh-secret
NODE_ENV=development
CORS_ORIGIN=http://localhost:8080
DEV_OTP_BYPASS=123456
PORT=3000
LOG_LEVEL=debug
```

> `DEV_OTP_BYPASS=123456` lets any driver log in with OTP `123456` during testing.
> The server **refuses to start in production** if this variable is set.

### 4. Set up the database
```cmd
cd backend
npx prisma migrate deploy
npx prisma generate
npm run db:seed
cd ..
```

> Re-run `npm run db:seed` any time Docker restarts from scratch (data is in a named volume — only wiped by `docker compose down -v`).

### 5. Start both servers (two terminals)

**Terminal 1 — Backend API:**
```cmd
cd backend
npm run dev
```
→ `http://localhost:3000`

**Terminal 2 — Frontend:**
```cmd
npm run dev
```
→ `http://localhost:8080`

### 6. Test login credentials

| Role | Login | Password / OTP |
|------|-------|----------------|
| Admin | `admin@rideops.dev` | `Admin123!` |
| Vendor | `vendor@rideops.dev` | `Vendor123!` |
| Supervisor | `supervisor@rideops.dev` | `Super123!` |
| Driver (Ramesh Kumar) | `+919000000001` | `123456` |
| Driver (Suresh Sharma) | `+919000000002` | `123456` |
| Driver (Mahesh Patel) | `+919000000003` | `123456` |

**Seeded data:**
- Office: Brigade South Parade (Trinity, MG Road, Bengaluru)
- 3 drivers — Ramesh Kumar (sedan, online by default), Suresh Sharma, Mahesh Patel
- 5 employees — M1, M2 (male), F1, F2, F3 (female) with Bengaluru addresses

**Driver GPS note:** Go online from the driver app — it uses your device's real GPS. Ramesh Kumar's coordinates are near MG Road (matches the office). For the vehicle availability to show correctly, the driver must be within 10 km of the pickup point (office for logout rides, first employee home for login rides).

### 7. Health check
```
http://localhost:3000/health
→ {"status":"ok","db":"ok","redis":"ok"}
```

---

## Production Deployment (Azure VM + Docker)

### Recommended Azure setup (≈ ₹23,000–28,000/month, South India region)

| Resource | SKU |
|---|---|
| API Server 1 | Standard D2s_v5 (2 vCPU, 8 GB) — Ubuntu 22.04 |
| API Server 2 | Standard D2s_v5 (2 vCPU, 8 GB) — Ubuntu 22.04 |
| PostgreSQL | Azure DB Flexible Server — Standard_D2ds_v4, 128 GB |
| Redis | Azure Cache for Redis — C1 Standard |
| Blob Storage | Standard LRS — container: `rideops-uploads` |
| Load Balancer | Standard — health probe: GET /health on :3000 |

> Use **South India (Chennai)** region — lowest latency from Bangalore (~80ms).

---

### Step 1 — Provision each API VM

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin curl git
sudo usermod -aG docker $USER
newgrp docker
```

### Step 2 — Clone the repo

```bash
cd ~
git clone https://github.com/Hex-Tech-Solutions/WeKashi-RideOps-Platform.git wekashi
cd wekashi
```

> The deploy workflow expects the repo at `~/wekashi` by default. Override with `SERVER_APP_DIR` secret.

### Step 3 — Create the production environment file

```bash
cp .env.prod.example .env.prod
nano .env.prod
```

Fill in every `CHANGE_ME` value. See **Environment Variables** section below.

### Step 4 — Launch

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

Migrations run automatically on container startup. Seed once:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml exec api npm run db:seed
```

### Step 5 — Verify

```bash
curl http://localhost/health
# → {"status":"ok","db":"ok","redis":"ok"}
```

Open Azure NSG → allow inbound TCP 80 (and 443 after SSL setup).

---

## CI/CD — GitHub Actions Auto-Deploy

Every push to `main` SSHes in, pulls, runs migrations, and rebuilds.

**Add these secrets** in GitHub → repo → Settings → Secrets → Actions:

| Secret | Value |
|--------|-------|
| `SERVER_HOST` | VM public IP or domain |
| `SERVER_USER` | `ubuntu` (or your VM username) |
| `SERVER_SSH_KEY` | Contents of `~/.ssh/id_rsa` (VM private key) — preferred |
| `SERVER_PASSWORD` | VM password — used only if `SERVER_SSH_KEY` is not set |
| `SERVER_PORT` | `22` (optional) |
| `SERVER_APP_DIR` | `/home/ubuntu/wekashi` (optional, this is the default) |

Manual trigger: **Actions → Deploy to Server → Run workflow**

---

## Environment Variables — Complete Reference

### Required (server won't start without these)

| Variable | How to get it |
|----------|--------------|
| `DATABASE_URL` | Azure PostgreSQL → Connection strings → convert to `postgresql://user:pass@host:5432/db?sslmode=require` |
| `REDIS_URL` | Azure Cache for Redis → Access keys → `rediss://:primarykey@hostname:6380` |
| `JWT_ACCESS_SECRET` | `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | `openssl rand -hex 32` (different from above) |
| `CORS_ORIGIN` | Your domain e.g. `https://wekashi.com` — never `*` in production |
| `NODE_ENV` | `production` |
| `VITE_GOOGLE_MAPS_KEY` | Google Cloud Console → APIs & Services → Credentials → Browser key (restrict to your domain) |

### Required for file uploads (KYC docs, driver documents)

| Variable | How to get it |
|----------|--------------|
| `AZURE_STORAGE_CONNECTION_STRING` | Azure Portal → Storage Account → Access keys → Connection string |
| `AZURE_STORAGE_CONTAINER` | `rideops-uploads` (auto-created on first upload) |

### Required for payments — collection (Razorpay Payments)

| Variable | How to get it |
|----------|--------------|
| `RAZORPAY_KEY_ID` | Razorpay Dashboard → Settings → API Keys |
| `RAZORPAY_KEY_SECRET` | Same place |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay → Settings → Webhooks → create webhook (event: `payment.captured`) → copy secret |
| `VITE_RAZORPAY_KEY_ID` | Same value as `RAZORPAY_KEY_ID` (used in frontend checkout) |

### Required for payouts — driver withdrawals (Razorpay X)

| Variable | How to get it |
|----------|--------------|
| `RAZORPAY_X_KEY_ID` | [x.razorpay.com](https://x.razorpay.com) → API Keys (separate from standard Payments keys) |
| `RAZORPAY_X_KEY_SECRET` | Same place |
| `RAZORPAY_X_ACCOUNT_NUMBER` | Your RazorpayX current account number (the source account payouts are debited from) |
| `RAZORPAY_X_WEBHOOK_SECRET` | RazorpayX → Settings → Webhooks → create webhook (events: `payout.processed`, `payout.failed`, `payout.reversed`) → copy secret |

> ⚠️ **Razorpay X requires its own account activation** — it is a separate product from standard Razorpay Payments and has its own KYC/approval process. Apply at x.razorpay.com before going live. Until these are set, `/payments/driver/withdraw` runs in mock mode (no real money moves).

### Optional (have defaults)

| Variable | Default | Notes |
|----------|---------|-------|
| `JWT_ACCESS_EXPIRY` | `15m` | Leave as is |
| `JWT_REFRESH_EXPIRY` | `7d` | Leave as is |
| `PORT` | `3000` | Leave as is |
| `WEB_PORT` | `80` | Change to `443` after HTTPS setup |
| `LOG_LEVEL` | `info` | Use `debug` for troubleshooting |
| `ADMIN_INVITE_TOKEN` | none | Restrict admin account creation to invited users |

### Required for SMS OTPs (mandatory before going live)

| Variable | Notes |
|----------|-------|
| `SMS_PROVIDER` | Set to `twilio` |
| `TWILIO_ACCOUNT_SID` | From Twilio console |
| `TWILIO_AUTH_TOKEN` | From Twilio console |
| `TWILIO_FROM_NUMBER` | Your Twilio number e.g. `+91xxxxxxxxxx` |

> Without Twilio, OTPs are printed to the server console (dev only). `DEV_OTP_BYPASS=123456` is **blocked in production**.

### Dev-only (NEVER in production .env.prod)

| Variable | Purpose |
|----------|---------|
| `DEV_OTP_BYPASS` | Set to `123456` — lets any driver log in without real SMS. Server refuses to start in production if set. |

---

## Connection String Formats

**Azure PostgreSQL:**
```
DATABASE_URL=postgresql://rideops:PASSWORD@your-server.postgres.database.azure.com:5432/rideops?sslmode=require
```

**Azure Redis (note double-s `rediss://`):**
```
REDIS_URL=rediss://:PRIMARY_KEY@your-cache.redis.cache.windows.net:6380
```

---

## Migrations

All database changes are managed through Prisma migrations in `backend/prisma/migrations/`.

**Applied migrations (in order):**

| Migration | What it adds |
|-----------|-------------|
| `init` | Core schema (users, vendors, drivers, rides, vehicles) |
| `init_02` through `init_28` | Incremental additions (payments, pax, location logs, OTD fields, etc.) |
| `20260731122145_add_driver_details_and_doc_fields` | DL number, DL expiry, Gov ID, alt phone on drivers; rejection_note, reviewed_by on documents |
| `20260731130000_add_escort_fields` | escort_required, escort_name on rides |
| `20260731200000_add_escort_charge` | escort_charge (Float) on rides |
| `20260801000000_payouts_remove_route` | Drops `razorpayAccountId`/`razorpayAccountVerified` (Route columns); adds `DriverBankDetail` and `PayoutTransaction` models for the Payments + Payouts architecture |
| `20260801010000_add_payment_status_index` | Composite index `(supervisorId, paymentStatus)` on `rides` — speeds up the `/payments/pending` query |

To apply on a fresh server:
```bash
npx prisma migrate deploy
```

---

## Android Driver App (Capacitor)

The driver app is the same React codebase at `/driver`, wrapped for Android.

### Build APK

Requirements: Android Studio + JDK 17

```bash
npm run build
npx cap copy android
npx cap open android
# Android Studio → Build → Generate Signed APK
```

Update `capacitor.config.ts` before building for production:
```ts
server: { url: 'https://yourdomain.com', cleartext: false }
```

---

## Performance Architecture

**GPS location buffering:**
```
Driver GPS ping (every 5s)
  → Redis buffer (immediate, ~0ms)
  → Socket.io emit to supervisor (real-time, unchanged)
  → DB bulk flush every 60s (reduces ~1,200 writes/sec → 1 bulk write/min)
```

**File storage:**
- Development: local disk at `backend/uploads/`
- Production: Azure Blob Storage (set `AZURE_STORAGE_CONNECTION_STRING`)
- Access: proxied through `/api/files/:filename` with JWT auth

**Socket.io multi-instance:**
Both API servers share Redis via Socket.io adapter. A supervisor on Server 1 receives events from a driver connected to Server 2.

**Broadcast radius:**
Drivers are notified within **10 km** of the first pickup point (login rides) or office (logout rides).

---

## Useful Commands

```bash
# ── Backend ────────────────────────────────────────────────────────────────
cd backend
npm run dev                   # Start with hot reload → http://localhost:3000
npx prisma studio             # Visual DB browser → http://localhost:5555
npx prisma migrate dev        # Create + apply new migration (dev only)
npx prisma migrate deploy     # Apply pending migrations (production)
npx prisma generate           # Regenerate client after schema change
npm run db:seed               # Seed demo data (admin, vendor, supervisor, 3 drivers, 5 employees)

# ── Frontend ───────────────────────────────────────────────────────────────
npm run dev                   # Start Vite dev server → http://localhost:8080
npm run build                 # Production build → dist/
npm run lint                  # ESLint check

# ── Docker (production) ────────────────────────────────────────────────────
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f api
docker compose --env-file .env.prod -f docker-compose.prod.yml exec api sh
docker compose --env-file .env.prod -f docker-compose.prod.yml restart api

# ── Docker (local dev) ─────────────────────────────────────────────────────
docker compose up -d          # Start Postgres + Redis
docker compose down           # Stop (data preserved in named volume)
docker compose down -v        # Stop AND wipe all data (requires re-seed)
```

---

## Pre-Launch Checklist

- [ ] HTTPS/SSL configured (nginx + Let's Encrypt or Cloudflare)
- [ ] Twilio SMS configured and tested (`SMS_PROVIDER=twilio`)
- [ ] Razorpay X account activated at x.razorpay.com (separate from standard Payments account)
- [ ] Razorpay Payments webhook registered and `RAZORPAY_WEBHOOK_SECRET` set
- [ ] Razorpay X payout webhook registered and `RAZORPAY_X_WEBHOOK_SECRET` set
- [ ] `CORS_ORIGIN` set to production domain (not `*`)
- [ ] `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are strong random values
- [ ] `DEV_OTP_BYPASS` is NOT in `.env.prod`
- [ ] Google Maps key restricted to production domain in Google Cloud Console
- [ ] Azure Blob Storage container created and `AZURE_STORAGE_CONNECTION_STRING` set
- [ ] GitHub Actions secrets set (`SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_KEY`)
- [ ] First deploy tested, health check returns `{"status":"ok","db":"ok","redis":"ok"}`
- [ ] Demo data seeded or cleared as needed
- [ ] Android APK built with production `server.url`

---

## Removed files (context)

| File | Why removed |
|------|------------|
| `app.sh` | Lovable scaffold script — used `vite preview` and Supabase SQL. Not applicable. |
| `db/schema.sql` | Supabase-era SQL schema. Replaced by Prisma migrations. |
| `supabase/` | Supabase integration. Not used. |
| `src/integrations/supabase/` | Dead Supabase client code. |
| `src/integrations/lovable/` | Dead Lovable OAuth code. |
| `src/store/useMockStore.ts` | Mock demo data store from prototype phase. |
| `src/lib/mock-data.ts` | Mock demo data. `statusColor` extracted to `src/lib/rideStatus.ts`. |
| `src/components/RideDetailSheet.tsx` | Replaced by `CompletedRideDetailSheet.tsx`. |
