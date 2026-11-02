package in.wekashi.driver;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.PixelFormat;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.CountDownTimer;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;

import androidx.annotation.Nullable;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;

/**
 * Draws the Rapido-style incoming-ride card as a TYPE_APPLICATION_OVERLAY window
 * over whatever is on screen — including the home screen / another app while the
 * device is UNLOCKED. Unlike launching an Activity, an overlay window is NOT
 * subject to Android 10+'s background-activity-launch restriction, so it pops on
 * its own when the push arrives in the background (the thing a banner couldn't do).
 *
 * Runs as a foreground service (required to draw overlays reliably from the
 * background on modern Android). Requires the SYSTEM_ALERT_WINDOW ("Display over
 * other apps") permission — the onboarding flow guides the driver to grant it.
 *
 * The card mirrors the web DriverOfferCard; Accept/Reject call the backend via
 * RideApi (token-refreshing, HTTPS-only). Self-stops on accept, reject, timeout,
 * or a ride_dismiss broadcast (cancelled/expired/taken).
 */
public class IncomingRideOverlayService extends Service {

    private static final String FG_CHANNEL = "ride_overlay_fg";
    private static final int FG_NOTIF_ID = 7101;

    private WindowManager windowManager;
    private View overlayView;
    private Ringtone ringtone;
    private Vibrator vibrator;
    private CountDownTimer timer;
    private String rideId;
    private final Handler main = new Handler(Looper.getMainLooper());
    private BroadcastReceiver dismissReceiver;

