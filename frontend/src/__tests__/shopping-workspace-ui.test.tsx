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

describe("parts workspace agent scaffold", () => {
  beforeEach(() => {
    useProjectStore.getState().clear();
    useShoppingStore.setState({ query: "", results: [], cart: [], budget: null, lastSearchAt: null, publicationError: null, undoStack: [] });
  });

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
  });

  it("shows the public search handoff scaffold and keeps cart sourcing agent-gated", () => {
    const container = renderWorkspace();
    expect(container.textContent).toContain("Waiting for the WebMCP agent");
    expect(container.textContent).toContain("Agent publication required");
    expect(container.textContent).toContain("shopping.search");
    expect(Array.from(container.querySelectorAll("button")).some((button) => /search/i.test(button.textContent ?? ""))).toBe(true);

    const input = container.querySelector<HTMLInputElement>("input[aria-label='Search exact parts']");
    expect(input).toBeTruthy();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "ESP32-S3");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(useShoppingStore.getState().query).toBe("ESP32-S3");
  });
});
