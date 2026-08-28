import type { StorageError, StorageOperation, StorageResult } from "./types";

function errorName(error: unknown): string | undefined {
  return error && typeof error === "object" && "name" in error && typeof error.name === "string"
    ? error.name
    : undefined;
}

function errorMessage(error: unknown): string | undefined {
  return error && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message
    : error instanceof Error
      ? error.message
      : undefined;
}

export function storageError(
  code: StorageError["code"],
  operation: StorageOperation,
  message: string,
  options: Pick<StorageError, "retryable" | "causeName" | "details"> = { retryable: false },
): StorageError {
  return {
    code,
    operation,
    message,
    retryable: options.retryable,
    ...(options.causeName ? { causeName: options.causeName } : {}),
    ...(options.details ? { details: options.details } : {}),
  };
}

export function failure<T>(error: StorageError): StorageResult<T> {
  return { ok: false, error };
}

export function success<T>(value: T): StorageResult<T> {
  return { ok: true, value };
}

export function mapStorageException(error: unknown, operation: StorageOperation): StorageError {
  const name = errorName(error);
  const message = errorMessage(error);
  const normalizedMessage = message?.trim() || "The browser storage operation failed";
  const quota = name === "QuotaExceededError" || /quota|storage.?full/i.test(normalizedMessage);
  const blocked = name === "BlockedError";
  const aborted = name === "AbortError";
  const unavailable = name === "SecurityError" || name === "InvalidStateError";

  if (quota) {
    return storageError("quota-exceeded", operation, "The browser storage quota was exceeded.", {
      retryable: false,
      causeName: name,
    });
  }
  if (blocked) {
    return storageError("blocked", operation, "The browser storage database is blocked by another tab.", {
      retryable: true,
      causeName: name,
    });
  }
  if (aborted) {
    return storageError("aborted", operation, "The browser storage transaction was aborted.", {
      retryable: true,
      causeName: name,
    });
  }
  if (unavailable) {
    return storageError("unavailable", operation, "IndexedDB is unavailable in this browser context.", {
      retryable: false,
      causeName: name,
    });
  }

  return storageError("unknown", operation, normalizedMessage, {
    retryable: true,
    ...(name ? { causeName: name } : {}),
  });
}

export function invalidInput(operation: StorageOperation, message: string): StorageError {
  return storageError("invalid-input", operation, message, { retryable: false });
}

export function notFound(operation: StorageOperation, message: string): StorageError {
  return storageError("not-found", operation, message, { retryable: false });
}

export function corruptRecord(operation: StorageOperation, message: string): StorageError {
  return storageError("corrupt-record", operation, message, { retryable: false });
}
