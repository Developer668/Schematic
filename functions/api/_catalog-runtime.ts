/**
 * Data-only API helpers shared by the active ChatGPT Site routes.
 *
 * Keep this module free of simulation, compiler, firmware, WebAssembly, and
 * subprocess imports. The Site imports it directly so its server dependency
 * graph proves the compiler-free product boundary without relying on bundler
 * tree-shaking of the legacy `_runtime.ts` compatibility module.
 */
import { catalog, getCatalogComponent, searchCatalog } from "../../frontend/src/data/catalog";
import { analyzeImport } from "../../packages/component-format/src/importer";
import { platformIdentity, verifySessionToken, type AuthEnv, type SessionIdentity } from "../_auth";

type ApiContext = { request: Request; env: AuthEnv };

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
    return local || hosted ? trimOrigin(origin) : "";
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
    Vary: "Origin",
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

export function unauthorized(request: Request) {
  return jsonResponse(request, { authenticated: false, error: "Sign in to use this Schematic workspace" }, 401);
}

export async function componentSearch(request: Request, env: AuthEnv) {
  const identity = await requireApiIdentity({ request, env });
  if (!identity) return unauthorized(request);
  const url = new URL(request.url);
  const results = searchCatalog(url.searchParams.get("q") ?? "", {
    category: url.searchParams.get("category") || undefined,
    domain: url.searchParams.get("domain") || undefined,
  });
  return jsonResponse(request, { count: results.length, results: results.map(publicComponent), source: "canonical-components-metadata", catalogCount: catalog.length });
}

function publicComponent(component: NonNullable<ReturnType<typeof getCatalogComponent>>) {
  const { models: _legacyModels, ...catalogData } = component;
  return {
    ...catalogData,
    preview: component.behavior
      ? { mapped: true, profileId: component.behavior.profileId, profileVersion: component.behavior.profileVersion, ...(component.behavior.variant ? { variant: component.behavior.variant } : {}) }
      : { mapped: false },
  };
}

export async function componentById(request: Request, env: AuthEnv, id: string) {
  const identity = await requireApiIdentity({ request, env });
  if (!identity) return unauthorized(request);
  const component = getCatalogComponent(id);
  return component ? jsonResponse(request, publicComponent(component)) : jsonResponse(request, { error: `Unknown component ${id}` }, 404);
}

export async function componentPorts(request: Request, env: AuthEnv, id: string) {
  const identity = await requireApiIdentity({ request, env });
  if (!identity) return unauthorized(request);
  const component = getCatalogComponent(id);
  return component ? jsonResponse(request, {
    componentId: id,
    ports: component.ports,
    preview: component.behavior
      ? { mapped: true, profileId: component.behavior.profileId, profileVersion: component.behavior.profileVersion, ...(component.behavior.variant ? { variant: component.behavior.variant } : {}) }
      : { mapped: false },
  }) : jsonResponse(request, { error: `Unknown component ${id}` }, 404);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const MAX_IMPORT_ANALYZE_BODY_BYTES = 32 * 1024;

async function readBoundedJson(request: Request, maxBytes: number): Promise<{ value?: unknown; status?: number; error?: string }> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isFinite(parsedLength) || parsedLength < 0) return { status: 400, error: "Content-Length must be a non-negative number" };
    if (parsedLength > maxBytes) return { status: 413, error: `Request body may contain at most ${maxBytes} bytes` };
  }

  const reader = request.body?.getReader();
  if (!reader) return { status: 400, error: "Request body must be JSON" };
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("request body limit exceeded");
        return { status: 413, error: `Request body may contain at most ${maxBytes} bytes` };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { status: 400, error: "Request body must be JSON" };
  }
}

export async function componentImportAnalyze(request: Request, env: AuthEnv) {
  const identity = await requireApiIdentity({ request, env });
  if (!identity) return unauthorized(request);
  const parsed = await readBoundedJson(request, MAX_IMPORT_ANALYZE_BODY_BYTES);
  if (parsed.error) return jsonResponse(request, { error: parsed.error }, parsed.status ?? 400);
  const body = asRecord(parsed.value);
  const rawNames = Array.isArray(body?.filenames) ? body.filenames : [];
  const rawSizes = Array.isArray(body?.fileSizes) ? body.fileSizes : [];
  if (rawNames.length > 64) return jsonResponse(request, { error: "At most 64 model files can be analyzed at once" }, 413);
  const files = rawNames.flatMap((value, index) => {
    const name = String(value ?? "").trim().slice(0, 240);
    if (!name) return [];
    const rawSize = Number(rawSizes[index] ?? 0);
    const size = Number.isFinite(rawSize) ? Math.max(0, Math.min(Math.floor(rawSize), 1_000_000_000)) : 0;
    return [{ name, size }];
  });
  const filenames = files.map((file) => file.name);
  const fileSizes = files.map((file) => file.size);
  return jsonResponse(request, analyzeImport(filenames, fileSizes));
}
