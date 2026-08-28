import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeWebMCPTool, unregisterWebMCPTools } from "../webmcp/tools.ts";
import { useProjectStore } from "../store/useProjectStore.ts";
import { useSimulationStore } from "../store/useSimulationStore.ts";
import { useValidationStore } from "../store/useValidationStore.ts";

describe("degraded WebMCP runs", () => {
  beforeEach(() => {
    useProjectStore.getState().clear();
    useSimulationStore.getState().reset();
    useValidationStore.getState().clear();
  });

  afterEach(() => {
    unregisterWebMCPTools();
    vi.unstubAllGlobals();
  });

  it("returns checks and validation when the remote runtime declines a board model", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      status: "invalid-target",
      runtime: "remote",
      execution_mode: "behavioral",
      duration_ns: 50_000_000,
      target_issues: [{ componentId: "board-1", code: "UNSUPPORTED_BOARD_MODEL", message: "No executable model" }],
      programs: [],
      resolved_nets: 1,
      serial_output: "",
      protocol_events: [],
      device_states: [],
      warnings: [],
      unsupported_apis: [],
      note: "The selected board model is unavailable.",
    }), { status: 422, headers: { "content-type": "application/json" } })));

    const board: any = await invokeWebMCPTool("component.add", { componentId: "arduino-mega", x: 40, y: 40 });
    const led: any = await invokeWebMCPTool("component.add", { componentId: "led", x: 360, y: 40 });
    await invokeWebMCPTool("connection.connect", { sourceComponentId: board.data.instanceId, sourcePortId: "D18", targetComponentId: led.data.instanceId, targetPortId: "IN" });
    await invokeWebMCPTool("firmware.write", { componentId: board.data.instanceId, files: [{ name: "main.ino", content: "void setup() {} void loop() {}" }] });

    const result: any = await invokeWebMCPTool("simulation.run", { durationMs: 50 });

    expect(result.isError).not.toBe(true);
    expect(result.data.connectionCheck.status).toBe("completed");
    expect(result.data.connectionCheck.connectionsChecked).toBe(1);
    expect(result.data.codeExecution.status).toBe("unavailable");
    expect(result.data.validation.issueCount).toBeGreaterThanOrEqual(0);
    expect(useValidationStore.getState().valid).not.toBe(null);
    expect(useSimulationStore.getState().lastRun?.connectionCheck?.status).toBe("completed");
    expect(useSimulationStore.getState().lastRun?.codeExecution?.status).toBe("unavailable");
  });

  it("keeps topology results when a recognized browser artifact cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("verified browser artifact unavailable");
    }));

    const board: any = await invokeWebMCPTool("component.add", { componentId: "esp32-devkit-v1", x: 40, y: 40 });
    const button: any = await invokeWebMCPTool("component.add", { componentId: "pushbutton", x: 360, y: 40 });
    const led: any = await invokeWebMCPTool("component.add", { componentId: "led", x: 680, y: 40 });
    await invokeWebMCPTool("connection.connect", { sourceComponentId: board.data.instanceId, sourcePortId: "GPIO18", targetComponentId: button.data.instanceId, targetPortId: "A" });
    await invokeWebMCPTool("connection.connect", { sourceComponentId: board.data.instanceId, sourcePortId: "GPIO19", targetComponentId: led.data.instanceId, targetPortId: "IN" });
    await invokeWebMCPTool("firmware.write", {
      componentId: board.data.instanceId,
      files: [{ name: "main.ino", content: "constexpr int BUTTON_PIN = 18; constexpr int LED_PIN = 19; void setup() { pinMode(BUTTON_PIN, INPUT_PULLUP); pinMode(LED_PIN, OUTPUT); } void loop() { bool pressed = digitalRead(BUTTON_PIN) == LOW; digitalWrite(LED_PIN, pressed); delay(10); }" }],
    });

    const result: any = await invokeWebMCPTool("simulation.run", { durationMs: 50 });

    expect(result.isError).not.toBe(true);
    expect(result.data.connectionCheck.status).toBe("completed");
    expect(result.data.connectionCheck.connectionsChecked).toBe(2);
    expect(result.data.codeExecution.status).toBe("unavailable");
    expect(result.data.note).toContain("actual hardware");
  });
});
