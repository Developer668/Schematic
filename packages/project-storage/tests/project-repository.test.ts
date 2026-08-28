import { describe, expect, it } from "vitest";
import {
  ProjectRepository,
  createDebouncedWorkspaceSaver,
  getSchematicLegacyProjectKeys,
  namespaceKey,
  migrateLocalStorageWorkspace,
  type LegacyStorageLike,
  type WorkspaceSnapshot,
} from "../src/index";
import { FakeIndexedDBFactory } from "./support/fake-indexeddb";

interface TestProject {
  id: string;
  name: string;
  payload?: string;
}

const namespace = { roomId: "room-a", userId: "user-a" } as const;

function workspace(name = "first", id = "project-1"): WorkspaceSnapshot<TestProject> {
  return {
    version: 1,
    activeProjectId: id,
    projects: [{ id, name }],
  };
}

function repository(factory: FakeIndexedDBFactory, dbName = "test-project-storage") {
  return new ProjectRepository<TestProject>({
    namespace,
    indexedDB: factory as unknown as IDBFactory,
    dbName,
    now: (() => {
      let tick = 0;
      return () => `2026-01-01T00:00:0${tick++}.000Z`;
    })(),
  });
}

function memoryStorage(initial: Record<string, string> = {}): LegacyStorageLike & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

describe("ProjectRepository", () => {
  it("saves and loads a namespaced workspace with revision metadata", async () => {
    const factory = new FakeIndexedDBFactory();
    const repo = repository(factory);

    const saved = await repo.saveWorkspace(workspace(), { expectedRevision: null, updatedBy: "test" });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.metadata.revision).toBe(1);
    expect(saved.value.metadata.updatedBy).toBe("test");
    expect(saved.value.namespace.key).toBe(namespaceKey(namespace));

    const loaded = await repo.loadWorkspace();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok || !loaded.value) return;
    expect(loaded.value.projects[0].name).toBe("first");
    expect(loaded.value.metadata.revision).toBe(1);

    const otherRoom = new ProjectRepository<TestProject>({
      namespace: { roomId: "room-b", userId: "user-a" },
      indexedDB: factory as unknown as IDBFactory,
      dbName: "test-project-storage",
    });
    const other = await otherRoom.loadWorkspace();
    expect(other.ok).toBe(true);
    expect(other.ok && other.value).toBeNull();
  });

  it("increments revisions and rejects stale optimistic writes", async () => {
    const factory = new FakeIndexedDBFactory();
    const repo = repository(factory);
    const first = await repo.saveWorkspace(workspace(), { expectedRevision: null });
    expect(first.ok).toBe(true);

    const second = await repo.saveWorkspace(workspace("second"), { expectedRevision: 1 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.metadata.revision).toBe(2);

    const conflict = await repo.saveWorkspace(workspace("stale"), { expectedRevision: 1 });
    expect(conflict.ok).toBe(false);
    if (conflict.ok) return;
    expect(conflict.error.code).toBe("conflict");
    expect(conflict.error.details?.currentRevision).toBe(2);
  });

  it("returns a corrupt-record result instead of trusting malformed IndexedDB data", async () => {
    const factory = new FakeIndexedDBFactory();
    const dbName = "test-corrupt-record";
    factory.seed(dbName, "workspaces", namespaceKey(namespace), { namespaceKey: namespaceKey(namespace), workspace: [] });
    const loaded = await repository(factory, dbName).loadWorkspace();
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe("corrupt-record");
  });

  it("maps quota and unavailable errors without throwing", async () => {
    const factory = new FakeIndexedDBFactory();
    factory.failNext("put", "QuotaExceededError", "storage full");
    const quota = await repository(factory, "test-quota").saveWorkspace(workspace(), { expectedRevision: null });
    expect(quota.ok).toBe(false);
    if (!quota.ok) expect(quota.error.code).toBe("quota-exceeded");

    const unavailable = await new ProjectRepository<TestProject>({ namespace }).loadWorkspace();
    expect(unavailable.ok).toBe(false);
    if (!unavailable.ok) expect(unavailable.error.code).toBe("unavailable");
  });

  it("exports one project and imports it into another namespace with boundary checks", async () => {
    const factory = new FakeIndexedDBFactory();
    const source = repository(factory, "test-export-source");
    await source.saveWorkspace({ version: 1, activeProjectId: "project-1", projects: [workspace().projects[0], { id: "project-2", name: "second" }] }, { expectedRevision: null });

    const exported = await source.exportProject("project-2");
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.value.filename).toBe("project-2.schematic.json");
    const envelope = JSON.parse(await exported.value.blob.text()) as Record<string, unknown>;
    expect(envelope.format).toBe("schematic-project");
    expect(envelope.projectId).toBe("project-2");
    expect(envelope.namespace).toBeUndefined();

    const target = new ProjectRepository<TestProject>({
      namespace: { roomId: "import-room", userId: "user-a" },
      indexedDB: factory as unknown as IDBFactory,
      dbName: "test-export-target",
    });
    const imported = await target.importProject(exported.value.blob);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.project.name).toBe("second");
    expect(imported.value.workspace.activeProjectId).toBe("project-2");

    const collision = await target.importProject(exported.value.blob);
    expect(collision.ok).toBe(false);
    if (!collision.ok) expect(collision.error.code).toBe("conflict");

    const replaced = await target.importProject(exported.value.blob, { collision: "replace" });
    expect(replaced.ok).toBe(true);

    const invalid = await target.importProject("not-json");
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe("invalid-input");

    const bounded = new ProjectRepository<TestProject>({
      namespace: { roomId: "bounded", userId: "user-a" },
      indexedDB: factory as unknown as IDBFactory,
      dbName: "test-export-target",
      maxImportBytes: 16,
    });
    const tooLarge = await bounded.importProject("{" + "x".repeat(64));
    expect(tooLarge.ok).toBe(false);
    if (!tooLarge.ok) expect(tooLarge.error.code).toBe("quota-exceeded");
  });
});

