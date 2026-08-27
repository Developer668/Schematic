import { create } from "zustand";

type LibraryDensity = "comfortable" | "compact";

interface WorkspaceState {
  showGrid: boolean;
  snapToGrid: boolean;
  libraryDensity: LibraryDensity;
  reducedMotion: boolean;
  setShowGrid: (show: boolean) => void;
  setSnapToGrid: (snap: boolean) => void;
  setLibraryDensity: (density: LibraryDensity) => void;
  setReducedMotion: (reduced: boolean) => void;
}

const STORAGE_KEY = "schematic-workspace";

function readPreferences(): Pick<WorkspaceState, "showGrid" | "snapToGrid" | "libraryDensity" | "reducedMotion"> {
  const fallback = { showGrid: true, snapToGrid: true, libraryDensity: "comfortable" as const, reducedMotion: false };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return {
      showGrid: stored.showGrid ?? fallback.showGrid,
      snapToGrid: stored.snapToGrid ?? fallback.snapToGrid,
      libraryDensity: stored.libraryDensity === "compact" ? "compact" : "comfortable",
      reducedMotion: stored.reducedMotion ?? fallback.reducedMotion,
    };
  } catch {
    return fallback;
  }
}

function persist(next: Partial<WorkspaceState>) {
  try {
    const current = readPreferences();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...next }));
  } catch {}
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  ...readPreferences(),
  setShowGrid(showGrid) { persist({ showGrid }); set({ showGrid }); },
  setSnapToGrid(snapToGrid) { persist({ snapToGrid }); set({ snapToGrid }); },
  setLibraryDensity(libraryDensity) { persist({ libraryDensity }); set({ libraryDensity }); },
  setReducedMotion(reducedMotion) {
    persist({ reducedMotion });
    document.documentElement.classList.toggle("reduce-motion", reducedMotion);
    set({ reducedMotion });
  },
}));

if (typeof document !== "undefined") {
  document.documentElement.classList.toggle("reduce-motion", readPreferences().reducedMotion);
}
