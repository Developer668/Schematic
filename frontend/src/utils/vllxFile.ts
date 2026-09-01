import { useProjectStore, type HardwareGraph } from "../store/useProjectStore.ts";
import { boardTargetFor } from "../data/hardware.ts";
import {
  isSafeRelativeCodePath,
  MAX_CODE_DEPENDENCIES_PER_DOCUMENT,
  MAX_CODE_DOCUMENTS_PER_PROJECT,
  MAX_CODE_EXPORT_HISTORY,
  MAX_CODE_DOCUMENT_BYTES,
  MAX_CODE_FILE_BYTES,
  MAX_CODE_FILES_PER_DOCUMENT,
  MAX_COMPONENTS_PER_PROJECT,
  MAX_CONNECTIONS_PER_PROJECT,
  MAX_LEGACY_FIRMWARE_TARGETS_PER_PROJECT,
  MAX_PERSISTED_ID_LENGTH,
  MAX_PROJECT_SOURCE_BYTES,
  MAX_SERIALIZED_PROJECT_SOURCE_BYTES,
} from "../store/behaviorPersistence.ts";

export interface VlxPayload {
  format: "schematic-project";
  version: 1;
  exportedAt: string;
  name?: string;
  project: HardwareGraph;
  pinStates: Record<string, unknown>;
}

/** Keep file imports aligned with the project-storage repository's default cap. */
export const MAX_SCHEMATIC_PROJECT_FILE_BYTES = 10 * 1024 * 1024;

export function buildVlxPayload(name?: string): VlxPayload {
  const { project } = useProjectStore.getState();
  return {
    format: "schematic-project",
    version: 1,
    exportedAt: new Date().toISOString(),
    name: name ?? project.name,
    project,
    // Preview/session state is ephemeral. Keep the legacy envelope field for
    // old readers, but never export the active preview's values.
    pinStates: {},
  };
}

export function buildVlxBlob(name?: string): Blob {
  return new Blob([JSON.stringify(buildVlxPayload(name), null, 2)], { type: "application/json" });
}

export function triggerDownloadVlx(name?: string): string {
  const blob = buildVlxBlob(name);
  const safe = (name ?? "schematic-project").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80) || "schematic-project";
  const filename = `${safe}.vlx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
  return filename;
}

export async function parseVlxFile(file: File): Promise<VlxPayload> {
  const data = await readJsonFile(file);
  assertAllowedKeys(data, ["format", "version", "exportedAt", "name", "project", "pinStates"], "export");
  if (data.format !== "schematic-project") throw new Error("This is not a Schematic .vlx project file.");
  if (data.version !== 1) throw new Error(`Unsupported .vlx version ${String(data.version)}.`);
  assertVlxMetadata(data);
  assertProjectShape(data.project);
  return data as unknown as VlxPayload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must be a non-empty string.`);
}

function requireOptionalString(value: unknown, path: string) {
  if (value !== undefined && typeof value !== "string") throw new Error(`${path} must be a string.`);
}

function requireOptionalBoundedString(value: unknown, path: string, max = MAX_PERSISTED_ID_LENGTH) {
  requireOptionalString(value, path);
  if (typeof value === "string" && value.length > max) throw new Error(`${path} must contain at most ${max} characters.`);
}

function requireFiniteNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number.`);
}

const MAX_BEHAVIOR_PLANS_PER_PROJECT = 100;
const MAX_BEHAVIOR_RULES_PER_PLAN = 200;
const MAX_BEHAVIOR_ACTIONS_PER_RULE = 20;
const MAX_BEHAVIOR_CUES_PER_PLAN = 2_000;
const MAX_BEHAVIOR_STRING_LENGTH = 4_096;
const BEHAVIOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*\.[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const CODE_LANGUAGES = new Set(["arduino", "micropython", "espidf", "c", "cpp", "python"]);
const CODE_ORIGINS = new Set(["ai-generated", "human-authored", "imported", "mixed"]);
const DEPENDENCY_ECOSYSTEMS = new Set(["arduino-library", "platformio", "python-package", "vendor-sdk", "other"]);

function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[], path: string) {
  const accepted = new Set(allowed);
  for (const key of Object.keys(value)) if (!accepted.has(key)) throw new Error(`${path}.${key} is not an allowed field.`);
}

function requireBoundedString(value: unknown, path: string, max = MAX_BEHAVIOR_STRING_LENGTH): asserts value is string {
  requireNonEmptyString(value, path);
  if (value.length > max) throw new Error(`${path} must contain at most ${max} characters.`);
}

function requireNonNegativeInteger(value: unknown, path: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${path} must be a non-negative safe integer.`);
}

