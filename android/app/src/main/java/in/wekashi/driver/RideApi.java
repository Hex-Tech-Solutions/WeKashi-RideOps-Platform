package in.wekashi.driver;

import android.content.Context;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Minimal native HTTP client for accepting/rejecting a ride from the
 * IncomingRideActivity, used when the web app is killed. Runs OFF the main
 * thread (callers wrap it). Handles a single 401 by refreshing the access token
 * via POST /auth/refresh (rotating refresh token) and retrying once.
 */
public final class RideApi {

    public enum Result { ACCEPTED, REJECTED, UNAVAILABLE, AUTH_FAILED, ERROR }

    private RideApi() {}

    public static Result accept(Context ctx, String rideId) {
        return post(ctx, "/rides/" + rideId + "/accept", true);
    }

    public static Result reject(Context ctx, String rideId) {
        return post(ctx, "/rides/" + rideId + "/reject", false);
    }

    private static Result post(Context ctx, String path, boolean isAccept) {
        String base = AuthStore.apiBase(ctx);
        String access = AuthStore.access(ctx);
        if (access == null) return Result.AUTH_FAILED;

        int status = doPost(base + path, access);

        // Access token expired → refresh once and retry.
        if (status == 401) {
            if (!refreshToken(ctx)) return Result.AUTH_FAILED;
            access = AuthStore.access(ctx);
            status = doPost(base + path, access);
        }

        if (status >= 200 && status < 300) {
            return isAccept ? Result.ACCEPTED : Result.REJECTED;
        }
        if (status == 409 || status == 410 || status == 400) {
            // Ride already taken / expired / not available.
            return Result.UNAVAILABLE;
        }
        if (status == 401 || status == 403) return Result.AUTH_FAILED;
        return Result.ERROR;
    }

    /** Fire the POST with a Bearer token; returns the HTTP status (or -1). */
    private static int doPost(String urlStr, String bearer) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Authorization", "Bearer " + bearer);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            conn.setDoOutput(true);
            // Empty JSON body — these endpoints take no payload.
            try (OutputStream os = conn.getOutputStream()) {
                os.write("{}".getBytes("UTF-8"));
            }
            return conn.getResponseCode();
        } catch (Exception e) {
            return -1;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /** Refresh the access token via POST /auth/refresh. Persists the rotated pair. */
    private static boolean refreshToken(Context ctx) {
        String base = AuthStore.apiBase(ctx);
        String refresh = AuthStore.refresh(ctx);
        if (refresh == null) return false;

        HttpURLConnection conn = null;
        try {
            URL url = new URL(base + "/auth/refresh");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            conn.setDoOutput(true);
            JSONObject body = new JSONObject();
            body.put("refreshToken", refresh);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.toString().getBytes("UTF-8"));
            }
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) return false;

            java.io.InputStream in = conn.getInputStream();
            java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
            byte[] chunk = new byte[1024];
            int n;
            while ((n = in.read(chunk)) != -1) buf.write(chunk, 0, n);
            JSONObject json = new JSONObject(buf.toString("UTF-8"));
            String newAccess = json.optString("accessToken", null);
            String newRefresh = json.optString("refreshToken", null);
            if (newAccess == null || newRefresh == null) return false;
            AuthStore.updateTokens(ctx, newAccess, newRefresh);
            return true;
        } catch (Exception e) {
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
