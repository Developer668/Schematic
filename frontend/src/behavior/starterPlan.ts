import { writeBehaviorPlan } from "../application/behaviorCommands.ts";
import { useProjectStore } from "../store/useProjectStore.ts";
import { capabilitiesForCatalogComponent } from "./capabilities.ts";
import { useBehaviorPreviewStore } from "./useBehaviorPreviewStore.ts";

/**
 * The Outcome timeline refuses to run without a saved Behavior Plan by design
 * (an empty canvas must never be presented as a working outcome). This module
 * closes the UI gap: it builds a valid version-1 plan from the behavior
 * profiles already checked into the catalog and saves it through the exact
 * same command path the WebMCP `behavior.plan.write` tool uses, so a human
 * can press Play without needing an external MCP agent.
 */

const STARTER_PLAN_ID = "starter-behavior-plan";
const STARTER_DURATION_MS = 2_400;

/** Demo payloads keyed by action id. Every payload must satisfy the exact JSON schema its profile declares. */
const DEMO_PAYLOADS: Record<string, { kind: "literal"; value: Record<string, unknown> }> = {
  "indicator.set": { kind: "literal", value: { on: true, color: "#3b82f6", intensity: 1 } },
  "indicator.setBrightness": { kind: "literal", value: { intensity: 0.85 } },
  "buzzer.start": { kind: "literal", value: { frequencyHz: 440, durationMs: 400 } },
  "buzzer.stop": { kind: "literal", value: {} },
  "display.showText": { kind: "literal", value: { text: "Hello from Schematic" } },
  "display.clear": { kind: "literal", value: {} },
  "button.setPressed": { kind: "literal", value: { pressed: true } },
  "motor.setSpeed": { kind: "literal", value: { rpm: 1200, direction: "forward" } },
  "motor.stop": { kind: "literal", value: {} },
  "relay.set": { kind: "literal", value: { on: true } },
  "servo.setAngle": { kind: "literal", value: { degrees: 90 } },
  "sensor.setReading": { kind: "literal", value: { value: 42 } },
};

interface StarterComponent {
  id: string;
  definitionId: string;
}

function buildStarterPlan(project: { id: string; components: readonly StarterComponent[] }) {
  const rules: Array<Record<string, unknown>> = [];
  const cues: Array<Record<string, unknown>> = [];
  let ruleIndex = 0;
  let cueIndex = 0;

  for (const component of project.components) {
    const report = capabilitiesForCatalogComponent(component);
    const usable = report.actions.filter((action) => DEMO_PAYLOADS[action.actionId]);
    if (!usable.length) continue;
    const primary = usable[0];

    rules.push({
      id: `starter-rule-${ruleIndex}`,
      enabled: true,
      when: { type: "preview.started" },
      then: [{
        componentId: component.id,
        definitionId: component.definitionId,
        actionId: primary.actionId,
        payload: DEMO_PAYLOADS[primary.actionId],
      }],
    });
    ruleIndex += 1;

    // Give indicators a visible blink timeline so the outcome actually moves.
    if (primary.actionId === "indicator.set") {
      const toggle = (atMs: number, on: boolean) => {
        cues.push({
          id: `starter-cue-${cueIndex}`,
          atMs,
          order: cueIndex,
          action: {
            componentId: component.id,
            definitionId: component.definitionId,
            actionId: "indicator.set",
            payload: { kind: "literal", value: { on, color: "#22c55e", intensity: 1 } },
          },
        });
        cueIndex += 1;
      };
      toggle(500, true);
      toggle(1_000, false);
      toggle(1_500, true);
      toggle(2_000, false);
    }
  }

  return {
    schemaVersion: 1,
    id: STARTER_PLAN_ID,
    projectId: project.id,
    name: "Starter demo plan",
    intent: "Auto-generated starter Behavior Plan: one typed action per capable component, plus an indicator blink timeline.",
    rules,
    ...(cues.length ? { cues } : {}),
  };
}

export function canvasHasActionableBehavior(): boolean {
  const { project } = useProjectStore.getState();
  return project.components.some((component) =>
    capabilitiesForCatalogComponent(component).actions.some((action) => DEMO_PAYLOADS[action.actionId]),
  );
}

/**
 * Build, validate, and save a starter Behavior Plan from the current canvas,
 * then start the preview through the same adapter the Play button uses.
 * Returns null on success or an honest failure message for the UI.
 */
export async function createStarterPlanAndPreview(): Promise<string | null> {
  const state = useProjectStore.getState();
  if (!canvasHasActionableBehavior()) {
    return "None of the parts on this canvas have mappable behavior actions yet. Add an LED, button, buzzer, display, relay, servo, motor, or sensor part and try again.";
  }

  const plan = buildStarterPlan(state.project);
  const revision = state.getBehaviorPlan(STARTER_PLAN_ID)?.revision ?? null;
  const written = await writeBehaviorPlan(plan, revision);
  if (!written.ok) {
    const error = (written as { error?: { code?: string; message?: string } }).error;
    return error?.message ?? `Could not save the starter Behavior Plan${error?.code ? ` (${error.code})` : ""}.`;
  }

  await useBehaviorPreviewStore.getState().startPreview({ durationMs: STARTER_DURATION_MS });
  const { status, error } = useBehaviorPreviewStore.getState();
  if (status === "blocked") return error ?? "Preview is blocked; check the Outcome diagnostics.";
  return null;
}
