// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ValidationPanel from "../components/validation/ValidationPanel.tsx";
import { useProjectStore } from "../store/useProjectStore.ts";
import { useValidationStore } from "../store/useValidationStore.ts";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function renderPanel() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(<ValidationPanel />));
  return host;
}

beforeEach(() => {
  useProjectStore.getState().clear();
  useValidationStore.getState().clear();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  useProjectStore.getState().clear();
  useValidationStore.getState().clear();
});

describe("ValidationPanel", () => {
  it("does not render unsupported auto-fix controls or mutate the graph on repeat checks", () => {
    useProjectStore.getState().addComponent("led");
    const before = structuredClone(useProjectStore.getState().project);
    const container = renderPanel();
    const validateButton = container.querySelector<HTMLButtonElement>("button");

    expect(validateButton?.textContent).toBe("Run graph checks");
    act(() => validateButton?.click());
    act(() => validateButton?.click());

    expect(container.textContent).toContain("MISSING_GROUND");
    expect(container.textContent).not.toContain("Auto-fix");
    expect(Array.from(container.querySelectorAll("button")).map((button) => button.textContent)).toEqual(["Run graph checks"]);
    expect(useProjectStore.getState().project).toEqual(before);
    expect(new Set(useValidationStore.getState().issues.map((issue) => issue.id)).size).toBe(useValidationStore.getState().issues.length);
    expect(useValidationStore.getState().issues.some((issue) => Object.prototype.hasOwnProperty.call(issue, "autoFix"))).toBe(false);
  });
});
