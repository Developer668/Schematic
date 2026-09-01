import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectRepository, type StoredWorkspace, type WorkspaceSnapshot } from "@schematic/project-storage";

const authGate = vi.hoisted(() => {
  let resolveGate: (value: null) => void = () => undefined;
  let promise: Promise<null>;
  const reset = () => {
    promise = new Promise<null>((resolve) => { resolveGate = resolve; });
  };
  reset();
  return {
    initAuth: vi.fn(() => promise),
    getCurrentUserId: vi.fn(() => null as string | null),
    reset,
    resolve: (value: null) => resolveGate(value),
  };
});

vi.mock("../auth/session.ts", () => ({
  initAuth: authGate.initAuth,
  getCurrentUserId: authGate.getCurrentUserId,
}));

import {
  flushProjectPersistence,
  getProjectPersistenceStatus,
  startProjectPersistence,
  waitForProjectPersistence,
} from "../store/projectPersistence.ts";
import { useProjectStore, type HardwareGraph } from "../store/useProjectStore.ts";

const namespace = { roomId: "workspace", userId: null, key: "v1:user:anonymous:room:workspace" };

function project(name: string, updatedAt: string): HardwareGraph {
  return {
    id: "project-1",
    name,
    components: [],
    connections: [],
    firmwareTargets: [],
    simulation: { mode: "interactive", engines: {} },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
    version: 1,
  };
}

function storedWorkspace(
  workspaceProject: HardwareGraph,
  revision: number,
  source: "save" | "migration" = "save",
): StoredWorkspace<HardwareGraph> {
  return {
    version: 1,
    activeProjectId: workspaceProject.id,
    projects: [workspaceProject],
    namespace,
    metadata: { revision, updatedAt: "2026-08-31T00:00:00.000Z", source },
  };
}

function setCurrentProject(workspaceProject: HardwareGraph) {
  useProjectStore.setState({
    project: workspaceProject,
    projects: [workspaceProject],
    activeProjectId: workspaceProject.id,
  });
}

