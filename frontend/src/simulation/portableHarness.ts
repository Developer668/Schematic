import { loadBundledButtonLedWasm, type DigitalLevel, type HarnessSnapshot } from "../../../packages/firmware-harness/src/index.ts";
import { componentPorts, resolveBoardPin, resolveFirmwareBinding } from "../data/hardware.ts";
import { getCatalogComponent } from "../data/catalog.ts";
import type { HardwareGraph } from "../store/useProjectStore.ts";

type Endpoint = { componentId: string; portId: string };

type ResolvedPortableContract = {
  target: HardwareGraph["firmwareTargets"][number];
  source: string;
  buttonEndpoint: Endpoint;
  ledEndpoint: Endpoint;
  boardButtonPort: string;
  boardLedPort: string;
  buttonPin: number;
  ledPin: number;
  activeLow: boolean;
};

export class PortableHarnessUnavailableError extends Error {
  readonly code = "WASM_ARTIFACT_UNAVAILABLE" as const;

  constructor(message: string, readonly componentId: string, cause?: unknown) {
    super(message);
    this.name = "PortableHarnessUnavailableError";
    if (cause !== undefined) Object.defineProperty(this, "cause", { value: cause, enumerable: false });
  }
}

export interface PortableButtonLedRun {
  contract: "button-led";
  executionEngine: "c-wasm";
  abiVersion: 2;
  artifactSha256?: string;
  boardId: string;
  buttonId: string;
  ledId: string;
  buttonEndpoint: Endpoint;
  ledEndpoint: Endpoint;
  boardButtonPort: string;
  boardLedPort: string;
  activeLow: boolean;
  durationMs: number;
  steps: number;
  sourceFiles: string[];
  snapshot: HarnessSnapshot;
  outputs: Record<string, boolean>;
  events: { timeMs: number; endpoint: string; value: boolean; reason: string }[];
  capabilities: readonly string[];
  note: string;
}

function sourceForTarget(target: HardwareGraph["firmwareTargets"][number]) {
  return target.files
    .filter((file) => /\.(ino|c|cpp|h)$/i.test(file.name))
    .map((file) => file.content)
    .join("\n");
}

/**
 * Keep recognition conservative. The compiled browser module implements one
 * precise semantic contract, so comments and string literals must not be
 * allowed to influence its detection.
 */
function maskCommentsAndStrings(source: string) {
  let masked = "";
  let state: "code" | "line-comment" | "block-comment" | "string" | "char" = "code";
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (state === "line-comment") {
      masked += character === "\n" ? "\n" : " ";
      if (character === "\n") state = "code";
      continue;
    }
    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        masked += "  ";
        index += 1;
        state = "code";
      } else {
        masked += character === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (state === "string" || state === "char") {
      masked += character === "\n" ? "\n" : " ";
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if ((state === "string" && character === '"') || (state === "char" && character === "'")) state = "code";
      continue;
    }
    if (character === "/" && next === "/") {
      masked += "  ";
      index += 1;
      state = "line-comment";
    } else if (character === "/" && next === "*") {
      masked += "  ";
      index += 1;
      state = "block-comment";
    } else if (character === '"') {
      masked += " ";
      state = "string";
      escaped = false;
    } else if (character === "'") {
      masked += " ";
      state = "char";
      escaped = false;
    } else {
      masked += character;
    }
  }
  return masked;
}

