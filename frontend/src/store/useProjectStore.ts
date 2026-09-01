import { create } from "zustand";
import { sha256 } from "@schematic/behavior/canonicalize";
import { validateConnection as validateGraphConnection } from "@schematic/validation";
import { defaultProperties, componentPort, getCatalogComponent, isBoardDefinition, orientConnectionEndpoints, resolveFirmwareBinding, boardTargetFor } from "../data/hardware.ts";
import { useSelectionStore } from "./useSelectionStore.ts";
import { useGraphFocusStore } from "./useGraphFocusStore.ts";
import { useValidationStore, validateProject, type ValidationIssue } from "./useValidationStore.ts";
import { useBehaviorPreviewStore } from "../behavior/useBehaviorPreviewStore.ts";
import { assertPersistenceMutationReady, getPersistenceGate, markExpectedPersistenceFallback } from "./persistenceGate.ts";
import {
  codeDocumentFromLegacyTarget,
  normalizeBehaviorPlan,
  normalizeCodeDocument,
  MAX_BEHAVIOR_PLANS_PER_PROJECT,
  MAX_CODE_DOCUMENTS_PER_PROJECT,
  MAX_COMPONENTS_PER_PROJECT,
  MAX_CONNECTIONS_PER_PROJECT,
  MAX_LEGACY_FIRMWARE_TARGETS_PER_PROJECT,
  MAX_PERSISTED_ID_LENGTH,
  MAX_PROJECT_SOURCE_BYTES,
  codeFilesByteLength,
  type BehaviorPlanRecord,
  type CodeDependencyRecord,
  type CodeDocumentRecord,
  type CodeFileRecord,
  type CodeLanguage,
  type CodePreviewLink,
} from "./behaviorPersistence.ts";

export interface HardwareGraph {
  id: string;
  name: string;
  description?: string;
  components: { id: string; definitionId: string; position: { x: number; y: number }; rotation: number; properties: Record<string, unknown>; label?: string }[];
  connections: { id: string; source: { componentId: string; portId: string }; target: { componentId: string; portId: string }; domain: string }[];
  firmwareTargets: { id: string; componentId: string; definitionId?: string; language?: string; boardFqbn?: string; files: { name: string; content: string }[]; compiledArtifact?: { success: boolean; log: string; hexB64?: string; elfB64?: string; binB64?: string; identity?: Record<string, unknown> } }[];
  /** Durable declaration consumed by the shared Behavior System. */
  behaviorPlans?: BehaviorPlanRecord[];
  /** Durable editable source documents; source is never executed by preview. */
  codeDocuments?: CodeDocumentRecord[];
  /** Unknown/legacy values retained for round-tripping, never executed. */
  legacyBehaviorData?: Record<string, unknown>;
  simulation?: { mode: "interactive" | "batch"; durationMs?: number; engines: Record<string, { enabled: boolean; fidelity: "fast" | "high" }> };
  createdAt?: string;
  updatedAt?: string;
  version?: 1;
}

interface ProjectState {
  project: HardwareGraph;
  projects: HardwareGraph[];
  activeProjectId: string;
  setProjectName: (name: string) => void;
  renameProject: (projectId: string, name: string) => string | null;
  addComponent: (definitionId: string, pos?: { x: number; y: number }) => { id: string };
  moveComponent: (id: string, position: { x: number; y: number }) => void;
  removeComponent: (id: string) => void;
  connectPorts: (source: { componentId: string; portId: string }, target: { componentId: string; portId: string }) => { id: string; domain: string; source: { componentId: string; portId: string }; target: { componentId: string; portId: string } };
  disconnectPorts: (connectionId: string) => void;
  getGraph: () => HardwareGraph;
  clear: () => void;
  loadProject: (graph: HardwareGraph) => void;
  importProject: (graph: HardwareGraph) => string;
  updateComponentProps: (id: string, props: Record<string, unknown>) => void;
  updateFirmware: (componentId: string, files: { name: string; content: string }[], metadata?: { language?: string; boardFqbn?: string }) => void;
  writeBehaviorPlan: (plan: unknown, expectedRevision: number | null) => { plan: BehaviorPlanRecord; replaced: boolean; conflict?: { current?: BehaviorPlanRecord; deleted?: boolean } };
  getBehaviorPlan: (planId?: string) => BehaviorPlanRecord | undefined;
  writeCodeDocument: (request: {
    targetComponentId: string;
    targetDefinitionId?: string;
    files: readonly CodeFileRecord[];
    language: CodeLanguage;
    dependencies?: readonly CodeDependencyRecord[];
    contentSha256?: string;
    expectedContentSha256?: string | null;
    origin?: CodeDocumentRecord["origin"];
    linkToBehaviorPlan?: CodePreviewLink;
    boardFqbn?: string;
  }) => { document: CodeDocumentRecord; replaced: boolean; conflict?: { current?: CodeDocumentRecord; deleted?: boolean } };
  getCodeDocument: (targetComponentId?: string, documentId?: string) => CodeDocumentRecord | undefined;
  recordCodeExport: (documentId: string, exportRecord: { contentSha256: string; exportedAt: string; format: CodeDocumentRecord["exportHistory"][number]["format"] }) => boolean;
  setCompiledArtifact: (componentId: string, artifact: { success: boolean; log: string; hexB64?: string; elfB64?: string; binB64?: string; identity?: Record<string, unknown> }) => void;
  saveProject: () => { projectId: string; savedAt: string };
  createProject: (name?: string) => string;
  duplicateProject: (projectId?: string, name?: string) => string | null;
  switchProject: (projectId: string) => boolean;
  deleteProject: (projectId?: string) => boolean;
  listProjects: () => HardwareGraph[];
}

import { getCurrentUserId } from "../auth/session.ts";

function storageKey() {
  const uid = getCurrentUserId();
  return uid ? `schematic-projects:${uid}` : "schematic-projects";
}
function legacyKey() {
  const uid = getCurrentUserId();
  return uid ? `schematic-project:${uid}` : "schematic-project";
}
const PROJECTS_STORAGE_KEY = "schematic-projects";
const LEGACY_PROJECT_STORAGE_KEY = "schematic-project";
const projectChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("schematic-project-sync") : null;
let loadedRoomId = getCurrentUserId();

// Per-user room: projects are stored on device keyed by the verified session
// subject. The browser never chooses a different user's room.

type StoredProjects = { version: 1; activeProjectId: string; projects: HardwareGraph[]; updatedAt?: string };

/**
 * Keep the in-browser room comfortably below the repository adapter's 10 MiB
 * ceiling. The lower application limit leaves space for the storage envelope,
 * timestamps, and future schema metadata without turning quota failures into
 * partially-applied Zustand updates.
 */
export const MAX_PROJECTS_PER_WORKSPACE = 50;
export const MAX_WORKSPACE_SERIALIZED_BYTES = 8 * 1024 * 1024;
let workspaceRecoveryError: string | null = null;
let workspaceRecoveryBaseline: { projectCount: number; serializedBytes: number } | null = null;
const MAX_RECOVERY_PROJECTS = 200;
const MAX_RECOVERY_WORKSPACE_BYTES = 10 * 1024 * 1024;

export class WorkspaceCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceCapacityError";
  }
}

/** Structured graph diagnostics raised while a new wire is being verified. */
export class ConnectionValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(issues[0]?.message ?? "The connection conflicts with graph rules.");
    this.name = "ConnectionValidationError";
    this.issues = issues;
  }
}

export function getWorkspaceRecoveryError() {
  return workspaceRecoveryError;
}

export function enterWorkspaceRecovery(message: string, workspace?: Pick<StoredProjects, "projects" | "activeProjectId">) {
  workspaceRecoveryError = message;
  workspaceRecoveryBaseline = workspace ? {
    projectCount: workspace.projects.length,
    serializedBytes: workspaceSerializedByteLength(workspace.projects, workspace.activeProjectId),
  } : null;
}

