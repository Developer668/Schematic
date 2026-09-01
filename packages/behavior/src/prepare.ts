import type { ComponentInstance, HardwareProject } from "@schematic/hardware-graph";
import { canonicalize, sha256 } from "./canonicalize";
import type {
  BehaviorDefinitionLookup,
  BehaviorDiagnostic,
  BehaviorSystem,
  BehaviorSystemOptions,
  BehaviorTriggerV1,
  ComponentActionRequestV1,
  ComponentBehaviorCapabilityReport,
  PlanPreparation,
  PreparedBehaviorPlan,
  ProjectBehaviorReport,
  RejectedBehaviorItem,
  ResolvedBehaviorCue,
  ResolvedBehaviorRule,
} from "./contracts";
import { parseBehaviorPlan, validatePayload, BEHAVIOR_LIMITS } from "./schemas";
import { capabilitiesForComponent, createBehaviorRegistry, defaultBehaviorRegistry, lookupDefinition, resolveProfile, type ResolvedProfile } from "./registry";
import { createBehaviorPreviewSession } from "./session";

/** Clone and recursively freeze the bounded JSON-like records that cross the
 * preparation boundary. A caller must never be able to change execution while
 * retaining the same plan hash. */
function cloneFrozen<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map((item) => cloneFrozen(item))) as T;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    Object.defineProperty(result, key, { value: cloneFrozen(item), enumerable: true, configurable: false, writable: false });
  }
  return Object.freeze(result) as T;
}

/** Hash only behavior-relevant project data. Source files and timestamps are
 * deliberately excluded so editing code never changes preview state. */
