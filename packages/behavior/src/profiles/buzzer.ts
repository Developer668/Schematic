import type { ComponentInstance } from "@schematic/hardware-graph";
import { actionState, boundedNumber, integerNumber, objectPayload, property } from "./common";
import type { BehaviorProfile, BehaviorActionDescriptor, DeterministicActionContext, ResolvedComponentAction } from "../contracts";
import { BEHAVIOR_LIMITS, payloadSchema } from "../schemas";

export interface BuzzerState {
  active: boolean;
  frequencyHz: number;
  durationMs?: number;
}

const startSchema = payloadSchema("behavior/buzzer/start/v1", {
  type: "object",
  properties: {
    frequencyHz: { type: "number", minimum: 20, maximum: 20_000 },
    durationMs: { type: "integer", minimum: 0, maximum: BEHAVIOR_LIMITS.maxDurationMs },
  },
  required: ["frequencyHz"],
  additionalProperties: false,
});
const stopSchema = payloadSchema("behavior/buzzer/stop/v1", { type: "object", properties: {}, additionalProperties: false });

const actions: readonly BehaviorActionDescriptor[] = [
  { id: "buzzer.start", label: "Start tone", description: "Show a bounded buzzer tone as active.", payloadSchema: startSchema, control: { kind: "number", min: 20, max: 20_000, step: 1, unit: "Hz" } },
  { id: "buzzer.stop", label: "Stop tone", description: "Stop the visible buzzer activity.", payloadSchema: stopSchema, control: { kind: "trigger" } },
];

export const buzzerProfile: BehaviorProfile<BuzzerState> = {
  manifest: { id: "buzzer", version: 1, implementationId: "buzzer:v1:20260831", actions, events: [] },
  parseState(value: unknown): BuzzerState {
    const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    return { active: record.active === true, frequencyHz: boundedNumber(record.frequencyHz, 440, 20, 20_000), ...(record.durationMs === undefined ? {} : { durationMs: integerNumber(record.durationMs, 0, 0, BEHAVIOR_LIMITS.maxDurationMs) }) };
  },
  initialState(instance: ComponentInstance): BuzzerState {
    return { active: property(instance, "active") === true, frequencyHz: boundedNumber(property(instance, "frequencyHz"), 440, 20, 20_000) };
  },
  reduce(state: BuzzerState, action: ResolvedComponentAction, _context: DeterministicActionContext) {
    if (action.actionId === "buzzer.stop") return actionState({ ...state, active: false });
    if (action.actionId !== "buzzer.start") return [];
    const payload = objectPayload(action.payload);
    if (!payload || typeof payload.frequencyHz !== "number") return [];
    return actionState({
      active: true,
      frequencyHz: boundedNumber(payload.frequencyHz, state.frequencyHz, 20, 20_000),
      ...(payload.durationMs === undefined ? {} : { durationMs: integerNumber(payload.durationMs, 0, 0, BEHAVIOR_LIMITS.maxDurationMs) }),
    });
  },
  projectVisual(state: BuzzerState) {
    return { primitives: [{ kind: "activity", key: "buzzer", state: state.active ? "active" : "idle" }], accessibleSummary: state.active ? `Buzzer active at ${Math.round(state.frequencyHz)} hertz.` : "Buzzer is idle." };
  },
};
