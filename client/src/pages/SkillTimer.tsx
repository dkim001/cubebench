import { useCallback, useEffect, useState } from "react";
import { SolveTimer } from "../components/SolveTimer.tsx";
import { nextScramble, warmUp } from "../lib/scrambles.ts";
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

export default function SkillTimer() {
  const [scramble, setScramble] = useState<string | null>(null);
  const [scrambleError, setScrambleError] = useState<string | null>(null);
  const [solves, setSolves] = useState<Solve[]>([]);
  // First visit: explain what the Skill Timer is before the timer takes over.
  const [showIntro, setShowIntro] = useState(
    () => localStorage.getItem(INTRO_SEEN_KEY) !== "1",
  );

  function dismissIntro() {
    localStorage.setItem(INTRO_SEEN_KEY, "1");
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
    setSolves((prev) => [...prev, solve]);
    loadScramble();
  }

  function resetSession() {
    setSolves([]);
  }

  const summary = solves.length > 0 ? sessionSummary(solves) : null;

  if (showIntro) {
    return (
      <div className="screen container container--gate skill-intro">
        <span className="eyebrow">Skill Timer</span>
        <h1 className="title">Find out where your solve is slow.</h1>
        <p className="muted onboard__lead">
          The Skill Timer is a practice tool that times each part of your
          solve, not just the total. One tap of the spacebar at the end of
          each stage splits your solve into its four phases:
        </p>
        <ol className="steps">
          <li>
            <span className="steps__n">1</span>
            <span>
              <strong>Cross</strong> — your first four edges
            </span>
          </li>
          <li>
            <span className="steps__n">2</span>
            <span>
              <strong>F2L</strong> — first two layers
            </span>
          </li>
          <li>
            <span className="steps__n">3</span>
            <span>
              <strong>OLL</strong> — orienting the last layer
            </span>
          </li>
          <li>
            <span className="steps__n">4</span>
            <span>
              <strong>PLL</strong> — permuting the last layer, solve done
            </span>
          </li>
        </ol>
        <p className="muted onboard__lead">
          Solve as much as you like — the session summary adds it up and shows
          which stage is eating the biggest share of your time. Scrambles are
          proper random-state practice scrambles.
        </p>
        <button className="btn" onClick={dismissIntro} autoFocus>
          Got it — start practicing
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
