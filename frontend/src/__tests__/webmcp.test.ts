import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useProjectStore } from "../store/useProjectStore.ts";
import { useWorkspaceStore } from "../store/useWorkspaceStore.ts";
import { useValidationStore } from "../store/useValidationStore.ts";
import { useWebMCPStore } from "../store/useWebMCPStore.ts";
import { useShoppingStore } from "../store/useShoppingStore.ts";
import { getCatalogComponent } from "../data/catalog.ts";
import { resolveBoardPin } from "../data/hardware.ts";
import { fetchJson, getRegisteredToolNames, invokeWebMCPTool, registerWebMCPTools, unregisterWebMCPTools, WEBMCP_TOOL_COUNT } from "../webmcp/tools.ts";

const AGENT_PUBLICATION = {
  authenticated: true as const,
  agentId: "webmcp:local:local-development",
  provider: "Digi-Key",
  publishedAt: new Date().toISOString(),
};

function validAgentListing(catalogId: string, overrides: Record<string, unknown> = {}) {
  const isEsp32 = catalogId === "esp32-s3";
  const title = isEsp32 ? "ESP32-S3 DevKit" : catalogId === "arduino-uno-r3" ? "Arduino Uno R3" : "LED";
  const partNumber = isEsp32 ? "ESP32-S3-DevKitC-1" : catalogId === "arduino-uno-r3" ? "A000066" : "LED-5MM";
  const prices = isEsp32 ? [8.5, 9.1, 10.2] : [22];
  return {
    id: `listing-${catalogId}`,
    catalogId,
    title,
    manufacturer: isEsp32 ? "Espressif" : undefined,
    partNumber,
    requestedQuantity: 1,
    exactMatch: true,
    offers: prices.map((price, index) => ({
      id: `offer-${catalogId}-${index}`,
      retailer: ["Digi-Key", "Mouser", "Newark"][index] ?? "Digi-Key",
      title,
      price,
      currency: "USD",
      url: `https://example.com/${catalogId}/${index}`,
      fetchedAt: AGENT_PUBLICATION.publishedAt,
      provider: AGENT_PUBLICATION.provider,
    })),
    alternatives: [],
    updatedAt: AGENT_PUBLICATION.publishedAt,
    provenance: { source: "webmcp-agent" as const, provider: AGENT_PUBLICATION.provider, agentId: AGENT_PUBLICATION.agentId, publishedAt: AGENT_PUBLICATION.publishedAt },
    ...overrides,
  };
}

