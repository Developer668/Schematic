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

/**
 * WebMCP must be visible on EVERY route — including "/" (landing), "/studio",
 * "/parts", "/settings", and 404 — because ChatGPT discovers tools on the
 * currently loaded top-level document. Registering only inside WorkspaceApp
 * left the landing page with 0 tools, so the model reported WebMCP as missing.
 * This bootstrap owns the single registration lease for the whole SPA.
 */
function WebMCPBootstrap() {
  useEffect(() => {
    let disposed = false;
    void import("./webmcp/tools.ts")
      .then(({ registerWebMCPTools }) => {
        if (disposed) return;
        return registerWebMCPTools();
      })
      .catch((error) => {
        if (!disposed) console.error("[WebMCP] bootstrap registration failed", error);
      });
    return () => {
      disposed = true;
      void import("./webmcp/tools.ts").then(({ unregisterWebMCPTools }) => {
        unregisterWebMCPTools();
      }).catch(() => undefined);
    };
  }, []);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <RouteEffects />
      <WebMCPBootstrap />
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
