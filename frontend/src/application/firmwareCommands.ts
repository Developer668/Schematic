import { resolveBoardPin, resolveFirmwareBinding } from "../data/hardware.ts";
import { useProjectStore } from "../store/useProjectStore.ts";
import { validateProject } from "../store/useValidationStore.ts";
import type { CodeFileRecord, CodeLanguage } from "../store/behaviorPersistence.ts";

export const MAX_FIRMWARE_CHECK_DURATION_MS = 10_000;
export const MAX_FIRMWARE_CHECK_INPUTS = 64;
const MAX_EXECUTED_STATEMENTS = 5_000;
const MAX_SOURCE_BYTES = 512 * 1024;

export interface FirmwareCommandError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export type FirmwareCommandResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: FirmwareCommandError; data?: Record<string, unknown> };

export interface SourcePreflightIssue {
  code: string;
  message: string;
  line?: number;
}

export interface SourcePreflightReport {
  status: "passed" | "failed";
  errors: SourcePreflightIssue[];
  warnings: SourcePreflightIssue[];
  supportedForBrowserExecution: boolean;
}

export type FirmwareCheckStatus = "browser-executed" | "browser-executed-with-warnings" | "browser-partial" | "browser-unavailable";

export interface FirmwareCheckResult {
  componentId: string;
  status: FirmwareCheckStatus;
  sourceSha256: string;
  preflight: SourcePreflightReport;
  runtime: {
    status: "completed" | "completed-with-warnings" | "partial" | "unavailable";
    runtime: "browser";
    executionEngine?: "bounded-arduino-subset";
    durationMs: number;
    outputs: Record<string, boolean | number>;
    events: Array<{ timeMs: number; endpoint: string; value: boolean | number; reason: string }>;
    programs: Array<{ componentId: string; statements: number; loopIterations: number; sourceFiles: string[] }>;
    serialOutput: string;
    warnings: SourcePreflightIssue[];
    unsupportedApis: string[];
    note: string;
    connectionCheck: { status: "completed"; connectionsChecked: number; note: string };
    codeExecution: { status: "executed" | "partial" | "unavailable"; reason?: string; physicalHardwareNextStep: string };
  };
  staticGraph: ReturnType<typeof validateProject>;
  compilation: { status: "not-performed"; reason: string };
  claims: {
    sourceCodeExecutedInBrowser: boolean;
    sourceCodeCompiled: false;
    electricalBehaviorSimulated: false;
    uploadedToHardware: false;
    physicalHardwareVerified: false;
  };
  notice: string;
}

export interface FirmwareCheckRequest {
  componentId: string;
  durationMs?: number;
  inputs?: Record<string, number | boolean>;
}

function fail<T = never>(code: string, message: string, retryable = false, details: Record<string, unknown> = {}): FirmwareCommandResult<T> {
  return {
    ok: false,
    error: { code, message, retryable, ...(Object.keys(details).length ? { details } : {}) },
    ...(Object.keys(details).length ? { data: details } : {}),
  };
}

function boundedIdentifier(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 200;
}

function lineAt(source: string, index: number) {
  return source.slice(0, Math.max(0, index)).split("\n").length;
}

function stripComments(source: string) {
  let output = "";
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
        output += char;
      } else output += " ";
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        output += "  ";
        index += 1;
      } else output += char === "\n" ? "\n" : " ";
      continue;
    }
    if (quote) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      output += char;
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      output += "  ";
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      output += "  ";
      index += 1;
      continue;
    }
    output += char;
  }
  return output;
}

function delimiterIssue(source: string): SourcePreflightIssue | null {
  const stack: Array<{ char: string; index: number }> = [];
  const closing: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  let quote = "";
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") stack.push({ char, index });
    if (char === ")" || char === "]" || char === "}") {
      const previous = stack.pop();
      if (!previous || previous.char !== closing[char]) return { code: "UNBALANCED_DELIMITER", message: `Unexpected ${char}.`, line: lineAt(source, index) };
    }
  }
  if (quote) return { code: "UNTERMINATED_STRING", message: "A quoted string or character literal is not terminated." };
  const remaining = stack.pop();
  return remaining ? { code: "UNBALANCED_DELIMITER", message: `Unclosed ${remaining.char}.`, line: lineAt(source, remaining.index) } : null;
}

function sourceText(files: readonly Pick<CodeFileRecord, "name" | "content">[]) {
  return files
    .filter((file) => /\.(?:ino|c|cc|cpp|cxx|h|hpp)$/i.test(file.name))
    .map((file) => `\n// file:${file.name}\n${file.content}`)
    .join("\n");
}

