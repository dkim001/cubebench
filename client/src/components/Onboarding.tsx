import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../lib/auth.tsx";
import { renderGoogleButton } from "../lib/google.ts";

/**
 * The gate in front of the app: two steps, no card. A bare column on the
 * paper ground, anchored at the optical center — the auth screen is the
 * welcome. Content enters with the product's one motion vocabulary
 * (staggered rise + blur), steps swap by remount so the incoming content
 * replays it. Progress is a text counter, not carousel dots.
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
      <svg
        className="gate__mark gate__item"
        width="28"
        height="28"
        viewBox="0 0 32 32"
        aria-hidden="true"
      >
        <g fill="currentColor">
          <rect x="2" y="2" width="8" height="8" rx="2" />
          <rect x="12" y="2" width="8" height="8" rx="2" />
          <rect x="22" y="2" width="8" height="8" rx="2" />
          <rect x="2" y="12" width="8" height="8" rx="2" />
          <rect x="12" y="12" width="8" height="8" rx="2" />
          <rect x="22" y="12" width="8" height="8" rx="2" />
          <rect x="2" y="22" width="8" height="8" rx="2" />
          <rect x="12" y="22" width="8" height="8" rx="2" />
          <rect x="22" y="22" width="8" height="8" rx="2" />
        </g>
      </svg>

      {/* keyed remount replays the staggered entrance for the new step */}
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
  const { googleAvailable, signInGoogle, signInEmail } = useAuth();
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";
  const canGoogle = googleAvailable && clientId.length > 0;

  const googleRef = useRef<HTMLDivElement>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Render (and re-render on resize) the GIS button at the column's width.
  useEffect(() => {
    if (!canGoogle || !googleRef.current) return;
    let cancelled = false;
    const render = () => {
      if (cancelled || !googleRef.current) return;
      renderGoogleButton(googleRef.current, clientId, (credential) => {
        signInGoogle(credential).catch((err) =>
          setGoogleError(
            err instanceof Error ? err.message : "Google sign-in failed.",
          ),
        );
      }).catch((err) =>
        setGoogleError(
          err instanceof Error ? err.message : "Google sign-in failed.",
        ),
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
      await signInEmail(email, name);
      // success advances the step via the user effect in Onboarding
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not create the account.",
      );
    } finally {
      setBusy(false);
    }
  }

  let i = 0;
  return (
    <>
      <Item index={++i}>
        <span className="gate__count mono">Step 1 of 2</span>
      </Item>
      <Item index={++i}>
        <h1 className="title gate__title">Create your account</h1>
      </Item>
      <Item index={++i}>
        <p className="muted gate__sub">
          Sign in once — your solves, averages, and progress stay yours.
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
          <input
            className="input"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            autoFocus
          />
          <input
            className="input"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <button className="btn" disabled={busy}>
            {busy ? "Creating…" : "Continue"}
          </button>
          {error && <p className="gate__error">{error}</p>}
        </form>
      </Item>
      <Item index={++i}>
        <p className="tertiary gate__note">
          No password yet — this keeps your results tied to you.
          {!canGoogle &&
            " Google sign-in switches on once a client ID is configured."}
        </p>
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
