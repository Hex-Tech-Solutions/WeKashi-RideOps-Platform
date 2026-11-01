package in.wekashi.driver;

import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CountDownTimer;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

/**
 * Rapido-style full-screen incoming-ride card. Launched by the full-screen
 * intent (locked) or directly from the FCM service (unlocked, with overlay
 * permission). Renders the real ride summary from the push data and lets the
 * driver Accept/Reject WITHOUT opening the web app — the buttons call the
 * backend directly via RideApi (with token refresh), so a killed app still
 * works. On Accept success it opens the app to the active ride.
 */
public class IncomingRideActivity extends AppCompatActivity {

    private CountDownTimer timer;
    private Ringtone ringtone;
    private Vibrator vibrator;
    private String rideId;
    private boolean finished = false;
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        showOverLockScreen();
        setContentView(R.layout.activity_incoming_ride);

        Intent i = getIntent();
        rideId = i.getStringExtra("rideId");
        String pickup = i.getStringExtra("pickup");
        String drop = i.getStringExtra("drop");
        String fare = i.getStringExtra("fare");
        String vehicleType = i.getStringExtra("vehicleType");
        String isAc = i.getStringExtra("isAc");
        String distanceKm = i.getStringExtra("distanceKm");
        String expiresAt = i.getStringExtra("expiresAt");

        TextView fareValue = findViewById(R.id.fareValue);
        TextView metaLine = findViewById(R.id.metaLine);
        TextView pickupValue = findViewById(R.id.pickupValue);
        TextView dropValue = findViewById(R.id.dropValue);
        final Button acceptButton = findViewById(R.id.acceptButton);
        final Button rejectButton = findViewById(R.id.rejectButton);

        fareValue.setText(fare != null && !fare.isEmpty() ? "\u20B9" + fare : "\u20B9—");
        metaLine.setText(buildMeta(vehicleType, isAc, distanceKm));
        if (pickup != null) pickupValue.setText(pickup);
        if (drop != null) dropValue.setText(drop);

        acceptButton.setOnClickListener(v -> onAccept());
        rejectButton.setOnClickListener(v -> onReject());

        startAlertSound();
        startVibration();
        startCountdown(expiresAt);
    }

    private String buildMeta(String vehicleType, String isAc, String distanceKm) {
        StringBuilder sb = new StringBuilder();
        if (vehicleType != null && !vehicleType.isEmpty()) {
            sb.append(vehicleType.substring(0, 1).toUpperCase()).append(vehicleType.substring(1));
        }
        if ("1".equals(isAc)) sb.append(sb.length() > 0 ? " · AC" : "AC");
        else if ("0".equals(isAc)) sb.append(sb.length() > 0 ? " · Non-AC" : "Non-AC");
        if (distanceKm != null && !distanceKm.isEmpty()) {
            sb.append(sb.length() > 0 ? " · " : "").append(distanceKm).append(" km trip");
        }
        return sb.length() > 0 ? sb.toString() : "—";
    }

    /** Countdown driven by the server's broadcast_expires_at, so it matches the
     *  real auction window instead of a hard-coded native timer. */
    private void startCountdown(String expiresAtIso) {
        long msLeft = 55_000L; // fallback if the timestamp is missing/unparseable
        if (expiresAtIso != null) {
            try {
                // ISO-8601 UTC, e.g. "2026-11-01T12:34:56.000Z". Parse without
                // java.time (API 26+) since minSdk is 22 — use SimpleDateFormat.
                java.text.SimpleDateFormat fmt =
                        new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
                fmt.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
                long expiry = fmt.parse(expiresAtIso).getTime();
                long diff = expiry - System.currentTimeMillis();
                if (diff > 1000) msLeft = diff;
            } catch (Exception ignored) { /* use fallback */ }
        }
        final TextView countdown = findViewById(R.id.countdown);
        timer = new CountDownTimer(msLeft, 1000) {
            @Override public void onTick(long m) { countdown.setText(String.valueOf(m / 1000)); }
            @Override public void onFinish() {
                // Window elapsed — just dismiss. Server expires the broadcast.
                dismiss();
            }
        }.start();
    }

    private void onAccept() {
        if (rideId == null) { dismiss(); return; }
        setInFlight(getString(R.string.incoming_ride_accepting));
        new Thread(() -> {
            RideApi.Result r = RideApi.accept(getApplicationContext(), rideId);
            main.post(() -> handleResult(r, true));
        }).start();
    }

    private void onReject() {
        if (rideId == null) { dismiss(); return; }
        // Reject is best-effort; dismiss immediately for a snappy feel and fire
        // the call in the background.
        final String id = rideId;
        new Thread(() -> RideApi.reject(getApplicationContext(), id)).start();
        dismiss();
    }

    private void handleResult(RideApi.Result r, boolean wasAccept) {
        switch (r) {
            case ACCEPTED:
                // Won the ride — open the app to the active ride.
                openRideInApp();
                break;
            case UNAVAILABLE:
                showStatusThenClose(getString(R.string.incoming_ride_taken));
                break;
            case AUTH_FAILED:
                showStatusThenClose(getString(R.string.incoming_ride_auth_failed));
                break;
            case REJECTED:
                dismiss();
                break;
            default:
                showStatusThenClose(getString(R.string.incoming_ride_error));
        }
    }

    private void setInFlight(String message) {
        TextView status = findViewById(R.id.statusLine);
        Button accept = findViewById(R.id.acceptButton);
        Button reject = findViewById(R.id.rejectButton);
        status.setText(message);
        accept.setEnabled(false);
        reject.setEnabled(false);
        if (timer != null) timer.cancel();
        stopSoundAndVibration();
    }

    private void showStatusThenClose(String message) {
        TextView status = findViewById(R.id.statusLine);
        status.setText(message);
        findViewById(R.id.acceptButton).setVisibility(View.GONE);
        main.postDelayed(this::dismiss, 2000);
    }

    private void showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null) km.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                            | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                            | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
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
        long[] pattern = {0, 500, 300, 500, 300, 500};
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
        } else {
            vibrator.vibrate(pattern, 0);
        }
    }

    private void openRideInApp() {
        if (finished) return;
        finished = true;
        stopSoundAndVibration();
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (rideId != null) intent.putExtra("openRideId", rideId);
        startActivity(intent);
        clearNotificationAndFinish();
    }

    private void dismiss() {
        if (finished) return;
        finished = true;
        stopSoundAndVibration();
        clearNotificationAndFinish();
    }

    private void clearNotificationAndFinish() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(7001);
        finish();
    }

    private void stopSoundAndVibration() {
        if (ringtone != null && ringtone.isPlaying()) ringtone.stop();
        if (vibrator != null) vibrator.cancel();
    }

    @Override
    protected void onDestroy() {
        if (timer != null) timer.cancel();
        main.removeCallbacksAndMessages(null);
        stopSoundAndVibration();
        super.onDestroy();
    }
}
