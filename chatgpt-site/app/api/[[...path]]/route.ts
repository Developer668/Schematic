import {
  componentById,
  componentImportAnalyze,
  componentPorts,
  componentSearch,
  jsonResponse,
  optionsResponse,
} from "../../../../functions/api/_catalog-runtime";
import { siteAuthEnv } from "../site-auth";
import { partsSearch } from "../../../../functions/api/parts/search";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path?: string[] }> };

async function routePath(context: RouteContext) {
  const path = (await context.params).path ?? [];
  return path.join("/");
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
      componentSearch: "GET /api/components/search?q=esp32",
      component: "GET /api/components/:catalogId",
      componentPorts: "GET /api/components/ports/:catalogId",
      parts: "GET /api/parts/search (bounded no-key public discovery; final listings are verified and published through WebMCP)",
      importAnalyze: "POST /api/components/import/analyze",
    },
    limitations: [
      "Editable source is stored and exported as an artifact; this Site never parses, executes, builds, uploads, or physically tests it.",
      "Behavior Preview is derived only from validated Behavior Plans and must not be represented as firmware execution.",
    ],
  });
}

function isKnownApiPath(path: string) {
  return path === "health"
    || path === "docs"
    || path === "components/search"
    || path === "parts/search"
    || path === "components/import/analyze"
    || /^components\/ports\/[^/]+$/.test(path)
    || /^components\/(?!ports$)[^/]+$/.test(path);
}

/**
 * Same-origin API surface for the ChatGPT Site.
 *
 * This deliberately exposes only catalog, import-analysis, parts, health, and
 * identity helpers. Behavior Preview and source authoring remain local typed
 * application workflows and do not cross into executable runtime routes.
 */
export async function OPTIONS(request: Request, context: RouteContext) {
  const path = await routePath(context);
  return isKnownApiPath(path) ? optionsResponse(request) : notFound(request);
}

export async function GET(request: Request, context: RouteContext) {
  const path = await routePath(context);
  const env = await siteAuthEnv();

  if (path === "health") {
    return jsonResponse(request, { status: "ok", version: "1.1.0", runtime: "chatgpt-site-typed-preview", api_boundary: "same-origin" });
  }
  if (path === "docs") return apiDocs(request);
  if (path === "components/search") return componentSearch(request, env);
  if (path === "components/ports" || path === "components") return notFound(request);
  if (path.startsWith("components/ports/")) return componentPorts(request, env, path.slice("components/ports/".length));
  if (path.startsWith("components/") && path.split("/").length === 2) return componentById(request, env, path.slice("components/".length));
  if (path === "parts/search") {
    return partsSearch(request, env);
  }
  return notFound(request);
}

export async function POST(request: Request, context: RouteContext) {
  const path = await routePath(context);
  const env = await siteAuthEnv();

  if (path === "components/import/analyze") return componentImportAnalyze(request, env);
  return notFound(request);
}
