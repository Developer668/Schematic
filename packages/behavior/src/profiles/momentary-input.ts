import type { ComponentInstance } from "@schematic/hardware-graph";
import { objectPayload, property } from "./common";
import type { BehaviorProfile, BehaviorEventDescriptor, BehaviorActionDescriptor, DeterministicActionContext, ResolvedComponentAction } from "../contracts";
import { payloadSchema } from "../schemas";

export interface MomentaryInputState {
  pressed: boolean;
}

const emptyObject = payloadSchema("behavior/momentary-input/empty/v1", { type: "object", properties: {}, additionalProperties: false });
const pressPayload = payloadSchema("behavior/momentary-input/pressed/v1", { type: "object", properties: { pressed: { type: "boolean" } }, required: ["pressed"], additionalProperties: false });

const actions: readonly BehaviorActionDescriptor[] = [
  { id: "button.setPressed", label: "Set pressed", description: "Set the input's visible pressed state.", payloadSchema: pressPayload, control: { kind: "toggle" } },
];
const events: readonly BehaviorEventDescriptor[] = [
  { id: "button.pressed", label: "Pressed", description: "Dispatch when the input is pressed.", payloadSchema: pressPayload, control: { kind: "trigger", label: "Press" } },
  { id: "button.released", label: "Released", description: "Dispatch when the input is released.", payloadSchema: pressPayload, control: { kind: "trigger", label: "Release" } },
];

export const momentaryInputProfile: BehaviorProfile<MomentaryInputState> = {
  manifest: { id: "momentary-input", version: 1, implementationId: "momentary-input:v1:20260831", actions, events },
  parseState(value: unknown): MomentaryInputState {
    return { pressed: typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as Record<string, unknown>).pressed === "boolean" ? (value as { pressed: boolean }).pressed : false };
  },
  initialState(instance: ComponentInstance): MomentaryInputState {
    return { pressed: property(instance, "pressed") === true };
  },
  reduce(state: MomentaryInputState, action: ResolvedComponentAction, _context: DeterministicActionContext) {
    if (action.actionId !== "button.setPressed") return [];
    const payload = objectPayload(action.payload);
    if (!payload || typeof payload.pressed !== "boolean") return [];
    return [{
      state: { pressed: payload.pressed },
      emittedEvents: [{
        componentId: action.componentId,
        definitionId: action.definitionId,
        eventId: payload.pressed ? "button.pressed" : "button.released",
        payload: { pressed: payload.pressed },
      }],
    }];
  },
  projectVisual(state: MomentaryInputState) {
    return { primitives: [{ kind: "button", key: "button", pressed: state.pressed }], accessibleSummary: state.pressed ? "Button is pressed." : "Button is released." };
  },
};

export { emptyObject as momentaryEmptyPayloadSchema };
