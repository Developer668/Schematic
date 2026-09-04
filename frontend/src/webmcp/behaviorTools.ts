import {
  exportCode,
  getBehaviorCapabilities,
  getBehaviorState,
  getPreviewStatus,
  invokeBehavior,
  previewBehavior,
  readCode,
  writeBehaviorPlan,
  writeCode,
} from "../application/behaviorCommands.ts";
import { PREVIEW_DISCLAIMER, useBehaviorPreviewStore } from "../behavior/useBehaviorPreviewStore.ts";
import { useProjectStore } from "../store/useProjectStore.ts";
import { MAX_CODE_DEPENDENCIES_PER_DOCUMENT, MAX_CODE_FILE_BYTES, MAX_CODE_FILES_PER_DOCUMENT, type CodeDependencyRecord, type CodeFileRecord, type CodeLanguage } from "../store/behaviorPersistence.ts";
import { CALCULATOR_KEYS, isJsonValue, type BehaviorPayloadV1 } from "@schematic/behavior";

export interface BehaviorWebMCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; untrustedContentHint?: boolean };
  execute: (args: any, context?: { signal?: AbortSignal }) => Promise<any>;
}

function jsonContent(data: unknown) {
  return [{ type: "text", text: JSON.stringify(data, null, 2) }];
}

function commandResult(result: any) {
  if (result.ok) return { content: jsonContent(result.data), data: result.data };
  const error = result.error ?? { code: "COMMAND_FAILED", message: "The command failed.", retryable: false };
  return {
    content: jsonContent({ error, ...(result.data ? { data: result.data } : {}) }),
    isError: true,
    error,
    data: { code: error.code, ...(result.data ?? {}) },
  };
}

const MAX_BEHAVIOR_IDENTIFIER_LENGTH = 200;
const SHA256_PATTERN = /^[0-9a-fA-F]{64}$/;
const SHA256_SCHEMA = { type: "string", pattern: "^[0-9a-fA-F]{64}$" };
const COMPONENT_ID_SCHEMA = { type: "string", minLength: 1, maxLength: MAX_BEHAVIOR_IDENTIFIER_LENGTH };
const BOARD_FQBN_SCHEMA = { type: "string", minLength: 1, maxLength: MAX_BEHAVIOR_IDENTIFIER_LENGTH };

function boundedIdentifier(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_BEHAVIOR_IDENTIFIER_LENGTH;
}

function expectedHash(value: unknown) {
  return value === null || (typeof value === "string" && SHA256_PATTERN.test(value));
}

export const KEYPAD_PRESS_RECOVERY_HINT = "Use behavior.get_capabilities to list keypad instances and exact behavior support.";

/**
 * WebMCP and the human controls share command semantics, but model calls do
 * not pass through the UI adapter. Project the completed tool result into the
 * same ephemeral store so an agent-triggered preview is actually visible on
 * the canvas. Bumping the generation makes the latest completed command win
 * over any older in-flight UI request.
 */
function previewCommandResult(result: any, command: "preview" | "invoke") {
  const store = useBehaviorPreviewStore;
  if (!result.ok) {
    // An older async prepare must not overwrite the session/store installed by
    // the request that superseded it.
    if (result.error?.code === "PREVIEW_REQUEST_SUPERSEDED") return commandResult(result);
    const diagnostics = result.error?.details?.diagnostics ?? [{ code: result.error?.code ?? "COMMAND_FAILED", severity: "error", message: result.error?.message ?? "Behavior command failed." }];
    store.setState((state) => ({
      requestGeneration: state.requestGeneration + 1,
      status: "blocked",
      snapshot: null,
      durationMs: 1_000,
      diagnostics,
      preparationStatus: null,
      error: result.error?.message ?? "Behavior command failed.",
      announcement: result.error?.message ?? "Behavior command failed.",
    }));
    return commandResult(result);
  }

  const data = result.data ?? {};
  const status = command === "preview"
    ? data.status
    : getPreviewStatus();
  store.setState((state) => ({
    requestGeneration: state.requestGeneration + 1,
    ...(data.snapshot ? { snapshot: data.snapshot } : {}),
    ...(Array.isArray(data.preparationDiagnostics) || Array.isArray(data.diagnostics) ? {
      diagnostics: command === "preview"
        ? (data.diagnostics ?? data.preparationDiagnostics ?? [])
        : [...(data.preparationDiagnostics ?? []), ...(data.diagnostics ?? [])],
    } : {}),
    ...(Number.isSafeInteger(data.durationMs) && data.durationMs > 0 ? { durationMs: data.durationMs } : {}),
    ...(Object.prototype.hasOwnProperty.call(data, "preparationStatus") ? { preparationStatus: data.preparationStatus } : {}),
    status,
    error: null,
    announcement: data.notice ?? PREVIEW_DISCLAIMER,
  }));
  return commandResult(result);
}

