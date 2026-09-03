// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../components/shopping/ShoppingWorkspace.tsx", () => ({ default: () => <div data-testid="shopping" /> }));
vi.mock("../components/editor/MonacoWorkspace.tsx", () => ({ default: () => <div data-testid="monaco" /> }));
vi.mock("../components/ComponentArtwork.tsx", () => ({ default: () => <div data-testid="artwork" /> }));

import RightPanel from "../components/layout/RightPanel.tsx";
import Inspector from "../components/inspector/Inspector.tsx";
import { useProjectStore } from "../store/useProjectStore.ts";
import { useSelectionStore } from "../store/useSelectionStore.ts";
import { useWorkspaceStore } from "../store/useWorkspaceStore.ts";

let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function renderPanel() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<RightPanel />);
    await vi.dynamicImportSettled();
  });
  return host;
}

async function renderInspector() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<Inspector />);
  });
  return host;
}

beforeEach(() => {
  useProjectStore.getState().clear();
  useSelectionStore.getState().clear();
  useWorkspaceStore.getState().setRightPanelTab("project");
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  useProjectStore.getState().clear();
  useSelectionStore.getState().clear();
});

describe("RightPanel destructive controls", () => {
  it("arms project clear on the first click and mutates only after confirmation", async () => {
    const component = useProjectStore.getState().addComponent("led");
    const container = await renderPanel();
    let clearButton = container.querySelector<HTMLButtonElement>("button[aria-label^='Clear project']");

    expect(clearButton).toBeTruthy();
    act(() => clearButton?.click());
    expect(useProjectStore.getState().project.components.some((item) => item.id === component.id)).toBe(true);
    expect(container.querySelector("button[aria-label^='Confirm clear project']")).toBeTruthy();

    clearButton = container.querySelector<HTMLButtonElement>("button[aria-label^='Confirm clear project']");
    act(() => clearButton?.click());
    expect(useProjectStore.getState().project.components).toHaveLength(0);
  });

  it("requires a second activation before removing a selected component", async () => {
    const component = useProjectStore.getState().addComponent("led");
    useSelectionStore.getState().setActive(component.id);
    useWorkspaceStore.getState().setRightPanelTab("inspect");
    const container = await renderInspector();
    let removeButton = container.querySelector<HTMLButtonElement>(`button[aria-label='Delete LED']`);

    expect(removeButton).toBeTruthy();
    act(() => removeButton?.click());
    expect(useProjectStore.getState().project.components.some((item) => item.id === component.id)).toBe(true);
    expect(container.querySelector(`button[aria-label^='Confirm delete LED']`)).toBeTruthy();

    removeButton = container.querySelector<HTMLButtonElement>(`button[aria-label^='Confirm delete LED']`);
    act(() => removeButton?.click());
    expect(useProjectStore.getState().project.components.some((item) => item.id === component.id)).toBe(false);
  });
});
