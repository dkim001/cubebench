/**
 * The WCA events the Simulator supports. All are time-based (results in
 * centiseconds), so the WCA `average` field can be ranked uniformly.
 *
 * Format drives how many solves a round has and how the average is computed:
 *   - "ao5": 5 solves, drop best + worst, mean of the middle 3
 *   - "mo3": 3 solves, mean of all 3 (any DNF => DNF)
 *
 * Deliberately excluded: 333bf/444bf/555bf (best-of-3, DNF-heavy), 333fm
 * (move count, not time), 333mbf (multi-blind points format). Those need
 * bespoke scoring and aren't time averages, so they don't fit this pipeline.
 */
export type EventFormat = "ao5" | "mo3";

export type WcaEventDef = {
  id: string;
  name: string;
  format: EventFormat;
  /** number of solves in a standard round of this event */
  solves: number;
};

export const SUPPORTED_EVENTS: WcaEventDef[] = [
  { id: "333", name: "3x3x3 Cube", format: "ao5", solves: 5 },
  { id: "222", name: "2x2x2 Cube", format: "ao5", solves: 5 },
  { id: "444", name: "4x4x4 Cube", format: "ao5", solves: 5 },
  { id: "555", name: "5x5x5 Cube", format: "ao5", solves: 5 },
  { id: "666", name: "6x6x6 Cube", format: "mo3", solves: 3 },
  { id: "777", name: "7x7x7 Cube", format: "mo3", solves: 3 },
  { id: "333oh", name: "3x3x3 One-Handed", format: "ao5", solves: 5 },
  { id: "clock", name: "Clock", format: "ao5", solves: 5 },
  { id: "minx", name: "Megaminx", format: "ao5", solves: 5 },
  { id: "pyram", name: "Pyraminx", format: "ao5", solves: 5 },
  { id: "skewb", name: "Skewb", format: "ao5", solves: 5 },
  { id: "sq1", name: "Square-1", format: "ao5", solves: 5 },
];

const BY_ID = new Map(SUPPORTED_EVENTS.map((e) => [e.id, e]));

export function isSupportedEvent(id: string): boolean {
  return BY_ID.has(id);
}

export function getEventDef(id: string): WcaEventDef | undefined {
  return BY_ID.get(id);
}

/** Minimum scrambles a round needs to be solvable (its full solve count). */
export function minScrambles(id: string): number {
  return BY_ID.get(id)?.solves ?? 5;
}
