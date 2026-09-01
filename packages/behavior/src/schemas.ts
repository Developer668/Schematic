import type {
  BehaviorActionId,
  BehaviorCueV1,
  BehaviorEventId,
  ComponentActionRequestV1,
  BehaviorPayloadV1,
  BehaviorPayloadSchemaV1,
  BehaviorPlanV1,
  BehaviorRuleV1,
  BehaviorTriggerV1,
  JsonValue,
  BehaviorDiagnostic,
} from "./contracts";

export const BEHAVIOR_LIMITS = Object.freeze({
  maxPlansPerProject: 100,
  maxRulesPerPlan: 200,
  maxActionsPerRule: 20,
  maxCuesPerPlan: 2_000,
  defaultDurationMs: 60_000,
  maxDurationMs: 600_000,
  maxDispatchedEvents: 10_000,
  maxEventChainDepth: 32,
  maxDisplayTextLength: 4_096,
  maxTimelineItems: 500,
  maxSchemaDepth: 16,
  maxPlanStringLength: 4_096,
  maxJsonDepth: 16,
  maxJsonNodes: 20_000,
  maxJsonStringLength: 65_536,
  maxIdentifierLength: 200,
  /**
   * Aggregate limits are measured against the JSON representation, not the
   * caller's object graph. Keeping both code units and UTF-8 bytes bounded
   * makes the same contract safe for browser strings and persisted/network
   * payloads. A plan is intentionally larger than one dispatch request.
   */
  maxPlanJsonCodeUnits: 1_048_576,
  maxPlanJsonBytes: 2_097_152,
  maxDispatchJsonCodeUnits: 131_072,
  maxDispatchJsonBytes: 262_144,
  maxRetainedHistoryBytes: 4_194_304,
  maxSessionLogEntryBytes: 16_384,
  maxSessionLogBytes: 1_048_576,
  maxSessionLogLifetimeBytes: 4_194_304,
} as const);

export type JsonValidationMode = "generic" | "plan" | "dispatch";

export interface JsonResourceSize {
  codeUnits: number;
  utf8Bytes: number;
}

const JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema" as const;
const SUPPORTED_SCHEMA_KEYS = new Set([
  "type", "properties", "required", "additionalProperties", "items", "enum", "const",
  "minimum", "maximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems", "format",
]);

export interface PayloadValidationResult {
  valid: boolean;
  diagnostics: readonly BehaviorDiagnostic[];
}

export function payloadSchema(
  schemaId: string,
  schema: JsonValue,
): BehaviorPayloadSchemaV1 {
  return { schemaId, dialect: JSON_SCHEMA_DIALECT, schema };
}

export function validatePayloadSchema(schema: BehaviorPayloadSchemaV1, path = "payloadSchema"): readonly BehaviorDiagnostic[] {
  const diagnostics: BehaviorDiagnostic[] = [];
  if (!isRecord(schema) || schema.dialect !== JSON_SCHEMA_DIALECT || typeof schema.schemaId !== "string" || !schema.schemaId.trim()) {
    diagnostics.push({ code: "INVALID_PAYLOAD_SCHEMA", severity: "error", message: `${path} must use the supported JSON Schema dialect and a non-empty schemaId.`, path });
    return diagnostics;
  }
  validateSchemaNode(schema.schema, path, diagnostics, 0);
  return diagnostics;
}

export function validatePayload(
  schema: BehaviorPayloadSchemaV1,
  value: unknown,
  path = "payload",
  mode: JsonValidationMode = "dispatch",
): PayloadValidationResult {
  const schemaDiagnostics = validatePayloadSchema(schema);
  if (schemaDiagnostics.some((diagnostic) => diagnostic.severity === "error")) return { valid: false, diagnostics: schemaDiagnostics };
  if (!isJsonValue(value, mode)) return { valid: false, diagnostics: [{ code: "NON_JSON_VALUE", severity: "error", message: `${path} must be bounded JSON data within the ${mode} resource budget.`, path }] };
  const diagnostics: BehaviorDiagnostic[] = [];
  validateValueAgainstSchema(schema.schema, value, path, diagnostics, 0);
  return { valid: diagnostics.length === 0, diagnostics };
}

