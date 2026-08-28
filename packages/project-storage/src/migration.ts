import { failure, invalidInput, mapStorageException, storageError } from "./errors";
import { parseJson } from "./serialization";
import { PROJECT_STORAGE_SCHEMA_VERSION } from "./constants";
import type { ProjectRepository } from "./repository";
import type {
  LegacyStorageLike,
  LocalStorageMigrationOptions,
  MigrationOutcome,
  ProjectIdResolver,
  StorageError,
  StoredWorkspace,
  WorkspaceSnapshot,
} from "./types";

function defaultProjectId<TProject>(project: TProject): string | null {
  if (!project || typeof project !== "object") return null;
  const id = (project as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? id : null;
}

function browserLocalStorage(): LegacyStorageLike | null {
  if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) return null;
  try {
    const candidate = (globalThis as typeof globalThis & { localStorage?: LegacyStorageLike }).localStorage;
    if (!candidate || typeof candidate.getItem !== "function") return null;
    return candidate;
  } catch {
    return null;
  }
}

export function getSchematicLegacyProjectKeys(userId?: string | null): string[] {
  const normalized = userId?.trim();
  if (normalized && normalized !== "local-development") {
    return [`schematic-projects:${normalized}`, `schematic-project:${normalized}`];
  }
  return ["schematic-projects", "schematic-project"];
}

function parseLegacyWorkspace<TProject>(
  raw: string,
  options: Pick<LocalStorageMigrationOptions<TProject>, "normalizeProject" | "getProjectId">,
): { workspace: WorkspaceSnapshot<TProject> } | { error: StorageError } {
  const parsed = parseJson<unknown>(raw, "migration-read");
  if (!parsed.ok) return { error: storageError("corrupt-record", "migration-read", parsed.error.message) };
  const getProjectId: ProjectIdResolver<TProject> = options.getProjectId ?? defaultProjectId;
  const normalize = options.normalizeProject ?? ((value: unknown) => value as TProject);

  const value = parsed.value;
  const rawProjects = value && typeof value === "object" && !Array.isArray(value)
    && Array.isArray((value as { projects?: unknown }).projects)
    ? (value as { projects: unknown[] }).projects
    : [value];
  const projects: TProject[] = [];
  for (const rawProject of rawProjects) {
    try {
      const project = normalize(rawProject);
      if (project == null || !getProjectId(project)) {
        return { error: storageError("corrupt-record", "migration-read", "A legacy project is missing a usable id.") };
      }
      projects.push(project);
    } catch (error) {
      return { error: storageError("corrupt-record", "migration-read", error instanceof Error ? error.message : "A legacy project could not be normalized.") };
    }
  }
  if (!projects.length) return { error: storageError("corrupt-record", "migration-read", "The legacy workspace contains no projects.") };

  const rawActive = value && typeof value === "object" && !Array.isArray(value)
    ? (value as { activeProjectId?: unknown }).activeProjectId
    : undefined;
  const activeProjectId = typeof rawActive === "string" && projects.some((project) => getProjectId(project) === rawActive)
    ? rawActive
    : getProjectId(projects[0]);
  if (!activeProjectId) return { error: storageError("corrupt-record", "migration-read", "The legacy workspace has no active project.") };

  return {
    workspace: {
      version: PROJECT_STORAGE_SCHEMA_VERSION,
      activeProjectId,
      projects,
    },
  };
}

export async function migrateLocalStorageWorkspace<TProject>(
  repository: Pick<ProjectRepository<TProject>, "loadWorkspace" | "saveWorkspace">,
  options: LocalStorageMigrationOptions<TProject>,
): Promise<MigrationOutcome<TProject>> {
  const existing = await repository.loadWorkspace();
  if (!existing.ok) return { status: "failed", error: existing.error };
  if (existing.value) return { status: "already-present", workspace: existing.value };

  const storage = options.storage === undefined ? browserLocalStorage() : options.storage;
  if (!storage) {
    return {
      status: "failed",
      error: storageError("unavailable", "migration-read", "localStorage is unavailable in this browser context."),
    };
  }
  const keys = [...new Set(options.keys.map((key) => key.trim()).filter(Boolean))];
  if (!keys.length) return { status: "not-found" };

  let firstCorrupt: StorageError | undefined;
  for (const key of keys) {
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch (error) {
      return { status: "failed", key, error: mapStorageException(error, "migration-read") };
    }
    if (raw == null) continue;

    const candidate = parseLegacyWorkspace(raw, options);
    if ("error" in candidate) {
      firstCorrupt ??= candidate.error;
      continue;
    }
    const saved = await repository.saveWorkspace(candidate.workspace, {
      expectedRevision: null,
      source: "migration",
      updatedBy: options.updatedBy,
    });
    if (!saved.ok) return { status: "failed", key, error: saved.error };

    let cleanupError: StorageError | undefined;
    if (options.removeLegacy && typeof storage.removeItem === "function") {
      try {
        storage.removeItem(key);
      } catch (error) {
        cleanupError = mapStorageException(error, "migration-cleanup");
      }
    }
    return { status: "migrated", key, workspace: saved.value, ...(cleanupError ? { cleanupError } : {}) };
  }

  return firstCorrupt ? { status: "corrupt", error: firstCorrupt } : { status: "not-found" };
}
