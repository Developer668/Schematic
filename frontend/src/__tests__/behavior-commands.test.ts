import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BehaviorPlanV1 } from "@schematic/behavior";
import { getRegisteredToolNames, invokeWebMCPTool, WEBMCP_TOOL_COUNT } from "../webmcp/tools.ts";
import {
  exportCode,
  getBehaviorState,
  pauseBehavior,
  previewBehavior,
  resetBehavior,
  resumeBehavior,
  seekBehavior,
  writeBehaviorPlan,
  writeCode,
} from "../application/behaviorCommands.ts";
import { normalizeProject, useProjectStore, type HardwareGraph } from "../store/useProjectStore.ts";
import { MAX_CODE_DOCUMENTS_PER_PROJECT } from "../store/behaviorPersistence.ts";
import { useBehaviorPreviewStore } from "../behavior/useBehaviorPreviewStore.ts";
import { getAuthSession } from "../auth/session.ts";
import { beginPendingPersistenceContext, clearPersistenceGate } from "../store/persistenceGate.ts";

function graph(id = "behavior-project"): HardwareGraph {
  const timestamp = new Date(0).toISOString();
  return {
    id,
    name: id,
    components: [
      { id: "board-1", definitionId: "arduino-uno", position: { x: 0, y: 0 }, rotation: 0, properties: {} },
      { id: "button-1", definitionId: "pushbutton", position: { x: 400, y: 0 }, rotation: 0, properties: {} },
      { id: "led-1", definitionId: "led", position: { x: 800, y: 0 }, rotation: 0, properties: {} },
    ],
    connections: [],
    firmwareTargets: [],
    behaviorPlans: [],
    codeDocuments: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
  };
}

function buttonLedPlan(name = "Button LED"): BehaviorPlanV1 {
  return {
    schemaVersion: 1,
    id: "plan-1",
    projectId: "behavior-project",
    name,
    revision: 1,
    rules: [{
      id: "button-on",
      enabled: true,
      when: {
        type: "component.event",
        componentId: "button-1",
        definitionId: "pushbutton",
        eventId: "button.pressed",
      },
      then: [{
        componentId: "led-1",
        definitionId: "led",
        actionId: "indicator.set",
        payload: { kind: "literal", value: { on: true } },
      }],
    }],
  };
}

const source = "// editable source\nvoid setup() {}\nvoid loop() {}\n";

function setGraph(next = graph()) {
  useProjectStore.setState({ project: next, projects: [next], activeProjectId: next.id });
}

beforeEach(async () => {
  // Resolve the one-time auth event before installing the fixture. Otherwise
  // the first direct WebMCP invocation can reload an old localStorage room
  // between the command and tool parity assertions.
  localStorage.clear();
  await getAuthSession();
  setGraph();
  useBehaviorPreviewStore.getState().resetPreview();
});

afterEach(() => {
  useBehaviorPreviewStore.getState().resetPreview();
  setGraph(graph("test-cleanup"));
  localStorage.clear();
});

