import type { ComponentInstance } from "@schematic/hardware-graph";
import { actionState, boundedNumber, objectPayload, property } from "./common";
import type { BehaviorProfile, BehaviorActionDescriptor, DeterministicActionContext, ResolvedComponentAction } from "../contracts";
import { payloadSchema } from "../schemas";

export interface RotaryActuatorState {
  degrees: number;
}

const setAngleSchema = payloadSchema("behavior/rotary-actuator/set-angle/v1", { type: "object", properties: { degrees: { type: "number", minimum: 0, maximum: 180 } }, required: ["degrees"], additionalProperties: false });

export const rotaryActuatorProfile: BehaviorProfile<RotaryActuatorState> = {
  manifest: {
    id: "rotary-actuator",
    version: 1,
    implementationId: "rotary-actuator:v1:20260831",
    actions: [{ id: "servo.setAngle", label: "Set angle", description: "Set a bounded conceptual actuator angle.", payloadSchema: setAngleSchema, control: { kind: "number", min: 0, max: 180, step: 1, unit: "°" } } satisfies BehaviorActionDescriptor],
    events: [],
  },
  parseState(value: unknown): RotaryActuatorState {
    const degrees = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>).degrees : undefined;
    return { degrees: boundedNumber(degrees, 0, 0, 180) };
  },
  initialState(instance: ComponentInstance): RotaryActuatorState {
    return { degrees: boundedNumber(property(instance, "degrees") ?? property(instance, "angle"), 0, 0, 180) };
  },
  reduce(_state: RotaryActuatorState, action: ResolvedComponentAction, _context: DeterministicActionContext) {
    const payload = objectPayload(action.payload);
    return action.actionId === "servo.setAngle" && payload && typeof payload.degrees === "number" ? actionState({ degrees: boundedNumber(payload.degrees, 0, 0, 180) }) : [];
  },
  projectVisual(state: RotaryActuatorState) {
    return { primitives: [{ kind: "rotation", key: "actuator", degrees: state.degrees }], accessibleSummary: `Actuator angle is ${Math.round(state.degrees)} degrees.` };
  },
};
