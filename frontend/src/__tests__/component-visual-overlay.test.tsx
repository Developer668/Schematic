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

  it("exposes deterministic typed action controls for modeled component outcomes", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const onAction = vi.fn();
    act(() => root?.render(<ComponentVisualOverlay
      componentId="outcomes-1"
      onAction={onAction}
      projection={{
        accessibleSummary: "Modeled outcomes.",
        primitives: [
          { kind: "indicator", key: "indicator", on: true, color: "#22c55e", intensity: 1 },
          { kind: "switch", key: "relay", position: "closed" },
          { kind: "text-display", key: "display", lines: ["Hello"] },
          { kind: "numeric-readout", key: "sensor", value: 42, unit: "°C" },
          { kind: "rotation", key: "actuator", degrees: 90 },
          { kind: "activity", key: "buzzer", state: "active" },
          { kind: "activity", key: "motor", state: "idle" },
          { kind: "button", key: "button", pressed: false },
        ],
      }}
    />));

    const controls = Array.from(host.querySelectorAll<HTMLButtonElement>("button"));
    expect(controls.map((control) => control.getAttribute("aria-label"))).toEqual([
      "Turn indicator off",
      "Open relay",
      "Clear display",
      "Increase sensor reading",
      "Set actuator angle to 135 degrees",
      "Stop buzzer",
      "Start motor",
      "Preview button; press",
    ]);
    act(() => controls.forEach((control) => control.click()));
    expect(onAction.mock.calls).toEqual([
      ["indicator.set", { kind: "literal", value: { on: false } }],
      ["relay.set", { kind: "literal", value: { on: false } }],
      ["display.clear", { kind: "literal", value: {} }],
      ["sensor.setReading", { kind: "literal", value: { value: 43 } }],
      ["servo.setAngle", { kind: "literal", value: { degrees: 135 } }],
      ["buzzer.stop", { kind: "literal", value: {} }],
      ["motor.setSpeed", { kind: "literal", value: { rpm: 500 } }],
      ["button.setPressed", { kind: "literal", value: { pressed: true } }],
    ]);
  });

  it("routes membrane keypad controls through the calculator typed action", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const onAction = vi.fn();
    act(() => root?.render(<ComponentVisualOverlay
      componentId="keypad-1"
      onAction={onAction}
      projection={{ accessibleSummary: "Calculator keypad result is 7.", primitives: [{ kind: "keypad", key: "keypad", lastKey: "7", keys: ["7", "+", "5", "="] }] }}
    />));

    const key = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.getAttribute("aria-label") === "Press calculator key 7");
    expect(key).toBeDefined();
    act(() => key?.click());
    expect(onAction).toHaveBeenCalledWith("keypad.press", { kind: "literal", value: { key: "7" } });
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
