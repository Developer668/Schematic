/**
 * The static Cloudflare deployment shares the same deterministic behavioral
 * runtime as the browser and the FastAPI service.  This keeps the Pages
 * deployment useful without Docker or a second process: unsupported binary
 * compilation is reported as a preflight result, while supported firmware
 * can still execute against the exact graph and catalog definitions.
 */
import { runFirmwareRuntime, type RuntimeResult } from "../../frontend/src/simulation/runtime";
import { boardTargetFor } from "../../frontend/src/data/hardware";
import { catalog, getCatalogComponent, searchCatalog } from "../../frontend/src/data/catalog";
import { analyzeImport } from "../../packages/component-format/src/importer";
import type { HardwareGraph } from "../../frontend/src/store/useProjectStore";
import { issueSessionToken, platformIdentity, verifySessionToken, type AuthEnv, type SessionIdentity } from "../_auth";

type ApiContext = { request: Request; env: AuthEnv };

const MAX_PROJECT_BYTES = 2_000_000;
const MAX_SOURCE_BYTES = 1_000_000;
const MAX_SESSIONS = 128;
const sessions = new Map<string, { owner: string; result: Record<string, unknown>; updatedAt: number }>();

function trimOrigin(value: string) {
  return value.replace(/\/+$/, "");
}

function allowedOrigin(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  if (!origin) return "";
  try {
    const url = new URL(origin);
    const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    const hosted = url.protocol === "https:" && (url.hostname.endsWith(".pages.dev") || url.hostname.endsWith(".chatgpt.site") || url.hostname.endsWith(".chatgpt.com") || url.hostname.endsWith(".openai.com"));
    return (local || hosted) ? trimOrigin(origin) : "";
  } catch {
    return "";
  }
}

export function corsHeaders(request: Request) {
  const origin = allowedOrigin(request);
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true" } : {}),
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function jsonResponse(request: Request, body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...corsHeaders(request), "Cache-Control": "no-store", ...extra } });
}

