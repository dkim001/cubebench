import { useCallback, useEffect, useState } from "react";
import { SolveTimer } from "../components/SolveTimer.tsx";
import { nextScramble, warmUp } from "../lib/scrambles.ts";
import { store } from "../lib/store.ts";
import {
  formatMs,
  stageBreakdown,
  STAGE_LABEL,
  STAGE_ORDER,
  type Solve,
} from "../lib/cubing.ts";

/**
 * Skill Timer: unlimited stage-split practice. Spacebar taps mark the end of
 * each stage (cross, F2L, OLL, PLL); every solve adds to a running session
 * summary showing where the time is going. Scrambles are proper random-state
 * 3x3 scrambles from cubing.js.
 */
const INTRO_SEEN_KEY = "cb_skill_intro_seen";
const SESSION_KEY = "cb_skill_session_v1";

export default function SkillTimer() {
  const [scramble, setScramble] = useState<string | null>(null);
  const [scrambleError, setScrambleError] = useState<string | null>(null);
  // The session survives navigation and refresh — practice shouldn't
  // evaporate because you glanced at Pricing.
  const [solves, setSolves] = useState<Solve[]>(
    () => store.getJson<Solve[]>(SESSION_KEY) ?? [],
  );
  // First visit: explain what the Skill Timer is before the timer takes over.
  const [showIntro, setShowIntro] = useState(
    () => store.get(INTRO_SEEN_KEY) !== "1",
  );

  function dismissIntro() {
    store.set(INTRO_SEEN_KEY, "1");
    setShowIntro(false);
  }

  const loadScramble = useCallback(() => {
    setScramble(null);
    setScrambleError(null);
    nextScramble()
      .then(setScramble)
      .catch((err) =>
        setScrambleError(
          err instanceof Error ? err.message : "Could not generate a scramble",
        ),
      );
  }, []);

  useEffect(() => {
    warmUp();
    loadScramble();
  }, [loadScramble]);

  function handleComplete(solve: Solve) {
    setSolves((prev) => {
      const next = [...prev, solve];
      store.setJson(SESSION_KEY, next);
      return next;
    });
    loadScramble();
  }

  function resetSession() {
    if (
      solves.length > 0 &&
      !window.confirm(
        `Reset this session? Your ${solves.length} solve${solves.length === 1 ? "" : "s"} will be cleared.`,
      )
    ) {
      return;
    }
    store.remove(SESSION_KEY);
    setSolves([]);
  }

  const summary = solves.length > 0 ? sessionSummary(solves) : null;

  if (showIntro) {
    return (
      <div className="screen container container--gate skill-intro">
        <span className="eyebrow">Skill Timer</span>
        <h1 className="title">Find out where your solve is slow.</h1>
        <p className="muted gate__sub">
          The Skill Timer times every stage of your solve separately. One tap
          of the spacebar at the end of each stage splits your solve into its
          four phases:
        </p>
        <ol className="stage-list">
          {(
            [
              ["1", "Cross", "your first four edges"],
              ["2", "F2L", "first two layers"],
              ["3", "OLL", "orienting the last layer"],
              ["4", "PLL", "permuting the last layer, and the solve is done"],
            ] as const
          ).map(([n, name, desc]) => (
            <li className="stage-list__row" key={n}>
              <span className="stage-list__n mono" aria-hidden="true">
                {n}
              </span>
              <span className="stage-list__name">{name}</span>
              <span className="muted stage-list__desc">{desc}</span>
            </li>
          ))}
        </ol>
        <p className="muted gate__sub">
          Solve as much as you like. The session summary shows which stage is
          eating the biggest share of your time. Scrambles are random-state,
          the same kind you'd get in an official round.
        </p>
        <button className="btn" onClick={dismissIntro} autoFocus>
          Got it, start practicing
        </button>
      </div>
    );
  }

  return (
    <div className="screen container skill">
      {scramble && (
        <SolveTimer
          scramble={scramble}
          solveNumber={solves.length + 1}
          onComplete={handleComplete}
        />
      )}

      {!scramble && !scrambleError && (
        <div className="skill__loading">
          <div className="spinner" />
          <p className="muted">Generating a random-state scramble…</p>
        </div>
      )}

      {scrambleError && (
        <div className="skill__loading">
          <p className="muted">Scramble generation failed: {scrambleError}</p>
          <button className="btn btn--secondary" onClick={loadScramble}>
            Try again
          </button>
        </div>
      )}

      {summary && (
        <div className="card session">
          <div className="session__head">
            <h3 className="session__title">This session</h3>
            <button className="btn--ghost btn session__reset" onClick={resetSession}>
              Reset
            </button>
          </div>

          <div className="session__stats">
            <div className="session__stat">
              <span className="session__stat-label">Solves</span>
              <span className="session__stat-value mono">{solves.length}</span>
            </div>
            <div className="session__stat">
              <span className="session__stat-label">Average</span>
              <span className="session__stat-value mono">
                {formatMs(summary.meanMs)}
              </span>
            </div>
            <div className="session__stat">
              <span className="session__stat-label">Best</span>
              <span className="session__stat-value mono">
                {formatMs(summary.bestMs)}
              </span>
            </div>
            <div className="session__stat">
              <span className="session__stat-label">Focus on</span>
              <span className="session__stat-value">
                {STAGE_LABEL[summary.breakdown.slowest]}{" "}
                <span className="muted mono session__pct">
                  {Math.round(summary.breakdown.slowestShare * 100)}%
                </span>
              </span>
            </div>
          </div>

          <div className="breakdown__bars">
            {STAGE_ORDER.map((key) => {
              const share = summary.breakdown.grandTotalMs
                ? summary.breakdown.totals[key] / summary.breakdown.grandTotalMs
                : 0;
              return (
                <div key={key} className="breakdown__row">
                  <span className="breakdown__label">{STAGE_LABEL[key]}</span>
                  <div className="breakdown__track">
                    <div
                      className={`breakdown__fill${key === summary.breakdown.slowest ? " is-slowest" : ""}`}
                      style={{ width: `${Math.max(share * 100, 1.5)}%` }}
                    />
                  </div>
                  <span className="breakdown__pct mono">
                    {Math.round(share * 100)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function sessionSummary(solves: Solve[]) {
  const totals = solves.map((s) => s.totalMs);
  return {
    meanMs: totals.reduce((a, b) => a + b, 0) / totals.length,
    bestMs: Math.min(...totals),
    breakdown: stageBreakdown(solves),
  };
}
