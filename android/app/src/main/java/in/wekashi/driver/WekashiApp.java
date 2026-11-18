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
 *
 * Also creates the notification channels at start-up (NotificationChannels),
 * so the quiet account channel exists before any push arrives, and tells the
 * quick-assist bubble when the app goes to / comes back from the background.
 */
public class WekashiApp extends Application {

    /** Told when the app moves between foreground and background. */
    public interface ForegroundListener { void onForegroundChanged(boolean foreground); }

    private static int startedActivities = 0;
    private static ForegroundListener foregroundListener;

    public static boolean isForeground() {
        return startedActivities > 0;
    }

    /** One listener (the quick-assist bubble in OnlineStatusService); null to clear. */
    public static void setForegroundListener(@Nullable ForegroundListener l) {
        foregroundListener = l;
    }

    private static void notifyForeground(boolean fg) {
        ForegroundListener l = foregroundListener;
        if (l != null) {
            try { l.onForegroundChanged(fg); } catch (Exception ignored) { }
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationChannels.ensure(this);
        registerActivityLifecycleCallbacks(new ActivityLifecycleCallbacks() {
            @Override public void onActivityStarted(@NonNull Activity activity) {
                // Don't count the incoming-ride wake-up splash as "in the app".
                if (activity instanceof IncomingRideActivity) return;
                startedActivities++;
                if (startedActivities == 1) notifyForeground(true);
            }
            @Override public void onActivityStopped(@NonNull Activity activity) {
                if (activity instanceof IncomingRideActivity) return;
                if (startedActivities > 0) startedActivities--;
                if (startedActivities == 0) notifyForeground(false);
            }
            @Override public void onActivityCreated(@NonNull Activity a, @Nullable Bundle b) { }
            @Override public void onActivityResumed(@NonNull Activity a) { }
            @Override public void onActivityPaused(@NonNull Activity a) { }
            @Override public void onActivitySaveInstanceState(@NonNull Activity a, @NonNull Bundle b) { }
            @Override public void onActivityDestroyed(@NonNull Activity a) { }
        });
    }
}
