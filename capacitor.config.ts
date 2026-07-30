import type { CapacitorConfig } from '@capacitor/cli';

// RideOps Driver — Android wrapper.
//
// v1 strategy: the APK is a thin native shell that loads the hosted driver
// console (http://<EC2>/driver). Because it loads from the server origin, the
// relative "/api" calls and same-origin auth just work — no separate API base.
//
// Later (offline-capable build): remove `server.url`, set the API base to an
// absolute URL in src/lib/api.ts, run `npm run build`, then `npx cap copy`.
const config: CapacitorConfig = {
  appId: 'dev.rideops.driver',
  appName: 'RideOps Driver',
  webDir: 'dist',
  server: {
    url: 'http://52.237.81.220/driver',
    cleartext: true,
  },
};

export default config;