function callNames(source: string) {
  const names = new Set<string>();
  for (const match of source.matchAll(/\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)\s*\(/g)) names.add(match[1]);
  return names;
}

const SUPPORTED_CALLS = new Set([
  "setup", "loop", "if", "pinMode", "digitalWrite", "analogWrite", "digitalRead", "analogRead",
  "delay", "millis", "micros", "tone", "noTone", "map", "constrain", "min", "max", "abs", "round",
  "Serial.begin", "Serial.print", "Serial.println", "Serial.write",
]);

export function preflightSource(files: readonly Pick<CodeFileRecord, "name" | "content">[], language: CodeLanguage): SourcePreflightReport {
  const errors: SourcePreflightIssue[] = [];
  const warnings: SourcePreflightIssue[] = [];
  const bytes = files.reduce((total, file) => total + new TextEncoder().encode(file.content).byteLength, 0);
  if (bytes > MAX_SOURCE_BYTES) errors.push({ code: "SOURCE_TOO_LARGE", message: `Browser Check accepts at most ${MAX_SOURCE_BYTES} bytes of source per target.` });

  const browserLanguage = language === "arduino" || language === "c" || language === "cpp";
  if (!browserLanguage) {
    warnings.push({ code: "BROWSER_LANGUAGE_UNSUPPORTED", message: `Browser Check does not execute ${language} source; it remains editable/exportable.` });
    return { status: errors.length ? "failed" : "passed", errors, warnings, supportedForBrowserExecution: false };
  }

  const source = sourceText(files);
  if (!source.trim()) errors.push({ code: "NO_BROWSER_SOURCE", message: "No .ino/.c/.cpp source file is available for Browser Check." });
  const stripped = stripComments(source);
  const delimiter = delimiterIssue(stripped);
  if (delimiter) errors.push(delimiter);
  if (language === "arduino" && !/\b(?:setup|loop)\s*\([^)]*\)\s*\{/m.test(stripped)) {
    errors.push({ code: "NO_ARDUINO_ENTRYPOINT", message: "Arduino Browser Check requires setup() or loop()." });
  }
  if (/\b(?:goto|asm|__asm__|new|delete|throw|try|catch)\b/.test(stripped)) {
    warnings.push({ code: "UNSUPPORTED_LANGUAGE_FEATURE", message: "Browser Check does not execute dynamic allocation, exceptions, goto, or inline assembly." });
  }
  if (/\b(?:for|while|do|switch)\s*(?:\(|\{)/.test(stripped)) {
    warnings.push({ code: "BOUNDED_CONTROL_FLOW", message: "Complex loops/switch statements are not interpreted; Browser Check will report partial execution instead of guessing." });
  }
  const unsupportedCalls = [...callNames(stripped)].filter((name) => !SUPPORTED_CALLS.has(name) && !/^(?:void|int|bool|byte|long|float|double|String)$/.test(name));
  if (unsupportedCalls.length) warnings.push({ code: "UNSUPPORTED_CALLS", message: `Unsupported calls will fail closed: ${unsupportedCalls.slice(0, 12).join(", ")}${unsupportedCalls.length > 12 ? ", …" : ""}.` });
  return { status: errors.length ? "failed" : "passed", errors, warnings, supportedForBrowserExecution: errors.length === 0 };
}

function matchingBrace(source: string, openIndex: number) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function functionBody(source: string, name: string) {
  const match = new RegExp(`\\b${name}\\s*\\([^)]*\\)\\s*\\{`, "m").exec(source);
  if (!match || match.index === undefined) return "";
  const open = source.indexOf("{", match.index);
  const close = matchingBrace(source, open);
  return close < 0 ? "" : source.slice(open + 1, close);
}

function splitStatements(body: string) {
  const statements: string[] = [];
  let start = 0;
  let parens = 0;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "(") parens += 1;
    if (char === ")") parens = Math.max(0, parens - 1);
    if (char === ";" && parens === 0) {
      const statement = body.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const rest = body.slice(start).trim();
  if (rest) statements.push(rest);
  return statements;
}

function constantsFrom(source: string) {
  const values = new Map<string, number | boolean>();
  for (const match of source.matchAll(/^\s*#define\s+([A-Za-z_]\w*)\s+([^\s/]+).*$/gm)) {
    const raw = match[2];
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) values.set(match[1], Number(raw));
    else if (/^(?:true|HIGH)$/i.test(raw)) values.set(match[1], true);
    else if (/^(?:false|LOW)$/i.test(raw)) values.set(match[1], false);
  }
  for (const match of source.matchAll(/\b(?:const\s+|constexpr\s+)?(?:bool|byte|short|int|long|float|double|uint8_t|uint16_t)\s+([A-Za-z_]\w*)\s*=\s*([^;]+);/g)) {
    const raw = match[2].trim();
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) values.set(match[1], Number(raw));
    else if (/^(?:true|HIGH)$/i.test(raw)) values.set(match[1], true);
    else if (/^(?:false|LOW)$/i.test(raw)) values.set(match[1], false);
  }
  return values;
}

function scalar(expression: string, constants: Map<string, number | boolean>, variables: Map<string, number | boolean>) {
  const value = expression.trim().replace(/^\(+|\)+$/g, "");
  if (/^(?:true|HIGH)$/i.test(value)) return true;
  if (/^(?:false|LOW)$/i.test(value)) return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (variables.has(value)) return variables.get(value)!;
  if (constants.has(value)) return constants.get(value)!;
  return undefined;
}

function argumentList(raw: string) {
  const result: string[] = [];
  let start = 0;
  let parens = 0;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "(") parens += 1;
    if (char === ")") parens -= 1;
    if (char === "," && parens === 0) {
      result.push(raw.slice(start, index).trim());
      start = index + 1;
    }
  }
  result.push(raw.slice(start).trim());
  return result;
}

