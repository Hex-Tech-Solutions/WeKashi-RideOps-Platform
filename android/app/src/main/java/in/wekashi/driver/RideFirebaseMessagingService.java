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
        if (!"ride_broadcast".equals(kind)) {
            return; // not an incoming-ride message; ignore
        }

        String rideId = data.get("rideId");
        String title = data.get("title") != null ? data.get("title") : "New ride available";
        String body = data.get("body") != null ? data.get("body") : "Tap to view and accept.";
        String pickup = data.get("pickupAddress");
        String drop = data.get("dropAddress");
        String type = data.get("type");

        createChannel();

        // Always post the full-screen-intent notification. This is what fires
        // the takeover when the screen is LOCKED/OFF, and it's the heads-up
        // banner fallback when the OS won't allow a direct launch.
        showFullScreenNotification(rideId, title, body, pickup, drop, type);

        // When the screen is UNLOCKED and the driver is in another app, a
        // full-screen intent is only shown as a heads-up banner by Android. To
        // match Rapido's "takes over even while using another app", launch the
        // Activity directly — this requires the "Display over other apps"
        // (SYSTEM_ALERT_WINDOW) permission, which the onboarding flow guides the
        // driver to grant. If it's not granted, we rely on the banner above.
        if (canDrawOverlays()) {
            Intent direct = new Intent(this, IncomingRideActivity.class);
            direct.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            direct.putExtra("rideId", rideId);
            direct.putExtra("pickup", pickup);
            direct.putExtra("drop", drop);
            direct.putExtra("type", type);
            direct.putExtra("fare", body);
            try {
                startActivity(direct);
            } catch (Exception ignored) {
                // Background-activity-launch restrictions may block this; the
                // full-screen-intent notification above still covers the driver.
            }
        }
    }

    private boolean canDrawOverlays() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return android.provider.Settings.canDrawOverlays(this);
        }
        return true;
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
                                            String pickup, String drop, String type) {
        // The Activity that takes over the screen.
        Intent fullScreenIntent = new Intent(this, IncomingRideActivity.class);
        fullScreenIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        fullScreenIntent.putExtra("rideId", rideId);
        fullScreenIntent.putExtra("pickup", pickup);
        fullScreenIntent.putExtra("drop", drop);
        fullScreenIntent.putExtra("type", type);
        fullScreenIntent.putExtra("fare", body);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent fullScreenPending = PendingIntent.getActivity(
                this, rideId != null ? rideId.hashCode() : 0, fullScreenIntent, flags);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setAutoCancel(true)
                .setOngoing(true)
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
