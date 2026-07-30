# WeKashi RideOps Platform — Setup & Deployment Guide

> **Production status:** Feature-complete and security-hardened.
> Two hard blockers remain before serving real users:
> - **HTTPS/SSL** must be configured (traffic is unencrypted without it)
> - **SMS OTP (Twilio)** must be configured (drivers cannot log in without it)
>
> Everything else in `PRODUCTION_ISSUES.txt` is enhancements or technical debt
> that does not block the core booking → dispatch → payment flow.

## Project Structure

```
WeKashi-RideOps-Platform/
├── src/                    # React frontend (Vite + TypeScript + shadcn/ui)
├── backend/                # Express API (Prisma + Socket.io + Redis)
├── android/                # Capacitor Android wrapper (driver app APK)
├── docker/                 # nginx config
├── docker-compose.yml      # Local development (Postgres + Redis containers only)
├── docker-compose.prod.yml # Production (Azure managed services)
├── .env.prod.example       # Template for production environment variables
├── API_REFERENCE.md        # Full API documentation (all endpoints)
├── INTEGRATIONS.md         # Third-party setup (Google Maps, Razorpay, SMS, FCM)
└── PRODUCTION_ISSUES.txt   # Known issues, remaining work, technical debt
```

**Production architecture:**
```
Browser / Android Driver App
           │
     nginx (:80 or :443)
     ├── /api  →  Express API (:3000)      ←── 2 VMs behind Load Balancer
     └── /     →  React static build
                        │
          ┌─────────────┼──────────────┐
          │             │              │
   Azure PostgreSQL  Azure Redis   Azure Blob
   (database)        (cache/buffer) (KYC files)
```

**Docker containers:**
```
Dockerfile          → nginx serving React build (frontend)
backend/Dockerfile  → Node.js Express API (multi-stage, non-root user)
docker-compose.yml       → Local dev: Postgres + Redis containers only
docker-compose.prod.yml  → Production: API + nginx only (DB/Redis = Azure)
```

---

## Local Development (Windows — no Docker needed)

### Prerequisites
- Node.js 22+
- PostgreSQL 16 with PostGIS extension (`postgis/postgis` Docker image works)
- Redis

### 1. Clone and install
```cmd
git clone https://github.com/Hex-Tech-Solutions/WeKashi-RideOps-Platform.git
cd WeKashi-RideOps-Platform
npm install
cd backend && npm install && cd ..
```

### 2. Start Postgres + Redis (Docker)
```cmd
docker compose up -d
```
This starts only the database and Redis as containers. The app itself runs outside Docker for hot reload.

### 3. Configure environment
```cmd
copy .env.prod.example backend\.env
```

Edit `backend/.env` for local development:
```env
DATABASE_URL=postgresql://rideops:rideops@localhost:5432/rideops
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=any-local-secret-32chars
JWT_REFRESH_SECRET=any-other-local-secret-32chars
NODE_ENV=development
CORS_ORIGIN=http://localhost:8080
DEV_OTP_BYPASS=123456
PORT=3000
LOG_LEVEL=debug
```

> `DEV_OTP_BYPASS=123456` lets drivers log in with OTP `123456` during testing.
> The server **blocks startup in production** if this is set.

### 3. Set up the database
```cmd
cd backend
npx prisma migrate deploy
npx prisma generate
npm run db:seed
cd ..
```

### 4. Start both servers (two terminals)

**Terminal 1 — Backend:**
```cmd
cd backend
npm run dev
# → http://localhost:3000
```

**Terminal 2 — Frontend:**
```cmd
npm run dev
# → http://localhost:8080
```

### 5. Test login credentials (after seeding)

| Role | Email / Phone | Password / OTP |
|------|--------------|----------------|
| Admin | admin@rideops.dev | Admin123! |
| Vendor | vendor@rideops.dev | Vendor123! |
| Supervisor | supervisor@rideops.dev | Super123! |
| Driver | +919000000001 | OTP: `123456` |
| Driver | +919000000002 | OTP: `123456` |

---

## Production Deployment (Azure VM + Docker)

### Recommended Azure setup (≈ $280–345/month, South India region)

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

### Step 1 — Set up each API server VM

