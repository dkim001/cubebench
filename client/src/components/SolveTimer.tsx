import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatMs,
  STAGE_LABEL,
  STAGE_ORDER,
  type Solve,
  type StageKey,
} from "../lib/cubing.ts";
import { isTouchDevice } from "../lib/pointer.ts";
import { CubeImage } from "./CubeImage.tsx";

type Phase = "ready" | "running" | "done";

/**
 * One stage-split practice solve. The spacebar drives everything:
 *   press 1  -> start
 *   press 2  -> end of Cross
 *   press 3  -> end of F2L
 *   press 4  -> end of OLL
 *   press 5  -> end of solve (after PLL)
 * That yields four stage durations plus the total. Key auto-repeat is ignored
 * so holding the bar doesn't fire multiple splits. Taps on the timer area do
 * the same on touch devices.
 */
export function SolveTimer({
  scramble,
  solveNumber,
  onComplete,
}: {
  scramble: string;
  /** 1-based position in the practice session, purely for display */
  solveNumber: number;
  onComplete: (solve: Solve) => void;
}) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [elapsed, setElapsed] = useState(0);
  // Phrase instructions for the device in hand ("tap" vs "space").
  const [touch] = useState(isTouchDevice);
  // timestamps (performance.now): [start, endCross, endF2L, endOLL, endSolve]
  const stampsRef = useRef<number[]>([]);
  const [pressCount, setPressCount] = useState(0);
  const rafRef = useRef<number | null>(null);
  const finishedRef = useRef<Solve | null>(null);

  const stopRaf = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  // Reset for a new solve.
  useEffect(() => {
    stampsRef.current = [];
    finishedRef.current = null;
    setPhase("ready");
    setElapsed(0);
    setPressCount(0);
    return stopRaf;
  }, [solveNumber, scramble]);

  const tick = useCallback(() => {
    const start = stampsRef.current[0];
    if (start != null) setElapsed(performance.now() - start);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const handlePress = useCallback(() => {
    const now = performance.now();
    const stamps = stampsRef.current;

    if (phase === "ready") {
      stampsRef.current = [now];
      setPressCount(1);
      setPhase("running");
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    if (phase === "running") {
      stamps.push(now);
      setPressCount(stamps.length);

      if (stamps.length === 5) {
        stopRaf();
        const [s0, s1, s2, s3, s4] = stamps;
        const solve: Solve = {
          stages: {
            cross: s1 - s0,
            f2l: s2 - s1,
            oll: s3 - s2,
            pll: s4 - s3,
          },
          totalMs: s4 - s0,
        };
        finishedRef.current = solve;
        setElapsed(solve.totalMs);
        setPhase("done");
      }
    }
  }, [phase, tick]);

  // Global spacebar listener. Rebinds when the handler identity changes.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      if (e.repeat) return; // ignore auto-repeat while held
      e.preventDefault();
      handlePress();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlePress]);

  // Derived: durations of already-completed stages this solve.
  const completed: number[] = [];
  for (let i = 1; i < pressCount; i++) {
    completed.push(stampsRef.current[i] - stampsRef.current[i - 1]);
  }
  const activeStageIdx = phase === "running" ? pressCount - 1 : -1;

  return (
    <div className="solve">
      <div className="solve__head">
        <span className="eyebrow">Solve {solveNumber}</span>
        <div className="solve__scramble mono">{scramble}</div>
      </div>

      <div className="solve__cube">
        <CubeImage scramble={scramble} />
      </div>

      <div
        className={`timer-zone timer-zone--${phase === "running" ? "running" : phase}`}
        onPointerDown={() => handlePress()}
      >
        <div className={`timer timer--${phase}`}>
          <div className="timer__time mono">{formatMs(elapsed)}</div>
          <div className="timer__hint" role="status" aria-live="polite">
            {phase === "ready" &&
              (touch
                ? "Tap to start, then tap at the end of each stage"
                : "Space (or tap) to start, then again at the end of each stage")}
            {phase === "running" &&
              activeStageIdx >= 0 &&
              activeStageIdx < STAGE_ORDER.length &&
              `Timing ${STAGE_LABEL[STAGE_ORDER[activeStageIdx]]}. ${touch ? "Tap" : "Space"} at the end of ${STAGE_LABEL[STAGE_ORDER[activeStageIdx]]}.`}
            {phase === "done" && "Solve complete"}
          </div>
        </div>
      </div>

      <div className="stages">
        {STAGE_ORDER.map((key: StageKey, i) => {
          const done = i < completed.length;
          const active = i === activeStageIdx;
          return (
            <div
              key={key}
              className={`stage-chip${done ? " is-done" : ""}${active ? " is-active" : ""}`}
            >
              <span className="stage-chip__label">{STAGE_LABEL[key]}</span>
              <span className="stage-chip__value mono">
                {done ? formatMs(completed[i]) : "–"}
              </span>
            </div>
          );
        })}
      </div>

      {phase === "done" && finishedRef.current && (
        <button
          className="btn"
          onClick={() => onComplete(finishedRef.current!)}
          autoFocus
        >
          Next scramble
        </button>
      )}
    </div>
  );
}
