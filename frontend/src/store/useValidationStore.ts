import { create } from "zustand";
import { validateFirmwareFiles as validateCanonicalFirmwareFiles, validateProject as validateCanonicalProject } from "@schematic/validation";
import { componentDefinition, getCatalogComponent, isBoardDefinition, resolveFirmwareBinding } from "../data/hardware.ts";
import type { HardwareGraph } from "./useProjectStore.ts";
import { getCurrentUserId } from "../auth/session.ts";

export interface ValidationIssue {
  id?: string;
  severity: "error" | "warning" | "info" | string;
  code: string;
  message: string;
  line?: number;
  file?: string;
  affectedComponents?: string[];
  affectedConnections?: string[];
}

export interface CodeIssue {
  id: string;
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  file?: string;
  line?: number;
}

export interface CompileState {
  status: "idle" | "checking" | "success" | "error" | "unavailable";
  boardFqbn?: string;
  log?: string;
  checkedAt?: number;
}

/**
 * Hardware checks are derived from the shared graph index. Firmware-target
 * checks remain here because they depend on the frontend's exact board/FQBN
 * binding, while topology is owned by @schematic/validation. Source contents
 * are intentionally not inspected: code is an editable artifact, not a
 * compiler input, and active validation is graph-only.
 */
export function validateProject(project: HardwareGraph) {
  const canonical = validateCanonicalProject(project as unknown as import("@schematic/hardware-graph").HardwareProject, (definitionId) => getCatalogComponent(definitionId));
  const issues: ValidationIssue[] = canonical.issues.map((issue) => ({
    id: issue.id,
    severity: issue.severity,
    code: issue.code,
    message: issue.message,
    ...(issue.affectedComponents ? { affectedComponents: [...issue.affectedComponents] } : {}),
    ...(issue.affectedConnections ? { affectedConnections: [...issue.affectedConnections] } : {}),
  }));

  const boards = project.components.filter((component) => isBoardDefinition(componentDefinition(project, component.id)));
  if (project.components.length > 0 && boards.length === 0) {
    issues.push({ id: "no-board", severity: "info", code: "NO_BOARD", message: "No microcontroller board detected. You can still check wiring and export the design; firmware needs a board target." });
  }

  for (const target of project.firmwareTargets) {
    const binding = resolveFirmwareBinding(project, target.componentId);
    if (!binding.component || !binding.definition) {
      issues.push({ id: `firmware-missing-${target.id}`, severity: "error", code: "INVALID_FIRMWARE_TARGET", message: `Firmware target ${target.componentId} references a missing component or catalog definition.`, affectedComponents: [target.componentId] });
    } else if (!isBoardDefinition(binding.definition)) {
      issues.push({ id: `firmware-not-board-${target.id}`, severity: "error", code: "NON_BOARD_FIRMWARE_TARGET", message: `${binding.definition.title} cannot receive firmware.`, affectedComponents: [target.componentId] });
    } else if (!target.definitionId) {
      issues.push({ id: `firmware-definition-required-${target.id}`, severity: "error", code: "FIRMWARE_DEFINITION_REQUIRED", message: `Firmware target ${target.id} is missing its exact board definition binding. Rewrite the firmware for the current board.`, affectedComponents: [target.componentId] });
    } else if (!target.boardFqbn) {
      issues.push({ id: `firmware-fqbn-required-${target.id}`, severity: "error", code: "FIRMWARE_FQBN_REQUIRED", message: `Firmware target ${target.id} is missing an explicit board FQBN.`, affectedComponents: [target.componentId] });
    } else if (!binding.definitionMatchesTarget) {
      issues.push({ id: `firmware-mismatch-${target.id}`, severity: "error", code: "FIRMWARE_DEFINITION_MISMATCH", message: `Firmware target ${target.id} was created for ${target.definitionId}, but the instance now contains ${binding.component.definitionId}.`, affectedComponents: [target.componentId] });
    } else if (!binding.fqbnMatchesDefinition) {
      issues.push({ id: `firmware-fqbn-mismatch-${target.id}`, severity: "error", code: "FIRMWARE_FQBN_MISMATCH", message: `Firmware target ${target.id} uses ${target.boardFqbn}, but ${binding.definition.title} maps to ${binding.targetConfig?.fqbn}.`, affectedComponents: [target.componentId] });
    }
  }

  // Keep the optional compatibility field present for consumers that render
  // it, but do not derive it from editable firmware/source contents.
  return { valid: !issues.some((issue) => issue.severity === "error"), issues, codeIssues: [] };
}