function workspaceSerializedByteLength(projects: readonly HardwareGraph[], activeProjectId: string, updatedAt = ""): number {
  return new TextEncoder().encode(JSON.stringify({ version: 1, activeProjectId, projects, updatedAt })).byteLength;
}

function assertWorkspaceCapacity(projects: readonly HardwareGraph[], activeProjectId: string, updatedAt = "") {
  if (projects.length > MAX_PROJECTS_PER_WORKSPACE) {
    throw new WorkspaceCapacityError(`Workspace recovery required: the durable room exceeds ${MAX_PROJECTS_PER_WORKSPACE} projects. Its original data was left untouched.`);
  }
  if (workspaceSerializedByteLength(projects, activeProjectId, updatedAt) > MAX_WORKSPACE_SERIALIZED_BYTES) {
    throw new WorkspaceCapacityError("Workspace recovery required: the durable room exceeds 8 MiB. Its original data was left untouched.");
  }
}

export function normalizeStoredWorkspace(values: readonly unknown[], preferredActiveProjectId: unknown): StoredProjects {
  if (values.length > MAX_PROJECTS_PER_WORKSPACE) {
    throw new WorkspaceCapacityError(`Workspace recovery required: the durable room exceeds ${MAX_PROJECTS_PER_WORKSPACE} projects. Its original data was left untouched.`);
  }
  const projects = values.map((project) => normalizeProject(project));
  if (!projects.length) throw new Error("A durable workspace must contain at least one project");
  const requestedActiveProjectId = typeof preferredActiveProjectId === "string" ? preferredActiveProjectId : "";
  const activeProjectId = projects.some((project) => project.id === requestedActiveProjectId)
    ? requestedActiveProjectId
    : projects[0].id;
  assertWorkspaceCapacity(projects, activeProjectId);
  return { version: 1, activeProjectId, projects };
}

/**
 * Recovery-only hydration for rooms written by an older release between the
 * new 8 MiB/50-project app limit and the durable repository's 10 MiB limit.
 * It exposes the original normalized projects without silently dropping any,
 * while ordinary mutations remain blocked until a confirmed clear/delete
 * operation makes the room strictly smaller.
 */
export function normalizeRecoveryWorkspace(values: readonly unknown[], preferredActiveProjectId: unknown): StoredProjects {
  const rawBytes = new TextEncoder().encode(JSON.stringify({ projects: values })).byteLength;
  if (values.length === 0 || values.length > MAX_RECOVERY_PROJECTS || rawBytes > MAX_RECOVERY_WORKSPACE_BYTES) {
    throw new WorkspaceCapacityError("Workspace recovery requires manual backup: the durable room exceeds the bounded 10 MiB/200-project recovery window. Its original data was left untouched.");
  }
  const projects = values.map((project) => normalizeProject(project));
  const requestedActiveProjectId = typeof preferredActiveProjectId === "string" ? preferredActiveProjectId : "";
  const activeProjectId = projects.some((project) => project.id === requestedActiveProjectId) ? requestedActiveProjectId : projects[0].id;
  return { version: 1, activeProjectId, projects };
}

function makeId(prefix: string) {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return `${prefix}-${uuid}`;
}

function now() { return new Date().toISOString(); }

function connectionAttemptIssue(
  code: string,
  message: string,
  source: { componentId: string; portId: string },
  target: { componentId: string; portId: string },
): ValidationIssue {
  const scope = [source.componentId, source.portId, target.componentId, target.portId]
    .map((value) => encodeURIComponent(value).slice(0, 40))
    .join("-");
  return {
    id: `connection-attempt-${code}-${scope}`.slice(0, 160),
    severity: "error",
    code,
    message,
    affectedComponents: [...new Set([source.componentId, target.componentId])].slice(0, 2),
  };
}

function cloneBoundedProjectJson(value: unknown, budget: { nodes: number }, depth = 0): unknown {
  budget.nodes += 1;
  if (budget.nodes > 100_000 || depth > 16) return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return value.length <= 65_536 ? value : undefined;
  if (Array.isArray(value)) {
    if (value.length > 20_000) return undefined;
    const result: unknown[] = [];
    for (const item of value) {
      const cloned = cloneBoundedProjectJson(item, budget, depth + 1);
      if (cloned === undefined && item !== undefined) return undefined;
      result.push(cloned);
    }
    return result;
  }
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 20_000 || entries.some(([key]) => key.length > 240)) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, item] of entries) {
    const cloned = cloneBoundedProjectJson(item, budget, depth + 1);
    if (cloned === undefined && item !== undefined) return undefined;
    if (cloned !== undefined) {
      Object.defineProperty(result, key, { value: cloned, enumerable: true, configurable: true, writable: true });
    }
  }
  return result;
}

/**
 * A graph edit invalidates a code document's declarative preview relation, but
 * never edits its source. Keep the original hashes so the user can see what
 * changed and explicitly relink/export a new revision later.
 */
function markCodeDocumentsStale(
  documents: readonly CodeDocumentRecord[] | undefined,
  changed: "code" | "plan" | "project",
): CodeDocumentRecord[] | undefined {
  if (!documents) return documents;
  return documents.map((document) => markCodeDocumentStale(document, changed));
}

function markCodeDocumentStale(
  document: CodeDocumentRecord,
  changed: "code" | "plan" | "project",
): CodeDocumentRecord {
  if (document.previewLink.status === "unlinked") return document;
  const previous = document.previewLink;
  const changedFields = new Set<"code" | "plan" | "project">(previous.status === "stale" ? previous.changed : []);
  changedFields.add(changed);
  return {
    ...document,
    previewLink: {
      status: "stale" as const,
      behaviorPlanId: previous.behaviorPlanId,
      behaviorPlanSha256: previous.behaviorPlanSha256,
      projectSha256: previous.projectSha256,
      linkedContentSha256: previous.linkedContentSha256,
      changed: [...changedFields],
    },
  };
}

// Hardware nodes are rendered at roughly 270px wide and the largest board
// definitions are about 350px tall. Keep the automatic placement cells larger
// than that footprint so a click-to-add or an agent add without coordinates
// never stacks new nodes on top of the existing graph.
const COMPONENT_LAYOUT_ORIGIN = { x: 80, y: 80 };
const COMPONENT_LAYOUT_COLUMNS = 4;
const COMPONENT_LAYOUT_COLUMN_STEP = 360;
const COMPONENT_LAYOUT_ROW_STEP = 460;
const COMPONENT_LAYOUT_BOX = { width: 300, height: 420 };
const COMPONENT_LAYOUT_GAP = 18;

function boxesOverlap(a: { x: number; y: number }, b: { x: number; y: number }) {
  return a.x < b.x + COMPONENT_LAYOUT_BOX.width + COMPONENT_LAYOUT_GAP
    && a.x + COMPONENT_LAYOUT_BOX.width + COMPONENT_LAYOUT_GAP > b.x
    && a.y < b.y + COMPONENT_LAYOUT_BOX.height + COMPONENT_LAYOUT_GAP
    && a.y + COMPONENT_LAYOUT_BOX.height + COMPONENT_LAYOUT_GAP > b.y;
}