function validateSchemaNode(value: unknown, path: string, diagnostics: BehaviorDiagnostic[], depth: number) {
  if (depth > BEHAVIOR_LIMITS.maxSchemaDepth) {
    diagnostics.push({ code: "SCHEMA_TOO_DEEP", severity: "error", message: `Schema exceeds the maximum depth of ${BEHAVIOR_LIMITS.maxSchemaDepth}.`, path });
    return;
  }
  if (!isRecord(value)) {
    diagnostics.push({ code: "INVALID_SCHEMA_NODE", severity: "error", message: `${path} must be a JSON object.`, path });
    return;
  }
  for (const key of Object.keys(value)) {
    if (!SUPPORTED_SCHEMA_KEYS.has(key)) diagnostics.push({ code: "UNSUPPORTED_SCHEMA_KEYWORD", severity: "error", message: `Schema keyword ${key} is not supported.`, path: `${path}.${key}` });
  }
  if (value.type !== undefined && !isSchemaType(value.type)) {
    diagnostics.push({ code: "INVALID_SCHEMA_TYPE", severity: "error", message: `${path}.type must be a supported JSON Schema type.`, path: `${path}.type` });
  }
  if (value.properties !== undefined) {
    if (!isRecord(value.properties)) diagnostics.push({ code: "INVALID_SCHEMA_PROPERTIES", severity: "error", message: `${path}.properties must be an object.`, path: `${path}.properties` });
    else for (const [key, child] of Object.entries(value.properties)) validateSchemaNode(child, `${path}.properties.${key}`, diagnostics, depth + 1);
  }
  if (value.items !== undefined) validateSchemaNode(value.items, `${path}.items`, diagnostics, depth + 1);
  if (value.required !== undefined) {
    if (!Array.isArray(value.required) || value.required.some((item) => typeof item !== "string") || new Set(value.required).size !== value.required.length) {
      diagnostics.push({ code: "INVALID_SCHEMA_REQUIRED", severity: "error", message: `${path}.required must contain unique property names.`, path: `${path}.required` });
    }
  }
  if (value.additionalProperties !== undefined && typeof value.additionalProperties !== "boolean") diagnostics.push({ code: "INVALID_SCHEMA_ADDITIONAL_PROPERTIES", severity: "error", message: `${path}.additionalProperties must be boolean.`, path: `${path}.additionalProperties` });
  for (const key of ["minimum", "maximum", "multipleOf"]) {
    const bound = value[key];
    if (bound !== undefined && (!isFiniteNumber(bound) || (key === "multipleOf" && bound <= 0))) diagnostics.push({ code: "INVALID_SCHEMA_NUMBER_BOUND", severity: "error", message: `${path}.${key} must be a finite ${key === "multipleOf" ? "positive " : ""}number.`, path: `${path}.${key}` });
  }
  for (const key of ["minLength", "maxLength", "minItems", "maxItems"]) {
    const bound = value[key];
    if (bound !== undefined && (!Number.isSafeInteger(bound) || (bound as number) < 0)) diagnostics.push({ code: "INVALID_SCHEMA_LENGTH_BOUND", severity: "error", message: `${path}.${key} must be a non-negative integer.`, path: `${path}.${key}` });
  }
  if (isFiniteNumber(value.minimum) && isFiniteNumber(value.maximum) && value.minimum > value.maximum) diagnostics.push({ code: "INVALID_SCHEMA_NUMBER_RANGE", severity: "error", message: `${path}.minimum must not exceed maximum.`, path });
  if (Number.isSafeInteger(value.minLength) && Number.isSafeInteger(value.maxLength) && (value.minLength as number) > (value.maxLength as number)) diagnostics.push({ code: "INVALID_SCHEMA_LENGTH_RANGE", severity: "error", message: `${path}.minLength must not exceed maxLength.`, path });
  if (Number.isSafeInteger(value.minItems) && Number.isSafeInteger(value.maxItems) && (value.minItems as number) > (value.maxItems as number)) diagnostics.push({ code: "INVALID_SCHEMA_LENGTH_RANGE", severity: "error", message: `${path}.minItems must not exceed maxItems.`, path });
  if (value.enum !== undefined && (!Array.isArray(value.enum) || value.enum.length === 0 || value.enum.some((item) => !isJsonValue(item)))) diagnostics.push({ code: "INVALID_SCHEMA_ENUM", severity: "error", message: `${path}.enum must be a non-empty JSON array.`, path: `${path}.enum` });
  if (value.const !== undefined && !isJsonValue(value.const)) diagnostics.push({ code: "INVALID_SCHEMA_CONST", severity: "error", message: `${path}.const must be JSON data.`, path: `${path}.const` });
  if (value.format !== undefined && value.format !== "hex-color") diagnostics.push({ code: "UNSUPPORTED_SCHEMA_FORMAT", severity: "error", message: `${path}.format must be the supported hex-color format.`, path: `${path}.format` });
}

