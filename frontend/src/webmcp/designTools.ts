import { sha256, type BehaviorPlanV1 } from "@schematic/behavior";
import { writeBehaviorPlan } from "../application/behaviorCommands.ts";
import { ensureAgentBuildArtifacts } from "../application/agentBuildArtifacts.ts";
import { verifyProject } from "../application/projectVerification.ts";
import { getCatalogComponent } from "../data/catalog.ts";
import { useProjectStore, type HardwareGraph } from "../store/useProjectStore.ts";
import { useSelectionStore } from "../store/useSelectionStore.ts";
import { useValidationStore, validateProject } from "../store/useValidationStore.ts";

export interface DesignWebMCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; consequentialHint?: boolean; untrustedContentHint?: boolean };
  execute: (args: any) => Promise<any>;
}

type CalculatorProposal = {
  id: string;
  kind: "calculator";
  projectId: string;
  projectSha256: string;
  goal: string;
  createdAt: string;
  components: readonly [
    { alias: "board"; definitionId: "arduino-uno" },
    { alias: "keypad"; definitionId: "membrane-keypad" },
    { alias: "display"; definitionId: "lcd1602-i2c" },
  ];
  wiring: readonly { from: string; to: string }[];
};

type DesignHistoryEntry = { projectId: string; label: string; snapshot: HardwareGraph; recordedAt: string };

const MAX_HISTORY = 20;
let activeProposal: CalculatorProposal | null = null;
let undoStack: DesignHistoryEntry[] = [];
let redoStack: DesignHistoryEntry[] = [];
let fullToolCount = 0;

export function setDesignSurfaceFullCount(count: number) {
  fullToolCount = Number.isSafeInteger(count) && count > 0 ? count : 0;
}

function cloneProject<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function projectHash(project = useProjectStore.getState().project) {
  return sha256(project);
}

