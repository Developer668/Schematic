import { catalog } from "../data/catalog.ts";
import type { HardwareGraph } from "../store/useProjectStore.ts";

export type RuntimeValue = boolean | number;

export interface RuntimeEvent {
  timeMs: number;
  endpoint: string;
  value: RuntimeValue;
  reason: string;
}

export interface RuntimeResult {
  status: "completed" | "no-firmware";
  runtime: "browser";
  durationMs: number;
  outputs: Record<string, RuntimeValue>;
  events: RuntimeEvent[];
  programs: { componentId: string; writes: number; executions: number; sourceFiles: string[] }[];
  resolvedNets: number;
  serialOutput: string;
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

function componentPorts(project: HardwareGraph, componentId: string) {
  const instance = project.components.find((component) => component.id === componentId);
  return catalog.find((definition) => definition.id === instance?.definitionId)?.ports ?? [];
}

function signalPort(project: HardwareGraph, componentId: string, requestedKey: string) {
  const ports = componentPorts(project, componentId);
  return ports.find((port) => port.id.toLowerCase() === requestedKey.toLowerCase())
    ?? ports.find((port) => ["A", "OUT", "P1", "IN"].includes(port.id) && !["power", "ground"].includes(port.domain));
}

function pinEndpoint(project: HardwareGraph, boardId: string, expression: string, constants: Map<string, RuntimeValue>): Endpoint | null {
  const target = project.components.find((component) => component.id === boardId);
  const definition = catalog.find((item) => item.id === target?.definitionId);
  const ports = definition?.ports ?? [];
  const pinExpression = expression.trim().replace(/^\(+|\)+$/g, "");
  const constantValue = constants.get(pinExpression);
  const numeric = typeof constantValue === "number" ? String(constantValue) : pinExpression.match(/\d+/)?.[0];
  if (!numeric) return null;
  const direct = ports.find((port) => port.id === `GPIO${numeric}` || port.id === `D${numeric}` || port.id === `A${numeric}`);
  if (direct) return { componentId: boardId, portId: direct.id };
  for (const port of ports) {
    const match = port.id.match(/(?:GPIO|D|A)(\d+)/i);
    if (match?.[1] === numeric) return { componentId: boardId, portId: port.id };
  }
  return null;
}

function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function parseConstants(source: string) {
  const constants = new Map<string, RuntimeValue>();
  const matches = source.matchAll(/(?:(?:const|constexpr)\s+)?(?:bool|boolean|byte|short|int|long|float|double|uint8_t|uint16_t)\s+([A-Za-z_]\w*)\s*=\s*([^;]+);/g);
  for (const match of matches) {
    const raw = match[2].trim();
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) constants.set(match[1], Number(raw));
    else if (/^(true|HIGH)$/i.test(raw)) constants.set(match[1], true);
    else if (/^(false|LOW)$/i.test(raw)) constants.set(match[1], false);
  }
  return constants;
}

