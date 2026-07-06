import { useEffect, useState } from "react";
import {
  getRanking,
  type Competition,
  type RankingData,
  type RoundScrambleSet,
} from "../lib/api.ts";
import {
  attemptCs,
  formatAttempt,
  formatCentiseconds,
  type Attempt,
} from "../lib/cubing.ts";
import type { ClientEvent } from "../lib/events.ts";
import { CompTimer } from "./CompTimer.tsx";

/**
 * A round in progress. The screen stays purposeful even before the timer runs:
 * the attempts done so far are listed with a running/projected average (in the
 * event's format), and a "who you're up against" panel shows the real field —
 * its size, the advancement cut, and the fastest average to benchmark against.
 * Attempts live in the parent (persisted after each solve); leaving mid-round
 * just pauses it.
 */
export function Solving({
  comp,
  event,
  scrambles,
  round,
  roundName,
  attempts,
  onAttempt,
  onBack,
}: {
  comp: Competition;
  event: ClientEvent;
  scrambles: string[];
  round: RoundScrambleSet;
  roundName?: string;
  attempts: Attempt[];
  onAttempt: (attempt: Attempt) => void;
  onBack: () => void;
}) {
  const requiredAttempts = event.solves;
  const solveScrambles = scrambles.slice(0, requiredAttempts);
  const total = solveScrambles.length;
  const index = attempts.length;

  return (
    <div className="screen container solving">
      <div className="solving__bar">
        <button className="btn--ghost btn" onClick={onBack}>
          ‹ Back
        </button>
        <span
          className="solving__count mono"
          aria-label={`Solve ${index + 1} of ${total}`}
        >
          {roundName ? `${roundName} · ` : ""}
          {event.display} · {index + 1} / {total}
        </span>
        <div className="solving__times mono" aria-label="Times so far">
          {attempts.map((a, i) => (
            <span key={i} className="solving__time">
              {formatAttempt(a)}
            </span>
          ))}
        </div>
      </div>

      <CompTimer
        key={index}
        scramble={solveScrambles[index]}
        solveIndex={index}
        totalSolves={total}
        onComplete={onAttempt}
      />

      <RunningAverage attempts={attempts} event={event} total={total} />
      <UpAgainst comp={comp} event={event} round={round} />
    </div>
  );
}

/**
 * The attempts done this round with a running result. Once the average can be
 * computed early (Ao5: one attempt may still be dropped, so the middle three
 * of the first four is a "current" figure; Mo3: the running mean), it's shown
 * so the cuber can do the usual "what do I need on the last one" math.
 */
function RunningAverage({
  attempts,
  event,
  total,
}: {
  attempts: Attempt[];
  event: ClientEvent;
  total: number;
}) {
  if (attempts.length === 0) return null;

  const done = attempts.length;
  const label = done < total ? "Running" : event.formatName;
  const value = runningAverage(attempts, event.format);

  return (
    <div className="card run-avg">
      <div className="run-avg__head">
        <span className="eyebrow">This round</span>
        <span className="tertiary run-avg__meta">
          {done} of {total} done
        </span>
      </div>
      <div className="run-avg__rows">
        {attempts.map((a, i) => (
          <div className="run-avg__cell" key={i}>
            <span className="tertiary">{i + 1}</span>
            <span className="mono">{formatAttempt(a)}</span>
          </div>
        ))}
        {Array.from({ length: total - done }).map((_, i) => (
          <div className="run-avg__cell run-avg__cell--pending" key={`p-${i}`}>
            <span className="tertiary">{done + i + 1}</span>
            <span className="mono">—</span>
          </div>
        ))}
      </div>
      {value !== undefined && (
        <div className="run-avg__foot">
          <span className="tertiary">{label}</span>
          <span className="mono run-avg__value">
            {value === null ? "DNF" : formatCentiseconds(value)}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * A "current" average from a partial set. For Ao5 it needs at least 4 attempts
 * (so a best+worst can be dropped from the ones in hand); for Mo3 the running
 * mean of whatever's done. `undefined` means "not enough data yet"; `null`
 * means the current figure is a DNF.
 */
function runningAverage(
  attempts: Attempt[],
  format: ClientEvent["format"],
): number | null | undefined {
  if (format === "mo3") {
    if (attempts.some((a) => a.dnf)) return null;
    const cs = attempts.map(attemptCs);
    return Math.round(cs.reduce((s, t) => s + t, 0) / cs.length);
  }
  // ao5: needs >= 4 attempts so a best AND worst can be dropped from the ones
  // in hand and still leave a middle to mean.
  if (attempts.length < 4) return undefined;
  const dnfCount = attempts.filter((a) => a.dnf).length;
  if (dnfCount >= 2) return null;
  const cs = attempts
    .filter((a) => !a.dnf)
    .map(attemptCs)
    .sort((a, b) => a - b);
  // one DNF is the worst (already excluded): drop only the best; else drop
  // best and worst of the valid times.
  const middle = dnfCount === 1 ? cs.slice(1) : cs.slice(1, -1);
  return Math.round(middle.reduce((s, t) => s + t, 0) / middle.length);
}

/**
 * Who you're up against: the real field for this exact event + round. Fetched
 * from the ranking endpoint (best-effort — the solving screen never blocks on
 * it). Shows field size, the advancement cut when the round advances, and the
 * fastest average as the benchmark.
 */
function UpAgainst({
  comp,
  event,
  round,
}: {
  comp: Competition;
  event: ClientEvent;
  round: RoundScrambleSet;
}) {
  const [ranking, setRanking] = useState<RankingData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!round.roundTypeId) return;
    let cancelled = false;
    setRanking(null);
    setFailed(false);
    getRanking(comp.id, round.roundTypeId, event.id)
      .then(({ ranking: r }) => {
        if (!cancelled) setRanking(r);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [comp.id, round.roundTypeId, event.id]);

  // Nothing to show yet (or the round has no published field): stay quiet
  // rather than render an empty shell.
  if (failed || !ranking || ranking.totalCompetitors === 0) return null;

  const fastest =
    ranking.fastestAverage != null
      ? formatCentiseconds(ranking.fastestAverage)
      : null;

  return (
    <div className="card up-against">
      <div className="up-against__head">
        <span className="eyebrow">Who you're up against</span>
        <span className="tertiary">
          {ranking.roundName ?? round.roundName ?? "This round"}
        </span>
      </div>
      <div className="up-against__stats">
        <div className="up-against__stat">
          <span className="up-against__num mono">{ranking.totalCompetitors}</span>
          <span className="tertiary">in the field</span>
        </div>
        {fastest && (
          <div className="up-against__stat">
            <span className="up-against__num mono accent">{fastest}</span>
            <span className="tertiary">fastest average</span>
          </div>
        )}
        {ranking.nextRound && (
          <div className="up-against__stat">
            <span className="up-against__num mono">
              {ranking.nextRound.advancedCount}
            </span>
            <span className="tertiary">
              advance to the {ranking.nextRound.roundName}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
