import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import LandingPage from "./pages/LandingPage.tsx";
import LogoMark from "./components/LogoMark.tsx";
import LoadingState from "./components/ui/loading-state.tsx";

const WorkspaceApp = lazy(() => import("./WorkspaceApp.tsx"));

function RouteEffects() {
  const { pathname } = useLocation();

  useEffect(() => {
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
    document.documentElement.dataset.route = pathname;
    document.title = pathname === "/"
      ? "Schematic — Design Connected Hardware"
      : pathname.startsWith("/studio")
        ? "Studio — Schematic"
        : pathname.startsWith("/parts")
          ? "Parts — Schematic"
          : pathname.startsWith("/settings")
            ? "Settings — Schematic"
            : "Schematic";
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  return null;
}

function RouteLoading() {
  return (
    <main className="route-loading" aria-busy="true">
      <div className="route-loading-card">
        <span className="route-loading-mark"><LogoMark /></span>
        <h1 className="sr-only">Opening Schematic</h1>
        <LoadingState label="Opening Schematic" variant="Drive" />
      </div>
    </main>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <RouteEffects />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route
          path="/*"
          element={
            <Suspense fallback={<RouteLoading />}>
              <WorkspaceApp />
            </Suspense>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
