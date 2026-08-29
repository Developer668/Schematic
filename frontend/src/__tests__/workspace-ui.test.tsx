// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../components/canvas/HardwareCanvas.tsx", () => ({ default: () => <div data-testid="canvas" /> }));
vi.mock("../components/layout/BottomDock.tsx", () => ({ default: () => <div data-testid="bottom-dock" /> }));
vi.mock("../components/import/ImportDialog.tsx", () => ({ default: () => null }));
vi.mock("../components/ComponentArtwork.tsx", () => ({ default: () => <div data-testid="artwork" /> }));
vi.mock("../components/inspector/Inspector.tsx", () => ({ default: () => <div data-testid="inspector" /> }));
vi.mock("../components/shopping/ShoppingWorkspace.tsx", () => ({ default: () => <div data-testid="shopping" /> }));
vi.mock("../components/editor/MonacoWorkspace.tsx", () => ({ default: () => <div data-testid="monaco" /> }));
vi.mock("../components/LogoMark.tsx", () => ({ default: () => <span data-testid="logo" /> }));
vi.mock("../utils/vllxFile.ts", () => ({ triggerDownloadVlx: vi.fn() }));
vi.mock("../webmcp/tools.ts", () => ({
  getRegisteredToolNames: () => ["simulation.run"],
  invokeWebMCPTool: vi.fn(async () => ({ isError: false })),
}));
vi.mock("../auth/session.ts", () => ({
  useAuth: () => ({ session: null }),
  getCurrentUserId: () => "local-development",
  signOut: vi.fn(),
}));

import { BrowserRouter } from "react-router-dom";
import StudioPage from "../pages/StudioPage.tsx";
import RightPanel from "../components/layout/RightPanel.tsx";
import { nextComponentPosition, useProjectStore } from "../store/useProjectStore.ts";
import { useSelectionStore } from "../store/useSelectionStore.ts";

let root: Root | undefined;
let host: HTMLDivElement;

function render(element: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(element));
  return host;
}

function studio() {
  return render(<BrowserRouter><StudioPage /></BrowserRouter>);
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  window.localStorage.clear();
  useProjectStore.getState().clear();
  useSelectionStore.getState().clear();
});

