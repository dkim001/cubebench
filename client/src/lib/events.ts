/**
 * The WCA events this app can simulate, with their solving format. Two formats
 * only: average-of-5 (5 solves, drop best+worst) and mean-of-3 (3 solves, no
 * dropping). The `solves` count and `format` drive the timer flow and the
 * scoring — nothing else should hardcode "5".
 */

export type EventFormat = "ao5" | "mo3";

export type ClientEvent = {
  id: string;
  name: string;
  display: string;
  format: EventFormat;
  solves: number;
  formatName: string;
};

export const EVENTS: ClientEvent[] = [
  { id: "333", name: "3x3x3 Cube", display: "3×3", format: "ao5", solves: 5, formatName: "average of 5" },
  { id: "222", name: "2x2x2 Cube", display: "2×2", format: "ao5", solves: 5, formatName: "average of 5" },
  { id: "444", name: "4x4x4 Cube", display: "4×4", format: "ao5", solves: 5, formatName: "average of 5" },
  { id: "555", name: "5x5x5 Cube", display: "5×5", format: "ao5", solves: 5, formatName: "average of 5" },
  { id: "666", name: "6x6x6 Cube", display: "6×6", format: "mo3", solves: 3, formatName: "mean of 3" },
  { id: "777", name: "7x7x7 Cube", display: "7×7", format: "mo3", solves: 3, formatName: "mean of 3" },
  { id: "333oh", name: "3x3x3 One-Handed", display: "3×3 OH", format: "ao5", solves: 5, formatName: "average of 5" },
  { id: "clock", name: "Clock", display: "Clock", format: "ao5", solves: 5, formatName: "average of 5" },
  { id: "minx", name: "Megaminx", display: "Megaminx", format: "ao5", solves: 5, formatName: "average of 5" },
  { id: "pyram", name: "Pyraminx", display: "Pyraminx", format: "ao5", solves: 5, formatName: "average of 5" },
  { id: "skewb", name: "Skewb", display: "Skewb", format: "ao5", solves: 5, formatName: "average of 5" },
  { id: "sq1", name: "Square-1", display: "Square-1", format: "ao5", solves: 5, formatName: "average of 5" },
];

/** The default event (3x3) — used as a safe fallback for unknown ids. */
export const DEFAULT_EVENT: ClientEvent = EVENTS[0];

/** Look up an event by id. */
export function eventById(id: string): ClientEvent | undefined {
  return EVENTS.find((e) => e.id === id);
}

/** Look up an event by id, falling back to 3x3 for unknown/missing ids. */
export function eventOrDefault(id: string | undefined | null): ClientEvent {
  return (id != null ? eventById(id) : undefined) ?? DEFAULT_EVENT;
}
