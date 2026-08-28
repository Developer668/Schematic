import {
  PROJECT_EXPORT_FORMAT,
  PROJECT_EXPORT_VERSION,
  PROJECT_STORAGE_DB_NAME,
  PROJECT_STORAGE_STORE_NAME,
  PROJECT_STORAGE_SCHEMA_VERSION,
} from "./constants";
import { openProjectStorageDatabase } from "./database";
import { corruptRecord, failure, invalidInput, mapStorageException, notFound, storageError, success } from "./errors";
import { normalizeNamespace } from "./namespace";
import { byteLength, cloneJson, parseJson } from "./serialization";
import type {
  ImportProjectOptions,
  ImportSource,
  NormalizedStorageNamespace,
  ProjectExport,
  ProjectExportEnvelope,
  ProjectIdResolver,
  ProjectImport,
  ProjectRepositoryOptions,
  ProjectStorageRecord,
  RevisionSource,
  SaveWorkspaceOptions,
  StorageOperation,
  StorageResult,
  StoredWorkspace,
  WorkspaceSnapshot,
} from "./types";
import type { RevisionMetadata } from "./types";

type InternalRecord<TProject> = ProjectStorageRecord<TProject>;

const DEFAULT_MAX_RECORD_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_IMPORT_BYTES = 10 * 1024 * 1024;

function globalIndexedDb(): IDBFactory | undefined {
  return typeof globalThis !== "undefined" && "indexedDB" in globalThis
    ? (globalThis as typeof globalThis & { indexedDB?: IDBFactory }).indexedDB
    : undefined;
}

