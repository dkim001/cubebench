import { useEffect, useRef, useState } from "react";
import {
  getRound,
  type Competition,
  type RoundMeta,
  type RoundScrambleSet,
} from "../lib/api.ts";
import type { Attempt } from "../lib/cubing.ts";
import { store } from "../lib/store.ts";
import { CompetitionPicker } from "../components/CompetitionPicker.tsx";
import { Solving } from "../components/Solving.tsx";
import { Results } from "../components/Results.tsx";
import { Mark } from "../components/Mark.tsx";

type Step =
  | "picking"
  | "rounds"
  | "loadingRound"
  | "solving"
  | "results"
  | "qualified";

const ROUND_KEY = "cb_round_v1";

type SavedRound = {
  comp: Competition;
  round: RoundScrambleSet;
  attempts: Attempt[];
  savedAt: string;
};

/**
 * Competition Simulator. Pick a competition → pick a round (competitions have
 * several: first round through the final) → solve its five real scrambles →
 * see where you'd have placed in that round. In-progress rounds persist, so a
 * refresh resumes rather than losing solves.
 */
export default function Simulator() {
  const [step, setStep] = useState<Step>("picking");
  const [comp, setComp] = useState<Competition | null>(null);
  const [rounds, setRounds] = useState<RoundMeta[]>([]);
  const [round, setRound] = useState<RoundScrambleSet | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [roundError, setRoundError] = useState<string | null>(null);
  // advancing to a round the user just qualified for
  const [advanceTo, setAdvanceTo] = useState<{
    roundTypeId: string;
    roundName: string;
  } | null>(null);
  const [advanceRound, setAdvanceRound] = useState<RoundScrambleSet | null>(null);
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  // guards for the background preload: ignore stale/duplicate fetch results
  const advanceReqRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);
  const [saved, setSaved] = useState<SavedRound | null>(() => {
    const s = store.getJson<SavedRound>(ROUND_KEY);
    return s && s.attempts.length > 0 && s.attempts.length < 5 ? s : null;
  });

  // Load a specific round's scrambles, then start solving it.
  async function loadRound(c: Competition, meta: RoundMeta) {
    setStep("loadingRound");
    setRoundError(null);
    try {
      const { round: r } = await getRound(c.id, meta.roundTypeId);
      if (r.available && r.scrambles && r.scrambles.length >= 5) {
        setRound(r);
        setAttempts([]);
        setStep("solving");
      } else {
        setRoundError(r.reason ?? "That round isn't available.");
        setStep("rounds");
      }
    } catch (err) {
      setRoundError(err instanceof Error ? err.message : "Couldn't load that round.");
      setStep("rounds");
    }
  }

  // Qualified for the next round: show the celebration and preload its
  // scrambles in the background so continuing is instant (smooth, no spinner).
  function advance(roundTypeId: string, roundName: string) {
    if (!comp) return;
    // Already loaded this exact round (e.g. returned from "Back to results"
    // and clicked again): reuse it, no refetch, no loading flash.
    if (advanceTo?.roundTypeId === roundTypeId && advanceRound) {
      setStep("qualified");
      return;
    }
    setAdvanceTo({ roundTypeId, roundName });
    setAdvanceRound(null);
    setAdvanceError(null);
    setStep("qualified");
    const reqId = ++advanceReqRef.current;
    getRound(comp.id, roundTypeId)
      .then(({ round: r }) => {
        // ignore if a newer request superseded this or we unmounted
        if (reqId !== advanceReqRef.current || !mountedRef.current) return;
        if (r.available && r.scrambles && r.scrambles.length >= 5) {
          setAdvanceRound(r);
        } else {
          setAdvanceError(r.reason ?? "That round isn't available.");
        }
      })
      .catch((err) => {
        if (reqId !== advanceReqRef.current || !mountedRef.current) return;
        setAdvanceError(
          err instanceof Error ? err.message : "Couldn't load that round.",
        );
      });
  }

  // Begin the round we just celebrated qualifying for.
  function startAdvancedRound() {
    if (!advanceRound) return;
    setRound(advanceRound);
    setAttempts([]);
    setAdvanceTo(null);
    setAdvanceRound(null);
    setStep("solving");
  }

  function chooseCompetition(c: Competition, rs: RoundMeta[]) {
    setComp(c);
    setRounds(rs);
    setRoundError(null);
    // Skip the chooser when there's only one round.
    if (rs.length === 1) loadRound(c, rs[0]);
    else setStep("rounds");
  }

  function handleAttempt(attempt: Attempt) {
    if (!comp || !round) return;
    const next = [...attempts, attempt];
    setAttempts(next);
    if (next.length >= 5) {
      store.remove(ROUND_KEY);
      setSaved(null);
      setStep("results");
    } else {
      const snapshot: SavedRound = {
        comp,
        round,
        attempts: next,
        savedAt: new Date().toISOString(),
      };
      store.setJson(ROUND_KEY, snapshot);
      setSaved(snapshot);
    }
  }

  function discardSaved() {
    if (
      saved &&
      !window.confirm(
        `Discard your paused round at ${saved.comp.name}? ${saved.attempts.length} solve${saved.attempts.length === 1 ? "" : "s"} will be lost.`,
      )
    ) {
      return;
    }
    store.remove(ROUND_KEY);
    setSaved(null);
  }

  // Leaving an in-progress round (Back from Solving) abandons it: the lifted
  // attempts are dropped and the persisted snapshot is cleared, so it can't
  // resurrect as a stale resume card later.
  function leaveRound() {
    store.remove(ROUND_KEY);
    setSaved(null);
    setAttempts([]);
    setStep(rounds.length > 1 ? "rounds" : "picking");
  }

  function reset() {
    store.remove(ROUND_KEY);
    setSaved(null);
    setComp(null);
    setRounds([]);
    setRound(null);
    setAttempts([]);
    setStep("picking");
  }

  return (
    <>
      {step === "picking" && (
        <>
          {saved && (
            <div className="screen container resume">
              <div className="card resume__card">
                <div className="resume__info">
                  <span className="eyebrow">Paused round</span>
                  <span className="resume__name">
                    {saved.comp.name}
                    {saved.round.roundName ? ` · ${saved.round.roundName}` : ""}
                  </span>
                  <span className="tertiary resume__meta">
                    {saved.attempts.length} of 5 solves done
                  </span>
                </div>
                <div className="resume__actions">
                  <button
                    className="btn"
                    onClick={() => {
                      setComp(saved.comp);
                      setRound(saved.round);
                      setAttempts(saved.attempts);
                      setStep("solving");
                    }}
                  >
                    Resume
                  </button>
                  <button className="btn btn--ghost" onClick={discardSaved}>
                    Discard
                  </button>
                </div>
              </div>
            </div>
          )}
          <CompetitionPicker onProceed={chooseCompetition} />
        </>
      )}

      {(step === "rounds" || step === "loadingRound") && comp && (
        <RoundChooser
          comp={comp}
          rounds={rounds}
          loading={step === "loadingRound"}
          error={roundError}
          onChoose={(meta) => loadRound(comp, meta)}
          onBack={reset}
        />
      )}

      {step === "solving" && comp && round?.scrambles && (
        <Solving
          scrambles={round.scrambles}
          roundName={round.roundName}
          attempts={attempts}
          onAttempt={handleAttempt}
          onBack={leaveRound}
        />
      )}

      {step === "results" && comp && round && attempts.length === 5 && (
        <Results
          comp={comp}
          round={round}
          attempts={attempts}
          onRestart={reset}
          onAdvance={advance}
        />
      )}

      {step === "qualified" && advanceTo && (
        <Qualified
          roundName={advanceTo.roundName}
          ready={Boolean(advanceRound)}
          error={advanceError}
          onStart={startAdvancedRound}
          onBack={() => setStep("results")}
          onRetry={() => advance(advanceTo.roundTypeId, advanceTo.roundName)}
        />
      )}
    </>
  );
}

