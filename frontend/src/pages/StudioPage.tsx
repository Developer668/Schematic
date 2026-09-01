import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import HardwareCanvas from "../components/canvas/HardwareCanvas.tsx";
import RightPanel from "../components/layout/RightPanel.tsx";
import BottomDock from "../components/layout/BottomDock.tsx";
import ImportDialog from "../components/import/ImportDialog.tsx";
import { useComponentCatalogStore } from "../store/useComponentCatalogStore.ts";
import { useProjectStore, WorkspaceCapacityError } from "../store/useProjectStore.ts";
import { useValidationStore, validateProject } from "../store/useValidationStore.ts";
import { getRegisteredToolNames } from "../webmcp/tools.ts";
import { triggerDownloadVlx } from "../utils/vllxFile.ts";
import { useThemeStore } from "../store/useThemeStore.ts";
import { useWorkspaceStore } from "../store/useWorkspaceStore.ts";
import { isPreviewRunning, PREVIEW_DISCLAIMER, useBehaviorPreviewStore } from "../behavior/useBehaviorPreviewStore.ts";
import { catalog, categories as allCategories, getCatalogComponent, type CatalogComponent } from "../data/catalog.ts";
import ComponentArtwork from "../components/ComponentArtwork.tsx";
import LogoMark from "../components/LogoMark.tsx";
import { useAuth, signOut, getCurrentUserId } from "../auth/session.ts";
import { getProjectPersistenceStatus, subscribeProjectPersistenceStatus } from "../store/projectPersistence.ts";
import { Search, X, Settings, Download, Trash2, Play, Pause, RotateCcw, PanelLeft, PanelRight, ChevronDown, Box, Wrench, Wifi, PanelBottom, Copy, Plus, ShoppingCart, Check, LogOut, User, Menu, Save, AlertTriangle } from "lucide-react";

const LIBRARY_PAGE_SIZE = 60;

function previewSupportPresentation(definition: CatalogComponent) {
  const binding = definition.behavior;
  if (binding) {
    const variant = binding.variant ? ` (${binding.variant})` : "";
    return {
      label: "Preview mapped",
      executable: true,
      detail: `Exact typed profile ${binding.profileId}:v${binding.profileVersion}${variant}. The visual outcome is scripted; source code is not run.`,
    };
  }
  return {
    label: "No scripted preview",
    executable: false,
    detail: "No exact Behavior Profile is registered for this catalog definition. Placement, graph validation, and editable source remain available.",
  };
}

function ThemeIcon({ theme }: { theme: string }) {
  return theme === "dark" ? (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.2v1M8 14v1M1.2 8h1M13.8 8h1M3.2 3.2l.7.7M12.1 12.1l.7.7M3.2 12.8l.7-.7M12.1 3.9l.7-.7" />
    </svg>
  ) : (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M12.5 8A4.5 4.5 0 1 1 8 3.5 3.4 3.4 0 0 0 12.5 8Z" />
    </svg>
  );
}

