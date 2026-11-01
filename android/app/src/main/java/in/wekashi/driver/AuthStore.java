package in.wekashi.driver;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

/**
 * Persistent, ENCRYPTED store for the driver's auth tokens and the API base
 * URL, so the native IncomingRideActivity can call Accept/Reject on the backend
 * even when the web app (which holds the tokens in localStorage) is killed.
 *
 * Tokens are stored with EncryptedSharedPreferences — AES-256 keyed by a
 * MasterKey held in the Android Keystore — so they are not readable as
 * plaintext even on a rooted device. If the crypto layer can't initialize on
 * some odd OEM build, we fall back to private (sandboxed, MODE_PRIVATE)
 * SharedPreferences rather than break login — the data is still app-private.
 *
 * The web app pushes these down on login / token refresh via the WekashiAuth
 * Capacitor plugin (see WekashiAuthPlugin).
 */
public final class AuthStore {
    private static final String PREFS = "wekashi_auth_enc";
    private static final String KEY_ACCESS = "access";
    private static final String KEY_REFRESH = "refresh";
    private static final String KEY_BASE = "apiBase";

    private AuthStore() {}

    private static SharedPreferences prefs(Context ctx) {
        Context app = ctx.getApplicationContext();
        try {
            MasterKey masterKey = new MasterKey.Builder(app)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build();
            return EncryptedSharedPreferences.create(
                    app,
                    PREFS,
                    masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM);
        } catch (Exception e) {
            // Fallback: still app-private, just not encrypted at rest.
            return app.getSharedPreferences(PREFS + "_fallback", Context.MODE_PRIVATE);
        }
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
