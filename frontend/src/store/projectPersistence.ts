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
}

let activeContext: PersistenceContext | null = null;
let hydrationGeneration = 0;
let persistenceLifecycleGeneration = 0;
let persistenceReady: Promise<void> = Promise.resolve();

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
  const save = context.saver.schedule(currentWorkspace(), {
    source: "save",
    ...(getCurrentUserId() ? { updatedBy: getCurrentUserId()! } : {}),
  });
  void save.then((result) => {
    if (activeContext !== context || !result.ok) return;
    context.revision = result.value.metadata.revision;
  });
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

  const loaded = await context.repository.loadWorkspace();
  if (!isCurrent() || generation !== hydrationGeneration || activeContext !== context) return;

  let workspace: Workspace | undefined;
  if (loaded.ok && loaded.value) {
    workspace = loaded.value;
    context.revision = loaded.value.metadata.revision;
  } else if (loaded.ok) {
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

  if (workspace) applyWorkspace(workspace, context);
  context.hydrated = true;
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
  const result = await context.saver.flush();
  if (result?.ok) context.revision = result.value.metadata.revision;
  return result?.ok ? result.value : null;
}

export function getProjectPersistenceStatus() {
  return {
    backend: "indexeddb" as const,
    roomId: ROOM_ID,
    userId: getCurrentUserId(),
    hydrated: activeContext?.hydrated ?? false,
    pending: activeContext?.saver.pending ?? false,
    revision: activeContext?.revision ?? null,
  };
}
