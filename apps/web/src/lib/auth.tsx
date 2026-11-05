import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { api } from "./api";

interface User {
  id: string;
  email: string;
  name: string;
  role: "CUSTOMER" | "WAITER" | "KITCHEN" | "ADMIN";
}

interface AuthCtx {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("cafe_token"));
  // Only wait on /auth/me when a token was actually stored; otherwise the app
  // can render the login route immediately instead of flashing a loader.
  const [loading, setLoading] = useState(() => Boolean(localStorage.getItem("cafe_token")));

  useEffect(() => {
    const stored = localStorage.getItem("cafe_token");
    if (stored) {
      api
        .get<{ user: User }>("/auth/me")
        .then((r) => setUser(r.user))
        .catch(() => {
          localStorage.removeItem("cafe_token");
          setToken(null);
        })
        .finally(() => setLoading(false));
    }
  }, []);

  const login = async (email: string, password: string) => {
    const r = await api.post<{ token: string; user: User }>("/auth/login", { email, password });
    localStorage.setItem("cafe_token", r.token);
    setToken(r.token);
    setUser(r.user);
    // Socket.io is only needed once a realtime screen mounts; keep it out of
    // the landing/login entry bundle.
    void import("./socket").then(({ reconnectWithToken }) => reconnectWithToken(r.token));
    return r.user;
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      /* ignore */
    }
    localStorage.removeItem("cafe_token");
    setToken(null);
    setUser(null);
  };

  return <Ctx.Provider value={{ user, token, loading, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
