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
    getAuthSession: vi.fn(async () => {
      const subject = authGate.getCurrentUserId() ?? "anonymous";
      return { authenticated: true, subject, userId: subject, environment: "local" as const };
    }),
    getAuthHeaders: vi.fn(async () => ({})),
    apiUrl: (path: string) => path,
    waitForAuth: vi.fn(async () => authGate.getAuthSession()),
    reset,
    resolve: (value: null) => resolveGate(value),
  };
});

vi.mock("../auth/session.ts", () => ({
  initAuth: authGate.initAuth,
  getCurrentUserId: authGate.getCurrentUserId,
  getAuthSession: authGate.getAuthSession,
  getAuthHeaders: authGate.getAuthHeaders,
  apiUrl: authGate.apiUrl,
  waitForAuth: authGate.waitForAuth,
}));

vi.mock("../store/remoteProjectPersistence.ts", () => ({
  loadRemoteWorkspace: vi.fn(async () => null),
  saveRemoteWorkspace: vi.fn(async () => null),
}));

import {
  flushProjectPersistence,
  getProjectPersistenceStatus,
  startProjectPersistence,
  waitForProjectPersistence,
  waitForCurrentProjectPersistence,
} from "../store/projectPersistence.ts";
import { useProjectStore, type HardwareGraph } from "../store/useProjectStore.ts";
import { invokeWebMCPTool } from "../webmcp/tools.ts";

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
    vi.unstubAllGlobals();
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

  it("blocks UI and WebMCP mutations across a subject switch until the new room is hydrated", async () => {
    const durableA = project("User A durable", "2026-08-31T08:00:00.000Z");
    const durableB = project("User B durable", "2026-08-31T10:00:00.000Z");
    const localB = project("User B local fallback", "2026-08-31T09:00:00.000Z");
    authGate.getCurrentUserId.mockReturnValue("user-a");

    let resolveB: (value: { ok: true; value: StoredWorkspace<HardwareGraph> }) => void = () => undefined;
    const bLoad = new Promise<{ ok: true; value: StoredWorkspace<HardwareGraph> }>((resolve) => { resolveB = resolve; });
    const loadWorkspace = vi.spyOn(ProjectRepository.prototype, "loadWorkspace").mockImplementation(function (this: ProjectRepository<HardwareGraph>) {
      return this.namespace.userId === "user-b"
        ? bLoad as never
        : Promise.resolve({ ok: true, value: storedWorkspace(durableA, 1) }) as never;
    });
    const saveWorkspace = vi.spyOn(ProjectRepository.prototype, "saveWorkspace").mockResolvedValue({
      ok: true,
      value: storedWorkspace(durableA, 2, "migration"),
    } as never);

    stop = startProjectPersistence();
    authGate.resolve(null);
    await waitForProjectPersistence();
    await settlePromises(); // let the capture-phase session listener install
    expect(loadWorkspace).toHaveBeenCalledTimes(1);
    expect(useProjectStore.getState().project.name).toBe("User A durable");

    localStorage.setItem("schematic-projects:user-b", JSON.stringify({
      version: 1,
      activeProjectId: localB.id,
      projects: [localB],
      updatedAt: "2026-08-31T09:00:00.000Z",
    }));
    authGate.getCurrentUserId.mockReturnValue("user-b");
    window.dispatchEvent(new Event("schematic-session"));

    // The project store has switched to its synchronous B-room fallback, but
    // the durable B room is still loading. Neither UI store methods nor the
    // already-registered WebMCP surface may write during this interval.
    expect(getProjectPersistenceStatus()).toMatchObject({ userId: "user-b", hydrated: false });
    expect(useProjectStore.getState().project.name).toBe("User B local fallback");
    let waiterSettled = false;
    const roomWaiter = waitForCurrentProjectPersistence().then(() => { waiterSettled = true; });
    await settlePromises();
    expect(waiterSettled).toBe(false);
    // Token refresh/session re-announcement for the same subject must join the
    // existing B hydration rather than replacing its pending promise.
    window.dispatchEvent(new Event("schematic-session"));
    await settlePromises();
    expect(waiterSettled).toBe(false);
    expect(() => useProjectStore.getState().renameProject(useProjectStore.getState().activeProjectId, "poisoned UI write")).toThrow("room is changing");
    const blocked = await invokeWebMCPTool("project.rename", { name: "poisoned agent write" });
    expect(blocked).toMatchObject({ isError: true, error: { code: "PERSISTENCE_NOT_READY", retryable: true }, data: { unchanged: true } });
    expect(useProjectStore.getState().project.name).toBe("User B local fallback");
    expect(saveWorkspace).not.toHaveBeenCalled();

    resolveB({ ok: true, value: storedWorkspace(durableB, 7) });
    await waitForProjectPersistence();
    await roomWaiter;
    expect(getProjectPersistenceStatus()).toMatchObject({ userId: "user-b", hydrated: true, revision: 7 });
    expect(useProjectStore.getState().project.name).toBe("User B durable");
    expect(saveWorkspace).not.toHaveBeenCalled();
    const loadsAfterB = loadWorkspace.mock.calls.length;
    // A normal token refresh/identity re-announcement for the same subject
    // must not create a fresh room generation or re-read IndexedDB.
    window.dispatchEvent(new Event("schematic-session"));
    await settlePromises();
    expect(loadWorkspace).toHaveBeenCalledTimes(loadsAfterB);
    expect(getProjectPersistenceStatus()).toMatchObject({ userId: "user-b", hydrated: true });
    // A same-room refresh must not re-read the synchronous localStorage
    // fallback and roll the hydrated IndexedDB snapshot back.
    expect(useProjectStore.getState().project.name).toBe("User B durable");
  });

  it("does not miss a subject switch while the initial room is still hydrating", async () => {
    const durableA = project("User A durable", "2026-08-31T08:00:00.000Z");
    const durableB = project("User B durable", "2026-08-31T10:00:00.000Z");
    const localB = project("User B local fallback", "2026-08-31T09:00:00.000Z");
    authGate.getCurrentUserId.mockReturnValue("user-a");

    let resolveA: (value: { ok: true; value: StoredWorkspace<HardwareGraph> }) => void = () => undefined;
    let resolveB: (value: { ok: true; value: StoredWorkspace<HardwareGraph> }) => void = () => undefined;
    const aLoad = new Promise<{ ok: true; value: StoredWorkspace<HardwareGraph> }>((resolve) => { resolveA = resolve; });
    const bLoad = new Promise<{ ok: true; value: StoredWorkspace<HardwareGraph> }>((resolve) => { resolveB = resolve; });
    vi.spyOn(ProjectRepository.prototype, "loadWorkspace").mockImplementation(function (this: ProjectRepository<HardwareGraph>) {
      return this.namespace.userId === "user-b" ? bLoad as never : aLoad as never;
    });
    const saveWorkspace = vi.spyOn(ProjectRepository.prototype, "saveWorkspace");

    stop = startProjectPersistence();
    authGate.resolve(null);
    await settlePromises();
    expect(getProjectPersistenceStatus()).toMatchObject({ userId: "user-a", hydrated: false });

    localStorage.setItem("schematic-projects:user-b", JSON.stringify({
      version: 1,
      activeProjectId: localB.id,
      projects: [localB],
      updatedAt: "2026-08-31T09:00:00.000Z",
    }));
    authGate.getCurrentUserId.mockReturnValue("user-b");
    window.dispatchEvent(new Event("schematic-session"));
    expect(getProjectPersistenceStatus()).toMatchObject({ userId: "user-b", hydrated: false });
    expect(useProjectStore.getState().project.name).toBe("User B local fallback");

    // Completion of the abandoned A request must not preserve B's synchronous
    // fallback into A or replace the pending B promise.
    resolveA({ ok: true, value: storedWorkspace(durableA, 3) });
    await settlePromises();
    expect(getProjectPersistenceStatus()).toMatchObject({ userId: "user-b", hydrated: false });
    expect(saveWorkspace).not.toHaveBeenCalled();

    resolveB({ ok: true, value: storedWorkspace(durableB, 7) });
    await waitForProjectPersistence();
    expect(getProjectPersistenceStatus()).toMatchObject({ userId: "user-b", hydrated: true, revision: 7 });
    expect(useProjectStore.getState().project.name).toBe("User B durable");
    expect(saveWorkspace).not.toHaveBeenCalled();
  });

  it("does not preserve the synchronous authenticated fallback over newer IndexedDB on initial auth", async () => {
    const durableB = project("User B durable", "2026-08-31T10:00:00.000Z");
    // Start anonymous, as the hosted browser does before the session endpoint
    // resolves. There is deliberately no B localStorage record: the
    // synchronous room swap will create an empty fallback before IndexedDB
    // returns the durable project.
    authGate.getCurrentUserId.mockReturnValue(null);
    const loadWorkspace = vi.spyOn(ProjectRepository.prototype, "loadWorkspace").mockImplementation(function (this: ProjectRepository<HardwareGraph>) {
      return this.namespace.userId === "user-b"
        ? Promise.resolve({ ok: true, value: storedWorkspace(durableB, 7) }) as never
        : Promise.resolve({ ok: true, value: null }) as never;
    });
    const saveWorkspace = vi.spyOn(ProjectRepository.prototype, "saveWorkspace");

    stop = startProjectPersistence();
    authGate.getCurrentUserId.mockReturnValue("user-b");
    window.dispatchEvent(new Event("schematic-session"));
    expect(getProjectPersistenceStatus()).toMatchObject({ userId: "user-b", hydrated: false });

    authGate.resolve(null);
    await waitForProjectPersistence();

    expect(loadWorkspace).toHaveBeenCalledTimes(1);
    expect(useProjectStore.getState().project.name).toBe("User B durable");
    expect(saveWorkspace).not.toHaveBeenCalled();
  });

  it("discards an in-flight shopping response from the old room", async () => {
    const durableA = project("User A durable", "2026-08-31T08:00:00.000Z");
    const durableB = project("User B durable", "2026-08-31T10:00:00.000Z");
    authGate.getCurrentUserId.mockReturnValue("user-a");

    let resolveB: (value: { ok: true; value: StoredWorkspace<HardwareGraph> }) => void = () => undefined;
    const bLoad = new Promise<{ ok: true; value: StoredWorkspace<HardwareGraph> }>((resolve) => { resolveB = resolve; });
    vi.spyOn(ProjectRepository.prototype, "loadWorkspace").mockImplementation(function (this: ProjectRepository<HardwareGraph>) {
      return this.namespace.userId === "user-b"
        ? bLoad as never
        : Promise.resolve({ ok: true, value: storedWorkspace(durableA, 1) }) as never;
    });
    const saveWorkspace = vi.spyOn(ProjectRepository.prototype, "saveWorkspace").mockResolvedValue({
      ok: true,
      value: storedWorkspace(durableA, 2, "migration"),
    } as never);

    let resolveFetch: (value: Response) => void = () => undefined;
    const fetchRequest = new Promise<Response>((resolve) => { resolveFetch = resolve; });
    vi.stubGlobal("fetch", vi.fn(() => fetchRequest));
    stop = startProjectPersistence();
    authGate.resolve(null);
    await waitForProjectPersistence();
    await settlePromises();

    const pendingSearch = invokeWebMCPTool("shopping.search", { query: "ESP32", quantity: 1 });
    await settlePromises();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    const bShoppingBefore = JSON.stringify({
      query: "B sentinel",
      results: [],
      cart: [],
      budget: null,
      lastSearchAt: null,
      handoff: null,
      discovery: null,
    });
    localStorage.setItem("schematic-shopping:user-b", bShoppingBefore);
    authGate.getCurrentUserId.mockReturnValue("user-b");
    window.dispatchEvent(new Event("schematic-session"));
    expect(getProjectPersistenceStatus()).toMatchObject({ userId: "user-b", hydrated: false });

    // Resolve the old request only after the subject changed. Its continuation
    // must fail the captured A generation before it can persist under B.
    resolveFetch(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    resolveB({ ok: true, value: storedWorkspace(durableB, 7) });
    await waitForProjectPersistence();
    await expect(pendingSearch).resolves.toMatchObject({ isError: true, error: { code: "PERSISTENCE_NOT_READY", retryable: true } });
    expect(localStorage.getItem("schematic-shopping:user-b")).toBe(bShoppingBefore);
    expect(saveWorkspace).not.toHaveBeenCalled();
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
