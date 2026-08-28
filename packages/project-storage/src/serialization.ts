import { failure, invalidInput, storageError, success } from "./errors";
import type { StorageOperation, StorageResult } from "./types";

export function byteLength(text: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).byteLength;
  return unescape(encodeURIComponent(text)).length;
}

export function cloneJson<T>(
  value: T,
  operation: StorageOperation,
  maxBytes?: number,
): StorageResult<T> {
  try {
    const text = JSON.stringify(value);
    if (typeof text !== "string") {
      return failure(storageError("serialization", operation, "The value is not JSON serializable."));
    }
    const bytes = byteLength(text);
    if (maxBytes != null && bytes > maxBytes) {
      return failure(storageError(
        "quota-exceeded",
        operation,
        `The value is ${bytes} bytes, above the ${maxBytes}-byte safety limit.`,
        { retryable: false, details: { bytes, maxBytes } },
      ));
    }
    return success(JSON.parse(text) as T);
  } catch (error) {
    return failure(storageError(
      "serialization",
      operation,
      error instanceof Error ? error.message : "The value is not JSON serializable.",
      { retryable: false, causeName: error instanceof Error ? error.name : undefined },
    ));
  }
}

export function parseJson<T>(text: string, operation: StorageOperation): StorageResult<T> {
  try {
    return success(JSON.parse(text) as T);
  } catch (error) {
    return failure(invalidInput(
      operation,
      error instanceof Error ? `Invalid JSON: ${error.message}` : "The value is not valid JSON.",
    ));
  }
}
