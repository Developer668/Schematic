import { create } from "zustand";

export type ToolActivityStatus = "running" | "success" | "error";

export interface ToolActivity {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: ToolActivityStatus;
  startedAt: number;
  finishedAt?: number;
  resultText?: string;
  isError?: boolean;
}

interface WebMCPState {
  activities: ToolActivity[];
  beginTool: (name: string, args: Record<string, unknown>) => string;
  finishTool: (id: string, result: unknown, isError?: boolean) => void;
  clearActivities: () => void;
}

const webmcpChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("schematic-webmcp-sync") : null;

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
  beginTool(name, args) {
    const id = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const activity = { id, name, args, status: "running" as const, startedAt: Date.now() };
    set((state) => ({ activities: [activity, ...state.activities].slice(0, 80) }));
    webmcpChannel?.postMessage({ type: "activity:add", activity });
    return id;
  },
  finishTool(id, result, isError = Boolean((result as any)?.isError)) {
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
    webmcpChannel?.postMessage({ type: "activity:update", id, patch });
  },
  clearActivities() {
    set({ activities: [] });
    webmcpChannel?.postMessage({ type: "activity:clear" });
  },
}));

webmcpChannel?.addEventListener("message", (event) => {
  if (event.data?.type === "activity:add" && event.data.activity) {
    useWebMCPStore.setState((state) => ({ activities: [event.data.activity, ...state.activities].slice(0, 80) }));
  }
  if (event.data?.type === "activity:update" && event.data.id && event.data.patch) {
    useWebMCPStore.setState((state) => ({ activities: state.activities.map((activity) => activity.id === event.data.id ? { ...activity, ...event.data.patch } : activity) }));
  }
  if (event.data?.type === "activity:clear") useWebMCPStore.setState({ activities: [] });
});
