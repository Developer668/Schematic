import { useState, useMemo, useRef, useEffect, useCallback, useDeferredValue } from "react";
import { Link } from "react-router-dom";
import HardwareCanvas from "../components/canvas/HardwareCanvas.tsx";
import RightPanel from "../components/layout/RightPanel.tsx";
import BottomDock from "../components/layout/BottomDock.tsx";
import ImportDialog from "../components/import/ImportDialog.tsx";
import { useComponentCatalogStore } from "../store/useComponentCatalogStore.ts";
import { useProjectStore, WorkspaceCapacityError } from "../store/useProjectStore.ts";
import { useValidationStore, validateProject } from "../store/useValidationStore.ts";
import { triggerDownloadVlx } from "../utils/vllxFile.ts";
import { useThemeStore } from "../store/useThemeStore.ts";
import { useWorkspaceStore } from "../store/useWorkspaceStore.ts";
import { isPreviewRunning, PREVIEW_DISCLAIMER, useBehaviorPreviewStore } from "../behavior/useBehaviorPreviewStore.ts";
import { catalog, categories as allCategories, getCatalogComponent } from "../data/catalog.ts";
import ComponentArtwork from "../components/ComponentArtwork.tsx";
import LogoMark from "../components/LogoMark.tsx";
import GooeyInput from "../components/ui/gooey-input.tsx";
import { useAuth, signOut } from "../auth/session.ts";
import { flushProjectPersistence, getProjectPersistenceStatus, subscribeProjectPersistenceStatus } from "../store/projectPersistence.ts";
import { X, Settings, Download, Trash2, Play, Pause, RotateCcw, PanelLeft, PanelRight, ChevronDown, Box, Pencil, PanelBottom, Copy, Plus, ShoppingCart, Check, LogOut, User, Menu, Save, AlertTriangle, Info, LoaderCircle, SlidersHorizontal } from "lucide-react";

const LIBRARY_PAGE_SIZE = 60;
type PortFilter = "all" | "compact" | "standard" | "dense";
type CoverageFilter = "all" | "modeled" | "catalog";
type LibrarySort = "relevance" | "name" | "ports";

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
  if (!session) {
    return (
      <Link to="/auth" className="secondary-button" aria-label="Sign in to the workspace">
        <User size={12} />
        <span className="hidden sm:inline">Sign in</span>
      </Link>
    );
  }

  const email = session.email?.trim() || "Signed in";
  const isLocalSession = email.toLowerCase().endsWith("@localhost");
  const initial = (email.charAt(0) || "U").toUpperCase();
  return (
    <div className="user-room-actions">
      <span className={`user-avatar ${isLocalSession ? "is-local" : ""}`} title={isLocalSession ? "Local workspace session" : email} aria-label={isLocalSession ? "Local workspace session" : `Signed in as ${email}`}>
        {isLocalSession ? <User size={13} /> : initial}
      </span>
      <button
        type="button"
        onClick={() => signOut()}
        className="workspace-icon-button"
        title="Sign out"
        aria-label="Sign out of the workspace"
      >
        <LogOut size={12} />
      </button>
    </div>
  );
}

