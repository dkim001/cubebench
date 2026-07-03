import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { store } from "./store.ts";

/**
 * Session state for the app. The token lives in localStorage; the user is
 * re-fetched from /api/me on load so a stale token signs out cleanly instead
 * of pretending. Google sign-in sends Google's ID token to the backend for
 * real verification; email accounts are passwordless by design in this MVP.
 */

export type User = {
  id: string;
  provider: "google" | "email";
  email: string;
  name: string;
  /** true while trialing or subscribed */
  pro: boolean;
  profile: {
    displayName?: string;
    avg333?: string;
  };
};

const TOKEN_KEY = "cb_token";

type AuthState = {
  user: User | null;
  /** true until the stored token has been checked against the server */
  loading: boolean;
  googleAvailable: boolean;
  billingAvailable: boolean;
  signInGoogle: (credential: string) => Promise<void>;
  signUpEmail: (email: string, password: string, name: string) => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<void>;
  saveProfile: (profile: { displayName?: string; avg333?: string }) => Promise<void>;
  /** refresh the current user from the server (after returning from Stripe) */
  refresh: () => Promise<void>;
  /** redirect to Stripe Checkout for Pro */
  startCheckout: () => Promise<void>;
  /** redirect to the Stripe Billing Portal to manage/cancel */
  openPortal: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

async function postJson<T>(url: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Something went wrong.",
    );
  }
  return data as T;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [googleAvailable, setGoogleAvailable] = useState(false);
  const [billingAvailable, setBillingAvailable] = useState(false);

  // Restore session + discover which sign-in methods the server supports.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await fetch("/api/auth/config").then((r) => r.json());
        if (!cancelled) {
          setGoogleAvailable(Boolean(cfg?.googleAvailable));
          setBillingAvailable(Boolean(cfg?.billingAvailable));
        }
      } catch {
        /* config is advisory; email auth still works */
      }
      const token = store.get(TOKEN_KEY);
      if (!token) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const res = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setUser(data.user);
        } else {
          store.remove(TOKEN_KEY); // stale token: sign out honestly
        }
      } catch {
        /* offline: leave signed out; a retry happens on next load */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const finishSignIn = useCallback((data: { user: User; token: string }) => {
    store.set(TOKEN_KEY, data.token);
    setUser(data.user);
  }, []);

  const signInGoogle = useCallback(
    async (credential: string) => {
      finishSignIn(
        await postJson<{ user: User; token: string }>("/api/auth/google", {
          credential,
        }),
      );
    },
    [finishSignIn],
  );

  const signUpEmail = useCallback(
    async (email: string, password: string, name: string) => {
      finishSignIn(
        await postJson<{ user: User; token: string }>("/api/auth/signup", {
          email,
          password,
          name,
        }),
      );
    },
    [finishSignIn],
  );

  const signInEmail = useCallback(
    async (email: string, password: string) => {
      finishSignIn(
        await postJson<{ user: User; token: string }>("/api/auth/signin", {
          email,
          password,
        }),
      );
    },
    [finishSignIn],
  );

  const refresh = useCallback(async () => {
    const token = store.get(TOKEN_KEY);
    if (!token) return;
    try {
      const res = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setUser((await res.json()).user);
    } catch {
      /* leave current state on a transient failure */
    }
  }, []);

  const saveProfile = useCallback(
    async (profile: { displayName?: string; avg333?: string }) => {
      const token = store.get(TOKEN_KEY) ?? "";
      const data = await postJson<{ user: User }>("/api/profile", profile, token);
      setUser(data.user);
    },
    [],
  );

  const startCheckout = useCallback(async () => {
    const token = store.get(TOKEN_KEY) ?? "";
    const { url } = await postJson<{ url: string }>(
      "/api/billing/checkout",
      {},
      token,
    );
    window.location.href = url;
  }, []);

  const openPortal = useCallback(async () => {
    const token = store.get(TOKEN_KEY) ?? "";
    const { url } = await postJson<{ url: string }>(
      "/api/billing/portal",
      {},
      token,
    );
    window.location.href = url;
  }, []);

  const signOut = useCallback(async () => {
    const token = store.get(TOKEN_KEY);
    store.remove(TOKEN_KEY);
    setUser(null);
    if (token) {
      try {
        await postJson("/api/auth/signout", {}, token);
      } catch {
        /* local sign-out already done; server session expires with restart */
      }
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        googleAvailable,
        billingAvailable,
        signInGoogle,
        signUpEmail,
        signInEmail,
        saveProfile,
        refresh,
        startCheckout,
        openPortal,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