export function validateFirmwareFiles(files: { name: string; content: string }[]): CodeIssue[] {
  return validateCanonicalFirmwareFiles(files).map((issue) => ({ ...issue }));
}

interface ValidationState {
  issues: ValidationIssue[];
  codeIssues: CodeIssue[];
  valid: boolean | null;
  checkedAt: number | null;
  compile: CompileState;
  setResult: (result: { valid: boolean; issues: ValidationIssue[]; codeIssues?: CodeIssue[] }) => void;
  setCodeIssues: (issues: CodeIssue[]) => void;
  setCompile: (result: CompileState) => void;
  clear: () => void;
}

const validationChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("schematic-validation-sync") : null;
const initialCompile: CompileState = { status: "idle" };
const MAX_VALIDATION_ISSUES = 200;
const MAX_VALIDATION_MESSAGE_LENGTH = 1_000;
const MAX_VALIDATION_ID_LENGTH = 160;
const MAX_VALIDATION_FILE_LENGTH = 240;
const MAX_VALIDATION_COMPILE_LOG = 32 * 1024;
const MAX_VALIDATION_LINE = 1_000_000;
// Keep timestamps in the range accepted by Date. This prevents a finite but
// enormous number from becoming unbounded metadata in a broadcast snapshot.
const MAX_VALIDATION_TIMESTAMP = 8_640_000_000_000_000;

type ValidationSnapshot = Pick<ValidationState, "issues" | "codeIssues" | "valid" | "checkedAt" | "compile">;

function boundedText(value: unknown, max: number, allowEmpty = false): string | undefined {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && value.trim().length === 0)) return undefined;
  return value;
}

function boundedIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, MAX_VALIDATION_ISSUES).flatMap((item) => {
    const id = boundedText(item, MAX_VALIDATION_ID_LENGTH);
    return id ? [id] : [];
  });
}

function boundedTimestamp(value: unknown): number | undefined {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_VALIDATION_TIMESTAMP
    ? value
    : undefined;
}

function normalizeValidationIssue(value: unknown): ValidationIssue | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const issue = value as Record<string, unknown>;
  const code = boundedText(issue.code, 120);
  const message = boundedText(issue.message, MAX_VALIDATION_MESSAGE_LENGTH);
  const severity = issue.severity === "error" || issue.severity === "warning" || issue.severity === "info" ? issue.severity : undefined;
  if (!code || !message || !severity) return undefined;
  const line = typeof issue.line === "number" && Number.isSafeInteger(issue.line) && issue.line > 0 && issue.line <= MAX_VALIDATION_LINE ? issue.line : undefined;
  const affectedComponents = boundedIds(issue.affectedComponents);
  const affectedConnections = boundedIds(issue.affectedConnections);
  return {
    ...(boundedText(issue.id, MAX_VALIDATION_ID_LENGTH) ? { id: issue.id as string } : {}),
    severity,
    code,
    message,
    ...(line ? { line } : {}),
    ...(boundedText(issue.file, MAX_VALIDATION_FILE_LENGTH) ? { file: issue.file as string } : {}),
    ...(affectedComponents ? { affectedComponents } : {}),
    ...(affectedConnections ? { affectedConnections } : {}),
  };
}

function normalizeCodeIssue(value: unknown): CodeIssue | undefined {
  const issue = normalizeValidationIssue(value);
  if (!issue || !issue.id) return undefined;
  return { id: issue.id, severity: issue.severity as CodeIssue["severity"], code: issue.code, message: issue.message, ...(issue.file ? { file: issue.file } : {}), ...(issue.line ? { line: issue.line } : {}) };
}