```bash
# Install Docker + Compose
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin curl
sudo usermod -aG docker ubuntu
```

### Step 2 — Deploy key (VM → GitHub)

```bash
ssh-keygen -t ed25519 -C "wekashi-deploy" -f ~/.ssh/wekashi_deploy -N ""
cat ~/.ssh/wekashi_deploy.pub
# Add to GitHub → repo → Settings → Deploy keys (read access)
```

```bash
# Add to ~/.ssh/config
Host github.com
  IdentityFile ~/.ssh/wekashi_deploy
  IdentitiesOnly yes
```

```bash
cd /home/ubuntu
git clone git@github.com:Hex-Tech-Solutions/WeKashi-RideOps-Platform.git wekashi
cd wekashi
```

> ⚠️ Repo must live at `/home/ubuntu/wekashi` — matches the path in `.github/workflows/deploy.yml`.

### Step 3 — Create production environment file

```bash
cp .env.prod.example .env.prod
nano .env.prod
```

Fill in **all required variables** (see Environment Variables section below).

### Step 4 — Launch

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

Migration runs automatically on startup. Seed demo data once:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml exec api npm run db:seed
```

### Step 5 — Verify

```bash
curl http://localhost/health
# → {"status":"ok","timestamp":"..."}
```

Open Azure Network Security Group → allow inbound TCP 80 (and 443 for HTTPS).

---

## CI/CD — GitHub Actions Auto-Deploy

Every push to `main` SSHes into the server, pulls latest, and rebuilds.

Add these secrets in GitHub → repo → **Settings → Secrets → Actions**:

| Secret | Value |
|--------|-------|
| `SERVER_HOST` | VM public IP or domain |
| `SERVER_USER` | `ubuntu` |
| `SERVER_SSH_KEY` | Contents of your Azure VM SSH private key |
| `SERVER_PORT` | `22` |

Trigger manually: **Actions → Deploy to Server → Run workflow**

---

## Environment Variables — Complete Reference

### Required (app won't start without these)

| Variable | How to get it |
|----------|--------------|
| `DATABASE_URL` | Azure PostgreSQL → Connection strings → ADO.NET → convert to postgres:// format. Add `?sslmode=require` at end |
| `REDIS_URL` | Azure Cache for Redis → Access keys → use `rediss://:primarykey@hostname:6380` |
| `JWT_ACCESS_SECRET` | Run: `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | Run: `openssl rand -hex 32` (different from above) |
| `CORS_ORIGIN` | Your domain e.g. `https://wekashi.com` — never `*` |
| `NODE_ENV` | `production` |
| `VITE_GOOGLE_MAPS_KEY` | Google Cloud Console → APIs & Services → Credentials → Browser key |

### Required for file uploads (KYC docs, invoices)

| Variable | How to get it |
|----------|--------------|
| `AZURE_STORAGE_CONNECTION_STRING` | Azure Portal → Storage Account → Access keys → Connection string |
| `AZURE_STORAGE_CONTAINER` | Use `rideops-uploads` (created automatically on first upload) |

### Required for payments

| Variable | How to get it |
|----------|--------------|
| `RAZORPAY_KEY_ID` | Razorpay Dashboard → Settings → API Keys |
| `RAZORPAY_KEY_SECRET` | Same place |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay → Settings → Webhooks → create webhook → copy secret |
| `VITE_RAZORPAY_KEY_ID` | Same value as `RAZORPAY_KEY_ID` (used in frontend checkout) |

### Optional (have defaults)

| Variable | Default | Notes |
|----------|---------|-------|
| `JWT_ACCESS_EXPIRY` | `15m` | Leave as is |
| `JWT_REFRESH_EXPIRY` | `7d` | Leave as is |
| `PORT` | `3000` | Leave as is |
| `WEB_PORT` | `80` | Change to `443` after adding HTTPS |
| `LOG_LEVEL` | `info` | Set `debug` for troubleshooting |
| `ADMIN_INVITE_TOKEN` | none | Secret token to restrict admin account creation |

### Required for real SMS OTPs (optional at launch)

