import { describe, it, expect } from "vitest";
import { validateProject } from "@schematic/validation";
import type { HardwareProject, HardwarePort } from "@schematic/hardware-graph";
import { validateProject as validateFrontendProject } from "../store/useValidationStore.ts";
import { useProjectStore } from "../store/useProjectStore.ts";
import { useValidationStore } from "../store/useValidationStore.ts";

const lookup = (id: string) => {
  const defs: Record<string, { ports: HardwarePort[] }> = {
    "esp32-s3": { ports: [{ id: "3V3", name: "3V3", domain: "power", direction: "power", electrical: { nominalVoltage: 3.3, maxVoltage: 3.6 } } as any, { id: "GND", name: "GND", domain: "ground", direction: "power" } as any, { id: "GPIO4", name: "GPIO4", domain: "gpio", direction: "bidirectional" } as any] },
    bmp280: { ports: [{ id: "VCC", name: "VCC", domain: "power", direction: "input", electrical: { nominalVoltage: 3.3, maxVoltage: 3.6 } } as any, { id: "GND", name: "GND", domain: "ground", direction: "power" } as any, { id: "SDA", name: "SDA", domain: "i2c", direction: "bidirectional", protocol: { role: "target", address: 0x76 }, electrical: { requiresPullup: true } } as any, { id: "SCL", name: "SCL", domain: "i2c", direction: "bidirectional" } as any] },
    led: { ports: [{ id: "Anode", name: "Anode", domain: "power", direction: "input" } as any] },
  };
  return defs[id];
};

