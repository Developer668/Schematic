import {
  createDebouncedWorkspaceSaver,
  getSchematicLegacyProjectKeys,
  migrateLocalStorageWorkspace,
  ProjectRepository,
  type StoredWorkspace,
  type WorkspaceSnapshot,
} from "@schematic/project-storage";
import { getCurrentUserId, initAuth } from "../auth/session.ts";
import { normalizeProject, useProjectStore, type HardwareGraph } from "./useProjectStore.ts";

const ROOM_ID = "workspace";
const SAVE_DELAY_MS = 500;

type Workspace = WorkspaceSnapshot<HardwareGraph>;

interface PersistenceContext {
  key: string;
  repository: ProjectRepository<HardwareGraph>;
  saver: ReturnType<typeof createDebouncedWorkspaceSaver<HardwareGraph>>;
  hydrated: boolean;
  applying: boolean;
  pendingBeforeHydration: boolean;
  revision: number | null;
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
  const projects = workspace.projects.map((project) => normalizeProject(project));
  if (!projects.length) return false;
  const activeProjectId = projects.some((project) => project.id === workspace.activeProjectId)
    ? workspace.activeProjectId
    : projects[0].id;
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
  if (activeContext !== context || !context.hydrated) return;
  context.error = null;
  const save = context.saver.schedule(currentWorkspace(), {
    source: "save",
    ...(getCurrentUserId() ? { updatedBy: getCurrentUserId()! } : {}),
  });
  emitPersistenceStatus();
  void save.then((result) => {
    if (activeContext !== context) return;
    if (result.ok) context.revision = result.value.metadata.revision;
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

function makeContext(userId: string | null): PersistenceContext {
  const repository = new ProjectRepository<HardwareGraph>({
    namespace: { roomId: ROOM_ID, userId },
  });
  return {
    key: contextKey(userId),
    repository,
    saver: createDebouncedWorkspaceSaver(repository, SAVE_DELAY_MS),
    hydrated: false,
    applying: false,
    pendingBeforeHydration: false,
    revision: null,
    error: null,
  };
}

async function hydrateForCurrentRoom(isCurrent: () => boolean = () => true): Promise<void> {
  if (!isCurrent()) return;
  const generation = ++hydrationGeneration;
  const userId = getCurrentUserId();
  const key = contextKey(userId);
  if (activeContext?.key === key && activeContext.hydrated) return;

  activeContext?.saver.cancel();
  const context = makeContext(userId);
  activeContext = context;
  emitPersistenceStatus();

  const localStorageUpdatedAt = latestLocalStorageProjectUpdate(userId);

  const loaded = await context.repository.loadWorkspace();
  if (!isCurrent() || generation !== hydrationGeneration || activeContext !== context) return;

  let workspace: Workspace | undefined;
  if (!loaded.ok) {
    context.error = loaded.error.message;
    context.hydrated = true;
    emitPersistenceStatus();
    return;
  }
  if (loaded.value) {
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
  emitPersistenceStatus();
  if (context.pendingBeforeHydration || !workspace) scheduleSave(context);
}

/** Start the browser-local repository and keep it in sync with the Zustand graph. */
export function startProjectPersistence(): () => void {
  if (typeof window === "undefined") return () => undefined;

  const lifecycleGeneration = ++persistenceLifecycleGeneration;
  let disposed = false;
  const isCurrent = () => !disposed && persistenceLifecycleGeneration === lifecycleGeneration;
  const unsubscribe = useProjectStore.subscribe(() => {
    const context = activeContext;
    if (!context || context.applying || !context.hydrated) {
      if (context && !context.applying) context.pendingBeforeHydration = true;
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
    persistenceReady = hydrateForCurrentRoom(isCurrent);
    void persistenceReady;
  };
  // Auth must settle before the repository namespace is selected. Otherwise a
  // slow Site session lookup can hydrate the anonymous room and overwrite the
  // authenticated room when the WebMCP registry starts writing immediately.
  persistenceReady = initAuth().then(() => isCurrent() ? hydrateForCurrentRoom(isCurrent) : undefined);
  void persistenceReady.then(() => {
    if (isCurrent()) window.addEventListener("schematic-session", onSessionChange);
  });

  return () => {
    disposed = true;
    unsubscribe();
    window.removeEventListener("pagehide", flushForPageLifecycle);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("schematic-session", onSessionChange);
    // A stale StrictMode cleanup must not cancel the context belonging to a
    // newer mount. Its generation guard still invalidates this lifecycle's
    // hydration when the pending auth promise settles.
    if (persistenceLifecycleGeneration !== lifecycleGeneration) return;
    persistenceLifecycleGeneration += 1;
    activeContext?.saver.cancel();
    activeContext = null;
    hydrationGeneration += 1;
    persistenceReady = Promise.resolve();
    emitPersistenceStatus();
  };
}

/** Wait until the auth-scoped workspace has completed its first hydration. */
export function waitForProjectPersistence(): Promise<void> {
  return persistenceReady;
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
  return {
    backend: "indexeddb" as const,
    roomId: ROOM_ID,
    userId: getCurrentUserId(),
    hydrated,
    pending,
    revision: activeContext?.revision ?? null,
    error,
    state: !hydrated ? "loading" as const : pending ? "saving" as const : error ? "error" as const : "saved" as const,
  };
}
