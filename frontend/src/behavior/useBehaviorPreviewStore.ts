import { create } from "zustand";
import type {
  PreviewCommandResult,
  PreviewDiagnostic,
  PreviewSnapshot,
  PreviewStatus,
} from "./previewTypes.ts";

export const PREVIEW_DISCLAIMER = "Scripted outcome · no code ran · wiring and hardware not verified.";

export function isPreviewRunning(status: PreviewStatus | string) {
  return status === "playing" || status === "partial";
}

export interface PreviewEventRequest {
  componentId: string;
  definitionId: string;
  eventId: string;
  payload?: unknown;
}

export interface PreviewActionRequest {
  componentId: string;
  definitionId: string;
  actionId: string;
  payload: unknown;
}

/**
 * Adapter boundary between UI controls and the shared Behavior System.
 *
 * The UI never owns reducers and never invokes arbitrary component functions.
 * The application command layer registers this adapter once and the store
 * only carries ephemeral session state. Keeping the adapter outside Zustand
 * also prevents class instances or callbacks from being persisted or sent
 * over BroadcastChannel.
 */
export interface BehaviorPreviewAdapter {
  preview?: (request?: { durationMs?: number }) => Promise<PreviewCommandResult> | PreviewCommandResult;
  pause?: () => Promise<PreviewCommandResult | void> | PreviewCommandResult | void;
  reset?: () => Promise<PreviewCommandResult | void> | PreviewCommandResult | void;
  seek?: (timeMs: number) => Promise<PreviewCommandResult | void> | PreviewCommandResult | void;
  dispatchEvent?: (request: PreviewEventRequest) => Promise<PreviewCommandResult | void> | PreviewCommandResult | void;
  invokeAction?: (request: PreviewActionRequest) => Promise<PreviewCommandResult | void> | PreviewCommandResult | void;
}

let adapter: BehaviorPreviewAdapter | null = null;

/** Register the shared application command adapter; returns an unregister fn for tests and hot reload. */
export function registerBehaviorPreviewAdapter(next: BehaviorPreviewAdapter | null) {
  adapter = next;
  return () => {
    if (adapter === next) adapter = null;
  };
}

function statusForResult(result: PreviewCommandResult | void, fallback: PreviewStatus): PreviewStatus {
  if (result?.status) return result.status;
  if (result?.rejected?.length) return "partial";
  return fallback;
}

interface BehaviorPreviewState {
  status: PreviewStatus;
  snapshot: PreviewSnapshot | null;
  diagnostics: readonly PreviewDiagnostic[];
  preparationStatus: "ready" | "partial" | null;
  selectedComponentId: string | null;
  error: string | null;
  announcement: string;
  durationMs: number;
  requestGeneration: number;
  setSnapshot: (snapshot: PreviewSnapshot | null, status?: PreviewStatus) => void;
  setStatus: (status: PreviewStatus) => void;
  setSelectedComponent: (componentId: string | null) => void;
  setDiagnostics: (diagnostics: readonly PreviewDiagnostic[]) => void;
  startPreview: (request?: { durationMs?: number }) => Promise<PreviewCommandResult | void>;
  pausePreview: () => Promise<PreviewCommandResult | void>;
  resetPreview: () => Promise<PreviewCommandResult | void>;
  seekPreview: (timeMs: number) => Promise<PreviewCommandResult | void>;
  dispatchEvent: (request: PreviewEventRequest) => Promise<PreviewCommandResult | void>;
  invokeAction: (request: PreviewActionRequest) => Promise<PreviewCommandResult | void>;
  clearError: () => void;
}

function applyResult(
  set: (next: Partial<BehaviorPreviewState>) => void,
  result: PreviewCommandResult | void,
  fallbackStatus: PreviewStatus,
) {
  if (!result) {
    return;
  }
  if (result.diagnostics) set({ diagnostics: result.diagnostics });
  set({
    ...(Object.prototype.hasOwnProperty.call(result, "snapshot") ? { snapshot: result.snapshot ?? null } : {}),
    ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
    ...(Object.prototype.hasOwnProperty.call(result, "preparationStatus") ? { preparationStatus: result.preparationStatus ?? null } : {}),
    status: statusForResult(result, fallbackStatus),
    ...(Number.isSafeInteger(result.durationMs) && (result.durationMs ?? 0) > 0 ? { durationMs: result.durationMs } : {}),
    ...(result.message ? { announcement: result.message } : {}),
  });
}

