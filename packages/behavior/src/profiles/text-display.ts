import type { ComponentInstance } from "@schematic/hardware-graph";
import { actionState, boundedString, integerNumber, objectPayload, property } from "./common";
import type { BehaviorProfile, BehaviorActionDescriptor, DeterministicActionContext, ResolvedComponentAction } from "../contracts";
import { BEHAVIOR_LIMITS, payloadSchema } from "../schemas";

export interface TextDisplayState {
  lines: readonly string[];
  x: number;
  y: number;
}

const showTextSchema = payloadSchema("behavior/text-display/show-text/v1", {
  type: "object",
  properties: {
    text: { type: "string", maxLength: BEHAVIOR_LIMITS.maxDisplayTextLength },
    x: { type: "integer", minimum: 0, maximum: 4096 },
    y: { type: "integer", minimum: 0, maximum: 4096 },
  },
  required: ["text"],
  additionalProperties: false,
});
const clearSchema = payloadSchema("behavior/text-display/clear/v1", { type: "object", properties: {}, additionalProperties: false });

const actions: readonly BehaviorActionDescriptor[] = [
  { id: "display.showText", label: "Show text", description: "Show bounded plain text on the display.", payloadSchema: showTextSchema, control: { kind: "text", maxLength: BEHAVIOR_LIMITS.maxDisplayTextLength } },
  { id: "display.clear", label: "Clear display", description: "Remove all display text.", payloadSchema: clearSchema, control: { kind: "trigger" } },
];

function safeText(value: unknown): string {
  return boundedString(typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "") : value, "", BEHAVIOR_LIMITS.maxDisplayTextLength);
}

export const textDisplayProfile: BehaviorProfile<TextDisplayState> = {
  manifest: { id: "text-display", version: 1, implementationId: "text-display:v1:20260831", actions, events: [] },
  parseState(value: unknown): TextDisplayState {
    const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const lines = Array.isArray(record.lines) ? record.lines.filter((line): line is string => typeof line === "string").map(safeText) : [];
    return { lines, x: integerNumber(record.x, 0, 0, 4096), y: integerNumber(record.y, 0, 0, 4096) };
  },
  initialState(instance: ComponentInstance): TextDisplayState {
    const text = safeText(property(instance, "text") ?? property(instance, "initialText"));
    return { lines: text ? text.split("\n").map(safeText) : [], x: integerNumber(property(instance, "x"), 0, 0, 4096), y: integerNumber(property(instance, "y"), 0, 0, 4096) };
  },
  reduce(state: TextDisplayState, action: ResolvedComponentAction, _context: DeterministicActionContext) {
    const payload = objectPayload(action.payload);
    if (action.actionId === "display.clear") return actionState({ ...state, lines: [] });
    if (action.actionId !== "display.showText" || !payload || typeof payload.text !== "string") return [];
    const text = safeText(payload.text);
    return actionState({
      lines: text.split("\n").map(safeText),
      x: integerNumber(payload.x, state.x, 0, 4096),
      y: integerNumber(payload.y, state.y, 0, 4096),
    });
  },
  projectVisual(state: TextDisplayState) {
    const visibleLines = state.lines.map((line) => safeText(line));
    const summary = visibleLines.length ? `Display shows: ${visibleLines.join(" | ")}` : "Display is clear.";
    return { primitives: [{ kind: "text-display", key: "display", lines: visibleLines }], accessibleSummary: summary };
  },
};
