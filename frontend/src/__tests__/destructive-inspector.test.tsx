// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../components/ComponentArtwork.tsx", () => ({ default: () => <div data-testid="artwork" /> }));

import Inspector from "../components/inspector/Inspector.tsx";
import { useProjectStore } from "../store/useProjectStore.ts";
import { useSelectionStore } from "../store/useSelectionStore.ts";

let root: Root | undefined;
let host: HTMLDivElement | undefined;

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
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  useProjectStore.getState().clear();
  useSelectionStore.getState().clear();
});

describe("Inspector destructive controls", () => {
  it("does not delete the selected component until the confirmation activation", () => {
    const component = useProjectStore.getState().addComponent("led");
    useSelectionStore.getState().setActive(component.id);
    const container = renderInspector();
    let deleteButton = container.querySelector<HTMLButtonElement>("button[aria-label^='Delete ']");

    expect(deleteButton).toBeTruthy();
    act(() => deleteButton?.click());
    expect(useProjectStore.getState().project.components.some((item) => item.id === component.id)).toBe(true);
    expect(container.querySelector("button[aria-label^='Confirm delete ']")).toBeTruthy();

    deleteButton = container.querySelector<HTMLButtonElement>("button[aria-label^='Confirm delete ']");
    act(() => deleteButton?.click());
    expect(useProjectStore.getState().project.components.some((item) => item.id === component.id)).toBe(false);
  });

  it("disarms an armed deletion when selection changes", () => {
    const first = useProjectStore.getState().addComponent("led");
    const second = useProjectStore.getState().addComponent("pushbutton");
    useSelectionStore.getState().setActive(first.id);
    const container = renderInspector();
    const firstDelete = container.querySelector<HTMLButtonElement>("button[aria-label^='Delete ']");

    act(() => firstDelete?.click());
    expect(container.querySelector("button[aria-label^='Confirm delete ']")).toBeTruthy();
    act(() => useSelectionStore.getState().setActive(second.id));
    expect(container.querySelector("button[aria-label^='Confirm delete ']")).toBeNull();
    expect(useProjectStore.getState().project.components).toHaveLength(2);
  });
});