async function runCommand(
  command: (() => Promise<PreviewCommandResult | void> | PreviewCommandResult | void) | undefined,
  set: (next: Partial<BehaviorPreviewState>) => void,
  fallbackStatus: PreviewStatus,
  generation: number,
  getGeneration: () => number,
) {
  if (!command) {
    set({ status: "blocked", error: "Preview controls are not connected to the Behavior System yet." });
    return;
  }
  try {
    const result = await command();
    if (generation !== getGeneration()) return result;
    applyResult(set, result, fallbackStatus);
    return result;
  } catch (error) {
    if (generation === getGeneration()) set({ status: "blocked", error: error instanceof Error ? error.message : String(error) });
    return;
  }
}

export const useBehaviorPreviewStore = create<BehaviorPreviewState>((set, get) => ({
  status: "idle",
  snapshot: null,
  diagnostics: [],
  preparationStatus: null,
  selectedComponentId: null,
  error: null,
  announcement: "",
  durationMs: 1_000,
  requestGeneration: 0,
  setSnapshot(snapshot, status = snapshot ? "ready" : "idle") {
    set((state) => ({
      snapshot,
      status,
      error: null,
      announcement: snapshot ? PREVIEW_DISCLAIMER : "",
      ...(snapshot === null ? { preparationStatus: null } : {}),
      // A null snapshot is also how project/auth-room changes invalidate the
      // old session. Bump the generation so an in-flight adapter promise for
      // the previous project cannot repopulate this store after the reset.
      requestGeneration: snapshot === null ? state.requestGeneration + 1 : state.requestGeneration,
    }));
  },
  setStatus(status) { set({ status }); },
  setSelectedComponent(selectedComponentId) { set({ selectedComponentId }); },
  setDiagnostics(diagnostics) { set({ diagnostics }); },
  async startPreview(request) {
    const generation = get().requestGeneration + 1;
    const resuming = get().status === "paused";
    set({ requestGeneration: generation, status: "playing", ...(resuming ? {} : { snapshot: null }), error: null, announcement: PREVIEW_DISCLAIMER });
    const currentAdapter = adapter;
    return runCommand(currentAdapter?.preview ? () => currentAdapter.preview?.(request) : undefined, set, "playing", generation, () => get().requestGeneration);
  },
  async pausePreview() {
    const generation = get().requestGeneration + 1;
    set({ requestGeneration: generation, status: "paused", error: null, announcement: PREVIEW_DISCLAIMER });
    const currentAdapter = adapter;
    return runCommand(currentAdapter?.pause ? () => currentAdapter.pause?.() : undefined, set, "paused", generation, () => get().requestGeneration);
  },
  async resetPreview() {
    const generation = get().requestGeneration + 1;
    set({ requestGeneration: generation, status: "idle", snapshot: null, diagnostics: [], preparationStatus: null, error: null, announcement: "", durationMs: 1_000 });
    const currentAdapter = adapter;
    // Resetting the ephemeral UI state is always safe, even during boot or
    // after hot-reload temporarily unregisters the command adapter.
    if (!currentAdapter?.reset) return;
    return runCommand(currentAdapter?.reset ? () => currentAdapter.reset?.() : undefined, set, "idle", generation, () => get().requestGeneration);
  },
  async seekPreview(timeMs) {
    const bounded = Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0;
    const generation = get().requestGeneration + 1;
    set({ requestGeneration: generation, error: null, announcement: PREVIEW_DISCLAIMER });
    const currentAdapter = adapter;
    return runCommand(currentAdapter?.seek ? () => currentAdapter.seek?.(bounded) : undefined, set, get().status, generation, () => get().requestGeneration);
  },
  async dispatchEvent(request) {
    const generation = get().requestGeneration;
    const currentAdapter = adapter;
    return runCommand(currentAdapter?.dispatchEvent ? () => currentAdapter.dispatchEvent?.(request) : undefined, set, get().status, generation, () => get().requestGeneration);
  },
  async invokeAction(request) {
    const generation = get().requestGeneration;
    const currentAdapter = adapter;
    return runCommand(currentAdapter?.invokeAction ? () => currentAdapter.invokeAction?.(request) : undefined, set, get().status, generation, () => get().requestGeneration);
  },
  clearError() { set({ error: null }); },
}));

export function currentPreviewProjection(componentId: string | undefined) {
  if (!componentId) return undefined;
  return useBehaviorPreviewStore.getState().snapshot?.components[componentId];
}
