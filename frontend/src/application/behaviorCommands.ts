import {
  createBehaviorSystem,
  parseBehaviorPlan,
  projectBehaviorFingerprint,
  sha256,
  sha256Text,
  type ActionOutcome,
  type BehaviorDispatchRequest,
  type BehaviorSnapshot,
  type ComponentActionRequestV1,
  type ComponentEventRequest,
  type ExternalCodeHandoffV1,
  type PlanPreparation,
  type PreviewClaims,
} from "@schematic/behavior";
import type { HardwareProject } from "@schematic/hardware-graph";
import { getCatalogComponent } from "../data/catalog.ts";
import { isBoardDefinition, resolveFirmwareBinding } from "../data/hardware.ts";
import { useBehaviorPreviewStore, registerBehaviorPreviewAdapter, PREVIEW_DISCLAIMER } from "../behavior/useBehaviorPreviewStore.ts";
import { useProjectStore, type HardwareGraph } from "../store/useProjectStore.ts";
import {
  flushProjectPersistence,
  getProjectPersistenceContext,
  getProjectPersistenceStatus,
  isCurrentProjectPersistenceContext,
  subscribeProjectPersistenceStatus,
} from "../store/projectPersistence.ts";
import { assertPersistenceMutationReady, PersistenceNotReadyError, type PersistenceContextToken } from "../store/persistenceGate.ts";
import { validateProject } from "../store/useValidationStore.ts";
import {
  MAX_CODE_DOCUMENT_BYTES,
  MAX_CODE_FILE_BYTES,
  MAX_CODE_FILES_PER_DOCUMENT,
  MAX_CODE_DEPENDENCIES_PER_DOCUMENT,
  MAX_PROJECT_SOURCE_BYTES,
  MAX_PERSISTED_ID_LENGTH,
  isSafeRelativeCodePath,
  type CodeDependencyRecord,
  type CodeDocumentRecord,
  type CodeFileRecord,
  type CodeLanguage,
} from "../store/behaviorPersistence.ts";

const CODE_LANGUAGES = new Set<CodeLanguage>(["arduino", "micropython", "espidf", "c", "cpp", "python"]);
const DEPENDENCY_ECOSYSTEMS = new Set<CodeDependencyRecord["ecosystem"]>(["arduino-library", "platformio", "python-package", "vendor-sdk", "other"]);
const SHA256_PATTERN = /^[0-9a-fA-F]{64}$/;

const NO_SOURCE_CLAIM: PreviewClaims = {
  basis: "declared-behavior-plan",
  componentActionsValidated: true,
  sourceCodeRead: false,
  sourceCodeExecuted: false,
  sourceCodeCompiled: false,
  hardwareUploaded: false,
  electricalBehaviorSimulated: false,
  physicalWiringVerified: false,
  physicalBehaviorVerified: false,
};

const CODE_NOTICE = "Editable source for external use. Schematic has not compiled, uploaded, run, or physically tested this code. Behavior Preview follows the Behavior Plan.";

export interface CommandError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export type CommandResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: CommandError; data?: Record<string, unknown> };

export interface CodeWriteRequest {
  targetComponentId: string;
  files: readonly CodeFileRecord[];
  language: CodeLanguage;
  dependencies?: readonly CodeDependencyRecord[];
  /** Required optimistic precondition: null creates only; an exact hash replaces. */
  expectedContentSha256: string | null;
  origin?: CodeDocumentRecord["origin"];
  boardFqbn?: string;
  linkToBehaviorPlan?: {
    planId: string;
    planSha256: string;
    projectSha256: string;
  };
}

export interface CodeExportResult {
  manifest: ExternalCodeHandoffV1;
  document: CodeDocumentRecord;
  notice: string;
  /** JSON text is intentionally returned as an artifact; it is never executed. */
  manifestJson: string;
}

let activeSession: ReturnType<ReturnType<typeof createBehaviorSystem>["open"]> | null = null;
let activePrepared: Extract<PlanPreparation, { status: "ready" | "partial" }>["prepared"] | null = null;
let activePlanId: string | null = null;
let activeProjectId: string | null = null;
let activeDurationMs = 1_000;
let previewStatus: "idle" | "ready" | "playing" | "paused" | "partial" | "blocked" = "idle";
let activePreparationStatus: "ready" | "partial" | null = null;
let activePreparationDiagnostics: readonly import("@schematic/behavior").BehaviorDiagnostic[] = [];
let previewOperationGeneration = 0;

/**
 * Position/label/layout edits are common during canvas work but are excluded
 * from the Behavior Plan project fingerprint.  Avoid serializing and hashing
 * the complete graph for those updates; only fall back to the canonical hash
 * when a behavior-relevant reference or primitive actually changed.  Store
 * updates are immutable, so a reused properties object is a valid identity
 * signal while an edited properties object takes the canonical path below.
 */
function behaviorGraphReferencesEqual(left: HardwareGraph, right: HardwareGraph) {
  if (left.id !== right.id || left.version !== right.version
    || left.components.length !== right.components.length
    || left.connections.length !== right.connections.length) return false;
  for (let index = 0; index < left.components.length; index += 1) {
    const a = left.components[index];
    const b = right.components[index];
    if (a === b) continue;
    if (a.id !== b.id || a.definitionId !== b.definitionId
      || (a as { firmwareGroupId?: string }).firmwareGroupId !== (b as { firmwareGroupId?: string }).firmwareGroupId
      || a.properties !== b.properties) return false;
  }
  for (let index = 0; index < left.connections.length; index += 1) {
    const a = left.connections[index];
    const b = right.connections[index];
    if (a === b) continue;
    if (a.id !== b.id || a.domain !== b.domain
      || a.source.componentId !== b.source.componentId || a.source.portId !== b.source.portId
      || a.target.componentId !== b.target.componentId || a.target.portId !== b.target.portId) return false;
  }
  return true;
}

