import { componentPorts, resolveBoardPin, resolveFirmwareBinding, signalPort } from "../data/hardware.ts";
import { createProtocolRuntime, type DeviceRuntimeState, type ProtocolRuntime, type ProtocolTrace, type ProtocolWarning } from "./protocolRuntime.ts";
import type { HardwareGraph } from "../store/useProjectStore.ts";

export type RuntimeValue = boolean | number;

export interface RuntimeEvent {
  timeMs: number;
  endpoint: string;
  value: RuntimeValue;
  reason: string;
}

export interface RuntimeResult {
  status: "completed" | "completed-with-warnings" | "no-firmware" | "invalid-target" | "unsupported-api";
  runtime: "browser" | "remote";
  executionEngine?: "browser-interpreter" | "c-wasm" | "remote";
  abiVersion?: number;
  artifactSha256?: string;
  durationMs: number;
  outputs: Record<string, RuntimeValue>;
  events: RuntimeEvent[];
  programs: { componentId: string; writes: number; executions: number; sourceFiles: string[] }[];
  resolvedNets: number;
  serialOutput: string;
  targetIssues: { componentId: string; code: string; message: string }[];
  protocolEvents: ProtocolTrace[];
  deviceStates: DeviceRuntimeState[];
  warnings: ProtocolWarning[];
  unsupportedApis: string[];
  note: string;
}

type Endpoint = { componentId: string; portId: string };
type ExpressionContext = {
  constants: Map<string, RuntimeValue>;
  variables: Map<string, RuntimeValue>;
  inputs: Record<string, RuntimeValue>;
  project: HardwareGraph;
  boardId: string;
  dsu: DisjointSet;
  protocol: ProtocolRuntime;
  cursor: number;
};
type ExecutionContext = ExpressionContext & {
  outputs: Record<string, RuntimeValue>;
  netValues: Map<string, RuntimeValue>;
  events: RuntimeEvent[];
  serial: string[];
  duration: number;
  cursor: number;
  writes: number;
  executions: number;
  programId: string;
  unsupportedApis: Set<string>;
};

class DisjointSet {
  private parent = new Map<string, string>();
  add(key: string) { if (!this.parent.has(key)) this.parent.set(key, key); }
  find(key: string): string {
    this.add(key);
    const parent = this.parent.get(key)!;
    if (parent === key) return key;
    const root = this.find(parent);
    this.parent.set(key, root);
    return root;
  }
  union(a: string, b: string) { this.parent.set(this.find(a), this.find(b)); }
  members(root: string) { return [...this.parent.keys()].filter((key) => this.find(key) === root); }
  size() { return new Set([...this.parent.keys()].map((key) => this.find(key))).size; }
}

function endpointKey(endpoint: Endpoint) { return `${endpoint.componentId}:${endpoint.portId}`; }

function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function balancedSource(source: string) {
  const stack: string[] = [];
  let quote = "";
  let escaped = false;
  const pairs: Record<string, string> = { "}": "{", ")": "(", "]": "[" };
  for (const character of source) {
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'") quote = character;
    else if ("{([".includes(character)) stack.push(character);
    else if ("})]".includes(character)) {
      if (!stack.length || stack.pop() !== pairs[character]) return false;
    }
  }
  return stack.length === 0 && !quote;
}

