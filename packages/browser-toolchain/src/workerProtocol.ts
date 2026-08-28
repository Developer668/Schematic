import { failureResult } from "./results";
import type {
  BrowserCompiler,
  BrowserCompilerTarget,
  CompileRequest,
  CompileResult,
  CompileProgress,
  CompilerFamily,
  CompilerSupport,
} from "./types";

export const WORKER_PROTOCOL_VERSION = 1 as const;

export interface WorkerCompileMessage {
  type: "compile";
  protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  requestId: string;
  request: CompileRequest;
}

export interface WorkerCancelMessage {
  type: "cancel";
  protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  requestId: string;
}

export type WorkerRequest = WorkerCompileMessage | WorkerCancelMessage;

export interface WorkerProgressMessage {
  type: "progress";
  protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  requestId: string;
  progress: CompileProgress;
}

export interface WorkerResultMessage {
  type: "result";
  protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  requestId: string;
  result: CompileResult;
}

export interface WorkerErrorMessage {
  type: "error";
  protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  requestId: string;
  message: string;
}

export type WorkerResponse = WorkerProgressMessage | WorkerResultMessage | WorkerErrorMessage;

export interface CompilerWorkerLike {
  postMessage(message: WorkerRequest): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "error" | "messageerror", listener: (event: { message?: string }) => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "error" | "messageerror", listener: (event: { message?: string }) => void): void;
  terminate?(): void;
}

export interface WorkerCompilerOptions {
  id: string;
  family?: CompilerFamily;
  createWorker: () => CompilerWorkerLike;
  supports(target: BrowserCompilerTarget): CompilerSupport;
}

let nextRequestId = 1;

function isResponse(value: unknown): value is WorkerResponse {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return message.protocolVersion === WORKER_PROTOCOL_VERSION && ["progress", "result", "error"].includes(String(message.type));
}

function errorMessage(event: { message?: string }): string {
  return event.message || "Compiler worker failed";
}

export function createWorkerCompiler(options: WorkerCompilerOptions): BrowserCompiler {
  return {
    id: options.id,
    family: options.family ?? "avr",
    supports: options.supports,
    compile: (request, compileOptions = {}) => {
      const support = options.supports(request.target);
      if (support.status !== "supported") {
        const status = support.status === "blocked" ? "blocked" : "unsupported";
        return Promise.resolve(
          failureResult(
            status,
            request.target,
            support.reason ?? `Worker compiler does not support ${request.target.fqbn}`,
            status === "blocked" ? "blocked-toolchain" : "unsupported-target",
          ),
        );
      }
      if (compileOptions.signal?.aborted) {
        return Promise.resolve(failureResult("cancelled", request.target, "Compilation was cancelled", "cancelled"));
      }

      let worker: CompilerWorkerLike;
      try {
        worker = options.createWorker();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Promise.resolve(failureResult("failed", request.target, message, "worker-error"));
      }

      const requestId = `${options.id}-${nextRequestId++}`;
      return new Promise<CompileResult>((resolve) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const cleanup = () => {
          if (timer) clearTimeout(timer);
          worker.removeEventListener("message", onMessage);
          worker.removeEventListener("error", onWorkerError);
          worker.removeEventListener("messageerror", onWorkerError);
          compileOptions.signal?.removeEventListener("abort", onAbort);
        };

        const finish = (result: CompileResult) => {
          if (settled) return;
          settled = true;
          cleanup();
          worker.terminate?.();
          resolve(result);
        };

        const cancel = (status: "cancelled" | "timed-out", message: string) => {
          try {
            worker.postMessage({ type: "cancel", protocolVersion: WORKER_PROTOCOL_VERSION, requestId });
          } finally {
            finish(failureResult(status, request.target, message, status === "cancelled" ? "cancelled" : "timeout"));
          }
        };

        const onAbort = () => cancel("cancelled", "Compilation was cancelled");
        const onWorkerError = (event: { message?: string }) => finish(failureResult("failed", request.target, errorMessage(event), "worker-error"));
        const onMessage = (event: { data: unknown }) => {
          const message = event.data;
          if (!isResponse(message)) {
            finish(failureResult("failed", request.target, "Compiler worker returned an invalid message", "worker-error"));
            return;
          }
          if (message.requestId !== requestId) return;
          if (message.type === "progress") {
            compileOptions.onProgress?.(message.progress);
          } else if (message.type === "result") {
            finish(message.result);
          } else {
            finish(failureResult("failed", request.target, message.message, "worker-error"));
          }
        };

        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onWorkerError);
        worker.addEventListener("messageerror", onWorkerError);
        compileOptions.signal?.addEventListener("abort", onAbort, { once: true });
        if (compileOptions.timeoutMs && compileOptions.timeoutMs > 0) {
          timer = setTimeout(() => cancel("timed-out", `Compilation exceeded the ${compileOptions.timeoutMs} ms timeout`), compileOptions.timeoutMs);
        }
        worker.postMessage({ type: "compile", protocolVersion: WORKER_PROTOCOL_VERSION, requestId, request });
      });
    },
  };
}

export interface WorkerMessageSink {
  postMessage(message: WorkerResponse): void;
}

/** Creates the worker-side request handler for a real compiler implementation. */
export function createCompilerWorkerHandler(compiler: BrowserCompiler) {
  const running = new Map<string, AbortController>();

  return async (message: WorkerRequest, sink: WorkerMessageSink): Promise<void> => {
    if (message.protocolVersion !== WORKER_PROTOCOL_VERSION) return;
    if (message.type === "cancel") {
      running.get(message.requestId)?.abort();
      return;
    }

    const controller = new AbortController();
    running.set(message.requestId, controller);
    try {
      const result = await compiler.compile(message.request, {
        signal: controller.signal,
        onProgress: (progress) => sink.postMessage({ type: "progress", protocolVersion: WORKER_PROTOCOL_VERSION, requestId: message.requestId, progress }),
      });
      sink.postMessage({ type: "result", protocolVersion: WORKER_PROTOCOL_VERSION, requestId: message.requestId, result });
    } catch (error) {
      sink.postMessage({
        type: "error",
        protocolVersion: WORKER_PROTOCOL_VERSION,
        requestId: message.requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      running.delete(message.requestId);
    }
  };
}
