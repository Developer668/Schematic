import type { ComponentInstance } from "@schematic/hardware-graph";
import { actionState, objectPayload, property } from "./common";
import type { BehaviorProfile, BehaviorActionDescriptor, DeterministicActionContext, ResolvedComponentAction } from "../contracts";
import { payloadSchema } from "../schemas";

export interface RelayState {
  on: boolean;
}

const setSchema = payloadSchema("behavior/relay/set/v1", { type: "object", properties: { on: { type: "boolean" } }, required: ["on"], additionalProperties: false });

export const relayProfile: BehaviorProfile<RelayState> = {
  manifest: {
    id: "relay",
    version: 1,
    implementationId: "relay:v1:20260831",
    actions: [{ id: "relay.set", label: "Set relay", description: "Open or close the relay contact in the conceptual preview.", payloadSchema: setSchema, control: { kind: "toggle" } } satisfies BehaviorActionDescriptor],
    events: [],
  },
  parseState(value: unknown): RelayState {
    return { on: Boolean(value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).on === true) };
  },
  initialState(instance: ComponentInstance): RelayState {
    return { on: property(instance, "on") === true || property(instance, "closed") === true };
  },
  reduce(_state: RelayState, action: ResolvedComponentAction, _context: DeterministicActionContext) {
    const payload = objectPayload(action.payload);
    return action.actionId === "relay.set" && payload && typeof payload.on === "boolean" ? actionState({ on: payload.on }) : [];
  },
  projectVisual(state: RelayState) {
    return { primitives: [{ kind: "switch", key: "relay", position: state.on ? "closed" : "open" }], accessibleSummary: state.on ? "Relay is closed." : "Relay is open." };
  },
};
