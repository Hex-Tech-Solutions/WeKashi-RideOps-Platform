package in.wekashi.driver;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

/**
 * Persistent "You're online" foreground-service notification (Step 3).
 *
 * Because of Model 2 a driver stays online even when the app is killed, so they
 * need a reliable way to go offline WITHOUT reopening the app. This ongoing
 * notification sits in the shade while online and carries a "Go Offline" action
 * that calls POST /driver/offline directly (via RideApi → GoOfflineReceiver),
 * then stops the service and the notification.
 *
 * Controlled by the web app through the WekashiAuth plugin:
 *   start → when the driver goes online
 *   stop  → when the driver goes offline (in-app toggle)
 */
public class OnlineStatusService extends Service {

    public static final String ACTION_START = "in.wekashi.driver.ONLINE_START";
    public static final String ACTION_STOP = "in.wekashi.driver.ONLINE_STOP";
    private static final String CHANNEL = "driver_online_status";
    private static final int NOTIF_ID = 7201;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : ACTION_START;
        if (ACTION_STOP.equals(action)) {
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        // location FGS type (Android 10+): this is the driver's on-duty
        // location-sharing session. The type is required at start on API 29+.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, buildNotification(),
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIF_ID, buildNotification());
        }
        // STICKY so Android restarts it (and the "online" notification) if the
        // process is killed while the driver is still on-duty.
        return START_STICKY;
    }

    private Notification buildNotification() {
        createChannel();

        // Tap the notification → open the app.
        Intent openApp = new Intent(this, MainActivity.class);
        openApp.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent openPending = PendingIntent.getActivity(this, 0, openApp, piFlags);

        // "Go Offline" action → GoOfflineReceiver (calls the backend, no UI).
        Intent offline = new Intent(this, GoOfflineReceiver.class);
        offline.setAction(GoOfflineReceiver.ACTION_GO_OFFLINE);
        PendingIntent offlinePending = PendingIntent.getBroadcast(this, 1, offline, piFlags);

        return new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("You're online")
                .setContentText("Receiving ride requests · tap to open")
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setContentIntent(openPending)
                .addAction(0, "Go Offline", offlinePending)
                .build();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(
                CHANNEL, "Online status", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Shows that you're online and lets you go offline");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    /** Helper the plugin / receiver use to stop the service + its notification. */
    public static void stop(Context ctx) {
        Intent i = new Intent(ctx, OnlineStatusService.class);
        i.setAction(ACTION_STOP);
        try { ctx.startService(i); } catch (Exception ignored) { }
    }

    @Nullable @Override public IBinder onBind(Intent intent) { return null; }
}
