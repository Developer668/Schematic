import { describe, expect, it } from "vitest";
import { runFirmwareRuntime } from "../simulation/runtime.ts";
import type { HardwareGraph } from "../store/useProjectStore.ts";

const project: HardwareGraph = {
  id: "runtime-test",
  name: "Button LED",
  components: [
    { id: "board-1", definitionId: "esp32-devkit-v1", position: { x: 0, y: 0 }, rotation: 0, properties: {} },
    { id: "button-1", definitionId: "pushbutton", position: { x: 240, y: 0 }, rotation: 0, properties: {} },
    { id: "led-1", definitionId: "led", position: { x: 480, y: 0 }, rotation: 0, properties: {} },
  ],
  connections: [
    { id: "wire-button", source: { componentId: "board-1", portId: "GPIO18" }, target: { componentId: "button-1", portId: "A" }, domain: "gpio" },
    { id: "wire-led", source: { componentId: "board-1", portId: "GPIO19" }, target: { componentId: "led-1", portId: "IN" }, domain: "gpio" },
  ],
  firmwareTargets: [{ id: "fw-board-1", componentId: "board-1", definitionId: "esp32-devkit-v1", boardFqbn: "esp32:esp32:esp32", files: [{ name: "main.ino", content: "constexpr int BUTTON_PIN = 18; constexpr int LED_PIN = 19; void setup() {} void loop() { bool pressed = digitalRead(BUTTON_PIN) == LOW; digitalWrite(LED_PIN, pressed); delay(50); }" }] }],
};

