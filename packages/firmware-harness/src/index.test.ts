import { describe, expect, it } from "vitest";
import { createBrowserHarness, detectFirmwareCapability, getEsp32ExportManifest } from "./index";

describe("browser firmware harness", () => {
  it("runs the portable button-to-LED contract deterministically", () => {
    const harness = createBrowserHarness();
    expect(harness.readDigital(2)).toBe(0);

    harness.setDigitalInput(4, 0);
    const pressed = harness.step();
    expect(pressed.pins[2]).toBe(1);
    expect(pressed.events).toEqual([{ tick: 0, pin: 2, value: 1 }]);

    harness.setDigitalInput(4, 1);
    const released = harness.step();
    expect(released.pins[2]).toBe(0);
    expect(released.events.at(-1)).toEqual({ tick: 1, pin: 2, value: 0 });
  });

  it("fails closed for inputs outside the declared contract", () => {
    const harness = createBrowserHarness();
    expect(() => harness.setDigitalInput(12, 1)).toThrow("not a configured digital input");
    expect(detectFirmwareCapability()).toMatchObject({ supported: false, mode: "unsupported" });
  });
});

describe("ESP32 export contract", () => {
  it("contains an exact board target and reproducibility metadata", () => {
    expect(getEsp32ExportManifest()).toMatchObject({
      board: { fqbn: "esp32:esp32:esp32", framework: "arduino" },
      firmware: { entrypoint: "src/main.cpp", contract: "button-led-contract" },
      dependencies: { manager: "arduino-library-manager", libraries: [] },
    });
  });

  it("reports browser execution separately from native compilation", () => {
    expect(detectFirmwareCapability({ browserContract: true })).toMatchObject({
      supported: true,
      mode: "browser-contract",
    });
    expect(detectFirmwareCapability({ browserContract: true }).reason).toMatch(/not claimed/i);
    expect(detectFirmwareCapability({ nativeToolchain: "available" })).toMatchObject({
      supported: true,
      mode: "native-build",
    });
  });
});
