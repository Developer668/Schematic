import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import StudioPage from "./pages/StudioPage.tsx";
import { lazy, Suspense, useEffect, useState } from "react";
import { registerWebMCPTools, unregisterWebMCPTools } from "./webmcp/tools.ts";
import "./store/useThemeStore.ts";
import { useAuth, getCurrentUserId, initAuth } from "./auth/session.ts";
import { startProjectPersistence, waitForProjectPersistence } from "./store/projectPersistence.ts";
import LogoMark from "./components/LogoMark.tsx";

const LandingPage = lazy(() => import("./pages/LandingPage.tsx"));
const SettingsPage = lazy(() => import("./pages/SettingsPage.tsx"));
const PartsPage = lazy(() => import("./pages/PartsPage.tsx"));
const AuthPage = lazy(() => import("./pages/AuthPage.tsx"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage.tsx"));

function LoadingScreen({ message = "Loading your workspace…" }: { message?: string }) {
  return (
    <main className="min-h-screen grid place-items-center bg-background p-6 text-foreground" aria-busy="true">
      <div className="flex max-w-sm flex-col items-center text-center">
        <span className="brand-mark mb-4 h-10 w-10 animate-pulse"><LogoMark /></span>
        <h1 className="text-sm font-semibold">{message}</h1>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">Projects stay on this device and are loaded before editing begins.</p>
      </div>
    </main>
  );
}

function RequireAuth({ children, workspaceReady }: { children: React.ReactNode; workspaceReady: boolean }) {
  const { session, loading } = useAuth();
  if (loading) return <LoadingScreen message="Checking your session…" />;
  if (!session) return <Navigate to="/auth" replace />;
  if (!workspaceReady) return <LoadingScreen />;
  return <>{children}</>;
}

function AuthGate() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && session) navigate("/studio", { replace: true });
  }, [session, loading, navigate]);
  if (loading) return <LoadingScreen message="Checking your session…" />;
  if (session) return null;
  return <AuthPage />;
}

export default function App() {
  const [workspaceReady, setWorkspaceReady] = useState(false);

  useEffect(() => {
    // Start auth-scoped persistence before exposing mutation tools. The
    // registry waits for this same hydration gate, so an agent cannot mutate
    // the default room while the authenticated Site room is still loading.
    const stopProjectPersistence = startProjectPersistence();
    void initAuth();
    let disposed = false;
    void waitForProjectPersistence().then(() => {
      if (!disposed) setWorkspaceReady(true);
    });
    // Defer registration one microtask so a StrictMode setup/cleanup pair can
    // cancel before any native tools are registered. unregisterWebMCPTools()
    // still invalidates an in-flight registration after it has started.
    void Promise.resolve().then(() => {
      if (disposed) return;
      return registerWebMCPTools();
    }).catch((error) => {
      if (!disposed) console.error("[WebMCP] startup registration failed", error);
    });
    if (!localStorage.getItem("schematic-theme")) {
      document.documentElement.classList.add("dark");
    }
    // Expose per-user room id for debugging and for WebMCP to verify isolation
    (window as any).__schematicRoom = () => getCurrentUserId() || "global";
    return () => {
      disposed = true;
      unregisterWebMCPTools();
      stopProjectPersistence();
    };
  }, []);

  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingScreen message="Opening Schematic…" />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/auth" element={<AuthGate />} />
          <Route
            path="/studio"
            element={
              <RequireAuth workspaceReady={workspaceReady}>
                <StudioPage />
              </RequireAuth>
            }
          />
          <Route
            path="/parts"
            element={
              <RequireAuth workspaceReady={workspaceReady}>
                <PartsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/settings"
            element={
              <RequireAuth workspaceReady={workspaceReady}>
                <SettingsPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
