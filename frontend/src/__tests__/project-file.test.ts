import { afterEach, describe, expect, it } from "vitest";
import { useProjectStore, type HardwareGraph } from "../store/useProjectStore.ts";
import {
  buildVlxBlob,
  MAX_SCHEMATIC_PROJECT_FILE_BYTES,
  parseSchematicProjectFile,
  parseVlxFile,
} from "../utils/vllxFile.ts";
import { MAX_COMPONENTS_PER_PROJECT, MAX_PERSISTED_ID_LENGTH } from "../store/behaviorPersistence.ts";

function project(name = "Imported sensor board"): HardwareGraph {
  return {
    id: "external-project",
    name,
    components: [],
    connections: [],
    firmwareTargets: [],
    version: 1,
  };
}

function populatedProject(): HardwareGraph {
  return {
    id: "portable-project",
    name: "Portable controller",
    description: "A project with connections and firmware",
    components: [
      { id: "board-1", definitionId: "arduino-uno", position: { x: 80, y: 80 }, rotation: 0, properties: {} },
      { id: "led-1", definitionId: "led", position: { x: 440, y: 80 }, rotation: 90, properties: { color: "red" }, label: "Status" },
    ],
    connections: [
      { id: "connection-1", source: { componentId: "board-1", portId: "D13" }, target: { componentId: "led-1", portId: "A" }, domain: "gpio" },
    ],
    firmwareTargets: [
      {
        id: "firmware-1",
        componentId: "board-1",
        definitionId: "arduino-uno",
        language: "arduino",
        boardFqbn: "arduino:avr:uno",
        files: [{ name: "sketch.ino", content: "void setup() {}\nvoid loop() {}" }],
        compiledArtifact: { success: true, log: "ok", hexB64: "AA==", identity: { compiler: "avr-gcc" } },
      },
    ],
    simulation: { mode: "interactive", engines: { behavioral: { enabled: true, fidelity: "fast" } } },
    version: 1,
  };
}

function projectFile(graph: unknown, envelope = false) {
  const data = envelope
    ? { format: "schematic-project", version: 1, exportedAt: new Date(0).toISOString(), project: graph, pinStates: {} }
    : graph;
  return new File([JSON.stringify(data)], envelope ? "project.vlx" : "project.json", { type: "application/json" });
}

function cloneGraph(): HardwareGraph {
  return JSON.parse(JSON.stringify(populatedProject())) as HardwareGraph;
}

afterEach(() => {
  const state = useProjectStore.getState();
  const imported = state.projects.find((item) => item.id !== state.projects[0]?.id);
  if (imported && state.projects.length > 1) state.deleteProject(imported.id);
  state.switchProject(state.projects[0]?.id);
});

