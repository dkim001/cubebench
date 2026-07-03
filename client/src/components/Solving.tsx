import { useState } from "react";
import type { Attempt } from "../lib/cubing.ts";
import { CompTimer } from "./CompTimer.tsx";

/**
 * Sequences the five attempts of the simulated round. Each CompTimer is keyed
 * by index so it fully resets (inspection included) between solves.
 */
export function Solving({
  scrambles,
  onFinish,
  onCancel,
}: {
  scrambles: string[];
  onFinish: (attempts: Attempt[]) => void;
  onCancel: () => void;
}) {
  const solveScrambles = scrambles.slice(0, 5);
  const total = solveScrambles.length;
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const index = attempts.length;

  function handleComplete(attempt: Attempt) {
    const next = [...attempts, attempt];
    if (next.length >= total) onFinish(next);
    else setAttempts(next);
  }

  return (
    <div className="screen container solving">
      <div className="solving__bar">
        <button className="btn--ghost btn" onClick={onCancel}>
          ‹ Back
        </button>
        <div className="solving__dots">
          {solveScrambles.map((_, i) => (
            <span
              key={i}
              className={`dot${i < index ? " is-done" : ""}${i === index ? " is-current" : ""}`}
            />
          ))}
        </div>
        <div className="solving__spacer" />
      </div>

      <CompTimer
        key={index}
        scramble={solveScrambles[index]}
        solveIndex={index}
        totalSolves={total}
        onComplete={handleComplete}
      />
    </div>
  );
}
