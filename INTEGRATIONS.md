# RideOps — Integrations & deploy-time setup

Follow this checklist whenever you add a third-party key or redeploy. All secrets
live in **`/home/ubuntu/rideops-platform/.env.prod` on the EC2 box** (never
committed). After editing `.env.prod`, redeploy:

```bash
cd /home/ubuntu/rideops-platform
git pull --ff-only origin main
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

---

## 1. Google Maps (routing + live map)

The web bundle reads `VITE_GOOGLE_MAPS_KEY` at **build time**.

1. In Google Cloud Console, enable: **Maps JavaScript API, Directions API,
   Distance Matrix API, Places API**, and create a **browser key** (restrict it
   to your domain/EC2 IP once you have HTTPS).
2. On EC2, set in `.env.prod`:
   ```
   VITE_GOOGLE_MAPS_KEY=AIza...thekey
   ```
3. Redeploy (command above). The compose build passes it as a build arg →
   baked into the bundle.

---

## 2. Razorpay (payments)

Code is implemented and **inactive until keys are present**. When the client
sends test/live keys:

1. In `.env.prod`:
   ```
   RAZORPAY_KEY_ID=rzp_test_xxx
   RAZORPAY_KEY_SECRET=xxx
   RAZORPAY_WEBHOOK_SECRET=xxx
   VITE_RAZORPAY_KEY_ID=rzp_test_xxx     # same key id, for the browser checkout
   ```
2. In the Razorpay dashboard → **Settings → Webhooks**, add:
   `http://<EC2_or_domain>/api/payments/webhook` with events
   `payment.captured`, `subscription.charged`, `subscription.activated`.
   Use the same secret as `RAZORPAY_WEBHOOK_SECRET`.
3. Redeploy. Subscriptions/payouts become active automatically.

---

## 3. SMS OTP (Twilio)

Until configured, OTPs are **logged to the api container** (and the dev bypass
`DEV_OTP_BYPASS=123456` works). To send real SMS:

1. Twilio console → get **Account SID**, **Auth Token**, and an SMS-capable
   **From number**.
2. In `.env.prod`:
   ```
   SMS_PROVIDER=twilio
   TWILIO_ACCOUNT_SID=ACxxx
   TWILIO_AUTH_TOKEN=xxx
   TWILIO_FROM_NUMBER=+1xxx
   ```
3. **Remove** `DEV_OTP_BYPASS` from `.env.prod` so a real OTP is required.
4. Redeploy. (The SMS sender in `backend/src/lib/sms.ts` switches to Twilio when
   `SMS_PROVIDER=twilio`.)

---

## 4. Push notifications (FCM) — for the driver Android app

Replaces the driver app's 8-second polling with instant push.

1. Create a **Firebase project** → add an **Android app** with package
   `dev.rideops.driver` → download `google-services.json`.
2. Project Settings → **Service accounts** → generate a private key
   (`fcm-service-account.json`).
3. Copy it to the EC2 box and mount it into the api container:
   ```bash
   mkdir -p /home/ubuntu/rideops-platform/secrets
   # scp fcm-service-account.json into ./secrets/
   ```
   Add a volume to the `api` service in `docker-compose.prod.yml`:
   ```yaml
       volumes:
         - ./secrets:/app/secrets:ro
   ```
   And in `.env.prod`:
   ```
   FCM_SERVICE_ACCOUNT_JSON=/app/secrets/fcm-service-account.json
   ```
4. In the Capacitor Android project, drop `google-services.json` into
   `android/app/`, add `@capacitor/push-notifications`, and register the device
   token via `POST /api/driver/push-token` (endpoint to be added in the FCM slice).
5. Redeploy.

---

## 5. SOS (safety) — current state

The **safety/incidents** API exists (`/api/safety/incidents`) and the admin
Safety page is live. A one-tap **SOS button** in the driver app that creates an
incident with the driver's current location is a small follow-up (no external
keys needed) — it will POST to `/api/safety/incidents`.

---

## 6. HTTPS (before real launch)

Currently plain HTTP. When the client provides a **domain**:

1. Point an A record at the EC2 public IP.
2. Add Caddy or nginx + Let's Encrypt (or an AWS ALB + ACM cert) in front.
3. Update `CORS_ORIGIN` in `.env.prod` and the `url` in `capacitor.config.ts`
   to `https://…`, then redeploy + rebuild the APK.
