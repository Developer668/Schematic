import { create } from "zustand";

interface SelectionState {
  selectedIds: string[];
  activeComponentId: string | null;
  select: (id: string) => void;
  deselect: (id: string) => void;
  setActive: (id: string | null) => void;
  clear: () => void;
}

const selectionChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("schematic-selection-sync") : null;

function publishSelection(state: Pick<SelectionState, "selectedIds" | "activeComponentId">) {
  selectionChannel?.postMessage({ type: "selection:update", state: { selectedIds: state.selectedIds, activeComponentId: state.activeComponentId } });
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedIds: [],
  activeComponentId: null,
  select(id) {
    set((state) => {
      const next = { selectedIds: [...new Set([...state.selectedIds, id])], activeComponentId: id };
      publishSelection(next);
      return next;
    });
  },
  deselect(id) {
    set((state) => {
      const selectedIds = state.selectedIds.filter((x) => x !== id);
      const next = { selectedIds, activeComponentId: selectedIds[0] ?? null };
      publishSelection(next);
      return next;
    });
  },
  setActive(id) {
    const next = { activeComponentId: id, selectedIds: id ? [id] : [] };
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
  if (event.data?.type === "selection:update" && event.data.state) useSelectionStore.setState(event.data.state);
});
