export const PROJECT_STORAGE_SCHEMA_VERSION = 1 as const;
export const PROJECT_EXPORT_FORMAT = "schematic-project" as const;
export const PROJECT_EXPORT_VERSION = 1 as const;

export type StorageOperation =
  | "open"
  | "load"
  | "save"
  | "clear"
  | "export"
  | "import"
  | "migration-read"
  | "migration-write"
  | "migration-cleanup";

export type StorageErrorCode =
  | "unavailable"
  | "blocked"
  | "quota-exceeded"
  | "corrupt-record"
  | "invalid-input"
  | "not-found"
  | "conflict"
  | "serialization"
  | "aborted"
  | "unknown";

export interface StorageError {
  code: StorageErrorCode;
  operation: StorageOperation;
  message: string;
  retryable: boolean;
  causeName?: string;
  details?: Record<string, string | number | boolean | null>;
}

export type StorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: StorageError };

export interface StorageNamespace {
  roomId: string;
  userId?: string | null;
}

export interface NormalizedStorageNamespace {
  roomId: string;
  userId: string | null;
  key: string;
}

export interface WorkspaceSnapshot<TProject> {
  version: 1;
  activeProjectId: string;
  projects: TProject[];
}

export type RevisionSource = "save" | "migration" | "import";

export interface RevisionMetadata {
  revision: number;
  updatedAt: string;
  source: RevisionSource;
  updatedBy?: string;
}

export interface StoredWorkspace<TProject> extends WorkspaceSnapshot<TProject> {
  namespace: NormalizedStorageNamespace;
  metadata: RevisionMetadata;
}

export interface ProjectStorageRecord<TProject> {
  schemaVersion: 1;
  namespaceKey: string;
  namespace: NormalizedStorageNamespace;
  workspace: WorkspaceSnapshot<TProject>;
  metadata: RevisionMetadata;
}

export interface SaveWorkspaceOptions {
  /** `null` means the write is only valid when no record exists yet. */
  expectedRevision?: number | null;
  source?: RevisionSource;
  updatedBy?: string;
}

export type ProjectIdResolver<TProject> = (project: TProject) => string | null | undefined;

export interface ProjectRepositoryOptions<TProject> {
  namespace: StorageNamespace;
  dbName?: string;
  storeName?: string;
  indexedDB?: IDBFactory;
  now?: () => string;
  getProjectId?: ProjectIdResolver<TProject>;
  maxRecordBytes?: number;
  maxImportBytes?: number;
}

export interface ProjectExport<TProject> {
  blob: Blob;
  filename: string;
  projectId: string;
  bytes: number;
  formatVersion: 1;
  project: TProject;
}

export interface ProjectExportEnvelope<TProject> {
  format: typeof PROJECT_EXPORT_FORMAT;
  formatVersion: typeof PROJECT_EXPORT_VERSION;
  exportedAt: string;
  projectId: string;
  project: TProject;
}

export type ProjectImportCollision = "error" | "replace";

export interface ImportProjectOptions {
  collision?: ProjectImportCollision;
  makeActive?: boolean;
  expectedRevision?: number | null;
}

export interface ProjectImport<TProject> {
  project: TProject;
  projectId: string;
  replaced: boolean;
  workspace: StoredWorkspace<TProject>;
}

export type ImportSource = string | Blob | ArrayBuffer | ArrayBufferView;

export interface DebouncedWorkspaceSaver<TProject> {
  schedule(
    workspace: WorkspaceSnapshot<TProject>,
    options?: SaveWorkspaceOptions,
  ): Promise<StorageResult<StoredWorkspace<TProject>>>;
  flush(): Promise<StorageResult<StoredWorkspace<TProject>> | null>;
  cancel(): void;
  readonly pending: boolean;
}

export interface LegacyStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface LocalStorageMigrationOptions<TProject> {
  keys: readonly string[];
  storage?: LegacyStorageLike | null;
  normalizeProject?: (value: unknown) => TProject | null | undefined;
  getProjectId?: ProjectIdResolver<TProject>;
  removeLegacy?: boolean;
  updatedBy?: string;
}

export type MigrationStatus = "migrated" | "already-present" | "not-found" | "corrupt" | "failed";

export interface MigrationOutcome<TProject> {
  status: MigrationStatus;
  key?: string;
  workspace?: StoredWorkspace<TProject>;
  error?: StorageError;
  cleanupError?: StorageError;
}
