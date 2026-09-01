// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../auth/session.ts", () => ({
  apiUrl: (path: string) => path,
  getAuthHeaders: vi.fn(async () => ({})),
  getCurrentUserId: () => "local-development",
}));

import ImportDialog from "../components/import/ImportDialog.tsx";
import { MAX_PROJECTS_PER_WORKSPACE, useProjectStore } from "../store/useProjectStore.ts";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function renderDialog() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(<ImportDialog onClose={vi.fn()} />));
  return host;
}

function chooseFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, "files", { configurable: true, value: files });
  act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ImportDialog", () => {
  it("ignores an older hardware-model analysis after the file selection changes", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    vi.stubGlobal("fetch", fetchMock);

    const container = renderDialog();
    act(() => Array.from(container.querySelectorAll<HTMLButtonElement>("[role='tab']"))
      .find((button) => button.textContent?.includes("Hardware models"))?.click());

    const input = container.querySelector<HTMLInputElement>("input[type='file'][multiple]");
    expect(input).toBeTruthy();
    expect(input?.closest("label")?.className).toContain("focus-within:ring-2");

    chooseFiles(input!, [new File(["old"], "old.ibis")]);
    act(() => Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("Check selected files"))?.click());
    expect(container.querySelector("[role='tabpanel']")?.getAttribute("aria-busy")).toBe("true");

    chooseFiles(input!, [new File(["new"], "new.touchstone")]);
    act(() => Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("Check selected files"))?.click());

    await act(async () => {
      second.resolve(new Response(JSON.stringify({ possibleExternalTools: ["Touchstone"], claims: { filesRead: false, filesExecuted: false, filesImported: false, compatibilityVerified: false }, steps: [] }), { status: 200 }));
      await second.promise;
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Touchstone");

    await act(async () => {
      first.resolve(new Response(JSON.stringify({ possibleExternalTools: ["Stale IBIS"], claims: { filesRead: false, filesExecuted: false, filesImported: false, compatibilityVerified: false }, steps: [] }), { status: 200 }));
      await first.promise;
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Touchstone");
    expect(container.textContent).not.toContain("Stale IBIS");
  });

  it("keeps the dialog open when the workspace cannot accept another project", async () => {
    while (useProjectStore.getState().projects.length < MAX_PROJECTS_PER_WORKSPACE) useProjectStore.getState().createProject();
    try {
      const container = renderDialog();
      const input = container.querySelector<HTMLInputElement>("input[type='file']:not([multiple])");
      expect(input).toBeTruthy();
      chooseFiles(input!, [new File([JSON.stringify({ id: "capacity-import", name: "Capacity import", components: [], connections: [], firmwareTargets: [], version: 1 })], "capacity.json", { type: "application/json" })]);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(container.textContent).toContain("Ready to import");

      act(() => Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("Import as new project"))?.click());
      expect(container.querySelector("[role='dialog']")).toBeTruthy();
      expect(container.querySelector("[role='alert']")?.textContent).toContain(`${MAX_PROJECTS_PER_WORKSPACE} projects`);
    } finally {
      act(() => {
        let state = useProjectStore.getState();
        for (const project of state.projects.slice(1)) state.deleteProject(project.id);
        state = useProjectStore.getState();
        state.switchProject(state.projects[0]?.id ?? state.activeProjectId);
        state.clear();
      });
    }
  });
});