function validateValueAgainstSchema(schema: unknown, value: unknown, path: string, diagnostics: BehaviorDiagnostic[], depth: number) {
  if (!isRecord(schema) || depth > BEHAVIOR_LIMITS.maxSchemaDepth) return;
  if (schema.type !== undefined && !matchesSchemaType(schema.type, value)) {
    diagnostics.push({ code: "PAYLOAD_TYPE_MISMATCH", severity: "error", message: `${path} does not match the declared payload type.`, path });
    return;
  }
  if (schema.const !== undefined && !jsonEqual(schema.const, value)) diagnostics.push({ code: "PAYLOAD_CONST_MISMATCH", severity: "error", message: `${path} must equal the declared constant.`, path });
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => jsonEqual(candidate, value))) diagnostics.push({ code: "PAYLOAD_ENUM_MISMATCH", severity: "error", message: `${path} is not one of the declared values.`, path });
  if (typeof value === "number" && Number.isFinite(value)) {
    if (typeof schema.minimum === "number" && value < schema.minimum) diagnostics.push({ code: "PAYLOAD_BELOW_MINIMUM", severity: "error", message: `${path} must be at least ${schema.minimum}.`, path });
    if (typeof schema.maximum === "number" && value > schema.maximum) diagnostics.push({ code: "PAYLOAD_ABOVE_MAXIMUM", severity: "error", message: `${path} must be at most ${schema.maximum}.`, path });
    if (typeof schema.multipleOf === "number" && !isMultipleOf(value, schema.multipleOf)) diagnostics.push({ code: "PAYLOAD_NOT_MULTIPLE", severity: "error", message: `${path} must be a multiple of ${schema.multipleOf}.`, path });
  }
  if (typeof value === "string") {
    const length = Array.from(value).length;
    if (typeof schema.minLength === "number" && length < schema.minLength) diagnostics.push({ code: "PAYLOAD_TOO_SHORT", severity: "error", message: `${path} must contain at least ${schema.minLength} characters.`, path });
    if (typeof schema.maxLength === "number" && length > schema.maxLength) diagnostics.push({ code: "PAYLOAD_TOO_LONG", severity: "error", message: `${path} must contain at most ${schema.maxLength} characters.`, path });
    if (schema.format === "hex-color" && !/^#[0-9a-fA-F]{6}$/.test(value)) diagnostics.push({ code: "PAYLOAD_FORMAT_MISMATCH", severity: "error", message: `${path} must be a six-digit hexadecimal color such as #3b82f6.`, path });
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) diagnostics.push({ code: "PAYLOAD_TOO_FEW_ITEMS", severity: "error", message: `${path} must contain at least ${schema.minItems} items.`, path });
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) diagnostics.push({ code: "PAYLOAD_TOO_MANY_ITEMS", severity: "error", message: `${path} must contain at most ${schema.maxItems} items.`, path });
    if (schema.items !== undefined) value.forEach((item, index) => validateValueAgainstSchema(schema.items, item, `${path}[${index}]`, diagnostics, depth + 1));
  }
  if (isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!Object.prototype.hasOwnProperty.call(properties, key)) diagnostics.push({ code: "PAYLOAD_UNKNOWN_PROPERTY", severity: "error", message: `${path}.${key} is not permitted by the payload schema.`, path: `${path}.${key}` });
    }
    if (Array.isArray(schema.required)) for (const key of schema.required) if (!Object.prototype.hasOwnProperty.call(value, key)) diagnostics.push({ code: "PAYLOAD_MISSING_PROPERTY", severity: "error", message: `${path}.${String(key)} is required.`, path: `${path}.${String(key)}` });
    for (const [key, childSchema] of Object.entries(properties)) if (Object.prototype.hasOwnProperty.call(value, key)) validateValueAgainstSchema(childSchema, value[key], `${path}.${key}`, diagnostics, depth + 1);
  }
}

