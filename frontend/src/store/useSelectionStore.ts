import { create } from "zustand";

interface SelectionState {
  selectedIds: string[];
  activeComponentId: string | null;
  select: (id: string) => void;
  deselect: (id: string) => void;
  setActive: (id: string | null) => void;
  clear: () => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedIds: [],
  activeComponentId: null,
  select(id) {
    set((s) => ({ selectedIds: [...new Set([...s.selectedIds, id])], activeComponentId: id }));
  },
  deselect(id) {
    set((s) => ({ selectedIds: s.selectedIds.filter((x) => x !== id), activeComponentId: s.selectedIds.filter((x) => x !== id)[0] ?? null }));
  },
  setActive(id) {
    set({ activeComponentId: id, selectedIds: id ? [id] : [] });
  },
  clear() {
    set({ selectedIds: [], activeComponentId: null });
  },
}));
