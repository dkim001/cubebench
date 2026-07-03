import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth.tsx";
import { Onboarding } from "./Onboarding.tsx";

/**
 * Everything behind "Launch App". Until a signed-in user with a profile
 * exists, this renders the onboarding gate instead of the app — competition
 * listings and both timers live on the other side.
 */
export function AppShell() {
  const { user, loading, signOut } = useAuth();

  if (loading) {
    return (
      <div className="gate-loading">
        <div className="spinner" />
      </div>
    );
  }

  const needsOnboarding = !user || !user.profile.avg333;
  if (needsOnboarding) {
    return (
      <>
        {/* minimal branded header so the gate still feels like Cube Bench */}
        <header className="nav">
          <nav className="nav__inner container">
            <NavLink to="/" className="nav__wordmark">
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
          </nav>
        </header>
        <main className="app">
          <Onboarding />
        </main>
      </>
    );
  }

  return (
    <>
      <header className="nav">
        <nav className="nav__inner container">
          <NavLink to="/" className="nav__wordmark">
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
            <NavLink
              to="/app"
              end
              className={({ isActive }) => `nav__link${isActive ? " is-active" : ""}`}
            >
              Competitions
            </NavLink>
            <NavLink
              to="/app/skill-timer"
              className={({ isActive }) => `nav__link${isActive ? " is-active" : ""}`}
            >
              Skill Timer
            </NavLink>
            <NavLink
              to="/app/pricing"
              className={({ isActive }) => `nav__link${isActive ? " is-active" : ""}`}
            >
              Pricing
            </NavLink>
            <button
              className="nav__link nav__signout"
              onClick={() => signOut()}
              title={user.email}
            >
              Sign out
            </button>
          </div>
        </nav>
      </header>
      <main className="app">
        <Outlet />
      </main>
    </>
  );
}
