import { GENERATED_STARTER_BEHAVIOR_PLAN_ID, useProjectStore } from "../store/useProjectStore.ts";
import { getCatalogComponent } from "../data/catalog.ts";
import { isBoardDefinition } from "../data/hardware.ts";
import { validateFirmwareBindings, validateProject } from "../store/useValidationStore.ts";
import { isGeneratedAgentStarterDocument } from "./behaviorCommands.ts";
import { prepareBehaviorPlanReadiness } from "./behaviorReadiness.ts";
import { checkFirmware, MAX_FIRMWARE_CHECK_DURATION_MS } from "./firmwareCommands.ts";

export interface ProjectVerificationRequest {
  componentId?: string;
  durationMs?: number;
}

type VerificationFailure = {
  ok: false;
  error: { code: string; message: string; retryable: boolean };
  data?: Record<string, unknown>;
};

type VerificationSuccess = {
  ok: true;
  data: {
    projectId: string;
    overall: "ready" | "needs-attention" | "blocked";
    stages: {
      graph: Record<string, unknown> & { status: string };
      behavior: Record<string, unknown> & { status: string };
      source: Record<string, unknown> & { status: string };
      browserSourceCheck: Record<string, unknown> & { status: string };
      preflight: Record<string, unknown> & { status: string };
      compilation: { status: "not-performed"; reason: string };
      physicalHardware: { status: "not-verified"; reason: string };
    };
    claims: {
      sourceExecutedInBrowser: boolean;
      sourceCompiled: false;
      electricalBehaviorSimulated: false;
      uploadedToHardware: false;
      physicalHardwareVerified: false;
    };
    notice: string;
  };
};

export type ProjectVerificationResult = VerificationFailure | VerificationSuccess;

function fail(code: string, message: string, retryable = false, data?: Record<string, unknown>): VerificationFailure {
  return { ok: false, error: { code, message, retryable }, ...(data ? { data } : {}) };
}

function behaviorMappedComponentIds(project: ReturnType<typeof useProjectStore.getState>["project"]) {
  return project.components
    .filter((component) => Boolean(getCatalogComponent(component.definitionId)?.behavior))
    .map((component) => component.id);
}

function referencedBehaviorComponentIds(plan: { rules?: readonly any[]; cues?: readonly any[] }) {
  const ids = new Set<string>();
  for (const rule of plan.rules ?? []) {
    const trigger = rule?.when;
    if (trigger?.componentId) ids.add(String(trigger.componentId));
    for (const action of rule?.then ?? []) if (action?.componentId) ids.add(String(action.componentId));
  }
  for (const cue of plan.cues ?? []) if (cue?.action?.componentId) ids.add(String(cue.action.componentId));
  return ids;
}

