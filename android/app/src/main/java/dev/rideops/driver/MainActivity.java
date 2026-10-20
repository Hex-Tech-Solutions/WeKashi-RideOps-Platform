package dev.rideops.driver;

import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;

/**
 * RideOps Driver — thin native shell that loads the hosted driver console in a
 * WebView (see capacitor.config.ts server.url).
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
    super.onCreate(savedInstanceState);

    WebView webView = getBridge().getWebView();
    if (webView != null) {
      WebSettings settings = webView.getSettings();
      // Honour server Cache-Control (immutable assets cached, index.html revalidated).
      settings.setCacheMode(WebSettings.LOAD_DEFAULT);
      // Clear stale cached documents left by older installs (one-time on launch).
      webView.clearCache(true);
    }
  }
}