function parseConstants(source: string) {
  const constants = new Map<string, RuntimeValue>();
  const matches = source.matchAll(/(?:(?:const|constexpr)\s+)?(?:bool|boolean|byte|short|int|long|float|double|uint8_t|uint16_t)\s+([A-Za-z_]\w*)\s*=\s*([^;]+);/g);
  for (const match of matches) {
    const raw = match[2].trim();
    if (/^-?(?:\d+(?:\.\d+)?|0x[\da-f]+)$/i.test(raw)) constants.set(match[1], Number(raw));
    else if (/^(true|HIGH)$/i.test(raw)) constants.set(match[1], true);
    else if (/^(false|LOW)$/i.test(raw)) constants.set(match[1], false);
  }
  const defines = source.matchAll(/^\s*#define\s+([A-Za-z_]\w*)\s+([^\s/]+).*$/gm);
  for (const match of defines) {
    const raw = match[2].trim();
    if (/^-?(?:\d+(?:\.\d+)?|0x[\da-f]+)$/i.test(raw)) constants.set(match[1], Number(raw));
    else if (/^(true|HIGH)$/i.test(raw)) constants.set(match[1], true);
    else if (/^(false|LOW)$/i.test(raw)) constants.set(match[1], false);
  }
  return constants;
}

function parseExpressions(source: string) {
  return parseConstants(source);
}

function matchingDelimiter(source: string, start: number, open: string, close: string) {
  let depth = 0;
  let quote = "";
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === open) depth += 1;
    if (character === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function functionBody(source: string, name: string) {
  const match = new RegExp(`\\b${name}\\s*\\([^)]*\\)\\s*\\{`, "i").exec(source);
  if (!match || match.index === undefined) return "";
  const open = source.indexOf("{", match.index);
  const close = matchingDelimiter(source, open, "{", "}");
  return close === -1 ? source.slice(open + 1) : source.slice(open + 1, close);
}

function readInputValue(inputs: Record<string, RuntimeValue>, project: HardwareGraph, dsu: DisjointSet, endpoint: Endpoint) {
  const direct = inputs[endpointKey(endpoint)];
  if (direct !== undefined) return { value: direct, semantic: false, inputKey: "" };
  const root = dsu.find(endpointKey(endpoint));
  for (const [key, value] of Object.entries(inputs)) {
    if (!/:(pressed|button|click|trigger|motion|signal|input|temperature|humidity|distance|value)$/i.test(key)) continue;
    const separator = key.indexOf(":");
    if (separator === -1) continue;
    const componentId = key.slice(0, separator);
    const inputKey = key.slice(separator + 1);
    const inputPort = signalPort(project, componentId, inputKey);
    if (inputPort && dsu.find(endpointKey({ componentId, portId: inputPort.id })) === root) return { value, semantic: true, inputKey };
  }
  for (const member of dsu.members(root)) {
    const value = inputs[member];
    if (value !== undefined) return { value, semantic: false, inputKey: "" };
  }
  return { value: false as RuntimeValue, semantic: false, inputKey: "" };
}

function splitTopLevel(source: string, operator: string) {
  let depth = 0;
  let quote = "";
  for (let index = 0; index <= source.length - operator.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth === 0 && source.slice(index, index + operator.length) === operator) return [source.slice(0, index), source.slice(index + operator.length)];
  }
  return null;
}

function asNumber(value: RuntimeValue) { return typeof value === "number" ? value : value ? 1 : 0; }

function evaluateExpression(expression: string, context: ExpressionContext, depth = 0): RuntimeValue {
  if (depth > 12) return false;
  let raw = expression.trim().replace(/;$/, "");
  while (raw.startsWith("(") && raw.endsWith(")") && matchingDelimiter(raw, 0, "(", ")") === raw.length - 1) raw = raw.slice(1, -1).trim();

  const or = splitTopLevel(raw, "||");
  if (or) return Boolean(evaluateExpression(or[0], context, depth + 1)) || Boolean(evaluateExpression(or[1], context, depth + 1));
  const and = splitTopLevel(raw, "&&");
  if (and) return Boolean(evaluateExpression(and[0], context, depth + 1)) && Boolean(evaluateExpression(and[1], context, depth + 1));

  const ternaryIndex = raw.indexOf("?");
  if (ternaryIndex !== -1) {
    const branches = splitTopLevel(raw.slice(ternaryIndex + 1), ":");
    if (branches) return evaluateExpression(raw.slice(0, ternaryIndex), context, depth + 1) ? evaluateExpression(branches[0], context, depth + 1) : evaluateExpression(branches[1], context, depth + 1);
  }

  const comparison = raw.match(/^(.+?)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/);
  if (comparison) {
    const left = evaluateExpression(comparison[1], context, depth + 1);
    const right = evaluateExpression(comparison[3], context, depth + 1);
    switch (comparison[2]) {
      case "===": case "==": return left === right || asNumber(left) === asNumber(right);
      case "!==": case "!=": return !(left === right || asNumber(left) === asNumber(right));
      case ">=": return asNumber(left) >= asNumber(right);
      case "<=": return asNumber(left) <= asNumber(right);
      case ">": return asNumber(left) > asNumber(right);
      case "<": return asNumber(left) < asNumber(right);
    }
  }

  const arithmetic = raw.match(/^(.+?)\s*([+\-*/%])\s*(.+)$/);
  if (arithmetic && !/^[-+]?\d+(?:\.\d+)?$/.test(raw)) {
    const left = asNumber(evaluateExpression(arithmetic[1], context, depth + 1));
    const right = asNumber(evaluateExpression(arithmetic[3], context, depth + 1));
    if (arithmetic[2] === "+") return left + right;
    if (arithmetic[2] === "-") return left - right;
    if (arithmetic[2] === "*") return left * right;
    if (arithmetic[2] === "/") return right === 0 ? 0 : left / right;
    return right === 0 ? 0 : left % right;
  }

  const digitalRead = raw.match(/^digitalRead\s*\(\s*([^)]*)\s*\)$/i);
  if (digitalRead) {
    const endpoint = resolveBoardPin(context.project, context.boardId, digitalRead[1], context.constants);
    const input = endpoint ? readInputValue(context.inputs, context.project, context.dsu, endpoint) : { value: false as RuntimeValue, semantic: false, inputKey: "" };
    return input.semantic && /pressed|button|click|trigger/i.test(input.inputKey) ? !input.value : Boolean(input.value);
  }
  const analogRead = raw.match(/^analogRead\s*\(\s*([^)]*)\s*\)$/i);
  if (analogRead) {
    const endpoint = resolveBoardPin(context.project, context.boardId, analogRead[1], context.constants);
    if (!endpoint) return 0;
    if (Object.prototype.hasOwnProperty.call(context.inputs, endpointKey(endpoint))) return asNumber(context.inputs[endpointKey(endpoint)]);
    return context.protocol.analogRead(context.boardId, endpoint.portId, context.inputs);
  }
  const wireAvailable = raw.match(/^Wire\.available\s*\(\s*\)$/i);
  if (wireAvailable) return context.protocol.i2cAvailable(context.boardId);
  const wireRead = raw.match(/^Wire\.read\s*\(\s*\)$/i);
  if (wireRead) return context.protocol.i2cRead(context.boardId);
  const serialAvailable = raw.match(/^Serial\.available\s*\(\s*\)$/i);
  if (serialAvailable) return context.protocol.serialAvailable(context.boardId);
  const serialRead = raw.match(/^Serial\.read\s*\(\s*\)$/i);
  if (serialRead) return context.protocol.serialRead(context.boardId);
  const spiTransfer = raw.match(/^SPI\.transfer\s*\(\s*([^)]*)\s*\)$/i);
  if (spiTransfer) return context.protocol.spiTransfer(context.boardId, asNumber(evaluateExpression(spiTransfer[1], context)));
  const millis = raw.match(/^millis\s*\(\s*\)$/i);
  if (millis) return context.cursor;
  const micros = raw.match(/^micros\s*\(\s*\)$/i);
  if (micros) return context.cursor * 1000;
  const mapCall = raw.match(/^map\s*\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)$/i);
  if (mapCall) {
    const value = asNumber(evaluateExpression(mapCall[1], context));
    const fromLow = asNumber(evaluateExpression(mapCall[2], context));
    const fromHigh = asNumber(evaluateExpression(mapCall[3], context));
    const toLow = asNumber(evaluateExpression(mapCall[4], context));
    const toHigh = asNumber(evaluateExpression(mapCall[5], context));
    return fromHigh === fromLow ? toLow : (value - fromLow) * (toHigh - toLow) / (fromHigh - fromLow) + toLow;
  }
  const constrain = raw.match(/^constrain\s*\(\s*([^,]+),\s*([^,]+),\s*([^)]+)\)$/i);
  if (constrain) {
    const value = asNumber(evaluateExpression(constrain[1], context));
    const low = asNumber(evaluateExpression(constrain[2], context));
    const high = asNumber(evaluateExpression(constrain[3], context));
    return Math.min(high, Math.max(low, value));
  }
  if (/^!/.test(raw)) return !evaluateExpression(raw.slice(1), context, depth + 1);
  if (/^(true|HIGH)$/i.test(raw)) return true;
  if (/^(false|LOW)$/i.test(raw)) return false;
  const character = raw.match(/^'([^'\\]|\\.)'$/);
  if (character) {
    const value = character[1];
    return value.length === 2 && value[0] === "\\" ? value.charCodeAt(1) : value.charCodeAt(0);
  }
  if (/^-?(?:\d+(?:\.\d+)?|0x[\da-f]+)$/i.test(raw)) return /^0x/i.test(raw) ? Number.parseInt(raw, 16) : Number(raw);
  if (context.variables.has(raw)) return context.variables.get(raw)!;
  if (context.constants.has(raw)) return context.constants.get(raw)!;
  return false;
}