function assertJsonValue(value: unknown, path: string, depth = 0) {
  if (depth > 16) throw new Error(`${path} is nested too deeply.`);
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (value.length > 65_536) throw new Error(`${path} contains a string longer than 65536 characters.`);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} must contain only finite numbers.`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 20_000) throw new Error(`${path} contains more than 20000 array items.`);
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (!isRecord(value)) throw new Error(`${path} must contain JSON data only.`);
  const entries = Object.entries(value);
  if (entries.length > 20_000) throw new Error(`${path} contains more than 20000 object entries.`);
  for (const [key, item] of entries) {
    if (key.length > 240) throw new Error(`${path} contains an object key longer than 240 characters.`);
    assertJsonValue(item, `${path}.${key}`, depth + 1);
  }
}

function assertJsonBudget(value: unknown) {
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let nodes = 0;
  let stringCharacters = 0;
  while (stack.length) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > 100_000) throw new Error("The project contains more than 100,000 JSON values.");
    if (current.depth > 24) throw new Error("The project JSON is nested more than 24 levels deep.");
    if (typeof current.value === "string") {
      stringCharacters += current.value.length;
      if (stringCharacters > 4_000_000) throw new Error("The project contains too much string data.");
      continue;
    }
    if (current.value === null || typeof current.value === "boolean") continue;
    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value)) throw new Error("The project contains a non-finite number.");
      continue;
    }
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) stack.push({ value: current.value[index], depth: current.depth + 1 });
      continue;
    }
    if (!isRecord(current.value)) throw new Error("The project must contain JSON data only.");
    for (const [key, item] of Object.entries(current.value)) {
      stringCharacters += key.length;
      if (stringCharacters > 4_000_000) throw new Error("The project contains too much string data.");
      stack.push({ value: item, depth: current.depth + 1 });
    }
  }
}

function assertNamespacedId(value: unknown, path: string) {
  requireBoundedString(value, path);
  if (!BEHAVIOR_ID_PATTERN.test(value)) throw new Error(`${path} must use a namespaced id such as indicator.set.`);
}

function assertBehaviorPayload(value: unknown, path: string) {
  if (!isRecord(value) || (value.kind !== "literal" && value.kind !== "trigger-payload")) throw new Error(`${path} must be a literal or trigger-payload object.`);
  if (value.kind === "literal") {
    assertAllowedKeys(value, ["kind", "value"], path);
    if (!("value" in value)) throw new Error(`${path}.value is required.`);
    assertJsonValue(value.value, `${path}.value`);
    return;
  }
  assertAllowedKeys(value, ["kind", "select", "fallback"], path);
  if (value.select !== "$" && value.select !== "$.value") throw new Error(`${path}.select must be $ or $.value.`);
  if (value.fallback !== undefined) assertJsonValue(value.fallback, `${path}.fallback`);
}

function assertBehaviorAction(value: unknown, path: string, componentIds: ReadonlySet<string>) {
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
  assertAllowedKeys(value, ["componentId", "definitionId", "actionId", "payload"], path);
  requireNonEmptyString(value.componentId, `${path}.componentId`);
  if (!componentIds.has(value.componentId)) throw new Error(`${path} references missing component "${value.componentId}".`);
  requireNonEmptyString(value.definitionId, `${path}.definitionId`);
  assertNamespacedId(value.actionId, `${path}.actionId`);
  assertBehaviorPayload(value.payload, `${path}.payload`);
}

function assertBehaviorTrigger(value: unknown, path: string, componentIds: ReadonlySet<string>) {
  if (!isRecord(value) || typeof value.type !== "string") throw new Error(`${path} must declare a trigger type.`);
  switch (value.type) {
    case "preview.started":
      assertAllowedKeys(value, ["type"], path);
      return;
    case "component.event":
      assertAllowedKeys(value, ["type", "componentId", "definitionId", "eventId", "payload"], path);
      requireNonEmptyString(value.componentId, `${path}.componentId`);
      if (!componentIds.has(value.componentId)) throw new Error(`${path} references missing component "${value.componentId}".`);
      requireNonEmptyString(value.definitionId, `${path}.definitionId`);
      assertNamespacedId(value.eventId, `${path}.eventId`);
      if (value.payload !== undefined) assertJsonValue(value.payload, `${path}.payload`);
      return;
    case "input.changed":
      assertAllowedKeys(value, ["type", "componentId", "definitionId", "inputId"], path);
      requireNonEmptyString(value.componentId, `${path}.componentId`);
      if (!componentIds.has(value.componentId)) throw new Error(`${path} references missing component "${value.componentId}".`);
      requireNonEmptyString(value.definitionId, `${path}.definitionId`);
      requireBoundedString(value.inputId, `${path}.inputId`);
      return;
    case "time.elapsed":
      assertAllowedKeys(value, ["type", "afterMs"], path);
      requireNonNegativeInteger(value.afterMs, `${path}.afterMs`);
      if ((value.afterMs as number) > 600_000) throw new Error(`${path}.afterMs cannot exceed 600000.`);
      return;
    default:
      throw new Error(`${path}.type ${value.type} is not supported.`);
  }
}

function assertBehaviorPlan(value: unknown, path: string, componentIds: ReadonlySet<string>, projectId: string | undefined, planIds: Set<string>) {
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
  if (!Number.isSafeInteger(value.schemaVersion) || (value.schemaVersion as number) < 1) throw new Error(`${path}.schemaVersion must be a positive integer.`);
  // Future versions remain inert migration data. They still must be plain JSON
  // so importing an unknown schema cannot smuggle callbacks or class values.
  if (value.schemaVersion !== 1) {
    assertJsonValue(value, path);
    if (typeof value.id === "string" && value.id.trim()) {
      requireBoundedString(value.id, `${path}.id`, MAX_PERSISTED_ID_LENGTH);
      planIds.add(value.id);
    }
    return;
  }
  assertAllowedKeys(value, ["schemaVersion", "id", "projectId", "name", "intent", "revision", "rules", "cues"], path);
  requireBoundedString(value.id, `${path}.id`, MAX_PERSISTED_ID_LENGTH);
  if (planIds.has(value.id)) throw new Error(`${path}.id duplicates "${value.id}".`);
  planIds.add(value.id);
  requireBoundedString(value.projectId, `${path}.projectId`, MAX_PERSISTED_ID_LENGTH);
  if (projectId && value.projectId !== projectId) throw new Error(`${path}.projectId must match project.id.`);
  requireBoundedString(value.name, `${path}.name`);
  if (value.intent !== undefined) requireBoundedString(value.intent, `${path}.intent`);
  requireNonNegativeInteger(value.revision, `${path}.revision`);
  if (!Array.isArray(value.rules)) throw new Error(`${path}.rules must be an array.`);
  if (value.rules.length > MAX_BEHAVIOR_RULES_PER_PLAN) throw new Error(`${path}.rules exceeds ${MAX_BEHAVIOR_RULES_PER_PLAN} items.`);
  const ruleIds = new Set<string>();
  value.rules.forEach((rule, index) => {
    const rulePath = `${path}.rules[${index}]`;
    if (!isRecord(rule)) throw new Error(`${rulePath} must be an object.`);
    assertAllowedKeys(rule, ["id", "enabled", "when", "then"], rulePath);
    requireNonEmptyString(rule.id, `${rulePath}.id`);
    if (ruleIds.has(rule.id)) throw new Error(`${rulePath}.id duplicates "${rule.id}".`);
    ruleIds.add(rule.id);
    if (typeof rule.enabled !== "boolean") throw new Error(`${rulePath}.enabled must be boolean.`);
    assertBehaviorTrigger(rule.when, `${rulePath}.when`, componentIds);
    if (!Array.isArray(rule.then)) throw new Error(`${rulePath}.then must be an array.`);
    if (rule.then.length > MAX_BEHAVIOR_ACTIONS_PER_RULE) throw new Error(`${rulePath}.then exceeds ${MAX_BEHAVIOR_ACTIONS_PER_RULE} items.`);
    rule.then.forEach((action, actionIndex) => assertBehaviorAction(action, `${rulePath}.then[${actionIndex}]`, componentIds));
  });
  if (value.cues === undefined) return;
  if (!Array.isArray(value.cues)) throw new Error(`${path}.cues must be an array.`);
  if (value.cues.length > MAX_BEHAVIOR_CUES_PER_PLAN) throw new Error(`${path}.cues exceeds ${MAX_BEHAVIOR_CUES_PER_PLAN} items.`);
  const cueIds = new Set<string>();
  value.cues.forEach((cue, index) => {
    const cuePath = `${path}.cues[${index}]`;
    if (!isRecord(cue)) throw new Error(`${cuePath} must be an object.`);
    assertAllowedKeys(cue, ["id", "atMs", "order", "action"], cuePath);
    requireNonEmptyString(cue.id, `${cuePath}.id`);
    if (cueIds.has(cue.id)) throw new Error(`${cuePath}.id duplicates "${cue.id}".`);
    cueIds.add(cue.id);
    requireNonNegativeInteger(cue.atMs, `${cuePath}.atMs`);
    if ((cue.atMs as number) > 600_000) throw new Error(`${cuePath}.atMs cannot exceed 600000.`);
    requireNonNegativeInteger(cue.order, `${cuePath}.order`);
    assertBehaviorAction(cue.action, `${cuePath}.action`, componentIds);
  });
}

function assertPreviewLink(value: unknown, path: string, planIds: ReadonlySet<string>) {
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
  if (value.status === "unlinked") {
    assertAllowedKeys(value, ["status"], path);
    return;
  }
  if (value.status !== "linked" && value.status !== "stale") throw new Error(`${path}.status is invalid.`);
  assertAllowedKeys(value, value.status === "stale" ? ["status", "behaviorPlanId", "behaviorPlanSha256", "projectSha256", "linkedContentSha256", "changed"] : ["status", "behaviorPlanId", "behaviorPlanSha256", "projectSha256", "linkedContentSha256"], path);
  requireBoundedString(value.behaviorPlanId, `${path}.behaviorPlanId`, MAX_PERSISTED_ID_LENGTH);
  if (!planIds.has(value.behaviorPlanId)) throw new Error(`${path}.behaviorPlanId references missing Behavior Plan "${value.behaviorPlanId}".`);
  requireBoundedString(value.behaviorPlanSha256, `${path}.behaviorPlanSha256`, 128);
  requireBoundedString(value.projectSha256, `${path}.projectSha256`, 128);
  requireBoundedString(value.linkedContentSha256, `${path}.linkedContentSha256`, 128);
  if (value.status === "stale") {
    if (!Array.isArray(value.changed) || value.changed.length === 0 || value.changed.some((item) => item !== "code" && item !== "plan" && item !== "project")) throw new Error(`${path}.changed must contain code, plan, or project.`);
  }
}

function assertCodeDocuments(value: unknown, path: string, componentDefinitions: ReadonlyMap<string, string>, planIds: ReadonlySet<string>, projectId?: string) {
  if (value === undefined) return { bytes: 0, sourceByComponent: new Map<string, string>() };
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  if (value.length > MAX_CODE_DOCUMENTS_PER_PROJECT) throw new Error(`${path} exceeds ${MAX_CODE_DOCUMENTS_PER_PROJECT} items.`);
  const ids = new Set<string>();
  let projectBytes = 0;
  const sourceByComponent = new Map<string, string>();
  value.forEach((document, index) => {
    const documentPath = `${path}[${index}]`;
    if (!isRecord(document)) throw new Error(`${documentPath} must be an object.`);
    assertAllowedKeys(document, ["schemaVersion", "id", "projectId", "targetComponentId", "targetDefinitionId", "boardFqbn", "language", "files", "dependencies", "revision", "contentSha256", "exportHistory", "origin", "previewLink", "inAppVerification", "updatedAt"], documentPath);
    if (document.schemaVersion !== undefined && document.schemaVersion !== 1) throw new Error(`${documentPath}.schemaVersion must be 1.`);
    uniqueId(document.id, documentPath, ids);
    requireBoundedString(document.projectId, `${documentPath}.projectId`, MAX_PERSISTED_ID_LENGTH);
    if (projectId && document.projectId !== projectId) throw new Error(`${documentPath}.projectId must match project.id.`);
    requireBoundedString(document.targetComponentId, `${documentPath}.targetComponentId`, MAX_PERSISTED_ID_LENGTH);
    if (!componentDefinitions.has(document.targetComponentId)) throw new Error(`${documentPath} references missing component "${document.targetComponentId}".`);
    requireBoundedString(document.targetDefinitionId, `${documentPath}.targetDefinitionId`, MAX_PERSISTED_ID_LENGTH);
    const expectedDefinitionId = componentDefinitions.get(document.targetComponentId as string)!;
    if (document.targetDefinitionId !== expectedDefinitionId) throw new Error(`${documentPath}.targetDefinitionId must match component "${document.targetComponentId}" (${expectedDefinitionId}).`);
    requireOptionalBoundedString(document.boardFqbn, `${documentPath}.boardFqbn`, 200);
    const expectedBoard = boardTargetFor(expectedDefinitionId);
    if (typeof document.boardFqbn === "string" && expectedBoard && document.boardFqbn !== expectedBoard.fqbn) throw new Error(`${documentPath}.boardFqbn must match ${expectedBoard.fqbn}.`);
    if (typeof document.language !== "string" || !CODE_LANGUAGES.has(document.language)) throw new Error(`${documentPath}.language is invalid.`);
    requireNonNegativeInteger(document.revision, `${documentPath}.revision`);
    requireOptionalString(document.contentSha256, `${documentPath}.contentSha256`);
    if (!Array.isArray(document.files)) throw new Error(`${documentPath}.files must be an array.`);
    if (document.files.length > MAX_CODE_FILES_PER_DOCUMENT) throw new Error(`${documentPath}.files exceeds ${MAX_CODE_FILES_PER_DOCUMENT} items.`);
    const fileNames = new Set<string>();
    let documentBytes = 0;
    document.files.forEach((file, fileIndex) => {
      const filePath = `${documentPath}.files[${fileIndex}]`;
      if (!isRecord(file)) throw new Error(`${filePath} must be an object.`);
      requireNonEmptyString(file.name, `${filePath}.name`);
      if (file.name !== file.name.trim()) throw new Error(`${filePath}.name must not contain leading or trailing whitespace.`);
      if (!isSafeRelativeCodePath(file.name)) throw new Error(`${filePath}.name must be a safe relative path.`);
      if (fileNames.has(file.name)) throw new Error(`${filePath}.name duplicates "${file.name}".`);
      fileNames.add(file.name);
      if (typeof file.content !== "string") throw new Error(`${filePath}.content must be a string.`);
      const contentBytes = new TextEncoder().encode(file.content).byteLength;
      if (contentBytes > MAX_CODE_FILE_BYTES) throw new Error(`${filePath}.content exceeds the 1 MiB limit.`);
      documentBytes += contentBytes;
      if (documentBytes > MAX_CODE_DOCUMENT_BYTES) throw new Error(`${documentPath}.files exceed the 512 KiB aggregate source limit.`);
    });
    if (sourceByComponent.has(document.targetComponentId as string)) throw new Error(`${documentPath} duplicates the code target for component "${document.targetComponentId}".`);
    sourceByComponent.set(document.targetComponentId as string, JSON.stringify([...document.files].map((file) => ({ name: (file as Record<string, unknown>).name, content: (file as Record<string, unknown>).content })).sort((left, right) => String(left.name).localeCompare(String(right.name)))));
    if (document.dependencies !== undefined) {
      if (!Array.isArray(document.dependencies) || document.dependencies.length > MAX_CODE_DEPENDENCIES_PER_DOCUMENT) throw new Error(`${documentPath}.dependencies is invalid or exceeds ${MAX_CODE_DEPENDENCIES_PER_DOCUMENT} items.`);
      document.dependencies.forEach((dependency, dependencyIndex) => {
        const dependencyPath = `${documentPath}.dependencies[${dependencyIndex}]`;
        if (!isRecord(dependency)) throw new Error(`${dependencyPath} must be an object.`);
        assertAllowedKeys(dependency, ["ecosystem", "name", "version", "sourceUrl"], dependencyPath);
        if (typeof dependency.ecosystem !== "string" || !DEPENDENCY_ECOSYSTEMS.has(dependency.ecosystem)) throw new Error(`${dependencyPath}.ecosystem is invalid.`);
        requireBoundedString(dependency.name, `${dependencyPath}.name`, 240);
        requireOptionalBoundedString(dependency.version, `${dependencyPath}.version`, 120);
        requireOptionalBoundedString(dependency.sourceUrl, `${dependencyPath}.sourceUrl`, 2_000);
      });
    }
    if (document.exportHistory !== undefined) {
      if (!Array.isArray(document.exportHistory) || document.exportHistory.length > MAX_CODE_EXPORT_HISTORY) throw new Error(`${documentPath}.exportHistory is invalid or too large.`);
      document.exportHistory.forEach((entry, entryIndex) => {
        const entryPath = `${documentPath}.exportHistory[${entryIndex}]`;
        if (!isRecord(entry)) throw new Error(`${entryPath} must be an object.`);
        assertAllowedKeys(entry, ["contentSha256", "exportedAt", "format"], entryPath);
        requireBoundedString(entry.contentSha256, `${entryPath}.contentSha256`, 128);
        requireNonEmptyString(entry.exportedAt, `${entryPath}.exportedAt`);
        if (entry.format !== "source-files" && entry.format !== "handoff-manifest" && entry.format !== "project-bundle") throw new Error(`${entryPath}.format is invalid.`);
      });
    }
    if (document.origin !== undefined && (typeof document.origin !== "string" || !CODE_ORIGINS.has(document.origin))) throw new Error(`${documentPath}.origin is invalid.`);
    if (document.previewLink !== undefined) assertPreviewLink(document.previewLink, `${documentPath}.previewLink`, planIds);
    if (document.inAppVerification !== undefined && document.inAppVerification !== "not-performed") throw new Error(`${documentPath}.inAppVerification must be not-performed.`);
    requireOptionalString(document.updatedAt, `${documentPath}.updatedAt`);
    projectBytes += documentBytes;
    if (projectBytes > MAX_PROJECT_SOURCE_BYTES) throw new Error(`${path} exceeds the 512 KiB project source limit.`);
  });
  return { bytes: projectBytes, sourceByComponent };
}

function uniqueId(value: unknown, path: string, ids: Set<string>): string {
  requireBoundedString(value, `${path}.id`, MAX_PERSISTED_ID_LENGTH);
  if (ids.has(value)) throw new Error(`${path}.id duplicates "${value}".`);
  ids.add(value);
  return value;
}

function assertVlxMetadata(value: Record<string, unknown>) {
  requireNonEmptyString(value.exportedAt, "The export timestamp");
  requireOptionalString(value.name, "The export name");
  if (!isRecord(value.pinStates)) throw new Error("The project pin-state snapshot is missing or invalid.");
  assertJsonValue(value.pinStates, "pinStates");
}

function assertProjectShape(value: unknown): asserts value is HardwareGraph {
  if (!isRecord(value)) throw new Error("The file does not contain a project graph.");
  assertAllowedKeys(value, ["id", "name", "description", "components", "connections", "firmwareTargets", "behaviorPlans", "codeDocuments", "legacyBehaviorData", "simulation", "createdAt", "updatedAt", "version"], "project");
  if (typeof value.name !== "string" || !value.name.trim()) throw new Error("The project is missing a name.");
  if (!Array.isArray(value.components)) throw new Error("The project components list is missing or invalid.");
  if (!Array.isArray(value.connections)) throw new Error("The project connections list is missing or invalid.");
  if (value.firmwareTargets !== undefined && !Array.isArray(value.firmwareTargets)) throw new Error("The project firmware list is invalid.");
  if (value.components.length > MAX_COMPONENTS_PER_PROJECT) throw new Error(`project.components exceeds ${MAX_COMPONENTS_PER_PROJECT} items.`);
  if (value.connections.length > MAX_CONNECTIONS_PER_PROJECT) throw new Error(`project.connections exceeds ${MAX_CONNECTIONS_PER_PROJECT} items.`);
  if ((value.firmwareTargets?.length ?? 0) > MAX_LEGACY_FIRMWARE_TARGETS_PER_PROJECT) throw new Error(`project.firmwareTargets exceeds ${MAX_LEGACY_FIRMWARE_TARGETS_PER_PROJECT} items.`);

  requireOptionalBoundedString(value.id, "project.id");
  requireOptionalString(value.description, "project.description");
  requireOptionalString(value.createdAt, "project.createdAt");
  requireOptionalString(value.updatedAt, "project.updatedAt");
  if (value.version !== undefined && value.version !== 1) throw new Error("project.version must be 1 when present.");

  const componentIds = new Set<string>();
  const componentDefinitions = new Map<string, string>();
  value.components.forEach((component, index) => {
    const path = `project.components[${index}]`;
    if (!isRecord(component)) throw new Error(`${path} must be an object.`);
    assertAllowedKeys(component, ["id", "definitionId", "position", "rotation", "properties", "label"], path);
    uniqueId(component.id, path, componentIds);
    requireBoundedString(component.definitionId, `${path}.definitionId`, MAX_PERSISTED_ID_LENGTH);
    componentDefinitions.set(component.id as string, component.definitionId as string);
    if (!isRecord(component.position)) throw new Error(`${path}.position must be an object.`);
    assertAllowedKeys(component.position, ["x", "y"], `${path}.position`);
    requireFiniteNumber(component.position.x, `${path}.position.x`);
    requireFiniteNumber(component.position.y, `${path}.position.y`);
    if (component.rotation !== undefined && ![0, 90, 180, 270].includes(component.rotation as number)) {
      throw new Error(`${path}.rotation must be 0, 90, 180, or 270.`);
    }
    if (component.properties !== undefined) {
      if (!isRecord(component.properties)) throw new Error(`${path}.properties must be an object.`);
      assertJsonValue(component.properties, `${path}.properties`);
    }
    requireOptionalString(component.label, `${path}.label`);
  });

  const connectionIds = new Set<string>();
  value.connections.forEach((connection, index) => {
    const path = `project.connections[${index}]`;
    if (!isRecord(connection)) throw new Error(`${path} must be an object.`);
    assertAllowedKeys(connection, ["id", "source", "target", "domain"], path);
    uniqueId(connection.id, path, connectionIds);
    requireBoundedString(connection.domain, `${path}.domain`, MAX_PERSISTED_ID_LENGTH);

    for (const side of ["source", "target"] as const) {
      const endpoint = connection[side];
      if (!isRecord(endpoint)) throw new Error(`${path}.${side} must be an object.`);
      assertAllowedKeys(endpoint, ["componentId", "portId"], `${path}.${side}`);
      requireBoundedString(endpoint.componentId, `${path}.${side}.componentId`, MAX_PERSISTED_ID_LENGTH);
      requireBoundedString(endpoint.portId, `${path}.${side}.portId`, MAX_PERSISTED_ID_LENGTH);
      if (!componentIds.has(endpoint.componentId)) {
        throw new Error(`${path}.${side} references missing component "${endpoint.componentId}".`);
      }
    }
  });

  const targetIds = new Set<string>();
  const targetComponents = new Set<string>();
  const legacySourceByComponent = new Map<string, { bytes: number; signature: string }>();
  let serializedTargetBytes = 0;
  (value.firmwareTargets ?? []).forEach((target, index) => {
    const path = `project.firmwareTargets[${index}]`;
    if (!isRecord(target)) throw new Error(`${path} must be an object.`);
    assertAllowedKeys(target, ["id", "componentId", "definitionId", "language", "boardFqbn", "files", "compiledArtifact"], path);
    uniqueId(target.id, path, targetIds);
    requireBoundedString(target.componentId, `${path}.componentId`, MAX_PERSISTED_ID_LENGTH);
    if (!componentIds.has(target.componentId)) throw new Error(`${path} references missing component "${target.componentId}".`);
    if (targetComponents.has(target.componentId)) throw new Error(`${path} duplicates the firmware target for component "${target.componentId}".`);
    targetComponents.add(target.componentId);
    requireOptionalBoundedString(target.definitionId, `${path}.definitionId`);
    const expectedDefinitionId = componentDefinitions.get(target.componentId as string)!;
    if (typeof target.definitionId === "string" && target.definitionId !== expectedDefinitionId) throw new Error(`${path}.definitionId must match component "${target.componentId}" (${expectedDefinitionId}).`);
    requireOptionalString(target.language, `${path}.language`);
    requireOptionalBoundedString(target.boardFqbn, `${path}.boardFqbn`, 200);
    const expectedBoard = boardTargetFor(expectedDefinitionId);
    if (typeof target.boardFqbn === "string" && expectedBoard && target.boardFqbn !== expectedBoard.fqbn) throw new Error(`${path}.boardFqbn must match ${expectedBoard.fqbn}.`);
    if (!Array.isArray(target.files)) throw new Error(`${path}.files must be an array.`);
    if (target.files.length > MAX_CODE_FILES_PER_DOCUMENT) throw new Error(`${path}.files exceeds ${MAX_CODE_FILES_PER_DOCUMENT} items.`);
    let targetBytes = 0;
    const targetFileNames = new Set<string>();
    target.files.forEach((file, fileIndex) => {
      const filePath = `${path}.files[${fileIndex}]`;
      if (!isRecord(file)) throw new Error(`${filePath} must be an object.`);
      assertAllowedKeys(file, ["name", "content"], filePath);
      requireNonEmptyString(file.name, `${filePath}.name`);
      if (file.name !== file.name.trim()) throw new Error(`${filePath}.name must not contain leading or trailing whitespace.`);
      if (!isSafeRelativeCodePath(file.name)) throw new Error(`${filePath}.name must be a safe relative path.`);
      if (targetFileNames.has(file.name)) throw new Error(`${filePath}.name duplicates "${file.name}".`);
      targetFileNames.add(file.name);
      if (typeof file.content !== "string") throw new Error(`${filePath}.content must be a string.`);
      const contentBytes = new TextEncoder().encode(file.content).byteLength;
      if (contentBytes > MAX_CODE_FILE_BYTES) throw new Error(`${filePath}.content exceeds the 1 MiB limit.`);
      targetBytes += contentBytes;
      if (targetBytes > MAX_CODE_DOCUMENT_BYTES) throw new Error(`${path}.files exceed the 512 KiB aggregate source limit.`);
    });
    legacySourceByComponent.set(target.componentId as string, {
      bytes: targetBytes,
      signature: JSON.stringify([...target.files].map((file) => ({ name: (file as Record<string, unknown>).name, content: (file as Record<string, unknown>).content })).sort((left, right) => String(left.name).localeCompare(String(right.name)))),
    });

    if (target.compiledArtifact !== undefined) {
      const artifactPath = `${path}.compiledArtifact`;
      const artifact = target.compiledArtifact;
      if (!isRecord(artifact)) throw new Error(`${artifactPath} must be an object.`);
      assertAllowedKeys(artifact, ["success", "log", "hexB64", "elfB64", "binB64", "identity"], artifactPath);
      if (typeof artifact.success !== "boolean") throw new Error(`${artifactPath}.success must be a boolean.`);
      if (typeof artifact.log !== "string") throw new Error(`${artifactPath}.log must be a string.`);
      requireOptionalString(artifact.hexB64, `${artifactPath}.hexB64`);
      requireOptionalString(artifact.elfB64, `${artifactPath}.elfB64`);
      requireOptionalString(artifact.binB64, `${artifactPath}.binB64`);
      if (artifact.identity !== undefined) {
        if (!isRecord(artifact.identity)) throw new Error(`${artifactPath}.identity must be an object.`);
        assertJsonValue(artifact.identity, `${artifactPath}.identity`);
      }
    }
    serializedTargetBytes += targetBytes;
  });

  const behaviorPlanIds = new Set<string>();
  if (value.behaviorPlans !== undefined) {
    if (!Array.isArray(value.behaviorPlans)) throw new Error("project.behaviorPlans must be an array.");
    if (value.behaviorPlans.length > MAX_BEHAVIOR_PLANS_PER_PROJECT) throw new Error(`project.behaviorPlans exceeds ${MAX_BEHAVIOR_PLANS_PER_PROJECT} items.`);
    value.behaviorPlans.forEach((plan, index) => assertBehaviorPlan(plan, `project.behaviorPlans[${index}]`, componentIds, typeof value.id === "string" ? value.id : undefined, behaviorPlanIds));
  }
  const codeDocuments = assertCodeDocuments(value.codeDocuments, "project.codeDocuments", componentDefinitions, behaviorPlanIds, typeof value.id === "string" ? value.id : undefined);
  let canonicalSourceBytes = codeDocuments.bytes;
  for (const [componentId, legacy] of legacySourceByComponent) {
    const documentSource = codeDocuments.sourceByComponent.get(componentId);
    if (documentSource !== undefined && documentSource !== legacy.signature) throw new Error(`project source containers conflict for component "${componentId}".`);
    if (documentSource === undefined) canonicalSourceBytes += legacy.bytes;
  }
  if (canonicalSourceBytes > MAX_PROJECT_SOURCE_BYTES) throw new Error("project canonical source exceeds the 512 KiB project source limit.");
  if (codeDocuments.bytes + serializedTargetBytes > MAX_SERIALIZED_PROJECT_SOURCE_BYTES) throw new Error("project source containers exceed the 1 MiB serialized source limit.");
  if (value.legacyBehaviorData !== undefined) {
    if (!isRecord(value.legacyBehaviorData)) throw new Error("project.legacyBehaviorData must be an object.");
    assertJsonValue(value.legacyBehaviorData, "project.legacyBehaviorData");
  }

  if (value.simulation !== undefined) {
    if (!isRecord(value.simulation)) throw new Error("project.simulation must be an object.");
    assertAllowedKeys(value.simulation, ["mode", "durationMs", "engines"], "project.simulation");
    const { mode, durationMs, engines } = value.simulation;
    if (mode !== undefined && mode !== "interactive" && mode !== "batch") throw new Error("project.simulation.mode is invalid.");
    if (durationMs !== undefined) {
      requireFiniteNumber(durationMs, "project.simulation.durationMs");
      if (durationMs < 0) throw new Error("project.simulation.durationMs cannot be negative.");
    }
    if (engines !== undefined) {
      if (!isRecord(engines)) throw new Error("project.simulation.engines must be an object.");
      for (const [engineName, configuration] of Object.entries(engines)) {
        const path = `project.simulation.engines.${engineName}`;
        if (!isRecord(configuration)) throw new Error(`${path} must be an object.`);
        assertAllowedKeys(configuration, ["enabled", "fidelity"], path);
        if (typeof configuration.enabled !== "boolean") throw new Error(`${path}.enabled must be a boolean.`);
        if (configuration.fidelity !== "fast" && configuration.fidelity !== "high") throw new Error(`${path}.fidelity is invalid.`);
      }
    }
  }
}

async function readJsonFile(file: File): Promise<Record<string, unknown>> {
  if (file.size > MAX_SCHEMATIC_PROJECT_FILE_BYTES) {
    throw new Error("The selected project is larger than the 10 MB import limit.");
  }
  let source: string;
  try {
    source = await file.text();
  } catch {
    throw new Error("The selected project file could not be read.");
  }
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }
  assertJsonBudget(data);
  if (!isRecord(data)) throw new Error("The selected file does not contain a project object.");
  return data;
}

/** Read the current .vlx format or a legacy bare project JSON export. */
export async function parseSchematicProjectFile(file: File): Promise<HardwareGraph> {
  const data = await readJsonFile(file);
  if (data.format !== undefined) {
    if (data.format !== "schematic-project") throw new Error("The file belongs to a different application or format.");
    if (data.version !== 1) throw new Error(`Unsupported .vlx version ${String(data.version)}.`);
    assertVlxMetadata(data);
    assertProjectShape(data.project);
    return data.project;
  }
  assertProjectShape(data);
  return data;
}
