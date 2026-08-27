/**
 * WebMCP tool surface — ~18 semantic hardware tools via document.modelContext.registerTool
 * Per HardwareWebMCP.md: don't expose 100 tiny tools, expose powerful semantic ones.
 * Human click and AI call share same underlying Zustand functions.
 */
import { useProjectStore, type HardwareGraph } from "../store/useProjectStore.ts";
import { useSimulationStore } from "../store/useSimulationStore.ts";
import { useSelectionStore } from "../store/useSelectionStore.ts";
import { useWorkspaceStore, type BottomPanel } from "../store/useWorkspaceStore.ts";
import { useValidationStore, validateFirmwareFiles, validateProject } from "../store/useValidationStore.ts";
import { useWebMCPStore } from "../store/useWebMCPStore.ts";
import { useShoppingStore, type PartOffer, type ShoppingResult } from "../store/useShoppingStore.ts";
import { runFirmwareRuntime } from "../simulation/runtime.ts";
import { catalog, searchCatalog } from "../data/catalog.ts";
import metaGlassesBlueprint from "../../../examples/demo4-meta-glasses/project.json";

type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: any) => Promise<any>;
  annotations?: { readOnlyHint?: boolean };
};

type ApiJsonResult = {
  response: Response | null;
  data: any;
  available: boolean;
  error?: string;
};

const BLUEPRINTS: Record<string, unknown> = { "meta-glasses": metaGlassesBlueprint };

function cloneProject(source: unknown): HardwareGraph {
  return JSON.parse(JSON.stringify(source)) as HardwareGraph;
}

/**
 * Pages serves the SPA fallback for unknown /api routes. Read the body once
 * and identify that case before calling JSON.parse, so WebMCP gets a useful
 * result instead of "Unexpected end of JSON input".
 */
export async function fetchJson(path: string, init?: RequestInit): Promise<ApiJsonResult> {
  try {
    const response = await fetch(path, init);
    const responseText = typeof response.text === "function" ? await response.text() : null;

    if (responseText !== null) {
      if (!responseText.trim()) {
        return { response, data: null, available: false, error: `API ${path} returned an empty response` };
      }
      try {
        return { response, data: JSON.parse(responseText), available: true };
      } catch {
        return { response, data: null, available: false, error: `API ${path} returned non-JSON content` };
      }
    }

    // Lightweight fetch mocks and older WebViews may only expose response.json().
    return { response, data: await response.json(), available: true };
  } catch (e) {
    return { response: null, data: null, available: false, error: (e as Error).message };
  }
}

export function browserCompilePreflight(files: { name: string; content: string }[], boardFqbn: string) {
  const source = files.map((file) => file.content).join("\n");
  let depth = 0;
  for (const character of source) {
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
  }
  const balancedBraces = depth === 0;
  const hasSketchFile = files.some((file) => /\.ino$/i.test(file.name));
  return {
    success: false,
    available: false,
    mode: "browser-preflight",
    board_fqbn: boardFqbn,
    source_files: files.map((file) => file.name),
    preflight: { balanced_braces: balancedBraces, has_sketch_file: hasSketchFile },
    error: balancedBraces
      ? "Binary compilation is unavailable on this static deployment."
      : "Source preflight found unbalanced braces.",
    hint: balancedBraces
      ? "Connect the Schematic backend with arduino-cli to produce a firmware artifact."
      : "Fix the source syntax, then connect the Schematic backend for binary compilation.",
    simulation_ready: balancedBraces && hasSketchFile,
    browser_runtime: { available: balancedBraces && hasSketchFile, supports: ["setup", "loop", "digitalRead", "digitalWrite", "analogRead", "analogWrite", "delay", "Serial"] },
  };
}

function runBrowserSimulation(project: ReturnType<typeof useProjectStore.getState>["project"], inputs: Record<string, boolean | number>, durationMs: number) {
  const boundedDurationMs = Math.max(0, Math.min(Number.isFinite(durationMs) ? durationMs : 1000, 86_400_000));
  const runtime = runFirmwareRuntime(project, inputs, boundedDurationMs);
  const timeNs = BigInt(Math.round(boundedDurationMs * 1_000_000));
  const outputs = runtime.outputs;
  const simulation = useSimulationStore.getState();
  simulation.setTime(timeNs);
  for (const [portId, value] of Object.entries(outputs)) simulation.setPin(portId, value);
  simulation.setLastRun(runtime);
  const trace = runtime.events.slice(0, 8).map((event) => `${event.endpoint}=${event.value}`).join("  ");
  simulation.appendSerial(`[${project.name}] browser firmware runtime · t=${timeNs}ns${trace ? `  ${trace}` : ""}\n${runtime.serialOutput}`);
  simulation.stop();
  return {
    ...runtime,
    time_ns: timeNs.toString(),
    snapshot: runtime.outputs,
  };
}

const SHOPPING_RETAILERS = [
  { name: "Digi-Key", url: "https://www.digikey.com/en/products/result?keywords=" },
  { name: "Mouser", url: "https://www.mouser.com/c/?q=" },
  { name: "Newark", url: "https://www.newark.com/search?st=" },
];

function retailerSearchUrl(retailer: string, title: string, partNumber?: string) {
  const query = encodeURIComponent(partNumber ? `${partNumber} ${title}` : title);
  return SHOPPING_RETAILERS.find((item) => item.name.toLowerCase() === retailer.toLowerCase())?.url.concat(query) ?? `https://www.google.com/search?q=${query}+electronics`;
}

