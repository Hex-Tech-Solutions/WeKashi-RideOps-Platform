package in.wekashi.driver;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;

/**
 * Wekashi Cabs (driver) — thin native shell that loads the hosted driver
 * console in a WebView (see capacitor.config.ts server.url).
 *
 * The WebView's HTTP cache is configured so the app always picks up the latest
 * deploy instead of pinning a stale bundle:
 *   - LOAD_DEFAULT  → use the normal HTTP cache, but honour the server's
 *                     Cache-Control. nginx marks index.html as no-cache and the
 *                     hashed /assets/* as immutable, so the entry document is
 *                     always revalidated while the heavy JS/CSS are reused by
 *                     filename. This is what makes new deploys appear without
 *                     the user reinstalling or clearing app data.
 *   - clearCache on start → drop any document the WebView cached under an older
 *                     (pre-header-fix) policy, so existing installs recover on
 *                     the next launch.
 */
public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Register our native plugins before the bridge initializes.
    registerPlugin(WekashiAuthPlugin.class);
    registerPlugin(PermissionsPlugin.class);
    super.onCreate(savedInstanceState);

    WebView webView = getBridge().getWebView();
    if (webView != null) {
      WebSettings settings = webView.getSettings();
      // Honour server Cache-Control (immutable assets cached, index.html revalidated).
      settings.setCacheMode(WebSettings.LOAD_DEFAULT);
      // Clear stale cached documents left by older installs (one-time on launch).
      webView.clearCache(true);
    }

    // Cold start from the full-screen Accept button.
    handleOpenRide(getIntent());
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    // Warm start (app already running) from the full-screen Accept button.
    handleOpenRide(intent);
  }

  /**
   * When the driver taps Accept on the full-screen IncomingRideActivity, it
   * launches us with an "openRideId" extra. Tell the web app to navigate to
   * that ride by dispatching a window event it listens for. Safe no-op if the
   * extra is absent or the web layer doesn't handle it.
   */
  private void handleOpenRide(Intent intent) {
    if (intent == null) return;
    final String rideId = intent.getStringExtra("openRideId");
    if (rideId == null || rideId.isEmpty()) return;

    final WebView webView = getBridge().getWebView();
    if (webView == null) return;
    // Defer until the web layer is ready to receive the event.
    webView.post(() -> {
      String js = "window.dispatchEvent(new CustomEvent('wekashi:openRide',"
          + "{ detail: { rideId: '" + rideId.replace("'", "") + "' } }));";
      webView.evaluateJavascript(js, null);
    });
  }
}
