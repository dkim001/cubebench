import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/**
 * Session state for the app. The token lives in localStorage; the user is
 * re-fetched from /api/me on load so a stale token signs out cleanly instead
 * of pretending. Google sign-in sends Google's ID token to the backend for
 * real verification; email accounts are passwordless by design in this MVP.
 */

export type User = {
  id: string;
  email: string;
  name: string;
  provider: "google" | "email";
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
  signInGoogle: (credential: string) => Promise<void>;
  signInEmail: (email: string, name: string) => Promise<void>;
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

  // Restore session + discover whether the server can verify Google tokens.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await fetch("/api/auth/config").then((r) => r.json());
        if (!cancelled) setGoogleAvailable(Boolean(cfg?.googleAvailable));
      } catch {
        /* config is advisory; email auth still works */
      }
      const token = localStorage.getItem(TOKEN_KEY);
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
          localStorage.removeItem(TOKEN_KEY); // stale token: sign out honestly
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
    localStorage.setItem(TOKEN_KEY, data.token);
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

  const signInEmail = useCallback(
    async (email: string, name: string) => {
      finishSignIn(
        await postJson<{ user: User; token: string }>("/api/auth/email", {
          email,
          name,
        }),
      );
    },
    [finishSignIn],
  );

  const saveProfile = useCallback(
    async (profile: { displayName?: string; avg333?: string }) => {
      const token = localStorage.getItem(TOKEN_KEY) ?? "";
      const data = await postJson<{ user: User }>("/api/profile", profile, token);
      setUser(data.user);
    },
    [],
  );

  const signOut = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
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
      value={{ user, loading, googleAvailable, signInGoogle, signInEmail, saveProfile, signOut }}
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
