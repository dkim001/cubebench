/**
 * WCA round_type_id codes are letter/number codes, not a simple sequence.
 * This map assigns each code a sort order so rounds display in the real
 * competition order and so we can reliably identify the *first* round of an
 * event (the round with the smallest order that is actually present).
 *
 * Ordering rationale (lower = earlier in the competition):
 *   qualification -> first -> second -> semi-final -> final -> B-final
 *
 * Combined rounds ("d", "e", "g", "c") are the cutoff variants of their plain
 * counterparts and sort at the same stage. Only the first round of 3x3 is used
 * in v1, but the full map is here so extending to other rounds/events is a
 * one-line change.
 */
export type RoundTypeInfo = {
  order: number;
  name: string;
};

export const ROUND_TYPES: Record<string, RoundTypeInfo> = {
  "0": { order: 0, name: "Qualification round" },
  h: { order: 0, name: "Combined qualification" },

  "1": { order: 1, name: "First round" },
  d: { order: 1, name: "Combined first round" },

  "2": { order: 2, name: "Second round" },
  e: { order: 2, name: "Combined second round" },

  "3": { order: 3, name: "Semi final" },
  g: { order: 3, name: "Combined third round" },
  s: { order: 3, name: "Semi final" },

  f: { order: 4, name: "Final" },
  c: { order: 4, name: "Combined final" },

  b: { order: 5, name: "B final" },
};

/** Fallback for unknown codes: sort them after everything known. */
export function roundOrder(code: string): number {
  return ROUND_TYPES[code]?.order ?? 999;
}

export function roundName(code: string): string {
  return ROUND_TYPES[code]?.name ?? `Round "${code}"`;
}

/**
 * Given the set of round_type_id codes present for an event, return the code
 * of the first round (smallest order). Ties break by original code string so
 * the choice is deterministic.
 */
export function firstRoundCode(codes: string[]): string | null {
  const unique = [...new Set(codes)];
  if (unique.length === 0) return null;
  return unique.sort((a, b) => roundOrder(a) - roundOrder(b) || a.localeCompare(b))[0];
}
