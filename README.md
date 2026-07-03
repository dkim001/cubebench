# Cube Bench

Find out where you'd actually place. Cube Bench turns solo speedcubing
practice into a real benchmark: solve the actual scrambles from real WCA
competitions and see where your average would have landed against the people
who were there.

## Pages

- **Home** — landing page: the pitch, a real example result, how it works.
- **Simulator** — pick a real past competition, do the 5 first-round 3×3
  solves on its real scrambles with a standard hold-to-start timer and 15s
  WCA inspection (+2 for a late start), then see your WCA average of 5 ranked
  against the official field.
- **Skill Timer** — unlimited stage-split practice: spacebar taps mark the end
  of cross / F2L / OLL / PLL; a session summary shows which stage is eating
  your time. Scrambles are random-state via cubing.js.
- **Pricing** — Free (three featured competitions + full single-session Skill
  Timer) and Pro, $3/month with the first month free (full WCA library +
  progress analytics). Pro is early-access only: an email capture, no payment
  taken anywhere. Gating is visual only in this version (no accounts).

## Architecture

```
client/   React + Vite + TS SPA (react-router: /, /simulator, /skill-timer, /pricing)
server/   Express proxy for the WCA public API + early-access store
```

The browser only talks to the Express backend. The backend:

- proxies the WCA API and handles CORS,
- does the scramble **grouping and round-sorting** (the WCA scrambles endpoint
  returns one flat list per competition),
- shapes ranking data (WCA ordering, DNFs counted in total but sorted last),
- caches responses (long TTL for immutable scrambles/results, short for lists),
- uses bounded timeouts + retries (exponential backoff + jitter) and distinct
  `/health` (liveness) and `/ready` (readiness) probes,
- `POST /api/early-access` appends validated, deduped emails to
  `server/data/early-access.jsonl`.

### Correctness-critical logic

- `client/src/lib/cubing.ts` — WCA math, pure and unit-tested:
  - **Ao5**: drop exactly one best and one worst, mean the middle three —
    never a plain mean; tie-safe via sort + slice.
  - **Attempts are quantized to centiseconds first** (like every official WCA
    result), then best/worst selection, averaging, and ranking all run in cs,
    so the displayed average always agrees with the displayed attempt times.
  - **+2 penalty** (inspection over 15.00s) is added to that attempt *before*
    best/worst selection and averaging; penalized results display as `14.34+`.
- `server/src/roundTypes.ts` — maps WCA `round_type_id` codes to sort order;
  first round is identified via this map, never assumed to be code `"1"`.
- `server/src/wca.ts` — scramble grouping: filter event, bucket by
  `(round_type_id, group_id)`, take one group, drop `is_extra`, order by
  `scramble_num`.

### Review subagents

`.claude/agents/` defines two read-only reviewers used during development:
`cube-reviewer` (WCA math, penalties, grouping, timing) and `design-reviewer`
(blunt design critic hunting template tells and mobile breakage).

## Accounts and Google sign-in

The app is gated behind onboarding: Launch App → create an account (Google or
email) → quick profile → competitions. Email accounts are passwordless in this
MVP (name + email, stated plainly in the UI); users persist to
`server/data/users.jsonl`, sessions are in-memory.

**Google sign-in is real** (Google Identity Services, ID token verified
server-side with `google-auth-library`) and switches on when a client ID is
configured:

1. Go to https://console.cloud.google.com/apis/credentials (create a project
   if needed).
2. Configure the OAuth consent screen (External, app name, your email).
3. Create Credentials → OAuth client ID → **Web application**.
4. Add `http://localhost:5173` to **Authorized JavaScript origins**.
5. Copy the client ID into both env files:
   - `client/.env` → `VITE_GOOGLE_CLIENT_ID=<your-id>`
   - `server/.env` → `GOOGLE_CLIENT_ID=<your-id>`
6. Restart both dev servers.

Until then, the Google button doesn't render (no fake auth); email accounts
work immediately.

## Running locally

Requires Node 20+ (developed on Node 26).

```bash
# Terminal 1 — backend (port 4000)
cd server && npm install && npm start

# Terminal 2 — frontend (port 5173, proxies /api to 4000)
cd client && npm install && npm run dev
```

## Verification

```bash
cd server && npm run verify          # real WCA fetch + grouping sanity check
cd client && node src/lib/cubing.test.ts   # WCA math unit tests
cd client && npm run build           # typecheck + production build
```

## Timer conventions

- **Simulator (competition timer)**: press space to start 15s inspection;
  hold space (red) until armed (green), release to start; any key stops.
  Starting after 15.00s marks that solve +2. Touch: tap to inspect,
  press-and-hold + release to start, tap to stop.
- **Skill Timer (stage splits)**: space (or tap) to start, then a tap at the
  end of each stage — cross, F2L, OLL, final press ends the solve after PLL.
