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
 * Also:
 *  - creates the notification channels at start-up (NotificationChannels), so
 *    the quiet account channel exists before any push arrives;
 *  - tells OnlineStatusService when the app goes to / comes back from the
 *    background (quick-assist bubble), and when the app's screen (MainActivity,
 *    which runs the web app and its GPS watcher) exists or not (native GPS
 *    fallback, see NativeLocationReporter).
 */
public class WekashiApp extends Application {

    /** Told about foreground/background and app-screen changes. */
    public interface AppStateListener {
        void onForegroundChanged(boolean foreground);
        /** The web app (MainActivity) started or was destroyed. */
        void onWebAppAliveChanged(boolean alive);
    }

    private static int startedActivities = 0;
    private static int mainActivities = 0;
    private static AppStateListener listener;

    public static boolean isForeground() {
        return startedActivities > 0;
    }

    /** True while MainActivity exists, i.e. the web app (and its GPS watcher) can run. */
    public static boolean isWebAppAlive() {
        return mainActivities > 0;
    }

    /** One listener (OnlineStatusService); null to clear. */
    public static void setAppStateListener(@Nullable AppStateListener l) {
        listener = l;
    }

    private static void notifyForeground(boolean fg) {
        AppStateListener l = listener;
        if (l != null) {
            try { l.onForegroundChanged(fg); } catch (Exception ignored) { }
        }
    }

    private static void notifyWebAppAlive(boolean alive) {
        AppStateListener l = listener;
        if (l != null) {
            try { l.onWebAppAliveChanged(alive); } catch (Exception ignored) { }
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
            @Override public void onActivityCreated(@NonNull Activity a, @Nullable Bundle b) {
                if (a instanceof MainActivity) {
                    mainActivities++;
                    if (mainActivities == 1) notifyWebAppAlive(true);
                }
            }
            @Override public void onActivityDestroyed(@NonNull Activity a) {
                if (a instanceof MainActivity && mainActivities > 0) {
                    mainActivities--;
                    if (mainActivities == 0) notifyWebAppAlive(false);
                }
            }
            @Override public void onActivityResumed(@NonNull Activity a) { }
            @Override public void onActivityPaused(@NonNull Activity a) { }
            @Override public void onActivitySaveInstanceState(@NonNull Activity a, @NonNull Bundle b) { }
        });
    }
}
