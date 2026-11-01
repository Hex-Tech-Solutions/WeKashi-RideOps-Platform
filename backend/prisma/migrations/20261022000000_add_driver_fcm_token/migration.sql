-- Push notifications (FCM): store the driver's device registration token.
-- Nullable — push is a best-effort layer on top of the Socket.IO broadcast.
-- Set on login via POST /api/driver/push-token; cleared on logout or when FCM
-- reports the token is unregistered/stale.
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS fcm_token TEXT;
