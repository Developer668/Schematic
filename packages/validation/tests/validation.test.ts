import { describe, expect, it } from "vitest";
import { createEmptyProject, type HardwareDefinitionLookup, type HardwarePort, type HardwareProject } from "@schematic/hardware-graph";
import { validateProject } from "../src";

const definitions: Record<string, { ports: HardwarePort[] }> = {
  board: {
    ports: [
      { id: "VCC", name: "VCC", domain: "power", direction: "power" },
      { id: "GND", name: "GND", domain: "ground", direction: "power" },
      { id: "SDA", name: "SDA", domain: "i2c", direction: "bidirectional", protocol: { role: "controller" } },
      { id: "SCL", name: "SCL", domain: "i2c", direction: "bidirectional", protocol: { role: "controller" } },
    ],
  },
  target: {
    ports: [
      { id: "VCC", name: "VCC", domain: "power", direction: "power" },
      { id: "GND", name: "GND", domain: "ground", direction: "power" },
      { id: "SDA", name: "SDA", domain: "i2c", direction: "bidirectional", protocol: { role: "target", address: 0x40 }, electrical: { requiresPullup: true } },
      { id: "SCL", name: "SCL", domain: "i2c", direction: "bidirectional", protocol: { role: "target" } },
    ],
  },
};

const lookup: HardwareDefinitionLookup = (definitionId) => definitions[definitionId];

function project(componentDefinitions: Record<string, string>, connections: HardwareProject["connections"]): HardwareProject {
  const value = createEmptyProject("validation test");
  value.components = Object.entries(componentDefinitions).map(([id, definitionId]) => ({
    id,
    definitionId,
    position: { x: 0, y: 0 },
    rotation: 0,
    properties: {},
  }));
  value.connections = connections;
  return value;
}

function wire(id: string, source: [string, string], target: [string, string], domain: string) {
  return { id, source: { componentId: source[0], portId: source[1] }, target: { componentId: target[0], portId: target[1] }, domain } as HardwareProject["connections"][number];
}

describe("validation graph integration", () => {
  it("validates shared ground and multidrop I2C using derived nets", () => {
    const result = validateProject(project({ mcu: "board", a: "target", b: "target" }, [
      wire("g-a", ["mcu", "GND"], ["a", "GND"], "ground"),
      wire("g-b", ["a", "GND"], ["b", "GND"], "ground"),
      wire("sda-a", ["mcu", "SDA"], ["a", "SDA"], "i2c"),
      wire("sda-b", ["a", "SDA"], ["b", "SDA"], "i2c"),
      wire("scl-a", ["mcu", "SCL"], ["a", "SCL"], "i2c"),
      wire("scl-b", ["a", "SCL"], ["b", "SCL"], "i2c"),
    ]), lookup);

    expect(result.issues.some((issue) => issue.code === "MISSING_GROUND")).toBe(false);
    expect(result.issues.some((issue) => issue.code === "MIXED_DOMAIN_NET")).toBe(false);
    expect(result.issues.some((issue) => issue.code === "BUS_SIGNAL_MISMATCH")).toBe(false);
    expect(result.issues.some((issue) => issue.code === "I2C_ADDRESS_COLLISION")).toBe(true);
  });

  it("does not report an I2C address collision across separate buses", () => {
    const result = validateProject(project({ mcu1: "board", mcu2: "board", a: "target", b: "target" }, [
      wire("one-sda", ["mcu1", "SDA"], ["a", "SDA"], "i2c"),
      wire("one-scl", ["mcu1", "SCL"], ["a", "SCL"], "i2c"),
      wire("two-sda", ["mcu2", "SDA"], ["b", "SDA"], "i2c"),
      wire("two-scl", ["mcu2", "SCL"], ["b", "SCL"], "i2c"),
    ]), lookup);

    expect(result.issues.some((issue) => issue.code === "I2C_ADDRESS_COLLISION")).toBe(false);
  });

  it("returns clear errors for missing endpoints and mixed rails", () => {
    const result = validateProject(project({ mcu: "board", a: "target" }, [
      wire("removed", ["mcu", "GND"], ["removed-component", "GND"], "ground"),
      wire("wrong-rail", ["mcu", "VCC"], ["a", "GND"], "power"),
      wire("missing-port", ["mcu", "SDA"], ["a", "NOPE"], "i2c"),
    ]), lookup);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "MISSING_PORT",
      "DOMAIN_MISMATCH",
      "MIXED_RAIL_NET",
    ]));
    expect(result.issues.find((issue) => issue.code === "MISSING_PORT")?.message).toContain("NOPE");
  });
});
