import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";

/**
 * Marketing nav for the landing page: wordmark, section anchors, and a
 * "Launch App" action. Transparent while the hero is at rest; the hairline
 * and frosted backdrop fade in once the page scrolls.
 */
export function NavBar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`nav nav--marketing${scrolled ? " is-scrolled" : ""}`}>
      <nav className="nav__inner container">
        <NavLink to="/" className="nav__wordmark">
          {/* the 3×3 brand mark — same one as the favicon */}
          <svg
            className="nav__mark"
            width="15"
            height="15"
            viewBox="0 0 32 32"
            aria-hidden="true"
          >
            <g fill="currentColor">
              <rect x="2" y="2" width="8" height="8" rx="2" />
              <rect x="12" y="2" width="8" height="8" rx="2" />
              <rect x="22" y="2" width="8" height="8" rx="2" />
              <rect x="2" y="12" width="8" height="8" rx="2" />
              <rect x="12" y="12" width="8" height="8" rx="2" />
              <rect x="22" y="12" width="8" height="8" rx="2" />
              <rect x="2" y="22" width="8" height="8" rx="2" />
              <rect x="12" y="22" width="8" height="8" rx="2" />
              <rect x="22" y="22" width="8" height="8" rx="2" />
            </g>
          </svg>
          Cube Bench
        </NavLink>
        <div className="nav__links">
          <a className="nav__link nav__anchor" href="#how">
            How it works
          </a>
          <a className="nav__link nav__anchor" href="#why">
            Why
          </a>
          <Link className="btn nav__launch" to="/app">
            Launch App
          </Link>
        </div>
      </nav>
    </header>
  );
}
