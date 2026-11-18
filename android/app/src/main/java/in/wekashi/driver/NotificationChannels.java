package in.wekashi.driver;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ContentResolver;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

/**
 * The app's two notification channels, created at app start (WekashiApp):
 *
 *   RIDE_CHANNEL     — ride broadcasts ONLY. Loud: the retro landline ringer
 *                      (res/raw/retro_ring.wav), vibration, bypasses Do Not Disturb.
 *   ACCOUNT_CHANNEL  — every other notice (documents, KYC, credits, payments,
 *                      face check...). Normal phone notification sound. This is
 *                      also the manifest default, so a message that names no
 *                      channel can never ring like a ride.
 *
 * Android fixes a channel's sound when the channel is first created, so the
 * ringer needs a NEW channel id ("ride_broadcasts_v2"); the old
 * "ride_broadcasts" channel (phone ringtone) is deleted.
 */
public final class NotificationChannels {

    public static final String RIDE_CHANNEL = "ride_broadcasts_v2";
    /** Must match ACCOUNT_CHANNEL_ID in backend/src/lib/fcm.ts. */
    public static final String ACCOUNT_CHANNEL = "account_updates";
    private static final String OLD_RIDE_CHANNEL = "ride_broadcasts";

    private NotificationChannels() { }

    /** The retro landline ringer bundled with the app. */
    public static Uri rideSoundUri(Context ctx) {
        return Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://"
                + ctx.getPackageName() + "/" + R.raw.retro_ring);
    }

    /** Ringer for the ride card (overlay / full-screen), looped by the caller. */
    public static Ringtone rideRingtone(Context ctx) {
        Ringtone r = RingtoneManager.getRingtone(ctx.getApplicationContext(), rideSoundUri(ctx));
        if (r == null) {
            // Should never happen; fall back to the phone's ringtone.
            r = RingtoneManager.getRingtone(ctx.getApplicationContext(),
                    RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE));
        }
        if (r != null) {
            r.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
        }
        return r;
    }

    /** Create both channels (idempotent) and remove the old ride channel. */
    public static void ensure(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        if (nm.getNotificationChannel(OLD_RIDE_CHANNEL) != null) {
            try { nm.deleteNotificationChannel(OLD_RIDE_CHANNEL); } catch (Exception ignored) { }
        }

        if (nm.getNotificationChannel(RIDE_CHANNEL) == null) {
            NotificationChannel ride = new NotificationChannel(
                    RIDE_CHANNEL,
                    ctx.getString(R.string.channel_incoming_rides),
                    NotificationManager.IMPORTANCE_HIGH);
            ride.setDescription(ctx.getString(R.string.channel_incoming_rides_desc));
            ride.enableVibration(true);
            ride.setVibrationPattern(new long[]{0, 400, 200, 400, 200, 400});
            ride.setBypassDnd(true);
            ride.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            ride.setSound(rideSoundUri(ctx), new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            nm.createNotificationChannel(ride);
        }

        if (nm.getNotificationChannel(ACCOUNT_CHANNEL) == null) {
            // Same settings the web app uses (src/lib/pushNotifications.ts):
            // default importance = normal sound, no heads-up takeover.
            NotificationChannel account = new NotificationChannel(
                    ACCOUNT_CHANNEL,
                    ctx.getString(R.string.channel_account_updates),
                    NotificationManager.IMPORTANCE_DEFAULT);
            account.setDescription(ctx.getString(R.string.channel_account_updates_desc));
            account.enableVibration(true);
            account.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            nm.createNotificationChannel(account);
        }
    }
}
