import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import "./store/useThemeStore.ts";
import { getCurrentUserId, initAuth, useAuth } from "./auth/session.ts";
import {
  getProjectPersistenceStatus,
  startProjectPersistence,
  subscribeProjectPersistenceStatus,
  waitForProjectPersistence,
} from "./store/projectPersistence.ts";
import { installBehaviorPreviewAdapter } from "./application/behaviorCommands.ts";
import {
  isPreviewRunning,
  useBehaviorPreviewStore,
} from "./behavior/useBehaviorPreviewStore.ts";
import { useProjectStore } from "./store/useProjectStore.ts";
import LogoMark from "./components/LogoMark.tsx";
import LoadingState from "./components/ui/loading-state.tsx";
import "./index.css";
import "./refinement.css";
import "./workspace-v2.css";

const StudioPage = lazy(() => import("./pages/StudioPage.tsx"));
const SettingsPage = lazy(() => import("./pages/SettingsPage.tsx"));
const PartsPage = lazy(() => import("./pages/PartsPage.tsx"));
const AuthPage = lazy(() => import("./pages/AuthPage.tsx"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage.tsx"));

function WorkspaceLoading({ message = "Loading your workspace…" }: { message?: string }) {
  return (
    <main className="min-h-screen grid place-items-center bg-background p-6 text-foreground" aria-busy="true">
      <div className="flex max-w-sm flex-col items-center text-center">
        <span className="brand-mark mb-4 h-10 w-10"><LogoMark /></span>
        <h1 className="sr-only">{message}</h1>
        <LoadingState label={message.replace(/…$/, "")} variant="Drive" />
        <p className="mt-3 text-xs leading-5 text-muted-foreground">Opening the active project and its saved workspace.</p>
      </div>
    </main>
  );
}

function RequireAuth({ children, workspaceReady }: { children: React.ReactNode; workspaceReady: boolean }) {
  const { session, loading } = useAuth();
  if (loading) return <WorkspaceLoading message="Checking your session…" />;
  if (!session) return <Navigate to="/auth" replace />;
  if (!workspaceReady) return <WorkspaceLoading />;
  return <>{children}</>;
}

function AuthGate() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && session) navigate("/studio", { replace: true });
  }, [session, loading, navigate]);

  if (loading) return <WorkspaceLoading message="Checking your session…" />;
  if (session) return null;
  return <AuthPage />;
}

/** Owns the ephemeral logical preview clock only while a workspace route is open. */
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

export default function WorkspaceApp() {
  const [workspaceReady, setWorkspaceReady] = useState(false);

  useEffect(() => {
    const stopProjectPersistence = startProjectPersistence();
    const syncWorkspaceReadiness = () => {
      setWorkspaceReady(getProjectPersistenceStatus().hydrated);
    };
    const stopPersistenceStatus = subscribeProjectPersistenceStatus(syncWorkspaceReadiness);
    syncWorkspaceReadiness();

    const stopBehaviorPreviewAdapter = installBehaviorPreviewAdapter();
    void initAuth();
    let disposed = false;

    void waitForProjectPersistence().then(() => {
      if (!disposed) syncWorkspaceReadiness();
    });

    // WebMCP registration is owned by App-level WebMCPBootstrap so tools stay
    // visible on landing, studio, parts, settings, and 404. Do not register or
    // unregister here — doing so would abort the shared lease on route change.

    if (!localStorage.getItem("schematic-theme")) {
      document.documentElement.classList.add("dark");
    }

    (window as typeof window & { __schematicRoom?: () => string }).__schematicRoom = () => getCurrentUserId() || "global";

    return () => {
      disposed = true;
      stopBehaviorPreviewAdapter();
      stopPersistenceStatus();
      stopProjectPersistence();
    };
  }, []);

  return (
    <>
      <BehaviorPreviewController />
      <Suspense fallback={<WorkspaceLoading message="Opening Schematic…" />}>
        <Routes>
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
    </>
  );
}