function hasSafePreprocessor(source: string) {
  for (const line of source.split(/\r?\n/)) {
    const directive = line.trim();
    if (!directive.startsWith("#")) continue;
    if (/^#\s*include\s*[<"]Arduino\.h[">]\s*$/i.test(directive)) continue;
    // Pin aliases are safe because they are reduced to numeric board pins
    // before matching. All conditionals, function-like macros, and other
    // object-like macros are rejected so preprocessor state cannot hide or
    // rewrite the semantics we are about to execute.
    if (/^#\s*define\s+(?:BUTTON_PIN|LED_PIN)\s+-?\d+\s*$/i.test(directive)) continue;
    return false;
  }
  return true;
}

function functionBodies(source: string, name: "setup" | "loop") {
  const bodies: string[] = [];
  const definition = new RegExp(`\\b${name}\\s*\\([^{}]*\\)\\s*\\{`, "gi");
  for (const match of source.matchAll(definition)) {
    const openBrace = source.indexOf("{", match.index ?? 0);
    if (openBrace < 0) continue;
    let depth = 0;
    for (let index = openBrace; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") depth -= 1;
      if (depth === 0) {
        bodies.push(source.slice(openBrace + 1, index));
        break;
      }
    }
  }
  return bodies;
}

function numericConstants(source: string) {
  const constants = new Map<string, number | boolean>();
  for (const match of source.matchAll(/(?:constexpr|const)?\s*(?:bool|boolean|byte|short|int|long|uint8_t|uint16_t)\s+([A-Za-z_]\w*)\s*=\s*([^;]+);/g)) {
    const value = match[2].trim();
    if (/^-?\d+$/.test(value)) constants.set(match[1], Number(value));
    else if (/^true$/i.test(value)) constants.set(match[1], true);
    else if (/^false$/i.test(value)) constants.set(match[1], false);
  }
  for (const match of source.matchAll(/^\s*#define\s+([A-Za-z_]\w*)\s+(-?\d+|true|false)\s*$/gim)) {
    const value = match[2].trim();
    if (/^-?\d+$/.test(value)) constants.set(match[1], Number(value));
    else constants.set(match[1], value.toLowerCase() === "true");
  }
  return constants;
}

function pinNumber(portId: string) {
  const match = portId.match(/(?:GPIO|PIN|IO|D|A|P)[_ ]?(\d+)/i);
  return match ? Number(match[1]) : null;
}

function otherEndpoint(project: HardwareGraph, boardId: string, boardPort: string, predicate: (componentId: string) => boolean) {
  for (const connection of project.connections) {
    const other = connection.source.componentId === boardId && connection.source.portId === boardPort
      ? connection.target
      : connection.target.componentId === boardId && connection.target.portId === boardPort
        ? connection.source
        : null;
    if (other && predicate(other.componentId)) return other;
  }
  return null;
}

function isPart(project: HardwareGraph, componentId: string, expression: RegExp) {
  const component = project.components.find((item) => item.id === componentId);
  const definition = component ? getCatalogComponent(component.definitionId) : undefined;
  return Boolean(component && expression.test(`${component.definitionId} ${definition?.title ?? ""}`.toLowerCase()));
}

function logicalInput(inputs: Record<string, boolean | number>, buttonId: string, boardId: string, boardPort: string, activeLow: boolean): DigitalLevel {
  const semantic = inputs[`${buttonId}:pressed`] ?? inputs[`${buttonId}:button`] ?? inputs[`${buttonId}:click`];
  if (typeof semantic === "boolean") return activeLow ? (semantic ? 0 : 1) : (semantic ? 1 : 0);
  const direct = inputs[`${boardId}:${boardPort}`];
  if (typeof direct === "number") return direct === 0 ? 0 : 1;
  if (typeof direct === "boolean") return direct ? 1 : 0;
  return activeLow ? 1 : 0;
}

function resolvePortableButtonLedContract(project: HardwareGraph): ResolvedPortableContract | null {
  const target = project.firmwareTargets.find((candidate) => {
    const binding = resolveFirmwareBinding(project, candidate.componentId);
    return binding.definition?.category === "board" && binding.definitionMatchesTarget && binding.fqbnMatchesDefinition;
  });
  if (!target) return null;

  const source = sourceForTarget(target);
  if (!hasSafePreprocessor(source)) return null;
  const normalizedSource = maskCommentsAndStrings(source);
  const setups = functionBodies(normalizedSource, "setup");
  const loops = functionBodies(normalizedSource, "loop");
  if (setups.length !== 1 || loops.length !== 1) return null;
  if ((normalizedSource.match(/\bdigitalRead\s*\(/gi) ?? []).length !== 1 || (normalizedSource.match(/\bdigitalWrite\s*\(/gi) ?? []).length !== 1) return null;
  if ((normalizedSource.match(/\bpinMode\s*\(/gi) ?? []).length !== 2) return null;
  if (/\b(?:analogRead|analogWrite|Wire|SPI|Serial|tone|attachInterrupt|millis|micros|interrupts|noInterrupts)\b/i.test(normalizedSource)) return null;

  // This is intentionally a small grammar, not a heuristic. Only the exact
  // read -> boolean -> write relationship below is safe to execute with the
  // fixed C/WASM adapter. Branches, constants, inversion, and hard-coded
  // writes stay on the interpreter/remote path.
  const loopMatch = /^\s*(?:const\s+)?(?:bool|boolean)\s+([A-Za-z_]\w*)\s*=\s*digitalRead\s*\(\s*([^()]+?)\s*\)\s*==\s*(LOW|HIGH)\s*;\s*digitalWrite\s*\(\s*([^,()]+?)\s*,\s*\1\s*\)\s*;\s*(?:delay\s*\(\s*\d+\s*\)\s*;\s*)?$/i.exec(loops[0]);
  if (!loopMatch) return null;
  const readExpression = loopMatch[2].trim();
  const writeExpression = loopMatch[4].trim();
  const constants = numericConstants(normalizedSource);
  const buttonBoardEndpoint = resolveBoardPin(project, target.componentId, readExpression, constants);
  const ledBoardEndpoint = resolveBoardPin(project, target.componentId, writeExpression, constants);
  if (!buttonBoardEndpoint || !ledBoardEndpoint || buttonBoardEndpoint.portId === ledBoardEndpoint.portId) return null;

  const pinModePattern = /pinMode\s*\(\s*([^,()]+?)\s*,\s*(INPUT_PULLUP|INPUT|OUTPUT)\s*\)\s*;/gi;
  const setupPinModes = [...setups[0].matchAll(pinModePattern)];
  if (setups[0].replace(pinModePattern, "").trim()) return null;
  if (setupPinModes.length !== 2 || setupPinModes.some((match) => !match[1] || !match[2])) return null;
  let configuredButton = false;
  let configuredLed = false;
  for (const mode of setupPinModes) {
    const endpoint = resolveBoardPin(project, target.componentId, mode[1].trim(), constants);
    if (!endpoint) return null;
    if (endpoint.portId === buttonBoardEndpoint.portId && /^INPUT(?:_PULLUP)?$/i.test(mode[2])) configuredButton = true;
    else if (endpoint.portId === ledBoardEndpoint.portId && /^OUTPUT$/i.test(mode[2])) configuredLed = true;
    else return null;
  }
  if (!configuredButton || !configuredLed) return null;

  const buttonEndpoint = otherEndpoint(project, target.componentId, buttonBoardEndpoint.portId, (id) => isPart(project, id, /button|switch/));
  const ledEndpoint = otherEndpoint(project, target.componentId, ledBoardEndpoint.portId, (id) => isPart(project, id, /(^|\s|-)led\b|light/));
  if (!buttonEndpoint || !ledEndpoint) return null;

  const activeLow = loopMatch[3].toUpperCase() === "LOW";
  const buttonPin = pinNumber(buttonBoardEndpoint.portId);
  const ledPin = pinNumber(ledBoardEndpoint.portId);
  if (buttonPin === null || ledPin === null) return null;

  return {
    target,
    source,
    buttonEndpoint,
    ledEndpoint,
    boardButtonPort: buttonBoardEndpoint.portId,
    boardLedPort: ledBoardEndpoint.portId,
    buttonPin,
    ledPin,
    activeLow,
  };
}

function makeSnapshot(tick: number, buttonPin: number, buttonLevel: DigitalLevel, ledPin: number, ledLevel: DigitalLevel, events: { tick: number; pin: number; value: DigitalLevel }[]): HarnessSnapshot {
  return {
    tick,
    pins: Object.freeze({ [buttonPin]: buttonLevel, [ledPin]: ledLevel }),
    events: Object.freeze(events.map((event) => ({ ...event }))),
  };
}

/**
 * Execute the small portable button/LED contract through the compiled C/WASM
 * module. More complex firmware deliberately returns null and remains on the
 * existing interpreter/remote path; this function never claims to run
 * arbitrary C++.
 */
export async function runPortableButtonLedHarness(
  project: HardwareGraph,
  inputs: Record<string, boolean | number>,
  durationMs: number,
): Promise<PortableButtonLedRun | null> {
  const contract = resolvePortableButtonLedContract(project);
  if (!contract) return null;

  let wasm;
  try {
    wasm = await loadBundledButtonLedWasm();
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new PortableHarnessUnavailableError(`Compiled C/WASM browser harness is unavailable: ${detail}`, contract.target.componentId, cause);
  }

  wasm.configure(contract.buttonPin, contract.ledPin, contract.activeLow);
  wasm.init();
  const buttonLevel = logicalInput(inputs, contract.buttonEndpoint.componentId, contract.target.componentId, contract.boardButtonPort, contract.activeLow);
  wasm.setButton(buttonLevel);
  let ledLevel: DigitalLevel = wasm.readLed();
  const ioEvents: { tick: number; pin: number; value: DigitalLevel }[] = [];
  const steps = Math.max(1, Math.min(1000, Math.ceil(Number.isFinite(durationMs) ? Math.max(0, durationMs) : 1000)));
  let snapshot = makeSnapshot(0, contract.buttonPin, buttonLevel, contract.ledPin, ledLevel, ioEvents);
  for (let step = 0; step < steps; step += 1) {
    wasm.setButton(buttonLevel);
    wasm.step();
    const nextLedLevel: DigitalLevel = wasm.readLed();
    if (nextLedLevel !== ledLevel) ioEvents.push({ tick: step, pin: contract.ledPin, value: nextLedLevel });
    ledLevel = nextLedLevel;
    snapshot = makeSnapshot(step + 1, contract.buttonPin, buttonLevel, contract.ledPin, ledLevel, ioEvents);
  }

  const ledValue = ledLevel === 1;
  const outputs: Record<string, boolean> = {
    [`${contract.target.componentId}:${contract.boardLedPort}`]: ledValue,
    [`${contract.ledEndpoint.componentId}:${contract.ledEndpoint.portId}`]: ledValue,
  };
  return {
    contract: "button-led",
    executionEngine: "c-wasm",
    abiVersion: wasm.abiVersion,
    ...(wasm.artifactSha256 ? { artifactSha256: wasm.artifactSha256 } : {}),
    boardId: contract.target.componentId,
    buttonId: contract.buttonEndpoint.componentId,
    ledId: contract.ledEndpoint.componentId,
    buttonEndpoint: contract.buttonEndpoint,
    ledEndpoint: contract.ledEndpoint,
    boardButtonPort: contract.boardButtonPort,
    boardLedPort: contract.boardLedPort,
    activeLow: contract.activeLow,
    durationMs: Math.max(0, Number.isFinite(durationMs) ? durationMs : 1000),
    steps,
    sourceFiles: contract.target.files.map((file) => file.name),
    snapshot,
    outputs,
    events: ioEvents.map((event) => ({
      timeMs: event.tick,
      endpoint: `${contract.ledEndpoint.componentId}:${contract.ledEndpoint.portId}`,
      value: event.value === 1,
      reason: "compiled C/WASM button-led output",
    })),
    capabilities: ["compiled-c-wasm", "deterministic-virtual-io", "browser-contract"],
    note: `Compiled C/WASM button-led firmware executed in the browser (ABI v${wasm.abiVersion}${wasm.artifactSha256 ? `, SHA-256 ${wasm.artifactSha256}` : ""}). Project pin ${contract.boardButtonPort} maps to the button input and ${contract.boardLedPort} maps to the LED output. Arbitrary C++ and device-specific libraries remain outside this bounded contract.`,
  };
}

export function hasPortableButtonLedContract(project: HardwareGraph) {
  return resolvePortableButtonLedContract(project) !== null;
}

export function boardPortExists(project: HardwareGraph, boardId: string, portId: string) {
  return componentPorts(project, boardId).some((port) => port.id === portId);
}
