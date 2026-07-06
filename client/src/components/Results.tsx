import { useEffect, useState } from "react";
import { getRanking, type Competition, type RoundScrambleSet } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import {
  attemptCs,
  formatAttempt,
  formatCentiseconds,
  madeTheCut,
  ordinal,
  placeAverage,
  wcaAverageFromAttempts,
  type Attempt,
} from "../lib/cubing.ts";
import type { ClientEvent } from "../lib/events.ts";

/** Self-reported level buckets -> comparable cs ranges. */
const LEVEL_RANGES: Record<string, { name: string; lo: number; hi: number }> = {
  "sub-15": { name: "Fast", lo: 0, hi: 1500 },
  "15–25": { name: "Advanced", lo: 1500, hi: 2500 },
  "25–40": { name: "Intermediate", lo: 2500, hi: 4000 },
  "40–60": { name: "Improving", lo: 4000, hi: 6000 },
  "60+": { name: "Getting started", lo: 6000, hi: Infinity },
  // legacy bucket spellings from the first onboarding
  "Sub-15": { name: "Fast", lo: 0, hi: 1500 },
  "Over 60": { name: "Getting started", lo: 6000, hi: Infinity },
};

function levelContext(avgCs: number, bucket?: string): string | null {
  if (!bucket) return null;
  const range = LEVEL_RANGES[bucket];
  if (!range) return null;
  if (avgCs < range.lo)
    return `faster than the ${bucket}s you told us, so it may be time to update your level`;
  if (avgCs < range.hi) return `right in your ${bucket}s range`;
  return `above your ${bucket}s estimate, and that's normal: competition nerves are real, even in a simulation`;
}