/** Find the first conservative grid cell that does not collide with a node. */
export function nextComponentPosition(components: Array<{ position: { x: number; y: number } }>) {
  const initialScanCells = Math.max(components.length + 1, COMPONENT_LAYOUT_COLUMNS) * COMPONENT_LAYOUT_COLUMNS;
  for (let index = 0; index < initialScanCells; index += 1) {
    const candidate = {
      x: COMPONENT_LAYOUT_ORIGIN.x + (index % COMPONENT_LAYOUT_COLUMNS) * COMPONENT_LAYOUT_COLUMN_STEP,
      y: COMPONENT_LAYOUT_ORIGIN.y + Math.floor(index / COMPONENT_LAYOUT_COLUMNS) * COMPONENT_LAYOUT_ROW_STEP,
    };
    if (components.every((component) => !boxesOverlap(candidate, component.position))) return candidate;
  }

  // A manually positioned component can block more than one grid cell, so the
  // bounded first pass is followed by a bounded row scan. Every fallback
  // candidate is checked before returning; failure is explicit rather than an
  // unchecked coordinate that could reintroduce overlap.
  const firstFallbackRow = Math.ceil(initialScanCells / COMPONENT_LAYOUT_COLUMNS);
  const lastFallbackRow = firstFallbackRow + Math.max(components.length * 2 + 4, 8);
  for (let row = firstFallbackRow; row <= lastFallbackRow; row += 1) {
    for (let column = 0; column < COMPONENT_LAYOUT_COLUMNS; column += 1) {
      const candidate = {
        x: COMPONENT_LAYOUT_ORIGIN.x + column * COMPONENT_LAYOUT_COLUMN_STEP,
        y: COMPONENT_LAYOUT_ORIGIN.y + row * COMPONENT_LAYOUT_ROW_STEP,
      };
      if (components.every((component) => !boxesOverlap(candidate, component.position))) return candidate;
    }
  }

  throw new Error("Unable to find a free canvas position for the new component");
}

/** Repair only legacy graphs whose saved node rectangles already collide. */
function repairOverlappingComponentPositions<T extends { position: { x: number; y: number } }>(components: T[]) {
  for (let index = 0; index < components.length; index += 1) {
    for (let previous = 0; previous < index; previous += 1) {
      if (boxesOverlap(components[index].position, components[previous].position)) return layoutComponentPositions(components);
    }
  }
  return components;
}

/** Stable layout shared by the visible auto-layout action and WebMCP. */
export function layoutComponentPositions<T extends { position: { x: number; y: number } }>(components: T[]) {
  return components.map((component, index) => ({
    ...component,
    position: {
      x: COMPONENT_LAYOUT_ORIGIN.x + (index % COMPONENT_LAYOUT_COLUMNS) * COMPONENT_LAYOUT_COLUMN_STEP,
      y: COMPONENT_LAYOUT_ORIGIN.y + Math.floor(index / COMPONENT_LAYOUT_COLUMNS) * COMPONENT_LAYOUT_ROW_STEP,
    },
  }));
}

