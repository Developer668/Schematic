import type { ComponentInstance } from "@schematic/hardware-graph";
import { objectPayload } from "./common";
import type { BehaviorActionDescriptor, BehaviorEventDescriptor, BehaviorProfile, ComponentEventRequest, DeterministicActionContext, ResolvedComponentAction } from "../contracts";
import { payloadSchema } from "../schemas";

export const CALCULATOR_KEYS = [
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  "+", "-", "*", "/", ".", "=", "C",
] as const;

export type CalculatorKey = (typeof CALCULATOR_KEYS)[number];
export type CalculatorOperator = "+" | "-" | "*" | "/";

export interface CalculatorState {
  display: string;
  entry: string;
  operand: number | null;
  operator: CalculatorOperator | null;
  fresh: boolean;
}

export function isCalculatorKey(value: unknown): value is CalculatorKey {
  return typeof value === "string" && (CALCULATOR_KEYS as readonly string[]).includes(value);
}

function isDigitKey(key: CalculatorKey) {
  return key.length === 1 && key >= "0" && key <= "9";
}

function isOperatorKey(key: unknown): key is CalculatorOperator {
  return key === "+" || key === "-" || key === "*" || key === "/";
}

export function initialCalculatorState(): CalculatorState {
  return { display: "0", entry: "", operand: null, operator: null, fresh: true };
}

function errorCalculatorState(): CalculatorState {
  return { display: "Error", entry: "", operand: null, operator: null, fresh: true };
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return "Error";
  const rounded = Number(value.toPrecision(10));
  if (!Number.isFinite(rounded)) return "Error";
  if (rounded === 0) return "0";
  const text = String(rounded);
  return text.length > 16 ? "Error" : text;
}

function compute(left: number, operator: CalculatorOperator, right: number): number | undefined {
  if (operator === "+") return left + right;
  if (operator === "-") return left - right;
  if (operator === "*") return left * right;
  if (right === 0) return undefined;
  return left / right;
}

export function parseCalculatorState(value: unknown): CalculatorState {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const rawDisplay = record.display;
  const safeDisplay = typeof rawDisplay === "string" && rawDisplay.length > 0 && rawDisplay.length <= 64 ? rawDisplay : "0";
  if (safeDisplay === "Error") return errorCalculatorState();
  const safeEntry = typeof record.entry === "string" && record.entry.length <= 16 && /^(?:[0-9]+\.?[0-9]*|\.[0-9]+)?$/.test(record.entry) ? record.entry : "";
  const operand = typeof record.operand === "number" && Number.isFinite(record.operand) ? record.operand : null;
  const operator = operand !== null && isOperatorKey(record.operator) ? record.operator : null;
  const fresh = typeof record.fresh === "boolean" ? record.fresh : true;
  return { display: safeDisplay, entry: safeEntry, operand, operator, fresh };
}