/** Staggered entrance child (fade-up is the product's one reveal). */
function Rise({
  index,
  children,
  className = "",
}: {
  index: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rise${className ? ` ${className}` : ""}`}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      {children}
    </div>
  );
}

export function Results({
  comp,
  event,
  round,
  attempts,
  onRestart,
  onAdvance,
}: {
  comp: Competition;
  event: ClientEvent;
  round: RoundScrambleSet;
  attempts: Attempt[];
  onRestart: () => void;
  /** advance into the next round the user just qualified for */
  onAdvance: (roundTypeId: string, roundName: string) => void;
}) {
  const { user } = useAuth();

  // Mean of 3 keeps every attempt; average of 5 drops one best + one worst.
  const drops = event.format === "ao5";

  // Official average, DNF-aware (format-specific): null means the average is DNF.
  const avgCs = wcaAverageFromAttempts(attempts, event.format);
  const avgText = avgCs === null ? "DNF" : formatCentiseconds(avgCs);

  // Best/worst marking. Mo3 drops nothing, so it marks neither.
  const orderVals = attempts.map((a) => (a.dnf ? Infinity : attemptCs(a)));
  const bestIdx =
    avgCs === null || !drops ? -1 : orderVals.indexOf(Math.min(...orderVals));
  const worstIdx =
    avgCs === null || !drops
      ? -1
      : orderVals.lastIndexOf(Math.max(...orderVals));

  type Neighbor = { rank: number; name: string; averageCs: number };
  const [ranking, setRanking] = useState<{
    placement: number;
    total: number;
    fastestCs: number | null;
    /** top three of this round */
    podium: Neighbor[];
    /** up to 10 real competitors ranked immediately above the user (faster) */
    above: Neighbor[];
    /** up to 10 ranked immediately below (slower) */
    below: Neighbor[];
    /** whether the top-3 are already visible in `above` (avoid duplication) */
    podiumInWindow: boolean;
    nextRound: {
      roundTypeId: string;
      roundName: string;
      advancedCount: number;
      solvable?: boolean;
    } | null;
    /** did the user's placement make the next round's cut? */
    qualified: boolean | null;
  } | null>(null);
  const [rankError, setRankError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (avgCs === null) return; // a DNF average doesn't place
    let cancelled = false;
    setRankError(null);
    setRanking(null);
    if (!round.roundTypeId) {
      setRankError("round could not be identified");
      return;
    }
    getRanking(comp.id, round.roundTypeId, event.id)
      .then(({ ranking: r }) => {
        if (cancelled) return;
        if (r.totalCompetitors === 0) {
          setRankError("no official results are published for this round yet");
          return;
        }
        const averages = r.competitors.map((c) => c.averageCs);
        const { placement, total } = placeAverage(avgCs, averages, r.totalCompetitors);
        // The user slots in at index (placement - 1) among the valid field.
        // Real competitors [idx-10, idx) rank above; [idx, idx+10) below.
        const idx = placement - 1;
        const toNeighbor = (c: { name: string; averageCs: number }, i: number) => ({
          // ranks shift down by one below the user's inserted slot
          rank: i < idx ? i + 1 : i + 2,
          name: c.name,
          averageCs: c.averageCs,
        });
        const aboveStart = Math.max(0, idx - 10);
        const above = r.competitors
          .slice(aboveStart, idx)
          .map((c, k) => toNeighbor(c, aboveStart + k));
        const below = r.competitors
          .slice(idx, idx + 10)
          .map((c, k) => toNeighbor(c, idx + k));
        const podium = r.competitors
          .slice(0, 3)
          .map((c, k) => toNeighbor(c, k));
        // if the neighbor window already starts within the top 3, the podium
        // is redundant — don't show it twice
        const podiumInWindow = placement <= 3 || aboveStart < 3;
        const qualified = r.nextRound
          ? madeTheCut(placement, r.nextRound.advancedCount)
          : null;
        setRanking({
          placement,
          total,
          fastestCs: r.fastestAverage,
          podium,
          above,
          below,
          podiumInWindow,
          nextRound: r.nextRound,
          qualified,
        });
      })
      .catch((err) => {
        if (!cancelled)
          setRankError(err instanceof Error ? err.message : "Ranking unavailable");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comp.id, event.id, retryNonce]);

  // The self-reported level context is calibrated to 3x3 averages only, so it
  // is shown for 333 and omitted for every other event.
  const context =
    avgCs !== null && ranking && event.id === "333"
      ? levelContext(avgCs, user?.profile.avg333)
      : null;

  return (
    <div className="screen container results">
      <Rise index={0} className="results__head">
        <span className="eyebrow">Your result</span>
        <div className="avg-mask" aria-label={`Average ${avgText}`}>
          <div className="results__avg mono avg-rise">{avgText}</div>
        </div>
        <p className="muted results__avg-label">
          {avgCs === null
            ? `WCA ${event.formatName}: DNF`
            : `WCA ${event.formatName}`}
        </p>
      </Rise>

      <Rise index={1} className="results__rank-wrap">
        <div className="card results__rank">
          {avgCs === null && (
            <p className="results__rank-line">
              {drops
                ? "Two or more DNFs make the average itself a DNF, and in an official round that wouldn't place."
                : "In a mean of 3 a single DNF makes the whole mean a DNF, and in an official round that wouldn't place."}{" "}
              Solve the round again and keep it clean.
            </p>
          )}
          {avgCs !== null && !ranking && !rankError && (
            <div className="state-center">
              <div className="spinner" />
            </div>
          )}
          {avgCs !== null && rankError && (
            <div className="results__rank-error">
              <p className="muted">
                Couldn't place you ({rankError}). Your average is still{" "}
                {avgText}.
              </p>
              <button
                className="btn btn--secondary results__retry"
                onClick={() => setRetryNonce((n) => n + 1)}
              >
                Try again
              </button>
            </div>
          )}
          {avgCs !== null && ranking && (
            <>
              <p className="results__rank-line">
                Your average of <strong className="mono">{avgText}</strong>{" "}
                would have placed{" "}
                <strong className="accent mono">
                  {ordinal(ranking.placement)}
                </strong>{" "}
                of <strong className="mono">{ranking.total}</strong>
              </p>
              <p className="muted results__rank-sub">
                {round.roundName ?? "First round"} of {event.display} at {comp.name}
                {ranking.fastestCs != null && (
                  <> · winner averaged {formatCentiseconds(ranking.fastestCs)}</>
                )}
              </p>
              <p className="tertiary results__context">
                Top {Math.max(1, Math.ceil((ranking.placement / ranking.total) * 100))}%
                of the field{context && <> · {context}</>}
              </p>
            </>
          )}
        </div>
      </Rise>

      {/* did you make the cut for the next round? */}
      {ranking?.nextRound && (
        <Rise index={2}>
          <div
            className={`card cut${ranking.qualified ? " cut--in" : " cut--out"}`}
          >
            <span className="cut__badge">
              {ranking.qualified ? "You'd have advanced" : "You'd have missed the cut"}
            </span>
            <p className="cut__line">
              The top <strong className="mono">{ranking.nextRound.advancedCount}</strong>{" "}
              of {ranking.total} went through to the {ranking.nextRound.roundName}.{" "}
              {ranking.qualified
                ? `Your ${ordinal(ranking.placement)} would have made it.`
                : `Your ${ordinal(ranking.placement)} would have fallen ${ranking.placement - ranking.nextRound.advancedCount} short.`}
            </p>
            {ranking.qualified && ranking.nextRound.solvable && (
              <button
                className="btn cut__advance"
                onClick={() =>
                  onAdvance(
                    ranking.nextRound!.roundTypeId,
                    ranking.nextRound!.roundName,
                  )
                }
              >
                Simulate the {ranking.nextRound.roundName}{" "}
                <span className="arrow">→</span>
              </button>
            )}
            {ranking.qualified && !ranking.nextRound.solvable && (
              <p className="tertiary cut__note">
                The {ranking.nextRound.roundName}'s scrambles weren't uploaded to
                the WCA, so it can't be simulated.
              </p>
            )}
          </div>
        </Rise>
      )}
      {ranking && !ranking.nextRound && (
        <Rise index={2}>
          <div className="card cut cut--final">
            <span className="cut__badge">The final</span>
            <p className="cut__line">
              This was the last round, so your {ordinal(ranking.placement)} of{" "}
              {ranking.total} would have been your finishing position.
            </p>
          </div>
        </Rise>
      )}

      {ranking && (ranking.above.length > 0 || ranking.below.length > 0) && (
        <Rise index={3} className="results__board-wrap">
          <div className="card board">
            {!ranking.podiumInWindow && ranking.podium.length > 0 && (
              <>
                <div className="board__head">
                  <span className="eyebrow">Round podium</span>
                </div>
                <div className="board__rows board__rows--podium">
                  {ranking.podium.map((n) => (
                    <div className="board__row" key={`p-${n.rank}`}>
                      <span className="board__rank mono">{ordinal(n.rank)}</span>
                      <span className="board__name">{n.name}</span>
                      <span className="board__time mono">
                        {formatCentiseconds(n.averageCs)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="board__divider" />
              </>
            )}
            <div className="board__head">
              <span className="eyebrow">Where you'd slot in</span>
              <span className="tertiary board__sub">
                Real competitors around your average
              </span>
            </div>
            <div className="board__rows">
              {ranking.above.map((n) => (
                <div className="board__row" key={`a-${n.rank}`}>
                  <span className="board__rank mono">{ordinal(n.rank)}</span>
                  <span className="board__name">{n.name}</span>
                  <span className="board__time mono">
                    {formatCentiseconds(n.averageCs)}
                  </span>
                </div>
              ))}
              <div className="board__row board__row--you">
                <span className="board__rank mono">{ordinal(ranking.placement)}</span>
                <span className="board__name">You</span>
                <span className="board__time mono">{avgText}</span>
              </div>
              {ranking.below.map((n) => (
                <div className="board__row" key={`b-${n.rank}`}>
                  <span className="board__rank mono">{ordinal(n.rank)}</span>
                  <span className="board__name">{n.name}</span>
                  <span className="board__time mono">
                    {formatCentiseconds(n.averageCs)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Rise>
      )}

      <Rise index={4}>
        <div className="results__solves">
          {attempts.map((a, i) => {
            const dropped = i === bestIdx || i === worstIdx;
            return (
              <div
                key={i}
                className={`solve-pill${dropped ? " is-dropped" : ""}${a.dnf ? " is-dnf" : ""}`}
              >
                <span className="tertiary">{i + 1}</span>
                <span className="mono">{formatAttempt(a)}</span>
                {i === bestIdx && <span className="solve-pill__tag">best</span>}
                {i === worstIdx && <span className="solve-pill__tag">worst</span>}
              </div>
            );
          })}
        </div>
      </Rise>

      <Rise index={5}>
        <p className="tertiary results__drop-note">
          {drops
            ? "Best and worst are dropped. The average is the mean of the middle three."
            : "Nothing is dropped. The result is the mean of all three solves."}
          {attempts.some((a) => a.plus2 && !a.dnf) &&
            " A “+” marks a +2 penalty."}
          {drops && attempts.some((a) => a.dnf) &&
            " A DNF counts as the worst attempt."}
          {!drops && attempts.some((a) => a.dnf) &&
            " A single DNF makes the mean a DNF."}
        </p>
      </Rise>

      <Rise index={6}>
        <button className="btn btn--secondary" onClick={onRestart}>
          Try another competition
        </button>
      </Rise>
    </div>
  );
}