function normalizeCompile(value: unknown): CompileState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return initialCompile;
  const compile = value as Record<string, unknown>;
  const status = ["idle", "checking", "success", "error", "unavailable"].includes(String(compile.status)) ? String(compile.status) as CompileState["status"] : "idle";
  return {
    status,
    ...(boundedText(compile.boardFqbn, MAX_VALIDATION_ID_LENGTH) ? { boardFqbn: compile.boardFqbn as string } : {}),
    ...(boundedText(compile.log, MAX_VALIDATION_COMPILE_LOG, true) ? { log: compile.log as string } : {}),
    ...(boundedTimestamp(compile.checkedAt) !== undefined ? { checkedAt: boundedTimestamp(compile.checkedAt) } : {}),
  };
}

function normalizeValidationSnapshot(value: unknown): ValidationSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { issues: [], codeIssues: [], valid: null, checkedAt: null, compile: initialCompile };
  const state = value as Record<string, unknown>;
  const issues = Array.isArray(state.issues) ? state.issues.slice(0, MAX_VALIDATION_ISSUES).flatMap((item) => { const issue = normalizeValidationIssue(item); return issue ? [issue] : []; }) : [];
  const codeIssues = Array.isArray(state.codeIssues) ? state.codeIssues.slice(0, MAX_VALIDATION_ISSUES).flatMap((item) => { const issue = normalizeCodeIssue(item); return issue ? [issue] : []; }) : [];
  return {
    issues,
    codeIssues,
    valid: typeof state.valid === "boolean" ? state.valid : null,
    checkedAt: boundedTimestamp(state.checkedAt) ?? null,
    compile: normalizeCompile(state.compile),
  };
}

function publishValidation(state: ValidationSnapshot) {
  validationChannel?.postMessage({ type: "validation:update", roomId: getCurrentUserId(), state: normalizeValidationSnapshot(state) });
}

export const useValidationStore = create<ValidationState>((set) => ({
  issues: [],
  codeIssues: [],
  valid: null,
  checkedAt: null,
  compile: initialCompile,
  setResult(result) {
    set((state) => {
      // `valid` is a graph verdict. Ignore optional/source diagnostics even if
      // an older caller includes them in the result object.
      const normalized = normalizeValidationSnapshot({ issues: result?.issues, codeIssues: [], valid: true, checkedAt: Date.now(), compile: state.compile });
      const next = { issues: normalized.issues, codeIssues: [], valid: !normalized.issues.some((issue) => issue.severity === "error"), checkedAt: normalized.checkedAt };
      publishValidation({ ...state, ...next });
      return next;
    });
  },
  setCodeIssues(codeIssues) {
    set((state) => {
      // Retain this compatibility setter for explicit legacy diagnostics, but
      // never let source diagnostics silently change the graph verdict.
      const normalized = normalizeValidationSnapshot({ issues: state.issues, codeIssues, valid: state.valid === null ? null : state.issues.every((issue) => issue.severity !== "error"), checkedAt: Date.now(), compile: state.compile });
      const next = { codeIssues: normalized.codeIssues, valid: normalized.valid, checkedAt: normalized.checkedAt };
      publishValidation({ ...state, ...next });
      return next;
    });
  },
  setCompile(compile) {
    set((state) => {
      const next = { compile: normalizeCompile(compile) };
      publishValidation({ ...state, ...next });
      return next;
    });
  },
  clear() {
    const next = { issues: [], codeIssues: [], valid: null, checkedAt: null, compile: initialCompile };
    set(next);
    publishValidation(next);
  },
}));

validationChannel?.addEventListener("message", (event) => {
  if (event.data?.type !== "validation:update" || !event.data.state || (event.data.roomId ?? null) !== getCurrentUserId()) return;
  useValidationStore.setState(normalizeValidationSnapshot(event.data.state));
});

if (typeof window !== "undefined") {
  window.addEventListener("schematic-session", () => useValidationStore.setState({ issues: [], codeIssues: [], valid: null, checkedAt: null, compile: initialCompile }));
}
