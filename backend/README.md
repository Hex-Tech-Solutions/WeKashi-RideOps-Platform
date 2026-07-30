# RideOps Backend

A production-ready B2B corporate cab management API.

## Tech Stack

- **Runtime**: Node 20 LTS + TypeScript (strict)
- **Framework**: Express
- **Database**: PostgreSQL 16 + PostGIS
- **Cache / Pub-Sub**: Redis 7
- **ORM**: Prisma
- **Realtime**: Socket.io with Redis adapter
- **Validation**: Zod
- **Logging**: pino
- **Auth**: JWT (access 15m / refresh 7d, rotated) + OTP for drivers

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Copy environment file

```bash
cp .env.example .env
# Edit .env with your values
```

### 3. Start infrastructure (Docker)

```bash
docker-compose up postgres redis -d
```

### 4. Run database migrations

```bash
npm run db:migrate
```

Then apply GIST indexes from `prisma/migrations/init/migration.sql`:

```bash
psql $DATABASE_URL -f prisma/migrations/init/migration.sql
```

### 5. Seed the database

```bash
npm run db:seed
```

### 6. Start the dev server

```bash
npm run dev
```

The API will be available at `http://localhost:3000`.

## Docker (full stack)

```bash
docker-compose up --build
```

## Running Tests

```bash
npm test
```

Tests require a running PostgreSQL (with PostGIS) and Redis instance. Set `TEST_DATABASE_URL` and `TEST_REDIS_URL` to point to test databases.

## Authentication

### Web roles (admin / supervisor / vendor)

```
POST /api/auth/register     Register a new user
POST /api/auth/login        Get access + refresh tokens
POST /api/auth/refresh      Rotate refresh token
POST /api/auth/logout       Revoke refresh token
GET  /api/auth/me           Get current user info
```

Admin registration requires `x-invite-token: <ADMIN_INVITE_TOKEN>` header.

### Driver (mobile, OTP-based)

```
POST /api/driver/auth/request-otp    Send OTP to phone (rate-limited: 5/10min)
POST /api/driver/auth/verify-otp     Verify OTP, get tokens
```

In development, set `DEV_OTP_BYPASS=123456` and use `123456` as OTP.

## API Routes Summary

| Method | Path | Roles |
|--------|------|-------|
| GET    | /api/rides | all |
| POST   | /api/rides | supervisor |
| GET    | /api/rides/:id | all |
| POST   | /api/rides/:id/accept | driver |
| POST   | /api/rides/:id/reject | driver |
| POST   | /api/rides/:id/cancel | supervisor, admin |
| PATCH  | /api/rides/:id/status | driver, supervisor, admin |
| POST   | /api/rides/:id/rebroadcast | supervisor, admin |
| GET    | /api/drivers | vendor, admin |
| POST   | /api/drivers | vendor |
| PATCH  | /api/drivers/:id/status | vendor, admin |
| POST   | /api/drivers/:id/location | driver |
| CRUD   | /api/employees | supervisor |
| POST   | /api/employees/bulk | supervisor |
| CRUD   | /api/vendors | admin |
| GET    | /api/vendors/:id/stats | admin |
| CRUD   | /api/vehicles | vendor |
| GET    | /api/payouts | vendor, admin |
| POST   | /api/payouts | admin |
| PATCH  | /api/payouts/:id/status | admin |
| GET    | /api/analytics/overview | admin |
| GET    | /api/analytics/rides | admin |
| GET    | /api/analytics/vendors/:id/performance | admin |
| CRUD   | /api/safety/incidents | supervisor, admin |

## Socket.io Namespaces

Connect to `ws://localhost:3000/{namespace}` with `auth: { token: <accessToken> }`.

| Namespace | Roles | Events received |
|-----------|-------|----------------|
| /supervisor | supervisor | ride:broadcast, ride:status_changed, driver:accepted, driver:location, ride:expired |
| /driver | driver | ride:broadcast |
| /admin | admin | admin:activity |

## Ride State Machine

```
pending → broadcasting → assigned → in_progress → completed
                      ↓           ↓
                   cancelled   cancelled
                   expired
```

## Seed Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@rideops.dev | Admin123! |
| Vendor | vendor@rideops.dev | Vendor123! |
| Supervisor | supervisor@rideops.dev | Super123! |
| Driver 1 | phone: +919000000001 | OTP via bypass |
| Driver 2 | phone: +919000000002 | OTP via bypass |
| Driver 3 | phone: +919000000003 | OTP via bypass |

## Environment Variables

See `.env.example` for all configuration options.
