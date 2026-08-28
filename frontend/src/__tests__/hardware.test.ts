import { describe, expect, it } from "vitest";
import {
  boardTargetFor,
  componentPort,
  defaultProperties,
  isBoardDefinition,
  orientConnectionEndpoints,
  resolveBoardPin,
  resolveFirmwareBinding,
} from "../data/hardware.ts";
import { getCatalogComponent } from "../data/catalog.ts";

const project = {
  components: [
    { id: "board-1", definitionId: "esp32-s3" },
    { id: "led-1", definitionId: "led" },
    { id: "servo-1", definitionId: "servo" },
  ],
  firmwareTargets: [{ id: "fw-1", componentId: "board-1", definitionId: "esp32-s3", files: [{ name: "sketch.ino", content: "" }] }],
};

describe("shared hardware resolvers", () => {
  it("keeps firmware bound to the exact board definition", () => {
    const binding = resolveFirmwareBinding(project, "board-1");
    expect(binding.definition?.id).toBe("esp32-s3");
    expect(binding.targetConfig?.fqbn).toBe("esp32:esp32:esp32s3");
    expect(binding.definitionMatchesTarget).toBe(true);

    const mismatch = resolveFirmwareBinding({
      ...project,
      firmwareTargets: [{ ...project.firmwareTargets[0], definitionId: "arduino-uno" }],
    }, "board-1");
    expect(mismatch.definitionMatchesTarget).toBe(false);
  });

  it("does not invent a compiler target for an unsupported board", () => {
    expect(isBoardDefinition("stm32-bluepill")).toBe(true);
    expect(boardTargetFor("stm32-bluepill")).toBeUndefined();
  });

  it("keeps architecture-specific pin profiles distinct", () => {
    expect(getCatalogComponent("esp32-devkit-v1")?.ports.some((port) => port.id === "GPIO19")).toBe(true);
    expect(getCatalogComponent("stm32-bluepill")?.ports.some((port) => port.id === "PA13")).toBe(true);
    expect(getCatalogComponent("teensy-3-2")?.ports.some((port) => port.id === "D13")).toBe(true);
    expect(getCatalogComponent("bbc-microbit-v2")?.ports.some((port) => port.id === "P0")).toBe(true);
    expect(getCatalogComponent("nano-rp2040-connect")?.ports.some((port) => port.id === "GPIO19")).toBe(true);
    expect(getCatalogComponent("esp32-devkit-v1")?.ports.some((port) => port.id === "PA13")).toBe(false);
  });

  it("marks unimplemented protocol parts as validation-only", () => {
    expect(getCatalogComponent("ds3231")?.model).toMatchObject({ support: "behavioral", modelId: "ds3231-register-read:v1" });
    expect(getCatalogComponent("bmp280")?.model.support).toBe("validation");
    expect(getCatalogComponent("ssd1306")?.model).toMatchObject({ support: "behavioral", adapterId: "i2c-display-text" });
  });

  it("keeps device-specific ports and bus identities physically truthful", () => {
    expect(getCatalogComponent("gy-521-mpu6050")?.ports.find((port) => port.id === "SDA")?.protocol).toMatchObject({ role: "target", address: 0x68 });
    expect(getCatalogComponent("gy-68-bmp280")?.ports.find((port) => port.id === "SDA")?.protocol).toMatchObject({ role: "target", address: 0x76 });
    expect(getCatalogComponent("hcsr04-2")?.ports.map((port) => [port.id, port.domain])).toEqual(expect.arrayContaining([["TRIG", "gpio"], ["ECHO", "gpio"]]));
    expect(getCatalogComponent("hx711-2")?.ports.map((port) => [port.id, port.domain])).toEqual(expect.arrayContaining([["DOUT", "gpio"], ["SCK", "gpio"]]));
    expect(getCatalogComponent("tft-1-8-st7735-2")?.ports.find((port) => port.id === "SCL")?.domain).toBe("spi");
  });

  it("hydrates catalog defaults and resolves named pins", () => {
    expect(defaultProperties("ssd1306")).toEqual({ i2cAddress: "0x3c" });
    expect(resolveBoardPin(project, "board-1", "LED_PIN", new Map([["LED_PIN", 18]]))).toEqual({ componentId: "board-1", portId: "GPIO18" });
  });

  it("normalizes an input-to-output wire and rejects input-to-input", () => {
    const ledIn = componentPort(project, "led-1", "IN")!;
    const boardPin = componentPort(project, "board-1", "GPIO18")!;
    const normalized = orientConnectionEndpoints({ componentId: "led-1", portId: "IN" }, ledIn, { componentId: "board-1", portId: "GPIO18" }, boardPin);
    expect(normalized.source).toEqual({ componentId: "board-1", portId: "GPIO18" });
    expect(normalized.target).toEqual({ componentId: "led-1", portId: "IN" });

    const servoSignal = componentPort(project, "servo-1", "SIG")!;
    expect(() => orientConnectionEndpoints({ componentId: "led-1", portId: "IN" }, ledIn, { componentId: "servo-1", portId: "SIG" }, servoSignal)).toThrow(/input|output/i);
  });
});
