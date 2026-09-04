import type {
  ComponentInstance,
  HardwareProject,
} from "@schematic/hardware-graph";

/** Values that are safe to persist in a Behavior Plan or send over WebMCP. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type BehaviorActionId = `${string}.${string}`;
export type BehaviorEventId = `${string}.${string}`;

export interface CatalogBehaviorBinding {
  profileId: string;
  profileVersion: number;
  variant?: string;
}

/**
 * The smallest catalog adapter needed by the behavior package. The frontend
 * can adapt its richer CatalogComponent records without making this package
 * depend on catalog storage or React.
 */
export interface BehaviorDefinitionLike {
  readonly id?: string;
  readonly behavior?: CatalogBehaviorBinding;
  readonly behaviorBinding?: CatalogBehaviorBinding;
}

export type BehaviorDefinitionLookup =
  | ((definitionId: string) => BehaviorDefinitionLike | undefined)
  | ReadonlyMap<string, BehaviorDefinitionLike>
  | Readonly<Record<string, BehaviorDefinitionLike | undefined>>;

export interface BehaviorPayloadSchemaV1 {
  schemaId: string;
  dialect: "https://json-schema.org/draft/2020-12/schema";
  schema: JsonValue;
}

export interface BehaviorActionDescriptor {
  id: BehaviorActionId;
  label: string;
  description: string;
  payloadSchema: BehaviorPayloadSchemaV1;
  control:
    | { kind: "trigger" }
    | { kind: "toggle" }
    | { kind: "number"; min: number; max: number; step: number; unit?: string }
    | { kind: "text"; maxLength: number }
    | { kind: "select"; options: readonly { value: JsonValue; label: string }[] };
}

export interface BehaviorEventDescriptor {
  id: BehaviorEventId;
  label: string;
  description: string;
  payloadSchema: BehaviorPayloadSchemaV1;
  control: { kind: "trigger"; label: string };
}

export type CapabilityAvailability =
  | { status: "available" }
  | {
      status: "disabled";
      code: "PRECONDITION_FAILED" | "STALE_PROJECT";
      reason: string;
      recovery?: string;
    }
  | {
      status: "unsupported";
      code: "ACTION_NOT_DECLARED" | "EVENT_NOT_DECLARED" | "PROFILE_NOT_INSTALLED";
      reason: string;
      recovery?: string;
      alternatives?: readonly string[];
    };

export interface ComponentActionCapability {
  actionId: BehaviorActionId;
  descriptor?: BehaviorActionDescriptor;
  availability: CapabilityAvailability;
}

export interface ComponentEventCapability {
  eventId: BehaviorEventId;
  descriptor?: BehaviorEventDescriptor;
  availability: CapabilityAvailability;
}

export interface ComponentBehaviorCapabilityReport {
  componentId: string;
  definitionId: string;
  profile?: CatalogBehaviorBinding;
  actions: readonly ComponentActionCapability[];
  events: readonly ComponentEventCapability[];
  limitations: readonly string[];
}

export interface BehaviorPlanV1 {
  schemaVersion: 1;
  id: string;
  projectId: string;
  name: string;
  intent?: string;
  revision: number;
  rules: readonly BehaviorRuleV1[];
  cues?: readonly BehaviorCueV1[];
}

export interface BehaviorRuleV1 {
  id: string;
  enabled: boolean;
  when: BehaviorTriggerV1;
  then: readonly ComponentActionRequestV1[];
}

export type BehaviorTriggerV1 =
  | { type: "preview.started" }
  | {
      type: "component.event";
      componentId: string;
      definitionId: string;
      eventId: BehaviorEventId;
      payload?: JsonValue;
    }
  | {
      type: "input.changed";
      componentId: string;
      definitionId: string;
      inputId: string;
    }
  | { type: "time.elapsed"; afterMs: number };

export interface BehaviorCueV1 {
  id: string;
  atMs: number;
  order: number;
  action: ComponentActionRequestV1;
}

export type BehaviorPayloadV1 =
  | { kind: "literal"; value: JsonValue }
  | {
      kind: "trigger-payload";
      select: "$" | "$.value";
      fallback?: JsonValue;
    };

export interface ComponentActionRequestV1 {
  componentId: string;
  definitionId: string;
  actionId: BehaviorActionId;
  payload: BehaviorPayloadV1;
}

export interface ComponentEventRequest {
  componentId: string;
  definitionId: string;
  eventId: BehaviorEventId;
  payload: JsonValue;
}

export interface InputChangeRequest {
  componentId: string;
  definitionId: string;
  inputId: string;
  value: JsonValue;
}

export type BehaviorDispatchRequest =
  | ComponentEventRequest
  | InputChangeRequest
  | ComponentActionRequestV1;

export interface ResolvedComponentAction {
  componentId: string;
  definitionId: string;
  profileId: string;
  profileVersion: number;
  actionId: BehaviorActionId;
  payload: JsonValue;
}

