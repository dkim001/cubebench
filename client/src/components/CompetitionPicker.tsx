import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getRounds,
  searchCompetitions,
  type Competition,
  type RoundMeta,
} from "../lib/api.ts";
import { FEATURED_COMPS, FEATURED_COMP_IDS } from "../lib/featured.ts";
import { isTouchDevice } from "../lib/pointer.ts";
import { useAuth } from "../lib/auth.tsx";

/**
 * Competition picker with visual free/Pro gating (no accounts in this
 * version). With an empty search, the three featured (free) competitions are
 * shown. Searching reveals the whole library; non-featured comps render
 * locked and link to Pricing instead of starting a session.
 *
 * Selecting a free comp fetches its first-round 3x3 scramble set; comps whose
 * scrambles were never uploaded show "Scrambles not available" and can't be
 * started.
 */
export function CompetitionPicker({
  onProceed,
}: {
  onProceed: (comp: Competition, rounds: RoundMeta[]) => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isPro = Boolean(user?.pro);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<Record<string, string>>({});
  const [retryNonce, setRetryNonce] = useState(0);

  const showingFeatured = query.trim() === "";

  // Debounced search; the featured view needs no fetch at all.
  useEffect(() => {
    if (showingFeatured) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const handle = setTimeout(async () => {
      try {
        const { competitions } = await searchCompetitions(query);
        if (!cancelled) setResults(competitions);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, showingFeatured, retryNonce]);

  // Focus the search on desktop only — on phones autofocus throws the
  // keyboard over the featured list, which is the intended first tap.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!isTouchDevice()) inputRef.current?.focus();
  }, []);

  async function select(comp: Competition) {
    if (selectingId || unavailable[comp.id]) return;
    if (!FEATURED_COMP_IDS.has(comp.id) && !isPro) {
      navigate("/app/pricing");
      return;
    }
    setSelectingId(comp.id);
    try {
      const { available, reason, rounds } = await getRounds(comp.id);
      if (available && rounds.length > 0) {
        onProceed(comp, rounds);
      } else {
        setUnavailable((u) => ({
          ...u,
          [comp.id]: reason ?? "Scrambles not available",
        }));
      }
    } catch (err) {
      setUnavailable((u) => ({
        ...u,
        [comp.id]: err instanceof Error ? err.message : "Could not load rounds",
      }));
    } finally {
      setSelectingId(null);
    }
  }

  const rows: Competition[] = showingFeatured ? FEATURED_COMPS : results;

  return (
    <div className="screen container picker">
      <div className="picker__head">
        <span className="eyebrow">Step 1</span>
        <h2 className="title">Pick a competition</h2>
        <p className="muted">
          Search by name, city, or year, then pick any 3×3 round the
          competition ran.
        </p>
      </div>

      <input
        ref={inputRef}
        className="input"
        placeholder="Search all competitions…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        spellCheck={false}
      />

      {showingFeatured && (
        <p className="picker__plan-note tertiary">
          Featured competitions are free. The full library of past WCA
          competitions comes with Pro.
        </p>
      )}

      <div className="picker__list card">
        {loading &&
          // skeleton rows: the layout doesn't jump from empty box to list
          [0, 1, 2].map((i) => (
            <div className="skel-row" key={i} aria-hidden="true">
              <span className="skel skel--name" />
              <span className="skel skel--meta" />
            </div>
          ))}

        {!loading && error && (
          <div className="state-center picker__error">
            <p className="muted">{error}</p>
            <button
              className="btn btn--secondary picker__retry"
              onClick={() => setRetryNonce((n) => n + 1)}
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && !showingFeatured && rows.length === 0 && (
          <div className="state-center muted picker__empty">
            <p>No competitions found.</p>
            <p className="tertiary">
              Try a name, city, or year, like “Nationals 2023”.
            </p>
          </div>
        )}

        {!loading &&
          !error &&
          rows.map((comp) => {
            const note = unavailable[comp.id];
            const busy = selectingId === comp.id;
            const locked = !FEATURED_COMP_IDS.has(comp.id) && !isPro;
            return (
              <button
                key={comp.id}
                className={`comp-row${note ? " is-unavailable" : ""}${locked ? " is-locked" : ""}`}
                onClick={() => select(comp)}
                disabled={!!note || !!selectingId}
                aria-label={
                  locked ? `${comp.name}, included with Pro` : comp.name
                }
              >
                <span className="comp-row__main">
                  <span className="comp-row__name">{comp.name}</span>
                  <span className="comp-row__meta tertiary">
                    {[comp.city, formatDate(comp.start_date)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="comp-row__right">
                  {busy && <span className="spinner spinner--sm" />}
                  {note && <span className="comp-row__note">{note}</span>}
                  {!busy && !note && locked && (
                    <span className="comp-row__pro">Pro</span>
                  )}
                  {!busy && !note && !locked && (
                    <>
                      {FEATURED_COMP_IDS.has(comp.id) && !isPro && (
                        <span className="comp-row__free">Free</span>
                      )}
                      <span className="comp-row__chev">›</span>
                    </>
                  )}
                </span>
              </button>
            );
          })}
      </div>
    </div>
  );
}

function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
