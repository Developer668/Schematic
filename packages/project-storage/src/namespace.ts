import type { NormalizedStorageNamespace, StorageNamespace } from "./types";

const MAX_NAMESPACE_PART_LENGTH = 256;

function normalizePart(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} must not be empty`);
  if (normalized.length > MAX_NAMESPACE_PART_LENGTH) {
    throw new TypeError(`${label} is too long`);
  }
  if ([...normalized].some((character) => character.charCodeAt(0) < 0x20)) {
    throw new TypeError(`${label} contains a control character`);
  }
  return normalized;
}

export function normalizeNamespace(namespace: StorageNamespace): NormalizedStorageNamespace {
  if (!namespace || typeof namespace !== "object") {
    throw new TypeError("A storage namespace is required");
  }

  const roomId = normalizePart(namespace.roomId, "roomId");
  const userId = namespace.userId == null ? null : normalizePart(namespace.userId, "userId");
  const encodedUser = encodeURIComponent(userId ?? "anonymous");
  const encodedRoom = encodeURIComponent(roomId);

  return {
    roomId,
    userId,
    key: `v${1}:user:${encodedUser}:room:${encodedRoom}`,
  };
}

export function namespaceKey(namespace: StorageNamespace): string {
  return normalizeNamespace(namespace).key;
}