function uniqueProjectName(name: string, projects: HardwareGraph[], excludeId?: string) {
  const base = name.trim().slice(0, 120) || "Untitled";
  const used = new Set(projects.filter((project) => project.id !== excludeId).map((project) => project.name.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  let suffix = 2;
  while (used.has(`${base} ${suffix}`.toLowerCase())) suffix += 1;
  return `${base} ${suffix}`;
}

export function normalizeProject(stored: unknown, fallbackId?: string): HardwareGraph {
  const value = stored && typeof stored === "object" ? stored as Record<string, any> : {};
  const timestamp = now();
  const jsonBudget = { nodes: 0 };
  const components = Array.isArray(value.components) ? value.components.slice(0, MAX_COMPONENTS_PER_PROJECT).map((component: any) => {
    const x = Number(component?.position?.x ?? 100);
    const y = Number(component?.position?.y ?? 100);
    return {
      id: String(component?.id ?? makeId("component")),
      definitionId: String(component?.definitionId ?? "unknown"),
      position: { x: Number.isFinite(x) ? x : 100, y: Number.isFinite(y) ? y : 100 },
      rotation: [0, 90, 180, 270].includes(component?.rotation) ? component.rotation : 0,
      properties: { ...defaultProperties(String(component?.definitionId ?? "unknown")), ...((cloneBoundedProjectJson(component?.properties, jsonBudget) as Record<string, unknown> | undefined) ?? {}) },
      ...(typeof component?.label === "string" ? { label: component.label.slice(0, 240) } : {}),
    };
  }) : [];
  const projectId = typeof value.id === "string" && value.id ? value.id : fallbackId ?? makeId("proj");
  const rawLegacyTargets = Array.isArray(value.firmwareTargets)
    ? value.firmwareTargets.slice(0, MAX_LEGACY_FIRMWARE_TARGETS_PER_PROJECT).filter((target: unknown): target is Record<string, unknown> => Boolean(target && typeof target === "object" && !Array.isArray(target)))
    : [];
  const normalizedBehaviorPlans = Array.isArray(value.behaviorPlans)
    ? value.behaviorPlans.slice(0, MAX_BEHAVIOR_PLANS_PER_PROJECT).flatMap((plan: unknown) => {
        const normalized = normalizeBehaviorPlan(plan, projectId);
        return normalized ? [normalized] : [];
      })
    : [];
  const explicitCodeDocuments: CodeDocumentRecord[] = [];
  let projectSourceBytes = 0;
  if (Array.isArray(value.codeDocuments)) {
    for (const rawDocument of value.codeDocuments.slice(0, MAX_CODE_DOCUMENTS_PER_PROJECT)) {
      const normalized = normalizeCodeDocument(rawDocument, projectId);
      if (!normalized) continue;
      const bytes = codeFilesByteLength(normalized.files);
      if (projectSourceBytes + bytes > MAX_PROJECT_SOURCE_BYTES) break;
      explicitCodeDocuments.push(normalized);
      projectSourceBytes += bytes;
    }
  }
  const codeDocuments = [...explicitCodeDocuments];
  const codeDocumentTargets = new Set(codeDocuments.map((document) => document.targetComponentId));
  const componentById = new Map(components.map((component) => [component.id, component]));
  // Firmware targets are the legacy source-file container. Materialize a
  // durable editable document once, without carrying compiled artifacts into
  // the new code-document record or using source as preview input.
  for (const target of rawLegacyTargets) {
    if (codeDocuments.length >= MAX_CODE_DOCUMENTS_PER_PROJECT) break;
    const componentId = typeof target.componentId === "string" ? target.componentId : "";
    if (!componentId || codeDocumentTargets.has(componentId)) continue;
    const component = componentById.get(componentId);
    const legacyDocumentId = `code-legacy-${sha256(String(target.id ?? componentId)).slice(0, 32)}`;
    const document = codeDocumentFromLegacyTarget(target, projectId, component?.definitionId ?? "unknown", legacyDocumentId);
    const documentBytes = document ? codeFilesByteLength(document.files) : 0;
    if (document && projectSourceBytes + documentBytes <= MAX_PROJECT_SOURCE_BYTES) {
      codeDocuments.push(document);
      codeDocumentTargets.add(componentId);
      projectSourceBytes += documentBytes;
    }
  }
  const clonedLegacyBehaviorData = cloneBoundedProjectJson(value.legacyBehaviorData, jsonBudget);
  const legacyBehaviorData: Record<string, unknown> = clonedLegacyBehaviorData && typeof clonedLegacyBehaviorData === "object" && !Array.isArray(clonedLegacyBehaviorData)
    ? clonedLegacyBehaviorData as Record<string, unknown>
    : {};
  // Future plan versions are preserved as inert data so an older app does not
  // destroy work it cannot validate. They are deliberately not promoted into
  // the executable Behavior System.
  if (Array.isArray(value.behaviorPlans)) {
    const unsupportedPlans = value.behaviorPlans.slice(0, MAX_BEHAVIOR_PLANS_PER_PROJECT).filter((plan: any) => plan?.schemaVersion !== 1).flatMap((plan: unknown) => {
      const cloned = cloneBoundedProjectJson(plan, jsonBudget);
      return cloned === undefined ? [] : [cloned];
    });
    if (unsupportedPlans.length) legacyBehaviorData.unsupportedBehaviorPlans = unsupportedPlans;
  }
  if (rawLegacyTargets.some((target) => target.compiledArtifact !== undefined)) {
    legacyBehaviorData.compiledArtifacts = rawLegacyTargets.flatMap((target) => {
      const artifact = cloneBoundedProjectJson(target.compiledArtifact, jsonBudget);
      return artifact && typeof artifact === "object" ? [{ targetId: String(target.id ?? "").slice(0, MAX_PERSISTED_ID_LENGTH), artifact }] : [];
    });
  }
  if (value.simulation && typeof value.simulation === "object" && !Array.isArray(value.simulation)) {
    // Legacy simulation configuration is retained for round-trip awareness,
    // but is not part of the canonical Behavior Preview project state.
    const legacySimulation = cloneBoundedProjectJson(value.simulation, jsonBudget);
    if (legacySimulation !== undefined) legacyBehaviorData.legacySimulation = legacySimulation;
  }
  return {
    id: projectId,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim().slice(0, 120) : "Untitled",
    description: typeof value.description === "string" ? value.description : undefined,
    components: repairOverlappingComponentPositions(components),
    connections: Array.isArray(value.connections) ? value.connections.slice(0, MAX_CONNECTIONS_PER_PROJECT).map((connection: any) => ({
      id: String(connection?.id ?? makeId("conn")),
      source: { componentId: String(connection?.source?.componentId ?? ""), portId: String(connection?.source?.portId ?? "") },
      target: { componentId: String(connection?.target?.componentId ?? ""), portId: String(connection?.target?.portId ?? "") },
      domain: String(connection?.domain ?? "gpio"),
    })) : [],
    firmwareTargets: rawLegacyTargets.map((target: any) => {
      // Compiled artifacts are accepted at the import boundary for old files,
      // but they are quarantined above and must never remain an active
      // canonical target field. Preserve every other unknown legacy field.
      const canonicalDocument = codeDocuments.find((document) => document.targetComponentId === String(target?.componentId ?? ""));
      return ({
        id: String(target?.id ?? makeId("fw")).slice(0, MAX_PERSISTED_ID_LENGTH),
        componentId: String(target?.componentId ?? "").slice(0, MAX_PERSISTED_ID_LENGTH),
        definitionId: typeof target?.definitionId === "string" ? target.definitionId.slice(0, MAX_PERSISTED_ID_LENGTH) : undefined,
        language: typeof target?.language === "string" ? target.language : "arduino",
        boardFqbn: typeof target?.boardFqbn === "string" ? target.boardFqbn.slice(0, 200) : undefined,
        files: canonicalDocument?.files.map((file) => ({ ...file })) ?? [],
      });
    }),
    behaviorPlans: normalizedBehaviorPlans,
    codeDocuments,
    ...(Object.keys(legacyBehaviorData).length ? { legacyBehaviorData } : {}),
    createdAt: typeof value.createdAt === "string" ? value.createdAt : timestamp,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : timestamp,
    version: 1,
  };
}

function emptyProject(name = "Untitled"): HardwareGraph {
  const timestamp = now();
  return { id: makeId("proj"), name, components: [], connections: [], firmwareTargets: [], behaviorPlans: [], codeDocuments: [], createdAt: timestamp, updatedAt: timestamp, version: 1 };
}

function readStoredState(): StoredProjects {
  workspaceRecoveryError = null;
  workspaceRecoveryBaseline = null;
  try {
    if (typeof localStorage === "undefined") return { version: 1, activeProjectId: "", projects: [emptyProject()] };
    const userId = getCurrentUserId();
    // A hosted account must never inherit the anonymous/global room. Keep the
    // fallback only for local development and for the short pre-auth bootstrap
    // before the session lookup has resolved.
    const tryKeys = userId && userId !== "local-development"
      ? [storageKey()]
      : [storageKey(), PROJECTS_STORAGE_KEY, legacyKey(), LEGACY_PROJECT_STORAGE_KEY];
    for (const key of tryKeys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const stored = JSON.parse(raw);
      if (stored && Array.isArray(stored.projects) && stored.projects.length > 0) {
        let normalized: StoredProjects;
        try {
          normalized = normalizeStoredWorkspace(stored.projects, stored.activeProjectId);
        } catch (error) {
          if (!(error instanceof WorkspaceCapacityError)) throw error;
          normalized = normalizeRecoveryWorkspace(stored.projects, stored.activeProjectId);
          enterWorkspaceRecovery(error.message, normalized);
        }
        const { projects, activeProjectId } = normalized;
        // Migrate legacy keys only inside the local development room. Never
        // copy an anonymous/global room into a hosted user's account.
        if (key !== storageKey() && (!userId || userId === "local-development")) {
          try { localStorage.setItem(storageKey(), JSON.stringify({ version: 1, activeProjectId, projects })); } catch {}
        }
        return { version: 1, activeProjectId, projects };
      }
      if (stored && typeof stored === "object" && !Array.isArray(stored.projects)) {
        // Legacy single project shape
        const project = normalizeProject(stored);
        if (!userId || userId === "local-development") {
          try { localStorage.setItem(storageKey(), JSON.stringify({ version: 1, activeProjectId: project.id, projects: [project] })); } catch {}
        }
        return { version: 1, activeProjectId: project.id, projects: [project] };
      }
    }
    // Also try legacy singletons
    for (const key of userId && userId !== "local-development" ? [] : [legacyKey(), LEGACY_PROJECT_STORAGE_KEY]) {
      const legacy = JSON.parse(localStorage.getItem(key) ?? "null");
      if (legacy && typeof legacy === "object") {
        const project = normalizeProject(legacy);
        try { localStorage.setItem(storageKey(), JSON.stringify({ version: 1, activeProjectId: project.id, projects: [project] })); } catch {}
        return { version: 1, activeProjectId: project.id, projects: [project] };
      }
    }
  } catch (error) {
    if (error instanceof WorkspaceCapacityError) workspaceRecoveryError = error.message;
  }
  const project = emptyProject();
  return { version: 1, activeProjectId: project.id, projects: [project] };
}

function persistState(projects: HardwareGraph[], activeProjectId: string, broadcast = true) {
  // A room transition publishes an unhydrated lease before this store is
  // synchronously swapped to the new subject's local snapshot. Refuse every
  // normal write during that window so an old UI callback cannot overwrite the
  // new subject's delayed IndexedDB workspace.
  assertPersistenceMutationReady();
  // Workspace-level time records collection-only changes such as switching or
  // deleting a project, where no remaining project's updatedAt must change.
  const updatedAt = now();
  if (workspaceRecoveryError) throw new WorkspaceCapacityError(workspaceRecoveryError);
  assertWorkspaceCapacity(projects, activeProjectId, updatedAt);
  const state: StoredProjects = { version: 1, activeProjectId, projects, updatedAt };
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(storageKey(), JSON.stringify(state));
  } catch {}
  if (broadcast) projectChannel?.postMessage({ type: "projects:update", state: { ...state, _room: getCurrentUserId() } });
}

function persistRecoveryReduction(projects: HardwareGraph[], activeProjectId: string) {
  assertPersistenceMutationReady();
  const baseline = workspaceRecoveryBaseline;
  if (!workspaceRecoveryError || !baseline) return persistState(projects, activeProjectId);
  const updatedAt = now();
  const serializedBytes = workspaceSerializedByteLength(projects, activeProjectId, updatedAt);
  const reduced = projects.length <= baseline.projectCount
    && serializedBytes <= baseline.serializedBytes
    && (projects.length < baseline.projectCount || serializedBytes < baseline.serializedBytes);
  if (!reduced) throw new WorkspaceCapacityError(`${workspaceRecoveryError} Clear a project or delete an unused project to reduce the room before editing.`);
  const state: StoredProjects = { version: 1, activeProjectId, projects, updatedAt };
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(storageKey(), JSON.stringify(state));
  } catch {}
  try {
    assertWorkspaceCapacity(projects, activeProjectId, updatedAt);
    workspaceRecoveryError = null;
    workspaceRecoveryBaseline = null;
  } catch {
    workspaceRecoveryBaseline = { projectCount: projects.length, serializedBytes };
  }
  projectChannel?.postMessage({ type: "projects:update", state: { ...state, _room: getCurrentUserId() } });
}

