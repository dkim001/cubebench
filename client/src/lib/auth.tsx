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
  provider: "google" | "email" | "wca";
  email?: string;
  wcaId?: string;
  name: string;
  verified: boolean;
  profile: {
    displayName?: string;
    avg333?: string;
    wcaId?: string;
    pb333AverageCs?: number;
  };
};

const TOKEN_KEY = "cb_token";

type AuthState = {
  user: User | null;
  /** true until the stored token has been checked against the server */
  loading: boolean;
  googleAvailable: boolean;
  wcaOAuthAvailable: boolean;
  signInGoogle: (credential: string) => Promise<void>;
  /** email step 1: returns whether it was really sent + the dev code if not */
  startEmail: (email: string, name: string) => Promise<{ delivered: boolean; devCode?: string }>;
  /** email step 2 */
  verifyEmail: (email: string, code: string) => Promise<void>;
  signInWca: (wcaId: string) => Promise<void>;
  linkWca: (wcaId: string) => Promise<void>;
  saveProfile: (profile: { displayName?: string; avg333?: string }) => Promise<void>;
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
  const [wcaOAuthAvailable, setWcaOAuthAvailable] = useState(false);

  // Restore session + discover which sign-in methods the server supports.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await fetch("/api/auth/config").then((r) => r.json());
        if (!cancelled) {
          setGoogleAvailable(Boolean(cfg?.googleAvailable));
          setWcaOAuthAvailable(Boolean(cfg?.wcaOAuthAvailable));
        }
      } catch {
        /* config is advisory; email + WCA-ID auth still work */
      }
      // WCA OAuth bounces back with a one-time token in the URL fragment.
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const oauthToken = hash.get("wca_token");
      if (oauthToken) {
        store.set(TOKEN_KEY, oauthToken);
        window.history.replaceState(null, "", window.location.pathname);
      }
      const token = oauthToken ?? store.get(TOKEN_KEY);
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

  const startEmail = useCallback(
    (email: string, name: string) =>
      postJson<{ delivered: boolean; devCode?: string }>(
        "/api/auth/email/start",
        { email, name },
      ),
    [],
  );

  const verifyEmail = useCallback(
    async (email: string, code: string) => {
      finishSignIn(
        await postJson<{ user: User; token: string }>("/api/auth/email/verify", {
          email,
          code,
        }),
      );
    },
    [finishSignIn],
  );

  const signInWca = useCallback(
    async (wcaId: string) => {
      finishSignIn(
        await postJson<{ user: User; token: string }>("/api/auth/wca", {
          wcaId,
        }),
      );
    },
    [finishSignIn],
  );

  const linkWca = useCallback(async (wcaId: string) => {
    const token = store.get(TOKEN_KEY) ?? "";
    const data = await postJson<{ user: User }>(
      "/api/profile/link-wca",
      { wcaId },
      token,
    );
    setUser(data.user);
  }, []);

  const saveProfile = useCallback(
    async (profile: { displayName?: string; avg333?: string }) => {
      const token = store.get(TOKEN_KEY) ?? "";
      const data = await postJson<{ user: User }>("/api/profile", profile, token);
      setUser(data.user);
    },
    [],
  );

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
        wcaOAuthAvailable,
        signInGoogle,
        startEmail,
        verifyEmail,
        signInWca,
        linkWca,
        saveProfile,
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
