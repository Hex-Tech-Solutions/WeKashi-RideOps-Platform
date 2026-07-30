import { createContext, useContext, useState, ReactNode } from "react";
import { driverVerifyOtp, getStoredDriver, logoutRequest, type DriverSession } from "@/lib/api";

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

  const login = async (phone: string, otp: string) => {
    const s = await driverVerifyOtp(phone, otp);
    setSession(s);
    return s;
  };

  const logout = async () => {
    await logoutRequest();
    setSession(null);
  };

  return <Ctx.Provider value={{ session, login, logout }}>{children}</Ctx.Provider>;
}

export const useDriverAuth = () => useContext(Ctx);
