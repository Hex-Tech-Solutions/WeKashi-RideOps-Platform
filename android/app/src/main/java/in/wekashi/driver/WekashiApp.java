package in.wekashi.driver;

import android.app.Activity;
import android.app.Application;
import android.os.Bundle;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

/**
 * Application subclass that reliably tracks whether the app is in the foreground
 * (has a started/resumed Activity), via ActivityLifecycleCallbacks. This is the
 * authoritative signal RideFirebaseMessagingService uses to decide whether to
 * show native surfaces (notification/overlay) — it must NOT show them while the
 * driver is actively using the app (the web layer owns the ride then).
 *
 * The process-importance heuristic (ActivityManager.getMyMemoryState) was
 * unreliable here because a foreground SERVICE in the same process also reports
 * IMPORTANCE_FOREGROUND, so it couldn't tell "driver is in the app" from "we're
 * running our own overlay service". A started-activity counter is exact.
 */
public class WekashiApp extends Application {

    private static int startedActivities = 0;

    public static boolean isForeground() {
        return startedActivities > 0;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        registerActivityLifecycleCallbacks(new ActivityLifecycleCallbacks() {
            @Override public void onActivityStarted(@NonNull Activity activity) {
                // Don't count the incoming-ride wake-up splash as "in the app".
                if (activity instanceof IncomingRideActivity) return;
                startedActivities++;
            }
            @Override public void onActivityStopped(@NonNull Activity activity) {
                if (activity instanceof IncomingRideActivity) return;
                if (startedActivities > 0) startedActivities--;
            }
            @Override public void onActivityCreated(@NonNull Activity a, @Nullable Bundle b) { }
            @Override public void onActivityResumed(@NonNull Activity a) { }
            @Override public void onActivityPaused(@NonNull Activity a) { }
            @Override public void onActivitySaveInstanceState(@NonNull Activity a, @NonNull Bundle b) { }
            @Override public void onActivityDestroyed(@NonNull Activity a) { }
        });
    }
}
