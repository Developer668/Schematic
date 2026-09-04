import type { ComponentInstance } from "@schematic/hardware-graph";
import { objectPayload, property } from "./common";
import { CALCULATOR_KEYS, initialCalculatorState, isCalculatorKey, parseCalculatorState, reduceCalculatorKey, type CalculatorKey, type CalculatorState } from "./calculator-engine";
import type { BehaviorActionDescriptor, BehaviorEventDescriptor, BehaviorProfile, ComponentEventRequest, DeterministicActionContext, ResolvedComponentAction } from "../contracts";
import { payloadSchema } from "../schemas";

export interface MembraneKeypadState {
  lastKey: CalculatorKey | null;
  calculator: CalculatorState;
}

function parseMembraneKeypadState(value: unknown): MembraneKeypadState {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const lastKey = isCalculatorKey(record.lastKey) ? record.lastKey : null;
  return { lastKey, calculator: parseCalculatorState(record.calculator) };
}

const pressSchema = payloadSchema("behavior/membrane-keypad/press/v2", {
  type: "object",
  properties: { key: { type: "string", enum: [...CALCULATOR_KEYS] } },
  required: ["key"],
  additionalProperties: false,
});
const keyPressedSchema = payloadSchema("behavior/membrane-keypad/key-pressed/v1", {
  type: "object",
  properties: { key: { type: "string", enum: [...CALCULATOR_KEYS] } },
  required: ["key"],
  additionalProperties: false,
});
// Shape the display event around $.value so Behavior Plans can pass it to
// display.showText with the existing bounded trigger-payload selector.
const displayChangedSchema = payloadSchema("behavior/membrane-keypad/display-changed/v1", {
  type: "object",
  properties: {
    value: {
      type: "object",
      properties: { text: { type: "string", maxLength: 64 } },
      required: ["text"],
      additionalProperties: false,
    },
  },
  required: ["value"],
  additionalProperties: false,
});

const actions: readonly BehaviorActionDescriptor[] = [
  { id: "keypad.press", label: "Press key", description: "Press one calculator key. The keypad keeps deterministic calculator entry/operator state and emits both the key press and resulting display value.", payloadSchema: pressSchema, control: { kind: "select", options: CALCULATOR_KEYS.map((key) => ({ value: key, label: key })) } },
];
const events: readonly BehaviorEventDescriptor[] = [
  { id: "keypad.keyPressed", label: "Key pressed", description: "Emitted for every accepted membrane-keypad key press.", payloadSchema: keyPressedSchema, control: { kind: "trigger", label: "Key pressed" } },
  { id: "keypad.displayChanged", label: "Calculator display changed", description: "Emitted after each accepted calculator key with a display.showText-compatible value payload.", payloadSchema: displayChangedSchema, control: { kind: "trigger", label: "Display changed" } },
];

export const membraneKeypadProfile: BehaviorProfile<MembraneKeypadState> = {
  manifest: { id: "membrane-keypad", version: 1, implementationId: "membrane-keypad:v2:20260903-source", actions, events },
  parseState: parseMembraneKeypadState,
  initialState(instance: ComponentInstance): MembraneKeypadState {
    const candidate = property(instance, "lastKey");
    return { lastKey: isCalculatorKey(candidate) ? candidate : null, calculator: initialCalculatorState() };
  },
  reduce(state: MembraneKeypadState, action: ResolvedComponentAction, _context: DeterministicActionContext) {
    if (action.actionId !== "keypad.press") return [];
    const payload = objectPayload(action.payload);
    if (!payload || !isCalculatorKey(payload.key)) return [];
    const key = payload.key;
    const nextCalculator = reduceCalculatorKey(state.calculator, key);
    if (!nextCalculator) return [];
    const emittedEvents: readonly ComponentEventRequest[] = [
      {
        componentId: action.componentId,
        definitionId: action.definitionId,
        eventId: "keypad.keyPressed",
        payload: { key },
      },
      {
        componentId: action.componentId,
        definitionId: action.definitionId,
        eventId: "keypad.displayChanged",
        payload: { value: { text: nextCalculator.display } },
      },
    ];
    return [{
      state: { lastKey: key, calculator: nextCalculator },
      emittedEvents,
    }];
  },
  projectVisual(state: MembraneKeypadState) {
    const current = parseMembraneKeypadState(state);
    return {
      primitives: [{ kind: "keypad", key: "keypad", lastKey: current.lastKey, keys: CALCULATOR_KEYS }],
      accessibleSummary: current.lastKey === null
        ? "Calculator keypad is ready; display value is 0."
        : `Calculator keypad last pressed ${current.lastKey}; result is ${current.calculator.display}.`,
    };
  },
};
