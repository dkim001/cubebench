/**
 * Tiny in-memory TTL cache. Two intents:
 *   - short TTL for lists that can change (competition search, in-progress comps)
 *   - long TTL for immutable data (scrambles + results of finished comps)
 *
 * This is a single-process cache — fine for an MVP. If this grows into a real
 * product with multiple instances, swap the internals for a shared store
 * (e.g. ElastiCache/Redis) behind the same get/withCache surface.
 */
type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

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
  return entry.value;
}

export function set<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: now() + ttlMs });
}

/**
 * Cache-aside helper. Runs `producer` on a miss and stores its result.
 * Errors are not cached, so a transient WCA outage won't be memoized.
 */
export async function withCache<T>(
  key: string,
  ttlMs: number,
  producer: () => Promise<T>,
): Promise<T> {
  const hit = get<T>(key);
  if (hit !== undefined) return hit;
  const value = await producer();
  set(key, value, ttlMs);
  return value;
}
