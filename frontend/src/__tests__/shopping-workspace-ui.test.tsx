// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ShoppingWorkspace from "../components/shopping/ShoppingWorkspace.tsx";
import { useProjectStore } from "../store/useProjectStore.ts";
import { useShoppingStore } from "../store/useShoppingStore.ts";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function renderWorkspace() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(<ShoppingWorkspace />));
  return host;
}

describe("parts workspace automatic sourcing", () => {
  beforeEach(() => {
    useProjectStore.getState().clear();
    useShoppingStore.setState({ query: "", results: [], cart: [], budget: null, lastSearchAt: null, publicationError: null, requestStatus: "idle", handoff: null, discovery: null, undoStack: [] });
  });

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
  });

  it("shows the design-driven build cart without the retired search controls", () => {
    const container = renderWorkspace();
    expect(container.textContent).toContain("Build cart");
    expect(container.textContent).toContain("Est. build cost");
    expect(container.textContent).toContain("Add components to your design");
    expect(container.textContent).not.toContain("PUBLIC DISCOVERY");
    expect(container.textContent).not.toContain("Budget ceiling");
    expect(container.textContent).not.toContain("Undo");
    expect(container.textContent).not.toContain("Reset required");
    expect(container.querySelector("input[aria-label='Search exact parts']")).toBeNull();
    expect(container.querySelector("[data-testid='build-cart']")).toBeTruthy();
  });
});
