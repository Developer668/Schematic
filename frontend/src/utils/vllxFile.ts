import { useProjectStore, type HardwareGraph } from "../store/useProjectStore.ts";
import { useSimulationStore } from "../store/useSimulationStore.ts";

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
  const { pinStates } = useSimulationStore.getState();
  return {
    format: "schematic-project",
    version: 1,
    exportedAt: new Date().toISOString(),
    name: name ?? project.name,
    project,
    pinStates: pinStates as Record<string, unknown>,
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

function requireFiniteNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number.`);
}

function uniqueId(value: unknown, path: string, ids: Set<string>): string {
  requireNonEmptyString(value, `${path}.id`);
  if (ids.has(value)) throw new Error(`${path}.id duplicates "${value}".`);
  ids.add(value);
  return value;
}

function assertVlxMetadata(value: Record<string, unknown>) {
  requireNonEmptyString(value.exportedAt, "The export timestamp");
  requireOptionalString(value.name, "The export name");
  if (!isRecord(value.pinStates)) throw new Error("The project pin-state snapshot is missing or invalid.");
}

function assertProjectShape(value: unknown): asserts value is HardwareGraph {
  if (!isRecord(value)) throw new Error("The file does not contain a project graph.");
  if (typeof value.name !== "string" || !value.name.trim()) throw new Error("The project is missing a name.");
  if (!Array.isArray(value.components)) throw new Error("The project components list is missing or invalid.");
  if (!Array.isArray(value.connections)) throw new Error("The project connections list is missing or invalid.");
  if (value.firmwareTargets !== undefined && !Array.isArray(value.firmwareTargets)) throw new Error("The project firmware list is invalid.");

  requireOptionalString(value.id, "project.id");
  requireOptionalString(value.description, "project.description");
  requireOptionalString(value.createdAt, "project.createdAt");
  requireOptionalString(value.updatedAt, "project.updatedAt");
  if (value.version !== undefined && value.version !== 1) throw new Error("project.version must be 1 when present.");

  const componentIds = new Set<string>();
  value.components.forEach((component, index) => {
    const path = `project.components[${index}]`;
    if (!isRecord(component)) throw new Error(`${path} must be an object.`);
    uniqueId(component.id, path, componentIds);
    requireNonEmptyString(component.definitionId, `${path}.definitionId`);
    if (!isRecord(component.position)) throw new Error(`${path}.position must be an object.`);
    requireFiniteNumber(component.position.x, `${path}.position.x`);
    requireFiniteNumber(component.position.y, `${path}.position.y`);
    if (component.rotation !== undefined && ![0, 90, 180, 270].includes(component.rotation as number)) {
      throw new Error(`${path}.rotation must be 0, 90, 180, or 270.`);
    }
    if (component.properties !== undefined && !isRecord(component.properties)) throw new Error(`${path}.properties must be an object.`);
    requireOptionalString(component.label, `${path}.label`);
  });

  const connectionIds = new Set<string>();
  value.connections.forEach((connection, index) => {
    const path = `project.connections[${index}]`;
    if (!isRecord(connection)) throw new Error(`${path} must be an object.`);
    uniqueId(connection.id, path, connectionIds);
    requireNonEmptyString(connection.domain, `${path}.domain`);

    for (const side of ["source", "target"] as const) {
      const endpoint = connection[side];
      if (!isRecord(endpoint)) throw new Error(`${path}.${side} must be an object.`);
      requireNonEmptyString(endpoint.componentId, `${path}.${side}.componentId`);
      requireNonEmptyString(endpoint.portId, `${path}.${side}.portId`);
      if (!componentIds.has(endpoint.componentId)) {
        throw new Error(`${path}.${side} references missing component "${endpoint.componentId}".`);
      }
    }
  });

  const targetIds = new Set<string>();
  const targetComponents = new Set<string>();
  (value.firmwareTargets ?? []).forEach((target, index) => {
    const path = `project.firmwareTargets[${index}]`;
    if (!isRecord(target)) throw new Error(`${path} must be an object.`);
    uniqueId(target.id, path, targetIds);
    requireNonEmptyString(target.componentId, `${path}.componentId`);
    if (!componentIds.has(target.componentId)) throw new Error(`${path} references missing component "${target.componentId}".`);
    if (targetComponents.has(target.componentId)) throw new Error(`${path} duplicates the firmware target for component "${target.componentId}".`);
    targetComponents.add(target.componentId);
    requireOptionalString(target.definitionId, `${path}.definitionId`);
    requireOptionalString(target.language, `${path}.language`);
    requireOptionalString(target.boardFqbn, `${path}.boardFqbn`);
    if (!Array.isArray(target.files)) throw new Error(`${path}.files must be an array.`);
    target.files.forEach((file, fileIndex) => {
      const filePath = `${path}.files[${fileIndex}]`;
      if (!isRecord(file)) throw new Error(`${filePath} must be an object.`);
      requireNonEmptyString(file.name, `${filePath}.name`);
      if (typeof file.content !== "string") throw new Error(`${filePath}.content must be a string.`);
    });

    if (target.compiledArtifact !== undefined) {
      const artifactPath = `${path}.compiledArtifact`;
      const artifact = target.compiledArtifact;
      if (!isRecord(artifact)) throw new Error(`${artifactPath} must be an object.`);
      if (typeof artifact.success !== "boolean") throw new Error(`${artifactPath}.success must be a boolean.`);
      if (typeof artifact.log !== "string") throw new Error(`${artifactPath}.log must be a string.`);
      requireOptionalString(artifact.hexB64, `${artifactPath}.hexB64`);
      requireOptionalString(artifact.elfB64, `${artifactPath}.elfB64`);
      requireOptionalString(artifact.binB64, `${artifactPath}.binB64`);
      if (artifact.identity !== undefined && !isRecord(artifact.identity)) throw new Error(`${artifactPath}.identity must be an object.`);
    }
  });

  if (value.simulation !== undefined) {
    if (!isRecord(value.simulation)) throw new Error("project.simulation must be an object.");
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
