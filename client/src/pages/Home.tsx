import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Reveal } from "../components/Reveal.tsx";
import { Mark } from "../components/Mark.tsx";

/**
 * Marketing landing page, desktop-first. One motion vocabulary (rise +
 * blur-to-sharp, once-only, swift-out easing), a scripted hero, a scroll-
 * settled showcase, one inverted ink band. The serif display face carries
 * the editorial headlines; General Sans stays on UI and body.
 *
 * All numbers shown are real, verified against the WCA API. The marquee and
 * the stats band reference real championships.
 */

/** Headline words rise out of an overflow mask, 90ms apart. */
function MaskedWords({
  text,
  startDelay = 0,
  italicIndex = -1,
}: {
  text: string;
  startDelay?: number;
  /** index of a word to set in the serif italic (the human gesture) */
  italicIndex?: number;
}) {
  return (
    <>
      {text.split(" ").map((word, i) => (
        <span className="mask-word" key={`${word}-${i}`}>
          <span
            className={`mask-word__inner${i === italicIndex ? " is-italic" : ""}`}
            style={{ animationDelay: `${startDelay + i * 0.09}s` }}
          >
            {word}
          </span>
        </span>
      ))}
    </>
  );
}

const MARQUEE_COMPS = [
  "WCA World Championship 2019 · Melbourne",
  "CubingUSA Nationals 2023 · Pittsburgh",
  "World Championship 2017 · Paris",
  "World Championship 2015 · São Paulo",
  "CubingUSA Nationals 2019 · Baltimore",
  "World Championship 2013 · Las Vegas",
  "World Championship 2011 · Bangkok",
  "…and thousands more in the archive",
];

const FAQ = [
  {
    q: "Is the scoring really WCA-accurate?",
    a: "Yes. Averages drop your single best and worst solve and take the mean of the middle three, quantized to centiseconds the way official results are. Late inspection costs a +2, and DNFs follow the official rules: one counts as your worst solve, two make the whole average a DNF.",
  },
  {
    q: "Where do the scrambles and results come from?",
    a: "From the WCA's public API. You solve the exact scrambles a round used, and your average is placed against that round's official results. Cube Bench isn't affiliated with the WCA; it builds on the data they publish.",
  },
  {
    q: "Do I need an account?",
    a: "Yes, and it's free. Your account holds your speed profile and, if you upgrade, your Pro plan. Sign up with an email and password, or with Google.",
  },
  {
    q: "What does Pro add?",
    a: "The full library of past WCA competitions, plus skill analytics that follow your stage splits across sessions. It's $3.49 a month (or $25 a year), with a 3-day free trial, and you can cancel anytime.",
  },
  {
    q: "What happens if I mis-tap mid-solve?",
    a: "After every solve you can redo it on the same scramble, mark a +2, or flag it as a DNF before it counts. Leaving a round pauses it, and you can resume from the competition list.",
  },
];