    @Override
    public void onCreate() {
        super.onCreate();
        startForegroundSelf();
        dismissReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) {
                String r = i.getStringExtra("rideId");
                if (r == null || r.equals(rideId)) stopSelfClean();
            }
        };
        LocalBroadcastManager.getInstance(this)
                .registerReceiver(dismissReceiver, new IntentFilter(IncomingRideActivity.ACTION_DISMISS));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) { stopSelfClean(); return START_NOT_STICKY; }

        // Only draw if we actually have the overlay permission; otherwise the
        // FCM service's full-screen-intent notification is the fallback.
        if (!canDrawOverlays()) { stopSelfClean(); return START_NOT_STICKY; }

        rideId = intent.getStringExtra("rideId");
        showOverlay(intent);
        return START_NOT_STICKY;
    }

    private void showOverlay(Intent data) {
        // A newer ride push arrived while a card is already up — replace it with
        // the new one (rather than ignoring it, which left the 2nd ride showing
        // only as a banner). Tear down the current card first, then draw the new.
        if (overlayView != null) {
            if (timer != null) { timer.cancel(); timer = null; }
            removeOverlay();
        }

        windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        overlayView = LayoutInflater.from(this).inflate(R.layout.overlay_incoming_ride, null);

        bindData(data);
        startAlertSound();
        startVibration();
        startCountdown(data.getStringExtra("expiresAt"));

        Button accept = overlayView.findViewById(R.id.ovAccept);
        Button reject = overlayView.findViewById(R.id.ovReject);
        accept.setOnClickListener(v -> onAccept(accept, reject));
        reject.setOnClickListener(v -> onReject());

        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;

        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                type,
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                        | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                        | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP;

        try {
            windowManager.addView(overlayView, lp);
        } catch (Exception e) {
            stopSelfClean();
        }
    }

    private void bindData(Intent d) {
        String fare = d.getStringExtra("fare");
        String vehicleType = d.getStringExtra("vehicleType");
        String isAc = d.getStringExtra("isAc");
        String distanceKm = d.getStringExtra("distanceKm");
        String pickup = d.getStringExtra("pickup");
        String drop = d.getStringExtra("drop");
        String type = d.getStringExtra("type");
        String paxCount = d.getStringExtra("paxCount");
        String loginTime = d.getStringExtra("loginTime");
        String firstPickupTime = d.getStringExtra("firstPickupTime");

        tv(R.id.ovFare).setText(fare != null && !fare.isEmpty() ? "\u20B9" + fare : "\u20B9—");

        TextView ac = tv(R.id.ovAc);
        ac.setText("1".equals(isAc) ? "AC" : "Non-AC");

        TextView veh = tv(R.id.ovVehicle);
        if (vehicleType != null && !vehicleType.isEmpty()) {
            veh.setText(vehicleType.substring(0, 1).toUpperCase() + vehicleType.substring(1));
        } else {
            veh.setVisibility(View.GONE);
        }

        TextView typeChip = tv(R.id.ovType);
        boolean logout = "logout".equals(type);
        typeChip.setText(logout ? "Logout" : "Login");
        typeChip.setTextColor(logout ? 0xFFF87171 : 0xFF4ADE80);

        if (pickup != null) tv(R.id.ovPickup).setText(pickup);
        if (drop != null) tv(R.id.ovDrop).setText(drop);

        tv(R.id.ovPickupDist).setText("Pickup");
        tv(R.id.ovDropDist).setText(distanceKm != null && !distanceKm.isEmpty()
                ? distanceKm + " km trip" : "Trip");

        StringBuilder meta = new StringBuilder();
        if (paxCount != null && !paxCount.isEmpty()) meta.append(paxCount).append(" pax");
        tv(R.id.ovMeta).setText(meta.toString());

        // Times row: Login/Logout time + 1st pickup, matching the in-app card.
        TextView times = tv(R.id.ovTimes);
        StringBuilder t = new StringBuilder();
        String loginLabel = "logout".equals(type) ? "Logout" : "Login";
        String lt = toHHmm(loginTime);
        if (lt != null) t.append(loginLabel).append(" ").append(lt);
        String fp = toHHmm(firstPickupTime);
        if (fp != null) {
            if (t.length() > 0) t.append("   ");
            t.append("1st pickup ").append(fp);
        }
        if (t.length() > 0) {
            times.setText(t.toString());
            times.setVisibility(View.VISIBLE);
        } else {
            times.setVisibility(View.GONE);
        }
    }

    /** Accept an ISO datetime or an HH:MM string; return HH:MM for display. */
    private String toHHmm(String v) {
        if (v == null || v.isEmpty()) return null;
        if (v.matches("^\\d{2}:\\d{2}$")) return v;
        try {
            java.text.SimpleDateFormat in =
                    new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
            in.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            java.util.Date d = in.parse(v);
            java.text.SimpleDateFormat out = new java.text.SimpleDateFormat("HH:mm", java.util.Locale.US);
            return out.format(d);
        } catch (Exception e) {
            return null;
        }
    }

    private TextView tv(int id) { return overlayView.findViewById(id); }

    private void startCountdown(String expiresAtIso) {
        long msLeft = 55_000L;
        if (expiresAtIso != null) {
            try {
                java.text.SimpleDateFormat fmt =
                        new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
                fmt.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
                long diff = fmt.parse(expiresAtIso).getTime() - System.currentTimeMillis();
                if (diff > 1000) msLeft = diff;
            } catch (Exception ignored) { }
        }
        final TextView cd = tv(R.id.ovCountdown);
        timer = new CountDownTimer(msLeft, 1000) {
            @Override public void onTick(long m) {
                long s = m / 1000;
                cd.setText(String.format(java.util.Locale.US, "%02d:%02d", s / 60, s % 60));
            }
            @Override public void onFinish() { stopSelfClean(); }
        }.start();
    }

    private void onAccept(Button accept, Button reject) {
        accept.setEnabled(false);
        reject.setEnabled(false);
        accept.setText("Accepting…");
        stopSoundAndVibration();
        final String id = rideId;
        new Thread(() -> {
            RideApi.Result r = RideApi.accept(getApplicationContext(), id);
            main.post(() -> {
                if (r == RideApi.Result.ACCEPTED) {
                    // Open the app to the active ride.
                    Intent open = new Intent(this, MainActivity.class);
                    open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP
                            | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                    open.putExtra("openRideId", id);
                    startActivity(open);
                } else {
                    accept.setText(r == RideApi.Result.UNAVAILABLE ? "No longer available" : "Open the app");
                }
                stopSelfClean();
            });
        }).start();
    }

    private void onReject() {
        final String id = rideId;
        new Thread(() -> RideApi.reject(getApplicationContext(), id)).start();
        stopSelfClean();
    }

    private boolean canDrawOverlays() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) return Settings.canDrawOverlays(this);
        return true;
    }

    private void startForegroundSelf() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(FG_CHANNEL) == null) {
                NotificationChannel ch = new NotificationChannel(
                        FG_CHANNEL, "Incoming ride overlay", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("Shows the ride request card over other apps");
                nm.createNotificationChannel(ch);
            }
        }
        Notification n = new Notification.Builder(this,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? FG_CHANNEL : null)
                .setContentTitle("New ride request")
                .setContentText("Tap to view")
                .setSmallIcon(R.mipmap.ic_launcher)
                .build();
        startForeground(FG_NOTIF_ID, n);
    }

    private void startAlertSound() {
        try {
            Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            ringtone = RingtoneManager.getRingtone(getApplicationContext(), sound);
            if (ringtone != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) ringtone.setLooping(true);
                ringtone.play();
            }
        } catch (Exception ignored) { }
    }

    private void startVibration() {
        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator == null || !vibrator.hasVibrator()) return;
        long[] p = {0, 500, 300, 500, 300, 500};
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(p, 0));
        } else {
            vibrator.vibrate(p, 0);
        }
    }

    private void stopSoundAndVibration() {
        if (ringtone != null && ringtone.isPlaying()) ringtone.stop();
        if (vibrator != null) vibrator.cancel();
    }

    private void stopSelfClean() {
        if (timer != null) { timer.cancel(); timer = null; }
        stopSoundAndVibration();
        removeOverlay();
        // Also clear the FCM banner notification for this ride.
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(7001);
        stopForeground(true);
        stopSelf();
    }

    private void removeOverlay() {
        if (overlayView != null && windowManager != null) {
            try { windowManager.removeView(overlayView); } catch (Exception ignored) { }
            overlayView = null;
        }
    }

    @Override
    public void onDestroy() {
        if (dismissReceiver != null) {
            LocalBroadcastManager.getInstance(this).unregisterReceiver(dismissReceiver);
        }
        if (timer != null) timer.cancel();
        stopSoundAndVibration();
        removeOverlay();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) { return null; }
}
