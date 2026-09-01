# WeKashi RideOps

B2B employee-transport platform. Transport supervisors at client companies book
verified cabs on demand when their regular fleet falls short; drivers and
transport vendors fulfil those rides.

Operated by **Shreeya Tours and Travels** (proprietor: Padma Priya R), Bengaluru.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite + TypeScript, Tailwind, shadcn/ui, TanStack Query |
| Backend | Express 5 + TypeScript, Prisma, Socket.io |
| Database | PostgreSQL + PostGIS |
| Cache / queues | Redis |
| Routing & ETAs | Google Routes API (server-side proxy) |
| Payments | Razorpay (orders + PayoutsX) |
| Storage | Azure Blob (KYC docs, invoices) |
| Deploy | Docker Compose on Azure VM, nginx, GitHub Actions on push to `main` |

## Documentation

| File | Contents |
|---|---|
| [SETUP.md](SETUP.md) | Local dev setup, project layout |
| [API_REFERENCE.md](API_REFERENCE.md) | Every endpoint, auth scoping, rate limits |
| [DRIVER_APP.md](DRIVER_APP.md) | Driver app trip flow, Android/Capacitor build |
| [INTEGRATIONS.md](INTEGRATIONS.md) | Google, Razorpay, SMS, FCM, HTTPS setup |

## Run locally

Requires PostgreSQL (with PostGIS) on 5432 and Redis on 6379.

```bash
# backend — http://localhost:3000
cd backend
npm install
npx prisma migrate deploy
npx prisma generate
npm run dev

# frontend — http://localhost:8080
npm install
npm run dev
```

See [SETUP.md](SETUP.md) for environment variables and seed data.

## Roles

- **Supervisor** — manages an employee roster, books and tracks rides, pays after completion
- **Vendor** — onboards drivers and vehicles, sees their own fleet's earnings
- **Driver** — receives ride offers, verifies passengers by OTP, withdraws earnings
- **Admin** — approves accounts, verifies KYC, oversees all rides and payouts

Employees being transported need no account or app; their supervisor books for them.

## Ride types

**`login`** — employees are collected from home one at a time and dropped at the office.

**`logout`** — employees board together at the office (each verified by OTP *before*
departure) and are dropped at their homes.

Both use two OTPs per employee: one to board, one to drop. A passenger cannot be
dropped before being boarded. See [DRIVER_APP.md](DRIVER_APP.md) for the full flow.

### Women's safety

The platform avoids leaving a lone female passenger as the first pickup or last
drop of a journey. Where that cannot be avoided, a chaperone (escort) is required
before the ride can be broadcast.

On `logout` escort rides the escort boards at the office and must be returned
there afterwards, verified by a separate **Escort OTP** that the supervisor relays
to the driver verbally. The ride cannot complete without it.

## Money

Nothing is charged upfront. A supervisor pays only **after** a trip completes.

| Item | Amount | Goes to |
|---|---|---|
| Driver fare | Distance × vehicle slab, min ₹500 | Driver |
| Platform fee | ₹20 flat | Platform |
| Escort surcharge | 50% of driver fare | Driver |
| AC surcharge | ₹100 flat | Driver |
| Fare top-up | Supervisor's choice (₹50–150) | Driver |

Driver earnings accrue to an in-app wallet and are transferred to their bank/UPI
on request. Fee constants live in `backend/src/lib/pricing.ts`.

### Cancellation fees

**Supervisor** — free before a driver is assigned. Once assigned, 5% of the ride
fare, collected on their *next* booking rather than immediately. Waived for
safety/SOS cancellations.

**Driver** — declining a broadcast is free. Releasing a *claimed scheduled* ride
is priced on notice given before pickup:

| Notice before pickup | Fine |
|---|---|
| 24 h or more | ₹0 |
| Under 24 h | ₹100 |
| Pickup time already passed | ₹200 |
| Claimed but never started (no-show) | ₹300 |

Driver fines are debited from the wallet and recorded in the `driver_fines` table
in the same transaction, so a balance can never move without an audit row
explaining it. A negative balance is absorbed by subsequent earnings.

## Public policy pages

Required for payment-gateway onboarding, and reachable without signing in:

`/about` · `/privacy-policy` · `/refund-policy` · `/shipping-and-returns` · `/terms`

All business identity (legal name, GSTIN, address, grievance officer, refund
turnaround) is centralised in `src/lib/businessInfo.ts` — edit it there, not in
the individual pages.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which pulls on the VM,
applies migrations, and rebuilds the containers. Frontend `VITE_*` variables are
baked in at build time, so changing one requires a rebuild, not just a restart.