describe("WebMCP tools", () => {
  beforeEach(() => {
    useProjectStore.getState().clear();
    useShoppingStore.getState().clearResults();
    useValidationStore.getState().clear();
  });

  afterEach(() => {
    unregisterWebMCPTools();
    vi.unstubAllGlobals();
    delete (document as any).modelContext;
  });

  it("exposes a focused native studio tool surface", () => {
    const names = getRegisteredToolNames();
    expect(names.length).toBe(WEBMCP_TOOL_COUNT);
    expect(WEBMCP_TOOL_COUNT).toBe(12);
    expect(names).toEqual(expect.arrayContaining([
      "project.get_graph", "project.apply_blueprint", "component.search", "component.inspect",
      "component.add", "component.list_ports", "connection.connect", "design.auto_layout",
      "firmware.write", "validation.check", "code.export",
    ]));
    expect(names.some((name) => name.startsWith("simulation."))).toBe(false);
    expect(names).not.toContain("firmware.compile");
  });

  it("does not fabricate WebMCP APIs or callback globals", async () => {
    delete (document as any).modelContext;
    delete (navigator as any).modelContextTesting;
    await registerWebMCPTools();
    expect((document as any).modelContext).toBeUndefined();
    expect((navigator as any).modelContextTesting).toBeUndefined();
    expect((window as any).__schematicTools).toBeUndefined();
    expect((window as any).__schematicWebMCP).toBeUndefined();
    expect(useWebMCPStore.getState().registration.state).toBe("unavailable");
  });

  it("add_component via store works", () => {
    const { addComponent } = useProjectStore.getState();
    const { id } = addComponent("esp32-s3");
    expect(id).toContain("esp32-s3");
    expect(useProjectStore.getState().project.components).toHaveLength(1);
  });

  it("keeps project.get_graph source-blind and requires code.read for file contents", async () => {
    const board = useProjectStore.getState().addComponent("arduino-uno");
    const source = "void setup() { /* explicit source boundary */ }";
    const written = await invokeWebMCPTool("code.write", {
      targetComponentId: board.id,
      language: "arduino",
      files: [{ name: "sketch.ino", content: source }],
      expectedContentSha256: null,
    });
    expect(written.isError).not.toBe(true);
    const current = useProjectStore.getState().project;
    useProjectStore.setState({
      project: { ...current, legacyBehaviorData: { privateLegacyText: "must-never-leave-project-room" } },
      projects: [{ ...current, legacyBehaviorData: { privateLegacyText: "must-never-leave-project-room" } }],
    });

    const graphResult = await invokeWebMCPTool("project.get_graph", {});
    const serializedGraph = JSON.stringify(graphResult.data);
    expect(serializedGraph).not.toContain(source);
    expect(serializedGraph).not.toContain("must-never-leave-project-room");
    expect(graphResult.data.codeDocuments[0].files).toEqual([{ name: "sketch.ino", byteLength: new TextEncoder().encode(source).byteLength }]);
    expect(graphResult.data.sourceAccess).toContain("code.read");

    const sourceResult = await invokeWebMCPTool("code.read", { targetComponentId: board.id });
    expect(sourceResult.data.document.files[0].content).toBe(source);
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

  it("requires destructive project tools to confirm the exact target id", async () => {
    const source = useProjectStore.getState().project;
    const secondId = useProjectStore.getState().createProject("Destructive target");
    useProjectStore.getState().addComponent("led");

    const wrongDelete: any = await invokeWebMCPTool("project.delete", { projectId: source.id, confirmProjectId: secondId });
    expect(wrongDelete.isError).toBe(true);
    expect(wrongDelete.data.code).toBe("CONFIRMATION_REQUIRED");
    expect(useProjectStore.getState().projects.some((project) => project.id === source.id)).toBe(true);

    const wrongClear: any = await invokeWebMCPTool("project.clear", { projectId: source.id, confirmProjectId: source.id });
    expect(wrongClear.isError).toBe(true);
    expect(useProjectStore.getState().project.components).toHaveLength(1);

    const cleared: any = await invokeWebMCPTool("project.clear", { projectId: secondId, confirmProjectId: secondId });
    expect(cleared.isError).not.toBe(true);
    expect(useProjectStore.getState().project.components).toHaveLength(0);
  });

  it("creates blueprints in a new project by default and requires exact replacement confirmation", async () => {
    const original = useProjectStore.getState().project;
    const originalId = original.id;
    useProjectStore.getState().addComponent("led");

    const created: any = await invokeWebMCPTool("project.apply_blueprint", { blueprintId: "meta-glasses" });
    expect(created.isError).not.toBe(true);
    expect(created.data.replaced).toBe(false);
    expect(created.data.projectId).not.toBe(originalId);
    expect(useProjectStore.getState().activeProjectId).toBe(created.data.projectId);
    expect(useProjectStore.getState().projects.find((project) => project.id === originalId)?.components).toHaveLength(1);

    const replacementId = useProjectStore.getState().activeProjectId;
    const beforeFailedReplacement = useProjectStore.getState().project;
    const rejected: any = await invokeWebMCPTool("project.apply_blueprint", {
      blueprintId: "meta-glasses",
      replace: true,
      confirmProjectId: originalId,
    });
    expect(rejected.isError).toBe(true);
    expect(rejected.data.code).toBe("CONFIRMATION_REQUIRED");
    expect(useProjectStore.getState().activeProjectId).toBe(replacementId);
    expect(useProjectStore.getState().project.updatedAt).toBe(beforeFailedReplacement.updatedAt);

    const replaced: any = await invokeWebMCPTool("project.apply_blueprint", {
      blueprintId: "meta-glasses",
      replace: true,
      confirmProjectId: replacementId,
    });
    expect(replaced.isError).not.toBe(true);
    expect(replaced.data.replaced).toBe(true);
    expect(replaced.data.projectId).toBe(replacementId);
    expect(useProjectStore.getState().activeProjectId).toBe(replacementId);

    // Do not leave this test's extra project in the shared in-memory store.
    useProjectStore.getState().switchProject(originalId);
    expect(useProjectStore.getState().deleteProject(replacementId)).toBe(true);
  });

  it("rejects malformed behavior invokes and destructive component/connection calls", async () => {
    const malformed: any = await invokeWebMCPTool("behavior.invoke", {
      componentId: "led-1",
      definitionId: "led",
      eventId: "button.pressed",
      payload: { pressed: true },
      unexpected: true,
    });
    expect(malformed.isError).toBe(true);
    expect(malformed.data.code).toBe("INVALID_BEHAVIOR_REQUEST");

    const missingPayload: any = await invokeWebMCPTool("behavior.invoke", {
      componentId: "led-1",
      definitionId: "led",
      eventId: "button.pressed",
    });
    expect(missingPayload.isError).toBe(true);
    expect(missingPayload.data.code).toBe("INVALID_BEHAVIOR_REQUEST");

    const led: any = await invokeWebMCPTool("component.add", { componentId: "led" });
    const instanceId = led.data.instanceId;
    const wrongRemove: any = await invokeWebMCPTool("component.remove", { instanceId, confirmInstanceId: "different-id" });
    expect(wrongRemove.isError).toBe(true);
    expect(wrongRemove.data.code).toBe("CONFIRMATION_REQUIRED");
    expect(useProjectStore.getState().project.components.some((component) => component.id === instanceId)).toBe(true);

    const board: any = await invokeWebMCPTool("component.add", { componentId: "esp32-s3" });
    const sensor: any = await invokeWebMCPTool("component.add", { componentId: "bmp280" });
    const connection: any = await invokeWebMCPTool("connection.connect", {
      sourceComponentId: board.data.instanceId,
      sourcePortId: "SDA",
      targetComponentId: sensor.data.instanceId,
      targetPortId: "SDA",
    });
    expect(connection.isError).not.toBe(true);
    const wrongDisconnect: any = await invokeWebMCPTool("connection.disconnect", {
      connectionId: connection.data.connectionId,
      confirmConnectionId: "different-id",
    });
    expect(wrongDisconnect.isError).toBe(true);
    expect(wrongDisconnect.data.code).toBe("CONFIRMATION_REQUIRED");
    expect(useProjectStore.getState().project.connections.some((item) => item.id === connection.data.connectionId)).toBe(true);
  });

  it("executes the real component lifecycle through WebMCP callbacks", async () => {
    const search: any = await invokeWebMCPTool("component.search", { query: "bmp280" });
    expect(search.data.some((definition: any) => definition.id === "bmp280")).toBe(true);

    const added: any = await invokeWebMCPTool("component.add", { componentId: "bmp280", x: 160, y: 96 });
    const instanceId = added.data.instanceId;
    expect(useProjectStore.getState().project.components.find((item) => item.id === instanceId)?.position).toEqual({ x: 160, y: 96 });

    await invokeWebMCPTool("component.remove", { instanceId, confirmInstanceId: instanceId });
    expect(useProjectStore.getState().project.components).toHaveLength(0);
  });

  it("uses safe automatic placement and rejects malformed WebMCP coordinates", async () => {
    const first: any = await invokeWebMCPTool("component.add", { componentId: "esp32-devkit-v1" });
    const second: any = await invokeWebMCPTool("component.add", { componentId: "led" });
    expect(first.isError).not.toBe(true);
    expect(second.isError).not.toBe(true);
    expect(first.data.position).toEqual({ x: 80, y: 80 });
    expect(second.data.position).toEqual({ x: 440, y: 80 });

    const partial: any = await invokeWebMCPTool("component.add", { componentId: "pushbutton", x: 100 });
    expect(partial.isError).toBe(true);
    expect(partial.content[0].text).toMatch(/provided together/i);

    const nullCoordinates: any = await invokeWebMCPTool("component.add", { componentId: "pushbutton", x: null, y: null });
    expect(nullCoordinates.isError).toBe(true);
    expect(nullCoordinates.content[0].text).toMatch(/finite numbers/i);

    const stringCoordinates: any = await invokeWebMCPTool("component.add", { componentId: "pushbutton", x: "0", y: "0" });
    expect(stringCoordinates.isError).toBe(true);

    const explicit: any = await invokeWebMCPTool("component.add", { componentId: "pushbutton", x: 0, y: 0 });
    expect(explicit.isError).not.toBe(true);
    expect(explicit.data.position).toEqual({ x: 0, y: 0 });
  });

  it("keeps agent activity, panels, and diagnostics live", async () => {
    useWebMCPStore.getState().clearActivities();
    await invokeWebMCPTool("project.apply_blueprint", { blueprintId: "meta-glasses" });
    const blueprintGraph = useProjectStore.getState().project;
    expect(blueprintGraph.connections.find((connection) => connection.id === "c12")?.source.portId).toBe("GPIO4");
    expect(blueprintGraph.connections.find((connection) => connection.id === "c18")?.source.portId).toBe("GPIO18");
    expect(blueprintGraph.connections.find((connection) => connection.id === "c14")?.source.portId).toBe("GPIO1");
    expect(getCatalogComponent("esp32-s3")?.ports.find((port) => port.id === "GPIO1")).toMatchObject({ domain: "adc", description: expect.stringContaining("ADC1") });
    expect(getCatalogComponent("esp32-s3")?.ports.some((port) => port.id === "ADC1_CH0")).toBe(false);
    expect(resolveBoardPin(blueprintGraph, "compute-1", "1", new Map())).toEqual({ componentId: "compute-1", portId: "GPIO1" });
    await invokeWebMCPTool("validation.check");
    await invokeWebMCPTool("workspace.set_panel", { panel: "validation" });

    expect(blueprintGraph.components).toHaveLength(10);
    expect(useValidationStore.getState().valid).toBe(true);
    expect(useWorkspaceStore.getState().bottomPanel).toBe("validation");
    expect(useWorkspaceStore.getState().bottomCollapsed).toBe(false);
    expect(useWebMCPStore.getState().activities.map((item) => item.name)).toEqual(expect.arrayContaining([
      "project.apply_blueprint", "validation.check", "workspace.set_panel",
    ]));
  });

  it("keeps validation.check graph-only when editable source is malformed", async () => {
    const base = useProjectStore.getState().project;
    const cleanProject = {
      ...base,
      components: [{ id: "board-1", definitionId: "arduino-uno-r3", position: { x: 0, y: 0 }, rotation: 0, properties: {} }],
      connections: [],
      firmwareTargets: [{
        id: "firmware-1",
        componentId: "board-1",
        definitionId: "arduino-uno-r3",
        language: "arduino",
        boardFqbn: "arduino:avr:uno",
        files: [{ name: "sketch.ino", content: "void setup() {}\nvoid loop() {}" }],
      }],
    };
    useProjectStore.setState({ project: cleanProject, projects: [cleanProject], activeProjectId: cleanProject.id });
    const cleanResult: any = await invokeWebMCPTool("validation.check");

    const malformedProject = {
      ...cleanProject,
      firmwareTargets: cleanProject.firmwareTargets.map((target) => ({
        ...target,
        files: [{ ...target.files[0], content: "}\n// missing setup and loop" }],
      })),
    };
    useProjectStore.setState({ project: malformedProject, projects: [malformedProject], activeProjectId: malformedProject.id });
    const malformedResult: any = await invokeWebMCPTool("validation.check");

    expect(malformedResult.isError).not.toBe(true);
    expect(malformedResult.data).toEqual(cleanResult.data);
    expect(malformedResult.data.codeIssues).toEqual([]);
  });

  it("registers every tool with the native WebMCP surface", async () => {
    const registerTool = vi.fn(async () => undefined);
    (document as any).modelContext = { registerTool };
    await registerWebMCPTools();

    expect(WEBMCP_TOOL_COUNT).toBe(12);
    expect(registerTool).toHaveBeenCalledTimes(12);
    expect(registerTool).toHaveBeenCalledTimes(getRegisteredToolNames().length);
    const calls = registerTool.mock.calls as any[];
    expect(calls.map(([definition]) => definition.name)).toEqual(getRegisteredToolNames());
    for (const [definition, options] of calls) {
      expect(definition.execute).toBeTypeOf("function");
      expect(definition.inputSchema.type).toBe("object");
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
    const definitions = new Map(calls.map(([definition]) => [definition.name, definition]));
    expect(definitions.get("project.get_graph").annotations?.readOnlyHint).toBe(true);
    expect(definitions.get("component.search").annotations?.readOnlyHint).toBe(true);
    expect(definitions.get("project.apply_blueprint")).toBeDefined();
  });

  it("does not expose an inbound postMessage mutation bridge", () => {
    const source = readFileSync(resolve(process.cwd(), "src/webmcp/tools.ts"), "utf8");
    expect(source).not.toMatch(/(?:window|globalThis)\.(?:addEventListener|onmessage)\s*\(\s*["']message["']/);
    expect(source).not.toMatch(/window\.postMessage\s*\(/);
  });

  it("passes AbortSignal to fetch and rejects when the request is aborted", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/api/auth/session")) {
        return Promise.resolve(new Response(JSON.stringify({ authenticated: false }), { status: 200, headers: { "content-type": "application/json" } }));
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = fetchJson("/api/parts/search", { method: "POST", body: "{}", signal: controller.signal });
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/parts/search"))).toBe(true));
    const targetCall = fetchMock.mock.calls.find(([input]) => String(input).includes("/api/parts/search"));
    expect(targetCall?.[1]?.signal).toBe(controller.signal);

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("returns an applied mutation when cancellation arrives after commit", async () => {
    const state = useProjectStore.getState();
    state.addComponent("led");
    const projectId = useProjectStore.getState().project.id;
    const controller = new AbortController();

    const pending = invokeWebMCPTool("project.clear", { projectId, confirmProjectId: projectId }, controller.signal);
    queueMicrotask(() => controller.abort());
    const result: any = await pending;

    expect(result.isError).not.toBe(true);
    expect(useProjectStore.getState().project.components).toHaveLength(0);
  });

  it("keeps internal domain commands working behind the focused native surface", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: "ok" }) }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    const invoked = new Set<string>();
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      invoked.add(name);
      const result = await invokeWebMCPTool(name, args);
      expect(result?.isError).not.toBe(true);
      return result;
    };

    const initialProjectId = useProjectStore.getState().activeProjectId;
    await call("project.clear", { projectId: initialProjectId, confirmProjectId: initialProjectId });
    await call("project.list");
    const createdProject = await call("project.create", { name: "Scratch hardware" });
    const duplicateProject = await call("project.duplicate");
    await call("project.switch", { projectId: createdProject.data.projectId });
    await call("project.save");
    await call("project.delete", { projectId: duplicateProject.data.projectId, confirmProjectId: duplicateProject.data.projectId });
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
    const button = await call("component.add", { componentId: "pushbutton", x: 610, y: 20 });
    const led = await call("component.add", { componentId: "led", x: 910, y: 20 });
    const boardId = board.data.instanceId;
    const sensorId = sensor.data.instanceId;
    const buttonId = button.data.instanceId;
    const ledId = led.data.instanceId;
    await call("component.list_ports", { componentId: boardId });
    const connection = await call("connection.connect", { sourceComponentId: boardId, sourcePortId: "SDA", targetComponentId: sensorId, targetPortId: "SDA" });
    await call("connection.get_connections");
    await call("connection.disconnect", { connectionId: connection.data.connectionId, confirmConnectionId: connection.data.connectionId });
    await call("behavior.get_capabilities");
    const behaviorPlan = {
      schemaVersion: 1,
      id: "button-led-preview",
      projectId: useProjectStore.getState().project.id,
      name: "Button LED preview",
      revision: 1,
      rules: [{
        id: "press-led",
        enabled: true,
        when: { type: "component.event", componentId: buttonId, definitionId: "pushbutton", eventId: "button.pressed" },
        then: [{ componentId: ledId, definitionId: "led", actionId: "indicator.set", payload: { kind: "literal", value: { on: true } } }],
      }],
    };
    await call("behavior.plan.write", { plan: behaviorPlan, expectedRevision: null });
    await call("behavior.preview", { planId: behaviorPlan.id });
    const invocation = await call("behavior.invoke", { componentId: buttonId, definitionId: "pushbutton", eventId: "button.pressed", payload: { pressed: true } });
    expect(invocation.data.snapshot.components[ledId].primitives[0]).toMatchObject({ kind: "indicator", on: true });
    await call("behavior.get_state");
    const codeWrite = await call("code.write", { targetComponentId: boardId, language: "arduino", files: [{ name: "sketch.ino", content: "void setup(){} void loop(){}" }], expectedContentSha256: null });
    await call("code.read", { targetComponentId: boardId });
    await call("code.export", { targetComponentId: boardId });
    await call("firmware.write", { componentId: boardId, files: [{ name: "sketch.ino", content: "void setup(){} void loop(){}" }], expectedContentSha256: codeWrite.data.document.contentSha256 });
    await call("firmware.read", { componentId: boardId });
    await call("firmware.check", { componentId: boardId });
    await call("validation.check");
    await call("validation.explain_error", { code: "MISSING_GROUND" });
    const shopping = await call("shopping.search", {
      query: "esp32",
      quantity: 2,
      publication: AGENT_PUBLICATION,
      listings: [validAgentListing("esp32-s3", { alternatives: [{ catalogId: "arduino-uno-r3", title: "Arduino Uno R3", reason: "Compatible controller alternative for a simpler GPIO build.", resultId: "listing-arduino-uno-r3" }] }), validAgentListing("arduino-uno-r3")],
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
    await call("shopping.cart_remove", { resultId: useShoppingStore.getState().cart[0]?.resultId });
    await call("design.auto_layout");
    await call("project.get_graph");
    await call("component.remove", { instanceId: sensorId, confirmInstanceId: sensorId });

    expect([...getRegisteredToolNames()].every((name) => invoked.has(name))).toBe(true);
  });
});
