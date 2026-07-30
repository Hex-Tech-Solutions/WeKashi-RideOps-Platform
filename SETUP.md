# RideOps — Setup & Deployment Guide

## Project Structure

```
RideOps-source/
├── src/                    # React frontend (Vite + TypeScript + shadcn/ui)
├── backend/                # Express API (Prisma + Socket.io + Redis)
├── android/                # Capacitor Android wrapper (driver app APK)
├── docker/                 # nginx config
├── docker-compose.yml      # Local Docker stack
├── docker-compose.prod.yml # Production Docker stack
├── .env.prod.example       # Template for production secrets
└── API_REFERENCE.md        # Full API documentation
```

**Architecture:**
```
Browser / Android app
        │
   nginx (:80)
   ├── /api  →  Express API (:3000)
   │            ├── PostgreSQL 16 + PostGIS
   │            └── Redis
   └── /     →  React static build
```

---

## Local Development (Windows — no Docker needed)

### Prerequisites
- Node.js 22+
- PostgreSQL 16 with PostGIS extension
- Redis

### 1. Clone and install
```cmd
git clone <repo-url>
cd RideOps-source
npm install
cd backend && npm install && cd ..
```

### 2. Configure environment
```cmd
copy .env.prod.example backend\.env
```

Edit `backend/.env`:
```env
DATABASE_URL=postgresql://rideops:rideops@localhost:5432/rideops
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=any-local-secret
JWT_REFRESH_SECRET=any-local-secret-2
NODE_ENV=development
CORS_ORIGIN=http://localhost:8080
DEV_OTP_BYPASS=123456
PORT=3000
```

### 3. Set up the database
```cmd
cd backend
npx prisma migrate deploy
npx prisma generate
npm run db:seed
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

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@rideops.dev | Admin123! |
| Vendor | vendor@rideops.dev | Vendor123! |
| Supervisor | supervisor@rideops.dev | Super123! |
| Driver | +919000000001 | OTP: `123456` (dev bypass) |

---

## Production Deployment (EC2 + Docker)

### 1. EC2 setup

```bash
# Install Docker + Compose plugin
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin
sudo usermod -aG docker ubuntu
```

### 2. Deploy key (EC2 → GitHub)

```bash
ssh-keygen -t ed25519 -C "rideops-deploy" -f ~/.ssh/rideops_deploy -N ""
cat ~/.ssh/rideops_deploy.pub
# Add to GitHub → repo → Settings → Deploy keys
```

```bash
# ~/.ssh/config
Host github.com
  IdentityFile ~/.ssh/rideops_deploy
  IdentitiesOnly yes
```

```bash
cd /home/ubuntu
git clone git@github.com:<YOUR_USER>/RideOps.git rideops-platform
cd rideops-platform
```

> ⚠️ The repo must live at `/home/ubuntu/rideops-platform` — this path is hard-coded in `.github/workflows/deploy.yml`.

### 3. Create production environment file

```bash
cp .env.prod.example .env.prod
nano .env.prod
```

Required values to change:
```env
POSTGRES_PASSWORD=<strong-password>
JWT_ACCESS_SECRET=<openssl rand -hex 32>
JWT_REFRESH_SECRET=<openssl rand -hex 32>
CORS_ORIGIN=https://yourdomain.com
VITE_GOOGLE_MAPS_KEY=AIza...
NODE_ENV=production
```

⚠️ **Do NOT set `DEV_OTP_BYPASS` in production** — the server will refuse to start if it's set.

### 4. Launch the stack

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
```

Migration runs automatically on `api` container start. Seed once:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml exec api npm run db:seed
```

### 5. Verify

```bash
curl http://localhost/health
# → {"status":"ok","timestamp":"..."}
```

Open EC2 Security Group → allow TCP 80 (and 443 for HTTPS) inbound.

---

## CI/CD — GitHub Actions Auto-Deploy

Every push to `main` SSHes into EC2, pulls latest, and rebuilds.

Add these secrets in GitHub → repo → **Settings → Secrets → Actions**:

| Secret | Value |
|--------|-------|
| `SERVER_HOST` | EC2 public IP or domain |
| `SERVER_USER` | `ubuntu` |
| `SERVER_SSH_KEY` | Contents of your EC2 `.pem` key |
| `SERVER_PORT` | `22` |

Trigger manually: **Actions → Deploy to Server → Run workflow**

---

## Android Driver App (Capacitor)

The driver app is the same React codebase served at `/driver`, wrapped in Capacitor.

### Build APK

Requirements: Android Studio + JDK 17

```bash
npm run build
npx cap copy android
npx cap open android
# Android Studio → Build → Build Bundle(s)/APK(s) → Build APK(s)
```

Update `capacitor.config.ts` with your production URL before building:
```ts
server: { url: 'https://yourdomain.com', cleartext: false }
```

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_URL` | ✅ | Redis connection string |
| `JWT_ACCESS_SECRET` | ✅ | Strong random secret (min 32 chars) |
| `JWT_REFRESH_SECRET` | ✅ | Strong random secret (min 32 chars) |
| `JWT_ACCESS_EXPIRY` | — | Default: `15m` |
| `JWT_REFRESH_EXPIRY` | — | Default: `7d` |
| `CORS_ORIGIN` | ✅ prod | Exact frontend origin — never `*` in prod |
| `NODE_ENV` | ✅ | `development` or `production` |
| `PORT` | — | Default: `3000` |
| `DEV_OTP_BYPASS` | dev only | Fixed OTP for testing. Server **refuses to start** if set in production |
| `VITE_GOOGLE_MAPS_KEY` | ✅ | Google Maps browser key (baked into frontend build) |
| `RAZORPAY_KEY_ID` | payments | Razorpay key ID |
| `RAZORPAY_KEY_SECRET` | payments | Razorpay secret |
| `RAZORPAY_WEBHOOK_SECRET` | payments | Razorpay webhook signature secret |
| `VITE_RAZORPAY_KEY_ID` | payments | Same as `RAZORPAY_KEY_ID` (frontend) |
| `SMS_PROVIDER` | SMS | Set to `twilio` to enable real SMS |
| `TWILIO_ACCOUNT_SID` | SMS | Twilio credentials |
| `TWILIO_AUTH_TOKEN` | SMS | Twilio credentials |
| `TWILIO_FROM_NUMBER` | SMS | Twilio from number |
| `ADMIN_INVITE_TOKEN` | admin reg | Token required to register admin accounts |

---

## Useful Commands

```bash
# Backend
cd backend
npm run dev              # Start with hot reload
npx prisma studio        # DB browser at http://localhost:5555
npx prisma migrate dev   # Create + apply a new migration
npx prisma generate      # Regenerate Prisma client after schema change
npm run db:seed          # Seed demo data

# Frontend
npm run dev              # Start Vite dev server
npm run build            # Production build
npm run lint             # ESLint
npm test                 # Run tests

# Docker
docker compose up -d --build    # Start local stack
docker compose logs -f api      # Tail API logs
docker compose exec api sh      # Shell into API container
```

---

## What `app.sh` was (and why it's gone)

`app.sh` was a **generic scaffold helper script** generated by the Lovable.dev platform when the project was first created. It contained commands for a simple Vite-only app (no backend, no Docker, using `vite preview` for "production"). 

It was **not used** in this project because:
- The backend uses Prisma + Docker, not a raw `db/schema.sql`
- Production runs via `docker-compose.prod.yml` + nginx, not `vite preview`
- The `db/schema.sql` file it referenced was also obsolete (replaced by Prisma migrations)

It has been removed along with `db/schema.sql`.
