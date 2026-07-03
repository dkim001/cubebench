import express from "express";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  getCompetition,
  getFirstRound333Ranking,
  getFirstRound333Scrambles,
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

// Friendly root: this is the API server, not the app. Avoids a cryptic
// "Cannot GET /" if someone opens port 4000 directly — the UI is on 5173.
app.get("/", (_req, res) => {
  res.json({
    service: "cube-benchmark-api",
    note: "This is the API. The app runs on the Vite dev server (port 5173).",
    endpoints: [
      "/health",
      "/ready",
      "/api/competitions?q=",
      "/api/competitions/:id/round",
      "/api/competitions/:id/ranking?roundTypeId=1",
    ],
  });
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
app.get(
  "/api/competitions/:id/round",
  wrap(async (req, res) => {
    const { id } = req.params;
    // Server-side gating: featured comps are free; the rest need Pro. Enforced
    // here so the plan can't be bypassed from devtools.
    if (!FEATURED_COMP_IDS.has(id)) {
      const user = await userForToken(bearerToken(req));
      if (!isPro(user)) {
        res.status(403).json({
          error: "This competition is part of Cube Bench Pro.",
          upgrade: true,
        });
        return;
      }
    }
    const [comp, round] = await Promise.all([
      withCache(`comp:${id}`, TTL.SHORT_MS, () => getCompetition(id)),
      // Scrambles are immutable once generated -> cache long.
      withCache(`scrambles:${id}`, TTL.LONG_MS, () =>
        getFirstRound333Scrambles(id),
      ),
    ]);
    res.json({ competition: comp, round });
  }),
);

// Real competitors' averages for the identified first round, WCA-ordered.
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
      getFirstRound333Ranking(id, roundTypeId),
    );
    res.json({ ranking });
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

app.post("/api/auth/signout", (req, res) => {
  destroySession(bearerToken(req));
  res.json({ status: "ok" });
});

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
// Honest pre-launch capture only: no payment, no checkout, just an email
// appended to a local JSONL file. Idempotent per address.

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const EARLY_ACCESS_FILE = join(DATA_DIR, "early-access.jsonl");
const EMAIL_MAX_LEN = 254;
// Deliberately loose shape check — the goal is catching typos, not RFC 5322.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Emails already captured; hydrated from disk once, then kept in memory. */
let knownEmails: Set<string> | null = null;

async function loadKnownEmails(): Promise<Set<string>> {
  if (knownEmails) return knownEmails;
  const set = new Set<string>();
  try {
    const raw = await readFile(EARLY_ACCESS_FILE, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as { email?: string };
        if (parsed.email) set.add(parsed.email);
      } catch {
        // skip malformed line; don't let one bad row break signups
      }
    }
  } catch {
    // file doesn't exist yet — first signup will create it
  }
  knownEmails = set;
  return set;
}

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
    const known = await loadKnownEmails();
    if (!known.has(email)) {
      await mkdir(DATA_DIR, { recursive: true });
      await appendFile(
        EARLY_ACCESS_FILE,
        JSON.stringify({ email, ts: new Date().toISOString() }) + "\n",
        "utf8",
      );
      known.add(email);
    }
    res.json({ status: "ok" });
  }),
);

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

app.listen(PORT, () => {
  console.log(`cube-benchmark server listening on http://localhost:${PORT}`);
});