function proposalId() {
  return `proposal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function jsonResult(data: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(data) }], data };
}

function failure(code: string, message: string, data: Record<string, unknown> = {}, retryable = false) {
  return { content: [{ type: "text", text: JSON.stringify({ code, message, ...data }) }], isError: true, error: { code, message, retryable }, data: { code, ...data } };
}

function restoreSnapshot(snapshot: HardwareGraph) {
  const current = useProjectStore.getState();
  const restored = cloneProject(snapshot);
  useProjectStore.setState({
    project: restored,
    projects: current.projects.map((project) => project.id === restored.id ? restored : project),
    activeProjectId: restored.id,
  });
  useProjectStore.getState().saveProject();
  useSelectionStore.getState().clear();
  useValidationStore.getState().setResult(validateProject(restored));
}

export function recordDesignMutation(label: string, before: HardwareGraph) {
  undoStack.push({ projectId: before.id, label, snapshot: cloneProject(before), recordedAt: new Date().toISOString() });
  if (undoStack.length > MAX_HISTORY) undoStack = undoStack.slice(-MAX_HISTORY);
  redoStack = [];
}

function calculatorWiring() {
  return [
    { from: "board.D2", to: "keypad.R1" },
    { from: "board.D3", to: "keypad.R2" },
    { from: "board.D4", to: "keypad.R3" },
    { from: "board.D5", to: "keypad.R4" },
    { from: "board.D6", to: "keypad.C1" },
    { from: "board.D7", to: "keypad.C2" },
    { from: "board.D8", to: "keypad.C3" },
    { from: "board.D9", to: "keypad.C4" },
    { from: "board.5V", to: "display.VCC" },
    { from: "board.GND", to: "display.GND" },
    { from: "board.SDA", to: "display.SDA" },
    { from: "board.SCL", to: "display.SCL" },
  ] as const;
}

function buildCalculatorPreview(base: HardwareGraph) {
  const components = [
    { id: "proposal-board", definitionId: "arduino-uno", position: { x: 160, y: 240 }, rotation: 0, properties: {} },
    { id: "proposal-keypad", definitionId: "membrane-keypad", position: { x: 500, y: 240 }, rotation: 0, properties: {} },
    { id: "proposal-display", definitionId: "lcd1602-i2c", position: { x: 850, y: 240 }, rotation: 0, properties: {} },
  ];
  const endpoint = (alias: string) => {
    const [component, port] = alias.split(".");
    const componentId = component === "board" ? "proposal-board" : component === "keypad" ? "proposal-keypad" : "proposal-display";
    return { componentId, portId: port };
  };
  const connections = calculatorWiring().map((wire, index) => ({
    id: `proposal-connection-${index + 1}`,
    source: endpoint(wire.from),
    target: endpoint(wire.to),
    domain: getCatalogComponent(endpoint(wire.from).componentId === "proposal-board" ? "arduino-uno" : endpoint(wire.from).componentId === "proposal-keypad" ? "membrane-keypad" : "lcd1602-i2c")?.ports.find((port) => port.id === endpoint(wire.from).portId)?.domain ?? "gpio",
  }));
  return { ...cloneProject(base), components, connections, behaviorPlans: [], codeDocuments: [], firmwareTargets: [] } as HardwareGraph;
}

function calculatorPlan(projectId: string, keypadId: string, displayId: string): BehaviorPlanV1 {
  return {
    schemaVersion: 1,
    id: "calculator-interaction-v1",
    projectId,
    name: "Interactive calculator",
    intent: "Membrane keypad input deterministically updates calculator state and forwards the visible result to the LCD.",
    revision: 1,
    rules: [
      {
        id: "calculator-initial-display",
        enabled: true,
        when: { type: "preview.started" },
        then: [{ componentId: displayId, definitionId: "lcd1602-i2c", actionId: "display.showText", payload: { kind: "literal", value: { text: "0" } } }],
      },
      {
        id: "calculator-display-from-keypad",
        enabled: true,
        when: { type: "component.event", componentId: keypadId, definitionId: "membrane-keypad", eventId: "keypad.displayChanged" },
        then: [{ componentId: displayId, definitionId: "lcd1602-i2c", actionId: "display.showText", payload: { kind: "trigger-payload", select: "$.value" } }],
      },
    ],
  };
}

function currentStage() {
  const project = useProjectStore.getState().project;
  if (activeProposal?.projectId === project.id) return "proposal";
  if (project.components.length === 0) return "empty";
  const validation = validateProject(project);
  if (!project.connections.length) return "parts";
  if (!validation.valid) return "repair";
  if (!(project.behaviorPlans ?? []).length) return "behavior";
  return "verify";
}

function recommendedTools(stage: string) {
  if (stage === "proposal") return ["design.preview", "design.apply", "design.discard", "project.get_graph"];
  if (stage === "empty") return ["design.propose", "project.apply_blueprint", "component.search", "project.get_graph"];
  if (stage === "parts") return ["component.list_ports", "connection.connect", "validation.check", "design.undo"];
  if (stage === "repair") return ["validation.check", "validation.explain_error", "connection.get_connections", "connection.connect", "design.undo"];
  if (stage === "behavior") return ["behavior.get_capabilities", "behavior.plan.write", "behavior.preview", "design.undo"];
  return ["design.verify", "project.verify", "behavior.preview", "behavior.press_key", "firmware.check", "design.undo"];
}

export const designToolDefinitions: readonly DesignWebMCPTool[] = [
  {
    name: "design.propose",
    description: "Stage a non-mutating goal-level hardware proposal. Calculator/math requests produce the reviewed Arduino + membrane keypad + I2C LCD workflow; use design.preview before design.apply.",
    inputSchema: { type: "object", properties: { goal: { type: "string", minLength: 1, maxLength: 500 } }, required: ["goal"], additionalProperties: false },
    execute: async ({ goal }) => {
      if (typeof goal !== "string" || !goal.trim() || goal.length > 500) return failure("INVALID_DESIGN_GOAL", "goal must be a non-empty string of at most 500 characters.");
      if (!/(calculat|\bmath\b|arithmetic)/i.test(goal)) return failure("UNSUPPORTED_PROPOSAL", "This release only has a reviewed goal-level proposal template for the calculator workflow. Use component.search plus primitive graph tools for other designs.", { supportedTemplate: "calculator" });
      const project = useProjectStore.getState().project;
      if (project.components.length) return failure("PROJECT_NOT_EMPTY", "The reviewed calculator proposal applies to an empty active project so it cannot overwrite existing work. Create a new project or clear one explicitly first.", { projectId: project.id });
      activeProposal = {
        id: proposalId(), kind: "calculator", projectId: project.id, projectSha256: projectHash(project), goal: goal.trim(), createdAt: new Date().toISOString(),
        components: [{ alias: "board", definitionId: "arduino-uno" }, { alias: "keypad", definitionId: "membrane-keypad" }, { alias: "display", definitionId: "lcd1602-i2c" }],
        wiring: calculatorWiring(),
      };
      return jsonResult({ proposalId: activeProposal.id, kind: activeProposal.kind, goal: activeProposal.goal, components: activeProposal.components, connectionCount: activeProposal.wiring.length, approvalRequired: true, nextTool: "design.preview" });
    },
  },
  {
    name: "design.preview",
    description: "Preview the staged design without mutating the active project. Returns component/wiring summary, static graph diagnostics, and an explicit approval token requirement for apply.",
    inputSchema: { type: "object", properties: { proposalId: { type: "string", minLength: 1, maxLength: 200 } }, required: ["proposalId"], additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async ({ proposalId }) => {
      const proposal = activeProposal;
      if (!proposal || proposal.id !== proposalId) return failure("PROPOSAL_NOT_FOUND", "No matching staged proposal exists. Run design.propose again.");
      const project = useProjectStore.getState().project;
      if (project.id !== proposal.projectId || projectHash(project) !== proposal.projectSha256) return failure("PROPOSAL_STALE", "The project changed after this proposal was created. Discard it and propose again.", { proposalId }, true);
      const previewGraph = buildCalculatorPreview(project);
      const validation = validateProject(previewGraph);
      return jsonResult({ proposalId, kind: proposal.kind, components: proposal.components, wiring: proposal.wiring, validation: { valid: validation.valid, errors: validation.issues.filter((issue) => issue.severity === "error").length, warnings: validation.issues.filter((issue) => issue.severity === "warning").length, issues: validation.issues.slice(0, 8).map((issue) => ({ code: issue.code, severity: issue.severity, message: issue.message })) }, mutatesProject: false, approvalRequired: true, applyWith: { proposalId, confirmProposalId: proposalId } });
    },
  },
  {
    name: "design.apply",
    description: "Apply one staged proposal only after explicit exact-id confirmation. The whole design is one undoable transaction; any failed component, wire, or Behavior Plan step rolls back to the prior project.",
    inputSchema: { type: "object", properties: { proposalId: { type: "string", minLength: 1, maxLength: 200 }, confirmProposalId: { type: "string", minLength: 1, maxLength: 200 } }, required: ["proposalId", "confirmProposalId"], additionalProperties: false },
    execute: async ({ proposalId, confirmProposalId }) => {
      const proposal = activeProposal;
      if (!proposal || proposal.id !== proposalId) return failure("PROPOSAL_NOT_FOUND", "No matching staged proposal exists. Run design.propose again.");
      if (confirmProposalId !== proposal.id) return failure("APPROVAL_REQUIRED", "design.apply requires confirmProposalId to exactly match the previewed proposalId.", { proposalId });
      const state = useProjectStore.getState();
      const before = cloneProject(state.project);
      if (before.id !== proposal.projectId || projectHash(before) !== proposal.projectSha256 || before.components.length) return failure("PROPOSAL_STALE", "The active project changed since preview. No design was applied.", { proposalId }, true);
      try {
        const board = state.addComponent("arduino-uno", { x: 160, y: 240 }).id;
        const keypad = useProjectStore.getState().addComponent("membrane-keypad", { x: 500, y: 240 }).id;
        const display = useProjectStore.getState().addComponent("lcd1602-i2c", { x: 850, y: 240 }).id;
        const aliases: Record<string, string> = { board, keypad, display };
        const connectionIds: string[] = [];
        for (const wire of proposal.wiring) {
          const [fromAlias, fromPort] = wire.from.split(".");
          const [toAlias, toPort] = wire.to.split(".");
          connectionIds.push(useProjectStore.getState().connectPorts({ componentId: aliases[fromAlias], portId: fromPort }, { componentId: aliases[toAlias], portId: toPort }).id);
        }
        const plan = calculatorPlan(before.id, keypad, display);
        const written = await writeBehaviorPlan(plan, null);
        if (!written.ok) throw new Error(`${written.error.code}: ${written.error.message}`);
        const buildArtifacts = await ensureAgentBuildArtifacts();
        recordDesignMutation("Apply interactive calculator proposal", before);
        activeProposal = null;
        useSelectionStore.getState().setActive(keypad);
        const validation = validateProject(useProjectStore.getState().project);
        useValidationStore.getState().setResult(validation);
        return jsonResult({ applied: true, projectId: before.id, instances: { board, keypad, display }, connectionIds, behaviorPlanId: plan.id, buildArtifacts, validation: { valid: validation.valid, errors: validation.issues.filter((issue) => issue.severity === "error").length, warnings: validation.issues.filter((issue) => issue.severity === "warning").length }, nextTools: ["behavior.preview", "behavior.press_key", "code.write", "firmware.check", "design.verify"], undoAvailable: true });
      } catch (error) {
        restoreSnapshot(before);
        return failure("DESIGN_APPLY_FAILED", `The proposal could not be applied and was rolled back: ${error instanceof Error ? error.message : String(error)}`, { rolledBack: true }, true);
      }
    },
  },
  {
    name: "design.discard",
    description: "Discard the staged proposal without mutating the hardware project.",
    inputSchema: { type: "object", properties: { proposalId: { type: "string", minLength: 1, maxLength: 200 } }, required: ["proposalId"], additionalProperties: false },
    execute: async ({ proposalId }) => {
      if (!activeProposal || activeProposal.id !== proposalId) return failure("PROPOSAL_NOT_FOUND", "No matching staged proposal exists.");
      activeProposal = null;
      return jsonResult({ discarded: true, proposalId, projectUnchanged: true });
    },
  },
  {
    name: "design.undo",
    description: "Undo the latest agent design mutation for the active project by restoring its exact prior project snapshot. Undo itself is reversible with design.redo.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: async () => {
      const current = useProjectStore.getState().project;
      const index = [...undoStack].map((entry) => entry.projectId).lastIndexOf(current.id);
      if (index < 0) return failure("NOTHING_TO_UNDO", "No recorded agent design mutation is available for this project.");
      const entry = undoStack.splice(index, 1)[0];
      redoStack.push({ projectId: current.id, label: entry.label, snapshot: cloneProject(current), recordedAt: new Date().toISOString() });
      restoreSnapshot(entry.snapshot);
      return jsonResult({ undone: true, label: entry.label, projectId: current.id, redoAvailable: true, remainingUndo: undoStack.filter((item) => item.projectId === current.id).length });
    },
  },
  {
    name: "design.redo",
    description: "Redo the most recently undone agent design mutation for the active project.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: async () => {
      const current = useProjectStore.getState().project;
      const index = [...redoStack].map((entry) => entry.projectId).lastIndexOf(current.id);
      if (index < 0) return failure("NOTHING_TO_REDO", "No undone design mutation is available to redo for this project.");
      const entry = redoStack.splice(index, 1)[0];
      undoStack.push({ projectId: current.id, label: entry.label, snapshot: cloneProject(current), recordedAt: new Date().toISOString() });
      restoreSnapshot(entry.snapshot);
      return jsonResult({ redone: true, label: entry.label, projectId: current.id, undoAvailable: true });
    },
  },
  {
    name: "design.verify",
    description: "Return a compact goal-level verification summary for the active design, including calculator interactivity, graph/behavior/source stages, and honest browser/external boundaries.",
    inputSchema: { type: "object", properties: { durationMs: { type: "integer", minimum: 0, maximum: 10000, default: 250 } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async ({ durationMs = 250 }) => {
      const report = await verifyProject({ durationMs });
      if (!report.ok) return failure(report.error.code, report.error.message, report.data ?? {}, report.error.retryable);
      const project = useProjectStore.getState().project;
      const keypad = project.components.find((component) => component.definitionId === "membrane-keypad");
      const display = project.components.find((component) => component.definitionId === "lcd1602-i2c" || component.definitionId === "lcd1602");
      const plan = project.behaviorPlans?.find((candidate) => candidate.id === "calculator-interaction-v1");
      return jsonResult({ overall: report.data.overall, calculatorInteractive: Boolean(keypad && display && plan && report.data.stages.behavior.status === "ready"), graph: report.data.stages.graph.status, behavior: report.data.stages.behavior.status, source: report.data.stages.source.status, browserSourceCheck: report.data.stages.browserSourceCheck.status, preflight: report.data.stages.preflight.status, claims: report.data.claims, nextAction: !keypad || !display || !plan ? "Use design.propose for the reviewed calculator workflow." : report.data.stages.source.status === "missing" || report.data.stages.source.status === "starter-source-present" ? "Author project-specific board firmware, run firmware.check, then re-run design.verify." : "Run behavior.preview and press 7, +, 5, = to demonstrate the live LCD result." });
    },
  },
  {
    name: "workspace.get_tool_surface",
    description: "Read a small state-aware shortlist of the WebMCP tools most relevant to the current project stage instead of choosing from the full registry blindly.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const stage = currentStage();
      const recommended = recommendedTools(stage);
      return jsonResult({ stage, recommendedTools: recommended, fullToolCount, hiddenFromShortlist: Math.max(0, fullToolCount - recommended.length), proposalId: activeProposal?.projectId === useProjectStore.getState().project.id ? activeProposal.id : null, undoAvailable: undoStack.some((item) => item.projectId === useProjectStore.getState().project.id), redoAvailable: redoStack.some((item) => item.projectId === useProjectStore.getState().project.id) });
    },
  },
];
