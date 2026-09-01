import type {
  BehaviorDiagnostic,
  BehaviorSessionLogEntry,
  BehaviorSnapshot as SharedBehaviorSnapshot,
  BehaviorTimelineEvent,
  ComponentVisualProjection,
  PreviewClaims,
  VisualPrimitive,
} from "@schematic/behavior";

/**
 * Browser-facing names for the shared Behavior System contract.
 *
 * Reducers and snapshot hashes are owned by `@schematic/behavior`; these
 * aliases deliberately prevent the UI from drifting into a second, subtly
 * incompatible runtime. `claims` is optional only for old in-memory fixtures
 * and migration snapshots; real package snapshots always include it.
 */
export type PreviewPrimitive = VisualPrimitive;
export type PreviewProjection = ComponentVisualProjection;
export type PreviewTimelineEvent = BehaviorTimelineEvent;
export type PreviewLogEntry = BehaviorSessionLogEntry;
export type PreviewDiagnostic = BehaviorDiagnostic;
export type PreviewSnapshot = Omit<SharedBehaviorSnapshot, "claims"> & { claims?: PreviewClaims };

export type PreviewStatus = "idle" | "ready" | "playing" | "paused" | "partial" | "blocked";

export interface PreviewCommandResult {
  snapshot?: PreviewSnapshot | null;
  status?: PreviewStatus;
  /** Bounded logical playback window for the active plan. */
  durationMs?: number;
  diagnostics?: readonly PreviewDiagnostic[];
  preparationStatus?: "ready" | "partial" | null;
  rejected?: readonly unknown[];
  message?: string;
}
