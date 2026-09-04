import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import LandingPage from "./pages/LandingPage.tsx";
import LogoMark from "./components/LogoMark.tsx";
import LoadingState from "./components/ui/loading-state.tsx";
import { ensureWebMCPRegistration } from "./webmcp/tools.ts";

const WorkspaceApp = lazy(() => import("./WorkspaceApp.tsx"));

let webMCPRegistrationStarted = false;

function startWebMCPRegistration() {
  if (typeof document === "undefined" || webMCPRegistrationStarted) return;
  webMCPRegistrationStarted = true;
  void ensureWebMCPRegistration().catch((error) => {
    webMCPRegistrationStarted = false;
    console.error("[WebMCP] bootstrap registration failed", error);
  });
}

// Register as soon as the client entry is evaluated. Waiting for a passive
// React effect leaves an avoidable discovery gap while the host is already
// inspecting the top-level document.
startWebMCPRegistration();

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
    startWebMCPRegistration();
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
