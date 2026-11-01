package in.wekashi.driver;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor plugin bridging the web driver app to native auth storage.
 *
 * The web app calls saveAuth({access, refresh, apiBase}) on login / token
 * refresh so the native IncomingRideActivity can accept/reject a ride directly
 * against the backend when the web app is killed, and clearAuth() on logout.
 */
@CapacitorPlugin(name = "WekashiAuth")
public class WekashiAuthPlugin extends Plugin {

    @PluginMethod
    public void saveAuth(PluginCall call) {
        String access = call.getString("access");
        String refresh = call.getString("refresh");
        String apiBase = call.getString("apiBase");
        AuthStore.save(getContext(), access, refresh, apiBase);
        call.resolve();
    }

    @PluginMethod
    public void clearAuth(PluginCall call) {
        AuthStore.clear(getContext());
        call.resolve();
    }
}