function UserRoomBadge() {
  const { session } = useAuth();
  const roomId = getCurrentUserId() || "global";
  const shortRoom = roomId.slice(0, 10);
  if (!session) {
    return (
      <Link to="/auth" className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300 sm:px-2.5" aria-label="Sign in for your room">
        <User size={12} /> <span className="hidden sm:inline">Sign in for your room</span><span className="sm:hidden">Sign in</span>
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className="hidden items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300 sm:inline-flex" title={`Room ${roomId} — stored on your device, isolated per user. WebMCP mutates only this room.`}>
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
        Room {shortRoom} • {session.email || "local"}
      </span>
      <button onClick={() => signOut()} className="grid h-7 w-7 place-items-center rounded-full border border-border hover:bg-muted" title="Sign out of the workspace" aria-label="Sign out of the workspace">
        <LogOut size={12} />
      </button>
    </div>
  );
}

export default function StudioPage() {
  const { results, search, setCategory, category } = useComponentCatalogStore();
  const { addComponent, project, projects, activeProjectId, clear, createProject, duplicateProject, switchProject, deleteProject, renameProject } = useProjectStore();
  const previewStatus = useBehaviorPreviewStore((state) => state.status);
  const previewSnapshot = useBehaviorPreviewStore((state) => state.snapshot);
  const startPreview = useBehaviorPreviewStore((state) => state.startPreview);
  const pausePreview = useBehaviorPreviewStore((state) => state.pausePreview);
  const resetPreview = useBehaviorPreviewStore((state) => state.resetPreview);
  const previewError = useBehaviorPreviewStore((state) => state.error);
  const previewAnnouncement = useBehaviorPreviewStore((state) => state.announcement);
  const running = isPreviewRunning(previewStatus);
  const { theme, toggle } = useThemeStore();
  const libraryDensity = useWorkspaceStore((state) => state.libraryDensity);
  const bottomCollapsed = useWorkspaceStore((state) => state.bottomCollapsed);
  const bottomHeight = useWorkspaceStore((state) => state.bottomHeight);
  const rightPanelWidth = useWorkspaceStore((state) => state.rightPanelWidth);
  const setBottomCollapsed = useWorkspaceStore((state) => state.setBottomCollapsed);
  const setBottomHeight = useWorkspaceStore((state) => state.setBottomHeight);
  const setRightPanelWidth = useWorkspaceStore((state) => state.setRightPanelWidth);

  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string | null>(category);
  const [orgFilter, setOrgFilter] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const [deleteProjectArmedId, setDeleteProjectArmedId] = useState<string | null>(null);
  const [clearWorkspaceArmedId, setClearWorkspaceArmedId] = useState<string | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState("");
  const [runError, setRunError] = useState("");
  const [runNotice, setRunNotice] = useState("");
  const [visibleLibraryCount, setVisibleLibraryCount] = useState(LIBRARY_PAGE_SIZE);
  const [persistenceStatus, setPersistenceStatus] = useState(() => getProjectPersistenceStatus());
  const closeImport = useCallback(() => setShowImport(false), []);

  const [leftCollapsed, setLeftCollapsed] = useState(() => typeof window !== "undefined" && window.innerWidth < 900);
  const [rightCollapsed, setRightCollapsed] = useState(() => typeof window !== "undefined" && window.innerWidth < 1280);
  const isBottomResizingRef = useRef(false);
  const isRightResizingRef = useRef(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const overflowMenuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const toolNames = getRegisteredToolNames();

  useEffect(() => subscribeProjectPersistenceStatus(() => setPersistenceStatus(getProjectPersistenceStatus())), []);

  useEffect(() => {
    if (!showProjectMenu && !showOverflowMenu) return;
    const close = (event: MouseEvent) => {
      if (!projectMenuRef.current?.contains(event.target as Node)) {
        setShowProjectMenu(false);
      }
      if (!overflowMenuRef.current?.contains(event.target as Node)) setShowOverflowMenu(false);
    };
    window.addEventListener("mousedown", close);
    return () => {
      window.removeEventListener("mousedown", close);
    };
  }, [showProjectMenu, showOverflowMenu]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setShowProjectMenu(false);
      setShowOverflowMenu(false);
      setEditingProjectId(null);
      setEditingProjectName("");
      if (window.innerWidth < 768) {
        setLeftCollapsed(true);
        setRightCollapsed(true);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  useEffect(() => {
    if (!showProjectMenu) setDeleteProjectArmedId(null);
    if (!showOverflowMenu) setClearWorkspaceArmedId(null);
  }, [showProjectMenu, showOverflowMenu]);

  useEffect(() => {
    setDeleteProjectArmedId(null);
    setClearWorkspaceArmedId(null);
  }, [activeProjectId]);

  useEffect(() => {
    const focusLibrarySearch = (event: KeyboardEvent) => {
      const target = event.target;
      const isEditing = target instanceof Element && target.matches("input, textarea, select, [contenteditable='true']");
      if (isEditing || (event.key !== "/" && !(event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)))) return;
      event.preventDefault();
      setLeftCollapsed(false);
      window.setTimeout(() => searchInputRef.current?.focus(), 0);
    };
    window.addEventListener("keydown", focusLibrarySearch);
    return () => window.removeEventListener("keydown", focusLibrarySearch);
  }, []);

  const doRun = async () => {
    setRunError("");
    setRunNotice("");
    try {
      // Graph validation is independent from Behavior Preview. Keep its
      // diagnostics visible, but never pass source code to the preview path.
      const validation = validateProject(useProjectStore.getState().project);
      useValidationStore.getState().setResult(validation);
      const result = await startPreview({ durationMs: 1_000 });
      if (result?.status === "blocked") {
        setRunError(result.message ?? "Behavior Preview could not start");
        return;
      }
      if (validation.issues.some((issue) => issue.severity === "error")) setRunNotice(`Preview started with ${validation.issues.filter((issue) => issue.severity === "error").length} graph issue(s). See Problems; the scripted outcome does not verify wiring.`);
    } catch (error) {
      setRunError(`Behavior Preview failed: ${(error as Error).message}`);
    }
  };

  const doStop = async () => {
    setRunError("");
    await pausePreview();
  };

  const handleSearch = (v: string) => { setQuery(v); search(v); };
  const handleCategory = (c: string | null) => { setActiveCat(c); setCategory(c); };

  const beginProjectRename = (item: { id: string; name: string }) => {
    setEditingProjectId(item.id);
    setEditingProjectName(item.name);
  };

  const switchProjectFromMenu = (item: { id: string }) => {
    setDeleteProjectArmedId(null);
    switchProject(item.id);
  };

  const cancelProjectRename = () => {
    setEditingProjectId(null);
    setEditingProjectName("");
  };

  const commitProjectRename = () => {
    if (!editingProjectId) return;
    if (editingProjectName.trim()) {
      try {
        renameProject(editingProjectId, editingProjectName);
      } catch (cause) {
        projectMutationError("Renaming the project", cause);
      }
    }
    cancelProjectRename();
  };

  const projectMutationError = (action: string, cause: unknown) => {
    const message = cause instanceof Error ? cause.message : "The project was not changed.";
    setRunError(`${action} ${cause instanceof WorkspaceCapacityError ? "blocked" : "failed"}: ${message}`);
  };

  const createProjectFromMenu = () => {
    setRunError("");
    try {
      createProject(`Project ${projects.length + 1}`);
      setShowProjectMenu(false);
    } catch (cause) {
      projectMutationError("Creating a project", cause);
    }
  };

  const duplicateProjectFromMenu = () => {
    setRunError("");
    try {
      duplicateProject();
      setShowProjectMenu(false);
    } catch (cause) {
      projectMutationError("Duplicating the project", cause);
    }
  };

  const manufacturers = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of catalog) if (c.manufacturer) m.set(c.manufacturer, (m.get(c.manufacturer) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n);
  }, []);

  const filteredResults = useMemo(() => {
    if (!orgFilter) return results;
    return results.filter((c) => c.manufacturer === orgFilter);
  }, [results, orgFilter]);

  useEffect(() => setVisibleLibraryCount(LIBRARY_PAGE_SIZE), [query, activeCat, orgFilter]);

  const visibleResults = useMemo(
    () => filteredResults.slice(0, visibleLibraryCount),
    [filteredResults, visibleLibraryCount],
  );

  const deleteProjectArmed = deleteProjectArmedId === activeProjectId;
  const clearWorkspaceArmed = clearWorkspaceArmedId === activeProjectId;

  const handleDragStart = (e: React.DragEvent, compId: string) => {
    e.dataTransfer.setData("application/x-schematic-component", compId);
    e.dataTransfer.effectAllowed = "copy";
    const def = getCatalogComponent(compId);
    if (def?.thumbnail) {
      const div = document.createElement("div");
      div.innerHTML = def.thumbnail;
      div.style.position = "absolute"; div.style.top = "-1000px"; div.style.width = "28px"; div.style.height = "28px";
      document.body.appendChild(div);
      const svg = div.querySelector("svg");
      if (svg) e.dataTransfer.setDragImage(svg as any, 14, 14);
      setTimeout(() => div.remove(), 0);
    }
  };

  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    isBottomResizingRef.current = true;
    const sy = e.clientY, sh = bottomHeight;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: PointerEvent) => { if (isBottomResizingRef.current) setBottomHeight(sh + (sy - ev.clientY)); };
    const onUp = () => { isBottomResizingRef.current = false; document.body.style.cursor = ""; document.body.style.userSelect = ""; window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onRightResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    isRightResizingRef.current = true;
    const startX = event.clientX;
    const startWidth = rightPanelWidth;
    document.body.style.cursor = "col-resize";
    const onMove = (moveEvent: PointerEvent) => {
      if (isRightResizingRef.current) setRightPanelWidth(startWidth + startX - moveEvent.clientX);
    };
    const onUp = () => {
      isRightResizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className="workbench flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="workbench-header relative z-40 h-11 shrink-0 gap-2 overflow-visible border-b border-border px-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Link to="/" aria-label="Schematic home" className="flex items-center gap-1.5">
            <span className="brand-mark"><LogoMark /></span>
            <span className="hidden text-[13px] font-semibold tracking-[-0.025em] sm:inline">Schematic</span>
          </Link>
          <span className="hidden h-4 w-px bg-border md:block" />
          <div className="relative z-[60] flex min-w-0 max-w-[min(42vw,250px)] shrink items-center gap-2" ref={projectMenuRef}>
            <button
              type="button"
              onClick={() => setShowProjectMenu((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={showProjectMenu}
              className="flex min-w-0 max-w-full items-center gap-1 rounded px-1.5 py-1 text-xs font-medium hover:bg-muted"
              title="Switch project"
            >
              <span className="min-w-0 max-w-[min(34vw,190px)] flex-1 truncate">{project.name}</span>
              <ChevronDown size={11} className={`shrink-0 transition-transform ${showProjectMenu ? "rotate-180" : ""}`} />
            </button>
            <span
              className={`status-pill hidden sm:inline-flex ${persistenceStatus.state === "error" ? "!border-red-500/35 !bg-red-500/10 !text-red-600 dark:!text-red-300" : ""}`}
              role="status"
              aria-live="polite"
              title={persistenceStatus.error ?? "Projects are stored on this device"}
            >
              {persistenceStatus.state === "error" ? <AlertTriangle size={10} /> : <Save size={10} />}
              {persistenceStatus.state === "loading" ? "Loading…" : persistenceStatus.state === "saving" ? "Saving…" : persistenceStatus.state === "error" ? "Save failed" : "Saved on this device"}
            </span>
            {showProjectMenu && (
              <div role="menu" aria-label="Projects" className="absolute left-0 top-full z-[70] mt-2 w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-border bg-card shadow-xl">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <div><div className="kicker">Projects</div><div className="text-[11px] text-muted-foreground">Double-click a name to rename</div></div>
                  <span className="count-badge">{projects.length}</span>
                </div>
                <div className="max-h-[min(16rem,calc(100vh-10rem))] overflow-auto p-1">
                  {projects.map((item) => editingProjectId === item.id ? (
                    <div key={item.id} className="flex w-full items-center gap-2 rounded bg-muted px-2.5 py-2">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                      <input
                        autoFocus
                        value={editingProjectName}
                        onChange={(event) => setEditingProjectName(event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") commitProjectRename();
                          if (event.key === "Escape") cancelProjectRename();
                        }}
                        onBlur={commitProjectRename}
                        aria-label={`Rename ${item.name}`}
                        className="min-w-0 flex-1 select-text rounded border border-border bg-background px-1.5 py-1 text-xs font-medium outline-none focus:border-foreground/40 focus:ring-2 focus:ring-ring/10"
                      />
                      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={commitProjectRename} className="grid h-6 w-6 shrink-0 place-items-center rounded border border-border hover:bg-background" aria-label="Save project name"><Check size={12} /></button>
                    </div>
                  ) : (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      onClick={() => switchProjectFromMenu(item)}
                      onDoubleClick={(event) => { event.stopPropagation(); beginProjectRename(item); }}
                      className={`flex w-full items-center gap-2 rounded px-2.5 py-2 text-left hover:bg-muted ${item.id === activeProjectId ? "bg-muted" : ""}`}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.id === activeProjectId ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                      <span className="min-w-0 flex-1" title="Double-click to rename"><span className="block truncate text-xs font-medium">{item.name}</span><span className="block text-[10px] text-muted-foreground">{item.components.length} comps · {item.connections.length} wires</span></span>
                      {item.id === activeProjectId && <span className="text-[10px] text-emerald-600 dark:text-emerald-400">active</span>}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1 border-t border-border bg-muted/20 p-1.5">
                  <button type="button" onClick={createProjectFromMenu} className="flex flex-1 items-center justify-center gap-1 rounded border border-border px-2 py-1.5 text-[11px] hover:bg-muted"><Plus size={11} /> New</button>
                  <button type="button" onClick={duplicateProjectFromMenu} className="flex flex-1 items-center justify-center gap-1 rounded border border-border px-2 py-1.5 text-[11px] hover:bg-muted"><Copy size={11} /> Duplicate</button>
                  <button
                    type="button"
                    disabled={projects.length <= 1}
                    onClick={() => {
                      const currentProjectId = useProjectStore.getState().activeProjectId;
                      if (deleteProjectArmedId !== currentProjectId) {
                        setDeleteProjectArmedId(currentProjectId);
                        return;
                      }
                      try {
                        const deleted = deleteProject(deleteProjectArmedId);
                        setDeleteProjectArmedId(null);
                        if (deleted) setShowProjectMenu(false);
                      } catch (cause) {
                        projectMutationError("Deleting the project", cause);
                      }
                    }}
                    className={`flex items-center justify-center gap-1 rounded border px-2 py-1.5 text-[11px] text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400 ${deleteProjectArmed ? "border-red-500/40 bg-red-500/10" : "border-border hover:bg-red-50 dark:hover:bg-red-950/20"}`}
                    aria-label={deleteProjectArmed ? `Confirm deletion of ${project.name}` : `Delete ${project.name}`}
                    title={deleteProjectArmed ? "Choose again to confirm" : "Delete current project"}
                  ><Trash2 size={11} />{deleteProjectArmed && <span>Confirm</span>}</button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex min-w-0 shrink items-center justify-end gap-1.5">
          <span className="status-pill hidden lg:inline-flex"><Wifi size={11} /> WebMCP · {toolNames.length}</span>
          {previewSnapshot && <span className="status-pill preview-disclaimer-pill hidden xl:inline-flex" title={PREVIEW_DISCLAIMER}><span className="preview-status-dot" aria-hidden="true" /> Preview · no code</span>}
          <Link to="/parts" className="workspace-icon-button md:hidden" aria-label="Open parts desk" title="Open parts desk">
            <ShoppingCart size={12} strokeWidth={1.8} />
          </Link>
          <Link to="/parts" className="secondary-button hidden md:inline-flex">
            <ShoppingCart size={12} strokeWidth={1.8} /> Parts
          </Link>
          {running ? (
            <button type="button" onClick={doStop} className="run-button is-running" aria-label="Pause behavior preview">
              <Pause size={10} className="fill-white" /> Pause preview
            </button>
          ) : (
            <button type="button" onClick={doRun} className="run-button" aria-label={previewStatus === "paused" ? "Resume behavior preview" : "Preview behavior"}>
              <Play size={9} className="fill-current" /> {previewStatus === "paused" ? "Resume preview" : "Preview behavior"}
            </button>
          )}
          {previewSnapshot && <button type="button" onClick={() => void resetPreview()} className="workspace-icon-button hidden sm:grid" aria-label="Reset behavior preview" title="Reset preview"><RotateCcw size={12} /></button>}
          <UserRoomBadge />
          <div className="relative z-[60]" ref={overflowMenuRef}>
            <button type="button" onClick={() => setShowOverflowMenu((open) => !open)} aria-haspopup="menu" aria-expanded={showOverflowMenu} aria-label="Open workspace menu" title="More workspace actions" className="workspace-icon-button">
              <Menu size={14} strokeWidth={1.8} />
            </button>
            {showOverflowMenu && (
              <div role="menu" aria-label="Workspace actions" className="absolute right-0 top-full z-[70] mt-2 w-56 overflow-hidden rounded-lg border border-border bg-card p-1.5 shadow-xl">
                <button type="button" role="menuitem" onClick={() => { toggle(); setShowOverflowMenu(false); }} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs hover:bg-muted"><ThemeIcon theme={theme} /> {theme === "dark" ? "Use light theme" : "Use dark theme"}</button>
                <Link role="menuitem" to="/settings" onClick={() => setShowOverflowMenu(false)} className="flex items-center gap-2 rounded px-2.5 py-2 text-xs hover:bg-muted"><Settings size={13} /> Settings</Link>
                <button type="button" role="menuitem" onClick={() => { setShowImport(true); setShowOverflowMenu(false); }} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs hover:bg-muted"><Download size={13} /> Import design</button>
                <button type="button" role="menuitem" onClick={() => { triggerDownloadVlx(project.name); setShowOverflowMenu(false); }} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs hover:bg-muted"><Download size={13} /> Export project + editable source</button>
                <div className="my-1 border-t border-border" />
                <button type="button" role="menuitem" onClick={() => { setLeftCollapsed((value) => !value); setShowOverflowMenu(false); }} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs hover:bg-muted"><PanelLeft size={13} /> {leftCollapsed ? "Show components" : "Hide components"}</button>
                <button type="button" role="menuitem" onClick={() => { setRightCollapsed((value) => !value); setShowOverflowMenu(false); }} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs hover:bg-muted"><PanelRight size={13} /> {rightCollapsed ? "Show code panel" : "Hide code panel"}</button>
                <button type="button" role="menuitem" onClick={() => { setBottomCollapsed(!bottomCollapsed); setShowOverflowMenu(false); }} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs hover:bg-muted"><PanelBottom size={13} /> {bottomCollapsed ? "Show bottom panel" : "Hide bottom panel"}</button>
                <button type="button" role="menuitem" onClick={() => {
                  const currentProjectId = useProjectStore.getState().activeProjectId;
                  if (clearWorkspaceArmedId !== currentProjectId) { setClearWorkspaceArmedId(currentProjectId); return; }
                  try {
                    clear();
                    setClearWorkspaceArmedId(null);
                    setShowOverflowMenu(false);
                  } catch (cause) {
                    projectMutationError("Clearing the project", cause);
                  }
                }} className={`flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs text-red-600 dark:text-red-400 ${clearWorkspaceArmed ? "bg-red-500/10" : "hover:bg-red-50 dark:hover:bg-red-950/20"}`}><Trash2 size={13} /> {clearWorkspaceArmed ? "Confirm clear project" : "Clear project"}</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {persistenceStatus.error && (
        <div className="z-30 flex shrink-0 items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200" role="alert">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            {persistenceStatus.error.includes("Workspace recovery")
              ? `${persistenceStatus.error} Your projects remain visible and exportable. Switch projects from the Projects menu, then use the confirmed Clear or Delete action to reduce the room; other edits stay blocked until it fits.`
              : `Device save failed: ${persistenceStatus.error}`}
          </span>
        </div>
      )}

      <main aria-label="Studio workspace layout" className="relative flex flex-1 overflow-hidden min-h-0">
        {!leftCollapsed && <button type="button" className="absolute inset-0 z-20 bg-background/70 backdrop-blur-[1px] md:hidden" onClick={() => setLeftCollapsed(true)} aria-label="Close component library" />}
        {/* LEFT — compact 260px */}
        {!leftCollapsed && (
          <aside aria-label="Component library" className="panel-enter z-30 flex w-[292px] shrink-0 flex-col border-r border-border bg-card max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:shadow-2xl">
            <div className="flex h-11 items-center justify-between border-b border-border px-3">
              <div className="flex items-center gap-2"><Box size={14} /><div><div className="text-xs font-semibold">Components</div><div className="text-[10px] text-muted-foreground">Drag into the workspace</div></div></div>
              <div className="flex items-center gap-1.5">
                <span className="count-badge">{filteredResults.length}</span>
                <button type="button" onClick={() => setLeftCollapsed(true)} className="grid h-7 w-7 place-items-center rounded hover:bg-muted md:hidden" aria-label="Close component library"><X size={13} /></button>
              </div>
            </div>

            <div className="space-y-2.5 border-b border-border p-3">
              <div className="relative">
                <Search size={13} strokeWidth={1.8} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={searchInputRef}
                  value={query}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Search parts and boards"
                  aria-label="Search component library"
                  className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-7 text-xs placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring/10"
                />
                {query ? (
                  <button type="button" onClick={() => handleSearch("")} className="absolute right-0.5 top-1/2 -translate-y-1/2 h-6 w-6 grid place-items-center rounded hover:bg-muted text-muted-foreground" aria-label="Clear component search">
                    <X size={10} strokeWidth={1.8} />
                  </button>
                ) : (
                  <span className="absolute right-1.5 top-1/2 -translate-y-1/2 hidden sm:inline text-[9px] font-mono text-muted-foreground border border-border rounded px-1 leading-none py-0.5">/</span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="kicker !text-[8px] !tracking-[0.06em]">Category</span>
                  <div className="relative">
                    <select value={activeCat ?? ""} onChange={(e) => handleCategory(e.target.value || null)} className="h-8 w-full appearance-none rounded-md border border-border bg-background pl-2 pr-6 text-xs focus:outline-none focus:ring-2 focus:ring-ring/10">
                      <option value="">All</option>
                      {allCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <ChevronDown size={10} strokeWidth={1.7} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </label>
                <label className="space-y-1">
                  <span className="kicker !text-[8px]">Mfr</span>
                  <div className="relative">
                    <select value={orgFilter ?? ""} onChange={(e) => setOrgFilter(e.target.value || null)} className="h-8 w-full appearance-none rounded-md border border-border bg-background pl-2 pr-6 text-xs focus:outline-none focus:ring-2 focus:ring-ring/10">
                      <option value="">All</option>
                      {manufacturers.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <ChevronDown size={10} strokeWidth={1.7} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </label>
              </div>

              {(activeCat || orgFilter || query) && (
                <div className="flex items-center gap-1">
                  {activeCat && <span className="inline-flex rounded border border-foreground bg-foreground text-background px-1 py-0 text-[10px] font-medium">{activeCat}</span>}
                  <button type="button" onClick={() => { setActiveCat(null); setCategory(null); setOrgFilter(null); handleSearch(""); }} className="ml-auto text-[11px] underline decoration-muted-foreground/30 underline-offset-2 hover:decoration-foreground">Reset</button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-auto">
              <div className={`component-list p-2 ${libraryDensity === "compact" ? "is-compact" : ""}`}>
                {filteredResults.length === 0 ? (
                  <div className="mx-1 my-4 rounded border border-dashed border-border p-4 text-center">
                    <p className="text-[11px] font-medium">No components</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Try “esp32”</p>
                  </div>
                ) : (
                  visibleResults.map((c) => {
                    const dot = c.category === "board" || c.category === "display" ? "bg-blue-500" : "bg-zinc-400";
                    const previewSupport = previewSupportPresentation(c);
                    return (
                      <button
                        key={c.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, c.id)}
                        onClick={() => addComponent(c.id)}
                        className="component-list-item group"
                      >
                        <div className="component-preview shrink-0" aria-hidden="true">
                          <ComponentArtwork definition={c} alt="" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-semibold leading-tight">{c.title}</div>
                          <div className="truncate text-[10px] text-muted-foreground">{c.manufacturer ?? c.id}</div>
                          <div className="mt-0.5 flex items-center gap-1">
                            <span className={`h-3 w-[2px] rounded-sm ${dot}`} />
                            <span className="text-[10px] capitalize text-muted-foreground">{c.category}</span>
                            <span className="text-muted-foreground text-[10px]" aria-hidden="true">·</span>
                            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{c.ports.length}</span>
                          </div>
                          <span
                            className={`mt-1 inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-px text-[9px] font-medium leading-4 ${previewSupport.executable ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}
                            aria-label={`Preview support: ${previewSupport.label}`}
                            title={previewSupport.detail}
                          >
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${previewSupport.executable ? "bg-emerald-500" : "bg-amber-500"}`} aria-hidden="true" />
                            <span className="truncate">{previewSupport.label}</span>
                          </span>
                        </div>
                        <span className="component-add">+</span>
                      </button>
                    );
                  })
                )}
                {visibleResults.length < filteredResults.length && (
                  <button
                    type="button"
                    onClick={() => setVisibleLibraryCount((count) => count + LIBRARY_PAGE_SIZE)}
                    className="mx-1 mt-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] font-medium hover:bg-muted"
                  >
                    Show {Math.min(LIBRARY_PAGE_SIZE, filteredResults.length - visibleResults.length)} more
                  </button>
                )}
                <div className="py-1.5 text-center font-mono text-[10px] text-muted-foreground">Showing {visibleResults.length} of {filteredResults.length}</div>
              </div>
            </div>

            <div className="border-t border-border bg-muted/20 px-3 py-2">
              <p className="flex items-center gap-1.5 text-[10px] leading-relaxed text-muted-foreground"><Wrench size={11} /> Click to add · drag to position</p>
            </div>
          </aside>
        )}

        {/* CENTER */}
        <section aria-label="Hardware project canvas" className="flex flex-1 flex-col min-w-0 bg-background relative">
          <h1 className="sr-only">{project.name} hardware workspace</h1>
          {leftCollapsed && (
            <button type="button" onClick={() => setLeftCollapsed(false)} className="absolute left-1.5 top-1.5 z-10 grid h-6 w-6 place-items-center rounded border border-border bg-card hover:bg-muted" aria-label="Open component library" title="Open component library">
              <PanelLeft size={11} strokeWidth={1.7} />
            </button>
          )}
          <div className="relative min-h-0 flex-1">
            <HardwareCanvas key={project.id} onBrowseComponents={() => { setLeftCollapsed(false); window.setTimeout(() => searchInputRef.current?.focus(), 0); }} />
            {(runError || previewError || (previewStatus === "blocked" ? previewAnnouncement : "")) && <div className="run-error" role="alert">{runError || previewError || previewAnnouncement}</div>}
            {previewSnapshot && <div role="status" className="preview-disclaimer absolute left-3 right-3 top-3 z-10 flex items-start gap-2 rounded-md border border-amber-300/70 bg-amber-50/95 px-3 py-2 text-xs leading-snug text-amber-900 shadow-sm dark:border-amber-800 dark:bg-amber-950/85 dark:text-amber-100"><span className="preview-status-dot mt-1" aria-hidden="true" /> <span>{PREVIEW_DISCLAIMER}</span></div>}
            {runNotice && <div role="status" className="absolute bottom-3 left-3 right-3 z-10 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-900 shadow-sm dark:border-amber-800 dark:bg-amber-950/80 dark:text-amber-100">{runNotice}</div>}
          </div>
          {!bottomCollapsed && <div role="separator" aria-orientation="horizontal" aria-label="Resize bottom panel" aria-valuemin={140} aria-valuemax={360} aria-valuenow={Math.round(bottomHeight)} tabIndex={0} onPointerDown={onResizeStart} onKeyDown={(event) => { if (event.key === "ArrowUp") { event.preventDefault(); setBottomHeight(bottomHeight + 16); } if (event.key === "ArrowDown") { event.preventDefault(); setBottomHeight(bottomHeight - 16); } if (event.key === "Home") { event.preventDefault(); setBottomHeight(140); } if (event.key === "End") { event.preventDefault(); setBottomHeight(360); } }} className="flex h-2 shrink-0 cursor-row-resize items-center justify-center bg-border/40 hover:bg-foreground/20 focus-visible:bg-accent/10">
            <span className="h-px w-10 rounded-full bg-muted-foreground/40" />
          </div>}
          <BottomDock collapsed={bottomCollapsed} onToggleCollapse={() => setBottomCollapsed(!bottomCollapsed)} height={bottomHeight} />
        </section>

        {/* RIGHT — compact 300px */}
        {!rightCollapsed ? (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize code panel"
              aria-valuemin={300}
              aria-valuemax={720}
              aria-valuenow={Math.round(rightPanelWidth)}
              tabIndex={0}
              onPointerDown={onRightResizeStart}
              onKeyDown={(event) => {
                if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) event.preventDefault();
                if (event.key === "ArrowLeft") setRightPanelWidth(rightPanelWidth + 16);
                if (event.key === "ArrowRight") setRightPanelWidth(rightPanelWidth - 16);
                if (event.key === "Home") setRightPanelWidth(720);
                if (event.key === "End") setRightPanelWidth(300);
              }}
              className="workbench-resize-handle hidden md:flex"
              title="Drag to resize the code panel"
            />
            <aside aria-label="Code and project inspector" data-testid="docked-code-panel" style={{ width: `${rightPanelWidth}px` }} className="workbench-code-panel panel-enter hidden shrink-0 flex-col border-l border-border bg-card md:flex">
            <RightPanel />
            </aside>
          </>
        ) : (
          <div className="hidden md:flex w-7 shrink-0 flex-col items-center gap-1.5 border-l border-border bg-card py-1.5">
            <button type="button" onClick={() => setRightCollapsed(false)} className="grid h-6 w-6 place-items-center rounded bg-foreground text-background" aria-label="Open code panel" title="Open code panel">
              <PanelRight size={11} strokeWidth={1.7} />
            </button>
          </div>
        )}
      </main>

      <div data-testid="code-panel-mobile-region" className="md:hidden">
        {!rightCollapsed && (
          <div data-testid="code-panel-overlay" className="fixed inset-0 z-30 flex" role="dialog" aria-modal="true" aria-label="Code and project inspector">
            <button type="button" className="flex-1 bg-foreground/10 backdrop-blur-[1px]" onClick={() => setRightCollapsed(true)} aria-label="Close code and project inspector" />
            <div className="flex w-[84vw] max-w-[320px] flex-col border-l border-border bg-card">
              <div className="flex h-7 items-center justify-between border-b border-border px-2.5">
                <span className="kicker">Inspector</span>
                <button type="button" onClick={() => setRightCollapsed(true)} className="grid h-7 w-7 place-items-center rounded hover:bg-muted" aria-label="Close workspace panel"><X size={12} strokeWidth={1.7} /></button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden"><RightPanel /></div>
            </div>
          </div>
        )}
        {rightCollapsed && (
          <button type="button" onClick={() => setRightCollapsed(false)} className="fixed bottom-3 right-3 z-20 grid h-9 w-9 place-items-center rounded bg-foreground text-background shadow" aria-label="Open code panel" title="Open code panel">
            <PanelRight size={12} strokeWidth={1.7} />
          </button>
        )}
      </div>

      {showImport && <ImportDialog onClose={closeImport} />}

      <footer className="flex h-5 items-center gap-2 border-t border-border bg-muted/40 px-2.5 text-[10px] font-mono tabular-nums text-muted-foreground shrink-0">
        <span>{project.components.length}c · {project.connections.length}w</span>
        <span className="hidden sm:inline">· {toolNames.length} tools</span>
        <span className="hidden md:inline">· room {getCurrentUserId()?.slice(0, 8) || "global"} • device-local</span>
        <span className="hidden lg:inline">· WebMCP scoped to your room • <span className="text-emerald-600 dark:text-emerald-400">agent can place on your behalf</span></span>
        <span className="ml-auto">{running ? "previewing" : previewStatus}</span>
      </footer>
    </div>
  );
}
