import { useState } from "react";
import { Link } from "react-router-dom";
import { submitEarlyAccess } from "../lib/api.ts";

/**
 * Two plans, honestly stated. Pro is not purchasable yet: the button opens a
 * plain email capture, the copy says so, and no payment is taken anywhere.
 */
export default function Pricing() {
  return (
    <div className="screen container pricing">
      <div className="pricing__head">
        <span className="eyebrow">Pricing</span>
        <h1 className="title">Practice free. Benchmark deeper with Pro.</h1>
      </div>

      <div className="pricing__grid">
        <div className="card plan">
          <h2 className="plan__name">Free</h2>
          <p className="plan__price">
            <span className="plan__amount mono">$0</span>
          </p>
          <ul className="plan__features">
            <li>Three featured competitions in the Simulator</li>
            <li>Full Skill Timer, single sessions</li>
            <li>Real scrambles, real fields, exact WCA scoring</li>
          </ul>
          <Link className="btn btn--secondary plan__cta" to="/app">
            Start solving
          </Link>
        </div>

        <div className="card plan plan--pro">
          <h2 className="plan__name">Pro</h2>
          <p className="plan__price">
            <span className="plan__amount mono">$3</span>
            <span className="plan__per">/month · first month free</span>
          </p>
          <ul className="plan__features">
            <li>The entire library of past WCA competitions</li>
            <li>Skill analytics over time — progress across sessions</li>
            <li>Everything in Free</li>
          </ul>
          <EarlyAccess />
        </div>
      </div>

      <p className="pricing__note tertiary">
        Pro is launching soon. No payment is taken now — leaving your email
        just reserves your first month free at launch.
      </p>
    </div>
  );
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
      setError(
        err instanceof Error ? err.message : "Something went wrong — try again.",
      );
    }
  }

  if (state === "done") {
    return (
      <p className="plan__done">
        You're on the list — we'll email you when Pro launches.
      </p>
    );
  }

  if (!open) {
    return (
      <div className="plan__cta-wrap">
        <button className="btn plan__cta" onClick={() => setOpen(true)}>
          Get early access
        </button>
        <p className="plan__honest tertiary">
          Launching soon · no payment now
        </p>
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
        Pro is launching soon. No payment is taken now — you'll just get the
        first month free when it ships.
      </p>
    </form>
  );
}
