package in.wekashi.driver;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Tiny persistent store for the driver's auth tokens and the API base URL, so
 * the native IncomingRideActivity can call Accept/Reject on the backend even
 * when the web app (which normally holds the tokens in localStorage) is killed.
 *
 * The web app pushes these down on login via the WekashiAuth Capacitor plugin
 * (see WekashiAuthPlugin). Tokens are stored in a private SharedPreferences
 * file — same sandbox the WebView's localStorage lives in, not world-readable.
 */
public final class AuthStore {
    private static final String PREFS = "wekashi_auth";
    private static final String KEY_ACCESS = "access";
    private static final String KEY_REFRESH = "refresh";
    private static final String KEY_BASE = "apiBase";

    private AuthStore() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static void save(Context ctx, String access, String refresh, String apiBase) {
        SharedPreferences.Editor e = prefs(ctx).edit();
        if (access != null) e.putString(KEY_ACCESS, access);
        if (refresh != null) e.putString(KEY_REFRESH, refresh);
        if (apiBase != null) e.putString(KEY_BASE, apiBase);
        e.apply();
    }

    public static void updateTokens(Context ctx, String access, String refresh) {
        prefs(ctx).edit().putString(KEY_ACCESS, access).putString(KEY_REFRESH, refresh).apply();
    }

    public static void clear(Context ctx) {
        prefs(ctx).edit().remove(KEY_ACCESS).remove(KEY_REFRESH).apply();
    }

    public static String access(Context ctx)  { return prefs(ctx).getString(KEY_ACCESS, null); }
    public static String refresh(Context ctx) { return prefs(ctx).getString(KEY_REFRESH, null); }

    /** API base, e.g. "https://wekashi.in/api". Falls back to the prod origin. */
    public static String apiBase(Context ctx) {
        return prefs(ctx).getString(KEY_BASE, "https://wekashi.in/api");
    }
}
