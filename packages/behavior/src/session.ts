import type { HardwareProject, ComponentInstance } from "@schematic/hardware-graph";
import { canonicalize, sha256 } from "./canonicalize";
import type {
  ActionOutcome,
  BehaviorDefinitionLookup,
  BehaviorDiagnostic,
  BehaviorDispatchRequest,
  BehaviorPreviewSession,
  BehaviorProfile,
  BehaviorRuleV1,
  BehaviorSessionLogEntry,
  BehaviorSnapshot,
  BehaviorTimelineEvent,
  ComponentActionRequestV1,
  ComponentEventRequest,
  DeterministicActionContext,
  InputChangeRequest,
  JsonValue,
  PreparedBehaviorPlan,
  ResolvedBehaviorCue,
  ResolvedBehaviorRule,
  ResolvedComponentAction,
  StateTransition,
} from "./contracts";
import { BEHAVIOR_LIMITS, cloneJsonValue, isJsonValue, measureJsonValue, validatePayload } from "./schemas";
import { defaultBehaviorRegistry, lookupDefinition, resolveProfile, type ResolvedProfile } from "./registry";
import { projectBehaviorFingerprint } from "./prepare";

interface HistoryEntry {
  request: BehaviorDispatchRequest;
  logicalTimeMs: number;
  order: number;
}

interface RuntimeScheduleItem {
  atMs: number;
  kind: "time-rule" | "cue" | "external";
  order: number;
  id: string;
  rule?: ResolvedBehaviorRule;
  cue?: ResolvedBehaviorCue;
  history?: HistoryEntry;
}

const INVALID_DISPATCH_REQUEST: ComponentActionRequestV1 = {
  componentId: "",
  definitionId: "",
  actionId: "invalid.request",
  payload: { kind: "literal", value: null },
};

function parseDispatchRequest(value: unknown): BehaviorDispatchRequest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value) || !isJsonValue(value, "dispatch")) return undefined;
  const record = value as Record<string, JsonValue>;
  if (!boundedDispatchIdentifier(record.componentId) || !boundedDispatchIdentifier(record.definitionId)) return undefined;
  const modes = ["eventId", "inputId", "actionId"].filter((key) => Object.prototype.hasOwnProperty.call(record, key));
  if (modes.length !== 1) return undefined;
  if (modes[0] === "eventId") {
    if (Object.keys(record).some((key) => !["componentId", "definitionId", "eventId", "payload"].includes(key)) || !boundedDispatchIdentifier(record.eventId) || !Object.prototype.hasOwnProperty.call(record, "payload")) return undefined;
    return cloneJsonValue(record as unknown as ComponentEventRequest as unknown as JsonValue) as unknown as ComponentEventRequest;
  }
  if (modes[0] === "inputId") {
    if (Object.keys(record).some((key) => !["componentId", "definitionId", "inputId", "value"].includes(key)) || !boundedDispatchIdentifier(record.inputId) || !Object.prototype.hasOwnProperty.call(record, "value")) return undefined;
    return cloneJsonValue(record as unknown as InputChangeRequest as unknown as JsonValue) as unknown as InputChangeRequest;
  }
  if (Object.keys(record).some((key) => !["componentId", "definitionId", "actionId", "payload"].includes(key)) || !boundedDispatchIdentifier(record.actionId) || !Object.prototype.hasOwnProperty.call(record, "payload")) return undefined;
  return cloneJsonValue(record as unknown as ComponentActionRequestV1 as unknown as JsonValue) as unknown as ComponentActionRequestV1;
}

function boundedDispatchIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= BEHAVIOR_LIMITS.maxPlanStringLength;
}

/**
 * Deterministic plan reducer. It deliberately knows nothing about source
 * files, React, timers, browser APIs, or hardware runtimes.
 */
