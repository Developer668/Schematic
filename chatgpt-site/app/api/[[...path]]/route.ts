import {
  componentById,
  componentImportAnalyze,
  componentPorts,
  componentSearch,
  compilePreflight,
  engines,
  jsonResponse,
  optionsResponse,
  requireApiIdentity,
  runSimulation,
  simulationState,
  simulationStep,
  stopSimulation,
  unauthorized,
} from "../../../../functions/api/_runtime";
import { siteAuthEnv } from "../site-auth";
import { partsSearch } from "../../../../functions/api/parts/search";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path?: string[] }> };

async function routePath(context: RouteContext) {
  const path = (await context.params).path ?? [];
  return path.map((part) => decodeURIComponent(part)).join("/");
}

function methodNotAllowed(request: Request) {
  return jsonResponse(request, { error: "Method not supported for this API route" }, 405, { Allow: "GET, POST, OPTIONS" });
}

function notFound(request: Request) {
  return jsonResponse(request, { error: "Unknown ChatGPT Site API route" }, 404);
}

function apiDocs(request: Request) {
  return jsonResponse(request, {
    name: "Schematic ChatGPT Site API",
    boundary: "same-origin",
    authentication: "Use the short-lived bearer token returned by /api/auth/session.",
    routes: {
      health: "GET /api/health",
      engines: "GET /api/engines",
      componentSearch: "GET /api/components/search?q=esp32",
      component: "GET /api/components/:catalogId",
      componentPorts: "GET /api/components/ports/:catalogId",
      parts: "GET /api/parts/search (server-side provider fallback candidates; final listings are published through WebMCP)",
      compile: "POST /api/compile",
      importAnalyze: "POST /api/components/import/analyze",
      simulationRun: "POST /api/simulation/run",
      simulationStep: "POST /api/simulation/step",
      simulationState: "GET /api/simulation/state?session_id=…",
      simulationStop: "POST /api/simulation/stop",
    },
    limitations: [
      "The Site runs the behavioral browser-compatible runtime; it does not produce firmware binaries without a separate compiler service.",
      "Raw WebSocket transport is unavailable on the Site; use HTTP simulation or the browser runtime.",
    ],
  });
}

/**
 * Same-origin API surface for the ChatGPT Site.
 *
 * This deliberately reuses the tested graph/catalog/runtime functions used by
 * the other deployment, but the request never leaves the ChatGPT Site. The
 * client-side browser runtime remains the fallback when a feature is outside
 * the hosted behavioral contract.
 */
export async function OPTIONS(request: Request, context: RouteContext) {
  const path = await routePath(context);
  return path ? optionsResponse(request) : notFound(request);
}

export async function GET(request: Request, context: RouteContext) {
  const path = await routePath(context);
  const env = await siteAuthEnv();

  if (path === "health") {
    return jsonResponse(request, { status: "ok", version: "1.1.0", runtime: "chatgpt-site-behavioral", api_boundary: "same-origin" });
  }
  if (path === "docs") return apiDocs(request);
  if (path === "simulation/ws" || path === "auth/ws-ticket") {
    return jsonResponse(request, { error: "WebSocket transport is unavailable on this Site; use HTTP simulation or the browser runtime." }, 501);
  }
  if (path === "engines") return (await requireApiIdentity({ request, env })) ? engines(request) : unauthorized(request);
  if (path === "components/search") return componentSearch(request, env);
  if (path === "components/ports" || path === "components") return notFound(request);
  if (path.startsWith("components/ports/")) return componentPorts(request, env, path.slice("components/ports/".length));
  if (path.startsWith("components/") && path.split("/").length === 2) return componentById(request, env, path.slice("components/".length));
  if (path === "parts/search") {
    return partsSearch(request, env);
  }
  if (path === "simulation/state") return simulationState(request, env);
  return notFound(request);
}

export async function POST(request: Request, context: RouteContext) {
  const path = await routePath(context);
  const env = await siteAuthEnv();

  if (path === "compile") return compilePreflight(request, env);
  if (path === "components/import/analyze") return componentImportAnalyze(request, env);
  if (path === "simulation/run") return runSimulation(request, env);
  if (path === "simulation/step") return simulationStep(request, env);
  if (path === "simulation/stop") return stopSimulation(request, env);

  // The browser's WebSocket transport is optional. ChatGPT Sites can use the
  // same-origin HTTP simulation route and browser runtime without exposing a
  // raw socket fallback that the hosting boundary cannot guarantee.
  if (path === "simulation/ws") return jsonResponse(request, { error: "WebSocket transport is unavailable on this Site; use HTTP/browser runtime simulation." }, 501);
  if (path === "auth/ws-ticket") return jsonResponse(request, { error: "WebSocket transport is unavailable on this Site" }, 501);
  return methodNotAllowed(request);
}
