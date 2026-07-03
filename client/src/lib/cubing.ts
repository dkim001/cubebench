/**
 * Pure cubing math. No React, no I/O — easy to reason about and to test, and
 * this is the code cubers will scrutinize hardest, so it stays isolated.
 *
 * Internally we keep durations in MILLISECONDS for timer precision, and only
 * convert to centiseconds (WCA's unit) at the moment we compare against
 * official results, so the comparison is apples-to-apples.
 */

export type StageKey = "cross" | "f2l" | "oll" | "pll";

export const STAGE_ORDER: StageKey[] = ["cross", "f2l", "oll", "pll"];

export const STAGE_LABEL: Record<StageKey, string> = {
  cross: "Cross",
  f2l: "F2L",
  oll: "OLL",
  pll: "PLL",
};

export type Solve = {
  /** stage durations in ms, in solve order */
  stages: Record<StageKey, number>;
  /** total solve time in ms (== sum of stages) */
  totalMs: number;
};

/**
 * One competition attempt. `plus2` is the WCA +2 penalty (here: started the
 * solve after the 15s inspection window). The penalty is part of the
 * attempt's official time: it is added BEFORE choosing best/worst and before
 * averaging, never after.
 */
export type Attempt = {
  /** stopwatch time in ms, penalty not included */
  rawMs: number;
  plus2: boolean;
};

/** The attempt's official time in ms: raw + 2.000s if penalized. */
export function attemptEffectiveMs(a: Attempt): number {
  return a.rawMs + (a.plus2 ? 2000 : 0);
}

/**
 * The attempt's OFFICIAL time in centiseconds. WCA results live in
 * centiseconds, so each attempt is quantized here first and everything
 * official — best/worst selection, the average, ranking — is computed from
 * these values. (+2 is exactly +200 cs, so quantizing before or after the
 * penalty is equivalent.)
 */
export function attemptCs(a: Attempt): number {
  return msToCentiseconds(a.rawMs) + (a.plus2 ? 200 : 0);
}

/**
 * WCA display convention: a penalized result shows the FINAL time with a
 * trailing "+" — a 12.34 solve with +2 renders "14.34+".
 */
export function formatAttempt(a: Attempt): string {
  return formatCentiseconds(attemptCs(a)) + (a.plus2 ? "+" : "");
}

/**
 * WCA average of 5: drop the single best AND single worst attempt, take the
 * mean of the middle three. Sorting and slicing indices 1..4 removes exactly
 * one best and one worst even when times are tied (a plain "remove min/max by
 * value" would wrongly drop duplicates).
 *
 * Returns the mean in ms (not yet rounded); callers round when displaying.
 * Requires exactly 5 times — v1 has no DNFs, so no DNF handling here.
 */
export function wcaAo5Ms(totalsMs: number[]): number {
  if (totalsMs.length !== 5) {
    throw new Error(`Ao5 needs exactly 5 times, got ${totalsMs.length}`);
  }
  const sorted = [...totalsMs].sort((a, b) => a - b);
  const middleThree = sorted.slice(1, 4); // drops sorted[0] (best) and sorted[4] (worst)
  return middleThree.reduce((sum, t) => sum + t, 0) / middleThree.length;
}

/**
 * WCA-faithful Ao5 in centiseconds: attempts are already quantized to cs
 * (like every official result), best/worst are chosen and the middle three
 * averaged in cs, and the mean is rounded to the nearest cs — the same
 * pipeline that produced the official averages we rank against. This keeps
 * the displayed average provably consistent with the displayed attempts.
 */
export function wcaAo5Cs(attemptsCs: number[]): number {
  return Math.round(wcaAo5Ms(attemptsCs)); // same drop rule, cs domain
}

/** ms -> centiseconds, rounded to nearest (WCA records/averages to centiseconds). */
export function msToCentiseconds(ms: number): number {
  return Math.round(ms / 10);
}

/**
 * Slowest stage across all solves: sum each stage over the 5 solves, then
 * report the stage with the largest share of total time. Simple and honest —
 * "where is your time actually going."
 */
export type StageBreakdown = {
  totals: Record<StageKey, number>; // summed ms per stage
  grandTotalMs: number;
  slowest: StageKey;
  slowestShare: number; // 0..1
};

export function stageBreakdown(solves: Solve[]): StageBreakdown {
  const totals: Record<StageKey, number> = { cross: 0, f2l: 0, oll: 0, pll: 0 };
  for (const solve of solves) {
    for (const key of STAGE_ORDER) totals[key] += solve.stages[key];
  }
  const grandTotalMs = STAGE_ORDER.reduce((sum, k) => sum + totals[k], 0);
  const slowest = STAGE_ORDER.reduce((max, k) =>
    totals[k] > totals[max] ? k : max,
  );
  const slowestShare = grandTotalMs > 0 ? totals[slowest] / grandTotalMs : 0;
  return { totals, grandTotalMs, slowest, slowestShare };
}

/**
 * Placement against real competitors, WCA-ordered: count how many valid
 * averages are strictly faster, +1. `averagesAsc` are centiseconds (ascending,
 * DNFs already excluded); `total` is everyone in the round including DNFs, who
 * sort below any real average. Ties: the user places just behind equal times.
 */
export function placeAverage(
  userAvgCs: number,
  averagesAsc: number[],
  total: number,
): { placement: number; total: number } {
  let better = 0;
  for (const a of averagesAsc) {
    if (a < userAvgCs) better++;
    else break; // ascending -> the rest are >= user
  }
  return { placement: better + 1, total };
}

// ---------- formatting ----------

/** ms -> "SS.xx" or "M:SS.xx", rounded to centiseconds. */
export function formatMs(ms: number): string {
  return formatCentiseconds(msToCentiseconds(ms));
}

/** centiseconds -> "SS.xx" or "M:SS.xx". */
export function formatCentiseconds(cs: number): string {
  const totalSeconds = cs / 100;
  if (totalSeconds >= 60) {
    const m = Math.floor(totalSeconds / 60);
    const s = (totalSeconds % 60).toFixed(2).padStart(5, "0");
    return `${m}:${s}`;
  }
  return totalSeconds.toFixed(2);
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