type ExecutionContext = {
  componentId: string;
  source: string;
  durationMs: number;
  cursorMs: number;
  statements: number;
  loopIterations: number;
  constants: Map<string, number | boolean>;
  variables: Map<string, number | boolean>;
  outputs: Record<string, boolean | number>;
  events: Array<{ timeMs: number; endpoint: string; value: boolean | number; reason: string }>;
  serial: string[];
  unsupported: Set<string>;
};

function endpointFor(ctx: ExecutionContext, expression: string) {
  const project = useProjectStore.getState().project;
  const endpoint = resolveBoardPin(project, ctx.componentId, expression, ctx.constants);
  return endpoint ? `${endpoint.componentId}:${endpoint.portId}` : `${ctx.componentId}:${expression.trim()}`;
}

function runStatement(statement: string, ctx: ExecutionContext) {
  if (ctx.statements >= MAX_EXECUTED_STATEMENTS) {
    ctx.unsupported.add("execution-limit");
    return;
  }
  ctx.statements += 1;
  const text = statement.trim();
  if (!text || /^(?:pinMode|Serial\.begin)\s*\(/.test(text)) return;

  const delay = /^delay\s*\(([^)]*)\)$/i.exec(text);
  if (delay) {
    const amount = scalar(delay[1], ctx.constants, ctx.variables);
    if (typeof amount === "number" && Number.isFinite(amount)) ctx.cursorMs += Math.max(0, amount);
    else ctx.unsupported.add("delay-expression");
    return;
  }

  const write = /^(digitalWrite|analogWrite)\s*\((.*)\)$/i.exec(text);
  if (write) {
    const args = argumentList(write[2]);
    if (args.length !== 2) { ctx.unsupported.add(write[1]); return; }
    const rawValue = scalar(args[1], ctx.constants, ctx.variables);
    if (rawValue === undefined) { ctx.unsupported.add(`${write[1]}-expression`); return; }
    const value = write[1].toLowerCase() === "digitalwrite" ? Boolean(rawValue) : Number(rawValue);
    const endpoint = endpointFor(ctx, args[0]);
    ctx.outputs[endpoint] = value;
    ctx.events.push({ timeMs: Math.min(ctx.cursorMs, ctx.durationMs), endpoint, value, reason: write[1] });
    return;
  }

  const tone = /^tone\s*\((.*)\)$/i.exec(text);
  if (tone) {
    const args = argumentList(tone[1]);
    const duration = args[2] ? scalar(args[2], ctx.constants, ctx.variables) : 0;
    const endpoint = args[0] ? endpointFor(ctx, args[0]) : `${ctx.componentId}:unknown`;
    ctx.outputs[endpoint] = true;
    ctx.events.push({ timeMs: Math.min(ctx.cursorMs, ctx.durationMs), endpoint, value: true, reason: "tone" });
    if (typeof duration === "number" && duration > 0) {
      ctx.cursorMs += duration;
      ctx.outputs[endpoint] = false;
      ctx.events.push({ timeMs: Math.min(ctx.cursorMs, ctx.durationMs), endpoint, value: false, reason: "tone-complete" });
    }
    return;
  }

  const noTone = /^noTone\s*\((.*)\)$/i.exec(text);
  if (noTone) {
    const endpoint = endpointFor(ctx, noTone[1]);
    ctx.outputs[endpoint] = false;
    ctx.events.push({ timeMs: Math.min(ctx.cursorMs, ctx.durationMs), endpoint, value: false, reason: "noTone" });
    return;
  }

  const serial = /^Serial\.(print|println|write)\s*\((.*)\)$/i.exec(text);
  if (serial) {
    const raw = serial[2].trim();
    let rendered = "";
    if (/^"[\s\S]*"$/.test(raw)) rendered = raw.slice(1, -1);
    else {
      const value = scalar(raw, ctx.constants, ctx.variables);
      if (value === undefined) { ctx.unsupported.add(`Serial.${serial[1]}-expression`); return; }
      rendered = String(value);
    }
    if (serial[1].toLowerCase() === "println") rendered += "\n";
    ctx.serial.push(rendered);
    return;
  }

  const assignment = /^(?:(?:const\s+)?(?:bool|byte|short|int|long|float|double|uint8_t|uint16_t)\s+)?([A-Za-z_]\w*)\s*=\s*(.+)$/i.exec(text);
  if (assignment) {
    const value = scalar(assignment[2], ctx.constants, ctx.variables);
    if (value === undefined) ctx.unsupported.add("assignment-expression");
    else ctx.variables.set(assignment[1], value);
    return;
  }

  if (/^(?:if|for|while|switch|do)\b/.test(text)) {
    ctx.unsupported.add("C++:control-flow");
    return;
  }

  const called = /^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)\s*\(/.exec(text)?.[1];
  if (called && !SUPPORTED_CALLS.has(called)) ctx.unsupported.add(called);
  else if (text) ctx.unsupported.add("C++:statement");
}