/** Pure deterministic calculator transition shared by the logical engine and membrane keypad profile. */
export function reduceCalculatorKey(input: CalculatorState, key: CalculatorKey): CalculatorState | null {
  const state = parseCalculatorState(input);
  if (key === "C") return initialCalculatorState();

  if (state.display === "Error") {
    if (isDigitKey(key)) return { display: key, entry: key, operand: null, operator: null, fresh: false };
    if (key === ".") return { display: "0.", entry: "0.", operand: null, operator: null, fresh: false };
    return { ...state };
  }

  if (isDigitKey(key)) {
    if (state.fresh) return { ...state, display: key, entry: key, fresh: false };
    const base = state.entry !== "" ? state.entry : state.display;
    const nextEntry = base === "0" ? key : `${base}${key}`;
    if (nextEntry.length > 16) return null;
    return { ...state, display: nextEntry, entry: nextEntry, fresh: false };
  }

  if (key === ".") {
    if (state.fresh) return { ...state, display: "0.", entry: "0.", fresh: false };
    const current = state.entry !== "" ? state.entry : state.display;
    if (current.includes(".")) return null;
    const nextEntry = current === "" ? "0." : `${current}.`;
    if (nextEntry.length > 16) return null;
    return { ...state, display: nextEntry, entry: nextEntry, fresh: false };
  }

  if (isOperatorKey(key)) {
    if (state.operator !== null && state.operand !== null && !state.fresh) {
      const right = Number(state.entry !== "" ? state.entry : state.display);
      const computed = compute(state.operand, state.operator, Number.isFinite(right) ? right : 0);
      if (computed === undefined) return errorCalculatorState();
      const formatted = formatNumber(computed);
      if (formatted === "Error") return errorCalculatorState();
      const nextOperand = Number(formatted);
      return { display: formatted, entry: "", operand: Number.isFinite(nextOperand) ? nextOperand : computed, operator: key, fresh: true };
    }
    if (state.operator !== null && state.fresh) return { ...state, operator: key };
    const currentText = state.fresh ? state.display : state.entry !== "" ? state.entry : state.display;
    const currentValue = Number(currentText);
    return {
      display: state.fresh ? state.display : currentText,
      entry: "",
      operand: Number.isFinite(currentValue) ? currentValue : 0,
      operator: key,
      fresh: true,
    };
  }

  if (key === "=") {
    if (state.operator === null || state.operand === null) return { ...state };
    const rightText = state.fresh ? state.display : state.entry !== "" ? state.entry : state.display;
    const right = Number(rightText);
    const computed = compute(state.operand, state.operator, Number.isFinite(right) ? right : 0);
    if (computed === undefined) return errorCalculatorState();
    const formatted = formatNumber(computed);
    if (formatted === "Error") return errorCalculatorState();
    return { display: formatted, entry: "", operand: null, operator: null, fresh: true };
  }

  return null;
}

const pressKeySchema = payloadSchema("behavior/calculator-engine/press-key/v1", {
  type: "object",
  properties: { key: { type: "string", enum: [...CALCULATOR_KEYS] } },
  required: ["key"],
  additionalProperties: false,
});
const clearSchema = payloadSchema("behavior/calculator-engine/clear/v1", { type: "object", properties: {}, additionalProperties: false });
const displayChangedSchema = payloadSchema("behavior/calculator-engine/display-changed/v1", {
  type: "object",
  properties: { text: { type: "string", maxLength: 64 } },
  required: ["text"],
  additionalProperties: false,
});

const actions: readonly BehaviorActionDescriptor[] = [
  { id: "calculator.pressKey", label: "Press calculator key", description: "Press a deterministic calculator key.", payloadSchema: pressKeySchema, control: { kind: "select", options: CALCULATOR_KEYS.map((key) => ({ value: key, label: key })) } },
  { id: "calculator.clear", label: "Clear calculator", description: "Reset the calculator display to zero.", payloadSchema: clearSchema, control: { kind: "trigger" } },
];
const events: readonly BehaviorEventDescriptor[] = [
  { id: "calculator.displayChanged", label: "Display changed", description: "Emitted whenever the calculator display updates.", payloadSchema: displayChangedSchema, control: { kind: "trigger", label: "Display changed" } },
];

function displayChangedEvent(action: ResolvedComponentAction, text: string): ComponentEventRequest {
  return { componentId: action.componentId, definitionId: action.definitionId, eventId: "calculator.displayChanged", payload: { text } };
}

export const calculatorEngineProfile: BehaviorProfile<CalculatorState> = {
  manifest: { id: "calculator-engine", version: 1, implementationId: "calculator-engine:v1:20260903-source", actions, events },
  parseState: parseCalculatorState,
  initialState(_instance: ComponentInstance) { return initialCalculatorState(); },
  reduce(state: CalculatorState, action: ResolvedComponentAction, _context: DeterministicActionContext) {
    if (action.actionId === "calculator.clear") {
      const next = initialCalculatorState();
      return [{ state: next, emittedEvents: [displayChangedEvent(action, next.display)] }];
    }
    if (action.actionId !== "calculator.pressKey") return [];
    const payload = objectPayload(action.payload);
    if (!payload || !isCalculatorKey(payload.key)) return [];
    const next = reduceCalculatorKey(state, payload.key);
    return next ? [{ state: next, emittedEvents: [displayChangedEvent(action, next.display)] }] : [];
  },
  projectVisual(state: CalculatorState) {
    const current = parseCalculatorState(state);
    return { primitives: [{ kind: "text-display", key: "calculator", lines: [current.display] }], accessibleSummary: `Calculator shows ${current.display}.` };
  },
};