export default function StudioPage() {
  const { results, search, setQuery: setCatalogQuery, setCategory, category } = useComponentCatalogStore();
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
  const [portFilter, setPortFilter] = useState<PortFilter>("all");
  const [coverageFilter, setCoverageFilter] = useState<CoverageFilter>("all");
  const [librarySort, setLibrarySort] = useState<LibrarySort>("relevance");
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  const deferredQuery = useDeferredValue(query);
  const isLibrarySearchPending = deferredQuery !== query;

  const [leftCollapsed, setLeftCollapsed] = useState(() => typeof window !== "undefined" && window.innerWidth < 900);
  const [rightCollapsed, setRightCollapsed] = useState(() => typeof window !== "undefined" && window.innerWidth < 1280);
  const isBottomResizingRef = useRef(false);
  const isRightResizingRef = useRef(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const overflowMenuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
      if (validation.issues.some((issue) => issue.severity === "error")) setRunNotice(`Preview is available, but ${validation.issues.filter((issue) => issue.severity === "error").length} graph issue(s) need attention. Open Problems before hardware bring-up.`);
    } catch (error) {
      setRunError(`Behavior Preview failed: ${(error as Error).message}`);
    }
  };

  const doStop = async () => {
    setRunError("");
    await pausePreview();
  };

  const handleSearch = (v: string) => { setQuery(v); setCatalogQuery(v); };
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
      const nextName = `Project ${projects.length + 1}`;
      const nextProjectId = createProject(nextName);
      setEditingProjectId(nextProjectId);
      setEditingProjectName(nextName);
      setDeleteProjectArmedId(null);
      setShowProjectMenu(true);
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
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, []);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of catalog) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
    return counts;
  }, []);

  const filteredResults = useMemo(() => {
    const filtered = results.filter((component) => {
      if (orgFilter && component.manufacturer !== orgFilter) return false;
      if (portFilter === "compact" && component.ports.length > 8) return false;
      if (portFilter === "standard" && (component.ports.length < 9 || component.ports.length > 20)) return false;
      if (portFilter === "dense" && component.ports.length < 21) return false;
      if (coverageFilter === "modeled" && !component.behavior) return false;
      if (coverageFilter === "catalog" && component.behavior) return false;
      return true;
    });

    if (librarySort === "name") return [...filtered].sort((a, b) => a.title.localeCompare(b.title));
    if (librarySort === "ports") return [...filtered].sort((a, b) => b.ports.length - a.ports.length || a.title.localeCompare(b.title));
    return filtered;
  }, [results, orgFilter, portFilter, coverageFilter, librarySort]);

  useEffect(() => setVisibleLibraryCount(LIBRARY_PAGE_SIZE), [deferredQuery, activeCat, orgFilter, portFilter, coverageFilter, librarySort]);

  useEffect(() => {
    search(deferredQuery);
  }, [deferredQuery, search]);

  const visibleResults = useMemo(
    () => filteredResults.slice(0, visibleLibraryCount),
    [filteredResults, visibleLibraryCount],
  );

  const loadMoreLibraryResults = useCallback(() => {
    setVisibleLibraryCount((count) => Math.min(count + LIBRARY_PAGE_SIZE, filteredResults.length));
  }, [filteredResults.length]);

  const handleLibraryScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    if (target.scrollHeight - target.scrollTop - target.clientHeight < 180) loadMoreLibraryResults();
  };

  const clearWorkspaceArmed = clearWorkspaceArmedId === activeProjectId;
  const hasLibraryFilters = Boolean(
    query || activeCat || orgFilter || portFilter !== "all" || coverageFilter !== "all" || librarySort !== "relevance",
  );
  const activeFilterCount = [
    Boolean(activeCat),
    Boolean(orgFilter),
    portFilter !== "all",
    coverageFilter !== "all",
  ].filter(Boolean).length;

  const resetLibraryFilters = () => {
    setActiveCat(null);
    setCategory(null);
    setOrgFilter(null);
    setPortFilter("all");
    setCoverageFilter("all");
    setLibrarySort("relevance");
    setFiltersOpen(false);
    handleSearch("");
  };

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
    <div className="workbench studio-redesign flex h-screen flex-col overflow-hidden bg-background text-foreground">
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
              className="studio-project-trigger flex min-w-0 max-w-full items-center gap-1 text-xs font-medium"
              title="Switch project"
            >
              <span className="min-w-0 max-w-[min(34vw,190px)] flex-1 truncate">{project.name}</span>
              <ChevronDown size={11} className={`shrink-0 transition-transform ${showProjectMenu ? "rotate-180" : ""}`} />
            </button>
            <button
              type="button"
              className={`status-pill hidden sm:inline-flex ${persistenceStatus.state === "error" ? "!border-red-500/35 !bg-red-500/10 !text-red-600 dark:!text-red-300" : ""}`}
              onClick={() => void flushProjectPersistence()}
              aria-live="polite"
              title={persistenceStatus.error ?? (persistenceStatus.state === "saving" ? "Save now" : "Project saved")}
            >
              {persistenceStatus.state === "error" ? <AlertTriangle size={10} /> : <Save size={10} />}
              {persistenceStatus.state === "loading" ? "Loading" : persistenceStatus.state === "saving" ? "Saving" : persistenceStatus.state === "error" ? "Save issue" : "Saved"}
            </button>
            {showProjectMenu && (
              <div role="menu" aria-label="Projects" className="studio-project-menu absolute left-0 top-full z-[70] mt-2 w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <div><div className="kicker">Projects</div><div className="text-[11px] text-muted-foreground">Create, switch, rename, or remove a project</div></div>
                  <span className="count-badge">{projects.length}</span>
                </div>
                <div className="max-h-[min(16rem,calc(100vh-10rem))] overflow-auto p-1">
                  {projects.map((item) => editingProjectId === item.id ? (
                    <div key={item.id} className="project-menu-row is-editing">
                      <Check size={11} className="shrink-0 text-accent" />
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
                        className="project-menu-name-input"
                      />
                      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={commitProjectRename} className="project-menu-action" aria-label="Save project name"><Check size={12} /></button>
                      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={cancelProjectRename} className="project-menu-action" aria-label="Cancel project rename"><X size={12} /></button>
                    </div>
                  ) : (
                    <div key={item.id} className={`project-menu-row ${item.id === activeProjectId ? "is-active" : ""}`}>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => switchProjectFromMenu(item)}
                        onDoubleClick={(event) => { event.stopPropagation(); beginProjectRename(item); }}
                        className="project-menu-select"
                      >
                        <Box size={11} />
                        <span className="min-w-0 flex-1" title="Double-click to rename">
                          <span className="block truncate text-xs font-medium">{item.name}</span>
                          <span className="block text-[10px] text-muted-foreground">{item.components.length} components · {item.connections.length} wires</span>
                        </span>
                        {item.id === activeProjectId && <Check size={11} className="shrink-0 text-accent" aria-label="Active project" />}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); beginProjectRename(item); }}
                        className="project-menu-action"
                        aria-label={`Rename ${item.name}`}
                        title="Rename project"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        type="button"
                        disabled={projects.length <= 1}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (deleteProjectArmedId !== item.id) {
                            setDeleteProjectArmedId(item.id);
                            return;
                          }
                          try {
                            deleteProject(item.id);
                            setDeleteProjectArmedId(null);
                          } catch (cause) {
                            projectMutationError("Deleting the project", cause);
                          }
                        }}
                        className={`project-menu-action is-danger ${deleteProjectArmedId === item.id ? "is-armed" : ""}`}
                        aria-label={deleteProjectArmedId === item.id ? `Confirm deletion of ${item.name}` : `Delete ${item.name}`}
                        title={deleteProjectArmedId === item.id ? "Choose again to confirm" : "Delete project"}
                      >
                        {deleteProjectArmedId === item.id ? <Check size={11} /> : <Trash2 size={11} />}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-1 border-t border-border bg-muted/20 p-1.5">
                  <button type="button" onClick={createProjectFromMenu} className="flex flex-1 items-center justify-center gap-1 rounded border border-border px-2 py-1.5 text-[11px] hover:bg-muted"><Plus size={11} /> New</button>
                  <button type="button" onClick={duplicateProjectFromMenu} className="flex flex-1 items-center justify-center gap-1 rounded border border-border px-2 py-1.5 text-[11px] hover:bg-muted"><Copy size={11} /> Duplicate</button>

                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex min-w-0 shrink items-center justify-end gap-1.5">
          <Link to="/parts" className="workspace-icon-button md:hidden" aria-label="Open parts desk" title="Open parts desk">
            <ShoppingCart size={12} strokeWidth={1.8} />
          </Link>
          <Link to="/parts" className="secondary-button hidden md:inline-flex">
            <ShoppingCart size={12} strokeWidth={1.8} /> Parts
          </Link>
          {running ? (
            <button
              type="button"
              onClick={doStop}
              className="studio-run-control is-running"
              aria-label="Pause project preview"
              title="Pause project preview"
            >
              <Pause size={12} className="fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={doRun}
              className="studio-run-control"
              aria-label={previewStatus === "paused" ? "Resume project preview" : "Run project preview"}
              title={previewStatus === "paused" ? "Resume project preview" : "Run project preview"}
            >
              <Play size={12} className="fill-current" />
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
          <aside aria-label="Component library" className="studio-library panel-enter z-30 flex shrink-0 flex-col border-r border-border bg-card max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:shadow-2xl">
            <div className="flex h-11 items-center justify-between border-b border-border px-3">
              <div className="flex items-center gap-2"><Box size={14} /><div><div className="text-xs font-semibold">Components</div><div className="text-[10px] text-muted-foreground">Click to add · drag to place<span className="sr-only">. Preview controls appear in the Inspector.</span></div></div></div>
              <div className="flex items-center gap-1.5">
                <span className="count-badge" data-testid="component-search-count" role="status" aria-live="polite" aria-label={isLibrarySearchPending ? "Updating component results" : `${filteredResults.length} matching components`}>
                  {isLibrarySearchPending ? <LoaderCircle size={11} className="animate-spin" aria-hidden="true" /> : filteredResults.length}
                </span>
                <button type="button" onClick={() => setLeftCollapsed(true)} className="grid h-7 w-7 place-items-center rounded hover:bg-muted md:hidden" aria-label="Close component library"><X size={13} /></button>
              </div>
            </div>

            <div className="studio-library-tools border-b border-border p-3">
              <GooeyInput
                ref={searchInputRef}
                value={query}
                onValueChange={handleSearch}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && query) {
                    event.preventDefault();
                    event.stopPropagation();
                    handleSearch("");
                  }
                }}
                placeholder="Search parts, boards, or IDs"
                aria-label="Search component library"
                aria-controls="component-library-results"
                aria-keyshortcuts="/ Control+K"
                inputMode="search"
                shortcut="/"
                rootClassName="studio-gooey-search"
              />

              <div className="library-tools-row">
                <button
                  type="button"
                  className={`library-filter-toggle ${filtersOpen ? "is-open" : ""}`}
                  onClick={() => setFiltersOpen((open) => !open)}
                  aria-expanded={filtersOpen}
                  aria-controls="component-library-filters"
                >
                  <SlidersHorizontal size={12} />
                  <span>Filters</span>
                  {activeFilterCount > 0 && <b>{activeFilterCount}</b>}
                  <ChevronDown size={11} className={filtersOpen ? "rotate-180" : ""} />
                </button>

                <label className="library-sort-control">
                  <span>Sort</span>
                  <select value={librarySort} onChange={(event) => setLibrarySort(event.target.value as LibrarySort)}>
                    <option value="relevance">Best match</option>
                    <option value="name">Name</option>
                    <option value="ports">Most ports</option>
                  </select>
                </label>
              </div>

              {filtersOpen && (
                <div id="component-library-filters" className="library-filter-drawer">
                  <div className="library-filter-grid">
                    <label className="library-filter">
                      <span className="kicker !text-[8px] !tracking-[0.06em]">Category</span>
                      <div className="relative">
                        <select value={activeCat ?? ""} onChange={(event) => handleCategory(event.target.value || null)}>
                          <option value="">All ({catalog.length})</option>
                          {allCategories.map((item) => <option key={item} value={item}>{item} · {categoryCounts.get(item) ?? 0}</option>)}
                        </select>
                        <ChevronDown size={10} strokeWidth={1.7} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      </div>
                    </label>

                    <label className="library-filter">
                      <span className="kicker !text-[8px]">Manufacturer</span>
                      <div className="relative">
                        <select value={orgFilter ?? ""} onChange={(event) => setOrgFilter(event.target.value || null)}>
                          <option value="">All makers</option>
                          {manufacturers.map(([maker, count]) => <option key={maker} value={maker}>{maker} · {count}</option>)}
                        </select>
                        <ChevronDown size={10} strokeWidth={1.7} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      </div>
                    </label>

                    <label className="library-filter">
                      <span className="kicker !text-[8px]">Port count</span>
                      <div className="relative">
                        <select value={portFilter} onChange={(event) => setPortFilter(event.target.value as PortFilter)}>
                          <option value="all">Any port count</option>
                          <option value="compact">Up to 8 ports</option>
                          <option value="standard">9 to 20 ports</option>
                          <option value="dense">21 or more ports</option>
                        </select>
                        <ChevronDown size={10} strokeWidth={1.7} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      </div>
                    </label>

                    <label className="library-filter">
                      <span className="kicker !text-[8px]">Outcome coverage</span>
                      <div className="relative">
                        <select value={coverageFilter} onChange={(event) => setCoverageFilter(event.target.value as CoverageFilter)}>
                          <option value="all">Any coverage</option>
                          <option value="modeled">Modeled outcome</option>
                          <option value="catalog">Catalog only</option>
                        </select>
                        <ChevronDown size={10} strokeWidth={1.7} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      </div>
                    </label>
                  </div>
                  {hasLibraryFilters && (
                    <button type="button" className="library-reset-button" onClick={resetLibraryFilters}>
                      Reset search and filters
                    </button>
                  )}
                </div>
              )}
            </div>

            <div id="component-library-results" className="flex-1 overflow-auto" onScroll={handleLibraryScroll} aria-busy={isLibrarySearchPending}>
              <div className={`component-list p-2 ${libraryDensity === "compact" ? "is-compact" : ""}`}>
                {filteredResults.length === 0 ? (
                  <div className="component-library-empty mx-1 my-4 rounded border border-dashed border-border p-4 text-center" role="status">
                    <Info size={14} className="mx-auto mb-2 text-muted-foreground" aria-hidden="true" />
                    <p className="text-[11px] font-medium">{isLibrarySearchPending ? "Updating parts" : hasLibraryFilters ? `No parts match ${query ? `“${query}”` : "these filters"}` : "No parts in the catalog"}</p>
                    <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{hasLibraryFilters ? "Try a broader term or clear the filters." : "Parts added to the catalog will appear here."}</p>
                    {hasLibraryFilters && <button type="button" onClick={resetLibraryFilters} className="mt-3 rounded border border-border px-2 py-1 text-[10px] font-medium hover:bg-muted">Clear filters</button>}
                  </div>
                ) : (
                  visibleResults.map((c) => {
                    return (
                      <button
                        key={c.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, c.id)}
                        onClick={() => addComponent(c.id)}
                        className="component-list-item group"
                        aria-label={`Add ${c.title} to the workspace`}
                      >
                        <div className="component-preview shrink-0" aria-hidden="true">
                          <ComponentArtwork definition={c} alt="" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-semibold leading-tight">{c.title}</div>
                          <div className="truncate text-[10px] text-muted-foreground">{c.manufacturer ?? c.id}</div>
                          <div className="component-meta-row">
                            <span className="component-meta-badge">{c.category}</span>
                            <span className="font-mono tabular-nums">{c.ports.length} ports</span>
                            <span className={`component-preview-status ${c.behavior ? "is-mapped" : ""}`} title={c.behavior ? "Preview controls available in Inspector" : "No typed preview controls yet"} aria-hidden="true" />
                          </div>
                        </div>
                        <span className="component-add">+</span>
                      </button>
                    );
                  })
                )}
                {visibleResults.length < filteredResults.length && <div className="component-list-progress" role="status" aria-live="polite"><span>Scroll to continue</span><span>{filteredResults.length - visibleResults.length} more parts</span></div>}
                <div className="py-1.5 text-center font-mono text-[10px] text-muted-foreground">Showing {visibleResults.length} of {filteredResults.length}</div>
              </div>
            </div>

          </aside>
        )}

        {/* CENTER */}
        <section aria-label="Hardware project canvas" className="flex flex-1 flex-col min-w-0 bg-background relative">
          <h1 className="sr-only">{project.name} hardware workspace</h1>
          {leftCollapsed && (
            <button type="button" onClick={() => setLeftCollapsed(false)} className="library-toggle-button absolute left-1.5 top-1.5 z-10 grid h-6 w-6 place-items-center rounded border border-border bg-card hover:bg-muted" aria-label="Open component library" title="Open component library">
              <PanelLeft size={11} strokeWidth={1.7} />
            </button>
          )}
          <div className="relative min-h-0 flex-1">
            <HardwareCanvas key={project.id} />
            {(runError || previewError || (previewStatus === "blocked" ? previewAnnouncement : "")) && <div className="run-error" role="alert">{runError || previewError || previewAnnouncement}</div>}
            {previewSnapshot && <div role="status" className="preview-disclaimer absolute left-3 right-3 top-3 z-10 flex items-start gap-2 rounded-xl border border-border bg-card/95 px-3 py-2 text-xs leading-snug text-muted-foreground shadow-sm backdrop-blur"><Info size={13} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" /> <span>{PREVIEW_DISCLAIMER}</span></div>}
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

      <footer className="studio-footer flex shrink-0 items-center font-mono tabular-nums">
        <span>{project.components.length} components</span>
        <span className="studio-footer-separator">·</span>
        <span>{project.connections.length} wires</span>
        <span className="hidden sm:inline studio-footer-separator">·</span>
        <span className="hidden sm:inline">Local room</span>
        <span className="hidden md:inline studio-footer-separator">·</span>
        <span className="hidden md:inline">{window.location.hostname === "localhost" ? "development · localhost" : window.location.host}</span>
        <span className="ml-auto">{running ? "preview active" : previewStatus}</span>
      </footer>
    </div>
  );
}
