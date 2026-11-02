package in.wekashi.driver;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;

/**
 * Native bridge for the driver permissions-onboarding checklist (Step 4).
 *
 * Exposes:
 *  - checkPermissions(): the granted/needed status of every permission the
 *    driver app relies on (notifications, overlay, battery-optimization,
 *    full-screen-intent).
 *  - openSetting({ key }): deep-links to the exact settings page for a given
 *    permission so the driver can grant the ones that have no runtime dialog.
 *  - openAutostartSettings(): best-effort deep-link to the OEM Autostart page
 *    (Xiaomi/Realme/Oppo/Vivo etc.), which has no API — plus a `brand` hint so
 *    the UI can show the right instructions.
 *
 * Runtime-dialog permissions (notifications POST_NOTIFICATIONS, location) are
 * requested on the JS side via @capacitor/push-notifications and
 * @capacitor/geolocation; this plugin reports their status and handles the
 * special-access + OEM pages that those plugins can't.
 */
@CapacitorPlugin(name = "WekashiPermissions")
public class PermissionsPlugin extends Plugin {

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        Context ctx = getContext();
        JSObject res = new JSObject();
        res.put("notifications", NotificationManagerCompat.from(ctx).areNotificationsEnabled());
        res.put("overlay", canDrawOverlays(ctx));
        res.put("batteryUnrestricted", isIgnoringBatteryOptimizations(ctx));
        res.put("fullScreenIntent", canUseFullScreenIntent(ctx));
        res.put("brand", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase(Locale.US));
        call.resolve(res);
    }

    /** Open a specific special-access settings page. key: overlay | battery |
     *  fullScreenIntent | notifications | appDetails */
    @PluginMethod
    public void openSetting(PluginCall call) {
        String key = call.getString("key", "appDetails");
        Context ctx = getContext();
        Intent intent;
        switch (key) {
            case "overlay":
                intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:" + ctx.getPackageName()));
                break;
            case "battery":
                intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                break;
            case "fullScreenIntent":
                if (Build.VERSION.SDK_INT >= 34) {
                    intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
                            Uri.parse("package:" + ctx.getPackageName()));
                } else {
                    intent = appDetailsIntent(ctx);
                }
                break;
            case "notifications":
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                            .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
                } else {
                    intent = appDetailsIntent(ctx);
                }
                break;
            default:
                intent = appDetailsIntent(ctx);
        }
        launch(ctx, intent);
        call.resolve();
    }

    /**
     * Best-effort deep-link to the OEM Autostart / Auto-launch settings. There
     * is no official API; we try the known settings component per brand and
     * fall back to the app-details page. Returns the detected brand so the UI
     * can show the right "find Wekashi Cabs and enable it" instructions.
     */
    @PluginMethod
    public void openAutostartSettings(PluginCall call) {
        Context ctx = getContext();
        String brand = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase(Locale.US);
        boolean opened = tryAutostartIntents(ctx);
        if (!opened) launch(ctx, appDetailsIntent(ctx));
        JSObject res = new JSObject();
        res.put("brand", brand);
        res.put("opened", opened);
        call.resolve(res);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private boolean canDrawOverlays(Context ctx) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx);
    }

    private boolean isIgnoringBatteryOptimizations(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
    }

    private boolean canUseFullScreenIntent(Context ctx) {
        if (Build.VERSION.SDK_INT < 34) return true; // not gated below Android 14
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        try {
            return nm != null && nm.canUseFullScreenIntent();
        } catch (Throwable t) {
            return true;
        }
    }

    private Intent appDetailsIntent(Context ctx) {
        return new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + ctx.getPackageName()))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    private void launch(Context ctx, Intent intent) {
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
        } catch (Exception e) {
            try { ctx.startActivity(appDetailsIntent(ctx)); } catch (Exception ignored) { }
        }
    }

    /** Known OEM autostart settings components, tried in order. */
    private boolean tryAutostartIntents(Context ctx) {
        String[][] components = {
            // Xiaomi / Redmi / POCO (MIUI)
            {"com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"},
            // Oppo (ColorOS)
            {"com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"},
            {"com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"},
            {"com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"},
            // Vivo (Funtouch/OriginOS)
            {"com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"},
            {"com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"},
            // Realme (shares ColorOS components, handled above) + Oppo startsettings
            {"com.oppo.safe", "com.oppo.safe.permission.startupapp.StartupAppListActivity"},
            // Letv / Huawei / Honor
            {"com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"},
            {"com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"},
        };
        for (String[] c : components) {
            try {
                Intent i = new Intent();
                i.setClassName(c[0], c[1]);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
                return true;
            } catch (Exception ignored) {
                // try next
            }
        }
        return false;
    }
}