export interface ResolvedBehaviorRule {
  id: string;
  enabled: boolean;
  when: BehaviorTriggerV1;
  then: readonly ComponentActionRequestV1[];
}

export interface ResolvedBehaviorCue {
  id: string;
  atMs: number;
  order: number;
  action: ComponentActionRequestV1;
}

export interface PreparedBehaviorPlan {
  schemaVersion: 1;
  plan: BehaviorPlanV1;
  planSha256: string;
  projectSha256: string;
  registrySha256: string;
  profileVersions: Readonly<Record<string, number>>;
  /** Exact per-instance catalog binding observed during preparation. */
  componentProfiles: Readonly<Record<string, CatalogBehaviorBinding>>;
  normalizedRules: readonly ResolvedBehaviorRule[];
  normalizedCues: readonly ResolvedBehaviorCue[];
}

export type CodeLanguage = "arduino" | "micropython" | "espidf" | "c" | "cpp" | "python";

export interface CodeFile {
  name: string;
  content: string;
}

export interface CodeDependency {
  ecosystem: "arduino-library" | "platformio" | "python-package" | "vendor-sdk" | "other";
  name: string;
  version?: string;
  sourceUrl?: string;
}

export interface CodeExportRecord {
  contentSha256: string;
  exportedAt: string;
  format: "source-files" | "handoff-manifest" | "project-bundle";
}

export type CodePreviewLink =
  | { status: "unlinked" }
  | {
      status: "linked";
      behaviorPlanId: string;
      behaviorPlanSha256: string;
      projectSha256: string;
      linkedContentSha256: string;
    }
  | {
      status: "stale";
      behaviorPlanId: string;
      behaviorPlanSha256: string;
      projectSha256: string;
      linkedContentSha256: string;
      changed: readonly ("code" | "plan" | "project")[];
    };

export interface CodeDocument {
  schemaVersion: 1;
  id: string;
  projectId: string;
  targetComponentId: string;
  targetDefinitionId: string;
  boardFqbn?: string;
  language: CodeLanguage;
  files: readonly CodeFile[];
  dependencies: readonly CodeDependency[];
  revision: number;
  contentSha256: string;
  exportHistory: readonly CodeExportRecord[];
  origin: "ai-generated" | "human-authored" | "imported" | "mixed";
  previewLink: CodePreviewLink;
  inAppVerification: "not-performed";
  updatedAt: string;
}

export interface GraphDiagnosticWire {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  componentIds?: readonly string[];
  connectionIds?: readonly string[];
}

export interface ExternalCodeHandoffV1 {
  schemaVersion: 1;
  projectId: string;
  projectSha256: string;
  target: {
    componentId: string;
    definitionId: string;
    boardFqbn?: string;
  };
  language: CodeLanguage;
  files: readonly (CodeFile & { sha256: string })[];
  sourceSha256: string;
  dependencies: readonly CodeDependency[];
  previewLink: CodePreviewLink;
  graphDiagnostics: readonly GraphDiagnosticWire[];
  claims: {
    builtInSchematic: false;
    compiledInSchematic: false;
    executedInSchematic: false;
    uploadedBySchematic: false;
    physicallyTestedBySchematic: false;
  };
  exportedAt: string;
}

export type BehaviorDiagnosticSeverity = "error" | "warning" | "info";

export interface BehaviorDiagnostic {
  code: string;
  severity: BehaviorDiagnosticSeverity;
  message: string;
  path?: string;
  itemId?: string;
  componentId?: string;
  definitionId?: string;
  actionId?: string;
  eventId?: string;
  details?: Readonly<Record<string, JsonValue>>;
}

export interface RejectedBehaviorItem {
  kind: "rule" | "cue" | "action" | "event" | "input" | "plan";
  id?: string;
  request?: BehaviorDispatchRequest | ComponentActionRequestV1;
  diagnostics: readonly BehaviorDiagnostic[];
}

export type PlanPreparation =
  | {
      status: "ready";
      prepared: PreparedBehaviorPlan;
      diagnostics: readonly BehaviorDiagnostic[];
    }
  | {
      status: "partial";
      prepared: PreparedBehaviorPlan;
      rejected: readonly RejectedBehaviorItem[];
      diagnostics: readonly BehaviorDiagnostic[];
    }
  | {
      status: "blocked";
      rejected: readonly RejectedBehaviorItem[];
      diagnostics: readonly BehaviorDiagnostic[];
    };

export type VisualPrimitive =
  | { kind: "indicator"; key: string; on: boolean; color: string; intensity: number }
  | { kind: "button"; key: string; pressed: boolean }
  | { kind: "switch"; key: string; position: string }
  | { kind: "text-display"; key: string; lines: readonly string[] }
  | { kind: "numeric-readout"; key: string; value: number; unit?: string }
  | { kind: "rotation"; key: string; degrees: number }
  | { kind: "activity"; key: string; state: "idle" | "active" | "warning" }
  | { kind: "keypad"; key: string; lastKey: string | null; keys: readonly string[] };