export function createBehaviorPreviewSession(
  initialProject: HardwareProject,
  prepared: PreparedBehaviorPlan,
  definitions: BehaviorDefinitionLookup,
  registry = defaultBehaviorRegistry,
  options: {
    maxRetainedHistory?: number;
    maxRetainedHistoryBytes?: number;
    maxSessionLogBytes?: number;
    maxSessionLogLifetimeBytes?: number;
  } = {},
): BehaviorPreviewSession {
  if (projectBehaviorFingerprint(initialProject) !== prepared.projectSha256) throw new Error("STALE_PROJECT: Behavior Plan was prepared for a different project.");
  if (registry.hash !== prepared.registrySha256) throw new Error("STALE_REGISTRY: Behavior Plan was prepared for a different profile registry.");

  const components = new Map<string, ComponentInstance>();
  const profiles = new Map<string, ResolvedProfile>();
  for (const component of initialProject.components) {
    if (!components.has(component.id)) {
      components.set(component.id, component);
      const preparedBinding = prepared.componentProfiles[component.id];
      if (!preparedBinding) throw new Error(`STALE_DEFINITION_BINDING: Component ${component.id} had no prepared catalog binding.`);
      const current = resolveProfile(definitions, registry, component.definitionId);
      if (canonicalize(current.binding) !== canonicalize(preparedBinding)) throw new Error(`STALE_DEFINITION_BINDING: Catalog binding for ${component.definitionId} changed after preparation.`);
      profiles.set(component.id, {
        binding: preparedBinding,
        profile: registry.get(preparedBinding.profileId, preparedBinding.profileVersion),
        definitionKnown: current.definitionKnown,
      });
    }
  }

  let disposed = false;
  let logicalTimeMs = 0;
  let nextSequence = 0;
  let dispatchCount = 0;
  let historyOrder = 0;
  let state = new Map<string, unknown>();
  let inputs = new Map<string, JsonValue>();
  let sessionLog: BehaviorSessionLogEntry[] = [];
  let events: BehaviorTimelineEvent[] = [];
  let diagnostics: BehaviorDiagnostic[] = [];
  let history: HistoryEntry[] = [];
  let appliedScheduleIds = new Set<string>();
  const maxRetainedHistory = Number.isSafeInteger(options.maxRetainedHistory)
    ? Math.max(1, Math.min(options.maxRetainedHistory!, BEHAVIOR_LIMITS.maxDispatchedEvents))
    : BEHAVIOR_LIMITS.maxDispatchedEvents;
  const maxRetainedHistoryBytes = Number.isSafeInteger(options.maxRetainedHistoryBytes)
    ? Math.max(1, Math.min(options.maxRetainedHistoryBytes!, BEHAVIOR_LIMITS.maxRetainedHistoryBytes))
    : BEHAVIOR_LIMITS.maxRetainedHistoryBytes;
  const maxSessionLogLifetimeBytes = Number.isSafeInteger(options.maxSessionLogLifetimeBytes)
    ? Math.max(1, Math.min(options.maxSessionLogLifetimeBytes!, BEHAVIOR_LIMITS.maxSessionLogLifetimeBytes))
    : BEHAVIOR_LIMITS.maxSessionLogLifetimeBytes;
  const maxSessionLogBytes = Number.isSafeInteger(options.maxSessionLogBytes)
    ? Math.max(1, Math.min(options.maxSessionLogBytes!, BEHAVIOR_LIMITS.maxSessionLogBytes, maxSessionLogLifetimeBytes))
    : Math.min(BEHAVIOR_LIMITS.maxSessionLogBytes, maxSessionLogLifetimeBytes);
  // This counter is intentionally outside resetRuntime. Rewinding and reset
  // may discard replayable entries, but they must not mint a fresh lifetime
  // allocation budget for caller-controlled payloads.
  let retainedHistoryBytes = 0;
  let sessionLogBytes = 0;
  // Unlike the current snapshot log, this lifetime counter is not reset by a
  // rewind/reset. It prevents repeated rejected calls from buying fresh log
  // retention after the current runtime has been rebuilt.
  let sessionLogLifetimeBytes = 0;
  let sessionLogEntryBytes: number[] = [];

  const initialSnapshot = () => {
    resetRuntime();
    return buildSnapshot();
  };

  function ensureProject(currentProject: HardwareProject): BehaviorDiagnostic | undefined {
    if (disposed) return diagnostic("SESSION_DISPOSED", "This preview session is no longer active.");
    if (projectBehaviorFingerprint(currentProject) !== prepared.projectSha256) {
      disposed = true;
      const issue = diagnostic("STALE_PROJECT", "The project changed after this preview was prepared. Prepare the Behavior Plan again.");
      addDiagnostic(issue);
      return issue;
    }
    return undefined;
  }

  function resetRuntime() {
    logicalTimeMs = 0;
    nextSequence = 0;
    dispatchCount = 0;
    state = new Map();
    inputs = new Map();
    sessionLog = [];
    events = [];
    diagnostics = [];
    sessionLogBytes = 0;
    sessionLogEntryBytes = [];
    appliedScheduleIds = new Set();
    for (const component of [...components.values()].sort((left, right) => left.id.localeCompare(right.id))) {
      const resolved = profiles.get(component.id);
      state.set(component.id, resolved?.profile?.initialState(component) ?? null);
    }
    for (const rule of prepared.normalizedRules) {
      if (rule.enabled && rule.when.type === "preview.started") applyRule(rule, undefined, 0, true);
    }
    applyScheduledItems(0, 0);
  }

  function buildSnapshot(): BehaviorSnapshot {
    const projected: Record<string, ReturnType<BehaviorProfile["projectVisual"]>> = {};
    for (const component of [...components.values()].sort((left, right) => left.id.localeCompare(right.id))) {
      const resolved = profiles.get(component.id);
      const profile = resolved?.profile;
      let projection: ReturnType<BehaviorProfile["projectVisual"]>;
      try {
        projection = profile?.projectVisual(profile.parseState(state.get(component.id))) ?? { primitives: [], accessibleSummary: "Visual behavior controls are not mapped for this exact catalog part yet." };
      } catch {
        projection = { primitives: [], accessibleSummary: "The visual outcome could not be rendered for this component." };
      }
      Object.defineProperty(projected, component.id, { value: projection, enumerable: true, configurable: true, writable: true });
    }
    const sessionLogCopy = sessionLog.map((entry) => ({ ...entry, diagnosticCodes: [...entry.diagnosticCodes] }));
    const eventCopy = events.map((event) => ({ ...event }));
    const snapshotBase = {
      source: "behavior-preview" as const,
      execution: "typed-actions-only" as const,
      sourceCodeExecution: "none" as const,
      logicalTimeMs,
      sequence: nextSequence,
      components: projected,
      inputs: Object.fromEntries([...inputs.entries()].sort(([left], [right]) => left.localeCompare(right))),
      sessionLog: sessionLogCopy,
      sessionLogSha256: sha256(sessionLogCopy),
      events: eventCopy,
      diagnostics: diagnostics.map((issue) => ({ ...issue })),
      claims: {
        basis: "declared-behavior-plan" as const,
        componentActionsValidated: true,
        sourceCodeRead: false as const,
        sourceCodeExecuted: false as const,
        sourceCodeCompiled: false as const,
        hardwareUploaded: false as const,
        electricalBehaviorSimulated: false as const,
        physicalWiringVerified: false as const,
        physicalBehaviorVerified: false as const,
      },
    };
    const snapshot = { ...snapshotBase, snapshotSha256: sha256(snapshotBase) };
    return cloneFrozenSnapshot(snapshot) as BehaviorSnapshot;
  }

  function addDiagnostic(issue: BehaviorDiagnostic) {
    diagnostics.push(issue);
    if (diagnostics.length > 100) diagnostics = diagnostics.slice(-100);
  }

  function pushEvent(event: Omit<BehaviorTimelineEvent, "sequence">) {
    events.push({ sequence: nextSequence, ...event });
    nextSequence += 1;
    if (events.length > BEHAVIOR_LIMITS.maxTimelineItems) events = events.slice(-BEHAVIOR_LIMITS.maxTimelineItems);
  }

  function appendLog(
    request: BehaviorDispatchRequest,
    outcome: "accepted" | "rejected",
    issues: readonly BehaviorDiagnostic[],
  ) {
    const kind = "eventId" in request ? "component-event" : "inputId" in request ? "input-change" : "direct-action";
    const diagnosticCodes = issues.slice(0, 32).map((issue) => boundedLogString(issue.code));
    let entry: BehaviorSessionLogEntry = { sequence: nextSequence, logicalTimeMs, kind, request, outcome, diagnosticCodes };
    let entryBytes = measureJsonValue(entry)?.utf8Bytes ?? Number.POSITIVE_INFINITY;
    if (!Number.isFinite(entryBytes) || entryBytes > BEHAVIOR_LIMITS.maxSessionLogEntryBytes) {
      entry = {
        sequence: nextSequence,
        logicalTimeMs,
        kind,
        request: redactLogRequest(request),
        requestRedacted: true,
        outcome,
        diagnosticCodes: [...diagnosticCodes, "REQUEST_REDACTED"],
      };
      entryBytes = measureJsonValue(entry)?.utf8Bytes ?? Number.POSITIVE_INFINITY;
    }
    // Once the lifetime budget is exhausted, omit the entry entirely. The
    // caller still receives the bounded action outcome, but the runtime does
    // not retain attacker-controlled material just to explain the rejection.
    if (!Number.isFinite(entryBytes) || sessionLogLifetimeBytes > maxSessionLogLifetimeBytes - entryBytes) return;
    sessionLog.push(entry);
    sessionLogEntryBytes.push(entryBytes);
    sessionLogBytes += entryBytes;
    sessionLogLifetimeBytes += entryBytes;
    nextSequence += 1;
    while (sessionLog.length > BEHAVIOR_LIMITS.maxDispatchedEvents || sessionLogBytes > maxSessionLogBytes) {
      sessionLog.shift();
      sessionLogBytes -= sessionLogEntryBytes.shift() ?? 0;
    }
  }

  function beginOperation(): BehaviorDiagnostic | undefined {
    if (dispatchCount >= BEHAVIOR_LIMITS.maxDispatchedEvents) {
      const issue = diagnostic("EVENT_LIMIT_EXCEEDED", `A preview session may process at most ${BEHAVIOR_LIMITS.maxDispatchedEvents} dispatched events.`);
      addDiagnostic(issue);
      return issue;
    }
    dispatchCount += 1;
    return undefined;
  }

  function validateComponentReference(componentId: string, definitionId: string, kind: "action" | "event" | "input") {
    const issueList: BehaviorDiagnostic[] = [];
    const component = components.get(componentId);
    if (!component) {
      issueList.push(diagnostic("COMPONENT_NOT_FOUND", `${kind} references missing component ${componentId}.`, componentId));
      return { component: undefined, resolved: undefined, issues: issueList };
    }
    if (component.definitionId !== definitionId) issueList.push(diagnostic("DEFINITION_MISMATCH", `${kind} targets ${definitionId}, but ${componentId} is ${component.definitionId}.`, componentId));
    const resolved = profiles.get(componentId);
    return { component, resolved, issues: issueList };
  }

  function dispatch(currentProject: HardwareProject, request: BehaviorDispatchRequest): ActionOutcome {
    const parsedRequest = parseDispatchRequest(request);
    if (!parsedRequest) {
      const issue = diagnostic("INVALID_DISPATCH_REQUEST", "Provide exactly one bounded component event, input change, or component action request with exact string identifiers.");
      addDiagnostic(issue);
      return { status: "rejected", request: INVALID_DISPATCH_REQUEST, diagnostics: [issue], snapshot: buildSnapshot() };
    }
    // Keep the request immutable while it crosses into profile code. A
    // profile can be user-supplied in tests or a future extension, and a
    // reducer mutating its action/trigger must not rewrite replay history.
    const ownedRequest = cloneFrozenSnapshot(parsedRequest) as BehaviorDispatchRequest;
    const stale = ensureProject(currentProject);
    if (stale) {
      appendLog(ownedRequest, "rejected", [stale]);
      return { status: "rejected", request: ownedRequest, diagnostics: [stale], snapshot: buildSnapshot() };
    }
    // Rebuilds reset the replay operation counter but deliberately retain the
    // external history needed for deterministic forward playback. Enforce a
    // separate lifetime cap so rewind/dispatch cycles cannot grow retained
    // request payloads without bound.
    if (history.length >= maxRetainedHistory) {
      const historyLimit = diagnostic("EVENT_LIMIT_EXCEEDED", `A preview session may retain at most ${maxRetainedHistory} external dispatches.`);
      addDiagnostic(historyLimit);
      appendLog(ownedRequest, "rejected", [historyLimit]);
      return { status: "rejected", request: cloneJsonValue(ownedRequest as unknown as JsonValue) as unknown as BehaviorDispatchRequest, diagnostics: [historyLimit], snapshot: buildSnapshot() };
    }
    const requestSize = measureJsonValue(ownedRequest);
    const requestBytes = requestSize?.utf8Bytes ?? Number.POSITIVE_INFINITY;
    if (!Number.isFinite(requestBytes) || retainedHistoryBytes > maxRetainedHistoryBytes - requestBytes) {
      const historySizeLimit = diagnostic("HISTORY_SIZE_LIMIT_EXCEEDED", `Retained external dispatch history is limited to ${maxRetainedHistoryBytes} UTF-8 bytes over the session lifetime.`);
      addDiagnostic(historySizeLimit);
      appendLog(ownedRequest, "rejected", [historySizeLimit]);
      return { status: "rejected", request: cloneJsonValue(ownedRequest as unknown as JsonValue) as unknown as BehaviorDispatchRequest, diagnostics: [historySizeLimit], snapshot: buildSnapshot() };
    }
    const operationLimit = beginOperation();
    if (operationLimit) {
      appendLog(ownedRequest, "rejected", [operationLimit]);
      return { status: "rejected", request: cloneJsonValue(ownedRequest as unknown as JsonValue) as unknown as BehaviorDispatchRequest, diagnostics: [operationLimit], snapshot: buildSnapshot() };
    }
    const order = historyOrder++;
    const historyEntry: HistoryEntry = { request: ownedRequest, logicalTimeMs, order };
    history.push(historyEntry);
    retainedHistoryBytes += requestBytes;
    const result = dispatchInternal(ownedRequest, 0);
    appendLog(ownedRequest, result.status, result.issues);
    return { status: result.status, request: cloneJsonValue(ownedRequest as unknown as JsonValue) as unknown as BehaviorDispatchRequest, diagnostics: result.issues, snapshot: buildSnapshot() };
  }

  function dispatchInternal(request: BehaviorDispatchRequest, depth: number): { status: "accepted" | "rejected"; issues: BehaviorDiagnostic[] } {
    if (depth > BEHAVIOR_LIMITS.maxEventChainDepth) return { status: "rejected", issues: [diagnostic("EVENT_CHAIN_LIMIT_EXCEEDED", `Event chain exceeded depth ${BEHAVIOR_LIMITS.maxEventChainDepth}.`)] };
    if ("eventId" in request) return dispatchEvent(request, depth);
    if ("inputId" in request) return dispatchInput(request, depth);
    return dispatchDirectAction(request);
  }

  function dispatchEvent(request: ComponentEventRequest, depth: number): { status: "accepted" | "rejected"; issues: BehaviorDiagnostic[] } {
    const issues = validateComponentReference(request.componentId, request.definitionId, "event").issues;
    if (!isJsonValue(request.payload)) issues.push(diagnostic("NON_JSON_VALUE", "Event payload must contain JSON data only.", request.componentId));
    const resolved = profiles.get(request.componentId);
    const descriptor = resolved?.profile?.manifest.events.find((candidate) => candidate.id === request.eventId);
    if (!descriptor) issues.push(diagnostic("EVENT_NOT_DECLARED", `Event ${request.eventId} is not declared by the selected component profile.`, request.componentId));
    else issues.push(...validatePayload(descriptor.payloadSchema, request.payload, "event.payload", "dispatch").diagnostics);
    if (issues.length) {
      pushEvent({ logicalTimeMs, kind: "component-event", componentId: request.componentId, eventId: request.eventId, outcome: "rejected" });
      issues.forEach(addDiagnostic);
      return { status: "rejected", issues };
    }
    pushEvent({ logicalTimeMs, kind: "component-event", componentId: request.componentId, eventId: request.eventId, outcome: "accepted" });
    const matching = prepared.normalizedRules.filter((rule) => rule.enabled && rule.when.type === "component.event" && rule.when.componentId === request.componentId && rule.when.definitionId === request.definitionId && rule.when.eventId === request.eventId && (rule.when.payload === undefined || jsonEqual(rule.when.payload, request.payload)));
    const actionIssues: BehaviorDiagnostic[] = [];
    for (const rule of matching) actionIssues.push(...applyRule(rule, request, depth + 1, true));
    return { status: actionIssues.some((issue) => issue.severity === "error") ? "rejected" : "accepted", issues: actionIssues };
  }

  function dispatchInput(request: InputChangeRequest, depth: number): { status: "accepted" | "rejected"; issues: BehaviorDiagnostic[] } {
    const issues = validateComponentReference(request.componentId, request.definitionId, "input").issues;
    if (!request.inputId.trim()) issues.push(diagnostic("INVALID_INPUT_ID", "Input id must be non-empty.", request.componentId));
    if (!isJsonValue(request.value)) issues.push(diagnostic("NON_JSON_VALUE", "Input value must contain JSON data only.", request.componentId));
    if (issues.length) {
      pushEvent({ logicalTimeMs, kind: "input-change", componentId: request.componentId, outcome: "rejected" });
      issues.forEach(addDiagnostic);
      return { status: "rejected", issues };
    }
    inputs.set(`${request.componentId}:${request.inputId}`, request.value);
    pushEvent({ logicalTimeMs, kind: "input-change", componentId: request.componentId, outcome: "accepted" });
    const matching = prepared.normalizedRules.filter((rule) => rule.enabled && rule.when.type === "input.changed" && rule.when.componentId === request.componentId && rule.when.definitionId === request.definitionId && rule.when.inputId === request.inputId);
    const actionIssues: BehaviorDiagnostic[] = [];
    for (const rule of matching) actionIssues.push(...applyRule(rule, request, depth + 1, true));
    return { status: actionIssues.some((issue) => issue.severity === "error") ? "rejected" : "accepted", issues: actionIssues };
  }

  function dispatchDirectAction(request: ComponentActionRequestV1): { status: "accepted" | "rejected"; issues: BehaviorDiagnostic[] } {
    // The outer dispatch owns the caller-visible session-log entry. Actions
    // emitted by rules/cues are recorded by applyRule/applyScheduledItems.
    const result = applyAction(request, undefined, 0, false);
    const issues = [...result.issues, ...dispatchEmittedEvents(result.emittedEvents, 1)];
    return { status: result.accepted && !issues.some((issue) => issue.severity === "error") ? "accepted" : "rejected", issues };
  }

  function dispatchEmittedEvents(emittedEvents: unknown, depth: number): BehaviorDiagnostic[] {
    const issues: BehaviorDiagnostic[] = [];
    if (emittedEvents === undefined) return issues;
    if (!Array.isArray(emittedEvents)) {
      const issue = diagnostic("INVALID_EMITTED_EVENT", "A behavior profile emitted events in an invalid shape; expected an array of component event requests.");
      addDiagnostic(issue);
      return [issue];
    }
    for (const candidate of emittedEvents) {
      // Emissions cross the same ownership boundary as external dispatches.
      // Parse and clone them before dispatching so a profile cannot smuggle an
      // action/input request, mutate the runtime request, or crash the session
      // by returning an arbitrary object.
      const parsed = parseDispatchRequest(candidate);
      if (!parsed || !("eventId" in parsed)) {
        const issue = diagnostic("INVALID_EMITTED_EVENT", "A behavior profile emitted an invalid component event request.");
        addDiagnostic(issue);
        issues.push(issue);
        continue;
      }
      const emitted = cloneFrozenSnapshot(parsed) as BehaviorDispatchRequest;
      if (dispatchCount >= BEHAVIOR_LIMITS.maxDispatchedEvents) {
        const limitIssue = diagnostic("EVENT_LIMIT_EXCEEDED", `A preview session may process at most ${BEHAVIOR_LIMITS.maxDispatchedEvents} dispatched events.`);
        addDiagnostic(limitIssue);
        issues.push(limitIssue);
        break;
      }
      dispatchCount += 1;
      const eventResult = dispatchInternal(emitted, depth);
      issues.push(...eventResult.issues);
    }
    return issues;
  }

  function applyRule(rule: ResolvedBehaviorRule, trigger: ComponentEventRequest | InputChangeRequest | undefined, depth: number, record: boolean): BehaviorDiagnostic[] {
    if (depth > BEHAVIOR_LIMITS.maxEventChainDepth) {
      const issue = diagnostic("EVENT_CHAIN_LIMIT_EXCEEDED", `Event chain exceeded depth ${BEHAVIOR_LIMITS.maxEventChainDepth}.`, rule.id);
      addDiagnostic(issue);
      return [issue];
    }
    const issues: BehaviorDiagnostic[] = [];
    for (const action of rule.then) {
      const result = applyAction(action, trigger, depth, record);
      issues.push(...result.issues);
      issues.push(...dispatchEmittedEvents(result.emittedEvents, depth + 1));
    }
    return issues;
  }

  function applyAction(
    request: ComponentActionRequestV1,
    trigger: ComponentEventRequest | InputChangeRequest | undefined,
    depth: number,
    record: boolean,
  ): { accepted: boolean; issues: BehaviorDiagnostic[]; emittedEvents: unknown } {
    const reference = validateComponentReference(request.componentId, request.definitionId, "action");
    const issues = [...reference.issues];
    const resolved = reference.resolved;
    const descriptor = resolved?.profile?.manifest.actions.find((candidate) => candidate.id === request.actionId);
    if (!resolved?.profile) issues.push(diagnostic("PROFILE_NOT_INSTALLED", "The selected component behavior profile is not installed.", request.componentId));
    else if (!descriptor) issues.push(diagnostic("ACTION_NOT_DECLARED", `Action ${request.actionId} is not declared by the selected component profile.`, request.componentId));
    const payloadResult = resolveActionPayload(request, trigger, descriptor);
    issues.push(...payloadResult.issues);
    if (issues.length || !reference.component || !resolved?.profile || !descriptor || payloadResult.value === undefined) {
      pushEvent({ logicalTimeMs, kind: "action", componentId: request.componentId, actionId: request.actionId, outcome: "rejected" });
      issues.forEach(addDiagnostic);
      if (record) appendLog(request, "rejected", issues);
      return { accepted: false, issues, emittedEvents: [] };
    }
    const action: ResolvedComponentAction = { componentId: request.componentId, definitionId: request.definitionId, profileId: resolved.binding.profileId, profileVersion: resolved.binding.profileVersion, actionId: request.actionId, payload: payloadResult.value };
    const context: DeterministicActionContext = { componentId: request.componentId, definitionId: request.definitionId, logicalTimeMs, sequence: nextSequence, ...(trigger ? { trigger } : {}) };
    let transitions: readonly StateTransition<unknown>[] = [];
    try {
      const reduced = resolved.profile.reduce(resolved.profile.parseState(state.get(request.componentId)), action, context);
      if (!Array.isArray(reduced)) issues.push(diagnostic("INVALID_PROFILE_TRANSITION", "Behavior profile returned transitions in an invalid shape.", request.componentId));
      else transitions = reduced as readonly StateTransition<unknown>[];
    } catch {
      issues.push(diagnostic("PROFILE_REDUCER_ERROR", `Profile reducer failed for action ${request.actionId}.`, request.componentId));
    }
    const firstTransition = transitions[0];
    if (issues.length || transitions.length === 0 || !firstTransition || typeof firstTransition !== "object" || !Object.prototype.hasOwnProperty.call(firstTransition, "state")) {
      if (!issues.length) issues.push(diagnostic("ACTION_REJECTED", `Action ${request.actionId} was rejected by the profile reducer.`, request.componentId));
      pushEvent({ logicalTimeMs, kind: "action", componentId: request.componentId, actionId: request.actionId, outcome: "rejected" });
      issues.forEach(addDiagnostic);
      if (record) appendLog(request, "rejected", issues);
      return { accepted: false, issues, emittedEvents: [] };
    }
    state.set(request.componentId, firstTransition.state);
    pushEvent({ logicalTimeMs, kind: "action", componentId: request.componentId, actionId: request.actionId, outcome: "accepted" });
    if (record) appendLog(request, "accepted", []);
    return { accepted: true, issues: [], emittedEvents: firstTransition.emittedEvents };
  }

  function resolveActionPayload(
    request: ComponentActionRequestV1,
    trigger: ComponentEventRequest | InputChangeRequest | undefined,
    descriptor: { payloadSchema: { schemaId: string; dialect: "https://json-schema.org/draft/2020-12/schema"; schema: JsonValue } } | undefined,
  ): { value?: JsonValue; issues: BehaviorDiagnostic[] } {
    const issues: BehaviorDiagnostic[] = [];
    if (!request.payload || typeof request.payload !== "object" || Array.isArray(request.payload) || (request.payload.kind !== "literal" && request.payload.kind !== "trigger-payload")) {
      return { issues: [diagnostic("INVALID_ACTION_PAYLOAD", "Action payload must be a literal or a bounded trigger-payload reference.", request.componentId)] };
    }
    let value: JsonValue | undefined;
    if (request.payload.kind === "literal") {
      if (!isJsonValue(request.payload.value)) issues.push(diagnostic("NON_JSON_VALUE", "Literal action payload must contain JSON data only.", request.componentId));
      else value = request.payload.value;
    } else {
      if (!trigger) issues.push(diagnostic("TRIGGER_PAYLOAD_CONTEXT", "trigger-payload requires a component event or input change trigger.", request.componentId));
      else {
        const triggerPayload: JsonValue = "eventId" in trigger ? trigger.payload : { value: trigger.value };
        const selected = request.payload.select === "$" ? triggerPayload : selectValue(triggerPayload);
        value = selected === undefined ? request.payload.fallback : selected;
        if (value === undefined) issues.push(diagnostic("TRIGGER_PAYLOAD_MISSING", "The trigger payload does not contain the requested value and no fallback was provided.", request.componentId));
      }
      if (request.payload.select !== "$" && request.payload.select !== "$.value") issues.push(diagnostic("INVALID_TRIGGER_PAYLOAD_SELECTOR", "Only $ and $.value selectors are supported.", request.componentId));
    }
    if (value !== undefined && descriptor) issues.push(...validatePayload(descriptor.payloadSchema, value, "action.payload", "dispatch").diagnostics);
    return { value, issues };
  }

  function selectValue(value: JsonValue): JsonValue | undefined {
    if (typeof value !== "object" || value === null || Array.isArray(value) || !Object.prototype.hasOwnProperty.call(value, "value")) return undefined;
    return (value as { readonly [key: string]: JsonValue }).value;
  }

  function scheduleItems(): RuntimeScheduleItem[] {
    const timedRules = prepared.normalizedRules.filter((rule) => rule.enabled && rule.when.type === "time.elapsed").map((rule) => {
      const trigger = rule.when;
      if (trigger.type !== "time.elapsed") throw new Error("Unreachable trigger variant.");
      return { atMs: trigger.afterMs, kind: "time-rule" as const, order: 0, id: `rule:${rule.id}`, rule };
    });
    const cues = prepared.normalizedCues.map((cue) => ({ atMs: cue.atMs, kind: "cue" as const, order: cue.order, id: `cue:${cue.id}`, cue }));
    return [...timedRules, ...cues].sort((left, right) => left.atMs - right.atMs || scheduleKindOrder(left.kind) - scheduleKindOrder(right.kind) || left.order - right.order || left.id.localeCompare(right.id));
  }

  function scheduleKindOrder(kind: RuntimeScheduleItem["kind"]) {
    return kind === "time-rule" ? 0 : kind === "cue" ? 1 : 2;
  }

  function applyScheduledItems(fromMs: number, toMs: number) {
    for (const item of scheduleItems()) {
      if (item.atMs < fromMs || item.atMs > toMs || appliedScheduleIds.has(item.id)) continue;
      logicalTimeMs = item.atMs;
      if (item.rule) applyRule(item.rule, undefined, 0, true);
      if (item.cue) {
        const result = applyAction(item.cue.action, undefined, 0, true);
        dispatchEmittedEvents(result.emittedEvents, 1);
      }
      appliedScheduleIds.add(item.id);
    }
    logicalTimeMs = toMs;
  }

  /**
   * Advance an already-materialized runtime through the deterministic
   * timeline. External dispatches are part of that timeline too: after a
   * rewind, they must be replayed before later schedules can run. Only
   * history entries strictly after the current time are replayed here because
   * the current runtime already contains all effects at `fromMs`.
   */
  function applyForwardTimeline(fromMs: number, toMs: number) {
    const timeline: RuntimeScheduleItem[] = [
      ...scheduleItems(),
      ...history
        .filter((entry) => entry.logicalTimeMs > fromMs && entry.logicalTimeMs <= toMs)
        .map((entry) => ({ atMs: entry.logicalTimeMs, kind: "external" as const, order: entry.order, id: `external:${entry.order}`, history: entry })),
    ].sort((left, right) => left.atMs - right.atMs || scheduleKindOrder(left.kind) - scheduleKindOrder(right.kind) || left.order - right.order || left.id.localeCompare(right.id));

    for (const item of timeline) {
      if (item.atMs < fromMs || item.atMs > toMs) continue;
      logicalTimeMs = item.atMs;
      if (item.rule) {
        if (appliedScheduleIds.has(item.id)) continue;
        applyRule(item.rule, undefined, 0, true);
        appliedScheduleIds.add(item.id);
      } else if (item.cue) {
        if (appliedScheduleIds.has(item.id)) continue;
        const result = applyAction(item.cue.action, undefined, 0, true);
        dispatchEmittedEvents(result.emittedEvents, 1);
        appliedScheduleIds.add(item.id);
      } else if (item.history) {
        const operationLimit = beginOperation();
        if (operationLimit) appendLog(item.history.request, "rejected", [operationLimit]);
        else {
          const result = dispatchInternal(item.history.request, 0);
          appendLog(item.history.request, result.status, result.issues);
        }
      }
    }
    logicalTimeMs = toMs;
  }

  function seek(currentProject: HardwareProject, timeMs: number): BehaviorSnapshot {
    const stale = ensureProject(currentProject);
    if (stale) return buildSnapshot();
    if (!Number.isSafeInteger(timeMs) || timeMs < 0 || timeMs > BEHAVIOR_LIMITS.maxDurationMs) {
      const issue = diagnostic("INVALID_TIME", `Preview time must be a non-negative integer no greater than ${BEHAVIOR_LIMITS.maxDurationMs}ms.`);
      addDiagnostic(issue);
      return buildSnapshot();
    }
    if (timeMs < logicalTimeMs) {
      rebuildTo(timeMs);
      return buildSnapshot();
    }
    applyForwardTimeline(logicalTimeMs, timeMs);
    return buildSnapshot();
  }

  function rebuildTo(timeMs: number) {
    const replayHistory = history.filter((entry) => entry.logicalTimeMs <= timeMs).sort((left, right) => left.logicalTimeMs - right.logicalTimeMs || left.order - right.order);
    resetRuntime();
    const schedule = scheduleItems().map((item) => ({ ...item }));
    const timeline: RuntimeScheduleItem[] = [
      ...schedule,
      ...replayHistory.map((entry) => ({ atMs: entry.logicalTimeMs, kind: "external" as const, order: entry.order, id: `external:${entry.order}`, history: entry })),
    ].sort((left, right) => left.atMs - right.atMs || scheduleKindOrder(left.kind) - scheduleKindOrder(right.kind) || left.order - right.order || left.id.localeCompare(right.id));
    // resetRuntime already materializes preview.started and zero-time schedule
    // items. Preserve those IDs so rewinding cannot apply an atMs=0 rule/cue
    // twice before replaying the rest of the deterministic timeline.
    for (const item of timeline) {
      if (item.atMs > timeMs) break;
      logicalTimeMs = item.atMs;
      if (item.rule) {
        if (appliedScheduleIds.has(item.id)) continue;
        applyRule(item.rule, undefined, 0, true);
        appliedScheduleIds.add(item.id);
      } else if (item.cue) {
        if (appliedScheduleIds.has(item.id)) continue;
        const result = applyAction(item.cue.action, undefined, 0, true);
        dispatchEmittedEvents(result.emittedEvents, 1);
        appliedScheduleIds.add(item.id);
      }
      else if (item.history) {
        const operationLimit = beginOperation();
        if (operationLimit) appendLog(item.history.request, "rejected", [operationLimit]);
        else {
          const result = dispatchInternal(item.history.request, 0);
          appendLog(item.history.request, result.status, result.issues);
        }
      }
    }
    logicalTimeMs = timeMs;
  }

  function reset(currentProject: HardwareProject): BehaviorSnapshot {
    const stale = ensureProject(currentProject);
    if (stale) return buildSnapshot();
    history = [];
    historyOrder = 0;
    resetRuntime();
    return buildSnapshot();
  }

  function dispose() {
    disposed = true;
  }

  // Materialize the deterministic initial snapshot before returning. This
  // also ensures a session never relies on a first animation frame to decide
  // component state.
  initialSnapshot();

  return { dispatch, seek, reset, snapshot: buildSnapshot, dispose };
}

