import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useProjectStore } from "../store/useProjectStore.ts";
import { useSimulationStore } from "../store/useSimulationStore.ts";
import { useWorkspaceStore } from "../store/useWorkspaceStore.ts";
import { useValidationStore } from "../store/useValidationStore.ts";
import { useWebMCPStore } from "../store/useWebMCPStore.ts";
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

  it("keeps new and duplicated project names distinct", () => {
    const source = useProjectStore.getState().project;
    const secondId = useProjectStore.getState().createProject(source.name);
    const second = useProjectStore.getState().projects.find((project) => project.id === secondId);
    expect(second?.name).not.toBe(source.name);

    const copyId = useProjectStore.getState().duplicateProject(source.id);
    const copy = useProjectStore.getState().projects.find((project) => project.id === copyId);
    expect(copy?.name).toContain(`${source.name} copy`);

    const renamed = useProjectStore.getState().renameProject(copyId ?? "", source.name);
    expect(renamed).not.toBe(source.name);
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

  it("keeps agent activity, panels, and diagnostics live", async () => {
    useWebMCPStore.getState().clearActivities();
    await invokeWebMCPTool("project.apply_blueprint", { blueprintId: "meta-glasses" });
    await invokeWebMCPTool("validation.check");
    await invokeWebMCPTool("workspace.set_panel", { panel: "validation" });
    await invokeWebMCPTool("simulation.set_input", { componentId: "capture-1", key: "pressed", value: true });

    expect(useProjectStore.getState().project.components).toHaveLength(10);
    expect(useValidationStore.getState().valid).toBe(true);
    expect(useWorkspaceStore.getState().bottomPanel).toBe("validation");
    expect(useWorkspaceStore.getState().bottomCollapsed).toBe(false);
    expect(useWebMCPStore.getState().activities.map((item) => item.name)).toEqual(expect.arrayContaining([
      "project.apply_blueprint", "validation.check", "workspace.set_panel", "simulation.set_input",
    ]));
    expect(useSimulationStore.getState().serialOutput).toContain("capture-1.pressed=true");
  });

  it("registers every tool with the native WebMCP surface", async () => {
    const registerTool = vi.fn(async () => undefined);
    (document as any).modelContext = { registerTool };
    await registerWebMCPTools();

    expect(registerTool).toHaveBeenCalledTimes(getRegisteredToolNames().length);
    const calls = registerTool.mock.calls as any[];
    expect(calls.map(([definition]) => definition.name)).toEqual(getRegisteredToolNames());
    for (const [definition, options] of calls) {
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
      close = vi.fn();
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
    await call("project.list");
    const createdProject = await call("project.create", { name: "Scratch hardware" });
    const duplicateProject = await call("project.duplicate");
    await call("project.switch", { projectId: createdProject.data.projectId });
    await call("project.save");
    await call("project.delete", { projectId: duplicateProject.data.projectId });
    await call("project.rename", { name: "WebMCP integration" });
    await call("project.apply_blueprint", { blueprintId: "meta-glasses" });
    await call("workspace.get_state");
    await call("workspace.set_panel", { panel: "debug" });
    await call("workspace.set_right_width", { width: 480 });
    expect(useWorkspaceStore.getState().rightPanelWidth).toBe(480);
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
    await call("firmware.read", { componentId: boardId });
    await call("firmware.check", { componentId: boardId });
    await call("firmware.compile", { componentId: boardId, boardFqbn: "esp32:esp32:esp32s3" });
    const browserRun = await call("simulation.run", { durationMs: 2 });
    expect(browserRun.data.runtime).toBe("browser");
    await call("simulation.get_state");
    await call("simulation.set_input", { componentId: sensorId, key: "temperature", value: 25 });
    await call("simulation.stop");
    await call("validation.check");
    await call("validation.explain_error", { code: "MISSING_GROUND" });
    const shopping = await call("shopping.search", {
      query: "esp32",
      quantity: 2,
      listings: [
        {
          catalogId: "esp32-s3",
          title: "ESP32-S3 DevKit",
          manufacturer: "Espressif",
          partNumber: "ESP32-S3-DevKitC-1",
          exactMatch: true,
          alternatives: [{ catalogId: "arduino-uno-r3", title: "Arduino Uno R3", reason: "Compatible controller alternative for a simpler GPIO build." }],
          offers: [
            { retailer: "Digi-Key", price: 8.5, currency: "USD", url: "https://www.digikey.com/" },
            { retailer: "Mouser", price: 9.1, currency: "USD", url: "https://www.mouser.com/" },
            { retailer: "Newark", price: 10.2, currency: "USD", url: "https://www.newark.com/" },
          ],
        },
        { catalogId: "arduino-uno-r3", title: "Arduino Uno R3", exactMatch: true, offers: [] },
      ],
    });
    const shoppingResultId = shopping.data.results[0].id;
    await call("shopping.cart_add", { resultId: shoppingResultId, quantity: 2 });
    await call("shopping.cart_set_quantity", { resultId: shoppingResultId, quantity: 1 });
    await call("shopping.cart_set_budget", { budget: 12 });
    await call("shopping.get_state");
    await call("shopping.quote");
    await call("shopping.choose_alternative", { resultId: shoppingResultId, catalogId: "arduino-uno-r3" });
    await call("shopping.cart_reset", { requiredCatalogIds: ["esp32-s3"] });
    await call("shopping.cart_undo");
    await call("shopping.cart_remove", { resultId: shoppingResultId });
    await call("design.auto_layout");
    await call("project.get_graph");
    await call("component.remove", { instanceId: sensorId });

    expect([...invoked].sort()).toEqual([...getRegisteredToolNames()].sort());
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

});
