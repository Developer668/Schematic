import { describe, it, expect } from "vitest";
import { createEmptyProject, addComponent, removeComponent, connectPorts, validateProjectShape } from "@schematic/hardware-graph";

describe("hardware-graph", () => {
  it("creates empty project", () => {
    const p = createEmptyProject("Test");
    expect(p.name).toBe("Test");
    expect(p.version).toBe(1);
    expect(p.components).toEqual([]);
  });

  it("adds and removes component", () => {
    let p = createEmptyProject();
    p = addComponent(p, { id: "esp-1", definitionId: "esp32-s3", position: { x: 0, y: 0 }, rotation: 0, properties: {} });
    expect(p.components).toHaveLength(1);
    p = removeComponent(p, "esp-1");
    expect(p.components).toHaveLength(0);
  });

  it("connects ports", () => {
    let p = createEmptyProject();
    p = addComponent(p, { id: "a", definitionId: "esp32-s3", position: { x: 0, y: 0 }, rotation: 0, properties: {} });
    p = addComponent(p, { id: "b", definitionId: "bmp280", position: { x: 100, y: 0 }, rotation: 0, properties: {} });
    p = connectPorts(p, { id: "c1", source: { componentId: "a", portId: "SDA" }, target: { componentId: "b", portId: "SDA" }, domain: "i2c" });
    expect(p.connections).toHaveLength(1);
  });

  it("validates shape", () => {
    const p = createEmptyProject("X");
    expect(validateProjectShape(p).success).toBe(true);
    expect(validateProjectShape({ bad: true } as any).success).toBe(false);
  });
});