describe("workspace UI", () => {
  beforeEach(() => {
    useProjectStore.getState().clear();
  });

  it("opens a visible project menu and supports keyboard and double-click rename", () => {
    const container = studio();
    const selector = container.querySelector<HTMLButtonElement>("button[aria-haspopup='menu']");
    expect(selector).toBeTruthy();

    act(() => selector?.click());
    const menu = container.querySelector<HTMLElement>("[role='menu'][aria-label='Projects']");
    expect(menu).toBeTruthy();
    expect(menu?.className).toContain("bg-card");
    expect(menu?.className).toContain("border border-border");
    expect(menu?.className).toContain("z-[70]");

    const projectName = menu?.querySelector<HTMLElement>("[role='menuitem'] span[title='Double-click to rename']");
    expect(projectName).toBeTruthy();
    act(() => projectName?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const input = container.querySelector<HTMLInputElement>("input[aria-label^='Rename ']");
    expect(input).toBeTruthy();
    act(() => {
      if (!input) return;
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(input, "Renamed hardware");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(useProjectStore.getState().project.name).toBe("Renamed hardware");
  }, 15_000);

  it("keeps project names unique and adds an explicit copy suffix", () => {
    const store = useProjectStore.getState();
    const source = store.project;
    const created = store.createProject(source.name);
    const createdProject = useProjectStore.getState().projects.find((item) => item.id === created);
    expect(createdProject?.name).not.toBe(source.name);

    const copyId = useProjectStore.getState().duplicateProject(source.id);
    const copy = useProjectStore.getState().projects.find((item) => item.id === copyId);
    expect(copy?.name).toContain(`${source.name} copy`);
    expect(new Set(useProjectStore.getState().projects.map((item) => item.name.toLowerCase())).size).toBe(useProjectStore.getState().projects.length);
  });

  it("places default-added components in separate canvas cells", () => {
    const store = useProjectStore.getState();
    const ids = [
      store.addComponent("esp32-devkit-v1").id,
      store.addComponent("pushbutton").id,
      store.addComponent("led").id,
      store.addComponent("bmp280").id,
      store.addComponent("ds3231").id,
    ];
    const positions = useProjectStore.getState().project.components.map((component) => component.position);
    expect(new Set(positions.map((position) => `${position.x}:${position.y}`)).size).toBe(5);
    expect(positions).toEqual([
      { x: 80, y: 80 },
      { x: 440, y: 80 },
      { x: 800, y: 80 },
      { x: 1160, y: 80 },
      { x: 80, y: 540 },
    ]);
    store.removeComponent(ids[0]);
    expect(store.addComponent("resistor").id).toContain("resistor");
    const lastComponent = useProjectStore.getState().project.components[useProjectStore.getState().project.components.length - 1];
    expect(lastComponent?.position).toEqual({ x: 80, y: 80 });
  });

  it("repairs saved overlap without changing component identity or wiring data", () => {
    const store = useProjectStore.getState();
    store.loadProject({
      ...store.project,
      components: [
        { id: "board-1", definitionId: "esp32-devkit-v1", position: { x: 80, y: 80 }, rotation: 0, properties: { keep: true } },
        { id: "button-1", definitionId: "pushbutton", position: { x: 80, y: 80 }, rotation: 90, properties: { label: "Input" } },
        { id: "led-1", definitionId: "led", position: { x: 80, y: 80 }, rotation: 0, properties: { color: "red" } },
      ],
      connections: [{ id: "connection-1", source: { componentId: "board-1", portId: "gpio-0" }, target: { componentId: "button-1", portId: "pin-1" }, domain: "gpio" }],
    });

    const repaired = useProjectStore.getState().project;
    expect(repaired.components.map((component) => component.id)).toEqual(["board-1", "button-1", "led-1"]);
    expect(repaired.components.map((component) => component.position)).toEqual([
      { x: 80, y: 80 },
      { x: 440, y: 80 },
      { x: 800, y: 80 },
    ]);
    expect(repaired.components[1]?.rotation).toBe(90);
    expect(repaired.components[1]?.properties).toMatchObject({ label: "Input" });
    expect(repaired.connections).toEqual(expect.arrayContaining([{ id: "connection-1", source: { componentId: "board-1", portId: "gpio-0" }, target: { componentId: "button-1", portId: "pin-1" }, domain: "gpio" }]));
  });

  it("keeps growing without overlap and skips multiple candidates blocked by manual placement", () => {
    const store = useProjectStore.getState();
    for (let index = 0; index < 20; index += 1) store.addComponent("led");
    const positions = useProjectStore.getState().project.components.map((component) => component.position);
    expect(new Set(positions.map((position) => `${position.x}:${position.y}`)).size).toBe(20);
    for (let first = 0; first < positions.length; first += 1) {
      for (let second = first + 1; second < positions.length; second += 1) {
        expect(Math.abs(positions[first].x - positions[second].x) >= 360 || Math.abs(positions[first].y - positions[second].y) >= 460).toBe(true);
      }
    }
    expect(nextComponentPosition([{ position: { x: 260, y: 80 } }, { position: { x: 980, y: 80 } }])).toEqual({ x: 80, y: 540 });
  });

  it("keeps secondary controls behind one menu and dismisses it on outside click or Escape", () => {
    const container = studio();
    const overflow = container.querySelector<HTMLButtonElement>("button[aria-label='Open workspace menu']");
    expect(overflow).toBeTruthy();
    act(() => overflow?.click());
    expect(container.querySelector("[role='menu'][aria-label='Workspace actions']")).toBeTruthy();
    act(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(container.querySelector("[role='menu'][aria-label='Workspace actions']")).toBeNull();

    act(() => overflow?.click());
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(container.querySelector("[role='menu'][aria-label='Workspace actions']")).toBeNull();
  });

  it("docks the code panel beside the canvas at tablet widths", async () => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    try {
      const container = studio();
      const overflow = container.querySelector<HTMLButtonElement>("button[aria-label='Open workspace menu']");
      expect(overflow).toBeTruthy();

      act(() => overflow?.click());
      const menu = container.querySelector<HTMLElement>("[role='menu'][aria-label='Workspace actions']");
      const showCode = Array.from(menu?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((button) => button.textContent?.includes("Show code panel"));
      expect(showCode).toBeTruthy();
      await act(async () => {
        showCode?.click();
        await Promise.resolve();
      });

      const dockedPanel = container.querySelector<HTMLElement>("[data-testid='docked-code-panel']");
      expect(dockedPanel).toBeTruthy();
      expect(dockedPanel?.classList.contains("md:flex")).toBe(true);
      expect(container.querySelector("[data-testid='canvas']")).toBeTruthy();
      expect(container.querySelector("[data-testid='bottom-dock']")).toBeTruthy();
      expect(container.querySelector<HTMLElement>("[data-testid='code-panel-mobile-region']")?.classList.contains("md:hidden")).toBe(true);

      act(() => overflow?.click());
      const hideCode = Array.from(container.querySelectorAll<HTMLButtonElement>("[role='menu'] button")).find((button) => button.textContent?.includes("Hide code panel"));
      expect(hideCode).toBeTruthy();
      await act(async () => {
        hideCode?.click();
        await Promise.resolve();
      });
      expect(container.querySelector("[data-testid='docked-code-panel']")).toBeNull();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: previousWidth });
    }
  }, 15_000);

  it("renders no redundant copy actions in the right panel", () => {
    const component = useProjectStore.getState().addComponent("led");
    useSelectionStore.getState().setActive(component.id);
    const container = render(<RightPanel />);
    const inspectTab = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Inspect"));
    act(() => inspectTab?.click());
    const copyButtons = Array.from(container.querySelectorAll("button")).filter((button) => /copy/i.test(button.textContent ?? button.getAttribute("aria-label") ?? ""));
    expect(copyButtons).toHaveLength(0);
    expect(container.querySelector("button[aria-label*='Copy' i]")).toBeNull();
    expect(container.querySelector("[aria-label='Copy project JSON']")).toBeNull();
  });
});
