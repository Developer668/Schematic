export type CompilerFamily = "avr";

export type CompilerLanguage = "arduino" | "c";

export type ArtifactFormat = "intel-hex";

export type CompileStatus =
  | "compiled"
  | "failed"
  | "unsupported"
  | "blocked"
  | "cancelled"
  | "timed-out";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface BrowserCompilerTarget {
  fqbn: string;
  language: CompilerLanguage;
  boardId?: string;
}

export interface CompilerSupport {
  status: "supported" | "unsupported" | "blocked";
  reason?: string;
  compilerId?: string;
}

export interface SourceFile {
  name: string;
  content: string;
}

export interface CompileRequest {
  target: BrowserCompilerTarget;
  files: readonly SourceFile[];
  entrypoint?: string;
  /** Absolute or origin-relative static asset base. */
  assetsBase?: string;
}

export interface CompileProgress {
  phase: "loading" | "preparing" | "compiling" | "linking" | "emitting" | "done";
  completed?: number;
  total?: number;
  message?: string;
}

export interface CompileOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (progress: CompileProgress) => void;
}

export interface CompilerDiagnostic {
  severity: DiagnosticSeverity;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
}

export interface CompilerErrorInfo {
  code:
    | "compiler-error"
    | "invalid-manifest"
    | "invalid-artifact"
    | "corrupt-cache"
    | "worker-error"
    | "timeout"
    | "cancelled"
    | "unsupported-target"
    | "blocked-toolchain";
  message: string;
}

export interface ArtifactProvenance {
  compiler: string;
  compilerVersion?: string;
  targetFqbn: string;
  sourceSha256: string;
}

export interface IntelHexArtifact {
  format: "intel-hex";
  fileName: string;
  /** Exact text returned by the compiler. */
  text: string;
  /** UTF-8 bytes of the exact text, used for integrity and downloads. */
  bytes: Uint8Array;
  sha256: string;
  /** Number of populated flash bytes, excluding HEX metadata records. */
  flashBytes: number;
  provenance: ArtifactProvenance;
}

export interface CompileSuccess {
  status: "compiled";
  target: BrowserCompilerTarget;
  artifact: IntelHexArtifact;
  diagnostics: readonly CompilerDiagnostic[];
  metadata?: {
    fitsTarget?: boolean;
    timings?: Readonly<Record<string, number>>;
  };
}

export interface CompileFailure {
  status: Exclude<CompileStatus, "compiled">;
  target: BrowserCompilerTarget;
  artifact: null;
  diagnostics: readonly CompilerDiagnostic[];
  error?: CompilerErrorInfo;
}

export type CompileResult = CompileSuccess | CompileFailure;

export interface BrowserCompiler {
  readonly id: string;
  readonly family: CompilerFamily;
  supports(target: BrowserCompilerTarget): CompilerSupport;
  compile(request: CompileRequest, options?: CompileOptions): Promise<CompileResult>;
}
