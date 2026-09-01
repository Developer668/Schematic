import type { ComponentInstance } from "@schematic/hardware-graph";
import type { BehaviorProfile, ComponentVisualProjection, DeterministicActionContext, ResolvedComponentAction, StateTransition } from "../contracts";

export const catalogOnlyProfile: BehaviorProfile<null> = {
  manifest: { id: "catalog-only", version: 1, implementationId: "catalog-only:v1:20260831", actions: [], events: [] },
  parseState: () => null,
  initialState: (_instance: ComponentInstance) => null,
  reduce: (_state: null, _action: ResolvedComponentAction, _context: DeterministicActionContext): readonly StateTransition<null>[] => [],
  projectVisual: (_state: null): ComponentVisualProjection => ({
    primitives: [],
    accessibleSummary: "Visual behavior controls are not mapped for this exact catalog part yet.",
  }),
};
