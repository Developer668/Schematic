/**
 * WebMCP tool surface — semantic hardware tools via document.modelContext.registerTool
 * Per HardwareWebMCP.md: don't expose 100 tiny tools, expose powerful semantic ones.
 * Human click and AI call share same underlying Zustand functions.
 */
import { layoutComponentPositions, useProjectStore, type HardwareGraph } from "../store/useProjectStore.ts";
import { useSimulationStore } from "../store/useSimulationStore.ts";
import { useSelectionStore } from "../store/useSelectionStore.ts";
import { useWorkspaceStore, type BottomPanel } from "../store/useWorkspaceStore.ts";
import { useValidationStore, validateFirmwareFiles, validateProject } from "../store/useValidationStore.ts";
import { useWebMCPStore } from "../store/useWebMCPStore.ts";
import { useShoppingStore, type AgentPublication, type PartOffer, type ShoppingResult } from "../store/useShoppingStore.ts";
import { waitForProjectPersistence } from "../store/projectPersistence.ts";
import { runFirmwareRuntime } from "../simulation/runtime.ts";
import { hasPortableButtonLedContract, PortableHarnessUnavailableError, runPortableButtonLedHarness } from "../simulation/portableHarness.ts";
import { getCatalogComponent, searchCatalog } from "../data/catalog.ts";
import { isBoardDefinition, resolveFirmwareBinding } from "../data/hardware.ts";
import { apiUrl, getAuthHeaders, getAuthSession, waitForAuth } from "../auth/session.ts";
import metaGlassesBlueprint from "../../../examples/demo4-meta-glasses/project.json";

type ToolAnnotations = {
  readOnlyHint?: boolean;
  /** Result may contain content supplied by an external provider or agent. */
  untrustedContentHint?: boolean;
};

type ToolExecutionContext = { signal?: AbortSignal };

type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: any, context?: ToolExecutionContext) => Promise<any>;
  annotations?: ToolAnnotations;
};

type ApiJsonResult = {
  response: Response | null;
  data: any;
  available: boolean;
  error?: string;
};

type TrustedToolContext = {
  authenticated: true;
  subject: string;
  environment: string;
};

const BLUEPRINTS: Record<string, unknown> = { "meta-glasses": metaGlassesBlueprint };

function cloneProject(source: unknown): HardwareGraph {
  return JSON.parse(JSON.stringify(source)) as HardwareGraph;
}

function base64FromHex(hex: string) {
  const normalized = hex.trim();
  if (!/^(?:[0-9a-f]{2})*$/i.test(normalized)) return undefined;
  let binary = "";
  for (let index = 0; index < normalized.length; index += 2) {
    binary += String.fromCharCode(Number.parseInt(normalized.slice(index, index + 2), 16));
  }
  return btoa(binary);
}