function jsonEqual(left: JsonValue, right: JsonValue): boolean {
  return canonicalize(left) === canonicalize(right);
}

function diagnostic(code: string, message: string, componentId?: string): BehaviorDiagnostic {
  return { code, severity: "error", message, ...(componentId ? { componentId } : {}) };
}

const MAX_LOG_IDENTIFIER_LENGTH = 256;

function boundedLogString(value: unknown): string {
  if (typeof value !== "string") return "";
  if (value.length <= MAX_LOG_IDENTIFIER_LENGTH) return value;
  return `${value.slice(0, MAX_LOG_IDENTIFIER_LENGTH - 3)}...`;
}

/** Preserve the request kind and identifiers for diagnostics, but never retain
 * a caller-sized payload in a log entry. */
function redactLogRequest(request: BehaviorDispatchRequest): BehaviorDispatchRequest {
  const componentId = boundedLogString(request.componentId);
  const definitionId = boundedLogString(request.definitionId);
  if ("eventId" in request) {
    return { componentId, definitionId, eventId: boundedLogString(request.eventId) as ComponentEventRequest["eventId"], payload: null };
  }
  if ("inputId" in request) {
    return { componentId, definitionId, inputId: boundedLogString(request.inputId), value: null };
  }
  return {
    componentId,
    definitionId,
    actionId: boundedLogString(request.actionId) as ComponentActionRequestV1["actionId"],
    payload: { kind: "literal", value: null },
  };
}

function cloneFrozenSnapshot<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map((item) => cloneFrozenSnapshot(item))) as T;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    Object.defineProperty(result, key, { value: cloneFrozenSnapshot(item), enumerable: true, configurable: false, writable: false });
  }
  return Object.freeze(result) as T;
}
