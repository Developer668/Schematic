import { createIntelHexArtifact } from "./intelHex";
import { sha256Hex } from "./hash";
import { diagnostic, failureResult } from "./results";
import type {
  BrowserCompiler,
  BrowserCompilerTarget,
  CompileOptions,
  CompileRequest,
  CompileResult,
  CompilerDiagnostic,
} from "./types";

export const AVR_UNO_FQBN = "arduino:avr:uno";
export const AVR_NANO_FQBN = "arduino:avr:nano";
export const AVR_UNO_FLASH_BYTES = 32 * 1024;
export const AVR_UNO_APPLICATION_FLASH_BYTES = 32_256;

export interface AvrGccWasmCompileOutput {
  /** Must be actual Intel HEX emitted by the real compiler pipeline. */
  hex: string;
  flashBytes?: number;
  fitsTarget?: boolean;
  timings?: Readonly<Record<string, number>>;
  diagnostics?: readonly CompilerDiagnostic[];
}

/**
 * Narrow seam for @horang-corp/avr-gcc-wasm or a reviewed replacement. Keeping
 * the external package out of this package means the core stays testable and
 * cannot accidentally ship an unreviewed 55 MB toolchain.
 */
export interface AvrGccWasmBridge {
  readonly name?: string;
  readonly version?: string;
  compile(options: {
    source: string;
    assetsBase?: string;
    signal?: AbortSignal;
  }): Promise<AvrGccWasmCompileOutput>;
}

export interface AvrGccWasmCompilerOptions {
  bridge: AvrGccWasmBridge;
  id?: string;
  /** Explicitly approved target profiles; default is Uno only. */
  targetProfiles?: readonly { fqbn: string; flashBytes: number }[];
}

function sourceFileFor(request: CompileRequest): { name: string; content: string } | null {
  if (request.entrypoint) {
    const file = request.files.find((candidate) => candidate.name === request.entrypoint);
    return file && /\.(ino|cpp|c)$/i.test(file.name) ? file : null;
  }
  const sourceFiles = request.files.filter((file) => /\.(ino|cpp|c)$/i.test(file.name));
  return sourceFiles.length === 1 ? sourceFiles[0] : null;
}

export function createAvrGccWasmCompiler(options: AvrGccWasmCompilerOptions): BrowserCompiler {
  const id = options.id ?? "avr-gcc-wasm";
  const targetProfiles = options.targetProfiles ?? [{ fqbn: AVR_UNO_FQBN, flashBytes: AVR_UNO_FLASH_BYTES }];

  const compiler: BrowserCompiler = {
    id,
    family: "avr",
    supports(target: BrowserCompilerTarget) {
      const profile = targetProfiles.find((candidate) => candidate.fqbn === target.fqbn);
      if (target.language !== "arduino") {
        return { status: "unsupported", reason: "The browser AVR bridge accepts Arduino firmware only", compilerId: id };
      }
      if (!profile) {
        return { status: "unsupported", reason: `The reviewed AVR bridge has no profile for ${target.fqbn}`, compilerId: id };
      }
      return { status: "supported", compilerId: id };
    },
    async compile(request: CompileRequest, compileOptions: CompileOptions = {}): Promise<CompileResult> {
      const support = compiler.supports(request.target);
      if (support.status !== "supported") {
        const status = support.status === "blocked" ? "blocked" : "unsupported";
        return failureResult(
          status,
          request.target,
          support.reason ?? "Unsupported AVR target",
          status === "blocked" ? "blocked-toolchain" : "unsupported-target",
        );
      }
      if (compileOptions.signal?.aborted) {
        return failureResult("cancelled", request.target, "Compilation was cancelled", "cancelled");
      }

      const sourceFile = sourceFileFor(request);
      if (!sourceFile) {
        return failureResult(
          "unsupported",
          request.target,
          "The first browser compiler path requires exactly one .ino, .cpp, or .c entrypoint",
          "unsupported-target",
        );
      }

      const profile = targetProfiles.find((candidate) => candidate.fqbn === request.target.fqbn)!;
      const sourceSha256 = await sha256Hex(sourceFile.content);
      compileOptions.onProgress?.({ phase: "preparing", message: `Preparing ${sourceFile.name}` });
      try {
        const output = await options.bridge.compile({
          source: sourceFile.content,
          assetsBase: request.assetsBase,
          signal: compileOptions.signal,
        });
        if (compileOptions.signal?.aborted) {
          return failureResult("cancelled", request.target, "Compilation was cancelled", "cancelled");
        }
        const diagnostics = output.diagnostics ?? [];
        if (output.fitsTarget === false || (output.flashBytes !== undefined && output.flashBytes > AVR_UNO_APPLICATION_FLASH_BYTES)) {
          return {
            status: "failed",
            target: request.target,
            artifact: null,
            diagnostics: [
              ...diagnostics,
              diagnostic("error", `Firmware exceeds the ${AVR_UNO_APPLICATION_FLASH_BYTES}-byte Uno application flash budget`, {
                code: "flash-overflow",
              }),
            ],
            error: { code: "compiler-error", message: "Firmware does not fit the target flash budget" },
          };
        }

        const artifact = await createIntelHexArtifact(output.hex, {
          targetFqbn: request.target.fqbn,
          targetFlashBytes: profile.flashBytes,
          fileName: "firmware.hex",
          provenance: {
            compiler: options.bridge.name ?? "avr-gcc-wasm-bridge",
            compilerVersion: options.bridge.version,
            targetFqbn: request.target.fqbn,
            sourceSha256,
          },
        });
        compileOptions.onProgress?.({ phase: "done", completed: 1, total: 1, message: "Intel HEX verified" });
        return {
          status: "compiled",
          target: request.target,
          artifact,
          diagnostics,
          metadata: { fitsTarget: output.fitsTarget, timings: output.timings },
        };
      } catch (error) {
        if (compileOptions.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
          return failureResult("cancelled", request.target, "Compilation was cancelled", "cancelled");
        }
        const message = error instanceof Error ? error.message : String(error);
        return failureResult("failed", request.target, message || "Browser AVR compiler failed", "invalid-artifact");
      }
    },
  };

  return compiler;
}
