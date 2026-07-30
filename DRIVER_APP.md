# RideOps Driver — Android app

The driver app is the **same React codebase**, served at the `/driver` route. It
runs as a mobile web console today and wraps into an Android APK via Capacitor.

## Try it now (no build needed)

Open **http://13.201.194.248/driver** on a phone browser.

- Sign in with a seeded driver phone: `+919000000001` (or `…02` / `…03`)
- OTP in dev mode is **`123456`** (the backend `DEV_OTP_BYPASS`)
- Flip **Go online** (pick an area first) → you become eligible for broadcasts
- When a supervisor books a ride near that area, it appears under **Ride broadcasts** → **Accept** → **Start trip** → **Complete trip**

## Build the Android APK (on your machine)

You need **Android Studio + JDK 17** installed.

```bash
# 1. install Capacitor (dev-only; not part of the web build)
npm install @capacitor/core @capacitor/android
npm install -D @capacitor/cli

# 2. add the android platform (capacitor.config.ts is already in the repo)
npx cap add android

# 3. open in Android Studio and Run/Build → Build APK
npx cap open android
```

The APK loads `http://13.201.194.248/driver` (see `capacitor.config.ts`). Because
it loads from the server origin, login + `/api` calls work with no extra config.

> **HTTPS note:** `cleartext: true` allows plain HTTP for now. Put the EC2 box
> behind HTTPS (domain + Let's Encrypt) before shipping to real users, then
> update the `url` in `capacitor.config.ts` to `https://…`.

## Going fully offline-capable (later)

To ship a self-contained APK (assets bundled, not loaded from the server):

1. Remove `server.url` from `capacitor.config.ts`.
2. Set an **absolute** API base in `src/lib/api.ts` (e.g. `https://api.rideops…`)
   instead of the relative `/api`.
3. `npm run build && npx cap copy && npx cap open android`.

## Native features still to wire (Phase 5+)

- **Background GPS** → push the driver's real location to `POST /api/driver/online`
  on an interval (`@capacitor/geolocation`).
- **FCM push** for ride broadcasts (instead of the current 8s polling).
- **Per-PAX OTP** entry screens (needs the `ride_pax` backend table — not built yet).