| Variable | Notes |
|----------|-------|
| `SMS_PROVIDER` | Set to `twilio` |
| `TWILIO_ACCOUNT_SID` | From Twilio console |
| `TWILIO_AUTH_TOKEN` | From Twilio console |
| `TWILIO_FROM_NUMBER` | Your Twilio number e.g. `+1...` |

> Until configured, OTPs are logged to server console. Use `DEV_OTP_BYPASS=123456` in dev only.

### Dev-only (NEVER in production)

| Variable | Purpose |
|----------|---------|
| `DEV_OTP_BYPASS` | Allows any driver to log in with OTP `123456`. Server **refuses to start** in `NODE_ENV=production` if this is set. |

---

## Azure PostgreSQL connection string format

Azure gives you a connection string like:
```
Server=your-server.postgres.database.azure.com;Database=rideops;Port=5432;User Id=rideops@your-server;Password=...;Ssl Mode=Require;
```

Convert it to:
```
DATABASE_URL=postgresql://rideops:YOUR_PASSWORD@your-server.postgres.database.azure.com:5432/rideops?sslmode=require
```

## Azure Redis connection string format

```
REDIS_URL=rediss://:YOUR_PRIMARY_KEY@your-cache.redis.cache.windows.net:6380
```

> Note `rediss://` (double s) — Azure Redis requires SSL on port 6380.

---

## Android Driver App (Capacitor)

The driver app is the same React codebase at `/driver`, wrapped for Android via Capacitor.

### Build APK

Requirements: Android Studio + JDK 17

```bash
npm run build
npx cap copy android
npx cap open android
# Android Studio → Build → Build APK(s)
```

Update `capacitor.config.ts` with your production URL before building:
```ts
server: { url: 'https://yourdomain.com', cleartext: false }
```

---

## Useful Commands

```bash
# ── Backend ───────────────────────────────────────────────────────
cd backend
npm run dev                  # Start with hot reload (dev)
npx prisma studio            # Visual DB browser → http://localhost:5555
npx prisma migrate dev       # Create + apply a new migration
npx prisma generate          # Regenerate Prisma client after schema change
npx prisma migrate deploy    # Apply pending migrations (production)
npm run db:seed              # Seed demo data

# ── Frontend ──────────────────────────────────────────────────────
npm run dev                  # Start Vite dev server → http://localhost:8080
npm run build                # Production build → dist/
npm run lint                 # ESLint check
npm test                     # Run tests

# ── Docker (production) ───────────────────────────────────────────
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f api
docker compose --env-file .env.prod -f docker-compose.prod.yml exec api sh
docker compose --env-file .env.prod -f docker-compose.prod.yml restart api
```

---

## Performance notes

**GPS location buffering:**
Driver GPS pings are buffered in Redis and flushed to PostgreSQL every 60 seconds in bulk. This reduces DB write load from ~1,200 ops/sec (at 2,000 online drivers) to ~1 bulk insert/min. Real-time tracking still works via Socket.io — supervisors see movement every 5 seconds.

**File storage:**
KYC documents and invoice files are stored in Azure Blob Storage in production (not on the VM disk). Set `AZURE_STORAGE_CONNECTION_STRING` in `.env.prod` to enable this. In development, files are stored locally in `backend/uploads/`.

**Socket.io multi-instance:**
Both API servers share the same Redis instance via Socket.io Redis adapter (already configured). A supervisor connected to Server 1 will receive events from a driver connected to Server 2.

---

## Removed files (context)

| File | Why removed |
|------|------------|
| `app.sh` | Lovable scaffold script — used `vite preview` and Supabase SQL. Not applicable. |
| `db/schema.sql` | Supabase-era SQL schema. Replaced by Prisma migrations in `backend/prisma/migrations/`. |
| `supabase/` | Supabase integration. Not used — backend uses Prisma + Express. |
| `src/integrations/supabase/` | Dead Supabase client code. |
| `src/integrations/lovable/` | Dead Lovable OAuth code. |
| `src/store/useMockStore.ts` | Mock demo data store from prototype phase. |
| `src/lib/mock-data.ts` | Mock demo data. `statusColor` extracted to `src/lib/rideStatus.ts`. |
| `src/components/RideDetailSheet.tsx` | Replaced by `CompletedRideDetailSheet.tsx`. |