function behaviorPlansReferencesEqual(left: HardwareGraph, right: HardwareGraph) {
  const a = left.behaviorPlans ?? [];
  const b = right.behaviorPlans ?? [];
  return a === b || (a.length === b.length && a.every((plan, index) => plan === b[index]));
}

// A preview session is deliberately graph/plan-scoped. Store-level project
// switches (including auth-room hydration and cross-tab changes) must not
// leave a snapshot or reducer from the previous project visible. Code-only
// edits intentionally do not invalidate the preview fingerprint: source is
// an independent editable artifact and is never used by the reducer.
useProjectStore.subscribe((next, previous) => {
  const projectChanged = next.project.id !== previous.project.id;
  const graphChanged = projectChanged || !behaviorGraphReferencesEqual(next.project, previous.project);
  const plansChanged = !behaviorPlansReferencesEqual(next.project, previous.project)
    && sha256(next.project.behaviorPlans ?? []) !== sha256(previous.project.behaviorPlans ?? []);
  if (!graphChanged && !plansChanged) return;
  // A shallow semantic change is enough to invalidate the active session. The
  // canonical hash is still computed by prepare/open when provenance is
  // needed, but it is no longer paid on every drag/layout store update.
  closeActiveSession();
  previewStatus = "idle";
  useBehaviorPreviewStore.getState().setSnapshot(null, "idle");
  useBehaviorPreviewStore.getState().setDiagnostics([]);
});

function failure(code: string, message: string, retryable = false, details: Record<string, unknown> = {}): CommandResult<never> {
  return { ok: false, error: { code, message, retryable, ...(Object.keys(details).length ? { details } : {}) }, ...(Object.keys(details).length ? { data: details } : {}) };
}

function success<T>(data: T): CommandResult<T> {
  return { ok: true, data };
}

function persistenceMutationFailure(action: string): CommandResult<never> | null {
  try {
    assertPersistenceMutationReady();
    return null;
  } catch (error) {
    if (!(error instanceof PersistenceNotReadyError)) throw error;
    return failure("PERSISTENCE_NOT_READY", `${action} is unavailable while the active account room is loading.`, true, { unchanged: true });
  }
}

function behaviorProject(project: HardwareGraph): HardwareProject {
  return {
    ...project,
    components: project.components.map((component) => ({
      ...component,
      rotation: component.rotation === 90 || component.rotation === 180 || component.rotation === 270
        ? component.rotation
        : 0,
    })),
    connections: project.connections.map((connection) => ({
      ...connection,
      domain: connection.domain as HardwareProject["connections"][number]["domain"],
    })),
    simulation: project.simulation ?? { mode: "interactive", engines: {} },
    firmwareTargets: project.firmwareTargets.map((target) => ({
      ...target,
      definitionId: target.definitionId ?? "unknown",
      language: (target.language ?? "arduino") as HardwareProject["firmwareTargets"][number]["language"],
      boardFqbn: target.boardFqbn ?? "",
    })),
    createdAt: project.createdAt ?? new Date(0).toISOString(),
    updatedAt: project.updatedAt ?? new Date(0).toISOString(),
    version: 1,
  };
}

function definitionsLookup(definitionId: string) {
  const definition = getCatalogComponent(definitionId);
  return definition ? { id: definition.id, behavior: definition.behavior } : undefined;
}

function currentSystem() {
  // Constructing this small immutable adapter is cheap and guarantees the
  // registry is checked-in, deterministic code rather than model-provided
  // reducer or renderer input.
  return createBehaviorSystem({ definitions: definitionsLookup });
}

function planHash(plan: unknown) {
  return sha256(plan);
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_PERSISTED_ID_LENGTH;
}

function validSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function validOptionalSha256(value: unknown): value is string | null {
  return value === null || validSha256(value);
}

function currentProjectHash(project = useProjectStore.getState().project) {
  return projectBehaviorFingerprint(behaviorProject(project));
}

function claims(snapshot?: BehaviorSnapshot | null): PreviewClaims {
  return snapshot?.claims ?? NO_SOURCE_CLAIM;
}

function diagnosticData(preparation: PlanPreparation) {
  return {
    preparationStatus: preparation.status,
    diagnostics: preparation.diagnostics,
    ...(preparation.status !== "ready" ? { rejected: preparation.rejected } : {}),
  };
}

function activePreparationData() {
  return {
    preparationStatus: activePreparationStatus,
    preparationDiagnostics: activePreparationDiagnostics,
  };
}

type DurabilityCheck = () => boolean;

async function durableWriteData(
  projectId: string,
  persistenceContext: PersistenceContextToken | null,
  verifyWrittenData?: DurabilityCheck,
) {
  const startedStatus = getProjectPersistenceStatus();
  const stored = await flushProjectPersistence();
  const status = getProjectPersistenceStatus();
  // `flushProjectPersistence` can yield while auth changes rooms. Checking
  // only the subject/project labels is insufficient: a logout/login cycle can
  // legitimately return to the same subject and project ids while still
  // representing a different persistence lease. Never report the old write as
  // durable for that newer room.
  const contextChanged = !isCurrentProjectPersistenceContext(persistenceContext)
    || useProjectStore.getState().activeProjectId !== projectId
    || status.userId !== startedStatus.userId
    || status.roomId !== startedStatus.roomId
    || status.generation !== startedStatus.generation;
  if (contextChanged || (verifyWrittenData && !verifyWrittenData())) {
    return {
      persistence: "superseded" as const,
      persistenceDurable: false,
      persistenceRevision: stored?.metadata.revision ?? null,
      persistenceError: contextChanged
        ? "The active project or persistence room changed before the durability result completed; re-read the target project before relying on this status."
        : "The target changed again before the durability result completed; re-read it before relying on this artifact.",
      projectId,
    };
  }
  const persistence = stored
    ? "flushed" as const
    : status.error
      ? "failed" as const
      : status.hydrated
        ? "already-current" as const
        : "local-snapshot-only" as const;
  return {
    persistence,
    persistenceDurable: persistence === "flushed" || persistence === "already-current",
    persistenceRevision: stored?.metadata.revision ?? status.revision,
    ...(status.error ? { persistenceError: status.error } : {}),
    projectId,
  };
}

