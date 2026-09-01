import type { WorkspaceSnapshot } from "@schematic/project-storage";
import { apiUrl, getAuthHeaders } from "../auth/session.ts";
import type { HardwareGraph } from "./useProjectStore.ts";

export type RemoteWorkspace = {
  workspace: WorkspaceSnapshot<HardwareGraph>;
  revision: number;
  updatedAt: string;
};

async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(await getAuthHeaders(false, init.signal ?? undefined));
  if (init.body) headers.set("content-type", "application/json");
  return fetch(apiUrl(path), { ...init, headers, credentials: "include" });
}

export async function loadRemoteWorkspace(): Promise<RemoteWorkspace | null> {
  if (typeof fetch !== "function") return null;
  try {
    const response = await request("/api/projects/workspace");
    if (response.status === 404 || response.status === 503) return null;
    if (!response.ok) throw new Error(`Remote workspace returned ${response.status}`);
    const value = await response.json() as Partial<RemoteWorkspace>;
    if (!value.workspace || !Number.isInteger(value.revision) || typeof value.updatedAt !== "string") return null;
    return value as RemoteWorkspace;
  } catch (error) {
    console.warn("[persistence] remote workspace unavailable; IndexedDB remains active", error);
    return null;
  }
}

export async function saveRemoteWorkspace(
  workspace: WorkspaceSnapshot<HardwareGraph>,
  expectedRevision: number | null,
): Promise<RemoteWorkspace | null> {
  if (typeof fetch !== "function") return null;
  try {
    const response = await request("/api/projects/workspace", {
      method: "PUT",
      body: JSON.stringify({ workspace, expectedRevision }),
    });
    if (response.status === 404 || response.status === 503) return null;
    if (response.status === 409) throw new Error("Remote workspace changed in another browser; refresh before editing again.");
    if (!response.ok) throw new Error(`Remote workspace returned ${response.status}`);
    return await response.json() as RemoteWorkspace;
  } catch (error) {
    console.warn("[persistence] remote save failed; IndexedDB copy is still safe", error);
    return null;
  }
}