async function settlePromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("project persistence lifecycle", () => {
  let stop: (() => void) | undefined;
  let visibilityStateDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    authGate.reset();
    authGate.initAuth.mockClear();
    authGate.getCurrentUserId.mockReset();
    authGate.getCurrentUserId.mockReturnValue(null);
    localStorage.clear();
    setCurrentProject(project("Initial", "2026-01-01T00:00:00.000Z"));
    visibilityStateDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (visibilityStateDescriptor) {
      Object.defineProperty(document, "visibilityState", visibilityStateDescriptor);
    } else {
      Reflect.deleteProperty(document, "visibilityState");
    }
  });

  it("does not start hydration after its mount is disposed while auth is pending", async () => {
    const loadWorkspace = vi.spyOn(ProjectRepository.prototype, "loadWorkspace").mockResolvedValue({ ok: true, value: null } as never);
    stop = startProjectPersistence();
    expect(authGate.initAuth).toHaveBeenCalledTimes(1);

    stop();
    stop = undefined;
    authGate.resolve(null);
    await settlePromises();

    expect(loadWorkspace).not.toHaveBeenCalled();
    expect(getProjectPersistenceStatus().hydrated).toBe(false);
  });

  it("preserves and checkpoints a newer synchronous localStorage snapshot over older IndexedDB", async () => {
    // The workspace timestamp, not a surviving project's timestamp, proves
    // collection-only changes such as deletion/switching happened later.
    const recent = project("Recent local edit", "2026-08-30T09:00:00.000Z");
    const stale = project("Stale IndexedDB edit", "2026-08-30T10:00:00.000Z");
    localStorage.setItem("schematic-projects", JSON.stringify({
      version: 1,
      activeProjectId: recent.id,
      projects: [recent],
      updatedAt: "2026-08-31T10:01:00.000Z",
    }));
    setCurrentProject(recent);
    vi.spyOn(ProjectRepository.prototype, "loadWorkspace").mockResolvedValue({
      ok: true,
      value: storedWorkspace(stale, 7),
    } as never);
    const saveWorkspace = vi.spyOn(ProjectRepository.prototype, "saveWorkspace").mockResolvedValue({
      ok: true,
      value: storedWorkspace(recent, 8, "migration"),
    } as never);

    stop = startProjectPersistence();
    authGate.resolve(null);
    await waitForProjectPersistence();

    expect(useProjectStore.getState().project.name).toBe("Recent local edit");
    expect(saveWorkspace).toHaveBeenCalledTimes(1);
    const [saved, options] = saveWorkspace.mock.calls[0] as unknown as [WorkspaceSnapshot<HardwareGraph>, Record<string, unknown>];
    expect(saved.projects[0].name).toBe("Recent local edit");
    expect(options).toMatchObject({ expectedRevision: 7, source: "migration" });
    expect(getProjectPersistenceStatus()).toMatchObject({
      hydrated: true,
      pending: false,
      revision: 8,
      error: null,
      state: "saved",
    });
  });

  it("still hydrates from IndexedDB when its project data is newer", async () => {
    const stale = project("Stale local edit", "2026-08-30T10:00:00.000Z");
    // The remaining project's timestamp predates the local collection change,
    // but IndexedDB metadata proves its collection revision is newer (for
    // example, it deleted another project without editing this one).
    const recent = project("Recent IndexedDB edit", "2026-08-30T09:00:00.000Z");
    localStorage.setItem("schematic-projects", JSON.stringify({
      version: 1,
      activeProjectId: stale.id,
      projects: [stale],
      updatedAt: "2026-08-30T11:00:00.000Z",
    }));
    setCurrentProject(stale);
    vi.spyOn(ProjectRepository.prototype, "loadWorkspace").mockResolvedValue({
      ok: true,
      value: storedWorkspace(recent, 9),
    } as never);
    const saveWorkspace = vi.spyOn(ProjectRepository.prototype, "saveWorkspace");

    stop = startProjectPersistence();
    authGate.resolve(null);
    await waitForProjectPersistence();

    expect(useProjectStore.getState().project.name).toBe("Recent IndexedDB edit");
    expect(saveWorkspace).not.toHaveBeenCalled();
    expect(getProjectPersistenceStatus()).toMatchObject({ hydrated: true, revision: 9, state: "saved" });
  });

  it("does not replace a store update made while IndexedDB hydration is in flight", async () => {
    const stale = project("Stale IndexedDB edit", "2026-08-30T10:00:00.000Z");
    const live = project("Live edit during hydration", "2026-08-31T10:00:00.000Z");
    let resolveLoad: (value: { ok: true; value: StoredWorkspace<HardwareGraph> }) => void = () => undefined;
    const loadPromise = new Promise<{ ok: true; value: StoredWorkspace<HardwareGraph> }>((resolve) => {
      resolveLoad = resolve;
    });
    const loadWorkspace = vi.spyOn(ProjectRepository.prototype, "loadWorkspace").mockReturnValue(loadPromise as never);
    const saveWorkspace = vi.spyOn(ProjectRepository.prototype, "saveWorkspace").mockResolvedValue({
      ok: true,
      value: storedWorkspace(live, 5, "migration"),
    } as never);

    stop = startProjectPersistence();
    authGate.resolve(null);
    await settlePromises();
    expect(loadWorkspace).toHaveBeenCalledTimes(1);

    setCurrentProject(live);
    resolveLoad({ ok: true, value: storedWorkspace(stale, 4) });
    await waitForProjectPersistence();

    expect(useProjectStore.getState().project.name).toBe("Live edit during hydration");
    const [saved, options] = saveWorkspace.mock.calls[0] as unknown as [WorkspaceSnapshot<HardwareGraph>, Record<string, unknown>];
    expect(saved.projects[0].name).toBe("Live edit during hydration");
    expect(options).toMatchObject({ expectedRevision: 4, source: "migration" });
  });

  it("best-effort flushes pending saves on pagehide, hidden visibility, and explicit save", async () => {
    vi.useFakeTimers();
    const initial = project("Initial IndexedDB edit", "2026-08-31T08:00:00.000Z");
    vi.spyOn(ProjectRepository.prototype, "loadWorkspace").mockResolvedValue({
      ok: true,
      value: storedWorkspace(initial, 3),
    } as never);
    const saveWorkspace = vi.spyOn(ProjectRepository.prototype, "saveWorkspace").mockResolvedValue({
      ok: true,
      value: storedWorkspace(initial, 4),
    } as never);

    stop = startProjectPersistence();
    authGate.resolve(null);
    await waitForProjectPersistence();

    setCurrentProject(project("Edit before pagehide", "2026-08-31T09:00:00.000Z"));
    expect(getProjectPersistenceStatus()).toMatchObject({ pending: true, state: "saving" });
    expect(saveWorkspace).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("pagehide"));
    await settlePromises();
    expect(saveWorkspace).toHaveBeenCalledTimes(1);

    setCurrentProject(project("Edit before hidden", "2026-08-31T10:00:00.000Z"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    await settlePromises();
    expect(saveWorkspace).toHaveBeenCalledTimes(2);

    setCurrentProject(project("Edit before explicit save", "2026-08-31T11:00:00.000Z"));
    const flushed = await flushProjectPersistence();
    expect(saveWorkspace).toHaveBeenCalledTimes(3);
    expect(flushed?.metadata.revision).toBe(4);
    expect(getProjectPersistenceStatus()).toMatchObject({ pending: false, revision: 4, state: "saved" });

    setCurrentProject(project("Edit before teardown", "2026-08-31T12:00:00.000Z"));
    expect(getProjectPersistenceStatus().pending).toBe(true);
    stop();
    stop = undefined;
    window.dispatchEvent(new Event("pagehide"));
    document.dispatchEvent(new Event("visibilitychange"));
    await settlePromises();
    expect(saveWorkspace).toHaveBeenCalledTimes(3);
    expect(getProjectPersistenceStatus().hydrated).toBe(false);
  });
});
