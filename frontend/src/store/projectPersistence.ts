import {
  createDebouncedWorkspaceSaver,
  getSchematicLegacyProjectKeys,
  migrateLocalStorageWorkspace,
  ProjectRepository,
  type StoredWorkspace,
  type WorkspaceSnapshot,
} from "@schematic/project-storage";
import { getCurrentUserId, initAuth } from "../auth/session.ts";
import {
  enterWorkspaceRecovery,
  getWorkspaceRecoveryError,
  normalizeProject,
  normalizeRecoveryWorkspace,
  normalizeStoredWorkspace,
  useProjectStore,
  type HardwareGraph,
} from "./useProjectStore.ts";
import {
  beginPendingPersistenceContext,
  beginPersistenceRoom,
  clearPersistenceGate,
  completePersistenceRoom,
  consumeExpectedPersistenceFallback,
  getPersistenceGate,
  type PersistenceContextToken,
} from "./persistenceGate.ts";
import { loadRemoteWorkspace, saveRemoteWorkspace } from "./remoteProjectPersistence.ts";

const ROOM_ID = "workspace";
const SAVE_DELAY_MS = 500;

type Workspace = WorkspaceSnapshot<HardwareGraph>;

interface PersistenceContext {
  key: string;
  userId: string | null;
  token: PersistenceContextToken;
  repository: ProjectRepository<HardwareGraph>;
  saver: ReturnType<typeof createDebouncedWorkspaceSaver<HardwareGraph>>;
  hydrated: boolean;
  applying: boolean;
  pendingBeforeHydration: boolean;
  /** Ignore the synchronous room snapshot published by reloadForCurrentUser. */
  ignoreStoreUntilHydrated: boolean;
  revision: number | null;
  remoteRevision: number | null;
  remoteQueue: Promise<void>;
  error: string | null;
}

let activeContext: PersistenceContext | null = null;
let hydrationGeneration = 0;
let persistenceLifecycleGeneration = 0;
let persistenceReady: Promise<void> = Promise.resolve();
const statusListeners = new Set<() => void>();

function emitPersistenceStatus() {
  for (const listener of statusListeners) listener();
}

function contextKey(userId: string | null) {
  return `${userId ?? "anonymous"}:${ROOM_ID}`;
}

function currentWorkspace(): Workspace {
  const state = useProjectStore.getState();
  return {
    version: 1,
    activeProjectId: state.activeProjectId,
    projects: state.projects,
  };
}

function queueRemoteSave(context: PersistenceContext, workspace: Workspace = currentWorkspace()): Promise<void> {
  const snapshot = structuredClone(workspace);
  context.remoteQueue = context.remoteQueue.then(async () => {
    if (activeContext !== context) return;
    const stored = await saveRemoteWorkspace(snapshot, context.remoteRevision);
    if (activeContext === context && stored) context.remoteRevision = stored.revision;
  });
  return context.remoteQueue;
}

function parsedTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function latestProjectUpdate(workspace: Pick<Workspace, "projects">): number | null {
  let latest: number | null = null;
  for (const project of workspace.projects) {
    const timestamp = parsedTimestamp(project.updatedAt);
    if (timestamp !== null && (latest === null || timestamp > latest)) latest = timestamp;
  }
  return latest;
}

/**
 * The Zustand store bootstraps synchronously from the first applicable
 * localStorage record. Read only that same record's explicit timestamps here;
 * normalization-generated timestamps must not make an undated legacy record
 * appear newer than a durable IndexedDB revision.
 */