export function getPreviewStatus() {
  return previewStatus;
}

export function getActivePreviewSnapshot(): BehaviorSnapshot | null {
  ensureActiveProject();
  return activeSession?.snapshot() ?? null;
}

export async function getBehaviorCapabilities() {
  const project = behaviorProject(useProjectStore.getState().project);
  return success(currentSystem().inspect(project));
}

export async function writeBehaviorPlan(rawPlan: unknown, expectedRevision: number | null) {
  if (expectedRevision === undefined) {
    return failure("PLAN_REVISION_REQUIRED", "Behavior Plan writes require expectedRevision: null to create or the exact current integer revision to replace.");
  }
  if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) {
    return failure("INVALID_PLAN_REVISION", "expectedRevision must be null or a non-negative safe integer.");
  }
  const persistenceContext = getProjectPersistenceContext();
  if (!isCurrentProjectPersistenceContext(persistenceContext)) {
    return failure("PERSISTENCE_NOT_READY", "The active account room is changing; wait for workspace hydration to finish before editing.", true, { unchanged: true });
  }
  const project = useProjectStore.getState().project;
  const parsed = parseBehaviorPlan(rawPlan);
  if (!parsed.plan) return failure("INVALID_BEHAVIOR_PLAN", "Behavior Plan was rejected by the version 1 schema.", false, { diagnostics: parsed.diagnostics });
  const plan = parsed.plan;
  if (plan.id.length > MAX_PERSISTED_ID_LENGTH || plan.projectId.length > MAX_PERSISTED_ID_LENGTH) return failure("BEHAVIOR_PLAN_ID_TOO_LONG", `Behavior Plan and project ids may contain at most ${MAX_PERSISTED_ID_LENGTH} characters.`);
  if (plan.projectId !== project.id) return failure("PLAN_PROJECT_MISMATCH", `Plan ${plan.id} belongs to ${plan.projectId}, not the active project ${project.id}.`, false, { projectId: project.id, planProjectId: plan.projectId });
  const current = useProjectStore.getState().getBehaviorPlan(plan.id);
  const currentRevision = current?.revision ?? null;
  if (expectedRevision !== currentRevision) {
    return failure("PLAN_CONFLICT", `Behavior Plan ${plan.id} changed before this write completed.`, true, { expectedRevision, currentRevision, planId: plan.id });
  }
  const preparation = await currentSystem().prepare(behaviorProject(project), plan, { onUnsupported: "block" });
  const latestState = useProjectStore.getState();
  const latestCurrent = latestState.getBehaviorPlan(plan.id);
  if (!isCurrentProjectPersistenceContext(persistenceContext)) {
    return failure("PERSISTENCE_NOT_READY", "The active account room changed while the Behavior Plan was being validated. The plan was not written.", true, { unchanged: true });
  }
  if (latestState.project.id !== project.id || currentProjectHash(latestState.project) !== currentProjectHash(project)) {
    return failure("PLAN_CONTEXT_CHANGED", "The active project changed before Behavior Plan validation completed. The plan was not written.", true, { projectId: project.id, activeProjectId: latestState.project.id });
  }
  if ((latestCurrent?.revision ?? null) !== currentRevision || (latestCurrent && current && planHash(latestCurrent) !== planHash(current))) {
    return failure("PLAN_CONFLICT", `Behavior Plan ${plan.id} changed before validation completed.`, true, { expectedRevision, currentRevision: latestCurrent?.revision ?? null, planId: plan.id });
  }
  if (preparation.status === "blocked") return failure("BEHAVIOR_PLAN_BLOCKED", "Behavior Plan was not saved because one or more exact capabilities or payloads are unsupported.", false, diagnosticData(preparation));
  try {
    // Keep the check adjacent to the only durable plan mutation. The room
    // lease is generation-based, so a same-subject token refresh does not
    // invalidate the write while a real account switch does.
    if (!isCurrentProjectPersistenceContext(persistenceContext)) {
      return failure("PERSISTENCE_NOT_READY", "The active account room changed before the Behavior Plan could be written. The plan was not written.", true, { unchanged: true });
    }
    const written = useProjectStore.getState().writeBehaviorPlan(plan, expectedRevision);
    if (written.conflict) return failure(
      "PLAN_CONFLICT",
      written.conflict.deleted ? `Behavior Plan ${plan.id} was deleted before this write completed.` : `Behavior Plan ${plan.id} changed before this write completed.`,
      true,
      { expectedRevision, currentRevision: written.conflict.current?.revision ?? null, planId: plan.id, planDeleted: written.conflict.deleted === true },
    );
    const durable = await durableWriteData(project.id, persistenceContext, () => {
      const currentPlan = useProjectStore.getState().getBehaviorPlan(written.plan.id);
      return Boolean(currentPlan
        && currentPlan.revision === written.plan.revision
        && planHash(currentPlan) === planHash(written.plan));
    });
    return success({
      plan: written.plan,
      replaced: written.replaced,
      revision: written.plan.revision,
      planSha256: planHash(written.plan),
      projectSha256: currentProjectHash(project),
      diagnostics: preparation.diagnostics,
      notice: "Behavior Plan saved. Preview remains separate from editable source code.",
      ...durable,
    });
  } catch (error) {
    if (error instanceof PersistenceNotReadyError) {
      return failure("PERSISTENCE_NOT_READY", error.message, true, { unchanged: true });
    }
    return failure("BEHAVIOR_PLAN_WRITE_FAILED", error instanceof Error ? error.message : "Behavior Plan could not be saved.");
  }
}

function disposeActiveSession() {
  activeSession?.dispose();
  activeSession = null;
  activePrepared = null;
  activePlanId = null;
  activeProjectId = null;
  activeDurationMs = 1_000;
  activePreparationStatus = null;
  activePreparationDiagnostics = [];
}