export function optionsResponse(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

function bearer(request: Request) {
  const value = request.headers.get("authorization") ?? "";
  const [scheme, token] = value.split(/\s+/, 2);
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

export async function requireApiIdentity({ request, env }: ApiContext): Promise<SessionIdentity | null> {
  const token = bearer(request);
  if (token) return verifySessionToken(token, env);
  return platformIdentity(request, env);
}

function protocolCredential(request: Request) {
  const protocols = (request.headers.get("sec-websocket-protocol") ?? "")
    .split(",")
    .map((value) => value.trim());
  const ticket = protocols.find((value) => value.startsWith("schematic-ticket."));
  if (ticket) return { token: ticket.slice("schematic-ticket.".length), audience: "schematic-ws" } as const;
  const session = protocols.find((value) => value.startsWith("schematic-token."));
  return session ? { token: session.slice("schematic-token.".length), audience: "schematic-api" } as const : null;
}

export async function requireWebSocketIdentity(request: Request, env: AuthEnv) {
  const credential = protocolCredential(request);
  if (credential) return verifySessionToken(credential.token, env, credential.audience);
  return requireApiIdentity({ request, env });
}

export function unauthorized(request: Request) {
  return jsonResponse(request, { authenticated: false, error: "Sign in to use this Schematic workspace" }, 401);
}

export async function issueIdentityToken(identity: SessionIdentity, env: AuthEnv) {
  return issueSessionToken(identity, env);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function normalizeProject(value: unknown): HardwareGraph | null {
  const source = asRecord(value);
  if (!source) return null;
  const components = Array.isArray(source.components) ? source.components.filter((item) => asRecord(item)).map((item) => {
    const component = item as Record<string, unknown>;
    return {
      id: String(component.id ?? ""),
      definitionId: String(component.definitionId ?? component.definition_id ?? ""),
      position: { x: Number((component.position as Record<string, unknown> | undefined)?.x ?? 0), y: Number((component.position as Record<string, unknown> | undefined)?.y ?? 0) },
      rotation: [0, 90, 180, 270].includes(Number(component.rotation)) ? Number(component.rotation) as 0 | 90 | 180 | 270 : 0,
      properties: asRecord(component.properties) ?? {},
      ...(component.label ? { label: String(component.label) } : {}),
    };
  }).filter((component) => component.id && component.definitionId) : [];
  const connections = Array.isArray(source.connections) ? source.connections.filter((item) => asRecord(item)).map((item) => {
    const connection = item as Record<string, unknown>;
    const left = asRecord(connection.source);
    const right = asRecord(connection.target);
    return {
      id: String(connection.id ?? ""),
      source: { componentId: String(left?.componentId ?? ""), portId: String(left?.portId ?? "") },
      target: { componentId: String(right?.componentId ?? ""), portId: String(right?.portId ?? "") },
      domain: String(connection.domain ?? "gpio"),
    };
  }).filter((connection) => connection.id && connection.source.componentId && connection.target.componentId && connection.source.portId && connection.target.portId) : [];
  const rawFirmwareTargets = source.firmwareTargets ?? source.firmware_targets;
  const firmwareTargets = Array.isArray(rawFirmwareTargets) ? rawFirmwareTargets
    .filter((item): item is Record<string, unknown> => Boolean(asRecord(item)))
    .map((target) => {
    const files = Array.isArray(target.files) ? target.files.filter((file) => asRecord(file)).map((file) => {
      const sourceFile = file as Record<string, unknown>;
      return { name: String(sourceFile.name ?? "sketch.ino"), content: String(sourceFile.content ?? "") };
    }) : [];
    return {
      id: String(target.id ?? ""),
      componentId: String(target.componentId ?? target.component_id ?? ""),
      ...(target.definitionId || target.definition_id ? { definitionId: String(target.definitionId ?? target.definition_id) } : {}),
      ...(target.language ? { language: String(target.language) } : {}),
      ...(target.boardFqbn || target.board_fqbn ? { boardFqbn: String(target.boardFqbn ?? target.board_fqbn) } : {}),
      files,
    };
  }).filter((target) => target.id && target.componentId) : [];
  if (JSON.stringify(source).length > MAX_PROJECT_BYTES) return null;
  return {
    id: String(source.id ?? "hosted-project"),
    name: String(source.name ?? "Untitled").slice(0, 120),
    components,
    connections,
    firmwareTargets,
  } as HardwareGraph;
}

function boundedDurationMs(value: unknown) {
  const raw = Number(value ?? 1000);
  return Math.max(0, Math.min(Number.isFinite(raw) ? raw : 1000, 86_400_000));
}

function sessionId() {
  return `pages-sim-${typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function asRemoteResult(result: RuntimeResult, id: string) {
  return {
    ...result,
    runtime: "remote",
    execution_mode: "behavioral",
    session_id: id,
    duration_ns: Math.round(result.durationMs * 1_000_000),
    time_ns: Math.round(result.durationMs * 1_000_000),
    resolved_nets: result.resolvedNets,
    serial_output: result.serialOutput,
    target_issues: result.targetIssues,
    protocol_events: result.protocolEvents,
    device_states: result.deviceStates,
    unsupported_apis: result.unsupportedApis,
  };
}

function safeInputs(value: unknown) {
  const source = asRecord(value) ?? {};
  const inputs: Record<string, boolean | number> = {};
  for (const [key, entry] of Object.entries(source)) if ((typeof entry === "boolean" || typeof entry === "number") && Number.isFinite(Number(entry))) inputs[key] = entry;
  return inputs;
}

function runProject(project: HardwareGraph, inputs: Record<string, boolean | number>, durationMs: number, id: string) {
  return asRemoteResult(runFirmwareRuntime(project, inputs, durationMs), id);
}

export async function runSimulation(request: Request, env: AuthEnv) {
  const identity = await requireApiIdentity({ request, env });
  if (!identity) return unauthorized(request);
  let payload: unknown;
  try { payload = await request.json(); } catch { return jsonResponse(request, { error: "Request body must be JSON" }, 400); }
  const body = asRecord(payload);
  const project = normalizeProject(body?.project);
  if (!project) return jsonResponse(request, { error: "A valid project graph is required" }, 422);
  const safeInputValues = safeInputs(body?.inputs);
  const durationMs = boundedDurationMs(Number(body?.duration_ns ?? 1_000_000) / 1_000_000);
  const id = typeof body?.session_id === "string" && body.session_id.trim() ? body.session_id.trim().slice(0, 160) : sessionId();
  const existing = sessions.get(id);
  if (existing && existing.owner !== identity.subject) {
    return jsonResponse(request, { error: "session_id is owned by another room" }, 403);
  }
  const result = runProject(project, safeInputValues, durationMs, id);
  sessions.set(id, { owner: identity.subject, result, updatedAt: Date.now() });
  while (sessions.size > MAX_SESSIONS) {
    const oldest = [...sessions.entries()].sort((left, right) => left[1].updatedAt - right[1].updatedAt)[0]?.[0];
    if (!oldest) break;
    sessions.delete(oldest);
  }
  return jsonResponse(request, result);
}

export async function stopSimulation(request: Request, env: AuthEnv) {
  const identity = await requireApiIdentity({ request, env });
  if (!identity) return unauthorized(request);
  let body: Record<string, unknown> | null = null;
  try { body = asRecord(await request.json()); } catch { /* an empty stop body is valid */ }
  const requested = typeof body?.session_id === "string" ? body.session_id : null;
  if (requested) {
    const record = sessions.get(requested);
    if (record && record.owner !== identity.subject) return jsonResponse(request, { error: "session_id is owned by another room" }, 403);
    sessions.delete(requested);
  }
  return jsonResponse(request, { status: "stopped", session_id: requested });
}

export async function simulationState(request: Request, env: AuthEnv) {
  const identity = await requireApiIdentity({ request, env });
  if (!identity) return unauthorized(request);
  const id = new URL(request.url).searchParams.get("session_id");
  const record = id ? sessions.get(id) : undefined;
  if (record && record.owner !== identity.subject) return jsonResponse(request, { error: "session_id is owned by another room" }, 403);
  return jsonResponse(request, record ? { session_id: id, time_ns: record.result.time_ns, running: false, result: record.result } : { session_id: id, time_ns: 0, running: false, result: null });
}

export async function simulationStep(request: Request, env: AuthEnv) {
  return runSimulation(request, env);
}

/**
 * Real-time edge transport for the interactive simulator. The browser sends
 * its short-lived/session bearer through Sec-WebSocket-Protocol rather than a
 * URL query parameter. The selected protocol is only a label; the token is
 * verified before the socket is accepted.
 */
export async function simulationWebSocket(request: Request, env: AuthEnv) {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return jsonResponse(request, { error: "WebSocket upgrade required" }, 426);
  const identity = await requireWebSocketIdentity(request, env);
  if (!identity) return new Response("Unauthorized", { status: 401, headers: corsHeaders(request) });
  const Pair = (globalThis as unknown as { WebSocketPair?: new () => { 0: WebSocket; 1: WebSocket } }).WebSocketPair;
  if (!Pair) return jsonResponse(request, { error: "WebSocket runtime is unavailable" }, 501);
  const pair = new Pair();
  const client = pair[0];
  const server = pair[1] as WebSocket & { accept: () => void };
  server.accept();
  let activeSessionId: string | null = null;
  const pendingInputs: Record<string, boolean | number> = {};
  const send = (value: unknown) => server.send(JSON.stringify(value));
  server.addEventListener("close", () => {
    activeSessionId = null;
  });
  server.addEventListener("error", () => {
    try { server.close(); } catch { /* the peer may already have closed */ }
  });
  server.addEventListener("message", (event) => {
    void (async () => {
      try {
        const data = JSON.parse(String(event.data));
        if (!data || typeof data !== "object" || Array.isArray(data)) return send({ type: "error", code: "INVALID_MESSAGE", message: "WebSocket messages must be JSON objects." });
        if (data.op === "set_sensor_input") {
          if (typeof data.value !== "boolean" && typeof data.value !== "number") return send({ type: "error", code: "INVALID_INPUT", message: "Sensor input must be boolean or numeric." });
          const key = `${String(data.componentId ?? "")}:${String(data.key ?? "value")}`;
          pendingInputs[key] = data.value;
          return send({ type: "sensor_ack", session_id: activeSessionId, componentId: data.componentId, key: data.key, value: data.value });
        }
        if (data.op === "run") {
          const project = normalizeProject(data.project);
          if (!project) return send({ type: "error", code: "INVALID_PROJECT", message: "A valid project graph is required." });
          const supplied = safeInputs(data.inputs);
          const resultId = typeof data.session_id === "string" && data.session_id.trim() ? data.session_id.trim().slice(0, 160) : sessionId();
          const existing = sessions.get(resultId);
          if (existing && existing.owner !== identity.subject) return send({ type: "error", code: "SESSION_FORBIDDEN", message: "simulation session is owned by another room" });
          const result = runProject(project, { ...pendingInputs, ...supplied }, boundedDurationMs(Number(data.duration_ns ?? 1_000_000) / 1_000_000), resultId);
          activeSessionId = resultId;
          sessions.set(resultId, { owner: identity.subject, result, updatedAt: Date.now() });
          return send({ type: "simulation_result", ...result });
        }
        if (data.op === "stop") {
          if (activeSessionId) sessions.delete(activeSessionId);
          send({ type: "simulation_state", session_id: activeSessionId, status: "stopped" });
          activeSessionId = null;
          return;
        }
        if (data.op === "read_pin") {
          const record = activeSessionId ? sessions.get(activeSessionId) : undefined;
          if (!record || record.owner !== identity.subject) return send({ type: "error", code: "SESSION_FORBIDDEN", message: "simulation session is not initialized" });
          const portId = String(data.portId ?? "");
          const outputs = asRecord(record.result.outputs);
          return send({ type: "pin_value", session_id: activeSessionId, portId, value: { digital: outputs?.[portId] } });
        }
        send({ type: "error", code: "UNKNOWN_OPERATION", message: `unknown op ${String(data.op)}` });
      } catch (error) {
        send({ type: "error", code: "SIMULATION_ERROR", message: error instanceof Error ? error.message : "Unable to process WebSocket message" });
      }
    })();
  });
  const headers = { ...corsHeaders(request), "Sec-WebSocket-Protocol": (request.headers.get("sec-websocket-protocol") ?? "").split(",").map((value) => value.trim()).includes("schematic-bearer") ? "schematic-bearer" : "schematic-local" };
  return new Response(null, { status: 101, headers, webSocket: client } as ResponseInit & { webSocket: WebSocket });
}

function balancedSource(source: string) {
  const stack: string[] = [];
  let quote = "";
  let escaped = false;
  const pairs: Record<string, string> = { "}": "{", ")": "(", "]": "[" };
  for (const character of source) {
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'") quote = character;
    else if ("{([".includes(character)) stack.push(character);
    else if ("})]".includes(character) && (!stack.length || stack.pop() !== pairs[character])) return false;
  }
  return stack.length === 0 && !quote;
}

export async function compilePreflight(request: Request, env: AuthEnv) {
  const identity = await requireApiIdentity({ request, env });
  if (!identity) return unauthorized(request);
  let payload: unknown;
  try { payload = await request.json(); } catch { return jsonResponse(request, { error: "Request body must be JSON" }, 400); }
  const body = asRecord(payload);
  const files = Array.isArray(body?.files) ? body.files.filter((file) => asRecord(file)).map((file) => {
    const sourceFile = file as Record<string, unknown>;
    return { name: String(sourceFile.name ?? ""), content: String(sourceFile.content ?? "") };
  }) : typeof body?.code === "string" ? [{ name: "sketch.ino", content: body.code }] : [];
  const componentId = String(body?.component_id ?? "").trim();
  const definitionId = String(body?.definition_id ?? "").trim();
  const fqbn = String(body?.board_fqbn ?? "").trim();
  if (!componentId || !definitionId || !fqbn) return jsonResponse(request, { error: "component_id, definition_id, and board_fqbn are required" }, 422);
  const target = boardTargetFor(definitionId);
  if (!target) return jsonResponse(request, { error: `No compiler profile is registered for board definition ${definitionId}` }, 422);
  if (fqbn !== target.fqbn) return jsonResponse(request, { error: `${definitionId} requires ${target.fqbn}; refusing compilation for ${fqbn}` }, 422);
  const source = files.map((file) => file.content).join("\n");
  if (new TextEncoder().encode(source).byteLength > MAX_SOURCE_BYTES) return jsonResponse(request, { error: "Source exceeds the hosted preflight limit" }, 413);
  const balanced = balancedSource(source);
  const hasSketchFile = files.some((file) => /\.ino$/i.test(file.name));
  return jsonResponse(request, {
    success: false,
    available: false,
    mode: "browser-preflight",
    board_fqbn: fqbn,
    source_files: files.map((file) => file.name),
    preflight: { balanced_braces: balanced, has_sketch_file: hasSketchFile },
    error: balanced ? "Binary compilation is unavailable on this static deployment." : "Source preflight found unbalanced delimiters.",
    hint: balanced ? "The hosted behavioral runtime can execute supported Arduino code; binary artifacts require a configured arduino-cli service." : "Fix the source syntax, then retry the preflight.",
    simulation_ready: balanced && hasSketchFile,
    browser_runtime: { available: balanced && hasSketchFile, supports: ["setup", "loop", "digitalRead", "digitalWrite", "analogRead", "analogWrite", "delay", "Wire", "SPI", "Serial"] },
  });
}

export async function componentSearch(request: Request, env: AuthEnv) {
  const identity = await requireApiIdentity({ request, env });
  if (!identity) return unauthorized(request);
  const url = new URL(request.url);
  const results = searchCatalog(url.searchParams.get("q") ?? "", {
    category: url.searchParams.get("category") || undefined,
    domain: url.searchParams.get("domain") || undefined,
  });
  return jsonResponse(request, { count: results.length, results, source: "canonical-components-metadata", catalogCount: catalog.length });
}

export async function componentById(request: Request, env: AuthEnv, id: string) {
  const identity = await requireApiIdentity({ request, env });
  if (!identity) return unauthorized(request);
  const component = getCatalogComponent(id);
  return component ? jsonResponse(request, component) : jsonResponse(request, { error: `Unknown component ${id}` }, 404);
}

export async function componentPorts(request: Request, env: AuthEnv, id: string) {
  const identity = await requireApiIdentity({ request, env });
  if (!identity) return unauthorized(request);
  const component = getCatalogComponent(id);
  return component ? jsonResponse(request, { componentId: id, ports: component.ports, model: component.model }) : jsonResponse(request, { error: `Unknown component ${id}` }, 404);
}

export async function componentImportAnalyze(request: Request, env: AuthEnv) {
  const identity = await requireApiIdentity({ request, env });
  if (!identity) return unauthorized(request);
  let payload: unknown;
  try { payload = await request.json(); } catch { return jsonResponse(request, { error: "Request body must be JSON" }, 400); }
  const body = asRecord(payload);
  const rawNames = Array.isArray(body?.filenames) ? body.filenames : [];
  const rawSizes = Array.isArray(body?.fileSizes) ? body.fileSizes : [];
  if (rawNames.length > 64) return jsonResponse(request, { error: "At most 64 model files can be analyzed at once" }, 413);
  const filenames = rawNames.map((value) => String(value ?? "").trim().slice(0, 240)).filter(Boolean);
  const fileSizes = filenames.map((_, index) => {
    const size = Number(rawSizes[index] ?? 0);
    return Number.isFinite(size) ? Math.max(0, Math.min(Math.floor(size), 1_000_000_000)) : 0;
  });
  return jsonResponse(request, analyzeImport(filenames, fileSizes));
}

export function engines(request: Request) {
  return jsonResponse(request, {
    behavioral: { status: "available", purpose: "Graph-aware Arduino subset with GPIO, ADC, PWM, serial transport, SPI/I2C traces, and DS3231 I2C register behavior", verified: true },
    "arduino-cli": { status: "unavailable", purpose: "Firmware compilation", reason: "Static/edge deployment does not launch subprocesses." },
    renode: { status: "unsupported", detected: false, purpose: "MCU and SoC firmware" },
    ngspice: { status: "unsupported", detected: false, purpose: "Analog electrical and SPICE" },
    wasmtime: { status: "unsupported", detected: false, purpose: "Sandboxed WASM behaviors" },
  });
}
