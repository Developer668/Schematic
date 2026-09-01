import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import StudioPage from "./pages/StudioPage.tsx";
import { lazy, Suspense, useEffect, useState } from "react";
import { registerWebMCPTools, unregisterWebMCPTools } from "./webmcp/tools.ts";
import "./store/useThemeStore.ts";
import { useAuth, getCurrentUserId, initAuth } from "./auth/session.ts";
import { getProjectPersistenceStatus, startProjectPersistence, subscribeProjectPersistenceStatus, waitForProjectPersistence } from "./store/projectPersistence.ts";
import { installBehaviorPreviewAdapter } from "./application/behaviorCommands.ts";
import { isPreviewRunning, useBehaviorPreviewStore } from "./behavior/useBehaviorPreviewStore.ts";
import { useProjectStore } from "./store/useProjectStore.ts";
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

/** App-level owner for the one ephemeral logical preview clock. WebMCP tools
 * are registered across routes, so timed rules must not depend on StudioPage
 * being mounted. The shared reducer remains deterministic and timer-free. */
function BehaviorPreviewController() {
  const projectId = useProjectStore((state) => state.project.id);
  const status = useBehaviorPreviewStore((state) => state.status);
  const snapshot = useBehaviorPreviewStore((state) => state.snapshot);
  const durationMs = useBehaviorPreviewStore((state) => state.durationMs);
  const resetPreview = useBehaviorPreviewStore((state) => state.resetPreview);
  const seekPreview = useBehaviorPreviewStore((state) => state.seekPreview);
  const setStatus = useBehaviorPreviewStore((state) => state.setStatus);
  const snapshotIdentity = snapshot?.snapshotSha256 ?? null;

  useEffect(() => {
    void resetPreview();
  }, [projectId, resetPreview]);

  useEffect(() => {
    if (!isPreviewRunning(status) || !snapshot) return;
    const initialTimeMs = snapshot.logicalTimeMs ?? 0;
    if (initialTimeMs >= durationMs) {
      setStatus("ready");
      return;
    }
    let cancelled = false;
    let frame = 0;
    let lastSeekMs = initialTimeMs;
    const startedAt = performance.now();
    const tick = async (now: number) => {
      if (cancelled) return;
      const nextTimeMs = Math.min(durationMs, Math.round(initialTimeMs + now - startedAt));
      if (nextTimeMs === durationMs || nextTimeMs - lastSeekMs >= 50) {
        lastSeekMs = nextTimeMs;
        await seekPreview(nextTimeMs);
        if (cancelled) return;
      }
      if (nextTimeMs >= durationMs) {
        setStatus("ready");
        return;
      }
      frame = window.requestAnimationFrame((next) => { void tick(next); });
    };
    frame = window.requestAnimationFrame((next) => { void tick(next); });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [durationMs, seekPreview, setStatus, snapshot, snapshotIdentity, status]);

  return null;
}

export default function App() {
  const [workspaceReady, setWorkspaceReady] = useState(false);

  useEffect(() => {
    // Start auth-scoped persistence before exposing mutation tools. The
    // registry waits for this same hydration gate, so an agent cannot mutate
    // the default room while the authenticated Site room is still loading.
    const stopProjectPersistence = startProjectPersistence();
    // A verified subject change swaps the persistence lease synchronously and
    // marks it unhydrated. Keep already-mounted routes read-only/loading until
    // that room has been applied; otherwise a stale click or editor callback
    // can write the new user's delayed IndexedDB room.
    const syncWorkspaceReadiness = () => {
      setWorkspaceReady(getProjectPersistenceStatus().hydrated);
    };
    const stopPersistenceStatus = subscribeProjectPersistenceStatus(syncWorkspaceReadiness);
    syncWorkspaceReadiness();
    // Install the UI adapter during the client lifecycle rather than at module
    // evaluation time. This is reliable under Site SSR/hydration and React
    // StrictMode, and it cannot leave a stale adapter after unmount.
    const stopBehaviorPreviewAdapter = installBehaviorPreviewAdapter();
    void initAuth();
    let disposed = false;
    void waitForProjectPersistence().then(() => {
      if (!disposed) syncWorkspaceReadiness();
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
      stopBehaviorPreviewAdapter();
      stopPersistenceStatus();
      stopProjectPersistence();
    };
  }, []);

  return (
    <BrowserRouter>
      <BehaviorPreviewController />
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
