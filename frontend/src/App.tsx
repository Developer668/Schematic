import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import StudioPage from "./pages/StudioPage.tsx";
import { lazy, Suspense, useEffect } from "react";
import { registerWebMCPTools, unregisterWebMCPTools } from "./webmcp/tools.ts";
import "./store/useThemeStore.ts";
import { useAuth, getCurrentUserId, initAuth } from "./auth/session.ts";
import { startProjectPersistence } from "./store/projectPersistence.ts";

const LandingPage = lazy(() => import("./pages/LandingPage.tsx"));
const SettingsPage = lazy(() => import("./pages/SettingsPage.tsx"));
const PartsPage = lazy(() => import("./pages/PartsPage.tsx"));
const AuthPage = lazy(() => import("./pages/AuthPage.tsx"));

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">Checking your room…</div>;
  if (!session) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

function AuthGate() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && session) navigate("/studio", { replace: true });
  }, [session, loading, navigate]);
  if (loading) return <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">Loading…</div>;
  if (session) return null;
  return <AuthPage />;
}

export default function App() {
  useEffect(() => {
    // Start auth-scoped persistence before exposing mutation tools. The
    // registry waits for this same hydration gate, so an agent cannot mutate
    // the default room while the authenticated Site room is still loading.
    const stopProjectPersistence = startProjectPersistence();
    void initAuth();
    let disposed = false;
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
      <Suspense fallback={<div className="min-h-screen bg-background" />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/auth" element={<AuthGate />} />
          <Route
            path="/studio"
            element={
              <RequireAuth>
                <StudioPage />
              </RequireAuth>
            }
          />
          <Route
            path="/parts"
            element={
              <RequireAuth>
                <PartsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/settings"
            element={
              <RequireAuth>
                <SettingsPage />
              </RequireAuth>
            }
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
