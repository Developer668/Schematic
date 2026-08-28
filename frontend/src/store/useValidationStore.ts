import { create } from "zustand";
import { componentDefinition, componentPort, isBoardDefinition, resolveFirmwareBinding } from "../data/hardware.ts";
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

function portFor(project: HardwareGraph, componentId: string, portId: string) {
  return componentPort(project, componentId, portId);
}

function isUntypedPort(port: { id: string; domain: string }) {
  return port.domain === "gpio" && /^(P\d+|A|B)$/.test(port.id);
}

/** Hardware checks are derived from the same graph that drives the canvas and WebMCP. */
export function validateProject(project: HardwareGraph) {
  const issues: ValidationIssue[] = [];
  const knownComponents = new Set(project.components.map((component) => component.id));
  const seenConnections = new Set<string>();

  for (const connection of project.connections) {
    const sourceKey = `${connection.source.componentId}:${connection.source.portId}`;
    const targetKey = `${connection.target.componentId}:${connection.target.portId}`;
    const source = portFor(project, connection.source.componentId, connection.source.portId);
    const target = portFor(project, connection.target.componentId, connection.target.portId);
    if (!source || !target || !knownComponents.has(connection.source.componentId) || !knownComponents.has(connection.target.componentId)) {
      issues.push({ id: `missing-port-${connection.id}`, severity: "error", code: "MISSING_PORT", message: `Connection ${connection.id} references a missing component or port.`, affectedConnections: [connection.id] });
      continue;
    }
    const pair = [sourceKey, targetKey].sort().join("|");
    if (seenConnections.has(pair)) issues.push({ id: `duplicate-connection-${connection.id}`, severity: "error", code: "DUPLICATE_CONNECTION", message: `Duplicate wire between ${sourceKey} and ${targetKey}.`, affectedConnections: [connection.id] });
    seenConnections.add(pair);

    const sourceDomain = isUntypedPort(source) ? connection.domain : source.domain;
    const targetDomain = isUntypedPort(target) ? connection.domain : target.domain;
    const compatiblePower = ["power", "power_output"].includes(sourceDomain) && ["power", "power_output"].includes(targetDomain);
    if (sourceDomain !== targetDomain && !compatiblePower) {
      issues.push({ id: `domain-${connection.id}`, severity: "error", code: "DOMAIN_MISMATCH", message: `Incompatible domains: ${sourceKey} (${sourceDomain}) → ${targetKey} (${targetDomain}).`, affectedConnections: [connection.id] });
    }
    if (source.direction === "output" && target.direction === "output") {
      issues.push({ id: `out-out-${connection.id}`, severity: "error", code: "OUTPUT_TO_OUTPUT", message: `Output ${sourceKey} connected to output ${targetKey}.`, affectedConnections: [connection.id] });
    }
    if (source.direction === "input" && target.direction === "input") {
      issues.push({ id: `in-in-${connection.id}`, severity: "error", code: "INPUT_TO_INPUT", message: `Input ${sourceKey} connected to input ${targetKey}; connect a driving port to a receiving port.`, affectedConnections: [connection.id] });
    }
    if (sourceDomain === "uart" && targetDomain === "uart" && source.name.toUpperCase().includes("TX") && target.name.toUpperCase().includes("TX")) {
      issues.push({ id: `uart-tx-${connection.id}`, severity: "error", code: "UART_TX_TO_TX", message: `UART TX→TX illegal: ${sourceKey} → ${targetKey}.`, affectedConnections: [connection.id] });
    }
    if (sourceDomain === "i2c" && targetDomain === "i2c" && source.protocol?.role === "controller" && target.protocol?.role === "controller") {
      issues.push({ id: `i2c-controller-${connection.id}`, severity: "warning", code: "I2C_CONTROLLER_TO_CONTROLLER", message: `I2C controller-to-controller wire: ${sourceKey} → ${targetKey}.`, affectedConnections: [connection.id] });
    }
    if (sourceDomain === "usb" && targetDomain === "usb" && source.protocol?.role === "host" && target.protocol?.role === "host") {
      issues.push({ id: `usb-host-${connection.id}`, severity: "error", code: "USB_HOST_TO_HOST", message: "USB host-to-host connection is not valid.", affectedConnections: [connection.id] });
    }
    const sourceNominal = source.electrical?.nominalVoltage;
    const targetMax = target.electrical?.maxVoltage;
    if (sourceNominal !== undefined && targetMax !== undefined && sourceNominal > targetMax + 0.1) {
      issues.push({ id: `voltage-${connection.id}`, severity: "error", code: "VOLTAGE_MISMATCH", message: `${sourceNominal}V from ${sourceKey} exceeds ${targetMax}V max on ${targetKey}.`, affectedConnections: [connection.id], autoFix: { description: "Insert level shifter", action: "insert_level_shifter", params: { connectionId: connection.id } } });
    }
  }

  const hasConnectedGround = project.connections.some((connection) => connection.domain === "ground" || portFor(project, connection.source.componentId, connection.source.portId)?.domain === "ground" || portFor(project, connection.target.componentId, connection.target.portId)?.domain === "ground");
  const hasConnectedPower = project.connections.some((connection) => connection.domain === "power" || ["power", "power_output"].includes(portFor(project, connection.source.componentId, connection.source.portId)?.domain ?? "") || ["power", "power_output"].includes(portFor(project, connection.target.componentId, connection.target.portId)?.domain ?? ""));
  if (project.components.length > 0 && !hasConnectedGround) issues.push({ id: "missing-ground", severity: "warning", code: "MISSING_GROUND", message: "No connected ground net found — add a GND connection.", autoFix: { description: "Add ground component", action: "add_ground" } });
  if (project.components.length > 1 && !hasConnectedPower) issues.push({ id: "missing-power", severity: "warning", code: "INSUFFICIENT_POWER", message: "No connected power net found." });

  const i2cDevices = project.components.filter((component) => ["bmp280", "mpu6050", "ds1307", "ds3231", "ssd1306", "ssd1306-i2c-4pin", "lcd1602-i2c", "lcd2004-i2c"].includes(component.definitionId));
  const addresses = new Map<number, string[]>();
  for (const device of i2cDevices) {
    const address = portFor(project, device.id, "SDA")?.protocol?.address;
    if (address === undefined) continue;
    addresses.set(address, [...(addresses.get(address) ?? []), device.id]);
  }
  for (const [address, devices] of addresses) if (devices.length > 1) issues.push({ id: `i2c-collision-${address}`, severity: "error", code: "I2C_ADDRESS_COLLISION", message: `I2C address 0x${address.toString(16)} collision: ${devices.join(", ")}.` });
  if (project.connections.some((connection) => connection.domain === "i2c") && i2cDevices.length > 0 && !project.components.some((component) => component.definitionId.includes("resistor") || component.definitionId.includes("pullup"))) {
    issues.push({ id: "i2c-pullup", severity: "warning", code: "MISSING_PULLUP", message: "I2C bus has no pull-up resistor component (typically 4.7kΩ to VCC on SDA/SCL).", autoFix: { description: "Add 4.7k pull-ups", action: "insert_pullup", params: { value: 4700 } } });
  }
  const boards = project.components.filter((component) => isBoardDefinition(componentDefinition(project, component.id)));
  if (project.components.length > 0 && boards.length === 0) issues.push({ id: "no-board", severity: "info", code: "NO_BOARD", message: "No microcontroller board detected — firmware has no target." });

  for (const target of project.firmwareTargets) {
    const binding = resolveFirmwareBinding(project, target.componentId);
    if (!binding.component || !binding.definition) {
      issues.push({ id: `firmware-missing-${target.id}`, severity: "error", code: "INVALID_FIRMWARE_TARGET", message: `Firmware target ${target.componentId} references a missing component or catalog definition.`, affectedComponents: [target.componentId] });
    } else if (!isBoardDefinition(binding.definition)) {
      issues.push({ id: `firmware-not-board-${target.id}`, severity: "error", code: "NON_BOARD_FIRMWARE_TARGET", message: `${binding.definition.title} cannot receive firmware.`, affectedComponents: [target.componentId] });
    } else if (!binding.definitionMatchesTarget) {
      issues.push({ id: `firmware-mismatch-${target.id}`, severity: "error", code: "FIRMWARE_DEFINITION_MISMATCH", message: `Firmware target ${target.id} was created for ${target.definitionId}, but the instance now contains ${binding.component.definitionId}.`, affectedComponents: [target.componentId] });
    } else if (!binding.fqbnMatchesDefinition) {
      issues.push({ id: `firmware-fqbn-mismatch-${target.id}`, severity: "error", code: "FIRMWARE_FQBN_MISMATCH", message: `Firmware target ${target.id} uses ${target.boardFqbn}, but ${binding.definition.title} maps to ${binding.targetConfig?.fqbn}.`, affectedComponents: [target.componentId] });
    }
  }

  const codeIssues = project.firmwareTargets.flatMap((target) => validateFirmwareFiles(target.files));
  return { valid: !issues.some((issue) => issue.severity === "error") && !codeIssues.some((issue) => issue.severity === "error"), issues, codeIssues };
}

