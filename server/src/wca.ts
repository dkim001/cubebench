import { firstRoundCode, roundName } from "./roundTypes.ts";

const WCA_BASE = "https://www.worldcubeassociation.org/api/v0";
const EVENT_333 = "333";

/** Per-request budget for a single WCA call. */
const REQUEST_TIMEOUT_MS = 12_000;
/** Bounded retries for transient failures (network error / 5xx / 429). */
const MAX_RETRIES = 2;

// ---------- types mirroring the WCA payloads we consume ----------

export type WcaScramble = {
  event_id: string;
  round_type_id: string;
  group_id: string;
  is_extra: boolean;
  scramble_num: number;
  scramble: string;
};

export type WcaResult = {
  name: string;
  best: number; // centiseconds; <=0 means DNF/DNS
  average: number; // centiseconds; <=0 means DNF / no average
  pos: number;
  event_id: string;
  round_type_id: string;
  country_iso2: string;
  wca_id: string | null;
  attempts: number[];
};

export type WcaCompetition = {
  id: string;
  name: string;
  city?: string;
  country_iso2?: string;
  start_date?: string;
  end_date?: string;
};

export class WcaError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "WcaError";
    this.status = status;
  }
}

// ---------- low-level fetch with timeout + bounded backoff ----------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a WCA endpoint as JSON.
 * - Bounded per-attempt timeout via AbortController.
 * - Retries only transient failures (network error, 429, 5xx) with
 *   exponential backoff + jitter. 4xx (except 429) fail fast.
 * - A 404 returns { status: 404, data: null } to callers that expect it
 *   (e.g. scrambles never uploaded) rather than throwing.
 */
async function wcaFetch<T>(
  path: string,
): Promise<{ status: number; data: T | null }> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${WCA_BASE}${path}`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });

      if (res.status === 404) {
        return { status: 404, data: null };
      }

      // Retry transient upstream failures with backoff.
      if (res.status === 429 || res.status >= 500) {
        lastErr = new WcaError(`WCA upstream ${res.status}`, res.status);
        if (attempt < MAX_RETRIES) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw lastErr;
      }

      if (!res.ok) {
        // Other 4xx: fail fast, do not retry.
        throw new WcaError(`WCA responded ${res.status}`, res.status);
      }

      const data = (await res.json()) as T;
      return { status: res.status, data };
    } catch (err) {
      lastErr = err;
      const isAbort = err instanceof Error && err.name === "AbortError";
      const retryable = isAbort || err instanceof TypeError; // timeout or network
      if (retryable && attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        continue;
      }
      if (err instanceof WcaError) throw err;
      throw new WcaError(
        `Failed to reach WCA: ${err instanceof Error ? err.message : String(err)}`,
        502,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new WcaError("WCA request failed", 502);
}

function backoffMs(attempt: number): number {
  const base = 300 * 2 ** attempt; // 300, 600, ...
  const jitter = Math.random() * 200;
  return base + jitter;
}

// ---------- high-level operations ----------

export async function getCompetition(id: string): Promise<WcaCompetition> {
  const { status, data } = await wcaFetch<WcaCompetition>(
    `/competitions/${encodeURIComponent(id)}`,
  );
  if (!data) throw new WcaError(`Competition "${id}" not found`, status || 404);
  return data;
}

export async function searchCompetitions(query: string): Promise<WcaCompetition[]> {
  const q = query.trim();
  // The WCA competitions index supports full-text `q`, sorted most-recent first.
  const path = q
    ? `/competitions?q=${encodeURIComponent(q)}&sort=-start_date&per_page=25`
    : `/competitions?sort=-start_date&per_page=25`;
  const { data } = await wcaFetch<WcaCompetition[]>(path);
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    city: c.city,
    country_iso2: c.country_iso2,
    start_date: c.start_date,
    end_date: c.end_date,
  }));
}

export type RoundScrambleSet = {
  available: boolean;
  reason?: string;
  roundTypeId?: string;
  roundName?: string;
  groupId?: string;
  /** ordered by scramble_num, is_extra excluded */
  scrambles?: string[];
};

/**
 * Fetch and shape the first-round 3x3 scramble set for a competition.
 *
 * The scrambles endpoint returns ONE flat list for the whole comp, so we:
 *   1. filter to event 333,
 *   2. pick the first round via the round-type sort order,
 *   3. bucket by (round_type_id, group_id) and take Group A (or the first
 *      group present if there is no literal "A"),
 *   4. drop is_extra backups,
 *   5. order by scramble_num.
 *
 * Returns { available:false } with a human reason when scrambles were never
 * uploaded (404/null) or when 333 simply isn't in this comp's scramble set.
 */
export async function getFirstRound333Scrambles(
  id: string,
): Promise<RoundScrambleSet> {
  const { data } = await wcaFetch<WcaScramble[]>(
    `/competitions/${encodeURIComponent(id)}/scrambles`,
  );

  if (!data || !Array.isArray(data) || data.length === 0) {
    return { available: false, reason: "Scrambles not available" };
  }

  const threes = data.filter((s) => s.event_id === EVENT_333);
  if (threes.length === 0) {
    return { available: false, reason: "No 3x3 scrambles for this competition" };
  }

  const roundCode = firstRoundCode(threes.map((s) => s.round_type_id));
  if (!roundCode) {
    return { available: false, reason: "Could not identify the first round" };
  }

  const roundScrambles = threes.filter((s) => s.round_type_id === roundCode);

  // Prefer Group "A"; otherwise fall back to the first group present.
  const groups = [...new Set(roundScrambles.map((s) => s.group_id))].sort();
  const groupId = groups.includes("A") ? "A" : groups[0];

  const set = roundScrambles
    .filter((s) => s.group_id === groupId && !s.is_extra)
    .sort((a, b) => a.scramble_num - b.scramble_num)
    .map((s) => s.scramble);

  // An average-of-5 round needs 5 scrambles. Old best-of-3 rounds or
  // partial uploads would otherwise strand the user mid-round client-side.
  if (set.length < 5) {
    return {
      available: false,
      reason:
        set.length === 0
          ? "No usable scrambles for the first round"
          : "This round isn't a full average of 5",
    };
  }

  return {
    available: true,
    roundTypeId: roundCode,
    roundName: roundName(roundCode),
    groupId,
    scrambles: set,
  };
}

export type RankingData = {
  roundTypeId: string;
  roundName: string;
  totalCompetitors: number;
  /** valid Ao5 averages (centiseconds), ascending; DNFs excluded from array */
  averagesAsc: number[];
  fastestAverage: number | null;
};

/**
 * Real competitors' averages for the first-round 3x3, ordered the WCA way:
 * competitors with a valid average rank ascending; DNF / no-average
 * competitors are counted in the total but sort last (excluded from the
 * averages array). `totalCompetitors` is everyone in the round.
 */
export async function getFirstRound333Ranking(
  id: string,
  roundTypeId: string,
): Promise<RankingData> {
  const { data } = await wcaFetch<WcaResult[]>(
    `/competitions/${encodeURIComponent(id)}/results?event_id=${EVENT_333}`,
  );
  const rows = (data ?? []).filter(
    (r) => r.event_id === EVENT_333 && r.round_type_id === roundTypeId,
  );

  const valid = rows
    .filter((r) => r.average > 0)
    .map((r) => r.average)
    .sort((a, b) => a - b);

  return {
    roundTypeId,
    roundName: roundName(roundTypeId),
    totalCompetitors: rows.length,
    averagesAsc: valid,
    fastestAverage: valid.length ? valid[0] : null,
  };
}
