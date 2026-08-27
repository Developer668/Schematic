import { create } from "zustand";

type LibraryDensity = "comfortable" | "compact";
export type BottomPanel = "webmcp" | "terminal" | "debug" | "validation";

interface WorkspaceState {
  showGrid: boolean;
  snapToGrid: boolean;
  libraryDensity: LibraryDensity;
  reducedMotion: boolean;
  bottomPanel: BottomPanel;
  bottomCollapsed: boolean;
  bottomHeight: number;
  rightPanelWidth: number;
  setShowGrid: (show: boolean) => void;
  setSnapToGrid: (snap: boolean) => void;
  setLibraryDensity: (density: LibraryDensity) => void;
  setReducedMotion: (reduced: boolean) => void;
  setBottomPanel: (panel: BottomPanel) => void;
  setBottomCollapsed: (collapsed: boolean) => void;
  setBottomHeight: (height: number) => void;
  setRightPanelWidth: (width: number) => void;
}

const STORAGE_KEY = "schematic-workspace";
const workspaceChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("schematic-workspace-sync") : null;

function readPreferences(): Pick<WorkspaceState, "showGrid" | "snapToGrid" | "libraryDensity" | "reducedMotion" | "bottomPanel" | "bottomCollapsed" | "bottomHeight" | "rightPanelWidth"> {
  const fallback = { showGrid: true, snapToGrid: true, libraryDensity: "comfortable" as const, reducedMotion: false, bottomPanel: "webmcp" as const, bottomCollapsed: false, bottomHeight: 224, rightPanelWidth: 360 };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return {
      showGrid: stored.showGrid ?? fallback.showGrid,
      snapToGrid: stored.snapToGrid ?? fallback.snapToGrid,
      libraryDensity: stored.libraryDensity === "compact" ? "compact" : "comfortable",
      reducedMotion: stored.reducedMotion ?? fallback.reducedMotion,
      bottomPanel: ["webmcp", "terminal", "debug", "validation"].includes(stored.bottomPanel) ? stored.bottomPanel : fallback.bottomPanel,
      bottomCollapsed: stored.bottomCollapsed ?? fallback.bottomCollapsed,
      bottomHeight: typeof stored.bottomHeight === "number" ? Math.min(360, Math.max(140, stored.bottomHeight)) : fallback.bottomHeight,
      rightPanelWidth: typeof stored.rightPanelWidth === "number" ? Math.min(720, Math.max(300, stored.rightPanelWidth)) : fallback.rightPanelWidth,
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
  setBottomPanel(bottomPanel) {
    persist({ bottomPanel, bottomCollapsed: false });
    set({ bottomPanel, bottomCollapsed: false });
    workspaceChannel?.postMessage({ type: "workspace:update", state: { bottomPanel, bottomCollapsed: false } });
  },
  setBottomCollapsed(bottomCollapsed) {
    persist({ bottomCollapsed });
    set({ bottomCollapsed });
    workspaceChannel?.postMessage({ type: "workspace:update", state: { bottomCollapsed } });
  },
  setBottomHeight(bottomHeight) {
    const height = Math.min(360, Math.max(140, bottomHeight));
    persist({ bottomHeight: height });
    set({ bottomHeight: height });
    workspaceChannel?.postMessage({ type: "workspace:update", state: { bottomHeight: height } });
  },
  setRightPanelWidth(rightPanelWidth) {
    const width = Math.min(720, Math.max(300, rightPanelWidth));
    persist({ rightPanelWidth: width });
    set({ rightPanelWidth: width });
    workspaceChannel?.postMessage({ type: "workspace:update", state: { rightPanelWidth: width } });
  },
}));

workspaceChannel?.addEventListener("message", (event) => {
  if (event.data?.type === "workspace:update" && event.data.state) useWorkspaceStore.setState(event.data.state);
});

if (typeof document !== "undefined") {
  document.documentElement.classList.toggle("reduce-motion", readPreferences().reducedMotion);
}
