import { create } from "zustand";
import { getCurrentUserId } from "../auth/session.ts";

export type ToolActivityStatus = "running" | "success" | "error";
export type WebMCPRegistrationState = "checking" | "native" | "unavailable" | "error";
export type WebMCPDiscoveryState = "verified" | "unverified" | "unavailable";

export interface ToolActivity {
  id: string;
  name: string;
  args: Record<string, unknown>;
  roomId: string | null;
  status: ToolActivityStatus;
  startedAt: number;
  finishedAt?: number;
  resultText?: string;
  isError?: boolean;
}

interface WebMCPState {
  activities: ToolActivity[];
  registration: {
    state: WebMCPRegistrationState;
    registeredCount: number;
    declaredCount: number;
    discoveredCount: number;
    discovery: WebMCPDiscoveryState;
    error?: string;
  };
  beginTool: (name: string, args: Record<string, unknown>) => string;
  finishTool: (id: string, result: unknown, isError?: boolean) => void;
  clearActivities: () => void;
  setRegistration: (registration: Partial<WebMCPState["registration"]>) => void;
}

const webmcpChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("schematic-webmcp-sync") : null;

const REDACTED_ACTIVITY_KEYS = /^(?:authorization|code|content|files|password|plan|secret|source|token)$/i;

function activityRoomId() {
  return getCurrentUserId();
}

function summarizeActivityValue(value: unknown, key = "", depth = 0): unknown {
  if (REDACTED_ACTIVITY_KEYS.test(key)) return "[redacted from activity log]";
  if (depth >= 3) return "[nested value omitted]";
  if (typeof value === "string") return value.slice(0, 240);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => summarizeActivityValue(item, "", depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .slice(0, 32)
      .map(([childKey, child]) => [childKey, summarizeActivityValue(child, childKey, depth + 1)]));
  }
  return String(value).slice(0, 120);
}

function summarizeActivityArgs(args: Record<string, unknown>) {
  return summarizeActivityValue(args) as Record<string, unknown>;
}

function safeJson(value: unknown, fallback: string) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return fallback;
  }
}

function resultText(result: any) {
  const text = result?.content?.find?.((item: any) => item.type === "text")?.text ?? safeJson(result, "Tool completed");
  return String(text).slice(0, 2400);
}

export const useWebMCPStore = create<WebMCPState>((set) => ({
  activities: [],
  registration: { state: "checking", registeredCount: 0, declaredCount: 0, discoveredCount: 0, discovery: "unavailable" },
  beginTool(name, args) {
    const id = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const roomId = activityRoomId();
    const activity = { id, name: String(name).slice(0, 160), args: summarizeActivityArgs(args), roomId, status: "running" as const, startedAt: Date.now() };
    set((state) => ({ activities: [activity, ...state.activities].slice(0, 80) }));
    webmcpChannel?.postMessage({ type: "activity:add", roomId, activity });
    return id;
  },
  finishTool(id, result, isError = Boolean((result as any)?.isError)) {
    const roomId = activityRoomId();
    const activity = useWebMCPStore.getState().activities.find((candidate) => candidate.id === id && candidate.roomId === roomId);
    // A session change clears its old room's activity. A delayed completion
    // must not recreate or broadcast that activity under the new identity.
    if (!activity) return;
    const patch = {
      status: (isError ? "error" : "success") as ToolActivityStatus,
      finishedAt: Date.now(),
      resultText: resultText(result),
      isError,
    };
    set((state) => ({
      activities: state.activities.map((activity) => activity.id === id ? {
        ...activity,
        ...patch,
      } : activity),
    }));
    webmcpChannel?.postMessage({ type: "activity:update", roomId, id, patch });
  },
  clearActivities() {
    const roomId = activityRoomId();
    set({ activities: [] });
    webmcpChannel?.postMessage({ type: "activity:clear", roomId });
  },
  setRegistration(registration) {
    set((state) => ({ registration: { ...state.registration, ...registration } }));
  },
}));

webmcpChannel?.addEventListener("message", (event) => {
  if ((event.data?.roomId ?? null) !== activityRoomId()) return;
  if (event.data?.type === "activity:add" && event.data.activity) {
    const incoming = event.data.activity as Partial<ToolActivity>;
    if (incoming.roomId !== activityRoomId() || typeof incoming.id !== "string" || typeof incoming.name !== "string" || typeof incoming.startedAt !== "number") return;
    const activity: ToolActivity = {
      id: incoming.id.slice(0, 200),
      name: incoming.name.slice(0, 160),
      args: summarizeActivityArgs(incoming.args && typeof incoming.args === "object" ? incoming.args : {}),
      roomId: activityRoomId(),
      status: incoming.status === "success" || incoming.status === "error" ? incoming.status : "running",
      startedAt: incoming.startedAt,
      ...(typeof incoming.finishedAt === "number" ? { finishedAt: incoming.finishedAt } : {}),
      ...(typeof incoming.resultText === "string" ? { resultText: incoming.resultText.slice(0, 2400) } : {}),
      ...(typeof incoming.isError === "boolean" ? { isError: incoming.isError } : {}),
    };
    useWebMCPStore.setState((state) => ({ activities: [activity, ...state.activities.filter((item) => item.id !== activity.id)].slice(0, 80) }));
  }
  if (event.data?.type === "activity:update" && event.data.id && event.data.patch) {
    const patch = event.data.patch as Record<string, unknown>;
    useWebMCPStore.setState((state) => ({ activities: state.activities.map((activity) => activity.id === event.data.id && activity.roomId === activityRoomId() ? {
      ...activity,
      status: patch.status === "error" || patch.status === "success" ? patch.status : activity.status,
      ...(typeof patch.finishedAt === "number" ? { finishedAt: patch.finishedAt } : {}),
      ...(typeof patch.resultText === "string" ? { resultText: patch.resultText.slice(0, 2400) } : {}),
      ...(typeof patch.isError === "boolean" ? { isError: patch.isError } : {}),
    } : activity) }));
  }
  if (event.data?.type === "activity:clear") useWebMCPStore.setState({ activities: [] });
});

if (typeof window !== "undefined") {
  window.addEventListener("schematic-session", () => useWebMCPStore.setState({ activities: [] }));
}