function abortError() {
  try {
    return new DOMException("The WebMCP tool call was aborted", "AbortError");
  } catch {
    const error = new Error("The WebMCP tool call was aborted");
    error.name = "AbortError";
    return error;
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return Boolean(value && typeof value === "object" && "aborted" in value && "addEventListener" in value);
}

function executionSignal(value: unknown): AbortSignal | undefined {
  if (isAbortSignal(value)) return value;
  if (value && typeof value === "object" && isAbortSignal((value as { signal?: unknown }).signal)) return (value as { signal: AbortSignal }).signal;
  return undefined;
}

/**
 * Pages serves the SPA fallback for unknown /api routes. Read the body once
 * and identify that case before calling JSON.parse, so WebMCP gets a useful
 * result instead of "Unexpected end of JSON input".
 */
export async function fetchJson(path: string, init?: RequestInit): Promise<ApiJsonResult> {
  throwIfAborted(init?.signal ?? undefined);
  try {
    const request = async (authHeaders: Record<string, string>) => {
      const headers = new Headers(init?.headers);
      if (!headers.has("Content-Type") && init?.body) headers.set("Content-Type", "application/json");
      for (const [key, value] of Object.entries(authHeaders)) headers.set(key, value);
      return fetch(apiUrl(path), { credentials: "include", ...init, headers });
    };
    let response = await request(await getAuthHeaders(false, init?.signal || undefined));
    throwIfAborted(init?.signal ?? undefined);
    // A Site session is intentionally short-lived. Retry one time with a
    // freshly issued session so an agent action does not fail just because a
    // tab was left open. All current WebMCP requests use replayable JSON
    // bodies; avoid replaying an arbitrary streaming request.
    if (response.status === 401 && (!init?.body || typeof init.body === "string")) {
      response = await request(await getAuthHeaders(true, init?.signal || undefined));
    }
    const responseText = typeof response.text === "function" ? await response.text() : null;

    if (responseText !== null) {
      throwIfAborted(init?.signal ?? undefined);
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
    const data = await response.json();
    throwIfAborted(init?.signal ?? undefined);
    return { response, data, available: true };
  } catch (e) {
    if (init?.signal?.aborted || (e instanceof Error && e.name === "AbortError")) throw e;
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
    browser_runtime: { available: balancedBraces && hasSketchFile, supports: ["setup", "loop", "digitalRead", "digitalWrite", "analogRead", "analogWrite", "delay", "Serial", "Wire", "SPI"] },
  };
}

const DEGRADED_RUN_STATUSES = new Set(["no-firmware", "invalid-target", "unsupported-api"]);

function runTopologyCheck(project: HardwareGraph, inputs: Record<string, boolean | number>, durationMs: number) {
  // Resolve the graph without executing firmware. This gives every run path
  // the same wiring/protocol baseline, including a backend that declines an
  // unsupported board model.
  return runFirmwareRuntime({ ...project, firmwareTargets: [] }, inputs, durationMs);
}

function summarizeValidation(result: ReturnType<typeof validateProject>) {
  return {
    valid: result.valid,
    issueCount: result.issues.length,
    errorCount: result.issues.filter((issue) => issue.severity === "error").length,
    warningCount: result.issues.filter((issue) => issue.severity === "warning").length,
    codeIssueCount: result.codeIssues.length,
  } satisfies import("../simulation/runtime.ts").RuntimeValidationSummary;
}

function enrichRunResult(
  runtime: import("../simulation/runtime.ts").RuntimeResult,
  topology: import("../simulation/runtime.ts").RuntimeResult,
  validation: ReturnType<typeof validateProject>,
) {
  const codeExecution = runtime.codeExecution ?? {
    status: runtime.programs.length > 0 ? runtime.unsupportedApis.length > 0 ? "partial" as const : "executed" as const : "unavailable" as const,
    ...(runtime.programs.length === 0 ? { reason: "The runtime did not execute firmware for this target." } : {}),
    physicalHardwareNextStep: "Export the source, compile it with the board’s normal toolchain, and test it on the actual hardware.",
  };
  const connectionCheck = runtime.connectionCheck ?? topology.connectionCheck;
  const unavailableNote = codeExecution.status === "unavailable"
    ? "Connection topology was checked, but browser firmware execution is unavailable for this board/model. Your source remains editable and exportable; compile and test it on the actual hardware."
    : runtime.note;
  return {
    ...runtime,
    resolvedNets: runtime.resolvedNets || topology.resolvedNets,
    ...(connectionCheck ? { connectionCheck } : {}),
    codeExecution,
    validation: summarizeValidation(validation),
    note: unavailableNote,
  } satisfies import("../simulation/runtime.ts").RuntimeResult;
}

async function runBrowserSimulation(project: ReturnType<typeof useProjectStore.getState>["project"], inputs: Record<string, boolean | number>, durationMs: number) {
  const boundedDurationMs = Math.max(0, Math.min(Number.isFinite(durationMs) ? durationMs : 1000, 86_400_000));
  const topology = runTopologyCheck(project, inputs, boundedDurationMs);
  let portable;
  try {
    portable = await runPortableButtonLedHarness(project, inputs, boundedDurationMs);
  } catch (error) {
    if (!(error instanceof PortableHarnessUnavailableError)) throw error;
    const runtime: import("../simulation/runtime.ts").RuntimeResult = {
      ...topology,
      status: "unsupported-api",
      runtime: "browser",
      durationMs: boundedDurationMs,
      events: [],
      programs: [],
      targetIssues: [{ componentId: error.componentId, code: error.code, message: error.message }],
      unsupportedApis: [...new Set([...topology.unsupportedApis, "compiled-c-wasm"])],
      note: "Connection topology was checked, but browser firmware execution is unavailable because the verified C/WASM artifact could not be loaded. Your source remains editable and exportable; compile and test it on the actual hardware.",
      codeExecution: {
        status: "unavailable",
        reason: "The verified C/WASM artifact could not be loaded in this browser.",
        physicalHardwareNextStep: "Export the source, compile it with the board’s normal toolchain, and test it on the actual hardware.",
      },
    };
    return finalizeBrowserSimulation(project, runtime, boundedDurationMs);
  }
  const runtime: import("../simulation/runtime.ts").RuntimeResult = portable
    ? {
        status: "completed" as const,
        runtime: "browser" as const,
        executionEngine: "c-wasm" as const,
        abiVersion: portable.abiVersion,
        ...(portable.artifactSha256 ? { artifactSha256: portable.artifactSha256 } : {}),
        durationMs: portable.durationMs,
        outputs: portable.outputs,
        events: portable.events,
        programs: [{ componentId: portable.boardId, writes: portable.events.length, executions: portable.steps, sourceFiles: portable.sourceFiles }],
        resolvedNets: topology.resolvedNets,
        serialOutput: "",
        targetIssues: [],
        protocolEvents: [],
        deviceStates: [],
        warnings: [],
        unsupportedApis: [],
        connectionCheck: topology.connectionCheck,
        codeExecution: {
          status: "executed",
          physicalHardwareNextStep: "The source remains available for export and testing with the target board’s toolchain.",
        },
        note: portable.note,
      }
    : runFirmwareRuntime(project, inputs, boundedDurationMs);
  return finalizeBrowserSimulation(project, runtime, boundedDurationMs, portable);
}

function finalizeBrowserSimulation(
  project: ReturnType<typeof useProjectStore.getState>["project"],
  runtime: import("../simulation/runtime.ts").RuntimeResult,
  boundedDurationMs: number,
  portable?: Awaited<ReturnType<typeof runPortableButtonLedHarness>>,
) {
  const timeNs = BigInt(Math.round(boundedDurationMs * 1_000_000));
  const outputs = runtime.outputs;
  const simulation = useSimulationStore.getState();
  simulation.setTime(timeNs);
  for (const [portId, value] of Object.entries(outputs)) simulation.setPin(portId, value);
  simulation.setLastRun(runtime);
  const trace = runtime.events.slice(0, 8).map((event) => `${event.endpoint}=${event.value}`).join("  ");
  simulation.appendSerial(`[${project.name}] browser ${runtime.executionEngine ?? "runtime"} · t=${timeNs}ns${trace ? `  ${trace}` : ""}\n${runtime.serialOutput}`);
  simulation.stop();
  return {
    ...runtime,
    time_ns: timeNs.toString(),
    snapshot: runtime.outputs,
    ...(portable ? { harness: portable } : {}),
  };
}

function normalizeRemoteRun(result: any, topology?: import("../simulation/runtime.ts").RuntimeResult): import("../simulation/runtime.ts").RuntimeResult {
  const events = Array.isArray(result?.events) ? result.events.flatMap((event: any) => {
    const value = event?.value;
    if (typeof value !== "boolean" && typeof value !== "number") return [];
    return [{
      timeMs: Number(event?.timeMs ?? 0),
      endpoint: String(event?.endpoint ?? `${event?.deviceId ?? event?.controllerId ?? "device"}:${event?.operation ?? event?.kind ?? "event"}`),
      value,
      reason: String(event?.reason ?? `${event?.kind ?? "event"}${event?.operation ? ` ${event.operation}` : ""}`),
    }];
  }) : [];
  const programs = Array.isArray(result.programs) ? result.programs : [];
  const unsupportedApis = Array.isArray(result.unsupported_apis) ? result.unsupported_apis : [];
  const rawConnectionCheck = result?.connectionCheck ?? result?.connection_check;
  const connectionCheck = rawConnectionCheck && typeof rawConnectionCheck === "object"
    ? {
        status: "completed" as const,
        connectionsChecked: Number(rawConnectionCheck.connectionsChecked ?? rawConnectionCheck.connections_checked ?? 0),
        resolvedNets: Number(rawConnectionCheck.resolvedNets ?? rawConnectionCheck.resolved_nets ?? result.resolved_nets ?? 0),
        note: String(rawConnectionCheck.note ?? "The browser resolved connected nets and ran available protocol checks independently of firmware execution."),
      }
    : topology?.connectionCheck;
  const rawCodeExecution = result?.codeExecution ?? result?.code_execution;
  const rawStatus = rawCodeExecution?.status;
  const codeExecution = rawCodeExecution && ["executed", "partial", "unavailable"].includes(rawStatus)
    ? {
        status: rawStatus as "executed" | "partial" | "unavailable",
        ...(rawCodeExecution.reason ? { reason: String(rawCodeExecution.reason) } : {}),
        physicalHardwareNextStep: String(rawCodeExecution.physicalHardwareNextStep ?? rawCodeExecution.physical_hardware_next_step ?? "Export the source, compile it with the board’s normal toolchain, and test it on the actual hardware."),
      }
    : {
        status: programs.length > 0 ? unsupportedApis.length > 0 ? "partial" as const : "executed" as const : "unavailable" as const,
        ...(programs.length === 0 ? { reason: "The remote runtime did not execute firmware for this target." } : {}),
        physicalHardwareNextStep: "Export the source, compile it with the board’s normal toolchain, and test it on the actual hardware.",
      };
  return {
    status: result.status,
    runtime: "remote",
    executionEngine: "remote",
    durationMs: Number(result.duration_ms ?? Number(result.duration_ns ?? 0) / 1_000_000),
    outputs: result.outputs ?? {},
    events,
    programs,
    resolvedNets: Number(result.resolved_nets ?? topology?.resolvedNets ?? 0),
    serialOutput: String(result.serial_output ?? ""),
    targetIssues: Array.isArray(result.target_issues) ? result.target_issues : [],
    protocolEvents: Array.isArray(result.protocol_events) ? result.protocol_events : [],
    deviceStates: Array.isArray(result.device_states) ? result.device_states : [],
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
    unsupportedApis,
    note: String(result.note ?? "Remote behavioral simulation completed."),
    ...(connectionCheck ? { connectionCheck } : {}),
    codeExecution,
  };
}

function normalizeShoppingResults(raw: unknown, _query: string, quantity: number): ShoppingResult[] {
  const entries = Array.isArray(raw) ? raw : [];
  return entries.slice(0, 24).map((entry) => {
    const item = entry && typeof entry === "object" ? entry as Record<string, any> : {};
    // This is intentionally a shape conversion only. It never invents a
    // catalog identity, retailer, URL, price, timestamp, or provenance. The
    // shopping store rejects incomplete records before they reach the UI.
    const catalogId = String(item.catalogId ?? item.componentId ?? "").trim();
    const catalogDefinition = getCatalogComponent(catalogId);
    const exactMatch = item.exactMatch === true && Boolean(catalogDefinition);
    const title = String(item.title ?? "").trim();
    const partNumber = String(item.partNumber ?? "").trim();
    const rawOffers = Array.isArray(item.offers) ? item.offers : [];
    const offers = rawOffers.slice(0, 3).map((rawOffer: any) => {
      const offer = rawOffer && typeof rawOffer === "object" ? rawOffer as Record<string, any> : {};
      const parsedPrice = typeof offer.price === "number" ? offer.price : typeof offer.price === "string" && offer.price.trim() ? Number(offer.price) : null;
      return {
        id: String(offer.id ?? "").trim(),
        retailer: String(offer.retailer ?? offer.source ?? "").trim(),
        title: String(offer.title ?? "").trim(),
        price: typeof parsedPrice === "number" && Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : null,
        currency: String(offer.currency ?? "").trim(),
        url: String(offer.url ?? "").trim(),
        availability: offer.availability ? String(offer.availability) : undefined,
        fetchedAt: String(offer.fetchedAt ?? "").trim(),
        provider: String(offer.provider ?? "").trim(),
      } satisfies PartOffer;
    });
    const alternatives = (Array.isArray(item.alternatives) ? item.alternatives : []).slice(0, 3).map((alternative: any) => ({
      catalogId: String(alternative.catalogId ?? alternative.id ?? ""),
      title: String(alternative.title ?? alternative.name ?? "Alternative part"),
      reason: String(alternative.reason ?? "Verify electrical limits and footprint before substituting."),
      resultId: alternative.resultId ? String(alternative.resultId) : undefined,
    })).filter((alternative: { catalogId: string }) => alternative.catalogId);
    return {
      id: String(item.resultId ?? item.id ?? "").trim(),
      catalogId,
      title,
      manufacturer: item.manufacturer ? String(item.manufacturer).trim() : catalogDefinition?.manufacturer,
      partNumber,
      requestedQuantity: Math.max(1, Math.round(Number(item.requestedQuantity ?? quantity))),
      exactMatch,
      matchNote: item.matchNote ? String(item.matchNote) : undefined,
      offers,
      alternatives,
      updatedAt: String(item.updatedAt ?? "").trim(),
      provenance: item.provenance && typeof item.provenance === "object" ? {
        source: item.provenance.source,
        provider: String(item.provenance.provider ?? "").trim(),
        agentId: String(item.provenance.agentId ?? "").trim(),
        publishedAt: String(item.provenance.publishedAt ?? "").trim(),
      } : { source: "webmcp-agent", provider: "", agentId: "", publishedAt: "" },
    };
  });
}

function bindShoppingPublication(results: ShoppingResult[], publication: AgentPublication, trustedAuth: TrustedToolContext) {
  // The agent supplies sourcing provenance, while identity is bound to the
  // session that invoked the tool. Never require or trust a caller-provided
  // user/agent id; that would make the publication boundary self-asserted.
  return results.map((result) => ({
    ...result,
    provenance: {
      source: "webmcp-agent" as const,
      provider: publication.provider,
      agentId: `webmcp:${trustedAuth.environment}:${trustedAuth.subject}`,
      publishedAt: publication.publishedAt,
    },
  }));
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
      useSelectionStore.getState().setActive(project.components.find((component) => isBoardDefinition(getCatalogComponent(component.definitionId)))?.id ?? null);
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
          debug: { timeNs: simulation.timeNs.toString(), pinStates: simulation.pinStates, engineStatus: simulation.engineStatus, remoteSessionId: simulation.remoteSessionId, lastRun: simulation.lastRun },
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
      return { content: [{ type: "text", text: JSON.stringify(res.map((r) => ({ id: r.id, title: r.title, category: r.category, ports: r.ports.length, model: { support: r.model.support, family: r.model.family, modelId: r.model.modelId } })), null, 2) }], data: res };
    },
  },
  {
    name: "component.inspect",
    description: "Inspect a component definition by id — returns ports, models, fidelity checklist, electrical specs",
    inputSchema: { type: "object", properties: { componentId: { type: "string", description: "Catalog id, e.g. bmp280" } }, required: ["componentId"] },
    annotations: { readOnlyHint: true },
    execute: async ({ componentId }) => {
      const def = getCatalogComponent(componentId);
      if (!def) return { content: [{ type: "text", text: `Unknown component ${componentId}` }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(def, null, 2) }], data: def };
    },
  },
  {
    name: "component.add",
    description: "Add a hardware component to the current project; omit x and y for collision-aware automatic placement, or provide both finite numeric coordinates",
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
      const def = getCatalogComponent(componentId);
      if (!def) return { content: [{ type: "text", text: `Unknown component ${componentId}` }], isError: true };
      const hasX = typeof x !== "undefined";
      const hasY = typeof y !== "undefined";
      if (hasX !== hasY) return { content: [{ type: "text", text: "x and y must be provided together, or both omitted for automatic placement" }], isError: true };
      if (hasX && (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y))) {
        return { content: [{ type: "text", text: "x and y must both be finite numbers when coordinates are provided" }], isError: true };
      }
      const position = hasX ? { x: x as number, y: y as number } : undefined;
      const { id } = useProjectStore.getState().addComponent(componentId, position);
      useSelectionStore.getState().setActive(id);
      const resolvedPosition = useProjectStore.getState().project.components.find((component) => component.id === id)?.position ?? position;
      return { content: [{ type: "text", text: `Added ${componentId} as ${id} at (${resolvedPosition?.x}, ${resolvedPosition?.y})` }], data: { instanceId: id, position: resolvedPosition } };
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
      const def = getCatalogComponent(defId);
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
      const id = String(componentId ?? "");
      const project = useProjectStore.getState().project;
      const binding = resolveFirmwareBinding(project, id);
      if (!binding.component) return { content: [{ type: "text", text: `Unknown component ${id}` }], isError: true };
      if (!isBoardDefinition(binding.definition)) return { content: [{ type: "text", text: `${id} is not a programmable board` }], isError: true };
      if (!Array.isArray(files) || files.length === 0) return { content: [{ type: "text", text: "At least one firmware file is required" }], isError: true };
      const normalizedFiles = files.map((file: any) => ({ name: String(file?.name ?? "").trim(), content: typeof file?.content === "string" ? file.content : String(file?.content ?? "") }));
      if (normalizedFiles.some((file: { name: string }) => !file.name)) return { content: [{ type: "text", text: "Every firmware file needs a name" }], isError: true };
      const targetConfig = binding.targetConfig;
      if (boardFqbn && targetConfig && boardFqbn !== targetConfig.fqbn) {
        return { content: [{ type: "text", text: `${id} maps to ${targetConfig.fqbn}; refusing firmware for ${boardFqbn}` }], isError: true };
      }
      const targetLanguage = language ?? binding.target?.language ?? targetConfig?.language;
      const targetFqbn = boardFqbn ?? targetConfig?.fqbn ?? binding.target?.boardFqbn;
      useProjectStore.getState().updateFirmware(id, normalizedFiles, { language: targetLanguage, boardFqbn: targetFqbn });
      const codeIssues = validateFirmwareFiles(normalizedFiles);
      useValidationStore.getState().setCodeIssues(codeIssues);
      useSimulationStore.getState().appendSerial(`[firmware] ${id} updated · ${normalizedFiles.length} file(s)\n`);
      useSelectionStore.getState().setActive(id);
      return { content: [{ type: "text", text: `Firmware written for ${id} (${normalizedFiles.length} file(s))` }], data: { componentId: id, definitionId: binding.component.definitionId, language: targetLanguage, boardFqbn: targetFqbn, files: normalizedFiles.map((file: { name: string }) => file.name), codeIssues } };
    },
  },
  {
    name: "firmware.read",
    description: "Read firmware files for a board instance from the active project",
    inputSchema: { type: "object", properties: { componentId: { type: "string" } }, required: ["componentId"] },
    annotations: { readOnlyHint: true },
    execute: async ({ componentId }) => {
      const id = String(componentId ?? "");
      const binding = resolveFirmwareBinding(useProjectStore.getState().project, id);
      if (!binding.target) return { content: [{ type: "text", text: `No firmware for ${id}` }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify({ ...binding.target, definitionId: binding.component?.definitionId ?? binding.target.definitionId, definitionMatchesTarget: binding.definitionMatchesTarget }, null, 2) }], data: { ...binding.target, definitionId: binding.component?.definitionId ?? binding.target.definitionId, definitionMatchesTarget: binding.definitionMatchesTarget } };
    },
  },
  {
    name: "firmware.check",
    description: "Run browser-safe firmware diagnostics and publish them to Problems and Debug",
    inputSchema: { type: "object", properties: { componentId: { type: "string" } }, required: ["componentId"] },
    execute: async ({ componentId }) => {
      const id = String(componentId ?? "");
      const binding = resolveFirmwareBinding(useProjectStore.getState().project, id);
      const target = binding.target;
      if (!target) return { content: [{ type: "text", text: `No firmware for ${id}` }], isError: true };
      const targetIssues = !binding.component || !binding.definition
        ? [{ code: "INVALID_FIRMWARE_TARGET", message: `Firmware target ${id} references a missing board.` }]
        : !isBoardDefinition(binding.definition)
          ? [{ code: "NON_BOARD_FIRMWARE_TARGET", message: `${binding.definition.title} is not a programmable board.` }]
          : !target.definitionId
            ? [{ code: "FIRMWARE_DEFINITION_REQUIRED", message: "Firmware has no exact board definition binding." }]
            : !target.boardFqbn
              ? [{ code: "FIRMWARE_FQBN_REQUIRED", message: "Firmware has no explicit board FQBN." }]
          : !binding.definitionMatchesTarget
            ? [{ code: "FIRMWARE_DEFINITION_MISMATCH", message: `Firmware was written for ${target.definitionId}, but the current board is ${binding.component.definitionId}.` }]
            : !binding.fqbnMatchesDefinition
              ? [{ code: "FIRMWARE_FQBN_MISMATCH", message: `Firmware uses ${target.boardFqbn}, but the current board maps to ${binding.targetConfig?.fqbn}.` }]
            : [];
      const codeIssues = validateFirmwareFiles(target.files);
      useValidationStore.getState().setCodeIssues(codeIssues);
      useSimulationStore.getState().appendSerial(`[firmware] checked ${id} · ${codeIssues.length + targetIssues.length} diagnostic(s)\n`);
      return { content: [{ type: "text", text: JSON.stringify({ componentId: id, codeIssues, targetIssues }, null, 2) }], data: { componentId: id, codeIssues, targetIssues } };
    },
  },
  {
    name: "firmware.compile",
    description: "Compile firmware for a board; uses the remote compiler when connected and a browser preflight on static deployments",
    inputSchema: { type: "object", properties: { componentId: { type: "string" }, boardFqbn: { type: "string", description: "e.g. arduino:avr:uno" } }, required: ["componentId"] },
    execute: async ({ componentId, boardFqbn }, { signal } = {}) => {
      const proj = useProjectStore.getState().project;
      const id = String(componentId ?? "");
      const binding = resolveFirmwareBinding(proj, id);
      const tgt = binding.target;
      if (!tgt) {
        useValidationStore.getState().setCompile({ status: "error", log: `No firmware for ${id}`, checkedAt: Date.now() });
        return { content: [{ type: "text", text: `No firmware for ${id} — call firmware.write first` }], isError: true };
      }
      if (!binding.component || !binding.definition || !isBoardDefinition(binding.definition)) {
        const message = `${id} is not a valid programmable board target`;
        useValidationStore.getState().setCompile({ status: "error", log: message, checkedAt: Date.now() });
        return { content: [{ type: "text", text: message }], isError: true };
      }
      if (!binding.definitionMatchesTarget) {
        const message = `Firmware target ${id} was created for ${tgt.definitionId}, but the current board is ${binding.component.definitionId}`;
        useValidationStore.getState().setCompile({ status: "error", log: message, checkedAt: Date.now() });
        return { content: [{ type: "text", text: message }], isError: true };
      }
      if (boardFqbn && binding.targetConfig && boardFqbn !== binding.targetConfig.fqbn) {
        const message = `${id} maps to ${binding.targetConfig.fqbn}; refusing compilation for ${boardFqbn}`;
        useValidationStore.getState().setCompile({ status: "error", log: message, checkedAt: Date.now() });
        return { content: [{ type: "text", text: message }], isError: true };
      }
      if (!binding.fqbnMatchesDefinition && !boardFqbn) {
        const message = `Firmware target ${id} uses ${tgt.boardFqbn}, but the current board maps to ${binding.targetConfig?.fqbn}`;
        useValidationStore.getState().setCompile({ status: "error", log: message, checkedAt: Date.now() });
        return { content: [{ type: "text", text: message }], isError: true };
      }
      const fqbn = boardFqbn ?? tgt.boardFqbn ?? binding.targetConfig?.fqbn;
      const codeIssues = validateFirmwareFiles(tgt.files);
      useValidationStore.getState().setCodeIssues(codeIssues);
      if (!fqbn) {
        const message = `No compiler target is mapped for ${binding.definition.title}; provide boardFqbn explicitly or use a supported board.`;
        useValidationStore.getState().setCompile({ status: "unavailable", log: message, checkedAt: Date.now() });
        return { content: [{ type: "text", text: message }], data: { componentId: id, definitionId: binding.component.definitionId, available: false, error: message, codeIssues } };
      }
      useValidationStore.getState().setCompile({ status: "checking", boardFqbn: fqbn, log: "Checking source…", checkedAt: Date.now() });
      const result = await fetchJson("/api/compile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: tgt.files, board_fqbn: fqbn, component_id: id, definition_id: binding.component.definitionId, language: tgt.language ?? binding.targetConfig?.language }), signal });
      // A hosted Pages/Sites Function can be reachable while still lacking a
      // native arduino-cli binary. Treat its explicit preflight contract like
      // the fully static fallback instead of reporting a malformed compiler
      // success or blocking the rest of the behavioral runtime.
      if (result.available && result.response?.ok && result.data?.mode === "browser-preflight") {
        const preflight = result.data;
        const status = preflight.preflight?.balanced_braces === false || codeIssues.some((issue) => issue.severity === "error") ? "error" : "unavailable";
        useValidationStore.getState().setCompile({ status, boardFqbn: fqbn, log: JSON.stringify(preflight, null, 2), checkedAt: Date.now() });
        useSimulationStore.getState().appendSerial(`[firmware] ${status === "error" ? "compile failed" : "preflight complete"} · ${id}\n`);
        return { content: [{ type: "text", text: JSON.stringify(preflight, null, 2) }], data: { ...preflight, componentId: id, definitionId: binding.component.definitionId, codeIssues } };
      }
      if (!result.available) {
        const preflight = browserCompilePreflight(tgt.files, fqbn);
        const status = codeIssues.some((issue) => issue.severity === "error") ? "error" : "unavailable";
        useValidationStore.getState().setCompile({ status, boardFqbn: fqbn, log: JSON.stringify(preflight, null, 2), checkedAt: Date.now() });
        useSimulationStore.getState().appendSerial(`[firmware] ${status === "error" ? "compile failed" : "preflight complete"} · ${id}\n`);
        return { content: [{ type: "text", text: JSON.stringify(preflight, null, 2) }], data: { ...preflight, componentId: id, definitionId: binding.component.definitionId, codeIssues } };
      }
      if (!result.response?.ok) {
        useValidationStore.getState().setCompile({ status: "error", boardFqbn: fqbn, log: JSON.stringify(result.data, null, 2), checkedAt: Date.now() });
        return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }], data: result.data, isError: true };
      }
      if (result.data?.success !== true) {
        const message = result.data?.error || "Compiler returned no firmware artifact";
        useValidationStore.getState().setCompile({ status: "error", boardFqbn: fqbn, log: JSON.stringify(result.data, null, 2), checkedAt: Date.now() });
        useSimulationStore.getState().appendSerial(`[firmware] compile failed · ${id} · ${message}\n`);
        return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }], data: { ...result.data, componentId: id, definitionId: binding.component.definitionId, boardFqbn: fqbn }, isError: true };
      }
      const identity = result.data?.artifact_identity && typeof result.data.artifact_identity === "object"
        ? {
            componentId: result.data.artifact_identity.component_id ?? id,
            definitionId: result.data.artifact_identity.definition_id ?? binding.component.definitionId,
            sourceSha256: result.data.artifact_identity.source_sha256,
            artifactName: result.data.artifact_identity.artifact_name ?? null,
            artifactSha256: result.data.artifact_identity.artifact_sha256 ?? null,
            boardFqbn: result.data.artifact_identity.board_fqbn ?? fqbn,
            language: result.data.artifact_identity.language ?? tgt.language ?? binding.targetConfig?.language,
            compiler: result.data.artifact_identity.compiler ?? null,
          }
        : undefined;
      useProjectStore.getState().setCompiledArtifact(id, {
        success: true,
        log: JSON.stringify(result.data, null, 2),
        hexB64: typeof result.data?.hex_content === "string" ? btoa(result.data.hex_content) : undefined,
        binB64: typeof result.data?.binary_content === "string" ? base64FromHex(result.data.binary_content) : undefined,
        identity,
      });
      useValidationStore.getState().setCompile({ status: "success", boardFqbn: fqbn, log: JSON.stringify(result.data, null, 2), checkedAt: Date.now() });
      useSimulationStore.getState().appendSerial(`[firmware] compiled · ${id}\n`);
      return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }], data: { ...result.data, componentId: id, definitionId: binding.component.definitionId, boardFqbn: fqbn } };
    },
  },
  {
    name: "simulation.run",
    description: "Run simulation for current project (uses remote engines when connected, otherwise a browser runtime)",
    inputSchema: { type: "object", properties: { durationMs: { type: "number", description: "Duration ms, default 1000" } } },
    execute: async ({ durationMs }, { signal } = {}) => {
      const project = useProjectStore.getState().project;
      const inputs = useSimulationStore.getState().pinStates;
      const boundedDurationMs = durationMs ?? 1000;
      const validation = validateProject(project);
      const topology = runTopologyCheck(project, inputs, boundedDurationMs);
      // Keep agent-triggered runs aligned with the Studio button: a missing
      // executable model must not suppress canonical wiring diagnostics.
      useValidationStore.getState().setResult(validation);
      useSimulationStore.getState().start();
      // The bounded portable contract is deliberately browser-first so a
      // connected backend cannot silently replace the C/WASM trace with a
      // different interpreter. More complex projects retain the remote-first
      // path and fall back to the explicit browser interpreter when offline.
      if (hasPortableButtonLedContract(project)) {
        const res = enrichRunResult(await runBrowserSimulation(project, inputs, boundedDurationMs), topology, validation);
        useSimulationStore.getState().setLastRun(res);
        if (res.status === "unsupported-api" && res.codeExecution?.status !== "unavailable") {
          return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }], data: res, isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }], data: res };
      }
      const sessionId = useSimulationStore.getState().remoteSessionId;
      const result = await fetchJson("/api/simulation/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project, inputs, duration_ns: boundedDurationMs * 1e6, ...(sessionId ? { session_id: sessionId } : {}) }), signal });
      const remoteContract = result.available && result.data && typeof result.data === "object" && result.data.runtime === "remote" && result.data.execution_mode === "behavioral";
      const remotePayload = remoteContract && result.response?.ok;
      const degradedRemote = remoteContract && DEGRADED_RUN_STATUSES.has(String(result.data.status));
      const remote = remotePayload && (result.data.status === "completed" || result.data.status === "completed-with-warnings");
      if (degradedRemote) {
        const normalized = enrichRunResult(normalizeRemoteRun(result.data, topology), topology, validation);
        const simulation = useSimulationStore.getState();
        simulation.setTime(BigInt(Math.round(boundedDurationMs * 1_000_000)));
        for (const [portId, value] of Object.entries(normalized.outputs)) {
          if (typeof value === "boolean" || typeof value === "number") simulation.setPin(portId, value);
        }
        simulation.setLastRun(normalized);
        simulation.appendSerial(`[${project.name}] remote checks complete · browser code execution unavailable\n`);
        simulation.stop();
        return { content: [{ type: "text", text: JSON.stringify(normalized, null, 2) }], data: normalized };
      }
      if (remotePayload && !remote) {
        useSimulationStore.getState().stop();
        return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }], data: result.data, isError: true };
      }
      if (result.available && result.response && !result.response.ok && result.data && typeof result.data === "object") {
        useSimulationStore.getState().stop();
        return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }], data: result.data, isError: true };
      }
      if (!remotePayload && result.available && result.response?.ok && result.data && typeof result.data === "object") {
        useSimulationStore.getState().stop();
        const contractError = { status: "invalid-response", error: "Simulation backend returned a JSON response without the remote behavioral contract.", response: result.data };
        return { content: [{ type: "text", text: JSON.stringify(contractError, null, 2) }], data: contractError, isError: true };
      }
      if (!remote) {
        const res = enrichRunResult(await runBrowserSimulation(project, inputs, boundedDurationMs), topology, validation);
        const reason = result.available && !result.response?.ok ? ` Backend HTTP ${result.response?.status ?? "unknown"};` : "";
        res.note = `${res.note}${reason} Browser runtime is the active execution path.`;
        useSimulationStore.getState().setLastRun(res);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }], data: res };
      }
      const res = result.data;
      const normalized = enrichRunResult(normalizeRemoteRun(res, topology), topology, validation);
      const timeNs = BigInt(normalized.durationMs * 1_000_000);
      const simulation = useSimulationStore.getState();
      simulation.setRemoteSessionId(typeof res.session_id === "string" ? res.session_id : null);
      simulation.setTime(timeNs);
      for (const [portId, value] of Object.entries(normalized.outputs)) {
        if (typeof value === "boolean" || typeof value === "number") simulation.setPin(portId, value);
      }
      simulation.setLastRun(normalized);
      const readings = Object.entries(normalized.outputs).map(([key, value]) => `${key.split(":").pop()}=${value}`).join("  ");
      simulation.appendSerial(`[${project.name}] remote runtime · t=${timeNs}ns${readings ? `  ${readings}` : ""}\n${normalized.serialOutput}`);
      simulation.stop();
      return { content: [{ type: "text", text: JSON.stringify(normalized, null, 2) }], data: normalized };
    },
  },
  {
    name: "simulation.stop",
    description: "Stop simulation",
    inputSchema: { type: "object", properties: {} },
    execute: async (_args, { signal } = {}) => {
      useSimulationStore.getState().stop();
      const sessionId = useSimulationStore.getState().remoteSessionId;
      const result = await fetchJson("/api/simulation/stop", { method: "POST", body: JSON.stringify(sessionId ? { session_id: sessionId } : {}), signal });
      useSimulationStore.getState().setRemoteSessionId(null);
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
      const state = { running: sim.running, timeNs: sim.timeNs.toString(), pinStates: sim.pinStates, engineStatus: sim.engineStatus, remoteSessionId: sim.remoteSessionId, lastRun: sim.lastRun, serialOutput: sim.serialOutput.slice(-500) };
      return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }], data: state };
    },
  },
  {
    name: "simulation.set_input",
    description: "Set sensor input (e.g. motion=true, temperature=25) for simulation",
    inputSchema: { type: "object", properties: { componentId: { type: "string" }, key: { type: "string" }, value: {} } , required: ["componentId", "key", "value"]},
    execute: async ({ componentId, key, value }, { signal } = {}) => {
      throwIfAborted(signal);
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
        let ws: WebSocket | undefined;
        const closeOnAbort = () => ws?.close();
        signal?.addEventListener("abort", closeOnAbort, { once: true });
        try {
          const auth = await getAuthSession(false, signal);
          throwIfAborted(signal);
          const wsUrl = new URL(apiUrl("/api/simulation/ws"), backendUrl);
          wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
          // Browser WebSocket cannot set Authorization headers. Offer the
          // short-lived ticket as a subprotocol instead of putting a bearer
          // token in the URL where it can leak into logs, history, or proxy
          // analytics. Local development can use its explicit local session
          // credential when the ticket endpoint is not enabled.
          let protocols = auth?.token ? ["schematic-bearer", `schematic-token.${auth.token}`] : ["schematic-local"];
          if (auth?.token && auth.environment !== "local") {
            const ticket = await fetchJson("/api/auth/ws-ticket", { method: "POST", signal });
            throwIfAborted(signal);
            if (ticket.response?.ok && typeof ticket.data?.ticket === "string") protocols = ["schematic-bearer", `schematic-ticket.${ticket.data.ticket}`];
          }
          throwIfAborted(signal);
          const socket = new WebSocket(wsUrl.toString(), protocols);
          ws = socket;
          socket.onopen = () => {
            if (signal?.aborted) {
              socket.close();
              return;
            }
            socket.send(JSON.stringify({ op: "set_sensor_input", componentId, key, value, session_id: useSimulationStore.getState().remoteSessionId }));
            socket.close();
          };
        } catch (error) {
          if (signal?.aborted || (error as Error)?.name === "AbortError") throw signal?.aborted ? abortError() : error;
        } finally {
          signal?.removeEventListener("abort", closeOnAbort);
        }
      }
      throwIfAborted(signal);
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
    description: "Publish exact part listings found by an authenticated WebMCP shopping agent. The UI and frontend never generate fallback listings or retailer links.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Exact part, board, manufacturer, or catalog id" },
        quantity: { type: "number", description: "Required quantity" },
        listings: {
          type: "array",
          minItems: 1,
          description: "Agent-found listings only; every item must identify one canonical catalog part and its exact sourced offers.",
          items: {
            type: "object",
            required: ["id", "catalogId", "title", "partNumber", "requestedQuantity", "exactMatch", "offers", "updatedAt"],
            properties: {
              id: { type: "string" },
              catalogId: { type: "string", description: "Schematic catalog id; do not invent one" },
              title: { type: "string" },
              partNumber: { type: "string", description: "Manufacturer or distributor part number" },
              requestedQuantity: { type: "integer", minimum: 1 },
              exactMatch: { const: true },
              updatedAt: { type: "string", format: "date-time", description: "Recent time at which the agent refreshed this catalog match." },
              offers: {
                type: "array",
                minItems: 1,
                maxItems: 3,
                items: {
                  type: "object",
                  required: ["id", "retailer", "title", "price", "currency", "url", "fetchedAt", "provider"],
                  properties: {
                    id: { type: "string" }, retailer: { type: "string" }, title: { type: "string" },
                    price: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
                    currency: { type: "string", pattern: "^[A-Z]{3}$" }, url: { type: "string", format: "uri", description: "HTTPS retailer URL supplied by the agent; the UI does not verify the page." },
                    fetchedAt: { type: "string", format: "date-time", description: "Recent time at which the agent observed this offer." }, provider: { type: "string" },
                  },
                },
              },
              alternatives: { type: "array", description: "Optional context-aware alternatives; publish each alternative as its own exact listing too." },
            },
          },
        },
        publication: { type: "object", description: "Sourcing provenance supplied by the agent. Authentication and agent identity come from the verified WebMCP session, not from these fields. publishedAt must be recent.", properties: { provider: { type: "string" }, publishedAt: { type: "string", format: "date-time" } }, required: ["provider", "publishedAt"] },
      },
      required: ["listings", "publication"],
    },
    annotations: { untrustedContentHint: true },
    execute: async ({ query = "", quantity = 1, listings, publication, __trustedAuth }) => {
      const requestedQuantity = Math.max(1, Math.min(999, Math.round(Number(quantity) || 1)));
      const searchQuery = String(query ?? "");
      const shopping = useShoppingStore.getState();
      shopping.setQuery(searchQuery);
      if (!Array.isArray(listings) || listings.length === 0) {
        shopping.setResults([]);
        const data = { query: searchQuery, source: "webmcp-agent-required", liveOffers: false, results: [], requiresWebMCPAgent: true };
        return { content: [{ type: "text", text: "Parts shopping requires a connected, authenticated WebMCP agent to publish listings. No local or provider fallback was used." }], data, isError: true };
      }
      const trustedAuth = __trustedAuth as TrustedToolContext | undefined;
      if (!trustedAuth?.authenticated || !trustedAuth.subject) {
        shopping.setResults([]);
        const data = { query: searchQuery, source: "webmcp-agent-required", liveOffers: false, results: [], requiresWebMCPAgent: true };
        return { content: [{ type: "text", text: "Listing publication was rejected because no trusted WebMCP session was present." }], data, isError: true };
      }
      const requestedPublication = publication && typeof publication === "object" ? publication as Record<string, unknown> : {};
      const provider = String(requestedPublication.provider ?? "").trim();
      const publishedAt = String(requestedPublication.publishedAt ?? "").trim();
      if (!provider || !publishedAt) {
        shopping.setResults([]);
        const data = { query: searchQuery, source: "webmcp-agent-required", liveOffers: false, results: [], requiresWebMCPAgent: true };
        return { content: [{ type: "text", text: "Each WebMCP publication must include the parts provider and the time the agent sourced the listings." }], data, isError: true };
      }
      const trustedPublication: AgentPublication = {
        authenticated: true,
        agentId: `webmcp:${trustedAuth.environment}:${trustedAuth.subject}`,
        provider,
        publishedAt,
      };
      const normalized = bindShoppingPublication(normalizeShoppingResults(listings, searchQuery, requestedQuantity), trustedPublication, trustedAuth);
      const publicationResult = shopping.publishAgentResults(normalized, trustedPublication);
      const results = useShoppingStore.getState().results;
      const data = {
        query: searchQuery,
        source: "webmcp-agent",
        // A price value is not proof that a retailer page is live or in stock.
        // Preserve the legacy field as a conservative capability flag and
        // expose the useful fact separately for callers that need it.
        liveOffers: false,
        pricedOffers: results.some((result) => result.offers.some((offer) => offer.price !== null)),
        accepted: publicationResult.accepted,
        rejected: publicationResult.rejected,
        results,
        requiresWebMCPAgent: true,
      };
      if (!publicationResult.accepted) {
        return { content: [{ type: "text", text: publicationResult.message ?? "The WebMCP agent publication was rejected." }], data, isError: true };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        data,
      };
    },
  },
  {
    name: "shopping.get_state",
    description: "Read agent-sourced part listings, cart lines, budget, and cheapest-price quote for the current build",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
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
    annotations: { untrustedContentHint: true },
    execute: async ({ resultId, quantity }) => {
      const id = String(resultId);
      const result = useShoppingStore.getState().results.find((item) => item.id === id);
      if (!result) return { content: [{ type: "text", text: `Unknown shopping result ${id}; search for the part first` }], isError: true };
      if (!result.exactMatch) return { content: [{ type: "text", text: `${result.title} is not an exact catalog match; verify the part number before adding it to the cart` }], isError: true };
      useShoppingStore.getState().addToCart(id, Number(quantity) || 1);
      return { content: [{ type: "text", text: JSON.stringify(useShoppingStore.getState().getQuote(), null, 2) }], data: useShoppingStore.getState().getQuote() };
    },
  },
  {
    name: "shopping.cart_remove",
    description: "Remove a part from the shopping cart",
    inputSchema: { type: "object", properties: { resultId: { type: "string" } }, required: ["resultId"] },
    annotations: { untrustedContentHint: true },
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
    annotations: { untrustedContentHint: true },
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
    annotations: { untrustedContentHint: true },
    execute: async ({ budget }) => {
      useShoppingStore.getState().setBudget(budget === null ? null : Number(budget));
      return { content: [{ type: "text", text: JSON.stringify(useShoppingStore.getState().getQuote(), null, 2) }], data: useShoppingStore.getState().getQuote() };
    },
  },
  {
    name: "shopping.cart_undo",
    description: "Undo the last cart change",
    inputSchema: { type: "object", properties: {} },
    annotations: { untrustedContentHint: true },
    execute: async () => {
      useShoppingStore.getState().undoCart();
      return { content: [{ type: "text", text: JSON.stringify(useShoppingStore.getState().getQuote(), null, 2) }], data: useShoppingStore.getState().getQuote() };
    },
  },
  {
    name: "shopping.cart_reset",
    description: "Reset the cart to one of every catalog part currently required by the project, after listings have been searched",
    inputSchema: { type: "object", properties: { requiredCatalogIds: { type: "array", items: { type: "string" } } } },
    annotations: { untrustedContentHint: true },
    execute: async ({ requiredCatalogIds }) => {
      const project = useProjectStore.getState().project;
      const ids = Array.isArray(requiredCatalogIds) && requiredCatalogIds.length ? requiredCatalogIds.map(String) : project.components.map((component) => component.definitionId);
      const availableIds = new Set(useShoppingStore.getState().results.filter((result) => result.exactMatch).map((result) => result.catalogId));
      const missingCatalogIds = [...new Set(ids)].filter((catalogId) => !availableIds.has(catalogId));
      useShoppingStore.getState().resetCart(ids);
      const data = { requiredCatalogIds: ids, missingCatalogIds, quote: useShoppingStore.getState().getQuote() };
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], data };
    },
  },
  {
    name: "shopping.choose_alternative",
    description: "Replace a cart part with an agent-recommended context-aware alternative",
    inputSchema: { type: "object", properties: { resultId: { type: "string" }, catalogId: { type: "string" } }, required: ["resultId", "catalogId"] },
    annotations: { untrustedContentHint: true },
    execute: async ({ resultId, catalogId }) => {
      const changed = useShoppingStore.getState().chooseAlternative(String(resultId), String(catalogId));
      if (!changed) return { content: [{ type: "text", text: "Alternative is not available as a searched result yet" }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(useShoppingStore.getState().getQuote(), null, 2) }], data: useShoppingStore.getState().getQuote() };
    },
  },
  {
    name: "shopping.quote",
    description: "Calculate the total using the cheapest priced agent-sourced offer per cart line and report missing prices or budget overage",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
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
      const next = layoutComponentPositions(proj.components);
      useProjectStore.getState().loadProject({ ...proj, components: next });
      return { content: [{ type: "text", text: `Auto-layout applied to ${next.length} components` }] };
    },
  },
];

