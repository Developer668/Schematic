// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreviewSnapshot } from "../behavior/previewTypes.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../components/ComponentArtwork.tsx", () => ({ default: () => <div data-testid="artwork" /> }));

import Inspector from "../components/inspector/Inspector.tsx";
import { registerBehaviorPreviewAdapter, useBehaviorPreviewStore } from "../behavior/useBehaviorPreviewStore.ts";
import { useProjectStore } from "../store/useProjectStore.ts";
import { useSelectionStore } from "../store/useSelectionStore.ts";

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function ledSnapshot(componentId: string, on: boolean): PreviewSnapshot {
  return {
    source: "behavior-preview",
    execution: "typed-actions-only",
    sourceCodeExecution: "none",
    logicalTimeMs: 0,
    sequence: 0,
    components: {
      [componentId]: {
        primitives: [{ kind: "indicator", key: "indicator", on, color: "#22c55e", intensity: 1 }],
        accessibleSummary: on ? "LED on" : "LED off",
      },
    },
    inputs: {},
    sessionLog: [],
    sessionLogSha256: "session-hash",
    events: [],
    diagnostics: [],
    snapshotSha256: `snapshot-${on}`,
  };
}

function renderInspector() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(<Inspector />));
  return host;
}

beforeEach(() => {
  useProjectStore.getState().clear();
  useSelectionStore.getState().clear();
  useBehaviorPreviewStore.getState().setSnapshot(null, "idle");
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  registerBehaviorPreviewAdapter(null);
  useBehaviorPreviewStore.getState().setSnapshot(null, "idle");
});

describe("Inspector behavior controls", () => {
  it("disables actions before preview and reconciles a rejected optimistic toggle", async () => {
    const component = useProjectStore.getState().addComponent("led");
    useSelectionStore.getState().setActive(component.id);
    const invokeAction = vi.fn(async () => ({
      status: "playing" as const,
      snapshot: ledSnapshot(component.id, false),
      diagnostics: [{ code: "ACTION_REJECTED", severity: "error" as const, message: "Rejected" }],
    }));
    registerBehaviorPreviewAdapter({ invokeAction });
    const container = renderInspector();
    const toggle = () => container.querySelector<HTMLButtonElement>("button[aria-label='Preview Set indicator']");

    expect(container.textContent).toContain("Start Behavior Preview");
    expect(toggle()?.disabled).toBe(true);
    act(() => toggle()?.click());
    expect(invokeAction).not.toHaveBeenCalled();

    act(() => useBehaviorPreviewStore.getState().setSnapshot(ledSnapshot(component.id, false), "playing"));
    expect(toggle()?.disabled).toBe(false);
    expect(toggle()?.textContent).toContain("Off");

    await act(async () => { toggle()?.click(); });
    expect(invokeAction).toHaveBeenCalledTimes(1);
    expect(toggle()?.textContent).toContain("Off");
  });
});
