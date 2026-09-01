import { create } from "zustand";

type LibraryDensity = "comfortable" | "compact";
export type BottomPanel = "webmcp" | "terminal" | "debug" | "validation";
export type RightPanelTab = "code" | "inspect" | "project" | "shopping";

interface WorkspaceState {
  showGrid: boolean;
  snapToGrid: boolean;
  libraryDensity: LibraryDensity;
  reducedMotion: boolean;
  bottomPanel: BottomPanel;
  bottomCollapsed: boolean;
  bottomHeight: number;
  rightPanelWidth: number;
  rightPanelTab: RightPanelTab;
  setShowGrid: (show: boolean) => void;
  setSnapToGrid: (snap: boolean) => void;
  setLibraryDensity: (density: LibraryDensity) => void;
  setReducedMotion: (reduced: boolean) => void;
  setBottomPanel: (panel: BottomPanel) => void;
  setBottomCollapsed: (collapsed: boolean) => void;
  setBottomHeight: (height: number) => void;
  setRightPanelWidth: (width: number) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
}

const STORAGE_KEY = "schematic-workspace";
const workspaceChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("schematic-workspace-sync") : null;
const WORKSPACE_PANELS = ["webmcp", "terminal", "debug", "validation"] as const;
const RIGHT_PANELS = ["code", "inspect", "project", "shopping"] as const;

function finiteInRange(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function isWorkspacePanel(value: unknown): value is BottomPanel {
  return typeof value === "string" && (WORKSPACE_PANELS as readonly string[]).includes(value);
}

function isRightPanelTab(value: unknown): value is RightPanelTab {
  return typeof value === "string" && (RIGHT_PANELS as readonly string[]).includes(value);
}

function readPreferences(): Pick<WorkspaceState, "showGrid" | "snapToGrid" | "libraryDensity" | "reducedMotion" | "bottomPanel" | "bottomCollapsed" | "bottomHeight" | "rightPanelWidth" | "rightPanelTab"> {
  const fallback = { showGrid: true, snapToGrid: true, libraryDensity: "comfortable" as const, reducedMotion: false, bottomPanel: "debug" as const, bottomCollapsed: false, bottomHeight: 224, rightPanelWidth: 360, rightPanelTab: "code" as const };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return {
      showGrid: typeof stored.showGrid === "boolean" ? stored.showGrid : fallback.showGrid,
      snapToGrid: typeof stored.snapToGrid === "boolean" ? stored.snapToGrid : fallback.snapToGrid,
      libraryDensity: stored.libraryDensity === "compact" ? "compact" : "comfortable",
      reducedMotion: typeof stored.reducedMotion === "boolean" ? stored.reducedMotion : fallback.reducedMotion,
      bottomPanel: WORKSPACE_PANELS.includes(stored.bottomPanel) ? stored.bottomPanel : fallback.bottomPanel,
      bottomCollapsed: typeof stored.bottomCollapsed === "boolean" ? stored.bottomCollapsed : fallback.bottomCollapsed,
      bottomHeight: finiteInRange(stored.bottomHeight, 140, 360, fallback.bottomHeight),
      rightPanelWidth: finiteInRange(stored.rightPanelWidth, 300, 720, fallback.rightPanelWidth),
      rightPanelTab: RIGHT_PANELS.includes(stored.rightPanelTab) ? stored.rightPanelTab : fallback.rightPanelTab,
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
  setShowGrid(showGrid) {
    if (typeof showGrid !== "boolean") return;
    persist({ showGrid });
    set({ showGrid });
  },
  setSnapToGrid(snapToGrid) {
    if (typeof snapToGrid !== "boolean") return;
    persist({ snapToGrid });
    set({ snapToGrid });
  },
  setLibraryDensity(libraryDensity) {
    if (libraryDensity !== "compact" && libraryDensity !== "comfortable") return;
    persist({ libraryDensity });
    set({ libraryDensity });
  },
  setReducedMotion(reducedMotion) {
    if (typeof reducedMotion !== "boolean") return;
    persist({ reducedMotion });
    document.documentElement.classList.toggle("reduce-motion", reducedMotion);
    set({ reducedMotion });
  },
  setBottomPanel(bottomPanel) {
    if (!isWorkspacePanel(bottomPanel)) return;
    persist({ bottomPanel, bottomCollapsed: false });
    set({ bottomPanel, bottomCollapsed: false });
    workspaceChannel?.postMessage({ type: "workspace:update", state: { bottomPanel, bottomCollapsed: false } });
  },
  setBottomCollapsed(bottomCollapsed) {
    if (typeof bottomCollapsed !== "boolean") return;
    persist({ bottomCollapsed });
    set({ bottomCollapsed });
    workspaceChannel?.postMessage({ type: "workspace:update", state: { bottomCollapsed } });
  },
  setBottomHeight(bottomHeight) {
    if (typeof bottomHeight !== "number" || !Number.isFinite(bottomHeight)) return;
    const height = Math.min(360, Math.max(140, bottomHeight));
    persist({ bottomHeight: height });
    set({ bottomHeight: height });
    workspaceChannel?.postMessage({ type: "workspace:update", state: { bottomHeight: height } });
  },
  setRightPanelWidth(rightPanelWidth) {
    if (typeof rightPanelWidth !== "number" || !Number.isFinite(rightPanelWidth)) return;
    const width = Math.min(720, Math.max(300, rightPanelWidth));
    persist({ rightPanelWidth: width });
    set({ rightPanelWidth: width });
    workspaceChannel?.postMessage({ type: "workspace:update", state: { rightPanelWidth: width } });
  },
  setRightPanelTab(rightPanelTab) {
    if (!isRightPanelTab(rightPanelTab)) return;
    persist({ rightPanelTab });
    set({ rightPanelTab });
    workspaceChannel?.postMessage({ type: "workspace:update", state: { rightPanelTab } });
  },
}));

workspaceChannel?.addEventListener("message", (event) => {
  if (event.data?.type !== "workspace:update" || !event.data.state) return;
  const value = event.data.state as Record<string, unknown>;
  const next: Partial<Pick<WorkspaceState, "showGrid" | "snapToGrid" | "libraryDensity" | "reducedMotion" | "bottomPanel" | "bottomCollapsed" | "bottomHeight" | "rightPanelWidth" | "rightPanelTab">> = {};
  if (typeof value.showGrid === "boolean") next.showGrid = value.showGrid;
  if (typeof value.snapToGrid === "boolean") next.snapToGrid = value.snapToGrid;
  if (value.libraryDensity === "compact" || value.libraryDensity === "comfortable") next.libraryDensity = value.libraryDensity;
  if (typeof value.reducedMotion === "boolean") next.reducedMotion = value.reducedMotion;
  if (isWorkspacePanel(value.bottomPanel)) next.bottomPanel = value.bottomPanel;
  if (typeof value.bottomCollapsed === "boolean") next.bottomCollapsed = value.bottomCollapsed;
  if (typeof value.bottomHeight === "number" && Number.isFinite(value.bottomHeight)) next.bottomHeight = finiteInRange(value.bottomHeight, 140, 360, 224);
  if (typeof value.rightPanelWidth === "number" && Number.isFinite(value.rightPanelWidth)) next.rightPanelWidth = finiteInRange(value.rightPanelWidth, 300, 720, 360);
  if (isRightPanelTab(value.rightPanelTab)) next.rightPanelTab = value.rightPanelTab;
  if (Object.keys(next).length) useWorkspaceStore.setState(next);
});

if (typeof document !== "undefined") {
  document.documentElement.classList.toggle("reduce-motion", readPreferences().reducedMotion);
}
