import {
  createDebouncedWorkspaceSaver,
  getSchematicLegacyProjectKeys,
  migrateLocalStorageWorkspace,
  ProjectRepository,
  type StoredWorkspace,
  type WorkspaceSnapshot,
} from "@schematic/project-storage";
import { getCurrentUserId } from "../auth/session.ts";
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

async function hydrateForCurrentRoom(): Promise<void> {
  const generation = ++hydrationGeneration;
  const userId = getCurrentUserId();
  const key = contextKey(userId);
  if (activeContext?.key === key && activeContext.hydrated) return;

  activeContext?.saver.cancel();
  const context = makeContext(userId);
  activeContext = context;

  const loaded = await context.repository.loadWorkspace();
  if (generation !== hydrationGeneration || activeContext !== context) return;

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
    if (generation !== hydrationGeneration || activeContext !== context) return;
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

  const unsubscribe = useProjectStore.subscribe(() => {
    const context = activeContext;
    if (!context || context.applying || !context.hydrated) {
      if (context && !context.applying) context.pendingBeforeHydration = true;
      return;
    }
    scheduleSave(context);
  });
  const onSessionChange = () => { void hydrateForCurrentRoom(); };
  window.addEventListener("schematic-session", onSessionChange);
  void hydrateForCurrentRoom();

  return () => {
    unsubscribe();
    window.removeEventListener("schematic-session", onSessionChange);
    activeContext?.saver.cancel();
    activeContext = null;
    hydrationGeneration += 1;
  };
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
