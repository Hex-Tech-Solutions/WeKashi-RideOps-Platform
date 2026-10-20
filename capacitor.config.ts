import type { CapacitorConfig } from '@capacitor/cli';

// Wekashi Cabs (driver) — Android wrapper.
//
// v1 strategy: the APK is a thin native shell that loads the hosted driver
// console (https://wekashi.in/driver). Because it loads from the server origin,
// the relative "/api" calls and same-origin auth just work — no separate API base.
//
// Later (offline-capable build): remove `server.url`, set the API base to an
// absolute URL in src/lib/api.ts, run `npm run build`, then `npx cap copy`.
const config: CapacitorConfig = {
  appId: 'in.wekashi.driver',
  appName: 'Wekashi Cabs',
  webDir: 'dist',
  server: {
    // Production domain over HTTPS. cleartext is off — the app only loads
    // secure origins, which is required for Play Store and lets the WebView use
    // navigator.geolocation (secure-context only) in addition to the native
    // background-geolocation plugin.
    url: 'https://wekashi.in/driver',
    cleartext: false,
  },
};

export default config;