export interface PlanValidationResult {
  plan?: BehaviorPlanV1;
  diagnostics: readonly BehaviorDiagnostic[];
}

export function parseBehaviorPlan(value: unknown): PlanValidationResult {
  const diagnostics: BehaviorDiagnostic[] = [];
  if (!isRecord(value)) return { diagnostics: [diagnostic("INVALID_PLAN", "Behavior Plan must be a JSON object.", "$")] };
  if (!isJsonValue(value, "plan")) return { diagnostics: [diagnostic("PLAN_RESOURCE_LIMIT_EXCEEDED", `Behavior Plan must be bounded JSON (depth ${BEHAVIOR_LIMITS.maxJsonDepth}, at most ${BEHAVIOR_LIMITS.maxJsonNodes} values, strings at most ${BEHAVIOR_LIMITS.maxJsonStringLength} characters, ${BEHAVIOR_LIMITS.maxPlanJsonCodeUnits} JSON code units, and ${BEHAVIOR_LIMITS.maxPlanJsonBytes} UTF-8 bytes).`, "$")] };
  assertKeys(value, ["schemaVersion", "id", "projectId", "name", "intent", "revision", "rules", "cues"], "$", diagnostics);
  if (value.schemaVersion !== 1) diagnostics.push(diagnostic("UNSUPPORTED_PLAN_VERSION", "Only Behavior Plan schema version 1 is supported.", "$.schemaVersion"));
  const id = boundedIdentifier(value.id, "$.id", diagnostics);
  const projectId = boundedIdentifier(value.projectId, "$.projectId", diagnostics);
  const name = boundedString(value.name, "$.name", diagnostics);
  const intent = value.intent === undefined ? undefined : boundedString(value.intent, "$.intent", diagnostics);
  const revision = nonNegativeInteger(value.revision, "$.revision", diagnostics);
  const rules = parseRules(value.rules, diagnostics);
  const cues = value.cues === undefined ? undefined : parseCues(value.cues, diagnostics);
  if (diagnostics.some((item) => item.severity === "error")) return { diagnostics };
  return { plan: { schemaVersion: 1, id, projectId, name, ...(intent === undefined ? {} : { intent }), revision, rules, ...(cues === undefined ? {} : { cues }) }, diagnostics };
}

function parseRules(value: unknown, diagnostics: BehaviorDiagnostic[]): BehaviorRuleV1[] {
  if (!Array.isArray(value)) { diagnostics.push(diagnostic("INVALID_RULES", "Behavior Plan rules must be an array.", "$.rules")); return []; }
  if (value.length > BEHAVIOR_LIMITS.maxRulesPerPlan) diagnostics.push(diagnostic("RULE_LIMIT_EXCEEDED", `A plan may contain at most ${BEHAVIOR_LIMITS.maxRulesPerPlan} rules.`, "$.rules"));
  const ids = new Set<string>();
  const rules: BehaviorRuleV1[] = [];
  value.slice(0, BEHAVIOR_LIMITS.maxRulesPerPlan).forEach((item, index) => {
    const path = `$.rules[${index}]`;
    if (!isRecord(item)) { diagnostics.push(diagnostic("INVALID_RULE", "Rule must be an object.", path)); return; }
    assertKeys(item, ["id", "enabled", "when", "then"], path, diagnostics);
    const id = boundedIdentifier(item.id, `${path}.id`, diagnostics);
    if (ids.has(id)) diagnostics.push(diagnostic("DUPLICATE_RULE_ID", `Rule id ${id} is duplicated.`, `${path}.id`, id));
    ids.add(id);
    if (typeof item.enabled !== "boolean") diagnostics.push(diagnostic("INVALID_RULE_ENABLED", "Rule enabled must be boolean.", `${path}.enabled`));
    const when = parseTrigger(item.when, `${path}.when`, diagnostics);
    const then = parseActions(item.then, `${path}.then`, diagnostics);
    rules.push({ id, enabled: item.enabled === true, when, then });
  });
  return rules;
}

