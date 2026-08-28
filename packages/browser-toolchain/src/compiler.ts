import { failureResult } from "./results";
import type {
  BrowserCompiler,
  BrowserCompilerTarget,
  CompileOptions,
  CompileRequest,
  CompileResult,
  CompilerSupport,
} from "./types";

export interface CompilerManagerOptions {
  defaultTimeoutMs?: number;
}

function supportFailure(
  support: CompilerSupport,
  target: BrowserCompilerTarget,
): CompileResult {
  const status = support.status === "blocked" ? "blocked" : "unsupported";
  return failureResult(
    status,
    target,
    support.reason ?? `No browser compiler supports ${target.fqbn}`,
    status === "blocked" ? "blocked-toolchain" : "unsupported-target",
  );
}

export class CompilerManager {
  private readonly compilers = new Map<string, BrowserCompiler>();
  private readonly defaultTimeoutMs?: number;

  constructor(compilers: readonly BrowserCompiler[] = [], options: CompilerManagerOptions = {}) {
    this.defaultTimeoutMs = options.defaultTimeoutMs;
    for (const compiler of compilers) this.register(compiler);
  }

  register(compiler: BrowserCompiler): void {
    if (this.compilers.has(compiler.id)) throw new Error(`compiler already registered: ${compiler.id}`);
    this.compilers.set(compiler.id, compiler);
  }

  unregister(id: string): void {
    this.compilers.delete(id);
  }

  list(): readonly BrowserCompiler[] {
    return Array.from(this.compilers.values());
  }

  supports(target: BrowserCompilerTarget): CompilerSupport {
    const supports = this.list().map((compiler) => compiler.supports(target));
    const supported = supports.find((support) => support.status === "supported");
    if (supported) return supported;
    const blocked = supports.find((support) => support.status === "blocked");
    return blocked ?? { status: "unsupported", reason: `No compiler registered for ${target.fqbn}` };
  }

  async compile(request: CompileRequest, options: CompileOptions = {}): Promise<CompileResult> {
    if (options.signal?.aborted) {
      return failureResult("cancelled", request.target, "Compilation was cancelled before it started", "cancelled");
    }

    const candidates = this.list();
    const supported = candidates.find((compiler) => compiler.supports(request.target).status === "supported");
    if (!supported) return supportFailure(this.supports(request.target), request.target);

    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    if (!timeoutMs || timeoutMs <= 0) return this.invoke(supported, request, options);
    return this.invokeWithTimeout(supported, request, options, timeoutMs);
  }

  private async invoke(
    compiler: BrowserCompiler,
    request: CompileRequest,
    options: CompileOptions,
  ): Promise<CompileResult> {
    try {
      return await compiler.compile(request, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return failureResult("failed", request.target, message || "Compiler failed", "compiler-error");
    }
  }

  private invokeWithTimeout(
    compiler: BrowserCompiler,
    request: CompileRequest,
    options: CompileOptions,
    timeoutMs: number,
  ): Promise<CompileResult> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });

    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        controller.abort();
        options.signal?.removeEventListener("abort", onAbort);
        resolve(failureResult("timed-out", request.target, `Compilation exceeded the ${timeoutMs} ms timeout`, "timeout"));
      }, timeoutMs);

      void compiler
        .compile(request, { ...options, signal: controller.signal })
        .then((result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", onAbort);
          resolve(result);
        })
        .catch((error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", onAbort);
          const message = error instanceof Error ? error.message : String(error);
          resolve(failureResult("failed", request.target, message || "Compiler failed", "compiler-error"));
        });

      options.signal?.addEventListener(
        "abort",
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", onAbort);
          controller.abort();
          resolve(failureResult("cancelled", request.target, "Compilation was cancelled", "cancelled"));
        },
        { once: true },
      );
    });
  }
}

export function createBlockedCompiler(
  id: string,
  reason = "No reviewed browser compiler bridge has been provisioned",
): BrowserCompiler {
  return {
    id,
    family: "avr",
    supports: () => ({ status: "blocked", reason, compilerId: id }),
    compile: async (request) => failureResult("blocked", request.target, reason, "blocked-toolchain"),
  };
}
