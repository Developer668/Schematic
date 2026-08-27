import { describe, expect, it } from "vitest";
import { runFirmwareRuntime } from "../simulation/runtime.ts";
import type { HardwareGraph } from "../store/useProjectStore.ts";

const project: HardwareGraph = {
  id: "runtime-test",
  name: "Button LED",
  components: [
    { id: "board-1", definitionId: "esp32-s3", position: { x: 0, y: 0 }, rotation: 0, properties: {} },
    { id: "button-1", definitionId: "pushbutton", position: { x: 240, y: 0 }, rotation: 0, properties: {} },
    { id: "led-1", definitionId: "led", position: { x: 480, y: 0 }, rotation: 0, properties: {} },
  ],
  connections: [
    { id: "wire-button", source: { componentId: "board-1", portId: "GPIO18" }, target: { componentId: "button-1", portId: "A" }, domain: "gpio" },
    { id: "wire-led", source: { componentId: "board-1", portId: "GPIO19" }, target: { componentId: "led-1", portId: "IN" }, domain: "gpio" },
  ],
  firmwareTargets: [{ id: "fw-board-1", componentId: "board-1", files: [{ name: "main.ino", content: "constexpr int BUTTON_PIN = 18; constexpr int LED_PIN = 19; void setup() {} void loop() { bool pressed = digitalRead(BUTTON_PIN) == LOW; digitalWrite(LED_PIN, pressed); delay(50); }" }] }],
};

describe("browser hardware runtime", () => {
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
      firmwareTargets: [{ id: "fw-board-1", componentId: "board-1", files: [{ name: "main.ino", content: "constexpr int BUTTON_PIN = 18; constexpr int LED_PIN = 19; void setup() {} void loop() { if (digitalRead(BUTTON_PIN) == LOW) { digitalWrite(LED_PIN, HIGH); } else { digitalWrite(LED_PIN, LOW); } delay(10); }" }] }],
    };
    const pressed = runFirmwareRuntime(conditional, { "button-1:pressed": true }, 10);
    const released = runFirmwareRuntime(conditional, { "button-1:pressed": false }, 10);
    expect(pressed.outputs["led-1:IN"]).toBe(true);
    expect(released.outputs["led-1:IN"]).toBe(false);

    const flashing: HardwareGraph = {
      ...conditional,
      firmwareTargets: [{ id: "fw-board-1", componentId: "board-1", files: [{ name: "main.ino", content: "constexpr int LED_PIN = 19; void setup() {} void loop() { digitalWrite(LED_PIN, HIGH); delay(10); digitalWrite(LED_PIN, LOW); delay(10); }" }] }],
    };
    const run = runFirmwareRuntime(flashing, {}, 25);
    expect(run.events.filter((event) => event.endpoint === "led-1:IN").map((event) => [event.timeMs, event.value])).toEqual([[0, true], [10, false], [20, true], [25, false]]);
  });
});
