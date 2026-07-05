import express from "express";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "./db.ts";
import { TTL, withCache } from "./cache.ts";
import { ROUND_TYPES } from "./roundTypes.ts";
import {
  AuthError,
  destroySession,
  googleAuthAvailable,
  isPro,
  publicUser,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
  updateProfile,
  userForToken,
} from "./auth.ts";
import {
  BillingError,
  createCheckoutUrl,
  createPortalUrl,
  handleWebhook,
  stripeConfigured,
} from "./billing.ts";
import { FEATURED_COMP_IDS } from "./featured.ts";
import {
  get333Ranking,
  get333RoundScrambles,
  get333Rounds,
  getCompetition,
  searchCompetitions,
  WcaError,
} from "./wca.ts";

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

app.use(cors());
// Stripe webhook needs the raw body for signature verification; every other
// route gets JSON parsing.
app.use((req, res, next) =>
  req.originalUrl === "/api/billing/webhook"
    ? next()
    : express.json()(req, res, next),
);

// ---- Rate limits: the unauthenticated write/search endpoints are the
// abuse surface (each miss can also fan out to WCA). Per-IP, in-memory. ----

const limit = (windowMs: number, max: number) =>
  rateLimit({
    windowMs,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests — slow down a little.", status: 429 },
  });

const authLimiter = limit(10 * 60 * 1000, 30); // 30 / 10 min
const captureLimiter = limit(10 * 60 * 1000, 10); // 10 / 10 min
const searchLimiter = limit(60 * 1000, 60); // 60 / min

// Wrap async handlers so rejections hit the error middleware instead of
// hanging the request (no hidden failures).
type Handler = (
  req: express.Request,
  res: express.Response,
) => Promise<unknown>;
const wrap =
  (fn: Handler) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) =>
    fn(req, res).catch(next);

/** Was this competition already over? Drives cache TTL. */
async function isFinished(id: string): Promise<boolean> {
  try {
    const comp = await withCache(`comp:${id}`, TTL.SHORT_MS, () =>
      getCompetition(id),
    );
    if (!comp.end_date) return false;
    // end_date is date-only (UTC midnight at the START of the final day);
    // the comp is only over once that whole day has passed. Otherwise an
    // in-progress comp's partial results get cached for 24h.
    const DAY_MS = 24 * 60 * 60 * 1000;
    return new Date(comp.end_date).getTime() + DAY_MS < Date.now();
  } catch {
    return false; // when unsure, treat as live and cache conservatively
  }
}

// ---- Health probes: liveness and readiness kept distinct ----

