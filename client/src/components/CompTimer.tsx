import { useCallback, useEffect, useRef, useState } from "react";
import { formatMs, type Attempt } from "../lib/cubing.ts";
import { isTouchDevice } from "../lib/pointer.ts";
import { CubeImage } from "./CubeImage.tsx";

/**
 * Competition timer following standard cubing (csTimer) conventions:
 *
 *   idle        — scramble shown. Space (or tap) starts inspection.
 *   inspection  — 15s WCA inspection counts down. Hold spacebar: the time
 *                 turns red; after HOLD_TO_ARM_MS it turns green (armed).
 *                 RELEASE to start the solve. Releasing early cancels back
 *                 to inspection, which keeps counting.
 *   running     — any key (or tap) stops.
 *   done        — result shown; penalty applied if the solve started more
 *                 than 15.00s after inspection began (+2, kept simple: no
 *                 DNF tier).
 *
 * Touch drives the same machine: tap = start inspection, press-and-hold +
 * release = arm/start, tap while running = stop.
 */

const INSPECTION_MS = 15_000;
const HOLD_TO_ARM_MS = 550;

type Phase = "idle" | "inspection" | "running" | "done";

export function CompTimer({
  scramble,
  solveIndex,
  totalSolves,
  onComplete,
}: {
  scramble: string;
  solveIndex: number;
  totalSolves: number;
  onComplete: (attempt: Attempt) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  /** 15, 14, … seconds remaining; negative means over (penalty zone) */
  const [inspectionLeft, setInspectionLeft] = useState(15);
  /** mirrors the exact penalty test (strictly > 15.00s), for the display */
  const [overInspection, setOverInspection] = useState(false);
  const [holdState, setHoldState] = useState<"none" | "holding" | "armed">(
    "none",
  );
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<Attempt | null>(null);
  // Phrase instructions for the device in hand ("tap" vs "space").
  const [touch] = useState(isTouchDevice);

  const inspectionStartRef = useRef<number | null>(null);
  const solveStartRef = useRef<number | null>(null);
  const penaltyRef = useRef(false);
  /** when the current spacebar/touch hold began; null when not holding */
  const holdStartAtRef = useRef<number | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);
  // Set when the running timer is stopped by a keydown, so the paired keyup
  // isn't misread as a "release to start" in some later state.
  const spaceIsDownRef = useRef(false);
  /** when the solve was stopped — guards the just-pressed/held stop key from
   *  immediately activating the autofocused "Next solve" button */
  const stoppedAtRef = useRef(0);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const clearHoldTimer = () => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
  };
  const stopRaf = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  // Full reset when the scramble/solve changes.
  useEffect(() => {
    setPhase("idle");
    setInspectionLeft(15);
    setOverInspection(false);
    setHoldState("none");
    setElapsed(0);
    setResult(null);
    inspectionStartRef.current = null;
    solveStartRef.current = null;
    penaltyRef.current = false;
    spaceIsDownRef.current = false;
    holdStartAtRef.current = null;
    return () => {
      clearHoldTimer();
      stopRaf();
    };
  }, [solveIndex, scramble]);

  // Inspection countdown ticker (also runs while holding/armed).
  useEffect(() => {
    if (phase !== "inspection") return;
    const id = setInterval(() => {
      const start = inspectionStartRef.current;
      if (start == null) return;
      const elapsed = performance.now() - start;
      setInspectionLeft(Math.ceil((INSPECTION_MS - elapsed) / 1000));
      // Same strict comparison the penalty itself uses at solve start.
      setOverInspection(elapsed > INSPECTION_MS);
    }, 100);
    return () => clearInterval(id);
  }, [phase]);

  // Running stopwatch display.
  const tick = useCallback(() => {
    const start = solveStartRef.current;
    if (start != null) setElapsed(performance.now() - start);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  // ---- transitions ----

  const beginInspection = useCallback(() => {
    inspectionStartRef.current = performance.now();
    setInspectionLeft(15);
    setPhase("inspection");
  }, []);

  const beginHold = useCallback(() => {
    holdStartAtRef.current = performance.now();
    setHoldState("holding");
    // The timeout only drives the red->green visual. The actual decision is
    // made at release time from the real held duration, so a throttled or
    // late timer can never swallow a legitimate start.
    clearHoldTimer();
    holdTimerRef.current = setTimeout(() => {
      setHoldState("armed");
    }, HOLD_TO_ARM_MS);
  }, []);

  const releaseHold = useCallback(() => {
    clearHoldTimer();
    const heldFor =
      holdStartAtRef.current != null
        ? performance.now() - holdStartAtRef.current
        : 0;
    holdStartAtRef.current = null;
    if (heldFor >= HOLD_TO_ARM_MS) {
      // Start the solve. Penalty decided at this exact moment.
      const now = performance.now();
      const inspStart = inspectionStartRef.current ?? now;
      penaltyRef.current = now - inspStart > INSPECTION_MS;
      solveStartRef.current = now;
      setHoldState("none");
      setElapsed(0);
      setPhase("running");
      rafRef.current = requestAnimationFrame(tick);
    } else {
      // Released before armed — back to inspection (still counting).
      setHoldState("none");
    }
  }, [tick]);

  const stopSolve = useCallback(() => {
    const start = solveStartRef.current;
    if (start == null) return;
    stopRaf();
    const now = performance.now();
    stoppedAtRef.current = now;
    const rawMs = now - start;
    const attempt: Attempt = { rawMs, plus2: penaltyRef.current };
    setElapsed(rawMs);
    setResult(attempt);
    setPhase("done");
  }, []);

  // ---- keyboard ----

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const p = phaseRef.current;
      if (p === "running") {
        e.preventDefault();
        if (e.repeat) return;
        stopSolve();
        return;
      }
      if (p === "done") {
        // Swallow auto-repeat of the held stop key (and any press within a
        // short grace window) so it can't click the autofocused Next button.
        if (e.repeat || performance.now() - stoppedAtRef.current < 400) {
          e.preventDefault();
        }
        return;
      }
      if (e.code !== "Space" && e.key !== " ") return;
      e.preventDefault(); // keep space from scrolling / clicking
      if (e.repeat) return;
      spaceIsDownRef.current = true;
      if (p === "idle") beginInspection();
      else if (p === "inspection") beginHold();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      if (!spaceIsDownRef.current) return; // stray keyup (e.g. after a stop)
      spaceIsDownRef.current = false;
      if (phaseRef.current === "inspection") releaseHold();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [beginInspection, beginHold, releaseHold, stopSolve]);

  // ---- touch / pointer on the timer zone ----

  const onZonePointerDown = useCallback(() => {
    const p = phaseRef.current;
    if (p === "running") stopSolve();
    else if (p === "inspection") beginHold();
  }, [beginHold, stopSolve]);

  const onZonePointerUp = useCallback(() => {
    const p = phaseRef.current;
    if (p === "idle") beginInspection(); // tap-to-begin fires on release
    else if (p === "inspection") releaseHold();
  }, [beginInspection, releaseHold]);

  // A hold that never completes (finger slides off, gesture canceled) must
  // cancel cleanly back to inspection instead of sticking in holding/armed.
  const onZonePointerCancel = useCallback(() => {
    if (phaseRef.current !== "inspection") return;
    clearHoldTimer();
    holdStartAtRef.current = null;
    setHoldState("none");
  }, []);

  // ---- render ----

  const timeClass =
    holdState === "armed"
      ? " is-armed"
      : holdState === "holding"
        ? " is-holding"
        : "";

  const isLast = solveIndex === totalSolves - 1;

  return (
    <div className="solve">
      <div className="solve__head">
        <span className="eyebrow">
          Solve {solveIndex + 1} of {totalSolves}
        </span>
        <div className="solve__scramble mono">{scramble}</div>
      </div>

      {phase === "idle" && (
        <div className="solve__cube">
          <CubeImage scramble={scramble} />
        </div>
      )}

      <div
        className={`timer-zone timer-zone--${phase}`}
        onPointerDown={onZonePointerDown}
        onPointerUp={onZonePointerUp}
        onPointerCancel={onZonePointerCancel}
        onPointerLeave={onZonePointerCancel}
      >
        {phase === "idle" && (
          <div className="timer">
            <div className="timer__time mono">0.00</div>
            <div className="timer__hint">
              {touch
                ? "Tap to start inspection — you get 15 seconds, like a real round"
                : "Press space to start inspection — you get 15 seconds, like a real round"}
            </div>
          </div>
        )}

        {phase === "inspection" && (
          <div className="timer">
            <div
              className={`timer__time mono inspection__count${overInspection ? " is-over" : ""}${timeClass}`}
            >
              {holdState !== "none"
                ? "0.00"
                : overInspection
                  ? "+2"
                  : inspectionLeft}
            </div>
            <div className="timer__hint">
              {holdState === "armed"
                ? "Release to start"
                : holdState === "holding"
                  ? "Keep holding…"
                  : overInspection
                    ? `Over 15s — this solve is +2. ${touch ? "Press and hold" : "Hold space"}, release to start.`
                    : `Inspecting — ${touch ? "press and hold" : "hold space"}, then release to start`}
            </div>
          </div>
        )}

        {phase === "running" && (
          <div className="timer timer--running">
            <div className="timer__time mono">{formatMs(elapsed)}</div>
            <div className="timer__hint">
              {touch ? "Tap to stop" : "Any key to stop"}
            </div>
          </div>
        )}

        {phase === "done" && result && (
          <div className="timer timer--done">
            <div className="timer__time mono">{formatMs(result.rawMs)}</div>
            <div className="timer__hint">
              {result.plus2
                ? `Started after 15s — +2 penalty, counts as ${formatMs(result.rawMs + 2000)}`
                : "Solve complete"}
            </div>
          </div>
        )}
      </div>

      {phase === "done" && result && (
        <button className="btn" onClick={() => onComplete(result)} autoFocus>
          {isLast ? "See your ranking" : "Next solve"}
        </button>
      )}
    </div>
  );
}
