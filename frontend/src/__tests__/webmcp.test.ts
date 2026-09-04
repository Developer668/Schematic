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
import { getAuthSession } from "../auth/session.ts";
import { ensureWebMCPRegistration, fetchJson, getRegisteredToolNames, inspectNativeWebMCPRegistration, invokeWebMCPTool, registerWebMCPTools, unregisterWebMCPTools, WEBMCP_TOOL_COUNT } from "../webmcp/tools.ts";

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
  beforeEach(async () => {
    // Settle the one-time auth/session event before installing each fixture.
    // Otherwise a background WebMCP auth warm-up can fire schematic-session
    // after a blueprint mutation and reload an older localStorage room between
    // project.apply_blueprint and validation.check.
    localStorage.clear();
    await getAuthSession();
    useProjectStore.getState().clear();
    const cleanProject = useProjectStore.getState().project;
    useProjectStore.setState({ project: cleanProject, projects: [cleanProject], activeProjectId: cleanProject.id });
    useShoppingStore.getState().clearResults();
    useValidationStore.getState().clear();
  });

  afterEach(() => {
    unregisterWebMCPTools();
    vi.unstubAllGlobals();
    delete (document as any).modelContext;
    delete (navigator as any).modelContext;
    delete (navigator as any).modelContextTesting;
  });

  it("registers the complete behavior/code tool surface without retired runtime names", () => {
    const names = getRegisteredToolNames();
    expect(names.length).toBe(WEBMCP_TOOL_COUNT);
    expect(WEBMCP_TOOL_COUNT).toBe(56);
    expect(names).toEqual(expect.arrayContaining([
      "behavior.get_capabilities", "behavior.plan.write", "behavior.preview", "behavior.invoke",
      "behavior.get_state", "code.write", "code.read", "code.export",
      "project.get_graph", "component.search", "connection.connect", "validation.check",
    ]));
    expect(names.some((name) => name.startsWith("simulation."))).toBe(false);
    expect(names).not.toContain("firmware.compile");
  });

  it("publishes the complete explicit fallback bridge", async () => {
    const tools: any = (globalThis as any).window?.__schematicTools ?? (globalThis as any).__schematicTools;
    if (!tools) await registerWebMCPTools();
    const fallback = (globalThis as any).__schematicTools ?? (globalThis as any).window?.__schematicTools;
    const bridge = (globalThis as any).window?.schematicWebMCP;
    expect(fallback ?? {}).toBeDefined();
    expect(bridge.tools).toBeInstanceOf(Map);
    expect(bridge.tools.size).toBe(WEBMCP_TOOL_COUNT);
    expect(bridge.invoke).toBeTypeOf("function");
    expect(bridge.getStatus()).toMatchObject({ mode: "bridge", native: false, nativeProof: false });
    expect((document as any).modelContext).toBeUndefined();
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

  it("keeps fallback Outcome ready during model assembly but prefers an explicit model-authored plan", async () => {
    const led: any = await invokeWebMCPTool("component.add", { componentId: "led" });
    expect(led.isError).not.toBe(true);
    expect(led.data.behaviorSetup).toMatchObject({ ready: true, status: "ready", previewStarted: false });
    expect(useProjectStore.getState().project.behaviorPlans?.some((plan) => plan.id === "starter-behavior-plan")).toBe(true);

    const project = useProjectStore.getState().project;
    const authoredPlan = {
      schemaVersion: 1,
      id: "model-authored-outcome",
      projectId: project.id,
      name: "Model-authored outcome",
      revision: 1,
      rules: [{
        id: "model-led-on",
        enabled: true,
        when: { type: "preview.started" },
        then: [{
          componentId: led.data.instanceId,
          definitionId: "led",
          actionId: "indicator.set",
          payload: { kind: "literal", value: { on: true } },
        }],
      }],
    };
    const written: any = await invokeWebMCPTool("behavior.plan.write", { plan: authoredPlan, expectedRevision: null });
    expect(written.isError).not.toBe(true);
    expect(useProjectStore.getState().getBehaviorPlan()?.id).toBe(authoredPlan.id);

    const preview: any = await invokeWebMCPTool("behavior.preview", {});
    expect(preview.isError).not.toBe(true);
    expect(preview.data.planId).toBe(authoredPlan.id);
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
    const validationResult: any = await invokeWebMCPTool("validation.check");
    expect(validationResult.isError).not.toBe(true);
    const validationErrors = validationResult.data.issues.filter((issue: any) => issue.severity === "error");
    expect(
      validationResult.data.valid,
      `validation.check rejected project ${useProjectStore.getState().project.id}: ${JSON.stringify(validationErrors)}`,
    ).toBe(true);
    expect(validationErrors).toEqual([]);
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

    expect(WEBMCP_TOOL_COUNT).toBe(56);
    expect(registerTool).toHaveBeenCalledTimes(WEBMCP_TOOL_COUNT);
    expect(registerTool).toHaveBeenCalledTimes(getRegisteredToolNames().length);
    const calls = registerTool.mock.calls as any[];
    expect(calls.map(([definition]) => definition.name)).toEqual(getRegisteredToolNames());
    for (const [definition, options] of calls) {
      expect(definition).toBe((window as any).schematicWebMCP.tools.get(definition.name));
      expect(definition.execute).toBeTypeOf("function");
      expect(definition.inputSchema.type).toBe("object");
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
    expect((window as any).schematicWebMCP.getStatus()).toMatchObject({ mode: "native+bridge", native: true });
    const definitions = new Map(calls.map(([definition]) => [definition.name, definition]));
    const shoppingNames = getRegisteredToolNames().filter((name) => name.startsWith("shopping."));
    expect(shoppingNames).toHaveLength(10);
    for (const name of shoppingNames) expect(definitions.get(name).annotations?.untrustedContentHint).toBe(true);
    expect(definitions.get("shopping.get_state").annotations?.readOnlyHint).toBe(true);
    expect(definitions.get("shopping.quote").annotations?.readOnlyHint).toBe(true);
    expect(definitions.get("project.delete").annotations?.consequentialHint).toBe(true);
    expect(definitions.get("project.clear").annotations?.consequentialHint).toBe(true);
    expect(definitions.get("behavior.plan.write").inputSchema.required).toEqual(["plan", "expectedRevision"]);
  });

  it("deduplicates Site-shell and SPA bootstrap into one native registration lease", async () => {
    const resolvers: Array<() => void> = [];
    const registerTool = vi.fn(() => new Promise<void>((resolve) => resolvers.push(resolve)));
    (document as any).modelContext = { registerTool };

    const siteShell = ensureWebMCPRegistration();
    const spa = ensureWebMCPRegistration();
    await vi.waitFor(() => expect(registerTool).toHaveBeenCalledTimes(WEBMCP_TOOL_COUNT));
    expect(registerTool).toHaveBeenCalledTimes(WEBMCP_TOOL_COUNT);
    for (const resolve of resolvers) resolve();
    await Promise.all([siteShell, spa]);

    expect(useWebMCPStore.getState().registration).toMatchObject({
      state: "native",
      registeredCount: WEBMCP_TOOL_COUNT,
    });
  });

  it("re-registers when the host replaces the native modelContext object", async () => {
    const firstRegisterTool = vi.fn(async () => undefined);
    (document as any).modelContext = { registerTool: firstRegisterTool };
    await ensureWebMCPRegistration();
    expect(firstRegisterTool).toHaveBeenCalledTimes(WEBMCP_TOOL_COUNT);

    const secondRegisterTool = vi.fn(async () => undefined);
    (document as any).modelContext = { registerTool: secondRegisterTool };
    await ensureWebMCPRegistration();

    expect(secondRegisterTool).toHaveBeenCalledTimes(WEBMCP_TOOL_COUNT);
    expect(useWebMCPStore.getState().registration).toMatchObject({ state: "native", registeredCount: WEBMCP_TOOL_COUNT });
  });

  it("proves the complete registry by enumerating native document.modelContext tools", async () => {
    const registered: any[] = [];
    const modelContext = {
      registerTool: vi.fn(async (definition: any) => {
        registered.push({ ...definition, origin: "https://schematic.example" });
      }),
      getTools: vi.fn(async () => registered),
    };
    (document as any).modelContext = modelContext;

    await ensureWebMCPRegistration();
    const proof = await inspectNativeWebMCPRegistration();

    expect(modelContext.registerTool).toHaveBeenCalledTimes(WEBMCP_TOOL_COUNT);
    expect(modelContext.getTools).toHaveBeenCalled();
    expect(proof).toMatchObject({ native: true, verified: true, discoveredCount: WEBMCP_TOOL_COUNT });
    expect(proof.toolNames).toEqual(expect.arrayContaining(getRegisteredToolNames()));
  });

  it("submits the complete native registry before awaiting registration promises", async () => {
    const resolvers: Array<() => void> = [];
    const registerTool = vi.fn(() => new Promise<void>((resolve) => resolvers.push(resolve)));
    (document as any).modelContext = { registerTool };

    const pending = registerWebMCPTools();
    await vi.waitFor(() => expect(registerTool).toHaveBeenCalledTimes(WEBMCP_TOOL_COUNT));
    expect(resolvers).toHaveLength(WEBMCP_TOOL_COUNT);
    for (const resolve of resolvers) resolve();
    await pending;

    expect(useWebMCPStore.getState().registration).toMatchObject({
      state: "native",
      registeredCount: WEBMCP_TOOL_COUNT,
    });
  });

  it("uses navigator.modelContext when document.modelContext is present but incomplete", async () => {
    const registerTool = vi.fn(async () => undefined);
    (document as any).modelContext = {};
    (navigator as any).modelContext = { registerTool };

    await registerWebMCPTools();

    expect(registerTool).toHaveBeenCalledTimes(WEBMCP_TOOL_COUNT);
    expect(useWebMCPStore.getState().registration).toMatchObject({
      state: "native",
      registeredCount: WEBMCP_TOOL_COUNT,
      declaredCount: WEBMCP_TOOL_COUNT,
    });
  });

  it("leaves a host-owned modelContextTesting surface untouched when native WebMCP exists", async () => {
    const registerTool = vi.fn(async () => undefined);
    const hostTestingSurface = { hostOwned: true };
    Object.defineProperty(navigator, "modelContextTesting", { configurable: true, value: hostTestingSurface });
    (document as any).modelContext = { registerTool };

    await registerWebMCPTools();

    expect(registerTool).toHaveBeenCalledTimes(WEBMCP_TOOL_COUNT);
    expect((navigator as any).modelContextTesting).toBe(hostTestingSurface);
  });

  it("does not fake native WebMCP when the browser does not expose it", async () => {
    delete (document as any).modelContext;
    delete (navigator as any).modelContext;

    await registerWebMCPTools();

    expect((document as any).modelContext).toBeUndefined();
    expect((navigator as any).modelContext).toBeUndefined();
    expect((navigator as any).modelContextTesting?.listTools).toBeTypeOf("function");
    expect((window as any).schematicWebMCP.tools.size).toBe(WEBMCP_TOOL_COUNT);
    expect((window as any).__schematicWebMCP.proof).toBe("direct-call-bridge-not-native-webmcp");
    expect(useWebMCPStore.getState().registration).toMatchObject({
      state: "fallback",
      registeredCount: 0,
      declaredCount: WEBMCP_TOOL_COUNT,
      discoveredCount: 0,
      discovery: "unavailable",
    });
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

  it("executes every registered tool, including the typed Behavior Plan and editable code flow", async () => {
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

    // The high-level collaboration/state-aware additions are exercised by the
    // dedicated calculator journey. This legacy exhaustive flow must continue
    // to cover every pre-existing primitive tool without becoming coupled to
    // the recommended goal-level surface.
    expect(getRegisteredToolNames()).toEqual(expect.arrayContaining([...invoked]));
    expect(invoked.size).toBeGreaterThanOrEqual(45);
  });
});
