/**
 * Durable, JSON-only project records for the Behavior Preview authoring path.
 *
 * These are intentionally data-only shapes. Reducers, preview sessions, timers,
 * and registry instances never belong in project persistence. The shared
 * `@schematic/behavior` package owns validation and execution; this module only
 * describes the records that the application stores and exports.
 */

import { sha256 } from "@schematic/behavior/canonicalize";

export type BehaviorJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly BehaviorJsonValue[]
  | { readonly [key: string]: BehaviorJsonValue };

export type BehaviorPlanRecord = {
  schemaVersion: 1;
  id: string;
  projectId: string;
  name: string;
  intent?: string;
  revision: number;
  rules: readonly Record<string, unknown>[];
  cues?: readonly Record<string, unknown>[];
};

export type CodeLanguage = "arduino" | "micropython" | "espidf" | "c" | "cpp" | "python";

export interface CodeFileRecord {
  name: string;
  content: string;
}

export interface CodeDependencyRecord {
  ecosystem: "arduino-library" | "platformio" | "python-package" | "vendor-sdk" | "other";
  name: string;
  version?: string;
  sourceUrl?: string;
}

export interface CodeExportRecord {
  contentSha256: string;
  exportedAt: string;
  format: "source-files" | "handoff-manifest" | "project-bundle";
}

export type CodePreviewLink =
  | { status: "unlinked" }
  | {
      status: "linked";
      behaviorPlanId: string;
      behaviorPlanSha256: string;
      projectSha256: string;
      linkedContentSha256: string;
    }
  | {
      status: "stale";
      behaviorPlanId: string;
      behaviorPlanSha256: string;
      projectSha256: string;
      linkedContentSha256: string;
      changed: readonly ("code" | "plan" | "project")[];
    };

export interface CodeDocumentRecord {
  schemaVersion: 1;
  id: string;
  projectId: string;
  targetComponentId: string;
  targetDefinitionId: string;
  boardFqbn?: string;
  language: CodeLanguage;
  files: readonly CodeFileRecord[];
  dependencies: readonly CodeDependencyRecord[];
  revision: number;
  contentSha256: string;
  exportHistory: readonly CodeExportRecord[];
  origin: "ai-generated" | "human-authored" | "imported" | "mixed";
  previewLink: CodePreviewLink;
  inAppVerification: "not-performed";
  updatedAt: string;
}

export interface LegacyBehaviorData {
  /** Legacy firmware targets retained only for compatibility and re-export. */
  firmwareTargets?: readonly Record<string, unknown>[];
  /** A deliberately ignored/quarantined copy of legacy build artifacts. */
  compiledArtifacts?: readonly Record<string, unknown>[];
  [key: string]: unknown;
}

export const DEFAULT_CODE_LANGUAGE: CodeLanguage = "arduino";
export const DEFAULT_CODE_ORIGIN: CodeDocumentRecord["origin"] = "ai-generated";
export const MAX_BEHAVIOR_PLANS_PER_PROJECT = 100;
export const MAX_BEHAVIOR_RULES_PER_PLAN = 200;
export const MAX_BEHAVIOR_ACTIONS_PER_RULE = 20;
export const MAX_BEHAVIOR_CUES_PER_PLAN = 2_000;
export const MAX_CODE_FILE_BYTES = 1024 * 1024;
export const MAX_CODE_DOCUMENT_BYTES = 512 * 1024;
export const MAX_PROJECT_SOURCE_BYTES = 512 * 1024;
export const MAX_SERIALIZED_PROJECT_SOURCE_BYTES = 1024 * 1024;
export const MAX_CODE_FILES_PER_DOCUMENT = 128;
export const MAX_CODE_DEPENDENCIES_PER_DOCUMENT = 256;
export const MAX_CODE_DOCUMENTS_PER_PROJECT = 100;
export const MAX_CODE_EXPORT_HISTORY = 50;
export const MAX_COMPONENTS_PER_PROJECT = 500;
export const MAX_CONNECTIONS_PER_PROJECT = 2_000;
export const MAX_LEGACY_FIRMWARE_TARGETS_PER_PROJECT = 100;
export const MAX_PERSISTED_ID_LENGTH = 200;