function closeActiveSession() {
  previewOperationGeneration += 1;
  disposeActiveSession();
}

function ensureActiveProject() {
  if (activeProjectId && activeProjectId !== useProjectStore.getState().project.id) {
    closeActiveSession();
    previewStatus = "idle";
  }
}

export async function previewBehavior(planId?: string, policy: "block" | "skip" = "block", requestedDurationMs = 1_000) {
  // Invalidate every older prepare call before reading the next project/plan.
  // A prepare may yield, so only this generation is allowed to install a
  // module-global session after the await.
  closeActiveSession();
  const persistenceContext = getProjectPersistenceContext();
  if (!isCurrentProjectPersistenceContext(persistenceContext)) {
    return failure("PERSISTENCE_NOT_READY", "The active account room is changing; wait for workspace hydration to finish before previewing.", true, { unchanged: true });
  }
  if (planId !== undefined && !validIdentifier(planId)) {
    return failure("INVALID_BEHAVIOR_REQUEST", "planId must be a bounded non-empty identifier of at most 200 characters.");
  }
  const operationGeneration = previewOperationGeneration;
  const state = useProjectStore.getState();
  const project = behaviorProject(state.project);
  const plan = state.getBehaviorPlan(planId);
  if (!plan) {
    previewStatus = "blocked";
    return failure("BEHAVIOR_PLAN_NOT_FOUND", "No Behavior Plan is saved for this project. Write a plan before starting preview.", false, { projectId: project.id });
  }
  const preparation = await currentSystem().prepare(project, plan, { onUnsupported: policy });
  if (!isCurrentProjectPersistenceContext(persistenceContext)) {
    return failure("PERSISTENCE_NOT_READY", "The active account room changed while the Behavior Plan was being prepared. The previous preview remains closed.", true, { unchanged: true });
  }
  const currentState = useProjectStore.getState();
  const currentPlan = currentState.getBehaviorPlan(plan.id);
  const requestIsCurrent = operationGeneration === previewOperationGeneration
    && currentState.project.id === project.id
    && currentProjectHash(currentState.project) === projectBehaviorFingerprint(project)
    && Boolean(currentPlan)
    && planHash(currentPlan) === planHash(plan);
  if (!requestIsCurrent) {
    return failure("PREVIEW_REQUEST_SUPERSEDED", "A newer preview request or project revision replaced this preview before preparation completed.", true, { planId: plan.id, projectId: project.id });
  }
  if (preparation.status === "blocked") {
    previewStatus = "blocked";
    return failure("BEHAVIOR_PLAN_BLOCKED", "Preview is blocked until the Behavior Plan diagnostics are resolved.", false, { planId: plan.id, ...diagnosticData(preparation), claims: NO_SOURCE_CLAIM });
  }
  const system = currentSystem();
  activePrepared = preparation.prepared;
  activeSession = system.open(project, preparation.prepared);
  activePlanId = plan.id;
  activeProjectId = project.id;
  const scheduledTimes = [
    ...preparation.prepared.normalizedCues.map((cue) => cue.atMs),
    ...preparation.prepared.normalizedRules.flatMap((rule) => rule.when.type === "time.elapsed" ? [rule.when.afterMs] : []),
  ];
  const boundedRequestedDuration = Number.isSafeInteger(requestedDurationMs)
    ? Math.max(1, Math.min(600_000, requestedDurationMs))
    : 1_000;
  activeDurationMs = Math.max(boundedRequestedDuration, 1, ...scheduledTimes);
  activePreparationStatus = preparation.status;
  activePreparationDiagnostics = preparation.diagnostics;
  previewStatus = preparation.status === "partial" ? "partial" : "playing";
  const snapshot = activeSession.snapshot();
  return success({
    status: previewStatus,
    planId: plan.id,
    planSha256: preparation.prepared.planSha256,
    projectSha256: preparation.prepared.projectSha256,
    registrySha256: preparation.prepared.registrySha256,
    durationMs: activeDurationMs,
    snapshot,
    ...diagnosticData(preparation),
    claims: claims(snapshot),
    notice: PREVIEW_DISCLAIMER,
  });
}

function requireSession(): CommandResult<NonNullable<typeof activeSession>> {
  ensureActiveProject();
  if (!activeSession || !activePrepared || !activePlanId) return failure("PREVIEW_NOT_STARTED", "No active Behavior Preview session. Start behavior.preview first.");
  return success(activeSession);
}

export async function invokeBehavior(request: BehaviorDispatchRequest) {
  const blocked = persistenceMutationFailure("Behavior Preview actions");
  if (blocked) return blocked;
  const session = requireSession();
  if (!session.ok) return session;
  const project = behaviorProject(useProjectStore.getState().project);
  const outcome: ActionOutcome = session.data.dispatch(project, request);
  if (previewStatus === "idle") previewStatus = "ready";
  return success({
    status: outcome.status,
    request: outcome.request,
    diagnostics: outcome.diagnostics,
    ...activePreparationData(),
    durationMs: activeDurationMs,
    snapshot: outcome.snapshot,
    claims: claims(outcome.snapshot),
    notice: PREVIEW_DISCLAIMER,
  });
}

export async function seekBehavior(timeMs: number) {
  const blocked = persistenceMutationFailure("Behavior Preview seeking");
  if (blocked) return blocked;
  const session = requireSession();
  if (!session.ok) return session;
  const project = behaviorProject(useProjectStore.getState().project);
  const snapshot = session.data.seek(project, timeMs);
  if ((previewStatus === "playing" || previewStatus === "partial") && snapshot.logicalTimeMs >= activeDurationMs) previewStatus = "ready";
  return success({ status: previewStatus, durationMs: activeDurationMs, snapshot, ...activePreparationData(), claims: claims(snapshot), notice: PREVIEW_DISCLAIMER });
}