function executeBrowserSubset(componentId: string, files: readonly CodeFileRecord[], durationMs: number) {
  const source = stripComments(sourceText(files));
  const ctx: ExecutionContext = {
    componentId,
    source,
    durationMs,
    cursorMs: 0,
    statements: 0,
    loopIterations: 0,
    constants: constantsFrom(source),
    variables: new Map(),
    outputs: {},
    events: [],
    serial: [],
    unsupported: new Set(),
  };
  const setup = functionBody(source, "setup");
  const loop = functionBody(source, "loop");
  for (const statement of splitStatements(setup)) runStatement(statement, ctx);
  const loopStatements = splitStatements(loop);
  if (loopStatements.length) {
    const maxIterations = Math.min(1_000, Math.max(1, durationMs || 1));
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const before = ctx.cursorMs;
      for (const statement of loopStatements) runStatement(statement, ctx);
      ctx.loopIterations += 1;
      if (ctx.statements >= MAX_EXECUTED_STATEMENTS || ctx.cursorMs >= durationMs) break;
      if (ctx.cursorMs === before) break;
    }
  }
  return ctx;
}

export async function checkFirmware(request: FirmwareCheckRequest): Promise<FirmwareCommandResult<FirmwareCheckResult>> {
  if (!boundedIdentifier(request?.componentId)) return fail("INVALID_FIRMWARE_CHECK", "componentId must be a bounded non-empty board instance id of at most 200 characters.");
  const durationMs = request.durationMs ?? 1_000;
  if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > MAX_FIRMWARE_CHECK_DURATION_MS) return fail("INVALID_FIRMWARE_CHECK", `durationMs must be an integer from 0 to ${MAX_FIRMWARE_CHECK_DURATION_MS}.`);
  const inputs = request.inputs ?? {};
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) return fail("INVALID_FIRMWARE_CHECK", "inputs must be an object keyed by componentId:portId.");
  const inputEntries = Object.entries(inputs);
  if (inputEntries.length > MAX_FIRMWARE_CHECK_INPUTS || inputEntries.some(([key, value]) => !key || key.length > 240 || (typeof value !== "boolean" && (typeof value !== "number" || !Number.isFinite(value))))) {
    return fail("INVALID_FIRMWARE_CHECK", `inputs may contain at most ${MAX_FIRMWARE_CHECK_INPUTS} bounded endpoint keys with finite number or boolean values.`);
  }

  const componentId = request.componentId.trim();
  const state = useProjectStore.getState();
  const project = state.project;
  const document = state.getCodeDocument(componentId);
  if (!document) return fail("CODE_DOCUMENT_NOT_FOUND", "No editable code document exists for that target.", false, { targetComponentId: componentId });
  const binding = resolveFirmwareBinding(project, componentId);
  if (!binding.component || binding.definition?.category !== "board") return fail("CODE_TARGET_NOT_BOARD", `${componentId} is not a programmable board target.`, false, { componentId });
  if (binding.target && (!binding.definitionMatchesTarget || !binding.fqbnMatchesDefinition)) {
    return fail(
      "FIRMWARE_TARGET_BINDING_INVALID",
      `Firmware compatibility metadata for ${componentId} does not match the current ${binding.definition.title} board target.`,
      false,
      {
        componentId,
        definitionId: binding.component.definitionId,
        targetDefinitionId: binding.target.definitionId ?? null,
        expectedBoardFqbn: binding.targetConfig?.fqbn ?? null,
        targetBoardFqbn: binding.target.boardFqbn ?? null,
      },
    );
  }

  const preflight = preflightSource(document.files, document.language);
  if (preflight.errors.length) return fail("FIRMWARE_PREFLIGHT_FAILED", "Browser Check found source errors and did not execute the code.", false, { componentId, preflight });
  const staticGraph = validateProject(project);
  const compilation = { status: "not-performed" as const, reason: "Browser Check is a bounded interpreter/preflight, not a compiler. Use the board SDK/toolchain for a real compile." };
  const notice = "Browser Check executes only a documented Arduino/C++ subset and fails closed on unsupported constructs. It does not compile, electrically simulate, upload, or verify physical hardware.";

  if (!preflight.supportedForBrowserExecution) {
    return {
      ok: true,
      data: {
        componentId,
        status: "browser-unavailable",
        sourceSha256: document.contentSha256,
        preflight,
        runtime: {
          status: "unavailable", runtime: "browser", durationMs, outputs: { ...inputs }, events: [], programs: [], serialOutput: "", warnings: preflight.warnings, unsupportedApis: [],
          note: `Browser execution is unavailable for ${document.language} source; source remains editable and exportable.`,
          connectionCheck: { status: "completed", connectionsChecked: project.connections.length, note: "Static graph topology was checked independently of source execution." },
          codeExecution: { status: "unavailable", reason: "Unsupported Browser Check language.", physicalHardwareNextStep: "Compile and test with the target board toolchain and hardware." },
        },
        staticGraph,
        compilation,
        claims: { sourceCodeExecutedInBrowser: false, sourceCodeCompiled: false, electricalBehaviorSimulated: false, uploadedToHardware: false, physicalHardwareVerified: false },
        notice,
      },
    };
  }

  const execution = executeBrowserSubset(componentId, document.files, durationMs);
  const unsupported = [...execution.unsupported].sort();
  const partial = unsupported.length > 0 || preflight.warnings.some((warning) => warning.code === "BOUNDED_CONTROL_FLOW" || warning.code === "UNSUPPORTED_CALLS");
  const graphWarnings = staticGraph.issues.filter((issue) => issue.severity === "warning").length;
  const status: FirmwareCheckStatus = partial ? "browser-partial" : graphWarnings || preflight.warnings.length ? "browser-executed-with-warnings" : "browser-executed";
  const runtimeWarnings = [...preflight.warnings];
  if (unsupported.length) runtimeWarnings.push({ code: "UNSUPPORTED_RUNTIME_CALLS", message: `Browser Check skipped unsupported calls/statements: ${unsupported.join(", ")}.` });

  return {
    ok: true,
    data: {
      componentId,
      status,
      sourceSha256: document.contentSha256,
      preflight,
      runtime: {
        status: partial ? "partial" : runtimeWarnings.length ? "completed-with-warnings" : "completed",
        runtime: "browser",
        executionEngine: "bounded-arduino-subset",
        durationMs,
        outputs: { ...inputs, ...execution.outputs },
        events: execution.events,
        programs: [{ componentId, statements: execution.statements, loopIterations: execution.loopIterations, sourceFiles: document.files.map((file) => file.name) }],
        serialOutput: execution.serial.join(""),
        warnings: runtimeWarnings,
        unsupportedApis: unsupported,
        note: partial ? "Supported statements executed; unsupported constructs were skipped and explicitly reported. No unsupported operation was treated as successful." : "Supported Arduino/C++ statements executed deterministically in the browser.",
        connectionCheck: { status: "completed", connectionsChecked: project.connections.length, note: "Static graph topology was checked independently of Browser Check source execution." },
        codeExecution: { status: partial ? "partial" : "executed", ...(partial ? { reason: "Unsupported constructs were skipped." } : {}), physicalHardwareNextStep: "Compile, upload, and test the source with the actual board and wiring." },
      },
      staticGraph,
      compilation,
      claims: { sourceCodeExecutedInBrowser: true, sourceCodeCompiled: false, electricalBehaviorSimulated: false, uploadedToHardware: false, physicalHardwareVerified: false },
      notice,
    },
  };
}
