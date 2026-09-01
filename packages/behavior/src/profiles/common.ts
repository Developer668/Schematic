import type { ComponentInstance } from "@schematic/hardware-graph";
import type { JsonValue, BehaviorDiagnostic } from "../contracts";

export function objectPayload(value: JsonValue): Record<string, JsonValue> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, JsonValue> : undefined;
}

export function property(instance: ComponentInstance, key: string): unknown {
  return instance.properties && typeof instance.properties === "object" ? instance.properties[key] : undefined;
}

export function boundedString(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === "string" ? Array.from(value).slice(0, maxLength).join("") : fallback;
}

export function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function integerNumber(value: unknown, fallback: number, min: number, max: number): number {
  return Math.trunc(boundedNumber(value, fallback, min, max));
}

export function actionState<State>(state: State): readonly { state: State }[] {
  return [{ state }];
}

export function noTransition<State>(): readonly { state: State }[] {
  return [];
}

export function profileDiagnostic(code: string, message: string, path?: string): BehaviorDiagnostic {
  return { code, severity: "error", message, ...(path ? { path } : {}) };
}

