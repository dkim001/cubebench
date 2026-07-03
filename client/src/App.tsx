import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./lib/auth.tsx";
import { NavBar } from "./components/NavBar.tsx";
import { AppShell } from "./components/AppShell.tsx";
import Home from "./pages/Home.tsx";
import Simulator from "./pages/Simulator.tsx";
import SkillTimer from "./pages/SkillTimer.tsx";
import Pricing from "./pages/Pricing.tsx";

/**
 * Two worlds:
 *   /        — marketing landing page (no app tabs, just "Launch App")
 *   /app/*   — the product, behind onboarding (account + profile), with its
 *              own navigation: Competitions, Skill Timer, Pricing.
 * Old top-level routes redirect into the app.
 */
export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route
            path="/"
            element={
              <>
                <NavBar />
                <main className="app">
                  <Home />
                </main>
              </>
            }
          />

          <Route path="/app" element={<AppShell />}>
            <Route index element={<Simulator />} />
            <Route path="skill-timer" element={<SkillTimer />} />
            <Route path="pricing" element={<Pricing />} />
          </Route>

          {/* legacy paths from the tabbed layout */}
          <Route path="/simulator" element={<Navigate to="/app" replace />} />
          <Route path="/skill-timer" element={<Navigate to="/app/skill-timer" replace />} />
          <Route path="/pricing" element={<Navigate to="/app/pricing" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