function parseCues(value: unknown, diagnostics: BehaviorDiagnostic[]): BehaviorCueV1[] {
  if (!Array.isArray(value)) { diagnostics.push(diagnostic("INVALID_CUES", "Behavior Plan cues must be an array.", "$.cues")); return []; }
  if (value.length > BEHAVIOR_LIMITS.maxCuesPerPlan) diagnostics.push(diagnostic("CUE_LIMIT_EXCEEDED", `A plan may contain at most ${BEHAVIOR_LIMITS.maxCuesPerPlan} cues.`, "$.cues"));
  const ids = new Set<string>();
  const cues: BehaviorCueV1[] = [];
  value.slice(0, BEHAVIOR_LIMITS.maxCuesPerPlan).forEach((item, index) => {
    const path = `$.cues[${index}]`;
    if (!isRecord(item)) { diagnostics.push(diagnostic("INVALID_CUE", "Cue must be an object.", path)); return; }
    assertKeys(item, ["id", "atMs", "order", "action"], path, diagnostics);
    const id = boundedIdentifier(item.id, `${path}.id`, diagnostics);
    if (ids.has(id)) diagnostics.push(diagnostic("DUPLICATE_CUE_ID", `Cue id ${id} is duplicated.`, `${path}.id`, id));
    ids.add(id);
    const atMs = boundedTime(item.atMs, `${path}.atMs`, diagnostics);
    const order = nonNegativeInteger(item.order, `${path}.order`, diagnostics);
    const action = parseAction(item.action, `${path}.action`, diagnostics);
    cues.push({ id, atMs, order, action });
  });
  return cues;
}

function parseTrigger(value: unknown, path: string, diagnostics: BehaviorDiagnostic[]): BehaviorTriggerV1 {
  if (!isRecord(value) || typeof value.type !== "string") { diagnostics.push(diagnostic("INVALID_TRIGGER", "Rule trigger must declare a type.", path)); return { type: "preview.started" }; }
  switch (value.type) {
    case "preview.started":
      assertKeys(value, ["type"], path, diagnostics);
      return { type: "preview.started" };
    case "component.event": {
      assertKeys(value, ["type", "componentId", "definitionId", "eventId", "payload"], path, diagnostics);
      const componentId = boundedIdentifier(value.componentId, `${path}.componentId`, diagnostics);
      const definitionId = boundedIdentifier(value.definitionId, `${path}.definitionId`, diagnostics);
      const eventId = behaviorEventId(value.eventId, `${path}.eventId`, diagnostics);
      const payload = value.payload === undefined ? undefined : jsonValue(value.payload, `${path}.payload`, diagnostics);
      return { type: "component.event", componentId, definitionId, eventId, ...(payload === undefined ? {} : { payload }) };
    }
    case "input.changed":
      assertKeys(value, ["type", "componentId", "definitionId", "inputId"], path, diagnostics);
      return { type: "input.changed", componentId: boundedIdentifier(value.componentId, `${path}.componentId`, diagnostics), definitionId: boundedIdentifier(value.definitionId, `${path}.definitionId`, diagnostics), inputId: boundedIdentifier(value.inputId, `${path}.inputId`, diagnostics) };
    case "time.elapsed":
      assertKeys(value, ["type", "afterMs"], path, diagnostics);
      return { type: "time.elapsed", afterMs: boundedTime(value.afterMs, `${path}.afterMs`, diagnostics) };
    default:
      diagnostics.push(diagnostic("UNKNOWN_TRIGGER", `Unsupported trigger type ${value.type}.`, `${path}.type`));
      return { type: "preview.started" };
  }
}