describe("browser hardware runtime", () => {
  it("keeps topology checks and source handoff available when firmware execution is unavailable", () => {
    const result = runFirmwareRuntime({ ...project, firmwareTargets: [] }, {}, 50);

    expect(result.status).toBe("no-firmware");
    expect(result.connectionCheck?.status).toBe("completed");
    expect(result.connectionCheck?.connectionsChecked).toBe(project.connections.length);
    expect(result.connectionCheck?.resolvedNets).toBe(result.resolvedNets);
    expect(result.codeExecution?.status).toBe("unavailable");
    expect(result.note).toContain("Connection topology was checked");
    expect(result.codeExecution?.physicalHardwareNextStep).toContain("actual hardware");
  });

  it("checks wiring for a validation-only board without claiming browser code execution", () => {
    const validationOnly: HardwareGraph = {
      ...project,
      components: project.components.map((component) => component.id === "board-1" ? { ...component, definitionId: "arduino-mega" } : component),
      connections: project.connections.map((connection, index) => ({
        ...connection,
        source: { componentId: "board-1", portId: index === 0 ? "D18" : "D19" },
      })),
      firmwareTargets: [{
        ...project.firmwareTargets[0],
        definitionId: "arduino-mega",
        boardFqbn: "arduino:avr:mega",
      }],
    };

    const result = runFirmwareRuntime(validationOnly, {}, 50);
    expect(result.status).toBe("invalid-target");
    expect(result.targetIssues.some((issue) => issue.code === "UNSUPPORTED_BOARD_MODEL")).toBe(true);
    expect(result.connectionCheck?.status).toBe("completed");
    expect(result.connectionCheck?.connectionsChecked).toBe(2);
    expect(result.codeExecution?.status).toBe("unavailable");
    expect(result.note).toContain("editable and exportable");
  });

  it("propagates a button program through an ESP32 net to an LED", () => {
    const pressed = runFirmwareRuntime(project, { "button-1:pressed": true }, 50);
    expect(pressed.status).toBe("completed");
    expect(pressed.outputs["led-1:IN"]).toBe(true);
    expect(pressed.events.some((event) => event.endpoint === "led-1:IN" && event.value === true)).toBe(true);

    const released = runFirmwareRuntime(project, { "button-1:pressed": false }, 50);
    expect(released.outputs["led-1:IN"]).toBe(false);
  });

  it("executes only the selected branch and produces timed flashing events", () => {
    const conditional: HardwareGraph = {
      ...project,
      firmwareTargets: [{ id: "fw-board-1", componentId: "board-1", definitionId: "esp32-devkit-v1", boardFqbn: "esp32:esp32:esp32", files: [{ name: "main.ino", content: "constexpr int BUTTON_PIN = 18; constexpr int LED_PIN = 19; void setup() {} void loop() { if (digitalRead(BUTTON_PIN) == LOW) { digitalWrite(LED_PIN, HIGH); } else { digitalWrite(LED_PIN, LOW); } delay(10); }" }] }],
    };
    const pressed = runFirmwareRuntime(conditional, { "button-1:pressed": true }, 10);
    const released = runFirmwareRuntime(conditional, { "button-1:pressed": false }, 10);
    expect(pressed.outputs["led-1:IN"]).toBe(true);
    expect(released.outputs["led-1:IN"]).toBe(false);

    const flashing: HardwareGraph = {
      ...conditional,
      firmwareTargets: [{ id: "fw-board-1", componentId: "board-1", definitionId: "esp32-devkit-v1", boardFqbn: "esp32:esp32:esp32", files: [{ name: "main.ino", content: "constexpr int LED_PIN = 19; void setup() {} void loop() { digitalWrite(LED_PIN, HIGH); delay(10); digitalWrite(LED_PIN, LOW); delay(10); }" }] }],
    };
    const run = runFirmwareRuntime(flashing, {}, 25);
    expect(run.events.filter((event) => event.endpoint === "led-1:IN").map((event) => [event.timeMs, event.value])).toEqual([[0, true], [10, false], [20, true], [25, false]]);
  });

  it("resolves preprocessor pin definitions and reports stale board bindings", () => {
    const definedPin = {
      ...project,
      firmwareTargets: [{ id: "fw-board-1", componentId: "board-1", definitionId: "esp32-devkit-v1", boardFqbn: "esp32:esp32:esp32", files: [{ name: "main.ino", content: "#define LED_PIN 19\nvoid setup() {}\nvoid loop() { digitalWrite(LED_PIN, HIGH); }" }] }],
    };
    expect(runFirmwareRuntime(definedPin, {}, 1).outputs["led-1:IN"]).toBe(true);

    const stale = {
      ...definedPin,
      firmwareTargets: [{ ...definedPin.firmwareTargets[0], definitionId: "arduino-uno" }],
    };
    const result = runFirmwareRuntime(stale, {}, 1);
    expect(result.status).toBe("invalid-target");
    expect(result.targetIssues[0]?.code).toBe("FIRMWARE_DEFINITION_MISMATCH");
  });

  it("runs a wired DS3231 I2C model and uses its changing register value to drive an LED", () => {
    const rtcProject: HardwareGraph = {
      id: "rtc-led-test",
      name: "RTC LED",
      components: [
        { id: "board-1", definitionId: "esp32-devkit-v1", position: { x: 0, y: 0 }, rotation: 0, properties: {} },
        { id: "rtc-1", definitionId: "ds3231", position: { x: 240, y: 0 }, rotation: 0, properties: { epochMs: Date.UTC(2024, 0, 1, 0, 0, 0) } },
        { id: "led-1", definitionId: "led", position: { x: 480, y: 0 }, rotation: 0, properties: {} },
      ],
      connections: [
        { id: "wire-sda", source: { componentId: "board-1", portId: "SDA" }, target: { componentId: "rtc-1", portId: "SDA" }, domain: "i2c" },
        { id: "wire-scl", source: { componentId: "board-1", portId: "SCL" }, target: { componentId: "rtc-1", portId: "SCL" }, domain: "i2c" },
        { id: "wire-vcc", source: { componentId: "board-1", portId: "3V3" }, target: { componentId: "rtc-1", portId: "VCC" }, domain: "power" },
        { id: "wire-gnd", source: { componentId: "board-1", portId: "GND" }, target: { componentId: "rtc-1", portId: "GND" }, domain: "ground" },
        { id: "wire-led", source: { componentId: "board-1", portId: "GPIO19" }, target: { componentId: "led-1", portId: "IN" }, domain: "gpio" },
      ],
      firmwareTargets: [{
        id: "fw-board-1",
        componentId: "board-1",
        definitionId: "esp32-devkit-v1",
        boardFqbn: "esp32:esp32:esp32",
        files: [{
          name: "main.ino",
          content: "#include <Wire.h>\nconstexpr int LED_PIN = 19;\nvoid setup() { Wire.begin(); }\nvoid loop() { Wire.beginTransmission(0x68); Wire.write(0x00); Wire.endTransmission(); Wire.requestFrom(0x68, 1); int seconds = Wire.read(); digitalWrite(LED_PIN, seconds % 2 == 0 ? HIGH : LOW); delay(1000); }",
        }],
      }],
    };

    const result = runFirmwareRuntime(rtcProject, {}, 1001);
    expect(result.status).toBe("completed");
    expect(result.outputs["led-1:IN"]).toBe(false);
    expect(result.protocolEvents.some((event) => event.kind === "i2c" && event.operation === "read" && event.address === 0x68 && event.acknowledged)).toBe(true);
    expect(result.deviceStates.find((device) => device.componentId === "rtc-1")?.values.seconds).toBe(1);
    expect(result.warnings).toEqual([]);

    const wrongAddress = runFirmwareRuntime({
      ...rtcProject,
      firmwareTargets: [{ ...rtcProject.firmwareTargets[0], files: [{ name: "main.ino", content: rtcProject.firmwareTargets[0].files[0].content.replace(/0x68/g, "0x69") }] }],
    }, {}, 1);
    expect(wrongAddress.protocolEvents.some((event) => event.kind === "i2c" && !event.acknowledged)).toBe(true);
    expect(wrongAddress.warnings.some((warning) => warning.code === "I2C_DEVICE_NOT_FOUND")).toBe(true);

    const unsupported = runFirmwareRuntime({
      ...rtcProject,
      firmwareTargets: [{ ...rtcProject.firmwareTargets[0], files: [{ name: "main.ino", content: "void setup() { Wire.begin(); Wire.foo(); } void loop() {}" }] }],
    }, {}, 1);
    expect(unsupported.status).toBe("unsupported-api");
    expect(unsupported.unsupportedApis).toContain("Wire.foo");
  });

  it("traces SPI transfers without claiming a validation-only display model", () => {
    const spiProject: HardwareGraph = {
      ...project,
      components: [
        { id: "board-1", definitionId: "esp32-devkit-v1", position: { x: 0, y: 0 }, rotation: 0, properties: {} },
        { id: "display-1", definitionId: "tft-1-8-st7735-2", position: { x: 240, y: 0 }, rotation: 0, properties: {} },
      ],
      connections: [
        { id: "wire-sck", source: { componentId: "board-1", portId: "SCK" }, target: { componentId: "display-1", portId: "SCL" }, domain: "spi" },
        { id: "wire-mosi", source: { componentId: "board-1", portId: "MOSI" }, target: { componentId: "display-1", portId: "SDA" }, domain: "spi" },
      ],
      firmwareTargets: [{ id: "fw-board-1", componentId: "board-1", definitionId: "esp32-devkit-v1", boardFqbn: "esp32:esp32:esp32", files: [{ name: "main.ino", content: "void setup() { SPI.begin(); } void loop() { SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0)); byte response = SPI.transfer(0xA5); SPI.endTransaction(); delay(10); }" }] }],
    };
    const result = runFirmwareRuntime(spiProject, {}, 25);
    expect(result.status).toBe("completed-with-warnings");
    expect(result.unsupportedApis).not.toContain("SPISettings");
    expect(result.protocolEvents.filter((event) => event.kind === "spi")).toHaveLength(3);
    expect(result.protocolEvents.find((event) => event.kind === "spi")?.acknowledged).toBe(false);
  });

  it("records UART transport and consumes an injected RX byte", () => {
    const uartProject: HardwareGraph = {
      ...project,
      components: [
        { id: "board-1", definitionId: "esp32-devkit-v1", position: { x: 0, y: 0 }, rotation: 0, properties: {} },
        { id: "module-1", definitionId: "hc05-bluetooth", position: { x: 240, y: 0 }, rotation: 0, properties: {} },
      ],
      connections: [
        { id: "wire-tx", source: { componentId: "board-1", portId: "TX" }, target: { componentId: "module-1", portId: "RXD" }, domain: "uart" },
        { id: "wire-rx", source: { componentId: "board-1", portId: "RX" }, target: { componentId: "module-1", portId: "TXD" }, domain: "uart" },
      ],
      firmwareTargets: [{ id: "fw-board-1", componentId: "board-1", definitionId: "esp32-devkit-v1", boardFqbn: "esp32:esp32:esp32", files: [{ name: "main.ino", content: "void setup() {} void loop() { Serial.println(\"ready\"); if (Serial.available()) { int value = Serial.read(); Serial.write(value); } delay(10); }" }] }],
    };
    const result = runFirmwareRuntime(uartProject, { "module-1:rx": 65 }, 15);
    expect(result.status).toBe("completed");
    expect(result.serialOutput).toBe("ready\nready\n");
    expect(result.protocolEvents.some((event) => event.kind === "uart" && event.direction === "rx" && event.data[0] === 65)).toBe(true);
    expect(result.protocolEvents.some((event) => event.kind === "uart" && event.direction === "tx" && event.data[0] === 65)).toBe(true);
  });
});
