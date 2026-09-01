/**
 * Small, dependency-free readiness gate shared by the project store,
 * persistence owner, and WebMCP boundary.
 *
 * The project store cannot import projectPersistence without creating a module
 * cycle (projectPersistence imports the store), so the room lease lives in
 * this leaf module. `null` means no persistence owner is mounted (for example
 * a unit test); in that mode the store keeps its historical in-memory
 * behaviour. Once the application mounts, every room transition publishes an
 * unhydrated lease before any user or agent mutation can run.
 */

export interface PersistenceContextToken {
  /** Monotonic only when the logical persistence room changes. */
  generation: number;
  /** Stable room namespace, normally `${subject}:workspace`. */
  roomKey: string;
  userId: string | null;
}

export interface PersistenceGateState extends PersistenceContextToken {
  hydrated: boolean;
  error: string | null;
}

export class PersistenceNotReadyError extends Error {
  readonly code = "PERSISTENCE_NOT_READY";

  constructor(message = "The project room is changing; wait for workspace hydration to finish before editing.") {
    super(message);
    this.name = "PersistenceNotReadyError";
  }
}

let currentGate: PersistenceGateState | null = null;
let nextGeneration = 0;
let expectedFallbackGeneration: number | null = null;

/** Begin the first/auth-pending lease for a mounted persistence owner. */
export function beginPendingPersistenceContext(): PersistenceGateState {
  nextGeneration += 1;
  expectedFallbackGeneration = null;
  currentGate = {
    generation: nextGeneration,
    roomKey: "pending-auth:workspace",
    userId: null,
    hydrated: false,
    error: null,
  };
  return currentGate;
}

/**
 * Select a room. Reusing an existing room preserves its generation, which is
 * important: a normal token refresh for the same subject must not invalidate
 * editors or in-flight mutations.
 */
export function beginPersistenceRoom(roomKey: string, userId: string | null): PersistenceGateState {
  if (currentGate?.roomKey === roomKey) {
    expectedFallbackGeneration = null;
    currentGate = { ...currentGate, userId, hydrated: false, error: null };
    return currentGate;
  }
  nextGeneration += 1;
  expectedFallbackGeneration = null;
  currentGate = { generation: nextGeneration, roomKey, userId, hydrated: false, error: null };
  return currentGate;
}

/** Mark the current room ready, but never resurrect a stale room. */
export function completePersistenceRoom(token: PersistenceContextToken, error: string | null = null): boolean {
  if (!currentGate || !samePersistenceContext(currentGate, token)) return false;
  expectedFallbackGeneration = null;
  currentGate = { ...currentGate, hydrated: true, error };
  return true;
}

export function getPersistenceGate(): PersistenceGateState | null {
  return currentGate;
}

export function clearPersistenceGate() {
  currentGate = null;
  expectedFallbackGeneration = null;
}

/**
 * Mark the one synchronous project snapshot that a session-room transition is
 * about to publish. It is deliberately a generation-scoped, one-shot marker:
 * the expected localStorage fallback is ignored during hydration, while the
 * next genuine edit is still recorded and can win timestamp reconciliation.
 */
export function markExpectedPersistenceFallback() {
  expectedFallbackGeneration = currentGate && !currentGate.hydrated ? currentGate.generation : null;
}

/** Consume the expected fallback marker for the current unhydrated lease. */
export function consumeExpectedPersistenceFallback(): boolean {
  const expected = expectedFallbackGeneration;
  expectedFallbackGeneration = null;
  return expected !== null && Boolean(currentGate && !currentGate.hydrated && currentGate.generation === expected);
}

export function samePersistenceContext(left: PersistenceContextToken | null, right: PersistenceContextToken | null): boolean {
  return Boolean(left && right && left.generation === right.generation && left.roomKey === right.roomKey && left.userId === right.userId);
}

export function isPersistenceContextReady(token?: PersistenceContextToken | null): boolean {
  // No persistence owner is mounted. This is intentional for isolated store
  // tests and for the in-memory degraded runtime.
  if (!currentGate) return true;
  return currentGate.hydrated && (!token || samePersistenceContext(currentGate, token));
}

export function assertPersistenceMutationReady() {
  if (currentGate && !currentGate.hydrated) throw new PersistenceNotReadyError();
}
