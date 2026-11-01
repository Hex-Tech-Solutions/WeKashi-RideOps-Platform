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
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

/**
 * Full-screen "incoming ride" window, launched by RideFirebaseMessagingService's
 * full-screen intent. Shows over the lock screen and turns the screen on. Plays
 * a ringtone + vibrates, counts down, and on Accept hands off to the web app
 * (MainActivity) deep-linked to the ride; on Ignore / timeout it dismisses.
 *
 * NOTE: Accept here opens the ride in the web console so the driver confirms in
 * the normal UI (which calls POST /rides/:id/accept). We intentionally do NOT
 * accept the ride from native code — acceptance must go through the app's
 * authenticated flow and its credit/eligibility checks.
 */
public class IncomingRideActivity extends AppCompatActivity {

    // Matches the broadcast auction window (backend broadcast_expires_at = 1 min).
    // Kept a touch shorter so the screen dismisses before the server expires it.
    private static final long COUNTDOWN_MS = 55_000L;

    private CountDownTimer timer;
    private Ringtone ringtone;
    private Vibrator vibrator;
    private String rideId;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        showOverLockScreen();
        setContentView(R.layout.activity_incoming_ride);

        Intent intent = getIntent();
        rideId = intent.getStringExtra("rideId");
        String pickup = intent.getStringExtra("pickup");
        String drop = intent.getStringExtra("drop");
        String fare = intent.getStringExtra("fare");

        TextView pickupValue = findViewById(R.id.pickupValue);
        TextView dropValue = findViewById(R.id.dropValue);
        TextView fareValue = findViewById(R.id.fareValue);
        final TextView countdown = findViewById(R.id.countdown);
        Button acceptButton = findViewById(R.id.acceptButton);
        Button rejectButton = findViewById(R.id.rejectButton);

        if (pickup != null) pickupValue.setText(pickup);
        if (drop != null) dropValue.setText(drop);
        if (fare != null) fareValue.setText(fare);

        acceptButton.setOnClickListener(v -> openRideInApp());
        rejectButton.setOnClickListener(v -> dismiss());

        startAlertSound();
        startVibration();

        timer = new CountDownTimer(COUNTDOWN_MS, 1000) {
            @Override
            public void onTick(long msLeft) {
                countdown.setText(String.valueOf(msLeft / 1000));
            }

            @Override
            public void onFinish() {
                // Window elapsed with no action — dismiss. The server will expire
                // the broadcast on its own; we don't auto-reject so a late tap in
                // the app can still win if the window hasn't closed.
                dismiss();
            }
        }.start();
    }

    /** Wake the screen and show this Activity over the keyguard. */
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
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    ringtone.setLooping(true);
                }
                ringtone.play();
            }
        } catch (Exception ignored) {
            // Sound is best-effort; the visual + vibration still alert the driver.
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

    /** Hand off to the web app, deep-linked to the ride offer, and finish. */
    private void openRideInApp() {
        stopAlerts();
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        // MainActivity's WebView reads this to navigate to the ride (see the
        // bridge wiring); harmless if the web app ignores it.
        intent.putExtra("openRideId", rideId);
        startActivity(intent);
        finishAndCancelNotification();
    }

    private void dismiss() {
        stopAlerts();
        finishAndCancelNotification();
    }

    private void finishAndCancelNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(7001);
        finish();
    }

    private void stopAlerts() {
        if (timer != null) timer.cancel();
        if (ringtone != null && ringtone.isPlaying()) ringtone.stop();
        if (vibrator != null) vibrator.cancel();
    }

    @Override
    protected void onDestroy() {
        stopAlerts();
        super.onDestroy();
    }
}