function fallbackShoppingResults(query: string, quantity: number, project: HardwareGraph): ShoppingResult[] {
  const base = query.trim() ? searchCatalog(query).slice(0, 12) : project.components.map((component) => catalog.find((definition) => definition.id === component.definitionId)).filter(Boolean).slice(0, 12) as typeof catalog;
  const requested = [...new Map([...base, ...base.flatMap((definition) => searchCatalog("", { category: definition.category }).filter((candidate) => candidate.id !== definition.id).slice(0, 2))].map((definition) => [definition.id, definition])).values()].slice(0, 24);
  return requested.map((definition) => {
    const partNumber = definition.partNumber ?? definition.id;
    const alternatives = searchCatalog("", { category: definition.category }).filter((candidate) => candidate.id !== definition.id).slice(0, 2).map((candidate) => ({
      catalogId: candidate.id,
      title: candidate.title,
      reason: candidate.category === definition.category ? "Same component role; verify footprint and electrical limits." : "Related catalog match; verify the interface before substituting.",
    }));
    return {
      id: `shopping-${definition.id}`,
      catalogId: definition.id,
      title: definition.title,
      manufacturer: definition.manufacturer,
      partNumber,
      requestedQuantity: quantity,
      exactMatch: Boolean(query.trim() && `${definition.id} ${definition.title} ${partNumber}`.toLowerCase().includes(query.trim().toLowerCase())),
      matchNote: "Catalog identity confirmed. Live offers are supplied by the shopping agent or connected parts provider.",
      offers: SHOPPING_RETAILERS.map((retailer) => ({
        id: `${definition.id}-${retailer.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        retailer: retailer.name,
        title: `${definition.title} · ${partNumber}`,
        price: null,
        currency: "USD",
        url: retailerSearchUrl(retailer.name, definition.title, partNumber),
        availability: "Live quote required",
        fetchedAt: new Date().toISOString(),
      })),
      alternatives,
      updatedAt: new Date().toISOString(),
    };
  });
}

function normalizeShoppingResults(raw: unknown, query: string, quantity: number): ShoppingResult[] {
  const entries = Array.isArray(raw) ? raw : [];
  return entries.slice(0, 24).map((entry, index) => {
    const item = entry && typeof entry === "object" ? entry as Record<string, any> : {};
    const catalogId = String(item.catalogId ?? item.componentId ?? item.id ?? `agent-part-${index + 1}`);
    const definition = catalog.find((candidate) => candidate.id === catalogId) ?? searchCatalog(String(item.title ?? item.partNumber ?? query))[0];
    const title = String(item.title ?? definition?.title ?? catalogId);
    const partNumber = item.partNumber ? String(item.partNumber) : definition?.partNumber ?? definition?.id;
    const rawOffers = Array.isArray(item.offers) ? item.offers : [];
    const offersByRetailer = new Map<string, PartOffer>();
    for (const rawOffer of rawOffers) {
      if (!rawOffer || typeof rawOffer !== "object") continue;
      const offer = rawOffer as Record<string, any>;
      const retailer = String(offer.retailer ?? offer.source ?? "").trim();
      if (!retailer || offersByRetailer.has(retailer) || offersByRetailer.size >= 3) continue;
      const parsedPrice = typeof offer.price === "number" ? offer.price : typeof offer.price === "string" && offer.price.trim() ? Number(offer.price) : null;
      offersByRetailer.set(retailer, {
        id: String(offer.id ?? `${catalogId}-${retailer.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`),
        retailer,
        title: String(offer.title ?? title),
        price: typeof parsedPrice === "number" && Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : null,
        currency: String(offer.currency ?? "USD"),
        url: String(offer.url ?? retailerSearchUrl(retailer, title, partNumber)),
        availability: offer.availability ? String(offer.availability) : undefined,
        fetchedAt: String(offer.fetchedAt ?? new Date().toISOString()),
      });
    }
    for (const retailer of SHOPPING_RETAILERS) {
      if (offersByRetailer.size >= 3 || [...offersByRetailer.keys()].some((name) => name.toLowerCase() === retailer.name.toLowerCase())) continue;
      offersByRetailer.set(retailer.name, {
        id: `${catalogId}-${retailer.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        retailer: retailer.name,
        title: `${title}${partNumber ? ` · ${partNumber}` : ""}`,
        price: null,
        currency: "USD",
        url: retailerSearchUrl(retailer.name, title, partNumber),
        availability: "Live quote required",
        fetchedAt: new Date().toISOString(),
      });
    }
    const alternatives = (Array.isArray(item.alternatives) ? item.alternatives : []).slice(0, 3).map((alternative: any) => ({
      catalogId: String(alternative.catalogId ?? alternative.id ?? ""),
      title: String(alternative.title ?? alternative.name ?? "Alternative part"),
      reason: String(alternative.reason ?? "Verify electrical limits and footprint before substituting."),
      resultId: alternative.resultId ? String(alternative.resultId) : undefined,
    })).filter((alternative: { catalogId: string }) => alternative.catalogId);
    return {
      id: String(item.resultId ?? `shopping-${catalogId}-${index}`),
      catalogId,
      title,
      manufacturer: item.manufacturer ? String(item.manufacturer) : definition?.manufacturer,
      partNumber,
      requestedQuantity: Math.max(1, Math.round(Number(item.requestedQuantity ?? quantity))),
      exactMatch: Boolean(definition) && item.exactMatch !== false,
      matchNote: item.matchNote ? String(item.matchNote) : definition ? "Agent listing normalized against the Schematic catalog." : "Agent listing could not be matched to the Schematic catalog; verify the exact part number before buying.",
      offers: [...offersByRetailer.values()],
      alternatives,
      updatedAt: String(item.updatedAt ?? new Date().toISOString()),
    };
  });
}

const tools: ToolDef[] = [
  {
    name: "project.get_graph",
    description: "Get the current hardware project graph (components, connections, firmware)",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const g = useProjectStore.getState().getGraph();
      return { content: [{ type: "text", text: JSON.stringify(g, null, 2) }], data: g };
    },
  },
  {
    name: "project.list",
    description: "List all projects saved in this browser and identify the active project",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const state = useProjectStore.getState();
      const projects = state.listProjects().map((project) => ({ id: project.id, name: project.name, components: project.components.length, connections: project.connections.length, firmwareTargets: project.firmwareTargets.length, updatedAt: project.updatedAt }));
      return { content: [{ type: "text", text: JSON.stringify({ activeProjectId: state.activeProjectId, projects }, null, 2) }], data: { activeProjectId: state.activeProjectId, projects } };
    },
  },
  {
    name: "project.create",
    description: "Create and activate a new empty hardware project saved in this browser",
    inputSchema: { type: "object", properties: { name: { type: "string" } } },
    execute: async ({ name }) => {
      const projectId = useProjectStore.getState().createProject(name ?? "Untitled");
      const created = useProjectStore.getState().project;
      return { content: [{ type: "text", text: `Created project ${created.name}` }], data: { projectId, name: created.name } };
    },
  },
  {
    name: "project.switch",
    description: "Switch the active project; the selected project becomes live in every same-origin Schematic tab",
    inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
    execute: async ({ projectId }) => {
      const switched = useProjectStore.getState().switchProject(projectId);
      if (!switched) return { content: [{ type: "text", text: `Unknown project ${projectId}` }], isError: true };
      const project = useProjectStore.getState().project;
      return { content: [{ type: "text", text: `Switched to ${project.name}` }], data: { projectId, name: project.name } };
    },
  },
  {
    name: "project.duplicate",
    description: "Duplicate a saved project and activate the copy",
    inputSchema: { type: "object", properties: { projectId: { type: "string" }, name: { type: "string" } } },
    execute: async ({ projectId, name }) => {
      const duplicateId = useProjectStore.getState().duplicateProject(projectId, name);
      if (!duplicateId) return { content: [{ type: "text", text: `Unknown project ${projectId ?? ""}` }], isError: true };
      const duplicate = useProjectStore.getState().projects.find((project) => project.id === duplicateId);
      return { content: [{ type: "text", text: `Duplicated project as ${duplicate?.name ?? duplicateId}` }], data: { projectId: duplicateId, name: duplicate?.name } };
    },
  },
  {
    name: "project.delete",
    description: "Delete a saved project; the final remaining project cannot be deleted",
    inputSchema: { type: "object", properties: { projectId: { type: "string" } } },
    execute: async ({ projectId }) => {
      const deleted = useProjectStore.getState().deleteProject(projectId);
      if (!deleted) return { content: [{ type: "text", text: "Project was not deleted — keep one project and provide a valid id" }], isError: true };
      return { content: [{ type: "text", text: `Deleted project ${projectId ?? "current"}` }] };
    },
  },
  {
    name: "project.save",
    description: "Persist the active project collection to this browser and broadcast it to same-origin tabs",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      const saved = useProjectStore.getState().saveProject();
      return { content: [{ type: "text", text: `Saved ${saved.projectId} at ${saved.savedAt}` }], data: saved };
    },
  },
  {
    name: "project.clear",
    description: "Clear the current project (remove all components and connections)",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      useProjectStore.getState().clear();
      return { content: [{ type: "text", text: "Project cleared" }] };
    },
  },
  {
    name: "project.rename",
    description: "Rename the active hardware project",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    execute: async ({ name }) => {
      const state = useProjectStore.getState();
      const renamed = state.renameProject(state.activeProjectId, String(name));
      if (!renamed) return { content: [{ type: "text", text: "The active project could not be renamed" }], isError: true };
      return { content: [{ type: "text", text: `Renamed project to ${renamed}` }], data: { name: renamed } };
    },
  },
  {
    name: "project.apply_blueprint",
    description: "Create a complete hardware design in one live operation; supported blueprint: meta-glasses",
    inputSchema: { type: "object", properties: { blueprintId: { type: "string", enum: ["meta-glasses"] }, replace: { type: "boolean", default: true } }, required: ["blueprintId"] },
    execute: async ({ blueprintId, replace = true }) => {
      const blueprint = BLUEPRINTS[blueprintId];
      if (!blueprint) return { content: [{ type: "text", text: `Unknown blueprint ${blueprintId}` }], isError: true };
      const current = useProjectStore.getState().project;
      if (!replace && current.components.length > 0) return { content: [{ type: "text", text: "Blueprint not applied — the workspace is not empty and replace=false" }], isError: true };
      const project = cloneProject(blueprint);
      useProjectStore.getState().loadProject(project);
      useSelectionStore.getState().setActive(project.components.find((component) => component.definitionId.includes("esp32") || component.definitionId.includes("arduino") || component.definitionId.includes("pico"))?.id ?? null);
      useSimulationStore.getState().reset();
      useValidationStore.getState().clear();
      return {
        content: [{ type: "text", text: `Applied ${blueprintId}: ${project.components.length} components, ${project.connections.length} connections` }],
        data: { blueprintId, name: project.name, components: project.components.length, connections: project.connections.length, firmwareTargets: project.firmwareTargets.length },
      };
    },
  },
  {
    name: "workspace.get_state",
    description: "Read the live workspace panel state and recent WebMCP activity",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const workspace = useWorkspaceStore.getState();
      const simulation = useSimulationStore.getState();
      const validation = useValidationStore.getState();
      const selection = useSelectionStore.getState();
        const state = {
        project: { id: useProjectStore.getState().activeProjectId, name: useProjectStore.getState().project.name },
        projects: useProjectStore.getState().projects.map((project) => ({ id: project.id, name: project.name, active: project.id === useProjectStore.getState().activeProjectId })),
        selection: { activeComponentId: selection.activeComponentId, selectedIds: selection.selectedIds },
        panel: workspace.bottomPanel,
        collapsed: workspace.bottomCollapsed,
        height: workspace.bottomHeight,
        rightPanelWidth: workspace.rightPanelWidth,
        panels: {
          webmcp: { activities: useWebMCPStore.getState().activities.slice(0, 12) },
          terminal: { running: simulation.running, serialOutput: simulation.serialOutput.slice(-2000) },
          debug: { timeNs: simulation.timeNs.toString(), pinStates: simulation.pinStates, engineStatus: simulation.engineStatus, lastRun: simulation.lastRun },
          validation: { valid: validation.valid, issues: validation.issues, codeIssues: validation.codeIssues, compile: validation.compile, checkedAt: validation.checkedAt },
        },
      };
      return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }], data: state };
    },
  },
  {
    name: "workspace.set_panel",
    description: "Open a live bottom workspace panel for the user or agent: webmcp, terminal, debug, or validation",
    inputSchema: { type: "object", properties: { panel: { type: "string", enum: ["webmcp", "terminal", "debug", "validation"] } }, required: ["panel"] },
    execute: async ({ panel }) => {
      const panels: BottomPanel[] = ["webmcp", "terminal", "debug", "validation"];
      if (!panels.includes(panel)) return { content: [{ type: "text", text: `Unknown workspace panel ${panel}` }], isError: true };
      useWorkspaceStore.getState().setBottomPanel(panel);
      return { content: [{ type: "text", text: `Opened ${panel} panel` }], data: { panel, collapsed: false } };
    },
  },
  {
    name: "workspace.set_right_width",
    description: "Resize the right code and inspector panel in pixels; keeps the value across sessions",
    inputSchema: { type: "object", properties: { width: { type: "number", minimum: 300, maximum: 720 } }, required: ["width"] },
    execute: async ({ width }) => {
      if (!Number.isFinite(Number(width))) return { content: [{ type: "text", text: "Width must be a number between 300 and 720 pixels" }], isError: true };
      const requested = Number(width);
      if (requested < 300 || requested > 720) return { content: [{ type: "text", text: "Width must be between 300 and 720 pixels" }], isError: true };
      useWorkspaceStore.getState().setRightPanelWidth(requested);
      const actual = useWorkspaceStore.getState().rightPanelWidth;
      return { content: [{ type: "text", text: `Right panel width set to ${actual}px` }], data: { rightPanelWidth: actual } };
    },
  },
  {
    name: "component.search",
    description: "Search components in catalog by query, category, or domain. e.g. ESP32, TI DRV, sensor",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text" },
        category: { type: "string", enum: ["board", "sensor", "actuator", "display", "power", "logic", "communication", ""] },
        domain: { type: "string", enum: ["gpio", "i2c", "spi", "uart", "power", "rf", ""] },
      },
    },
    annotations: { readOnlyHint: true },
    execute: async ({ query, category, domain }) => {
      const res = searchCatalog(query ?? "", { category: category || undefined, domain: domain || undefined });
      return { content: [{ type: "text", text: JSON.stringify(res.map((r) => ({ id: r.id, title: r.title, category: r.category, ports: r.ports.length })), null, 2) }], data: res };
    },
  },
  {
    name: "component.inspect",
    description: "Inspect a component definition by id — returns ports, models, fidelity checklist, electrical specs",
    inputSchema: { type: "object", properties: { componentId: { type: "string", description: "Catalog id, e.g. bmp280" } }, required: ["componentId"] },
    annotations: { readOnlyHint: true },
    execute: async ({ componentId }) => {
      const def = catalog.find((c) => c.id === componentId);
      if (!def) return { content: [{ type: "text", text: `Unknown component ${componentId}` }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(def, null, 2) }], data: def };
    },
  },
  {
    name: "component.add",
    description: "Add a hardware component to the current project at x,y",
    inputSchema: {
      type: "object",
      properties: {
        componentId: { type: "string", description: "Catalog definition id" },
        x: { type: "number", description: "Canvas x" },
        y: { type: "number", description: "Canvas y" },
      },
      required: ["componentId"],
    },
    execute: async ({ componentId, x, y }) => {
      const def = catalog.find((c) => c.id === componentId);
      if (!def) return { content: [{ type: "text", text: `Unknown component ${componentId}` }], isError: true };
      const { id } = useProjectStore.getState().addComponent(componentId, { x: x ?? 100, y: y ?? 100 });
      useSelectionStore.getState().setActive(id);
      return { content: [{ type: "text", text: `Added ${componentId} as ${id}` }], data: { instanceId: id } };
    },
  },
  {
    name: "component.remove",
    description: "Remove a component instance from the project",
    inputSchema: { type: "object", properties: { instanceId: { type: "string" } }, required: ["instanceId"] },
    execute: async ({ instanceId }) => {
      const exists = useProjectStore.getState().project.components.some((component) => component.id === instanceId);
      if (!exists) return { content: [{ type: "text", text: `Unknown component instance ${instanceId}` }], isError: true };
      useProjectStore.getState().removeComponent(instanceId);
      if (useSelectionStore.getState().activeComponentId === instanceId) useSelectionStore.getState().clear();
      return { content: [{ type: "text", text: `Removed ${instanceId}` }] };
    },
  },
  {
    name: "component.list_ports",
    description: "List ports for a component instance (or definition if no instance)",
    inputSchema: { type: "object", properties: { componentId: { type: "string", description: "Instance id or definition id" } }, required: ["componentId"] },
    annotations: { readOnlyHint: true },
    execute: async ({ componentId }) => {
      const inst = useProjectStore.getState().project.components.find((c) => c.id === componentId);
      const defId = inst?.definitionId ?? componentId;
      const def = catalog.find((c) => c.id === defId);
      if (!def) return { content: [{ type: "text", text: `Unknown ${componentId}` }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(def.ports, null, 2) }], data: def.ports };
    },
  },
  {
    name: "connection.connect",
    description: "Connect two ports: source component.port → target component.port. Validates typed domains.",
    inputSchema: {
      type: "object",
      properties: {
        sourceComponentId: { type: "string" },
        sourcePortId: { type: "string" },
        targetComponentId: { type: "string" },
        targetPortId: { type: "string" },
      },
      required: ["sourceComponentId", "sourcePortId", "targetComponentId", "targetPortId"],
    },
    execute: async ({ sourceComponentId, sourcePortId, targetComponentId, targetPortId }) => {
      try {
        const { id } = useProjectStore.getState().connectPorts({ componentId: sourceComponentId, portId: sourcePortId }, { componentId: targetComponentId, portId: targetPortId });
        return { content: [{ type: "text", text: `Connected ${sourceComponentId}.${sourcePortId} → ${targetComponentId}.${targetPortId} as ${id}` }], data: { connectionId: id } };
      } catch (e) {
        return { content: [{ type: "text", text: `Failed: ${(e as Error).message}` }], isError: true };
      }
    },
  },
  {
    name: "connection.disconnect",
    description: "Disconnect (remove) a connection by id",
    inputSchema: { type: "object", properties: { connectionId: { type: "string" } }, required: ["connectionId"] },
    execute: async ({ connectionId }) => {
      const exists = useProjectStore.getState().project.connections.some((connection) => connection.id === connectionId);
      if (!exists) return { content: [{ type: "text", text: `Unknown connection ${connectionId}` }], isError: true };
      useProjectStore.getState().disconnectPorts(connectionId);
      return { content: [{ type: "text", text: `Disconnected ${connectionId}` }] };
    },
  },
  {
    name: "connection.get_connections",
    description: "Get all connections in current project",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const conns = useProjectStore.getState().project.connections;
      return { content: [{ type: "text", text: JSON.stringify(conns, null, 2) }], data: conns };
    },
  },
  {
    name: "firmware.write",
    description: "Write firmware files for a board instance; the code editor, Problems, Debug, and other tabs update live",
    inputSchema: {
      type: "object",
      properties: {
        componentId: { type: "string", description: "Board instance id" },
        files: { type: "array", items: { type: "object", properties: { name: { type: "string" }, content: { type: "string" } }, required: ["name", "content"] } },
        language: { type: "string", enum: ["arduino", "micropython", "espidf", "c", "python", "wasm"] },
        boardFqbn: { type: "string" },
    },
    required: ["componentId", "files"],
    },
    execute: async ({ componentId, files, language, boardFqbn }) => {
      const component = useProjectStore.getState().project.components.find((item) => item.id === componentId);
      if (!component) return { content: [{ type: "text", text: `Unknown component ${componentId}` }], isError: true };
      const definition = catalog.find((item) => item.id === component.definitionId);
      if (definition?.category !== "board") return { content: [{ type: "text", text: `${componentId} is not a programmable board` }], isError: true };
      if (!Array.isArray(files) || files.length === 0) return { content: [{ type: "text", text: "At least one firmware file is required" }], isError: true };
      const normalizedFiles = files.map((file: any) => ({ name: String(file?.name ?? "").trim(), content: typeof file?.content === "string" ? file.content : String(file?.content ?? "") }));
      if (normalizedFiles.some((file: { name: string }) => !file.name)) return { content: [{ type: "text", text: "Every firmware file needs a name" }], isError: true };
      useProjectStore.getState().updateFirmware(componentId, normalizedFiles, { language, boardFqbn });
      const codeIssues = validateFirmwareFiles(normalizedFiles);
      useValidationStore.getState().setCodeIssues(codeIssues);
      useSimulationStore.getState().appendSerial(`[firmware] ${componentId} updated · ${normalizedFiles.length} file(s)\n`);
      useSelectionStore.getState().setActive(componentId);
      return { content: [{ type: "text", text: `Firmware written for ${componentId} (${normalizedFiles.length} file(s))` }], data: { componentId, files: normalizedFiles.map((file: { name: string }) => file.name), codeIssues } };
    },
  },
  {
    name: "firmware.read",
    description: "Read firmware files for a board instance from the active project",
    inputSchema: { type: "object", properties: { componentId: { type: "string" } }, required: ["componentId"] },
    annotations: { readOnlyHint: true },
    execute: async ({ componentId }) => {
      const target = useProjectStore.getState().project.firmwareTargets.find((item) => item.componentId === componentId);
      if (!target) return { content: [{ type: "text", text: `No firmware for ${componentId}` }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(target, null, 2) }], data: target };
    },
  },
  {
    name: "firmware.check",
    description: "Run browser-safe firmware diagnostics and publish them to Problems and Debug",
    inputSchema: { type: "object", properties: { componentId: { type: "string" } }, required: ["componentId"] },
    execute: async ({ componentId }) => {
      const target = useProjectStore.getState().project.firmwareTargets.find((item) => item.componentId === componentId);
      if (!target) return { content: [{ type: "text", text: `No firmware for ${componentId}` }], isError: true };
      const codeIssues = validateFirmwareFiles(target.files);
      useValidationStore.getState().setCodeIssues(codeIssues);
      useSimulationStore.getState().appendSerial(`[firmware] checked ${componentId} · ${codeIssues.length} diagnostic(s)\n`);
      return { content: [{ type: "text", text: JSON.stringify({ componentId, codeIssues }, null, 2) }], data: { componentId, codeIssues } };
    },
  },
  {
    name: "firmware.compile",
    description: "Compile firmware for a board; uses the remote compiler when connected and a browser preflight on static deployments",
    inputSchema: { type: "object", properties: { componentId: { type: "string" }, boardFqbn: { type: "string", description: "e.g. arduino:avr:uno" } }, required: ["componentId"] },
    execute: async ({ componentId, boardFqbn }) => {
      const proj = useProjectStore.getState().project;
      const tgt = proj.firmwareTargets.find((f) => f.componentId === componentId);
      if (!tgt) {
        useValidationStore.getState().setCompile({ status: "error", log: `No firmware for ${componentId}`, checkedAt: Date.now() });
        return { content: [{ type: "text", text: `No firmware for ${componentId} — call firmware.write first` }], isError: true };
      }
      const fqbn = boardFqbn ?? tgt.boardFqbn ?? "arduino:avr:uno";
      const codeIssues = validateFirmwareFiles(tgt.files);
      useValidationStore.getState().setCodeIssues(codeIssues);
      useValidationStore.getState().setCompile({ status: "checking", boardFqbn: fqbn, log: "Checking source…", checkedAt: Date.now() });
      const result = await fetchJson("/api/compile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: tgt.files, board_fqbn: fqbn }) });
      if (!result.available) {
        const preflight = browserCompilePreflight(tgt.files, fqbn);
        const status = codeIssues.some((issue) => issue.severity === "error") ? "error" : "unavailable";
        useValidationStore.getState().setCompile({ status, boardFqbn: fqbn, log: JSON.stringify(preflight, null, 2), checkedAt: Date.now() });
        useSimulationStore.getState().appendSerial(`[firmware] ${status === "error" ? "compile failed" : "preflight complete"} · ${componentId}\n`);
        return { content: [{ type: "text", text: JSON.stringify(preflight, null, 2) }], data: { ...preflight, codeIssues } };
      }
      if (!result.response?.ok) {
        useValidationStore.getState().setCompile({ status: "error", boardFqbn: fqbn, log: JSON.stringify(result.data, null, 2), checkedAt: Date.now() });
        return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }], data: result.data, isError: true };
      }
      useValidationStore.getState().setCompile({ status: "success", boardFqbn: fqbn, log: JSON.stringify(result.data, null, 2), checkedAt: Date.now() });
      useSimulationStore.getState().appendSerial(`[firmware] compiled · ${componentId}\n`);
      return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }], data: result.data };
    },
  },
  {
    name: "simulation.run",
    description: "Run simulation for current project (uses remote engines when connected, otherwise a browser runtime)",
    inputSchema: { type: "object", properties: { durationMs: { type: "number", description: "Duration ms, default 1000" } } },
    execute: async ({ durationMs }) => {
      const project = useProjectStore.getState().project;
      const inputs = useSimulationStore.getState().pinStates;
      useSimulationStore.getState().start();
      const result = await fetchJson("/api/simulation/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project, inputs, duration_ns: (durationMs ?? 1000) * 1e6 }) });
      const remote = result.available && result.response?.ok && result.data && typeof result.data === "object" && result.data.runtime === "remote" && Object.keys(result.data.outputs ?? {}).length > 0;
      if (!remote) {
        const res = runBrowserSimulation(project, inputs, durationMs ?? 1000);
        const reason = result.available && !result.response?.ok ? ` Backend HTTP ${result.response?.status ?? "unknown"};` : "";
        res.note = `${res.note}${reason} Browser runtime is the active execution path.`;
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }], data: res };
      }
      const res = result.data;
      const timeNs = BigInt(res.time_ns ?? 0);
      const simulation = useSimulationStore.getState();
      simulation.setTime(timeNs);
      for (const [portId, value] of Object.entries(res.outputs ?? {})) {
        if (typeof value === "boolean" || typeof value === "number") simulation.setPin(portId, value);
      }
      const readings = Object.entries(res.outputs ?? {}).map(([key, value]) => `${key.split(":").pop()}=${value}`).join("  ");
      simulation.appendSerial(`[${project.name}] remote runtime · t=${timeNs}ns${readings ? `  ${readings}` : ""}\n`);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }], data: res };
    },
  },
  {
    name: "simulation.stop",
    description: "Stop simulation",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      useSimulationStore.getState().stop();
      const result = await fetchJson("/api/simulation/stop", { method: "POST" });
      if (!result.available) return { content: [{ type: "text", text: "Simulation stopped locally (browser runtime)" }], data: { status: "stopped", runtime: "browser" } };
      if (!result.response?.ok) return { content: [{ type: "text", text: `Simulation stopped locally; backend returned HTTP ${result.response?.status ?? "unknown"}` }], data: result.data, isError: true };
      return { content: [{ type: "text", text: "Simulation stopped" }], data: result.data };
    },
  },
  {
    name: "simulation.get_state",
    description: "Get simulation state (running, timeNs, pinStates, engineStatus)",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const sim = useSimulationStore.getState();
      const state = { running: sim.running, timeNs: sim.timeNs.toString(), pinStates: sim.pinStates, engineStatus: sim.engineStatus, lastRun: sim.lastRun, serialOutput: sim.serialOutput.slice(-500) };
      return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }], data: state };
    },
  },
  {
    name: "simulation.set_input",
    description: "Set sensor input (e.g. motion=true, temperature=25) for simulation",
    inputSchema: { type: "object", properties: { componentId: { type: "string" }, key: { type: "string" }, value: {} } , required: ["componentId", "key", "value"]},
    execute: async ({ componentId, key, value }) => {
      const component = useProjectStore.getState().project.components.find((item) => item.id === componentId);
      if (!component) return { content: [{ type: "text", text: `Unknown component ${componentId}` }], isError: true };
      if (typeof value !== "boolean" && typeof value !== "number") return { content: [{ type: "text", text: "Simulation input must be a boolean or number" }], isError: true };
      useSimulationStore.getState().setPin(`${componentId}:${key}`, value as boolean | number);
      useSimulationStore.getState().appendSerial(`[input] ${componentId}.${key}=${JSON.stringify(value)}\n`);
      // Forward to a connected backend only when explicitly configured, or when
      // the app is running locally. Never open insecure ws:// from HTTPS Pages.
      const configuredBackend = import.meta.env.VITE_BACKEND_URL as string | undefined;
      const localBackend = ["localhost", "127.0.0.1", "::1"].includes(location.hostname) ? `${location.protocol}//${location.hostname}:8001` : undefined;
      const backendUrl = configuredBackend || localBackend;
      if (backendUrl) {
        try {
          const wsUrl = new URL("/api/simulation/ws", backendUrl);
          wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
          const ws = new WebSocket(wsUrl.toString());
          ws.onopen = () => {
            ws.send(JSON.stringify({ op: "set_sensor_input", componentId, key, value }));
            ws.close();
          };
        } catch {}
      }
      return { content: [{ type: "text", text: `Set ${componentId}.${key}=${JSON.stringify(value)}` }], data: { componentId, key, value, pin: `${componentId}:${key}`, forwarded: Boolean(backendUrl) } };
    },
  },
  {
    name: "validation.check",
    description: "Validate current design — returns issues (voltage, ground, I2C collision, TX-TX, etc.)",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => {
      try {
        const project = useProjectStore.getState().project;
        const result = validateProject(project);
        useValidationStore.getState().setResult(result);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], data: result };
      } catch (e) {
        return { content: [{ type: "text", text: `Validation error: ${(e as Error).message}` }], isError: true };
      }
    },
  },
  {
    name: "validation.explain_error",
    description: "Explain a validation error code with fix guidance",
    inputSchema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
    annotations: { readOnlyHint: true },
    execute: async ({ code }) => {
      const map: Record<string, string> = {
        VOLTAGE_MISMATCH: "Voltage exceeds target max — insert level shifter or choose compatible variant.",
        OUTPUT_TO_OUTPUT: "Output→output illegal — one side must be input/bidirectional.",
        UART_TX_TO_TX: "Connect TX→RX and RX→TX (cross).",
        I2C_ADDRESS_COLLISION: "Two devices share same I2C address — change address jumper or use mux.",
        MISSING_PULLUP: "I2C needs 4.7kΩ pull-ups to VCC on SDA/SCL.",
        MISSING_GROUND: "Add common ground net.",
        USB_HOST_TO_HOST: "Host must connect to device.",
      };
      return { content: [{ type: "text", text: map[code] ?? `No explanation for ${code}` }] };
    },
  },
  {
    name: "shopping.search",
    description: "Find exact parts for the current build. Agent-supplied listings may include up to three live offers per part; offline fallback keeps honest retailer links with prices marked unavailable.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Exact part, board, manufacturer, or catalog id" },
        quantity: { type: "number", description: "Required quantity" },
        listings: { type: "array", description: "Optional agent/web results with title, partNumber, exactMatch, offers, and alternatives" },
      },
    },
    execute: async ({ query = "", quantity = 1, listings }) => {
      const project = useProjectStore.getState().project;
      const requestedQuantity = Math.max(1, Math.min(999, Math.round(Number(quantity) || 1)));
      const searchQuery = String(query ?? "");
      let source = "catalog-links";
      let results: ShoppingResult[];
      if (Array.isArray(listings)) {
        results = normalizeShoppingResults(listings, searchQuery, requestedQuantity);
        source = "webmcp-agent";
      } else {
        const remote = await fetchJson(`/api/parts/search?query=${encodeURIComponent(searchQuery)}&quantity=${requestedQuantity}`);
        const remoteListings = remote.available && remote.response?.ok ? remote.data?.results ?? remote.data?.listings ?? remote.data?.items : null;
        if (Array.isArray(remoteListings)) {
          results = normalizeShoppingResults(remoteListings, searchQuery, requestedQuantity);
          source = "parts-provider";
        } else {
          results = fallbackShoppingResults(searchQuery, requestedQuantity, project);
        }
      }
      useShoppingStore.getState().setQuery(searchQuery);
      useShoppingStore.getState().setResults(results);
      return {
        content: [{ type: "text", text: JSON.stringify({ query: searchQuery, source, liveOffers: results.some((result) => result.offers.some((offer) => offer.price !== null)), results }, null, 2) }],
        data: { query: searchQuery, source, liveOffers: results.some((result) => result.offers.some((offer) => offer.price !== null)), results },
      };
    },
  },
  {
    name: "shopping.get_state",
    description: "Read live part listings, cart lines, budget, and cheapest-price quote for the current build",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const shopping = useShoppingStore.getState();
      const quote = shopping.getQuote();
      const state = { query: shopping.query, results: shopping.results, cart: shopping.cart, budget: shopping.budget, lastSearchAt: shopping.lastSearchAt, quote };
      return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }], data: state };
    },
  },
  {
    name: "shopping.cart_add",
    description: "Add an exact shopping result to the build cart",
    inputSchema: { type: "object", properties: { resultId: { type: "string" }, quantity: { type: "number" } }, required: ["resultId"] },
    execute: async ({ resultId, quantity }) => {
      const id = String(resultId);
      if (!useShoppingStore.getState().results.some((result) => result.id === id)) return { content: [{ type: "text", text: `Unknown shopping result ${id}; search for the part first` }], isError: true };
      useShoppingStore.getState().addToCart(id, Number(quantity) || 1);
      return { content: [{ type: "text", text: JSON.stringify(useShoppingStore.getState().getQuote(), null, 2) }], data: useShoppingStore.getState().getQuote() };
    },
  },
  {
    name: "shopping.cart_remove",
    description: "Remove a part from the shopping cart",
    inputSchema: { type: "object", properties: { resultId: { type: "string" } }, required: ["resultId"] },
    execute: async ({ resultId }) => {
      const id = String(resultId);
      if (!useShoppingStore.getState().cart.some((line) => line.resultId === id)) return { content: [{ type: "text", text: `Shopping result ${id} is not in the cart` }], isError: true };
      useShoppingStore.getState().removeFromCart(id);
      return { content: [{ type: "text", text: "Cart line removed" }], data: useShoppingStore.getState().getQuote() };
    },
  },
  {
    name: "shopping.cart_set_quantity",
    description: "Set the quantity for a shopping cart line, or remove it with zero",
    inputSchema: { type: "object", properties: { resultId: { type: "string" }, quantity: { type: "number" } }, required: ["resultId", "quantity"] },
    execute: async ({ resultId, quantity }) => {
      const id = String(resultId);
      if (!useShoppingStore.getState().cart.some((line) => line.resultId === id)) return { content: [{ type: "text", text: `Shopping result ${id} is not in the cart` }], isError: true };
      useShoppingStore.getState().setQuantity(id, Number(quantity));
      return { content: [{ type: "text", text: JSON.stringify(useShoppingStore.getState().getQuote(), null, 2) }], data: useShoppingStore.getState().getQuote() };
    },
  },
  {
    name: "shopping.cart_set_budget",
    description: "Set or clear the target build budget in USD",
    inputSchema: { type: "object", properties: { budget: { type: ["number", "null"] } }, required: ["budget"] },
    execute: async ({ budget }) => {
      useShoppingStore.getState().setBudget(budget === null ? null : Number(budget));
      return { content: [{ type: "text", text: JSON.stringify(useShoppingStore.getState().getQuote(), null, 2) }], data: useShoppingStore.getState().getQuote() };
    },
  },
  {
    name: "shopping.cart_undo",
    description: "Undo the last cart change",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      useShoppingStore.getState().undoCart();
      return { content: [{ type: "text", text: JSON.stringify(useShoppingStore.getState().getQuote(), null, 2) }], data: useShoppingStore.getState().getQuote() };
    },
  },
  {
    name: "shopping.cart_reset",
    description: "Reset the cart to one of every catalog part currently required by the project, after listings have been searched",
    inputSchema: { type: "object", properties: { requiredCatalogIds: { type: "array", items: { type: "string" } } } },
    execute: async ({ requiredCatalogIds }) => {
      const project = useProjectStore.getState().project;
      const ids = Array.isArray(requiredCatalogIds) && requiredCatalogIds.length ? requiredCatalogIds.map(String) : project.components.map((component) => component.definitionId);
      useShoppingStore.getState().resetCart(ids);
      return { content: [{ type: "text", text: JSON.stringify({ requiredCatalogIds: ids, quote: useShoppingStore.getState().getQuote() }, null, 2) }], data: { requiredCatalogIds: ids, quote: useShoppingStore.getState().getQuote() } };
    },
  },
  {
    name: "shopping.choose_alternative",
    description: "Replace a cart part with an agent-recommended context-aware alternative",
    inputSchema: { type: "object", properties: { resultId: { type: "string" }, catalogId: { type: "string" } }, required: ["resultId", "catalogId"] },
    execute: async ({ resultId, catalogId }) => {
      const changed = useShoppingStore.getState().chooseAlternative(String(resultId), String(catalogId));
      if (!changed) return { content: [{ type: "text", text: "Alternative is not available as a searched result yet" }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(useShoppingStore.getState().getQuote(), null, 2) }], data: useShoppingStore.getState().getQuote() };
    },
  },
  {
    name: "shopping.quote",
    description: "Calculate the total using the cheapest live offer per cart line and report missing prices or budget overage",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const quote = useShoppingStore.getState().getQuote();
      return { content: [{ type: "text", text: JSON.stringify(quote, null, 2) }], data: quote };
    },
  },
  {
    name: "design.auto_layout",
    description: "Auto-layout components on canvas (simple grid)",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      const proj = useProjectStore.getState().project;
      const next = proj.components.map((c, i) => ({ ...c, position: { x: 50 + (i % 4) * 220, y: 50 + Math.floor(i / 4) * 180 } }));
      useProjectStore.getState().loadProject({ ...proj, components: next });
      return { content: [{ type: "text", text: `Auto-layout applied to ${next.length} components` }] };
    },
  },
];

