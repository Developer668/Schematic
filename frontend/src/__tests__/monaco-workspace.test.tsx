// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const editorHarness = vi.hoisted(() => ({
  props: null as { value?: string; onChange?: (value?: string) => void } | null,
}));

const authHarness = vi.hoisted(() => ({ userId: "user-a" as string | null }));

vi.mock("../auth/session.ts", () => ({
  getCurrentUserId: () => authHarness.userId,
}));

vi.mock("@monaco-editor/react", () => ({
  default: (props: { value?: string; onChange?: (value?: string) => void }) => {
    editorHarness.props = props;
    return <textarea data-testid="monaco-editor" value={props.value ?? ""} onChange={(event) => props.onChange?.(event.target.value)} />;
  },
}));

import MonacoWorkspace from "../components/editor/MonacoWorkspace.tsx";
import { useProjectStore } from "../store/useProjectStore.ts";
import { useSelectionStore } from "../store/useSelectionStore.ts";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function renderWorkspace() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(<MonacoWorkspace />));
  return host;
}

function addBoardWithFiles() {
  const store = useProjectStore.getState();
  const board = store.addComponent("arduino-uno");
  useSelectionStore.getState().setActive(board.id);
  store.writeCodeDocument({
    targetComponentId: board.id,
    targetDefinitionId: "arduino-uno",
    language: "arduino",
    files: [
      { name: "config.h", content: "#define READY 1" },
      { name: "sketch.ino", content: "void setup() {}" },
    ],
  });
  return board.id;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  editorHarness.props = null;
  useSelectionStore.getState().clear();
  useProjectStore.getState().clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("MonacoWorkspace source synchronization", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    authHarness.userId = "user-a";
    useProjectStore.getState().clear();
    useSelectionStore.getState().clear();
  });

  it("keeps a manual edit and the other file when the debounced save advances the document revision", async () => {
    const boardId = addBoardWithFiles();
    const container = renderWorkspace();
    const editor = () => container.querySelector<HTMLTextAreaElement>("[data-testid='monaco-editor']");
    expect(editor()?.value).toBe("#define READY 1");

    act(() => editorHarness.props?.onChange?.("#define READY 0\n#define MANUAL 1"));
    expect(editor()?.value).toContain("MANUAL");
    expect(useProjectStore.getState().getCodeDocument(boardId)?.revision).toBe(1);

    await act(async () => {
      vi.advanceTimersByTime(320);
      await Promise.resolve();
    });

    expect(useProjectStore.getState().getCodeDocument(boardId)?.revision).toBe(2);
    expect(editor()?.value).toBe("#define READY 0\n#define MANUAL 1");

    const sketchTab = Array.from(container.querySelectorAll<HTMLButtonElement>("button[role='tab']")).find((button) => button.textContent === "sketch.ino");
    expect(sketchTab).toBeTruthy();
    act(() => sketchTab?.click());
    expect(editor()?.value).toBe("void setup() {}");
    act(() => editorHarness.props?.onChange?.("void setup() { /* manual edit */ }") );

    const configTab = Array.from(container.querySelectorAll<HTMLButtonElement>("button[role='tab']")).find((button) => button.textContent === "config.h");
    expect(configTab).toBeTruthy();
    act(() => configTab?.click());
    expect(editor()?.value).toBe("#define READY 0\n#define MANUAL 1");
    act(() => sketchTab?.click());
    expect(editor()?.value).toContain("manual edit");

    await act(async () => {
      vi.advanceTimersByTime(320);
      await Promise.resolve();
    });

    expect(useProjectStore.getState().getCodeDocument(boardId)?.files).toEqual([
      { name: "config.h", content: "#define READY 0\n#define MANUAL 1" },
      { name: "sketch.ino", content: "void setup() { /* manual edit */ }" },
    ]);
    expect(editor()?.value).toBe("void setup() { /* manual edit */ }");
  });

  it("keeps an oversized draft visible and refuses to drop or partially save it", async () => {
    const boardId = addBoardWithFiles();
    const container = renderWorkspace();
    const oversized = "x".repeat(1024 * 1024 + 1);

    act(() => editorHarness.props?.onChange?.(oversized));
    await act(async () => {
      vi.advanceTimersByTime(320);
      await Promise.resolve();
    });

    expect(editorHarness.props?.value).toBe(oversized);
    expect(useProjectStore.getState().getCodeDocument(boardId)?.files[0]).toEqual({ name: "config.h", content: "#define READY 1" });
    expect(container.textContent).toContain("Save failed — draft kept");
  });

  it("does not overwrite a newer WebMCP/store revision with a stale editor draft", async () => {
    const boardId = addBoardWithFiles();
    const container = renderWorkspace();

    act(() => editorHarness.props?.onChange?.("// local unsaved draft"));
    act(() => {
      useProjectStore.getState().writeCodeDocument({
        targetComponentId: boardId,
        targetDefinitionId: "arduino-uno",
        language: "arduino",
        files: [
          { name: "config.h", content: "// newer external revision" },
          { name: "sketch.ino", content: "void setup() {}" },
        ],
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(320);
      await Promise.resolve();
    });

    expect(editorHarness.props?.value).toBe("// local unsaved draft");
    expect(useProjectStore.getState().getCodeDocument(boardId)?.files[0]).toEqual({ name: "config.h", content: "// newer external revision" });
    expect(container.textContent).toContain("Save failed — draft kept");
  });

  it("exposes both source versions and rebases the local draft only after an explicit choice", async () => {
    const boardId = addBoardWithFiles();
    const container = renderWorkspace();

    act(() => editorHarness.props?.onChange?.("// local draft to review"));
    act(() => {
      useProjectStore.getState().writeCodeDocument({
        targetComponentId: boardId,
        targetDefinitionId: "arduino-uno",
        language: "arduino",
        files: [
          { name: "config.h", content: "// newer durable revision" },
          { name: "sketch.ino", content: "void setup() {}" },
        ],
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(320);
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='code-source-conflict']")).toBeTruthy();
    expect(container.textContent).toContain("Download local draft");
    expect(container.textContent).toContain("Download newer source");
    expect(container.textContent).toContain("Reload newer source");
    expect(container.textContent).toContain("Rebase & save local draft");
    expect(editorHarness.props?.value).toBe("// local draft to review");
    expect(useProjectStore.getState().getCodeDocument(boardId)?.files[0]?.content).toBe("// newer durable revision");

    const rebase = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Rebase & save local draft");
    expect(rebase).toBeTruthy();
    act(() => rebase?.click());

    await act(async () => {
      vi.advanceTimersByTime(320);
      await Promise.resolve();
    });

    expect(useProjectStore.getState().getCodeDocument(boardId)?.revision).toBe(3);
    expect(useProjectStore.getState().getCodeDocument(boardId)?.files[0]?.content).toBe("// local draft to review");
    expect(container.querySelector("[data-testid='code-source-conflict']")).toBeNull();
  });

  it("clears the conflict projection when the user explicitly reloads the newer source", async () => {
    const boardId = addBoardWithFiles();
    const container = renderWorkspace();

    act(() => editorHarness.props?.onChange?.("// local draft to discard"));
    act(() => {
      useProjectStore.getState().writeCodeDocument({
        targetComponentId: boardId,
        targetDefinitionId: "arduino-uno",
        language: "arduino",
        files: [
          { name: "config.h", content: "// newer durable config" },
          { name: "sketch.ino", content: "void setup() {}" },
        ],
      });
    });
    await act(async () => {
      vi.advanceTimersByTime(320);
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='code-source-conflict']")).toBeTruthy();
    const reload = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Reload newer source");
    expect(reload).toBeTruthy();
    act(() => reload?.click());

    expect(container.querySelector("[data-testid='code-source-conflict']")).toBeNull();
    expect(editorHarness.props?.value).toBe("// newer durable config");
    expect(useProjectStore.getState().getCodeDocument(boardId)?.files[0]?.content).toBe("// newer durable config");
  });

  it("keeps a local draft when the durable source was deleted and rebases with create-only semantics", async () => {
    const boardId = addBoardWithFiles();
    const container = renderWorkspace();

    act(() => editorHarness.props?.onChange?.("// local draft after delete"));
    const currentProject = useProjectStore.getState().project;
    const deletedProject = { ...currentProject, codeDocuments: [], firmwareTargets: [] };
    act(() => useProjectStore.setState({ project: deletedProject, projects: [deletedProject], activeProjectId: deletedProject.id }));

    await act(async () => {
      vi.advanceTimersByTime(320);
      await Promise.resolve();
    });

    expect(useProjectStore.getState().getCodeDocument(boardId)).toBeUndefined();
    expect(editorHarness.props?.value).toBe("// local draft after delete");
    expect(container.querySelector("[data-testid='code-source-conflict']")).toBeTruthy();
    expect(container.textContent).toContain("durable source was deleted");

    const rebase = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Rebase & save local draft");
    expect(rebase).toBeTruthy();
    act(() => rebase?.click());
    await act(async () => {
      vi.advanceTimersByTime(320);
      await Promise.resolve();
    });

    expect(useProjectStore.getState().getCodeDocument(boardId)?.revision).toBe(1);
    expect(useProjectStore.getState().getCodeDocument(boardId)?.files[0]?.content).toBe("// local draft after delete");
    expect(container.querySelector("[data-testid='code-source-conflict']")).toBeNull();
  });

  it("keeps a fallback draft visible when another writer creates the first document", async () => {
    const store = useProjectStore.getState();
    const board = store.addComponent("arduino-uno");
    useSelectionStore.getState().setActive(board.id);
    const container = renderWorkspace();

    act(() => editorHarness.props?.onChange?.("// local draft before first durable write"));
    act(() => {
      useProjectStore.getState().writeCodeDocument({
        targetComponentId: board.id,
        targetDefinitionId: "arduino-uno",
        language: "arduino",
        files: [{ name: "sketch.ino", content: "// first external document" }],
      });
    });

    expect(editorHarness.props?.value).toBe("// local draft before first durable write");
    await act(async () => {
      vi.advanceTimersByTime(320);
      await Promise.resolve();
    });

    expect(editorHarness.props?.value).toBe("// local draft before first durable write");
    expect(useProjectStore.getState().getCodeDocument(board.id)?.files[0]?.content).toBe("// first external document");
    expect(container.textContent).toContain("Save failed — draft kept");
  });

  it("never flushes a delayed draft into another authenticated room with colliding ids", async () => {
    const store = useProjectStore.getState();
    const board = store.addComponent("arduino-uno");
    useSelectionStore.getState().setActive(board.id);
    renderWorkspace();

    act(() => editorHarness.props?.onChange?.("// private draft from user A"));

    const projectA = useProjectStore.getState().project;
    const projectB = {
      ...projectA,
      // Deliberately preserve the project and component ids while representing
      // the newly authenticated room with no durable source document.
      codeDocuments: [],
      firmwareTargets: [],
    };
    authHarness.userId = "user-b";
    act(() => {
      useProjectStore.setState({
        project: projectB,
        projects: [projectB],
        activeProjectId: projectB.id,
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(320);
      await Promise.resolve();
    });

    expect(useProjectStore.getState().getCodeDocument(board.id)).toBeUndefined();
    expect(editorHarness.props?.value).not.toBe("// private draft from user A");
  });
});