/** Single source of truth for the tool count shown in the product UI. */
export const WEBMCP_TOOL_COUNT = tools.length;

let controllers: AbortController[] = [];
let registrationGeneration = 0;

async function executeToolWithActivity(tool: ToolDef, args: Record<string, any> = {}, signal?: AbortSignal) {
  throwIfAborted(signal);
  const activityId = useWebMCPStore.getState().beginTool(tool.name, args);
  try {
    // Keep the public landing page from becoming an unauthenticated mutation
    // surface. Local development has the explicit development session; hosted
    // builds must have a platform-verified identity before any agent action.
    const hosted = typeof window !== "undefined" && !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
    const session = await getAuthSession(false, signal);
    if (hosted && !session) {
      const denied = {
        content: [{ type: "text", text: "Sign in to use Schematic WebMCP tools; project state is scoped to your verified account." }],
        isError: true,
      };
      useWebMCPStore.getState().finishTool(activityId, denied, true);
      return denied;
    }
    const trustedAuth: TrustedToolContext | undefined = session
      ? { authenticated: true, subject: session.subject, environment: session.environment }
      : undefined;
    throwIfAborted(signal);
    const result = await tool.execute({ ...args, __trustedAuth: trustedAuth }, { signal });
    throwIfAborted(signal);
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
  const generation = ++registrationGeneration;
  // Auth and persistence share startup gates with App. Waiting here keeps a
  // direct Site import safe as well as the Vite entrypoint.
  await waitForAuth();
  await waitForProjectPersistence();
  if (generation !== registrationGeneration) return;
  useWebMCPStore.getState().setRegistration({ state: "checking", registeredCount: 0, error: undefined });
  const existingModelContext: any = (document as any).modelContext ?? (navigator as any).modelContext;
  const hasNativeModelContext = typeof existingModelContext?.registerTool === "function";
  installModelContextProducerPolyfill();
  installModelContextTestingPolyfill();
  const mc: any = (document as any).modelContext ?? (navigator as any).modelContext;
  // Test/degraded-runtime fallback only. Native agents must use the
  // document.modelContext registration below; this same-origin object is not a
  // cross-origin mutation bridge.
  (window as any).__schematicTools = Object.fromEntries(tools.map((t) => [t.name, (args: Record<string, unknown>, context?: ToolExecutionContext | AbortSignal) => executeToolWithActivity(t, args, executionSignal(context))]));
  if (!mc || typeof mc.registerTool !== "function") {
    useWebMCPStore.getState().setRegistration({ state: "unavailable", registeredCount: 0, error: "The browser did not expose document.modelContext." });
    console.warn("[WebMCP] modelContext not available — run in the supported in-app browser, or use the test/degraded-runtime fallback");
    return;
  }
  let registeredCount = 0;
  let registrationErrors = 0;
  for (const t of tools) {
    if (generation !== registrationGeneration) return;
    const ctrl = new AbortController();
    controllers.push(ctrl);
    try {
      await mc.registerTool(
        {
          name: t.name,
          description: t.description + " — Scoped to your verified account and its local project room. Agent may place hardware on your behalf within your room only.",
          inputSchema: t.inputSchema,
          annotations: t.annotations,
          execute: (args: Record<string, unknown>, context?: ToolExecutionContext | AbortSignal) => executeToolWithActivity(t, args, executionSignal(context)),
        },
        { signal: ctrl.signal },
      );
      registeredCount += 1;
      console.log(`[WebMCP] registered ${t.name} (room-aware)`);
    } catch (e) {
      registrationErrors += 1;
      console.error(`[WebMCP] failed to register ${t.name}:`, e);
    }
  }
  // listen for toolchange
  if ("ontoolchange" in mc) {
    mc.ontoolchange = () => console.log("[WebMCP] toolset changed");
  }
  useWebMCPStore.getState().setRegistration({
    state: registrationErrors > 0 ? "error" : hasNativeModelContext ? "native" : "fallback",
    registeredCount,
    ...(registrationErrors > 0 ? { error: `${registrationErrors} tool registration${registrationErrors === 1 ? "" : "s"} failed.` } : { error: undefined }),
  });
  console.log(`[WebMCP] ready — ${WEBMCP_TOOL_COUNT} tools, room:`, (window as any).__schematicRoom?.() || "global", "— agent may now place hardware on your behalf inside your room");
}

export function unregisterWebMCPTools() {
  registrationGeneration += 1;
  for (const c of controllers) c.abort();
  controllers = [];
}

export function getRegisteredToolNames() {
  return tools.map((t) => t.name);
}

/** Invoke the exact same callback registered with document.modelContext. */
export async function invokeWebMCPTool(name: string, args: Record<string, any> = {}, signal?: AbortSignal) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Unknown WebMCP tool: ${name}`);
  return executeToolWithActivity(tool, args, signal);
}