export function reloadForCurrentUser() {
  const nextRoomId = getCurrentUserId();
  const roomChanged = nextRoomId !== loadedRoomId;
  // Session refreshes announce the same verified subject too. Once that room
  // is hydrated, re-reading localStorage here would replace a newer IndexedDB
  // snapshot with an older synchronous fallback. Only a real room transition
  // needs the synchronous room swap; the persistence owner handles hydration
  // and same-room refreshes independently.
  // During hydration, the persistence owner may know about a room before the
  // auth event reaches this legacy store listener (or a test may provide a
  // cached auth result without emitting an event). Keep the synchronous
  // fallback swap in that case. Only a hydrated same-room refresh is safe to
  // ignore, because re-reading localStorage then could roll IndexedDB back.
  if (!roomChanged && getPersistenceGate()?.hydrated) return;
  loadedRoomId = nextRoomId;
  const next = readStoredState();
  const proj = next.projects.find((p) => p.id === next.activeProjectId) ?? next.projects[0];
  // The persistence owner has already opened the new unhydrated lease in its
  // capture-phase session listener. Tell its subscriber that this immediate
  // synchronous room projection is expected; only this one update is ignored,
  // while a real user edit made during hydration still gets reconciled.
  markExpectedPersistenceFallback();
  useProjectStore.setState({ projects: next.projects, activeProjectId: next.activeProjectId, project: proj });
  if (roomChanged) resetProjectRuntime();
  // Do not broadcast this synchronous localStorage fallback. Another tab may
  // already have the same room hydrated from a newer IndexedDB revision; a
  // pre-hydration broadcast would let that tab apply/persist stale data. The
  // persistence owner broadcasts only through normal reconciled mutations.
}

function resetProjectRuntime() {
  useSelectionStore.getState().clear();
  useGraphFocusStore.getState().clear();
  // Preview state is ephemeral and must be recreated for the newly active
  // graph; no firmware/runtime store belongs to the project repository.
  useBehaviorPreviewStore.getState().setSnapshot(null, "idle");
  useBehaviorPreviewStore.getState().setDiagnostics([]);
  useValidationStore.getState().clear();
}

const initialState = readStoredState();
const initialProject = initialState.projects.find((project) => project.id === initialState.activeProjectId) ?? initialState.projects[0];

/**
 * Validation verdicts describe one exact semantic graph revision. Canvas
 * position, labels, plans, and editable source are outside that verdict, so
 * those high-frequency/artifact-only changes must not erase a still-current
 * result. Component properties are compared canonically only after their
 * immutable references differ, keeping the common drag path allocation-free.
 */