export function projectBehaviorFingerprint(project: HardwareProject): string {
  const components = project.components
    .map((component) => ({
      id: component.id,
      definitionId: component.definitionId,
      properties: component.properties,
      ...(component.firmwareGroupId ? { firmwareGroupId: component.firmwareGroupId } : {}),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const connections = project.connections
    .map((connection) => ({ source: connection.source, target: connection.target, domain: connection.domain }))
    .sort((left, right) => canonicalize(left).localeCompare(canonicalize(right)));
  return sha256({
    id: project.id,
    version: project.version,
    components,
    connections,
  });
}

function definitionLookupValue(lookup: BehaviorDefinitionLookup, definitionId: string) {
  return lookupDefinition(lookup, definitionId);
}

export function createBehaviorSystem(options: BehaviorSystemOptions): BehaviorSystem {
  const registry = options.registry ?? defaultBehaviorRegistry;
  return {
    inspect(project) {
      return inspectProject(project, options.definitions, registry);
    },
    async prepare(project, rawPlan, policy = { onUnsupported: "block" }) {
      return prepareBehaviorPlan(project, rawPlan, options.definitions, registry, policy);
    },
    open(project, prepared) {
      return createBehaviorPreviewSession(project, prepared, options.definitions, registry);
    },
  };
}

/** Convenience constructor for callers using the frontend's exact catalog
 * adapter but no custom checked-in profiles. */
export function createDefaultBehaviorSystem(definitions: BehaviorDefinitionLookup): BehaviorSystem {
  return createBehaviorSystem({ definitions });
}

export function inspectProject(
  project: HardwareProject,
  definitions: BehaviorDefinitionLookup,
  registry = defaultBehaviorRegistry,
): ProjectBehaviorReport {
  const diagnostics: BehaviorDiagnostic[] = [];
  const seen = new Set<string>();
  const components: ComponentBehaviorCapabilityReport[] = [];
  for (const component of [...project.components].sort((left, right) => left.id.localeCompare(right.id))) {
    if (seen.has(component.id)) diagnostics.push({ code: "DUPLICATE_COMPONENT_ID", severity: "error", message: `Component id ${component.id} is duplicated.`, componentId: component.id });
    seen.add(component.id);
    if (!definitionLookupValue(definitions, component.definitionId)) diagnostics.push({ code: "UNKNOWN_COMPONENT_DEFINITION", severity: "error", message: `Component ${component.id} references unknown definition ${component.definitionId}.`, componentId: component.id, definitionId: component.definitionId });
    const capability = capabilitiesForComponent(component, definitions, registry);
    components.push(capability);
    const resolved = resolveProfile(definitions, registry, component.definitionId);
    if (definitionLookupValue(definitions, component.definitionId) && !resolved.profile) diagnostics.push({ code: "PROFILE_NOT_INSTALLED", severity: "error", message: `Behavior profile ${resolved.binding.profileId}:v${resolved.binding.profileVersion} is not installed for ${component.definitionId}.`, componentId: component.id, definitionId: component.definitionId });
  }
  return { projectSha256: projectBehaviorFingerprint(project), registrySha256: registry.hash, components, diagnostics };
}

export function prepareBehaviorPlan(
  project: HardwareProject,
  rawPlan: unknown,
  definitions: BehaviorDefinitionLookup,
  registry = defaultBehaviorRegistry,
  policy: { onUnsupported: "block" | "skip" } = { onUnsupported: "block" },
): PlanPreparation {
  const parsed = parseBehaviorPlan(rawPlan);
  if (!parsed.plan) return { status: "blocked", rejected: [{ kind: "plan", diagnostics: parsed.diagnostics }], diagnostics: parsed.diagnostics };
  const plan = parsed.plan;
  const diagnostics: BehaviorDiagnostic[] = [...parsed.diagnostics];
  const rejected: RejectedBehaviorItem[] = [];
  const projectSha256 = projectBehaviorFingerprint(project);
  if (plan.projectId !== project.id) diagnostics.push(error("PLAN_PROJECT_MISMATCH", `Plan ${plan.id} belongs to project ${plan.projectId}, not ${project.id}.`, "$.projectId"));

  // Preparation is a public package boundary and must not assume that a
  // frontend graph validator already ran. Ambiguous instance IDs and unknown
  // catalog identities make exact profile resolution impossible even when the
  // malformed component is not referenced by a rule.
  diagnostics.push(...inspectProject(project, definitions, registry).diagnostics.filter((item) =>
    item.code === "DUPLICATE_COMPONENT_ID" || item.code === "UNKNOWN_COMPONENT_DEFINITION",
  ));

  const componentById = new Map<string, ComponentInstance>();
  for (const component of project.components) if (!componentById.has(component.id)) componentById.set(component.id, component);
  const componentProfiles: Record<string, ResolvedProfile["binding"]> = {};
  for (const component of componentById.values()) defineOwn(componentProfiles, component.id, resolveProfile(definitions, registry, component.definitionId).binding);
  const profileVersions: Record<string, number> = {};
  const normalizedRules: ResolvedBehaviorRule[] = [];
  for (const rule of plan.rules) {
    const triggerResult = validateTrigger(rule.when, componentById, definitions, registry, profileVersions);
    if (triggerResult.diagnostics.length) {
      const handled = handleUnsupported(policy, triggerResult.diagnostics);
      diagnostics.push(...handled.diagnostics);
      rejected.push({ kind: "rule", id: rule.id, diagnostics: triggerResult.diagnostics });
      // An invalid trigger can never be safely replayed. Explicit skip mode
      // records the rule as rejected but does not retain it in the plan.
      continue;
    }
    const acceptedActions: ComponentActionRequestV1[] = [];
    for (const action of rule.then) {
      const actionResult = validateAction(action, rule.when, componentById, definitions, registry, profileVersions);
      if (actionResult.diagnostics.length) {
        const handled = handleUnsupported(policy, actionResult.diagnostics);
        diagnostics.push(...handled.diagnostics);
        rejected.push({ kind: "action", id: `${rule.id}:${action.componentId}:${action.actionId}`, request: action, diagnostics: actionResult.diagnostics });
        if (handled.block) continue;
      } else acceptedActions.push(action);
    }
    if (!triggerResult.diagnostics.length || policy.onUnsupported === "skip") normalizedRules.push({ id: rule.id, enabled: rule.enabled, when: rule.when, then: acceptedActions });
  }

  const normalizedCues: ResolvedBehaviorCue[] = [];
  for (const cue of plan.cues ?? []) {
    const actionResult = validateAction(cue.action, { type: "time.elapsed", afterMs: cue.atMs }, componentById, definitions, registry, profileVersions, false);
    if (actionResult.diagnostics.length) {
      const handled = handleUnsupported(policy, actionResult.diagnostics);
      diagnostics.push(...handled.diagnostics);
      rejected.push({ kind: "cue", id: cue.id, request: cue.action, diagnostics: actionResult.diagnostics });
      if (handled.block) continue;
    } else normalizedCues.push({ id: cue.id, atMs: cue.atMs, order: cue.order, action: cue.action });
  }

  const hasProjectError = diagnostics.some((item) => item.severity === "error" && ["PLAN_PROJECT_MISMATCH", "DUPLICATE_COMPONENT_ID", "UNKNOWN_COMPONENT_DEFINITION"].includes(item.code));
  const hasBlockedSemanticError = policy.onUnsupported === "block" && rejected.length > 0;
  if (hasProjectError || hasBlockedSemanticError) return { status: "blocked", rejected, diagnostics };
  const immutablePlan = cloneFrozen(plan);
  const prepared: PreparedBehaviorPlan = Object.freeze({
    schemaVersion: 1,
    plan: immutablePlan,
    planSha256: sha256(immutablePlan),
    projectSha256,
    registrySha256: registry.hash,
    profileVersions: Object.freeze({ ...profileVersions }),
    componentProfiles: cloneFrozen(componentProfiles),
    normalizedRules: cloneFrozen(normalizedRules),
    normalizedCues: cloneFrozen([...normalizedCues].sort((left, right) => left.atMs - right.atMs || left.order - right.order || left.id.localeCompare(right.id))),
  });
  if (rejected.length) return { status: "partial", prepared, rejected, diagnostics };
  return { status: "ready", prepared, diagnostics };
}

interface ValidationResult {
  diagnostics: BehaviorDiagnostic[];
}

function validateTrigger(
  trigger: BehaviorTriggerV1,
  components: ReadonlyMap<string, ComponentInstance>,
  definitions: BehaviorDefinitionLookup,
  registry: ReturnType<typeof createBehaviorRegistry>,
  profileVersions: Record<string, number>,
): ValidationResult {
  const diagnostics: BehaviorDiagnostic[] = [];
  if (trigger.type === "preview.started") return { diagnostics };
  if (trigger.type === "time.elapsed") {
    if (!Number.isSafeInteger(trigger.afterMs) || trigger.afterMs < 0 || trigger.afterMs > BEHAVIOR_LIMITS.maxDurationMs) diagnostics.push(error("INVALID_TIME", `Trigger time must be between 0 and ${BEHAVIOR_LIMITS.maxDurationMs}ms.`, "trigger.afterMs"));
    return { diagnostics };
  }
  const component = components.get(trigger.componentId);
  if (!component) { diagnostics.push(error("COMPONENT_NOT_FOUND", `Trigger references missing component ${trigger.componentId}.`, "trigger.componentId", trigger.componentId)); return { diagnostics }; }
  if (component.definitionId !== trigger.definitionId) diagnostics.push(error("DEFINITION_MISMATCH", `Trigger targets ${trigger.definitionId}, but ${component.id} is ${component.definitionId}.`, "trigger.definitionId", component.id));
  const resolved = resolveProfile(definitions, registry, component.definitionId);
  rememberProfile(profileVersions, resolved);
  if (!resolved.profile) diagnostics.push(error("PROFILE_NOT_INSTALLED", `Behavior profile ${resolved.binding.profileId}:v${resolved.binding.profileVersion} is not installed.`, "trigger.profile", component.id));
  if (trigger.type === "component.event") {
    const descriptor = resolved.profile?.manifest.events.find((candidate) => candidate.id === trigger.eventId);
    if (!descriptor) diagnostics.push(error("EVENT_NOT_DECLARED", `Event ${trigger.eventId} is not declared by ${resolved.binding.profileId}:v${resolved.binding.profileVersion}.`, "trigger.eventId", component.id));
    if (descriptor && trigger.payload !== undefined) diagnostics.push(...validatePayload(descriptor.payloadSchema, trigger.payload, "trigger.payload", "plan").diagnostics);
  }
  if (trigger.type === "input.changed" && !trigger.inputId.trim()) diagnostics.push(error("INVALID_INPUT_ID", "Input id must be non-empty.", "trigger.inputId", component.id));
  return { diagnostics };
}

function validateAction(
  action: ComponentActionRequestV1,
  trigger: BehaviorTriggerV1,
  components: ReadonlyMap<string, ComponentInstance>,
  definitions: BehaviorDefinitionLookup,
  registry: ReturnType<typeof createBehaviorRegistry>,
  profileVersions: Record<string, number>,
  allowTriggerPayload = true,
): ValidationResult {
  const diagnostics: BehaviorDiagnostic[] = [];
  const component = components.get(action.componentId);
  if (!component) { diagnostics.push(error("COMPONENT_NOT_FOUND", `Action references missing component ${action.componentId}.`, "action.componentId", action.componentId)); return { diagnostics }; }
  if (component.definitionId !== action.definitionId) diagnostics.push(error("DEFINITION_MISMATCH", `Action targets ${action.definitionId}, but ${component.id} is ${component.definitionId}.`, "action.definitionId", component.id));
  const resolved = resolveProfile(definitions, registry, component.definitionId);
  rememberProfile(profileVersions, resolved);
  const descriptor = resolved.profile?.manifest.actions.find((candidate) => candidate.id === action.actionId);
  if (!resolved.profile) diagnostics.push(error("PROFILE_NOT_INSTALLED", `Behavior profile ${resolved.binding.profileId}:v${resolved.binding.profileVersion} is not installed.`, "action.profile", component.id));
  else if (!descriptor) diagnostics.push(error("ACTION_NOT_DECLARED", `Action ${action.actionId} is not declared by ${resolved.binding.profileId}:v${resolved.binding.profileVersion}.`, "action.actionId", component.id));
  if (action.payload.kind === "trigger-payload") {
    if (!allowTriggerPayload || (trigger.type !== "component.event" && trigger.type !== "input.changed")) diagnostics.push(error("TRIGGER_PAYLOAD_CONTEXT", "trigger-payload is only valid inside component.event or input.changed rules.", "action.payload", component.id));
    if (action.payload.fallback !== undefined && descriptor) diagnostics.push(...validatePayload(descriptor.payloadSchema, action.payload.fallback, "action.payload.fallback", "plan").diagnostics);
  } else if (descriptor) {
    diagnostics.push(...validatePayload(descriptor.payloadSchema, action.payload.value, "action.payload.value", "plan").diagnostics);
  }
  return { diagnostics };
}

function rememberProfile(profileVersions: Record<string, number>, resolved: ResolvedProfile) {
  defineOwn(profileVersions, resolved.binding.profileId, resolved.binding.profileVersion);
}

/** Assign caller-controlled identifiers as data properties, including the
 * historically special `__proto__` key. */
function defineOwn<T>(record: Record<string, T>, key: string, value: T) {
  Object.defineProperty(record, key, { value, enumerable: true, configurable: true, writable: true });
}

function handleUnsupported(policy: { onUnsupported: "block" | "skip" }, diagnostics: readonly BehaviorDiagnostic[]) {
  if (policy.onUnsupported === "block") return { block: true, diagnostics: [...diagnostics] };
  return { block: false, diagnostics: diagnostics.map((diagnostic) => ({ ...diagnostic, severity: "warning" as const })) };
}

function error(code: string, message: string, path?: string, componentId?: string): BehaviorDiagnostic {
  return { code, severity: "error", message, ...(path === undefined ? {} : { path }), ...(componentId === undefined ? {} : { componentId }) };
}
