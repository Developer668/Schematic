import { describe, expect, it } from "vitest";
import { catalog } from "../data/catalog.ts";
import { catalogCapabilityCoverage, capabilityRegistryEntry } from "../simulation/capabilityRegistry.ts";
import { runFirmwareRuntime } from "../simulation/runtime.ts";
import type { HardwareGraph } from "../store/useProjectStore.ts";

describe("explicit simulation capability registry", () => {
  it("maps every catalog model to an honest adapter or unsupported boundary", () => {
    const coverage = catalogCapabilityCoverage(catalog);
    const mapped = catalog.filter((definition) => definition.model.adapterId !== "unsupported").length;

    expect(mapped).toBeGreaterThan(0);
    expect(mapped + coverage.unsupported).toBe(catalog.length);
    expect(catalog.every((definition) => {
      const entry = capabilityRegistryEntry(definition.model.adapterId);
      return entry.family === definition.model.family || definition.model.adapterId === "unsupported";
    })).toBe(true);
    expect(catalog.find((definition) => definition.id === "bmp280")?.model.adapterId).toBe("i2c-register-transport");
    expect(catalog.find((definition) => definition.id === "bmp280")?.model.support).toBe("validation");
    expect(catalog.find((definition) => definition.id === "ssd1306")?.model.adapterId).toBe("i2c-display-text");
  });

  it("reports the current adapter coverage by exact runtime contract", () => {
    const coverage = catalogCapabilityCoverage(catalog);
    expect(coverage["mcu-gpio"]).toBeGreaterThan(0);
    expect(coverage["digital-input"]).toBeGreaterThan(0);
    expect(coverage["digital-output"]).toBeGreaterThan(0);
    expect(coverage["pwm-actuator"]).toBeGreaterThan(0);
    expect(coverage["adc-source"]).toBeGreaterThan(0);
    expect(coverage["i2c-register"]).toBeGreaterThan(0);
    expect(coverage["i2c-register-transport"]).toBeGreaterThan(0);
    expect(coverage["i2c-display-text"]).toBeGreaterThan(0);
    expect(coverage["i2c-display-transport"]).toBeGreaterThan(0);
    expect(coverage["spi-transport"]).toBeGreaterThan(0);
    expect(coverage["uart-transport"]).toBeGreaterThan(0);
    expect(coverage.unsupported).toBeGreaterThan(0);
  });

  it("captures printable text for the supported SSD1306 I2C adapter", () => {
    const project: HardwareGraph = {
      id: "display-test",
      name: "Display",
      components: [
        { id: "board-1", definitionId: "esp32-devkit-v1", position: { x: 0, y: 0 }, rotation: 0, properties: {} },
        { id: "display-1", definitionId: "ssd1306", position: { x: 200, y: 0 }, rotation: 0, properties: {} },
      ],
      connections: [
        { id: "sda", source: { componentId: "board-1", portId: "SDA" }, target: { componentId: "display-1", portId: "SDA" }, domain: "i2c" },
        { id: "scl", source: { componentId: "board-1", portId: "SCL" }, target: { componentId: "display-1", portId: "SCL" }, domain: "i2c" },
        { id: "vcc", source: { componentId: "board-1", portId: "3V3" }, target: { componentId: "display-1", portId: "VCC" }, domain: "power" },
        { id: "gnd", source: { componentId: "board-1", portId: "GND" }, target: { componentId: "display-1", portId: "GND" }, domain: "ground" },
      ],
      firmwareTargets: [{
        id: "firmware-1",
        componentId: "board-1",
        definitionId: "esp32-devkit-v1",
        boardFqbn: "esp32:esp32:esp32",
        files: [{ name: "main.ino", content: "void setup() { Wire.begin(); } void loop() { Wire.beginTransmission(0x3c); Wire.write(72); Wire.write(105); Wire.endTransmission(); delay(10); }" }],
      }],
    };

    const result = runFirmwareRuntime(project, {}, 10);
    expect(result.status).toBe("completed");
    expect(result.deviceStates.find((device) => device.componentId === "display-1")).toMatchObject({ adapterId: "i2c-display-text", status: "active", values: { displayText: "Hi" } });
  });

  it("does not turn an unmodeled I2C sensor into a successful device", () => {
    const bmp = catalog.find((definition) => definition.id === "bmp280");
    expect(bmp?.model.adapterId).toBe("i2c-register-transport");
    expect(bmp?.model.support).toBe("validation");
    expect(bmp?.model.reason).toMatch(/no executable register model/i);
  });
});