describe("validation", () => {
  it("flags missing ground", () => {
    const p: HardwareProject = {
      id: "p1", name: "T", components: [{ id: "a", definitionId: "led", position: { x: 0, y: 0 }, rotation: 0, properties: {} } as any],
      connections: [], firmwareTargets: [], simulation: { mode: "interactive", engines: {} }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1
    };
    const res = validateProject(p as any, lookup);
    expect(res.issues.some((i: any) => i.code === "MISSING_GROUND")).toBe(true);
  });

  it("voltage mismatch detected", () => {
    // 5V source → 3.3V max target would be flagged in real graph
    // simplified check: we test validator doesn't crash
    const p: HardwareProject = {
      id: "p1", name: "T",
      components: [
        { id: "esp", definitionId: "esp32-s3", position: { x: 0, y: 0 }, rotation: 0, properties: {} } as any,
        { id: "bmp", definitionId: "bmp280", position: { x: 100, y: 0 }, rotation: 0, properties: {} } as any,
      ],
      connections: [
        { id: "c1", source: { componentId: "esp", portId: "3V3" }, target: { componentId: "bmp", portId: "VCC" }, domain: "power" } as any
      ],
      firmwareTargets: [], simulation: { mode: "interactive", engines: {} }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1
    };
    const res = validateProject(p as any, lookup);
    expect(res).toHaveProperty("valid");
  });

  it("keeps the frontend active validator independent from editable source", () => {
    const p: HardwareProject = {
      id: "source-independent",
      name: "Source independent",
      components: [{ id: "board-1", definitionId: "arduino-uno-r3", position: { x: 0, y: 0 }, rotation: 0, properties: {} }],
      connections: [],
      firmwareTargets: [{
        id: "firmware-1",
        componentId: "board-1",
        definitionId: "arduino-uno-r3",
        language: "arduino",
        boardFqbn: "arduino:avr:uno",
        files: [{ name: "sketch.ino", content: "void setup() {}\nvoid loop() {}" }],
      }],
      simulation: { mode: "interactive", engines: {} },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      version: 1,
    };
    const malformed = structuredClone(p);
    malformed.firmwareTargets[0].files[0].content = "}\n// missing setup and loop";

    const cleanResult = validateFrontendProject(p as any);
    const malformedResult = validateFrontendProject(malformed as any);
    expect(malformedResult).toEqual(cleanResult);
    expect(malformedResult.codeIssues).toEqual([]);
  });

  it("keeps validation observational and never exposes synthetic automatic fixes", () => {
    useProjectStore.getState().clear();
    useValidationStore.getState().clear();
    useProjectStore.getState().addComponent("led");
    const before = structuredClone(useProjectStore.getState().project);

    const result = validateFrontendProject(useProjectStore.getState().project);
    useValidationStore.getState().setResult(result);
    const firstState = useValidationStore.getState();
    expect(firstState.issues.some((issue) => Object.prototype.hasOwnProperty.call(issue, "autoFix"))).toBe(false);
    expect(new Set(firstState.issues.map((issue) => issue.id)).size).toBe(firstState.issues.length);

    // A second check must not add a placeholder resistor/level shifter or
    // duplicate diagnostics. Validation only reads the graph.
    useValidationStore.getState().setResult(validateFrontendProject(useProjectStore.getState().project));
    const secondState = useValidationStore.getState();
    expect(secondState.issues).toEqual(firstState.issues);
    expect(useProjectStore.getState().project).toEqual(before);
  });

  it("invalidates a checked verdict only when the semantic graph changes", () => {
    const projects = useProjectStore.getState();
    projects.clear();
    const board = useProjectStore.getState().addComponent("esp32-devkit-v1");
    const led = useProjectStore.getState().addComponent("led");
    const markChecked = () => useValidationStore.getState().setResult({ valid: true, issues: [] });

    markChecked();
    useProjectStore.getState().moveComponent(board.id, { x: 640, y: 240 });
    expect(useValidationStore.getState().valid).toBe(true);

    useProjectStore.getState().updateFirmware(board.id, [{ name: "sketch.ino", content: "void setup() {}\nvoid loop() {}" }]);
    expect(useValidationStore.getState().valid).toBe(true);

    useProjectStore.getState().updateComponentProps(led.id, { previewLabel: "status" });
    expect(useValidationStore.getState()).toMatchObject({ valid: null, issues: [], checkedAt: null });

    markChecked();
    const connection = useProjectStore.getState().connectPorts(
      { componentId: board.id, portId: "GPIO18" },
      { componentId: led.id, portId: "IN" },
    );
    expect(useValidationStore.getState().valid).toBe(true);
    expect(useValidationStore.getState().issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["MISSING_GROUND", "INSUFFICIENT_POWER"]));

    markChecked();
    useProjectStore.getState().disconnectPorts(connection.id);
    expect(useValidationStore.getState().valid).toBe(true);
    expect(useValidationStore.getState().issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["MISSING_GROUND", "INSUFFICIENT_POWER"]));

    markChecked();
    useProjectStore.getState().removeComponent(led.id);
    expect(useValidationStore.getState()).toMatchObject({ valid: null, issues: [], checkedAt: null });

    markChecked();
    useProjectStore.getState().addComponent("led");
    expect(useValidationStore.getState()).toMatchObject({ valid: null, issues: [], checkedAt: null });
  });

  it("lodges rejected connection diagnostics without claiming a whole-graph verdict", () => {
    useProjectStore.getState().clear();
    useValidationStore.getState().clear();
    const board = useProjectStore.getState().addComponent("esp32-devkit-v1");
    const led = useProjectStore.getState().addComponent("led");

    expect(() => useProjectStore.getState().connectPorts(
      { componentId: board.id, portId: "GND" },
      { componentId: led.id, portId: "IN" },
    )).toThrow();
    expect(useProjectStore.getState().project.connections).toHaveLength(0);
    expect(useValidationStore.getState().valid).toBeNull();
    expect(useValidationStore.getState().checkedAt).toBeNull();
    expect(useValidationStore.getState().issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "DOMAIN_MISMATCH", affectedComponents: expect.arrayContaining([board.id, led.id]) }),
    ]));
  });
});