export async function resetBehavior() {
  // Reset only clears the in-memory preview session. It must remain available
  // while an authenticated room is hydrating so the UI can safely discard a
  // stale session during an account/project transition. Unlike invoke/seek/
  // pause/resume, reset does not write project state or durable behavior data.
  previewOperationGeneration += 1;
  const session = requireSession();
  if (!session.ok) {
    previewStatus = "idle";
    return success({ status: "idle" as const, durationMs: 1_000, snapshot: null, ...activePreparationData(), notice: PREVIEW_DISCLAIMER });
  }
  const snapshot = session.data.reset(behaviorProject(useProjectStore.getState().project));
  previewStatus = "ready";
  return success({ status: previewStatus, durationMs: activeDurationMs, snapshot, ...activePreparationData(), claims: claims(snapshot), notice: PREVIEW_DISCLAIMER });
}

export async function pauseBehavior() {
  const blocked = persistenceMutationFailure("Behavior Preview pause");
  if (blocked) return blocked;
  previewOperationGeneration += 1;
  ensureActiveProject();
  if (!activeSession) return success({ status: "idle" as const, durationMs: 1_000, snapshot: null, ...activePreparationData(), notice: PREVIEW_DISCLAIMER });
  previewStatus = "paused";
  const snapshot = activeSession.snapshot();
  return success({ status: previewStatus, durationMs: activeDurationMs, snapshot, ...activePreparationData(), claims: claims(snapshot), notice: PREVIEW_DISCLAIMER });
}

export async function resumeBehavior() {
  const blocked = persistenceMutationFailure("Behavior Preview resume");
  if (blocked) return blocked;
  const session = requireSession();
  if (!session.ok) return session;
  const snapshot = session.data.snapshot();
  previewStatus = snapshot.logicalTimeMs >= activeDurationMs ? "ready" : "playing";
  return success({ status: previewStatus, durationMs: activeDurationMs, snapshot, ...activePreparationData(), claims: claims(snapshot), notice: PREVIEW_DISCLAIMER });
}

export async function getBehaviorState() {
  ensureActiveProject();
  const project = useProjectStore.getState().project;
  const snapshot = activeSession?.snapshot() ?? null;
  const plan = useProjectStore.getState().getBehaviorPlan(activePlanId ?? undefined);
  return success({
    status: previewStatus,
    projectId: project.id,
    planId: plan?.id ?? null,
    planSha256: plan ? planHash(plan) : null,
    projectSha256: currentProjectHash(project),
    registrySha256: activePrepared?.registrySha256 ?? currentSystem().inspect(behaviorProject(project)).registrySha256,
    logicalTimeMs: snapshot?.logicalTimeMs ?? 0,
    durationMs: activeDurationMs,
    ...activePreparationData(),
    snapshot,
    claims: claims(snapshot),
    notice: PREVIEW_DISCLAIMER,
  });
}

function normalizedCodeFiles(files: readonly CodeFileRecord[]): CommandResult<CodeFileRecord[]> {
  if (!Array.isArray(files) || files.length === 0) return failure("CODE_FILES_REQUIRED", "At least one editable source file is required.");
  if (files.length > MAX_CODE_FILES_PER_DOCUMENT) return failure("CODE_FILE_LIMIT_EXCEEDED", `A code document may contain at most ${MAX_CODE_FILES_PER_DOCUMENT} files.`);
  const seen = new Set<string>();
  const result: CodeFileRecord[] = [];
  let totalBytes = 0;
  for (const file of files) {
    if (!file || typeof file !== "object" || typeof file.name !== "string" || typeof file.content !== "string") {
      return failure("INVALID_CODE_FILE", "Each code file needs an exact string name and string content value.");
    }
    const name = file.name.trim();
    const content = file.content;
    if (!isSafeRelativeCodePath(name)) return failure("INVALID_CODE_FILENAME", `Code file name ${name || "<empty>"} is not a safe relative path.`);
    if (seen.has(name)) return failure("DUPLICATE_CODE_FILENAME", `Code file ${name} appears more than once.`);
    const contentBytes = new TextEncoder().encode(content).byteLength;
    if (contentBytes > MAX_CODE_FILE_BYTES) return failure("CODE_FILE_TOO_LARGE", `Code file ${name} exceeds the 1 MiB editable source limit.`);
    totalBytes += contentBytes;
    if (totalBytes > MAX_CODE_DOCUMENT_BYTES) return failure("CODE_DOCUMENT_TOO_LARGE", "A code document may contain at most 512 KiB of editable source.");
    seen.add(name);
    result.push({ name, content });
  }
  return success(result.sort((left, right) => left.name.localeCompare(right.name)));
}

function normalizedDependencies(dependencies: readonly CodeDependencyRecord[] | undefined): CommandResult<CodeDependencyRecord[] | undefined> {
  if (dependencies === undefined) return success(undefined);
  if (!Array.isArray(dependencies)) return failure("INVALID_CODE_DEPENDENCIES", "Code dependencies must be an array.");
  if (dependencies.length > MAX_CODE_DEPENDENCIES_PER_DOCUMENT) return failure("CODE_DEPENDENCY_LIMIT_EXCEEDED", `A code document may contain at most ${MAX_CODE_DEPENDENCIES_PER_DOCUMENT} dependencies.`);
  const normalized: CodeDependencyRecord[] = [];
  for (const dependency of dependencies) {
    if (!dependency || typeof dependency !== "object" || !DEPENDENCY_ECOSYSTEMS.has(dependency.ecosystem) || typeof dependency.name !== "string" || !dependency.name.trim() || dependency.name.length > 240) {
      return failure("INVALID_CODE_DEPENDENCY", "Each dependency needs a supported ecosystem and a non-empty name of at most 240 characters.");
    }
    if (dependency.version !== undefined && (typeof dependency.version !== "string" || dependency.version.length > 120)) return failure("INVALID_CODE_DEPENDENCY", `Dependency ${dependency.name} has an invalid version.`);
    if (dependency.sourceUrl !== undefined && (typeof dependency.sourceUrl !== "string" || dependency.sourceUrl.length > 2_000)) return failure("INVALID_CODE_DEPENDENCY", `Dependency ${dependency.name} has an invalid source URL.`);
    normalized.push({
      ecosystem: dependency.ecosystem,
      name: dependency.name.trim(),
      ...(dependency.version?.trim() ? { version: dependency.version.trim() } : {}),
      ...(dependency.sourceUrl?.trim() ? { sourceUrl: dependency.sourceUrl.trim() } : {}),
    });
  }
  return success(normalized);
}

