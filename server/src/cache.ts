/**
 * Tiny in-memory TTL cache with three protections (this is the only
 * internet-facing process, and cache keys are derived from request input):
 *
 *   - LRU bound: at most MAX_ENTRIES live at once, so attacker-controlled
 *     keys (search queries, ids) can't grow memory without limit.
 *   - Periodic sweep: expired entries are reclaimed even if never re-read.
 *   - Single-flight: concurrent misses on one key share one producer run,
 *     so a TTL expiry (or a WCA brownout) can't fan out into N identical
 *     upstream fetches.
 *
 * Still single-process by design — swap the internals for a shared store
 * (e.g. ElastiCache/Redis) behind the same surface if this goes multi-instance.
 */
type Entry<T> = { value: T; expiresAt: number };

const MAX_ENTRIES = 500;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

const store = new Map<string, Entry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

export const TTL = {
  /** volatile lists (search results, live comps) */
  SHORT_MS: 5 * 60 * 1000,
  /** immutable data for finished comps (scrambles, official results) */
  LONG_MS: 24 * 60 * 60 * 1000,
} as const;

function now(): number {
  return Date.now();
}

export function get<T>(key: string): T | undefined {
  const entry = store.get(key) as Entry<T> | undefined;
  if (!entry) return undefined;
  if (entry.expiresAt <= now()) {
    store.delete(key);
    return undefined;
  }
  // LRU refresh: Maps iterate in insertion order, so re-inserting marks
  // this key most-recently-used.
  store.delete(key);
  store.set(key, entry);
  return entry.value;
}

export function set<T>(key: string, value: T, ttlMs: number): void {
  if (store.has(key)) store.delete(key);
  else if (store.size >= MAX_ENTRIES) {
    // evict least-recently-used (first key in iteration order)
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, expiresAt: now() + ttlMs });
}

/** Reclaim expired entries even when their keys are never read again. */
const sweeper = setInterval(() => {
  const t = now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= t) store.delete(key);
  }
}, SWEEP_INTERVAL_MS);
sweeper.unref?.(); // never keep the process alive just to sweep

/**
 * Cache-aside helper with single-flight. Runs `producer` on a miss and
 * stores its result; concurrent misses on the same key await the same
 * producer. Errors are not cached (and clear the in-flight slot), so a
 * transient WCA outage won't be memoized.
 */
export async function withCache<T>(
  key: string,
  ttlMs: number,
  producer: () => Promise<T>,
): Promise<T> {
  const hit = get<T>(key);
  if (hit !== undefined) return hit;

  const running = inFlight.get(key) as Promise<T> | undefined;
  if (running) return running;

  const p = (async () => {
    try {
      const value = await producer();
      set(key, value, ttlMs);
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, p);
  return p;
}
