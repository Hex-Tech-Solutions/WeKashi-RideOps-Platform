import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { driverVerifyOtp, getStoredDriver, logoutRequest, clearPushToken, tokenStore, type DriverSession } from "@/lib/api";
import { initPushNotifications, teardownPushNotifications } from "@/lib/pushNotifications";
import { syncNativeAuth, clearNativeAuth } from "@/lib/nativeAuth";
import { TERMS_ACCEPTED_KEY } from "./DriverTerms";

interface DriverAuthState {
  session: DriverSession | null;
  login: (phone: string, otp: string) => Promise<DriverSession>;
  logout: () => Promise<void>;
}

const Ctx = createContext<DriverAuthState>({
  session: null,
  login: async () => { throw new Error("DriverAuthProvider not mounted"); },
  logout: async () => {},
});

export function DriverAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<DriverSession | null>(getStoredDriver());

  // Register for FCM push whenever there's an authenticated driver session
  // (fresh login OR a session restored from storage on app relaunch). No-op on
  // web / when permission is declined. Ride broadcasts still arrive via sockets.
  // Also sync the current tokens down to native so the full-screen incoming-ride
  // card can Accept/Reject directly even when the app is killed.
  useEffect(() => {
    if (!session) return;
    void initPushNotifications();
    void syncNativeAuth(tokenStore.access, tokenStore.refresh);
  }, [session]);

  const login = async (phone: string, otp: string) => {
    const s = await driverVerifyOtp(phone, otp);
    // Clear any prior acceptance so a fresh login always re-presents the rules,
    // even if the previous driver accepted them in this same browser session.
    sessionStorage.removeItem(TERMS_ACCEPTED_KEY);
    setSession(s);
    return s;
  };

  const logout = async () => {
    // Clear the token server-side and tear down native listeners BEFORE the
    // access token is revoked, so a signed-out device stops receiving pushes.
    await clearPushToken();
    await teardownPushNotifications();
    await clearNativeAuth();
    await logoutRequest();
    sessionStorage.removeItem(TERMS_ACCEPTED_KEY);
    setSession(null);
  };

  return <Ctx.Provider value={{ session, login, logout }}>{children}</Ctx.Provider>;
}

export const useDriverAuth = () => useContext(Ctx);
