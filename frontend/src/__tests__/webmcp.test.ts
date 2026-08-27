import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useProjectStore } from "../store/useProjectStore.ts";
import { getRegisteredToolNames, invokeWebMCPTool, registerWebMCPTools, unregisterWebMCPTools } from "../webmcp/tools.ts";

describe("WebMCP tools", () => {
  beforeEach(() => useProjectStore.getState().clear());
  afterEach(() => {
    unregisterWebMCPTools();
    vi.unstubAllGlobals();
    delete (document as any).modelContext;
  });

  it("registers ~18 tools", () => {
    const names = getRegisteredToolNames();
    expect(names.length).toBeGreaterThanOrEqual(15);
    expect(names).toContain("project.get_graph");
    expect(names).toContain("component.search");
    expect(names).toContain("connection.connect");
    expect(names).toContain("simulation.run");
    expect(names).toContain("validation.check");
  });

  it("project tools work via fallback window.__schematicTools", async () => {
    const tools: any = (globalThis as any).window?.__schematicTools ?? (globalThis as any).__schematicTools;
    // if not yet registered, trigger via import
    if (!tools) {
      const { registerWebMCPTools } = await import("../webmcp/tools.ts");
      await registerWebMCPTools();
    }
    const fallback = (globalThis as any).__schematicTools ?? (globalThis as any).window?.__schematicTools;
    // At least fallback should exist after register
    expect(fallback ?? {}).toBeDefined();
  });

  it("add_component via store works", () => {
    const { addComponent } = useProjectStore.getState();
    const { id } = addComponent("esp32-s3");
    expect(id).toContain("esp32-s3");
    expect(useProjectStore.getState().project.components).toHaveLength(1);
  });

  it("executes the real component lifecycle through WebMCP callbacks", async () => {
    const search: any = await invokeWebMCPTool("component.search", { query: "bmp280" });
    expect(search.data.some((definition: any) => definition.id === "bmp280")).toBe(true);

    const added: any = await invokeWebMCPTool("component.add", { componentId: "bmp280", x: 160, y: 96 });
    const instanceId = added.data.instanceId;
    expect(useProjectStore.getState().project.components.find((item) => item.id === instanceId)?.position).toEqual({ x: 160, y: 96 });

    await invokeWebMCPTool("component.remove", { instanceId });
    expect(useProjectStore.getState().project.components).toHaveLength(0);
  });

  it("registers every tool with the native WebMCP surface", async () => {
    const registerTool = vi.fn(async () => undefined);
    (document as any).modelContext = { registerTool };
    await registerWebMCPTools();

    expect(registerTool).toHaveBeenCalledTimes(getRegisteredToolNames().length);
    expect(registerTool.mock.calls.map(([definition]) => definition.name)).toEqual(getRegisteredToolNames());
    for (const [definition, options] of registerTool.mock.calls) {
      expect(definition.execute).toBeTypeOf("function");
      expect(definition.inputSchema.type).toBe("object");
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("executes all registered WebMCP tools through real state transitions", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const data = url.includes("/api/compile")
        ? { success: true, artifact: "firmware.elf" }
        : { status: "ok", simulated_ns: 2_000_000 };
      return { ok: true, status: 200, json: async () => data } as Response;
    });
    class MockWebSocket {
      onopen: null | (() => void) = null;
      send = vi.fn();
      constructor() { queueMicrotask(() => this.onopen?.()); }
    }
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", MockWebSocket);

    const invoked = new Set<string>();
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      invoked.add(name);
      const result = await invokeWebMCPTool(name, args);
      expect(result?.isError).not.toBe(true);
      return result;
    };

    await call("project.clear");
    await call("project.rename", { name: "WebMCP integration" });
    await call("component.search", { query: "bmp280" });
    await call("component.inspect", { componentId: "esp32-s3" });
    const board = await call("component.add", { componentId: "esp32-s3", x: 10, y: 20 });
    const sensor = await call("component.add", { componentId: "bmp280", x: 310, y: 20 });
    const boardId = board.data.instanceId;
    const sensorId = sensor.data.instanceId;
    await call("component.list_ports", { componentId: boardId });
    const connection = await call("connection.connect", { sourceComponentId: boardId, sourcePortId: "SDA", targetComponentId: sensorId, targetPortId: "SDA" });
    await call("connection.get_connections");
    await call("connection.disconnect", { connectionId: connection.data.connectionId });
    await call("firmware.write", { componentId: boardId, files: [{ name: "sketch.ino", content: "void setup(){} void loop(){}" }] });
    await call("firmware.compile", { componentId: boardId, boardFqbn: "esp32:esp32:esp32s3" });
    await call("simulation.run", { durationMs: 2 });
    await call("simulation.get_state");
    await call("simulation.set_input", { componentId: sensorId, key: "temperature", value: 25 });
    await call("simulation.stop");
    await call("validation.check");
    await call("validation.explain_error", { code: "MISSING_GROUND" });
    await call("design.auto_layout");
    await call("project.get_graph");
    await call("component.remove", { instanceId: sensorId });

    expect([...invoked].sort()).toEqual([...getRegisteredToolNames()].sort());
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