function parseActions(value: unknown, path: string, diagnostics: BehaviorDiagnostic[]): ComponentActionRequestV1[] {
  if (!Array.isArray(value)) { diagnostics.push(diagnostic("INVALID_ACTIONS", "Rule actions must be an array.", path)); return []; }
  if (value.length > BEHAVIOR_LIMITS.maxActionsPerRule) diagnostics.push(diagnostic("ACTION_LIMIT_EXCEEDED", `A rule may contain at most ${BEHAVIOR_LIMITS.maxActionsPerRule} actions.`, path));
  return value.slice(0, BEHAVIOR_LIMITS.maxActionsPerRule).map((item, index) => parseAction(item, `${path}[${index}]`, diagnostics));
}

function parseAction(value: unknown, path: string, diagnostics: BehaviorDiagnostic[]): ComponentActionRequestV1 {
  if (!isRecord(value)) { diagnostics.push(diagnostic("INVALID_ACTION", "Action request must be an object.", path)); return { componentId: "", definitionId: "", actionId: "invalid.action", payload: { kind: "literal", value: null } }; }
  assertKeys(value, ["componentId", "definitionId", "actionId", "payload"], path, diagnostics);
  const componentId = boundedIdentifier(value.componentId, `${path}.componentId`, diagnostics);
  const definitionId = boundedIdentifier(value.definitionId, `${path}.definitionId`, diagnostics);
  const actionId = behaviorActionId(value.actionId, `${path}.actionId`, diagnostics);
  const payload = parsePayload(value.payload, `${path}.payload`, diagnostics);
  return { componentId, definitionId, actionId, payload };
}

function parsePayload(value: unknown, path: string, diagnostics: BehaviorDiagnostic[]): BehaviorPayloadV1 {
  if (!isRecord(value) || (value.kind !== "literal" && value.kind !== "trigger-payload")) { diagnostics.push(diagnostic("INVALID_ACTION_PAYLOAD", "Action payload must be a literal or bounded trigger-payload reference.", path)); return { kind: "literal", value: null }; }
  if (value.kind === "literal") {
    assertKeys(value, ["kind", "value"], path, diagnostics);
    return { kind: "literal", value: jsonValue(value.value, `${path}.value`, diagnostics) };
  }
  assertKeys(value, ["kind", "select", "fallback"], path, diagnostics);
  if (value.select !== "$" && value.select !== "$.value") diagnostics.push(diagnostic("INVALID_TRIGGER_PAYLOAD_SELECTOR", "Only $ and $.value selectors are supported.", `${path}.select`));
  const fallback = value.fallback === undefined ? undefined : jsonValue(value.fallback, `${path}.fallback`, diagnostics);
  return { kind: "trigger-payload", select: value.select === "$.value" ? "$.value" : "$", ...(fallback === undefined ? {} : { fallback }) };
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, diagnostics: BehaviorDiagnostic[]) {
  const accepted = new Set(allowed);
  for (const key of Object.keys(value)) if (!accepted.has(key)) diagnostics.push(diagnostic("UNKNOWN_PLAN_FIELD", `${path}.${key} is not an allowed Behavior Plan field.`, `${path}.${key}`));
}

function boundedString(value: unknown, path: string, diagnostics: BehaviorDiagnostic[]): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > BEHAVIOR_LIMITS.maxPlanStringLength) {
    diagnostics.push(diagnostic("INVALID_PLAN_STRING", `${path} must be a non-empty string of at most ${BEHAVIOR_LIMITS.maxPlanStringLength} characters.`, path));
    return typeof value === "string" ? value.slice(0, BEHAVIOR_LIMITS.maxPlanStringLength) : "";
  }
  return value;
}

function boundedIdentifier(value: unknown, path: string, diagnostics: BehaviorDiagnostic[]): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > BEHAVIOR_LIMITS.maxIdentifierLength) {
    diagnostics.push(diagnostic("INVALID_IDENTIFIER", `${path} must be a non-empty identifier of at most ${BEHAVIOR_LIMITS.maxIdentifierLength} characters.`, path));
    return typeof value === "string" ? value.slice(0, BEHAVIOR_LIMITS.maxIdentifierLength) : "";
  }
  return value;
}

