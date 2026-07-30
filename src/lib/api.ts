// Lightweight API client for the RideOps backend (Express + JWT).
//
// In production the React app and the API are same-origin: nginx serves the
// static build and reverse-proxies /api → the api container. So the base URL is
// simply "/api". For local dev, vite.config.ts proxies /api → localhost:3000.

export type AppRole = "admin" | "vendor" | "supervisor";

export interface AuthUser {
  id: string;
  role: AppRole;
  fullName: string;
}

const BASE = "/api";
const ACCESS_KEY = "rideops_access";
const REFRESH_KEY = "rideops_refresh";
const USER_KEY = "rideops_user";

export const tokenStore = {
  get access(): string | null {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  },
  getUser(): AuthUser | null {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  },
  set(access: string, refresh: string, user?: AuthUser | null) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function tryRefresh(): Promise<boolean> {
  const refresh = tokenStore.refresh;
  if (!refresh) return false;
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: refresh }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { accessToken: string; refreshToken: string };
    tokenStore.set(data.accessToken, data.refreshToken, tokenStore.getUser());
    return true;
  } catch {
    return false;
  }
}

interface ApiOptions extends RequestInit {
  auth?: boolean; // default true — attach the access token
}

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const { auth = true, ...init } = options;

  const run = async (): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (init.body && !(init.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }
    if (auth && tokenStore.access) {
      headers.set("Authorization", `Bearer ${tokenStore.access}`);
    }
    return fetch(`${BASE}${path}`, { ...init, headers });
  };

  let res = await run();

  // Access token expired → rotate once and retry
  if (res.status === 401 && auth) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await run();
    } else {
      tokenStore.clear();
    }
  }

  if (!res.ok) {
    let message = res.statusText;
    let code: string | undefined;
    try {
      const body = await res.json();
      message = body.error ?? body.message ?? message;
      code = body.code;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message, code);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

export async function login(email: string, password: string): Promise<AuthUser> {
  const data = await api<{ accessToken: string; refreshToken: string; user: AuthUser }>(
    "/auth/login",
    { method: "POST", auth: false, body: JSON.stringify({ email, password }) },
  );
  tokenStore.set(data.accessToken, data.refreshToken, data.user);
  return data.user;
}

export interface RegisterInput {
  email: string;
  password: string;
  role: AppRole;
  fullName: string;
  org?: string;
  inviteToken?: string;
}

export async function register(input: RegisterInput): Promise<AuthUser> {
  const headers: Record<string, string> = {};
  if (input.inviteToken) headers["x-invite-token"] = input.inviteToken;

  const data = await api<{ accessToken: string; refreshToken: string }>("/auth/register", {
    method: "POST",
    auth: false,
    headers,
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      role: input.role,
      fullName: input.fullName,
      org: input.org,
    }),
  });
  tokenStore.set(data.accessToken, data.refreshToken);

  // /auth/register only returns tokens; fetch id from /auth/me to build the user
  const me = await api<{ id: string; role: AppRole }>("/auth/me");
  const user: AuthUser = { id: me.id, role: input.role, fullName: input.fullName };
  tokenStore.set(data.accessToken, data.refreshToken, user);
  return user;
}

export async function logoutRequest(): Promise<void> {
  const refresh = tokenStore.refresh;
  try {
    if (refresh) {
      await api("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken: refresh }) });
    }
  } catch {
    /* ignore — clear locally regardless */
  }
  tokenStore.clear();
}

export async function fetchMe(): Promise<{ id: string; role: AppRole }> {
  return api<{ type: string; id: string; role: AppRole }>("/auth/me");
}

// ─── Driver auth (OTP) ──────────────────────────────────────────────────────

export interface DriverSession {
  id: string;
  role: "driver";
  fullName: string;
  vendorId: string;
}

export async function driverRequestOtp(phone: string): Promise<void> {
  await api("/auth/driver/request-otp", { method: "POST", auth: false, body: JSON.stringify({ phone }) });
}

/** Driver self-registration — creates account linked to vendor, sends OTP. */
export async function driverRegister(input: {
  phone: string;
  fullName: string;
  vendorCode: string;
}): Promise<{ message: string; vendorName: string }> {
  return api("/auth/driver/register", {
    method: "POST",
    auth: false,
    body: JSON.stringify(input),
  });
}

export async function driverVerifyOtp(phone: string, otp: string): Promise<DriverSession> {
  const data = await api<{ accessToken: string; refreshToken: string; driver: { id: string; fullName: string; vendorId: string } }>(
    "/auth/driver/verify-otp",
    { method: "POST", auth: false, body: JSON.stringify({ phone, otp }) },
  );
  const session: DriverSession = { id: data.driver.id, role: "driver", fullName: data.driver.fullName, vendorId: data.driver.vendorId };
  tokenStore.set(data.accessToken, data.refreshToken, session as unknown as AuthUser);
  return session;
}

export function getStoredDriver(): DriverSession | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    const u = JSON.parse(raw);
    return u?.role === "driver" ? (u as DriverSession) : null;
  } catch {
    return null;
  }
}
