import { create } from "zustand";
import { validateFirmwareFiles as validateCanonicalFirmwareFiles, validateProject as validateCanonicalProject } from "@schematic/validation";
import { componentDefinition, getCatalogComponent, isBoardDefinition, resolveFirmwareBinding } from "../data/hardware.ts";
import type { HardwareGraph } from "./useProjectStore.ts";

export interface ValidationIssue {
  id?: string;
  severity: "error" | "warning" | "info" | string;
  code: string;
  message: string;
  line?: number;
  file?: string;
  affectedComponents?: string[];
  affectedConnections?: string[];
  autoFix?: { description: string; action: string; params?: Record<string, unknown> };
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
 * binding, while topology is owned by @schematic/validation.
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
    ...(issue.autoFix ? { autoFix: issue.autoFix } : {}),
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

  const codeIssues = (canonical.codeIssues ?? []).map((issue) => ({ ...issue }));
  return { valid: !issues.some((issue) => issue.severity === "error") && !codeIssues.some((issue) => issue.severity === "error"), issues, codeIssues };
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

type ValidationSnapshot = Pick<ValidationState, "issues" | "codeIssues" | "valid" | "checkedAt" | "compile">;

function publishValidation(state: ValidationSnapshot) {
  validationChannel?.postMessage({ type: "validation:update", state: {
    issues: state.issues,
    codeIssues: state.codeIssues,
    valid: state.valid,
    checkedAt: state.checkedAt,
    compile: state.compile,
  } });
}

export const useValidationStore = create<ValidationState>((set) => ({
  issues: [],
  codeIssues: [],
  valid: null,
  checkedAt: null,
  compile: initialCompile,
  setResult(result) {
    set((state) => {
      const next = { issues: result.issues, codeIssues: result.codeIssues ?? [], valid: result.valid && !(result.codeIssues ?? []).some((issue) => issue.severity === "error"), checkedAt: Date.now() };
      publishValidation({ ...state, ...next });
      return next;
    });
  },
  setCodeIssues(codeIssues) {
    set((state) => {
      const next = { codeIssues, valid: state.valid === null ? null : state.issues.every((issue) => issue.severity !== "error") && !codeIssues.some((issue) => issue.severity === "error"), checkedAt: Date.now() };
      publishValidation({ ...state, ...next });
      return next;
    });
  },
  setCompile(compile) {
    set((state) => {
      const next = { compile };
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
  if (event.data?.type === "validation:update" && event.data.state) useValidationStore.setState(event.data.state);
});
