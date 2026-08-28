import type {
  BrowserCompilerTarget,
  CompileFailure,
  CompileStatus,
  CompilerDiagnostic,
  CompilerErrorInfo,
} from "./types";

export function diagnostic(
  severity: CompilerDiagnostic["severity"],
  message: string,
  details: Omit<CompilerDiagnostic, "severity" | "message"> = {},
): CompilerDiagnostic {
  return { severity, message, ...details };
}

export function failureResult(
  status: Exclude<CompileStatus, "compiled">,
  target: BrowserCompilerTarget,
  message: string,
  code: CompilerErrorInfo["code"],
  details: Omit<CompilerDiagnostic, "severity" | "message"> = {},
): CompileFailure {
  return {
    status,
    target,
    artifact: null,
    diagnostics: [diagnostic("error", message, details)],
    error: { code, message },
  };
}

export function isCompileFailure(result: { status: string }): result is CompileFailure {
  return result.status !== "compiled";
}