function validationGraphReferencesEqual(left: HardwareGraph, right: HardwareGraph) {
  if (left.id !== right.id
    || left.components.length !== right.components.length
    || left.connections.length !== right.connections.length) return false;
  for (let index = 0; index < left.components.length; index += 1) {
    const a = left.components[index];
    const b = right.components[index];
    if (a === b) continue;
    if (a.id !== b.id || a.definitionId !== b.definitionId) return false;
    if (a.properties !== b.properties && sha256(a.properties) !== sha256(b.properties)) return false;
  }
  for (let index = 0; index < left.connections.length; index += 1) {
    const a = left.connections[index];
    const b = right.connections[index];
    if (a === b) continue;
    if (a.id !== b.id || a.domain !== b.domain
      || a.source.componentId !== b.source.componentId || a.source.portId !== b.source.portId
      || a.target.componentId !== b.target.componentId || a.target.portId !== b.target.portId) return false;
  }
  return true;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: initialProject,
  projects: initialState.projects,
  activeProjectId: initialProject.id,

  setProjectName(name) {
    get().renameProject(get().activeProjectId, name);
  },

  renameProject(projectId, name) {
    const current = get().projects.find((item) => item.id === projectId);
    if (!current) return null;
    const nextName = uniqueProjectName(name, get().projects, projectId);
    set((state) => {
      const renamed = { ...current, name: nextName, updatedAt: now() };
      const projects = state.projects.map((item) => item.id === projectId ? renamed : item);
      persistState(projects, state.activeProjectId);
      return { project: state.activeProjectId === projectId ? renamed : state.project, projects };
    });
    return nextName;
  },

  addComponent(definitionId, pos) {
    if (!getCatalogComponent(definitionId)) throw new Error(`Unknown component definition ${definitionId}`);
    if (get().project.components.length >= MAX_COMPONENTS_PER_PROJECT) throw new Error(`A project may contain at most ${MAX_COMPONENTS_PER_PROJECT} components`);
    const id = `${definitionId}-${Math.random().toString(36).slice(2, 8)}`;
    const position = pos ?? nextComponentPosition(get().project.components);
    set((state) => {
      const codeDocuments = markCodeDocumentsStale(state.project.codeDocuments, "project");
      const project = { ...state.project, components: [...state.project.components, { id, definitionId, position, rotation: 0, properties: defaultProperties(definitionId) }], ...(codeDocuments ? { codeDocuments } : {}), updatedAt: now() };
      const projects = state.projects.map((item) => item.id === project.id ? project : item);
      persistState(projects, state.activeProjectId);
      return { project, projects };
    });
    return { id };
  },

  moveComponent(id, position) {
    set((state) => {
      const project = { ...state.project, components: state.project.components.map((component) => component.id === id ? { ...component, position } : component), updatedAt: now() };
      const projects = state.projects.map((item) => item.id === project.id ? project : item);
      persistState(projects, state.activeProjectId);
      return { project, projects };
    });
  },

  removeComponent(id) {
    set((state) => {
      const remainingCodeDocuments = (state.project.codeDocuments ?? []).filter((document) => document.targetComponentId !== id);
      const project = {
        ...state.project,
        components: state.project.components.filter((component) => component.id !== id),
        connections: state.project.connections.filter((connection) => connection.source.componentId !== id && connection.target.componentId !== id),
        firmwareTargets: state.project.firmwareTargets.filter((target) => target.componentId !== id),
        codeDocuments: markCodeDocumentsStale(remainingCodeDocuments, "project") ?? [],
        updatedAt: now(),
      };
      const projects = state.projects.map((item) => item.id === project.id ? project : item);
      persistState(projects, state.activeProjectId);
      return { project, projects };
    });
  },

  connectPorts(source, target) {
    const current = get().project;
    const reject = (code: string, message: string): never => {
      const issue = connectionAttemptIssue(code, message, source, target);
      useValidationStore.getState().lodgeIssues([issue]);
      throw new ConnectionValidationError([issue]);
    };
    if (current.connections.length >= MAX_CONNECTIONS_PER_PROJECT) return reject("MAX_CONNECTIONS", `A project may contain at most ${MAX_CONNECTIONS_PER_PROJECT} connections`);
    const sourcePort = componentPort(current, source.componentId, source.portId);
    const targetPort = componentPort(current, target.componentId, target.portId);
    if (!sourcePort || !targetPort) return reject("MISSING_ENDPOINT", "Both connection endpoints must reference existing component ports");
    if (source.componentId === target.componentId) return reject("SELF_CONNECTION", "A component cannot be wired to itself");
    let oriented: ReturnType<typeof orientConnectionEndpoints>;
    try {
      oriented = orientConnectionEndpoints(source, sourcePort, target, targetPort);
    } catch {
      return reject("INVALID_CONNECTION_DIRECTION", "A connection needs one driving port and one receiving port; two input or two output ports cannot be wired together");
    }
    const orientedSourcePort = componentPort(current, oriented.source.componentId, oriented.source.portId)!;
    const orientedTargetPort = componentPort(current, oriented.target.componentId, oriented.target.portId)!;
    const compatiblePower = ["power", "power_output"].includes(orientedSourcePort.domain) && ["power", "power_output"].includes(orientedTargetPort.domain);
    const duplicate = current.connections.some((connection) => (
      (connection.source.componentId === oriented.source.componentId && connection.source.portId === oriented.source.portId && connection.target.componentId === oriented.target.componentId && connection.target.portId === oriented.target.portId) ||
      (connection.source.componentId === oriented.target.componentId && connection.source.portId === oriented.target.portId && connection.target.componentId === oriented.source.componentId && connection.target.portId === oriented.source.portId)
    ));
    if (duplicate) return reject("DUPLICATE_CONNECTION", "Those ports are already connected");
    const id = makeId("conn");
    const domain = compatiblePower ? "power" : orientedSourcePort.domain;
    const candidate = { id, source: oriented.source, target: oriented.target, domain };
    const verification = validateGraphConnection(
      current as unknown as Parameters<typeof validateGraphConnection>[0],
      candidate as unknown as Parameters<typeof validateGraphConnection>[1],
      (definitionId) => getCatalogComponent(definitionId),
    );
    const errors = verification.issues.filter((issue) => issue.severity === "error");
    if (errors.length > 0) {
      const affectedComponents = [...new Set([source.componentId, target.componentId])];
      const scopedIssues = errors.map((issue) => ({
        ...issue,
        affectedComponents: [...new Set([...(issue.affectedComponents ?? []), ...affectedComponents])],
      }));
      useValidationStore.getState().lodgeIssues(scopedIssues);
      throw new ConnectionValidationError(scopedIssues);
    }
    set((state) => {
      const codeDocuments = markCodeDocumentsStale(state.project.codeDocuments, "project");
      const project = { ...state.project, connections: [...state.project.connections, candidate], ...(codeDocuments ? { codeDocuments } : {}), updatedAt: now() };
      const projects = state.projects.map((item) => item.id === project.id ? project : item);
      persistState(projects, state.activeProjectId);
      return { project, projects };
    });
    useValidationStore.getState().setResult(validateProject(get().project));
    return candidate;
  },

  disconnectPorts(connectionId) {
    set((state) => {
      const codeDocuments = markCodeDocumentsStale(state.project.codeDocuments, "project");
      const project = { ...state.project, connections: state.project.connections.filter((connection) => connection.id !== connectionId), ...(codeDocuments ? { codeDocuments } : {}), updatedAt: now() };
      const projects = state.projects.map((item) => item.id === project.id ? project : item);
      persistState(projects, state.activeProjectId);
      return { project, projects };
    });
    useValidationStore.getState().setResult(validateProject(get().project));
  },

  getGraph() { return get().project; },

  clear() {
    set((state) => {
      const project = { ...emptyProject(state.project.name), id: state.project.id, createdAt: state.project.createdAt, updatedAt: now() };
      const projects = state.projects.map((item) => item.id === project.id ? project : item);
      persistRecoveryReduction(projects, state.activeProjectId);
      return { project, projects };
    });
    resetProjectRuntime();
  },

  loadProject(graph) {
    set((state) => {
      const name = uniqueProjectName(graph.name || state.project.name, state.projects, state.activeProjectId);
      const normalized = normalizeProject({ ...graph, id: state.project.id, name });
      const project = {
        ...normalized,
        // Loading replaces graph state (and is also used by auto-layout).
        // Existing links therefore describe the pre-load graph fingerprint.
        ...(normalized.codeDocuments ? { codeDocuments: markCodeDocumentsStale(normalized.codeDocuments, "project") } : {}),
      };
      const projects = state.projects.map((item) => item.id === project.id ? project : item);
      persistState(projects, state.activeProjectId);
      return { project, projects };
    });
  },

  importProject(graph) {
    let importedProjectId = "";
    set((state) => {
      const normalized = normalizeProject({
        ...graph,
        id: makeId("proj"),
        name: uniqueProjectName(graph.name || "Imported project", state.projects),
        createdAt: now(),
        updatedAt: now(),
      });
      const project = {
        ...normalized,
        // The imported project id/fingerprint differs from the source room;
        // retain the handoff relation as stale rather than claiming a match.
        ...(normalized.codeDocuments ? { codeDocuments: markCodeDocumentsStale(normalized.codeDocuments, "project") } : {}),
      };
      importedProjectId = project.id;
      const projects = [...state.projects, project];
      persistState(projects, project.id);
      return { project, projects, activeProjectId: project.id };
    });
    resetProjectRuntime();
    return importedProjectId;
  },

  updateComponentProps(id, props) {
    set((state) => {
      const codeDocuments = markCodeDocumentsStale(state.project.codeDocuments, "project");
      const project = { ...state.project, components: state.project.components.map((component) => component.id === id ? { ...component, properties: { ...component.properties, ...props } } : component), ...(codeDocuments ? { codeDocuments } : {}), updatedAt: now() };
      const projects = state.projects.map((item) => item.id === project.id ? project : item);
      persistState(projects, state.activeProjectId);
      return { project, projects };
    });
  },

  updateFirmware(componentId, files, metadata = {}) {
    const binding = resolveFirmwareBinding(get().project, componentId);
    if (!binding.component) throw new Error(`Unknown component ${componentId}`);
    if (!isBoardDefinition(binding.definition)) throw new Error(`${componentId} is not a programmable board`);
    if (metadata.boardFqbn && binding.targetConfig && metadata.boardFqbn !== binding.targetConfig.fqbn) {
      throw new Error(`${componentId} maps to ${binding.targetConfig.fqbn}; refusing firmware for ${metadata.boardFqbn}`);
    }
    const existingDocument = get().project.codeDocuments?.find((document) => document.targetComponentId === componentId);
    const otherSourceBytes = (get().project.codeDocuments ?? []).filter((document) => document.id !== existingDocument?.id).reduce((total, document) => total + codeFilesByteLength(document.files), 0);
    if (otherSourceBytes + codeFilesByteLength(files) > MAX_PROJECT_SOURCE_BYTES) throw new Error("A project may contain at most 512 KiB of editable source across all board documents");
    set((state) => {
      const existing = state.project.firmwareTargets.find((target) => target.componentId === componentId);
      const existingDocument = state.project.codeDocuments?.find((document) => document.targetComponentId === componentId);
      const targetConfig = boardTargetFor(binding.definition?.id);
      const target = {
        id: existing?.id ?? makeId(`fw-${componentId}`),
        componentId,
        definitionId: binding.component!.definitionId,
        language: metadata.language ?? existing?.language ?? targetConfig?.language ?? "arduino",
        boardFqbn: metadata.boardFqbn ?? targetConfig?.fqbn ?? existing?.boardFqbn,
        files,
      };
      const firmwareTargets = existing
        ? state.project.firmwareTargets.map((item) => item.componentId === componentId ? target : item)
        : [...state.project.firmwareTargets, target];
      const document = normalizeCodeDocument({
        schemaVersion: 1,
        id: existingDocument?.id ?? `code-${componentId}`,
        projectId: state.project.id,
        targetComponentId: componentId,
        targetDefinitionId: binding.component!.definitionId,
        ...(target.boardFqbn ? { boardFqbn: target.boardFqbn } : {}),
        language: target.language,
        files,
        dependencies: existingDocument?.dependencies ?? [],
        revision: existingDocument ? existingDocument.revision + 1 : 1,
        origin: existingDocument?.origin ?? "human-authored",
        previewLink: existingDocument ? markCodeDocumentStale(existingDocument, "code").previewLink : { status: "unlinked" },
        exportHistory: existingDocument?.exportHistory ?? [],
        inAppVerification: "not-performed",
        updatedAt: now(),
      }, state.project.id, { targetComponentId: componentId, targetDefinitionId: binding.component!.definitionId, id: existingDocument?.id });
      const codeDocuments = document
        ? [...(state.project.codeDocuments ?? []).filter((item) => item.id !== document.id), document]
        : state.project.codeDocuments;
      const project = { ...state.project, firmwareTargets, ...(codeDocuments ? { codeDocuments } : {}), updatedAt: now() };
      const projects = state.projects.map((item) => item.id === project.id ? project : item);
      persistState(projects, state.activeProjectId);
      return { project, projects };
    });
  },

  writeBehaviorPlan(rawPlan, expectedRevision) {
    const state = get();
    const normalized = normalizeBehaviorPlan(rawPlan, state.project.id);
    if (!normalized) throw new Error("Behavior Plan must be a version 1 object with a valid id and rules array");
    if (normalized.projectId !== state.project.id) throw new Error(`Behavior Plan ${normalized.id} belongs to ${normalized.projectId}, not the active project ${state.project.id}`);
    const existing = (state.project.behaviorPlans ?? []).find((plan) => plan.id === normalized.id);
    const currentRevision = existing?.revision ?? null;
    if (expectedRevision !== currentRevision) {
      return { plan: existing ?? normalized, replaced: false, conflict: existing ? { current: existing } : { deleted: true } };
    }
    if (!existing && (state.project.behaviorPlans?.length ?? 0) >= MAX_BEHAVIOR_PLANS_PER_PROJECT) {
      throw new Error(`A project may contain at most ${MAX_BEHAVIOR_PLANS_PER_PROJECT} Behavior Plans`);
    }
    const plan: BehaviorPlanRecord = {
      ...normalized,
      revision: existing ? existing.revision + 1 : normalized.revision,
    };
    const planChanged = !existing || sha256(existing) !== sha256(plan);
    set((current) => {
      const behaviorPlans = [...(current.project.behaviorPlans ?? []).filter((item) => item.id !== plan.id), plan];
      const codeDocuments = planChanged
        ? (current.project.codeDocuments ?? []).map((document) => {
            if (document.previewLink.status === "unlinked" || document.previewLink.behaviorPlanId !== plan.id) return document;
            return markCodeDocumentStale(document, "plan");
          })
        : current.project.codeDocuments;
      const project = { ...current.project, behaviorPlans, codeDocuments, updatedAt: now() };
      const projects = current.projects.map((item) => item.id === project.id ? project : item);
      persistState(projects, current.activeProjectId);
      return { project, projects };
    });
    return { plan, replaced: Boolean(existing) };
  },

  getBehaviorPlan(planId) {
    const plans = get().project.behaviorPlans ?? [];
    if (planId) return plans.find((plan) => plan.id === planId);
    return plans[0];
  },

  writeCodeDocument(request) {
    const state = get();
    const targetComponentId = request.targetComponentId.trim();
    const component = state.project.components.find((item) => item.id === targetComponentId);
    if (!component) throw new Error(`Unknown code target component ${targetComponentId}`);
    if (request.targetDefinitionId && request.targetDefinitionId !== component.definitionId) throw new Error(`Code target ${targetComponentId} is ${component.definitionId}, not ${request.targetDefinitionId}`);
    const targetDefinitionId = component.definitionId;
    const expectedBoard = boardTargetFor(component.definitionId);
    if (request.boardFqbn && expectedBoard && request.boardFqbn !== expectedBoard.fqbn) throw new Error(`${targetComponentId} maps to ${expectedBoard.fqbn}; refusing source metadata for ${request.boardFqbn}`);
    const documents = state.project.codeDocuments ?? [];
    const current = documents.find((document) => document.targetComponentId === targetComponentId);
    if (!current && documents.length >= MAX_CODE_DOCUMENTS_PER_PROJECT) {
      throw new Error(`A project may contain at most ${MAX_CODE_DOCUMENTS_PER_PROJECT} code documents`);
    }
    if (request.files.some((file) => typeof file?.content !== "string")) throw new Error("Every code file must contain exact string content");
    const otherSourceBytes = documents.filter((document) => document.id !== current?.id).reduce((total, document) => total + codeFilesByteLength(document.files), 0);
    if (otherSourceBytes + codeFilesByteLength(request.files) > MAX_PROJECT_SOURCE_BYTES) throw new Error("A project may contain at most 512 KiB of editable source across all board documents");
    const expected = request.expectedContentSha256;
    if (expected !== undefined) {
      const currentHash = current?.contentSha256 ?? null;
      if (currentHash !== expected || (expected === null && current)) {
        return { document: current ?? normalizeCodeDocument({
          schemaVersion: 1,
          id: `code-${targetComponentId}`,
          projectId: state.project.id,
          targetComponentId,
          targetDefinitionId,
          language: request.language,
          files: [],
          dependencies: [],
          revision: 1,
          contentSha256: "",
          exportHistory: [],
          origin: "imported",
          previewLink: { status: "unlinked" },
          inAppVerification: "not-performed",
          updatedAt: now(),
        }, state.project.id, { targetComponentId, targetDefinitionId })!, replaced: false, conflict: current ? { current } : { deleted: true } };
      }
    }
    const normalizedCandidate = normalizeCodeDocument({
      schemaVersion: 1,
      id: current?.id ?? `code-${targetComponentId}`,
      projectId: state.project.id,
      targetComponentId,
      targetDefinitionId,
      ...(request.boardFqbn ? { boardFqbn: request.boardFqbn } : current?.boardFqbn ? { boardFqbn: current.boardFqbn } : {}),
      language: request.language,
      files: request.files,
      dependencies: request.dependencies ?? current?.dependencies ?? [],
      revision: current ? current.revision + 1 : 1,
      contentSha256: request.contentSha256 ?? current?.contentSha256 ?? "",
      exportHistory: current?.exportHistory ?? [],
      origin: request.origin ?? current?.origin ?? "ai-generated",
      previewLink: request.linkToBehaviorPlan ?? { status: "unlinked" },
      inAppVerification: "not-performed",
      updatedAt: now(),
    }, state.project.id, { targetComponentId, targetDefinitionId, id: current?.id });
    if (!normalizedCandidate) throw new Error(`Code document for ${targetComponentId} could not be normalized`);

    // A source edit must not silently claim that it still corresponds to the
    // exact Behavior Plan/graph revision that was previously linked. If the
    // caller supplies a fresh exact link, it has explicitly re-associated the
    // document. Otherwise preserve an unchanged link, or mark a changed one
    // stale while keeping the original hashes for auditability.
    const previewLink = request.linkToBehaviorPlan
      ? normalizedCandidate.previewLink
      : !current || current.previewLink.status === "unlinked"
        ? { status: "unlinked" as const }
        : current.previewLink.linkedContentSha256 === normalizedCandidate.contentSha256
          ? current.previewLink
          : markCodeDocumentStale(current, "code").previewLink;
    const normalized: CodeDocumentRecord = { ...normalizedCandidate, previewLink };
    set((currentState) => {
      const codeDocuments = [...(currentState.project.codeDocuments ?? []).filter((item) => item.id !== normalized.id), normalized];
      // Keep the legacy firmware target in sync for existing graph/runtime
      // consumers. It is a compatibility mirror only; the new preview never
      // reads or executes these source files.
      const existingTarget = currentState.project.firmwareTargets.find((target) => target.componentId === targetComponentId);
      const firmwareTarget = {
        id: existingTarget?.id ?? `fw-${targetComponentId}`,
        componentId: targetComponentId,
        definitionId: component.definitionId,
        language: normalized.language,
        boardFqbn: normalized.boardFqbn ?? existingTarget?.boardFqbn ?? "",
        files: normalized.files.map((file) => ({ name: file.name, content: file.content })),
      };
      const firmwareTargets = existingTarget
        ? currentState.project.firmwareTargets.map((target) => target.componentId === targetComponentId ? firmwareTarget : target)
        : [...currentState.project.firmwareTargets, firmwareTarget];
      const project = { ...currentState.project, codeDocuments, firmwareTargets, updatedAt: now() };
      const projects = currentState.projects.map((item) => item.id === project.id ? project : item);
      persistState(projects, currentState.activeProjectId);
      return { project, projects };
    });
    return { document: normalized, replaced: Boolean(current) };
  },

  getCodeDocument(targetComponentId, documentId) {
    const documents = get().project.codeDocuments ?? [];
    if (documentId) return documents.find((document) => document.id === documentId);
    if (targetComponentId) return documents.find((document) => document.targetComponentId === targetComponentId);
    return documents[0];
  },

  recordCodeExport(documentId, exportRecord) {
    let updated = false;
    set((currentState) => {
      const currentDocument = (currentState.project.codeDocuments ?? []).find((document) => document.id === documentId);
      if (!currentDocument) return currentState;
      const nextDocument: CodeDocumentRecord = {
        ...currentDocument,
        exportHistory: [...currentDocument.exportHistory, exportRecord].slice(-50),
      };
      const codeDocuments = (currentState.project.codeDocuments ?? []).map((document) => document.id === documentId ? nextDocument : document);
      const project = { ...currentState.project, codeDocuments, updatedAt: now() };
      const projects = currentState.projects.map((item) => item.id === project.id ? project : item);
      persistState(projects, currentState.activeProjectId);
      updated = true;
      return { project, projects };
    });
    return updated;
  },

  setCompiledArtifact(componentId, artifact) {
    set((state) => {
      const targetExists = state.project.firmwareTargets.some((target) => target.componentId === componentId);
      if (!targetExists) return state;
      const existingArtifacts = Array.isArray(state.project.legacyBehaviorData?.compiledArtifacts)
        ? state.project.legacyBehaviorData.compiledArtifacts
        : [];
      const legacyBehaviorData = {
        ...(state.project.legacyBehaviorData ?? {}),
        // Keep this compatibility API data-only and inert. It is intentionally
        // not attached to firmwareTargets, so new UI/tool status cannot imply
        // that Schematic built or verified source.
        compiledArtifacts: [...existingArtifacts.filter((item) => item && typeof item === "object" && (item as Record<string, unknown>).targetId !== componentId), { targetId: componentId, artifact }],
      };
      const project = { ...state.project, legacyBehaviorData, updatedAt: now() };
      const projects = state.projects.map((item) => item.id === project.id ? project : item);
      persistState(projects, state.activeProjectId);
      return { project, projects };
    });
  },

  saveProject() {
    const state = get();
    const savedAt = now();
    persistState(state.projects, state.activeProjectId);
    return { projectId: state.activeProjectId, savedAt };
  },

  createProject(name = "Untitled") {
    let createdProjectId = "";
    set((state) => {
      const project = emptyProject(uniqueProjectName(name, state.projects));
      createdProjectId = project.id;
      const projects = [...state.projects, project];
      persistState(projects, project.id);
      return { project, projects, activeProjectId: project.id };
    });
    resetProjectRuntime();
    return createdProjectId;
  },

  duplicateProject(projectId = get().activeProjectId, name) {
    const source = get().projects.find((item) => item.id === projectId);
    if (!source) return null;
    let duplicatedProjectId = "";
    set((state) => {
      const requestedName = name?.trim() && name.trim().toLowerCase() !== source.name.trim().toLowerCase() ? name : `${source.name} copy`;
      const normalized = normalizeProject({ ...JSON.parse(JSON.stringify(source)), id: makeId("proj"), name: uniqueProjectName(requestedName, state.projects), createdAt: now(), updatedAt: now() });
      const project = {
        ...normalized,
        // Normalization re-parents embedded plans and code documents to the
        // duplicate. Retain the audit trail, but never claim the copied hashes
        // still identify this new plan/project revision.
        ...(normalized.codeDocuments ? {
          codeDocuments: markCodeDocumentsStale(markCodeDocumentsStale(normalized.codeDocuments, "plan"), "project"),
        } : {}),
      };
      duplicatedProjectId = project.id;
      const projects = [...state.projects, project];
      persistState(projects, project.id);
      return { project, projects, activeProjectId: project.id };
    });
    resetProjectRuntime();
    return duplicatedProjectId;
  },

  switchProject(projectId) {
    assertPersistenceMutationReady();
    const next = get().projects.find((item) => item.id === projectId);
    if (!next) return false;
    set((state) => {
      // Recovery mode remains navigable so every preserved project can be
      // inspected/exported and the user can choose what to clear or delete.
      // Do not rewrite the oversized durable record merely to switch views.
      if (!workspaceRecoveryError) persistState(state.projects, next.id);
      return { project: next, activeProjectId: next.id };
    });
    resetProjectRuntime();
    return true;
  },

  deleteProject(projectId = get().activeProjectId) {
    const state = get();
    if (state.projects.length <= 1 || !state.projects.some((project) => project.id === projectId)) return false;
    const projects = state.projects.filter((project) => project.id !== projectId);
    const activeProjectId = state.activeProjectId === projectId ? projects[0].id : state.activeProjectId;
    const project = projects.find((item) => item.id === activeProjectId) ?? projects[0];
    persistRecoveryReduction(projects, activeProjectId);
    set({ projects, activeProjectId, project });
    resetProjectRuntime();
    return true;
  },

  listProjects() { return get().projects; },
}));

