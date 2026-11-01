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
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.WindowManager;
import android.widget.Button;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

/**
 * Minimal full-screen "wake-up" splash, launched by the full-screen intent in
 * RideFirebaseMessagingService when a ride push arrives while the phone is
 * locked / screen off.
 *
 * Design (Option 2): this screen does NOT render ride details. The web app owns
 * the real ride card (fare, vehicle, distances, timer, Accept/Reject), so there
 * is nothing here to get wrong or to drift out of sync with the server. This
 * Activity only:
 *   1. Wakes the screen and shows over the lock screen,
 *   2. Rings + vibrates to grab attention,
 *   3. Hands off to MainActivity (the web app), deep-linked to the ride, so the
 *      driver sees and acts on the authoritative in-app card.
 *
 * On an UNLOCKED phone we hand off immediately. On a LOCKED phone we wait for
 * the keyguard dismiss before launching the app, showing a brief spinner.
 */
public class IncomingRideActivity extends AppCompatActivity {

    private Ringtone ringtone;
    private Vibrator vibrator;
    private String rideId;
    private boolean handedOff = false;
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        rideId = getIntent().getStringExtra("rideId");

        boolean locked = isLocked();
        showOverLockScreen();
        setContentView(R.layout.activity_incoming_ride);

        Button dismiss = findViewById(R.id.dismissButton);
        dismiss.setOnClickListener(v -> dismiss());

        startAlertSound();
        startVibration();

        if (locked) {
            // Ask the keyguard to dismiss, then open the app once unlocked.
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                km.requestDismissKeyguard(this, new KeyguardManager.KeyguardDismissCallback() {
                    @Override
                    public void onDismissSucceeded() {
                        openRideInApp();
                    }
                    @Override
                    public void onDismissError() {
                        // Keep the splash visible; the driver can tap through / unlock.
                        openRideInApp();
                    }
                });
            }
            // Safety net: if the callback never fires, hand off after a short wait.
            handler.postDelayed(this::openRideInApp, 2500);
        } else {
            // Screen already unlocked (e.g. in another app) — go straight in.
            handler.postDelayed(this::openRideInApp, 400);
        }
    }

    private boolean isLocked() {
        KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        return km != null && km.isKeyguardLocked();
    }

    private void showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
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
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    ringtone.setLooping(true);
                }
                ringtone.play();
            }
        } catch (Exception ignored) {
            // Sound is best-effort; vibration + the visual splash still alert.
        }
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

    /** Launch the web app, deep-linked to the ride, then finish this splash. */
    private synchronized void openRideInApp() {
        if (handedOff) return;
        handedOff = true;
        stopAlerts();

        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (rideId != null) intent.putExtra("openRideId", rideId);
        startActivity(intent);
        finishAndCancelNotification();
    }

    private void dismiss() {
        handedOff = true;
        stopAlerts();
        finishAndCancelNotification();
    }

    private void finishAndCancelNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(7001);
        finish();
    }

    private void stopAlerts() {
        handler.removeCallbacksAndMessages(null);
        if (ringtone != null && ringtone.isPlaying()) ringtone.stop();
        if (vibrator != null) vibrator.cancel();
    }

    @Override
    protected void onDestroy() {
        stopAlerts();
        super.onDestroy();
    }
}
