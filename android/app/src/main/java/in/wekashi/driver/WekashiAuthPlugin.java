package in.wekashi.driver;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;

import androidx.localbroadcastmanager.content.LocalBroadcastManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor plugin bridging the web driver app to native services:
 *  - auth storage (saveAuth/clearAuth) so native Accept/Reject/GoOffline can
 *    call the backend when the web app is killed;
 *  - the persistent "You're online" notification (showOnlineNotification /
 *    hideOnlineNotification), shown while the driver is online so they can go
 *    offline in one tap even with the app closed.
 *
 * Fires a `wentOffline` JS event when the driver taps Go Offline on the
 * notification, so the web app flips its toggle if it's running.
 */
@CapacitorPlugin(name = "WekashiAuth")
public class WekashiAuthPlugin extends Plugin {

    private BroadcastReceiver wentOfflineReceiver;

    @Override
    public void load() {
        wentOfflineReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) {
                notifyListeners("wentOffline", new JSObject());
            }
        };
        LocalBroadcastManager.getInstance(getContext()).registerReceiver(
                wentOfflineReceiver, new IntentFilter(GoOfflineReceiver.ACTION_WENT_OFFLINE));
    }

    @Override
    protected void handleOnDestroy() {
        if (wentOfflineReceiver != null) {
            LocalBroadcastManager.getInstance(getContext()).unregisterReceiver(wentOfflineReceiver);
        }
    }

    @PluginMethod
    public void saveAuth(PluginCall call) {
        AuthStore.save(getContext(), call.getString("access"), call.getString("refresh"), call.getString("apiBase"));
        call.resolve();
    }

    @PluginMethod
    public void clearAuth(PluginCall call) {
        AuthStore.clear(getContext());
        call.resolve();
    }

    @PluginMethod
    public void showOnlineNotification(PluginCall call) {
        Intent i = new Intent(getContext(), OnlineStatusService.class);
        i.setAction(OnlineStatusService.ACTION_START);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(i);
        } else {
            getContext().startService(i);
        }
        call.resolve();
    }

    @PluginMethod
    public void hideOnlineNotification(PluginCall call) {
        OnlineStatusService.stop(getContext());
        call.resolve();
    }
}