let controllers: AbortController[] = [];

async function executeToolWithActivity(tool: ToolDef, args: Record<string, any> = {}) {
  const activityId = useWebMCPStore.getState().beginTool(tool.name, args);
  try {
    const result = await tool.execute(args);
    useWebMCPStore.getState().finishTool(activityId, result);
    return result;
  } catch (e) {
    const message = (e as Error).message;
    useWebMCPStore.getState().finishTool(activityId, { content: [{ type: "text", text: message }], isError: true }, true);
    throw e;
  }
}

/** Chrome WebMCP Bridge reads navigator.modelContextTesting (consumer API). */
function installModelContextTestingPolyfill() {
  const nav = navigator as any;
  if (nav.modelContextTesting?.listTools && nav.modelContextTesting?.executeTool) return;
  Object.defineProperty(nav, "modelContextTesting", {
    configurable: true,
    value: {
      listTools() {
        return tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: JSON.stringify(t.inputSchema ?? { type: "object" }),
        }));
      },
      async executeTool(toolName: string, inputArgsJson: string) {
        const tool = tools.find((candidate) => candidate.name === toolName);
        if (!tool) throw new Error(`Unknown WebMCP tool: ${toolName}`);
        const args = inputArgsJson ? JSON.parse(inputArgsJson) : {};
        const result = await executeToolWithActivity(tool, args);
        return typeof result === "string" ? result : JSON.stringify(result ?? null);
      },
      registerToolsChangedCallback(callback: () => void) {
        callback();
      },
    },
  });
}