function latestLocalStorageProjectUpdate(userId: string | null): number | null {
  if (typeof localStorage === "undefined") return null;
  const currentKey = userId ? `schematic-projects:${userId}` : "schematic-projects";
  const allKeys = [...new Set([currentKey, ...getSchematicLegacyProjectKeys(userId)])];
  const keys = userId && userId !== "local-development" ? [currentKey] : allKeys;
  for (const key of keys) {
    let raw: string | null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      return null;
    }
    if (raw === null) continue;
    try {
      const value = JSON.parse(raw) as unknown;
      if (!value || typeof value !== "object") return null;
      const record = value as { projects?: unknown; updatedAt?: unknown };
      const projects = Array.isArray(record.projects) && record.projects.length > 0
        ? record.projects
        : !Array.isArray(record.projects)
          ? [record]
          : [];
      let latest: number | null = parsedTimestamp(record.updatedAt);
      for (const project of projects) {
        if (!project || typeof project !== "object") continue;
        const timestamp = parsedTimestamp((project as { updatedAt?: unknown }).updatedAt);
        if (timestamp !== null && (latest === null || timestamp > latest)) latest = timestamp;
      }
      return latest;
    } catch {
      return null;
    }
  }
  return null;
}

function applyWorkspace(workspace: Workspace, context: PersistenceContext): boolean {
  let normalized;
  try {
    normalized = normalizeStoredWorkspace(workspace.projects, workspace.activeProjectId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workspace recovery required: the durable room is invalid.";
    let recovery;
    try {
      recovery = normalizeRecoveryWorkspace(workspace.projects, workspace.activeProjectId);
    } catch (recoveryError) {
      context.error = recoveryError instanceof Error ? recoveryError.message : message;
      enterWorkspaceRecovery(context.error);
      return false;
    }
    const { projects, activeProjectId } = recovery;
    const project = projects.find((candidate) => candidate.id === activeProjectId) ?? projects[0];
    enterWorkspaceRecovery(message, recovery);
    context.error = message;
    context.applying = true;
    try {
      useProjectStore.setState({ projects, activeProjectId, project });
    } finally {
      context.applying = false;
    }
    return true;
  }
  const { projects, activeProjectId } = normalized;
  const project = projects.find((candidate) => candidate.id === activeProjectId) ?? projects[0];
  context.applying = true;
  try {
    useProjectStore.setState({ projects, activeProjectId, project });
  } finally {
    context.applying = false;
  }
  return true;
}

function scheduleSave(context: PersistenceContext) {
  if (activeContext !== context || !context.hydrated || getWorkspaceRecoveryError()) return;
  context.error = null;
  const save = context.saver.schedule(currentWorkspace(), {
    source: "save",
    ...(getCurrentUserId() ? { updatedBy: getCurrentUserId()! } : {}),
  });
  emitPersistenceStatus();
  void save.then(async (result) => {
    if (activeContext !== context) return;
    if (result.ok) {
      context.revision = result.value.metadata.revision;
      await queueRemoteSave(context);
    }
    else context.error = result.error.message;
    emitPersistenceStatus();
  });
}

async function flushContext(context: PersistenceContext): Promise<StoredWorkspace<HardwareGraph> | null> {
  const result = await context.saver.flush();
  if (activeContext === context) {
    if (result?.ok) {
      context.revision = result.value.metadata.revision;
      context.error = null;
    } else if (result) {
      context.error = result.error.message;
    }
    emitPersistenceStatus();
  }
  if (result?.ok) await queueRemoteSave(context);
  return result?.ok ? result.value : null;
}

async function preserveCurrentWorkspace(
  context: PersistenceContext,
  expectedRevision: number,
  isCurrent: () => boolean,
): Promise<void> {
  const workspace = currentWorkspace();
  // Changes after this snapshot must schedule one more save once hydration is
  // complete instead of being mistaken for the change we are reconciling now.
  context.pendingBeforeHydration = false;
  const saved = await context.repository.saveWorkspace(workspace, {
    expectedRevision,
    source: "migration",
    ...(getCurrentUserId() ? { updatedBy: getCurrentUserId()! } : {}),
  });
  if (!isCurrent() || activeContext !== context) return;
  if (saved.ok) context.revision = saved.value.metadata.revision;
  else context.error = saved.error.message;
}

function makeContext(userId: string | null, token: PersistenceContextToken, ignoreStoreUntilHydrated = false): PersistenceContext {
  const repository = new ProjectRepository<HardwareGraph>({
    namespace: { roomId: ROOM_ID, userId },
  });
  return {
    key: contextKey(userId),
    userId,
    token,
    repository,
    saver: createDebouncedWorkspaceSaver(repository, SAVE_DELAY_MS),
    hydrated: false,
    applying: false,
    pendingBeforeHydration: false,
    ignoreStoreUntilHydrated,
    revision: null,
    remoteRevision: null,
    remoteQueue: Promise.resolve(),
    error: null,
  };
}

async function hydrateForCurrentRoom(isCurrent: () => boolean = () => true): Promise<void> {
  if (!isCurrent()) return;
  const generation = ++hydrationGeneration;
  const userId = getCurrentUserId();
  const key = contextKey(userId);
  if (activeContext?.key === key && activeContext.hydrated) return;
  // A duplicate session notification while this exact room is still loading
  // must join the existing hydration instead of resetting its generation.
  if (activeContext?.key === key) return;

  const roomChanged = Boolean(activeContext && activeContext.key !== key);
  activeContext?.saver.cancel();
  const token = beginPersistenceRoom(key, userId);
  const context = makeContext(userId, token, roomChanged);
  activeContext = context;
  emitPersistenceStatus();

  const recoveryError = getWorkspaceRecoveryError();
  if (recoveryError) {
    context.error = recoveryError;
    context.hydrated = true;
    completePersistenceRoom(context.token, context.error);
    emitPersistenceStatus();
    return;
  }

  const localStorageUpdatedAt = latestLocalStorageProjectUpdate(userId);

  const loaded = await context.repository.loadWorkspace();
  if (!isCurrent() || generation !== hydrationGeneration || activeContext !== context) return;

  let workspace: Workspace | undefined;
  if (!loaded.ok) {
    context.error = loaded.error.message;
    context.hydrated = true;
    completePersistenceRoom(context.token, context.error);
    emitPersistenceStatus();
    return;
  }
  const remote = await loadRemoteWorkspace();
  if (!isCurrent() || generation !== hydrationGeneration || activeContext !== context) return;
  if (remote) context.remoteRevision = remote.revision;

  const localDurableUpdatedAt = loaded.value
    ? Math.max(
      latestProjectUpdate(loaded.value) ?? 0,
      parsedTimestamp(loaded.value.metadata.updatedAt) ?? 0,
    )
    : 0;
  const remoteUpdatedAt = remote ? parsedTimestamp(remote.updatedAt) ?? 0 : 0;

  if (remote && (!loaded.value || remoteUpdatedAt > localDurableUpdatedAt)) {
    workspace = remote.workspace;
    const cached = await context.repository.saveWorkspace(remote.workspace, {
      ...(loaded.value ? { expectedRevision: loaded.value.metadata.revision } : {}),
      source: "migration",
      ...(getCurrentUserId() ? { updatedBy: getCurrentUserId()! } : {}),
    });
    if (!isCurrent() || generation !== hydrationGeneration || activeContext !== context) return;
    if (cached.ok) context.revision = cached.value.metadata.revision;
  } else if (loaded.value) {
    context.revision = loaded.value.metadata.revision;
    const indexedDbProjectUpdatedAt = latestProjectUpdate(loaded.value);
    const indexedDbMetadataUpdatedAt = parsedTimestamp(loaded.value.metadata.updatedAt);
    const indexedDbUpdatedAt = indexedDbProjectUpdatedAt === null
      ? indexedDbMetadataUpdatedAt
      : indexedDbMetadataUpdatedAt === null
        ? indexedDbProjectUpdatedAt
        : Math.max(indexedDbProjectUpdatedAt, indexedDbMetadataUpdatedAt);
    const localStorageIsNewer = localStorageUpdatedAt !== null
      && (indexedDbUpdatedAt === null || localStorageUpdatedAt > indexedDbUpdatedAt);
    if (context.pendingBeforeHydration || localStorageIsNewer) {
      await preserveCurrentWorkspace(context, loaded.value.metadata.revision, isCurrent);
      if (!isCurrent() || generation !== hydrationGeneration || activeContext !== context) return;
      context.hydrated = true;
      completePersistenceRoom(context.token, context.error);
      emitPersistenceStatus();
      if (context.pendingBeforeHydration) scheduleSave(context);
      return;
    }
    workspace = loaded.value;
  } else {
    const migrated = await migrateLocalStorageWorkspace(context.repository, {
      keys: getSchematicLegacyProjectKeys(userId),
      normalizeProject: (value) => normalizeProject(value),
      getProjectId: (value) => value.id,
      removeLegacy: false,
      updatedBy: userId ?? undefined,
    });
    if (!isCurrent() || generation !== hydrationGeneration || activeContext !== context) return;
    if (migrated.workspace) {
      workspace = migrated.workspace;
      context.revision = migrated.workspace.metadata.revision;
    }
  }

  if (workspace && context.pendingBeforeHydration && context.revision !== null) {
    await preserveCurrentWorkspace(context, context.revision, isCurrent);
    if (!isCurrent() || generation !== hydrationGeneration || activeContext !== context) return;
  } else if (workspace) {
    applyWorkspace(workspace, context);
  }
  context.hydrated = true;
  completePersistenceRoom(context.token, context.error);
  emitPersistenceStatus();
  if (context.pendingBeforeHydration || !workspace) scheduleSave(context);
  else if (!remote) void queueRemoteSave(context, workspace);
}

/** Start the browser-local repository and keep it in sync with the Zustand graph. */
export function startProjectPersistence(): () => void {
  if (typeof window === "undefined") return () => undefined;

  const lifecycleGeneration = ++persistenceLifecycleGeneration;
  let disposed = false;
  let sessionListenerInstalled = false;
  beginPendingPersistenceContext();
  const isCurrent = () => !disposed && persistenceLifecycleGeneration === lifecycleGeneration;
  const unsubscribe = useProjectStore.subscribe(() => {
    const context = activeContext;
    if (!context || context.applying || !context.hydrated) {
      if (context && !context.applying) {
        // reloadForCurrentUser publishes one expected synchronous fallback
        // immediately after a room event. Ignore only that marked projection;
        // every later real edit during the same hydration remains eligible to
        // win the reconciliation below.
        if (!consumeExpectedPersistenceFallback()) context.pendingBeforeHydration = true;
      }
      return;
    }
    scheduleSave(context);
  });
  const flushForPageLifecycle = () => {
    if (!isCurrent()) return;
    const context = activeContext;
    if (!context?.hydrated || !context.saver.pending) return;
    void flushContext(context);
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") flushForPageLifecycle();
  };
  window.addEventListener("pagehide", flushForPageLifecycle);
  document.addEventListener("visibilitychange", onVisibilityChange);
  const onSessionChange = () => {
    if (!isCurrent()) return;
    const key = contextKey(getCurrentUserId());
    // A repeated auth notification for the same subject while IndexedDB is
    // still loading must not replace the real in-flight promise with the
    // resolved promise returned by hydrateForCurrentRoom's no-op path.
    if (activeContext?.key === key && !activeContext.hydrated) return;
    persistenceReady = hydrateForCurrentRoom(isCurrent);
    void persistenceReady;
  };
  // Install the capture-phase listener before the first auth request finishes.
  // A subject can change while the initial room's IndexedDB read is still
  // pending; missing that event would let the old hydration preserve the new
  // subject's synchronous fallback into the wrong room. The listener is
  // idempotent for same-room announcements and the first hydrate call below
  // joins any identical in-flight room.
  sessionListenerInstalled = true;
  window.addEventListener("schematic-session", onSessionChange, { capture: true });
  // Auth must settle before the repository namespace is selected. Otherwise a
  // slow Site session lookup can hydrate the anonymous room and overwrite the
  // authenticated room when the WebMCP registry starts writing immediately.
  persistenceReady = initAuth().then(() => {
    if (!isCurrent()) return;
    const key = contextKey(getCurrentUserId());
    // The capture listener may already have started this exact room while the
    // auth request was settling. Preserve that real in-flight Promise instead
    // of replacing it with hydrateForCurrentRoom's resolved same-room no-op.
    if (activeContext?.key === key && !activeContext.hydrated) return;
    const hydration = hydrateForCurrentRoom(isCurrent);
    persistenceReady = hydration;
    return hydration;
  });

  return () => {
    disposed = true;
    unsubscribe();
    window.removeEventListener("pagehide", flushForPageLifecycle);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    if (sessionListenerInstalled) window.removeEventListener("schematic-session", onSessionChange, { capture: true });
    // A stale StrictMode cleanup must not cancel the context belonging to a
    // newer mount. Its generation guard still invalidates this lifecycle's
    // hydration when the pending auth promise settles.
    if (persistenceLifecycleGeneration !== lifecycleGeneration) return;
    persistenceLifecycleGeneration += 1;
    activeContext?.saver.cancel();
    activeContext = null;
    hydrationGeneration += 1;
    persistenceReady = Promise.resolve();
    clearPersistenceGate();
    emitPersistenceStatus();
  };
}

/** Wait until the auth-scoped workspace has completed its first hydration. */
export function waitForProjectPersistence(): Promise<void> {
  return persistenceReady;
}

/**
 * Wait for the currently selected auth room, not merely the promise that was
 * current when a caller started waiting. A session event can replace that
 * promise while an agent call is already in flight; looping makes the caller
 * join the newer room before it is allowed to mutate anything.
 *
 * `null` is returned when no persistence owner is mounted. That is the
 * intentional in-memory/degraded-runtime mode used by isolated tests.
 */
export async function waitForCurrentProjectPersistence(): Promise<PersistenceContextToken | null> {
  for (;;) {
    const pending = persistenceReady;
    await pending;
    if (pending !== persistenceReady) continue;
    const gate = getPersistenceGate();
    if (!gate) return null;
    if (gate.hydrated) return { generation: gate.generation, roomKey: gate.roomKey, userId: gate.userId };
    // Do not spin on an already-resolved promise while an IndexedDB request is
    // pending. Wait for the next meaningful persistence status transition or a
    // replacement room generation instead.
    const observedGeneration = gate.generation;
    await new Promise<void>((resolve) => {
      const onStatus = () => {
        const latest = getPersistenceGate();
        if (persistenceReady !== pending || latest?.generation !== observedGeneration || latest?.hydrated) {
          statusListeners.delete(onStatus);
          resolve();
        }
      };
      statusListeners.add(onStatus);
      onStatus();
    });
  }
}

/** Snapshot the room lease for an operation that may cross an await. */
export function getProjectPersistenceContext(): PersistenceContextToken | null {
  const gate = getPersistenceGate();
  return gate ? { generation: gate.generation, roomKey: gate.roomKey, userId: gate.userId } : null;
}

/** Return true only when the captured room is still hydrated and current. */
export function isCurrentProjectPersistenceContext(token: PersistenceContextToken | null): boolean {
  const gate = getPersistenceGate();
  if (!gate) return true;
  return gate.hydrated
    && Boolean(token)
    && gate.generation === token?.generation
    && gate.roomKey === token.roomKey
    && gate.userId === token.userId;
}

/** Flush the current debounced write when an explicit Save action needs certainty. */
export async function flushProjectPersistence(): Promise<StoredWorkspace<HardwareGraph> | null> {
  const context = activeContext;
  if (!context) return null;
  return flushContext(context);
}

/** Subscribe to loading/saving/failure changes for honest workspace status UI. */
export function subscribeProjectPersistenceStatus(listener: () => void) {
  statusListeners.add(listener);
  return () => { statusListeners.delete(listener); };
}

export function getProjectPersistenceStatus() {
  const hydrated = activeContext?.hydrated ?? false;
  const pending = activeContext?.saver.pending ?? false;
  const error = activeContext?.error ?? null;
  const gate = getPersistenceGate();
  return {
    backend: "indexeddb" as const,
    roomId: ROOM_ID,
    userId: activeContext?.userId ?? gate?.userId ?? getCurrentUserId(),
    roomKey: activeContext?.key ?? gate?.roomKey ?? contextKey(getCurrentUserId()),
    generation: activeContext?.token.generation ?? gate?.generation ?? 0,
    hydrated,
    pending,
    revision: activeContext?.revision ?? null,
    remoteRevision: activeContext?.remoteRevision ?? null,
    error,
    state: !hydrated ? "loading" as const : pending ? "saving" as const : error ? "error" as const : "saved" as const,
  };
}
