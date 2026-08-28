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
