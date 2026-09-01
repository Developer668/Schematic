import { create } from "zustand";
import { getCurrentUserId } from "../auth/session.ts";

interface SelectionState {
  selectedIds: string[];
  activeComponentId: string | null;
  select: (id: string) => void;
  deselect: (id: string) => void;
  setActive: (id: string | null) => void;
  clear: () => void;
}

const selectionChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("schematic-selection-sync") : null;
const MAX_SELECTION_IDS = 200;
const MAX_SELECTION_ID_LENGTH = 200;

function validSelectionId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_SELECTION_ID_LENGTH;
}

function normalizeSelection(value: unknown): Pick<SelectionState, "selectedIds" | "activeComponentId"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { selectedIds: [], activeComponentId: null };
  const state = value as Record<string, unknown>;
  const selectedIds = Array.isArray(state.selectedIds)
    ? [...new Set(state.selectedIds.filter(validSelectionId))].slice(0, MAX_SELECTION_IDS)
    : [];
  const activeComponentId = validSelectionId(state.activeComponentId) && selectedIds.includes(state.activeComponentId) ? state.activeComponentId : null;
  return { selectedIds, activeComponentId };
}

function publishSelection(state: Pick<SelectionState, "selectedIds" | "activeComponentId">) {
  selectionChannel?.postMessage({ type: "selection:update", roomId: getCurrentUserId(), state: normalizeSelection(state) });
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedIds: [],
  activeComponentId: null,
  select(id) {
    if (!validSelectionId(id)) return;
    set((state) => {
      const next = { selectedIds: [...new Set([...state.selectedIds, id])], activeComponentId: id };
      publishSelection(next);
      return next;
    });
  },
  deselect(id) {
    if (!validSelectionId(id)) return;
    set((state) => {
      const selectedIds = state.selectedIds.filter((x) => x !== id);
      const next = { selectedIds, activeComponentId: selectedIds[0] ?? null };
      publishSelection(next);
      return next;
    });
  },
  setActive(id) {
    const next = normalizeSelection({ activeComponentId: id, selectedIds: id ? [id] : [] });
    set(next);
    publishSelection(next);
  },
  clear() {
    const next = { selectedIds: [], activeComponentId: null };
    set(next);
    publishSelection(next);
  },
}));

selectionChannel?.addEventListener("message", (event) => {
  if (event.data?.type !== "selection:update" || !event.data.state || (event.data.roomId ?? null) !== getCurrentUserId()) return;
  useSelectionStore.setState(normalizeSelection(event.data.state));
});

if (typeof window !== "undefined") {
  window.addEventListener("schematic-session", () => useSelectionStore.setState({ selectedIds: [], activeComponentId: null }));
}
