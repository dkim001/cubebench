import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth.tsx";
import { Onboarding } from "./Onboarding.tsx";
import { Mark } from "./Mark.tsx";

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
              <Mark className="nav__mark" size={15} />
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

  const shownName = user.profile.displayName ?? user.name;
  const initials = shownName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

  return (
    <>
      <header className="nav nav--app">
        <nav className="nav__inner container">
          <NavLink to="/" className="nav__wordmark">
            <Mark className="nav__mark" size={15} />
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
            <span className="nav__user-chip" title={user.email}>
              <span className="nav__avatar" aria-hidden="true">
                {initials || "?"}
              </span>
              <span className="nav__username tertiary">{shownName}</span>
              {user.pro && <span className="nav__pro">Pro</span>}
            </span>
            <button className="nav__link nav__signout" onClick={() => signOut()}>
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