export default function Home() {
  const stageMainRef = useRef<HTMLDivElement>(null);

  // The showcase settles from a slight perspective tilt to flat over the
  // first stretch of scroll — clamped, once per frame, off under
  // prefers-reduced-motion. (Linear's signature, kept subtle.)
  useEffect(() => {
    const el = stageMainRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // 1 while the stage is low in the viewport, 0 once it reaches ~28% up
      const progress = Math.min(
        1,
        Math.max(0, (rect.top - vh * 0.28) / (vh * 0.55)),
      );
      el.style.setProperty("--stage-tilt", `${(progress * 6).toFixed(2)}deg`);
      el.style.setProperty(
        "--stage-scale",
        (1 - progress * 0.035).toFixed(4),
      );
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="home">
      {/* ---------- hero: a scripted sequence, not a fade-in ---------- */}
      <section className="hero container">
        <span className="eyebrow hero__fade" style={{ animationDelay: "0.05s" }}>
          Competition benchmark for speedcubers
        </span>
        <h1 className="display hero__headline" aria-label="Find out where you'd actually place.">
          <span className="hero__line">
            <MaskedWords text="Find out where" startDelay={0.12} />
          </span>
          <span className="hero__line">
            <MaskedWords
              text="you'd actually place."
              startDelay={0.39}
              italicIndex={1}
            />
          </span>
        </h1>
        <p className="lead hero__lead hero__fade" style={{ animationDelay: "0.62s" }}>
          Solve the real scrambles from real WCA competitions and see where
          your average would have landed against the people who were there.
        </p>
        <div className="hero__ctas hero__fade" style={{ animationDelay: "0.78s" }}>
          <Link className="btn" to="/app">
            Launch App
          </Link>
          <a className="btn btn--ghost" href="#how">
            See how it works <span className="arrow">→</span>
          </a>
        </div>
        <p
          className="hero__meta tertiary hero__fade"
          style={{ animationDelay: "0.92s" }}
        >
          Free to start · Real WCA data · Runs in your browser
        </p>
      </section>

      {/* ---------- product showcase: lands, then flattens on scroll ---------- */}
      <section
        className="stage container--wide stage--enter"
        aria-label="The app's result screen"
      >
        <div className="card stage__main" ref={stageMainRef}>
          <span className="eyebrow">Your result</span>
          <div className="stage__avg mono">12.43</div>
          <p className="muted stage__avg-label">WCA average of 5</p>
          <p className="results__rank-line">
            Would have placed <strong className="accent mono">428th</strong> of{" "}
            <strong className="mono">1014</strong> at CubingUSA Nationals 2023
          </p>
          <div className="results__solves stage__solves">
            <div className="solve-pill">
              <span className="tertiary">1</span>
              <span className="mono">12.61</span>
            </div>
            <div className="solve-pill is-dropped">
              <span className="tertiary">2</span>
              <span className="mono">11.09</span>
              <span className="solve-pill__tag">best</span>
            </div>
            <div className="solve-pill">
              <span className="tertiary">3</span>
              <span className="mono">12.20</span>
            </div>
            <div className="solve-pill is-dropped">
              <span className="tertiary">4</span>
              <span className="mono">14.87+</span>
              <span className="solve-pill__tag">worst</span>
            </div>
            <div className="solve-pill">
              <span className="tertiary">5</span>
              <span className="mono">12.48</span>
            </div>
          </div>
        </div>

        <div
          className="card stage__float"
          aria-label="Skill Timer session summary"
        >
          <span className="stage__float-title">Where your time went</span>
          {[
            ["Cross", 21, false],
            ["F2L", 48, true],
            ["OLL", 17, false],
            ["PLL", 14, false],
          ].map(([label, pct, slowest]) => (
            <div key={label as string} className="breakdown__row">
              <span className="breakdown__label">{label}</span>
              <div className="breakdown__track">
                <div
                  className={`breakdown__fill${slowest ? " is-slowest" : ""}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="breakdown__pct mono">{pct}%</span>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- slow marquee of real championships ---------- */}
      <Reveal className="reveal--full">
        <div className="marquee" aria-hidden="true">
          <div className="marquee__track">
            {[...MARQUEE_COMPS, ...MARQUEE_COMPS].map((name, i) => (
              <span className="marquee__item mono" key={i}>
                {name}
              </span>
            ))}
          </div>
        </div>
      </Reveal>

      {/* ---------- fact strip ---------- */}
      <section className="facts container--wide">
        {[
          [
            "The exact scrambles",
            "The five a round actually used, straight from the WCA archive.",
          ],
          [
            "The real field",
            "Ranked against every competitor who showed up that day.",
          ],
          [
            "Scored the WCA way",
            "Ao5 with best and worst dropped, penalties included.",
          ],
        ].map(([title, body], i) => (
          <Reveal key={title} delay={i * 100}>
            <div className="facts__item">
              <span className="facts__title">{title}</span>
              <span className="facts__body muted">{body}</span>
            </div>
          </Reveal>
        ))}
      </section>

      {/* ---------- how it works: real UI fragments ---------- */}
      <section className="how container--wide" id="how">
        <Reveal>
          <span className="eyebrow">How it works</span>
          <h2 className="how__title h-ink">Three steps to a real answer.</h2>
        </Reveal>
        <div className="how__grid">
          <Reveal delay={0}>
            <div className="card how__card">
              <span className="how__ghost mono" aria-hidden="true">
                1
              </span>
              <div className="how__fragment">
                <div className="how__comp-row">
                  <span className="how__comp-main">
                    <span className="how__comp-name">
                      WCA World Championship 2019
                    </span>
                    <span className="tertiary how__comp-meta">
                      Melbourne · Jul 11, 2019
                    </span>
                  </span>
                  <span className="comp-row__chev">›</span>
                </div>
              </div>
              <h3 className="how__step-title">Pick a real competition</h3>
              <p className="muted how__step-body">
                Any competition in the library, first round through the final.
                Three featured championships are free.
              </p>
            </div>
          </Reveal>

          <Reveal delay={110}>
            <div className="card how__card">
              <span className="how__ghost mono" aria-hidden="true">
                2
              </span>
              <div className="how__fragment how__fragment--timer">
                <span className="how__scramble mono">
                  R' B2 L D' F' D' B L2 D F2 R U2
                </span>
                <span className="how__digits mono">10.42</span>
              </div>
              <h3 className="how__step-title">Solve the same five scrambles</h3>
              <p className="muted how__step-body">
                Hold-to-start timer, 15 seconds of WCA inspection, and a +2 if
                you start late. Just like the real round.
              </p>
            </div>
          </Reveal>

          <Reveal delay={220}>
            <div className="card how__card">
              <span className="how__ghost mono" aria-hidden="true">
                3
              </span>
              <div className="how__fragment how__fragment--rank">
                <p className="how__rank-line">
                  <strong className="accent mono">331st</strong> of{" "}
                  <strong className="mono">807</strong>
                </p>
                <span className="tertiary how__rank-sub">
                  against the real field
                </span>
              </div>
              <h3 className="how__step-title">See where you'd have placed</h3>
              <p className="muted how__step-body">
                Your Ao5 sits in the official standings. The winner that day
                averaged 5.88.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------- the timer itself ---------- */}
      <section className="timerband container--wide">
        <Reveal delay={120}>
          <div className="card timerband__demo" aria-label="The competition timer">
            <span className="eyebrow">Solve 3 of 5</span>
            <span className="timerband__scramble mono">
              D2 R' F2 U2 R2 B U' L B2 D' F R2 U F2 D2 B2 U' L2 D R2
            </span>
            <span className="timerband__digits mono">11.32</span>
            <span className="tertiary timerband__hint">Any key to stop</span>
          </div>
        </Reveal>
        <Reveal>
          <div className="timerband__copy">
            <span className="eyebrow">The timer</span>
            <h2 className="h-ink">Conventions cubers already know.</h2>
            <p className="muted timerband__body">
              Hold space until it arms, release to start, and any key stops.
              Fifteen seconds of WCA inspection runs before every solve, and a
              late start costs the same +2 it would on the day.
            </p>
            <p className="muted timerband__body">
              Mis-taps aren't fatal either. Every solve can be redone, marked
              +2, or flagged DNF before it counts, and leaving a round pauses
              it for later.
            </p>
            <Link className="btn btn--ghost timerband__cta" to="/app">
              Try a solve <span className="arrow">→</span>
            </Link>
          </div>
        </Reveal>
      </section>

      {/* ---------- why vs a regular timer ---------- */}
      <section className="why container" id="why">
        <Reveal>
          <div className="card why__card">
            <div className="why__col">
              <span className="why__label">A regular timer</span>
              <p className="muted">
                Records your times, draws a graph, and leaves the real question
                open: would that average survive an actual round?
              </p>
            </div>
            <div className="why__divider" aria-hidden="true" />
            <div className="why__col">
              <span className="why__label why__label--accent">Cube Bench</span>
              <p className="muted">
                Puts your average of 5 next to the official results of a real
                WCA round, on the exact scrambles those competitors solved,
                scored the way the round was scored.
              </p>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ---------- one real round, by the numbers ---------- */}
      <section className="numbers container--wide">
        <Reveal>
          <span className="eyebrow">By the numbers</span>
          <h2 className="h-ink numbers__title">One real round.</h2>
        </Reveal>
        <div className="numbers__grid">
          {[
            ["807", "competitors in the field you're ranked against"],
            ["382", "made the cut for the second round"],
            ["5.88", "the winning average, in seconds"],
          ].map(([num, cap], i) => (
            <Reveal key={num} delay={i * 100}>
              <div className="numbers__item">
                <span className="numbers__num mono">{num}</span>
                <span className="numbers__cap muted">{cap}</span>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={280}>
          <p className="tertiary numbers__src">
            First round of 3×3 at the WCA World Championship 2019, Melbourne.
          </p>
        </Reveal>
      </section>

      {/* ---------- skill timer band ---------- */}
      <section className="skillband container--wide">
        <Reveal>
          <div className="skillband__copy">
            <span className="eyebrow">Also inside</span>
            <h2 className="h-ink">Skill Timer</h2>
            <p className="muted skillband__body">
              Practice with stage splits: one tap at the end of Cross, F2L,
              OLL, and PLL. Session by session, see exactly which stage is
              eating your time, and whether the work is paying off.
            </p>
            <Link className="btn btn--secondary" to="/app/skill-timer">
              Open Skill Timer
            </Link>
          </div>
        </Reveal>
        <Reveal delay={120}>
          <div className="card skillband__demo">
            <div className="session__stat">
              <span className="session__stat-label">Focus on</span>
              <span className="session__stat-value">
                F2L <span className="muted mono session__pct">48%</span>
              </span>
            </div>
            <p className="tertiary skillband__note">
              Nearly half this session went to F2L. That's where practice pays
              off first.
            </p>
          </div>
        </Reveal>
      </section>

      {/* ---------- FAQ ---------- */}
      <section className="faq container" id="faq">
        <Reveal>
          <span className="eyebrow">FAQ</span>
          <h2 className="h-ink faq__title">Fair questions.</h2>
        </Reveal>
        <div className="faq__list">
          {FAQ.map((item, i) => (
            <Reveal key={item.q} delay={i * 60}>
              <details className="faq__item">
                <summary className="faq__q">
                  {item.q}
                  <span className="faq__toggle" aria-hidden="true">
                    +
                  </span>
                </summary>
                <p className="muted faq__a">{item.a}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------- inverted ink band: the mission ---------- */}
      <section className="claim">
        <Reveal>
          <div className="claim__inner">
            <span className="eyebrow claim__eyebrow">Why we built this</span>
            <h2 className="claim__title">Make it measurable.</h2>
            <p className="claim__body">
              Cube timer websites haven't changed in years, and none of them
              answer the question everyone practicing at home has: am I ready
              for a real competition? Cube Bench turns that into a measurement.
              Solve a real round, see where you'd have landed, and sign up for
              your first competition because the numbers say you're ready.
            </p>
            <Link className="btn claim__cta" to="/app">
              Launch App
            </Link>
          </div>
        </Reveal>
      </section>

      {/* ---------- footer ---------- */}
      <footer className="footer">
        <div className="container--wide footer__inner">
          <div className="footer__brand">
            <span className="footer__wordmark">
              <Mark size={14} className="footer__mark" /> Cube Bench
            </span>
            <span className="tertiary footer__tag">
              The competition benchmark for speedcubers.
            </span>
          </div>
          <div className="footer__col">
            <span className="footer__head">Product</span>
            <Link className="footer__link" to="/app">
              Launch App
            </Link>
            <Link className="footer__link" to="/app/skill-timer">
              Skill Timer
            </Link>
            <Link className="footer__link" to="/app/pricing">
              Pricing
            </Link>
          </div>
          <div className="footer__col">
            <span className="footer__head">Learn</span>
            <a className="footer__link" href="#how">
              How it works
            </a>
            <a className="footer__link" href="#why">
              Why Cube Bench
            </a>
            <a className="footer__link" href="#faq">
              FAQ
            </a>
          </div>
        </div>
        <div className="container--wide footer__legal tertiary">
          Built on the WCA's public API. Not affiliated with the World Cube
          Association. © 2026 Cube Bench.
        </div>
      </footer>
    </div>
  );
}
