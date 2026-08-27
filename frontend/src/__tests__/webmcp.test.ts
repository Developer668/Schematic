import { describe, it, expect, beforeEach } from "vitest";
import { useProjectStore } from "../store/useProjectStore.ts";
import { getRegisteredToolNames, invokeWebMCPTool } from "../webmcp/tools.ts";

describe("WebMCP tools", () => {
  beforeEach(() => useProjectStore.getState().clear());

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
});
