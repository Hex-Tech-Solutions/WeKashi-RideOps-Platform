package in.wekashi.driver;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;

/**
 * Floating "quick assist" bubble: while the driver is ONLINE and using another
 * app (Maps, WhatsApp...), a round Wekashi button floats on the screen. One tap
 * brings the Wekashi app back. It can be dragged and snaps to the nearest side
 * edge; the position is remembered.
 *
 * Owned by OnlineStatusService (the "You're online" foreground service), so it
 * exists exactly while the driver is online. Hidden while the Wekashi app is
 * open. Uses the "Display over other apps" permission the driver already grants
 * for the incoming-ride card; without it, nothing is shown.
 */
final class QuickAssistBubble {

    private static final String PREFS = "quick_assist_bubble";
    private static final int SIZE_DP = 56;

    private final Context ctx;
    private final WindowManager wm;
    private FrameLayout view;
    private WindowManager.LayoutParams lp;

    QuickAssistBubble(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.wm = (WindowManager) this.ctx.getSystemService(Context.WINDOW_SERVICE);
    }

    private boolean canDraw() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx);
    }

    private int dp(int v) {
        return Math.round(v * ctx.getResources().getDisplayMetrics().density);
    }

    /** Show when the app is in the background, hide when it is in front. */
    void update(boolean appInForeground) {
        boolean draw = canDraw();
        android.util.Log.i(TAG, "update foreground=" + appInForeground + " canDraw=" + draw);
        if (appInForeground || !draw) hide();
        else { wanted = true; retries = 0; show(); }
    }

    @SuppressLint("ClickableViewAccessibility")
    private void show() {
        if (view != null || wm == null) return;

        FrameLayout bubble = new FrameLayout(ctx);
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(0xFF111111);
        bg.setStroke(dp(2), 0xFFD4A537); // gold ring, like the app's accent
        bubble.setBackground(bg);
        bubble.setElevation(dp(6));
        bubble.setContentDescription(ctx.getString(R.string.bubble_open_app));

        ImageView icon = new ImageView(ctx);
        icon.setImageResource(R.mipmap.ic_launcher_round);
        int pad = dp(6);
        icon.setPadding(pad, pad, pad, pad);
        bubble.addView(icon, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
        lp = new WindowManager.LayoutParams(
                dp(SIZE_DP), dp(SIZE_DP), type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        DisplayMetrics dm = ctx.getResources().getDisplayMetrics();
        lp.x = p.getInt("x", dm.widthPixels - dp(SIZE_DP) - dp(8));
        lp.y = p.getInt("y", dm.heightPixels / 3);

        bubble.setOnTouchListener(new View.OnTouchListener() {
            private final int slop = ViewConfiguration.get(ctx).getScaledTouchSlop();
            private int startX, startY;
            private float downX, downY;
            private boolean dragging;

            @Override public boolean onTouch(View v, MotionEvent e) {
                switch (e.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        startX = lp.x; startY = lp.y;
                        downX = e.getRawX(); downY = e.getRawY();
                        dragging = false;
                        return true;
                    case MotionEvent.ACTION_MOVE: {
                        float dx = e.getRawX() - downX, dy = e.getRawY() - downY;
                        if (!dragging && Math.hypot(dx, dy) > slop) dragging = true;
                        if (dragging) {
                            lp.x = startX + Math.round(dx);
                            lp.y = Math.max(0, startY + Math.round(dy));
                            try { wm.updateViewLayout(view, lp); } catch (Exception ignored) { }
                        }
                        return true;
                    }
                    case MotionEvent.ACTION_UP:
                        if (dragging) snapToEdge();
                        else openApp();
                        return true;
                    default:
                        return false;
                }
            }
        });

        try {
            wm.addView(bubble, lp);
            view = bubble;
            retries = 0;
            android.util.Log.i(TAG, "bubble shown");
        } catch (Exception e) {
            view = null;
            android.util.Log.w(TAG, "bubble addView failed (try " + retries + ")", e);
            // Right after Android restarts the app (e.g. the phone killed it on
            // swipe-up) the window manager can refuse for a moment: retry.
            if (retries < 5) {
                retries++;
                main.postDelayed(() -> { if (wanted) show(); }, 2000L * retries);
            }
        }
    }

    private static final String TAG = "WekashiBubble";
    private final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
    private int retries = 0;
    /** True while the bubble should be on screen (app in background, driver online). */
    private boolean wanted = false;

    private void snapToEdge() {
        int width = ctx.getResources().getDisplayMetrics().widthPixels;
        int size = dp(SIZE_DP);
        lp.x = (lp.x + size / 2 < width / 2) ? dp(8) : width - size - dp(8);
        try { wm.updateViewLayout(view, lp); } catch (Exception ignored) { }
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putInt("x", lp.x).putInt("y", lp.y).apply();
    }

    private void openApp() {
        Intent i = new Intent(ctx, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP
                | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        try { ctx.startActivity(i); } catch (Exception ignored) { }
    }

    /**
     * Watchdog check: put the bubble back if it should be on screen but isn't
     * (the phone removed it, or adding it failed after a restart).
     */
    void ensure(boolean appInForeground) {
        if (appInForeground || !canDraw()) { if (view != null) hide(); return; }
        boolean onScreen = view != null && view.isAttachedToWindow() && view.getWindowVisibility() == View.VISIBLE;
        if (onScreen) return;
        android.util.Log.i(TAG, "watchdog: bubble missing (view=" + (view != null) + "), showing again");
        if (view != null) {
            try { wm.removeView(view); } catch (Exception ignored) { }
            view = null;
        }
        wanted = true;
        retries = 0;
        show();
    }

    void hide() {
        wanted = false;
        main.removeCallbacksAndMessages(null);
        if (view == null || wm == null) return;
        try { wm.removeView(view); } catch (Exception ignored) { }
        view = null;
    }
}
