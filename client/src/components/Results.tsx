import { useEffect, useState } from "react";
import { getRanking, type Competition, type RoundScrambleSet } from "../lib/api.ts";
import {
  attemptCs,
  formatAttempt,
  formatCentiseconds,
  ordinal,
  placeAverage,
  wcaAo5Cs,
  type Attempt,
} from "../lib/cubing.ts";

export function Results({
  comp,
  round,
  attempts,
  onRestart,
}: {
  comp: Competition;
  round: RoundScrambleSet;
  attempts: Attempt[];
  onRestart: () => void;
}) {
  // Official times in centiseconds (like every WCA result): each attempt is
  // quantized first, then best/worst selection and the average run in cs, so
  // the displayed average always agrees with the displayed attempt times and
  // with how the official averages we rank against were computed.
  const totalsCs = attempts.map(attemptCs);
  const avgCs = wcaAo5Cs(totalsCs);

  const min = Math.min(...totalsCs);
  const max = Math.max(...totalsCs);
  const bestIdx = totalsCs.indexOf(min);
  const worstIdx = totalsCs.lastIndexOf(max);
  const avgText = formatCentiseconds(avgCs);

  const [ranking, setRanking] = useState<{
    placement: number;
    total: number;
    fastestCs: number | null;
  } | null>(null);
  const [rankError, setRankError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // The round code comes from the server's round-type identification; if it
    // is somehow missing we surface that instead of guessing a code.
    if (!round.roundTypeId) {
      setRankError("round could not be identified");
      return;
    }
    getRanking(comp.id, round.roundTypeId)
      .then(({ ranking: r }) => {
        if (cancelled) return;
        const { placement, total } = placeAverage(
          avgCs,
          r.averagesAsc,
          r.totalCompetitors,
        );
        setRanking({ placement, total, fastestCs: r.fastestAverage });
      })
      .catch((err) => {
        if (!cancelled)
          setRankError(err instanceof Error ? err.message : "Ranking unavailable");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comp.id]);

  return (
    <div className="screen container results">
      <div className="results__head">
        <span className="eyebrow">Your result</span>
        <div className="results__avg mono">{avgText}</div>
        <p className="muted results__avg-label">WCA average of 5</p>
      </div>

      <div className="card results__rank">
        {!ranking && !rankError && (
          <div className="picker__state">
            <div className="spinner" />
          </div>
        )}
        {rankError && (
          <p className="muted">
            Couldn't load the field for this round ({rankError}). Your average is
            still {avgText}.
          </p>
        )}
        {ranking && (
          <>
            <p className="results__rank-line">
              Your average of <strong className="mono">{avgText}</strong> would
              have placed{" "}
              <strong className="accent mono">{ordinal(ranking.placement)}</strong>{" "}
              of <strong className="mono">{ranking.total}</strong>
            </p>
            <p className="muted results__rank-sub">
              {round.roundName ?? "First round"} of 3×3 at {comp.name}
              {ranking.fastestCs != null && (
                <> · winner averaged {formatCentiseconds(ranking.fastestCs)}</>
              )}
            </p>
          </>
        )}
      </div>

      <div className="results__solves">
        {attempts.map((a, i) => {
          const dropped = i === bestIdx || i === worstIdx;
          return (
            <div key={i} className={`solve-pill${dropped ? " is-dropped" : ""}`}>
              <span className="tertiary">{i + 1}</span>
              <span className="mono">{formatAttempt(a)}</span>
              {i === bestIdx && <span className="solve-pill__tag">best</span>}
              {i === worstIdx && <span className="solve-pill__tag">worst</span>}
            </div>
          );
        })}
      </div>
      <p className="tertiary results__drop-note">
        Best and worst are dropped — the average is the mean of the middle three.
        {attempts.some((a) => a.plus2) && " A “+” marks a +2 for late inspection."}
      </p>

      <button className="btn btn--secondary" onClick={onRestart}>
        Try another competition
      </button>
    </div>
  );
}
