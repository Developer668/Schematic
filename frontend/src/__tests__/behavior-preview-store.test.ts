import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PREVIEW_DISCLAIMER,
  registerBehaviorPreviewAdapter,
  useBehaviorPreviewStore,
} from "../behavior/useBehaviorPreviewStore.ts";
import type { PreviewSnapshot } from "../behavior/previewTypes.ts";

const snapshot: PreviewSnapshot = {
  source: "behavior-preview",
  execution: "typed-actions-only",
  sourceCodeExecution: "none",
  logicalTimeMs: 0,
  sequence: 0,
  components: {
    "led-1": { primitives: [{ kind: "indicator", key: "indicator", on: true, color: "#22c55e", intensity: 1 }], accessibleSummary: "LED on" },
  },
  inputs: {},
  sessionLog: [],
  sessionLogSha256: "session-hash",
  events: [],
  diagnostics: [],
  snapshotSha256: "snapshot-hash",
};

afterEach(() => {
  registerBehaviorPreviewAdapter(null);
  useBehaviorPreviewStore.setState({ status: "idle", snapshot: null, diagnostics: [], error: null, announcement: "", durationMs: 1_000, requestGeneration: 0 });
  vi.restoreAllMocks();
});

describe("useBehaviorPreviewStore", () => {
  it("keeps session state ephemeral and applies the shared adapter snapshot", async () => {
    const preview = vi.fn(() => ({ snapshot, status: "playing" as const, durationMs: 800 }));
    registerBehaviorPreviewAdapter({ preview });

    await useBehaviorPreviewStore.getState().startPreview({ durationMs: 800 });

    expect(preview).toHaveBeenCalledWith({ durationMs: 800 });
    expect(useBehaviorPreviewStore.getState().snapshot?.sourceCodeExecution).toBe("none");
    expect(useBehaviorPreviewStore.getState().status).toBe("playing");
    expect(useBehaviorPreviewStore.getState().durationMs).toBe(800);
    expect(useBehaviorPreviewStore.getState().announcement).toBe(PREVIEW_DISCLAIMER);
  });

  it("ignores a stale result after reset invalidates the request", async () => {
    let resolvePreview!: (result: { snapshot: PreviewSnapshot; status: "ready" }) => void;
    const preview = vi.fn(() => new Promise<{ snapshot: PreviewSnapshot; status: "ready" }>((resolve) => { resolvePreview = resolve; }));
    registerBehaviorPreviewAdapter({ preview });

    const pending = useBehaviorPreviewStore.getState().startPreview();
    await useBehaviorPreviewStore.getState().resetPreview();
    resolvePreview({ snapshot, status: "ready" });
    await pending;

    expect(useBehaviorPreviewStore.getState().snapshot).toBeNull();
    expect(useBehaviorPreviewStore.getState().status).toBe("idle");
  });

  it("invalidates an in-flight result when the active project clears its snapshot", async () => {
    let resolvePreview!: (result: { snapshot: PreviewSnapshot; status: "ready" }) => void;
    const preview = vi.fn(() => new Promise<{ snapshot: PreviewSnapshot; status: "ready" }>((resolve) => { resolvePreview = resolve; }));
    registerBehaviorPreviewAdapter({ preview });

    const pending = useBehaviorPreviewStore.getState().startPreview();
    useBehaviorPreviewStore.getState().setSnapshot(null, "idle");
    resolvePreview({ snapshot, status: "ready" });
    await pending;

    expect(useBehaviorPreviewStore.getState().snapshot).toBeNull();
    expect(useBehaviorPreviewStore.getState().status).toBe("idle");
  });

  it("bounds seek input and routes typed events through the adapter", async () => {
    const seek = vi.fn(() => ({ snapshot, status: "paused" as const }));
    const dispatchEvent = vi.fn(() => ({ snapshot, status: "paused" as const }));
    registerBehaviorPreviewAdapter({ seek, dispatchEvent });
    useBehaviorPreviewStore.getState().setStatus("paused");

    await useBehaviorPreviewStore.getState().seekPreview(-4);
    await useBehaviorPreviewStore.getState().dispatchEvent({ componentId: "button-1", definitionId: "pushbutton", eventId: "button.pressed" });

    expect(seek).toHaveBeenCalledWith(0);
    expect(dispatchEvent).toHaveBeenCalledWith({ componentId: "button-1", definitionId: "pushbutton", eventId: "button.pressed" });
    expect(useBehaviorPreviewStore.getState().snapshot).toBe(snapshot);
  });
});
