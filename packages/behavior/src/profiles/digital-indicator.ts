import type { ComponentInstance } from "@schematic/hardware-graph";
import { actionState, boundedNumber, objectPayload, property } from "./common";
import type { BehaviorProfile, BehaviorActionDescriptor, DeterministicActionContext, ResolvedComponentAction } from "../contracts";
import { payloadSchema } from "../schemas";

export interface DigitalIndicatorState {
  on: boolean;
  color: string;
  intensity: number;
}

const indicatorStateSchema = payloadSchema("behavior/digital-indicator/state/v1", {
  type: "object",
  properties: {
    on: { type: "boolean" },
    color: { type: "string", minLength: 7, maxLength: 7, format: "hex-color" },
    intensity: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["on"],
  additionalProperties: false,
});
const brightnessSchema = payloadSchema("behavior/digital-indicator/brightness/v1", {
  type: "object",
  properties: { intensity: { type: "number", minimum: 0, maximum: 1 } },
  required: ["intensity"],
  additionalProperties: false,
});

const actions: readonly BehaviorActionDescriptor[] = [
  { id: "indicator.set", label: "Set indicator", description: "Set on/off state, color, and intensity.", payloadSchema: indicatorStateSchema, control: { kind: "toggle" } },
  { id: "indicator.setBrightness", label: "Set brightness", description: "Set visible indicator intensity from 0 to 1.", payloadSchema: brightnessSchema, control: { kind: "number", min: 0, max: 1, step: 0.01 } },
];

function safeIndicatorColor(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}

export const digitalIndicatorProfile: BehaviorProfile<DigitalIndicatorState> = {
  manifest: { id: "digital-indicator", version: 1, implementationId: "digital-indicator:v1:20260831", actions, events: [] },
  parseState(value: unknown): DigitalIndicatorState {
    const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    return {
      on: record.on === true,
      color: safeIndicatorColor(record.color, "#3b82f6"),
      intensity: boundedNumber(record.intensity, record.on === true ? 1 : 0, 0, 1),
    };
  },
  initialState(instance: ComponentInstance): DigitalIndicatorState {
    const on = property(instance, "on") === true || property(instance, "enabled") === true;
    return {
      on,
      color: safeIndicatorColor(property(instance, "color"), "#3b82f6"),
      intensity: boundedNumber(property(instance, "intensity") ?? property(instance, "brightness"), on ? 1 : 0, 0, 1),
    };
  },
  reduce(state: DigitalIndicatorState, action: ResolvedComponentAction, _context: DeterministicActionContext) {
    const payload = objectPayload(action.payload);
    if (!payload) return [];
    if (action.actionId === "indicator.set" && typeof payload.on === "boolean") {
      const on = payload.on;
      return actionState({
        on,
        color: safeIndicatorColor(payload.color, state.color),
        intensity: typeof payload.intensity === "number" ? boundedNumber(payload.intensity, on ? 1 : 0, 0, 1) : on ? Math.max(state.intensity, 1) : 0,
      });
    }
    if (action.actionId === "indicator.setBrightness" && typeof payload.intensity === "number") {
      const intensity = boundedNumber(payload.intensity, state.intensity, 0, 1);
      return actionState({ ...state, intensity, on: intensity > 0 });
    }
    return [];
  },
  projectVisual(state: DigitalIndicatorState) {
    return {
      primitives: [{ kind: "indicator", key: "indicator", on: state.on, color: state.color, intensity: state.on ? state.intensity : 0 }],
      accessibleSummary: state.on ? `Indicator is on at ${Math.round(state.intensity * 100)}% intensity.` : "Indicator is off.",
    };
  },
};