function installModelContextProducerPolyfill() {
  const doc = document as any;
  const nav = navigator as any;
  if (typeof doc.modelContext?.registerTool === "function" || typeof nav.modelContext?.registerTool === "function") return;
  const registry = new Map<string, ToolDef>();
  const mc = {
    async registerTool(tool: ToolDef, options?: { signal?: AbortSignal }) {
      registry.set(tool.name, tool);
      options?.signal?.addEventListener("abort", () => registry.delete(tool.name));
    },
    async getTools() {
      return [...registry.values()];
    },
    async executeTool(tool: string | { name: string }, args: Record<string, unknown> = {}) {
      const name = typeof tool === "string" ? tool : tool.name;
      const found = registry.get(name);
      if (!found) throw new Error(`Unknown WebMCP tool: ${name}`);
      return executeToolWithActivity(found, args);
    },
  };
  Object.defineProperty(doc, "modelContext", { configurable: true, value: mc });
  Object.defineProperty(nav, "modelContext", { configurable: true, value: mc });
}

export async function registerWebMCPTools() {
  installModelContextProducerPolyfill();
  installModelContextTestingPolyfill();
  const mc: any = (document as any).modelContext ?? (navigator as any).modelContext;
  if (!mc || typeof mc.registerTool !== "function") {
    console.warn("[WebMCP] modelContext not available — run in Chrome ≥146 with #enable-webmcp-testing, or use demo shim. Tools still callable via window.__schematicTools");
    (window as any).__schematicTools = Object.fromEntries(tools.map((t) => [t.name, (args: Record<string, unknown>) => executeToolWithActivity(t, args)]));
    return;
  }
  for (const t of tools) {
    const ctrl = new AbortController();
    controllers.push(ctrl);
    try {
      await mc.registerTool(
        {
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: t.annotations,
          execute: (args: Record<string, unknown>) => executeToolWithActivity(t, args),
        },
        { signal: ctrl.signal },
      );
      console.log(`[WebMCP] registered ${t.name}`);
    } catch (e) {
      console.error(`[WebMCP] failed to register ${t.name}:`, e);
    }
  }
  // expose for in-page testing / fallback
  (window as any).__schematicTools = Object.fromEntries(tools.map((t) => [t.name, (args: Record<string, unknown>) => executeToolWithActivity(t, args)]));
  // listen for toolchange
  if ("ontoolchange" in mc) {
    mc.ontoolchange = () => console.log("[WebMCP] toolset changed");
  }
}

export function unregisterWebMCPTools() {
  for (const c of controllers) c.abort();
  controllers = [];
}

export function getRegisteredToolNames() {
  return tools.map((t) => t.name);
}

/** Invoke the exact same callback registered with document.modelContext. */
export async function invokeWebMCPTool(name: string, args: Record<string, any> = {}) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Unknown WebMCP tool: ${name}`);
  return executeToolWithActivity(tool, args);
}
