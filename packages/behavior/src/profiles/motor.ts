import type { ComponentInstance } from "@schematic/hardware-graph";
import { actionState, boundedNumber, objectPayload, property } from "./common";
import type { BehaviorProfile, BehaviorActionDescriptor, DeterministicActionContext, ResolvedComponentAction } from "../contracts";
import { payloadSchema } from "../schemas";

export type MotorDirection = "forward" | "reverse";
export interface MotorState {
  rpm: number;
  direction: MotorDirection;
}

const speedSchema = payloadSchema("behavior/motor/set-speed/v1", {
  type: "object",
  properties: {
    rpm: { type: "number", minimum: -20_000, maximum: 20_000 },
    direction: { type: "string", enum: ["forward", "reverse"] },
  },
  required: ["rpm"],
  additionalProperties: false,
});
const stopSchema = payloadSchema("behavior/motor/stop/v1", { type: "object", properties: {}, additionalProperties: false });

const actions: readonly BehaviorActionDescriptor[] = [
  { id: "motor.setSpeed", label: "Set speed", description: "Set bounded motor speed in revolutions per minute.", payloadSchema: speedSchema, control: { kind: "number", min: -20_000, max: 20_000, step: 1, unit: "rpm" } },
  { id: "motor.stop", label: "Stop motor", description: "Stop the conceptual motor activity.", payloadSchema: stopSchema, control: { kind: "trigger" } },
];

export const motorProfile: BehaviorProfile<MotorState> = {
  manifest: { id: "motor", version: 1, implementationId: "motor:v1:20260831", actions, events: [] },
  parseState(value: unknown): MotorState {
    const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    return { rpm: boundedNumber(record.rpm, 0, -20_000, 20_000), direction: record.direction === "reverse" ? "reverse" : "forward" };
  },
  initialState(instance: ComponentInstance): MotorState {
    return { rpm: boundedNumber(property(instance, "rpm"), 0, -20_000, 20_000), direction: property(instance, "direction") === "reverse" ? "reverse" : "forward" };
  },
  reduce(state: MotorState, action: ResolvedComponentAction, _context: DeterministicActionContext) {
    if (action.actionId === "motor.stop") return actionState({ ...state, rpm: 0 });
    if (action.actionId !== "motor.setSpeed") return [];
    const payload = objectPayload(action.payload);
    if (!payload || typeof payload.rpm !== "number") return [];
    const rpm = boundedNumber(payload.rpm, state.rpm, -20_000, 20_000);
    return actionState({ rpm, direction: payload.direction === "reverse" || rpm < 0 ? "reverse" : "forward" });
  },
  projectVisual(state: MotorState) {
    const active = state.rpm !== 0;
    return {
      primitives: [
        { kind: "activity", key: "motor", state: active ? "active" : "idle" },
        { kind: "numeric-readout", key: "motor-speed", value: Math.abs(state.rpm), unit: "rpm" },
      ],
      accessibleSummary: active ? `Motor is active at ${Math.round(Math.abs(state.rpm))} RPM in ${state.direction} direction.` : "Motor is stopped.",
    };
  },
};