function defaultProjectId(project: unknown): string | null {
  if (!project || typeof project !== "object") return null;
  const id = (project as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? id : null;
}

function isRevisionSource(value: unknown): value is RevisionSource {
  return value === "save" || value === "migration" || value === "import";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isWorkspaceSnapshot(value: unknown): value is WorkspaceSnapshot<unknown> {
  return isRecord(value)
    && value.version === PROJECT_STORAGE_SCHEMA_VERSION
    && typeof value.activeProjectId === "string"
    && Array.isArray(value.projects);
}

function normalizeOptionalWriter(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 200) : undefined;
}

function safeFilename(projectId: string): string {
  const normalized = projectId.trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
  return `${normalized || "project"}.schematic.json`;
}

function sameNamespace(a: NormalizedStorageNamespace, b: NormalizedStorageNamespace): boolean {
  return a.key === b.key && a.roomId === b.roomId && a.userId === b.userId;
}

function readStoredRecord<TProject>(
  raw: unknown,
  namespace: NormalizedStorageNamespace,
  operation: StorageOperation,
): StorageResult<InternalRecord<TProject> | null> {
  if (raw === undefined) return success(null);
  if (!isRecord(raw)) return failure(corruptRecord(operation, "The IndexedDB workspace record is not an object."));
  if (raw.schemaVersion !== PROJECT_STORAGE_SCHEMA_VERSION) {
    return failure(corruptRecord(operation, "The IndexedDB workspace record has an unknown schema version."));
  }
  if (raw.namespaceKey !== namespace.key || !isRecord(raw.namespace)) {
    return failure(corruptRecord(operation, "The IndexedDB workspace namespace does not match this room."));
  }

  const rawNamespace = raw.namespace;
  if (rawNamespace.key !== namespace.key
    || rawNamespace.roomId !== namespace.roomId
    || rawNamespace.userId !== namespace.userId) {
    return failure(corruptRecord(operation, "The IndexedDB workspace namespace metadata is inconsistent."));
  }
  if (!isWorkspaceSnapshot(raw.workspace) || !isRecord(raw.metadata)) {
    return failure(corruptRecord(operation, "The IndexedDB workspace payload is incomplete."));
  }

  const metadata = raw.metadata;
  if (!Number.isInteger(metadata.revision) || Number(metadata.revision) < 1
    || typeof metadata.updatedAt !== "string" || !isRevisionSource(metadata.source)
    || (metadata.updatedBy !== undefined && typeof metadata.updatedBy !== "string")) {
    return failure(corruptRecord(operation, "The IndexedDB workspace revision metadata is invalid."));
  }

  return success(raw as unknown as InternalRecord<TProject>);
}

function storedWorkspace<TProject>(
  record: InternalRecord<TProject>,
): StoredWorkspace<TProject> {
  return {
    ...record.workspace,
    namespace: record.namespace,
    metadata: record.metadata,
  };
}

interface DatabaseResult {
  database: IDBDatabase;
}

export class ProjectRepository<TProject = { id: string }> {
  readonly namespace: NormalizedStorageNamespace;
  readonly dbName: string;
  readonly storeName: string;

  private readonly indexedDBFactory?: IDBFactory;
  private readonly now: () => string;
  private readonly getProjectId: ProjectIdResolver<TProject>;
  private readonly maxRecordBytes: number;
  private readonly maxImportBytes: number;

  constructor(options: ProjectRepositoryOptions<TProject>) {
    this.namespace = normalizeNamespace(options.namespace);
    this.dbName = options.dbName ?? PROJECT_STORAGE_DB_NAME;
    this.storeName = options.storeName ?? PROJECT_STORAGE_STORE_NAME;
    this.indexedDBFactory = options.indexedDB;
    this.now = options.now ?? (() => new Date().toISOString());
    this.getProjectId = options.getProjectId ?? (defaultProjectId as ProjectIdResolver<TProject>);
    this.maxRecordBytes = options.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES;
    this.maxImportBytes = options.maxImportBytes ?? DEFAULT_MAX_IMPORT_BYTES;
  }

  async loadWorkspace(): Promise<StorageResult<StoredWorkspace<TProject> | null>> {
    const record = await this.readRecord("load");
    if (!record.ok) return failure(record.error);
    if (record.value === null) return success(null);
    return success(storedWorkspace(record.value));
  }

  async saveWorkspace(
    workspace: WorkspaceSnapshot<TProject>,
    options: SaveWorkspaceOptions = {},
  ): Promise<StorageResult<StoredWorkspace<TProject>>> {
    const prepared = this.prepareWorkspace(workspace, "save");
    if (!prepared.ok) return prepared;

    const expectedRevision = options.expectedRevision;
    if (expectedRevision !== undefined
      && expectedRevision !== null
      && (!Number.isInteger(expectedRevision) || expectedRevision < 0)) {
      return failure(invalidInput("save", "expectedRevision must be a non-negative integer or null."));
    }

    const database = await this.openDatabase("save");
    if (!database.ok) return database;

    const source = options.source ?? "save";
    const updatedBy = normalizeOptionalWriter(options.updatedBy);
    return this.writeTransaction(database.value, "save", (store, finish) => {
      const request = store.get(this.namespace.key);
      let requestError: unknown;
      request.onerror = () => {
        requestError = request.error;
      };
      request.onsuccess = () => {
        const current = readStoredRecord<TProject>(request.result, this.namespace, "save");
        if (!current.ok) {
          finish(current);
          return;
        }

        const currentRevision = current.value?.metadata.revision ?? null;
        const matches = expectedRevision === undefined
          || (expectedRevision === null ? current.value === null : currentRevision === expectedRevision);
        if (!matches) {
          finish(failure(storageError(
            "conflict",
            "save",
            "The workspace changed before this save completed.",
            {
              retryable: true,
              details: {
                expectedRevision: expectedRevision ?? null,
                currentRevision,
              },
            },
          )));
          return;
        }

        const metadata: RevisionMetadata = {
          revision: (current.value?.metadata.revision ?? 0) + 1,
          updatedAt: this.now(),
          source,
          ...(updatedBy ? { updatedBy } : {}),
        };
        const record: InternalRecord<TProject> = {
          schemaVersion: PROJECT_STORAGE_SCHEMA_VERSION,
          namespaceKey: this.namespace.key,
          namespace: this.namespace,
          workspace: prepared.value,
          metadata,
        };
        const serializable = cloneJson(record, "save", this.maxRecordBytes);
        if (!serializable.ok) {
          finish(serializable);
          return;
        }

        try {
          const putRequest = store.put(serializable.value);
          putRequest.onerror = () => {
            requestError = putRequest.error;
          };
          putRequest.onsuccess = () => {
            finish(success({ ...prepared.value, namespace: this.namespace, metadata }));
          };
        } catch (error) {
          requestError = error;
          try { request.transaction?.abort(); } catch { /* the transaction may already be closed */ }
        }
      };
      return requestError;
    });
  }

  async clearWorkspace(): Promise<StorageResult<null>> {
    const database = await this.openDatabase("clear");
    if (!database.ok) return database;
    return this.writeTransaction(database.value, "clear", (store, finish) => {
      try {
        const request = store.delete(this.namespace.key);
        request.onsuccess = () => finish(success(null));
        request.onerror = () => finish(failure(mapStorageException(request.error, "clear")));
      } catch (error) {
        finish(failure(mapStorageException(error, "clear")));
      }
    });
  }

  async exportProject(projectId: string): Promise<StorageResult<ProjectExport<TProject>>> {
    const normalizedId = projectId.trim();
    if (!normalizedId) return failure(invalidInput("export", "projectId must not be empty."));

    const loaded = await this.loadWorkspace();
    if (!loaded.ok) return loaded;
    if (!loaded.value) return failure(notFound("export", "No workspace exists in this room."));

    const project = loaded.value.projects.find((candidate) => this.getProjectId(candidate) === normalizedId);
    if (!project) return failure(notFound("export", `Project ${normalizedId} was not found.`));

    const envelope: ProjectExportEnvelope<TProject> = {
      format: PROJECT_EXPORT_FORMAT,
      formatVersion: PROJECT_EXPORT_VERSION,
      exportedAt: this.now(),
      projectId: normalizedId,
      project,
    };
    const serialized = cloneJson(envelope, "export", this.maxImportBytes);
    if (!serialized.ok) return serialized;
    const text = JSON.stringify(serialized.value, null, 2);
    const blobConstructor = typeof globalThis !== "undefined" ? globalThis.Blob : undefined;
    if (!blobConstructor) return failure(storageError("unavailable", "export", "Blob downloads are unavailable in this browser context."));

    const blob = new blobConstructor([text], { type: "application/json" });
    return success({
      blob,
      filename: safeFilename(normalizedId),
      projectId: normalizedId,
      bytes: byteLength(text),
      formatVersion: PROJECT_EXPORT_VERSION,
      project,
    });
  }

  async importProject(
    source: ImportSource,
    options: ImportProjectOptions = {},
  ): Promise<StorageResult<ProjectImport<TProject>>> {
    const text = await this.readImportText(source);
    if (!text.ok) return text;
    const parsed = parseJson<unknown>(text.value, "import");
    if (!parsed.ok) return parsed;
    if (!isRecord(parsed.value)
      || parsed.value.format !== PROJECT_EXPORT_FORMAT
      || parsed.value.formatVersion !== PROJECT_EXPORT_VERSION
      || !isRecord(parsed.value.project)) {
      return failure(invalidInput("import", "The file is not a supported Schematic project export."));
    }

    const envelope = parsed.value as unknown as ProjectExportEnvelope<TProject>;
    const projectClone = cloneJson(envelope.project, "import", this.maxRecordBytes);
    if (!projectClone.ok) return projectClone;
    const projectId = this.getProjectId(projectClone.value);
    if (!projectId) return failure(invalidInput("import", "The exported project does not contain a usable id."));
    if (envelope.projectId !== projectId) {
      return failure(invalidInput("import", "The export projectId does not match the project payload."));
    }

    const loaded = await this.loadWorkspace();
    if (!loaded.ok) return loaded;
    const current = loaded.value;
    const collision = current?.projects.some((candidate) => this.getProjectId(candidate) === projectId) ?? false;
    const collisionMode = options.collision ?? "error";
    if (collision && collisionMode === "error") {
      return failure(storageError("conflict", "import", `Project ${projectId} already exists in this room.`, {
        retryable: false,
        details: { projectId },
      }));
    }

    const makeActive = options.makeActive ?? true;
    const projects = current
      ? collision
        ? current.projects.map((candidate) => this.getProjectId(candidate) === projectId ? projectClone.value : candidate)
        : [...current.projects, projectClone.value]
      : [projectClone.value];
    const workspace: WorkspaceSnapshot<TProject> = {
      version: PROJECT_STORAGE_SCHEMA_VERSION,
      activeProjectId: makeActive || !current ? projectId : current.activeProjectId,
      projects,
    };
    const expectedRevision = options.expectedRevision !== undefined
      ? options.expectedRevision
      : current?.metadata.revision ?? null;
    const saved = await this.saveWorkspace(workspace, {
      expectedRevision,
      source: "import",
    });
    if (!saved.ok) return saved;

    return success({
      project: projectClone.value,
      projectId,
      replaced: collision,
      workspace: saved.value,
    });
  }

  private prepareWorkspace(
    workspace: WorkspaceSnapshot<TProject>,
    operation: StorageOperation,
  ): StorageResult<WorkspaceSnapshot<TProject>> {
    if (!isWorkspaceSnapshot(workspace) || !workspace.activeProjectId.trim()) {
      return failure(invalidInput(operation, "A workspace must have version 1, an activeProjectId, and a projects array."));
    }
    const cloned = cloneJson({
      version: PROJECT_STORAGE_SCHEMA_VERSION,
      activeProjectId: workspace.activeProjectId,
      projects: workspace.projects,
    }, operation, this.maxRecordBytes);
    if (!cloned.ok) return cloned;
    return success(cloned.value as WorkspaceSnapshot<TProject>);
  }

  private async readImportText(source: ImportSource): Promise<StorageResult<string>> {
    if (typeof source === "string") {
      if (byteLength(source) > this.maxImportBytes) {
        return failure(storageError("quota-exceeded", "import", "The import is larger than the safety limit.", {
          retryable: false,
          details: { bytes: byteLength(source), maxImportBytes: this.maxImportBytes },
        }));
      }
      return success(source);
    }

    if (typeof ArrayBuffer !== "undefined" && source instanceof ArrayBuffer) {
      if (source.byteLength > this.maxImportBytes) return failure(this.importTooLarge(source.byteLength));
      return success(new TextDecoder().decode(source));
    }
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(source)) {
      if (source.byteLength > this.maxImportBytes) return failure(this.importTooLarge(source.byteLength));
      return success(new TextDecoder().decode(new Uint8Array(source.buffer, source.byteOffset, source.byteLength)));
    }
    if (typeof Blob !== "undefined" && source instanceof Blob) {
      if (source.size > this.maxImportBytes) return failure(this.importTooLarge(source.size));
      try {
        return success(await source.text());
      } catch (error) {
        return failure(mapStorageException(error, "import"));
      }
    }

    return failure(invalidInput("import", "Import input must be JSON text, a Blob, or an ArrayBuffer."));
  }

  private importTooLarge(bytes: number) {
    return storageError("quota-exceeded", "import", "The import is larger than the safety limit.", {
      retryable: false,
      details: { bytes, maxImportBytes: this.maxImportBytes },
    });
  }

  private async openDatabase(operation: StorageOperation): Promise<StorageResult<DatabaseResult["database"]>> {
    const factory = this.indexedDBFactory ?? globalIndexedDb();
    if (!factory) return failure(storageError("unavailable", operation, "IndexedDB is unavailable in this browser context."));
    try {
      return success(await openProjectStorageDatabase(factory, this.dbName, this.storeName));
    } catch (error) {
      return failure(mapStorageException(error, operation === "open" ? "open" : operation));
    }
  }

  private async readRecord(operation: StorageOperation): Promise<StorageResult<InternalRecord<TProject> | null>> {
    const database = await this.openDatabase(operation);
    if (!database.ok) return database;
    return new Promise((resolve) => {
      let transaction: IDBTransaction;
      let outcome: StorageResult<InternalRecord<TProject> | null> | undefined;
      let requestError: unknown;
      let closed = false;
      const finish = (result: StorageResult<InternalRecord<TProject> | null>) => {
        outcome = result;
      };
      const close = (result: StorageResult<InternalRecord<TProject> | null>) => {
        if (closed) return;
        closed = true;
        database.value.close();
        resolve(result);
      };

      try {
        transaction = database.value.transaction(this.storeName, "readonly");
        transaction.oncomplete = () => close(outcome ?? failure(storageError("unknown", operation, "IndexedDB read completed without a result.", { retryable: true })));
        transaction.onerror = () => close(failure(mapStorageException(requestError ?? transaction.error, operation)));
        transaction.onabort = () => close(failure(mapStorageException(requestError ?? transaction.error, operation)));
        const request = transaction.objectStore(this.storeName).get(this.namespace.key);
        request.onerror = () => { requestError = request.error; };
        request.onsuccess = () => finish(readStoredRecord<TProject>(request.result, this.namespace, operation));
      } catch (error) {
        close(failure(mapStorageException(error, operation)));
      }
    });
  }

  private writeTransaction<T>(
    database: IDBDatabase,
    operation: StorageOperation,
    setup: (store: IDBObjectStore, finish: (result: StorageResult<T>) => void) => unknown,
  ): Promise<StorageResult<T>> {
    return new Promise((resolve) => {
      let transaction: IDBTransaction;
      let outcome: StorageResult<T> | undefined;
      let requestError: unknown;
      let closed = false;
      const finish = (result: StorageResult<T>) => {
        outcome = result;
      };
      const close = (result: StorageResult<T>) => {
        if (closed) return;
        closed = true;
        database.close();
        resolve(result);
      };

      try {
        transaction = database.transaction(this.storeName, "readwrite");
        transaction.oncomplete = () => close(outcome ?? failure(storageError("unknown", operation, "IndexedDB write completed without a result.", { retryable: true })));
        transaction.onerror = () => close(failure(mapStorageException(requestError ?? transaction.error, operation)));
        transaction.onabort = () => close(failure(mapStorageException(requestError ?? transaction.error, operation)));
        const store = transaction.objectStore(this.storeName);
        const possibleError = setup(store, finish);
        if (possibleError) requestError = possibleError;
      } catch (error) {
        close(failure(mapStorageException(error, operation)));
      }
    });
  }
}
