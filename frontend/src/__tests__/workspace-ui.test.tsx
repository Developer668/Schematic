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
import { useProjectStore } from "../store/useProjectStore.ts";
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
    expect(menu?.className).toContain("bg-background");
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
  });

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