function codeContentHash(files: readonly CodeFileRecord[]) {
  return sha256([...files].sort((left, right) => left.name.localeCompare(right.name)).map((file) => ({ name: file.name, content: file.content })));
}

function reconciledCodeDocument(document: CodeDocumentRecord, project: HardwareGraph): CodeDocumentRecord {
  if (document.previewLink.status === "unlinked") return document;
  const link = document.previewLink;
  const changed = new Set<"code" | "plan" | "project">(link.status === "stale" ? link.changed : []);
  const plan = (project.behaviorPlans ?? []).find((candidate) => candidate.id === link.behaviorPlanId);
  if (!plan || planHash(plan) !== link.behaviorPlanSha256) changed.add("plan");
  if (currentProjectHash(project) !== link.projectSha256 || document.projectId !== project.id) changed.add("project");
  if (codeContentHash(document.files) !== document.contentSha256 || link.linkedContentSha256 !== document.contentSha256) changed.add("code");
  if (!changed.size) return document;
  return {
    ...document,
    previewLink: {
      status: "stale",
      behaviorPlanId: link.behaviorPlanId,
      behaviorPlanSha256: link.behaviorPlanSha256,
      projectSha256: link.projectSha256,
      linkedContentSha256: link.linkedContentSha256,
      changed: [...changed],
    },
  };
}

function sourceLink(request: CodeWriteRequest, project: HardwareGraph) {
  // An omitted link means "preserve/reconcile the document's existing
  // relation". It is intentionally different from an explicit unlinked
  // relation: source edits to a previously linked document must become stale,
  // not silently erase their audit trail.
  if (!request.linkToBehaviorPlan) return undefined;
  const plan = (project.behaviorPlans ?? []).find((candidate) => candidate.id === request.linkToBehaviorPlan!.planId);
  if (!plan) return null;
  const actualPlanHash = planHash(plan);
  const actualProjectHash = currentProjectHash(project);
  if (request.linkToBehaviorPlan.planSha256 !== actualPlanHash || request.linkToBehaviorPlan.projectSha256 !== actualProjectHash) return null;
  return {
    status: "linked" as const,
    behaviorPlanId: plan.id,
    behaviorPlanSha256: actualPlanHash,
    projectSha256: actualProjectHash,
    linkedContentSha256: "",
  };
}

