import type { ComponentInstance } from "@schematic/hardware-graph";
import { actionState, boundedNumber, boundedString, objectPayload, property } from "./common";
import type { BehaviorProfile, BehaviorActionDescriptor, BehaviorEventDescriptor, DeterministicActionContext, ResolvedComponentAction } from "../contracts";
import { payloadSchema } from "../schemas";

const MIN_READING = -1_000_000_000;
const MAX_READING = 1_000_000_000;

export interface NumericSensorState {
  value: number;
  unit?: string;
}

const readingSchema = payloadSchema("behavior/numeric-sensor/reading/v1", {
  type: "object",
  properties: {
    value: { type: "number", minimum: MIN_READING, maximum: MAX_READING },
    unit: { type: "string", maxLength: 32 },
  },
  required: ["value"],
  additionalProperties: false,
});

const actions: readonly BehaviorActionDescriptor[] = [
  { id: "sensor.setReading", label: "Set reading", description: "Inject a bounded sensor reading for the conceptual preview.", payloadSchema: readingSchema, control: { kind: "number", min: MIN_READING, max: MAX_READING, step: 0.01 } },
];
const events: readonly BehaviorEventDescriptor[] = [
  { id: "sensor.changed", label: "Reading changed", description: "Dispatch a typed sensor reading into Behavior Plan rules.", payloadSchema: readingSchema, control: { kind: "trigger", label: "Send reading" } },
];

export const numericSensorProfile: BehaviorProfile<NumericSensorState> = {
  manifest: { id: "numeric-sensor", version: 1, implementationId: "numeric-sensor:v1:20260831", actions, events },
  parseState(value: unknown): NumericSensorState {
    const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const unit = typeof record.unit === "string" ? boundedString(record.unit, "", 32) : undefined;
    return { value: boundedNumber(record.value, 0, MIN_READING, MAX_READING), ...(unit ? { unit } : {}) };
  },
  initialState(instance: ComponentInstance): NumericSensorState {
    const unit = boundedString(property(instance, "unit"), "", 32);
    return { value: boundedNumber(property(instance, "value") ?? property(instance, "reading"), 0, MIN_READING, MAX_READING), ...(unit ? { unit } : {}) };
  },
  reduce(state: NumericSensorState, action: ResolvedComponentAction, _context: DeterministicActionContext) {
    if (action.actionId !== "sensor.setReading") return [];
    const payload = objectPayload(action.payload);
    if (!payload || typeof payload.value !== "number") return [];
    const unit = typeof payload.unit === "string" ? boundedString(payload.unit, state.unit ?? "", 32) : state.unit;
    return actionState({ value: boundedNumber(payload.value, state.value, MIN_READING, MAX_READING), ...(unit ? { unit } : {}) });
  },
  projectVisual(state: NumericSensorState) {
    return {
      primitives: [{ kind: "numeric-readout", key: "sensor", value: state.value, ...(state.unit ? { unit: state.unit } : {}) }],
      accessibleSummary: `Sensor reading is ${state.value}${state.unit ? ` ${state.unit}` : ""}.`,
    };
  },
};