function nextStatement(source: string, start: number) {
  let depth = 0;
  let quote = "";
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === ";" && depth === 0) return { text: source.slice(start, index + 1), next: index + 1 };
  }
  return { text: source.slice(start), next: source.length };
}

function blockOrStatement(source: string, start: number) {
  const trimmedStart = source.slice(start).search(/\S/);
  const actualStart = trimmedStart === -1 ? source.length : start + trimmedStart;
  if (source[actualStart] === "{") {
    const close = matchingDelimiter(source, actualStart, "{", "}");
    return { body: close === -1 ? source.slice(actualStart + 1) : source.slice(actualStart + 1, close), next: close === -1 ? source.length : close + 1 };
  }
  const statement = nextStatement(source, actualStart);
  return { body: statement.text, next: statement.next };
}

function executeBlock(source: string, context: ExecutionContext) {
  let index = 0;
  while (index < source.length && context.executions < 20_000) {
    while (/\s|;/.test(source[index] ?? "")) index += 1;
    if (index >= source.length) break;
    const remainder = source.slice(index);
    const ifMatch = remainder.match(/^if\s*\(/i);
    if (ifMatch) {
      const conditionStart = index + remainder.indexOf("(");
      const conditionEnd = matchingDelimiter(source, conditionStart, "(", ")");
      if (conditionEnd === -1) break;
      const condition = source.slice(conditionStart + 1, conditionEnd);
      const yes = blockOrStatement(source, conditionEnd + 1);
      let after = yes.next;
      while (/\s/.test(source[after] ?? "")) after += 1;
      let no: { body: string; next: number } | null = null;
      if (/^else\b/i.test(source.slice(after))) no = blockOrStatement(source, after + 4);
      const chosen = evaluateExpression(condition, context) ? yes : no;
      if (chosen) executeBlock(chosen.body, context);
      index = no ? no.next : after;
      continue;
    }
    const statement = nextStatement(source, index);
    executeStatement(statement.text, context);
    index = statement.next;
  }
}

function executeStatement(statement: string, context: ExecutionContext) {
  const text = statement.trim().replace(/;$/, "").trim();
  if (!text) return;
  context.executions += 1;

  const delay = text.match(/^delay\s*\(\s*([^)]*)\s*\)$/i);
  if (delay) {
    context.cursor += Math.max(0, asNumber(evaluateExpression(delay[1], context)));
    context.protocol.advanceTo(context.cursor);
    return;
  }

  const pinMode = text.match(/^pinMode\s*\(\s*([^,]+),\s*([^)]+)\)$/i);
  if (pinMode) return;

  const wireBegin = text.match(/^Wire\.begin\s*\(.*\)$/i);
  if (wireBegin) return;
  const wireBeginTransmission = text.match(/^Wire\.beginTransmission\s*\(\s*([^)]*)\s*\)$/i);
  if (wireBeginTransmission) {
    context.protocol.i2cBeginTransmission(context.boardId, asNumber(evaluateExpression(wireBeginTransmission[1], context)));
    return;
  }
  const wireWrite = text.match(/^Wire\.write\s*\(\s*([^,)]*)(?:,[^)]*)?\s*\)$/i);
  if (wireWrite) {
    context.protocol.i2cWrite(context.boardId, asNumber(evaluateExpression(wireWrite[1], context)));
    return;
  }
  const wireEndTransmission = text.match(/^Wire\.endTransmission\s*\(.*\)$/i);
  if (wireEndTransmission) {
    context.protocol.i2cEndTransmission(context.boardId);
    return;
  }
  const wireRequestFrom = text.match(/^Wire\.requestFrom\s*\(\s*([^,]+),\s*([^,]+)(?:,[^)]*)?\s*\)$/i);
  if (wireRequestFrom) {
    context.protocol.i2cRequestFrom(context.boardId, asNumber(evaluateExpression(wireRequestFrom[1], context)), asNumber(evaluateExpression(wireRequestFrom[2], context)));
    return;
  }

  const spiBegin = text.match(/^SPI\.begin\s*\(.*\)$/i);
  if (spiBegin) return;
  const spiTransaction = text.match(/^SPI\.beginTransaction\s*\(.*\)$/i);
  if (spiTransaction) {
    context.protocol.spiBeginTransaction(context.boardId);
    return;
  }
  const spiTransfer = text.match(/^SPI\.transfer\s*\(\s*([^)]*)\s*\)$/i);
  if (spiTransfer) {
    context.protocol.spiTransfer(context.boardId, asNumber(evaluateExpression(spiTransfer[1], context)));
    return;
  }
  const spiEndTransaction = text.match(/^SPI\.endTransaction\s*\(.*\)$/i);
  if (spiEndTransaction) {
    context.protocol.spiEndTransaction(context.boardId);
    return;
  }
  const spiEnd = text.match(/^SPI\.end\s*\(.*\)$/i);
  if (spiEnd) return;

  const serial = text.match(/^Serial\.(?:print|println)\s*\((.*)\)$/i);
  if (serial) {
    const raw = serial[1].trim();
    const value = /^".*"$/.test(raw) ? raw.slice(1, -1) : String(evaluateExpression(raw, context));
    const output = value + (/println/i.test(text) ? "\n" : "");
    context.serial.push(output);
    context.protocol.serialWrite(context.boardId, [...new TextEncoder().encode(output)]);
    return;
  }
  const serialBegin = text.match(/^Serial\.begin\s*\(.*\)$/i);
  if (serialBegin) return;
  const serialWrite = text.match(/^Serial\.write\s*\(\s*([^)]*)\s*\)$/i);
  if (serialWrite) {
    const value = asNumber(evaluateExpression(serialWrite[1], context));
    context.protocol.serialWrite(context.boardId, [value]);
    return;
  }

  const tone = text.match(/^tone\s*\(\s*([^,]+),\s*([^,]+),\s*([^)]+)\)$/i);
  if (tone) {
    const endpoint = resolveBoardPin(context.project, context.boardId, tone[1], context.constants);
    if (!endpoint) return;
    const root = context.dsu.find(endpointKey(endpoint));
    const start = Math.min(context.cursor, context.duration);
    for (const member of context.dsu.members(root)) {
      context.outputs[member] = true;
      context.events.push({ timeMs: start, endpoint: member, value: true, reason: `${context.programId} firmware tone` });
    }
    context.writes += 1;
    context.protocol.pwmWrite(context.boardId, endpoint.portId, 255, asNumber(evaluateExpression(tone[2], context)));
    context.cursor += Math.max(0, asNumber(evaluateExpression(tone[3], context)));
    for (const member of context.dsu.members(root)) {
      context.outputs[member] = false;
      context.events.push({ timeMs: Math.min(context.cursor, context.duration), endpoint: member, value: false, reason: `${context.programId} firmware tone complete` });
    }
    return;
  }

  const write = text.match(/^(digitalWrite|analogWrite)\s*\((.*)\)$/i);
  const writeArguments = write ? splitTopLevel(write[2], ",") : null;
  if (write && writeArguments) {
    const endpoint = resolveBoardPin(context.project, context.boardId, writeArguments[0], context.constants);
    if (!endpoint) return;
    const rawValue = evaluateExpression(writeArguments[1], context);
    const value = write[1].toLowerCase() === "analogwrite" ? asNumber(rawValue) : Boolean(rawValue);
    const root = context.dsu.find(endpointKey(endpoint));
    context.netValues.set(root, value);
    context.writes += 1;
    for (const member of context.dsu.members(root)) {
      context.outputs[member] = value;
      context.events.push({ timeMs: Math.min(context.cursor, context.duration), endpoint: member, value, reason: `${context.programId} firmware ${write[1]}` });
    }
    return;
  }

  const assignment = text.match(/^(?:(?:const\s+)?(?:bool|boolean|byte|short|int|long|float|double|uint8_t|uint16_t)\s+)?([A-Za-z_]\w*)\s*=\s*(.+)$/);
  if (assignment) context.variables.set(assignment[1], evaluateExpression(assignment[2], context));

  const unsupported = text.match(/^(Wire|SPI|Serial|digitalRead|digitalWrite|analogRead|analogWrite|pinMode|delay|tone|millis|micros|map|constrain)\.?(?:[A-Za-z_]\w*)?\s*\(/i);
  if (unsupported) context.unsupportedApis.add(unsupported[0].replace(/\s*\($/, "").trim());
}

function sourceForTarget(target: HardwareGraph["firmwareTargets"][number]) {
  return stripComments(target.files.filter((file) => /\.(ino|c|cpp|h)$/i.test(file.name)).map((file) => file.content).join("\n"));
}

const SUPPORTED_PROTOCOL_APIS = new Set([
  "Wire.begin",
  "Wire.beginTransmission",
  "Wire.write",
  "Wire.endTransmission",
  "Wire.requestFrom",
  "Wire.available",
  "Wire.read",
  "SPI.begin",
  "SPI.beginTransaction",
  "SPI.transfer",
  "SPI.endTransaction",
  "SPI.end",
  "Serial.begin",
  "Serial.print",
  "Serial.println",
  "Serial.write",
  "Serial.available",
  "Serial.read",
]);

function collectUnsupportedApis(source: string, output: Set<string>) {
  for (const match of source.matchAll(/\b(Wire|SPI|Serial)\.([A-Za-z_]\w*)\s*\(/g)) {
    const api = `${match[1]}.${match[2]}`;
    if (!SUPPORTED_PROTOCOL_APIS.has(api)) output.add(api);
  }
  for (const match of source.matchAll(/\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\(/g)) {
    if (!["Wire", "SPI", "Serial"].includes(match[1])) output.add(`C++:${match[1]}.${match[2]}`);
  }
  const supported = new Set([
    "setup", "loop", "if", "else", "for", "while", "switch", "digitalRead", "digitalWrite", "analogRead", "analogWrite",
    "pinMode", "delay", "tone", "millis", "micros", "map", "constrain", "min", "max", "abs", "round", "SPISettings",
  ]);
  for (const match of source.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
    const name = match[1];
    const offset = match.index ?? 0;
    if (offset > 0 && source[offset - 1] === ".") continue;
    if (!supported.has(name)) output.add(`C++:${name}`);
  }
}

export function runFirmwareRuntime(project: HardwareGraph, inputs: Record<string, RuntimeValue>, durationMs: number): RuntimeResult {
  const duration = Math.max(0, Math.min(Number.isFinite(durationMs) ? durationMs : 1000, 86_400_000));
  const dsu = new DisjointSet();
  for (const component of project.components) for (const port of componentPorts(project, component.id)) dsu.add(endpointKey({ componentId: component.id, portId: port.id }));
  for (const connection of project.connections) dsu.union(endpointKey(connection.source), endpointKey(connection.target));

  const events: RuntimeEvent[] = [];
  const outputs: Record<string, RuntimeValue> = {};
  const programs: RuntimeResult["programs"] = [];
  const targetIssues: RuntimeResult["targetIssues"] = [];
  const netValues = new Map<string, RuntimeValue>();
  for (const [key, value] of Object.entries(inputs)) netValues.set(dsu.find(key), value);
  const serial: string[] = [];
  const protocol = createProtocolRuntime(project, dsu, duration, inputs);
  const runtimeUnsupported = new Set<string>();

  for (const target of project.firmwareTargets) {
    const binding = resolveFirmwareBinding(project, target.componentId);
    if (!binding.component || !binding.definition) {
      targetIssues.push({ componentId: target.componentId, code: "INVALID_FIRMWARE_TARGET", message: `Firmware target ${target.componentId} is not attached to a catalog component.` });
      continue;
    }
    if (!target.definitionId) {
      targetIssues.push({ componentId: target.componentId, code: "FIRMWARE_DEFINITION_REQUIRED", message: "Firmware must retain the exact catalog definition of its board target." });
      continue;
    }
    if (!target.boardFqbn) {
      targetIssues.push({ componentId: target.componentId, code: "FIRMWARE_FQBN_REQUIRED", message: "Firmware must declare the exact compiler target for its board." });
      continue;
    }
    if (binding.definition.category !== "board") {
      targetIssues.push({ componentId: target.componentId, code: "NON_BOARD_FIRMWARE_TARGET", message: `${binding.definition.title} is not a programmable board.` });
      continue;
    }
    if (!["behavioral", "engine-backed"].includes(binding.definition.model.support)) {
      targetIssues.push({ componentId: target.componentId, code: "UNSUPPORTED_BOARD_MODEL", message: `${binding.definition.title} has no verified executable firmware model in the browser runtime.` });
      continue;
    }
    if (!binding.definitionMatchesTarget) {
      targetIssues.push({ componentId: target.componentId, code: "FIRMWARE_DEFINITION_MISMATCH", message: `Firmware was written for ${target.definitionId}, but the current board is ${binding.component.definitionId}.` });
      continue;
    }
    if (!binding.fqbnMatchesDefinition) {
      targetIssues.push({ componentId: target.componentId, code: "FIRMWARE_FQBN_MISMATCH", message: `Firmware uses ${target.boardFqbn}, but ${binding.definition.title} maps to ${binding.targetConfig?.fqbn}.` });
      continue;
    }
    const source = sourceForTarget(target);
    collectUnsupportedApis(source, runtimeUnsupported);
    if (!source) {
      targetIssues.push({ componentId: target.componentId, code: "UNSUPPORTED_FIRMWARE_FILES", message: `No browser-supported C/C++ source file was found for ${binding.definition.title}.` });
      continue;
    }
    if (!balancedSource(source)) {
      targetIssues.push({ componentId: target.componentId, code: "MALFORMED_FIRMWARE", message: "Firmware source has unbalanced delimiters and was not executed." });
      continue;
    }
    if (!/\b(?:setup|loop)\s*\(/i.test(source)) {
      targetIssues.push({ componentId: target.componentId, code: "NO_EXECUTABLE_ENTRYPOINT", message: "The supported Arduino runtime requires a setup() or loop() entrypoint." });
      continue;
    }
    const constants = parseConstants(source);
    const context: ExecutionContext = {
      constants,
      variables: parseExpressions(source),
      inputs,
      project,
      boardId: target.componentId,
      dsu,
      outputs,
      netValues,
      events,
      serial,
      duration,
      cursor: 0,
      writes: 0,
      executions: 0,
      programId: target.componentId,
      protocol,
      unsupportedApis: new Set<string>(),
    };
    executeBlock(functionBody(source, "setup"), context);
    const loop = functionBody(source, "loop");
    const maxIterations = loop ? (duration > 0 ? 20_000 : 1) : 0;
    let iteration = 0;
    while (loop && iteration < maxIterations && (iteration === 0 || context.cursor < duration)) {
      const before = context.cursor;
      executeBlock(loop, context);
      iteration += 1;
      if (context.cursor === before) break;
    }
    programs.push({ componentId: target.componentId, writes: context.writes, executions: context.executions, sourceFiles: target.files.map((file) => file.name) });
  }

  protocol.advanceTo(duration);

  for (const [key, value] of Object.entries(inputs)) outputs[key] ??= value;
  const unsupportedApis = [...runtimeUnsupported];
  const status = programs.length > 0 ? runtimeUnsupported.size > 0 ? "unsupported-api" : protocol.warnings.length > 0 ? "completed-with-warnings" : "completed" : targetIssues.length > 0 ? "invalid-target" : "no-firmware";
  return {
    status,
    runtime: "browser",
    executionEngine: "browser-interpreter",
    durationMs: duration,
    outputs,
    events,
    programs,
    resolvedNets: dsu.size(),
    serialOutput: serial.join(""),
    targetIssues,
    protocolEvents: protocol.events,
    deviceStates: protocol.deviceStates,
    warnings: protocol.warnings,
    unsupportedApis,
    note: programs.length > 0
      ? runtimeUnsupported.size > 0
        ? `Firmware ran with unsupported Arduino APIs: ${[...runtimeUnsupported].join(", ")}. No unsupported call was treated as a successful device operation.`
        : protocol.warnings.length > 0
          ? `Firmware executed with ${protocol.warnings.length} protocol warning(s). Review device wiring and model coverage before treating the result as valid.`
        : "Firmware executed in the browser runtime. Control flow, reads, writes, delays, serial output, protocol transactions, and connected nets were evaluated together."
      : targetIssues.length > 0
        ? "Firmware targets were found but could not be executed until their board bindings or source files are corrected."
        : "No firmware target is attached to this project, so only input signals were observed.",
  };
}