// Liveness: the process is up. Never touches upstream.
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Readiness: can we actually serve traffic? Confirms the WCA dependency is
// reachable. Fails (503) on upstream breakage so a load balancer won't route
// to an instance that can't do its one job — proxying WCA.
app.get("/ready", async (_req, res) => {
  try {
    await withCache("ready:probe", 30_000, () =>
      searchCompetitions("").then(() => true),
    );
    res.json({ status: "ready" });
  } catch (err) {
    res.status(503).json({
      status: "unavailable",
      dependency: "wca-api",
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// ---- Data endpoints ----

// Searchable competition list.
app.get(
  "/api/competitions",
  searchLimiter,
  wrap(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const results = await withCache(`search:${q.toLowerCase()}`, TTL.SHORT_MS, () =>
      searchCompetitions(q),
    );
    res.json({ competitions: results });
  }),
);

// First-round 3x3 scramble set (Group A). Reports availability explicitly so
// the client can block solving for comps with no scrambles.
// Gate a competition behind Pro (featured comps are free). Returns true if
// the request should be blocked; writes the 403 itself.
async function blockedByPlan(
  req: express.Request,
  res: express.Response,
  id: string,
): Promise<boolean> {
  if (FEATURED_COMP_IDS.has(id)) return false;
  const user = await userForToken(bearerToken(req));
  if (isPro(user)) return false;
  res.status(403).json({
    error: "This competition is part of Cube Bench Pro.",
    upgrade: true,
  });
  return true;
}

// The solvable 3x3 rounds of a competition (first → final), for the round
// picker. Metadata only — scrambles come from /round.
app.get(
  "/api/competitions/:id/rounds",
  wrap(async (req, res) => {
    const { id } = req.params;
    if (await blockedByPlan(req, res, id)) return;
    const [comp, data] = await Promise.all([
      withCache(`comp:${id}`, TTL.SHORT_MS, () => getCompetition(id)),
      withCache(`rounds:${id}`, TTL.LONG_MS, () => get333Rounds(id)),
    ]);
    res.json({
      competition: comp,
      available: data.available,
      reason: data.reason,
      rounds: data.rounds.map((r) => ({
        roundTypeId: r.roundTypeId,
        roundName: r.roundName,
      })),
    });
  }),
);

// A single round's scramble set. roundTypeId omitted → the first round.
app.get(
  "/api/competitions/:id/round",
  wrap(async (req, res) => {
    const { id } = req.params;
    if (await blockedByPlan(req, res, id)) return;
    const roundTypeId =
      typeof req.query.roundTypeId === "string" ? req.query.roundTypeId : undefined;
    if (roundTypeId && !(roundTypeId in ROUND_TYPES)) {
      res.status(400).json({ error: `Unknown round type "${roundTypeId}".` });
      return;
    }
    const [comp, round] = await Promise.all([
      withCache(`comp:${id}`, TTL.SHORT_MS, () => getCompetition(id)),
      // Scrambles are immutable once generated -> cache long, per round.
      withCache(`round:${id}:${roundTypeId ?? "first"}`, TTL.LONG_MS, () =>
        get333RoundScrambles(id, roundTypeId),
      ),
    ]);
    res.json({ competition: comp, round });
  }),
);

// Real competitors (named, WCA-ordered) for a given round.
app.get(
  "/api/competitions/:id/ranking",
  wrap(async (req, res) => {
    const { id } = req.params;
    const roundTypeId =
      typeof req.query.roundTypeId === "string" ? req.query.roundTypeId : "1";
    // Round codes are a small closed set; anything else is a bad request,
    // not a fresh cache key + upstream fetch.
    if (!(roundTypeId in ROUND_TYPES)) {
      res.status(400).json({ error: `Unknown round type "${roundTypeId}".` });
      return;
    }
    const ttl = (await isFinished(id)) ? TTL.LONG_MS : TTL.SHORT_MS;
    const ranking = await withCache(`ranking:${id}:${roundTypeId}`, ttl, () =>
      get333Ranking(id, roundTypeId),
    );
    // The advancement fact comes from /results, but simulating the next round
    // needs its /scrambles. Cross-check so the client only offers to simulate
    // rounds that actually have a full scramble set (no dead-end button). This
    // is best-effort: if the scramble lookup fails, we still return the
    // ranking (solvable stays undefined -> the client hides the button but
    // keeps the advancement fact) rather than failing the whole request.
    let out = ranking;
    if (ranking.nextRound) {
      let solvable: boolean | undefined = undefined;
      try {
        const rounds = await withCache(`rounds:${id}`, TTL.LONG_MS, () =>
          get333Rounds(id),
        );
        solvable =
          rounds.available &&
          rounds.rounds.some(
            (r) => r.roundTypeId === ranking.nextRound!.roundTypeId,
          );
      } catch {
        /* scramble lookup unavailable — leave solvable undefined */
      }
      out = { ...ranking, nextRound: { ...ranking.nextRound, solvable } };
    }
    res.json({ ranking: out });
  }),
);

// ---- Auth: Google + email/password ----

function bearerToken(req: express.Request): string {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

async function requireUser(req: express.Request, res: express.Response) {
  const user = await userForToken(bearerToken(req));
  if (!user) {
    res.status(401).json({ error: "Not signed in." });
    return null;
  }
  return user;
}

// What this server can actually do (drives which buttons the client shows).
app.get("/api/auth/config", (_req, res) => {
  res.json({
    googleAvailable: googleAuthAvailable(),
    billingAvailable: stripeConfigured(),
  });
});

app.post(
  "/api/auth/google",
  authLimiter,
  wrap(async (req, res) => {
    const credential =
      typeof req.body?.credential === "string" ? req.body.credential : "";
    if (!credential) {
      res.status(400).json({ error: "Missing Google credential." });
      return;
    }
    const { user, token } = await signInWithGoogle(credential);
    res.json({ user: publicUser(user), token });
  }),
);

app.post(
  "/api/auth/signup",
  authLimiter,
  wrap(async (req, res) => {
    const { user, token } = await signUpWithEmail(
      typeof req.body?.email === "string" ? req.body.email : "",
      typeof req.body?.password === "string" ? req.body.password : "",
      typeof req.body?.name === "string" ? req.body.name : "",
    );
    res.json({ user: publicUser(user), token });
  }),
);

app.post(
  "/api/auth/signin",
  authLimiter,
  wrap(async (req, res) => {
    const { user, token } = await signInWithEmail(
      typeof req.body?.email === "string" ? req.body.email : "",
      typeof req.body?.password === "string" ? req.body.password : "",
    );
    res.json({ user: publicUser(user), token });
  }),
);

app.get(
  "/api/me",
  wrap(async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    res.json({ user: publicUser(user) });
  }),
);

app.post(
  "/api/profile",
  wrap(async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const displayName =
      typeof req.body?.displayName === "string"
        ? req.body.displayName.trim().slice(0, 80)
        : undefined;
    const avg333 =
      typeof req.body?.avg333 === "string"
        ? req.body.avg333.trim().slice(0, 20)
        : undefined;
    const updated = await updateProfile(user.id, { displayName, avg333 });
    res.json({ user: updated ? publicUser(updated) : null });
  }),
);

app.post(
  "/api/auth/signout",
  wrap(async (req, res) => {
    await destroySession(bearerToken(req));
    res.json({ status: "ok" });
  }),
);

// ---- Billing: real Stripe subscription (config-gated) ----

// Start hosted Checkout for Pro; returns a Stripe URL to redirect to.
app.post(
  "/api/billing/checkout",
  authLimiter,
  wrap(async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const url = await createCheckoutUrl(user);
    res.json({ url });
  }),
);

// Stripe Billing Portal, for managing or cancelling an existing subscription.
app.post(
  "/api/billing/portal",
  wrap(async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const url = await createPortalUrl(user);
    res.json({ url });
  }),
);

// Stripe webhook — the only writer of subscription state. Raw body (see the
// JSON-parser skip above) so the signature verifies.
app.post(
  "/api/billing/webhook",
  express.raw({ type: "*/*" }),
  wrap(async (req, res) => {
    await handleWebhook(
      req.body as Buffer,
      req.headers["stripe-signature"] as string | undefined,
    );
    res.json({ received: true });
  }),
);

// ---- Early access email capture ----
// Honest pre-launch capture only: no payment, no checkout — just an email
// stored in Postgres. Idempotent per address (ON CONFLICT DO NOTHING).

const EMAIL_MAX_LEN = 254;
// Deliberately loose shape check — the goal is catching typos, not RFC 5322.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

app.post(
  "/api/early-access",
  captureLimiter,
  wrap(async (req, res) => {
    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";
    if (!email || email.length > EMAIL_MAX_LEN || !EMAIL_SHAPE.test(email)) {
      res.status(400).json({ error: "Please enter a valid email address." });
      return;
    }
    await sql`
      insert into early_access (email) values (${email})
      on conflict (email) do nothing
    `;
    res.json({ status: "ok" });
  }),
);

// ---- Serve the built client (production single-service deploy) ----
// In dev this folder doesn't exist and Vite serves the client instead, so
// this block is a no-op locally. API/health routes are registered above, so
// they win; only unmatched GETs fall through to the SPA's index.html.
const CLIENT_DIST = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "client",
  "dist",
);
// On Vercel the client is served by Vercel's CDN, not Express — skip this.
if (!process.env.VERCEL && existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    res.sendFile(join(CLIENT_DIST, "index.html"));
  });
}

// ---- Error handling: explicit, mapped, never swallowed ----
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    // Domain errors carry their own status; also honor 4xx from middleware
    // (e.g. express.json parse failures are client errors, not our 5xx).
    const middlewareStatus =
      typeof (err as { status?: unknown })?.status === "number"
        ? ((err as { status: number }).status as number)
        : undefined;
    const status =
      err instanceof WcaError ||
      err instanceof AuthError ||
      err instanceof BillingError
        ? err.status
        : middlewareStatus && middlewareStatus >= 400 && middlewareStatus < 500
          ? middlewareStatus
          : 500;
    const message = err instanceof Error ? err.message : "Unexpected error";
    // Surface as a clean 4xx/5xx with actionable context; log server-side.
    console.error(`[error] ${status} ${message}`);
    res.status(status >= 400 && status < 600 ? status : 500).json({
      error: message,
      status,
    });
  },
);

// On Vercel the app is exported as a serverless function (see /api/index.ts)
// and must not open a port. Locally and on a normal host, we listen.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`cube-benchmark server listening on http://localhost:${PORT}`);
  });
}

export default app;