const languageSchema = { type: "string", enum: ["arduino", "micropython", "espidf", "c", "cpp", "python"] };
const fileSchema = { type: "object", properties: { name: { type: "string", minLength: 1, maxLength: 240 }, content: { type: "string", maxLength: MAX_CODE_FILE_BYTES } }, required: ["name", "content"], additionalProperties: false };
const dependencySchema = { type: "object", properties: { ecosystem: { type: "string", enum: ["arduino-library", "platformio", "python-package", "vendor-sdk", "other"] }, name: { type: "string", minLength: 1, maxLength: 240 }, version: { type: "string", maxLength: 120 }, sourceUrl: { type: "string", maxLength: 2_000 } }, required: ["ecosystem", "name"], additionalProperties: false };

export const behaviorToolDefinitions: readonly BehaviorWebMCPTool[] = [
  {
    name: "behavior.get_capabilities",
    description: "Read exact typed preview actions and events declared by the checked-in behavior profiles for every component instance.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async () => commandResult(await getBehaviorCapabilities()),
  },
  {
    name: "behavior.plan.write",
    description: "Create or replace a versioned Behavior Plan after validating exact component definitions, typed payloads, and profile support. This does not run source code or start preview.",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "object", description: "Version 1 Behavior Plan JSON" },
        expectedRevision: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }], description: "Current plan revision, or null to create only" },
      },
      required: ["plan", "expectedRevision"],
      additionalProperties: false,
    },
    execute: async ({ plan, expectedRevision }) => commandResult(await writeBehaviorPlan(plan, expectedRevision)),
  },
  {
    name: "behavior.preview",
    description: "Prepare and open the saved Behavior Plan for deterministic typed-action preview; source code is never read or executed.",
    inputSchema: {
      type: "object",
      properties: {
        planId: { type: "string", minLength: 1, maxLength: MAX_BEHAVIOR_IDENTIFIER_LENGTH },
        onUnsupported: { type: "string", enum: ["block", "skip"], default: "block" },
        durationMs: { type: "integer", minimum: 1, maximum: 600_000, default: 1_000, description: "Minimum logical playback window; scheduled plan items extend it automatically." },
      },
      additionalProperties: false,
    },
    execute: async ({ planId, onUnsupported, durationMs }) => {
      if (planId !== undefined && !boundedIdentifier(planId)) {
        return commandResult({ ok: false, error: { code: "INVALID_BEHAVIOR_REQUEST", message: "planId must be a bounded non-empty identifier of at most 200 characters.", retryable: false } });
      }
      return previewCommandResult(await previewBehavior(planId, onUnsupported === "skip" ? "skip" : "block", durationMs), "preview");
    },
  },
  {
    name: "behavior.invoke",
    description: "Dispatch exactly one validated component event, input change, or typed component action into the active Behavior Preview session. It never mutates the durable plan; a schema-valid request that the profile rejects is returned as data.status=rejected with diagnostics.",
    inputSchema: {
      type: "object",
      properties: {
        componentId: COMPONENT_ID_SCHEMA,
        definitionId: COMPONENT_ID_SCHEMA,
        eventId: { type: "string", minLength: 1, maxLength: MAX_BEHAVIOR_IDENTIFIER_LENGTH },
        inputId: { type: "string", minLength: 1, maxLength: MAX_BEHAVIOR_IDENTIFIER_LENGTH },
        actionId: { type: "string", minLength: 1, maxLength: MAX_BEHAVIOR_IDENTIFIER_LENGTH },
        payload: {},
        value: {},
      },
      required: ["componentId", "definitionId"],
      oneOf: [{ required: ["eventId", "payload"] }, { required: ["inputId", "value"] }, { required: ["actionId", "payload"] }],
      additionalProperties: false,
    },
    execute: async (args) => {
      // `executeToolWithActivity` attaches the authenticated session as an
      // internal-only field. It is not part of the public request contract and
      // must not make otherwise exact-key validation fail.
      const request = args && typeof args === "object" && !Array.isArray(args)
        ? Object.fromEntries(Object.entries(args).filter(([key]) => key !== "__trustedAuth"))
        : args;
      const { componentId, definitionId, eventId, inputId, actionId, payload, value } = request ?? {};
      const invalid = () => commandResult({ ok: false, error: { code: "INVALID_BEHAVIOR_REQUEST", message: "Provide exactly one bounded eventId/payload, inputId/value, or actionId/payload request with exact non-empty identifiers and no extra fields.", retryable: false } });
      if (!request || typeof request !== "object" || Array.isArray(request) || !boundedIdentifier(componentId) || !boundedIdentifier(definitionId)) return invalid();
      const selectedModes = [typeof eventId === "string", typeof inputId === "string", typeof actionId === "string"].filter(Boolean).length;
      if (selectedModes !== 1) return invalid();
      if (typeof eventId === "string") {
        if (!boundedIdentifier(eventId) || !Object.prototype.hasOwnProperty.call(request, "payload") || !isJsonValue(payload) || Object.keys(request).some((key) => !["componentId", "definitionId", "eventId", "payload"].includes(key))) return invalid();
        return previewCommandResult(await invokeBehavior({ componentId, definitionId, eventId: eventId as `${string}.${string}`, payload }), "invoke");
      }
      if (typeof inputId === "string") {
        if (!boundedIdentifier(inputId) || !Object.prototype.hasOwnProperty.call(request, "value") || !isJsonValue(value) || Object.keys(request).some((key) => !["componentId", "definitionId", "inputId", "value"].includes(key))) return invalid();
        return previewCommandResult(await invokeBehavior({ componentId, definitionId, inputId, value }), "invoke");
      }
      if (typeof actionId === "string") {
        if (!boundedIdentifier(actionId) || !Object.prototype.hasOwnProperty.call(request, "payload") || !isJsonValue(payload) || Object.keys(request).some((key) => !["componentId", "definitionId", "actionId", "payload"].includes(key))) return invalid();
        return previewCommandResult(await invokeBehavior({ componentId, definitionId, actionId: actionId as `${string}.${string}`, payload: payload as BehaviorPayloadV1 }), "invoke");
      }
      return invalid();
    },
  },
  {
    name: "behavior.press_key",
    description: "Press one calculator key on a membrane keypad instance through its exact keypad.press action. The keypad's deterministic calculator state emits the resulting display value for Behavior Plan routing to an LCD.",
    inputSchema: {
      type: "object",
      properties: {
        componentId: { ...COMPONENT_ID_SCHEMA, description: "Membrane keypad instance id." },
        definitionId: { ...COMPONENT_ID_SCHEMA, description: "Optional catalog definition id; resolved from the instance when omitted." },
        key: { type: "string", enum: [...CALCULATOR_KEYS], description: "Calculator key to press." },
      },
      required: ["componentId", "key"],
      additionalProperties: false,
    },
    execute: async (args) => {
      const request = args && typeof args === "object" && !Array.isArray(args) ? args : {};
      const { componentId, definitionId, key } = request;
      const invalid = (message: string) => commandResult({ ok: false, error: { code: "INVALID_BEHAVIOR_REQUEST", message: `${message} ${KEYPAD_PRESS_RECOVERY_HINT}`, retryable: false }, data: { hint: KEYPAD_PRESS_RECOVERY_HINT } });
      if (!boundedIdentifier(componentId)) return invalid("componentId must be a bounded non-empty identifier.");
      const instance = useProjectStore.getState().project.components.find((item) => item.id === componentId);
      if (!instance) return invalid(`Unknown component instance ${componentId}.`);
      const resolvedDefinitionId = definitionId ?? instance.definitionId;
      if (!boundedIdentifier(resolvedDefinitionId) || resolvedDefinitionId !== instance.definitionId) return invalid("definitionId must match the current component instance exactly.");
      if (instance.definitionId !== "membrane-keypad") return invalid(`${componentId} is not a membrane keypad instance.`);
      if (typeof key !== "string" || !(CALCULATOR_KEYS as readonly string[]).includes(key)) return invalid(`key must be one of ${CALCULATOR_KEYS.join(", ")}.`);
      const result = await invokeBehavior({ componentId, definitionId: resolvedDefinitionId, actionId: "keypad.press", payload: { kind: "literal", value: { key } } });
      return previewCommandResult(result, "invoke");
    },
  },
  {
    name: "behavior.get_state",
    description: "Read compact active Behavior Preview state. Logs and timeline entries are bounded by pagination parameters so default tool output stays small.",
    inputSchema: {
      type: "object",
      properties: {
        detail: { type: "string", enum: ["compact", "full"], default: "compact" },
        logLimit: { type: "integer", minimum: 0, maximum: 200, default: 12 },
        logOffset: { type: "integer", minimum: 0, default: 0 },
        eventsLimit: { type: "integer", minimum: 0, maximum: 200, default: 12 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async (args) => {
      const request = args && typeof args === "object" && !Array.isArray(args) ? args : {};
      const detail = request.detail ?? "compact";
      const logLimit = request.logLimit ?? 12;
      const logOffset = request.logOffset ?? 0;
      const eventsLimit = request.eventsLimit ?? 12;
      if ((detail !== "compact" && detail !== "full") || !Number.isInteger(logLimit) || logLimit < 0 || logLimit > 200 || !Number.isInteger(logOffset) || logOffset < 0 || !Number.isInteger(eventsLimit) || eventsLimit < 0 || eventsLimit > 200) {
        return commandResult({ ok: false, error: { code: "INVALID_BEHAVIOR_REQUEST", message: "Use detail compact/full, logLimit/eventsLimit 0-200, and a non-negative logOffset.", retryable: false } });
      }
      const result = await getBehaviorState();
      if (!result.ok || detail === "full") return commandResult(result);
      const data = result.data;
      const snapshot = data.snapshot;
      const sessionLog = snapshot && Array.isArray(snapshot.sessionLog) ? snapshot.sessionLog : [];
      const events = snapshot && Array.isArray(snapshot.events) ? snapshot.events : [];
      const compact = {
        status: data.status,
        projectId: data.projectId,
        planId: data.planId,
        logicalTimeMs: data.logicalTimeMs,
        durationMs: data.durationMs,
        componentCount: snapshot ? Object.keys(snapshot.components ?? {}).length : useProjectStore.getState().project.components.length,
        sessionLogTotal: sessionLog.length,
        sessionLog: sessionLog.slice(logOffset, logOffset + logLimit),
        eventsTotal: events.length,
        events: events.slice(0, eventsLimit),
        diagnostics: data.preparationDiagnostics ?? snapshot?.diagnostics ?? [],
        claims: data.claims,
      };
      return { content: [{ type: "text", text: JSON.stringify(compact) }], data: compact };
    },
  },
  {
    name: "code.write",
    description: "Write editable board source using exact-hash concurrency. expectedContentSha256=null creates source and may replace only Schematic's marked generated starter scaffold; real existing source still requires its exact hash. Browser Check can execute its supported bounded subset separately.",
    inputSchema: {
      type: "object",
      properties: {
        targetComponentId: COMPONENT_ID_SCHEMA,
        files: { type: "array", items: fileSchema, minItems: 1, maxItems: MAX_CODE_FILES_PER_DOCUMENT },
        language: languageSchema,
        dependencies: { type: "array", items: dependencySchema, maxItems: MAX_CODE_DEPENDENCIES_PER_DOCUMENT },
        expectedContentSha256: { anyOf: [SHA256_SCHEMA, { type: "null" }] },
        origin: { type: "string", enum: ["ai-generated", "human-authored", "imported", "mixed"] },
        boardFqbn: BOARD_FQBN_SCHEMA,
        linkToBehaviorPlan: { type: "object", properties: { planId: COMPONENT_ID_SCHEMA, planSha256: SHA256_SCHEMA, projectSha256: SHA256_SCHEMA }, required: ["planId", "planSha256", "projectSha256"], additionalProperties: false },
      },
      required: ["targetComponentId", "files", "language", "expectedContentSha256"],
      additionalProperties: false,
    },
    execute: async (args) => {
      if (!boundedIdentifier(args?.targetComponentId)) {
        return commandResult({ ok: false, error: { code: "INVALID_CODE_REQUEST", message: "targetComponentId must be a bounded identifier and expectedContentSha256 must be null or a 64-character SHA-256 hash.", retryable: false } });
      }
      if (!Object.prototype.hasOwnProperty.call(args ?? {}, "expectedContentSha256") || args?.expectedContentSha256 === undefined) {
        return commandResult({ ok: false, error: { code: "SOURCE_PRECONDITION_REQUIRED", message: "Code writes require expectedContentSha256: null for create-only, or the exact current hash for replacement.", retryable: false } });
      }
      if (!expectedHash(args.expectedContentSha256)) {
        return commandResult({ ok: false, error: { code: "INVALID_CODE_REQUEST", message: "expectedContentSha256 must be null or a 64-character SHA-256 hash.", retryable: false } });
      }
      if (args.linkToBehaviorPlan !== undefined) {
        const link = args.linkToBehaviorPlan;
        if (!link || typeof link !== "object" || Array.isArray(link)
          || !boundedIdentifier(link.planId)
          || !expectedHash(link.planSha256)
          || link.planSha256 === null
          || !expectedHash(link.projectSha256)
          || link.projectSha256 === null) {
          return commandResult({ ok: false, error: { code: "INVALID_CODE_REQUEST", message: "linkToBehaviorPlan requires a bounded planId and exact 64-character hexadecimal planSha256/projectSha256 values.", retryable: false } });
        }
      }
      return commandResult(await writeCode({
      targetComponentId: String(args.targetComponentId ?? ""),
      files: (Array.isArray(args.files) ? args.files : []) as CodeFileRecord[],
      language: args.language as CodeLanguage,
      ...(args.dependencies !== undefined ? { dependencies: args.dependencies as CodeDependencyRecord[] } : {}),
      expectedContentSha256: args.expectedContentSha256,
      replaceGeneratedStarter: args.expectedContentSha256 === null,
      origin: args.origin,
      boardFqbn: args.boardFqbn,
      linkToBehaviorPlan: args.linkToBehaviorPlan,
      }));
    },
  },
  {
    name: "code.read",
    description: "Read an editable source document and its origin, revision, hash, preview-link status, and external-use honesty claims.",
    inputSchema: { type: "object", properties: { targetComponentId: COMPONENT_ID_SCHEMA, documentId: COMPONENT_ID_SCHEMA }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async ({ targetComponentId, documentId }) => {
      if ((targetComponentId !== undefined && !boundedIdentifier(targetComponentId)) || (documentId !== undefined && !boundedIdentifier(documentId))) {
        return commandResult({ ok: false, error: { code: "INVALID_CODE_REQUEST", message: "Code target identifiers must be bounded non-empty strings.", retryable: false } });
      }
      return commandResult(await readCode(targetComponentId, documentId));
    },
  },
  {
    name: "code.export",
    description: "Create a machine-readable external code handoff manifest with file hashes and graph diagnostics. No compiler, uploader, network, or source execution is involved.",
    inputSchema: { type: "object", properties: { targetComponentId: COMPONENT_ID_SCHEMA, documentId: COMPONENT_ID_SCHEMA }, additionalProperties: false },
    execute: async ({ targetComponentId, documentId }) => {
      if ((targetComponentId !== undefined && !boundedIdentifier(targetComponentId)) || (documentId !== undefined && !boundedIdentifier(documentId))) {
        return commandResult({ ok: false, error: { code: "INVALID_CODE_REQUEST", message: "Code target identifiers must be bounded non-empty strings.", retryable: false } });
      }
      return commandResult(await exportCode(targetComponentId, documentId));
    },
  },
];

export function behaviorToolNames() {
  return behaviorToolDefinitions.map((tool) => tool.name);
}
