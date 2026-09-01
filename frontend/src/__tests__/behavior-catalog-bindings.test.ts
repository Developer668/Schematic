import { describe, expect, it } from "vitest";
import { getCatalogComponent } from "../data/catalog.ts";
import { capabilitiesForCatalogComponent } from "../behavior/capabilities.ts";

describe("explicit Behavior Preview catalog bindings", () => {
  it("only grants the checked-in profiles to exact component IDs", () => {
    expect(getCatalogComponent("pushbutton")?.behavior).toEqual({ profileId: "momentary-input", profileVersion: 1 });
    expect(getCatalogComponent("led")?.behavior).toEqual({ profileId: "digital-indicator", profileVersion: 1 });
    expect(getCatalogComponent("lcd1602")?.behavior).toEqual({ profileId: "text-display", profileVersion: 1 });
    expect(getCatalogComponent("buzzer")?.behavior).toEqual({ profileId: "buzzer", profileVersion: 1 });
    expect(getCatalogComponent("relay")?.behavior).toEqual({ profileId: "relay", profileVersion: 1 });
    expect(getCatalogComponent("servo")?.behavior).toEqual({ profileId: "rotary-actuator", profileVersion: 1 });
    expect(getCatalogComponent("stepper-motor")?.behavior).toEqual({ profileId: "motor", profileVersion: 1, variant: "stepper" });
    expect(getCatalogComponent("ntc-temperature-sensor")?.behavior).toEqual({ profileId: "numeric-sensor", profileVersion: 1, variant: "temperature" });
    expect(getCatalogComponent("resistor")?.behavior).toBeUndefined();
  });

  it("adapts exact bindings into profile-declared controls without inference", () => {
    const led = capabilitiesForCatalogComponent({ id: "led-1", definitionId: "led" });
    expect(led.profile).toEqual({ profileId: "digital-indicator", profileVersion: 1 });
    expect(led.actions.map((action) => action.actionId)).toEqual(["indicator.set", "indicator.setBrightness"]);

    const resistor = capabilitiesForCatalogComponent({ id: "r-1", definitionId: "resistor" });
    expect(resistor.actions).toHaveLength(0);
    expect(resistor.events).toHaveLength(0);
    expect(resistor.limitations.join(" ")).toContain("no registered scripted preview behavior");
  });
});
