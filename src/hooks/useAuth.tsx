import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import {
  tokenStore,
  fetchMe,
  login as apiLogin,
  register as apiRegister,
  logoutRequest,
  type AuthUser,
  type AppRole,
  type RegisterInput,
} from "@/lib/api";

export type { AppRole };

interface AuthState {
  user: AuthUser | null;
  roles: AppRole[];
  profile: { full_name: string | null; org: string | null } | null;
  loading: boolean;       // initial session restore
  rolesLoading: boolean;  // kept for API compatibility (always false now)
  signIn: (email: string, password: string) => Promise<AuthUser>;
  signUp: (input: RegisterInput) => Promise<AuthUser>;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthState>({
  user: null, roles: [], profile: null,
  loading: true, rolesLoading: false,
  signIn: async () => { throw new Error("AuthProvider not mounted"); },
  signUp: async () => { throw new Error("AuthProvider not mounted"); },
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore session from localStorage on first load, then validate the token.
  useEffect(() => {
    const stored = tokenStore.getUser();
    if (stored && tokenStore.access) {
      setUser(stored);
      // Validate in the background; if the token is dead and can't be refreshed,
      // the api layer clears storage and /auth/me throws → sign out.
      fetchMe()
        .then((me) => setUser({ ...stored, id: me.id, role: me.role }))
        .catch(() => {
          tokenStore.clear();
          setUser(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const signIn = async (email: string, password: string) => {
    const u = await apiLogin(email, password);
    setUser(u);
    return u;
  };

  const signUp = async (input: RegisterInput) => {
    const u = await apiRegister(input);
    setUser(u);
    return u;
  };

  const signOut = async () => {
    await logoutRequest();
    setUser(null);
  };

  return (
    <AuthCtx.Provider value={{
      user,
      roles: user ? [user.role] : [],
      profile: user ? { full_name: user.fullName, org: null } : null,
      loading,
      rolesLoading: false,
      signIn,
      signUp,
      signOut,
    }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
