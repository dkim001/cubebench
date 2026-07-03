import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../lib/auth.tsx";
import { renderGoogleButton } from "../lib/google.ts";
import { Mark } from "./Mark.tsx";

/**
 * The gate in front of the app: account → quick profile. A bare column on the
 * paper ground at the optical center — the auth screen is the welcome.
 * Content enters with the product's one motion vocabulary; steps swap by
 * remount. Sign up and sign in share one screen via a toggle.
 */

const LEVELS = [
  { label: "Getting started", range: "60s+", value: "60+" },
  { label: "Improving", range: "40–60s", value: "40–60" },
  { label: "Intermediate", range: "25–40s", value: "25–40" },
  { label: "Advanced", range: "15–25s", value: "15–25" },
  { label: "Fast", range: "sub-15s", value: "sub-15" },
] as const;

/** Staggered entrance: each child rises in 60ms after the previous. */
function Item({
  index,
  children,
  className = "",
}: {
  index: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`gate__item${className ? ` ${className}` : ""}`}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {children}
    </div>
  );
}

export function Onboarding() {
  const { user } = useAuth();
  const [step, setStep] = useState<"account" | "profile">(
    user ? "profile" : "account",
  );

  useEffect(() => {
    if (user && step === "account") setStep("profile");
  }, [user, step]);

  return (
    <div className="screen gate">
      <Mark className="gate__mark gate__item" size={28} />
      <div className="gate__step" key={step}>
        {step === "account" ? <Account /> : <Profile />}
      </div>
      <p className="gate__foot tertiary">
        Free during beta. Your results stay yours.
      </p>
    </div>
  );
}

function Account() {
  const { googleAvailable, signInGoogle, signUpEmail, signInEmail } = useAuth();
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";
  const canGoogle = googleAvailable && clientId.length > 0;

  const googleRef = useRef<HTMLDivElement>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canGoogle || !googleRef.current) return;
    let cancelled = false;
    const render = () => {
      if (cancelled || !googleRef.current) return;
      renderGoogleButton(googleRef.current, clientId, (credential) => {
        signInGoogle(credential).catch((err) =>
          setGoogleError(err instanceof Error ? err.message : "Google sign-in failed."),
        );
      }).catch((err) =>
        setGoogleError(err instanceof Error ? err.message : "Google sign-in failed."),
      );
    };
    render();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(render, 200);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      if (timer) clearTimeout(timer);
    };
  }, [canGoogle, clientId, signInGoogle]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signup") await signUpEmail(email, password, name);
      else await signInEmail(email, password);
      // success advances the step via the user effect in Onboarding
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const signup = mode === "signup";
  let i = 0;
  return (
    <>
      <Item index={++i}>
        <span className="gate__count mono">
          {signup ? "Step 1 of 2" : "Sign in"}
        </span>
      </Item>
      <Item index={++i}>
        <h1 className="title gate__title">
          {signup ? "Create your account" : "Welcome back"}
        </h1>
      </Item>
      <Item index={++i}>
        <p className="muted gate__sub">
          {signup
            ? "Sign in once — your solves, averages, and progress stay yours."
            : "Sign in to pick up where you left off."}
        </p>
      </Item>

      {canGoogle && (
        <>
          <Item index={++i}>
            <div ref={googleRef} className="gate__google" />
            {googleError && <p className="gate__error">{googleError}</p>}
          </Item>
          <Item index={++i}>
            <div className="gate__divider">
              <span>or</span>
            </div>
          </Item>
        </>
      )}

      <Item index={++i}>
        <form className="gate__form" onSubmit={submit}>
          {signup && (
            <input
              className="input"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              required
              autoFocus
            />
          )}
          <input
            className="input"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus={!signup}
          />
          <input
            className="input"
            type="password"
            autoComplete={signup ? "new-password" : "current-password"}
            placeholder={signup ? "Create a password (8+ characters)" : "Password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
          <button className="btn" disabled={busy}>
            {busy
              ? signup
                ? "Creating…"
                : "Signing in…"
              : signup
                ? "Create account"
                : "Sign in"}
          </button>
          {error && <p className="gate__error">{error}</p>}
        </form>
      </Item>

      <Item index={++i}>
        <button
          type="button"
          className="gate__switch"
          onClick={() => {
            setMode((m) => (m === "signup" ? "signin" : "signup"));
            setError(null);
            setPassword("");
          }}
        >
          {signup
            ? "Already have an account? Sign in"
            : "New here? Create an account"}
        </button>
      </Item>
    </>
  );
}

function Profile() {
  const { user, saveProfile } = useAuth();
  const [displayName, setDisplayName] = useState(
    user?.profile.displayName ?? user?.name ?? "",
  );
  const [level, setLevel] = useState<string>(user?.profile.avg333 ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(value: string) {
    setError(null);
    setBusy(true);
    try {
      await saveProfile({ displayName, avg333: value });
      // Saving flips AppShell into the app — nothing else to do.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      setBusy(false);
    }
  }

  let i = 0;
  return (
    <>
      <Item index={++i}>
        <span className="gate__count mono">Step 2 of 2</span>
      </Item>
      <Item index={++i}>
        <h1 className="title gate__title">How fast are you?</h1>
      </Item>
      <Item index={++i}>
        <p className="muted gate__sub">
          Roughly — it gives your results context. A guess is fine.
        </p>
      </Item>

      <Item index={++i}>
        <form
          className="gate__form"
          onSubmit={(e) => {
            e.preventDefault();
            if (level) save(level);
          }}
        >
          <input
            className="input"
            placeholder="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={80}
            required
          />

          <div className="gate__levels" role="radiogroup" aria-label="3x3 average">
            {LEVELS.map((l) => (
              <button
                key={l.value}
                type="button"
                role="radio"
                aria-checked={level === l.value}
                className={`lvl${level === l.value ? " is-selected" : ""}`}
                onClick={() => setLevel(l.value)}
              >
                <span className="lvl__label">{l.label}</span>
                <span className="lvl__range mono">{l.range}</span>
              </button>
            ))}
          </div>

          <button className="btn" disabled={busy || !level}>
            {busy ? "Saving…" : "Start solving"}
          </button>
          {error && <p className="gate__error">{error}</p>}
        </form>
      </Item>
      <Item index={++i}>
        <button
          type="button"
          className="gate__skip"
          disabled={busy}
          onClick={() => save("unsure")}
        >
          Not sure yet? Skip for now
        </button>
      </Item>
    </>
  );
}