function behaviorActionId(value: unknown, path: string, diagnostics: BehaviorDiagnostic[]): BehaviorActionId {
  const result = boundedIdentifier(value, path, diagnostics);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\.[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(result)) diagnostics.push(diagnostic("INVALID_ACTION_ID", `${path} must use a namespaced action id such as indicator.set.`, path));
  return result as BehaviorActionId;
}

function behaviorEventId(value: unknown, path: string, diagnostics: BehaviorDiagnostic[]): BehaviorEventId {
  const result = boundedIdentifier(value, path, diagnostics);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\.[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(result)) diagnostics.push(diagnostic("INVALID_EVENT_ID", `${path} must use a namespaced event id such as button.pressed.`, path));
  return result as BehaviorEventId;
}

function boundedTime(value: unknown, path: string, diagnostics: BehaviorDiagnostic[]): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > BEHAVIOR_LIMITS.maxDurationMs) diagnostics.push(diagnostic("INVALID_TIME", `${path} must be a non-negative integer no greater than ${BEHAVIOR_LIMITS.maxDurationMs}.`, path));
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(BEHAVIOR_LIMITS.maxDurationMs, Math.trunc(value))) : 0;
}

function nonNegativeInteger(value: unknown, path: string, diagnostics: BehaviorDiagnostic[]): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) diagnostics.push(diagnostic("INVALID_INTEGER", `${path} must be a non-negative safe integer.`, path));
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function jsonValue(value: unknown, path: string, diagnostics: BehaviorDiagnostic[]): JsonValue {
  if (!isJsonValue(value)) { diagnostics.push(diagnostic("NON_JSON_VALUE", `${path} must contain JSON data only; executable values are not permitted.`, path)); return null; }
  return cloneJsonValue(value);
}

function diagnostic(code: string, message: string, path?: string, itemId?: string): BehaviorDiagnostic {
  return { code, severity: "error", message, ...(path === undefined ? {} : { path }), ...(itemId === undefined ? {} : { itemId }) };
}

/**
 * Validate JSON iteratively and return the encoded resource size. This keeps
 * aggregate accounting in the same traversal as depth/node/string checks, so
 * callers do not need to stringify untrusted graphs before rejecting them.
 */
