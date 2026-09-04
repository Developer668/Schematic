import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@schematic/hardware-graph";
import { createBehaviorSystem, type BehaviorPlanV1, type ComponentActionRequestV1 } from "../src";

function calculatorProject() {
  const project = createEmptyProject("Calculator behavior journey");
  project.id = "calculator-project";
  project.components = [
    { id: "keypad-1", definitionId: "membrane-keypad", position: { x: 0, y: 0 }, rotation: 0, properties: {} },
    { id: "display-1", definitionId: "lcd1602-i2c", position: { x: 200, y: 0 }, rotation: 0, properties: {} },
  ];
  return project;
}

const definitions = {
  "membrane-keypad": { behaviorBinding: { profileId: "membrane-keypad", profileVersion: 1 } },
  "lcd1602-i2c": { behaviorBinding: { profileId: "text-display", profileVersion: 1 } },
};

function plan(): BehaviorPlanV1 {
  return {
    schemaVersion: 1,
    id: "calculator-interaction-v1",
    projectId: "calculator-project",
    name: "Interactive calculator",
    revision: 1,
    rules: [
      {
        id: "initial-display",
        enabled: true,
        when: { type: "preview.started" },
        then: [{ componentId: "display-1", definitionId: "lcd1602-i2c", actionId: "display.showText", payload: { kind: "literal", value: { text: "0" } } }],
      },
      {
        id: "keypad-result-to-display",
        enabled: true,
        when: { type: "component.event", componentId: "keypad-1", definitionId: "membrane-keypad", eventId: "keypad.displayChanged" },
        then: [{ componentId: "display-1", definitionId: "lcd1602-i2c", actionId: "display.showText", payload: { kind: "trigger-payload", select: "$.value" } }],
      },
    ],
  };
}

function press(key: string): ComponentActionRequestV1 {
  return {
    componentId: "keypad-1",
    definitionId: "membrane-keypad",
    actionId: "keypad.press",
    payload: { kind: "literal", value: { key } },
  };
}

describe("interactive calculator behavior journey", () => {
  it("routes membrane keypad presses through deterministic calculator state to the LCD", async () => {
    const project = calculatorProject();
    const system = createBehaviorSystem({ definitions });
    const preparation = await system.prepare(project, plan());
    expect(preparation.status).toBe("ready");
    if (preparation.status !== "ready") return;

    const session = system.open(project, preparation.prepared);
    expect(session.snapshot().components["display-1"].primitives[0]).toMatchObject({ kind: "text-display", lines: ["0"] });

    for (const key of ["7", "+", "5", "="]) {
      const result = session.dispatch(project, press(key));
      expect(result.status).toBe("accepted");
    }

    const snapshot = session.snapshot();
    expect(snapshot.components["display-1"].primitives[0]).toMatchObject({ kind: "text-display", lines: ["12"] });
    expect(snapshot.components["keypad-1"].primitives[0]).toMatchObject({ kind: "keypad", lastKey: "=" });
    expect(snapshot.components["keypad-1"].accessibleSummary).toContain("result is 12");
    expect(snapshot.events.filter((event) => event.eventId === "keypad.keyPressed" && event.outcome === "accepted")).toHaveLength(4);
    expect(snapshot.events.filter((event) => event.eventId === "keypad.displayChanged" && event.outcome === "accepted")).toHaveLength(4);
    expect(snapshot.sessionLog.filter((entry) => entry.kind === "direct-action" && entry.outcome === "accepted" && entry.request.componentId === "keypad-1" && "actionId" in entry.request && entry.request.actionId === "keypad.press")).toHaveLength(4);
    expect(snapshot.claims.sourceCodeExecuted).toBe(false);
    expect(snapshot.claims.sourceCodeCompiled).toBe(false);
    expect(snapshot.claims.physicalBehaviorVerified).toBe(false);
  });

  it("handles clear, decimals, chained operations, and divide-by-zero deterministically", async () => {
    const project = calculatorProject();
    const system = createBehaviorSystem({ definitions });
    const preparation = await system.prepare(project, plan());
    expect(preparation.status).toBe("ready");
    if (preparation.status !== "ready") return;
    const session = system.open(project, preparation.prepared);

    for (const key of ["1", ".", "5", "+", "2", ".", "5", "="]) expect(session.dispatch(project, press(key)).status).toBe("accepted");
    expect(session.snapshot().components["display-1"].primitives[0]).toMatchObject({ lines: ["4"] });

    for (const key of ["C", "8", "/", "0", "="]) expect(session.dispatch(project, press(key)).status).toBe("accepted");
    expect(session.snapshot().components["display-1"].primitives[0]).toMatchObject({ lines: ["Error"] });

    expect(session.dispatch(project, press("C")).status).toBe("accepted");
    expect(session.snapshot().components["display-1"].primitives[0]).toMatchObject({ lines: ["0"] });
  });
});