describe("Behavior Preview application commands", () => {
  it("requires an explicit revision precondition for create, replace, and conflict-safe writes", async () => {
    // Deliberately bypass the TypeScript signature to prove the runtime
    // command boundary rejects callers that omit the precondition.
    const omitted = await writeBehaviorPlan(buttonLedPlan(), undefined as unknown as number | null);
    expect(omitted).toMatchObject({ ok: false, error: { code: "PLAN_REVISION_REQUIRED" } });
    expect(useProjectStore.getState().project.behaviorPlans).toEqual([]);

    const created = await writeBehaviorPlan(buttonLedPlan(), null);
    expect(created).toMatchObject({ ok: true, data: { replaced: false, revision: 1 } });
    if (!created.ok) return;

    const createOnlyAgainstExisting = await writeBehaviorPlan(buttonLedPlan("Create only"), null);
    expect(createOnlyAgainstExisting).toMatchObject({
      ok: false,
      error: { code: "PLAN_CONFLICT", retryable: true },
      data: { expectedRevision: null, currentRevision: 1, planId: "plan-1" },
    });

    const replaced = await writeBehaviorPlan(buttonLedPlan("Replaced"), created.data.revision);
    expect(replaced).toMatchObject({ ok: true, data: { replaced: true, revision: 2 } });
    if (!replaced.ok) return;

    const stale = await writeBehaviorPlan(buttonLedPlan("Stale"), created.data.revision);
    expect(stale).toMatchObject({
      ok: false,
      error: { code: "PLAN_CONFLICT", retryable: true },
      data: { expectedRevision: 1, currentRevision: 2, planId: "plan-1" },
    });
    expect(useProjectStore.getState().getBehaviorPlan("plan-1")?.name).toBe("Replaced");
  });

  it("keeps a stale exact-replace plan write from recreating a deleted plan", async () => {
    expect((await writeBehaviorPlan(buttonLedPlan(), null)).ok).toBe(true);
    const currentProject = useProjectStore.getState().project;
    const deletedProject = { ...currentProject, behaviorPlans: [] };
    useProjectStore.setState({ project: deletedProject, projects: [deletedProject], activeProjectId: deletedProject.id });

    // Exercise the store boundary directly: the application command's early
    // read check is intentionally not the only safety net for typed callers.
    const result = useProjectStore.getState().writeBehaviorPlan(buttonLedPlan("stale replace"), 1);
    expect(result).toMatchObject({ replaced: false, conflict: { deleted: true } });
    expect(useProjectStore.getState().getBehaviorPlan("plan-1")).toBeUndefined();
  });

  it("keeps reset idle without a session and resumes from the paused logical time", async () => {
    const freshReset = await resetBehavior();
    expect(freshReset).toMatchObject({ ok: true, data: { status: "idle", snapshot: null } });

    expect((await writeBehaviorPlan(buttonLedPlan(), null)).ok).toBe(true);
    const started = await previewBehavior("plan-1", "block", 1_500);
    expect(started).toMatchObject({ ok: true, data: { status: "playing", durationMs: 1_500 } });
    const sought = await seekBehavior(600);
    expect(sought.ok).toBe(true);
    if (!sought.ok) return;
    expect(sought.data.snapshot.logicalTimeMs).toBe(600);
    expect((await pauseBehavior()).data?.status).toBe("paused");
    const resumed = await resumeBehavior();
    expect(resumed).toMatchObject({ ok: true, data: { status: "playing", durationMs: 1_500 } });
    if (!resumed.ok) return;
    expect(resumed.data.snapshot.logicalTimeMs).toBe(600);
    const completed = await seekBehavior(1_500);
    expect(completed).toMatchObject({ ok: true, data: { status: "ready", durationMs: 1_500 } });
    await pauseBehavior();
    expect(await resumeBehavior()).toMatchObject({ ok: true, data: { status: "ready", durationMs: 1_500 } });
  });

  it("keeps reset available while the authenticated room is hydrating", async () => {
    beginPendingPersistenceContext();
    try {
      // Reset is an in-memory preview clear, so an auth-room transition must
      // not turn it into a persistence error or leave the old session visible.
      expect(await resetBehavior()).toMatchObject({ ok: true, data: { status: "idle", snapshot: null } });
    } finally {
      clearPersistenceGate();
    }
  });

  it("keeps the code lifecycle optimistic, editable, and honest", async () => {
    const planResult = await writeBehaviorPlan(buttonLedPlan(), null);
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;

    const previewResult = await previewBehavior("plan-1");
    expect(previewResult.ok).toBe(true);
    if (!previewResult.ok) return;
    const initialSnapshotHash = previewResult.data.snapshot.snapshotSha256;

    const created = await writeCode({
      targetComponentId: "board-1",
      files: [{ name: "sketch.ino", content: source }],
      language: "arduino",
      expectedContentSha256: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.replaced).toBe(false);
    expect(created.data.document.contentSha256).toBeTruthy();
    expect(created.data.document.inAppVerification).toBe("not-performed");
    expect(created.data.claims.sourceCodeCompiled).toBe(false);

    const beforeConflict = JSON.stringify(useProjectStore.getState().getCodeDocument("board-1"));
    const conflict = await writeCode({
      targetComponentId: "board-1",
      files: [{ name: "sketch.ino", content: `${source}// rejected write\n` }],
      language: "arduino",
      expectedContentSha256: "0".repeat(64),
    });
    expect(conflict.ok).toBe(false);
    if (conflict.ok) return;
    expect(conflict.error.code).toBe("SOURCE_CONFLICT");
    expect(JSON.stringify(useProjectStore.getState().getCodeDocument("board-1"))).toBe(beforeConflict);

    const unsafePath = await writeCode({
      targetComponentId: "board-1",
      files: [{ name: "src/..", content: source }],
      language: "arduino",
      expectedContentSha256: created.data.document.contentSha256,
    });
    expect(unsafePath.ok).toBe(false);
    if (!unsafePath.ok) expect(unsafePath.error.code).toBe("INVALID_CODE_FILENAME");

    const tooManyDependencies = await writeCode({
      targetComponentId: "board-1",
      files: [{ name: "sketch.ino", content: source }],
      language: "arduino",
      expectedContentSha256: created.data.document.contentSha256,
      dependencies: Array.from({ length: 257 }, (_, index) => ({ ecosystem: "other" as const, name: `dependency-${index}` })),
    });
    expect(tooManyDependencies.ok).toBe(false);
    if (!tooManyDependencies.ok) expect(tooManyDependencies.error.code).toBe("CODE_DEPENDENCY_LIMIT_EXCEEDED");

    const linked = await writeCode({
      targetComponentId: "board-1",
      files: [{ name: "sketch.ino", content: source }],
      language: "arduino",
      expectedContentSha256: created.data.document.contentSha256,
      linkToBehaviorPlan: {
        planId: "plan-1",
        planSha256: planResult.data.planSha256,
        projectSha256: planResult.data.projectSha256,
      },
    });
    expect(linked.ok).toBe(true);
    if (!linked.ok) return;
    expect(linked.data.document.previewLink.status).toBe("linked");

    // Editing source is independent of preview. It marks the old relation
    // stale, but the active typed reducer and its snapshot remain unchanged.
    const edited = await writeCode({
      targetComponentId: "board-1",
      files: [{ name: "sketch.ino", content: `${source}// human edit\n` }],
      language: "arduino",
      origin: "human-authored",
      expectedContentSha256: linked.data.document.contentSha256,
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.data.document.origin).toBe("human-authored");
    expect(edited.data.document.previewLink.status).toBe("stale");
    if (edited.data.document.previewLink.status === "stale") expect(edited.data.document.previewLink.changed).toContain("code");

    const stateAfterCodeEdit = await getBehaviorState();
    expect(stateAfterCodeEdit.ok).toBe(true);
    if (!stateAfterCodeEdit.ok) return;
    expect(stateAfterCodeEdit.data.snapshot?.snapshotSha256).toBe(initialSnapshotHash);
    expect(stateAfterCodeEdit.data.claims.sourceCodeExecuted).toBe(false);

    const exported = await exportCode("board-1");
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.data.manifest.claims).toEqual({
      builtInSchematic: false,
      compiledInSchematic: false,
      executedInSchematic: false,
      uploadedBySchematic: false,
      physicallyTestedBySchematic: false,
    });
    expect(exported.data.manifest.files[0]?.sha256).toBeTruthy();
    expect(exported.data.manifest.sourceSha256).toBe(edited.data.document.contentSha256);
    expect(exported.data.document.exportHistory).toHaveLength(1);
    expect(exported.data.document.exportHistory[0]?.format).toBe("handoff-manifest");
    expect(JSON.parse(exported.data.manifestJson).sourceSha256).toBe(exported.data.manifest.sourceSha256);
  });

  it("reports a missing durable source as an explicit delete conflict", async () => {
    const created = await writeCode({
      targetComponentId: "board-1",
      files: [{ name: "sketch.ino", content: source }],
      language: "arduino",
      expectedContentSha256: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const currentProject = useProjectStore.getState().project;
    const deletedProject = { ...currentProject, codeDocuments: [], firmwareTargets: [] };
    useProjectStore.setState({ project: deletedProject, projects: [deletedProject], activeProjectId: deletedProject.id });

    const result = await writeCode({
      targetComponentId: "board-1",
      files: [{ name: "sketch.ino", content: `${source}// local draft\n` }],
      language: "arduino",
      expectedContentSha256: created.data.document.contentSha256,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "SOURCE_CONFLICT", retryable: true },
      data: { sourceDeleted: true, current: undefined },
    });
    expect(useProjectStore.getState().getCodeDocument("board-1")).toBeUndefined();
  });

  it("invalidates linked source on semantic plan/graph changes but not canvas layout", async () => {
    const writtenPlan = await writeBehaviorPlan(buttonLedPlan(), null);
    expect(writtenPlan.ok).toBe(true);
    if (!writtenPlan.ok) return;
    const writtenCode = await writeCode({
      targetComponentId: "board-1",
      files: [{ name: "sketch.ino", content: source }],
      language: "arduino",
      expectedContentSha256: null,
      linkToBehaviorPlan: {
        planId: "plan-1",
        planSha256: writtenPlan.data.planSha256,
        projectSha256: writtenPlan.data.projectSha256,
      },
    });
    expect(writtenCode.ok).toBe(true);
    if (!writtenCode.ok) return;
    expect(writtenCode.data.document.previewLink.status).toBe("linked");

    const changedPlan = await writeBehaviorPlan(buttonLedPlan("Renamed plan"), writtenPlan.data.revision);
    expect(changedPlan.ok).toBe(true);
    if (!changedPlan.ok) return;
    const afterPlan = useProjectStore.getState().getCodeDocument("board-1");
    expect(afterPlan?.previewLink.status).toBe("stale");
    if (afterPlan?.previewLink.status === "stale") expect(afterPlan.previewLink.changed).toContain("plan");
    expect(afterPlan).toBeTruthy();
    if (!afterPlan) return;

    const relinked = await writeCode({
      targetComponentId: "board-1",
      files: [{ name: "sketch.ino", content: source }],
      language: "arduino",
      expectedContentSha256: afterPlan.contentSha256,
      linkToBehaviorPlan: {
        planId: "plan-1",
        planSha256: changedPlan.data.planSha256,
        projectSha256: changedPlan.data.projectSha256,
      },
    });
    expect(relinked.ok).toBe(true);
    if (!relinked.ok) return;

    const started = await previewBehavior("plan-1");
    expect(started.ok).toBe(true);
    const beforeMove = await getBehaviorState();
    expect(beforeMove.ok).toBe(true);
    if (!beforeMove.ok) return;
    useProjectStore.getState().moveComponent("led-1", { x: 900, y: 100 });
    const afterMove = useProjectStore.getState().getCodeDocument("board-1");
    expect(afterMove?.previewLink.status).toBe("linked");
    const previewAfterMove = await getBehaviorState();
    expect(previewAfterMove.ok).toBe(true);
    if (!previewAfterMove.ok) return;
    expect(previewAfterMove.data?.snapshot?.snapshotSha256).toBe(beforeMove.data?.snapshot?.snapshotSha256);

    useProjectStore.getState().updateComponentProps("led-1", { mode: "semantic-change" });
    const afterGraph = useProjectStore.getState().getCodeDocument("board-1");
    expect(afterGraph?.previewLink.status).toBe("stale");
    if (afterGraph?.previewLink.status === "stale") expect(afterGraph.previewLink.changed).toContain("project");
  });

  it("isolates preview sessions when switching projects", async () => {
    const written = await writeBehaviorPlan(buttonLedPlan(), null);
    expect(written.ok).toBe(true);
    const started = await previewBehavior("plan-1");
    expect(started.ok).toBe(true);
    const projectA = useProjectStore.getState().project.id;

    const projectB = useProjectStore.getState().createProject("Project B");
    expect(projectB).not.toBe(projectA);
    const isolated = await getBehaviorState();
    expect(isolated.ok).toBe(true);
    if (!isolated.ok) return;
    expect(isolated.data.projectId).toBe(projectB);
    expect(isolated.data.snapshot).toBeNull();
    expect(isolated.data.planId).toBeNull();

    expect(useProjectStore.getState().switchProject(projectA)).toBe(true);
    expect((await getBehaviorState()).data?.snapshot ?? null).toBeNull();
  });

  it("does not install a prepared session after its project is superseded", async () => {
    expect((await writeBehaviorPlan(buttonLedPlan(), null)).ok).toBe(true);
    const pending = previewBehavior("plan-1");
    setGraph(graph("replacement-project"));
    const result = await pending;
    expect(result).toMatchObject({ ok: false, error: { code: "PREVIEW_REQUEST_SUPERSEDED" } });
    const state = await getBehaviorState();
    expect(state).toMatchObject({ ok: true, data: { projectId: "replacement-project", status: "idle", snapshot: null } });
  });

  it("does not write a validated plan after its project is superseded", async () => {
    const pending = writeBehaviorPlan(buttonLedPlan(), null);
    setGraph(graph("replacement-project"));
    const result = await pending;
    expect(result).toMatchObject({ ok: false, error: { code: "PLAN_CONTEXT_CHANGED" } });
    expect(useProjectStore.getState().project.behaviorPlans).toEqual([]);
  });

  it("lets pause and reset invalidate a preview that is still preparing", async () => {
    expect((await writeBehaviorPlan(buttonLedPlan(), null)).ok).toBe(true);

    const pendingPause = previewBehavior("plan-1");
    await pauseBehavior();
    expect(await pendingPause).toMatchObject({ ok: false, error: { code: "PREVIEW_REQUEST_SUPERSEDED" } });
    expect((await getBehaviorState()).data?.snapshot ?? null).toBeNull();

    const pendingReset = previewBehavior("plan-1");
    await resetBehavior();
    expect(await pendingReset).toMatchObject({ ok: false, error: { code: "PREVIEW_REQUEST_SUPERSEDED" } });
    expect((await getBehaviorState()).data?.snapshot ?? null).toBeNull();
  });
});

describe("project migration and WebMCP surface", () => {
  it("quarantines legacy simulation/artifacts while migrating editable source", () => {
    const legacy = {
      ...graph("legacy-project"),
      behaviorPlans: [{ schemaVersion: 2, id: "future.plan", opaque: { keep: true } }],
      simulation: { mode: "interactive", engines: { legacy: { enabled: true, fidelity: "high" } } },
      firmwareTargets: [{
        id: "fw-1",
        componentId: "board-1",
        definitionId: "arduino-uno",
        language: "arduino",
        boardFqbn: "arduino:avr:uno",
        files: [{ name: "sketch.ino", content: source }],
        compiledArtifact: { success: true, log: "legacy build" },
      }],
    };
    const normalized = normalizeProject(legacy);
    expect(normalized.simulation).toBeUndefined();
    expect(normalized.firmwareTargets[0]).not.toHaveProperty("compiledArtifact");
    expect(normalized.codeDocuments?.[0]?.origin).toBe("imported");
    expect(normalized.codeDocuments?.[0]?.contentSha256).toBeTruthy();
    expect(normalized.legacyBehaviorData?.legacySimulation).toEqual(legacy.simulation);
    expect(normalized.legacyBehaviorData?.compiledArtifacts).toHaveLength(1);
    expect(normalized.legacyBehaviorData?.unsupportedBehaviorPlans).toEqual(legacy.behaviorPlans);
  });

  it("never exceeds the combined code-document cap while migrating legacy targets", () => {
    const components = Array.from({ length: MAX_CODE_DOCUMENTS_PER_PROJECT }, (_, index) => ({ id: `board-${index}`, definitionId: "arduino-uno", position: { x: index * 10, y: 0 }, rotation: 0, properties: {} }));
    const raw = {
      ...graph("migration-cap"),
      components,
      codeDocuments: components.map((component, index) => ({
        schemaVersion: 1,
        id: `code-${index}`,
        projectId: "migration-cap",
        targetComponentId: component.id,
        targetDefinitionId: component.definitionId,
        language: "arduino",
        files: [{ name: "sketch.ino", content: "" }],
      })),
      firmwareTargets: components.map((component, index) => ({ id: `legacy-${index}`, componentId: component.id, definitionId: component.definitionId, files: [{ name: "legacy.ino", content: "" }] })),
    };
    expect(normalizeProject(raw).codeDocuments).toHaveLength(MAX_CODE_DOCUMENTS_PER_PROJECT);
  });

  it("keeps registration and direct command/tool results in parity", async () => {
    const names = getRegisteredToolNames();
    expect(WEBMCP_TOOL_COUNT).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining([
      "behavior.get_capabilities",
      "behavior.plan.write",
      "behavior.preview",
      "behavior.invoke",
      "behavior.get_state",
      "code.write",
      "code.read",
      "code.export",
    ]));
    expect(names.some((name) => name.startsWith("simulation."))).toBe(false);
    expect(names).not.toContain("firmware.compile");

    const throughTool = await invokeWebMCPTool("behavior.get_state", { detail: "full" });
    const direct = await getBehaviorState();
    expect(throughTool.isError).not.toBe(true);
    expect(throughTool.data).toMatchObject(direct.ok ? direct.data : {});
  });

  it("preserves omitted dependencies and rejects malformed code file content", async () => {
    const created = await writeCode({
      targetComponentId: "board-1",
      files: [{ name: "sketch.ino", content: source }],
      language: "arduino",
      dependencies: [{ ecosystem: "arduino-library", name: "Adafruit GFX Library", version: "1.11.11" }],
      expectedContentSha256: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const beforeMissingPrecondition = useProjectStore.getState().getCodeDocument("board-1");
    const omittedPrecondition = await invokeWebMCPTool("code.write", {
      targetComponentId: "board-1",
      files: [{ name: "sketch.ino", content: "// must not overwrite" }],
      language: "arduino",
    });
    expect(omittedPrecondition.isError).toBe(true);
    expect(omittedPrecondition.error?.code).toBe("SOURCE_PRECONDITION_REQUIRED");
    expect(useProjectStore.getState().getCodeDocument("board-1")?.contentSha256).toBe(beforeMissingPrecondition?.contentSha256);

    const omittedFirmwarePrecondition = await invokeWebMCPTool("firmware.write", {
      componentId: "board-1",
      files: [{ name: "sketch.ino", content: "// alias must not overwrite" }],
    });
    expect(omittedFirmwarePrecondition.isError).toBe(true);
    expect(omittedFirmwarePrecondition.error?.code).toBe("SOURCE_PRECONDITION_REQUIRED");
    expect(useProjectStore.getState().getCodeDocument("board-1")?.contentSha256).toBe(beforeMissingPrecondition?.contentSha256);

    const rewritten = await invokeWebMCPTool("code.write", {
      targetComponentId: "board-1",
      files: [{ name: "sketch.ino", content: `${source}// revised\n` }],
      language: "arduino",
      expectedContentSha256: created.data.document.contentSha256,
    });
    expect(rewritten.isError).not.toBe(true);
    expect(useProjectStore.getState().getCodeDocument("board-1")?.dependencies).toEqual(created.data.document.dependencies);

    const beforeMalformed = useProjectStore.getState().getCodeDocument("board-1");
    const malformed = await invokeWebMCPTool("code.write", {
      targetComponentId: "board-1",
      files: [{ name: "sketch.ino", content: 42 }],
      language: "arduino",
      expectedContentSha256: beforeMalformed?.contentSha256,
    });
    expect(malformed.isError).toBe(true);
    expect(malformed.error?.code).toBe("INVALID_CODE_FILE");
    expect(useProjectStore.getState().getCodeDocument("board-1")?.contentSha256).toBe(beforeMalformed?.contentSha256);
  });

  it("runs the same typed event path exposed by behavior.invoke", async () => {
    const written = await writeBehaviorPlan(buttonLedPlan(), null);
    expect(written.ok).toBe(true);
    const started = await invokeWebMCPTool("behavior.preview", { planId: "plan-1", durationMs: 1_200 });
    expect(started.isError).not.toBe(true);
    expect(useBehaviorPreviewStore.getState()).toMatchObject({ status: "playing", durationMs: 1_200 });
    expect(useBehaviorPreviewStore.getState().snapshot?.sourceCodeExecution).toBe("none");
    const result = await invokeWebMCPTool("behavior.invoke", {
      componentId: "button-1",
      definitionId: "pushbutton",
      eventId: "button.pressed",
      payload: { pressed: true },
    });
    expect(result.isError).not.toBe(true);
    expect(result.data.status).toBe("accepted");
    expect(result.data.durationMs).toBe(1_200);
    expect(result.data.snapshot.components["led-1"].primitives[0]).toMatchObject({ kind: "indicator", on: true });
    expect(result.data.claims.sourceCodeExecuted).toBe(false);
    expect(useBehaviorPreviewStore.getState().snapshot?.components["led-1"].primitives[0]).toMatchObject({ kind: "indicator", on: true });
    expect(useBehaviorPreviewStore.getState().status).toBe("playing");
  });

  it("clears the active session and canvas after a failed preview request", async () => {
    expect((await writeBehaviorPlan(buttonLedPlan(), null)).ok).toBe(true);
    expect((await invokeWebMCPTool("behavior.preview", { planId: "plan-1" })).isError).not.toBe(true);
    expect(useBehaviorPreviewStore.getState().snapshot).not.toBeNull();

    const missing = await invokeWebMCPTool("behavior.preview", { planId: "missing-plan" });
    expect(missing.isError).toBe(true);
    expect(missing.error?.code).toBe("BEHAVIOR_PLAN_NOT_FOUND");
    expect(useBehaviorPreviewStore.getState()).toMatchObject({ status: "blocked", snapshot: null, durationMs: 1_000 });
    expect((await getBehaviorState()).data?.snapshot ?? null).toBeNull();
  });

  it("keeps a paused playback state when a typed action is rejected", async () => {
    expect((await writeBehaviorPlan(buttonLedPlan(), null)).ok).toBe(true);
    expect((await invokeWebMCPTool("behavior.preview", { planId: "plan-1", durationMs: 1_200 })).isError).not.toBe(true);
    await seekBehavior(400);
    await pauseBehavior();

    const rejected = await invokeWebMCPTool("behavior.invoke", {
      componentId: "led-1",
      definitionId: "led",
      actionId: "indicator.set",
      payload: { kind: "literal", value: { on: "not-a-boolean" } },
    });
    expect(rejected.isError).not.toBe(true);
    expect(rejected.data.status).toBe("rejected");
    expect(useBehaviorPreviewStore.getState().status).toBe("paused");
    expect(useBehaviorPreviewStore.getState().snapshot?.logicalTimeMs).toBe(400);
    expect((await getBehaviorState()).data?.status).toBe("paused");
  });

  it("rejects ambiguous direct behavior.invoke executor input", async () => {
    const result = await invokeWebMCPTool("behavior.invoke", {
      componentId: "button-1",
      definitionId: "pushbutton",
      eventId: "button.pressed",
      actionId: "button.setPressed",
      payload: { kind: "literal", value: { pressed: true } },
    });
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe("INVALID_BEHAVIOR_REQUEST");
  });
});
