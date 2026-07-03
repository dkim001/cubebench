import { useState } from "react";
import type { Competition, RoundScrambleSet } from "../lib/api.ts";
import type { Attempt } from "../lib/cubing.ts";
import { CompetitionPicker } from "../components/CompetitionPicker.tsx";
import { Solving } from "../components/Solving.tsx";
import { Results } from "../components/Results.tsx";

type Step = "picking" | "solving" | "results";

/**
 * Competition Simulator: pick a real WCA competition, do the 5 first-round
 * 3x3 solves on its real scrambles, see your Ao5 and where it would have
 * placed against the real field.
 */
export default function Simulator() {
  const [step, setStep] = useState<Step>("picking");
  const [comp, setComp] = useState<Competition | null>(null);
  const [round, setRound] = useState<RoundScrambleSet | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);

  function reset() {
    setComp(null);
    setRound(null);
    setAttempts([]);
    setStep("picking");
  }

  return (
    <>
      {step === "picking" && (
        <CompetitionPicker
          onProceed={(c, r) => {
            setComp(c);
            setRound(r);
            setAttempts([]);
            setStep("solving");
          }}
        />
      )}

      {step === "solving" && round?.scrambles && (
        <Solving
          scrambles={round.scrambles}
          onCancel={() => setStep("picking")}
          onFinish={(a) => {
            setAttempts(a);
            setStep("results");
          }}
        />
      )}

      {step === "results" && comp && round && attempts.length === 5 && (
        <Results comp={comp} round={round} attempts={attempts} onRestart={reset} />
      )}
    </>
  );
}