export function measureJsonValue(value: unknown, mode: JsonValidationMode = "generic"): JsonResourceSize | undefined {
  type Frame = { value: unknown; depth: number; exit?: boolean };
  const stack: Frame[] = [{ value, depth: 0 }];
  const ancestors = new Set<object>();
  let nodes = 0;
  let codeUnits = 0;
  let utf8Bytes = 0;
  const codeUnitLimit = mode === "plan"
    ? BEHAVIOR_LIMITS.maxPlanJsonCodeUnits
    : mode === "dispatch"
      ? BEHAVIOR_LIMITS.maxDispatchJsonCodeUnits
      : Number.MAX_SAFE_INTEGER;
  const byteLimit = mode === "plan"
    ? BEHAVIOR_LIMITS.maxPlanJsonBytes
    : mode === "dispatch"
      ? BEHAVIOR_LIMITS.maxDispatchJsonBytes
      : Number.MAX_SAFE_INTEGER;

  const addEncoded = (encoded: string): boolean => {
    codeUnits += encoded.length;
    utf8Bytes += utf8ByteLength(encoded);
    return codeUnits <= codeUnitLimit && utf8Bytes <= byteLimit;
  };

  while (stack.length) {
    const frame = stack.pop()!;
    if (frame.exit) {
      ancestors.delete(frame.value as object);
      continue;
    }
    nodes += 1;
    if (nodes > BEHAVIOR_LIMITS.maxJsonNodes || frame.depth > BEHAVIOR_LIMITS.maxJsonDepth) return undefined;
    const current = frame.value;
    if (current === null) {
      if (!addEncoded("null")) return undefined;
      continue;
    }
    if (typeof current === "boolean") {
      if (!addEncoded(current ? "true" : "false")) return undefined;
      continue;
    }
    if (typeof current === "string") {
      if (current.length > BEHAVIOR_LIMITS.maxJsonStringLength) return undefined;
      if (!addEncoded(JSON.stringify(current))) return undefined;
      continue;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current) || !addEncoded(JSON.stringify(Object.is(current, -0) ? 0 : current))) return undefined;
      continue;
    }
    if (typeof current !== "object" || ancestors.has(current)) return undefined;
    if (Array.isArray(current)) {
      if (current.length > BEHAVIOR_LIMITS.maxJsonNodes || Object.keys(current).length !== current.length) return undefined;
      if (!addEncoded("[")) return undefined;
      for (let index = 1; index < current.length; index += 1) if (!addEncoded(",")) return undefined;
      if (!addEncoded("]")) return undefined;
      ancestors.add(current);
      stack.push({ value: current, depth: frame.depth, exit: true });
      for (let index = current.length - 1; index >= 0; index -= 1) stack.push({ value: current[index], depth: frame.depth + 1 });
      continue;
    }
    if ((Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) || Object.getOwnPropertySymbols(current).length > 0) return undefined;
    const entries = Object.entries(current as Record<string, unknown>);
    if (entries.length > BEHAVIOR_LIMITS.maxJsonNodes || entries.some(([key]) => key.length > BEHAVIOR_LIMITS.maxPlanStringLength)) return undefined;
    // Account for object punctuation incrementally. Constructing one giant
    // `${entries.map(...).join("")}` string allowed many large keys to evade
    // the aggregate budget until after a potentially huge allocation.
    if (!addEncoded("{")) return undefined;
    for (let index = 0; index < entries.length; index += 1) {
      if (index > 0 && !addEncoded(",")) return undefined;
      if (!addEncoded(JSON.stringify(entries[index][0])) || !addEncoded(":")) return undefined;
    }
    if (!addEncoded("}")) return undefined;
    ancestors.add(current);
    stack.push({ value: current, depth: frame.depth, exit: true });
    for (let index = entries.length - 1; index >= 0; index -= 1) stack.push({ value: entries[index][1], depth: frame.depth + 1 });
  }
  return { codeUnits, utf8Bytes };
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else if (code >= 0xdc00 && code <= 0xdfff) bytes += 3;
    else bytes += 3;
  }
  return bytes;
}

export function isJsonValue(value: unknown, mode: JsonValidationMode = "generic"): value is JsonValue {
  return measureJsonValue(value, mode) !== undefined;
}

/** Clone a previously bounded JSON value so callers cannot retain mutable
 * references into a prepared plan, session history, input map, or snapshot. */
export function cloneJsonValue<T extends JsonValue>(value: T): T {
  if (!isJsonValue(value)) throw new TypeError("Value must be bounded JSON data.");
  function clone(current: JsonValue): JsonValue {
    if (current === null || typeof current !== "object") return current;
    if (Array.isArray(current)) return current.map((item) => clone(item));
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(current)) {
      Object.defineProperty(result, key, { value: clone(item), enumerable: true, configurable: true, writable: true });
    }
    return result;
  }
  return clone(value) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSchemaType(value: unknown): boolean {
  const types = ["object", "array", "string", "number", "integer", "boolean", "null"];
  return typeof value === "string" ? types.includes(value) : Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && types.includes(item));
}

function matchesSchemaType(type: unknown, value: unknown): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some((candidate) => {
    switch (candidate) {
      case "object": return isRecord(value);
      case "array": return Array.isArray(value);
      case "string": return typeof value === "string";
      case "number": return typeof value === "number" && Number.isFinite(value);
      case "integer": return Number.isSafeInteger(value);
      case "boolean": return typeof value === "boolean";
      case "null": return value === null;
      default: return false;
    }
  });
}

function isMultipleOf(value: number, multiple: number) {
  const quotient = value / multiple;
  return Math.abs(quotient - Math.round(quotient)) < 1e-9;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (!isJsonValue(left) || !isJsonValue(right)) return false;
  return stableJson(left) === stableJson(right);
}

function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(Object.is(value, -0) ? 0 : value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const objectValue = value as { readonly [key: string]: JsonValue };
  return `{${Object.keys(objectValue).sort().map((key) => `${JSON.stringify(key)}:${stableJson(objectValue[key])}`).join(",")}}`;
}