export async function writeCode(request: CodeWriteRequest) {
  if (!validIdentifier(request?.targetComponentId)) {
    return failure("INVALID_CODE_REQUEST", "targetComponentId must be a bounded non-empty identifier of at most 200 characters.");
  }
  if (!Object.prototype.hasOwnProperty.call(request ?? {}, "expectedContentSha256") || !validOptionalSha256(request?.expectedContentSha256)) {
    return failure("INVALID_CODE_REQUEST", "expectedContentSha256 must be null or a 64-character hexadecimal SHA-256 hash.");
  }
  if (request?.linkToBehaviorPlan !== undefined) {
    const link = request.linkToBehaviorPlan;
    if (!link || typeof link !== "object"
      || !validIdentifier(link.planId)
      || !validSha256(link.planSha256)
      || !validSha256(link.projectSha256)) {
      return failure("INVALID_CODE_REQUEST", "linkToBehaviorPlan requires a bounded planId and exact 64-character hexadecimal planSha256/projectSha256 values.");
    }
  }
  const persistenceContext = getProjectPersistenceContext();
  if (!isCurrentProjectPersistenceContext(persistenceContext)) {
    return failure("PERSISTENCE_NOT_READY", "The active account room is changing; wait for workspace hydration to finish before editing.", true, { unchanged: true });
  }
  const state = useProjectStore.getState();
  const project = state.project;
  const id = request.targetComponentId.trim();
  const component = project.components.find((candidate) => candidate.id === id);
  if (!component) return failure("CODE_TARGET_NOT_FOUND", `Unknown code target component ${id}.`, false, { targetComponentId: id });
  if (!Object.prototype.hasOwnProperty.call(request, "expectedContentSha256") || request.expectedContentSha256 === undefined) {
    return failure("SOURCE_PRECONDITION_REQUIRED", "Code writes require expectedContentSha256: null for create-only, or the exact current hash for replacement.", false, { targetComponentId: id });
  }
  const binding = resolveFirmwareBinding(project, id);
  if (!isBoardDefinition(binding.definition)) return failure("CODE_TARGET_NOT_BOARD", `${id} is not a programmable board code target.`, false, { targetComponentId: id, definitionId: component.definitionId });
  const files = normalizedCodeFiles(request.files);
  if (!files.ok) return files;
  if (!CODE_LANGUAGES.has(request.language)) return failure("INVALID_CODE_LANGUAGE", `Unsupported source language ${String(request.language)}.`);
  const dependencies = normalizedDependencies(request.dependencies);
  if (!dependencies.ok) return dependencies;
  if (request.boardFqbn !== undefined && !validIdentifier(request.boardFqbn)) return failure("INVALID_BOARD_TARGET", "Board target identifiers must be bounded non-empty strings of at most 200 characters.");
  const contentSha256 = codeContentHash(files.data);
  const existing = state.getCodeDocument(id);
  const otherSourceBytes = (project.codeDocuments ?? []).filter((document) => document.id !== existing?.id).reduce((total, document) => total + document.files.reduce((fileTotal, file) => fileTotal + new TextEncoder().encode(file.content).byteLength, 0), 0);
  const nextSourceBytes = files.data.reduce((total, file) => total + new TextEncoder().encode(file.content).byteLength, 0);
  if (otherSourceBytes + nextSourceBytes > MAX_PROJECT_SOURCE_BYTES) return failure("PROJECT_SOURCE_LIMIT_EXCEEDED", "A project may contain at most 512 KiB of editable source across all board documents.");
  const currentHash = existing?.contentSha256 ?? null;
  if (currentHash !== request.expectedContentSha256) {
    const sourceDeleted = existing === undefined && request.expectedContentSha256 !== null;
    return failure(
      "SOURCE_CONFLICT",
      sourceDeleted ? `Code for ${id} was deleted since the caller last read it.` : `Code for ${id} changed since the caller last read it.`,
      true,
      { targetComponentId: id, expectedContentSha256: request.expectedContentSha256, currentContentSha256: currentHash, current: existing, sourceDeleted },
    );
  }
  const link = sourceLink(request, project);
  if (request.linkToBehaviorPlan && !link) return failure("PLAN_LINK_INVALID", "The requested code/Behavior Plan link does not match the current exact plan and project hashes.", false, { targetComponentId: id });
  const linked = link && link.status === "linked" ? { ...link, linkedContentSha256: contentSha256 } : link;
  const language = request.language ?? "arduino";
  const boardFqbn = request.boardFqbn ?? binding.targetConfig?.fqbn ?? binding.target?.boardFqbn;
  let written;
  try {
    if (!isCurrentProjectPersistenceContext(persistenceContext)) {
      return failure("PERSISTENCE_NOT_READY", "The active account room changed before source could be written. The source was not changed.", true, { unchanged: true });
    }
    written = state.writeCodeDocument({
      targetComponentId: id,
      targetDefinitionId: component.definitionId,
      files: files.data,
      language,
      ...(dependencies.data !== undefined ? { dependencies: dependencies.data } : {}),
      expectedContentSha256: request.expectedContentSha256,
      contentSha256,
      origin: request.origin ?? existing?.origin ?? "ai-generated",
      ...(linked ? { linkToBehaviorPlan: linked } : {}),
      boardFqbn,
    });
  } catch (error) {
    if (error instanceof PersistenceNotReadyError) {
      return failure("PERSISTENCE_NOT_READY", error.message, true, { unchanged: true });
    }
    throw error;
  }
  if (written.conflict) return failure(
    "SOURCE_CONFLICT",
    written.conflict.deleted ? `Code for ${id} was deleted since the caller last read it.` : `Code for ${id} changed since the caller last read it.`,
    true,
    { current: written.conflict.current, sourceDeleted: written.conflict.deleted === true },
  );
  const durable = await durableWriteData(project.id, persistenceContext, () => {
    const currentDocument = useProjectStore.getState().getCodeDocument(written.document.targetComponentId, written.document.id);
    return Boolean(currentDocument
      && currentDocument.revision === written.document.revision
      && currentDocument.contentSha256 === written.document.contentSha256);
  });
  return success({
    document: written.document,
    replaced: written.replaced,
    notice: CODE_NOTICE,
    ...durable,
    claims: { sourceCodeRead: false, sourceCodeExecuted: false, sourceCodeCompiled: false, hardwareUploaded: false, physicallyTestedBySchematic: false },
  });
}

export async function readCode(targetComponentId?: string, documentId?: string) {
  if ((targetComponentId !== undefined && !validIdentifier(targetComponentId)) || (documentId !== undefined && !validIdentifier(documentId))) {
    return failure("INVALID_CODE_REQUEST", "Code target identifiers must be bounded non-empty strings of at most 200 characters.");
  }
  const project = useProjectStore.getState().project;
  const document = useProjectStore.getState().getCodeDocument(targetComponentId, documentId);
  if (!document) return failure("CODE_DOCUMENT_NOT_FOUND", "No editable code document exists for that target.", false, { targetComponentId: targetComponentId ?? null, documentId: documentId ?? null });
  return success({ document: reconciledCodeDocument(document, project), notice: CODE_NOTICE, claims: { sourceCodeRead: true, sourceCodeExecuted: false, sourceCodeCompiled: false, hardwareUploaded: false, physicallyTestedBySchematic: false } });
}

function graphDiagnostics(project: HardwareGraph) {
  const result = validateProject(project);
  return result.issues.map((issue) => ({
    code: issue.code,
    severity: (issue.severity === "error" || issue.severity === "warning" ? issue.severity : "info") as "error" | "warning" | "info",
    message: issue.message,
    ...(issue.affectedComponents ? { componentIds: issue.affectedComponents } : {}),
    ...(issue.affectedConnections ? { connectionIds: issue.affectedConnections } : {}),
  }));
}