describe("localStorage migration", () => {
  it("migrates the current multi-project shape and preserves the legacy key by default", async () => {
    const factory = new FakeIndexedDBFactory();
    const storage = memoryStorage({
      "schematic-projects:user-a": JSON.stringify({
        version: 1,
        activeProjectId: "project-2",
        projects: [{ id: "project-1", name: "one" }, { id: "project-2", name: "two" }],
      }),
    });
    const repo = repository(factory, "test-migration");
    const outcome = await migrateLocalStorageWorkspace(repo, {
      keys: getSchematicLegacyProjectKeys("user-a"),
      storage,
      updatedBy: "migration-test",
    });
    expect(outcome.status).toBe("migrated");
    expect(outcome.key).toBe("schematic-projects:user-a");
    expect(outcome.workspace?.activeProjectId).toBe("project-2");
    expect(storage.values.has("schematic-projects:user-a")).toBe(true);

    const repeat = await migrateLocalStorageWorkspace(repo, {
      keys: getSchematicLegacyProjectKeys("user-a"),
      storage,
    });
    expect(repeat.status).toBe("already-present");
  });

  it("migrates a legacy singleton, can remove it, and reports corrupt input", async () => {
    const factory = new FakeIndexedDBFactory();
    const storage = memoryStorage({ "schematic-project": JSON.stringify({ id: "legacy", name: "legacy project" }) });
    const repo = repository(factory, "test-singleton-migration");
    const outcome = await migrateLocalStorageWorkspace(repo, {
      keys: ["schematic-project"],
      storage,
      removeLegacy: true,
    });
    expect(outcome.status).toBe("migrated");
    expect(storage.values.has("schematic-project")).toBe(false);

    const corruptStorage = memoryStorage({ "bad": "{not-json" });
    const corrupt = await migrateLocalStorageWorkspace(repository(factory, "test-corrupt-migration"), {
      keys: ["bad"],
      storage: corruptStorage,
    });
    expect(corrupt.status).toBe("corrupt");
    expect(corrupt.error?.code).toBe("corrupt-record");
  });

  it("returns a failure when legacy storage throws", async () => {
    const throwingStorage: LegacyStorageLike = {
      getItem: () => { throw new Error("storage denied"); },
      setItem: () => undefined,
    };
    const outcome = await migrateLocalStorageWorkspace(repository(new FakeIndexedDBFactory(), "test-storage-error"), {
      keys: ["schematic-project"],
      storage: throwingStorage,
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.error?.operation).toBe("migration-read");
  });
});

describe("debounced saves", () => {
  it("coalesces rapid updates and resolves all scheduled callers", async () => {
    const repo = repository(new FakeIndexedDBFactory(), "test-debounce");
    const saver = createDebouncedWorkspaceSaver(repo, 1);
    const first = saver.schedule(workspace("first"), { expectedRevision: null });
    const second = saver.schedule(workspace("latest"), { expectedRevision: null });
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(true);
    expect(saver.pending).toBe(false);
    if (secondResult.ok) expect(secondResult.value.projects[0].name).toBe("latest");
  });

  it("resolves cancelled callers with an abort result", async () => {
    const saver = createDebouncedWorkspaceSaver(repository(new FakeIndexedDBFactory(), "test-debounce-cancel"), 1000);
    const pending = saver.schedule(workspace(), { expectedRevision: null });
    saver.cancel();
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("aborted");
  });
});