export interface ComponentVisualProjection {
  primitives: readonly VisualPrimitive[];
  accessibleSummary: string;
}

export interface DeterministicActionContext {
  componentId: string;
  definitionId: string;
  logicalTimeMs: number;
  sequence: number;
  trigger?: ComponentEventRequest | InputChangeRequest;
}

export interface StateTransition<State> {
  state: State;
  /** Trusted profiles may describe a bounded event emission for future use. */
  emittedEvents?: readonly ComponentEventRequest[];
}

export interface BehaviorProfile<State = unknown> {
  manifest: {
    id: string;
    version: number;
    /** Immutable reviewed implementation identity; bump whenever reducer,
     * initial-state, parser, or projection semantics change. */
    implementationId: string;
    actions: readonly BehaviorActionDescriptor[];
    events: readonly BehaviorEventDescriptor[];
  };
  parseState(value: unknown): State;
  initialState(instance: ComponentInstance): State;
  reduce(
    state: State,
    action: ResolvedComponentAction,
    context: DeterministicActionContext,
  ): readonly StateTransition<State>[];
  projectVisual(state: State): ComponentVisualProjection;
}

export interface BehaviorRegistry {
  readonly profiles: readonly BehaviorProfile[];
  readonly hash: string;
  get(profileId: string, version?: number): BehaviorProfile | undefined;
}

export interface ProjectBehaviorReport {
  projectSha256: string;
  registrySha256: string;
  components: readonly ComponentBehaviorCapabilityReport[];
  diagnostics: readonly BehaviorDiagnostic[];
}

export interface BehaviorSnapshot {
  source: "behavior-preview";
  execution: "typed-actions-only";
  sourceCodeExecution: "none";
  logicalTimeMs: number;
  sequence: number;
  components: Readonly<Record<string, ComponentVisualProjection>>;
  inputs: Readonly<Record<string, JsonValue>>;
  sessionLog: readonly BehaviorSessionLogEntry[];
  sessionLogSha256: string;
  events: readonly BehaviorTimelineEvent[];
  diagnostics: readonly BehaviorDiagnostic[];
  snapshotSha256: string;
  claims: PreviewClaims;
}

export interface BehaviorSessionLogEntry {
  sequence: number;
  logicalTimeMs: number;
  kind: "component-event" | "input-change" | "direct-action";
  request: ComponentEventRequest | InputChangeRequest | ComponentActionRequestV1;
  /** True when the original request exceeded the per-entry retention budget. */
  requestRedacted?: boolean;
  outcome: "accepted" | "rejected";
  diagnosticCodes: readonly string[];
}

export interface BehaviorTimelineEvent {
  sequence: number;
  logicalTimeMs: number;
  kind: "component-event" | "input-change" | "action" | "diagnostic";
  componentId?: string;
  actionId?: BehaviorActionId;
  eventId?: BehaviorEventId;
  message?: string;
  outcome: "accepted" | "rejected" | "emitted";
}

export interface PreviewClaims {
  basis: "declared-behavior-plan";
  componentActionsValidated: boolean;
  sourceCodeRead: false;
  sourceCodeExecuted: false;
  sourceCodeCompiled: false;
  hardwareUploaded: false;
  electricalBehaviorSimulated: false;
  physicalWiringVerified: false;
  physicalBehaviorVerified: false;
}

export interface ActionOutcome {
  status: "accepted" | "rejected";
  request: BehaviorDispatchRequest;
  diagnostics: readonly BehaviorDiagnostic[];
  snapshot: BehaviorSnapshot;
}

export interface BehaviorPreviewSession {
  dispatch(
    currentProject: HardwareProject,
    request: BehaviorDispatchRequest,
  ): ActionOutcome;
  seek(currentProject: HardwareProject, timeMs: number): BehaviorSnapshot;
  reset(currentProject: HardwareProject): BehaviorSnapshot;
  snapshot(): BehaviorSnapshot;
  dispose(): void;
}

export interface BehaviorSystem {
  inspect(project: HardwareProject): ProjectBehaviorReport;
  prepare(
    project: HardwareProject,
    plan: unknown,
    policy?: { onUnsupported: "block" | "skip" },
  ): Promise<PlanPreparation>;
  open(project: HardwareProject, prepared: PreparedBehaviorPlan): BehaviorPreviewSession;
}

export interface BehaviorSystemOptions {
  definitions: BehaviorDefinitionLookup;
  registry?: BehaviorRegistry;
}

export const PREVIEW_CLAIMS: PreviewClaims = Object.freeze({
  basis: "declared-behavior-plan",
  componentActionsValidated: true,
  sourceCodeRead: false,
  sourceCodeExecuted: false,
  sourceCodeCompiled: false,
  hardwareUploaded: false,
  electricalBehaviorSimulated: false,
  physicalWiringVerified: false,
  physicalBehaviorVerified: false,
});
