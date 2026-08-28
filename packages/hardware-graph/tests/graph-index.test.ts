import { describe, expect, it } from "vitest";
import { createHardwareGraphIndex, type HardwareDefinitionLookup, type HardwareGraphProjectInput } from "../src/graph-index";

const definitions: Record<string, { ports: { id: string; name: string; domain: "power" | "ground" | "i2c" | "gpio"; direction: "power" | "bidirectional"; protocol?: { role: "controller" | "target"; address?: number } }[] }> = {
  board: {
    ports: [
      { id: "VCC", name: "VCC", domain: "power", direction: "power" },
      { id: "GND", name: "GND", domain: "ground", direction: "power" },
      { id: "SDA", name: "SDA", domain: "i2c", direction: "bidirectional", protocol: { role: "controller" } },
      { id: "SCL", name: "SCL", domain: "i2c", direction: "bidirectional", protocol: { role: "controller" } },
      { id: "D2", name: "D2", domain: "gpio", direction: "bidirectional" },
    ],
  },
  sensorA: {
    ports: [
      { id: "VCC", name: "VCC", domain: "power", direction: "power" },
      { id: "GND", name: "GND", domain: "ground", direction: "power" },
      { id: "SDA", name: "SDA", domain: "i2c", direction: "bidirectional", protocol: { role: "target", address: 0x40 } },
      { id: "SCL", name: "SCL", domain: "i2c", direction: "bidirectional", protocol: { role: "target" } },
    ],
  },
  sensorB: {
    ports: [
      { id: "VCC", name: "VCC", domain: "power", direction: "power" },
      { id: "GND", name: "GND", domain: "ground", direction: "power" },
      { id: "SDA", name: "SDA", domain: "i2c", direction: "bidirectional", protocol: { role: "target", address: 0x41 } },
      { id: "SCL", name: "SCL", domain: "i2c", direction: "bidirectional", protocol: { role: "target" } },
    ],
  },
};

const lookup: HardwareDefinitionLookup = (definitionId) => definitions[definitionId];

function project(connections: HardwareGraphProjectInput["connections"], componentIds = ["mcu", "a", "b"]): HardwareGraphProjectInput {
  const definitionById = { mcu: "board", a: "sensorA", b: "sensorB" };
  return {
    components: componentIds.map((id) => ({ id, definitionId: definitionById[id as keyof typeof definitionById] ?? id })),
    connections,
  };
}

function connection(id: string, source: [string, string], target: [string, string], domain: string) {
  return { id, source: { componentId: source[0], portId: source[1] }, target: { componentId: target[0], portId: target[1] }, domain };
}

describe("HardwareGraphIndex", () => {
  it("derives a deterministic shared ground net regardless of wire order or orientation", () => {
    const first = createHardwareGraphIndex(project([
      connection("g1", ["mcu", "GND"], ["a", "GND"], "ground"),
      connection("g2", ["b", "GND"], ["a", "GND"], "ground"),
    ]), lookup);
    const second = createHardwareGraphIndex(project([
      connection("g2", ["a", "GND"], ["b", "GND"], "ground"),
      connection("g1", ["a", "GND"], ["mcu", "GND"], "ground"),
    ]), lookup);

    const firstNet = first.netFor({ componentId: "mcu", portId: "GND" });
    const secondNet = second.netFor({ componentId: "mcu", portId: "GND" });
    expect(firstNet?.id).toBe(secondNet?.id);
    expect(firstNet?.domain).toBe("ground");
    expect(firstNet?.endpoints.map((endpoint) => endpoint.key)).toEqual([
      "a:GND",
      "b:GND",
      "mcu:GND",
    ]);
    expect(secondNet?.endpoints.map((endpoint) => endpoint.key)).toEqual(firstNet?.endpoints.map((endpoint) => endpoint.key));
    expect(first.diagnostics).toEqual([]);
  });

  it("models a multidrop I2C bus as one SDA net and one SCL net", () => {
    const index = createHardwareGraphIndex(project([
      connection("sda-a", ["mcu", "SDA"], ["a", "SDA"], "i2c"),
      connection("sda-b", ["a", "SDA"], ["b", "SDA"], "i2c"),
      connection("scl-a", ["mcu", "SCL"], ["a", "SCL"], "i2c"),
      connection("scl-b", ["b", "SCL"], ["a", "SCL"], "i2c"),
    ]), lookup);

    const sda = index.netFor({ componentId: "mcu", portId: "SDA" });
    const scl = index.netFor({ componentId: "mcu", portId: "SCL" });
    expect(sda?.endpoints.map((endpoint) => endpoint.key)).toEqual(["a:SDA", "b:SDA", "mcu:SDA"]);
    expect(scl?.endpoints.map((endpoint) => endpoint.key)).toEqual(["a:SCL", "b:SCL", "mcu:SCL"]);
    expect(sda?.id).not.toBe(scl?.id);
    expect(index.diagnostics.some((diagnostic) => diagnostic.code === "BUS_SIGNAL_MISMATCH")).toBe(false);
  });

  it("flags duplicate wires even when the second wire is reversed", () => {
    const index = createHardwareGraphIndex(project([
      connection("one", ["mcu", "GND"], ["a", "GND"], "ground"),
      connection("two", ["a", "GND"], ["mcu", "GND"], "ground"),
    ]), lookup);

    const duplicate = index.diagnostics.find((diagnostic) => diagnostic.code === "DUPLICATE_CONNECTION");
    expect(duplicate?.connectionIds).toEqual(["one", "two"]);
  });

  it("keeps disconnected ports addressable as singleton nets", () => {
    const index = createHardwareGraphIndex(project([]), lookup);
    const endpoint = index.endpoint({ componentId: "mcu", portId: "D2" });
    const net = index.netFor({ componentId: "mcu", portId: "D2" });

    expect(endpoint?.valid).toBe(true);
    expect(net?.connected).toBe(false);
    expect(net?.endpoints.map((item) => item.key)).toEqual(["mcu:D2"]);
    expect(index.connected({ componentId: "mcu", portId: "D2" })).toEqual([]);
  });

  it("reports mixed rails, mismatched declared domains, and mixed bus signals", () => {
    const index = createHardwareGraphIndex(project([
      connection("bad-rail", ["mcu", "VCC"], ["a", "GND"], "gpio"),
      connection("bad-bus", ["mcu", "SDA"], ["a", "SCL"], "i2c"),
    ]), lookup);

    expect(index.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      "DOMAIN_MISMATCH",
      "CONNECTION_DOMAIN_MISMATCH",
      "MIXED_RAIL_NET",
      "BUS_SIGNAL_MISMATCH",
    ]));
  });

  it("reports removed components and missing ports without throwing", () => {
    const index = createHardwareGraphIndex(project([
      connection("removed", ["mcu", "GND"], ["gone", "GND"], "ground"),
      connection("missing-port", ["mcu", "D2"], ["a", "NO_SUCH_PORT"], "gpio"),
    ], ["mcu", "a"]), lookup);

    expect(index.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      "MISSING_COMPONENT",
      "MISSING_PORT",
    ]));
    expect(index.endpoint({ componentId: "gone", portId: "GND" })?.valid).toBe(false);
    expect(index.netFor({ componentId: "gone", portId: "GND" })?.connected).toBe(true);
  });
});
