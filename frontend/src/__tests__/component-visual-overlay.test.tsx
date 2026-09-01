// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import ComponentVisualOverlay from "../components/canvas/ComponentVisualOverlay.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

describe("ComponentVisualOverlay", () => {
  it("renders generic primitives and exposes the profile summary", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root?.render(<ComponentVisualOverlay componentId="led-1" projection={{ accessibleSummary: "Indicator is on.", primitives: [{ kind: "indicator", key: "indicator", on: true, color: "#22c55e", intensity: 1 }, { kind: "numeric-readout", key: "value", value: 42, unit: "rpm" }] }} />));
    expect(host.querySelector("[data-component-id='led-1']")?.getAttribute("aria-label")).toBe("Indicator is on.");
    expect(host.querySelectorAll(".component-visual-indicator")).toHaveLength(1);
    expect(host.querySelector(".component-visual-number")?.textContent).toContain("42");
  });

  it("routes an interactive button through the typed event callback", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const onEvent = vi.fn();
    act(() => root?.render(<ComponentVisualOverlay componentId="button-1" onEvent={onEvent} projection={{ accessibleSummary: "Button is released.", primitives: [{ kind: "button", key: "button", pressed: false }] }} />));
    act(() => host?.querySelector<HTMLButtonElement>("button")?.click());
    expect(onEvent).toHaveBeenCalledWith("button.pressed", { pressed: true });
  });

  it("never forwards an untrusted indicator value into CSS", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root?.render(<ComponentVisualOverlay componentId="led-1" projection={{ accessibleSummary: "Indicator is on.", primitives: [{ kind: "indicator", key: "indicator", on: true, color: "url(//attacker.invalid/pixel)", intensity: 1 }] }} />));
    const indicator = host.querySelector<HTMLElement>(".component-visual-indicator");
    expect(indicator?.style.getPropertyValue("--indicator-color")).toBe("#71717a");
    expect(indicator?.getAttribute("style")).not.toContain("url(");
  });
});
