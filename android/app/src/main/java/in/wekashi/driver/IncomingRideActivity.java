package in.wekashi.driver;

import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
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
import androidx.localbroadcastmanager.content.LocalBroadcastManager;

/**
 * Option Y: this native screen does NOT render a ride card. The web app owns
 * the real DriverOfferCard (fare, vehicle, distances, times, Accept/Reject), so
 * nothing here can be mismatched or drift. This Activity's only job is to:
 *   1. Wake the screen and show over the lock screen,
 *   2. Ring + vibrate to grab attention,
 *   3. Hand off to MainActivity (the web app), deep-linked to the ride, which
 *      then shows the authoritative full-screen card overlay.
 *
 * It finishes itself if a ride_dismiss push arrives (ride cancelled / expired /
 * taken) before the driver acts.
 */
public class IncomingRideActivity extends AppCompatActivity {

    /** Broadcast action the FCM service sends to close an open card on dismiss. */
    public static final String ACTION_DISMISS = "in.wekashi.driver.ACTION_DISMISS";

    private Ringtone ringtone;
    private Vibrator vibrator;
    private String rideId;
    private boolean handedOff = false;
    private final Handler main = new Handler(Looper.getMainLooper());
    private BroadcastReceiver dismissReceiver;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        rideId = getIntent().getStringExtra("rideId");

        boolean locked = isLocked();
        showOverLockScreen();
        setContentView(R.layout.activity_incoming_ride);

        Button dismiss = findViewById(R.id.dismissButton);
        if (dismiss != null) dismiss.setOnClickListener(v -> dismiss());

        startAlertSound();
        startVibration();
        registerDismissReceiver();

        if (locked) {
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                km.requestDismissKeyguard(this, new KeyguardManager.KeyguardDismissCallback() {
                    @Override public void onDismissSucceeded() { openRideInApp(); }
                    @Override public void onDismissError() { openRideInApp(); }
                });
            }
            main.postDelayed(this::openRideInApp, 2500); // safety net
        } else {
            main.postDelayed(this::openRideInApp, 300);
        }
    }

    private void registerDismissReceiver() {
        dismissReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) {
                String dismissedRide = i.getStringExtra("rideId");
                // Close if it's this ride (or no id given — dismiss all).
                if (dismissedRide == null || dismissedRide.equals(rideId)) {
                    dismiss();
                }
            }
        };
        LocalBroadcastManager.getInstance(this)
                .registerReceiver(dismissReceiver, new IntentFilter(ACTION_DISMISS));
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

    private synchronized void openRideInApp() {
        if (handedOff) return;
        handedOff = true;
        stopAlerts();
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (rideId != null) intent.putExtra("openRideId", rideId);
        startActivity(intent);
        clearNotificationAndFinish();
    }

    private void dismiss() {
        handedOff = true;
        stopAlerts();
        clearNotificationAndFinish();
    }

    private void clearNotificationAndFinish() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(7001);
        finish();
    }

    private void stopAlerts() {
        main.removeCallbacksAndMessages(null);
        if (ringtone != null && ringtone.isPlaying()) ringtone.stop();
        if (vibrator != null) vibrator.cancel();
    }

    @Override
    protected void onDestroy() {
        if (dismissReceiver != null) {
            LocalBroadcastManager.getInstance(this).unregisterReceiver(dismissReceiver);
        }
        stopAlerts();
        super.onDestroy();
    }
}