function RoundChooser({
  comp,
  rounds,
  loading,
  error,
  onChoose,
  onBack,
}: {
  comp: Competition;
  rounds: RoundMeta[];
  loading: boolean;
  error: string | null;
  onChoose: (meta: RoundMeta) => void;
  onBack: () => void;
}) {
  return (
    <div className="screen container picker">
      <div className="picker__head">
        <button className="btn--ghost btn picker__back" onClick={onBack}>
          ‹ Competitions
        </button>
        <span className="eyebrow">Step 2</span>
        <h2 className="title">Choose a round</h2>
        <p className="muted">
          {comp.name} ran {rounds.length} round{rounds.length === 1 ? "" : "s"} of
          3×3. Solve any of them. Later rounds rank you against the field that
          advanced.
        </p>
      </div>

      {error && <p className="gate__error round-choose__error">{error}</p>}

      <div className="round-choose">
        {rounds.map((r, i) => (
          <button
            key={r.roundTypeId}
            className="lvl round-choose__row"
            disabled={loading}
            onClick={() => onChoose(r)}
          >
            <span className="lvl__label">{r.roundName}</span>
            <span className="lvl__range mono">
              {i === 0 ? "everyone" : "advanced"} ›
            </span>
          </button>
        ))}
      </div>

      {loading && (
        <div className="state-center">
          <div className="spinner" />
        </div>
      )}
    </div>
  );
}

/**
 * Celebration interstitial after qualifying. The next round's scrambles are
 * fetched in the background while this animates in, so "Start" is instant.
 */
function Qualified({
  roundName,
  ready,
  error,
  onStart,
  onBack,
  onRetry,
}: {
  roundName: string;
  ready: boolean;
  error: string | null;
  onStart: () => void;
  onBack: () => void;
  onRetry: () => void;
}) {
  // stagger the entrance like the rest of the gate (60ms per element)
  const d = (i: number) => ({ animationDelay: `${i * 60}ms` });
  return (
    <div className="screen container container--gate qualified">
      <div className="qualified__mark gate__item" style={d(0)} aria-hidden="true">
        <Mark size={40} />
        <span className="qualified__ring" />
      </div>
      <span className="eyebrow gate__item qualified__eyebrow" style={d(1)}>
        You made the cut
      </span>
      <h1 className="display qualified__title gate__item" style={d(2)}>
        Congratulations!
      </h1>
      <p className="lead qualified__lead gate__item" style={d(3)}>
        You qualified for the <strong>{roundName}</strong>. Only the fastest
        advanced. Solve their scrambles and see if you'd hold your ground.
      </p>

      <div className="qualified__actions gate__item" style={d(4)}>
        {error ? (
          <>
            <p className="gate__error">{error}</p>
            <button className="btn btn--secondary" onClick={onRetry}>
              Try again
            </button>
          </>
        ) : (
          <button className="btn qualified__cta" disabled={!ready} onClick={onStart}>
            {ready ? (
              <>
                Start the {roundName} <span className="arrow">→</span>
              </>
            ) : (
              "Loading scrambles…"
            )}
          </button>
        )}
        <button className="btn--ghost btn qualified__back" onClick={onBack}>
          Back to results
        </button>
      </div>
    </div>
  );
}