export function validateFirmwareFiles(files: { name: string; content: string }[]): CodeIssue[] {
  const issues: CodeIssue[] = [];
  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    let depth = 0;
    lines.forEach((line, index) => {
      for (const character of line) {
        if (character === "{") depth += 1;
        if (character === "}") depth -= 1;
      }
      if (depth < 0) issues.push({ id: `${file.name}-unexpected-close-${index + 1}`, severity: "error", code: "FIRMWARE_UNBALANCED_BRACES", file: file.name, line: index + 1, message: "Unexpected closing brace." });
    });
    if (depth !== 0) issues.push({ id: `${file.name}-unbalanced-braces`, severity: "error", code: "FIRMWARE_UNBALANCED_BRACES", file: file.name, message: "Opening and closing braces are unbalanced." });
    if (/\.ino$/i.test(file.name) && !/\bvoid\s+setup\s*\(/.test(file.content)) issues.push({ id: `${file.name}-missing-setup`, severity: "warning", code: "FIRMWARE_MISSING_SETUP", file: file.name, message: "Arduino sketch is missing void setup()." });
    if (/\.ino$/i.test(file.name) && !/\bvoid\s+loop\s*\(/.test(file.content)) issues.push({ id: `${file.name}-missing-loop`, severity: "warning", code: "FIRMWARE_MISSING_LOOP", file: file.name, message: "Arduino sketch is missing void loop()." });
  }
  return issues;
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