const SHA256_PATTERN = /^[0-9a-fA-F]{64}$/;

const CODE_LANGUAGES = new Set<CodeLanguage>(["arduino", "micropython", "espidf", "c", "cpp", "python"]);
const CODE_ORIGINS = new Set<CodeDocumentRecord["origin"]>(["ai-generated", "human-authored", "imported", "mixed"]);
const DEPENDENCY_ECOSYSTEMS = new Set<CodeDependencyRecord["ecosystem"]>(["arduino-library", "platformio", "python-package", "vendor-sdk", "other"]);
const PREVIEW_LINK_STATUSES = new Set(["unlinked", "linked", "stale"]);

export function codeFilesByteLength(files: readonly { content: string }[]) {
  return files.reduce((total, file) => total + new TextEncoder().encode(file.content).byteLength, 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function boundedString(value: unknown, fallback = "", max = 240) {
  return stringValue(value, fallback).slice(0, max);
}

function positiveInt(value: unknown, fallback: number) {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function stableId(prefix: string) {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${uuid}`;
}

export function isSafeRelativeCodePath(value: string) {
  const hasControlCharacter = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (!value || value.length > 240 || hasControlCharacter || value.includes("\\")) return false;
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value) || value.endsWith("/")) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

/**
 * Clone only JSON values. This is a persistence boundary, so functions,
 * classes, DOM nodes and circular data are discarded by returning undefined.
 */
function cloneJson(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const item of value) {
      const cloned = cloneJson(item);
      if (typeof cloned === "undefined" && item !== undefined) return undefined;
      result.push(cloned);
    }
    return result;
  }
  if (!isRecord(value)) return undefined;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const cloned = cloneJson(value[key]);
    if (typeof cloned === "undefined" && value[key] !== undefined) return undefined;
    if (typeof cloned !== "undefined") {
      // Assignment to `__proto__` on a normal object invokes its legacy
      // prototype setter. Define every JSON key as data so import/normalize/
      // export preserves valid JSON exactly without changing object shape.
      Object.defineProperty(result, key, { value: cloned, enumerable: true, configurable: true, writable: true });
    }
  }
  return result;
}

function normalizeCodeFile(value: unknown, _index: number): CodeFileRecord | null {
  if (!isRecord(value)) return null;
  if (typeof value.name !== "string" || value.name.length > 240 || typeof value.content !== "string") return null;
  const name = value.name.trim();
  if (!isSafeRelativeCodePath(name)) return null;
  const content = value.content;
  if (new TextEncoder().encode(content).byteLength > MAX_CODE_FILE_BYTES) return null;
  return { name, content };
}

function codeContentHash(files: readonly CodeFileRecord[]) {
  return sha256([...files].sort((left, right) => left.name.localeCompare(right.name)).map((file) => ({ name: file.name, content: file.content })));
}

function normalizeDependency(value: unknown): CodeDependencyRecord | null {
  if (!isRecord(value) || typeof value.name !== "string" || !value.name.trim()) return null;
  const ecosystem = DEPENDENCY_ECOSYSTEMS.has(value.ecosystem as CodeDependencyRecord["ecosystem"])
    ? value.ecosystem as CodeDependencyRecord["ecosystem"]
    : "other";
  return {
    ecosystem,
    name: boundedString(value.name, "", 240).trim(),
    ...(typeof value.version === "string" && value.version.trim() ? { version: boundedString(value.version, "", 120).trim() } : {}),
    ...(typeof value.sourceUrl === "string" && value.sourceUrl.trim() ? { sourceUrl: boundedString(value.sourceUrl, "", 2_000).trim() } : {}),
  };
}

function normalizePreviewLink(value: unknown): CodePreviewLink {
  if (!isRecord(value) || typeof value.status !== "string" || !PREVIEW_LINK_STATUSES.has(value.status)) return { status: "unlinked" };
  if (value.status === "unlinked") return { status: "unlinked" };
  const behaviorPlanId = typeof value.behaviorPlanId === "string" ? value.behaviorPlanId.trim() : "";
  const behaviorPlanSha256 = value.behaviorPlanSha256;
  const projectSha256 = value.projectSha256;
  const linkedContentSha256 = value.linkedContentSha256;
  // Preview links are optimistic-concurrency metadata. A malformed hash must
  // never survive persistence as if it were a valid link; drop the relation
  // and let the caller explicitly re-link the document.
  if (!behaviorPlanId || behaviorPlanId.length > MAX_PERSISTED_ID_LENGTH
    || typeof behaviorPlanSha256 !== "string" || !SHA256_PATTERN.test(behaviorPlanSha256)
    || typeof projectSha256 !== "string" || !SHA256_PATTERN.test(projectSha256)
    || typeof linkedContentSha256 !== "string" || !SHA256_PATTERN.test(linkedContentSha256)) return { status: "unlinked" };
  const base = { behaviorPlanId, behaviorPlanSha256, projectSha256, linkedContentSha256 } as const;
  if (value.status === "linked") return { status: "linked", ...base };
  const changed = Array.isArray(value.changed)
    ? value.changed.filter((item): item is "code" | "plan" | "project" => item === "code" || item === "plan" || item === "project")
    : [];
  return { status: "stale", ...base, changed: [...new Set(changed)] };
}

function normalizeExportHistory(value: unknown): CodeExportRecord[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_CODE_EXPORT_HISTORY).flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.contentSha256 !== "string" || !SHA256_PATTERN.test(entry.contentSha256) || typeof entry.exportedAt !== "string") return [];
    const format = entry.format === "source-files" || entry.format === "handoff-manifest" || entry.format === "project-bundle" ? entry.format : "source-files";
    return [{ contentSha256: entry.contentSha256, exportedAt: entry.exportedAt, format }];
  });
}

export function normalizeBehaviorPlan(value: unknown, projectId: string, fallbackId = stableId("plan")): BehaviorPlanRecord | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== 1) return null;
  const rawId = typeof value.id === "string" ? value.id.trim() : "";
  if (rawId.length > MAX_PERSISTED_ID_LENGTH || fallbackId.length > MAX_PERSISTED_ID_LENGTH) return null;
  const id = rawId || fallbackId;
  const rules = Array.isArray(value.rules)
    ? value.rules.filter(isRecord).slice(0, MAX_BEHAVIOR_RULES_PER_PLAN).flatMap((rule) => {
        const cloned = cloneJson(rule);
        if (isRecord(cloned) && Array.isArray(cloned.then)) cloned.then = cloned.then.slice(0, MAX_BEHAVIOR_ACTIONS_PER_RULE);
        return isRecord(cloned) ? [cloned] : [];
      })
    : [];
  const cues = Array.isArray(value.cues)
    ? value.cues.filter(isRecord).slice(0, MAX_BEHAVIOR_CUES_PER_PLAN).flatMap((cue) => {
        const cloned = cloneJson(cue);
        return isRecord(cloned) ? [cloned] : [];
      })
    : undefined;
  return {
    schemaVersion: 1,
    id,
    // The containing project is authoritative. Copied/imported records must
    // not retain a foreign project id and become addressable in this room.
    projectId,
    name: boundedString(value.name, "Untitled behavior", 200).trim() || "Untitled behavior",
    ...(typeof value.intent === "string" && value.intent.trim() ? { intent: boundedString(value.intent, "", 4_096) } : {}),
    revision: positiveInt(value.revision, 1) || 1,
    rules,
    ...(cues ? { cues } : {}),
  };
}

export function normalizeCodeDocument(
  value: unknown,
  projectId: string,
  fallback: Partial<CodeDocumentRecord> = {},
): CodeDocumentRecord | null {
  if (!isRecord(value)) return null;
  if (Array.isArray(value.files) && value.files.length > MAX_CODE_FILES_PER_DOCUMENT) return null;
  const files = Array.isArray(value.files) ? value.files.map(normalizeCodeFile).filter((file): file is CodeFileRecord => Boolean(file)) : [];
  if (Array.isArray(value.files) && files.length !== value.files.length) return null;
  if (new Set(files.map((file) => file.name)).size !== files.length) return null;
  if (codeFilesByteLength(files) > MAX_CODE_DOCUMENT_BYTES) return null;
  const dependencies = Array.isArray(value.dependencies) ? value.dependencies.slice(0, MAX_CODE_DEPENDENCIES_PER_DOCUMENT).map(normalizeDependency).filter((dependency): dependency is CodeDependencyRecord => Boolean(dependency)) : [];
  const language = CODE_LANGUAGES.has(value.language as CodeLanguage) ? value.language as CodeLanguage : fallback.language ?? DEFAULT_CODE_LANGUAGE;
  const origin = CODE_ORIGINS.has(value.origin as CodeDocumentRecord["origin"]) ? value.origin as CodeDocumentRecord["origin"] : fallback.origin ?? DEFAULT_CODE_ORIGIN;
  const targetComponentId = typeof value.targetComponentId === "string" ? value.targetComponentId.trim() : fallback.targetComponentId?.trim() ?? "";
  const rawId = typeof value.id === "string" ? value.id.trim() : fallback.id?.trim() ?? "";
  const id = rawId || stableId("code");
  const targetDefinitionId = typeof value.targetDefinitionId === "string" ? value.targetDefinitionId.trim() : fallback.targetDefinitionId?.trim() ?? "unknown";
  if (!targetComponentId || targetComponentId.length > MAX_PERSISTED_ID_LENGTH || id.length > MAX_PERSISTED_ID_LENGTH || !targetDefinitionId || targetDefinitionId.length > MAX_PERSISTED_ID_LENGTH) return null;
  const updatedAt = typeof value.updatedAt === "string" && value.updatedAt ? value.updatedAt : fallback.updatedAt ?? nowIso();
  return {
    schemaVersion: 1,
    id,
    // The containing project is authoritative for code records as well. A
    // copied document must not remain addressable as if it belonged to a
    // different room/project after normalization.
    projectId,
    targetComponentId,
    targetDefinitionId,
    ...(typeof value.boardFqbn === "string" && value.boardFqbn.trim() ? { boardFqbn: boundedString(value.boardFqbn, "", 200).trim() } : fallback.boardFqbn ? { boardFqbn: fallback.boardFqbn } : {}),
    language,
    files,
    dependencies,
    revision: positiveInt(value.revision, fallback.revision ?? 1) || 1,
    // Recompute this metadata from normalized source instead of trusting an
    // imported hash (and upgrade legacy documents that had no hash).
    contentSha256: codeContentHash(files),
    exportHistory: normalizeExportHistory(value.exportHistory),
    origin,
    previewLink: normalizePreviewLink(value.previewLink),
    inAppVerification: "not-performed",
    updatedAt,
  };
}

export function codeDocumentFromLegacyTarget(
  target: Record<string, unknown>,
  projectId: string,
  targetDefinitionId = "unknown",
  fallbackId = stableId("code"),
): CodeDocumentRecord | null {
  if (Array.isArray(target.files) && target.files.length > MAX_CODE_FILES_PER_DOCUMENT) return null;
  const files = Array.isArray(target.files) ? target.files.map(normalizeCodeFile).filter((file): file is CodeFileRecord => Boolean(file)) : [];
  if (Array.isArray(target.files) && files.length !== target.files.length) return null;
  if (new Set(files.map((file) => file.name)).size !== files.length) return null;
  if (codeFilesByteLength(files) > MAX_CODE_DOCUMENT_BYTES) return null;
  const componentId = typeof target.componentId === "string" ? target.componentId.trim() : "";
  if (!componentId) return null;
  const language = CODE_LANGUAGES.has(target.language as CodeLanguage) ? target.language as CodeLanguage : DEFAULT_CODE_LANGUAGE;
  return {
    schemaVersion: 1,
    id: fallbackId,
    projectId,
    targetComponentId: componentId,
    targetDefinitionId: typeof target.definitionId === "string" && target.definitionId.trim() ? target.definitionId : targetDefinitionId,
    ...(typeof target.boardFqbn === "string" && target.boardFqbn.trim() ? { boardFqbn: target.boardFqbn } : {}),
    language,
    files,
    dependencies: [],
    revision: 1,
    contentSha256: codeContentHash(files),
    exportHistory: [],
    origin: "imported",
    previewLink: { status: "unlinked" },
    inAppVerification: "not-performed",
    updatedAt: nowIso(),
  };
}
