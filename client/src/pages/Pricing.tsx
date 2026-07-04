import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth.tsx";
import { submitEarlyAccess } from "../lib/api.ts";

/**
 * Two plans. Pro is a real Stripe subscription ($3/mo, first month free) when
 * billing is configured; until then it falls back to an honest early-access
 * email capture — no fake checkout ever.
 */
export default function Pricing() {
  const { user, billingAvailable, startCheckout, openPortal, refresh } = useAuth();
  const [params, setParams] = useSearchParams();
  const [notice, setNotice] = useState<string | null>(null);

  // Returning from Stripe Checkout: refresh the plan and show the outcome.
  useEffect(() => {
    const upgrade = params.get("upgrade");
    if (!upgrade) return;
    if (upgrade === "success") {
      setNotice("You're on Pro. Your first month is free.");
      refresh();
    } else if (upgrade === "cancelled") {
      setNotice("No worries. Checkout was cancelled and nothing was charged.");
    }
    params.delete("upgrade");
    setParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="screen container pricing">
      <div className="pricing__head">
        <span className="eyebrow">Pricing</span>
        <h1 className="title">Practice free. Benchmark any competition with Pro.</h1>
      </div>

      {notice && <div className="card pricing__notice">{notice}</div>}

      <div className="card pricing__card">
        <div className="pricing__col">
          <span className="why__label">Free</span>
          <p className="plan__price">
            <span className="plan__amount mono">$0</span>
          </p>
          <ul className="plan__features">
            <li>Three featured competitions to simulate</li>
            <li>Full Skill Timer, single sessions</li>
            <li>Real scrambles, real fields, exact WCA scoring</li>
          </ul>
          <Link className="btn btn--secondary plan__cta" to="/app">
            Start solving
          </Link>
        </div>

        <div className="pricing__divider" aria-hidden="true" />

        <div className="pricing__col">
          <span className="why__label why__label--accent">Pro</span>
          <p className="plan__price">
            <span className="plan__amount mono">$3</span>
            <span className="plan__per">/month · first month free</span>
          </p>
          <ul className="plan__features">
            <li>The entire library of past WCA competitions</li>
            <li>Skill analytics that follow your progress across sessions</li>
            <li>Everything in Free</li>
          </ul>
          <ProAction
            isPro={Boolean(user?.pro)}
            billingAvailable={billingAvailable}
            startCheckout={startCheckout}
            openPortal={openPortal}
          />
        </div>
      </div>

      <p className="pricing__note tertiary">
        {billingAvailable
          ? "Cancel anytime. Your first month is free, and you won't be charged until it ends."
          : "Pro is launching soon. No payment is taken now."}
      </p>

      <div className="faq pricing__faq">
        <span className="eyebrow pricing__faq-head">Questions</span>
        {[
          {
            q: "Can I cancel whenever I want?",
            a: "Yes. Manage or cancel from the billing portal at any time. If you cancel, Pro stays active until the end of the period you've already paid for.",
          },
          {
            q: "What happens after the free month?",
            a: "The subscription renews at $3 a month. Cancel during the trial and you pay nothing at all.",
          },
          {
            q: "Is my card information safe?",
            a: "Checkout is hosted by Stripe, so your card details go to Stripe and never touch our servers.",
          },
        ].map((item) => (
          <details className="faq__item" key={item.q}>
            <summary className="faq__q">
              {item.q}
              <span className="faq__toggle" aria-hidden="true">
                +
              </span>
            </summary>
            <p className="muted faq__a">{item.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}

function ProAction({
  isPro,
  billingAvailable,
  startCheckout,
  openPortal,
}: {
  isPro: boolean;
  billingAvailable: boolean;
  startCheckout: () => Promise<void>;
  openPortal: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(fn: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await fn(); // redirects to Stripe on success
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  if (isPro) {
    return (
      <div className="plan__cta-wrap">
        <p className="plan__done">You're on Pro. Thanks for the support.</p>
        <button
          className="btn btn--secondary plan__cta"
          disabled={busy}
          onClick={() => go(openPortal)}
        >
          {busy ? "Opening…" : "Manage subscription"}
        </button>
        {error && <p className="plan__error">{error}</p>}
      </div>
    );
  }

  if (billingAvailable) {
    return (
      <div className="plan__cta-wrap">
        <button
          className="btn plan__cta"
          disabled={busy}
          onClick={() => go(startCheckout)}
        >
          {busy ? "Starting…" : "Upgrade to Pro"}
        </button>
        <p className="plan__honest tertiary">
          Secure checkout by Stripe · cancel anytime
        </p>
        {error && <p className="plan__error">{error}</p>}
      </div>
    );
  }

  // Billing not configured yet — honest early-access capture.
  return <EarlyAccess />;
}

function EarlyAccess() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setState("sending");
    try {
      await submitEarlyAccess(email);
      setState("done");
    } catch (err) {
      setState("idle");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  if (state === "done") {
    return (
      <p className="plan__done">
        You're on the list. We'll email you when Pro launches.
      </p>
    );
  }

  if (!open) {
    return (
      <div className="plan__cta-wrap">
        <button className="btn plan__cta" onClick={() => setOpen(true)}>
          Get early access
        </button>
        <p className="plan__honest tertiary">Launching soon · no payment now</p>
      </div>
    );
  }

  return (
    <form className="plan__form" onSubmit={submit}>
      <input
        className="input plan__email"
        type="email"
        required
        autoFocus
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button className="btn plan__cta" disabled={state === "sending"}>
        {state === "sending" ? "Adding…" : "Notify me"}
      </button>
      {error && <p className="plan__error">{error}</p>}
      <p className="plan__honest tertiary">
        Pro is launching soon. No payment is taken now.
      </p>
    </form>
  );
}
