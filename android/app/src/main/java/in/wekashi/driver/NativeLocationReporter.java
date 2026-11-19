package in.wekashi.driver;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Live GPS from native code while the driver is ONLINE but the web app is not
 * running — e.g. the phone killed the app on swipe-up (OnePlus/Oppo/Realme do
 * this) and Android restarted only OnlineStatusService.
 *
 * Normally the web app's background-geolocation watcher sends the position; it
 * dies with the app and is not restarted. OnlineStatusService runs this
 * reporter whenever MainActivity does not exist, and stops it as soon as the
 * app is opened again, so positions are never sent twice.
 *
 * Posts to POST /driver/location with { native: true }; the server also feeds
 * an in-progress rental's distance meter from it (the web app normally does
 * that).
 */
final class NativeLocationReporter {

    private static final String TAG = "WekashiNativeGps";
    /** Same cadence as the web app: about every 20 m, at most every 10 s. */
    private static final long INTERVAL_MS = 15_000;
    private static final long MIN_INTERVAL_MS = 10_000;
    private static final float MIN_DISTANCE_M = 20f;

    private final Context ctx;
    private final FusedLocationProviderClient client;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private boolean running = false;
    private long lastSentAt = 0;

    private final LocationCallback callback = new LocationCallback() {
        @Override public void onLocationResult(@NonNull LocationResult result) {
            Location l = result.getLastLocation();
            if (l == null) return;
            long now = System.currentTimeMillis();
            if (now - lastSentAt < MIN_INTERVAL_MS) return;
            lastSentAt = now;
            final double lat = l.getLatitude(), lng = l.getLongitude();
            io.execute(() -> {
                RideApi.Result r = RideApi.postLocation(ctx, lat, lng);
                if (r == RideApi.Result.ACCEPTED) Log.i(TAG, "location sent");
                else Log.w(TAG, "location post: " + r);
            });
        }
    };

    NativeLocationReporter(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.client = LocationServices.getFusedLocationProviderClient(this.ctx);
    }

    private boolean hasPermission() {
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @SuppressWarnings("MissingPermission") // checked in hasPermission()
    void start() {
        if (running) return;
        if (!hasPermission()) { Log.w(TAG, "no location permission"); return; }
        LocationRequest req = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, INTERVAL_MS)
                .setMinUpdateIntervalMillis(MIN_INTERVAL_MS)
                .setMinUpdateDistanceMeters(MIN_DISTANCE_M)
                .build();
        try {
            client.requestLocationUpdates(req, callback, Looper.getMainLooper());
            running = true;
            lastSentAt = 0;
            Log.i(TAG, "native GPS started (web app not running)");
        } catch (Exception e) {
            Log.w(TAG, "native GPS could not start", e);
        }
    }

    void stop() {
        if (!running) return;
        try { client.removeLocationUpdates(callback); } catch (Exception ignored) { }
        running = false;
        Log.i(TAG, "native GPS stopped");
    }
}