export async function verifyProject(request: ProjectVerificationRequest = {}): Promise<ProjectVerificationResult> {
  const durationMs = request.durationMs ?? 1_000;
  if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > MAX_FIRMWARE_CHECK_DURATION_MS) {
    return fail("INVALID_PROJECT_VERIFY", `durationMs must be an integer from 0 to ${MAX_FIRMWARE_CHECK_DURATION_MS}.`);
  }
  if (request.componentId !== undefined && (typeof request.componentId !== "string" || !request.componentId.trim() || request.componentId.length > 200)) {
    return fail("INVALID_PROJECT_VERIFY", "componentId must be a bounded non-empty board instance id when provided.");
  }

  const state = useProjectStore.getState();
  const project = state.project;
  const graphResult = validateProject(project);
  const graphErrors = graphResult.issues.filter((issue) => issue.severity === "error");
  const graphWarnings = graphResult.issues.filter((issue) => issue.severity === "warning");
  const graphStage = {
    status: graphErrors.length ? "blocked" : "ready",
    valid: graphResult.valid,
    errors: graphErrors.length,
    warnings: graphWarnings.length,
    issues: graphResult.issues.slice(0, 20).map((issue) => ({ code: issue.code, severity: issue.severity, message: issue.message })),
  };

  const selectedPlan = state.getBehaviorPlan();
  let behaviorStage: Record<string, unknown> & { status: string };
  if (!selectedPlan) {
    behaviorStage = {
      status: behaviorMappedComponentIds(project).length ? "missing" : "not-applicable",
      planId: null,
      message: behaviorMappedComponentIds(project).length
        ? "Behavior-capable components exist, but no saved project-specific Behavior Plan is available."
        : "No mapped behavior components require a Behavior Plan.",
    };
  } else {
    const preparation = await prepareBehaviorPlanReadiness(project, selectedPlan);
    const mapped = behaviorMappedComponentIds(project);
    const referenced = referencedBehaviorComponentIds(selectedPlan);
    const uncovered = mapped.filter((componentId) => !referenced.has(componentId));
    const isStarter = selectedPlan.id === GENERATED_STARTER_BEHAVIOR_PLAN_ID;
    const preparationStatus = preparation.status;
    const status = preparationStatus === "blocked"
      ? "blocked"
      : isStarter
        ? "needs-review"
        : preparationStatus === "partial" || uncovered.length > 0
          ? "needs-review"
          : "ready";
    behaviorStage = {
      status,
      planId: selectedPlan.id,
      revision: selectedPlan.revision,
      generatedStarter: isStarter,
      preparationStatus,
      mappedComponentIds: mapped,
      coveredComponentIds: mapped.filter((componentId) => referenced.has(componentId)),
      uncoveredComponentIds: uncovered,
      diagnostics: preparation.diagnostics.slice(0, 20),
      ...(preparation.status === "ready" || preparation.status === "partial"
        ? {
            planSha256: preparation.prepared.planSha256,
            projectSha256: preparation.prepared.projectSha256,
            registrySha256: preparation.prepared.registrySha256,
          }
        : {}),
      message: isStarter
        ? "The generated starter Behavior Plan is a demo fallback and must be replaced with project-specific intended behavior before the build is behavior-complete."
        : uncovered.length
          ? "The saved Behavior Plan prepares, but not every mapped behavior component is referenced. Review coverage before declaring the behavior complete."
          : preparationStatus === "blocked"
            ? "The saved Behavior Plan no longer prepares against the current graph."
            : preparationStatus === "partial"
              ? "The saved Behavior Plan only partially prepares against the current graph."
              : "The saved project-specific Behavior Plan prepares against the current graph.",
    };
  }

  const boards = project.components.filter((component) => isBoardDefinition(getCatalogComponent(component.definitionId)));
  const targetBoards = request.componentId
    ? boards.filter((board) => board.id === request.componentId)
    : boards;
  if (request.componentId && targetBoards.length === 0) {
    return fail("PROJECT_VERIFY_TARGET_NOT_FOUND", `${request.componentId} is not a programmable board in the active project.`, false, { componentId: request.componentId });
  }

  const firmwareBindingIssues = validateFirmwareBindings(project);
  const firmwareBindingErrors = firmwareBindingIssues.filter((issue) => issue.severity === "error");
  const sourceTargets = targetBoards.map((board) => {
    const document = state.getCodeDocument(board.id);
    return {
      componentId: board.id,
      definitionId: board.definitionId,
      documentId: document?.id ?? null,
      contentSha256: document?.contentSha256 ?? null,
      starter: isGeneratedAgentStarterDocument(document),
      present: Boolean(document),
    };
  });
  const missingSourceIds = sourceTargets.filter((target) => !target.present).map((target) => target.componentId);
  const starterSourceIds = sourceTargets.filter((target) => target.starter).map((target) => target.componentId);
  const authoredSourceIds = sourceTargets.filter((target) => target.present && !target.starter).map((target) => target.componentId);
  const sourceStatus = targetBoards.length === 0
    ? "not-applicable"
    : firmwareBindingErrors.length
      ? "invalid-binding"
      : missingSourceIds.length
        ? "missing"
        : starterSourceIds.length
          ? "starter-source-present"
          : "editable-source-present";
  const sourceStage = {
    status: sourceStatus,
    boardCount: targetBoards.length,
    documentCount: sourceTargets.filter((target) => target.present).length,
    targets: sourceTargets,
    firmwareBindingIssues: firmwareBindingIssues.map((issue) => ({ code: issue.code, severity: issue.severity, message: issue.message, affectedComponents: issue.affectedComponents ?? [] })),
    missingComponentIds: missingSourceIds,
    starterComponentIds: starterSourceIds,
    authoredComponentIds: authoredSourceIds,
    message: sourceStatus === "invalid-binding"
      ? "At least one firmware compatibility target has a missing or mismatched board definition/FQBN binding. Repair the target metadata before relying on Browser Check or external compilation."
      : sourceStatus === "starter-source-present"
        ? "Marked generated starter source is present and Browser Check can inspect it, but it does not count as project-specific firmware."
        : sourceStatus === "missing"
          ? "At least one programmable board has no editable source document."
          : sourceStatus === "editable-source-present"
            ? "Every selected programmable board has project-specific editable source."
            : "No programmable board source is required for this project.",
  };

  const checkReports: Array<Record<string, unknown>> = [];
  let sourceExecutedInBrowser = false;
  for (const board of targetBoards) {
    const document = state.getCodeDocument(board.id);
    if (!document) continue;
    const checked = await checkFirmware({ componentId: board.id, durationMs });
    if (!checked.ok) {
      checkReports.push({ componentId: board.id, ok: false, code: checked.error.code, message: checked.error.message, ...(checked.data ? { details: checked.data } : {}) });
      continue;
    }
    sourceExecutedInBrowser ||= checked.data.claims.sourceCodeExecutedInBrowser;
    checkReports.push({
      componentId: board.id,
      ok: true,
      status: checked.data.status,
      preflight: checked.data.preflight,
      runtime: {
        status: checked.data.runtime.status,
        unsupportedApis: checked.data.runtime.unsupportedApis,
        serialOutput: checked.data.runtime.serialOutput,
      },
      claims: checked.data.claims,
    });
  }

  const failedChecks = checkReports.filter((report) => report.ok === false);
  const partialChecks = checkReports.filter((report) => report.ok === true && report.status === "browser-partial");
  const unavailableChecks = checkReports.filter((report) => report.ok === true && report.status === "browser-unavailable");
  const browserStatus = targetBoards.length === 0
    ? "not-applicable"
    : missingSourceIds.length
      ? "not-run"
      : failedChecks.length
        ? "failed"
        : partialChecks.length
          ? "partial"
          : unavailableChecks.length
            ? "unavailable"
            : "ready";
  const browserSourceCheckStage = {
    status: browserStatus,
    checkedBoards: checkReports.length,
    reports: checkReports,
    message: browserStatus === "ready"
      ? "Browser Check completed for the selected board source within its documented subset."
      : browserStatus === "partial"
        ? "Browser Check executed supported statements but reported unsupported constructs."
        : browserStatus === "failed"
          ? "Browser Check found source/preflight errors."
          : browserStatus === "unavailable"
            ? "The source language is editable but unavailable to Browser Check."
            : browserStatus === "not-run"
              ? "Browser Check could not run because editable source is missing."
              : "No programmable board requires Browser Check.",
  };

  const preflightFailures = checkReports.filter((report) => {
    if (report.ok !== true || !report.preflight || typeof report.preflight !== "object") return report.ok === false && report.code === "FIRMWARE_PREFLIGHT_FAILED";
    return (report.preflight as { status?: string }).status === "failed";
  });
  const preflightStage = {
    status: targetBoards.length === 0
      ? "not-applicable"
      : missingSourceIds.length
        ? "not-run"
        : preflightFailures.length
          ? "failed"
          : "ready",
    failures: preflightFailures.length,
    message: preflightFailures.length
      ? "Static source preflight found blocking source issues."
      : missingSourceIds.length
        ? "Static source preflight could not run because source is missing."
        : targetBoards.length
          ? "Static source preflight found no blocking syntax/shape issues within Browser Check's bounded rules."
          : "No programmable source requires preflight.",
  };

  const compilationStage = {
    status: "not-performed" as const,
    reason: "Schematic Browser Check is not a compiler. Compile with the target board SDK/toolchain for real compiler diagnostics.",
  };
  const physicalHardwareStage = {
    status: "not-verified" as const,
    reason: "Physical wiring, upload, electrical behavior, and hardware operation require the real board and connected hardware.",
  };

  const blocked = graphStage.status === "blocked"
    || behaviorStage.status === "blocked"
    || sourceStage.status === "invalid-binding"
    || browserSourceCheckStage.status === "failed"
    || preflightStage.status === "failed";
  const needsAttention = behaviorStage.status === "missing"
    || behaviorStage.status === "needs-review"
    || sourceStage.status === "missing"
    || sourceStage.status === "starter-source-present"
    || browserSourceCheckStage.status === "partial"
    || browserSourceCheckStage.status === "unavailable"
    || browserSourceCheckStage.status === "not-run";
  const overall: "ready" | "needs-attention" | "blocked" = blocked ? "blocked" : needsAttention ? "needs-attention" : "ready";

  return {
    ok: true,
    data: {
      projectId: project.id,
      overall,
      stages: {
        graph: graphStage,
        behavior: behaviorStage,
        source: sourceStage,
        browserSourceCheck: browserSourceCheckStage,
        preflight: preflightStage,
        compilation: compilationStage,
        physicalHardware: physicalHardwareStage,
      },
      claims: {
        sourceExecutedInBrowser,
        sourceCompiled: false,
        electricalBehaviorSimulated: false,
        uploadedToHardware: false,
        physicalHardwareVerified: false,
      },
      notice: "Verification separates static graph checks, Behavior Plan readiness, editable source coverage, bounded Browser Check, real compilation, and physical hardware. Browser Check does not imply compilation or physical verification.",
    },
  };
}
