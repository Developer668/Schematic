import { jsonResponse, optionsResponse, requireApiIdentity, unauthorized } from "../_runtime";
import type { AuthEnv } from "../../_auth";

type KVNamespaceLike = {
  get<T>(key: string, type: "json"): Promise<T | null>;
  put(key: string, value: string): Promise<void>;
};

type Env = AuthEnv & { SCHEMATIC_PROJECTS?: KVNamespaceLike };
type Context = { request: Request; env: Env };
type Stored = { workspace: unknown; revision: number; updatedAt: string };

const MAX_WORKSPACE_BYTES = 10_000_000;

function keyFor(subject: string) {
  return `workspace:${subject}`;
}

function validWorkspace(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const workspace = value as Record<string, unknown>;
  return workspace.version === 1
    && typeof workspace.activeProjectId === "string"
    && Array.isArray(workspace.projects)
    && workspace.projects.length <= 128;
}

export const onRequestOptions = ({ request }: Context) => optionsResponse(request);

export const onRequestGet = async ({ request, env }: Context) => {
  const identity = await requireApiIdentity({ request, env });
  if (!identity) return unauthorized(request);
  if (!env.SCHEMATIC_PROJECTS) return jsonResponse(request, { error: "SCHEMATIC_PROJECTS KV binding is not configured" }, 503);
  const stored = await env.SCHEMATIC_PROJECTS.get<Stored>(keyFor(identity.subject), "json");
  return stored ? jsonResponse(request, stored) : jsonResponse(request, { error: "Workspace not found" }, 404);
};

export const onRequestPut = async ({ request, env }: Context) => {
  const identity = await requireApiIdentity({ request, env });
  if (!identity) return unauthorized(request);
  if (!env.SCHEMATIC_PROJECTS) return jsonResponse(request, { error: "SCHEMATIC_PROJECTS KV binding is not configured" }, 503);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_WORKSPACE_BYTES) return jsonResponse(request, { error: "Workspace exceeds 10 MB" }, 413);
  let body: { workspace?: unknown; expectedRevision?: unknown };
  try { body = JSON.parse(raw); } catch { return jsonResponse(request, { error: "Invalid JSON" }, 400); }
  if (!validWorkspace(body.workspace)) return jsonResponse(request, { error: "Invalid workspace" }, 422);
  const key = keyFor(identity.subject);
  const previous = await env.SCHEMATIC_PROJECTS.get<Stored>(key, "json");
  const expected = body.expectedRevision;
  if (previous && expected !== null && expected !== undefined && expected !== previous.revision) {
    return jsonResponse(request, { error: "Revision conflict", revision: previous.revision }, 409);
  }
  const stored: Stored = { workspace: body.workspace, revision: (previous?.revision ?? 0) + 1, updatedAt: new Date().toISOString() };
  await env.SCHEMATIC_PROJECTS.put(key, JSON.stringify(stored));
  return jsonResponse(request, stored);
};