describe("Schematic project files", () => {
  it("parses a versioned .vlx export", async () => {
    const graph = project();
    const file = new File([
      JSON.stringify({ format: "schematic-project", version: 1, exportedAt: new Date(0).toISOString(), project: graph, pinStates: {} }),
    ], "sensor-board.vlx", { type: "application/json" });

    await expect(parseSchematicProjectFile(file)).resolves.toEqual(graph);
  });

  it("round-trips the active project through the shipped .vlx exporter", async () => {
    const expected = useProjectStore.getState().project;
    const file = new File([buildVlxBlob("Round-trip project")], "round-trip.vlx", { type: "application/json" });

    const payload = await parseVlxFile(file);
    await expect(parseSchematicProjectFile(file)).resolves.toEqual(expected);
    expect(payload.project).toEqual(expected);
    expect(payload.name).toBe("Round-trip project");
  });

  it("accepts a structurally valid legacy bare project", async () => {
    const graph = populatedProject();
    const { firmwareTargets: _firmwareTargets, simulation: _simulation, ...legacy } = graph;
    await expect(parseSchematicProjectFile(projectFile(legacy))).resolves.toEqual(legacy);
  });

  it("rejects files above the project-storage 10 MB import limit before parsing", async () => {
    const file = new File(["x".repeat(MAX_SCHEMATIC_PROJECT_FILE_BYTES + 1)], "oversized.vlx", { type: "application/json" });
    await expect(parseSchematicProjectFile(file)).rejects.toThrow("larger than the 10 MB import limit");
  });

  it("rejects oversized graph collections before normalization work", async () => {
    const graph = project() as HardwareGraph;
    graph.components = Array.from({ length: MAX_COMPONENTS_PER_PROJECT + 1 }, (_, index) => ({
      id: `component-${index}`,
      definitionId: "led",
      position: { x: index * 10, y: 0 },
      rotation: 0,
      properties: {},
    }));
    await expect(parseSchematicProjectFile(projectFile(graph))).rejects.toThrow(`project.components exceeds ${MAX_COMPONENTS_PER_PROJECT} items`);
  });

  it("rejects identity fields that persistence would otherwise have to truncate", async () => {
    const graph = cloneGraph();
    graph.components[0].id = "x".repeat(MAX_PERSISTED_ID_LENGTH + 1);
    await expect(parseSchematicProjectFile(projectFile(graph))).rejects.toThrow(`at most ${MAX_PERSISTED_ID_LENGTH} characters`);
  });

  it("rejects duplicate component, connection, and firmware target IDs", async () => {
    const duplicateComponent = cloneGraph();
    duplicateComponent.components.push({ ...duplicateComponent.components[1], position: { x: 800, y: 80 } });

    const duplicateConnection = cloneGraph();
    duplicateConnection.connections.push({ ...duplicateConnection.connections[0] });

    const duplicateFirmware = cloneGraph();
    duplicateFirmware.firmwareTargets.push({ ...duplicateFirmware.firmwareTargets[0], componentId: "led-1", files: [] });

    await expect(parseSchematicProjectFile(projectFile(duplicateComponent))).rejects.toThrow('duplicates "led-1"');
    await expect(parseSchematicProjectFile(projectFile(duplicateConnection))).rejects.toThrow('duplicates "connection-1"');
    await expect(parseSchematicProjectFile(projectFile(duplicateFirmware))).rejects.toThrow('duplicates "firmware-1"');
  });

  it("rejects connections and firmware targets that reference missing components", async () => {
    const danglingConnection = cloneGraph();
    danglingConnection.connections[0].target.componentId = "missing-led";

    const danglingFirmware = cloneGraph();
    danglingFirmware.firmwareTargets[0].componentId = "missing-board";

    await expect(parseSchematicProjectFile(projectFile(danglingConnection))).rejects.toThrow('references missing component "missing-led"');
    await expect(parseSchematicProjectFile(projectFile(danglingFirmware))).rejects.toThrow('references missing component "missing-board"');
  });

  it("rejects malformed nested primitives and unknown collection shapes", async () => {
    const badPosition = cloneGraph() as unknown as Record<string, any>;
    badPosition.components[0].position.x = "80";

    const badEndpoint = cloneGraph() as unknown as Record<string, any>;
    badEndpoint.connections[0].source = [];

    const badFirmware = cloneGraph() as unknown as Record<string, any>;
    badFirmware.firmwareTargets[0].files[0].content = 42;

    const unsafeFirmwarePath = cloneGraph() as unknown as Record<string, any>;
    unsafeFirmwarePath.firmwareTargets[0].files[0].name = "../sketch.ino";

    await expect(parseSchematicProjectFile(projectFile(badPosition))).rejects.toThrow("position.x must be a finite number");
    await expect(parseSchematicProjectFile(projectFile(badEndpoint))).rejects.toThrow("source must be an object");
    await expect(parseSchematicProjectFile(projectFile(badFirmware))).rejects.toThrow("content must be a string");
    await expect(parseSchematicProjectFile(projectFile(unsafeFirmwarePath))).rejects.toThrow("name must be a safe relative path");
  });

  it("rejects JSON values that bounded persistence would otherwise drop", async () => {
    const longValue = cloneGraph();
    longValue.components[0].properties = { note: "x".repeat(65_537) };

    const longKey = cloneGraph();
    longKey.components[0].properties = { ["k".repeat(241)]: true };

    const oversizedArray = cloneGraph();
    oversizedArray.legacyBehaviorData = { values: Array.from({ length: 20_001 }, () => null) };

    await expect(parseSchematicProjectFile(projectFile(longValue))).rejects.toThrow("string longer than 65536");
    await expect(parseSchematicProjectFile(projectFile(longKey))).rejects.toThrow("object key longer than 240");
    await expect(parseSchematicProjectFile(projectFile(oversizedArray))).rejects.toThrow("more than 20000 array items");
  });

  it("preserves valid __proto__ JSON keys through import, normalization, and export", async () => {
    const graph = cloneGraph();
    const magicJson = JSON.parse('{"__proto__":{"value":1}}') as Record<string, unknown>;
    graph.components[0].properties = magicJson;
    graph.legacyBehaviorData = { retained: magicJson };
    graph.behaviorPlans = [{
      schemaVersion: 1,
      id: "proto-plan",
      projectId: graph.id,
      name: "Prototype-key fidelity",
      revision: 1,
      rules: [{
        id: "startup",
        enabled: true,
        when: { type: "preview.started" },
        then: [{
          componentId: "led-1",
          definitionId: "led",
          actionId: "indicator.set",
          payload: { kind: "literal", value: magicJson },
        }],
      }],
    }];

    const parsed = await parseSchematicProjectFile(projectFile(graph));
    useProjectStore.getState().loadProject(parsed);
    const normalized = useProjectStore.getState().project;
    const normalizedProperties = normalized.components[0].properties;
    const literalValue = (normalized.behaviorPlans?.[0].rules[0] as any).then[0].payload.value;
    expect(Object.prototype.hasOwnProperty.call(normalizedProperties, "__proto__")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(literalValue, "__proto__")).toBe(true);
    expect((normalizedProperties as any).__proto__.value).toBe(1);
    expect(Object.getPrototypeOf(normalizedProperties)).toBe(Object.prototype);

    const exported = await parseVlxFile(new File([buildVlxBlob("Prototype fidelity")], "prototype.vlx", { type: "application/json" }));
    expect(Object.prototype.hasOwnProperty.call(exported.project.components[0].properties, "__proto__")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call((exported.project.behaviorPlans?.[0].rules[0] as any).then[0].payload.value, "__proto__")).toBe(true);
  });

  it("rejects duplicate or trim-changing legacy source names instead of dropping source during normalization", async () => {
    const duplicate = cloneGraph();
    duplicate.firmwareTargets[0].files.push({ name: "sketch.ino", content: "different" });
    const trimEquivalent = cloneGraph();
    trimEquivalent.firmwareTargets[0].files.push({ name: " sketch.ino", content: "different" });

    await expect(parseSchematicProjectFile(projectFile(duplicate))).rejects.toThrow('duplicates "sketch.ino"');
    await expect(parseSchematicProjectFile(projectFile(trimEquivalent))).rejects.toThrow("leading or trailing whitespace");
  });

  it("rejects source provenance that disagrees with its component definition or board binding", async () => {
    const foreignLegacyDefinition = cloneGraph();
    foreignLegacyDefinition.firmwareTargets[0].definitionId = "esp32-devkit-c";
    const foreignLegacyBoard = cloneGraph();
    foreignLegacyBoard.firmwareTargets[0].boardFqbn = "esp32:esp32:esp32";
    const foreignDocument = cloneGraph();
    foreignDocument.codeDocuments = [{
      schemaVersion: 1,
      id: "code-board-1",
      projectId: foreignDocument.id,
      targetComponentId: "board-1",
      targetDefinitionId: "esp32-devkit-c",
      language: "arduino",
      files: [{ name: "sketch.ino", content: "void setup() {}" }],
      dependencies: [],
      revision: 1,
      contentSha256: "ignored-on-import",
      exportHistory: [],
      origin: "imported",
      previewLink: { status: "unlinked" },
      inAppVerification: "not-performed",
      updatedAt: new Date(0).toISOString(),
    }];

    await expect(parseSchematicProjectFile(projectFile(foreignLegacyDefinition))).rejects.toThrow("definitionId must match component");
    await expect(parseSchematicProjectFile(projectFile(foreignLegacyBoard))).rejects.toThrow("boardFqbn must match arduino:avr:uno");
    await expect(parseSchematicProjectFile(projectFile(foreignDocument))).rejects.toThrow("targetDefinitionId must match component");
  });

  it("rejects code metadata that persistence would otherwise truncate", async () => {
    const graph = cloneGraph();
    graph.codeDocuments = [{
      schemaVersion: 1,
      id: "code-board-1",
      projectId: graph.id,
      targetComponentId: "board-1",
      targetDefinitionId: "arduino-uno",
      boardFqbn: "arduino:avr:uno",
      language: "arduino",
      files: [{ name: "sketch.ino", content: "void setup() {}" }],
      dependencies: [{ ecosystem: "arduino-library", name: "x".repeat(241) }],
      revision: 1,
      contentSha256: "source",
      exportHistory: [],
      origin: "imported",
      previewLink: { status: "unlinked" },
      inAppVerification: "not-performed",
      updatedAt: new Date(0).toISOString(),
    }];

    await expect(parseSchematicProjectFile(projectFile(graph))).rejects.toThrow("at most 240 characters");
  });

  it("rejects a canonical source union that normalization could not preserve", async () => {
    const graph = cloneGraph();
    const boardOneSource = "a".repeat(400 * 1024);
    const boardTwoSource = "b".repeat(200 * 1024);
    graph.components.push({ id: "board-2", definitionId: "arduino-uno", position: { x: 800, y: 500 }, rotation: 0, properties: {} });
    graph.firmwareTargets[0].files = [{ name: "sketch.ino", content: boardOneSource }];
    graph.firmwareTargets.push({
      id: "firmware-2",
      componentId: "board-2",
      definitionId: "arduino-uno",
      language: "arduino",
      boardFqbn: "arduino:avr:uno",
      files: [{ name: "sketch.ino", content: boardTwoSource }],
    });
    graph.codeDocuments = [{
      schemaVersion: 1,
      id: "code-board-1",
      projectId: graph.id,
      targetComponentId: "board-1",
      targetDefinitionId: "arduino-uno",
      boardFqbn: "arduino:avr:uno",
      language: "arduino",
      files: [{ name: "sketch.ino", content: boardOneSource }],
      dependencies: [],
      revision: 1,
      contentSha256: "source",
      exportHistory: [],
      origin: "imported",
      previewLink: { status: "unlinked" },
      inAppVerification: "not-performed",
      updatedAt: new Date(0).toISOString(),
    }];

    await expect(parseSchematicProjectFile(projectFile(graph))).rejects.toThrow("canonical source exceeds the 512 KiB project source limit");
  });

  it("rejects conflicting canonical and legacy source containers for one component", async () => {
    const graph = cloneGraph();
    graph.codeDocuments = [{
      schemaVersion: 1,
      id: "code-board-1",
      projectId: graph.id,
      targetComponentId: "board-1",
      targetDefinitionId: "arduino-uno",
      boardFqbn: "arduino:avr:uno",
      language: "arduino",
      files: [{ name: "sketch.ino", content: "// canonical source" }],
      dependencies: [],
      revision: 1,
      contentSha256: "source",
      exportHistory: [],
      origin: "imported",
      previewLink: { status: "unlinked" },
      inAppVerification: "not-performed",
      updatedAt: new Date(0).toISOString(),
    }];

    await expect(parseSchematicProjectFile(projectFile(graph))).rejects.toThrow('source containers conflict for component "board-1"');
  });

  it("rejects incomplete versioned envelopes instead of trusting a project-shaped payload", async () => {
    const file = new File([JSON.stringify({ format: "schematic-project", version: 1, project: populatedProject() })], "incomplete.vlx", { type: "application/json" });
    await expect(parseSchematicProjectFile(file)).rejects.toThrow("export timestamp");
  });

  it("rejects arbitrary JSON instead of normalizing it into an empty project", async () => {
    const file = new File([JSON.stringify({})], "not-a-project.json", { type: "application/json" });
    await expect(parseSchematicProjectFile(file)).rejects.toThrow("missing a name");
  });

  it("imports as a new project and preserves the current project", () => {
    const before = useProjectStore.getState();
    const existingId = before.activeProjectId;
    const count = before.projects.length;

    const importedId = before.importProject(project());
    const after = useProjectStore.getState();

    expect(importedId).not.toBe(existingId);
    expect(after.activeProjectId).toBe(importedId);
    expect(after.projects).toHaveLength(count + 1);
    expect(after.projects.some((item) => item.id === existingId)).toBe(true);
  });
});
