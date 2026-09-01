// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../components/inspector/Inspector.tsx", () => ({ default: () => <div data-testid="inspector" /> }));
vi.mock("../components/shopping/ShoppingWorkspace.tsx", () => ({ default: () => <div data-testid="shopping" /> }));
vi.mock("../components/editor/MonacoWorkspace.tsx", () => ({ default: () => <div data-testid="monaco" /> }));
vi.mock("../components/ComponentArtwork.tsx", () => ({ default: () => <div data-testid="artwork" /> }));

import RightPanel from "../components/layout/RightPanel.tsx";
import { useProjectStore } from "../store/useProjectStore.ts";
import { useSelectionStore } from "../store/useSelectionStore.ts";
import { useWorkspaceStore } from "../store/useWorkspaceStore.ts";

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function renderPanel() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(<RightPanel />));
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
  it("arms project clear on the first click and mutates only after confirmation", () => {
    const component = useProjectStore.getState().addComponent("led");
    const container = renderPanel();
    let clearButton = container.querySelector<HTMLButtonElement>("button[aria-label^='Clear project']");

    expect(clearButton).toBeTruthy();
    act(() => clearButton?.click());
    expect(useProjectStore.getState().project.components.some((item) => item.id === component.id)).toBe(true);
    expect(container.querySelector("button[aria-label^='Confirm clear project']")).toBeTruthy();

    clearButton = container.querySelector<HTMLButtonElement>("button[aria-label^='Confirm clear project']");
    act(() => clearButton?.click());
    expect(useProjectStore.getState().project.components).toHaveLength(0);
  });

  it("requires a second activation before removing a selected component", () => {
    const component = useProjectStore.getState().addComponent("led");
    useSelectionStore.getState().setActive(component.id);
    useWorkspaceStore.getState().setRightPanelTab("inspect");
    const container = renderPanel();
    let removeButton = container.querySelector<HTMLButtonElement>(`button[aria-label='Remove ${component.id}']`);

    expect(removeButton).toBeTruthy();
    act(() => removeButton?.click());
    expect(useProjectStore.getState().project.components.some((item) => item.id === component.id)).toBe(true);
    expect(container.querySelector(`button[aria-label^='Confirm remove ${component.id}']`)).toBeTruthy();

    removeButton = container.querySelector<HTMLButtonElement>(`button[aria-label^='Confirm remove ${component.id}']`);
    act(() => removeButton?.click());
    expect(useProjectStore.getState().project.components.some((item) => item.id === component.id)).toBe(false);
  });
});