export async function exportCode(targetComponentId?: string, documentId?: string): Promise<CommandResult<CodeExportResult>> {
  if ((targetComponentId !== undefined && !validIdentifier(targetComponentId)) || (documentId !== undefined && !validIdentifier(documentId))) {
    return failure("INVALID_CODE_REQUEST", "Code target identifiers must be bounded non-empty strings of at most 200 characters.");
  }
  const persistenceContext = getProjectPersistenceContext();
  if (!isCurrentProjectPersistenceContext(persistenceContext)) {
    return failure("PERSISTENCE_NOT_READY", "The active account room is changing; wait for workspace hydration to finish before exporting source.", true, { unchanged: true });
  }
  const state = useProjectStore.getState();
  const project = state.project;
  const document = state.getCodeDocument(targetComponentId, documentId);
  if (!document) return failure("CODE_DOCUMENT_NOT_FOUND", "No editable code document exists for that target.", false, { targetComponentId: targetComponentId ?? null, documentId: documentId ?? null });
  const reconciled = reconciledCodeDocument(document, project);
  const projectSha256 = currentProjectHash(project);
  const files = reconciled.files.map((file) => ({ ...file, sha256: sha256Text(file.content) }));
  const sourceSha256 = codeContentHash(reconciled.files);
  const exportedAt = new Date().toISOString();
  const manifest: ExternalCodeHandoffV1 = {
    schemaVersion: 1,
    projectId: project.id,
    projectSha256,
    target: { componentId: document.targetComponentId, definitionId: document.targetDefinitionId, ...(document.boardFqbn ? { boardFqbn: document.boardFqbn } : {}) },
    language: document.language,
    files,
    sourceSha256,
    dependencies: document.dependencies,
    previewLink: reconciled.previewLink,
    graphDiagnostics: graphDiagnostics(project),
    claims: { builtInSchematic: false, compiledInSchematic: false, executedInSchematic: false, uploadedBySchematic: false, physicallyTestedBySchematic: false },
    exportedAt,
  };
  state.recordCodeExport(document.id, { contentSha256: sourceSha256, exportedAt, format: "handoff-manifest" });
  const durable = await durableWriteData(project.id, persistenceContext, () => {
    const currentDocument = useProjectStore.getState().getCodeDocument(document.targetComponentId, document.id);
    return Boolean(currentDocument
      && currentDocument.revision === document.revision
      && currentDocument.contentSha256 === document.contentSha256
      && currentDocument.exportHistory.some((record) => record.contentSha256 === sourceSha256 && record.exportedAt === exportedAt && record.format === "handoff-manifest"));
  });
  const refreshed = useProjectStore.getState().getCodeDocument(document.targetComponentId, document.id) ?? document;
  return success({ manifest, document: refreshed, notice: CODE_NOTICE, manifestJson: JSON.stringify(manifest, null, 2), ...durable });
}

/**
 * Connect the shared command layer to the ephemeral UI preview store. This
 * contains no durable state and does not expose reducer functions to models.
 */
export function installBehaviorPreviewAdapter() {
  let observedPersistenceGeneration = getProjectPersistenceStatus().generation;
  const clearStalePreview = () => {
    const status = getProjectPersistenceStatus();
    const changedRoom = status.generation !== observedPersistenceGeneration;
    observedPersistenceGeneration = status.generation;
    if (!changedRoom && status.hydrated) return;
    // Preview sessions are ephemeral but still belong to the active account
    // room. Clear both the reducer instance and its UI projection as soon as
    // a new room starts loading; otherwise a same-id/same-hash project can
    // accidentally keep the previous user's snapshot alive.
    closeActiveSession();
    previewStatus = "idle";
    useBehaviorPreviewStore.getState().setSnapshot(null, "idle");
    useBehaviorPreviewStore.getState().setDiagnostics([]);
  };
  const stopPersistenceStatus = subscribeProjectPersistenceStatus(clearStalePreview);
  clearStalePreview();
  const stopAdapter = registerBehaviorPreviewAdapter({
    preview: async (request) => {
      const result = getPreviewStatus() === "paused"
        ? await resumeBehavior()
        : await previewBehavior(undefined, "block", request?.durationMs);
      return result.ok ? { status: result.data.status, durationMs: result.data.durationMs, snapshot: result.data.snapshot, preparationStatus: "preparationStatus" in result.data ? result.data.preparationStatus === "partial" ? "partial" : "ready" : null, diagnostics: "diagnostics" in result.data ? result.data.diagnostics : result.data.preparationDiagnostics, message: result.data.notice } : { status: "blocked", durationMs: 1_000, snapshot: null, preparationStatus: null, diagnostics: (result.error.details?.diagnostics as any) ?? [{ code: result.error.code, message: result.error.message }], message: result.error.message };
    },
    pause: async () => {
      const result = await pauseBehavior();
      return result.ok ? { status: result.data.status, durationMs: result.data.durationMs, snapshot: result.data.snapshot, preparationStatus: result.data.preparationStatus, diagnostics: result.data.preparationDiagnostics, message: result.data.notice } : { status: "blocked", message: result.error.message };
    },
    reset: async () => {
      const result = await resetBehavior();
      return result.ok ? { status: result.data.status, durationMs: result.data.durationMs, snapshot: result.data.snapshot, preparationStatus: result.data.preparationStatus, diagnostics: result.data.preparationDiagnostics, message: result.data.notice } : { status: "blocked", message: result.error.message };
    },
    seek: async (timeMs) => {
      const result = await seekBehavior(timeMs);
      return result.ok ? { status: result.data.status, durationMs: result.data.durationMs, snapshot: result.data.snapshot, preparationStatus: result.data.preparationStatus, diagnostics: result.data.preparationDiagnostics, message: result.data.notice } : { status: "blocked", message: result.error.message };
    },
    dispatchEvent: async (request) => {
      const result = await invokeBehavior({ componentId: request.componentId, definitionId: request.definitionId, eventId: request.eventId as ComponentEventRequest["eventId"], payload: (request.payload ?? null) as ComponentEventRequest["payload"] });
      return result.ok ? { status: getPreviewStatus(), durationMs: result.data.durationMs, snapshot: result.data.snapshot, preparationStatus: result.data.preparationStatus, diagnostics: [...result.data.preparationDiagnostics, ...result.data.diagnostics], message: result.data.notice } : { status: "blocked", message: result.error.message };
    },
    invokeAction: async (request) => {
      const result = await invokeBehavior({ componentId: request.componentId, definitionId: request.definitionId, actionId: request.actionId as ComponentActionRequestV1["actionId"], payload: request.payload as ComponentActionRequestV1["payload"] });
      return result.ok ? { status: getPreviewStatus(), durationMs: result.data.durationMs, snapshot: result.data.snapshot, preparationStatus: result.data.preparationStatus, diagnostics: [...result.data.preparationDiagnostics, ...result.data.diagnostics], message: result.data.notice } : { status: "blocked", message: result.error.message };
    },
  });
  return () => {
    stopAdapter();
    stopPersistenceStatus();
    closeActiveSession();
    previewStatus = "idle";
    useBehaviorPreviewStore.getState().setSnapshot(null, "idle");
    useBehaviorPreviewStore.getState().setDiagnostics([]);
  };
}
