package in.wekashi.driver;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Receives FCM data messages and, for a ride broadcast, raises a HIGH-importance
 * notification with a FULL-SCREEN INTENT that launches {@link IncomingRideActivity}.
 *
 * Why data-only (no notification payload): the backend sends data-only messages
 * (see backend/src/lib/fcm.ts) so this service runs even when the app is
 * backgrounded or killed, letting us build the full-screen intent ourselves
 * instead of letting the system tray show a passive banner.
 *
 * Delivery model (Rapido-style):
 *   - Phone locked / screen off  -> full-screen intent wakes the screen and
 *     shows IncomingRideActivity over the lock screen.
 *   - Phone unlocked, in another app -> the full-screen intent + the Activity's
 *     own window flags surface the ride over the current app.
 */
public class RideFirebaseMessagingService extends FirebaseMessagingService {

    public static final String CHANNEL_ID = "ride_broadcasts";
    private static final int NOTIFICATION_ID = 7001;

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        // The Capacitor push-notifications plugin also reports the token to JS,
        // which POSTs it to /api/driver/push-token. We don't duplicate that here
        // to avoid racing the plugin; this override exists so a token refresh
        // while the app is backgrounded isn't lost (the plugin re-reads it on
        // next launch). No-op body is intentional.
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        String kind = data.get("kind");

        // Ride no longer available (cancelled / expired / taken) — clear both
        // the notification AND the open full-screen card.
        if ("ride_dismiss".equals(kind)) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(NOTIFICATION_ID);
            // Tell any live IncomingRideActivity for this ride to finish itself.
            Intent close = new Intent(IncomingRideActivity.ACTION_DISMISS);
            close.putExtra("rideId", data.get("rideId"));
            close.setPackage(getPackageName());
            androidx.localbroadcastmanager.content.LocalBroadcastManager
                    .getInstance(this).sendBroadcast(close);
            return;
        }

        if (!"ride_broadcast".equals(kind)) {
            return; // not an incoming-ride message; ignore
        }

        String rideId = data.get("rideId");
        String title = data.get("title") != null ? data.get("title") : "New ride available";
        String body = data.get("body") != null ? data.get("body") : "Tap to view and accept.";
        // The real ride fields the full-screen card renders. These are SEPARATE
        // from `body` — the earlier bug passed `body` (which is "Pickup: ...")
        // into the fare slot, so the card showed "₹Pickup: ...".
        String pickup = data.get("pickupAddress");
        String drop = data.get("dropAddress");
        String type = data.get("type");
        String fare = data.get("fare");
        String vehicleType = data.get("vehicleType");
        String isAc = data.get("isAc");
        String distanceKm = data.get("distanceKm");
        String expiresAt = data.get("expiresAt");

        createChannel();

        // Build the Activity intent once, with the FULL ride summary, reused by
        // both the full-screen-intent notification and the direct launch.
        Intent rideIntent = new Intent(this, IncomingRideActivity.class);
        rideIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        rideIntent.putExtra("rideId", rideId);
        rideIntent.putExtra("pickup", pickup);
        rideIntent.putExtra("drop", drop);
        rideIntent.putExtra("type", type);
        rideIntent.putExtra("fare", fare);
        rideIntent.putExtra("vehicleType", vehicleType);
        rideIntent.putExtra("isAc", isAc);
        rideIntent.putExtra("distanceKm", distanceKm);
        rideIntent.putExtra("expiresAt", expiresAt);

        // When the app is already in the FOREGROUND, the web app handles the
        // ride entirely (socket → broadcasts list + in-app alert). Showing a
        // native notification or overlay on top would be duplicate noise and
        // the card would wrongly cover the screen the driver is using. So skip
        // both native surfaces and let the web layer own it.
        if (isAppInForeground()) {
            return;
        }

        // Post the full-screen-intent notification. This fires the takeover when
        // the screen is LOCKED/OFF, and is the heads-up banner fallback when the
        // OS won't allow the overlay (no permission).
        showFullScreenNotification(rideId, title, body, rideIntent);

        // Rapido-style takeover over the home screen / another app while
        // UNLOCKED: draw the card as a system overlay via a foreground service.
        // Unlike launching an Activity, an overlay window is NOT blocked by
        // Android 10+'s background-activity-launch restriction — this is why it
        // pops on its own when the push arrives in the background. Needs the
        // "Display over other apps" permission (onboarding guides the driver).
        if (canDrawOverlays()) {
            Intent ov = new Intent(this, IncomingRideOverlayService.class);
            ov.putExtra("rideId", rideId);
            ov.putExtra("pickup", pickup);
            ov.putExtra("drop", drop);
            ov.putExtra("type", type);
            ov.putExtra("fare", fare);
            ov.putExtra("vehicleType", vehicleType);
            ov.putExtra("isAc", isAc);
            ov.putExtra("distanceKm", distanceKm);
            ov.putExtra("paxCount", data.get("paxCount"));
            ov.putExtra("expiresAt", expiresAt);
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(ov);
                } else {
                    startService(ov);
                }
            } catch (Exception ignored) {
                // If the OS blocks the FGS start, the full-screen-intent
                // notification above still alerts the driver.
            }
        }
    }

    private boolean canDrawOverlays() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return android.provider.Settings.canDrawOverlays(this);
        }
        return true;
    }

    /** True if our app has a foreground (resumed) activity — i.e. the driver is
     *  actively using the app, so the web layer should handle the ride. */
    private boolean isAppInForeground() {
        try {
            android.app.ActivityManager.RunningAppProcessInfo info =
                    new android.app.ActivityManager.RunningAppProcessInfo();
            android.app.ActivityManager.getMyMemoryState(info);
            return info.importance ==
                    android.app.ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND;
        } catch (Exception e) {
            return false;
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                getString(R.string.channel_incoming_rides),
                NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription(getString(R.string.channel_incoming_rides_desc));
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[]{0, 400, 200, 400, 200, 400});
        channel.setBypassDnd(true);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        channel.setSound(sound, attrs);

        nm.createNotificationChannel(channel);
    }

    private void showFullScreenNotification(String rideId, String title, String body,
                                            Intent rideIntent) {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent fullScreenPending = PendingIntent.getActivity(
                this, rideId != null ? rideId.hashCode() : 0, rideIntent, flags);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setAutoCancel(true)
                // NOT ongoing — the driver must be able to swipe the alert away.
                // A ride offer is transient (it expires); forcing it to stick
                // was wrong. The overlay/full-screen path handles the takeover;
                // this notification should behave like a normal dismissible alert.
                .setOngoing(false)
                .setTimeoutAfter(60_000)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                // This is the key line: a full-screen intent marked highPriority
                // launches the Activity directly when the screen is locked/off.
                .setFullScreenIntent(fullScreenPending, true)
                .setContentIntent(fullScreenPending);

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(NOTIFICATION_ID, builder.build());
        }
    }
}