function parseExpressions(source: string) {
  const expressions = new Map<string, RuntimeValue>();
  const matches = source.matchAll(/(?:(?:const|constexpr)\s+)?(?:bool|boolean|byte|short|int|long|float|double|uint8_t|uint16_t)\s+([A-Za-z_]\w*)\s*=\s*([^;]+);/g);
  for (const match of matches) {
    const raw = match[2].trim();
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) expressions.set(match[1], Number(raw));
    else if (/^(true|HIGH)$/i.test(raw)) expressions.set(match[1], true);
    else if (/^(false|LOW)$/i.test(raw)) expressions.set(match[1], false);
  }
  return expressions;
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
    const endpoint = pinEndpoint(context.project, context.boardId, digitalRead[1], context.constants);
    const input = endpoint ? readInputValue(context.inputs, context.project, context.dsu, endpoint) : { value: false as RuntimeValue, semantic: false, inputKey: "" };
    return input.semantic && /pressed|button|click|trigger/i.test(input.inputKey) ? !input.value : Boolean(input.value);
  }
  const analogRead = raw.match(/^analogRead\s*\(\s*([^)]*)\s*\)$/i);
  if (analogRead) {
    const endpoint = pinEndpoint(context.project, context.boardId, analogRead[1], context.constants);
    if (!endpoint) return 0;
    return readInputValue(context.inputs, context.project, context.dsu, endpoint).value;
  }
  if (/^!/.test(raw)) return !evaluateExpression(raw.slice(1), context, depth + 1);
  if (/^(true|HIGH)$/i.test(raw)) return true;
  if (/^(false|LOW)$/i.test(raw)) return false;
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
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
    return;
  }

  const serial = text.match(/^Serial\.(?:print|println)\s*\((.*)\)$/i);
  if (serial) {
    const raw = serial[1].trim();
    const value = /^".*"$/.test(raw) ? raw.slice(1, -1) : String(evaluateExpression(raw, context));
    context.serial.push(value + (/println/i.test(text) ? "\n" : ""));
    return;
  }

  const tone = text.match(/^tone\s*\(\s*([^,]+),\s*([^,]+),\s*([^)]+)\)$/i);
  if (tone) {
    const endpoint = pinEndpoint(context.project, context.boardId, tone[1], context.constants);
    if (!endpoint) return;
    const root = context.dsu.find(endpointKey(endpoint));
    const start = Math.min(context.cursor, context.duration);
    for (const member of context.dsu.members(root)) {
      context.outputs[member] = true;
      context.events.push({ timeMs: start, endpoint: member, value: true, reason: `${context.programId} firmware tone` });
    }
    context.writes += 1;
    context.cursor += Math.max(0, asNumber(evaluateExpression(tone[3], context)));
    for (const member of context.dsu.members(root)) {
      context.outputs[member] = false;
      context.events.push({ timeMs: Math.min(context.cursor, context.duration), endpoint: member, value: false, reason: `${context.programId} firmware tone complete` });
    }
    return;
  }

  const write = text.match(/^(digitalWrite|analogWrite)\s*\(\s*([^,]+),\s*([^)]+)\)$/i);
  if (write) {
    const endpoint = pinEndpoint(context.project, context.boardId, write[2], context.constants);
    if (!endpoint) return;
    const rawValue = evaluateExpression(write[3], context);
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
}

function sourceForTarget(target: HardwareGraph["firmwareTargets"][number]) {
  return stripComments(target.files.filter((file) => /\.(ino|c|cpp|h)$/i.test(file.name)).map((file) => file.content).join("\n"));
}

export function runFirmwareRuntime(project: HardwareGraph, inputs: Record<string, RuntimeValue>, durationMs: number): RuntimeResult {
  const duration = Math.max(0, Math.min(Number.isFinite(durationMs) ? durationMs : 1000, 86_400_000));
  const dsu = new DisjointSet();
  for (const component of project.components) for (const port of componentPorts(project, component.id)) dsu.add(endpointKey({ componentId: component.id, portId: port.id }));
  for (const connection of project.connections) dsu.union(endpointKey(connection.source), endpointKey(connection.target));

  const events: RuntimeEvent[] = [];
  const outputs: Record<string, RuntimeValue> = {};
  const programs: RuntimeResult["programs"] = [];
  const netValues = new Map<string, RuntimeValue>();
  for (const [key, value] of Object.entries(inputs)) netValues.set(dsu.find(key), value);
  const serial: string[] = [];

  for (const target of project.firmwareTargets) {
    const source = sourceForTarget(target);
    if (!source) continue;
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
    programs.push({ componentId: target.componentId, writes: (source.match(/(?:digitalWrite|analogWrite)\s*\(/gi) ?? []).length, executions: context.executions, sourceFiles: target.files.map((file) => file.name) });
  }

  for (const [key, value] of Object.entries(inputs)) outputs[key] ??= value;
  const status = programs.length > 0 ? "completed" : "no-firmware";
  return {
    status,
    runtime: "browser",
    durationMs: duration,
    outputs,
    events,
    programs,
    resolvedNets: dsu.size(),
    serialOutput: serial.join(""),
    note: programs.length > 0
      ? "Firmware executed in the browser runtime. Control flow, reads, writes, delays, serial output, and connected nets were evaluated together."
      : "No firmware target is attached to this project, so only input signals were observed.",
  };
}
