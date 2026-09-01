import { afterEach, describe, expect, it } from "vitest";
import { useProjectStore, type HardwareGraph } from "../store/useProjectStore.ts";
import {
  buildVlxBlob,
  MAX_SCHEMATIC_PROJECT_FILE_BYTES,
  parseSchematicProjectFile,
  parseVlxFile,
} from "../utils/vllxFile.ts";

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

    await expect(parseSchematicProjectFile(projectFile(badPosition))).rejects.toThrow("position.x must be a finite number");
    await expect(parseSchematicProjectFile(projectFile(badEndpoint))).rejects.toThrow("source must be an object");
    await expect(parseSchematicProjectFile(projectFile(badFirmware))).rejects.toThrow("content must be a string");
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
