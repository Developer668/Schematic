// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ShoppingWorkspace from "../components/shopping/ShoppingWorkspace.tsx";
import { useProjectStore, type HardwareGraph } from "../store/useProjectStore.ts";
import { useShoppingStore, type ShoppingResult } from "../store/useShoppingStore.ts";

vi.mock("../shopping/partsSearchClient.ts", () => ({
  getCachedPartsSearch: vi.fn(() => null),
  requestPartsSearch: vi.fn(() => new Promise(() => undefined)),
}));

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

const publishedAt = "2026-09-03T12:00:00.000Z";

function listing(
  catalogId: string,
  title: string,
  partNumber: string,
  price: number,
): ShoppingResult {
  return {
    id: `listing-${catalogId}`,
    catalogId,
    title,
    partNumber,
    requestedQuantity: 1,
    exactMatch: true,
    offers: [{
      id: `offer-${catalogId}`,
      retailer: "Digi-Key",
      title,
      price,
      currency: "USD",
      url: `https://example.com/${catalogId}`,
      availability: "In stock",
      fetchedAt: publishedAt,
      provider: "Digi-Key",
    }],
    alternatives: [],
    updatedAt: publishedAt,
    provenance: {
      source: "webmcp-agent",
      provider: "Digi-Key",
      agentId: "shopping-ui-test",
      publishedAt,
    },
  };
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

  it("groups listings under cart parts and sums the priced line items", () => {
    const current = useProjectStore.getState().project;
    const project: HardwareGraph = {
      ...current,
      id: "shopping-ui-project",
      name: "Shopping UI test",
      components: [
        { id: "esp-1", definitionId: "esp32-devkit-v1", position: { x: 0, y: 0 }, rotation: 0, properties: {} },
        { id: "esp-2", definitionId: "esp32-devkit-v1", position: { x: 100, y: 0 }, rotation: 0, properties: {} },
        { id: "led-1", definitionId: "led", position: { x: 200, y: 0 }, rotation: 0, properties: {} },
      ],
      connections: [{
        id: "wire-1",
        source: { componentId: "esp-1", portId: "D2" },
        target: { componentId: "led-1", portId: "A" },
        domain: "digital",
      }],
    };
    useProjectStore.setState({ project, projects: [project], activeProjectId: project.id });
    useShoppingStore.setState({
      results: [
        listing("esp32-devkit-v1", "ESP32 Devkit V1", "ESP32-DEVKIT-V1", 8.5),
        listing("led", "LED", "LED-5MM", 1.25),
      ],
      requestStatus: "ready",
    });

    const container = renderWorkspace();
    expect(container.textContent).toContain("3 line items");
    expect(container.textContent).toContain("Hookup wire");
    expect(container.textContent).toContain("Qty 2");
    expect(container.textContent).toContain("$17.00");
    expect(container.textContent).toContain("$18.25");
    expect(container.textContent).toContain("Matched to the build cart");
    expect(container.querySelectorAll(".shopping-listing-group")).toHaveLength(2);
    expect(container.textContent).not.toContain("Google Shopping");
    expect(container.textContent).not.toContain("REVIEW FIRST");
  });
});