// A pass/fail badge must never survive a semantic graph edit. This subscriber
// also covers project replacement and same-room cross-tab updates, while the
// comparison deliberately preserves verdicts across layout and source edits.
useProjectStore.subscribe((next, previous) => {
  if (!validationGraphReferencesEqual(next.project, previous.project)) {
    useValidationStore.getState().clear();
  }
});

function applyRemoteState(value: unknown) {
  if (!value || typeof value !== "object") return;
  const stored = value as any;
  // Only apply if it matches our current room (user)
  const incomingRoom = stored._room ?? null;
  const currentRoom = getCurrentUserId();
  if (incomingRoom !== currentRoom) return;
  if (!Array.isArray(stored.projects) || stored.projects.length === 0) return;
  let normalized: StoredProjects;
  try {
    normalized = normalizeStoredWorkspace(stored.projects, stored.activeProjectId);
  } catch {
    return;
  }
  const { projects, activeProjectId } = normalized;
  const previous = useProjectStore.getState().activeProjectId;
  const project = projects.find((item: HardwareGraph) => item.id === activeProjectId) ?? projects[0];
  useProjectStore.setState({ projects, activeProjectId, project });
  if (previous !== activeProjectId) resetProjectRuntime();
}

projectChannel?.addEventListener("message", (event) => {
  if (event.data?.type === "projects:update") applyRemoteState(event.data.state);
});

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (!event.newValue) return;
    if (event.key !== storageKey()) return;
    try { applyRemoteState(JSON.parse(event.newValue)); } catch {}
  });
  // When the verified session changes, reload to that subject's room.
  window.addEventListener("schematic-session", () => reloadForCurrentUser());
}
