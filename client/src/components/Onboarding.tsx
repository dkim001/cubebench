import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../lib/auth.tsx";
import { renderGoogleButton } from "../lib/google.ts";
import { Mark } from "./Mark.tsx";

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
      <Mark className="gate__mark gate__item" size={28} />

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
  const {
    googleAvailable,
    wcaOAuthAvailable,
    signInGoogle,
    startEmail,
    verifyEmail,
    signInWca,
  } = useAuth();
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";
  const canGoogle = googleAvailable && clientId.length > 0;

  const googleRef = useRef<HTMLDivElement>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);

  // which email/WCA path is showing, and how far along the email code flow is
  const [method, setMethod] = useState<"email" | "wca">("email");
  const [emailPhase, setEmailPhase] = useState<"enter" | "code">("enter");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [wcaId, setWcaId] = useState("");

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

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { devCode: dc } = await startEmail(email, name);
      setDevCode(dc ?? null);
      setEmailPhase("code");
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the code.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await verifyEmail(email, code); // success advances the step
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code isn't right.");
    } finally {
      setBusy(false);
    }
  }

  async function submitWca(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signInWca(wcaId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't find that WCA ID.");
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

      {(canGoogle || wcaOAuthAvailable) && (
        <>
          <Item index={++i}>
            {canGoogle && <div ref={googleRef} className="gate__google" />}
            {wcaOAuthAvailable && (
              <a className="btn btn--secondary gate__sso" href="/api/auth/wca/start">
                Continue with WCA
              </a>
            )}
            {googleError && <p className="gate__error">{googleError}</p>}
          </Item>
          <Item index={++i}>
            <div className="gate__divider">
              <span>or</span>
            </div>
          </Item>
        </>
      )}

      {method === "email" && emailPhase === "enter" && (
        <Item index={++i}>
          <form className="gate__form" onSubmit={sendCode}>
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
              {busy ? "Sending…" : "Send code"}
            </button>
            {error && <p className="gate__error">{error}</p>}
          </form>
        </Item>
      )}

      {method === "email" && emailPhase === "code" && (
        <Item index={++i}>
          <form className="gate__form" onSubmit={confirmCode}>
            <p className="muted gate__sub gate__sub--tight">
              We sent a 6-digit code to <strong>{email}</strong>.
            </p>
            <input
              className="input gate__code mono"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              required
              autoFocus
            />
            <button className="btn" disabled={busy || code.length < 6}>
              {busy ? "Verifying…" : "Verify & continue"}
            </button>
            {error && <p className="gate__error">{error}</p>}
            {devCode && (
              <p className="tertiary gate__note">
                Dev mode (no email provider): your code is{" "}
                <strong className="mono">{devCode}</strong>.
              </p>
            )}
            <button
              type="button"
              className="gate__skip"
              onClick={() => {
                setEmailPhase("enter");
                setError(null);
              }}
            >
              ‹ Use a different email
            </button>
          </form>
        </Item>
      )}

      {method === "wca" && (
        <Item index={++i}>
          <form className="gate__form" onSubmit={submitWca}>
            <input
              className="input mono"
              placeholder="2016PARK03"
              value={wcaId}
              onChange={(e) => setWcaId(e.target.value.toUpperCase())}
              maxLength={10}
              required
              autoFocus
            />
            <button className="btn" disabled={busy}>
              {busy ? "Looking up…" : "Continue with WCA ID"}
            </button>
            {error && <p className="gate__error">{error}</p>}
            <p className="tertiary gate__note">
              We'll pull your real name and 3×3 PB from the WCA. (This confirms
              the ID exists, not that it's yours — that's what “Continue with
              WCA” above is for.)
            </p>
          </form>
        </Item>
      )}

      <Item index={++i}>
        <button
          type="button"
          className="gate__switch"
          onClick={() => {
            setMethod((m) => (m === "email" ? "wca" : "email"));
            setError(null);
            setEmailPhase("enter");
          }}
        >
          {method === "email"
            ? "Have a WCA ID? Use it instead"
            : "Use an email instead"}
        </button>
      </Item>
    </>
  );
}

function Profile() {
  const { user, saveProfile, linkWca } = useAuth();
  const [displayName, setDisplayName] = useState(
    user?.profile.displayName ?? user?.name ?? "",
  );
  const [level, setLevel] = useState<string>(user?.profile.avg333 ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showWca, setShowWca] = useState(false);
  const [wcaId, setWcaId] = useState("");

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

  async function link(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // linking sets avg333 from the real PB, which completes onboarding
      await linkWca(wcaId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't find that WCA ID.");
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

      {showWca && (
        <Item index={++i}>
          <form className="gate__form" onSubmit={link}>
            <input
              className="input mono"
              placeholder="2016PARK03"
              value={wcaId}
              onChange={(e) => setWcaId(e.target.value.toUpperCase())}
              maxLength={10}
              required
              autoFocus
            />
            <button className="btn" disabled={busy}>
              {busy ? "Linking…" : "Link WCA ID & continue"}
            </button>
            {error && <p className="gate__error">{error}</p>}
            <button
              type="button"
              className="gate__skip"
              onClick={() => {
                setShowWca(false);
                setError(null);
              }}
            >
              ‹ Pick a range instead
            </button>
          </form>
        </Item>
      )}

      {!showWca && (
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
      )}

      {!showWca && (
        <Item index={++i}>
          <div className="gate__profile-alts">
            <button
              type="button"
              className="gate__switch"
              disabled={busy}
              onClick={() => {
                setShowWca(true);
                setError(null);
              }}
            >
              Know your WCA ID? Use your real PB
            </button>
            <button
              type="button"
              className="gate__skip"
              disabled={busy}
              onClick={() => save("unsure")}
            >
              Not sure yet? Skip for now
            </button>
          </div>
        </Item>
      )}
    </>
  );
}
