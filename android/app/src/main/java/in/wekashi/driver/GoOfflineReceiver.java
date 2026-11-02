package in.wekashi.driver;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.widget.Toast;

import androidx.localbroadcastmanager.content.LocalBroadcastManager;

/**
 * Handles the "Go Offline" action on the persistent online-status notification.
 * Calls POST /driver/offline directly (RideApi, token-refreshing) off the main
 * thread — the driver can go offline without opening the app. On success it
 * stops the OnlineStatusService (removing the notification) and broadcasts
 * ACTION_WENT_OFFLINE so the web app, if running, flips its toggle to offline.
 */
public class GoOfflineReceiver extends BroadcastReceiver {

    public static final String ACTION_GO_OFFLINE = "in.wekashi.driver.GO_OFFLINE";
    /** Web app listens for this (via the WekashiAuth plugin) to update its UI. */
    public static final String ACTION_WENT_OFFLINE = "in.wekashi.driver.WENT_OFFLINE";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ACTION_GO_OFFLINE.equals(intent.getAction())) return;
        final Context app = context.getApplicationContext();
        // goAsync keeps the receiver alive for the network call.
        final PendingResult pending = goAsync();
        new Thread(() -> {
            RideApi.Result r = RideApi.goOffline(app);
            // Stop the notification regardless — if the call failed (e.g. no
            // network), the driver clearly intends to be offline; the server
            // state reconciles on next app open. Avoids a stuck notification.
            OnlineStatusService.stop(app);
            LocalBroadcastManager.getInstance(app)
                    .sendBroadcast(new Intent(ACTION_WENT_OFFLINE));
            if (r != RideApi.Result.ACCEPTED && r != RideApi.Result.REJECTED) {
                // Non-2xx: let the driver know it may not have reached the server.
                try {
                    android.os.Handler h = new android.os.Handler(app.getMainLooper());
                    h.post(() -> Toast.makeText(app,
                            "Going offline — open the app if it doesn't stick",
                            Toast.LENGTH_SHORT).show());
                } catch (Exception ignored) { }
            }
            pending.finish();
        }).start();
    }
}
