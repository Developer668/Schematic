import { writeBehaviorPlan } from "../application/behaviorCommands.ts";
import { GENERATED_STARTER_BEHAVIOR_PLAN_ID, useProjectStore } from "../store/useProjectStore.ts";
import { prepareBehaviorPlanReadiness } from "../application/behaviorReadiness.ts";
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

export const STARTER_PLAN_ID = GENERATED_STARTER_BEHAVIOR_PLAN_ID;
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
  "keypad.press": { kind: "literal", value: { key: "7" } },
};

interface StarterComponent {
  id: string;
  definitionId: string;
}

function buildStarterPlan(project: { id: string; components: readonly StarterComponent[] }, revision: number) {
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
    revision,
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
export type StarterPlanPreparation =
  | {
      ready: true;
      status: "ready";
      planId: string;
      revision: number;
      previewStarted: false;
      planSha256: string;
      projectSha256: string;
    }
  | {
      ready: false;
      status: "unavailable" | "blocked";
      planId: string;
      revision: number | null;
      previewStarted: false;
      message: string;
      code?: string;
    };

/**
 * Ensure the current canvas has a durable, valid starter Behavior Plan, but do
 * not start the ephemeral Outcome session. Agent build flows use this after
 * graph mutations so a visually-built project does not end up with an empty
 * Outcome tab. Keeping preparation separate from playback also means adding a
 * part never unexpectedly starts animation for the user.
 */
export async function prepareStarterPlan(): Promise<StarterPlanPreparation> {
  const state = useProjectStore.getState();
  const currentRevision = state.getBehaviorPlan(STARTER_PLAN_ID)?.revision ?? null;
  if (!canvasHasActionableBehavior()) {
    return {
      ready: false,
      status: "unavailable",
      planId: STARTER_PLAN_ID,
      revision: currentRevision,
      previewStarted: false,
      message: "None of the parts on this canvas have mappable behavior actions yet. Add an LED, button, buzzer, display, relay, servo, motor, or sensor part and try again.",
    };
  }

  const plan = buildStarterPlan(state.project, currentRevision ?? 1);
  const written = await writeBehaviorPlan(plan, currentRevision);
  if (!written.ok) {
    return {
      ready: false,
      status: "blocked",
      planId: STARTER_PLAN_ID,
      revision: currentRevision,
      previewStarted: false,
      message: written.error.message,
      code: written.error.code,
    };
  }

  return {
    ready: true,
    status: "ready",
    planId: STARTER_PLAN_ID,
    revision: written.data.revision,
    previewStarted: false,
    planSha256: written.data.planSha256,
    projectSha256: written.data.projectSha256,
  };
}

/**
 * Agent graph mutations should keep the generated starter plan synchronized
 * only while it is the project's behavior source of truth. If a user/model has
 * already authored another explicit plan and no starter plan exists, preserve
 * that authored behavior instead of silently introducing a competing default.
 */
export async function ensureStarterPlanForAgentBuild(): Promise<StarterPlanPreparation | {
  ready: true;
  status: "custom-plan";
  planId: string;
  revision: number;
  previewStarted: false;
  planSha256: string;
  projectSha256: string;
} | {
  ready: false;
  status: "custom-plan-review" | "blocked";
  planId: string;
  revision: number;
  previewStarted: false;
  message: string;
  code?: string;
}> {
  const project = useProjectStore.getState().project;
  const plans = project.behaviorPlans ?? [];
  const authored = plans.find((plan) => plan.id !== STARTER_PLAN_ID);
  if (authored) {
    const preparation = await prepareBehaviorPlanReadiness(project, authored);
    if (preparation.status === "blocked") {
      return {
        ready: false,
        status: "blocked",
        planId: authored.id,
        revision: authored.revision,
        previewStarted: false,
        message: "The authored Behavior Plan no longer prepares against the current graph. Repair its exact component/action references before continuing.",
        code: "BEHAVIOR_PLAN_BLOCKED",
      };
    }
    if (preparation.status === "partial") {
      return {
        ready: false,
        status: "custom-plan-review",
        planId: authored.id,
        revision: authored.revision,
        previewStarted: false,
        message: "The authored Behavior Plan only partially prepares against the current graph. Review its diagnostics instead of silently replacing it with a starter plan.",
        code: "BEHAVIOR_PLAN_PARTIAL",
      };
    }
    return {
      ready: true,
      status: "custom-plan",
      planId: authored.id,
      revision: authored.revision,
      previewStarted: false,
      planSha256: preparation.prepared.planSha256,
      projectSha256: preparation.prepared.projectSha256,
    };
  }
  return prepareStarterPlan();
}

export async function createStarterPlanAndPreview(): Promise<string | null> {
  const prepared = await prepareStarterPlan();
  if (!prepared.ready) return prepared.message;

  await useBehaviorPreviewStore.getState().startPreview({ durationMs: STARTER_DURATION_MS });
  const { status, error } = useBehaviorPreviewStore.getState();
  if (status === "blocked") return error ?? "Preview is blocked; check the Outcome diagnostics.";
  return null;
}
